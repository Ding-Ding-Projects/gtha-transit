/**
 * HOTP (RFC 4226) and TOTP (RFC 6238), over the plain-JavaScript HMAC in
 * `hmac.ts`.
 *
 * Plain JavaScript for the same reason the rest of the credential code is:
 * `crypto.subtle` only exists in a secure context, and a code generator that
 * works on the https deployment and silently produces nothing on a LAN address
 * is worse than one that works everywhere. The only platform call is
 * `crypto.getRandomValues`, for a new secret, which needs no secure context.
 *
 * Checked against the RFC 6238 published vectors for all three algorithms and
 * the RFC 4226 HOTP table, and differentially against `node:crypto`. An
 * authenticator that is subtly wrong produces codes every server refuses with
 * no error to read, so the vectors are the whole point of the test file.
 */

import { hmac, type HashAlgorithm } from './hmac.ts';

export type OtpAlgorithm = HashAlgorithm;

export const OTP_ALGORITHMS: readonly OtpAlgorithm[] = ['sha1', 'sha256', 'sha512'];

export type OtpParameters = {
  algorithm: OtpAlgorithm;
  digits: number;
  period: number;
};

/** What the rest of the world issues, which is why it is the default. */
export const DEFAULT_OTP: Readonly<OtpParameters> = Object.freeze({ algorithm: 'sha1', digits: 6, period: 30 });

/** How many whole periods either side of now a code is still accepted in. */
export const SKEW_STEPS = 1;

/** A new secret's size in bytes. 20 matches the SHA-1 output and what most issuers use. */
export const SECRET_BYTES = 20;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, upper case, without padding. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/**
 * Decode base32, forgiving the ways people actually write it.
 *
 * Spaces, hyphens, lower case and trailing padding are all how a secret arrives
 * when somebody copies it off a setup page. Anything outside the alphabet is a
 * refusal rather than a guess: a secret decoded wrongly generates plausible
 * codes that never match.
 */
export function base32Decode(text: string): Uint8Array | null {
  if (typeof text !== 'string') return null;
  const clean = text.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (clean.length === 0) return null;
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of clean) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) return null;
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(output);
}

/** A secret in groups of four, which is how it is read aloud and typed across. */
export const groupSecret = (base32: string): string => base32.replace(/(.{4})/g, '$1 ').trim();

export function validParameters(params: Partial<OtpParameters> | null | undefined): params is OtpParameters {
  return Boolean(params)
    && OTP_ALGORITHMS.includes(params!.algorithm as OtpAlgorithm)
    && Number.isInteger(params!.digits) && params!.digits! >= 6 && params!.digits! <= 8
    && Number.isInteger(params!.period) && params!.period! >= 1 && params!.period! <= 300;
}

/**
 * One HOTP value.
 *
 * The counter is written as an 8-byte big-endian integer, high word first. A
 * counter above 2^32 is not hypothetical for a short period, and dropping the
 * high word is the kind of mistake that only shows up decades from now.
 */
export function hotp(secret: Uint8Array, counter: number, digits = 6, algorithm: OtpAlgorithm = 'sha1'): string {
  if (!Number.isSafeInteger(counter) || counter < 0) throw new RangeError('counter must be a non-negative safe integer');
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) throw new RangeError('digits must be 6 to 8');
  const message = new Uint8Array(8);
  const view = new DataView(message.buffer);
  view.setUint32(0, Math.floor(counter / 0x100000000), false);
  view.setUint32(4, counter >>> 0, false);
  const mac = hmac(algorithm, secret, message);
  /* Dynamic truncation: the low nibble of the last byte picks the offset. */
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The TOTP counter for a moment in Unix seconds. */
export const counterAt = (unixSeconds: number, period = DEFAULT_OTP.period): number => Math.floor(unixSeconds / period);

/** Seconds until the current code changes. Always at least 1, never 0. */
export const secondsRemaining = (unixSeconds: number, period = DEFAULT_OTP.period): number =>
  period - (Math.floor(unixSeconds) % period);

