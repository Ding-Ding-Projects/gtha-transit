import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = readFileSync(path.join(root, 'server', 'web.mjs'), 'utf8');

/*
 * The policy is a pure function of the path, so it is imported and exercised
 * rather than asserted about by reading the source. Reading the source is how a
 * rule that never matched anything survives -- which is exactly what happened
 * here before: the immutable branch tested for a directory this build does emit,
 * but every font and every photo fell past it to no-cache, and every one of them
 * was sent in full on every single load.
 */
import { cachePolicy as policy, validatorFor } from '../lib/static-cache.ts';

test('the policy lives where it can be run, not inside the listening server', () => {
  /*
   * Importing server/web.mjs starts it listening, so a rule that stayed in there
   * could only ever be checked by grepping -- and a caching rule nobody has run
   * is exactly how the previous one came to match nothing at all.
   */
  assert.equal(typeof policy, 'function');
  assert.match(server, /import \{ cachePolicy, validatorFor \} from '\.\.\/lib\/static-cache\.ts';/);
});

test('a content-addressed name is kept for a year and never asked about again', () => {
  for (const url of [
    '/_next/static/css/index.PtdM0hWj.css',
    '/_next/static/chunks/main.abc123.js',
    '/fonts/ibm-plex-mono/-F63fjptAgt5VM-kVkqdyU8n1i8q1w.woff2',
    '/fonts/space-grotesk/V8mQoQDjQSkFtoMM3T6r8E7mPbF4C_k3HqU.woff2',
  ]) {
    assert.match(policy(url, path.extname(url)), /max-age=31536000,immutable/, url);
  }
});

test('the one font whose name is fixed is never frozen', () => {
  /*
   * Its name is the family, not its contents, and this repository genuinely does
   * change which glyphs are in it. A year of immutable caching would leave
   * somebody looking at the wrong icons until they cleared their browser.
   */
  assert.equal(policy('/fonts/material-symbols-outlined/material-symbols-outlined.woff2', '.woff2'), 'no-cache');
});

test('a photo whose name survives a re-vendor gets a day, not a year', () => {
  // The dish slug stays the same while the bytes can change, so a year would be
  // a claim the filename cannot back.
  assert.equal(policy('/dim-sum/classic-har-gow.webp', '.webp'), 'public,max-age=86400');
  // Its manifest decides which photos exist, so it has to be right immediately.
  assert.equal(policy('/dim-sum/manifest.json', '.json'), 'no-cache');
});

test('the document itself always checks', () => {
  assert.match(policy('/', '.html'), /no-cache/);
  assert.match(policy('/index.html', '.html'), /no-cache/);
});

test('anything unrecognised revalidates rather than being cached by accident', () => {
  assert.equal(policy('/version.json', '.json'), 'no-cache');
  assert.equal(policy('/something-new/file.txt', '.txt'), 'no-cache');
});

test('the validator changes when the file does, and only then', () => {
  const one = validatorFor({ size: 1024, mtimeMs: 1_700_000_000_000 });
  assert.equal(one, validatorFor({ size: 1024, mtimeMs: 1_700_000_000_000.9 }), 'sub-millisecond noise is not a change');
  assert.notEqual(one, validatorFor({ size: 1025, mtimeMs: 1_700_000_000_000 }), 'different size');
  assert.notEqual(one, validatorFor({ size: 1024, mtimeMs: 1_700_000_001_000 }), 'different time');
  assert.match(one, /^W\/"[0-9a-f]+-[0-9a-f]+"$/);
});

test('every static response carries a validator and answers a conditional request', () => {
  /*
   * Without this, no-cache costs the whole file every time: "check before using"
   * with nothing to check against means the check is the download.
   */
  assert.match(server, /^\s*etag: validator,$/m);
  assert.match(server, /^\s*'last-modified': new Date\(info\.mtimeMs\)\.toUTCString\(\),$/m);
  assert.match(server, /if \(req\.headers\['if-none-match'\] === validator\) \{/);
  assert.match(server, /res\.writeHead\(304, headers\);/);
  // A 304 must not claim a body length it is not sending.
  assert.ok(!/writeHead\(304, \{ \.\.\.headers, 'content-length'/.test(server));
});
