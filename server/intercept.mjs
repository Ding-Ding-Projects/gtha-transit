import { getVehicleSnapshot, VEHICLE_FEEDS } from "../vehicles/index.mjs";

export const INTERCEPT_LIMITS = Object.freeze({ deadlineMs: 25_000, candidates: 3, walkConcurrency: 2, vehicleAgeMs: 120_000, futureSkewMs: 30_000 });
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = (value, max = 200) => typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= max && !/[\u0000-\u001f\u007f]/.test(value);
const rawId = (value) => text(value) && !/[:\s]/.test(value);
const qualifiedId = (value) => text(value) && /^[a-z][a-z0-9-]{0,31}:[^:\s]+$/.test(value);
const coordinates = (value) => object(value) && typeof value.lat === "number" && Number.isFinite(value.lat) && Math.abs(value.lat) <= 90 && typeof value.lon === "number" && Number.isFinite(value.lon) && Math.abs(value.lon) <= 180;
const instant = (value) => text(value, 64) && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
const fresh = (value, now) => { const at = instant(value); return Number.isFinite(at) && now - at <= INTERCEPT_LIMITS.vehicleAgeMs && at - now <= INTERCEPT_LIMITS.futureSkewMs; };
const cancelled = (value) => ["CANCELED", "CANCELLED", "SKIPPED"].includes(value);

function distance(a, b) {
  if (!coordinates(a) || !coordinates(b)) return Infinity;
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}

function validInput(input) {
  if (!object(input) || Object.keys(input).length !== 2 || !Object.hasOwn(input, "vehicleKey") || !Object.hasOwn(input, "origin") || !qualifiedId(input.vehicleKey)) return false;
  if (!coordinates(input.origin) || Object.keys(input.origin).some((key) => !["lat", "lon", "name"].includes(key))) return false;
  if (input.origin.name !== undefined && !text(input.origin.name, 120)) return false;
  return Object.hasOwn(VEHICLE_FEEDS, input.vehicleKey.split(":")[0]);
}

function point(value) {
  const result = { lat: value.lat, lon: value.lon };
  if (text(value.name, 200)) result.name = value.name;
  for (const key of ["id", "stopId", "stationId"]) if (qualifiedId(value[key])) result[key] = value[key];
  return result;
}

function candidate(value, feed, now) {
  if (!coordinates(value) || !qualifiedId(value.id) || !value.id.startsWith(`${feed}:`) || cancelled(value.realtimeState)) return null;
  if (!["realtime", "scheduled"].includes(value.basis)) return null;
  const at = value.basis === "realtime" ? value.arrivalAt ?? value.departureAt : value.scheduledArrivalAt ?? value.scheduledDepartureAt;
  const arrival = instant(at); const arriveBy = instant(value.arriveByAt);
  if (!Number.isFinite(arrival) || !Number.isFinite(arriveBy) || arriveBy <= now || arrival - arriveBy < 120_000) return null;
  return { stop: { ...point(value), id: value.id }, arrivalAt: new Date(arrival).toISOString(), arriveByAt: new Date(arriveBy).toISOString(), basis: value.basis };
}

function matchingEndpoint(endpoint, expected, requireIdentity = false) {
  // OTP returns the requested destination coordinates even when a walking path
  // snaps onto a nearby street. A small precision tolerance is not a stop search.
  if (distance(endpoint, expected) > 5) return false;
  if (requireIdentity) for (const key of ["id", "stopId"]) if (endpoint[key] != null && endpoint[key] !== expected.id) return false;
  return true;
}

