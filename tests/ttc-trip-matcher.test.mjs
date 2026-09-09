import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_THRESHOLDS, classifyBatch, decodeFeed, encodeFeed, gateVerdict, matchUpdate, server, serviceDayToronto,
} from "../backend/ttc-trip-matcher.mjs";

const fixture = async (name) => JSON.parse(await readFile(new URL(`../backend/fixtures/ttc-matcher/${name}`, import.meta.url), "utf8"));
const clone = (value) => structuredClone(value);

async function base() {
  const [staticIndex, tripUpdate, vehiclePosition] = await Promise.all([
    fixture("static-index.json"), fixture("trip-update.json"), fixture("vehicle-position.json"),
  ]);
  return { staticIndex, tripUpdate, vehiclePosition, now: vehiclePosition.timestamp * 1_000 };
}

// Importing this module runs only its pure half (protobuf codec + matching
// algorithm). The impure half - the poll loop and the HTTP server - is gated
// behind `process.argv[1] === this file`, which is false under `node --test`,
// so the exported `server` must exist (proving the module loaded fully) but
// must never have had `.listen()` called on it.
test("importing the matcher module never starts the server or opens a port", () => {
  assert.equal(typeof server, "object");
  assert.equal(server.listening, false);
});

test("a unique match rewrites onto the static trip, route, and stop ids, never the live feed's own", async () => {
  const { staticIndex, tripUpdate, vehiclePosition, now } = await base();
  const match = matchUpdate(tripUpdate, staticIndex, new Map([[vehiclePosition.vehicle.id, vehiclePosition]]), { now });
  assert.equal(match.classification, "unique");
  assert.equal(match.matchedTripId, "trip-501-B");
  assert.equal(match.matchedRouteId, "501");
  assert.equal(match.stopMappings.length, 3);
  // The live feed's own stop ids are 9991/9992/9993 (see trip-update.json) and
  // its trip id is a meaningless negative-hash string; the rewritten mapping
  // must carry only the static schedule's stop ids (1001/1002/1003, feed
  // prefix stripped), never the ones the update itself published.
  assert.deepEqual(match.stopMappings.map((mapping) => mapping.stopId), ["1001", "1002", "1003"]);
  assert.deepEqual(match.stopMappings.map((mapping) => mapping.sequence), [1, 2, 3]);
  assert.deepEqual(match.stopMappings.map((mapping) => mapping.time), [1_800_000_645, 1_800_000_945, 1_800_001_245]);
  assert.ok(match.vehicleDistanceMetres < 1);
});

test("ambiguous: a scoring runner-up inside the 300 s uniqueness margin keeps the match out", async () => {
  const { staticIndex, tripUpdate, vehiclePosition, now } = await base();
  const vehicleMap = new Map([[vehiclePosition.vehicle.id, vehiclePosition]]);
  const ambiguousIndex = clone(staticIndex);
  ambiguousIndex.routes["501"].push(clone(ambiguousIndex.routes["501"][1]));
  const match = matchUpdate(tripUpdate, ambiguousIndex, vehicleMap, { now });
  assert.equal(match.classification, "ambiguous");
  // Ambiguous still reports its diagnostics (there is a best score), but never
  // a rewrite: only a "unique" match ever carries stopMappings.
  assert.equal(match.matchedTripId, "trip-501-B");
  assert.equal(match.stopMappings, null);
});

