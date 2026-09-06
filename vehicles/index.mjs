import { readFile } from 'node:fs/promises';
import { matchCptdb, matchVehiclePhoto } from './fleet-registry.mjs';

export const TTC_VEHICLES_URL = 'https://bustime.ttc.ca/gtfsrt/vehicles';
export const VEHICLE_FEEDS = Object.freeze({
  ttc: { name: 'Toronto Transit Commission', url: TTC_VEHICLES_URL },
  miway: { name: 'MiWay', url: 'https://www.miapp.ca/GTFS_RT/Vehicle/VehiclePositions.pb' },
  burlington: { name: 'Burlington Transit', url: 'https://opendata.burlington.ca/gtfs-rt/GTFS_VehiclePositions.pb' },
  hsr: { name: 'Hamilton Street Railway', url: 'https://opendata.hamilton.ca/GTFS-RT/GTFS_VehiclePositions.pb' },
  go: { name: 'GO Transit', url: 'https://api.openmetrolinx.com/OpenDataAPI/api/V1/Gtfs/Feed/VehiclePosition', proxyAgency: 'go' },
  up: { name: 'UP Express', url: 'https://api.openmetrolinx.com/OpenDataAPI/api/V1/UP/Gtfs/Feed/VehiclePosition', proxyAgency: 'up' },
});
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ENTITIES = 10_000;
const CACHE_MS = 15_000;
const STALE_MS = 120_000;
const cache = new Map();

function parseFields(bytes) {
  const fields = []; let offset = 0;
  const varint = () => { let value = 0n; for (let shift = 0n; shift <= 63n && offset < bytes.length; shift += 7n) { const byte = bytes[offset++]; value |= BigInt(byte & 0x7f) << shift; if (!(byte & 0x80)) return value; } throw new Error('Malformed protobuf varint.'); };
  while (offset < bytes.length) {
    const key = Number(varint()); const number = key >>> 3; const wire = key & 7;
    if (!number || wire === 4) throw new Error('Malformed protobuf field.');
    if (wire === 0) fields.push([number, varint(), wire]);
    else if (wire === 1) { if (offset + 8 > bytes.length) throw new Error('Malformed protobuf fixed64.'); fields.push([number, bytes.subarray(offset, offset + 8), wire]); offset += 8; }
    else if (wire === 2) { const length = Number(varint()); if (!Number.isSafeInteger(length) || offset + length > bytes.length) throw new Error('Malformed protobuf length.'); fields.push([number, bytes.subarray(offset, offset + length), wire]); offset += length; }
    else if (wire === 5) { if (offset + 4 > bytes.length) throw new Error('Malformed protobuf fixed32.'); fields.push([number, bytes.subarray(offset, offset + 4), wire]); offset += 4; }
    else throw new Error(`Unsupported protobuf wire type ${wire}.`);
  }
  return fields;
}
const first = (fields, number) => fields.find(([field]) => field === number)?.[1];
const many = (fields, number) => fields.filter(([field]) => field === number).map(([, value]) => value);
const text = (value) => value ? new TextDecoder('utf-8', { fatal: true }).decode(value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 256) : '';
const float = (value) => value ? new DataView(value.buffer, value.byteOffset, 4).getFloat32(0, true) : undefined;
const iso = (seconds) => Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : undefined;
const MAX_UINT32 = 0xffffffff;
const VEHICLE_STOP_STATUS = Object.freeze({ INCOMING_AT: 0, STOPPED_AT: 1, IN_TRANSIT_TO: 2 });

function uint32(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= MAX_UINT32 ? number : null;
}

function publisherStopStatus(stopId, currentStopSequence, currentStatus) {
  if (!stopId || currentStopSequence === null) return 'unavailable';
  if (currentStatus === VEHICLE_STOP_STATUS.INCOMING_AT) return 'approaching';
  if (currentStatus === VEHICLE_STOP_STATUS.STOPPED_AT) return 'stopped-at';
  if (currentStatus === VEHICLE_STOP_STATUS.IN_TRANSIT_TO) return 'next';
  return 'unavailable';
}

