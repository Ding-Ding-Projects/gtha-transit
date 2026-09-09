import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';

import { hmac, hmacOutputSize } from '../lib/hmac.ts';

const bytes = (text) => new TextEncoder().encode(text);
const hex = (array) => Buffer.from(array).toString('hex');

/*
 * RFC 2202 (HMAC-SHA1) and RFC 4231 (HMAC-SHA256/SHA512) test case 1 and 2
 * keys and data -- the two most quoted HMAC vectors there are, used the same
 * way pbkdf2.test.mjs and sha1/sha512.test.mjs use their one published
 * anchor: checked against the platform, which is the same check the fuzz
 * test below does, plus a hardcoded literal for the reason those files give
 * (a transcription error in a hand-copied digest is indistinguishable from
 * an implementation bug).
 */
const rfcCase1 = { key: new Uint8Array(20).fill(0x0b), message: bytes('Hi There') };
const rfcCase2 = { key: bytes('Jefe'), message: bytes('what do ya want for nothing?') };

test('HMAC-SHA1 matches the published digest for RFC 2202 test case 1', () => {
  assert.equal(hex(hmac('sha1', rfcCase1.key, rfcCase1.message)), 'b617318655057264e28bc0b6fb378c8ef146be00');
});

test('HMAC-SHA256 matches the published digest for RFC 4231 test case 1', () => {
  assert.equal(
    hex(hmac('sha256', rfcCase1.key, rfcCase1.message)),
    'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
  );
});

test('HMAC-SHA512 matches the published digest for RFC 4231 test case 1', () => {
  assert.equal(
    hex(hmac('sha512', rfcCase1.key, rfcCase1.message)),
    '87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854',
  );
});

test('all three algorithms match the platform for the RFC test-case keys and messages', () => {
  for (const algorithm of ['sha1', 'sha256', 'sha512']) {
    for (const { key, message } of [rfcCase1, rfcCase2]) {
      assert.equal(
        hex(hmac(algorithm, key, message)),
        createHmac(algorithm, key).update(message).digest('hex'),
        `${algorithm}, ${key.length}-byte key, ${message.length}-byte message`,
      );
    }
  }
});

test('every algorithm matches the platform, including keys longer than its block', () => {
  for (const algorithm of ['sha1', 'sha256', 'sha512']) {
    const blockSize = algorithm === 'sha512' ? 128 : 64;
    const cases = [
      ['', ''],
      ['key', 'message'],
      ['k'.repeat(blockSize - 1), 'm'],
      ['k'.repeat(blockSize), 'm'],       // exactly the block: not hashed first
      ['k'.repeat(blockSize + 1), 'm'],   // one over: hashed first, easy to get backwards
      ['k'.repeat(200), 'm'.repeat(500)],
      ['密碼', '中文 message with emoji 🔐'],
    ];
    for (const [key, message] of cases) {
      const keyBytes = bytes(key);
      const messageBytes = bytes(message);
      assert.equal(
        hex(hmac(algorithm, keyBytes, messageBytes)),
        createHmac(algorithm, keyBytes).update(messageBytes).digest('hex'),
        `${algorithm}, key ${keyBytes.length}, message ${messageBytes.length}`,
      );
    }
  }
});

test('hmacOutputSize matches the actual digest length for every algorithm', () => {
  for (const algorithm of ['sha1', 'sha256', 'sha512']) {
    assert.equal(hmac(algorithm, bytes('k'), bytes('m')).length, hmacOutputSize(algorithm));
  }
});

test('a wrong key produces a different MAC for every algorithm', () => {
  for (const algorithm of ['sha1', 'sha256', 'sha512']) {
    const a = hex(hmac(algorithm, bytes('right-key'), bytes('message')));
    const b = hex(hmac(algorithm, bytes('wrong-key'), bytes('message')));
    assert.notEqual(a, b);
  }
});