function verifiedWalk(value, origin, stop, requestedAt, arriveByAt, currentTime) {
  if (!object(value) || !Array.isArray(value.legs) || !value.legs.length || value.legs.length > 12 || value.transfers !== 0) return null;
  const start = instant(value.startTime); const end = instant(value.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < requestedAt - 1000 || end < start || end < currentTime || end > instant(arriveByAt)) return null;
  const first = value.legs[0]; const last = value.legs.at(-1);
  if (!matchingEndpoint(first.from, origin) || !matchingEndpoint(last.to, stop, true)) return null;
  if (instant(first.startTime) !== start || instant(last.endTime) !== end) return null;
  const endpoints = [first.from]; const legs = [];
  for (const [index, leg] of value.legs.entries()) {
    const legStart = instant(leg.startTime); const legEnd = instant(leg.endTime);
    if (leg.mode !== "WALK" || leg.tripId || leg.routeId || leg.routeGtfsId || cancelled(leg.realtimeState) || !coordinates(leg.from) || !coordinates(leg.to) || !Number.isFinite(legStart) || !Number.isFinite(legEnd) || legStart < start || legEnd < legStart || legEnd > end) return null;
    if (index && (legStart < instant(value.legs[index - 1].endTime) || !matchingEndpoint(leg.from, value.legs[index - 1].to))) return null;
    // Returning to any prior leg endpoint is a loop, not progress to the stop.
    if (endpoints.some((prior) => distance(prior, leg.to) <= 1)) return null;
    endpoints.push(leg.to);
    if (leg.intermediateStops != null && (!Array.isArray(leg.intermediateStops) || leg.intermediateStops.length)) return null;
    const clean = { mode: "WALK", from: point(leg.from), to: point(leg.to), startTime: leg.startTime, endTime: leg.endTime };
    for (const key of ["duration", "distance"]) if (typeof leg[key] === "number" && Number.isFinite(leg[key]) && leg[key] >= 0) clean[key] = leg[key];
    if (text(leg.geometry, 200_000)) clean.geometry = leg.geometry;
    legs.push(clean);
  }
  const clean = { startTime: value.startTime, endTime: value.endTime, transfers: 0, legs };
  if (text(value.id)) clean.id = value.id;
  for (const key of ["duration", "walkDistance"]) if (typeof value[key] === "number" && Number.isFinite(value[key]) && value[key] >= 0) clean[key] = value[key];
  return clean;
}

/** Resolve one rider-selected vehicle through trusted data and genuine walking plans.
 * Loaders receive the shared abort signal; upstream errors and private addresses
 * never become response reasons. This module has no persistence or logging path.
 */
