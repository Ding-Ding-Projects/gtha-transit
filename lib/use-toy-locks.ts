'use client';

/**
 * The one store behind every lock, ticket, authenticator entry and history record
 * in this browser.
 *
 * One store rather than a hook per surface because a lock set in Settings must
 * refuse the saved-trips page in the same render, and a history record must be
 * appended by whichever surface made the change. Two copies of the lock list
 * would be two answers to "is this locked", and the wrong one would be the one a
 * palette teleport happened to read.
 *
 * What is persisted and what is not is the design:
 *
 * - the lock list, the TOTP secrets for locks (in their own record), the attempt
 *   budgets and the ladder's hourly budget are written to storage, so a reload
 *   neither loses a lock nor refunds a wait;
 * - unlock grants are held in memory only, so every lock is locked on launch.
 */

import { useSyncExternalStore } from 'react';
import {
  LOCKS_STORAGE_KEY,
  LOCK_ATTEMPTS_STORAGE_KEY,
  LOCK_OTP_STORAGE_KEY,
  beginAttempt,
  createLock,
  freshAttempts,
  grantFor,
  isLockedNow,
  parseAttempts,
  parseLocks,
  redactLock,
  serializeLocks,
  serveClock,
  submitStep,
  targetId,
  type AttemptOutcome,
  type AttemptState,
  type LockDraft,
  type LockRecord,
  type UnlockAttempt,
  type UnlockGrant,
} from './toy-locks.ts';
import { clearWait, spendLadder } from './unlock-ladder.ts';
import { TICKETS_STORAGE_KEY, parseTickets, serializeTickets, type Ticket } from './support-tickets.ts';
import { AUTHENTICATOR_STORAGE_KEY, parseEntries, serializeEntries, type AuthenticatorEntry } from './authenticator.ts';
import { HISTORY_STORAGE_KEY, appendHistory, parseHistory, serializeHistory, type HistoryInput, type HistoryRecord } from './secret-history.ts';

export const LADDER_STORAGE_KEY = 'gtha-toy-lock-ladder-v1';

export type LockStoreState = {
  ready: boolean;
  /** Storage refused a write at least once; changes hold for this session only. */
  storageFailed: boolean;
  locks: LockRecord[];
  /** Records restored without their credential, dropped rather than restored weaker. */
  dropped: number;
  attempts: Record<string, AttemptState>;
  grants: Record<string, UnlockGrant>;
  ladderSkips: number[];
  tickets: Ticket[];
  entries: AuthenticatorEntry[];
  history: HistoryRecord[];
  /** Set when a history write was refused, so the surface can say it was not recorded. */
  historyFailed: boolean;
};

let state: LockStoreState = {
  ready: false, storageFailed: false, locks: [], dropped: 0, attempts: {}, grants: {}, ladderSkips: [],
  tickets: [], entries: [], history: [], historyFailed: false,
};
let otpSecrets: Record<string, string> = {};
const listeners = new Set<() => void>();

const emit = () => { for (const listener of listeners) listener(); };
const set = (patch: Partial<LockStoreState>) => { state = { ...state, ...patch }; emit(); };

