import assert from 'node:assert/strict';
import test from 'node:test';
import { clearVehicleCache, enrichItineraries } from '../vehicles/index.mjs';

/**
 * Two measurements against the live TTC feeds on 6 September 2026 shape this.
 *
 * Trip identifiers: of 406 published in the realtime vehicle feed, 104 also
 * existed in the loaded static timetable, but only ONE carried the same route.
 *
 * Stop identifiers: of 192 live vehicles whose reported stop identifier also
 * existed in the timetable, ZERO were within 300 metres of that timetable's
 * stop. Every one of those was a number collision between unrelated stops.
 *
 * Neither identifier space can be joined. A published position can, so the
 * fallback compares coordinates, which cannot collide by numbering.
 */

const cat = (...parts) => Uint8Array.from(parts.flatMap((part) => [...part]));
const varint = (input) => { let value = BigInt(input); const out = []; do { let byte = Number(value & 0x7fn); value >>= 7n; if (value) byte |= 0x80; out.push(byte); } while (value); return Uint8Array.from(out); };
const scalar = (field, value) => cat(varint(field << 3), varint(value));
const bytes = (field, value) => cat(varint((field << 3) | 2), varint(value.length), value);
const string = (field, value) => bytes(field, new TextEncoder().encode(value));
const f32 = (field, value) => { const out = new Uint8Array(4); new DataView(out.buffer).setFloat32(0, value, true); return cat(varint((field << 3) | 5), out); };
const optionalString = (field, value) => value === undefined || value === null || value === '' ? new Uint8Array() : string(field, value);
const optionalScalar = (field, value) => value === undefined || value === null ? new Uint8Array() : scalar(field, value);

const NOW_SECONDS = 1788700800; // 2026-09-06T13:20:00Z
const NOW = NOW_SECONDS * 1000;

const unit = ({ id, route, trip, lat = 43.75, lon = -79.3, stopId = '0', timestamp = NOW_SECONDS }) => {
  const tripDescriptor = cat(string(1, trip), string(5, route));
  const position = cat(bytes(1, tripDescriptor), bytes(2, cat(f32(1, lat), f32(2, lon), f32(3, 180), f32(5, 10))), optionalScalar(3, 12), optionalScalar(4, 2), scalar(5, timestamp), optionalString(7, stopId), bytes(8, cat(string(1, id), string(2, id), string(3, 'TEST'))));
  return bytes(2, cat(string(1, `entity-${id}`), bytes(4, position)));
};
const feed = (...entities) => cat(bytes(1, cat(string(1, '2.0'), scalar(3, NOW_SECONDS))), ...entities);

const leg = (overrides = {}) => ({
  mode: 'BUS',
  route: '68',
  routeId: 'ttc:68',
  agency: 'TTC',
  agencyFeedId: 'ttc',
  tripId: 'ttc-next:50723818',
  from: { stopId: 'ttc:1001', name: 'Warden Station', lat: 43.71, lon: -79.3 },
  // A long leg, as a real bus route is: the expected position must pick one stop
  // out of many rather than treating the whole corridor as a match.
  intermediateStops: [
    { stopId: 'ttc:1002', lat: 43.72, lon: -79.3, arrival: { scheduledTime: '2026-09-06T13:16:00.000Z' } },
    { stopId: 'ttc:1003', lat: 43.73, lon: -79.3, arrival: { scheduledTime: '2026-09-06T13:18:00.000Z' } },
    { stopId: 'ttc:1004', lat: 43.75, lon: -79.3, arrival: { scheduledTime: '2026-09-06T13:20:00.000Z' } },
    { stopId: 'ttc:1005', lat: 43.76, lon: -79.3, arrival: { scheduledTime: '2026-09-06T13:24:00.000Z' } },
    { stopId: 'ttc:1006', lat: 43.78, lon: -79.3, arrival: { scheduledTime: '2026-09-06T13:32:00.000Z' } },
    { stopId: 'ttc:1007', lat: 43.79, lon: -79.3, arrival: { scheduledTime: '2026-09-06T13:36:00.000Z' } },
  ],
  to: { stopId: 'ttc:1008', name: 'Victoria Park', lat: 43.8, lon: -79.3 },
  startTime: '2026-09-06T13:15:00.000Z',
  endTime: '2026-09-06T13:45:00.000Z',
  ...overrides,
});

const run = async (entities, legOverrides = {}) => {
  clearVehicleCache();
  const payload = feed(...entities);
  const result = await enrichItineraries([{ legs: [leg(legOverrides)] }], {
    fetchImpl: async () => new Response(payload),
    now: NOW,
  });
  return result[0].legs[0];
};

/** 43.75, -79.30 is the leg's second stop, so this unit is standing at it. */
const onLeg = { id: '3201', route: '68', trip: '77311070', lat: 43.75, lon: -79.3 };

test('a trip identifier published on another route is a collision and assigns nothing', async () => {
  const result = await run([unit({ id: '9999', route: '512', trip: '50723818', lat: 43.75, lon: -79.3 })]);
  assert.equal(result.vehicle, undefined);
  assert.notEqual(result.vehicleAssignment.state, 'matched');
});

test('an exact trip identifier on the same route still assigns immediately', async () => {
  const result = await run([unit({ ...onLeg, trip: '50723818', lat: 44.9, lon: -79.9 })]);
  assert.equal(result.vehicleAssignment.state, 'matched');
  assert.equal(result.vehicleAssignment.method, 'exact-trip-id');
  assert.equal(result.vehicle.id, '3201');
});

