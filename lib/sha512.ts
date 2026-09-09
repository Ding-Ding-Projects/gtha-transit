/**
 * SHA-512, in plain TypeScript (FIPS 180-4).
 *
 * Paired with `sha256` (in `pbkdf2.ts`) and `sha1` for the same reason both
 * exist: this runs in the authenticator planner, served over plain HTTP on
 * some LAN origins where `crypto.subtle` is not available at all. RFC 6238
 * (TOTP) permits SHA-512 as an alternative to the default SHA-1, and some
 * services issue SHA-512 secrets, so this exists to interoperate with them.
 *
 * Each 64-bit lane is a pair of uint32 (`hi`, `lo`) rather than a BigInt.
 * BigInt reads more directly like the specification, but every add, rotate
 * and shift in the compression function would then box a 64-bit integer
 * instead of touching two plain doubles, and this can run once per keystroke
 * in a code-entry field. The small `Word64` helpers below keep the
 * arithmetic close to the FIPS pseudocode while staying on plain numbers
 * throughout; see sha512.test.mjs for the timing check.
 *
 * The round constants and initial hash values are not typed in from memory:
 * eighty 64-bit round constants is a great deal of hex to transcribe by
 * hand, and one wrong nibble would stay silent until it broke a message that
 * happened to reach that round. They were derived here with exact BigInt
 * integer arithmetic (integer square/cube roots, computed once with a
 * throwaway script -- never floating point, which does not carry 64 bits of
 * precision) and cross-checked against the SHA-256 constants already trusted
 * in `pbkdf2.ts`: truncating either SHA-512's initial hash values or the
 * first 64 of its 80 round constants to 32 bits must reproduce SHA-256's own
 * constants exactly, because both are prefixes of the same fractional
 * expansion of the same roots of the same primes. All 72 shared values
 * matched before this file was written; the differential test below is what
 * ultimately proves the arithmetic that consumes them is also correct.
 */

type Word64 = { hi: number; lo: number };

const w64 = (hi: number, lo: number): Word64 => ({ hi: hi >>> 0, lo: lo >>> 0 });

function rotr64(value: Word64, by: number): Word64 {
  const { hi, lo } = value;
  if (by === 32) return { hi: lo, lo: hi };
  if (by < 32) {
    return {
      hi: ((hi >>> by) | (lo << (32 - by))) >>> 0,
      lo: ((lo >>> by) | (hi << (32 - by))) >>> 0,
    };
  }
  const shift = by - 32;
  return {
    hi: ((lo >>> shift) | (hi << (32 - shift))) >>> 0,
    lo: ((hi >>> shift) | (lo << (32 - shift))) >>> 0,
  };
}

/** Logical shift right, no wraparound. Only ever called here with by < 32. */
function shr64(value: Word64, by: number): Word64 {
  return {
    hi: value.hi >>> by,
    lo: ((value.lo >>> by) | (value.hi << (32 - by))) >>> 0,
  };
}

const xor64 = (a: Word64, b: Word64): Word64 => ({ hi: (a.hi ^ b.hi) >>> 0, lo: (a.lo ^ b.lo) >>> 0 });
const and64 = (a: Word64, b: Word64): Word64 => ({ hi: (a.hi & b.hi) >>> 0, lo: (a.lo & b.lo) >>> 0 });
const not64 = (a: Word64): Word64 => ({ hi: ~a.hi >>> 0, lo: ~a.lo >>> 0 });

/** Sums any number of 64-bit lanes mod 2^64, carrying from the low word to the high one. */
function add64(...words: Word64[]): Word64 {
  let loSum = 0;
  let hiSum = 0;
  for (const word of words) {
    loSum += word.lo;
    hiSum += word.hi;
  }
  const carry = Math.floor(loSum / 0x100000000);
  return { hi: (hiSum + carry) >>> 0, lo: loSum >>> 0 };
}

