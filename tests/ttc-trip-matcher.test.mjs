import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { classifyBatch, decodeFeed, encodeFeed, gateVerdict, matchUpdate, createSingleFlightPoller, createStaticIndexBudget, loadStaticIndexForFeed, STATIC_INDEX_LIMITS, failSafeBytes } from "../backend/ttc-trip-matcher.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { createObservedIndexCache, classifyObservedBatch, updateServiceDates, OBSERVED_INDEX_LIMITS, serviceDayToronto, timestampFresh } from "../backend/ttc-trip-matcher.mjs";

const fixture = async (name) => JSON.parse(await readFile(new URL(`../backend/fixtures/ttc-matcher/${name}`, import.meta.url), "utf8"));
const clone = (value) => structuredClone(value);

async function base() {
  const [staticIndex, tripUpdate, vehiclePosition] = await Promise.all([
    fixture("static-index.json"), fixture("trip-update.json"), fixture("vehicle-position.json"),
  ]);
  return { staticIndex, tripUpdate, vehiclePosition, now: vehiclePosition.timestamp * 1_000 };
}

test("shadow matcher accepts only a unique time match confirmed by a fresh nearby vehicle", async () => {
  const { staticIndex, tripUpdate, vehiclePosition, now } = await base();
  const match = matchUpdate(tripUpdate, staticIndex, new Map([[vehiclePosition.vehicle.id, vehiclePosition]]), { now });
  assert.equal(match.classification, "unique");
  assert.equal(match.matchedTripId, "trip-501-B");
  assert.equal(match.matchedRouteId, "501");
  assert.equal(match.stopMappings.length, 3);
  assert.ok(match.vehicleDistanceMetres < 1);
});

test("shadow matcher keeps ambiguous, missing, contradicted, and sequence-misaligned updates out", async () => {
  const { staticIndex, tripUpdate, vehiclePosition, now } = await base();
  const vehicleMap = new Map([[vehiclePosition.vehicle.id, vehiclePosition]]);

  const ambiguousIndex = clone(staticIndex);
  ambiguousIndex.routes["501"].push(clone(ambiguousIndex.routes["501"][1]));
  assert.equal(matchUpdate(tripUpdate, ambiguousIndex, vehicleMap, { now }).classification, "ambiguous");

  const missing = clone(tripUpdate); missing.trip.routeId = "999";
  assert.equal(matchUpdate(missing, staticIndex, vehicleMap, { now }).classification, "none");

  const contradictedVehicle = clone(vehiclePosition); contradictedVehicle.position = { latitude: 43.9, longitude: -79.9 };
  assert.equal(matchUpdate(tripUpdate, staticIndex, new Map([[vehiclePosition.vehicle.id, contradictedVehicle]]), { now }).classification, "contradicted");

  const misaligned = clone(tripUpdate); misaligned.stopTimeUpdate[0].stopSequence = 99;
  assert.equal(matchUpdate(misaligned, staticIndex, vehicleMap, { now }).classification, "sequence-misaligned");
});

test("matcher encoder round-trips a rewritten static trip and the rolling gate is fail-closed", async () => {
  const feed = {
    header: { gtfsRealtimeVersion: "2.0", incrementality: 0, timestamp: 1_800_000_900 },
    tripUpdates: [{ id: "shadow-501", trip: { tripId: "trip-501-B", routeId: "501", scheduleRelationship: 0 }, stopTimeUpdate: [{ stopSequence: 2, stopId: "1002", arrival: { time: 1_800_000_945 } }], timestamp: 1_800_000_900 }],
  };
  const decoded = decodeFeed(encodeFeed(feed));
  assert.equal(decoded.tripUpdates.length, 1);
  assert.equal(decoded.tripUpdates[0].trip.tripId, "trip-501-B");
  assert.equal(decoded.tripUpdates[0].stopTimeUpdate[0].arrival.time, 1_800_000_945);

  const healthy = gateVerdict({ total: 100, unique: 60, ambiguous: 38, none: 0, contradicted: 2, unverified: 0, sequenceMisaligned: 0 });
  assert.equal(healthy.passes, true);
  const notEnoughEvidence = gateVerdict({ total: 0, unique: 0, ambiguous: 0, none: 0, contradicted: 0, unverified: 0, sequenceMisaligned: 0 });
  assert.equal(notEnoughEvidence.passes, false);
});

