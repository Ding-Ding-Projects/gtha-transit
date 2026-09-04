import test from 'node:test';
import assert from 'node:assert/strict';
import { clearTtcStatusCache, getTtcStatus, parseTtcAlerts, parseTtcWebAlerts, TTC_ALERTS_URL, TTC_WEB_ALERTS_URL } from './ttc.mjs';

const v = (n) => { const a = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; a.push(b); } while (n); return Uint8Array.from(a); };
const scalar = (field, value) => Uint8Array.from([...(v(field << 3)), ...v(value)]);
const msg = (field, bytes) => Uint8Array.from([...(v((field << 3) | 2)), ...v(bytes.length), ...bytes]);
const str = (field, value) => msg(field, new TextEncoder().encode(value));
const cat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));
const translation = (value) => msg(1, str(1, value));
const alert = ({ routeId, title, description, url }) => cat(msg(5, str(2, routeId)), msg(10, translation(title)), msg(11, translation(description)), msg(8, translation(url)));
const entity = (id, a) => cat(str(1, id), msg(5, alert(a)));
const feed = (timestamp = Math.floor(Date.now() / 1000), ...entities) => cat(msg(1, cat(str(1, '2.0'), scalar(3, timestamp))), ...entities.map((e) => msg(2, e)));

test('maps current TTC rapid-transit lines and retains streetcar alerts globally', () => {
  const now = 1700000000000; const result = parseTtcAlerts(feed(Math.floor(now / 1000), entity('line-2-alert', { routeId: '2', title: 'Service adjustment', description: 'Reduced service near a station.', url: 'https://www.ttc.ca/service-alerts' }), entity('streetcar-501-alert', { routeId: '501', title: 'Streetcar diversion', description: 'Route 501 buses replace streetcars.', url: 'https://www.ttc.ca/service-alerts' })), { now });
  assert.equal(result.state, 'live');
  assert.deepEqual(result.lines.map((line) => line.id), ['1', '2', '4', '5', '6']);
  assert.equal(result.lines.find((line) => line.id === '2').state, 'disrupted');
  assert.equal(result.lines.find((line) => line.id === '1').state, 'unknown');
  assert.equal(result.alerts.length, 2);
  assert.equal(result.sourceUrl, TTC_ALERTS_URL);
});

test('maps TTC website route alerts to subway and LRT lines', () => {
  const result = parseTtcWebAlerts({ lastUpdated: '2026-09-04T17:53:21.31Z', routeAlerts: [{ id: 'line-5-alert', route: '5', routeType: 'Subway', activePeriod: { start: '2026-09-04T17:00:00Z', end: '2026-09-04T20:00:00Z' }, headerText: 'Line 5: Service change', title: 'Trains are turning back.', url: 'https://www.ttc.ca/service-alerts' }, { id: 'streetcar-alert', route: '505', routeType: 'Streetcar', activePeriod: { start: '2026-09-04T17:00:00Z' }, headerText: '505 Dundas: Detour', title: 'Detour in effect.', url: '' }] }, { fetchedAt: '2026-09-04T18:00:00.000Z', now: Date.parse('2026-09-04T18:00:00Z') });
  assert.equal(result.sourceUrl, TTC_WEB_ALERTS_URL);
  assert.equal(result.fetchedAt, '2026-09-04T18:00:00.000Z');
  assert.equal(result.sourceUpdatedAt, '2026-09-04T17:53:21.310Z');
  assert.equal(result.lines.find((line) => line.id === '5').state, 'disrupted');
  assert.equal(result.lines.find((line) => line.id === '1').state, 'good');
  assert.equal(result.alerts.length, 2);
});

test('rejects timezone-naive timestamps and makes stale web data unknown', () => {
  assert.throws(() => parseTtcWebAlerts({ lastUpdated: '2026-09-04T18:00:00', routeAlerts: [] }, { fetchedAt: '2026-09-04T18:00:00.000Z', now: Date.parse('2026-09-04T18:00:00Z') }), /explicit timezone/);
  const stale = parseTtcWebAlerts({ lastUpdated: '2026-09-04T17:00:00Z', routeAlerts: [{ id: 'line-1', route: '1', activePeriod: {}, title: 'Old alert' }] }, { fetchedAt: '2026-09-04T18:00:00.000Z', now: Date.parse('2026-09-04T18:00:00Z') });
  assert.equal(stale.state, 'stale');
  assert.ok(stale.lines.every((line) => line.state === 'unknown'));
});

test('propagates an active network-wide alert to every rapid-transit line', () => {
  const result = parseTtcWebAlerts({ lastUpdated: '2026-09-04T18:00:00Z', routeAlerts: [{ id: 'network', route: '', activePeriod: {}, title: 'Network-wide disruption' }] }, { fetchedAt: '2026-09-04T18:00:01.000Z', now: Date.parse('2026-09-04T18:00:01Z') });
  assert.ok(result.lines.every((line) => line.state === 'disrupted'));
  assert.ok(result.lines.every((line) => line.alerts.length === 1));
});

test('does not report an active TTC regular-service notice as a disruption', () => {
  const result = parseTtcWebAlerts({ lastUpdated: '2026-09-04T18:00:00Z', routeAlerts: [{ id: 'resumed', route: '2', effectDesc: 'Regular service', activePeriod: {}, title: 'Service has resumed' }] }, { fetchedAt: '2026-09-04T18:00:01.000Z', now: Date.parse('2026-09-04T18:00:01Z') });
  assert.equal(result.lines.find((line) => line.id === '2').state, 'good');
  assert.equal(result.lines.find((line) => line.id === '2').alerts.length, 0);
  assert.equal(result.alerts.length, 1);
});

test('web transport is bounded and refuses redirects; stale cache never keeps good lines', async () => {
  clearTtcStatusCache();
  const now = Date.parse('2026-09-04T18:00:00Z');
  const payload = { lastUpdated: '2026-09-04T18:00:00Z', routeAlerts: [] };
  let init;
  const first = await getTtcStatus({ fetchImpl: async (_url, options) => { init = options; return new Response(JSON.stringify(payload), { status: 200 }); }, now });
  assert.equal(first.state, 'live');
  assert.equal(init.redirect, 'error');
  const second = await getTtcStatus({ fetchImpl: async () => { throw new Error('offline'); }, now: now + 60_000 });
  assert.equal(second.state, 'stale');
  assert.ok(second.lines.every((line) => line.state === 'unknown'));
  clearTtcStatusCache();
  const huge = new Response(new Uint8Array(2 * 1024 * 1024 + 1), { status: 200 });
  const unavailable = await getTtcStatus({ fetchImpl: async () => huge, now });
  assert.equal(unavailable.state, 'unavailable');
});

test('returns unknown lines when the feed is unavailable', async () => {
  clearTtcStatusCache();
  const result = await getTtcStatus({ fetchImpl: async () => { throw new Error('offline'); }, now: 1700000000000 });
  assert.equal(result.state, 'unavailable');
  assert.ok(result.lines.every((line) => line.state === 'unknown'));
});

test('serves stale cache after a later fetch failure', async () => {
  clearTtcStatusCache();
  const now = Date.now(); const bytes = feed(Math.floor(now / 1000), entity('line-2-alert', { routeId: '2', title: 'Service adjustment', description: 'Reduced service.', url: 'https://www.ttc.ca/service-alerts' }));
  const first = await getTtcStatus({ fetchImpl: async () => new Response(bytes, { status: 200 }), now });
  assert.equal(first.state, 'live');
  const second = await getTtcStatus({ fetchImpl: async () => { throw new Error('offline'); }, now: now + 100000 });
  assert.equal(second.state, 'stale');
});