test("unique and ambiguous sit on opposite sides of the exact 300 s uniqueness margin", async () => {
  const { staticIndex, now: baseNow } = await base();
  // Route 503 (static-index.json) holds two trips whose schedules are offset
  // by a controlled, exact number of seconds at every stop, so the runner-up's
  // score is exactly best.score + that offset - no other stop_time_update or
  // vehicle noise can move it. The update below matches trip-503-X exactly
  // (score 0), so the offset IS the runner-up gap the uniqueness margin (300 s,
  // DEFAULT_THRESHOLDS' sibling constant `uniqueMarginS`, matchUpdate's own
  // default) is compared against.
  const boundaryUpdate = {
    id: "entity-boundary",
    trip: { tripId: "-501", routeId: "503", startTime: null, startDate: null, scheduleRelationship: null, directionId: null },
    vehicle: { id: "boundary-vehicle", label: null, licensePlate: null },
    stopTimeUpdate: [
      { stopSequence: 1, stopId: "5001", arrival: { time: 1_900_000_000, delay: null }, departure: null },
      { stopSequence: 2, stopId: "5002", arrival: { time: 1_900_000_300, delay: null }, departure: null },
      { stopSequence: 3, stopId: "5003", arrival: { time: 1_900_000_600, delay: null }, departure: null },
    ],
    timestamp: 1_900_000_000,
  };
  const boundaryVehicle = {
    id: "vp-boundary", trip: null, vehicle: { id: "boundary-vehicle", label: null, licensePlate: null },
    position: { latitude: 43.9050, longitude: -79.6000, bearing: null },
    currentStopSequence: 2, stopId: "5002", currentStatus: 1, timestamp: 1_900_000_300,
  };
  const vehicleMap = new Map([["boundary-vehicle", boundaryVehicle]]);
  const now = 1_900_000_300 * 1_000;

  // The fixture already places trip-503-Y exactly 300 s after trip-503-X -
  // runnerUp.score(300) - best.score(0) = 300 >= uniqueMarginS(300): unique.
  const atMargin = matchUpdate(boundaryUpdate, staticIndex, vehicleMap, { now });
  assert.equal(atMargin.classification, "unique");
  assert.equal(atMargin.matchedTripId, "trip-503-X");

  // One second inside the margin (299 < 300) flips the same update to ambiguous.
  const justInsideIndex = clone(staticIndex);
  justInsideIndex.routes["503"][1].stops.forEach((stop, index) => {
    stop.scheduledAt = justInsideIndex.routes["503"][0].stops[index].scheduledAt + 299;
  });
  const justInside = matchUpdate(boundaryUpdate, justInsideIndex, vehicleMap, { now });
  assert.equal(justInside.classification, "ambiguous");

  assert.notEqual(baseNow, now, "sanity: the two fixtures use independent clocks");
});

test("none: no candidate trip's schedule sits within plus or minus 60 minutes of the predicted time", async () => {
  const { staticIndex, tripUpdate, vehiclePosition, now } = await base();
  const vehicleMap = new Map([[vehiclePosition.vehicle.id, vehiclePosition]]);
  // trip-501-A/B/C's first stop is scheduled at 1800000000/600/1200. Predicting
  // 1800004900 for that same stop_sequence puts every one of them more than
  // matchWindowS (3600 s = 60 min) away, so nothing enters the scored set even
  // though the sequence number itself is perfectly ordinary (not misaligned).
  const farFuture = clone(tripUpdate);
  farFuture.stopTimeUpdate[0].arrival.time = 1_800_004_900;
  const match = matchUpdate(farFuture, staticIndex, vehicleMap, { now });
  assert.equal(match.classification, "none");
  assert.equal(match.matchedTripId, null);
});

test("none: an update naming a route the static index does not carry, or carrying no stop times, reports no candidate", async () => {
  const { staticIndex, tripUpdate, vehiclePosition, now } = await base();
  const vehicleMap = new Map([[vehiclePosition.vehicle.id, vehiclePosition]]);
  const unknownRoute = clone(tripUpdate); unknownRoute.trip.routeId = "999";
  assert.equal(matchUpdate(unknownRoute, staticIndex, vehicleMap, { now }).classification, "none");
  const noStopTimes = clone(tripUpdate); noStopTimes.stopTimeUpdate = [];
  assert.equal(matchUpdate(noStopTimes, staticIndex, vehicleMap, { now }).classification, "none");
  const noRoute = clone(tripUpdate); noRoute.trip.routeId = null;
  assert.equal(matchUpdate(noRoute, staticIndex, vehicleMap, { now }).classification, "none");
});