/* First 64 bits of the fractional parts of the cube roots of the first 80
   primes. Derived, not typed in -- see the file comment. */
const K: readonly Word64[] = [
  w64(0x428a2f98, 0xd728ae22), w64(0x71374491, 0x23ef65cd), w64(0xb5c0fbcf, 0xec4d3b2f), w64(0xe9b5dba5, 0x8189dbbc),
  w64(0x3956c25b, 0xf348b538), w64(0x59f111f1, 0xb605d019), w64(0x923f82a4, 0xaf194f9b), w64(0xab1c5ed5, 0xda6d8118),
  w64(0xd807aa98, 0xa3030242), w64(0x12835b01, 0x45706fbe), w64(0x243185be, 0x4ee4b28c), w64(0x550c7dc3, 0xd5ffb4e2),
  w64(0x72be5d74, 0xf27b896f), w64(0x80deb1fe, 0x3b1696b1), w64(0x9bdc06a7, 0x25c71235), w64(0xc19bf174, 0xcf692694),
  w64(0xe49b69c1, 0x9ef14ad2), w64(0xefbe4786, 0x384f25e3), w64(0x0fc19dc6, 0x8b8cd5b5), w64(0x240ca1cc, 0x77ac9c65),
  w64(0x2de92c6f, 0x592b0275), w64(0x4a7484aa, 0x6ea6e483), w64(0x5cb0a9dc, 0xbd41fbd4), w64(0x76f988da, 0x831153b5),
  w64(0x983e5152, 0xee66dfab), w64(0xa831c66d, 0x2db43210), w64(0xb00327c8, 0x98fb213f), w64(0xbf597fc7, 0xbeef0ee4),
  w64(0xc6e00bf3, 0x3da88fc2), w64(0xd5a79147, 0x930aa725), w64(0x06ca6351, 0xe003826f), w64(0x14292967, 0x0a0e6e70),
  w64(0x27b70a85, 0x46d22ffc), w64(0x2e1b2138, 0x5c26c926), w64(0x4d2c6dfc, 0x5ac42aed), w64(0x53380d13, 0x9d95b3df),
  w64(0x650a7354, 0x8baf63de), w64(0x766a0abb, 0x3c77b2a8), w64(0x81c2c92e, 0x47edaee6), w64(0x92722c85, 0x1482353b),
  w64(0xa2bfe8a1, 0x4cf10364), w64(0xa81a664b, 0xbc423001), w64(0xc24b8b70, 0xd0f89791), w64(0xc76c51a3, 0x0654be30),
  w64(0xd192e819, 0xd6ef5218), w64(0xd6990624, 0x5565a910), w64(0xf40e3585, 0x5771202a), w64(0x106aa070, 0x32bbd1b8),
  w64(0x19a4c116, 0xb8d2d0c8), w64(0x1e376c08, 0x5141ab53), w64(0x2748774c, 0xdf8eeb99), w64(0x34b0bcb5, 0xe19b48a8),
  w64(0x391c0cb3, 0xc5c95a63), w64(0x4ed8aa4a, 0xe3418acb), w64(0x5b9cca4f, 0x7763e373), w64(0x682e6ff3, 0xd6b2b8a3),
  w64(0x748f82ee, 0x5defb2fc), w64(0x78a5636f, 0x43172f60), w64(0x84c87814, 0xa1f0ab72), w64(0x8cc70208, 0x1a6439ec),
  w64(0x90befffa, 0x23631e28), w64(0xa4506ceb, 0xde82bde9), w64(0xbef9a3f7, 0xb2c67915), w64(0xc67178f2, 0xe372532b),
  w64(0xca273ece, 0xea26619c), w64(0xd186b8c7, 0x21c0c207), w64(0xeada7dd6, 0xcde0eb1e), w64(0xf57d4f7f, 0xee6ed178),
  w64(0x06f067aa, 0x72176fba), w64(0x0a637dc5, 0xa2c898a6), w64(0x113f9804, 0xbef90dae), w64(0x1b710b35, 0x131c471b),
  w64(0x28db77f5, 0x23047d84), w64(0x32caab7b, 0x40c72493), w64(0x3c9ebe0a, 0x15c9bebc), w64(0x431d67c4, 0x9c100d4c),
  w64(0x4cc5d4be, 0xcb3e42b6), w64(0x597f299c, 0xfc657e2a), w64(0x5fcb6fab, 0x3ad6faec), w64(0x6c44198c, 0x4a475817),
];

