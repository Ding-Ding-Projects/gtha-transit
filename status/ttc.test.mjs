import test from 'node:test';
import assert from 'node:assert/strict';
import { clearTtcStatusCache, getTtcStatus, parseTtcAlerts, parseTtcWebAlerts, TTC_ALERTS_URL, TTC_WEB_ALERTS_URL } from './ttc.mjs';

const v = (n) => { const a = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; a.push(b); } while (n); return Uint8Array.from(a); };
const scalar = (field, value) => Uint8Array.from([...(v(field << 3)), ...v(value)]);
const msg = (field, bytes) => Uint8Array.from([...(v((field << 3) | 2)), ...v(bytes.length), ...bytes]);
const str = (field, value) => msg(field, new TextEncoder().encode(value));
const cat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));
const translation = (value) => msg(1, str(1, value));
const selector = ({ agencyId, routeId, routeType, stopId }) => cat(agencyId ? str(1, agencyId) : new Uint8Array(), routeId ? str(2, routeId) : new Uint8Array(), Number.isInteger(routeType) ? scalar(3, routeType) : new Uint8Array(), stopId ? str(5, stopId) : new Uint8Array());
const alert = ({ agencyId, routeId, routeType, stopId, title, description, url }) => cat(msg(5, selector({ agencyId, routeId, routeType, stopId })), msg(10, translation(title)), msg(11, translation(description)), msg(8, translation(url)));
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
  assert.deepEqual(result.alerts.find((alert) => alert.id === 'streetcar-alert').routeIds, ['505']);
  assert.deepEqual(result.alerts.find((alert) => alert.id === 'streetcar-alert').routeRefs, [{ routeId: '505', routeType: 'Streetcar' }]);
});

test('retains GTFS-Realtime route types and every comma- or pipe-separated TTC route identifier', () => {
  const now = 1700000000000;
  const realtime = parseTtcAlerts(feed(Math.floor(now / 1000), entity('typed', { routeId: '324', routeType: 3, title: 'Bus diversion', description: 'Detour.', url: 'https://www.ttc.ca/service-alerts' })), { now });
  assert.deepEqual(realtime.alerts[0].routeIds, ['324']);
  assert.deepEqual(realtime.alerts[0].routeRefs, [{ routeId: '324', routeType: 3 }]);
  const web = parseTtcWebAlerts({ lastUpdated: '2026-09-04T18:00:00Z', routeAlerts: [{ id: 'many', route: '324, 501|301|324', routeType: 'Bus', activePeriod: {}, title: 'Several routes' }] }, { fetchedAt: '2026-09-04T18:00:01.000Z', now: Date.parse('2026-09-04T18:00:01Z') });
  assert.deepEqual(web.alerts[0].routeIds, ['324', '501', '301']);
  assert.deepEqual(web.alerts[0].routeRefs, [{ routeId: '324', routeType: 'Bus' }, { routeId: '501', routeType: 'Bus' }, { routeId: '301', routeType: 'Bus' }]);
});

test('fails closed for a GTFS-Realtime selector restricted only to a stop', () => {
  const now = 1700000000000;
  const result = parseTtcAlerts(feed(Math.floor(now / 1000), entity('stop-only', { stopId: '1234', title: 'Stop notice', description: 'Details.', url: 'https://www.ttc.ca/service-alerts' })), { now });
  assert.equal(result.alerts[0].routeScope, 'unknown');
  assert.ok(result.lines.every((line) => line.state === 'unknown'));
});

test('treats an agency-only GTFS-Realtime selector as an explicit network scope', () => {
  const now = 1700000000000;
  const result = parseTtcAlerts(feed(Math.floor(now / 1000), entity('agency-wide', { agencyId: 'ttc', title: 'Network notice', description: 'Details.', url: 'https://www.ttc.ca/service-alerts' })), { now });
  assert.equal(result.alerts[0].routeScope, 'network');
  assert.ok(result.lines.every((line) => line.state === 'disrupted'));
});

test('preserves a timezone-naive publisher update as text without inventing an instant', () => {
  const result = parseTtcWebAlerts({ lastUpdated: 'September 4, 2026 18:07:13', routeAlerts: [{ id: 'line-1', route: '1', effectDesc: 'No Service', activePeriod: {}, title: 'No service' }] }, { fetchedAt: '2026-09-04T22:12:00.000Z', now: Date.parse('2026-09-04T22:12:00Z') });
  assert.equal(result.state, 'live');
  assert.equal(result.sourceUpdatedAtRaw, 'September 4, 2026 18:07:13');
  assert.equal('sourceUpdatedAt' in result, false);
  assert.equal(result.lines.find((line) => line.id === '1').state, 'disrupted');
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

/**
 * Shapes copied from the real TTC route-alert payload observed on 6 September 2026.
 * On that day every alert touching lines 1, 2, 4, 5 and 6 was an escalator notice,
 * and the interface reported the whole subway network disrupted.
 */
const webPayload = (alerts) => ({ lastUpdated: '2026-09-06T12:00:00Z', routeAlerts: alerts });
const escalator = (route) => ({
  id: 'esc-' + route, route, routeType: 'Escalator', effectDesc: 'Out of service',
  headerText: 'Kennedy: Escalator 16D2E out of service from Line 2 platform to concourse.',
  title: 'Escalator out of service', url: '',
  activePeriod: { start: '2026-09-01T00:00:00Z', end: '0001-01-01T00:00:00Z' },
});
const subwayDelay = (route) => ({
  id: 'delay-' + route, route, routeType: 'Subway', effectDesc: 'Delay',
  headerText: 'Line 5 Eglinton: Delays eastbound at Mount Dennis station.',
  title: 'Delays eastbound', url: '',
  activePeriod: { start: '2026-09-06T11:00:00Z', end: '0001-01-01T00:00:00Z' },
});

test('an escalator notice alone never marks a line disrupted, but stays listed on it', () => {
  const parsed = parseTtcWebAlerts(webPayload([escalator('1'), escalator('2')]), { fetchedAt: '2026-09-06T12:00:00Z', now: Date.parse('2026-09-06T12:00:00Z') });
  const line1 = parsed.lines.find((line) => line.id === '1');
  const line2 = parsed.lines.find((line) => line.id === '2');
  assert.equal(line1.state, 'good');
  assert.equal(line2.state, 'good');
  assert.equal(line1.alerts.length, 1);
  assert.equal(line1.facilityAlertCount, 1);
  assert.equal(line1.serviceAlertCount, 0);
});

test('a published service delay still marks its line disrupted', () => {
  const parsed = parseTtcWebAlerts(webPayload([escalator('5'), subwayDelay('5')]), { fetchedAt: '2026-09-06T12:00:00Z', now: Date.parse('2026-09-06T12:00:00Z') });
  const line5 = parsed.lines.find((line) => line.id === '5');
  assert.equal(line5.state, 'disrupted');
  assert.equal(line5.serviceAlertCount, 1);
  assert.equal(line5.facilityAlertCount, 1);
  assert.equal(line5.alerts.length, 2);
});

test('a network-wide notice with no route type still counts as service affecting', () => {
  const network = { id: 'net', route: '', routeType: '', effectDesc: 'Reduced service', headerText: 'TTC: Reduced overnight service.', title: 'Reduced', url: '', activePeriod: { start: '2026-09-06T11:00:00Z', end: '0001-01-01T00:00:00Z' } };
  const parsed = parseTtcWebAlerts(webPayload([network]), { fetchedAt: '2026-09-06T12:00:00Z', now: Date.parse('2026-09-06T12:00:00Z') });
  assert.equal(parsed.lines.every((line) => line.state === 'disrupted'), true);
});