export async function planIntercept(input, { snapshotLoader = getVehicleSnapshot, upcomingLoader, walkPlanner, now = Date.now, signal } = {}) {
  const wallStart = Date.now(); const initial = typeof now === "function" ? now() : now;
  const clock = typeof now === "function" ? now : () => initial + Date.now() - wallStart;
  const response = (state, reason, extra = {}) => ({ state, checkedAt: new Date(Number.isFinite(clock()) ? clock() : Date.now()).toISOString(), reason, options: [], ...extra });
  if (!validInput(input) || !Number.isFinite(initial)) return response("invalid-input", "Choose a vehicle and a valid current position.");
  if (typeof snapshotLoader !== "function" || typeof upcomingLoader !== "function" || typeof walkPlanner !== "function") return response("unavailable", "Vehicle interception is temporarily unavailable.");
  const controller = new AbortController();
  const sharedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), INTERCEPT_LIMITS.deadlineMs);
  const bounded = (operation) => new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Interception cancelled or timed out."));
    if (sharedSignal.aborted) { abort(); return; }
    sharedSignal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { if (sharedSignal.aborted) throw new Error("Interception cancelled."); return operation(); }).then(resolve, reject).finally(() => sharedSignal.removeEventListener("abort", abort));
  });
  try {
    const [agency, id] = input.vehicleKey.split(":");
    const snapshot = await bounded(() => snapshotLoader({ agency, now: clock(), signal: sharedSignal }));
    if (snapshot?.state === "stale") return response("stale", "The vehicle observation is too old to plan a catch.");
    if (snapshot?.state !== "live" || snapshot.agencyId !== agency || !Array.isArray(snapshot.vehicles) || snapshot.vehicles.length > 10_000) return response("unavailable", "Fresh vehicle data is temporarily unavailable.");
    if (!fresh(snapshot.sourceTimestamp, clock())) return response("stale", "The vehicle observation is too old to plan a catch.");
    const matches = snapshot.vehicles.filter((vehicle) => vehicle?.id === id && vehicle?.agencyId === agency);
    if (!matches.length) return response("vehicle-missing", "The selected vehicle is no longer in the current feed.");
    if (matches.length !== 1) return response("unavailable", "The selected vehicle identity could not be verified.");
    const selected = matches[0];
    if (selected.stale === true || !fresh(selected.timestamp, clock())) return response("stale", "The vehicle observation is too old to plan a catch.");
    if (!rawId(selected.id) || !rawId(selected.tripId) || !rawId(selected.routeId) || selected.vehicleKey != null && selected.vehicleKey !== input.vehicleKey) return response("unavailable", "The selected vehicle trip could not be verified.");
    const vehicle = { id: selected.id, agencyId: agency, label: text(selected.label, 200) ? selected.label : selected.id, tripId: selected.tripId, routeId: selected.routeId, timestamp: selected.timestamp };
    const upcoming = await bounded(() => upcomingLoader({ ...selected, vehicleKey: input.vehicleKey }, { signal: sharedSignal }));
    if (!fresh(snapshot.sourceTimestamp, clock()) || !fresh(selected.timestamp, clock())) return response("stale", "The vehicle observation is too old to plan a catch.");
    if (upcoming?.state === "trip-ended") return response("no-catchable-stop", "No upcoming stop can currently be reached on foot.", { vehicle });
    const feed = upcoming?.vehicle?.tripId?.split(":")[0];
    if (upcoming?.state !== "live" || upcoming.vehicle?.id !== input.vehicleKey || upcoming.vehicle?.agencyId !== agency || !qualifiedId(upcoming.vehicle?.tripId) || upcoming.vehicle.tripId.split(":")[1] !== selected.tripId || !(feed === agency || agency === "ttc" && feed === "ttc-next") || !Array.isArray(upcoming.candidates) || upcoming.candidates.length > INTERCEPT_LIMITS.candidates) return response("unavailable", "Upcoming stop data could not be verified.");
    const seen = new Set();
    const candidates = upcoming.candidates.map((stop) => candidate(stop, feed, clock())).filter((stop) => { if (!stop || seen.has(stop.stop.id)) return false; seen.add(stop.stop.id); return true; });
    const options = []; let index = 0; let failed = false;
    const worker = async () => {
      while (index < candidates.length && !sharedSignal.aborted) {
        const target = candidates[index++]; const requestedAt = clock();
        if (requestedAt >= instant(target.arriveByAt)) continue;
        try {
          const plan = await bounded(() => walkPlanner({ from: point(input.origin), to: { ...target.stop, stopId: target.stop.id }, dateTime: new Date(requestedAt).toISOString(), allowDirectWalking: true, signal: sharedSignal }));
          if (!Array.isArray(plan?.itineraries) || plan.itineraries.length > 10) { failed = true; continue; }
          const walks = plan.itineraries.map((walk) => verifiedWalk(walk, input.origin, target.stop, requestedAt, target.arriveByAt, clock())).filter(Boolean).sort((a, b) => instant(a.endTime) - instant(b.endTime));
          if (walks.length) options.push({ ...target, walk: walks[0], slackSeconds: Math.floor((instant(target.arriveByAt) - instant(walks[0].endTime)) / 1000) });
        } catch { failed = true; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(INTERCEPT_LIMITS.walkConcurrency, candidates.length) }, worker));
    if (sharedSignal.aborted) return response("unavailable", "Vehicle interception was cancelled or timed out.");
    if (!fresh(snapshot.sourceTimestamp, clock()) || !fresh(selected.timestamp, clock())) return response("stale", "The vehicle observation is too old to plan a catch.");
    const current = options.filter((option) => instant(option.arriveByAt) > clock() && instant(option.walk.endTime) >= clock()).sort((a, b) => instant(a.arrivalAt) - instant(b.arrivalAt));
    if (current.length) return { state: "catchable", checkedAt: new Date(clock()).toISOString(), vehicle, options: current };
    return response(failed ? "unavailable" : "no-catchable-stop", failed ? "Walking directions are temporarily unavailable." : "No upcoming stop can currently be reached on foot.", { vehicle });
  } catch { return response("unavailable", sharedSignal.aborted ? "Vehicle interception was cancelled or timed out." : "Vehicle interception is temporarily unavailable."); }
  finally { clearTimeout(timer); controller.abort(); }
}
