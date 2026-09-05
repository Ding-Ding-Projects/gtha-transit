import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ZONE = 'America/Toronto';
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const torontoDay = (value) => dayFormatter.format(new Date(value));
const timestampMs = (value) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value * 1000;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};
const calendarDaysAgo = (torontoDate, days) => {
  const [year, month, date] = torontoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date - days)).toISOString().slice(0, 10);
};
const rarityName = (percentage) => percentage <= 1 ? 'Omega' : percentage <= 5 ? 'Legendary' : percentage <= 15 ? 'Epic' : percentage <= 35 ? 'Rare' : percentage <= 65 ? 'Uncommon' : 'Common';

export function createVehicleSightingStore({ directory }) {
  if (!directory) throw new Error('Vehicle sighting directory is required.');
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'vehicle-sightings.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS sightings (
    vehicle_id TEXT NOT NULL, route_id TEXT NOT NULL, toronto_day TEXT NOT NULL, observed_at TEXT NOT NULL,
    PRIMARY KEY(vehicle_id, route_id, toronto_day)
  ); CREATE INDEX IF NOT EXISTS sightings_route_day ON sightings(route_id, toronto_day);`);
  const insert = db.prepare('INSERT OR IGNORE INTO sightings(vehicle_id,route_id,toronto_day,observed_at) VALUES(?,?,?,?)');
  function observe(snapshot, { now = Date.now() } = {}) {
    if (snapshot?.state !== 'live' || snapshot?.agencyId !== 'ttc') return { observed: false, reason: 'snapshot-not-live-ttc', count: 0 };
    let count = 0; db.exec('BEGIN IMMEDIATE');
    try { for (const vehicle of snapshot.vehicles ?? []) { const observedAt = timestampMs(vehicle?.timestamp); if (vehicle.stale || !vehicle?.id || !vehicle?.routeId || !Number.isFinite(observedAt) || observedAt > now || now - observedAt > 120_000) continue; const result = insert.run(String(vehicle.id), String(vehicle.routeId), torontoDay(observedAt), new Date(observedAt).toISOString()); count += Number(result.changes); } db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    return { observed: true, count };
  }
  function query({ vehicleId, routeId, now = Date.now(), windowDays = 30 } = {}) {
    if (!vehicleId || !routeId) throw new Error('Vehicle and route identifiers are required.');
    if (!Number.isFinite(now)) throw new Error('Current time is invalid.');
    const requestedDays = Number(windowDays); const safeDays = Math.min(365, Math.max(1, Number.isFinite(requestedDays) ? Math.trunc(requestedDays) : 30)); const end = torontoDay(now); const start = calendarDaysAgo(end, safeDays - 1);
    const routeDays = Number(db.prepare('SELECT count(DISTINCT toronto_day) AS count FROM sightings WHERE route_id=? AND toronto_day BETWEEN ? AND ?').get(String(routeId), start, end).count);
    const vehicleRouteDays = Number(db.prepare('SELECT count(DISTINCT toronto_day) AS count FROM sightings WHERE vehicle_id=? AND route_id=? AND toronto_day BETWEEN ? AND ?').get(String(vehicleId), String(routeId), start, end).count);
    const percentage = routeDays ? vehicleRouteDays / routeDays * 100 : null; const eligible = routeDays >= 7;
    return { label: 'Observed frequency', vehicleId: String(vehicleId), routeId: String(routeId), window: { timeZone: ZONE, start, end, days: safeDays }, sample: { vehicleRouteDays, routeObservedDays: routeDays }, percentage, eligible, rarity: eligible ? rarityName(percentage) : null, note: 'Historical observations describe recorded frequency and are not a prediction of a future assignment.' };
  }
  function close() { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } finally { db.close(); } }
  return { observe, query, close };
}
