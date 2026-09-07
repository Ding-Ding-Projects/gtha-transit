import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { looksLikeFeed } from '../backend/metrolinx-proxy.mjs';

/**
 * Two faults hid behind one message here, and both are worth a guard.
 *
 * The Metrolinx feed paths carry `Gtfs.proto`. The `Gtfs` spelling also answers
 * 200 with the same data as JSON, so asking the wrong path failed as an
 * unreadable payload and was reported as the operator refusing the request -
 * which sent everyone looking at the credential instead of the URL.
 *
 * Separately, a credential file that is present but unreadable was reported as
 * "not configured", which sends the next person looking for a key that is
 * already there.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, '..', 'backend', 'metrolinx-proxy.mjs'), 'utf8');

test('every GO feed path asks for the protobuf endpoint', () => {
  for (const feed of ['TripUpdates', 'Alerts', 'VehiclePosition']) {
    assert.ok(
      source.includes(`https://api.openmetrolinx.com/OpenDataAPI/api/V1/Gtfs.proto/Feed/${feed}`),
      `the GO ${feed} path must use Gtfs.proto`,
    );
  }
  // The bare spelling returns JSON and must not appear at all.
  assert.ok(!/api\/V1\/Gtfs\/Feed\//.test(source), 'no feed path may use the JSON-returning Gtfs spelling');
});

test('every UP feed path asks for the protobuf endpoint', () => {
  for (const feed of ['TripUpdates', 'Alerts', 'VehiclePosition']) {
    assert.ok(
      source.includes(`https://api.openmetrolinx.com/OpenDataAPI/api/V1/UP/Gtfs.proto/Feed/${feed}`),
      `the UP ${feed} path must use Gtfs.proto`,
    );
  }
});

test('a real feed begins with its header tag', () => {
  // Field 1, wire type 2: a length-delimited FeedHeader.
  assert.equal(looksLikeFeed(Buffer.from([0x0a, 0x07, 0x0a, 0x03, 0x32, 0x2e, 0x30])), true);
});

test('a JSON body is not mistaken for a feed', () => {
  assert.equal(looksLikeFeed(Buffer.from('{ "header": { "gtfs_realtime_version": "2.0" } }')), false);
  assert.equal(looksLikeFeed(Buffer.from('[1,2,3]')), false);
});

test('an error page and an empty answer are not feeds either', () => {
  assert.equal(looksLikeFeed(Buffer.from('<html><body>Forbidden</body></html>')), false);
  assert.equal(looksLikeFeed(Buffer.from([])), false);
  assert.equal(looksLikeFeed(Buffer.from([0x0a])), false);
});

test('a non-protobyte payload is refused before anything is cached', () => {
  assert.match(source, /if \(!looksLikeFeed\(body\)\) throw new Error\("upstream returned a non-protobuf payload"\)/);
  // The check must sit before the cache write, or a bad body is served for 15s.
  assert.ok(
    source.indexOf('looksLikeFeed(body)') < source.indexOf('cache.set(pathname'),
    'the payload check must run before the cache write',
  );
});

test('a present but unreadable credential is not reported as absent', () => {
  assert.match(source, /credential = cause && cause\.code === "EACCES" \? "present-but-unreadable"/);
  assert.match(source, /credential === "present-but-unreadable" \? "credential_unreadable"/);
  assert.match(source, /JSON\.stringify\(\{ configured, credential, agencies \}\)/);
});
