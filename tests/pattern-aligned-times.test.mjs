import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { alignedPatternAnchor, patternAlignedTimesWithOtp, ALIGNED_TIMETABLE_DISCLOSURE } from "../backend/otp-client.mjs";
import { routeStopAnchorsFromIndexes } from "../backend/stop-routes.mjs";
import { cachedRouteAnchors, upcomingForCollector } from "../backend/catch-vehicle.mjs";
import { parseVehicleFeed, combineVehicleSnapshots } from "../vehicles/index.mjs";
import { encodeFeed } from "../backend/ttc-trip-matcher.mjs";

const NOW = Date.parse("2026-09-09T16:00:00Z");
function sourceAnchors() {
  const routes = { routes: [{ id: "ttc-next:501", routeId: "501", feedId: "ttc", version: "ttc-next" }] };
  const patterns = { routePatterns: { "ttc-next:501": [{ id: "ttc-next:501:north", directionId: "0", stops: ["A", "B", "C", "D"].map((name, index) => ({ id: `ttc-next:${name}`, name, sequence: index + 1, lat: 43.7 + index * 0.01, lon: -79.4 })) }] } };
  return routeStopAnchorsFromIndexes(routes, patterns, "ttc-next:501");
}
const position = { feedId: "ttc-next", routeId: "501", lat: 43.705, lon: -79.4, bearing: 0, atMillis: NOW };

async function otp(context, { at = NOW, day = Date.parse("2026-09-09T04:00:00Z") / 1000, mutateDepartures = () => {}, mutateTrip = () => {} } = {}) {
  const calls = []; const anchors = sourceAnchors();
  const stops = anchors.patterns[0].stops.map((stop, index) => ({ stop: { gtfsId: stop.id, name: stop.name, lat: stop.lat, lon: stop.lon }, serviceDay: day, scheduledArrival: at / 1000 - day - 240 + index * 600, scheduledDeparture: at / 1000 - day - 240 + index * 600, realtime: true, realtimeArrival: at / 1000 - day + 9999, realtimeDeparture: at / 1000 - day + 9999, realtimeState: "UPDATED" }));
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body); calls.push(input);
    let data;
    if (input.query.includes("query Departures")) {
      const entries = [{ serviceDay: day, scheduledArrival: stops[1].scheduledArrival, scheduledDeparture: stops[1].scheduledDeparture, trip: { gtfsId: "ttc-next:sample-trip", route: { gtfsId: "ttc-next:501" } } }]; mutateDepartures(entries);
      data = { stop: { gtfsId: "ttc-next:B", stoptimesWithoutPatterns: entries } };
    } else if (input.variables.id === "ttc-next:unjoinable") data = { trip: null };
    else { const trip = { gtfsId: "ttc-next:sample-trip", route: { gtfsId: "ttc-next:501", shortName: "501" }, stoptimesForDate: structuredClone(stops) }; mutateTrip(trip); data = { trip }; }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ data }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => { server.closeAllConnections(); server.close(); });
  return { otpUrl: `http://127.0.0.1:${server.address().port}`, calls, anchors };
}

test("source-normalized route segments enforce radius, bearing and unique pattern identity", () => {
  const anchors = sourceAnchors(); const selected = alignedPatternAnchor({ ...position, anchors });
  assert.equal(selected.state, "aligned"); assert.equal(selected.to.id, "ttc-next:B"); assert.ok(Math.abs(selected.progress - 0.5) < 0.00001);
  assert.equal(alignedPatternAnchor({ ...position, anchors, lon: -79.398 }).state, "off-pattern");
  assert.equal(alignedPatternAnchor({ ...position, anchors, bearing: 61 }).state, "off-pattern");
  assert.equal(alignedPatternAnchor({ ...position, anchors, bearing: 60 }).state, "aligned");
  for (const invalid of [{ lat: null }, { lon: "-79.4" }, { lat: 91 }, { bearing: null }, { bearing: 360 }]) assert.equal(alignedPatternAnchor({ ...position, anchors, ...invalid }).state, "unavailable");
  anchors.patterns.push({ ...structuredClone(anchors.patterns[0]), id: "ttc-next:501:branch" });
  assert.equal(alignedPatternAnchor({ ...position, anchors }).state, "ambiguous");
});

test("timetable offsets use reported segment progress and never inherit publisher prediction labels", async (context) => {
  const fixture = await otp(context);
  const result = await patternAlignedTimesWithOtp({ ...position, ...fixture, timeoutMs: 1000 });
  assert.equal(fixture.calls.length, 2); assert.equal(result.state, "aligned");
  assert.ok(Math.abs(result.alignment.offsetSeconds + 60) < 0.01); assert.equal(result.alignment.anchorStopId, "ttc-next:B");
  assert.equal(result.stops[0].alignedArrival, new Date(NOW + 300000).toISOString());
  assert.ok(result.stops.every((stop) => stop.basis === "aligned-timetable" && !Object.hasOwn(stop, "arrivalAt")));
  assert.equal(result.confirmedTrip, false); assert.equal(result.trip.confirmed, false); assert.equal(result.disclosure, ALIGNED_TIMETABLE_DISCLOSURE);
  assert.deepEqual(fixture.calls[0].variables, { id: "ttc-next:B", start: NOW / 1000 - 3600, timeRange: 7200, count: 200 });
});