function write(key: string, value: string): boolean {
  try { localStorage.setItem(key, value); return true; } catch { state = { ...state, storageFailed: true }; return false; }
}

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function restore() {
  if (state.ready || typeof window === 'undefined') return;
  try { otpSecrets = JSON.parse(read(LOCK_OTP_STORAGE_KEY) || '{}') ?? {}; } catch { otpSecrets = {}; }
  if (!otpSecrets || typeof otpSecrets !== 'object') otpSecrets = {};
  const { locks, dropped } = parseLocks(read(LOCKS_STORAGE_KEY), otpSecrets);
  let skips: number[] = [];
  try { const parsed = JSON.parse(read(LADDER_STORAGE_KEY) || '[]'); if (Array.isArray(parsed)) skips = parsed.filter(Number.isFinite).slice(-20); } catch { /* none */ }
  state = {
    ...state,
    ready: true,
    locks,
    dropped,
    attempts: parseAttempts(read(LOCK_ATTEMPTS_STORAGE_KEY)),
    ladderSkips: skips,
    tickets: parseTickets(read(TICKETS_STORAGE_KEY)),
    entries: parseEntries(read(AUTHENTICATOR_STORAGE_KEY)),
    history: parseHistory(read(HISTORY_STORAGE_KEY)),
  };
  window.addEventListener('storage', (event) => {
    /* Another tab changed something. Re-read everything except grants, which
       belong to this tab alone. */
    if (event.key && ![LOCKS_STORAGE_KEY, LOCK_OTP_STORAGE_KEY, LOCK_ATTEMPTS_STORAGE_KEY, LADDER_STORAGE_KEY, TICKETS_STORAGE_KEY, AUTHENTICATOR_STORAGE_KEY, HISTORY_STORAGE_KEY].includes(event.key)) return;
    const grants = state.grants;
    state = { ...state, ready: false };
    restore();
    set({ grants });
  });
}

