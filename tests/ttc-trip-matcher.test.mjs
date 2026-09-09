import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { classifyBatch, decodeFeed, encodeFeed, gateVerdict, matchUpdate, createSingleFlightPoller, createStaticIndexBudget, loadStaticIndexForFeed, STATIC_INDEX_LIMITS, failSafeBytes } from "../backend/ttc-trip-matcher.mjs";
import { setTimeout as delay } from "node:timers/promises";

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
