import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Shadow trip matcher for the TTC realtime feed.
 *
 * The TTC's published TripUpdates carry a route short name, a negative-hash
 * trip_id that never matches the loaded static timetable, and no
 * direction_id/start_time/start_date - so there is no exact join to a static
 * trip. This module matches each live update to a static trip by comparing
 * predicted times against the schedule and then confirming the match against
 * the reporting vehicle's own published position, and only then rewrites the
 * update onto static identifiers. See docs/vehicles/trip-identifiers.md
 * ("Shadow matcher") for the measured numbers behind the thresholds below and
 * for the gate that decides whether this is trustworthy enough to route on.
 *
 * The module is split into a pure half (protobuf codec + matching algorithm,
 * all exported and unit tested against committed fixtures) and an impure half
 * (fetching the live feeds, querying OpenTripPlanner, and serving HTTP), which
 * only runs when this file is executed directly - importing it never starts a
 * server or makes a network call.
 */

export const TTC_TRIPS_URL = "https://bustime.ttc.ca/gtfsrt/trips";
export const TTC_VEHICLES_URL = "https://bustime.ttc.ca/gtfsrt/vehicles";
const USER_AGENT = "GTHATransitRealtimeMatcher/1.0";
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ENTITIES = 10_000;
const FETCH_DEADLINE_MS = 8_000;

function envInt(name, fallback) { const raw = Number(process.env[name]); return Number.isFinite(raw) && raw > 0 ? raw : fallback; }
function envNumber(name, fallback) { const raw = Number(process.env[name]); return Number.isFinite(raw) ? raw : fallback; }

const OTP_URL = process.env.OTP_URL ?? "http://otp:8080";
const POLL_MS = envInt("POLL_MS", 30_000);
const TTC_MATCHER_PORT = envInt("TTC_MATCHER_PORT", 8790);
/** How far the live feed's stop_sequence numbering is shifted from the static
 * stopPosition numbering. Defaults to no shift; see "Sequence alignment" in
 * docs/vehicles/trip-identifiers.md for how this is measured in practice. */
const SEQUENCE_OFFSET = envNumber("SEQUENCE_OFFSET", 0);
const FEED_IDS = (process.env.TTC_FEED_IDS ?? process.env.TTC_FEED_ID ?? "ttc-next").split(",").map((id) => id.trim()).filter(Boolean);
const FAIL_SAFE_HOLD_MS = 120_000;
const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;

// --- Protobuf decode primitives -------------------------------------------
// Ported from vehicles/index.mjs's parseFields/first/many/text/float (this
// backend image cannot import vehicles/), plus a signed-varint reader that
// module never needed: StopTimeEvent.delay is a real int32 and can be
// negative, encoded as a ten-byte varint carrying the 64-bit two's-complement
// value.

function parseFields(bytes) {
  const fields = []; let offset = 0;
  const varint = () => { let value = 0n; for (let shift = 0n; shift <= 63n && offset < bytes.length; shift += 7n) { const byte = bytes[offset++]; value |= BigInt(byte & 0x7f) << shift; if (!(byte & 0x80)) return value; } throw new Error("Malformed protobuf varint."); };
  while (offset < bytes.length) {
    const key = Number(varint()); const number = key >>> 3; const wire = key & 7;
    if (!number || wire === 4) throw new Error("Malformed protobuf field.");
    if (wire === 0) fields.push([number, varint(), wire]);
    else if (wire === 1) { if (offset + 8 > bytes.length) throw new Error("Malformed protobuf fixed64."); fields.push([number, bytes.subarray(offset, offset + 8), wire]); offset += 8; }
    else if (wire === 2) { const length = Number(varint()); if (!Number.isSafeInteger(length) || offset + length > bytes.length) throw new Error("Malformed protobuf length."); fields.push([number, bytes.subarray(offset, offset + length), wire]); offset += length; }
    else if (wire === 5) { if (offset + 4 > bytes.length) throw new Error("Malformed protobuf fixed32."); fields.push([number, bytes.subarray(offset, offset + 4), wire]); offset += 4; }
    else throw new Error(`Unsupported protobuf wire type ${wire}.`);
  }
  return fields;
}
const first = (fields, number) => fields.find(([field]) => field === number)?.[1];
const many = (fields, number) => fields.filter(([field]) => field === number).map(([, value]) => value);
/**
 * Decode a length-delimited field as trimmed, bounded text with ASCII control
 * characters (with codepoints below the printable range, plus DEL) removed.
 * Written as an explicit codepoint filter rather than a
 * control-character regex range so the source never has to spell out a raw
 * control-character escape sequence.
 */
function text(value) {
  if (!value) return "";
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(value);
  let out = "";
  for (const ch of decoded) { const code = ch.codePointAt(0); if (code >= 32 && code !== 127) out += ch; }
  return out.trim().slice(0, 256);
}
const float = (value) => value ? new DataView(value.buffer, value.byteOffset, 4).getFloat32(0, true) : undefined;
const MAX_UINT32 = 0xffffffff;
function uint32(value) { const number = Number(value); return Number.isSafeInteger(number) && number >= 0 && number <= MAX_UINT32 ? number : null; }
function svarint(value) { if (value === undefined) return null; const signed = value >= (1n << 63n) ? value - (1n << 64n) : value; return Number(signed); }

