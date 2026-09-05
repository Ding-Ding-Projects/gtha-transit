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

export function classifyOutOfDivision(vehicle, routeId, registry, { now = Date.now() } = {}) {
  const evidence = { source: registry.source, routeId: String(routeId ?? ''), vehicleId: String(vehicle?.id ?? ''), fleetNumber: String(vehicle?.fleetNumber ?? vehicle?.label ?? '') };
  if (day(now) < registry.source.validFrom || day(now) > registry.source.validThrough) return { state: 'unknown', reason: 'allocation-source-expired', ...evidence };
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
