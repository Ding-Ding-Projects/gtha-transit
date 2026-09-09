import assert from "node:assert/strict";
import test from "node:test";
import { collectorSnapshot, interceptCandidates, isServiceDate } from "../backend/catch-vehicle.mjs";
import { parseVehicleFeed, combineVehicleSnapshots } from "../vehicles/index.mjs";
import { encodeFeed } from "../backend/ttc-trip-matcher.mjs";

function collected(now, agencyId = "miway", startDate = "20260909") {
  const seconds = Math.floor(now / 1000);
  const bytes = encodeFeed({ header: { timestamp: seconds }, vehiclePositions: [{ id: "position-42", vehicle: { id: "42" }, timestamp: seconds, trip: { tripId: "trip-42", routeId: "42", startDate }, position: { latitude: 43.7, longitude: -79.4 }, stopId: "board", currentStatus: 2, currentStopSequence: 2 }] });
  return combineVehicleSnapshots([parseVehicleFeed(bytes, { now, agencyId, fetchedAt: new Date(now).toISOString() })]).vehicles[0];
}

test("collector adapter consumes the actual parsed and combined publisher output", () => {
  const now = Date.parse("2026-09-09T16:00:00Z");
  const item = collected(now);
  assert.equal(item.id, "42"); assert.equal(item.agencyId, "miway"); assert.equal(item.vehicleKey, "miway:42");
  const result = collectorSnapshot({ snapshot: item }, now);
  assert.equal(result.tripId, "miway:trip-42"); assert.equal(result.nextStopId, "miway:board");
  assert.equal(result.serviceDate, "20260909"); assert.equal(result.serviceDateSource, "publisher");
  assert.equal(Object.hasOwn(result, "lat"), false); assert.equal(Object.hasOwn(result, "lon"), false);
  assert.equal(collectorSnapshot({ snapshot: collected(now, "ttc") }, now).tripId, "ttc-next:trip-42");
});

test("collector adapter rejects conflicting, oversized, stale and invalid identities", () => {
  const now = Date.parse("2026-09-09T16:00:00Z"); const item = collected(now);
  for (const changed of [{ tripId: "yrt:other" }, { id: "yrt:42" }, { agencyId: "miway:1" }, { vehicleKey: "yrt:42" }, { tripId: "x".repeat(201) }, { tripId: "x\u0000" }, { nextStopId: "yrt:board" }, { timestamp: now }, { timestamp: new Date(now - 120001).toISOString() }, { timestamp: new Date(now + 30001).toISOString() }, { startDate: "20260230" }, { startDate: "20260907" }, { startDate: "20260910" }, { stale: true }]) {
    assert.equal(collectorSnapshot({ snapshot: { ...item, ...changed } }, now), null, JSON.stringify(changed));
  }
  assert.equal(collectorSnapshot({ snapshot: item, from: { lat: 43, lon: -79 } }, now), null);
  assert.equal(collectorSnapshot({ snapshot: { ...item, tripId: "miway:trip-42" } }, now).tripId, "miway:trip-42");
});

test("service dates validate real calendar days and use Toronto across midnight and DST", () => {
  for (const value of ["20260230", "20261301", "20260001", "20260900", "2026-09-09", null]) assert.equal(isServiceDate(value), false);
  assert.equal(isServiceDate("20280229"), true);
  for (const [instant, expected] of [["2026-09-10T02:00:00Z", "20260909"], ["2026-11-01T05:30:00Z", "20261101"], ["2026-11-01T06:30:00Z", "20261101"], ["2026-03-08T07:30:00Z", "20260308"]]) {
    const now = Date.parse(instant); const result = collectorSnapshot({ snapshot: collected(now, "miway", null) }, now);
    assert.equal(result.serviceDate, expected); assert.equal(result.serviceDateSource, "observation-calendar");
  }
  const now = Date.parse("2026-09-10T05:00:00Z");
  assert.equal(collectorSnapshot({ snapshot: collected(now, "miway", "20260909") }, now).serviceDate, "20260909");
});

test("candidate stop anchoring, coordinate bounds and scheduled basis fail closed", () => {
  const now = Date.parse("2026-09-09T16:00:00Z");
  const stop = (id, extra = {}) => ({ id: `miway:${id}`, lat: 43.7, lon: -79.4, scheduledArrivalAt: new Date(now + 300000).toISOString(), ...extra });
  const stops = [stop("passed"), stop("board", { lat: 91 }), stop("next"), stop("last", { realtimeState: "SKIPPED" })];
  const result = interceptCandidates({ stops, now, nextStopId: "miway:board" });
  assert.deepEqual(result.map((entry) => entry.id), ["miway:next"]);
  assert.equal(result[0].basis, "scheduled"); assert.equal(Date.parse(result[0].arriveByAt), now + 180000);
  assert.deepEqual(interceptCandidates({ stops, now, nextStopId: "miway:missing" }), []);
  assert.deepEqual(interceptCandidates({ stops: Array.from({ length: 40 }, () => stop("old", { scheduledArrivalAt: new Date(now - 1).toISOString() })).concat(stop("beyond-bound")), now }), []);
  assert.deepEqual(interceptCandidates({ stops: [stop("invalid-live", { arrivalAt: "invalid" })], now }), []);
});

test("intercept candidates skip cancelled and unsafe stops and remain bounded", () => {
  const now = Date.now(); const at = (seconds) => new Date(now + seconds * 1000).toISOString();
  const stops = [{ id: "miway:a", lat: 43.7, lon: -79.4, arrivalAt: at(60) }, { id: "miway:b", lat: 43.7, lon: -79.4, arrivalAt: at(180), realtimeState: "CANCELED" }, ...Array.from({ length: 5 }, (_, index) => ({ id: `miway:${index}`, lat: 43.7, lon: -79.4, arrivalAt: at(240 + index * 60), realtimeState: "UPDATED" }))];
  const candidates = interceptCandidates({ stops, now });
  assert.equal(candidates.length, 3); assert.equal(candidates[0].id, "miway:0");
  assert.equal(Date.parse(candidates[0].arriveByAt), Date.parse(candidates[0].arrivalAt) - 120_000);
});
