import assert from 'node:assert/strict';
import test from 'node:test';
import { clearVehicleCache, enrichItineraries, getVehicleSnapshot, getVehicles, parseTtcVehicles, parseVehicleFeed, TTC_VEHICLES_URL } from '../vehicles/index.mjs';
import { matchCptdb, matchVehiclePhoto, resolveFleetNumber } from '../vehicles/fleet-registry.mjs';

const cat = (...parts) => Uint8Array.from(parts.flatMap((part) => [...part]));
const varint = (input) => { let value = BigInt(input); const out = []; do { let byte = Number(value & 0x7fn); value >>= 7n; if (value) byte |= 0x80; out.push(byte); } while (value); return Uint8Array.from(out); };
const scalar = (field, value) => cat(varint(field << 3), varint(value));
const bytes = (field, value) => cat(varint((field << 3) | 2), varint(value.length), value);
const string = (field, value) => bytes(field, new TextEncoder().encode(value));
const f32 = (field, value) => { const out = new Uint8Array(4); new DataView(out.buffer).setFloat32(0, value, true); return cat(varint((field << 3) | 5), out); };
const vehicle = ({ id = '9029', label = id, route = '29', trip = 'trip-29', lat = 43.6501, lon = -79.4402, bearing = 180, speed = 10, timestamp = 1700000000 } = {}) => bytes(2, cat(string(1, `entity-${id}`), bytes(4, cat(bytes(1, cat(string(1, trip), string(5, route))), bytes(2, cat(f32(1, lat), f32(2, lon), f32(3, bearing), f32(5, speed))), scalar(5, timestamp), bytes(8, cat(string(1, id), string(2, label), string(3, 'TEST')))))));
const feed = (timestamp, ...entities) => cat(bytes(1, cat(string(1, '2.0'), scalar(3, timestamp))), ...entities);

test('decodes the real GTFS Realtime vehicle schema including floats and descriptors', () => {
  const now = 1700000000000; const result = parseTtcVehicles(feed(1700000000, vehicle()), { now, fetchedAt: '2023-11-14T22:13:20.000Z' }); const item = result.vehicles[0];
  assert.equal(result.state, 'live'); assert.equal(result.sourceUrl, TTC_VEHICLES_URL); assert.equal(item.id, '9029'); assert.equal(item.label, '9029'); assert.equal(item.routeId, '29'); assert.equal(item.tripId, 'trip-29'); assert.ok(Math.abs(item.lat - 43.6501) < 0.0001); assert.ok(Math.abs(item.lon + 79.4402) < 0.0001); assert.equal(item.bearing, 180); assert.equal(item.speedKph, 36); assert.equal(item.timestamp, '2023-11-14T22:13:20.000Z'); assert.equal(item.licensePlate, 'TEST'); assert.equal(item.stale, false);
});

test('marks old feed and vehicle timestamps stale', () => { const result = parseTtcVehicles(feed(1699999000, vehicle({ timestamp: 1699999000 })), { now: 1700000000000 }); assert.equal(result.state, 'stale'); assert.equal(result.vehicles[0].stale, true); });
test('rejects malformed fields, excessive bytes, and incomplete headers', () => { assert.throws(() => parseTtcVehicles(Uint8Array.of(0x12, 0xff))); assert.throws(() => parseTtcVehicles(new Uint8Array(10 * 1024 * 1024 + 1))); assert.throws(() => parseTtcVehicles(bytes(1, string(1, '2.0')))); });
test('drops invalid coordinates without dropping valid entities', () => { const result = parseTtcVehicles(feed(1700000000, vehicle({ id: 'bad', lat: 120 }), vehicle({ id: '3400' })), { now: 1700000000000 }); assert.deepEqual(result.vehicles.map((item) => item.id), ['3400']); });

test('uses official TTC boundaries and treats CPTDB links as searches rather than verified records', () => {
  assert.equal(matchCptdb('3400').fleetRange, '3400-3454'); assert.equal(matchCptdb('3400').manufacturer, 'Nova Bus'); assert.equal(matchCptdb('3455').fleetRange, '3455-3654'); assert.equal(matchCptdb('3759').model, 'K9M'); assert.equal(matchCptdb('3760').fleetRange, undefined); assert.equal(matchCptdb('9400').model, 'Xcelsior XDE60'); assert.equal(matchCptdb('9468').capacity, '50 seats'); assert.equal(matchCptdb('4400').manufacturer, 'Alstom'); assert.equal(matchCptdb('3400').match, 'search'); assert.equal(matchCptdb('not-a-fleet').match, 'search');
});

test('attaches licensed representative photos without claiming the wrong exact vehicle', () => {
  const flexity = matchCptdb('4412'); assert.equal(matchVehiclePhoto('4412', flexity).exactVehicle, true); assert.equal(matchVehiclePhoto('4400', flexity).exactVehicle, false); assert.equal(matchVehiclePhoto('3400', matchCptdb('3400')).license, 'CC BY-SA 4.0'); assert.equal(matchVehiclePhoto('3539', matchCptdb('3539')).exactVehicle, true); assert.equal(matchVehiclePhoto('3640', matchCptdb('3640')).exactVehicle, false); assert.equal(matchVehiclePhoto('9029', matchCptdb('9029')), null); assert.equal(matchVehiclePhoto('604', {}, 'go').exactVehicle, true); assert.equal(matchVehiclePhoto('2500', {}, 'go'), null);
});