/* First 64 bits of the fractional parts of the square roots of the first 8
   primes. The high halves are, byte for byte, sha256's own INITIAL constants
   in pbkdf2.ts -- see the file comment. */
const INITIAL: readonly Word64[] = [
  w64(0x6a09e667, 0xf3bcc908),
  w64(0xbb67ae85, 0x84caa73b),
  w64(0x3c6ef372, 0xfe94f82b),
  w64(0xa54ff53a, 0x5f1d36f1),
  w64(0x510e527f, 0xade682d1),
  w64(0x9b05688c, 0x2b3e6c1f),
  w64(0x1f83d9ab, 0xfb41bd6b),
  w64(0x5be0cd19, 0x137e2179),
];

/** SHA-512 of a byte string (64-byte digest). */
export function sha512(input: Uint8Array): Uint8Array {
  /* Padded to a multiple of 128 bytes: one 0x80, then zeros, then the length
     in bits as a 128-bit big-endian integer. The top 64 bits of that length
     field stay zero -- nothing that fits in a typed array gets anywhere near
     needing them -- so only the low 64 bits are written, split the same way
     sha256's 64-bit length field is. */
  const bitLength = input.length * 8;
  const padded = new Uint8Array((((input.length + 16) >> 7) + 1) * 128);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000) >>> 0, false);

  const state: Word64[] = INITIAL.map((word) => ({ ...word }));
  const schedule: Word64[] = new Array(80);

  for (let block = 0; block < padded.length; block += 128) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = {
        hi: view.getUint32(block + index * 8, false),
        lo: view.getUint32(block + index * 8 + 4, false),
      };
    }
    for (let index = 16; index < 80; index += 1) {
      const a = schedule[index - 15];
      const b = schedule[index - 2];
      const s0 = xor64(xor64(rotr64(a, 1), rotr64(a, 8)), shr64(a, 7));
      const s1 = xor64(xor64(rotr64(b, 19), rotr64(b, 61)), shr64(b, 6));
      schedule[index] = add64(schedule[index - 16], s0, schedule[index - 7], s1);
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 80; index += 1) {
      const bigSigma1 = xor64(xor64(rotr64(e, 14), rotr64(e, 18)), rotr64(e, 41));
      const choose = xor64(and64(e, f), and64(not64(e), g));
      const temp1 = add64(h, bigSigma1, choose, K[index], schedule[index]);
      const bigSigma0 = xor64(xor64(rotr64(a, 28), rotr64(a, 34)), rotr64(a, 39));
      const majority = xor64(xor64(and64(a, b), and64(a, c)), and64(b, c));
      const temp2 = add64(bigSigma0, majority);
      h = g;
      g = f;
      f = e;
      e = add64(d, temp1);
      d = c;
      c = b;
      b = a;
      a = add64(temp1, temp2);
    }

    state[0] = add64(state[0], a);
    state[1] = add64(state[1], b);
    state[2] = add64(state[2], c);
    state[3] = add64(state[3], d);
    state[4] = add64(state[4], e);
    state[5] = add64(state[5], f);
    state[6] = add64(state[6], g);
    state[7] = add64(state[7], h);
  }

  const digest = new Uint8Array(64);
  const out = new DataView(digest.buffer);
  for (let index = 0; index < 8; index += 1) {
    out.setUint32(index * 8, state[index].hi, false);
    out.setUint32(index * 8 + 4, state[index].lo, false);
  }
  return digest;
}
