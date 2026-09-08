import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, createHmac, pbkdf2Sync, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { hmacSha256, pbkdf2Sha256, sha256 } from '../lib/pbkdf2.ts';

const bytes = (text) => new TextEncoder().encode(text);
const hex = (array) => Buffer.from(array).toString('hex');

/*
 * Checked against the platform's own implementations rather than against vectors
 * typed in here. A transcription error in a hand-copied vector is
 * indistinguishable from a correct implementation failing, and the failure mode
 * of getting that wrong is a lock that agrees with nothing else in the world.
 *
 * The one published vector below is the exception, kept because it is the most
 * quoted digest there is and it catches a Node that has itself gone wrong.
 */

test('SHA-256 matches the published digest for "abc"', () => {
  assert.equal(hex(sha256(bytes('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('SHA-256 matches the platform across every awkward length', () => {
  const cases = [
    '',
    'a',
    'exam-time',
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
    assert.equal(hex(sha256(input)), createHash('sha256').update(input).digest('hex'), `length ${input.length}`);
  }
});

test('HMAC-SHA256 matches the platform, including keys longer than the block', () => {
  const cases = [
    ['', ''],
    ['key', 'message'],
    ['exam-time', 'salt'],
    ['k'.repeat(63), 'm'],
    ['k'.repeat(64), 'm'],   // exactly the block: not hashed
    ['k'.repeat(65), 'm'],   // one over: hashed first, which is easy to get backwards
    ['k'.repeat(200), 'm'.repeat(500)],
  ];
  for (const [key, message] of cases) {
    assert.equal(
      hex(hmacSha256(bytes(key), bytes(message))),
      createHmac('sha256', bytes(key)).update(bytes(message)).digest('hex'),
      `key ${key.length}, message ${message.length}`,
    );
  }
});

test('PBKDF2-HMAC-SHA256 matches the platform', () => {
  const cases = [
    ['password', 'salt', 1, 32],
    ['password', 'salt', 2, 32],
    ['password', 'salt', 4096, 32],
    ['exam-time', 'a-random-salt', 1000, 32],
    ['exam-time', 'a-random-salt', 1000, 20],   // shorter than one block
    ['exam-time', 'a-random-salt', 1000, 64],   // exactly two blocks
    ['exam-time', 'a-random-salt', 1000, 70],   // a partial third block
    ['', '', 1, 32],
  ];
  for (const [password, salt, iterations, length] of cases) {
    assert.equal(
      hex(pbkdf2Sha256(bytes(password), bytes(salt), iterations, length)),
      pbkdf2Sync(bytes(password), bytes(salt), iterations, length, 'sha256').toString('hex'),
      `${iterations} iterations, ${length} bytes`,
    );
  }
});

test('and it matches WebCrypto too, which is what it replaces', async () => {
  const key = await webcrypto.subtle.importKey('raw', bytes('exam-time'), 'PBKDF2', false, ['deriveBits']);
  const salt = bytes('a-random-salt');
  const derived = await webcrypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 5000, hash: 'SHA-256' },
    key,
    256,
  );
  assert.equal(hex(pbkdf2Sha256(bytes('exam-time'), salt, 5000, 32)), hex(new Uint8Array(derived)));
});

test('it refuses arithmetic it cannot do rather than returning something wrong', () => {
  const password = bytes('x');
  const salt = bytes('y');
  for (const iterations of [0, -1, 1.5, NaN]) {
    assert.throws(() => pbkdf2Sha256(password, salt, iterations, 32), RangeError, `iterations ${iterations}`);
  }
  for (const length of [0, -1, 2.5]) {
    assert.throws(() => pbkdf2Sha256(password, salt, 1000, length), RangeError, `length ${length}`);
  }
});

test('nothing in here invents randomness', () => {
  /*
   * Comments stripped first, or this matches the sentence explaining the rule --
   * exactly the way the copy guards in this repository once matched their own
   * prose. The claim is about the code, not about how the code describes itself.
   */
  const code = readFileSync(new URL('../lib/pbkdf2.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/Math\.random|getRandomValues/.test(code),
    'the salt is the caller\'s job, and a hand-rolled one here would be the worst possible place for it');
});
