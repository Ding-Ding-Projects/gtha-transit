import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { planIntercept, INTERCEPT_LIMITS } from "../server/intercept.mjs";
import { getVehicleSnapshot, parseVehicleFeed, clearVehicleCache } from "../vehicles/index.mjs";
import { collectorSnapshot, interceptCandidates } from "../backend/catch-vehicle.mjs";
import { encodeFeed } from "../backend/ttc-trip-matcher.mjs";
import { planWithOtp } from "../backend/otp-client.mjs";

const NOW = Date.parse("2026-09-09T16:00:00Z");
const iso = (seconds = 0) => new Date(NOW + seconds * 1000).toISOString();
const origin = { lat: 43.7, lon: -79.4, name: "Current position" };
const input = { vehicleKey: "miway:42", origin };

function publisherBytes() {
  return encodeFeed({ header: { timestamp: NOW / 1000 }, vehiclePositions: [{ id: "position", vehicle: { id: "42", label: "Bus 42" }, timestamp: NOW / 1000, trip: { tripId: "trip-42", routeId: "42", startDate: "20260909" }, position: { latitude: 43.68, longitude: -79.39 }, stopId: "stop-0", currentStopSequence: 1, currentStatus: 2 }] });
}

function fixture() {
  const snapshot = parseVehicleFeed(publisherBytes(), { now: NOW, agencyId: "miway", fetchedAt: iso() });
  const calls = { snapshot: [], upcoming: [], walk: [] };
  const stop = (index) => ({ id: `miway:stop-${index}`, name: `Stop ${index}`, lat: 43.701 + index * 0.001, lon: -79.401, scheduledArrivalAt: iso(300 + index * 120), realtimeState: "SCHEDULED" });
  const dependencies = {
    now: () => NOW,
    snapshotLoader: async (options) => { calls.snapshot.push(options); return snapshot; },
    upcomingLoader: async (vehicle, options) => { calls.upcoming.push({ vehicle, options }); return { state: "live", vehicle: collectorSnapshot({ snapshot: vehicle }, NOW), candidates: interceptCandidates({ stops: [stop(0), stop(1), stop(2)], now: NOW }) }; },
    walkPlanner: async (request) => { calls.walk.push(request); return { itineraries: [walking(request)] }; },
  };
  return { snapshot, calls, stop, dependencies };
}

function walking(request, { duration = 60, mode = "WALK" } = {}) {
  const startTime = iso(); const endTime = iso(duration);
  return { id: "otp-walk", startTime, endTime, transfers: 0, duration, walkDistance: 150, legs: [{ mode, from: { ...request.from }, to: { ...request.to }, startTime, endTime, duration, distance: 150, tripId: null, routeId: null, geometry: "_p~iF~ps|U_ulLnnqC_mqNvxq`@", intermediateStops: [] }] };
}

test("real getVehicleSnapshot output selects the raw vehicle and produces bounded walking options", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gtha-intercept-"));
  context.after(async () => { clearVehicleCache(); await rm(directory, { recursive: true, force: true }); });
  const fixturePath = path.join(directory, "vehicles.pb"); await writeFile(fixturePath, publisherBytes());
  const { calls, dependencies } = fixture();
  dependencies.snapshotLoader = async (options) => { calls.snapshot.push(options); return getVehicleSnapshot({ ...options, fixturePath, force: true }); };
  const result = await planIntercept(input, dependencies);
  assert.equal(result.state, "catchable"); assert.equal(result.options.length, 3);
  assert.deepEqual(result.vehicle, { id: "42", agencyId: "miway", label: "Bus 42", tripId: "trip-42", routeId: "42", timestamp: iso() });
  assert.equal(calls.snapshot[0].agency, "miway");
  assert.equal(calls.upcoming[0].vehicle.id, "42"); assert.equal(calls.upcoming[0].vehicle.vehicleKey, "miway:42");
  assert.equal(calls.upcoming[0].vehicle.lat, Math.fround(43.68));
  assert.equal(Object.hasOwn(calls.upcoming[0].vehicle, "origin"), false);
  assert.equal(calls.walk.length, 3);
  for (const [index, option] of result.options.entries()) {
    assert.equal(option.stop.id, `miway:stop-${index}`); assert.equal(option.arrivalAt, iso(300 + index * 120)); assert.equal(option.arriveByAt, iso(180 + index * 120));
    assert.equal(option.basis, "scheduled"); assert.equal(option.slackSeconds, 120 + index * 120);
    assert.equal(option.walk.legs.every((leg) => leg.mode === "WALK"), true);
    assert.equal(calls.walk[index].allowDirectWalking, true); assert.equal(calls.walk[index].dateTime, option.arriveByAt); assert.equal(calls.walk[index].arriveBy, true); assert.deepEqual(calls.walk[index].from, origin);
    assert.equal(calls.walk[index].to.stopId, option.stop.id);
    assert.equal(calls.walk[index].signal, calls.snapshot[0].signal);
  }
  assert.equal(Object.hasOwn(result.vehicle, "lat"), false);
});