function parseVehiclePosition(bytes, entityId, now, { agencyId, agencyName }) {
  const fields = parseFields(bytes); const trip = parseFields(first(fields, 1) ?? new Uint8Array()); const position = parseFields(first(fields, 2) ?? new Uint8Array()); const descriptor = parseFields(first(fields, 8) ?? new Uint8Array());
  const id = text(first(descriptor, 1)) || entityId; const label = text(first(descriptor, 2)) || id; const timestampSeconds = Number(first(fields, 5) ?? 0n);
  const lat = float(first(position, 1)); const lon = float(first(position, 2));
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const bearingValue = float(first(position, 3)); const speedValue = float(first(position, 5)); const timestamp = iso(timestampSeconds);
  const stopId = text(first(fields, 7)) || null; const currentStopSequence = uint32(first(fields, 3)); const rawCurrentStatus = first(fields, 4); const currentStatus = rawCurrentStatus === undefined ? VEHICLE_STOP_STATUS.IN_TRANSIT_TO : uint32(rawCurrentStatus);
  const stopStatus = publisherStopStatus(stopId, currentStopSequence, currentStatus); const nextStopId = stopStatus === 'next' || stopStatus === 'approaching' ? stopId : null;
  const cptdb = matchCptdb(id, label, { agencyId, agencyName });
  return {
    id, label, routeId: text(first(trip, 5)), tripId: text(first(trip, 1)), startTime: text(first(trip, 2)) || null, startDate: text(first(trip, 3)) || null, directionId: uint32(first(trip, 6)), lat, lon,
    bearing: Number.isFinite(bearingValue) ? bearingValue : null,
    speedKph: Number.isFinite(speedValue) && speedValue >= 0 ? speedValue * 3.6 : null,
    timestamp: timestamp ?? null, stale: !timestamp || now - timestampSeconds * 1000 > STALE_MS || timestampSeconds * 1000 - now > 60_000,
    agencyId, fleetNumber: cptdb.displayFleetNumber, licensePlate: text(first(descriptor, 3)) || null, stopId, currentStopSequence, currentStatus, stopStatus, nextStopId, cptdb, photo: matchVehiclePhoto(cptdb.displayFleetNumber || id, cptdb, agencyId),
  };
}

export function parseVehicleFeed(bytes, { fetchedAt = new Date().toISOString(), now = Date.now(), agencyId = 'ttc', sourceUrl = VEHICLE_FEEDS[agencyId]?.url, agencyName = VEHICLE_FEEDS[agencyId]?.name ?? agencyId } = {}) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > MAX_BYTES) throw new Error('TTC vehicle payload is empty or exceeds the 10 MiB safety bound.');
  const root = parseFields(bytes); const header = parseFields(first(root, 1) ?? new Uint8Array()); const version = text(first(header, 1)); const sourceSeconds = Number(first(header, 3) ?? 0n); const entities = many(root, 2);
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(version) || !sourceSeconds) throw new Error('TTC vehicle feed header is incomplete.');
  if (entities.length > MAX_ENTITIES) throw new Error('TTC vehicle entity count exceeds 10000.');
  const vehicles = entities.map((entityBytes) => { const entity = parseFields(entityBytes); const entityId = text(first(entity, 1)); const vehicle = first(entity, 4); return vehicle ? parseVehiclePosition(vehicle, entityId, now, { agencyId, agencyName }) : null; }).filter(Boolean);
  const sourceTimestamp = iso(sourceSeconds); const stale = now - sourceSeconds * 1000 > STALE_MS || sourceSeconds * 1000 - now > 60_000;
  return { state: stale ? 'stale' : 'live', agencyId, fetchedAt, sourceTimestamp, sourceUrl, total: vehicles.length, vehicles };
}

export const parseTtcVehicles = (bytes, options = {}) => parseVehicleFeed(bytes, { ...options, agencyId: 'ttc', sourceUrl: TTC_VEHICLES_URL, agencyName: VEHICLE_FEEDS.ttc.name });

async function readBoundedBody(response) {
  const declared = Number(response.headers?.get?.('content-length') ?? 0); if (declared > MAX_BYTES) throw new Error('TTC vehicle payload exceeds the 10 MiB safety bound.');
  if (!response.body?.getReader) { const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.byteLength > MAX_BYTES) throw new Error('TTC vehicle payload exceeds the 10 MiB safety bound.'); return bytes; }
  const reader = response.body.getReader(); const chunks = []; let total = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > MAX_BYTES) throw new Error('TTC vehicle payload exceeds the 10 MiB safety bound.'); chunks.push(value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
}

