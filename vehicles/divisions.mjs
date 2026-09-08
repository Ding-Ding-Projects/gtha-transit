import { readFile } from 'node:fs/promises';

const TORONTO_ZONE = 'America/Toronto';
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TORONTO_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const day = (value) => {
  const parts = Object.fromEntries(dayFormatter.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const timestampMs = (value) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === 'string' && value.trim()) {
    if (/^\d+(?:\.\d+)?$/.test(value.trim())) return timestampMs(Number(value));
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export async function loadTtcDivisionRegistry(url = new URL('../data/ttc-divisions.json', import.meta.url)) {
  const registry = JSON.parse(await readFile(url, 'utf8'));
  if (registry.schemaVersion !== 1 || !registry.source?.sha256 || !registry.routesByGarage || !Array.isArray(registry.fleetAllocations)) throw new Error('TTC division registry is incomplete.');
  return registry;
}

export function routeGarages(registry, routeId) {
  const route = String(routeId ?? '').replace(/^ttc:/i, '').trim();
  return Object.entries(registry.routesByGarage).filter(([, routes]) => routes.includes(route)).map(([garage]) => garage);
}

/**
 * Whether the published period still covers a day, and which side of it we are on.
 *
 * Before the period starts is a different thing from after it ends. A summary
 * that has not begun describes service nobody is running yet, and using it would
 * be a guess about the future. One that has ended describes the last service the
 * operator published, which is the best available answer until the next summary
 * is out, and garage allocations move slowly enough for that to be worth having.
 */
export function sourceCoverage(registry, now = Date.now()) {
  const today = day(now);
  if (today < registry.source.validFrom) return 'not-yet-in-effect';
  if (today > registry.source.validThrough) return 'last-published';
  return 'current';
}

export function classifyOutOfDivision(vehicle, routeId, registry, { now = Date.now() } = {}) {
  const coverage = sourceCoverage(registry, now);
  const evidence = { source: registry.source, sourceCoverage: coverage, routeId: String(routeId ?? ''), vehicleId: String(vehicle?.id ?? ''), fleetNumber: String(vehicle?.fleetNumber ?? vehicle?.label ?? '') };
  /* A summary that has not started yet cannot say anything about today. One that
     has ended can: it is the last allocation the operator published, and refusing
     to use it left every vehicle unclassified for the whole gap between board
     periods, which reads as "we found nothing" rather than "the answer is a few
     days old". It is carried on every result as sourceCoverage so nothing
     downstream can present it as current. */
  if (coverage === 'not-yet-in-effect') return { state: 'unknown', reason: 'allocation-source-not-yet-in-effect', ...evidence };
  if (!vehicle || vehicle.agencyId !== 'ttc') return { state: 'unknown', reason: 'not-a-fresh-ttc-vehicle', ...evidence };
  const observedAt = timestampMs(vehicle?.timestamp);
  if (vehicle.stale || !Number.isFinite(observedAt) || observedAt > now || now - observedAt > 120_000) return { state: 'unknown', reason: 'not-a-fresh-ttc-vehicle', ...evidence };
  const fleet = Number(String(vehicle.fleetNumber ?? vehicle.label ?? '').trim());
  const allocation = Number.isFinite(fleet) ? registry.fleetAllocations.find((item) => fleet >= item.first && fleet <= item.last) : undefined;
  if (!allocation) return { state: 'unknown', reason: 'fleet-allocation-unavailable', ...evidence };
  const assignedGarages = routeGarages(registry, routeId);
  if (!assignedGarages.length) return { state: 'unknown', reason: 'route-allocation-unavailable', possibleHomeGarages: allocation.garages, ...evidence };
  if (allocation.garages.length !== 1) return { state: 'unknown', reason: 'multi-garage-fleet-allocation', possibleHomeGarages: allocation.garages, assignedGarages, ...evidence };
  const homeGarage = allocation.garages[0];
  return { state: assignedGarages.includes(homeGarage) ? 'in-division' : 'out-of-division', reason: 'single-garage-series-allocation', homeGarage, homeGarageName: registry.garageNames[homeGarage], assignedGarages, assignedGarageNames: assignedGarages.map((garage) => registry.garageNames[garage]), ...evidence };
}

export function classifyVehicleSnapshot(snapshot, registry, options = {}) {
  if (snapshot?.state !== 'live' || snapshot?.agencyId !== 'ttc') return [];
  return snapshot.vehicles.map((vehicle) => ({ vehicle, classification: classifyOutOfDivision(vehicle, vehicle.routeId, registry, options) }));
}

export function getOutOfDivisionVehicles(snapshot, registry, options = {}) { return classifyVehicleSnapshot(snapshot, registry, options).filter((item) => item.classification.state === 'out-of-division'); }