test("contradicted: a fresh vehicle roughly 2 km from the expected stop fails the position check", async () => {
  const { staticIndex, tripUpdate, vehiclePosition, now } = await base();
  // trip-501-B's expected stop at `now` is stop 2 (43.7050, -79.4000, see the
  // base "unique" test). 0.018 degrees of latitude is close to 2 km at this
  // latitude; well past the 300 m default positionToleranceM, so this is
  // unambiguously a contradiction rather than a near-miss.
  const farVehicle = clone(vehiclePosition);
  farVehicle.position = { latitude: vehiclePosition.position.latitude + 0.018, longitude: vehiclePosition.position.longitude, bearing: null };
  const match = matchUpdate(tripUpdate, staticIndex, new Map([[farVehicle.vehicle.id, farVehicle]]), { now });
  assert.equal(match.classification, "contradicted");
  assert.equal(match.matchedTripId, "trip-501-B");
  assert.equal(match.stopMappings, null);
  assert.ok(match.vehicleDistanceMetres > 1_900 && match.vehicleDistanceMetres < 2_100, `expected roughly 2 km, got ${match.vehicleDistanceMetres}`);
});

test("unverified: a unique score with no vehicle position, or one older than the freshness bound, is not confirmed", async () => {
  const { staticIndex, tripUpdate, vehiclePosition, now } = await base();
  const noVehicle = matchUpdate(tripUpdate, staticIndex, new Map(), { now });
  assert.equal(noVehicle.classification, "unverified");
  assert.equal(noVehicle.matchedTripId, "trip-501-B", "the score is still unique; only confirmation is missing");
  assert.equal(noVehicle.stopMappings, null);

  // vehicleFreshMs defaults to 120,000 ms; one second past it must already fail.
  const staleVehicle = clone(vehiclePosition); staleVehicle.timestamp = vehiclePosition.timestamp - 121;
  const stale = matchUpdate(tripUpdate, staticIndex, new Map([[staleVehicle.vehicle.id, staleVehicle]]), { now });
  assert.equal(stale.classification, "unverified");

  // One second inside the bound must still confirm, as a control for the case above.
  const justFreshVehicle = clone(vehiclePosition); justFreshVehicle.timestamp = vehiclePosition.timestamp - 119;
  const justFresh = matchUpdate(tripUpdate, staticIndex, new Map([[justFreshVehicle.vehicle.id, justFreshVehicle]]), { now });
  assert.equal(justFresh.classification, "unique");
});

test("sequence-misaligned: the first update's stop sequence exists on no candidate trip at all", async () => {
  const { staticIndex, tripUpdate, vehiclePosition, now } = await base();
  const vehicleMap = new Map([[vehiclePosition.vehicle.id, vehiclePosition]]);
  const misaligned = clone(tripUpdate); misaligned.stopTimeUpdate[0].stopSequence = 99;
  const match = matchUpdate(misaligned, staticIndex, vehicleMap, { now });
  assert.equal(match.classification, "sequence-misaligned");
  assert.equal(match.matchedTripId, null, "sequence-misaligned is diagnosed before any trip is scored");
});

// Regression test for a genuine bug found while hardening this suite: numberOr()
// used `Number(value)` before checking for null, and `Number(null) === 0`. A
// stop_time_update that (validly, per the GTFS-RT spec) identifies its stop by
// stop_id alone and omits stop_sequence decodes with `stopSequence: null`
// (see uint32() in this module), and numberOr(null, null) was returning 0
// instead of falling through to the null fallback. That turned "no published
// sequence" into "sequence number 0", which coincides with no real static
// stop_sequence (they are 1-based) and so was misreported as
// "sequence-misaligned" - a false alarm suggesting SEQUENCE_OFFSET is wrong
// when the real cause is simply an absent field. Fixed in numberOr(); this
// pins the corrected classification.
test("a stop_time_update with no published stop_sequence is an ordinary non-match, not a false sequence-misalignment alarm", async () => {
  const { staticIndex, tripUpdate, vehiclePosition, now } = await base();
  const vehicleMap = new Map([[vehiclePosition.vehicle.id, vehiclePosition]]);
  const noSequence = clone(tripUpdate); noSequence.stopTimeUpdate[0].stopSequence = null;
  const match = matchUpdate(noSequence, staticIndex, vehicleMap, { now });
  assert.equal(match.classification, "none");
});

