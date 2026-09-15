import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';

import {
  DEFAULT_OTP,
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  counterAt,
  generateSecret,
  groupSecret,
  hotp,
  parseOtpauthUri,
  secondsRemaining,
  totpAt,
  verifyTotp,
} from '../lib/totp.ts';

const ascii = (text) => new TextEncoder().encode(text);

/*
 * RFC 6238 Appendix B. The seeds are the ASCII digits repeated to the key length
 * each algorithm uses; the codes are the published eight-digit values.
 */
const seeds = {
  sha1: ascii('12345678901234567890'),
  sha256: ascii('12345678901234567890123456789012'),
  sha512: ascii('1234567890123456789012345678901234567890123456789012345678901234'),
};

const vectors = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'],
];

for (const [time, sha1Code, sha256Code, sha512Code] of vectors) {
  test(`RFC 6238 vector at T=${time} for SHA-1, SHA-256 and SHA-512`, () => {
    assert.equal(totpAt(seeds.sha1, time, { algorithm: 'sha1', digits: 8, period: 30 }), sha1Code);
    assert.equal(totpAt(seeds.sha256, time, { algorithm: 'sha256', digits: 8, period: 30 }), sha256Code);
    assert.equal(totpAt(seeds.sha512, time, { algorithm: 'sha512', digits: 8, period: 30 }), sha512Code);
  });
}

test('six digits are the low six of the same truncation, for every algorithm', () => {
  for (const [time, ...codes] of vectors) {
    ['sha1', 'sha256', 'sha512'].forEach((algorithm, index) => {
      assert.equal(totpAt(seeds[algorithm], time, { algorithm, digits: 6, period: 30 }), codes[index].slice(2));
    });
  }
});

test('RFC 4226 Appendix D HOTP table', () => {
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  expected.forEach((code, counter) => assert.equal(hotp(seeds.sha1, counter), code));
});

test('HOTP agrees with node:crypto for random keys and large counters', () => {
  for (let round = 0; round < 40; round += 1) {
    const key = generateSecret(1 + (round % 70));
    const counter = round * 0x2000_0000 + round;
    const algorithm = ['sha1', 'sha256', 'sha512'][round % 3];
    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(BigInt(counter));
    const mac = createHmac(algorithm, key).update(message).digest();
    const offset = mac[mac.length - 1] & 15;
    const binary = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
    assert.equal(hotp(key, counter, 8, algorithm), String(binary % 1e8).padStart(8, '0'));
  }
});

test('a code one period either side is accepted, two periods is not', () => {
  const now = 1_700_000_000;
  const period = 30;
  const params = { ...DEFAULT_OTP };
  const at = (seconds) => totpAt(seeds.sha1, seconds, params);
  assert.deepEqual(verifyTotp(seeds.sha1, at(now), now, params), { ok: true, offset: 0 });
  assert.deepEqual(verifyTotp(seeds.sha1, at(now - period), now, params), { ok: true, offset: -1 });
  assert.deepEqual(verifyTotp(seeds.sha1, at(now + period), now, params), { ok: true, offset: 1 });
  assert.equal(verifyTotp(seeds.sha1, at(now - 2 * period), now, params).ok, false);
  assert.equal(verifyTotp(seeds.sha1, at(now + 2 * period), now, params).ok, false);
});

test('a code of the wrong shape is refused without being compared', () => {
  const now = 1_700_000_000;
  const good = totpAt(seeds.sha1, now);
  assert.equal(verifyTotp(seeds.sha1, good.slice(1), now).ok, false);
  assert.equal(verifyTotp(seeds.sha1, good + '0', now).ok, false);
  assert.equal(verifyTotp(seeds.sha1, 'abcdef', now).ok, false);
  assert.equal(verifyTotp(seeds.sha1, '', now).ok, false);
  assert.equal(verifyTotp(seeds.sha1, `${good.slice(0, 3)} ${good.slice(3)}`, now).ok, true, 'a grouped code is still the code');
});

test('base32 round-trips and forgives how secrets are written', () => {
  for (let length = 1; length < 64; length += 7) {
    const bytes = generateSecret(length);
    assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  }
  assert.equal(base32Encode(ascii('12345678901234567890')), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(base32Decode('gezd gnbv-gy3t qojq gezdgnbvgy3tqojq===='), ascii('12345678901234567890'));
  assert.equal(base32Decode('GEZ1'), null, 'a 1 is not in the alphabet, and is refused rather than guessed');
  assert.equal(base32Decode(''), null);
  assert.equal(groupSecret('ABCDEFGHIJ'), 'ABCD EFGH IJ');
});

test('countdown never reads zero and the counter follows the period', () => {
  assert.equal(secondsRemaining(60, 30), 30);
  assert.equal(secondsRemaining(89, 30), 1);
  assert.equal(counterAt(59, 30), 1);
  assert.equal(counterAt(60, 60), 1);
});

test('an otpauth URI carries every parameter and reads back identically', () => {
  const entry = { issuer: 'Example Transit', account: 'rider@example.test', secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', algorithm: 'sha256', digits: 8, period: 60 };
  const uri = buildOtpauthUri(entry);
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /algorithm=SHA256/);
  assert.match(uri, /digits=8/);
  assert.match(uri, /period=60/);
  assert.deepEqual(parseOtpauthUri(uri), entry);
});

test('an otpauth URI missing optional parameters takes the standard defaults', () => {
  const parsed = parseOtpauthUri('otpauth://totp/Issuer:me?secret=GEZDGNBVGY3TQOJQ');
  assert.equal(parsed.issuer, 'Issuer');
  assert.equal(parsed.account, 'me');
  assert.equal(parsed.algorithm, 'sha1');
  assert.equal(parsed.digits, 6);
  assert.equal(parsed.period, 30);
});

test('an unusable URI is refused rather than turned into a different entry', () => {
  assert.equal(parseOtpauthUri('otpauth://hotp/x?secret=GEZDGNBV&counter=1'), null);
  assert.equal(parseOtpauthUri('otpauth://totp/x?secret=not!base32'), null);
  assert.equal(parseOtpauthUri('otpauth://totp/x?secret=GEZDGNBV&digits=11'), null);
  assert.equal(parseOtpauthUri('otpauth://totp/x?secret=GEZDGNBV&algorithm=MD5'), null);
  assert.equal(parseOtpauthUri('https://example.test/?secret=GEZDGNBV'), null);
  assert.equal(parseOtpauthUri('not a uri'), null);
});

test('the authenticator code makes no network call and asks for no secure context', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../lib/totp.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
  assert.doesNotMatch(source, /crypto\.subtle/);
});
