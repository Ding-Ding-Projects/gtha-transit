const GRAPHQL = `query Plan($origin:PlanLabeledLocationInput!,$destination:PlanLabeledLocationInput!,$via:[PlanViaLocationInput!],$dateTime:PlanDateTimeInput!,$first:Int!,$modes:PlanModesInput!,$preferences:PlanPreferencesInput) {
  planConnection(origin:$origin,destination:$destination,via:$via,dateTime:$dateTime,first:$first,modes:$modes,preferences:$preferences) {
    edges { node { start end duration walkDistance numberOfTransfers legs {
      mode realTime start { scheduledTime estimated { time delay } } end { scheduledTime estimated { time delay } } duration distance headsign from { name lat lon viaLocationType stop { gtfsId locationType parentStation { gtfsId } } } to { name lat lon viaLocationType stop { gtfsId locationType parentStation { gtfsId } } }
      intermediatePlaces { name lat lon stop { gtfsId locationType parentStation { gtfsId } } }
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
function milliseconds(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.abs(value) < 10_000_000_000 ? value * 1000 : value;
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
const TRANSIT_MODES = new Set(["BUS", "RAIL", "SUBWAY", "TRAM"]);
function isTransitLeg(leg) { return TRANSIT_MODES.has(String(leg?.mode ?? "").toUpperCase()); }
function transferWaitDetails(legs) {
  const list = Array.isArray(legs) ? legs : [];
  const transitIndexes = list.map((leg, index) => isTransitLeg(leg) ? index : -1).filter((index) => index >= 0);
  if (!transitIndexes.length) return { hasTransit: false, known: false, seconds: null };
  if (transitIndexes.length === 1) return { hasTransit: true, known: true, seconds: 0 };
  let seconds = 0;
  for (let index = 1; index < transitIndexes.length; index += 1) {
    const previous = transitIndexes[index - 1]; const next = transitIndexes[index];
    const priorEnd = milliseconds(list[previous].endTime); const nextStart = milliseconds(list[next].startTime);
    if (priorEnd === null || nextStart === null) return { hasTransit: true, known: false, seconds: null };
    let walkingMilliseconds = 0;
    for (let between = previous + 1; between < next; between += 1) {
      const leg = list[between];
      if (String(leg?.mode ?? "").toUpperCase() !== "WALK") return { hasTransit: true, known: false, seconds: null };
      const start = milliseconds(leg.startTime); const end = milliseconds(leg.endTime);
      if (start === null || end === null || end < start) return { hasTransit: true, known: false, seconds: null };
      walkingMilliseconds += end - start;
    }
    const platformWait = nextStart - priorEnd - walkingMilliseconds;
    if (!Number.isFinite(platformWait) || platformWait < 0) return { hasTransit: true, known: false, seconds: null };
    seconds += platformWait / 1000;
  }
  return { hasTransit: true, known: true, seconds };
}
function annotateTransferWait(item) {
  const details = transferWaitDetails(item.legs);
  item.transferWaitSeconds = details.known ? details.seconds : null;
  item.transferWaitKnown = details.known;
  return details;
}
export function rankItineraries(itineraries, preference, arriveBy) {
  const timing = (item) => arriveBy ? -timestamp(item.startTime, -Infinity) : timestamp(item.endTime, Infinity);
  if (preference === "waiting") {
    const waits = new Map();
    let hasTransitOption = false;
    for (const item of itineraries) { const details = annotateTransferWait(item); waits.set(item, details); hasTransitOption ||= details.hasTransit; }
    const key = (item) => {
      const details = waits.get(item);
      return [hasTransitOption && !details.hasTransit ? 1 : 0, details.known ? 0 : 1, details.seconds ?? Infinity, timing(item), item.duration];
    };
    return itineraries.sort((left, right) => { const a = key(left); const b = key(right); for (let index = 0; index < a.length; index += 1) { if (a[index] !== b[index]) return a[index] - b[index]; } return String(left.id).localeCompare(String(right.id)); });
  }
  const key = (item) => preference === "transfers" ? [item.transfers, timing(item), item.duration] : preference === "walking" ? [item.walkDistance, timing(item), item.duration] : [timing(item), item.duration];
  return itineraries.sort((left, right) => { const a = key(left); const b = key(right); for (let index = 0; index < a.length; index += 1) { if (a[index] !== b[index]) return a[index] - b[index]; } return String(left.id).localeCompare(String(right.id)); });
}
function point(raw) {
  if (!raw || finiteNumber(raw.lat) === null || finiteNumber(raw.lon) === null) return null;
  const stopId = safeText(raw.stop?.gtfsId);
  const locationType = safeText(raw.stop?.locationType);
  const parentStationId = safeText(raw.stop?.parentStation?.gtfsId);
  const stationId = parentStationId ?? (locationType === "STATION" ? stopId : null);
  const id = stopId ?? stationId;
  const separator = id?.indexOf(":") ?? -1;
  const agencyFeedId = separator > 0 ? publicAgencyFeedId(id.slice(0, separator)) : null;
  return {
    name: String(raw.name ?? "").slice(0, 200), lat: finiteNumber(raw.lat), lon: finiteNumber(raw.lon),
    ...(id ? { id } : {}), ...(stopId ? { stopId } : {}), ...(stationId ? { stationId } : {}),
    ...(agencyFeedId ? { agencyFeedId } : {}), ...(locationType ? { locationType } : {})
  };
}
function endpoint(raw) {
  const value = point(raw); if (!value) return null;
  const viaLocationType = safeText(raw?.viaLocationType);
  return ["VISIT", "PASS_THROUGH"].includes(viaLocationType) ? { ...value, viaLocationType } : value;
}
function durationSeconds(value) {
  if (typeof value === "number") return Math.max(0, value);
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(String(value ?? ""));
  return match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) : 0;
}
function normalizeLeg(leg, index) {
  const from = endpoint(leg.from); const to = endpoint(leg.to);
  if (!from || !to) return null;
  const tripId = safeText(leg.trip?.gtfsId); const routeGtfsId = safeText(leg.route?.gtfsId); const routeId = routeGtfsId; const agencyId = safeText(leg.route?.agency?.gtfsId);
  return { index, mode: String(leg.mode ?? "").toUpperCase(), from, to, startTime: leg.start?.estimated?.time ?? leg.start?.scheduledTime ?? null, endTime: leg.end?.estimated?.time ?? leg.end?.scheduledTime ?? null,
    scheduledStartTime: leg.start?.scheduledTime ?? null, scheduledEndTime: leg.end?.scheduledTime ?? null, realtime: Boolean(leg.realTime),
    tripId, routeId, routeGtfsId, agencyId, agencyFeedId: publicAgencyFeedId(tripId?.includes(":") ? tripId.slice(0, tripId.indexOf(":")) : routeGtfsId?.includes(":") ? routeGtfsId.slice(0, routeGtfsId.indexOf(":")) : null),
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

function qualifiedStopLocationId(value) {
  const id = safeText(value)?.trim();
  const separator = id?.indexOf(":") ?? -1;
  return separator > 0 && separator < id.length - 1 ? id : null;
}
function visitInput(place) {
  const label = safeText(place?.name ?? place?.label)?.slice(0, 200);
  const stopLocationId = qualifiedStopLocationId(place?.stopId);
  const visit = { minimumWaitTime: "PT0S" };
  if (stopLocationId) visit.stopLocationIds = [stopLocationId];
  else visit.coordinate = { latitude: place.lat, longitude: place.lon };
  if (label) visit.label = label;
  return { visit };
}
const VIA_MATCH_DISTANCE_METRES = 100;
function viaVisitEvents(legs) {
  if (!legs.length) return [];
  return [legs[0].from, ...legs.map((leg) => leg.to)].filter((place) => place?.viaLocationType === "VISIT");
}
function distanceMetres(left, right) {
  if (![left?.lat, left?.lon, right?.lat, right?.lon].every(Number.isFinite)) return Infinity;
  const radians = Math.PI / 180;
  const latitude = (right.lat - left.lat) * radians; const longitude = (right.lon - left.lon) * radians;
  const a = Math.sin(latitude / 2) ** 2 + Math.cos(left.lat * radians) * Math.cos(right.lat * radians) * Math.sin(longitude / 2) ** 2;
  const haversine = Math.min(1, Math.max(0, a));
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}
function matchedViaCount(legs, via) {
  let matched = 0;
  for (const visit of viaVisitEvents(legs)) {
    if (matched >= via.length) break;
    const requestedStopId = qualifiedStopLocationId(via[matched]?.stopId);
    if (requestedStopId ? visit.stopId === requestedStopId : distanceMetres(visit, via[matched]) <= VIA_MATCH_DISTANCE_METRES) matched += 1;
  }
  return matched;
}
function segmentPoint(place) { return { name: safeText(place?.name) ?? null, lat: place?.lat ?? null, lon: place?.lon ?? null }; }
function firstUnverifiedSegment(from, to, via, completed) {
  if (completed >= via.length) return null;
  return { from: segmentPoint(completed ? via[completed - 1] : from), to: segmentPoint(via[completed] ?? to), state: "unverified" };
}

export async function planWithOtp({ otpUrl, timeoutMs, from, to, via = [], dateTime, arriveBy, wheelchair, maxWalkDistance, preference, maxResults }) {
  const requestedVia = Array.isArray(via) ? via : [];
  const preferences = {};
  if (wheelchair) preferences.accessibility = { wheelchair: { enabled: true } };
  if (preference === "walking") preferences.street = { walk: { reluctance: 8 } };
  if (preference === "transfers") preferences.street = { walk: { boardCost: 1800 } };
  const variables = {
    origin: { location: { coordinate: { latitude: from.lat, longitude: from.lon } } }, destination: { location: { coordinate: { latitude: to.lat, longitude: to.lon } } },
    via: requestedVia.length ? requestedVia.map(visitInput) : null,
    dateTime: arriveBy ? { latestArrival: dateTime } : { earliestDeparture: dateTime }, first: requestedVia.length ? 1 : maxResults,
    modes: { transitOnly: true, transit: { access: ["WALK"], egress: ["WALK"], transfer: ["WALK"], transit: ["BUS", "RAIL", "SUBWAY", "TRAM"].map((mode) => ({ mode })) } },
    preferences: Object.keys(preferences).length ? preferences : null
  };
  const data = await queryOtp(otpUrl, timeoutMs, GRAPHQL, variables);
  const candidates = (data?.planConnection?.edges ?? []).map((edge) => edge.node).filter(Boolean).map((item, index) => {
    const legs = Array.isArray(item.legs) ? item.legs.map(normalizeLeg).filter(Boolean) : [];
    const transferWait = transferWaitDetails(legs);
    const itinerary = {
      id: `otp-${index + 1}-${item.start ?? "unknown"}`, startTime: item.start ?? null, endTime: item.end ?? null,
      duration: durationSeconds(item.duration), walkDistance: Math.max(0, finiteNumber(item.walkDistance, 0)), transfers: Math.max(0, finiteNumber(item.numberOfTransfers, 0)),
      transferWaitSeconds: transferWait.known ? transferWait.seconds : null, transferWaitKnown: transferWait.known, legs
    };
    if (requestedVia.length) { itinerary.viaVisitCount = matchedViaCount(legs, requestedVia); itinerary.viaComplete = itinerary.viaVisitCount === requestedVia.length; }
    return itinerary;
  });
  let itineraries = candidates.filter((item) => item.legs.length && item.walkDistance <= maxWalkDistance);
  if (requestedVia.length) {
    const completed = Math.max(0, ...candidates.map((item) => item.viaVisitCount));
    itineraries = itineraries.filter((item) => item.viaComplete);
    rankItineraries(itineraries, preference, arriveBy);
    return { itineraries: itineraries.slice(0, 1), failedSegment: itineraries.length ? null : firstUnverifiedSegment(from, to, requestedVia, completed) };
  }
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
