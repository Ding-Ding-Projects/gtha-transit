import assert from 'node:assert/strict';
import test from 'node:test';
import { clearMetrolinxAlertCache, getMetrolinxAlerts, METROLINX_AGENCIES } from '../status/go.mjs';

/**
 * The Metrolinx alert feed sits behind an API key held by the routing service, so
 * a browser can never reach it directly. Without that service configured there is
 * no feed at all, and that is reported as unavailable rather than as an absence
 * of disruption - the two look identical on screen and mean opposite things.
 */

const cat = (...parts) => Uint8Array.from(parts.flatMap((part) => [...part]));
const varint = (input) => { let value = BigInt(input); const out = []; do { let byte = Number(value & 0x7fn); value >>= 7n; if (value) byte |= 0x80; out.push(byte); } while (value); return Uint8Array.from(out); };
const scalar = (field, value) => cat(varint(field << 3), varint(value));
const bytes = (field, value) => cat(varint((field << 3) | 2), varint(value.length), value);
const string = (field, value) => bytes(field, new TextEncoder().encode(value));
const translated = (field, value) => bytes(field, bytes(1, cat(string(1, value), string(2, 'en'))));

const NOW_SECONDS = 1788710400; // 2026-09-06T16:00:00Z
const NOW = NOW_SECONDS * 1000;

const alertFeed = (title, description) => cat(
  bytes(1, cat(string(1, '2.0'), scalar(3, NOW_SECONDS))),
  bytes(2, cat(string(1, 'go-alert-1'), bytes(5, cat(
    bytes(5, cat(string(2, 'GO-BR'))),
    translated(10, title),
    translated(11, description),
  )))),
);

const CANCELLED = alertFeed(
  'Train cancelled - Aurora GO 16:55 - Union Station 17:46',
  'Please consider the following train options:\nBy GO train: Aurora GO 15:55 - Union Station 16:46',
);

const call = (fetchImpl, overrides = {}) => {
  clearMetrolinxAlertCache();
  return getMetrolinxAlerts({ agency: 'go', routingOrigin: 'http://routing.test', now: NOW, fetchImpl, ...overrides });
};

test('an agency alert feed is decoded into its published alerts', async () => {
  const status = await call(async () => new Response(CANCELLED));
  assert.equal(status.state, 'live');
  assert.equal(status.agencyName, METROLINX_AGENCIES.go.name);
  assert.equal(status.alerts.length, 1);
  assert.equal(status.alerts[0].title, 'Train cancelled - Aurora GO 16:55 - Union Station 17:46');
  assert.match(status.alerts[0].description, /Aurora GO 15:55/);
});

test('the request goes through the routing service, never straight to the operator', async () => {
  let requested = '';
  await call(async (url) => { requested = String(url); return new Response(CANCELLED); });
  assert.equal(requested, 'http://routing.test/api/alerts/metrolinx?agency=go');
});

test('no routing service means no feed, and that is said rather than shown as calm', async () => {
  const status = await getMetrolinxAlerts({ agency: 'go', routingOrigin: '', now: NOW, fetchImpl: async () => { throw new Error('must not be called'); } });
  assert.equal(status.state, 'unavailable');
  assert.equal(status.alerts.length, 0);
  assert.match(status.reason, /routing service/);
});

test('a refused or unreadable feed is unavailable, not empty', async () => {
  const refused = await call(async () => new Response('nope', { status: 502 }));
  assert.equal(refused.state, 'unavailable');
  assert.match(refused.reason, /refused/);
  const broken = await call(async () => new Response(Uint8Array.from([1, 2, 3])));
  assert.equal(broken.state, 'unavailable');
  assert.match(broken.reason, /could not be read/);
});

test('an unknown agency is refused rather than guessed at', async () => {
  const status = await getMetrolinxAlerts({ agency: 'ttc', routingOrigin: 'http://routing.test', now: NOW, fetchImpl: async () => new Response(CANCELLED) });
  assert.equal(status.state, 'unavailable');
  assert.match(status.reason, /Unknown agency/);
});

test('a second read inside the cache window does not hit the feed again', async () => {
  let calls = 0;
  clearMetrolinxAlertCache();
  const options = { agency: 'go', routingOrigin: 'http://routing.test', now: NOW, fetchImpl: async () => { calls += 1; return new Response(CANCELLED); } };
  await getMetrolinxAlerts(options);
  await getMetrolinxAlerts(options);
  assert.equal(calls, 1);
  await getMetrolinxAlerts({ ...options, now: NOW + 60_000 });
  assert.equal(calls, 2);
});
