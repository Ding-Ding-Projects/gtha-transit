/**
 * The built-in authenticator's entries.
 *
 * A list of TOTP secrets somebody registers for whatever accounts they like, and
 * the rules for keeping it: bounded, parameters honoured exactly as given, and
 * secrets never in an ordinary export.
 *
 * Where the contract cannot apply literally: it asks for secrets in the
 * operating-system credential vault. A browser page cannot reach one, so these
 * live in this origin's own storage, which anybody with the browser can read.
 * The surface says so beside the list rather than implying otherwise.
 */

import { base32Decode, parseOtpauthUri, validParameters, type OtpAlgorithm } from './totp.ts';

export const AUTHENTICATOR_STORAGE_KEY = 'gtha-authenticator-v1';
export const MAX_ENTRIES = 100;

export type AuthenticatorEntry = {
  id: string;
  issuer: string;
  account: string;
  secret: string;
  algorithm: OtpAlgorithm;
  digits: number;
  period: number;
  group: string;
};

let sequence = 0;
const newId = () => `otp-${Date.now().toString(36)}-${(sequence += 1).toString(36)}`;

export type EntryInput = Omit<AuthenticatorEntry, 'id' | 'group'> & { group?: string };

/** A usable entry, or the reason there is not one. */
export function makeEntry(input: EntryInput): { entry: AuthenticatorEntry } | { problem: 'secret' | 'parameters' | 'account' } {
  const secret = String(input.secret ?? '').replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  const decoded = base32Decode(secret);
  if (!decoded || decoded.length < 10) return { problem: 'secret' };
  const params = { algorithm: input.algorithm, digits: input.digits, period: input.period };
  if (!validParameters(params)) return { problem: 'parameters' };
  const account = String(input.account ?? '').trim().slice(0, 120);
  const issuer = String(input.issuer ?? '').trim().slice(0, 80);
  if (!account && !issuer) return { problem: 'account' };
  return { entry: { id: newId(), issuer, account, secret, ...params, group: String(input.group ?? '').trim().slice(0, 40) } };
}

export function entryFromUri(uri: string): ReturnType<typeof makeEntry> {
  const parsed = parseOtpauthUri(uri);
  if (!parsed) return { problem: 'secret' };
  return makeEntry(parsed);
}

export const entryName = (entry: Pick<AuthenticatorEntry, 'issuer' | 'account'>): string =>
  entry.issuer && entry.account ? `${entry.issuer} (${entry.account})` : entry.issuer || entry.account;

export function addEntry(entries: readonly AuthenticatorEntry[], entry: AuthenticatorEntry): AuthenticatorEntry[] {
  return [...entries, entry].slice(0, MAX_ENTRIES);
}

export function updateEntry(entries: readonly AuthenticatorEntry[], id: string, patch: Partial<Pick<AuthenticatorEntry, 'issuer' | 'account' | 'group'>>): { entries: AuthenticatorEntry[]; fields: string[] } {
  const fields: string[] = [];
  const next = entries.map((entry) => {
    if (entry.id !== id) return entry;
    const updated = { ...entry };
    for (const key of ['issuer', 'account', 'group'] as const) {
      if (patch[key] !== undefined && String(patch[key]).trim() !== entry[key]) {
        updated[key] = String(patch[key]).trim().slice(0, key === 'account' ? 120 : key === 'issuer' ? 80 : 40);
        fields.push(key);
      }
    }
    return updated;
  });
  return { entries: next, fields };
}

export const removeEntries = (entries: readonly AuthenticatorEntry[], ids: readonly string[]): AuthenticatorEntry[] =>
  entries.filter((entry) => !ids.includes(entry.id));

export function moveEntry(entries: readonly AuthenticatorEntry[], id: string, by: -1 | 1): AuthenticatorEntry[] {
  const index = entries.findIndex((entry) => entry.id === id);
  const target = index + by;
  if (index < 0 || target < 0 || target >= entries.length) return [...entries];
  const next = [...entries];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function parseEntries(raw: string | null | undefined): AuthenticatorEntry[] {
  let parsed: unknown;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { return []; }
  const list = (parsed as { version?: number; entries?: unknown })?.version === 1 ? (parsed as { entries: unknown }).entries : null;
  if (!Array.isArray(list)) return [];
  const out: AuthenticatorEntry[] = [];
  for (const item of list.slice(0, MAX_ENTRIES)) {
    const made = makeEntry(item as EntryInput);
    if ('entry' in made && typeof (item as AuthenticatorEntry).id === 'string') out.push({ ...made.entry, id: (item as AuthenticatorEntry).id });
  }
  return out;
}

export const serializeEntries = (entries: readonly AuthenticatorEntry[]): string => JSON.stringify({ version: 1, entries });

/**
 * The ordinary export.
 *
 * Every field except the secret, and a column saying the secret was left out --
 * the export rule forbids silently dropping a field, so the omission is stated
 * on every row rather than implied by its absence.
 */
export const exportEntryRows = (entries: readonly AuthenticatorEntry[]): Record<string, unknown>[] =>
  entries.map((entry) => ({
    issuer: entry.issuer,
    account: entry.account,
    group: entry.group,
    algorithm: entry.algorithm.toUpperCase(),
    digits: entry.digits,
    period: entry.period,
    secret: 'omitted: authenticator secrets are never included in this export',
  }));
