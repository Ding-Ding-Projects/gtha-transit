import { readFileSync } from "node:fs";
import { routeStopAnchors } from "./stop-routes.mjs";
import { tripStopTimesWithOtp, patternAlignedTimesWithOtp } from "./otp-client.mjs";
const feeds = JSON.parse(readFileSync(new URL("../data/feeds.json", import.meta.url), "utf8")).agencies;
const MAX_STOPS = 40;
const MAX_CANDIDATES = 3;
const SAFETY_MARGIN_SECONDS = 120;
const MAX_AGE_MS = 120_000;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const boundedId = (value) => typeof value === "string" && Buffer.byteLength(value) <= 200 && /^[^\s:\u0000-\u001f\u007f]+$/.test(value);
const qualified = (value) => typeof value === "string" && Buffer.byteLength(value) <= 200 && /^[^:\s\u0000-\u001f\u007f]+:[^:\s\u0000-\u001f\u007f]+$/.test(value);

export function isServiceDate(value) {
  if (typeof value !== "string" || !/^\d{8}$/.test(value)) return false;
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const date = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso;
}

function torontoDate(now) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type).value).join("");
}

function scopedId(value, agencyId, feedId) {
  if (boundedId(value)) return Buffer.byteLength(`${feedId}:${value}`) <= 200 ? `${feedId}:${value}` : null;
  if (!qualified(value)) return null;
  const [prefix, id] = value.split(":");
  return prefix === agencyId || prefix === feedId ? scopedId(id, agencyId, feedId) : null;
}

