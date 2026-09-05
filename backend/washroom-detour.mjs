import { facilityAvailability } from "../shared/washrooms.mjs";
import { canonicalAgencyId } from "../shared/washroom-identities.mjs";

export const MAX_WASHROOM_CANDIDATES = 6;
export const MAX_WASHROOM_CONCURRENCY = 2;
export const MAX_WASHROOM_DETOUR_DEADLINE_MS = 24_000;

const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const text = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
const agencyKey = (value) => canonicalAgencyId(value);

function point(raw) {
  const lat = numeric(raw?.lat); const lon = numeric(raw?.lon);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, ...(text(raw?.name) ? { name: text(raw.name) } : {}) };
}

function list(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.facilities)) return value.facilities;
  if (Array.isArray(value?.stops)) return value.stops;
  if (value instanceof Map) return [...value.values()];
  return [];
}

function identities(value) {
  const nested = value?.identity ?? value?.stationIdentity ?? value?.station ?? {};
  const values = [value?.id, value?.stopId, value?.stationId, value?.gtfsId, nested?.id, nested?.stopId, nested?.stationId, nested?.gtfsId, ...(Array.isArray(value?.ids) ? value.ids : []), ...(Array.isArray(value?.stopIds) ? value.stopIds : []), ...(Array.isArray(value?.stationIds) ? value.stationIds : [])];
  return new Set(values.map(text).filter(Boolean));
}

function agencyOf(value) {
  return agencyKey(value?.agencyId ?? value?.agencyFeedId ?? value?.feedId ?? value?.agency?.id ?? value?.stationIdentity?.agencyId ?? value?.identity?.agencyId ?? (text(value?.id)?.includes(":") ? value.id.slice(0, value.id.indexOf(":")) : null));
}

export function haversineMetres(left, right) {
  if (!point(left) || !point(right)) return Infinity;
  const radians = Math.PI / 180;
  const latitude = (right.lat - left.lat) * radians;
  const longitude = (right.lon - left.lon) * radians;
  const a = Math.sin(latitude / 2) ** 2 + Math.cos(left.lat * radians) * Math.cos(right.lat * radians) * Math.sin(longitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(Math.min(1, Math.max(0, a))), Math.sqrt(1 - Math.min(1, Math.max(0, a))));
}

function sourceEvidence(coordinates, fallbackSource = null) {
  return {
    kind: "official-facility-coordinate",
    sourceUrl: text(coordinates?.sourceUrl) ?? text(fallbackSource),
    sourceReceiptId: text(coordinates?.sourceReceiptId),
    retrievedAt: text(coordinates?.sourceRetrievedAt),
    reference: text(coordinates?.reference)
  };
}

function identityEvidence(facility) {
  const identity = facility?.stationIdentity ?? facility?.identity ?? facility?.station ?? {};
  return {
    sourceUrl: text(identity?.sourceUrl) ?? text(facility?.source),
    sourceReceiptId: text(identity?.sourceReceiptId) ?? text(facility?.sourceReceiptId),
    retrievedAt: text(identity?.sourceRetrievedAt) ?? text(facility?.sourceRetrievedAt),
    reference: text(identity?.reference)
  };
}

/**
 * Resolves a facility only from its published coordinates or from an explicit,
 * agency-qualified GTFS identity. Display names are deliberately never used.
 */
export function resolveFacilityLocation(facility, stopIndex = null) {
  const direct = point(facility?.coordinates);
  const directSource = text(facility?.coordinates?.sourceUrl) ?? text(facility?.source);
  const directReceipt = text(facility?.coordinates?.sourceReceiptId) ?? text(facility?.sourceReceiptId);
  if (direct && directSource && directReceipt) return { point: direct, source: sourceEvidence(facility.coordinates, facility.source) };

  const agencyId = agencyOf(facility);
  const facilityIds = identities(facility);
  const identitySource = identityEvidence(facility);
  if (!agencyId || !facilityIds.size || !identitySource.sourceUrl || !identitySource.sourceReceiptId) return null;
  const matches = list(stopIndex).filter((stop) => agencyOf(stop) === agencyId && [...facilityIds].some((id) => identities(stop).has(id))).map((stop) => ({ stop, point: point(stop) })).filter((item) => item.point);
  if (matches.length !== 1) return null;
  const match = matches[0];
  return {
    point: match.point,
    source: {
      kind: "verified-stop-index",
      stopId: text(match.stop.id) ?? text(match.stop.stopId) ?? null,
      agencyId,
      sourceUrl: identitySource.sourceUrl,
      sourceReceiptId: identitySource.sourceReceiptId,
      retrievedAt: identitySource.retrievedAt,
      reference: identitySource.reference
    }
  };
}

