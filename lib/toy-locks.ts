/**
 * Toy locks: a speed bump somebody puts in front of one part of their own
 * planner, and nothing more than that.
 *
 * The rules that make it safe to ship are the ones a lock gets wrong first.
 *
 * **Every lock is its own lock.** It carries its own policy, its own salt and
 * its own credential set. There is no master credential, unlocking one surface
 * never unlocks another, and a bulk lock creates one record per target. A person
 * who wants the same PIN everywhere types it everywhere; nothing assumes it.
 *
 * **Credentials are hashes.** A PIN or password is kept as PBKDF2-HMAC-SHA256
 * over a random salt, never as the value. A TOTP secret cannot be hashed -- the
 * code has to be computed from it -- so it lives in a separate record from the
 * lock list, which means the list can be exported, searched and recorded in
 * history without carrying anything usable.
 *
 * **Wrong answers cost time, never content.** Five wrong answers start a wait
 * that doubles with each consecutive lockout up to a ceiling. Nothing is wiped,
 * nothing escalates past waiting, and the prompt says how to get out: clear this
 * site's data. A lock must never be the only thing between somebody and their
 * own trips, and in a browser it cannot be anyway.
 *
 * **It is not security, and nothing here says it is.** Anybody with the browser
 * can clear site data. The honesty test in `tests/toy-locks.test.mjs` fails if
 * this module's own copy starts claiming otherwise.
 *
 * No React and no storage calls here. The hook in `use-toy-locks.ts` owns
 * persistence; this file owns the rules, so each one is testable directly.
 */

import { pbkdf2Sha256 } from './pbkdf2.ts';
import { base32Decode, validParameters, verifyTotp, type OtpParameters } from './totp.ts';

export const LOCKS_STORAGE_KEY = 'gtha-toy-locks-v1';
export const LOCK_OTP_STORAGE_KEY = 'gtha-toy-lock-otp-v1';
export const LOCK_ATTEMPTS_STORAGE_KEY = 'gtha-toy-lock-attempts-v1';

/** The six policies, in the order the wizard offers them. */
export const LOCK_POLICIES = ['pin', 'password', 'pin+password', 'password+totp', 'pin+totp', 'password+pin+totp'] as const;
export type LockPolicy = (typeof LOCK_POLICIES)[number];

export type Factor = 'pin' | 'password' | 'totp';

/** The order each policy asks for its factors in. Written out, not derived from the name. */
export const POLICY_FACTORS: Readonly<Record<LockPolicy, readonly Factor[]>> = Object.freeze({
  pin: ['pin'],
  password: ['password'],
  'pin+password': ['pin', 'password'],
  'password+totp': ['password', 'totp'],
  'pin+totp': ['pin', 'totp'],
  'password+pin+totp': ['password', 'pin', 'totp'],
});

/**
 * The surfaces that can carry a lock.
 *
 * The Privacy section is deliberately not lockable: it holds the list of locks,
 * the recovery route and Support Tickets, and a lock in front of the way out of
 * locks is a wall rather than a speed bump.
 */
export const LOCKABLE_SECTIONS = ['appearance', 'language', 'comfort', 'narrator'] as const;
export type LockTargetKind = 'saved-trip' | 'settings-section' | 'appearance-studio' | 'history';

export type LockTarget = { kind: LockTargetKind; key: string; label: { en: string; zh: string } };

export const targetId = (target: Pick<LockTarget, 'kind' | 'key'>): string => `${target.kind}:${target.key}`;

export type UnlockDuration =
  | { kind: 'surface' }
  | { kind: 'minutes'; minutes: number }
  | { kind: 'session' };

export const MAX_UNLOCK_MINUTES = 240;

export type HashedFactor = { salt: string; hash: string; iterations: number };

export type LockRecord = {
  version: 1;
  id: string;
  target: LockTarget;
  policy: LockPolicy;
  pin?: HashedFactor;
  password?: HashedFactor;
  /** The parameters only. The secret is in its own record, keyed by `id`. */
  totp?: OtpParameters;
  duration: UnlockDuration;
  createdAt: number;
  changedAt: number;
};