// --- Protobuf encode primitives --------------------------------------------

function encodeVarint(input) {
  let value = typeof input === "bigint" ? input : BigInt(Math.trunc(Number(input)));
  if (value < 0n) value += 1n << 64n;
  const bytes = [];
  do { let byte = Number(value & 0x7fn); value >>= 7n; if (value !== 0n) byte |= 0x80; bytes.push(byte); } while (value !== 0n);
  return Uint8Array.from(bytes);
}
function concatBytes(parts) {
  let total = 0; for (const part of parts) total += part.length;
  const out = new Uint8Array(total); let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
const encodeTag = (fieldNumber, wireType) => encodeVarint((fieldNumber << 3) | wireType);
const encodeLengthDelimited = (fieldNumber, bytes) => concatBytes([encodeTag(fieldNumber, 2), encodeVarint(bytes.length), bytes]);
const encodeVarintField = (fieldNumber, value) => concatBytes([encodeTag(fieldNumber, 0), encodeVarint(value)]);
const encodeStringField = (fieldNumber, value) => encodeLengthDelimited(fieldNumber, new TextEncoder().encode(value));
function encodeFixed32Field(fieldNumber, floatValue) { const buf = new Uint8Array(4); new DataView(buf.buffer).setFloat32(0, floatValue, true); return concatBytes([encodeTag(fieldNumber, 5), buf]); }

// --- decodeFeed -------------------------------------------------------------
// Field numbers below are the standard gtfs-realtime.proto layout, confirmed
// against the wire this project already reads in vehicles/index.mjs.

function decodeTripDescriptor(fields) {
  return {
    tripId: text(first(fields, 1)) || null,
    startTime: text(first(fields, 2)) || null,
    startDate: text(first(fields, 3)) || null,
    scheduleRelationship: uint32(first(fields, 4)),
    routeId: text(first(fields, 5)) || null,
    directionId: uint32(first(fields, 6)),
  };
}
function decodeVehicleDescriptor(fields) {
  return { id: text(first(fields, 1)) || null, label: text(first(fields, 2)) || null, licensePlate: text(first(fields, 3)) || null };
}
function decodeStopTimeEvent(fields) { return { delay: svarint(first(fields, 1)), time: svarint(first(fields, 2)) }; }
function decodeStopTimeUpdate(bytes) {
  const fields = parseFields(bytes);
  const arrivalBytes = first(fields, 2); const departureBytes = first(fields, 3);
  return {
    stopSequence: uint32(first(fields, 1)),
    arrival: arrivalBytes ? decodeStopTimeEvent(parseFields(arrivalBytes)) : null,
    departure: departureBytes ? decodeStopTimeEvent(parseFields(departureBytes)) : null,
    stopId: text(first(fields, 4)) || null,
  };
}
function decodeTripUpdate(id, fields) {
  const tripBytes = first(fields, 1); const vehicleBytes = first(fields, 3);
  return {
    id,
    trip: decodeTripDescriptor(parseFields(tripBytes ?? new Uint8Array())),
    vehicle: vehicleBytes ? decodeVehicleDescriptor(parseFields(vehicleBytes)) : null,
    stopTimeUpdate: many(fields, 2).map(decodeStopTimeUpdate),
    timestamp: svarint(first(fields, 4)),
  };
}
function decodeVehiclePosition(id, fields) {
  const tripBytes = first(fields, 1); const vehicleBytes = first(fields, 8);
  const positionFields = parseFields(first(fields, 2) ?? new Uint8Array());
  return {
    id,
    trip: tripBytes ? decodeTripDescriptor(parseFields(tripBytes)) : null,
    vehicle: vehicleBytes ? decodeVehicleDescriptor(parseFields(vehicleBytes)) : null,
    position: { latitude: float(first(positionFields, 1)) ?? null, longitude: float(first(positionFields, 2)) ?? null, bearing: float(first(positionFields, 3)) ?? null },
    currentStopSequence: uint32(first(fields, 3)),
    currentStatus: uint32(first(fields, 4)),
    stopId: text(first(fields, 7)) || null,
    timestamp: svarint(first(fields, 5)),
  };
}

/** Decode a GTFS-Realtime FeedMessage into `{ header, tripUpdates, vehiclePositions }`. */
export function decodeFeed(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new Error("GTFS-Realtime payload is empty.");
  if (bytes.byteLength > MAX_BYTES) throw new Error("GTFS-Realtime payload exceeds the 10 MiB safety bound.");
  const root = parseFields(bytes);
  const headerFields = parseFields(first(root, 1) ?? new Uint8Array());
  const header = { gtfsRealtimeVersion: text(first(headerFields, 1)) || null, incrementality: uint32(first(headerFields, 2)), timestamp: svarint(first(headerFields, 3)) };
  const entities = many(root, 2);
  if (entities.length > MAX_ENTITIES) throw new Error(`GTFS-Realtime entity count exceeds ${MAX_ENTITIES}.`);
  const tripUpdates = []; const vehiclePositions = [];
  for (const entityBytes of entities) {
    const entity = parseFields(entityBytes);
    const id = text(first(entity, 1));
    const tuBytes = first(entity, 3); const vpBytes = first(entity, 4);
    if (tuBytes) tripUpdates.push(decodeTripUpdate(id, parseFields(tuBytes)));
    if (vpBytes) vehiclePositions.push(decodeVehiclePosition(id, parseFields(vpBytes)));
  }
  return { header, tripUpdates, vehiclePositions };
}

// --- encodeFeed --------------------------------------------------------------
// The inverse of decodeFeed, using the same field numbers. Every optional
// field is written only when present so that encode(decode(encode(x))) is
// byte-identical to encode(x) - the round trip a lossless codec has to prove.

function encodeTripDescriptor(trip) {
  if (!trip) return new Uint8Array();
  const parts = [];
  if (trip.tripId) parts.push(encodeStringField(1, trip.tripId));
  if (trip.startTime) parts.push(encodeStringField(2, trip.startTime));
  if (trip.startDate) parts.push(encodeStringField(3, trip.startDate));
  if (trip.scheduleRelationship !== undefined && trip.scheduleRelationship !== null) parts.push(encodeVarintField(4, trip.scheduleRelationship));
  if (trip.routeId) parts.push(encodeStringField(5, trip.routeId));
  if (trip.directionId !== undefined && trip.directionId !== null) parts.push(encodeVarintField(6, trip.directionId));
  return concatBytes(parts);
}
function encodeVehicleDescriptor(vehicle) {
  if (!vehicle) return new Uint8Array();
  const parts = [];
  if (vehicle.id) parts.push(encodeStringField(1, vehicle.id));
  if (vehicle.label) parts.push(encodeStringField(2, vehicle.label));
  if (vehicle.licensePlate) parts.push(encodeStringField(3, vehicle.licensePlate));
  return concatBytes(parts);
}
function encodeStopTimeEvent(event) {
  const parts = [];
  if (event?.delay !== undefined && event?.delay !== null) parts.push(encodeVarintField(1, event.delay));
  if (event?.time !== undefined && event?.time !== null) parts.push(encodeVarintField(2, event.time));
  return concatBytes(parts);
}
function encodeStopTimeUpdate(update) {
  const parts = [];
  if (update.stopSequence !== undefined && update.stopSequence !== null) parts.push(encodeVarintField(1, update.stopSequence));
  if (update.arrival) parts.push(encodeLengthDelimited(2, encodeStopTimeEvent(update.arrival)));
  if (update.departure) parts.push(encodeLengthDelimited(3, encodeStopTimeEvent(update.departure)));
  if (update.stopId) parts.push(encodeStringField(4, update.stopId));
  return concatBytes(parts);
}
function encodeTripUpdateBody(tripUpdate) {
  const parts = [encodeLengthDelimited(1, encodeTripDescriptor(tripUpdate.trip))];
  for (const update of tripUpdate.stopTimeUpdate ?? []) parts.push(encodeLengthDelimited(2, encodeStopTimeUpdate(update)));
  if (tripUpdate.vehicle) parts.push(encodeLengthDelimited(3, encodeVehicleDescriptor(tripUpdate.vehicle)));
  if (tripUpdate.timestamp !== undefined && tripUpdate.timestamp !== null) parts.push(encodeVarintField(4, tripUpdate.timestamp));
  return concatBytes(parts);
}
function encodeVehiclePositionBody(vehiclePosition) {
  const parts = [];
  if (vehiclePosition.trip) parts.push(encodeLengthDelimited(1, encodeTripDescriptor(vehiclePosition.trip)));
  const position = vehiclePosition.position ?? {};
  const positionParts = [];
  if (Number.isFinite(position.latitude)) positionParts.push(encodeFixed32Field(1, position.latitude));
  if (Number.isFinite(position.longitude)) positionParts.push(encodeFixed32Field(2, position.longitude));
  if (Number.isFinite(position.bearing)) positionParts.push(encodeFixed32Field(3, position.bearing));
  if (positionParts.length) parts.push(encodeLengthDelimited(2, concatBytes(positionParts)));
  if (vehiclePosition.currentStopSequence !== undefined && vehiclePosition.currentStopSequence !== null) parts.push(encodeVarintField(3, vehiclePosition.currentStopSequence));
  if (vehiclePosition.currentStatus !== undefined && vehiclePosition.currentStatus !== null) parts.push(encodeVarintField(4, vehiclePosition.currentStatus));
  if (vehiclePosition.timestamp !== undefined && vehiclePosition.timestamp !== null) parts.push(encodeVarintField(5, vehiclePosition.timestamp));
  if (vehiclePosition.stopId) parts.push(encodeStringField(7, vehiclePosition.stopId));
  if (vehiclePosition.vehicle) parts.push(encodeLengthDelimited(8, encodeVehicleDescriptor(vehiclePosition.vehicle)));
  return concatBytes(parts);
}
const encodeEntity = (id, innerFieldNumber, innerBytes) => concatBytes([encodeStringField(1, id ?? ""), encodeLengthDelimited(innerFieldNumber, innerBytes)]);

/** Encode `{ header, tripUpdates, vehiclePositions }` into a GTFS-Realtime FeedMessage. */
export function encodeFeed({ header = {}, tripUpdates = [], vehiclePositions = [] } = {}) {
  const headerBytes = concatBytes([
    encodeStringField(1, header.gtfsRealtimeVersion ?? "2.0"),
    encodeVarintField(2, header.incrementality ?? 0),
    encodeVarintField(3, header.timestamp ?? Math.floor(Date.now() / 1_000)),
  ]);
  const entities = [];
  for (const tripUpdate of tripUpdates) entities.push(encodeLengthDelimited(2, encodeEntity(tripUpdate.id, 3, encodeTripUpdateBody(tripUpdate))));
  for (const vehiclePosition of vehiclePositions) entities.push(encodeLengthDelimited(2, encodeEntity(vehiclePosition.id, 4, encodeVehiclePositionBody(vehiclePosition))));
  return concatBytes([encodeLengthDelimited(1, headerBytes), ...entities]);
}

// --- Matching algorithm ------------------------------------------------------

export const DEFAULT_THRESHOLDS = Object.freeze({ uniqueMin: 0.6, contradictedMax: 0.02, alignmentMin: 0.98 });
const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres between `{lat,lon}` points. */
export function haversineMetres(a, b) {
  if (![a?.lat, a?.lon, b?.lat, b?.lon].every(Number.isFinite)) return Infinity;
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians; const dLon = (b.lon - a.lon) * radians;
  const h = Math.min(1, Math.max(0, Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLon / 2) ** 2));
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Strip a feed-scoped id's `feed:` prefix, as OTP's updater adds it back on output. */
export function stripFeedPrefix(id) {
  if (typeof id !== "string") return id ?? null;
  const separator = id.indexOf(":");
  return separator > 0 ? id.slice(separator + 1) : id;
}

function numberOr(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function predictedTime(update) { const arrival = numberOr(update?.arrival?.time, null); return arrival !== null ? arrival : numberOr(update?.departure?.time, null); }

/**
 * Mean absolute and mean signed prediction error for one candidate trip, over
 * the first three of the update's stop-time updates whose sequence (after
 * `sequenceOffset`) exists on that trip. The signed mean doubles as the
 * running-early/late correction used by `expectedPositionNow`: a trip that is
 * uniformly 45 seconds late should be expected 45 seconds late at its next
 * stop too, not exactly on schedule.
 */
function scoreTrip(trip, updates, sequenceOffset) {
  const deltas = []; const signed = [];
  for (const update of updates) {
    if (deltas.length >= 3) break;
    const seq = numberOr(update?.stopSequence, null); if (seq === null) continue;
    const predicted = predictedTime(update); if (predicted === null) continue;
    const stop = trip.stops.find((candidate) => candidate.seq === seq + sequenceOffset); if (!stop) continue;
    deltas.push(Math.abs(predicted - stop.scheduledAt));
    signed.push(predicted - stop.scheduledAt);
  }
  const matchedCount = deltas.length;
  return {
    trip, matchedCount,
    score: matchedCount ? deltas.reduce((a, b) => a + b, 0) / matchedCount : Infinity,
    signedDelay: matchedCount ? signed.reduce((a, b) => a + b, 0) / matchedCount : 0,
  };
}

/** The stop on `trip` whose delay-adjusted scheduled time is nearest `nowSeconds`. */
function expectedPositionNow(trip, signedDelay, nowSeconds) {
  let best = null; let bestDiff = Infinity;
  for (const stop of trip.stops) {
    const diff = Math.abs(stop.scheduledAt + signedDelay - nowSeconds);
    if (diff < bestDiff) { bestDiff = diff; best = stop; }
  }
  return best;
}

function buildStopMappings(trip, updates, sequenceOffset) {
  const mappings = [];
  for (const update of updates) {
    const seq = numberOr(update?.stopSequence, null); if (seq === null) continue;
    const predicted = predictedTime(update); if (predicted === null) continue;
    const stop = trip.stops.find((candidate) => candidate.seq === seq + sequenceOffset); if (!stop) continue;
    mappings.push({ sequence: seq, stopId: stripFeedPrefix(stop.stopId), time: predicted });
  }
  return mappings;
}

function lookupVehicle(vehiclesById, id) {
  if (!id || !vehiclesById) return null;
  if (vehiclesById instanceof Map) return vehiclesById.get(id) ?? null;
  return vehiclesById[id] ?? null;
}
function vehicleLatLon(vehicle) {
  const lat = numberOr(vehicle?.position?.latitude ?? vehicle?.latitude, null);
  const lon = numberOr(vehicle?.position?.longitude ?? vehicle?.longitude, null);
  return lat !== null && lon !== null ? { lat, lon } : null;
}
const emptyMatch = (routeShortName) => ({ classification: null, routeShortName, matchedTripId: null, matchedRouteId: null, score: null, runnerUpScore: null, stopMappings: null, vehicleDistanceMetres: null });

/**
 * Classify one live TripUpdate against the static schedule loaded for its
 * route. `staticIndex` is `{ serviceDate, routes: { [shortName]: [{ gtfsId,
 * routeGtfsId, stops: [{ seq, stopId, lat, lon, scheduledAt }] }] } }`.
 * `vehiclesById` is a Map or plain object of vehicle id to the vehicle's
 * latest decoded VehiclePosition. Returns one of six mutually exclusive
 * classifications - unique, ambiguous, none, contradicted, unverified,
 * sequence-misaligned - documented in docs/vehicles/trip-identifiers.md.
 */
export function matchUpdate(tripUpdate, staticIndex, vehiclesById, options = {}) {
  const now = options.now ?? Date.now();
  const sequenceOffset = options.sequenceOffset ?? 0;
  const matchWindowS = options.matchWindowS ?? 3_600;
  const uniqueMaxS = options.uniqueMaxS ?? 300;
  const uniqueMarginS = options.uniqueMarginS ?? 300;
  const vehicleFreshMs = options.vehicleFreshMs ?? 120_000;
  const positionToleranceM = options.positionToleranceM ?? 300;

  const routeShortName = tripUpdate?.trip?.routeId || null;
  const base = emptyMatch(routeShortName);
  const updates = Array.isArray(tripUpdate?.stopTimeUpdate) ? tripUpdate.stopTimeUpdate : [];
  if (!routeShortName || !updates.length) return { ...base, classification: "none" };

  const candidates = staticIndex?.routes?.[routeShortName] ?? [];
  // A route the static index does not contain is an ordinary no-match.  It
  // cannot prove a sequence-offset defect because there is no sequence list
  // to compare.  Reserving `sequence-misaligned` for a known route makes the
  // activation statistic actionable instead of inflating it with missing data.
  if (!candidates.length) return { ...base, classification: "none" };
  const firstUpdate = updates[0];
  const firstSeq = numberOr(firstUpdate?.stopSequence, null);
  if (firstSeq === null) return { ...base, classification: "none" };
  const alignedFirstSeq = firstSeq + sequenceOffset;

  // Checked before the time window, and against every candidate on the
  // route regardless of schedule: a sequence numbering mismatch (the wrong
  // SEQUENCE_OFFSET) means no candidate anywhere carries this position, no
  // matter how close its times are.
  const hasSequenceAnywhere = candidates.some((trip) => trip.stops.some((stop) => stop.seq === alignedFirstSeq));
  if (!hasSequenceAnywhere) return { ...base, classification: "sequence-misaligned" };

  const firstPredicted = predictedTime(firstUpdate);
  if (firstPredicted === null) return { ...base, classification: "none" };

  const windowed = candidates.filter((trip) => trip.stops.some((stop) => stop.seq === alignedFirstSeq && Math.abs(stop.scheduledAt - firstPredicted) <= matchWindowS));
  if (!windowed.length) return { ...base, classification: "none" };

  const scored = windowed.map((trip) => scoreTrip(trip, updates, sequenceOffset)).filter((entry) => entry.matchedCount > 0).sort((a, b) => a.score - b.score);
  if (!scored.length) return { ...base, classification: "none" };

  const best = scored[0]; const runnerUp = scored[1] ?? null;
  const diagnostics = { matchedTripId: stripFeedPrefix(best.trip.gtfsId), matchedRouteId: stripFeedPrefix(best.trip.routeGtfsId), score: best.score, runnerUpScore: runnerUp?.score ?? null };
  const isUnique = best.score <= uniqueMaxS && (runnerUp === null || runnerUp.score - best.score >= uniqueMarginS);
  if (!isUnique) return { ...base, ...diagnostics, classification: "ambiguous" };

  // A match that scores as unique still needs the reporting vehicle to be
  // where that trip should be right now before it is trusted; without a
  // fresh vehicle position there is nothing to confirm it against.
  const vehicle = lookupVehicle(vehiclesById, tripUpdate?.vehicle?.id ?? null);
  const vehicleTimestampMs = vehicle ? numberOr(vehicle.timestamp, null) : null;
  const vehicleFresh = Boolean(vehicle) && vehicleTimestampMs !== null && Math.abs(now - vehicleTimestampMs * 1_000) <= vehicleFreshMs;
  if (!vehicleFresh) return { ...base, ...diagnostics, classification: "unverified" };

  const expectedStop = expectedPositionNow(best.trip, best.signedDelay, now / 1_000);
  const vehiclePosition = vehicleLatLon(vehicle);
  const distance = expectedStop && vehiclePosition ? haversineMetres({ lat: expectedStop.lat, lon: expectedStop.lon }, vehiclePosition) : Infinity;
  if (!(distance <= positionToleranceM)) return { ...base, ...diagnostics, vehicleDistanceMetres: Number.isFinite(distance) ? distance : null, classification: "contradicted" };

  return { ...base, ...diagnostics, vehicleDistanceMetres: distance, stopMappings: buildStopMappings(best.trip, updates, sequenceOffset), classification: "unique" };
}

const CLASSIFICATION_KEYS = Object.freeze({ unique: "unique", ambiguous: "ambiguous", none: "none", contradicted: "contradicted", unverified: "unverified", "sequence-misaligned": "sequenceMisaligned" });

/** Run `matchUpdate` over a batch, building its own vehicle-id index from a plain array. */
export function classifyBatch(tripUpdates, staticIndex, vehiclePositions, options = {}) {
  const vehiclesById = new Map();
  for (const vehiclePosition of Array.isArray(vehiclePositions) ? vehiclePositions : []) {
    const id = vehiclePosition?.vehicle?.id; if (!id) continue;
    const existing = vehiclesById.get(id);
    if (!existing || numberOr(vehiclePosition.timestamp, -Infinity) >= numberOr(existing.timestamp, -Infinity)) vehiclesById.set(id, vehiclePosition);
  }
  const counters = { total: 0, unique: 0, ambiguous: 0, none: 0, contradicted: 0, unverified: 0, sequenceMisaligned: 0 };
  const results = (Array.isArray(tripUpdates) ? tripUpdates : []).map((tripUpdate) => {
    const match = matchUpdate(tripUpdate, staticIndex, vehiclesById, options);
    counters.total += 1; counters[CLASSIFICATION_KEYS[match.classification]] += 1;
    return { tripUpdate, match };
  });
  return { counters, results };
}

/** Whether a batch's (or rolling window's) counters clear the shadow-matcher's routing gate. */
export function gateVerdict(counters, thresholds = DEFAULT_THRESHOLDS) {
  const merged = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const total = counters?.total ?? 0;
  const uniqueRatio = total > 0 ? counters.unique / total : 0;
  const contradictedRatio = total > 0 ? counters.contradicted / total : 0;
  const alignmentRatio = total > 0 ? (total - (counters.sequenceMisaligned ?? 0)) / total : 0;
  const passes = total > 0 && uniqueRatio >= merged.uniqueMin && contradictedRatio <= merged.contradictedMax && alignmentRatio >= merged.alignmentMin;
  return { uniqueRatio, contradictedRatio, alignmentRatio, passes, thresholds: merged };
}

/**
 * The GTFS service day (YYYYMMDD) an instant belongs to in Toronto's local
 * time. GTFS static schedules that run past midnight encode times as
 * HH:MM:SS >= 24:00:00 rather than advancing the calendar date, so a trip
 * genuinely observed operating between midnight and `cutoverHour` (default
 * 04:00, an ordinary early-morning transit-schedule boundary) almost always
 * still belongs to the PREVIOUS day's service_id/calendar entry, with an
 * inflated (>=24:00) scheduled time. This rolls the calendar date back by one
 * day in that window so a lookup against the static index uses the same
 * service day the schedule itself does; pass `cutoverHour: 0` for the plain
 * calendar date instead.
 */
export function serviceDayToronto(instantMs, { timeZone = "America/Toronto", cutoverHour = 4 } = {}) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instantMs));
  const value = (type) => Number(parts.find((part) => part.type === type)?.value);
  let year = value("year"); let month = value("month"); let day = value("day"); const hour = value("hour");
  if (hour < cutoverHour) {
    const rolled = new Date(Date.UTC(year, month - 1, day)); rolled.setUTCDate(rolled.getUTCDate() - 1);
    year = rolled.getUTCFullYear(); month = rolled.getUTCMonth() + 1; day = rolled.getUTCDate();
  }
  return `${String(year).padStart(4, "0")}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

// --- Static schedule loading (OpenTripPlanner GraphQL) ----------------------
// Not exercised by tests (no live OTP is available for that; see the report
// for this task), so kept deliberately small and defensive.

async function fetchBounded(url) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), FETCH_DEADLINE_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "error", headers: { "user-agent": USER_AGENT, accept: "*/*" } });
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    const declared = Number(response.headers?.get?.("content-length") ?? 0);
    if (declared > MAX_BYTES) throw new Error(`${url} payload exceeds the safety bound`);
    if (!response.body?.getReader) { const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.byteLength > MAX_BYTES) throw new Error(`${url} payload exceeds the safety bound`); return bytes; }
    const reader = response.body.getReader(); const chunks = []; let total = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > MAX_BYTES) throw new Error(`${url} payload exceeds the safety bound`); chunks.push(value); } }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
  } finally { clearTimeout(timer); }
}

async function otpGraphQL(query, variables) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), FETCH_DEADLINE_MS);
  try {
    const response = await fetch(`${OTP_URL.replace(/\/$/, "")}/otp/gtfs/v1`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ query, variables }), signal: controller.signal });
    if (!response.ok) throw new Error(`OTP GraphQL returned HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.errors?.length) { const error = new Error(`OTP GraphQL error: ${payload.errors.map((entry) => entry.message).join("; ")}`); error.graphqlErrors = payload.errors; throw error; }
    return payload.data;
  } finally { clearTimeout(timer); }
}

