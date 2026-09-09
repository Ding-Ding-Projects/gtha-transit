import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import { sha512 } from '../lib/sha512.ts';

const bytes = (text) => new TextEncoder().encode(text);
const hex = (array) => Buffer.from(array).toString('hex');

/* The FIPS 180-4 message built to land exactly on SHA-512's block boundary:
   112 bytes (896 bits) is the shortest input for which the 1-byte marker
   plus 16-byte length no longer fits in the 128-byte block it started in.
   Built as a sliding window rather than typed out solid, and checked for
   length below, so a dropped or doubled character is caught immediately
   rather than surfacing as a confusing digest mismatch. */
const fipsMessage896 = ['abcdefgh', 'bcdefghi', 'cdefghij', 'defghijk', 'efghijkl', 'fghijklm', 'ghijklmn', 'hijklmno', 'ijklmnop', 'jklmnopq', 'klmnopqr', 'lmnopqrs', 'mnopqrst', 'nopqrstu'].join('');
/* 448 bits: named alongside 896 in the task, and cheap to include even
   though it stays within SHA-512's first block. */
const fipsMessage448 = ['abcd', 'bcde', 'cdef', 'defg', 'efgh', 'fghi', 'ghij', 'hijk', 'ijkl', 'jklm', 'klmn', 'lmno', 'mnop', 'nopq'].join('');

test('the standard 448- and 896-bit messages are the length they claim to be', () => {
  assert.equal(bytes(fipsMessage448).length, 56, '448 bits = 56 bytes');
  assert.equal(bytes(fipsMessage896).length, 112, '896 bits = 112 bytes');
});

/*
 * Checked against the platform's own implementation rather than against
 * digests typed in here, for the reason pbkdf2.test.mjs already gives: a
 * transcription error in a hand-copied vector is indistinguishable from a
 * correct implementation failing. The one exception below is the most
 * quoted digest there is, kept because it also catches a Node that has
 * itself gone wrong.
 */

test('SHA-512 matches the published digest for "abc"', () => {
  assert.equal(
    hex(sha512(bytes('abc'))),
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
  );
});

test('SHA-512 matches the platform for the FIPS 180-4 standard messages', () => {
  const cases = ['', 'abc', fipsMessage448, fipsMessage896];
  for (const value of cases) {
    const input = bytes(value);
    assert.equal(hex(sha512(input)), createHash('sha512').update(input).digest('hex'), `length ${input.length}`);
  }
});

test('SHA-512 matches the platform across every awkward length', () => {
  const cases = [
    'x'.repeat(110),   // one byte short of needing a second block
    'x'.repeat(111),   // exactly the boundary: 111 + 1 + 16 = 128
    'x'.repeat(112),   // one over: spills into a second block
    'x'.repeat(127),
    'x'.repeat(128),   // exactly one block
    'x'.repeat(129),
    'x'.repeat(1000),
    '密碼 with 中文 and emoji 🚌',
  ];
  for (const value of cases) {
    const input = bytes(value);
    assert.equal(hex(sha512(input)), createHash('sha512').update(input).digest('hex'), `length ${input.length}`);
  }
});

test('SHA-512 matches the platform over random lengths from 0 to 5000 bytes', () => {
  for (let trial = 0; trial < 50; trial += 1) {
    const length = Math.floor(Math.random() * 5001);
    const input = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) input[index] = Math.floor(Math.random() * 256);
    assert.equal(hex(sha512(input)), createHash('sha512').update(input).digest('hex'), `random length ${length}`);
  }
});

test('a 1 KiB message hashes in well under 5 ms', () => {
  const input = new Uint8Array(1024);
  for (let index = 0; index < input.length; index += 1) input[index] = index & 0xff;
  // Warm up the JIT before timing, same as any microbenchmark must.
  for (let i = 0; i < 20; i += 1) sha512(input);
  const started = performance.now();
  for (let i = 0; i < 20; i += 1) sha512(input);
  const elapsedEach = (performance.now() - started) / 20;
  assert.ok(elapsedEach < 5, `averaged ${elapsedEach.toFixed(3)} ms per 1 KiB hash, want < 5 ms`);
});
