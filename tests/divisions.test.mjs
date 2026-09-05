import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { classifyOutOfDivision, getOutOfDivisionVehicles, loadTtcDivisionRegistry, routeGarages } from '../vehicles/divisions.mjs';
import { createVehicleSightingStore } from '../history/vehicle-sightings.mjs';

const NOW = Date.parse('2026-09-05T12:00:00Z');
const vehicle = (overrides = {}) => ({ id: '7001', label: '7001', fleetNumber: '7001', agencyId: 'ttc', routeId: '29', timestamp: '2026-09-05T11:59:30.000Z', stale: false, ...overrides });

test('loads the current official allocation receipt and preserves many-to-many routes', async () => {
  const registry = await loadTtcDivisionRegistry(); assert.equal(registry.source.sha256, '5A81E7680049BDFADDD9187C1867AE966939B0E5D35085E4EF583D77CEE1466C'); assert.equal(Object.values(registry.routesByGarage).flat().length, 207); assert.deepEqual(routeGarages(registry, 'ttc:301').sort(), ['Qsy', 'Ron']); assert.deepEqual(routeGarages(registry, '29'), ['MtD']);
});

test('classifies only fresh vehicles from single-garage fleet allocations', async () => {
  const registry = await loadTtcDivisionRegistry();
  const out = classifyOutOfDivision(vehicle(), '29', registry, { now: NOW }); assert.equal(out.state, 'out-of-division'); assert.equal(out.homeGarage, 'Wil'); assert.deepEqual(out.assignedGarages, ['MtD']);
  const seconds = classifyOutOfDivision(vehicle({ timestamp: Math.floor((NOW - 30_000) / 1000) }), '29', registry, { now: NOW }); assert.equal(seconds.state, 'out-of-division');
  const inside = classifyOutOfDivision(vehicle({ routeId: '7' }), '7', registry, { now: NOW }); assert.equal(inside.state, 'in-division');
  const ambiguous = classifyOutOfDivision(vehicle({ id: '9001', fleetNumber: '9001' }), '29', registry, { now: NOW }); assert.equal(ambiguous.state, 'unknown'); assert.equal(ambiguous.reason, 'multi-garage-fleet-allocation');
});

test('fails closed on expired evidence, stale observations, non-TTC vehicles, and missing routes', async () => {
  const registry = await loadTtcDivisionRegistry();
  assert.equal(classifyOutOfDivision(vehicle(), '29', registry, { now: Date.parse('2026-09-06T12:00:00Z') }).reason, 'allocation-source-expired');
  assert.equal(classifyOutOfDivision(vehicle({ stale: true }), '29', registry, { now: NOW }).reason, 'not-a-fresh-ttc-vehicle');
  assert.equal(classifyOutOfDivision(vehicle({ timestamp: 'not-a-date' }), '29', registry, { now: NOW }).reason, 'not-a-fresh-ttc-vehicle');
  assert.equal(classifyOutOfDivision(vehicle({ timestamp: new Date(NOW + 1).toISOString() }), '29', registry, { now: NOW }).reason, 'not-a-fresh-ttc-vehicle');
  assert.equal(classifyOutOfDivision(vehicle({ timestamp: Math.floor((NOW - 121_000) / 1000) }), '29', registry, { now: NOW }).reason, 'not-a-fresh-ttc-vehicle');
  assert.equal(classifyOutOfDivision(vehicle({ agencyId: 'miway' }), '29', registry, { now: NOW }).reason, 'not-a-fresh-ttc-vehicle');
  assert.equal(classifyOutOfDivision(vehicle(), '9999', registry, { now: NOW }).reason, 'route-allocation-unavailable');
});

test('returns only verified out-of-division records from a live TTC snapshot', async () => {
  const registry = await loadTtcDivisionRegistry(); const snapshot = { state: 'live', agencyId: 'ttc', vehicles: [vehicle(), vehicle({ id: '7002', label: '7002', fleetNumber: '7002', routeId: '7' }), vehicle({ id: '9001', label: '9001', fleetNumber: '9001' })] }; const result = getOutOfDivisionVehicles(snapshot, registry, { now: NOW }); assert.deepEqual(result.map((item) => item.vehicle.id), ['7001']);
});