/**
 * Primary shape: an OTP schema that exposes `tripsForDate` on a pattern
 * together with `stopPosition` on a date-scoped stoptime answers a whole
 * route in one round trip. Falls back to the two-call shape this project's
 * own backend/otp-client.mjs already relies on elsewhere (route.patterns
 * .trips.activeDates, then trip.stoptimesForDate per trip - see
 * ROUTE_BLOCK_TRIPS/TRIP_SHAPE_TIMES there) when the schema does not have
 * tripsForDate/stopPosition, taking the returned stoptime array's own order
 * as the stop position: OTP always returns a trip's stoptimes in stop
 * sequence order, so the 1-based array index carries the same ordinal
 * information stopPosition would. Neither shape has been run against a live
 * OTP instance while building this module (none was reachable); this is the
 * adaptive strategy called for when the primary shape's fields do not exist.
 */
const ROUTE_TRIPS_FOR_DATE = `query($id:String!,$date:String!) { route(id:$id) { patterns { tripsForDate(serviceDate:$date) { gtfsId stoptimesForDate(serviceDate:$date) { stopPosition scheduledDeparture serviceDay stop { gtfsId lat lon } } } } } }`;
const ROUTE_TRIPS_WITH_ACTIVE_DATES = `query($id:String!) { route(id:$id) { patterns { trips { gtfsId activeDates } } } }`;
const TRIP_STOPTIMES_FOR_DATE = `query($id:String!,$date:String!) { trip(id:$id) { stoptimesForDate(serviceDate:$date) { scheduledDeparture serviceDay stop { gtfsId lat lon } } } }`;