/** Adapt one actual combineVehicleSnapshots vehicle, supplied only by the web collector. */
export function collectorSnapshot(raw, now = Date.now()) {
  if (!raw || Array.isArray(raw) || Object.keys(raw).some((key) => key !== "snapshot")) return null;
  const item = raw.snapshot;
  if (!item || typeof item !== "object" || !boundedId(item.agencyId) || item.stale === true || !finite(now)) return null;
  if (typeof item.timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(item.timestamp)) return null;
  const timestamp = Date.parse(item.timestamp);
  if (!finite(timestamp) || now - timestamp > MAX_AGE_MS || timestamp > now + 30_000) return null;
  // A published service date is authoritative, including service past midnight.
  // Without one, only the Toronto calendar date of the observation is attempted.
  const serviceDate = item.startDate == null ? torontoDate(timestamp) : item.startDate;
  if (!isServiceDate(serviceDate)) return null;
  const today = torontoDate(now);
  const previous = new Date(`${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}T12:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  if (serviceDate !== today && serviceDate !== previous.toISOString().slice(0, 10).replaceAll("-", "")) return null;
  const date = `${serviceDate.slice(0, 4)}-${serviceDate.slice(4, 6)}-${serviceDate.slice(6, 8)}`;
  const candidates = feeds.filter((feed) => (feed.publicAgencyId ?? feed.id) === item.agencyId && (!feed.retireAfter || date <= feed.retireAfter) && (!feed.promoteAfter || date > feed.promoteAfter));
  if (candidates.length !== 1) return null;
  const feedId = candidates[0].id;
  const id = scopedId(item.id, item.agencyId, item.agencyId);
  const tripId = item.tripId == null || item.tripId === "" ? null : scopedId(item.tripId, item.agencyId, feedId);
  const routeId = item.routeId == null || item.routeId === "" ? null : scopedId(item.routeId, item.agencyId, feedId);
  if (!id || item.tripId && !tripId || item.routeId && !routeId || !tripId && !routeId || item.vehicleKey !== id) return null;
  if (item.lat != null && (!finite(item.lat) || Math.abs(item.lat) > 90) || item.lon != null && (!finite(item.lon) || Math.abs(item.lon) > 180) || item.bearing != null && (!finite(item.bearing) || item.bearing < 0 || item.bearing >= 360)) return null;
  const position = finite(item.lat) && finite(item.lon) && finite(item.bearing) ? { lat: item.lat, lon: item.lon, bearing: item.bearing } : null;
  const nextStopId = item.nextStopId == null ? null : scopedId(item.nextStopId, item.agencyId, feedId);
  if (item.nextStopId != null && !nextStopId) return null;
  return { id, vehicleKey: id, agencyId: item.agencyId, feedId, routeId, tripId, serviceDate, serviceDateSource: item.startDate == null ? "observation-calendar" : "publisher", timestamp: new Date(timestamp).toISOString(), nextStopId, position };
}

/** Choose only upcoming, non-cancelled publisher times that leave a safety margin. */
export function interceptCandidates({ stops, now = Date.now(), nextStopId = null, safetyMarginSeconds = SAFETY_MARGIN_SECONDS }) {
  if (!finite(now) || !finite(safetyMarginSeconds) || safetyMarginSeconds < 0) return [];
  const ordered = Array.isArray(stops) ? stops : [];
  const start = nextStopId ? ordered.findIndex((stop) => stop?.id === nextStopId) : 0;
  if (start < 0) return [];
  return ordered.slice(start, start + MAX_STOPS).filter((stop) => {
    const at = Date.parse(stop?.basis === "aligned-timetable" ? stop.alignedArrival : stop?.arrivalAt ?? stop?.departureAt ?? stop?.scheduledArrivalAt ?? stop?.scheduledDepartureAt ?? "");
    return finite(at) && at > now + safetyMarginSeconds * 1000 && !["CANCELED", "CANCELLED", "SKIPPED"].includes(stop?.realtimeState) && qualified(stop?.id) && finite(stop?.lat) && Math.abs(stop.lat) <= 90 && finite(stop?.lon) && Math.abs(stop.lon) <= 180;
  }).slice(0, MAX_STOPS).slice(0, MAX_CANDIDATES).map((stop) => { const aligned = stop.basis === "aligned-timetable"; const arrivalAt = aligned ? stop.alignedArrival : stop.arrivalAt ?? stop.departureAt ?? stop.scheduledArrivalAt ?? stop.scheduledDepartureAt; return { ...stop, basis: aligned ? "aligned-timetable" : stop.arrivalAt || stop.departureAt ? "realtime" : "scheduled", arriveByAt: new Date((Date.parse(arrivalAt) - safetyMarginSeconds * 1000)).toISOString() }; });
}

const anchorCache = new Map();
export async function cachedRouteAnchors(reference, { date, now = Date.now(), loader = routeStopAnchors } = {}) {
  const key = `${reference.feedId}/${reference.routeId}/${date}`; const previous = anchorCache.get(key);
  if (previous && previous.loader === loader && now >= previous.at && now - previous.at < 600000) return previous.value;
  const value = await loader(reference, { date });
  if (anchorCache.size >= 64) anchorCache.delete(anchorCache.keys().next().value);
  anchorCache.set(key, { at: now, value, loader }); return value;
}

/** Private POST only: the web collector supplies position, never the rider request. */
export async function upcomingForCollector(input, { otpUrl, timeoutMs = 8000, now = Date.now(), signal, anchorsLoader = routeStopAnchors, tripLoader = tripStopTimesWithOtp, alignedLoader = patternAlignedTimesWithOtp } = {}) {
  const snapshot = collectorSnapshot(input, now);
  if (!snapshot) return { state: "invalid-input", code: "INVALID_COLLECTOR_SNAPSHOT", candidates: [] };
  const { position, ...vehicle } = snapshot;
  const started = Date.now(); const deadline = started + Math.min(8000, Math.max(1, timeoutMs));
  const remaining = () => { signal?.throwIfAborted(); const time = deadline - Date.now(); if (time <= 0) throw new Error("Upcoming deadline exceeded"); return time; };
  const unavailable = (state = "unavailable") => ({ state, fetchedAt: new Date(now + Date.now() - started).toISOString(), vehicle, candidates: [] });
  try {
    let trip = null;
    if (snapshot.tripId) {
      try { trip = await tripLoader({ otpUrl, timeoutMs: remaining(), tripId: snapshot.tripId, serviceDate: snapshot.serviceDate, signal }); }
      catch (error) {
        // OTP may reject an unknown publisher trip through GraphQL errors
        // rather than returning null. This still permits the independently
        // labelled pattern lookup, within the same remaining time/call budget.
        if (error?.code !== "UPSTREAM" || signal?.aborted) throw error;
        remaining();
      }
    }
    remaining();
    if (now + Date.now() - started - Date.parse(snapshot.timestamp) > MAX_AGE_MS) return unavailable("stale");
    if (trip?.id === snapshot.tripId) {
      const candidates = interceptCandidates({ stops: trip.stops.filter((stop) => stop.id.startsWith(`${snapshot.feedId}:`)), nextStopId: snapshot.nextStopId, now: now + Date.now() - started });
      return { ...unavailable(candidates.length ? "live" : "trip-ended"), method: "trip-id", confirmedTrip: true, trip: { id: trip.id, headsign: trip.headsign, routeId: trip.routeId, confirmed: true }, candidates };
    }
    if (!position || !snapshot.routeId) return unavailable();
    const date = `${snapshot.serviceDate.slice(0, 4)}-${snapshot.serviceDate.slice(4, 6)}-${snapshot.serviceDate.slice(6, 8)}`;
    const routeId = snapshot.routeId.split(":")[1];
    const anchors = await cachedRouteAnchors({ feedId: snapshot.agencyId, routeId }, { date, now, loader: anchorsLoader });
    const result = await alignedLoader({ otpUrl, timeoutMs: remaining(), feedId: snapshot.feedId, routeId, ...position, atMillis: Date.parse(snapshot.timestamp), anchors, signal });
    remaining();
    if (now + Date.now() - started - Date.parse(snapshot.timestamp) > MAX_AGE_MS) return unavailable("stale");
    if (result.state !== "aligned") return unavailable(result.state);
    const candidates = interceptCandidates({ stops: result.stops, now: now + Date.now() - started });
    return { ...unavailable(candidates.length ? "live" : "trip-ended"), method: result.method, confirmedTrip: false, disclosure: result.disclosure, alignment: result.alignment, trip: result.trip, candidates };
  } catch { return unavailable(); }
}