test('one vehicle standing at a stop on this leg is identified, and says how', async () => {
  const result = await run([unit(onLeg)]);
  assert.equal(result.vehicleAssignment.state, 'matched');
  assert.equal(result.vehicleAssignment.method, 'route-and-stop-position');
  assert.match(result.vehicleAssignment.disclosure, /trip identifier/);
  assert.equal(result.vehicle.id, '3201');
});

test('a stop identifier that collides from twenty kilometres away identifies nothing', async () => {
  const result = await run([unit({ id: '3299', route: '68', trip: '77311099', lat: 43.93, lon: -79.3, stopId: '1002' })]);
  assert.equal(result.vehicleAssignment.state, 'no-match');
  assert.equal(result.vehicle, undefined);
});

test('a vehicle on the right route but nowhere near this leg is not identified', async () => {
  const result = await run([unit({ ...onLeg, lat: 43.95, lon: -79.3 })]);
  assert.equal(result.vehicleAssignment.state, 'no-match');
  assert.equal(result.vehicle, undefined);
});

test('a vehicle of another route at the same place is not this leg', async () => {
  const result = await run([unit({ ...onLeg, route: '24' })]);
  assert.equal(result.vehicleAssignment.state, 'no-match');
});

test('two vehicles at the same expected position are ambiguous rather than guessed', async () => {
  const result = await run([unit(onLeg), unit({ id: '3202', route: '68', trip: '77311071', lat: 43.7502, lon: -79.3 })]);
  assert.equal(result.vehicleAssignment.state, 'ambiguous');
  assert.equal(result.vehicleAssignment.candidateCount, 2);
  assert.equal(result.vehicle, undefined);
});

test('a vehicle further along the leg than the trip has reached is not this trip', async () => {
  // 43.78 is the stop this trip reaches at 13:32; at 13:20 it is twelve minutes ahead.
  const result = await run([unit({ id: '3202', route: '68', trip: '77311071', lat: 43.78, lon: -79.3 })]);
  assert.equal(result.vehicleAssignment.state, 'no-match');
  assert.equal(result.vehicle, undefined);
});

test('a long leg does not turn every vehicle on the route into a candidate', async () => {
  // The defect this guards: on a leg with dozens of stops, asking whether a vehicle
  // sits near ANY of them matched most of the route's fleet and identified nothing.
  const spread = [
    unit(onLeg),
    unit({ id: 'far-1', route: '68', trip: 'a', lat: 43.71, lon: -79.3 }),
    unit({ id: 'far-2', route: '68', trip: 'b', lat: 43.78, lon: -79.3 }),
    unit({ id: 'far-3', route: '68', trip: 'c', lat: 43.8, lon: -79.3 }),
  ];
  const result = await run(spread);
  assert.equal(result.vehicleAssignment.state, 'matched');
  assert.equal(result.vehicle.id, '3201');
});

test('a departure that has not left yet reports that, rather than a failed search', async () => {
  const early = await run([unit(onLeg)], { startTime: '2026-09-06T14:00:00.000Z', endTime: '2026-09-06T14:30:00.000Z' });
  assert.equal(early.vehicleAssignment.state, 'not-started');
  assert.equal(early.vehicleAssignment.minutesUntilDeparture, 40);
  assert.equal(early.vehicle, undefined);
});

test('a running departure with no candidate is still an honest no-match', async () => {
  const running = await run([unit({ ...onLeg, lat: 43.95, lon: -79.3 })], { startTime: '2026-09-06T13:10:00.000Z', endTime: '2026-09-06T13:40:00.000Z' });
  assert.equal(running.vehicleAssignment.state, 'no-match');
  assert.equal(running.vehicle, undefined);
});

test('a leg that has already finished keeps its existing unavailable verdict', async () => {
  const late = await run([unit(onLeg)], { startTime: '2026-09-06T12:40:00.000Z', endTime: '2026-09-06T13:10:00.000Z' });
  assert.equal(late.vehicleAssignment.state, 'unavailable');
  assert.equal(late.vehicle, undefined);
});

test('a bus already at the boarding stop is identified inside the lead-in', async () => {
  // Boarding in ten minutes, with the bus standing at the boarding stop.
  const soon = await run([unit({ ...onLeg, lat: 43.71, lon: -79.3 })], {
    startTime: '2026-09-06T13:30:00.000Z',
    endTime: '2026-09-06T14:00:00.000Z',
    intermediateStops: [{ stopId: 'ttc:1002', lat: 43.75, lon: -79.3, arrival: { scheduledTime: '2026-09-06T13:45:00.000Z' } }],
  });
  assert.equal(soon.vehicleAssignment.state, 'matched');
  assert.equal(soon.vehicleAssignment.method, 'route-and-stop-position');
});

test('the window follows the trip through the leg', async () => {
  // At 13:20 the trip is at the 43.75 stop, and that is the bus identified.
  const middle = await run([unit(onLeg)]);
  assert.equal(middle.vehicleAssignment.state, 'matched');
  assert.equal(middle.vehicle.id, '3201');
  // A bus at the alighting stop is twelve minutes ahead of this trip, so it is not it.
  const ahead = await run([unit({ ...onLeg, lat: 43.8, lon: -79.3 })]);
  assert.equal(ahead.vehicleAssignment.state, 'no-match');
});

test('a leg with no published stop coordinates cannot be matched by position', async () => {
  const bare = { from: { name: 'A' }, to: { name: 'B' }, intermediateStops: [] };
  const result = await run([unit(onLeg)], bare);
  assert.equal(result.vehicleAssignment.state, 'no-match');
});

test('a vehicle with no published position cannot be matched by position', async () => {
  const result = await run([unit({ ...onLeg, lat: 0, lon: 0 })]);
  assert.equal(result.vehicleAssignment.state, 'no-match');
});