test("batch counters retain every non-unique classification for the activation record", async () => {
  const { staticIndex, tripUpdate, vehiclePosition, now } = await base();
  const misaligned = clone(tripUpdate); misaligned.stopTimeUpdate[0].stopSequence = 99;
  const { counters } = classifyBatch([tripUpdate, misaligned], staticIndex, [vehiclePosition], { now });
  assert.deepEqual(counters, { total: 2, unique: 1, ambiguous: 0, none: 0, contradicted: 0, unverified: 0, sequenceMisaligned: 1 });
});

test("slow and reentrant polls share a single run and schedule only after completion", async (context) => {
  let release; let started; let calls = 0; let running = 0; let maximum = 0;
  const began = new Promise((resolve) => { started = resolve; });
  const hold = new Promise((resolve) => { release = resolve; });
  const poller = createSingleFlightPoller(async () => { calls++; running++; maximum = Math.max(maximum, running); started(); if (calls === 1) await hold; running--; }, { intervalMs: 10 });
  context.after(() => { poller.stop(); release(); });
  poller.start(); await began;
  const first = poller.poll(); assert.equal(poller.poll(), first);
  await delay(35); assert.equal(calls, 1);
  release(); await first; assert.equal(calls, 1);
  await delay(35); poller.stop(); assert.ok(calls >= 2); assert.equal(maximum, 1);
  const stoppedAt = calls; await delay(25); assert.equal(calls, stoppedAt);
});

test("a rejected poll clears single-flight state and reports the rejection once", async () => {
  let calls = 0; const poller = createSingleFlightPoller(async () => { calls++; throw new Error("fixture rejection"); });
  await assert.rejects(poller.poll(), /fixture rejection/);
  await assert.rejects(poller.poll(), /fixture rejection/);
  assert.equal(calls, 2); poller.stop();
});

const route = { gtfsId: "ttc-next:501", shortName: "501" };
const schedule = { gtfsId: "ttc-next:trip", stoptimesForDate: [{ stopPosition: 0, serviceDay: 1800000000, scheduledDeparture: 60, stop: { gtfsId: "ttc-next:stop", lat: 43.7, lon: -79.4 } }] };
const primaryQuery = async (_query, variables) => variables.feeds ? { routes: [route] } : { route: { patterns: [{ tripsForDate: [schedule] }] } };

test("index loading executes primary queries and enforces total route, trip and query caps", async () => {
  const budget = createStaticIndexBudget({ query: primaryQuery });
  const index = await loadStaticIndexForFeed("ttc-next", "20260909", budget);
  assert.equal(index.routes["501"][0].stops[0].seq, 1); assert.equal(budget.counts.queries, 2);
  await assert.rejects(loadStaticIndexForFeed("ttc-next", "20260909", createStaticIndexBudget({ query: primaryQuery, limits: { queries: 1 } })), /queries limit/);
  await assert.rejects(loadStaticIndexForFeed("ttc-next", "20260909", createStaticIndexBudget({ limits: { routes: 1 }, query: async () => ({ routes: [route, route] }) })), /routes limit/);
  await assert.rejects(loadStaticIndexForFeed("ttc-next", "20260909", createStaticIndexBudget({ limits: { trips: 1 }, query: async (_q, v) => v.feeds ? { routes: [route] } : { route: { patterns: [{ tripsForDate: [schedule, schedule] }] } } })), /trips limit/);
  const shared = createStaticIndexBudget({ query: primaryQuery, limits: { routes: 1 } });
  await loadStaticIndexForFeed("ttc-next", "20260909", shared);
  await assert.rejects(loadStaticIndexForFeed("ttc", "20260909", shared), /routes limit/);
  assert.equal(STATIC_INDEX_LIMITS.deadlineMs, 45000);
});