export function totpAt(secret: Uint8Array, unixSeconds: number, params: OtpParameters = DEFAULT_OTP): string {
  return hotp(secret, counterAt(unixSeconds, params.period), params.digits, params.algorithm);
}

/**
 * Is this code current?
 *
 * Accepted up to `SKEW_STEPS` periods either side of now, and nowhere else. The
 * offset is returned so a surface can say the device clock looks off rather
 * than leaving somebody retyping a code that will never match.
 */
export function verifyTotp(
  secret: Uint8Array,
  code: string,
  unixSeconds: number,
  params: OtpParameters = DEFAULT_OTP,
  window = SKEW_STEPS,
): { ok: boolean; offset: number | null } {
  const clean = typeof code === 'string' ? code.replace(/\s/g, '') : '';
  if (clean.length !== params.digits || !/^\d+$/.test(clean)) return { ok: false, offset: null };
  const now = counterAt(unixSeconds, params.period);
  let matched: number | null = null;
  for (let step = -window; step <= window; step += 1) {
    const counter = now + step;
    if (counter < 0) continue;
    const expected = hotp(secret, counter, params.digits, params.algorithm);
    let difference = 0;
    for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ clean.charCodeAt(index);
    /* No early return: every step in the window is computed either way. */
    if (difference === 0 && matched === null) matched = step;
  }
  return { ok: matched !== null, offset: matched };
}

/**
 * A new random secret.
 *
 * Throws, rather than inventing one, when the platform has no random source.
 * A secret made from `Math.random` would look exactly like a real one.
 */
export function generateSecret(bytes = SECRET_BYTES): Uint8Array {
  const source = globalThis.crypto;
  if (!source || typeof source.getRandomValues !== 'function') throw new Error('No secure random source is available in this browser.');
  return source.getRandomValues(new Uint8Array(bytes));
}

export type OtpAuth = OtpParameters & { issuer: string; account: string; secret: string };

/** A standard `otpauth://totp/` URI, carrying every parameter rather than relying on defaults. */
export function buildOtpauthUri(entry: OtpAuth): string {
  const issuer = entry.issuer.trim();
  const account = entry.account.trim();
  const label = encodeURIComponent(issuer ? `${issuer}:${account}` : account);
  const query = new URLSearchParams({
    secret: entry.secret,
    ...(issuer ? { issuer } : {}),
    algorithm: entry.algorithm.toUpperCase(),
    digits: String(entry.digits),
    period: String(entry.period),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

/**
 * Read an `otpauth://totp/` URI.
 *
 * Parameters it carries are honoured, missing ones take the standard defaults,
 * and anything unusable -- HOTP, a bad secret, eleven digits -- is a refusal
 * rather than a quietly different entry.
 */
export function parseOtpauthUri(uri: string): OtpAuth | null {
  if (typeof uri !== 'string' || uri.length > 2048) return null;
  let url: URL;
  try { url = new URL(uri.trim()); } catch { return null; }
  if (url.protocol !== 'otpauth:' || url.hostname.toLowerCase() !== 'totp') return null;
  let label: string;
  try { label = decodeURIComponent(url.pathname.replace(/^\//, '')); } catch { return null; }
  const secret = (url.searchParams.get('secret') || '').replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (!base32Decode(secret)) return null;
  const colon = label.indexOf(':');
  const labelIssuer = colon >= 0 ? label.slice(0, colon).trim() : '';
  const account = (colon >= 0 ? label.slice(colon + 1) : label).trim();
  const algorithmText = (url.searchParams.get('algorithm') || 'SHA1').toLowerCase();
  const params = {
    algorithm: algorithmText as OtpAlgorithm,
    digits: url.searchParams.has('digits') ? Number(url.searchParams.get('digits')) : DEFAULT_OTP.digits,
    period: url.searchParams.has('period') ? Number(url.searchParams.get('period')) : DEFAULT_OTP.period,
  };
  if (!validParameters(params)) return null;
  return {
    ...params,
    issuer: (url.searchParams.get('issuer') || labelIssuer).slice(0, 80),
    account: account.slice(0, 120),
    secret,
  };
}