test("the codec round-trips every optional field, present and absent, and re-encoding is byte-identical", () => {
  // Coordinates are deliberately exact half/quarter-degree values: GTFS-RT
  // encodes Position lat/lon as 32-bit floats, and an arbitrary decimal such
  // as 43.7050 does not survive a float32 round trip bit-for-bit (it decodes
  // back as 43.70500183105469). 43.5 and -79.25 need only a handful of
  // mantissa bits, well inside float32 precision, so they round-trip exactly -
  // this test is about the codec's field plumbing, not about float precision.
  const richFeed = {
    header: { gtfsRealtimeVersion: "2.0", incrementality: 0, timestamp: 1_800_000_000 },
    tripUpdates: [
      {
        id: "tu-1",
        trip: { tripId: "trip-1", startTime: "08:00:00", startDate: "20260909", scheduleRelationship: 0, routeId: "501", directionId: 1 },
        vehicle: { id: "veh-1", label: "Bus 1", licensePlate: "ABC123" },
        stopTimeUpdate: [
          { stopSequence: 1, stopId: "1001", arrival: { time: 1_800_000_100, delay: 45 }, departure: { time: 1_800_000_130, delay: 30 } },
          { stopSequence: 2, stopId: "1002", arrival: { time: 1_800_000_400, delay: -26 }, departure: null },
        ],
        timestamp: 1_800_000_000,
      },
      {
        // A trip update carrying only a route: every other trip-descriptor
        // field, its vehicle, and its timestamp are genuinely absent.
        id: "tu-2",
        trip: { tripId: null, startTime: null, startDate: null, scheduleRelationship: null, routeId: "502", directionId: null },
        vehicle: null,
        stopTimeUpdate: [],
        timestamp: null,
      },
    ],
    vehiclePositions: [
      {
        id: "vp-1",
        trip: { tripId: "trip-1", startTime: null, startDate: null, scheduleRelationship: null, routeId: "501", directionId: null },
        vehicle: { id: "veh-1", label: null, licensePlate: null },
        position: { latitude: 43.5, longitude: -79.25, bearing: 180 },
        currentStopSequence: 2, currentStatus: 1, stopId: "1002", timestamp: 1_800_000_000,
      },
      {
        // decodeVehiclePosition always returns a position object (never null),
        // even when no lat/lon/bearing was ever published - see vehicleLatLon()
        // and the encode side's `if (positionParts.length)` guard.
        id: "vp-2",
        trip: null, vehicle: null,
        position: { latitude: null, longitude: null, bearing: null },
        currentStopSequence: null, currentStatus: null, stopId: null, timestamp: null,
      },
    ],
  };

  const encodedOnce = encodeFeed(richFeed);
  const decoded = decodeFeed(encodedOnce);
  assert.deepEqual(decoded, richFeed);

  const encodedTwice = encodeFeed(decoded);
  assert.equal(Buffer.compare(Buffer.from(encodedOnce), Buffer.from(encodedTwice)), 0, "re-encoding a decoded feed must reproduce the exact original bytes");
});