test("fallback index queries are bounded and transport failures do not trigger fallback", async () => {
  let calls = 0;
  const query = async (document, variables) => {
    calls++;
    if (variables.feeds) return { routes: [route] };
    if (document.includes("tripsForDate(")) { const error = new Error("schema unavailable"); error.graphqlErrors = [{ message: "Cannot query field tripsForDate" }]; throw error; }
    if (document.includes("activeDates")) return { route: { patterns: [{ trips: [{ gtfsId: schedule.gtfsId, activeDates: ["20260909"] }] }] } };
    return { trip: { stoptimesForDate: schedule.stoptimesForDate } };
  };
  const index = await loadStaticIndexForFeed("ttc-next", "20260909", createStaticIndexBudget({ query }));
  assert.equal(index.routes["501"][0].stops[0].seq, 1); assert.equal(calls, 4);
  calls = 0;
  await assert.rejects(loadStaticIndexForFeed("ttc-next", "20260909", createStaticIndexBudget({ query, limits: { queries: 3 } })), /queries limit/);
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(loadStaticIndexForFeed("ttc-next", "20260909", createStaticIndexBudget({ query: async (_q, v) => { calls++; if (v.feeds) return { routes: [route] }; throw new Error("transport unavailable"); } })), /transport unavailable/);
  assert.equal(calls, 2);
});

test("index deadlines abort a slow query and bound adapters that ignore abort", async () => {
  let signal;
  const started = Date.now();
  await assert.rejects(loadStaticIndexForFeed("ttc-next", "20260909", createStaticIndexBudget({ limits: { deadlineMs: 30 }, query: (_q, _v, options) => { signal = options.signal; return new Promise(() => {}); } })), /deadline exceeded/);
  assert.equal(signal.aborted, true); assert.ok(Date.now() - started < 1000);
  const budget = createStaticIndexBudget({ query: primaryQuery, limits: { stops: 1 } });
  await loadStaticIndexForFeed("ttc-next", "20260909", budget);
  await assert.rejects(loadStaticIndexForFeed("ttc-next", "20260909", budget), /stops limit/);
});

test("uninitialized, stale and future-dated matcher states emit an empty protobuf feed", () => {
  const now = 1800000000000;
  const bytes = encodeFeed({ tripUpdates: [{ id: "matched", trip: { tripId: "static-trip" } }] });
  assert.equal(failSafeBytes({ lastGoodAt: now - 120000, lastRewrittenBytes: bytes }, now), bytes);
  for (const lastGoodAt of [null, now - 120001, now + 1]) {
    const feed = decodeFeed(failSafeBytes({ lastGoodAt, lastRewrittenBytes: bytes }, now));
    assert.deepEqual(feed.tripUpdates, []); assert.equal(feed.header.timestamp, now / 1000);
  }
});

async function observedFixture() {
  const value = await base(); const date = serviceDayToronto(value.now, { cutoverHour: 0 });
  value.tripUpdate.timestamp = value.now / 1000; value.tripUpdate.trip.startDate = date;
  const requests = [];
  const query = async (_document, variables) => {
    requests.push(variables);
    if (variables.feeds) return { routes: ["501", "502", "unobserved"].map((id) => ({ gtfsId: `ttc-next:${id}`, shortName: id })) };
    const trips = value.staticIndex.routes[variables.id.split(":")[1]] ?? [];
    return { route: { patterns: [{ tripsForDate: trips.map((trip) => ({ gtfsId: trip.gtfsId, stoptimesForDate: trip.stops.map((stop) => ({ stopPosition: stop.seq - 1, serviceDay: stop.scheduledAt, scheduledDeparture: 0, stop: { gtfsId: stop.stopId, lat: stop.lat, lon: stop.lon } })) })) }] } };
  };
  return { ...value, date, requests, query };
}