const subscribe = (listener: () => void) => {
  restore();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const snapshot = () => state;
const serverSnapshot = () => state;

/* ------------------------------------------------------------ writers -- */

const saveLocks = (locks: LockRecord[]) => write(LOCKS_STORAGE_KEY, serializeLocks(locks));
const saveSecrets = () => write(LOCK_OTP_STORAGE_KEY, JSON.stringify(otpSecrets));
const saveAttempts = (attempts: Record<string, AttemptState>) => write(LOCK_ATTEMPTS_STORAGE_KEY, JSON.stringify(attempts));

/** Every secret held right now, so the history can refuse a record that contains one. */
const knownSecrets = () => [...Object.values(otpSecrets), ...state.entries.map((entry) => entry.secret)];

export function recordHistory(input: HistoryInput, now = Date.now()): boolean {
  try {
    const history = appendHistory(state.history, input, now, knownSecrets());
    if (!write(HISTORY_STORAGE_KEY, serializeHistory(history))) { set({ historyFailed: true }); return false; }
    set({ history, historyFailed: false });
    return true;
  } catch {
    set({ historyFailed: true });
    return false;
  }
}

export function replaceHistory(history: HistoryRecord[]): boolean {
  if (!write(HISTORY_STORAGE_KEY, serializeHistory(history))) { set({ historyFailed: true }); return false; }
  set({ history, historyFailed: false });
  return true;
}

/* --------------------------------------------------------------- locks -- */

export const lockFor = (id: string): LockRecord | undefined => state.locks.find((lock) => targetId(lock.target) === id);

export function isTargetLocked(id: string, now = Date.now()): boolean {
  const lock = lockFor(id);
  return isLockedNow(lock, lock ? state.grants[lock.id] : undefined, now);
}

/**
 * Create a lock and record it.
 *
 * The creator is granted the lock straight away: somebody who has just typed the
 * PIN does not need to type it again to see the thing they locked. The grant is
 * memory only, so the next reload finds it locked.
 */
export function addLock(draft: LockDraft, now = Date.now()): LockRecord {
  const id = targetId(draft.target);
  if (lockFor(id)) throw new Error('That surface already has a lock. Remove it first.');
  const { lock, otpSecret } = createLock(draft, now);
  if (otpSecret) { otpSecrets = { ...otpSecrets, [lock.id]: otpSecret }; saveSecrets(); }
  const locks = [...state.locks, lock];
  saveLocks(locks);
  set({ locks, grants: { ...state.grants, [lock.id]: grantFor(lock, now) } });
  recordHistory({ action: 'lock-created', subject: `${lock.target.label.en} (${id})`, fields: ['policy', 'duration'], detail: lock.policy }, now);
  return lock;
}

/**
 * Remove a lock.
 *
 * Refused while the lock is shut. A remove button that worked on a locked
 * surface would be the lock's own way around itself, so the caller must unlock
 * first; the surface says so rather than offering a button that does nothing.
 */
export function removeLock(lockId: string, now = Date.now()): boolean {
  const lock = state.locks.find((item) => item.id === lockId);
  if (!lock || isLockedNow(lock, state.grants[lock.id], now)) return false;
  const locks = state.locks.filter((item) => item.id !== lockId);
  const { [lockId]: _secret, ...remainingSecrets } = otpSecrets;
  otpSecrets = remainingSecrets;
  saveSecrets();
  saveLocks(locks);
  const { [lockId]: _grant, ...grants } = state.grants;
  const { [lockId]: _attempts, ...attempts } = state.attempts;
  saveAttempts(attempts);
  set({ locks, grants, attempts });
  recordHistory({ action: 'lock-removed', subject: `${lock.target.label.en} (${targetId(lock.target)})`, fields: ['policy'], detail: lock.policy }, now);
  return true;
}

export function relock(lockId: string) {
  if (!state.grants[lockId]) return;
  const { [lockId]: _grant, ...grants } = state.grants;
  set({ grants });
}

/** A surface-scoped grant ends when that surface goes away. */
export function releaseSurface(lockId: string) {
  if (state.grants[lockId]?.scope === 'surface') relock(lockId);
}

export const attemptsFor = (lockId: string, now = Date.now()): AttemptState => serveClock(state.attempts[lockId] ?? freshAttempts(), now);

export function newAttempt(lockId: string, now = Date.now()): UnlockAttempt | null {
  const lock = state.locks.find((item) => item.id === lockId);
  return lock ? beginAttempt(lock, now) : null;
}

/**
 * Submit one factor. The keypad and the typed field both land here.
 */
export function submitFactor(lockId: string, attempt: UnlockAttempt, value: string, now = Date.now()): { attempt: UnlockAttempt; outcome: AttemptOutcome } {
  const lock = state.locks.find((item) => item.id === lockId);
  if (!lock) return { attempt, outcome: 'expired' };
  const result = submitStep(lock, attempt, attemptsFor(lockId, now), value, otpSecrets[lockId] ?? null, now);
  const attempts = { ...state.attempts, [lockId]: result.attempts };
  saveAttempts(attempts);
  const patch: Partial<LockStoreState> = { attempts };
  if (result.outcome === 'unlocked') patch.grants = { ...state.grants, [lockId]: grantFor(lock, now) };
  set(patch);
  return { attempt: result.attempt, outcome: result.outcome };
}

/** The ladder was cleared: the wait ends, and nothing else changes. */
export function ladderCleared(lockId: string, now = Date.now()) {
  const next = clearWait(attemptsFor(lockId, now), state.ladderSkips, now);
  const attempts = { ...state.attempts, [lockId]: next.attempts };
  saveAttempts(attempts);
  write(LADDER_STORAGE_KEY, JSON.stringify(next.skips));
  set({ attempts, ladderSkips: next.skips });
}

export function ladderLost(lockId: string, now = Date.now()) {
  const attempts = { ...state.attempts, [lockId]: spendLadder(attemptsFor(lockId, now)) };
  saveAttempts(attempts);
  set({ attempts });
}

export const exportLocks = () => state.locks.map(redactLock);

/* ------------------------------------------------------------- tickets -- */

export function setTickets(tickets: Ticket[]) {
  write(TICKETS_STORAGE_KEY, serializeTickets(tickets));
  set({ tickets });
}

/* ------------------------------------------------------- authenticator -- */

/**
 * Replace the entry list, recording the mutation first.
 *
 * The history record is written before the change is reported, and a refused
 * record leaves the entries unchanged: a mutation the history does not hold is
 * exactly the one the history exists to have.
 */
export function setEntries(entries: AuthenticatorEntry[], record: HistoryInput | null, now = Date.now()): boolean {
  if (record && !recordHistory(record, now)) return false;
  write(AUTHENTICATOR_STORAGE_KEY, serializeEntries(entries));
  set({ entries });
  return true;
}

/* ---------------------------------------------------------------- hook -- */

/** The current state, for code that is not rendering: tests, and event handlers outside React. */
export const lockStoreSnapshot = (): LockStoreState => state;

export function useToyLocks(): LockStoreState {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