test("browser snapshot forgery and non-exact input shapes never invoke loaders", async () => {
  const { dependencies, calls } = fixture();
  for (const bad of [null, [], {}, { ...input, snapshot: {} }, { ...input, tripId: "miway:forged" }, { ...input, vehicleKey: "miway:miway:42" }, { ...input, vehicleKey: "unknown:42" }, { ...input, vehicleKey: `miway:${"x".repeat(201)}` }, { ...input, vehicleKey: "miway:42\u0000" }, { ...input, origin: { lat: "43.7", lon: -79.4 } }, { ...input, origin: { lat: 91, lon: -79.4 } }, { ...input, origin: { ...origin, snapshot: {} } }, { ...input, origin: { ...origin, name: "x".repeat(121) } }]) {
    assert.equal((await planIntercept(bad, dependencies)).state, "invalid-input", JSON.stringify(bad));
  }
  assert.equal(calls.snapshot.length, 0); assert.equal(calls.upcoming.length, 0); assert.equal(calls.walk.length, 0);
});

test("missing, duplicate and conflicting selected identities cannot reach stop lookup", async () => {
  for (const [change, expected] of [
    [(snapshot) => { snapshot.vehicles = []; }, "vehicle-missing"],
    [(snapshot) => { snapshot.vehicles.push(snapshot.vehicles[0]); }, "unavailable"],
    [(snapshot) => { snapshot.agencyId = "yrt"; }, "unavailable"],
    [(snapshot) => { snapshot.vehicles[0].agencyId = "yrt"; }, "vehicle-missing"],
    [(snapshot) => { snapshot.vehicles[0].vehicleKey = "yrt:42"; }, "unavailable"],
    [(snapshot) => { snapshot.vehicles[0].tripId = "yrt:trip"; }, "unavailable"],
  ]) {
    const { dependencies, snapshot, calls } = fixture(); change(snapshot);
    assert.equal((await planIntercept(input, dependencies)).state, expected); assert.equal(calls.upcoming.length, 0);
  }
});

test("stale collector states, publisher times, vehicle times and future clocks stay stale", async () => {
  for (const change of [
    (snapshot) => { snapshot.state = "stale"; },
    (snapshot) => { snapshot.sourceTimestamp = iso(-121); },
    (snapshot) => { snapshot.sourceTimestamp = iso(31); },
    (snapshot) => { snapshot.vehicles[0].timestamp = iso(-121); },
    (snapshot) => { snapshot.vehicles[0].timestamp = iso(31); },
    (snapshot) => { snapshot.vehicles[0].stale = true; },
    (snapshot) => { snapshot.vehicles[0].timestamp = "not-a-time"; },
  ]) {
    const { dependencies, snapshot, calls } = fixture(); change(snapshot);
    assert.equal((await planIntercept(input, dependencies)).state, "stale"); assert.equal(calls.upcoming.length, 0);
  }
});

test("transit, late, mismatched, discontinuous and loop journeys are rejected", async () => {
  const mutations = [
    (walk) => { walk.legs[0].mode = "BUS"; },
    (walk) => { walk.legs[0].tripId = "miway:preceding-trip"; },
    (walk) => { walk.transfers = 1; },
    (walk) => { walk.legs[0].to.id = "miway:other-platform"; },
    (walk) => { walk.legs[0].to.lat += 0.01; },
    (walk) => { walk.legs[0].from.lon += 0.01; },
    (walk) => { walk.endTime = iso(9999); walk.legs[0].endTime = walk.endTime; },
    (walk) => { walk.legs[0].endTime = iso(61); },
    (walk) => { walk.legs[0].realtimeState = "CANCELED"; },
    (walk) => { walk.legs[0].intermediateStops = [{ id: "miway:board" }]; },
    (walk) => { walk.startTime = iso(-31); walk.legs[0].startTime = walk.startTime; },
    (walk) => { walk.legs = [walk.legs[0], { ...walk.legs[0], from: { lat: 43.8, lon: -79.4 }, startTime: iso(30) }]; },
    (walk) => {
      const original = walk.legs[0]; const mid = { lat: 43.7005, lon: -79.4005 };
      walk.legs = [{ ...original, to: mid, endTime: iso(20) }, { ...original, from: mid, to: original.from, startTime: iso(20), endTime: iso(40) }, { ...original, startTime: iso(40) }];
    },
  ];
  for (const mutate of mutations) {
    const { dependencies } = fixture(); dependencies.walkPlanner = async (request) => { const walk = walking(request); mutate(walk); return { itineraries: [walk] }; };
    const result = await planIntercept(input, dependencies); assert.equal(result.state, "no-catchable-stop"); assert.deepEqual(result.options, []);
  }
});