test("observed cache queries only live route/date timetables and reuses complete windows", async () => {
  const { tripUpdate, vehiclePosition, now, date, query, requests } = await observedFixture();
  const cache = createObservedIndexCache("ttc-next");
  const warm = await cache.refresh([tripUpdate], now, createStaticIndexBudget({ query }));
  assert.equal(warm.built, 1); assert.equal(warm.failed, 0);
  assert.deepEqual(requests, [{ feeds: ["ttc-next"] }, { id: "ttc-next:501", date }]);
  const result = classifyObservedBatch([tripUpdate], cache, [vehiclePosition], { now });
  assert.equal(result.counters.total, 1); assert.equal(result.counters.unique, 1); assert.equal(result.results[0].match.matchedServiceDate, date);
  await cache.refresh([tripUpdate], now + 30000, createStaticIndexBudget({ query }));
  assert.equal(requests.length, 2);
});

test("partial cache coverage counts every omitted update as unverified and rotates new work", async () => {
  const { tripUpdate, vehiclePosition, now, query, requests } = await observedFixture();
  const other = clone(tripUpdate); other.id = "second"; other.trip.routeId = "502";
  const cache = createObservedIndexCache("ttc-next", { limits: { buildsPerPoll: 1, cacheEntries: 1 } });
  await cache.refresh([tripUpdate, other], now, createStaticIndexBudget({ query }));
  const partial = classifyObservedBatch([tripUpdate, other], cache, [vehiclePosition], { now });
  assert.equal(partial.counters.total, 2); assert.equal(partial.counters.unique, 1); assert.equal(partial.counters.unverified, 1); assert.equal(partial.counters.coverageUnverified, 1);
  assert.equal(gateVerdict(partial.counters).uniqueRatio, 0.5); assert.equal(gateVerdict(partial.counters).passes, false);
  await cache.refresh([tripUpdate, other], now + 30000, createStaticIndexBudget({ query }));
  assert.equal(requests.at(-1).id, "ttc-next:502"); assert.equal(cache.stats().cachedEntries, 1);
  assert.equal(classifyObservedBatch([tripUpdate, other], cache, [vehiclePosition], { now: now + 30000 }).counters.total, 2);
});

test("time windows discard unrelated trips but keep the full competing candidate set", async () => {
  const { staticIndex, tripUpdate, vehiclePosition, now, query } = await observedFixture();
  const distant = clone(staticIndex.routes["501"][0]); distant.gtfsId = "ttc-next:far";
  distant.stops.forEach((stop) => { stop.scheduledAt += 86400; }); staticIndex.routes["501"].push(distant);
  const competitor = clone(staticIndex.routes["501"][1]); competitor.gtfsId = "ttc-next:competitor"; staticIndex.routes["501"].push(competitor);
  const cache = createObservedIndexCache("ttc-next"); await cache.refresh([tripUpdate], now, createStaticIndexBudget({ query }));
  const index = cache.indexFor(tripUpdate, now); assert.equal(index.routes["501"].length, 4);
  assert.equal(index.routes["501"].some((trip) => trip.gtfsId.endsWith(":far")), false);
  assert.equal(classifyObservedBatch([tripUpdate], cache, [vehiclePosition], { now }).counters.ambiguous, 1);
  const shifted = clone(tripUpdate); shifted.stopTimeUpdate[0].arrival.time = now / 1000 + 3601;
  assert.equal(cache.indexFor(shifted, now), null, "a window missing possible competitors cannot claim completeness");
});

test("cache rejects an oversized route atomically instead of truncating competitors", async () => {
  const { tripUpdate, vehiclePosition, now, query } = await observedFixture();
  const cache = createObservedIndexCache("ttc-next", { limits: { cachedStops: 8 } });
  const result = await cache.refresh([tripUpdate], now, createStaticIndexBudget({ query }));
  assert.equal(result.built, 0); assert.equal(result.failed, 1); assert.equal(result.cachedStops, 0);
  const classified = classifyObservedBatch([tripUpdate], cache, [vehiclePosition], { now });
  assert.equal(classified.counters.total, 1); assert.equal(classified.counters.coverageUnverified, 1); assert.equal(classified.counters.unique, 0);
  assert.equal(OBSERVED_INDEX_LIMITS.cachedStops, 75000);
});