function stopsFromStoptimes(stoptimes, positionOf) {
  return (stoptimes ?? []).map((stoptime, index) => ({ seq: positionOf(stoptime, index), stopId: stoptime.stop?.gtfsId ?? null, lat: Number(stoptime.stop?.lat), lon: Number(stoptime.stop?.lon), scheduledAt: Number(stoptime.serviceDay) + Number(stoptime.scheduledDeparture) }))
    .filter((stop) => stop.stopId && Number.isFinite(stop.lat) && Number.isFinite(stop.lon) && Number.isFinite(stop.scheduledAt));
}

async function tripsForRouteOnDate(routeGtfsId, serviceDate) {
  try {
    const data = await otpGraphQL(ROUTE_TRIPS_FOR_DATE, { id: routeGtfsId, date: serviceDate });
    const trips = (data?.route?.patterns ?? []).flatMap((pattern) => pattern?.tripsForDate ?? []);
    if (!trips.length) return [];
    // stopPosition is 0-based in OTP's schema; this module's `seq` (and a
    // static stop_sequence) is 1-based.
    return trips.map((trip) => ({ gtfsId: trip.gtfsId, stops: stopsFromStoptimes(trip.stoptimesForDate, (stoptime) => Number(stoptime.stopPosition) + 1) }));
  } catch {
    const data = await otpGraphQL(ROUTE_TRIPS_WITH_ACTIVE_DATES, { id: routeGtfsId });
    const candidateTrips = (data?.route?.patterns ?? []).flatMap((pattern) => pattern?.trips ?? []).filter((trip) => Array.isArray(trip.activeDates) && trip.activeDates.includes(serviceDate));
    const trips = [];
    for (const trip of candidateTrips) {
      const timesData = await otpGraphQL(TRIP_STOPTIMES_FOR_DATE, { id: trip.gtfsId, date: serviceDate });
      trips.push({ gtfsId: trip.gtfsId, stops: stopsFromStoptimes(timesData?.trip?.stoptimesForDate, (_stoptime, index) => index + 1) });
    }
    return trips;
  }
}