test('stores one sighting per Toronto calendar day and computes observed-frequency rarity', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'gtha-sightings-')); const store = createVehicleSightingStore({ directory });
  try {
    for (let index = 0; index < 10; index += 1) { const timestamp = new Date(Date.parse('2026-08-27T16:00:00Z') + index * 86400000).toISOString(); const vehicles = [{ id: 'route-witness', routeId: '29', timestamp, stale: false }]; if (index === 0) vehicles.push({ id: '7001', routeId: '29', timestamp, stale: false }); assert.equal(store.observe({ state: 'live', agencyId: 'ttc', vehicles }, { now: Date.parse(timestamp) }).observed, true); store.observe({ state: 'live', agencyId: 'ttc', vehicles }, { now: Date.parse(timestamp) }); }
    const result = store.query({ vehicleId: '7001', routeId: '29', now: NOW }); assert.deepEqual(result.sample, { vehicleRouteDays: 1, routeObservedDays: 10 }); assert.equal(result.percentage, 10); assert.equal(result.rarity, 'Epic'); assert.equal(result.eligible, true); assert.match(result.note, /not a prediction/);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('withholds a rarity badge below seven route-days and handles a zero denominator', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'gtha-sightings-')); const store = createVehicleSightingStore({ directory });
  try { const empty = store.query({ vehicleId: '7001', routeId: '29', now: NOW }); assert.equal(empty.percentage, null); assert.equal(empty.rarity, null); assert.equal(empty.eligible, false); store.observe({ state: 'live', agencyId: 'ttc', vehicles: [{ id: '7001', routeId: '29', timestamp: new Date(NOW - 60_000).toISOString(), stale: false }] }, { now: NOW }); const small = store.query({ vehicleId: '7001', routeId: '29', now: NOW }); assert.equal(small.percentage, 100); assert.equal(small.rarity, null); assert.equal(small.eligible, false); }
  finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('keeps valid Unix-second observations when a snapshot also has invalid, future, or stale timestamps', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'gtha-sightings-')); const store = createVehicleSightingStore({ directory });
  try {
    const result = store.observe({ state: 'live', agencyId: 'ttc', vehicles: [
      { id: 'valid', routeId: '29', timestamp: Math.floor((NOW - 60_000) / 1000), stale: false },
      { id: 'invalid', routeId: '29', timestamp: 'not-a-date', stale: false },
      { id: 'future', routeId: '29', timestamp: Math.floor((NOW + 1_000) / 1000), stale: false },
      { id: 'old', routeId: '29', timestamp: Math.floor((NOW - 121_000) / 1000), stale: false },
    ] }, { now: NOW });
    assert.deepEqual(result, { observed: true, count: 1 });
    assert.deepEqual(store.query({ vehicleId: 'valid', routeId: '29', now: NOW }).sample, { vehicleRouteDays: 1, routeObservedDays: 1 });
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('uses Toronto calendar days across DST and bounds the requested window to whole days', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'gtha-sightings-')); const store = createVehicleSightingStore({ directory });
  try {
    const first = Date.parse('2026-11-01T16:00:00Z'); const second = Date.parse('2026-11-02T17:00:00Z');
    store.observe({ state: 'live', agencyId: 'ttc', vehicles: [{ id: '7001', routeId: '29', timestamp: new Date(first).toISOString(), stale: false }] }, { now: first });
    store.observe({ state: 'live', agencyId: 'ttc', vehicles: [{ id: '7001', routeId: '29', timestamp: new Date(second).toISOString(), stale: false }] }, { now: second });
    const twoDay = store.query({ vehicleId: '7001', routeId: '29', now: second, windowDays: 2.8 });
    assert.deepEqual(twoDay.window, { timeZone: 'America/Toronto', start: '2026-11-01', end: '2026-11-02', days: 2 });
    assert.deepEqual(twoDay.sample, { vehicleRouteDays: 2, routeObservedDays: 2 });
    assert.equal(store.query({ vehicleId: '7001', routeId: '29', now: second, windowDays: 0 }).window.days, 1);
    assert.equal(store.query({ vehicleId: '7001', routeId: '29', now: second, windowDays: 999 }).window.days, 365);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('persists coordinate-free distinct Toronto dates in SQLite across store instances', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'gtha-sightings-'));
  try {
    const first = createVehicleSightingStore({ directory });
    first.observe({ state: 'live', agencyId: 'ttc', vehicles: [{ id: '7001', routeId: '29', timestamp: '2026-09-05T01:00:00Z', stale: false, latitude: 43.7, longitude: -79.4 }] }, { now: Date.parse('2026-09-05T01:00:00Z') });
    first.close();
    const second = createVehicleSightingStore({ directory });
    try {
      const result = second.query({ vehicleId: '7001', routeId: '29', now: NOW });
      assert.deepEqual(result.sample, { vehicleRouteDays: 1, routeObservedDays: 1 });
      assert.equal(result.eligible, false);
    } finally { second.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('rarity thresholds are inclusive at their named boundaries', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'gtha-sightings-')); const store = createVehicleSightingStore({ directory });
  try {
    for (let index = 0; index < 100; index += 1) { const timestamp = new Date(Date.parse('2026-05-29T16:00:00Z') + index * 86400000).toISOString(); const vehicles = [{ id: 'witness', routeId: '1', timestamp, stale: false }]; if (index < 1) vehicles.push({ id: 'omega', routeId: '1', timestamp, stale: false }); if (index < 5) vehicles.push({ id: 'legendary', routeId: '1', timestamp, stale: false }); if (index < 15) vehicles.push({ id: 'epic', routeId: '1', timestamp, stale: false }); if (index < 35) vehicles.push({ id: 'rare', routeId: '1', timestamp, stale: false }); if (index < 65) vehicles.push({ id: 'uncommon', routeId: '1', timestamp, stale: false }); store.observe({ state: 'live', agencyId: 'ttc', vehicles }, { now: Date.parse(timestamp) }); }
    const query = (vehicleId) => store.query({ vehicleId, routeId: '1', now: Date.parse('2026-09-05T20:00:00Z'), windowDays: 100 }).rarity; assert.equal(query('omega'), 'Omega'); assert.equal(query('legendary'), 'Legendary'); assert.equal(query('epic'), 'Epic'); assert.equal(query('rare'), 'Rare'); assert.equal(query('uncommon'), 'Uncommon'); assert.equal(query('witness'), 'Common');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
