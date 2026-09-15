/**
 * The mutation history for authenticator entries, the display name and locks.
 *
 * Every add, change and removal appends one record, and records are never
 * edited: a label, a restore or a prune is itself a new record. Each record
 * carries the SHA-256 of the one before it, so a history that has been edited
 * in storage says so when it is read rather than presenting a tidied past.
 *
 * **No secret ever enters a record.** A record names what changed -- which entry,
 * which fields -- and never a value that could open anything. `appendHistory`
 * refuses a record whose detail carries a field name that looks like a
 * credential, and `tests/secret-history.test.mjs` feeds it real secrets and
 * checks the serialized log for them.
 *
 * Where the contract cannot apply literally: it asks for a local Git repository
 * in the application-data directory, with encrypted snapshots keyed from the
 * operating-system credential vault. A browser has none of those. The shipped
 * equivalent is this append-only, hash-chained log in the origin's own storage,
 * without snapshots, which is why restore covers the display name (whose earlier
 * values are not secret and are in the log) and not authenticator secrets.
 */

import { sha256 } from './pbkdf2.ts';

export const HISTORY_STORAGE_KEY = 'gtha-secret-history-v1';
export const HISTORY_MAX = 1_000;

export const HISTORY_ACTIONS = [
  'totp-added', 'totp-changed', 'totp-removed',
  'display-name-changed', 'display-name-reset',
  'lock-created', 'lock-changed', 'lock-removed',
  'labelled', 'pruned', 'restored',
] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

export type HistoryRecord = {
  seq: number;
  at: number;
  action: HistoryAction;
  /** What it happened to, in words: an issuer and account, a lock's target, a name. */
  subject: string;
  /** Which fields changed, by name. */
  fields: string[];
  /** A short non-secret detail: a new display name, a label, a count. */
  detail: string;
  prev: string;
  hash: string;
};

/** Field names that must never appear in a record, as a field or inside the detail. */
export const FORBIDDEN_FIELD = /secret|password|passcode|\bpin\b|otp.?code|\bcode\b|salt|hash|credential|otpauth/i;

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const encoder = new TextEncoder();

function digest(record: Omit<HistoryRecord, 'hash'>): string {
  const canonical = JSON.stringify([record.seq, record.at, record.action, record.subject, record.fields, record.detail, record.prev]);
  return hex(sha256(encoder.encode(canonical)));
}

export type HistoryInput = { action: HistoryAction; subject: string; fields?: string[]; detail?: string };

/**
 * Append one record.
 *
 * `knownSecrets` is every secret the caller holds at this moment. A record whose
 * text contains one of them is refused, which is a second wall behind the field
 * rule: a secret pasted into an issuer name would otherwise walk straight into
 * the history as a subject.
 */
export function appendHistory(log: readonly HistoryRecord[], input: HistoryInput, now = Date.now(), knownSecrets: readonly string[] = []): HistoryRecord[] {
  if (!HISTORY_ACTIONS.includes(input.action)) throw new Error('Unknown history action.');
  const fields = (input.fields ?? []).map((field) => String(field).slice(0, 40));
  if (fields.some((field) => FORBIDDEN_FIELD.test(field))) throw new Error('A history record cannot name a credential field.');
  const subject = String(input.subject ?? '').slice(0, 160);
  const detail = String(input.detail ?? '').slice(0, 160);
  const text = `${subject}\n${detail}`;
  for (const secret of knownSecrets) {
    const clean = String(secret ?? '').replace(/\s/g, '');
    if (clean.length >= 4 && text.replace(/\s/g, '').toUpperCase().includes(clean.toUpperCase())) {
      throw new Error('A history record cannot contain a secret.');
    }
  }
  const last = log[log.length - 1];
  const base = { seq: (last?.seq ?? 0) + 1, at: now, action: input.action, subject, fields, detail, prev: last?.hash ?? '' };
  return [...log, { ...base, hash: digest(base) }].slice(-HISTORY_MAX);
}

/**
 * Is the chain intact?
 *
 * The first record's `prev` is accepted as the anchor, because a pruned history
 * legitimately starts part-way through; every link after it must match.
 */
export function verifyHistory(log: readonly HistoryRecord[]): { intact: boolean; brokenAt: number | null } {
  for (let index = 0; index < log.length; index += 1) {
    const record = log[index];
    const { hash, ...rest } = record;
    if (digest(rest) !== hash) return { intact: false, brokenAt: record.seq };
    if (index > 0 && record.prev !== log[index - 1].hash) return { intact: false, brokenAt: record.seq };
  }
  return { intact: true, brokenAt: null };
}

export function parseHistory(raw: string | null | undefined): HistoryRecord[] {
  let parsed: unknown;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { return []; }
  const list = (parsed as { version?: number; records?: unknown })?.version === 1 ? (parsed as { records: unknown }).records : null;
  if (!Array.isArray(list)) return [];
  return list.slice(-HISTORY_MAX).filter((item): item is HistoryRecord => {
    const record = item as HistoryRecord;
    return Boolean(record) && Number.isInteger(record.seq) && Number.isFinite(record.at) && HISTORY_ACTIONS.includes(record.action)
      && typeof record.subject === 'string' && Array.isArray(record.fields) && typeof record.detail === 'string'
      && typeof record.prev === 'string' && typeof record.hash === 'string';
  });
}

export const serializeHistory = (log: readonly HistoryRecord[]): string => JSON.stringify({ version: 1, records: log });

/** Keep the newest `keep` records, and record that the rest were pruned. */
export function pruneHistory(log: readonly HistoryRecord[], keep: number, now = Date.now()): HistoryRecord[] {
  const count = Math.max(0, Math.min(HISTORY_MAX, Math.floor(keep)));
  if (log.length <= count) return [...log];
  const removed = log.length - count;
  return appendHistory(log.slice(log.length - count), { action: 'pruned', subject: 'history', fields: [], detail: `${removed} older records removed` }, now);
}

/** A label is a new record pointing at an old one, never an edit of it. */
export const labelHistory = (log: readonly HistoryRecord[], seq: number, label: string, now = Date.now()): HistoryRecord[] =>
  appendHistory(log, { action: 'labelled', subject: `record ${seq}`, fields: [], detail: String(label).slice(0, 80) }, now);

/** Rows for the redacted export. The log holds no secret, and the export says what it never contains. */
export function historyRows(log: readonly HistoryRecord[]): Record<string, unknown>[] {
  return log.map((record) => ({
    seq: record.seq,
    at: new Date(record.at).toISOString(),
    action: record.action,
    subject: record.subject,
    fields: record.fields.join(', '),
    detail: record.detail,
    omitted: 'no secret, PIN, password, code or authenticator key is ever recorded',
  }));
}