/** Build `{ serviceDate, routes }` for one feed id, bounding memory to `{ gtfsId, routeGtfsId, stops: [{ seq, stopId, lat, lon, scheduledAt }] }` per trip. */
async function loadStaticIndexForFeed(feedId, serviceDate) {
  const data = await otpGraphQL("query($feeds:[String]) { routes(feeds:$feeds) { gtfsId shortName } }", { feeds: [feedId] });
  const routes = {};
  for (const route of data?.routes ?? []) {
    if (!route.shortName) continue;
    const trips = (await tripsForRouteOnDate(route.gtfsId, serviceDate)).filter((trip) => trip.stops.length).map((trip) => ({ ...trip, routeGtfsId: route.gtfsId }));
    if (trips.length) routes[route.shortName] = [...(routes[route.shortName] ?? []), ...trips];
  }
  return { serviceDate, routes };
}

// --- Poll loop and HTTP server -----------------------------------------------

function emptyCounters() { return { total: 0, unique: 0, ambiguous: 0, none: 0, contradicted: 0, unverified: 0, sequenceMisaligned: 0 }; }
function sumCounters(history) { const sum = emptyCounters(); for (const entry of history) for (const key of Object.keys(sum)) sum[key] += entry.counters[key] ?? 0; return sum; }
function emptyRewrittenBytes(now) { return encodeFeed({ header: { gtfsRealtimeVersion: "2.0", incrementality: 0, timestamp: Math.floor(now / 1_000) }, tripUpdates: [] }); }

