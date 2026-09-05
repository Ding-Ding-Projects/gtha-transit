const GRAPHQL = `query Plan($origin:PlanLabeledLocationInput!,$destination:PlanLabeledLocationInput!,$dateTime:PlanDateTimeInput!,$first:Int!,$modes:PlanModesInput!,$preferences:PlanPreferencesInput) {
  planConnection(origin:$origin,destination:$destination,dateTime:$dateTime,first:$first,modes:$modes,preferences:$preferences) {
    edges { node { start end duration walkDistance numberOfTransfers legs {
      mode realTime start { scheduledTime estimated { time delay } } end { scheduledTime estimated { time delay } } duration distance headsign from { name lat lon } to { name lat lon }
      intermediatePlaces { name lat lon }
      route { gtfsId shortName longName mode agency { gtfsId name } }
      trip { gtfsId }
      legGeometry { points }
    } } }
  }
}`;
const DEPARTURES = `query Departures($id:String!,$start:Long!,$timeRange:Int!,$count:Int!) {
  stop(id:$id) { gtfsId name lat lon stoptimesWithoutPatterns(startTime:$start,timeRange:$timeRange,numberOfDepartures:$count,omitCanceled:true) {
    serviceDay scheduledArrival scheduledDeparture realtimeArrival realtimeDeparture realtime headsign
    trip { gtfsId route { gtfsId shortName longName agency { gtfsId name } } }
  } }
}`;

function finiteNumber(value, fallback = null) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function safeText(value) { if (value == null) return null; const text = String(value); return /[\u0000-\u001f\u007f]/.test(text) ? null : text; }
export function publicAgencyFeedId(value) { return value === "ttc-next" ? "ttc" : value; }
function timestamp(value, fallback) { const parsed = Date.parse(value ?? ""); return Number.isFinite(parsed) ? parsed : fallback; }
export function rankItineraries(itineraries, preference, arriveBy) {
  const timing = (item) => arriveBy ? -timestamp(item.startTime, -Infinity) : timestamp(item.endTime, Infinity);
  const key = (item) => preference === "transfers" ? [item.transfers, timing(item), item.duration] : preference === "walking" ? [item.walkDistance, timing(item), item.duration] : [timing(item), item.duration];
  return itineraries.sort((left, right) => { const a = key(left); const b = key(right); for (let index = 0; index < a.length; index += 1) { if (a[index] !== b[index]) return a[index] - b[index]; } return String(left.id).localeCompare(String(right.id)); });
}
function point(raw) {
  if (!raw || finiteNumber(raw.lat) === null || finiteNumber(raw.lon) === null) return null;
  return { name: String(raw.name ?? "").slice(0, 200), lat: finiteNumber(raw.lat), lon: finiteNumber(raw.lon) };
}
function durationSeconds(value) {
  if (typeof value === "number") return Math.max(0, value);
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(String(value ?? ""));
  return match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) : 0;
}
function normalizeLeg(leg, index) {
  const from = point(leg.from); const to = point(leg.to);
  if (!from || !to) return null;
  const tripId = safeText(leg.trip?.gtfsId); const routeId = safeText(leg.route?.gtfsId); const agencyId = safeText(leg.route?.agency?.gtfsId);
  return { index, mode: String(leg.mode ?? "").toUpperCase(), from, to, startTime: leg.start?.estimated?.time ?? leg.start?.scheduledTime ?? null, endTime: leg.end?.estimated?.time ?? leg.end?.scheduledTime ?? null,
    scheduledStartTime: leg.start?.scheduledTime ?? null, scheduledEndTime: leg.end?.scheduledTime ?? null, realtime: Boolean(leg.realTime),
    tripId, routeId, agencyId, agencyFeedId: publicAgencyFeedId(tripId?.includes(":") ? tripId.slice(0, tripId.indexOf(":")) : routeId?.includes(":") ? routeId.slice(0, routeId.indexOf(":")) : null),
    duration: durationSeconds(leg.duration), distance: Math.max(0, finiteNumber(leg.distance, 0)),
    route: leg.route ? safeText(leg.route.shortName ?? leg.route.longName ?? "") : null,
    agency: leg.route?.agency ? safeText(leg.route.agency.name ?? "") : null,
    headsign: safeText(leg.headsign),
    geometry: leg.legGeometry?.points ? String(leg.legGeometry.points) : null,
    intermediateStops: Array.isArray(leg.intermediatePlaces) ? leg.intermediatePlaces.map(point).filter(Boolean).slice(0, 500) : [] };
}
async function queryOtp(otpUrl, timeoutMs, query, variables) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try { response = await fetch(`${otpUrl.replace(/\/$/, "")}/otp/gtfs/v1`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ query, variables }), signal: controller.signal }); }
    catch (cause) { const error = new Error("routing upstream request failed"); error.code = "UPSTREAM"; error.cause = cause; throw error; }
    if (!response.ok) { const error = new Error("routing upstream request failed"); error.code = "UPSTREAM"; throw error; }
    const payload = await response.json();
    if (payload.errors?.length) { const error = new Error("routing upstream rejected the request"); error.code = "UPSTREAM"; error.details = payload.errors; throw error; }
    return payload.data;
  } finally { clearTimeout(timer); }
}

