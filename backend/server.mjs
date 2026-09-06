import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { calendarDateInTimeZone, coverage, coverageContextForDate, graphProvenance, searchPlaces } from "./places.mjs";
import { blockPredecessorWithOtp, departuresWithOtp, otpReady, planWithOtp } from "./otp-client.mjs";
import { applyWashroomPreference, resolvedWashroomRegistry, washroomForPublishedPlace } from "./washrooms.mjs";
import { isCalendarDate, routeCatalogPageFromIndex } from "./routes.mjs";
import { publishedStopForId, routeStopAnchors } from "./stop-routes.mjs";
import { planWithRequiredLine } from "./required-line.mjs";
import { planWashroomDetour } from "./washroom-detour.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(here, "config.json"), "utf8"));
const otpUrl = process.env.OTP_URL ?? config.otpUrl;
const max = config.maxBodyBytes;
const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve, reject) => {
  let data = "";
  req.on("data", (chunk) => { data += chunk; if (Buffer.byteLength(data) > max) { reject(new Error("request body exceeds limit")); req.destroy(); } });
  req.on("end", () => resolve(data)); req.on("error", reject);
});
const number = (value, name) => { if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) throw new Error(`${name} must be a finite number`); const n = Number(value); if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number`); return n; };
const coordinates = (raw, name) => ({ lat: bounded(raw?.lat, `${name}.lat`, -90, 90), lon: bounded(raw?.lon, `${name}.lon`, -180, 180) });
const bounded = (value, name, min, max) => { const n = number(value, name); if (n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}`); return n; };
const nonNegativeInteger = (value, name, max) => { const n = bounded(value, name, 0, max); if (!Number.isInteger(n)) throw new Error(`${name} must be an integer`); return n; };
const MAX_VIA_PLACES = 5;
const VERIFIED_STOP_COORDINATE_TOLERANCE_METRES = 50;
const placeLabel = (raw, name) => {
  const value = raw?.name ?? raw?.label; if (value == null) return null;
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  const label = value.trim();
  if (Buffer.byteLength(label, "utf8") > 200) throw new Error(`${name} must be at most 200 bytes`);
  if (/[\u0000-\u001f\u007f]/.test(label)) throw new Error(`${name} contains control characters`);
  return label || null;
};
const qualifiedStopLocationId = (value) => {
  if (typeof value !== "string") return null;
  const id = value.trim();
  const separator = id.indexOf(":");
  return id.length <= 120 && separator > 0 && separator < id.length - 1 && !/[\u0000-\u001f\u007f]/.test(id) ? id : null;
};
const distanceMetres = (left, right) => {
  const latA = Number(left?.lat), lonA = Number(left?.lon), latB = Number(right?.lat), lonB = Number(right?.lon);
  if (![latA, lonA, latB, lonB].every(Number.isFinite)) return Infinity;
  const radians = Math.PI / 180;
  const latitude = (latB - latA) * radians; const longitude = (lonB - lonA) * radians;
  const haversine = Math.min(1, Math.max(0, Math.sin(latitude / 2) ** 2 + Math.cos(latA * radians) * Math.cos(latB * radians) * Math.sin(longitude / 2) ** 2));
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};
const candidateStopIds = (place) => [...new Set([place?.stopId, place?.id, place?.stationId].map(qualifiedStopLocationId).filter(Boolean))];
export async function resolveViaPlaces(raw, { date = null, lookup = publishedStopForId } = {}) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error("via must be an array");
  if (raw.length > MAX_VIA_PLACES) throw new Error("via may contain at most 5 places");
  return Promise.all(raw.map(async (place, index) => {
    const coordinate = coordinates(place, `via[${index}]`);
    const value = { ...coordinate, name: placeLabel(place, `via[${index}].name`) };
    for (const requestedId of candidateStopIds(place)) {
      let published = null;
      try { published = await lookup(requestedId, { date }); } catch { continue; }
      const resolvedId = qualifiedStopLocationId(published?.id);
      if (resolvedId && distanceMetres(coordinate, published) <= VERIFIED_STOP_COORDINATE_TOLERANCE_METRES) return { ...value, stopId: resolvedId };
    }
    return value;
  }));
}

/** How many legs in one plan may ask the routing engine for their block chain. */
const MAX_BLOCK_LOOKUPS = 4;

/**
 * Attach the previous trip on each transit leg's own block.
 *
 * Only for legs that have not departed, because that is when a rider wants to
 * know which vehicle is coming and the leg's own trip has nobody on it yet. The
 * work is bounded per plan: a block lookup is three routing queries, and a plan
 * with ten itineraries would otherwise make thirty.
 */