export async function getVehicleSnapshot({ agency = 'ttc', fetchImpl = globalThis.fetch, now = Date.now(), timeoutMs = 10_000, fixturePath, force = false, routingOrigin = process.env.ROUTING_ORIGIN } = {}) {
  const feed = VEHICLE_FEEDS[agency]; if (!feed) return { state: 'unavailable', agencyId: agency, fetchedAt: new Date(now).toISOString(), sourceTimestamp: null, sourceUrl: null, total: 0, vehicles: [], error: `Unknown vehicle agency ${agency}.` };
  const prior = cache.get(agency); if (!force && prior && now - prior.receivedAt < CACHE_MS) return prior.value;
  try {
    let bytes;
    if (fixturePath) bytes = new Uint8Array(await readFile(fixturePath));
    else {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), Math.min(Math.max(Number(timeoutMs) || 10_000, 1), 10_000));
      const requestUrl = feed.proxyAgency ? `${String(routingOrigin ?? '').replace(/\/$/, '')}/api/vehicles/metrolinx?agency=${feed.proxyAgency}` : feed.url;
      if (feed.proxyAgency && !routingOrigin) throw new Error(`${feed.name} vehicle positions require the configured routing service.`);
      try { const response = await fetchImpl(requestUrl, { signal: controller.signal, redirect: 'error', headers: { accept: '*/*' } }); if (!response.ok) throw new Error(`${feed.name} vehicle feed returned HTTP ${response.status}.`); bytes = await readBoundedBody(response); } finally { clearTimeout(timer); }
    }
    const value = parseVehicleFeed(bytes, { fetchedAt: new Date(now).toISOString(), now, agencyId: agency, agencyName: feed.name, sourceUrl: feed.url }); cache.set(agency, { receivedAt: now, value }); return value;
  } catch (error) {
    if (prior) return { ...prior.value, state: 'stale', fetchedAt: new Date(now).toISOString(), error: error.message, vehicles: prior.value.vehicles.map((vehicle) => ({ ...vehicle, stale: true })) };
    return { state: 'unavailable', agencyId: agency, fetchedAt: new Date(now).toISOString(), sourceTimestamp: null, sourceUrl: feed.url, total: 0, vehicles: [], error: error.message };
  }
}

export async function getVehicles({ q = '', route = '', limit = 100, cursor = 0, ...options } = {}) {
  const snapshot = options.agency === 'all' ? combineVehicleSnapshots(await getAllVehicleSnapshots(options)) : await getVehicleSnapshot(options); const query = String(q).trim().toLocaleLowerCase(); const routeId = String(route).trim();
  const filtered = snapshot.vehicles.filter((vehicle) => (!routeId || vehicle.routeId === routeId) && (!query || [vehicle.id, vehicle.label, vehicle.routeId, vehicle.cptdb.manufacturer, vehicle.cptdb.model, vehicle.cptdb.year].some((value) => String(value ?? '').toLocaleLowerCase().includes(query))));
  const start = Math.max(0, Number.parseInt(cursor, 10) || 0); const pageLimit = Math.min(2_500, Math.max(1, Number.parseInt(limit, 10) || 100)); const vehicles = filtered.slice(start, start + pageLimit); const nextCursor = start + vehicles.length < filtered.length ? String(start + vehicles.length) : null;
  return { ...snapshot, total: filtered.length, vehicles, nextCursor };
}

export function combineVehicleSnapshots(snapshots) {
  const vehicles = snapshots.flatMap(snapshot => snapshot.vehicles.map(vehicle => ({ ...vehicle, agencyId: snapshot.agencyId, agencyName: VEHICLE_FEEDS[snapshot.agencyId]?.name ?? snapshot.agencyId, vehicleKey: `${snapshot.agencyId}:${vehicle.id}` })));
  return { agencyId: 'all', state: snapshots.every(snapshot => snapshot.state === 'live') ? 'live' : vehicles.length ? 'partial' : 'unavailable', fetchedAt: snapshots.map(snapshot => snapshot.fetchedAt).filter(Boolean).sort().at(-1) ?? null, sourceTimestamp: null, total: vehicles.length, vehicles, agencies: snapshots.map(snapshot => ({ id: snapshot.agencyId, name: VEHICLE_FEEDS[snapshot.agencyId]?.name ?? snapshot.agencyId, state: snapshot.state, total: snapshot.vehicles.length })) };
}