/**
 * Work factor. The same reasoning as School mode's: synchronous plain
 * JavaScript, so a vault-sized count would freeze a phone for seconds per
 * factor, and the thing being resisted is somebody guessing at a PIN they set
 * themselves, not an offline attack on a stolen database.
 */
export const LOCK_ITERATIONS = 50_000;

export const PIN_MIN = 4;
export const PIN_MAX = 12;
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 128;

export const pinIsUsable = (pin: string): boolean => typeof pin === 'string' && new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin);
export const passwordIsUsable = (password: string): boolean =>
  typeof password === 'string' && password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX && password.trim().length > 0;

/* ------------------------------------------------------------ hashing -- */

const encoder = new TextEncoder();
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

function randomBytes(length: number): Uint8Array {
  const source = globalThis.crypto;
  if (!source || typeof source.getRandomValues !== 'function') throw new Error('No secure random source is available in this browser.');
  return source.getRandomValues(new Uint8Array(length));
}

export function hashFactor(value: string, iterations = LOCK_ITERATIONS, salt: Uint8Array = randomBytes(16)): HashedFactor {
  return { salt: toBase64(salt), hash: toBase64(pbkdf2Sha256(encoder.encode(value), salt, iterations, 32)), iterations };
}

export function matchesFactor(stored: HashedFactor | undefined, value: string): boolean {
  if (!stored || typeof value !== 'string' || value.length === 0) return false;
  let candidate: string;
  try { candidate = toBase64(pbkdf2Sha256(encoder.encode(value), fromBase64(stored.salt), stored.iterations, 32)); } catch { return false; }
  if (candidate.length !== stored.hash.length) return false;
  let difference = 0;
  for (let index = 0; index < candidate.length; index += 1) difference |= candidate.charCodeAt(index) ^ stored.hash.charCodeAt(index);
  return difference === 0;
}

/* ----------------------------------------------------------- creation -- */

export type LockDraft = {
  target: LockTarget;
  policy: LockPolicy;
  pin?: string;
  pinConfirm?: string;
  password?: string;
  passwordConfirm?: string;
  /** Base32, generated locally by the wizard. */
  otpSecret?: string;
  otp?: OtpParameters;
  /** One current code typed back, which is what arms the factor. */
  otpConfirmCode?: string;
  duration: UnlockDuration;
  /** The person ticked that this is a speed bump and read how to get out. */
  acknowledged: boolean;
};

export type DraftProblem =
  | 'unknown-policy' | 'not-acknowledged' | 'pin-unusable' | 'pin-mismatch'
  | 'password-unusable' | 'password-mismatch' | 'otp-secret' | 'otp-parameters' | 'otp-confirm' | 'duration' | 'target';

/** What stops this draft becoming a lock, in the order the wizard asks. Empty means it can be created. */
export function draftProblems(draft: LockDraft, unixSeconds: number): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (!draft?.target || !draft.target.key || !draft.target.kind) problems.push('target');
  if (!LOCK_POLICIES.includes(draft?.policy)) return [...problems, 'unknown-policy'];
  const factors = POLICY_FACTORS[draft.policy];
  if (factors.includes('pin')) {
    if (!pinIsUsable(draft.pin ?? '')) problems.push('pin-unusable');
    else if (draft.pin !== draft.pinConfirm) problems.push('pin-mismatch');
  }
  if (factors.includes('password')) {
    if (!passwordIsUsable(draft.password ?? '')) problems.push('password-unusable');
    else if (draft.password !== draft.passwordConfirm) problems.push('password-mismatch');
  }
  if (factors.includes('totp')) {
    const secret = base32Decode(draft.otpSecret ?? '');
    if (!secret || secret.length < 10) problems.push('otp-secret');
    else if (!validParameters(draft.otp)) problems.push('otp-parameters');
    else if (!verifyTotp(secret, draft.otpConfirmCode ?? '', unixSeconds, draft.otp).ok) problems.push('otp-confirm');
  }
  const duration = draft.duration;
  if (!duration || !['surface', 'minutes', 'session'].includes(duration.kind)
    || (duration.kind === 'minutes' && !(Number.isInteger(duration.minutes) && duration.minutes >= 1 && duration.minutes <= MAX_UNLOCK_MINUTES))) {
    problems.push('duration');
  }
  if (draft.acknowledged !== true) problems.push('not-acknowledged');
  return problems;
}