export async function planWithOtp({ otpUrl, timeoutMs, from, to, dateTime, arriveBy, wheelchair, maxWalkDistance, preference, maxResults }) {
  const preferences = {};
  if (wheelchair) preferences.accessibility = { wheelchair: { enabled: true } };
  if (preference === "walking") preferences.street = { walk: { reluctance: 8 } };
  if (preference === "transfers") preferences.street = { walk: { boardCost: 1800 } };
  const variables = {
    origin: { location: { coordinate: { latitude: from.lat, longitude: from.lon } } }, destination: { location: { coordinate: { latitude: to.lat, longitude: to.lon } } },
    dateTime: arriveBy ? { latestArrival: dateTime } : { earliestDeparture: dateTime }, first: maxResults,
    modes: { transitOnly: true, transit: { access: ["WALK"], egress: ["WALK"], transfer: ["WALK"], transit: ["BUS", "RAIL", "SUBWAY", "TRAM"].map((mode) => ({ mode })) } },
    preferences: Object.keys(preferences).length ? preferences : null
  };
  const data = await queryOtp(otpUrl, timeoutMs, GRAPHQL, variables);
  let itineraries = (data?.planConnection?.edges ?? []).map((edge) => edge.node).filter(Boolean).map((item, index) => ({
    id: `otp-${index + 1}-${item.start ?? "unknown"}`, startTime: item.start ?? null, endTime: item.end ?? null,
    duration: durationSeconds(item.duration), walkDistance: Math.max(0, finiteNumber(item.walkDistance, 0)), transfers: Math.max(0, finiteNumber(item.numberOfTransfers, 0)),
    legs: Array.isArray(item.legs) ? item.legs.map(normalizeLeg).filter(Boolean) : []
  })).filter((item) => item.legs.length && item.walkDistance <= maxWalkDistance);
  rankItineraries(itineraries, preference, arriveBy);
  return { itineraries };
}

export async function departuresWithOtp({ otpUrl, timeoutMs, stopId, startTime, timeRange = 7200, maxResults = 25 }) {
  const start = finiteNumber(startTime, Math.floor(Date.now() / 1000)); const range = Math.min(86400, Math.max(60, finiteNumber(timeRange, 7200)));
  const data = await queryOtp(otpUrl, timeoutMs, DEPARTURES, { id: String(stopId).slice(0, 200), start, timeRange: range, count: maxResults });
  const stop = data?.stop; if (!stop) return { departures: [], stop: null };
  const departures = (stop.stoptimesWithoutPatterns ?? []).slice(0, maxResults).map((item) => ({
    scheduledArrival: Number(item.serviceDay) + Number(item.scheduledArrival), scheduledDeparture: Number(item.serviceDay) + Number(item.scheduledDeparture),
    predictedArrival: item.realtime ? Number(item.serviceDay) + Number(item.realtimeArrival) : null, predictedDeparture: item.realtime ? Number(item.serviceDay) + Number(item.realtimeDeparture) : null, realtime: Boolean(item.realtime),
    headsign: safeText(item.headsign), route: item.trip?.route ? safeText(item.trip.route.shortName ?? item.trip.route.longName ?? "") : null,
    agency: item.trip?.route?.agency ? safeText(item.trip.route.agency.name ?? "") : null }));
  return { departures, stop: { id: stop.gtfsId, name: stop.name ?? "", lat: Number(stop.lat), lon: Number(stop.lon) } };
}

export const graphqlDocument = GRAPHQL;

export async function otpReady({ otpUrl, timeoutMs = 2000 }) {
  const data = await queryOtp(otpUrl, timeoutMs, "{ stop(id:\"go:UN\") { name } }", {});
  return data?.stop?.name === "Union Station GO";
}