test("classifyBatch's unique results are the only ones carrying a rewritable static trip, route, and stop mapping", async () => {
  const { staticIndex, tripUpdate, vehiclePosition, now } = await base();
  const misaligned = clone(tripUpdate); misaligned.stopTimeUpdate[0].stopSequence = 99;
  const ambiguousIndex = clone(staticIndex); ambiguousIndex.routes["501"].push(clone(ambiguousIndex.routes["501"][1]));
  // classifyBatch scores each update against its OWN staticIndex argument, so
  // this batch mixes an ordinary unique update with one that is only
  // ambiguous because of a route-local staticIndex mutation - both run through
  // the same call by giving the ambiguous one its own doctored update object.
  const ambiguousUpdate = clone(tripUpdate); ambiguousUpdate.id = "entity-ambiguous";
  const noVehicleUpdate = clone(tripUpdate); noVehicleUpdate.id = "entity-no-vehicle"; noVehicleUpdate.vehicle.id = "no-such-vehicle";

  const { counters, results } = classifyBatch(
    [tripUpdate, misaligned, noVehicleUpdate],
    staticIndex,
    [vehiclePosition],
    { now },
  );
  assert.deepEqual(counters, { total: 3, unique: 1, ambiguous: 0, none: 0, contradicted: 0, unverified: 1, sequenceMisaligned: 1 });

  const uniqueResults = results.filter((entry) => entry.match.classification === "unique");
  assert.equal(uniqueResults.length, 1);
  for (const { match } of uniqueResults) {
    assert.equal(typeof match.matchedTripId, "string");
    assert.equal(typeof match.matchedRouteId, "string");
    assert.ok(Array.isArray(match.stopMappings) && match.stopMappings.length > 0);
    for (const mapping of match.stopMappings) assert.ok(["1001", "1002", "1003"].includes(mapping.stopId), "a rewrite must only ever use static stop ids");
  }
  for (const { match } of results.filter((entry) => entry.match.classification !== "unique")) {
    assert.equal(match.stopMappings, null, "a non-unique classification must never carry a rewrite");
  }

  // The same shape ttc-trip-matcher.mjs's refreshFeedState() builds from these
  // results (id/trip/stopTimeUpdate straight off match.matchedTripId,
  // match.matchedRouteId and match.stopMappings) - proving that filtering to
  // "unique" and feeding the result through the exported codec produces a
  // feed containing only that one static-id trip.
  const rewritten = results
    .filter((entry) => entry.match.classification === "unique")
    .map(({ tripUpdate: original, match }) => ({
      id: original.id,
      trip: { tripId: match.matchedTripId, routeId: match.matchedRouteId, scheduleRelationship: 0 },
      stopTimeUpdate: match.stopMappings.map((mapping) => ({ stopSequence: mapping.sequence, stopId: mapping.stopId, arrival: { time: mapping.time } })),
      timestamp: Math.floor(now / 1_000),
    }));
  const rewrittenFeed = decodeFeed(encodeFeed({ tripUpdates: rewritten }));
  assert.equal(rewrittenFeed.tripUpdates.length, 1);
  assert.equal(rewrittenFeed.tripUpdates[0].trip.tripId, "trip-501-B");
  assert.equal(rewrittenFeed.tripUpdates[0].trip.routeId, "501");
  assert.deepEqual(rewrittenFeed.tripUpdates[0].stopTimeUpdate.map((update) => update.stopId), ["1001", "1002", "1003"]);
});

