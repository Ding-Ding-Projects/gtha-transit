import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { classifyBatch, decodeFeed, encodeFeed, gateVerdict, matchUpdate } from "../backend/ttc-trip-matcher.mjs";

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