let sequence = 0;
const newLockId = () => `lock-${Date.now().toString(36)}-${(sequence += 1).toString(36)}-${toBase64(randomBytes(6)).replace(/[^A-Za-z0-9]/g, '')}`;

/**
 * Make a lock.
 *
 * Only the factors the policy names are hashed and kept. A PIN supplied to a
 * password-only policy is dropped rather than stored "in case", because a
 * credential nobody is asked for is a credential nobody knows is there.
 */
export function createLock(draft: LockDraft, now = Date.now(), iterations = LOCK_ITERATIONS): { lock: LockRecord; otpSecret: string | null } {
  const problems = draftProblems(draft, Math.floor(now / 1000));
  if (problems.length > 0) throw new Error(`The lock cannot be created: ${problems.join(', ')}`);
  const factors = POLICY_FACTORS[draft.policy];
  const lock: LockRecord = {
    version: 1,
    id: newLockId(),
    target: { kind: draft.target.kind, key: draft.target.key, label: { en: String(draft.target.label.en).slice(0, 120), zh: String(draft.target.label.zh).slice(0, 120) } },
    policy: draft.policy,
    duration: draft.duration.kind === 'minutes' ? { kind: 'minutes', minutes: draft.duration.minutes } : { kind: draft.duration.kind },
    createdAt: now,
    changedAt: now,
  };
  if (factors.includes('pin')) lock.pin = hashFactor(draft.pin!, iterations);
  if (factors.includes('password')) lock.password = hashFactor(draft.password!, iterations);
  if (factors.includes('totp')) lock.totp = { algorithm: draft.otp!.algorithm, digits: draft.otp!.digits, period: draft.otp!.period };
  return { lock, otpSecret: factors.includes('totp') ? draft.otpSecret!.replace(/\s/g, '').toUpperCase() : null };
}

/**
 * The same draft applied to several targets, as several independent locks.
 *
 * Each gets its own salt and its own id. Nothing is shared except what the
 * person typed, and they typed it once per target by choosing bulk.
 */
export function createLocks(draft: Omit<LockDraft, 'target'>, targets: readonly LockTarget[], now = Date.now(), iterations = LOCK_ITERATIONS) {
  return targets.map((target) => createLock({ ...draft, target }, now, iterations));
}

/* ------------------------------------------------------- verification -- */

/**
 * The one validator every input route feeds.
 *
 * The keypad and the typed field both call this with the same factor and the
 * same value, so they cannot disagree about what is right, and both spend the
 * same attempt budget because the caller records the result in one place.
 */
export function checkFactor(lock: LockRecord, factor: Factor, value: string, otpSecret: string | null, unixSeconds: number): boolean {
  if (!POLICY_FACTORS[lock.policy]?.includes(factor)) return false;
  if (factor === 'pin') return matchesFactor(lock.pin, value);
  if (factor === 'password') return matchesFactor(lock.password, value);
  const secret = base32Decode(otpSecret ?? '');
  if (!secret || !lock.totp) return false;
  return verifyTotp(secret, value, unixSeconds, lock.totp).ok;
}

/* ---------------------------------------------------- attempt budget -- */

export const ATTEMPTS_PER_WAIT = 5;
export const FIRST_WAIT_MS = 30_000;
export const MAX_WAIT_MS = 30 * 60_000;