test("the rolling gate passes or fails exactly at its published thresholds (0.6 unique / 0.02 contradicted / 0.98 aligned)", () => {
  assert.deepEqual(DEFAULT_THRESHOLDS, { uniqueMin: 0.6, contradictedMax: 0.02, alignmentMin: 0.98 });
  const { uniqueMin, contradictedMax, alignmentMin } = DEFAULT_THRESHOLDS;
  // total: 100 makes every ratio a clean two-decimal fraction, so "exactly at
  // the threshold" is an exact integer count rather than a rounded one.
  const passingCounters = { total: 100, unique: uniqueMin * 100, ambiguous: 36, none: 0, contradicted: contradictedMax * 100, unverified: 0, sequenceMisaligned: (1 - alignmentMin) * 100 };
  const passing = gateVerdict(passingCounters);
  assert.equal(passing.uniqueRatio, 0.6); assert.equal(passing.contradictedRatio, 0.02); assert.equal(passing.alignmentRatio, 0.98);
  assert.equal(passing.passes, true, "every ratio sits exactly at its inclusive (>=/<=) boundary");

  const uniqueJustUnder = gateVerdict({ ...passingCounters, unique: 59, ambiguous: 37 });
  assert.equal(uniqueJustUnder.uniqueRatio, 0.59);
  assert.equal(uniqueJustUnder.passes, false);

  const contradictedJustOver = gateVerdict({ ...passingCounters, contradicted: 3, ambiguous: 35 });
  assert.equal(contradictedJustOver.contradictedRatio, 0.03);
  assert.equal(contradictedJustOver.passes, false);

  const alignmentJustUnder = gateVerdict({ ...passingCounters, sequenceMisaligned: 3, ambiguous: 35 });
  assert.equal(alignmentJustUnder.alignmentRatio, 0.97);
  assert.equal(alignmentJustUnder.passes, false);

  const noEvidenceYet = gateVerdict({ total: 0, unique: 0, ambiguous: 0, none: 0, contradicted: 0, unverified: 0, sequenceMisaligned: 0 });
  assert.equal(noEvidenceYet.passes, false, "zero updates must never read as a passing gate");
});

test("the gate merges a partial threshold override onto the defaults rather than discarding the rest", () => {
  const counters = { total: 100, unique: 50, ambiguous: 48, none: 0, contradicted: 2, unverified: 0, sequenceMisaligned: 2 };
  const result = gateVerdict(counters, { uniqueMin: 0.5 });
  assert.deepEqual(result.thresholds, { uniqueMin: 0.5, contradictedMax: 0.02, alignmentMin: 0.98 });
  assert.equal(result.passes, true, "0.5 uniqueRatio clears the lowered override; contradicted/alignment still clear the untouched defaults");
});

test("a service day rolls back to the previous calendar day before 04:00 Toronto time, and the cutover hour is configurable", () => {
  // GTFS static schedules that run past midnight encode times as HH:MM:SS
  // >= 24:00:00 instead of advancing the calendar date, so a trip observed
  // between midnight and the cutover hour (04:00 by default, chosen as an
  // ordinary early-morning transit schedule boundary) still belongs to the
  // PREVIOUS day's service_id. serviceDayToronto() rolls the calendar date
  // back by one in exactly that window: [00:00, 04:00) -> previous day,
  // [04:00, 24:00) -> the same day. All timestamps below are given with an
  // explicit -04:00 offset (Toronto observes EDT in September/October), so
  // the calendar arithmetic is being tested, not this file's own timezone.
  const at = (iso) => Date.parse(iso);
  assert.equal(serviceDayToronto(at("2026-09-10T00:00:00-04:00")), "20260909");
  assert.equal(serviceDayToronto(at("2026-09-10T01:00:00-04:00")), "20260909");
  assert.equal(serviceDayToronto(at("2026-09-10T03:59:00-04:00")), "20260909");
  // The cutover hour itself belongs to the new day: [00:00, cutoverHour) is a
  // half-open interval, and 04:00 is not less than 04:00.
  assert.equal(serviceDayToronto(at("2026-09-10T04:00:00-04:00")), "20260910");
  assert.equal(serviceDayToronto(at("2026-09-10T12:00:00-04:00")), "20260910");
  // Rolling back across a month boundary must land on the real last day of
  // the previous month (30 September), not "October 0" or a fixed "-1 day"
  // string manipulation.
  assert.equal(serviceDayToronto(at("2026-10-01T01:00:00-04:00")), "20260930");
  // cutoverHour: 0 means "never roll back" (hour < 0 is never true) - the
  // plain calendar date every time, including the small hours.
  assert.equal(serviceDayToronto(at("2026-09-10T00:30:00-04:00"), { cutoverHour: 0 }), "20260910");
  assert.equal(serviceDayToronto(at("2026-09-10T23:59:00-04:00"), { cutoverHour: 0 }), "20260910");
});