test("two route-window builds are shared across feeds and deadlines retain the denominator", async () => {
  const { tripUpdate, vehiclePosition, now, query, requests } = await observedFixture();
  const budget = createStaticIndexBudget({ query });
  const first = createObservedIndexCache("ttc-next"); const second = createObservedIndexCache("ttc-next"); const third = createObservedIndexCache("ttc-next");
  await first.refresh([tripUpdate], now, budget); await second.refresh([tripUpdate], now, budget);
  const limited = await third.refresh([tripUpdate], now, budget); assert.equal(limited.built, 0); assert.equal(limited.failed, 1);
  assert.equal(requests.filter((entry) => entry.id).length, 2);
  const timed = createObservedIndexCache("ttc-next");
  let clock = now;
  const lateQuery = async (...args) => { const data = await query(...args); if (args[1].id) clock += 45001; return data; };
  const report = await timed.refresh([tripUpdate], now, createStaticIndexBudget({ query: lateQuery, now: () => clock }));
  assert.equal(report.failed, 1); assert.equal(report.built, 0);
  assert.equal(classifyObservedBatch([tripUpdate], timed, [vehiclePosition], { now }).counters.unverified, 1);
});

test("Toronto crossover uses exact published dates or both calendars without a cutover guess", async () => {
  for (const instant of ["2026-09-10T04:30:00Z", "2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z", "2026-03-08T07:30:00Z"]) {
    const now = Date.parse(instant); const dates = updateServiceDates({ trip: {} }, now);
    assert.equal(dates.length, 2); assert.equal(dates[0], serviceDayToronto(now, { cutoverHour: 0 }));
    for (const date of dates) assert.deepEqual(updateServiceDates({ trip: { startDate: date } }, now), [date]);
    assert.deepEqual(updateServiceDates({ trip: { startDate: "20260230" } }, now), []);
  }
  const { tripUpdate, vehiclePosition, now, query } = await observedFixture(); tripUpdate.trip.startDate = null;
  const cache = createObservedIndexCache("ttc-next", { limits: { buildsPerPoll: 1 } });
  await cache.refresh([tripUpdate], now, createStaticIndexBudget({ query }));
  assert.equal(cache.indexFor(tripUpdate, now), null, "the missing second service calendar remains unverified");
  await cache.refresh([tripUpdate], now, createStaticIndexBudget({ query }));
  assert.equal(classifyObservedBatch([tripUpdate], cache, [vehiclePosition], { now }).counters.ambiguous, 1, "same-time trips on both dates remain competitors");
});

test("stale or future publisher/vehicle observations never earn a cached unique match", async () => {
  const { tripUpdate, vehiclePosition, now, query } = await observedFixture();
  const cache = createObservedIndexCache("ttc-next"); await cache.refresh([tripUpdate], now, createStaticIndexBudget({ query }));
  for (const stamp of [null, now / 1000 - 121, now / 1000 + 31]) {
    assert.equal(timestampFresh(stamp, now), false);
    assert.equal(classifyObservedBatch([tripUpdate], cache, [vehiclePosition], { now, publisherTimestamps: [stamp] }).counters.unverified, 1);
  }
  const future = clone(vehiclePosition); future.timestamp = now / 1000 + 31;
  assert.equal(classifyObservedBatch([tripUpdate], cache, [future], { now }).counters.unverified, 1);
  const staleUpdate = clone(tripUpdate); staleUpdate.timestamp = now / 1000 - 121;
  assert.equal(classifyObservedBatch([staleUpdate], cache, [vehiclePosition], { now }).counters.coverageUnverified, 1);
});

test("two-date work warms one observed route completely instead of sweeping one date first", async () => {
  const { tripUpdate, now, query, requests } = await observedFixture(); tripUpdate.trip.startDate = null;
  const other = clone(tripUpdate); other.trip.routeId = "502";
  const cache = createObservedIndexCache("ttc-next");
  await cache.refresh([tripUpdate, other], now, createStaticIndexBudget({ query }));
  assert.deepEqual(requests.filter((entry) => entry.id).map((entry) => entry.id), ["ttc-next:501", "ttc-next:501"]);
  assert.ok(cache.indexFor(tripUpdate, now)); assert.equal(cache.indexFor(other, now), null);
});