export type AttemptState = {
  /** Wrong answers since the last wait ended or the last success. */
  failures: number;
  /** Consecutive lockouts. Only a correct unlock resets this. */
  lockouts: number;
  /** When the current wait ends, or null when there is none. */
  waitUntil: number | null;
  /** Which lockout the ladder was last used or lost for, so it is offered once per lockout. */
  ladderSpentFor: number | null;
};

export const freshAttempts = (): AttemptState => ({ failures: 0, lockouts: 0, waitUntil: null, ladderSpentFor: null });

/** Exponential, capped. The same wall whether or not the ladder was cleared last time. */
export const waitFor = (lockouts: number): number =>
  lockouts < 1 ? 0 : Math.min(MAX_WAIT_MS, FIRST_WAIT_MS * 2 ** Math.min(20, lockouts - 1));

/** A wait that has run out restores the budget. Nothing else does, except a correct answer. */
export function serveClock(state: AttemptState, now: number): AttemptState {
  if (state.waitUntil !== null && state.waitUntil <= now) return { ...state, failures: 0, waitUntil: null };
  return state;
}

export function attemptsLeft(state: AttemptState, now: number): number {
  const current = serveClock(state, now);
  return current.waitUntil !== null ? 0 : Math.max(0, ATTEMPTS_PER_WAIT - current.failures);
}

export function recordFailure(state: AttemptState, now: number): AttemptState {
  const current = serveClock(state, now);
  if (current.waitUntil !== null) return current;
  const failures = current.failures + 1;
  if (failures < ATTEMPTS_PER_WAIT) return { ...current, failures };
  const lockouts = current.lockouts + 1;
  return { ...current, failures, lockouts, waitUntil: now + waitFor(lockouts) };
}

export const recordSuccess = (): AttemptState => freshAttempts();

/* ----------------------------------------------------- the attempt itself -- */

/** How long already-verified factors are kept for while the next one is typed. */
export const ATTEMPT_TTL_MS = 2 * 60_000;

export type UnlockAttempt = { lockId: string; step: number; startedAt: number };

export const beginAttempt = (lock: LockRecord, now: number): UnlockAttempt => ({ lockId: lock.id, step: 0, startedAt: now });

export type AttemptOutcome = 'next' | 'unlocked' | 'wrong' | 'waiting' | 'expired';

/**
 * Submit the factor the attempt is currently asking for.
 *
 * A wrong answer spends one attempt and sends the attempt back to its first
 * step: verified factors are kept only for the attempt they belong to, never
 * carried into the next one, so a multi-factor lock cannot be walked one factor
 * per wait.
 */
export function submitStep(
  lock: LockRecord,
  attempt: UnlockAttempt,
  attempts: AttemptState,
  value: string,
  otpSecret: string | null,
  now: number,
): { attempt: UnlockAttempt; attempts: AttemptState; outcome: AttemptOutcome } {
  const budget = serveClock(attempts, now);
  if (budget.waitUntil !== null) return { attempt: beginAttempt(lock, now), attempts: budget, outcome: 'waiting' };
  if (attempt.lockId !== lock.id || now - attempt.startedAt > ATTEMPT_TTL_MS) {
    return { attempt: beginAttempt(lock, now), attempts: budget, outcome: 'expired' };
  }
  const factors = POLICY_FACTORS[lock.policy];
  const factor = factors[attempt.step];
  if (!factor) return { attempt: beginAttempt(lock, now), attempts: budget, outcome: 'expired' };
  if (!checkFactor(lock, factor, value, otpSecret, Math.floor(now / 1000))) {
    const next = recordFailure(budget, now);
    return { attempt: beginAttempt(lock, now), attempts: next, outcome: next.waitUntil !== null ? 'waiting' : 'wrong' };
  }
  if (attempt.step + 1 < factors.length) return { attempt: { ...attempt, step: attempt.step + 1 }, attempts: budget, outcome: 'next' };
  return { attempt: beginAttempt(lock, now), attempts: recordSuccess(), outcome: 'unlocked' };
}