test('namespaces non-TTC vehicles and gives each a real agency-specific CPTDB search', () => {
  const result = parseVehicleFeed(feed(1700000000, vehicle({ id: '1234' })), { now: 1700000000000, agencyId: 'miway', agencyName: 'MiWay', sourceUrl: 'https://example.test/vehicles.pb' }); assert.equal(result.agencyId, 'miway'); assert.equal(result.vehicles[0].agencyId, 'miway'); assert.match(result.vehicles[0].cptdb.url, /MiWay%201234/); assert.equal(result.vehicles[0].cptdb.manufacturer, undefined);
  assert.equal(result.vehicles[0].photo.credit, 'Robert T Bell'); assert.equal(result.vehicles[0].photo.exactVehicle, false);
});

test('prefers a fleet-like label but falls back to a numeric vehicle id for descriptive labels', () => {
  assert.equal(resolveFleetNumber('2118', '1018'), '1018'); assert.equal(resolveFleetNumber('3004', 'UP - Pearson Airport'), '3004'); assert.equal(resolveFleetNumber('go:646', 'GO train'), '646');
  const go = matchCptdb('646', '646', { agencyId: 'go', agencyName: 'GO Transit' }); assert.equal(go.model, 'MP40PH-3C'); assert.equal(go.year, '2007-2010'); assert.equal(go.match, 'series');
  const up = matchCptdb('3004', 'UP - Pearson Airport', { agencyId: 'up', agencyName: 'UP Express' }); assert.equal(up.model, 'DMU C-car'); assert.equal(up.manufacturer, 'Nippon Sharyo'); assert.equal(up.displayFleetNumber, '3004');
});

test('enriches directions only from an exact fresh agency and trip identifier match', async () => {
  clearVehicleCache(); const payload = feed(1700000000, vehicle({ id: '604', trip: '20260905-GT-3511', route: '09261126-GT' })); const fetchImpl = async () => new Response(payload); const input = [{ legs: [{ startTime:'2023-11-14T22:13:20Z', endTime:'2023-11-14T23:13:20Z', agencyId: 'go:GO', agencyFeedId: 'go', tripId: 'go:20260905-GT-3511', routeId: 'go:09261126-GT' }, { startTime:'2023-11-14T22:13:20Z', endTime:'2023-11-14T23:13:20Z', agencyFeedId: 'go', tripId: 'go:different', routeId: 'go:09261126-GT' }] }];
  const result = await enrichItineraries(input, { fetchImpl, routingOrigin: 'https://routing.example', now: 1700000000000 }); assert.equal(result[0].legs[0].vehicle.id, '604'); assert.equal(result[0].legs[0].vehicleAssignment.method, 'exact-trip-id'); assert.equal(result[0].legs[1].vehicle, undefined); assert.equal(result[0].legs[1].vehicleAssignment.state, 'no-match');
});

test('queries a cached snapshot with exact route filtering and bounded pagination', async () => {
  clearVehicleCache(); const payload = feed(1700000000, vehicle({ id: '3400', route: '29' }), vehicle({ id: '9029', route: '29' }), vehicle({ id: '4400', route: '501' })); let calls = 0; const fetchImpl = async () => { calls += 1; return new Response(payload, { status: 200 }); };
  const first = await getVehicles({ q: 'Nova', route: '29', limit: 1, fetchImpl, now: 1700000000000 }); assert.equal(first.total, 2); assert.equal(first.vehicles[0].id, '3400'); assert.equal(first.nextCursor, '1');
  const second = await getVehicles({ route: '29', limit: 1, fetchImpl, now: 1700000000001 }); assert.equal(second.total, 2); assert.equal(second.nextCursor, '1'); assert.equal(calls, 1);
  const mapPage = await getVehicles({ limit: 99999, fetchImpl, now: 1700000000002 }); assert.equal(mapPage.vehicles.length, 3); assert.equal(mapPage.nextCursor, null);
});
test('current vehicle positions cannot be assigned to tomorrow by a reused trip id',async()=>{
 clearVehicleCache();const payload=feed(1700000000,vehicle({id:'604',trip:'daily-trip'}));const result=await enrichItineraries([{legs:[{agencyFeedId:'go',tripId:'go:daily-trip',startTime:'2023-11-15T22:13:20Z',endTime:'2023-11-15T23:13:20Z'}]}],{fetchImpl:async()=>new Response(payload),routingOrigin:'https://routing.example',now:1700000000000});assert.equal(result[0].legs[0].vehicle,undefined);assert.equal(result[0].legs[0].vehicleAssignment.state,'unavailable');
});

test('preserves the last snapshot as stale after a refresh failure', async () => {
  clearVehicleCache(); const payload = feed(1700000000, vehicle({ id: '9029' })); await getVehicleSnapshot({ fetchImpl: async () => new Response(payload), now: 1700000000000 }); const stale = await getVehicleSnapshot({ fetchImpl: async () => { throw new Error('offline'); }, now: 1700000020000, force: true }); assert.equal(stale.state, 'stale'); assert.equal(stale.vehicles[0].stale, true); assert.match(stale.error, /offline/);
});

test('returns an honest unavailable snapshot before any successful response', async () => { clearVehicleCache(); const result = await getVehicleSnapshot({ fetchImpl: async () => { throw new Error('offline'); }, now: 1700000000000 }); assert.equal(result.state, 'unavailable'); assert.equal(result.total, 0); assert.deepEqual(result.vehicles, []); });

test('conflicting or oversized source photographs are not attached', () => {
  assert.equal(matchVehiclePhoto('9441', matchCptdb('9441')), null);
  assert.equal(matchVehiclePhoto('2283', {}, 'hsr'), null);
});
