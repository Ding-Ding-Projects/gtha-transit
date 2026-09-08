/**
 * School mode: a self-imposed lock that puts the planner into plain English.
 *
 * Three things about it are easy to get wrong and are the whole design.
 *
 * **It omits rather than disables.** While it is on, the Cantonese and bilingual
 * modes, both playfulness sliders, the personal-vocabulary file and the dim sum
 * surprise behave as though they were never installed: no control, no label, no
 * search result, no palette row, no picture. A greyed-out switch labelled
 * "Cantonese" tells everybody looking at the screen exactly what was turned off,
 * which is the opposite of what somebody turning this on wanted.
 *
 * **It can be renamed, and then the shipped name is gone.** Somebody who calls it
 * "Exam mode" gets that everywhere; nothing in the interface says "School mode"
 * again. A rename that leaked the original name in one tooltip would defeat the
 * rename entirely.
 *
 * **It is a speed bump, not a security boundary, and it says so.** The credential
 * is a salted hash in this browser's own storage. Anybody who can clear site data
 * can turn the mode off, and the unlock dialog tells them that rather than
 * implying a protection it cannot provide. Claiming otherwise would be the
 * dishonest part; the honesty is what makes it fine to ship.
 */

export const SCHOOL_STORAGE_KEY = 'gtha-school-mode-v1';

/** The name it ships with, used only until somebody chooses their own. */
export const SHIPPED_NAME = 'School mode';
export const MAX_NAME = 40;

/** PBKDF2 work factor. High enough to matter, low enough not to stall a phone. */
export const PBKDF2_ITERATIONS = 210_000;
export const MIN_SECRET = 4;

export type SchoolState = {
  on: boolean;
  /** What this person calls it. Empty means the shipped name. */
  name: string;
  /** Salted hash of the secret that turns it off. Never the secret. */
  salt: string;
  hash: string;
};

export const emptySchoolState = (): SchoolState => ({ on: false, name: '', salt: '', hash: '' });

/** The name to show. Never falls back to the shipped name once one is chosen. */
export const schoolName = (state: SchoolState): string => (state.name.trim() || SHIPPED_NAME);

export const hasChosenName = (state: SchoolState): boolean => state.name.trim().length > 0;

export function renameSchool(state: SchoolState, name: string): SchoolState {
  return { ...state, name: String(name ?? '').slice(0, MAX_NAME) };
}

/* ------------------------------------------------------------ the credential -- */

const encoder = new TextEncoder();
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

/**
 * Derive the stored hash.
 *
 * The secret itself is never stored, never logged, never exported and never put
 * anywhere a capture could reach. What is kept is this, and a random salt.
 */
export async function deriveHash(secret: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

/** Turn it on, setting the secret that will turn it off again. */
export async function lock(state: SchoolState, secret: string): Promise<SchoolState> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { ...state, on: true, salt: toBase64(salt), hash: await deriveHash(secret, salt) };
}

/**
 * Is this the secret?
 *
 * Compared in constant time for the length of the digest. The threat here is not
 * really a timing attack -- it is a lock somebody put on their own browser -- but
 * a comparison that returns early is the kind of thing that gets copied into
 * somewhere it does matter.
 */
export async function verify(state: SchoolState, secret: string): Promise<boolean> {
  if (!state.on || !state.salt || !state.hash) return false;
  let candidate: string;
  try { candidate = await deriveHash(secret, fromBase64(state.salt)); } catch { return false; }
  if (candidate.length !== state.hash.length) return false;
  let difference = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    difference |= candidate.charCodeAt(index) ^ state.hash.charCodeAt(index);
  }
  return difference === 0;
}

/** Turn it off, forgetting the credential but keeping the chosen name. */
export const unlock = (state: SchoolState): SchoolState => ({ ...state, on: false, salt: '', hash: '' });

export const secretIsUsable = (secret: string): boolean => typeof secret === 'string' && secret.trim().length >= MIN_SECRET;

/* -------------------------------------------------------------- suppression -- */

/**
 * What the mode hides.
 *
 * Named as a list rather than checked ad hoc at each site, so a new surface has
 * one place to ask and a reviewer has one place to read. Every one of these is
 * omitted while the mode is on, not disabled.
 */
export const SUPPRESSED = ['cantonese', 'bilingual', 'playfulness', 'vocabulary', 'dim-sum'] as const;
export type Suppressed = (typeof SUPPRESSED)[number];

export const suppresses = (state: SchoolState, what: Suppressed): boolean => state.on;

/**
 * The language mode to render in.
 *
 * English while it is on, whatever was chosen before. The previous choice is not
 * overwritten: it is still in its own setting and returns the moment the mode is
 * turned off.
 */
export const effectiveLanguage = (state: SchoolState, chosen: string): string => (state.on ? 'en' : chosen);

/** Both playfulness sliders read at their shipped level while it is on. */
export const effectiveFunLevel = (state: SchoolState, chosen: number): number => (state.on ? 5 : chosen);

/* -------------------------------------------------------------- persistence -- */

export function serializeSchool(state: SchoolState): string {
  return JSON.stringify({ version: 1, on: state.on, name: state.name, salt: state.salt, hash: state.hash });
}

/**
 * Restore.
 *
 * A record that says the mode is on but carries no credential would be a lock
 * nobody could open, so it restores as off: the failure mode of a self-imposed
 * speed bump must never be locking somebody out of their own planner.
 */
export function parseSchool(raw: string | null | undefined): SchoolState {
  const empty = emptySchoolState();
  if (!raw) return empty;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return empty; }
  if (!parsed || typeof parsed !== 'object') return empty;
  const { version, on, name, salt, hash } = parsed as Record<string, unknown>;
  if (version !== 1) return empty;
  const state: SchoolState = {
    on: on === true,
    name: typeof name === 'string' ? name.slice(0, MAX_NAME) : '',
    salt: typeof salt === 'string' ? salt : '',
    hash: typeof hash === 'string' ? hash : '',
  };
  if (state.on && (!state.salt || !state.hash)) return { ...state, on: false, salt: '', hash: '' };
  return state;
}

/**
 * How somebody who has forgotten the secret gets back in.
 *
 * Stated plainly wherever the lock is, because forgetting it is a normal outcome
 * for a lock somebody set on themselves, and a lock with no way out is not a
 * speed bump, it is a wall.
 */
export const RECOVERY = Object.freeze({
  en: 'Clearing this site\'s data in your browser turns it off. That also clears your saved trips and settings.',
  zh: '喺瀏覽器清除本網站資料就會關閉，同時會清埋已儲存嘅行程同設定。',
});