export async function getAllVehicleSnapshots(options = {}) { return Promise.all(Object.keys(VEHICLE_FEEDS).map((agency) => getVehicleSnapshot({ ...options, agency }))); }

const TTC_PUBLIC_FEED_ALIASES = new Set(['ttc', 'ttc-next']);

/** How far before a leg starts, and after it ends, a live position can still identify it. */
const POSITION_LEAD_MS = 20 * 60 * 1000;
const POSITION_TRAIL_MS = 5 * 60 * 1000;
/** How close a published position must be to a stop on the leg to count as being there. */
const POSITION_RADIUS_M = 150;

function vehicleFeedId(value) {
  const feedId = String(value ?? '').split(':')[0].trim().toLowerCase();
  return feedId === 'ttc-next' ? 'ttc' : feedId;
}

const feedIdFromLeg = (leg) => vehicleFeedId(leg?.agencyFeedId ?? leg?.agencyId);

function bareTripId(tripId, feedId) {
  const value = String(tripId ?? '').trim();
  const separator = value.indexOf(':');
  if (separator <= 0) return value;
  const prefix = value.slice(0, separator).toLowerCase();
  const aliases = feedId === 'ttc' ? TTC_PUBLIC_FEED_ALIASES : new Set([feedId]);
  return aliases.has(prefix) ? value.slice(separator + 1) : value;
}

/** Strip only a known feed alias from a qualified identity. */
function bareStopId(stopId, feedId) {
  const value = String(stopId ?? '').trim();
  const separator = value.indexOf(':');
  if (separator <= 0) return value;
  const prefix = value.slice(0, separator).toLowerCase();
  const aliases = feedId === 'ttc' ? TTC_PUBLIC_FEED_ALIASES : new Set([feedId]);
  return aliases.has(prefix) ? value.slice(separator + 1) : value;
}

const EARTH_RADIUS_M = 6371000;
const radians = (degrees) => (degrees * Math.PI) / 180;

