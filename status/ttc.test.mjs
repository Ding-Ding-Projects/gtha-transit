import test from 'node:test';
import assert from 'node:assert/strict';
import { clearTtcStatusCache, getTtcStatus, parseTtcAlerts, TTC_ALERTS_URL } from './ttc.mjs';

const v = (n) => { const a = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; a.push(b); } while (n); return Uint8Array.from(a); };
const msg = (field, bytes) => Uint8Array.from([...(v((field << 3) | 2)), ...v(bytes.length), ...bytes]);
const str = (field, value) => msg(field, new TextEncoder().encode(value));
const cat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));
const translation = (value) => msg(1, str(1, value));
const alert = ({ routeId, title, description, url }) => cat(msg(5, str(2, routeId)), msg(10, translation(title)), msg(11, translation(description)), msg(8, translation(url)));
const entity = (id, a) => cat(str(1, id), msg(5, alert(a)));
const feed = (...entities) => cat(...entities.map((e) => msg(1, e)));

test('maps current TTC rapid-transit lines and retains streetcar alerts globally', () => {
  const result = parseTtcAlerts(feed(entity('line-2-alert', { routeId: '2', title: 'Service adjustment', description: 'Reduced service near a station.', url: 'https://www.ttc.ca/service-alerts' }), entity('streetcar-501-alert', { routeId: '501', title: 'Streetcar diversion', description: 'Route 501 buses replace streetcars.', url: 'https://www.ttc.ca/service-alerts' })));
  assert.equal(result.state, 'live');
  assert.deepEqual(result.lines.map((line) => line.id), ['1', '2', '4', '5', '6']);
  assert.equal(result.lines.find((line) => line.id === '2').state, 'disrupted');
  assert.equal(result.lines.find((line) => line.id === '1').state, 'good');
  assert.equal(result.alerts.length, 2);
  assert.equal(result.sourceUrl, TTC_ALERTS_URL);
});

test('returns unknown lines when the feed is unavailable', async () => {
  clearTtcStatusCache();
  const result = await getTtcStatus({ fetchImpl: async () => { throw new Error('offline'); }, now: 1700000000000 });
  assert.equal(result.state, 'unavailable');
  assert.ok(result.lines.every((line) => line.state === 'unknown'));
});

test('serves stale cache after a later fetch failure', async () => {
  clearTtcStatusCache();
  const bytes = feed(entity('line-2-alert', { routeId: '2', title: 'Service adjustment', description: 'Reduced service.', url: 'https://www.ttc.ca/service-alerts' }));
  const first = await getTtcStatus({ fetchImpl: async () => new Response(bytes, { status: 200 }), now: 1700000000000 });
  assert.equal(first.state, 'live');
  const second = await getTtcStatus({ fetchImpl: async () => { throw new Error('offline'); }, now: 1700000100000 });
  assert.equal(second.state, 'stale');
});