const feedStates = new Map(FEED_IDS.map((feedId) => [feedId, { staticIndex: null, serviceDate: null, lastRewrittenBytes: null, lastGoodAt: null, history: [] }]));
let lastGoodPollAt = null;

function applyFailSafe(feedId, now) {
  const state = feedStates.get(feedId);
  if (state.lastGoodAt && now - state.lastGoodAt <= FAIL_SAFE_HOLD_MS && state.lastRewrittenBytes) return;
  state.lastRewrittenBytes = emptyRewrittenBytes(now);
}

async function refreshFeedState(feedId, tripUpdates, vehiclePositions, now) {
  const state = feedStates.get(feedId);
  const serviceDate = serviceDayToronto(now);
  if (!state.staticIndex || state.serviceDate !== serviceDate) {
    try { state.staticIndex = await loadStaticIndexForFeed(feedId, serviceDate); state.serviceDate = serviceDate; }
    catch (error) { console.error(`[ttc-trip-matcher] static index load failed for feed=${feedId}: ${error.message}`); applyFailSafe(feedId, now); return; }
  }
  const { counters, results } = classifyBatch(tripUpdates, state.staticIndex, vehiclePositions, { now, sequenceOffset: SEQUENCE_OFFSET });
  const uniqueUpdates = results.filter((entry) => entry.match.classification === "unique").map(({ tripUpdate, match }) => ({
    id: tripUpdate.id,
    trip: { tripId: match.matchedTripId, routeId: match.matchedRouteId, scheduleRelationship: 0 },
    stopTimeUpdate: match.stopMappings.map((mapping) => ({ stopSequence: mapping.sequence, stopId: mapping.stopId, arrival: { time: mapping.time } })),
    timestamp: Math.floor(now / 1_000),
  }));
  state.lastRewrittenBytes = encodeFeed({ header: { gtfsRealtimeVersion: "2.0", incrementality: 0, timestamp: Math.floor(now / 1_000) }, tripUpdates: uniqueUpdates });
  state.lastGoodAt = now;
  state.history = [...state.history, { at: now, counters }].filter((entry) => now - entry.at <= ROLLING_WINDOW_MS);
  lastGoodPollAt = now;
  // One line per poll, counters only - no coordinates, no vehicle or trip ids.
  console.log(`[ttc-trip-matcher] feed=${feedId} total=${counters.total} unique=${counters.unique} ambiguous=${counters.ambiguous} none=${counters.none} contradicted=${counters.contradicted} unverified=${counters.unverified} sequenceMisaligned=${counters.sequenceMisaligned}`);
}