/** Great-circle distance in metres between two published coordinates. */
function metresBetween(fromLat, fromLon, toLat, toLon) {
  const dLat = radians(toLat - fromLat);
  const dLon = radians(toLon - fromLon);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(fromLat)) * Math.cos(radians(toLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

const routeCode = (value) => String(value ?? '').trim().toUpperCase();

/** Prefer the feed-qualified route identity, falling back to the short name. */
function legRouteCode(leg, feedId) {
  const qualified = bareStopId(leg?.routeId, feedId);
  return routeCode(qualified || leg?.route);
}

/**
 * Every stop this leg calls at, as published coordinates.
 *
 * Coordinates rather than stop identifiers, deliberately. Measured on
 * 6 September 2026, none of the 192 live TTC vehicles whose reported stop
 * identifier also existed in the loaded timetable was within 300 metres of that
 * timetable's stop: every one of those identifier matches was a number collision
 * between unrelated stops. A published position cannot collide that way.
 */
function legStopPoints(leg) {
  const places = [leg?.from, ...(Array.isArray(leg?.intermediateStops) ? leg.intermediateStops : []), leg?.to];
  const points = [];
  for (const place of places) {
    const lat = Number(place?.lat);
    const lon = Number(place?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) points.push([lat, lon]);
  }
  return points;
}

/**
 * A vehicle is on this leg when the publisher places it at a stop the leg calls
 * at, on the leg's own route, while the leg is running. TTC stop identities are
 * direction-specific, so being at one of these stops also establishes direction.
 * This is never route equality alone.
 */
function positionCandidates(vehicles, leg, feedId, now) {
  const route = legRouteCode(leg, feedId);
  if (!route) return [];
  const points = legStopPoints(leg);
  if (!points.length) return [];
  const start = legTimeMillis(leg?.startTime);
  const end = legTimeMillis(leg?.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  if (now < start - POSITION_LEAD_MS || now > end + POSITION_TRAIL_MS) return [];
  return vehicles.filter((vehicle) => {
    if (vehicle.stale || routeCode(vehicle.routeId) !== route) return false;
    const lat = Number(vehicle.lat);
    const lon = Number(vehicle.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    return points.some(([stopLat, stopLon]) => metresBetween(lat, lon, stopLat, stopLon) <= POSITION_RADIUS_M);
  });
}

function legTimeMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
    return Number.isFinite(milliseconds) && Math.abs(milliseconds) <= 8.64e15 ? milliseconds : Number.NaN;
  }
  const textValue = String(value ?? '').trim();
  if (/^-?\d+(?:\.\d+)?$/.test(textValue)) return legTimeMillis(Number(textValue));
  return Date.parse(textValue);
}

export async function enrichItineraries(itineraries, options = {}) {
  const list = Array.isArray(itineraries) ? itineraries : itineraries?.itineraries;
  if (!Array.isArray(list)) throw new Error('Itineraries must be an array or contain an itineraries array.');
  const agencies = [...new Set(list.flatMap((itinerary) => itinerary.legs ?? []).map(feedIdFromLeg).filter((id) => VEHICLE_FEEDS[id]))];
  const snapshots = new Map((await Promise.all(agencies.map(async (agency) => [agency, await getVehicleSnapshot({ ...options, agency })]))));
  const enriched = list.map((itinerary) => ({ ...itinerary, legs: (itinerary.legs ?? []).map((leg) => {
    const agency = feedIdFromLeg(leg); const tripId = bareTripId(leg.tripId, agency); const snapshot = snapshots.get(agency);
    const start=legTimeMillis(leg.startTime), end=legTimeMillis(leg.endTime), now=options.now??Date.now();
    if (!Number.isFinite(start)||!Number.isFinite(end)||start>end||start>now+7200000||end<now-120000) return { ...leg, vehicleAssignment:{state:'unavailable',reason:'A current vehicle observation cannot identify a distant or completed journey.'} };
    if (!agency || !tripId || !snapshot) return { ...leg, vehicleAssignment: { state: 'unavailable', reason: 'No supported agency and trip identifier were published for this leg.' } };
    if (snapshot.state !== 'live') return { ...leg, vehicleAssignment: { state: snapshot.state, reason: 'Fresh vehicle positions are unavailable for this agency.' } };
    const legRoute = legRouteCode(leg, agency);
    const newest = (list) => [...list].sort((a, b) => Date.parse(b.timestamp ?? 0) - Date.parse(a.timestamp ?? 0));
    const identify = (vehicle) => ({ id: vehicle.id, label: vehicle.label, fleetNumber: vehicle.fleetNumber, agencyId: vehicle.agencyId, timestamp: vehicle.timestamp, cptdb: vehicle.cptdb, photo: vehicle.photo });
    // A trip identifier published on a different route is a number collision, not this vehicle.
    const exact = newest(snapshot.vehicles.filter((vehicle) => !vehicle.stale
      && bareTripId(vehicle.tripId, agency) === tripId
      && (!legRoute || !vehicle.routeId || routeCode(vehicle.routeId) === legRoute)));
    if (exact.length) return { ...leg, vehicle: identify(exact[0]), vehicleAssignment: { state: 'matched', method: 'exact-trip-id' } };
    const onLeg = newest(positionCandidates(snapshot.vehicles, leg, agency, now));
    if (onLeg.length === 1) return { ...leg, vehicle: identify(onLeg[0]), vehicleAssignment: { state: 'matched', method: 'route-and-stop-position', disclosure: 'This publisher does not share a matching trip identifier. One vehicle on this route is reported at a stop on this leg while the leg is running.' } };
    if (onLeg.length > 1) return { ...leg, vehicleAssignment: { state: 'ambiguous', reason: 'Several vehicles on this route are reported at stops on this leg, so the exact one cannot be identified.', candidateCount: onLeg.length } };
    return { ...leg, vehicleAssignment: { state: 'no-match', reason: 'No fresh vehicle position has this exact trip identifier, and none is reported at a stop on this leg.' } };
  }) }));
  return Array.isArray(itineraries) ? enriched : { ...itineraries, itineraries: enriched };
}

export function clearVehicleCache() { cache.clear(); }