/* ------------------------------------------------------ unlock sessions -- */

/**
 * An open lock, held in memory only.
 *
 * Never persisted, which is what makes every lock locked on launch: a reload
 * starts with no grants at all.
 */
export type UnlockGrant = { lockId: string; until: number | null; scope: UnlockDuration['kind'] };

export function grantFor(lock: LockRecord, now: number): UnlockGrant {
  const duration = lock.duration;
  return {
    lockId: lock.id,
    scope: duration.kind,
    until: duration.kind === 'minutes' ? now + duration.minutes * 60_000 : null,
  };
}

export const grantIsLive = (grant: UnlockGrant | undefined, now: number): boolean =>
  Boolean(grant) && (grant!.until === null || grant!.until > now);

/**
 * Does this surface refuse activation right now?
 *
 * The gate asks this and nothing else. A lock with no live grant refuses; a
 * surface with no lock at all never does.
 */
export function isLockedNow(lock: LockRecord | undefined, grant: UnlockGrant | undefined, now: number): boolean {
  if (!lock) return false;
  return !(grant && grant.lockId === lock.id && grantIsLive(grant, now));
}

/* ---------------------------------------------------------- persistence -- */

export function serializeLocks(locks: readonly LockRecord[]): string {
  return JSON.stringify({ version: 1, locks });
}

const validHashed = (value: unknown): value is HashedFactor =>
  Boolean(value) && typeof (value as HashedFactor).salt === 'string' && (value as HashedFactor).salt.length > 0
  && typeof (value as HashedFactor).hash === 'string' && (value as HashedFactor).hash.length > 0
  && Number.isInteger((value as HashedFactor).iterations) && (value as HashedFactor).iterations >= 1 && (value as HashedFactor).iterations <= 2_000_000;

/**
 * Restore the lock list.
 *
 * A record whose policy names a factor it has no credential for is dropped and
 * counted, never restored: a lock that cannot be opened would be a wall, and a
 * lock quietly restored without its factor would be a different, weaker lock.
 * The caller says how many were dropped rather than letting a surface become
 * unlocked with no explanation.
 */
export function parseLocks(raw: string | null | undefined, otpSecrets: Readonly<Record<string, string>> = {}): { locks: LockRecord[]; dropped: number } {
  if (!raw) return { locks: [], dropped: 0 };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { locks: [], dropped: 0 }; }
  const list = (parsed as { version?: unknown; locks?: unknown })?.version === 1 ? (parsed as { locks: unknown }).locks : null;
  if (!Array.isArray(list)) return { locks: [], dropped: 0 };
  const locks: LockRecord[] = [];
  let dropped = 0;
  const seen = new Set<string>();
  for (const item of list.slice(0, 500)) {
    const record = item as LockRecord;
    const factors = LOCK_POLICIES.includes(record?.policy) ? POLICY_FACTORS[record.policy] : null;
    const kindOk = ['saved-trip', 'settings-section', 'appearance-studio', 'history'].includes(record?.target?.kind);
    const complete = factors
      && (!factors.includes('pin') || validHashed(record.pin))
      && (!factors.includes('password') || validHashed(record.password))
      && (!factors.includes('totp') || (validParameters(record.totp) && Boolean(base32Decode(otpSecrets[record.id] ?? ''))));
    const id = kindOk ? targetId(record.target) : '';
    if (record?.version !== 1 || typeof record.id !== 'string' || !kindOk || !complete || seen.has(id)) { dropped += 1; continue; }
    seen.add(id);
    locks.push({
      version: 1,
      id: record.id,
      target: { kind: record.target.kind, key: String(record.target.key).slice(0, 400), label: { en: String(record.target.label?.en ?? '').slice(0, 120), zh: String(record.target.label?.zh ?? '').slice(0, 120) } },
      policy: record.policy,
      ...(factors.includes('pin') ? { pin: record.pin } : {}),
      ...(factors.includes('password') ? { password: record.password } : {}),
      ...(factors.includes('totp') ? { totp: { algorithm: record.totp!.algorithm, digits: record.totp!.digits, period: record.totp!.period } } : {}),
      duration: record.duration?.kind === 'minutes' && Number.isInteger(record.duration.minutes) && record.duration.minutes >= 1 && record.duration.minutes <= MAX_UNLOCK_MINUTES
        ? { kind: 'minutes', minutes: record.duration.minutes }
        : record.duration?.kind === 'session' ? { kind: 'session' } : { kind: 'surface' },
      createdAt: Number.isFinite(record.createdAt) ? record.createdAt : 0,
      changedAt: Number.isFinite(record.changedAt) ? record.changedAt : 0,
    });
  }
  return { locks, dropped };
}