test("genuine contiguous multiple walking legs are accepted and unrecognized output fields are stripped", async () => {
  const { dependencies } = fixture();
  dependencies.walkPlanner = async (request) => {
    const walk = walking(request); const original = walk.legs[0]; const mid = { lat: 43.7005, lon: -79.4005 };
    walk.debugUrl = "http://private.invalid/internal";
    walk.legs = [{ ...original, to: mid, endTime: iso(30), debugUrl: walk.debugUrl }, { ...original, from: mid, startTime: iso(30) }];
    return { itineraries: [walk] };
  };
  const result = await planIntercept(input, dependencies); assert.equal(result.state, "catchable");
  assert.equal(result.options[0].walk.legs.length, 2); assert.doesNotMatch(JSON.stringify(result), /private[.]invalid|debugUrl/);
});

test("invalid candidate metadata, cancelled stops and unrelated returned vehicles fail closed", async () => {
  for (const [change, expected] of [
    [(upcoming) => { upcoming.vehicle.id = "miway:other"; }, "unavailable"],
    [(upcoming) => { upcoming.vehicle.tripId = "yrt:trip-42"; }, "unavailable"],
    [(upcoming) => { upcoming.candidates.push(upcoming.candidates[0]); }, "unavailable"],
    [(upcoming) => { upcoming.candidates.forEach((stop) => { stop.realtimeState = "CANCELED"; }); }, "no-catchable-stop"],
    [(upcoming) => { upcoming.candidates.forEach((stop) => { stop.arriveByAt = iso(-1); }); }, "no-catchable-stop"],
    [(upcoming) => { upcoming.candidates.forEach((stop) => { stop.arriveByAt = stop.scheduledArrivalAt; }); }, "no-catchable-stop"],
    [(upcoming) => { upcoming.candidates.forEach((stop) => { stop.basis = "guessed"; }); }, "no-catchable-stop"],
    [(upcoming) => { upcoming.candidates.forEach((stop) => { stop.lat = null; }); }, "no-catchable-stop"],
    [(upcoming) => { upcoming.candidates.forEach((stop) => { stop.id = "yrt:wrong"; }); }, "no-catchable-stop"],
  ]) {
    const { dependencies, calls } = fixture(); const upstream = dependencies.upcomingLoader;
    dependencies.upcomingLoader = async (...args) => { const value = await upstream(...args); change(value); return value; };
    assert.equal((await planIntercept(input, dependencies)).state, expected); assert.equal(calls.walk.length, 0);
  }
});

test("realtime basis uses the real prediction, and duplicate stops schedule once", async () => {
  const { dependencies, calls } = fixture(); const upstream = dependencies.upcomingLoader;
  dependencies.upcomingLoader = async (...args) => {
    const value = await upstream(...args); const stop = value.candidates[0];
    stop.basis = "realtime"; stop.arrivalAt = iso(360); stop.arriveByAt = iso(240);
    value.candidates = [stop, stop]; return value;
  };
  const result = await planIntercept(input, dependencies);
  assert.equal(result.state, "catchable"); assert.equal(result.options.length, 1); assert.equal(calls.walk.length, 1);
  assert.equal(result.options[0].arrivalAt, iso(360)); assert.equal(result.options[0].basis, "realtime"); assert.equal(result.options[0].slackSeconds, 180);
});

test("no reachable walking route and upstream failures produce honest generic states", async () => {
  const empty = fixture(); empty.dependencies.walkPlanner = async () => ({ itineraries: [] });
  assert.equal((await planIntercept(input, empty.dependencies)).state, "no-catchable-stop");
  for (const key of ["snapshotLoader", "upcomingLoader", "walkPlanner"]) {
    const { dependencies } = fixture(); dependencies[key] = async () => { throw new Error("http://private.invalid/internal?credential=hidden"); };
    const result = await planIntercept(input, dependencies); assert.equal(result.state, "unavailable"); assert.doesNotMatch(JSON.stringify(result), /private|credential|hidden|https?:/);
  }
});

