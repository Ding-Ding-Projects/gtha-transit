import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import { sha1 } from '../lib/sha1.ts';

const bytes = (text) => new TextEncoder().encode(text);
const hex = (array) => Buffer.from(array).toString('hex');

/* The two FIPS 180-4 / RFC 3174 messages built to land exactly on a block
   boundary: 56 bytes (448 bits) is the shortest input for which the 1-byte
   marker plus 8-byte length no longer fits in the block it started in, so
   SHA-1 (64-byte blocks) needs a second block to hold the padding. Built as a
   sliding window rather than typed out solid, and checked for length, so a
   dropped or doubled character is caught immediately rather than surfacing as
   a confusing digest mismatch. */
const fipsMessage448 = ['abcd', 'bcde', 'cdef', 'defg', 'efgh', 'fghi', 'ghij', 'hijk', 'ijkl', 'jklm', 'klmn', 'lmno', 'mnop', 'nopq'].join('');
/* 896 bits: the message FIPS 180-4 uses for the 1024-bit-block hashes
   (SHA-512 here); included for SHA-1 too because the task names both
   lengths, and there is no reason SHA-1 should choke on a longer input. */
const fipsMessage896 = ['abcdefgh', 'bcdefghi', 'cdefghij', 'defghijk', 'efghijkl', 'fghijklm', 'ghijklmn', 'hijklmno', 'ijklmnop', 'jklmnopq', 'klmnopqr', 'lmnopqrs', 'mnopqrst', 'nopqrstu'].join('');

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

test('SHA-1 matches the published digest for "abc"', () => {
  assert.equal(hex(sha1(bytes('abc'))), 'a9993e364706816aba3e25717850c26c9cd0d89d');
});

test('SHA-1 matches the platform for the FIPS 180-4 standard messages', () => {
  const cases = ['', 'abc', fipsMessage448, fipsMessage896];
  for (const value of cases) {
    const input = bytes(value);
    assert.equal(hex(sha1(input)), createHash('sha1').update(input).digest('hex'), `length ${input.length}`);
  }
});

test('SHA-1 matches the platform across every awkward length', () => {
  const cases = [
    'x'.repeat(55),   // one byte short of needing a second block
    'x'.repeat(56),   // exactly the boundary where padding spills over
    'x'.repeat(57),
    'x'.repeat(63),
    'x'.repeat(64),   // exactly one block
    'x'.repeat(65),
    'x'.repeat(1000),
    '密碼 with 中文 and emoji 🚌',
  ];
  for (const value of cases) {
    const input = bytes(value);
    assert.equal(hex(sha1(input)), createHash('sha1').update(input).digest('hex'), `length ${input.length}`);
  }
});

test('SHA-1 matches the platform over random lengths from 0 to 5000 bytes', () => {
  for (let trial = 0; trial < 50; trial += 1) {
    const length = Math.floor(Math.random() * 5001);
    const input = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) input[index] = Math.floor(Math.random() * 256);
    assert.equal(hex(sha1(input)), createHash('sha1').update(input).digest('hex'), `random length ${length}`);
  }
});
