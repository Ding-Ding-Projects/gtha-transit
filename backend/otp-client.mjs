const GRAPHQL = `query Plan($origin:PlanLabeledLocationInput!, $destination:PlanLabeledLocationInput!, $dateTime:PlanDateTimeInput, $first:Int, $modes:PlanModesInput, $wheelchair:Boolean) {
  planConnection(origin:$origin,destination:$destination,dateTime:$dateTime,first:$first,modes:$modes,preferences:{wheelchair:$wheelchair}) {
    edges { node { startTime endTime duration walkDistance numberOfTransfers legs {
      mode startTime endTime duration distance route { shortName longName type } agency { id name } headsign
      from { name lat lon } to { name lat lon }
      intermediateStops { name lat lon }
      legGeometry { points }
    } } }
  }
}`;
const DEPARTURES = `query Departures($id: String!, $start: Long, $timeRange: Int) {
  stop(id:$id) { name lat lon stoptimesWithoutPatterns(startTime:$start,timeRange:$timeRange) {
    scheduledArrival scheduledDeparture headsign trip { route { shortName longName } agency { id name } }
  } }
}`;

function finiteNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function point(raw) {
  if (!raw || finiteNumber(raw.lat) === null || finiteNumber(raw.lon) === null) return null;
  return { name: String(raw.name ?? "").slice(0, 200), lat: finiteNumber(raw.lat), lon: finiteNumber(raw.lon) };
}

function normalizeLeg(leg, index) {
  const from = point(leg.from);
  const to = point(leg.to);
  if (!from || !to) return null;
  return {
    mode: String(leg.mode ?? "").toUpperCase(),
    from,
    to,
    startTime: leg.startTime ?? null,
    endTime: leg.endTime ?? null,
    duration: Math.max(0, finiteNumber(leg.duration, 0)),
    route: leg.route?.shortName ?? leg.route?.longName ?? null,
    agency: leg.agency?.name ?? null,
    headsign: leg.headsign ?? null,
    geometry: leg.legGeometry?.points ?? null,
    intermediateStops: Array.isArray(leg.intermediateStops) ? leg.intermediateStops.map(point).filter(Boolean).slice(0, 500) : [],
    index
  };
}

export async function planWithOtp({ otpUrl, timeoutMs, from, to, dateTime, arriveBy = false, wheelchair = false, maxWalkDistance = 2000, preference = "fastest", modes, maxResults }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${otpUrl.replace(/\/$/, "")}/otp/routers/default/index/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query: GRAPHQL, variables: { origin: { location: { coordinate: { latitude: from.lat, longitude: from.lon } } }, destination: { location: { coordinate: { latitude: to.lat, longitude: to.lon } } }, dateTime: dateTime ? (arriveBy ? { latestArrival: dateTime } : { earliestDeparture: dateTime }) : null, first: Math.min(maxResults, 10), modes, wheelchair, maxWalkDistance, preference } }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`OTP responded with HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.errors?.length) throw new Error(payload.errors.map((error) => error.message).join("; "));
    const edges = payload.data?.planConnection?.edges;
    if (!Array.isArray(edges)) throw new Error("OTP response omitted planConnection.edges");
    const itineraries = edges.map((edge) => edge.node).filter(Boolean).slice(0, maxResults).map((item, index) => ({
      id: `otp-${index + 1}-${item.startTime ?? "unknown"}`,
      startTime: item.startTime ?? null,
      endTime: item.endTime ?? null,
      duration: Math.max(0, finiteNumber(item.duration, 0)),
      walkDistance: Math.max(0, finiteNumber(item.walkDistance, 0)),
      transfers: Math.max(0, finiteNumber(item.numberOfTransfers, 0)),
      legs: Array.isArray(item.legs) ? item.legs.map(normalizeLeg).filter(Boolean) : []
    })).filter((item) => item.legs.length > 0);
    return { itineraries, data: { source: "OpenTripPlanner", endpoint: `${otpUrl}/otp/routers/default/index/graphql` } };
  } finally {
    clearTimeout(timer);
  }
}

export async function departuresWithOtp({ otpUrl, timeoutMs, stopId, startTime, timeRange = 7200, maxResults = 25 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${otpUrl.replace(/\/$/, "")}/otp/routers/default/index/graphql`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query: DEPARTURES, variables: { id: String(stopId).slice(0, 200), start: Number(startTime ?? Math.floor(Date.now() / 1000)), timeRange: Math.min(86400, Math.max(60, Number(timeRange))) } }), signal: controller.signal
    });
    if (!response.ok) throw new Error(`OTP responded with HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.errors?.length) throw new Error(payload.errors.map((error) => error.message).join("; "));
    const stop = payload.data?.stop;
    if (!stop) return { departures: [], data: { source: "OpenTripPlanner", stopId } };
    const departures = (stop.stoptimesWithoutPatterns ?? []).slice(0, maxResults).map((item) => ({
      scheduledArrival: item.scheduledArrival ?? null, scheduledDeparture: item.scheduledDeparture ?? null,
      headsign: item.headsign ?? null, route: item.trip?.route ? { shortName: item.trip.route.shortName ?? null, longName: item.trip.route.longName ?? null } : null,
      agency: item.trip?.route?.agency ?? item.trip?.agency ?? null
    }));
    return { departures, stop: { name: stop.name ?? "", lat: Number(stop.lat), lon: Number(stop.lon) }, data: { source: "OpenTripPlanner", stopId } };
  } finally { clearTimeout(timer); }
}

export const graphqlDocument = GRAPHQL;