/** Resolves only an explicit coordinate or one exact agency-qualified stop ID. */
export function resolveCurrentPosition(currentPosition, stopIndex = null) {
  const direct = point(currentPosition);
  if (direct) return { point: direct, source: { kind: "request-coordinate" } };
  const requestedId = text(currentPosition?.stopId ?? currentPosition?.stationId ?? currentPosition?.id);
  const requestedAgency = agencyKey(currentPosition?.agencyId ?? currentPosition?.agencyFeedId ?? currentPosition?.feedId);
  if (!requestedId || !requestedAgency) return null;
  const matches = list(stopIndex).filter((stop) => agencyOf(stop) === requestedAgency && identities(stop).has(requestedId)).map((stop) => ({ stop, point: point(stop) })).filter((item) => item.point);
  if (matches.length !== 1) return null;
  return { point: matches[0].point, source: { kind: "verified-stop-index", stopId: requestedId, agencyId: requestedAgency } };
}

function validDateTime(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && /(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : null;
}

function durationSeconds(itinerary, departureAt) {
  const reported = numeric(itinerary?.duration);
  if (reported !== null && reported >= 0) return Math.round(reported);
  const start = Date.parse(itinerary?.startTime ?? departureAt);
  const end = Date.parse(itinerary?.endTime);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.round((end - start) / 1000) : null;
}

function itineraryFrom(result, departureAt) {
  const candidates = Array.isArray(result?.itineraries) ? result.itineraries : Array.isArray(result) ? result : [];
  return candidates.map((itinerary) => ({ itinerary, duration: durationSeconds(itinerary, departureAt) })).filter((item) => item.duration !== null).sort((left, right) => left.duration - right.duration || String(left.itinerary?.id ?? "").localeCompare(String(right.itinerary?.id ?? "")))[0] ?? null;
}

function arrivalTime(itinerary, departureAt, seconds) {
  const end = validDateTime(itinerary?.endTime);
  if (end) return end;
  return new Date(Date.parse(departureAt) + seconds * 1000).toISOString();
}

function publicFacility(facility, availability) {
  return {
    agencyId: text(facility?.agencyId) ?? null,
    facilityId: text(facility?.facilityId) ?? text(facility?.id) ?? null,
    facilityType: text(facility?.facilityType) ?? null,
    name: Array.isArray(facility?.names) ? text(facility.names[0]) : text(facility?.name),
    source: text(facility?.source) ?? null,
    availability
  };
}

function noResult(code, note, details = {}) {
  return { status: "unroutable", completeJourney: false, facility: null, facilityLeg: null, continuation: null, unresolved: { code, ...details }, candidateCount: 0, note };
}

function scopedNoResult(facilityOnly, code, note, details = {}) {
  const result = noResult(code, note, details);
  return facilityOnly ? { ...result, scope: "facility-only" } : result;
}

function remaining(deadline, now) { return Math.max(0, deadline - now()); }

async function boundedPlan(planWithOtp, payload, deadline, now) {
  const timeLeft = remaining(deadline, now);
  if (timeLeft < 1) return { error: "deadline" };
  const timeoutMs = Math.max(1, Math.min(10_000, timeLeft));
  const operation = Promise.resolve().then(() => planWithOtp({ ...payload, timeoutMs }));
  let timer;
  const expiry = new Promise((resolve) => { timer = setTimeout(() => resolve({ __washroomDeadline: true }), timeLeft); });
  try {
    const result = await Promise.race([operation, expiry]);
    return result?.__washroomDeadline ? { error: "deadline" } : { result };
  } finally {
    clearTimeout(timer);
  }
}

async function runPool(candidates, concurrency, worker) {
  let cursor = 0;
  const results = new Array(candidates.length);
  const runners = Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
    while (cursor < candidates.length) {
      const index = cursor; cursor += 1;
      results[index] = await worker(candidates[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

function normalizedVia(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const via = value.map(point);
  return via.some((item) => !item) ? null : via;
}

/**
 * Plans a short, bounded detour to a facility, then separately proves that the
 * remaining journey can still be completed. It never reports a complete trip
 * from an immediate facility leg alone.
 */
export async function planWashroomDetour(input, { planWithOtp, facilityRegistry, stopIndex = null, now = () => Date.now(), deadlineMs = MAX_WASHROOM_DETOUR_DEADLINE_MS } = {}) {
  if (typeof planWithOtp !== "function") throw new TypeError("planWithOtp is required");
  const facilityOnly = input?.facilityOnly === true;
  const current = resolveCurrentPosition(input?.currentPosition, stopIndex);
  if (!current) return scopedNoResult(facilityOnly, "CURRENT_POSITION_UNRESOLVED", "An explicit current coordinate or uniquely verified agency-qualified stop is required before a washroom detour can be planned.");
  const destination = point(input?.to);
  if (!facilityOnly && !destination) return noResult("DESTINATION_UNRESOLVED", "The remaining destination needs valid coordinates before a washroom detour can be planned.");
  const via = facilityOnly ? [] : normalizedVia(input?.via);
  if (!facilityOnly && !via) return noResult("VIA_UNRESOLVED", "Each remaining stop must have valid coordinates before a washroom detour can be planned.");
  const dateTime = validDateTime(input?.dateTime);
  if (!dateTime) return scopedNoResult(facilityOnly, "DATETIME_UNRESOLVED", "A timestamp with an explicit offset is required before availability can be checked at facility arrival.");

  const deadline = now() + Math.min(MAX_WASHROOM_DETOUR_DEADLINE_MS, Math.max(1, numeric(deadlineMs) ?? MAX_WASHROOM_DETOUR_DEADLINE_MS));
  const facilities = list(facilityRegistry);
  const evaluated = facilities.map((facility) => ({ facility, availability: facilityAvailability(facility, dateTime), location: resolveFacilityLocation(facility, stopIndex) }));
  const pool = evaluated.filter((candidate) => candidate.availability !== "unknown" && candidate.location).sort((left, right) => haversineMetres(current.point, left.location.point) - haversineMetres(current.point, right.location.point) || String(left.facility.facilityId ?? "").localeCompare(String(right.facility.facilityId ?? ""))).slice(0, MAX_WASHROOM_CANDIDATES);
  if (!pool.length) {
    const publishedButUnroutable = evaluated.some((candidate) => candidate.availability !== "unknown" && !candidate.location);
    return scopedNoResult(facilityOnly, publishedButUnroutable ? "FACILITY_COORDINATES_UNAVAILABLE" : "NO_CONFIRMED_AVAILABILITY", publishedButUnroutable ? "No facility with published hours has verified routing coordinates. Municipal facility coordinates are not inferred." : "No facility has published hours that can be confirmed for automatic washroom routing.", { locationSource: current.source });
  }

  const options = {
    wheelchair: Boolean(input?.wheelchair),
    maxWalkDistance: Math.min(20_000, Math.max(0, numeric(input?.maxWalkDistance) ?? 2_000)),
    preference: ["fastest", "transfers", "walking", "waiting"].includes(input?.preference) ? input.preference : "fastest",
    maxResults: Math.min(10, Math.max(1, Math.floor(numeric(input?.maxResults) ?? 3)))
  };
  const results = await runPool(pool, MAX_WASHROOM_CONCURRENCY, async (candidate) => {
    try {
      const immediate = await boundedPlan(planWithOtp, { ...options, from: current.point, to: candidate.location.point, via: [], dateTime, arriveBy: false }, deadline, now);
      if (immediate.error) return { state: immediate.error, candidate };
      const immediateItinerary = itineraryFrom(immediate.result, dateTime);
      if (!immediateItinerary) return { state: "facility-unresolved", candidate };
      const expectedArrival = arrivalTime(immediateItinerary.itinerary, dateTime, immediateItinerary.duration);
      const availability = facilityAvailability(candidate.facility, expectedArrival);
      if (availability !== "confirmed-open") return { state: availability === "closed" ? "closed-at-arrival" : "unknown-at-arrival", candidate, expectedArrival };
      const facilityLeg = { itinerary: immediateItinerary.itinerary, from: current.point, to: candidate.location.point, timeToFacilitySeconds: immediateItinerary.duration, expectedArrival, internalWalkingUnknown: true, locationSource: candidate.location.source };
      if (facilityOnly) return { state: "facility-only", candidate, availability, facilityLeg };
      const continuation = await boundedPlan(planWithOtp, { ...options, from: candidate.location.point, to: destination, via, dateTime: expectedArrival, arriveBy: false }, deadline, now);
      if (continuation.error) return { state: continuation.error, candidate, availability, facilityLeg };
      const continuationItinerary = itineraryFrom(continuation.result, expectedArrival);
      if (!continuationItinerary) return { state: "continuation-unresolved", candidate, availability, facilityLeg };
      return { state: "complete", candidate, availability, facilityLeg, continuation: continuationItinerary.itinerary, continuationDurationSeconds: continuationItinerary.duration };
    } catch (error) {
      return { state: "routing-error", candidate, error: error instanceof Error ? error.message : "routing error" };
    }
  });
  if (facilityOnly) {
    const facility = results.filter((result) => result?.state === "facility-only").sort((left, right) => left.facilityLeg.timeToFacilitySeconds - right.facilityLeg.timeToFacilitySeconds || String(left.candidate.facility.facilityId ?? "").localeCompare(String(right.candidate.facility.facilityId ?? "")))[0];
    if (facility) return { status: "facility-only", scope: "facility-only", completeJourney: false, facility: publicFacility(facility.candidate.facility, facility.availability), facilityLeg: facility.facilityLeg, continuation: null, unresolved: null, candidateCount: pool.length, note: "The facility is confirmed open at expected arrival. No onward journey was requested or claimed. Internal walking distance and access within the facility are unknown.", locationSource: current.source };
    const timedOut = results.some((result) => result?.state === "deadline");
    return { status: timedOut ? "unresolved" : "unroutable", scope: "facility-only", completeJourney: false, facility: null, facilityLeg: null, continuation: null, unresolved: { code: timedOut ? "DETOUR_TIMEOUT" : "NO_REACHABLE_OPEN_FACILITY", attempts: results.map((result) => ({ facilityId: result?.candidate?.facility?.facilityId ?? null, state: result?.state ?? "unresolved" })) }, candidateCount: pool.length, note: timedOut ? "Facility-only washroom routing reached its bounded planning deadline before a result was available." : "No nearby facility could be confirmed open at its expected arrival time.", locationSource: current.source };
  }
  const complete = results.filter((result) => result?.state === "complete").sort((left, right) => left.facilityLeg.timeToFacilitySeconds + left.continuationDurationSeconds - right.facilityLeg.timeToFacilitySeconds - right.continuationDurationSeconds || String(left.candidate.facility.facilityId ?? "").localeCompare(String(right.candidate.facility.facilityId ?? "")))[0];
  if (complete) return { status: "complete", completeJourney: true, facility: publicFacility(complete.candidate.facility, complete.availability), facilityLeg: complete.facilityLeg, continuation: { itinerary: complete.continuation, durationSeconds: complete.continuationDurationSeconds, preservedTo: destination, preservedVia: via }, unresolved: null, candidateCount: pool.length, note: "The facility is confirmed open at expected arrival. Internal walking distance and access within the facility are unknown.", locationSource: current.source };
  const partial = results.filter((result) => result?.facilityLeg).sort((left, right) => left.facilityLeg.timeToFacilitySeconds - right.facilityLeg.timeToFacilitySeconds || String(left.candidate.facility.facilityId ?? "").localeCompare(String(right.candidate.facility.facilityId ?? "")))[0];
  if (partial) return { status: "partial", completeJourney: false, facility: publicFacility(partial.candidate.facility, partial.availability), facilityLeg: partial.facilityLeg, continuation: null, unresolved: { code: partial.state === "deadline" ? "CONTINUATION_TIMEOUT" : "CONTINUATION_UNRESOLVED", preservedTo: destination, preservedVia: via }, candidateCount: pool.length, note: "The facility is confirmed open at expected arrival, but the remaining journey could not be resolved. Internal walking distance and access within the facility are unknown.", locationSource: current.source };
  const timedOut = results.some((result) => result?.state === "deadline");
  return { status: timedOut ? "unresolved" : "unroutable", completeJourney: false, facility: null, facilityLeg: null, continuation: null, unresolved: { code: timedOut ? "DETOUR_TIMEOUT" : "NO_REACHABLE_OPEN_FACILITY", attempts: results.map((result) => ({ facilityId: result?.candidate?.facility?.facilityId ?? null, state: result?.state ?? "unresolved" })) }, candidateCount: pool.length, note: timedOut ? "Washroom routing reached its bounded planning deadline before a complete result was available." : "No nearby facility could be confirmed open at its expected arrival time.", locationSource: current.source };
}