test("at most two walking queries run concurrently and completion order does not reorder stops", async () => {
  const { dependencies } = fixture(); let active = 0; let peak = 0; let calls = 0;
  dependencies.walkPlanner = async (request) => { active++; calls++; peak = Math.max(peak, active); await delay(request.to.id.endsWith("0") ? 30 : 10); active--; return { itineraries: [walking(request)] }; };
  const result = await planIntercept(input, dependencies);
  assert.equal(result.state, "catchable"); assert.equal(peak, 2); assert.equal(calls, 3);
  assert.deepEqual(result.options.map((option) => option.stop.id), ["miway:stop-0", "miway:stop-1", "miway:stop-2"]);
});

test("caller cancellation bounds loaders that ignore abort and stops new walking queries", async () => {
  for (const phase of ["snapshotLoader", "upcomingLoader", "walkPlanner"]) {
    const { dependencies } = fixture(); const controller = new AbortController(); let started; let calls = 0;
    const began = new Promise((resolve) => { started = resolve; });
    dependencies[phase] = (...args) => { calls++; const shared = phase === "upcomingLoader" ? args[1].signal : args[0].signal; assert.equal(shared.aborted, false); started(); return new Promise(() => {}); };
    const pending = planIntercept(input, { ...dependencies, signal: controller.signal });
    await began; controller.abort();
    const result = await pending; assert.equal(result.state, "unavailable"); assert.match(result.reason, /cancelled/); assert.ok(calls <= 2);
  }
  const { dependencies, calls } = fixture(); const controller = new AbortController(); controller.abort();
  assert.equal((await planIntercept(input, { ...dependencies, signal: controller.signal })).state, "unavailable"); assert.equal(calls.snapshot.length, 0);
});

test("vehicle freshness is rechecked after slow lookup and walking completion", async () => {
  for (const phase of ["upcomingLoader", "walkPlanner"]) {
    const { dependencies } = fixture(); let time = NOW; dependencies.now = () => time;
    const original = dependencies[phase]; dependencies[phase] = async (...args) => { const result = await original(...args); time += 121000; return result; };
    assert.equal((await planIntercept(input, dependencies)).state, "stale");
  }
});

test("one 25-second deadline covers a stalled collector independently of its abort support", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
  const { dependencies } = fixture(); let received;
  dependencies.snapshotLoader = (request) => { received = request.signal; return new Promise(() => {}); };
  const pending = planIntercept(input, dependencies);
  await Promise.resolve(); assert.equal(received.aborted, false);
  context.mock.timers.tick(INTERCEPT_LIMITS.deadlineMs - 1); assert.equal(received.aborted, false);
  context.mock.timers.tick(1);
  const result = await pending; assert.equal(received.aborted, true); assert.equal(result.state, "unavailable"); assert.match(result.reason, /timed out/);
  assert.equal(INTERCEPT_LIMITS.deadlineMs, 25000);
});

test("normal HTTP OTP planning and normalization supply a genuine direct walking itinerary", async (context) => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const query = JSON.parse(body); requests.push(query);
    const from = query.variables.origin.location.coordinate;
    const to = query.variables.destination.location.coordinate;
    const start = iso();
    const end = new Date(Date.parse(start) + 60000).toISOString();
    const walk = { start, end, duration: "PT60S", walkDistance: 150, numberOfTransfers: 0, legs: [{ mode: "WALK", start: { scheduledTime: start }, end: { scheduledTime: end }, duration: "PT60S", distance: 150, from: { name: "Current position", lat: from.latitude, lon: from.longitude }, to: { name: "Published stop", lat: to.latitude, lon: to.longitude }, intermediatePlaces: [] }] };
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ data: { planConnection: { edges: [{ node: walk }] } } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => { server.closeAllConnections(); server.close(); });
  const { dependencies } = fixture();
  dependencies.walkPlanner = (request) => planWithOtp({ ...request, otpUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: 1000, maxWalkDistance: 2000, preference: "fastest", maxResults: 10 });
  const result = await planIntercept(input, dependencies);
  assert.equal(result.state, "catchable"); assert.equal(result.options.length, 3); assert.equal(requests.length, 3);
  assert.equal(result.options[0].walk.duration, 60); assert.equal(result.options[0].walk.legs[0].distance, 150);
  assert.ok(requests.every((query) => query.query.includes("planConnection") && Number.isFinite(Date.parse(query.variables.dateTime.latestArrival))));
});

test("a publisher header that expires during walking invalidates even a newer selected vehicle", async () => {
  const { dependencies, snapshot } = fixture(); snapshot.sourceTimestamp = iso(-110);
  let time = NOW; dependencies.now = () => time;
  dependencies.walkPlanner = async (request) => { time = NOW + 11000; return { itineraries: [walking(request)] }; };
  assert.equal((await planIntercept(input, dependencies)).state, "stale");
});