test("calendar crossover uses the chosen timetable service day, including after-midnight offsets", async (context) => {
  const at = Date.parse("2026-09-10T04:05:00Z"); const fixture = await otp(context, { at });
  const result = await patternAlignedTimesWithOtp({ ...position, ...fixture, atMillis: at });
  assert.equal(result.state, "aligned"); assert.equal(fixture.calls[1].variables.date, "20260909");
  assert.equal(result.stops[0].alignedArrival, new Date(at + 300000).toISOString());
});

test("equally near timetable trips, wrong trip patterns and unavailable stop times fail closed", async (context) => {
  const ambiguous = await otp(context, { mutateDepartures(entries) { entries.push({ ...entries[0], trip: { ...entries[0].trip, gtfsId: "ttc-next:other-trip" } }); } });
  assert.equal((await patternAlignedTimesWithOtp({ ...position, ...ambiguous })).state, "ambiguous"); assert.equal(ambiguous.calls.length, 1);
  const wrong = await otp(context, { mutateTrip(trip) { trip.stoptimesForDate[2].stop.gtfsId = "ttc-next:wrong-branch"; } });
  assert.equal((await patternAlignedTimesWithOtp({ ...position, ...wrong })).state, "ambiguous");
  const missing = await otp(context, { mutateTrip(trip) { trip.stoptimesForDate[0].stop.lat = null; } });
  assert.equal((await patternAlignedTimesWithOtp({ ...position, ...missing })).state, "ambiguous");
  const cancel = new AbortController(); cancel.abort();
  await assert.rejects(patternAlignedTimesWithOtp({ ...position, ...wrong, signal: cancel.signal }), { name: "AbortError" });
});

test("actual collector positions use at most three OTP calls after a failed exact TTC join", async (context) => {
  const fixture = await otp(context);
  const bytes = encodeFeed({ header: { timestamp: NOW / 1000 }, vehiclePositions: [{ id: "observed", vehicle: { id: "42" }, timestamp: NOW / 1000, trip: { tripId: "unjoinable", routeId: "501", startDate: "20260909" }, position: { latitude: 43.705, longitude: -79.4, bearing: 0 } }] });
  const vehicle = combineVehicleSnapshots([parseVehicleFeed(bytes, { now: NOW, agencyId: "ttc" })]).vehicles[0];
  const result = await upcomingForCollector({ snapshot: vehicle }, { otpUrl: fixture.otpUrl, now: NOW, anchorsLoader: async () => fixture.anchors });
  assert.equal(result.state, "live"); assert.equal(fixture.calls.length, 3); assert.equal(result.candidates.length, 3);
  assert.equal(result.method, "position-aligned-timetable"); assert.equal(result.disclosure, ALIGNED_TIMETABLE_DISCLOSURE);
  assert.equal(result.vehicle.tripId, "ttc-next:unjoinable"); assert.equal(result.trip.confirmed, false); assert.equal(Object.hasOwn(result.vehicle, "position"), false);
  assert.ok(result.candidates.every((stop) => stop.basis === "aligned-timetable" && Date.parse(stop.arriveByAt) === Date.parse(stop.alignedArrival) - 120000));
});

test("route anchors have a bounded ten-minute cache and no rider-coordinate admission", async () => {
  let calls = 0; const loader = async () => { calls++; return sourceAnchors(); }; const reference = { feedId: "ttc", routeId: "501" };
  await cachedRouteAnchors(reference, { date: "2026-09-09", now: NOW, loader });
  await cachedRouteAnchors(reference, { date: "2026-09-09", now: NOW + 599999, loader }); assert.equal(calls, 1);
  await cachedRouteAnchors(reference, { date: "2026-09-09", now: NOW + 600000, loader }); assert.equal(calls, 2);
  const result = await upcomingForCollector({ snapshot: {}, origin: { lat: 43.7, lon: -79.4 } }); assert.equal(result.state, "invalid-input");
});

test("cancelled stops and backwards timetable chronology cannot become unlabelled estimates", async (context) => {
  const cancelled = await otp(context, { mutateTrip(trip) { trip.stoptimesForDate[2].realtimeState = "CANCELED"; } });
  const result = await patternAlignedTimesWithOtp({ ...position, ...cancelled });
  assert.equal(result.state, "aligned"); assert.equal(result.stops.some((stop) => stop.id === "ttc-next:C"), false);
  const backwards = await otp(context, { mutateTrip(trip) { trip.stoptimesForDate[2].scheduledArrival -= 9999; } });
  assert.equal((await patternAlignedTimesWithOtp({ ...position, ...backwards })).state, "unavailable");
  const absent = await otp(context, { mutateTrip(trip) { trip.stoptimesForDate[2].scheduledArrival = null; trip.stoptimesForDate[2].scheduledDeparture = null; } });
  assert.equal((await patternAlignedTimesWithOtp({ ...position, ...absent })).state, "unavailable");
});