async function pollOnce() {
  const now = Date.now();
  let decodedTu; let decodedVp;
  try {
    const [tripsBytes, vehiclesBytes] = await Promise.all([fetchBounded(TTC_TRIPS_URL), fetchBounded(TTC_VEHICLES_URL)]);
    decodedTu = decodeFeed(tripsBytes); decodedVp = decodeFeed(vehiclesBytes);
  } catch (error) {
    console.error(`[ttc-trip-matcher] poll fetch/decode failed: ${error.message}`);
    for (const feedId of FEED_IDS) applyFailSafe(feedId, now);
    return;
  }
  for (const feedId of FEED_IDS) await refreshFeedState(feedId, decodedTu.tripUpdates, decodedVp.vehiclePositions, now);
}

function isHealthy() { return lastGoodPollAt !== null && Date.now() - lastGoodPollAt <= 3 * POLL_MS; }

function matchStatsPayload(feedId) {
  const state = feedStates.get(feedId);
  const rolling = sumCounters(state.history);
  return {
    feed: feedId,
    lastPollAt: state.lastGoodAt ? new Date(state.lastGoodAt).toISOString() : null,
    lastPoll: state.history.length ? state.history[state.history.length - 1].counters : emptyCounters(),
    rolling24h: { ...rolling, polls: state.history.length },
    gate: gateVerdict(rolling, DEFAULT_THRESHOLDS),
  };
}

