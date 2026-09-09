/**
 * SHA-1, in plain TypeScript (FIPS 180-4).
 *
 * Paired with `sha256` in `pbkdf2.ts` for the same reason that one exists:
 * this runs in the authenticator planner, which is served over plain HTTP on
 * some LAN origins where `crypto.subtle` does not exist at all. SHA-1 is not
 * used here for anything that needs collision resistance -- it exists purely
 * because RFC 4226 and RFC 6238 specify it as the default (and most widely
 * interoperable) HOTP/TOTP hash, and most authenticator apps and servers
 * still issue SHA-1 secrets.
 *
 * Checked differentially against `node:crypto` rather than against hex
 * digests typed in from memory, for the reason `pbkdf2.ts` already gives: a
 * transcription error in a hand-copied vector is indistinguishable from a
 * correct implementation failing.
 */

const rotl = (value: number, by: number): number => ((value << by) | (value >>> (32 - by))) >>> 0;

/** SHA-1 of a byte string (20-byte digest). */
export function sha1(input: Uint8Array): Uint8Array {
  /* Padded to a multiple of 64 bytes: one 0x80, then zeros, then the length in
     bits as a 64-bit big-endian integer -- identical framing to sha256. */
  const bitLength = input.length * 8;
  const padded = new Uint8Array((((input.length + 8) >> 6) + 1) * 64);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);

  const state = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
  const schedule = new Uint32Array(80);

  for (let block = 0; block < padded.length; block += 64) {
    for (let index = 0; index < 16; index += 1) schedule[index] = view.getUint32(block + index * 4, false);
    for (let index = 16; index < 80; index += 1) {
      const value = (schedule[index - 3] ^ schedule[index - 8] ^ schedule[index - 14] ^ schedule[index - 16]) >>> 0;
      schedule[index] = rotl(value, 1);
    }

    let [a, b, c, d, e] = state;
    for (let index = 0; index < 80; index += 1) {
      let f: number;
      let k: number;
      if (index < 20) {
        f = ((b & c) | (~b & d)) >>> 0;
        k = 0x5a827999;
      } else if (index < 40) {
        f = (b ^ c ^ d) >>> 0;
        k = 0x6ed9eba1;
      } else if (index < 60) {
        f = ((b & c) | (b & d) | (c & d)) >>> 0;
        k = 0x8f1bbcdc;
      } else {
        f = (b ^ c ^ d) >>> 0;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + schedule[index]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
  }

  const digest = new Uint8Array(20);
  const out = new DataView(digest.buffer);
  for (let index = 0; index < 5; index += 1) out.setUint32(index * 4, state[index], false);
  return digest;
}