test("arrive-by interception forwards accessibility preferences and admits a feasible transit connection", async () => {
  const { dependencies, calls } = fixture();
  dependencies.walkPlanner = async (request) => {
    calls.walk.push(request); const journey = walking(request); const original = journey.legs[0];
    const board = { id: "go:board", lat: 43.7003, lon: -79.4002 };
    const alight = { id: "go:alight", lat: 43.7008, lon: -79.4007 };
    journey.legs = [{ ...original, to: board, endTime: iso(20) }, { mode: "BUS", routeId: "go:40", tripId: "go:connection", route: "40", agency: "GO Transit", from: board, to: alight, startTime: iso(20), endTime: iso(40), intermediateStops: [] }, { ...original, from: alight, startTime: iso(40) }];
    return { itineraries: [journey] };
  };
  const result = await planIntercept({ ...input, preferences: { wheelchair: true, maxWalkDistance: 1200 } }, dependencies);
  assert.equal(result.state, "catchable"); assert.equal(result.options.length, 3);
  assert.equal(result.options[0].journey.legs[1].tripId, "go:connection"); assert.equal(Object.hasOwn(result.options[0], "walk"), false);
  assert.equal(calls.walk[0].arriveBy, true); assert.equal(calls.walk[0].dateTime, result.options[0].arriveByAt);
  assert.equal(calls.walk[0].wheelchair, true); assert.equal(calls.walk[0].maxWalkDistance, 1200); assert.equal(calls.walk[0].preference, "fastest");
  assert.equal(result.options[0].marginSeconds, 240); assert.equal(result.options[0].leaveInSeconds, 0);
});

test("transit cannot reuse the target trip, target route or assigned target vehicle", async () => {
  for (const identity of [{ tripId: "miway:trip-42", routeId: "miway:99" }, { tripId: "miway:another-trip", routeId: "miway:42" }, { tripId: "go:connection", routeId: "go:40", vehicle: { id: "42", agencyId: "miway" } }]) {
    const { dependencies } = fixture();
    dependencies.walkPlanner = async (request) => { const journey = walking(request); journey.legs[0] = { ...journey.legs[0], mode: "BUS", from: { ...request.from, id: "go:board" }, to: { ...request.to, id: request.to.id }, ...identity }; return { itineraries: [journey] }; };
    assert.equal((await planIntercept(input, dependencies)).state, "no-catchable-stop");
  }
});

test("position-aligned estimates require disclosure and remain unconfirmed with a journey result", async () => {
  for (const stripDisclosure of [false, true]) {
    const { dependencies, snapshot } = fixture(); snapshot.vehicles[0].tripId = "";
    const upstream = dependencies.upcomingLoader;
    dependencies.upcomingLoader = async (...args) => {
      const result = await upstream(...args);
      return { ...result, method: "position-aligned-timetable", confirmedTrip: false, disclosure: stripDisclosure ? undefined : "Arrival times for this vehicle are timetable estimates aligned to the bus's reported position, not publisher predictions.", alignment: { patternId: "miway:42:north", directionId: "0", anchorStopId: "miway:stop-0", offsetSeconds: -60, distanceMetres: 25, debugUrl: "http://private.invalid" }, candidates: result.candidates.map((stop) => ({ ...stop, basis: "aligned-timetable", alignedArrival: stop.scheduledArrivalAt })) };
    };
    const result = await planIntercept(input, dependencies);
    assert.equal(result.state, stripDisclosure ? "unavailable" : "catchable");
    if (!stripDisclosure) { assert.equal(result.confirmedTrip, false); assert.equal(result.options[0].basis, "aligned-timetable"); assert.ok(result.options[0].journey); assert.ok(result.options[0].walk); assert.doesNotMatch(JSON.stringify(result), /private[.]invalid|debugUrl/); }
  }
});

test("invalid accessibility input and journeys beyond the requested walking limit are refused", async () => {
  const { dependencies, calls } = fixture();
  for (const preferences of [{ wheelchair: "true" }, { maxWalkDistance: -1 }, { maxWalkDistance: 20001 }, { unsafe: true }]) assert.equal((await planIntercept({ ...input, preferences }, dependencies)).state, "invalid-input");
  assert.equal(calls.snapshot.length, 0);
  assert.equal((await planIntercept({ ...input, preferences: { maxWalkDistance: 100 } }, dependencies)).state, "no-catchable-stop");
});