const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };

const httpServer = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") { const healthy = isHealthy(); return json(res, healthy ? 200 : 503, { ok: healthy, service: "ttc-trip-matcher", lastPollAt: lastGoodPollAt ? new Date(lastGoodPollAt).toISOString() : null }); }
    if (req.method === "GET" && url.pathname === "/internal/ttc/trips") {
      const feedId = url.searchParams.get("feed") ?? FEED_IDS[0];
      const state = feedStates.get(feedId);
      if (!state) return json(res, 404, { error: `unknown feed ${feedId}` });
      const bytes = state.lastRewrittenBytes ?? emptyRewrittenBytes(Date.now());
      res.writeHead(200, { "content-type": "application/x-protobuf", "content-length": bytes.length, "cache-control": "no-store" });
      res.end(Buffer.from(bytes));
      return;
    }
    if (req.method === "GET" && url.pathname === "/internal/ttc/match-stats") {
      const feedId = url.searchParams.get("feed") ?? FEED_IDS[0];
      if (!feedStates.has(feedId)) return json(res, 404, { error: `unknown feed ${feedId}` });
      return json(res, 200, matchStatsPayload(feedId));
    }
    return json(res, 404, { error: "route not found" });
  } catch (error) { return json(res, 500, { error: String(error?.message ?? error) }); }
});

function startPolling() {
  pollOnce().catch((error) => console.error(`[ttc-trip-matcher] poll failed: ${error.message}`));
  setInterval(() => { pollOnce().catch((error) => console.error(`[ttc-trip-matcher] poll failed: ${error.message}`)); }, POLL_MS);
}

// Importing this module must not start a server or touch the network - only
// running it directly (`node ttc-trip-matcher.mjs`) does.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startPolling();
  httpServer.listen(TTC_MATCHER_PORT, process.env.HOST ?? "0.0.0.0", () => console.log(`[ttc-trip-matcher] listening on port ${TTC_MATCHER_PORT}`));
}
export { httpServer as server };
