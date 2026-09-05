import assert from 'node:assert/strict';
import test from 'node:test';
import { clearVehicleCache, getVehicleSnapshot, getVehicles, parseTtcVehicles, TTC_VEHICLES_URL } from '../vehicles/index.mjs';
import { matchCptdb } from '../vehicles/fleet-registry.mjs';

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

test('maps exact fleet boundaries and labels unmatched identifiers as searches', () => {
  assert.deepEqual([matchCptdb('3400').fleetRange, matchCptdb('3654').fleetRange], ['3400-3654', '3400-3654']); assert.equal(matchCptdb('3399').match, 'search'); assert.equal(matchCptdb('9029').model, 'LFS Artic'); assert.equal(matchCptdb('4400').manufacturer, 'Bombardier Transportation'); assert.equal(matchCptdb('4663').manufacturer, 'Alstom'); assert.equal(matchCptdb('6749').model, 'LFSe+'); assert.equal(matchCptdb('not-a-fleet').match, 'search');
});

test('queries a cached snapshot with exact route filtering and bounded pagination', async () => {
  clearVehicleCache(); const payload = feed(1700000000, vehicle({ id: '3400', route: '29' }), vehicle({ id: '9029', route: '29' }), vehicle({ id: '4400', route: '501' })); let calls = 0; const fetchImpl = async () => { calls += 1; return new Response(payload, { status: 200 }); };
  const first = await getVehicles({ q: 'Nova', route: '29', limit: 1, fetchImpl, now: 1700000000000 }); assert.equal(first.total, 1); assert.equal(first.vehicles[0].id, '9029'); assert.equal(first.nextCursor, null);
  const second = await getVehicles({ route: '29', limit: 1, fetchImpl, now: 1700000000001 }); assert.equal(second.total, 2); assert.equal(second.nextCursor, '1'); assert.equal(calls, 1);
  const mapPage = await getVehicles({ limit: 99999, fetchImpl, now: 1700000000002 }); assert.equal(mapPage.vehicles.length, 3); assert.equal(mapPage.nextCursor, null);
});

test('preserves the last snapshot as stale after a refresh failure', async () => {
  clearVehicleCache(); const payload = feed(1700000000, vehicle({ id: '9029' })); await getVehicleSnapshot({ fetchImpl: async () => new Response(payload), now: 1700000000000 }); const stale = await getVehicleSnapshot({ fetchImpl: async () => { throw new Error('offline'); }, now: 1700000020000, force: true }); assert.equal(stale.state, 'stale'); assert.equal(stale.vehicles[0].stale, true); assert.match(stale.error, /offline/);
});

test('returns an honest unavailable snapshot before any successful response', async () => { clearVehicleCache(); const result = await getVehicleSnapshot({ fetchImpl: async () => { throw new Error('offline'); }, now: 1700000000000 }); assert.equal(result.state, 'unavailable'); assert.equal(result.total, 0); assert.deepEqual(result.vehicles, []); });
