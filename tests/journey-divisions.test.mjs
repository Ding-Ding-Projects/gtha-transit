import assert from 'node:assert/strict';
import test from 'node:test';
import { annotateJourneyDivisions, applyJourneyDivisionPreference } from '../vehicles/journey-divisions.mjs';

const NOW = Date.parse('2026-09-05T12:00:00Z');
const registry = { source: { validFrom: '2026-07-26', validThrough: '2026-09-05', sha256: 'test' }, garageNames: { Wil: 'Wilson', MtD: 'Mount Dennis' }, routesByGarage: { MtD: ['29'], Wil: ['7'] }, fleetAllocations: [{ first: 7000, last: 7133, garages: ['Wil'] }, { first: 9000, last: 9152, garages: ['Wil', 'MtD'] }] };
const assigned = (overrides = {}) => ({ agencyFeedId: 'ttc', routeId: '29', startTime: NOW - 60_000, endTime: NOW + 60_000, vehicle: { id: '7001', fleetNumber: '7001', agencyId: 'ttc', timestamp: NOW - 30_000, stale: false }, vehicleAssignment: { state: 'matched', method: 'exact-trip-id' }, ...overrides });

test('annotates only a current exact TTC assignment and does not mutate inputs', () => {
  const input = [{ id: 'out', legs: [assigned()] }]; const result = annotateJourneyDivisions(input, registry, { now: NOW });
  assert.equal(result.matched, 1); assert.equal(result.itineraries[0].legs[0].vehicleDivision.state, 'out-of-division'); assert.equal(result.itineraries[0].legs[0].vehicleDivision.homeGarageName, 'Wilson'); assert.equal(input[0].legs[0].vehicleDivision, undefined);
});

test('parses current leg times in Unix seconds, Unix milliseconds, and ISO form', () => {
  const seconds = assigned({ startTime: Math.floor((NOW - 60_000) / 1000), endTime: Math.floor((NOW + 60_000) / 1000), vehicle: { ...assigned().vehicle, timestamp: Math.floor((NOW - 30_000) / 1000) } });
  const millis = assigned({ startTime: NOW - 60_000, endTime: NOW + 60_000, vehicle: { ...assigned().vehicle, timestamp: NOW - 30_000 } });
  const iso = assigned({ startTime: new Date(NOW - 60_000).toISOString(), endTime: new Date(NOW + 60_000).toISOString() });
  for (const leg of [seconds, millis, iso]) assert.equal(annotateJourneyDivisions([{ legs: [leg] }], registry, { now: NOW }).itineraries[0].legs[0].vehicleDivision.state, 'out-of-division');
});

test('withholds division evidence for past, future, ambiguous, expired, and route-only assignments', () => {
  const routeOnly = assigned({ vehicleAssignment: { state: 'no-match', method: 'route' } });
  const legs = [assigned({ endTime: NOW - 1 }), assigned({ startTime: NOW + 1 }), assigned({ vehicle: { ...assigned().vehicle, fleetNumber: '9001' } }), routeOnly];
  const result = annotateJourneyDivisions([{ legs }], registry, { now: NOW });
  assert.deepEqual(result.itineraries[0].legs.map((leg) => leg.vehicleDivision.reason), ['leg-is-not-current', 'leg-is-not-current', 'multi-garage-fleet-allocation', 'no-exact-vehicle-assignment']);
  const expiredNow = Date.parse('2026-09-06T04:01:00Z'); const expiredLeg = assigned({ startTime: expiredNow - 60_000, endTime: expiredNow + 60_000, vehicle: { ...assigned().vehicle, timestamp: expiredNow - 30_000 } });
  assert.equal(annotateJourneyDivisions([{ legs: [expiredLeg] }], registry, { now: expiredNow }).itineraries[0].legs[0].vehicleDivision.reason, 'allocation-source-expired');
});

test('soft preference is stable, preserves options, and never boosts route-only facts', () => {
  const annotated = annotateJourneyDivisions([{ id: 'ordinary', legs: [assigned({ routeId: '7', vehicle: { ...assigned().vehicle, fleetNumber: '7001' } })] }, { id: 'out', legs: [assigned()] }, { id: 'route-only', legs: [assigned({ vehicleAssignment: { state: 'no-match', method: 'route' } })] }], registry, { now: NOW });
  const disabled = applyJourneyDivisionPreference(annotated.itineraries, { enabled: false, retained: 'value' }); assert.deepEqual(disabled.itineraries.map((item) => item.id), ['ordinary', 'out', 'route-only']); assert.deepEqual(disabled.options, { enabled: false, retained: 'value' });
  const preferred = applyJourneyDivisionPreference(annotated.itineraries, { enabled: true, retained: 'value' }); assert.deepEqual(preferred.itineraries.map((item) => item.id), ['out', 'ordinary', 'route-only']); assert.equal(preferred.matched, 1); assert.equal(preferred.unknown, 1); assert.equal(preferred.reasons['no-exact-vehicle-assignment'], 1);
});