export function parseAttempts(raw: string | null | undefined): Record<string, AttemptState> {
  let parsed: unknown;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { return {}; }
  if (!parsed || typeof parsed !== 'object') return {};
  const out: Record<string, AttemptState> = {};
  for (const [id, value] of Object.entries(parsed as Record<string, AttemptState>).slice(0, 500)) {
    if (!value || typeof value !== 'object') continue;
    out[id] = {
      failures: Number.isInteger(value.failures) ? Math.max(0, Math.min(ATTEMPTS_PER_WAIT, value.failures)) : 0,
      lockouts: Number.isInteger(value.lockouts) ? Math.max(0, Math.min(1000, value.lockouts)) : 0,
      waitUntil: Number.isFinite(value.waitUntil) ? value.waitUntil : null,
      ladderSpentFor: Number.isInteger(value.ladderSpentFor) ? value.ladderSpentFor : null,
    };
  }
  return out;
}

/**
 * What a lock looks like outside this browser: in an export, in history, in a
 * search result. The target, the policy and the timing, with every credential
 * field left out and a line saying so.
 */
export function redactLock(lock: LockRecord): Record<string, unknown> {
  return {
    target: targetId(lock.target),
    label: lock.target.label.en,
    policy: lock.policy,
    duration: lock.duration.kind === 'minutes' ? `${lock.duration.minutes} minutes` : lock.duration.kind,
    createdAt: new Date(lock.createdAt).toISOString(),
    credentials: 'omitted: PIN and password hashes, salts and authenticator secrets are never exported',
  };
}

/* ----------------------------------------------------------------- copy -- */

/**
 * Said on the wizard and the unlock prompt, outside every funny level.
 *
 * Names what the lock is, what it is not, and the one way out, with its cost.
 */
export const LOCK_DISCLOSURE = Object.freeze({
  en: 'This lock is for fun. It is a speed bump in this browser, not protection for anything.',
  zh: '呢把鎖係玩下嘅，只係喺呢個瀏覽器度擺個減速壆，唔會保護到任何嘢。',
});

export const LOCK_RECOVERY = Object.freeze({
  en: 'Forgot it? Clear this site\'s data in your browser settings and every lock is gone. That also clears your saved trips and settings.',
  zh: '唔記得？喺瀏覽器設定清除本網站資料，所有鎖就會冇晒，但係已儲存嘅行程同設定都會一齊清走。',
});

export function policyLabel(policy: LockPolicy, t: (en: string, zh: string) => string): string {
  return {
    pin: t('PIN', 'PIN 碼'),
    password: t('Password', '密碼'),
    'pin+password': t('PIN, then password', '先 PIN 碼，再密碼'),
    'password+totp': t('Password, then authenticator code', '先密碼，再驗證碼'),
    'pin+totp': t('PIN, then authenticator code', '先 PIN 碼，再驗證碼'),
    'password+pin+totp': t('Password, then PIN, then authenticator code', '先密碼，再 PIN 碼，最後驗證碼'),
  }[policy];
}

export function factorLabel(factor: Factor, t: (en: string, zh: string) => string): string {
  return { pin: t('PIN', 'PIN 碼'), password: t('Password', '密碼'), totp: t('Authenticator code', '驗證碼') }[factor];
}
