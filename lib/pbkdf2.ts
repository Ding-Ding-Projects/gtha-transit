/**
 * SHA-256, HMAC-SHA256 and PBKDF2, in plain JavaScript.
 *
 * This exists because `crypto.subtle` is only there in a secure context. An
 * origin served over plain HTTP — a LAN address, a bare IP — has no WebCrypto at
 * all, so School mode could not be turned on there and the button silently did
 * nothing. Rather than shipping a lock that works on some origins and not others,
 * the derivation is done here and behaves identically everywhere.
 *
 * `crypto.getRandomValues` is a separate matter and is available without a secure
 * context, so the salt is still real randomness rather than anything invented
 * here. Nothing in this file generates randomness.
 *
 * **What this is for.** A self-imposed speed bump on one browser. It is not a
 * general-purpose crypto library, nothing else should reach for it, and it makes
 * no claim to be constant-time or side-channel resistant — the comparison that
 * matters is done by the caller and the attacker model is "the person who set it,
 * a few minutes later". It is correct, and correctness is checked differentially
 * against the platform's own implementations rather than against vectors typed in
 * by hand, because a transcription error in a test vector is indistinguishable
 * from a correct implementation failing.
 */

/* The first 32 bits of the fractional parts of the cube roots of the first 64
   primes, which is where these come from and why they are not worth reading. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** The first 32 bits of the fractional parts of the square roots of the first 8 primes. */
const INITIAL = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const rotate = (value: number, by: number) => ((value >>> by) | (value << (32 - by))) >>> 0;

/** SHA-256 of a byte string. */
export function sha256(input: Uint8Array): Uint8Array {
  /* Padded to a multiple of 64 bytes: one 0x80, then zeros, then the length in
     bits as a 64-bit big-endian integer. */
  const bitLength = input.length * 8;
  const padded = new Uint8Array((((input.length + 8) >> 6) + 1) * 64);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  /* The high word stays zero. A message long enough to need it would not fit in
     a JavaScript array in the first place. */
  view.setUint32(padded.length - 4, bitLength >>> 0, false);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);

  const state = new Uint32Array(INITIAL);
  const schedule = new Uint32Array(64);

  for (let block = 0; block < padded.length; block += 64) {
    for (let index = 0; index < 16; index += 1) schedule[index] = view.getUint32(block + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const a = schedule[index - 15];
      const b = schedule[index - 2];
      const s0 = (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) >>> 0;
      const s1 = (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10)) >>> 0;
      schedule[index] = (schedule[index - 16] + s0 + schedule[index - 7] + s1) >>> 0;
    }

    let [h0, h1, h2, h3, h4, h5, h6, h7] = state;
    for (let index = 0; index < 64; index += 1) {
      const s1 = (rotate(h4, 6) ^ rotate(h4, 11) ^ rotate(h4, 25)) >>> 0;
      const choose = ((h4 & h5) ^ (~h4 & h6)) >>> 0;
      const temp1 = (h7 + s1 + choose + K[index] + schedule[index]) >>> 0;
      const s0 = (rotate(h0, 2) ^ rotate(h0, 13) ^ rotate(h0, 22)) >>> 0;
      const majority = ((h0 & h1) ^ (h0 & h2) ^ (h1 & h2)) >>> 0;
      const temp2 = (s0 + majority) >>> 0;
      h7 = h6; h6 = h5; h5 = h4;
      h4 = (h3 + temp1) >>> 0;
      h3 = h2; h2 = h1; h1 = h0;
      h0 = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + h0) >>> 0; state[1] = (state[1] + h1) >>> 0;
    state[2] = (state[2] + h2) >>> 0; state[3] = (state[3] + h3) >>> 0;
    state[4] = (state[4] + h4) >>> 0; state[5] = (state[5] + h5) >>> 0;
    state[6] = (state[6] + h6) >>> 0; state[7] = (state[7] + h7) >>> 0;
  }

  const digest = new Uint8Array(32);
  const out = new DataView(digest.buffer);
  for (let index = 0; index < 8; index += 1) out.setUint32(index * 4, state[index], false);
  return digest;
}

const BLOCK = 64;

/** HMAC-SHA256. */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  /* A key longer than the block is hashed first; a shorter one is zero-padded.
     Getting this backwards is the classic way to produce a plausible-looking HMAC
     that agrees with nothing else in the world. */
  const block = new Uint8Array(BLOCK);
  block.set(key.length > BLOCK ? sha256(key) : key);

  const inner = new Uint8Array(BLOCK + message.length);
  const outer = new Uint8Array(BLOCK + 32);
  for (let index = 0; index < BLOCK; index += 1) {
    inner[index] = block[index] ^ 0x36;
    outer[index] = block[index] ^ 0x5c;
  }
  inner.set(message, BLOCK);
  outer.set(sha256(inner), BLOCK);
  return sha256(outer);
}

/**
 * PBKDF2-HMAC-SHA256.
 *
 * Synchronous, so a large iteration count blocks whatever thread calls it. The
 * caller decides what number is honest for what it is protecting; this only does
 * the arithmetic.
 */
export function pbkdf2Sha256(password: Uint8Array, salt: Uint8Array, iterations: number, length: number): Uint8Array {
  if (!Number.isInteger(iterations) || iterations < 1) throw new RangeError('iterations must be a positive integer');
  if (!Number.isInteger(length) || length < 1) throw new RangeError('length must be a positive integer');

  const derived = new Uint8Array(length);
  const blocks = Math.ceil(length / 32);
  const seed = new Uint8Array(salt.length + 4);
  seed.set(salt);
  const counter = new DataView(seed.buffer, salt.length, 4);

  for (let block = 1; block <= blocks; block += 1) {
    counter.setUint32(0, block, false);
    let previous = hmacSha256(password, seed);
    const accumulated = previous.slice();
    for (let round = 1; round < iterations; round += 1) {
      previous = hmacSha256(password, previous);
      for (let index = 0; index < 32; index += 1) accumulated[index] ^= previous[index];
    }
    derived.set(accumulated.subarray(0, Math.min(32, length - (block - 1) * 32)), (block - 1) * 32);
  }
  return derived;
}
