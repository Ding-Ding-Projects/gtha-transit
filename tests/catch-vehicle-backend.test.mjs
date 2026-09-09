import assert from "node:assert/strict";
import test from "node:test";
import { collectorSnapshot, interceptCandidates } from "../backend/catch-vehicle.mjs";

test("collector snapshot requires a fresh exact trip identity", () => {
  const now = Date.now();
  const good = { snapshot: { id: "miway:42", agencyId: "miway:1", tripId: "miway:trip-42", serviceDate: "20260909", timestamp: now } };
  assert.equal(collectorSnapshot(good, now).tripId, "miway:trip-42");
  assert.equal(collectorSnapshot({ snapshot: { ...good.snapshot, tripId: "42" } }, now), null);
  assert.equal(collectorSnapshot({ snapshot: { ...good.snapshot, timestamp: now - 120_001 } }, now), null);
});

test("intercept candidates skip cancelled and unsafe stops and remain bounded", () => {
  const now = Date.now(); const at = (seconds) => new Date(now + seconds * 1000).toISOString();
  const stops = [{ id: "miway:a", lat: 43.7, lon: -79.4, arrivalAt: at(60) }, { id: "miway:b", lat: 43.7, lon: -79.4, arrivalAt: at(180), realtimeState: "CANCELED" }, ...Array.from({ length: 5 }, (_, index) => ({ id: `miway:${index}`, lat: 43.7, lon: -79.4, arrivalAt: at(240 + index * 60), realtimeState: "UPDATED" }))];
  const candidates = interceptCandidates({ stops, now });
  assert.equal(candidates.length, 3); assert.equal(candidates[0].id, "miway:0");
  assert.equal(Date.parse(candidates[0].arriveByAt), Date.parse(candidates[0].arrivalAt) - 120_000);
});