async function attachBlockPredecessors(itineraries, atMillis) {
  const seen = new Map();
  let lookups = 0;
  for (const itinerary of itineraries ?? []) {
    for (const leg of itinerary?.legs ?? []) {
      if (!leg || leg.mode === "WALK" || !leg.tripId || !leg.routeId) continue;
      const startsAt = Date.parse(leg.startTime);
      if (!Number.isFinite(startsAt) || startsAt <= atMillis) continue;
      if (seen.has(leg.tripId)) { leg.blockChain = seen.get(leg.tripId); continue; }
      if (lookups >= MAX_BLOCK_LOOKUPS) continue;
      lookups += 1;
      try {
        const chain = await blockPredecessorWithOtp({ otpUrl, timeoutMs: config.requestTimeoutMs, tripId: leg.tripId, routeId: leg.routeId, atMillis });
        if (chain) { seen.set(leg.tripId, chain); leg.blockChain = chain; }
      } catch {
        // A block chain is an extra. Its absence never fails a journey.
      }
    }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") {
      try { const ready = await otpReady({ otpUrl }); return json(res, ready ? 200 : 503, { ok: ready, service: "gtha-transit-routing", router: ready ? "ready" : "unavailable" }); }
      catch { return json(res, 503, { ok: false, service: "gtha-transit-routing", router: "unavailable", code: "ROUTER_UNAVAILABLE" }); }
    }
    if (req.method === "GET" && url.pathname === "/api/places") {
      const date = url.searchParams.get("date");
      if (date && !isCalendarDate(date)) throw Error("date must be a real YYYY-MM-DD date");
      return json(res, 200, { places: await searchPlaces(url.searchParams.get("q"), 20, { date }) });
    }
    if (req.method === "GET" && url.pathname === "/api/stop-routes") {
      const stopId = url.searchParams.get("stopId"), date = url.searchParams.get("date"), at = url.searchParams.get("at");
      if (!stopId || stopId.length > 120 || !stopId.includes(":") || /[\u0000-\u001f\u007f]/.test(stopId)) throw Error("An exact qualified stopId is required");
      if (date && !isCalendarDate(date)) throw Error("date must be a real YYYY-MM-DD date");
      if (at && (!Number.isFinite(Date.parse(at)) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(at))) throw Error("at must be an ISO timestamp with an offset");
      const stop = await publishedStopForId(stopId, { date });
      return json(res, 200, { stop, routes: stop?.servingRoutes ?? [], washroom: stop ? await washroomForPublishedPlace(stop, { at: at ?? new Date() }) : null });
    }
    if (req.method === "GET" && url.pathname === "/api/routes") {
      if (Buffer.byteLength(req.url ?? "") > max) throw new Error("query exceeds limit");
      const limit = url.searchParams.get("limit") == null ? 50 : nonNegativeInteger(url.searchParams.get("limit"), "limit", 200);
      if (limit < 1) throw new Error("limit must be between 1 and 200");
      const offset = url.searchParams.get("offset") == null ? 0 : nonNegativeInteger(url.searchParams.get("offset"), "offset", 1_000_000);
      const date = url.searchParams.get("date"); if (date && !isCalendarDate(date)) throw new Error("date must be a real YYYY-MM-DD calendar date");
      return json(res, 200, await routeCatalogPageFromIndex({ agency: url.searchParams.get("agency"), query: url.searchParams.get("q"), date, limit, offset, cursor: url.searchParams.get("cursor") }));
    }
    if (req.method === "GET" && url.pathname === "/api/coverage") return json(res, 200, await coverage());
    if (req.method === "GET" && url.pathname === "/api/integrations/status") {
      try { const response = await fetch("http://127.0.0.1:8788/internal/metrolinx/status", { signal: AbortSignal.timeout(2000) }); if (!response.ok) throw new Error(); return json(res, 200, { metrolinx: await response.json() }); }
      catch { return json(res, 200, { metrolinx: { configured: false, agencies: [{ id: "go", state: "unavailable", capabilities: ["trip_updates", "vehicle_positions", "service_alerts"] }, { id: "up", state: "unavailable", capabilities: ["trip_updates", "vehicle_positions", "service_alerts"] }] } }); }
    }
    if (req.method === "GET" && url.pathname === "/api/vehicles/metrolinx") {
      const agency = url.searchParams.get("agency");
      if (!new Set(["go", "up"]).has(agency)) return json(res, 400, { error: "agency must be go or up", code: "INVALID_AGENCY" });
      try {
        const response = await fetch(`http://127.0.0.1:8788/internal/metrolinx/${agency}/vehicles`, { signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error();
        const body = Buffer.from(await response.arrayBuffer());
        res.writeHead(200, { "content-type": "application/x-google-protobuf", "content-length": body.length, "cache-control": "private, max-age=10" }); res.end(body); return;
      } catch { return json(res, 503, { error: "Live vehicle data is temporarily unavailable.", code: "VEHICLE_DATA_UNAVAILABLE" }); }
    }
    if (req.method === "GET" && url.pathname === "/api/alerts/metrolinx") {
      const agency = url.searchParams.get("agency");
      if (!new Set(["go", "up"]).has(agency)) return json(res, 400, { error: "agency must be go or up", code: "INVALID_AGENCY" });
      try {
        const response = await fetch(`http://127.0.0.1:8788/internal/metrolinx/${agency}/alerts`, { signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error();
        const body = Buffer.from(await response.arrayBuffer());
        res.writeHead(200, { "content-type": "application/x-google-protobuf", "content-length": body.length, "cache-control": "private, max-age=30" }); res.end(body); return;
      } catch { return json(res, 503, { error: "Live service alerts are temporarily unavailable for this agency.", code: "ALERT_DATA_UNAVAILABLE" }); }
    }
    if (req.method === "GET" && url.pathname === "/api/departures") {
      const stopId = url.searchParams.get("stopId"); if (!stopId) throw new Error("stopId is required");
      return json(res, 200, await departuresWithOtp({ otpUrl, timeoutMs: config.requestTimeoutMs, stopId, startTime: url.searchParams.get("startTime"), timeRange: url.searchParams.get("timeRange"), maxResults: config.maxResults }));
    }
    if (req.method === "POST" && url.pathname === "/api/plan") {
      const input = JSON.parse(await readBody(req));
      const from = coordinates(input.from, "from"); const to = coordinates(input.to, "to");
      const dateTime = typeof input.dateTime === "string" && Number.isFinite(Date.parse(input.dateTime)) ? input.dateTime : null;
      if (!dateTime || !/[+-]\d\d:\d\d$|Z$/i.test(dateTime)) throw new Error("dateTime must be an ISO 8601 timestamp with an offset");
      const provenance = await graphProvenance();
      const via = await resolveViaPlaces(input.via, { date: calendarDateInTimeZone(dateTime, provenance.timezone ?? "America/Toronto") });
      const preference = input.preference ?? "fastest";
      if (!["fastest", "transfers", "walking", "waiting"].includes(preference)) throw new Error("preference must be fastest, transfers, walking, or waiting");
      const request = { otpUrl, timeoutMs: config.requestTimeoutMs, from, to, via, dateTime, arriveBy: Boolean(input.arriveBy), wheelchair: Boolean(input.wheelchair), maxWalkDistance: bounded(input.maxWalkDistance ?? 2000, "maxWalkDistance", 0, 20000), preference, maxResults: config.maxResults };
      const result = input.requiredRoute != null ? await planWithRequiredLine({ ...request, requiredRoute: input.requiredRoute }, { planWithOtp, routeStopAnchors }) : await planWithOtp(request);
      if (input.requiredRoute != null && !result.itineraries.length) return json(res, 422, { error: "No complete journey riding the selected line was found in this bounded search", code: "REQUIRED_LINE_UNRESOLVED", requiredLine: result.requiredLine, itineraries: [], data: provenance });
      if (via.length && !result.itineraries.length) return json(res, 422, { error: "No complete itinerary visits every requested stop", code: "MULTI_STOP_INCOMPLETE", itineraries: [], failedSegment: result.failedSegment ?? null, data: provenance, coverage: coverageContextForDate(provenance, calendarDateInTimeZone(dateTime, provenance.timezone)) });
      const preferred = await applyWashroomPreference(result.itineraries, Boolean(input.preferWashrooms));
      await attachBlockPredecessors(preferred.itineraries, Date.parse(dateTime));
      return json(res, 200, { ...preferred, requiredLine: result.requiredLine ?? null, data: provenance, coverage: result.itineraries.length ? null : coverageContextForDate(provenance, calendarDateInTimeZone(dateTime, provenance.timezone)) });
    }
    if (req.method === "POST" && url.pathname === "/api/plan-washroom-detour") {
      const input = JSON.parse(await readBody(req));
      const registry = await resolvedWashroomRegistry();
      const stopIndex = JSON.parse(await readFile(path.join(here, "../data/stops.json"), "utf8"));
      const result = await planWashroomDetour(input, { facilityRegistry: registry, stopIndex, planWithOtp: (request) => planWithOtp({ ...request, otpUrl, timeoutMs: Math.min(config.requestTimeoutMs, request.timeoutMs ?? config.requestTimeoutMs) }) });
      return json(res, 200, result);
    }
    return json(res, 404, { error: "route not found" });
  } catch (error) { const upstream = error.name === "AbortError" || error.code === "UPSTREAM"; return json(res, upstream ? 503 : 400, { error: upstream ? "routing service is temporarily unavailable" : String(error.message ?? error) }); }
});

const port = Number(process.env.PORT ?? 8787);
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) server.listen(port, process.env.HOST ?? "0.0.0.0", () => console.log(`routing backend listening on port ${port}`));
export { server };
