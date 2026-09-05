import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WASHROOM_VISIT_MINUTES, MAX_WASHROOM_CANDIDATES, MAX_WASHROOM_CONCURRENCY, MAX_WASHROOM_DETOUR_DEADLINE_MS, planWashroomDetour } from "./washroom-detour.mjs";

const opened = {
  agencyId: "go",
  facilityId: "go-fixture",
  facilityType: "transit-station",
  names: ["Fixture Station"],
  source: "https://publisher.example/facility",
  coordinates: { lat: 43.65, lon: -79.38, sourceUrl: "https://publisher.example/gtfs", sourceReceiptId: "official-gtfs", reference: "GO GTFS stop_id=FIX" },
  hours: { timeZone: "America/Toronto", weekly: { mon: [{ open: "00:00", close: "23:59" }], tue: [{ open: "00:00", close: "23:59" }], wed: [{ open: "00:00", close: "23:59" }], thu: [{ open: "00:00", close: "23:59" }], fri: [{ open: "00:00", close: "23:59" }], sat: [{ open: "00:00", close: "23:59" }], sun: [{ open: "00:00", close: "23:59" }] } }
};

const referenceLibraryFromF187 = {
  agencyId: "toronto",
  facilityId: "toronto-library-toronto-reference-library",
  facilityType: "library",
  names: ["Toronto Reference Library"],
  source: "https://tpl.ca/locations/TRL/",
  sourceReceiptId: "tpl-toronto-reference-library",
  coordinates: { lat: 43.67195, lon: -79.38674, sourceUrl: "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/f5aa9b07-da35-45e6-b31f-d6790eb9bd9b/resource/5f4950b4-c727-4e54-8d0d-972e198268d6/download/tpl-branch-general-information-4326.geojson", sourceReceiptId: "tpl-branch-general-information-4326", reference: "Toronto Public Library BranchCode=TRL, _id=104" },
  hours: { status: "published", timezone: "America/Toronto", weekly: [{ days: ["monday", "tuesday", "wednesday", "thursday", "friday"], opens: "11:00", closes: "20:30", endsNextDay: false }], exceptions: [] }
};

function itinerary({ duration, endTime, id }) { return { itineraries: [{ id, duration, endTime, legs: [{ mode: "WALK" }] }] }; }

function input(overrides = {}) {
  return { currentPosition: { lat: 43.64, lon: -79.39 }, to: { lat: 43.7, lon: -79.35 }, via: [{ lat: 43.68, lon: -79.37 }], dateTime: "2026-09-07T12:00:00-04:00", ...overrides };
}

test("missing current coordinates never fall back to a name or original origin", async () => {
  const result = await planWashroomDetour(input({ currentPosition: { name: "Eglinton" }, from: { lat: 43.65, lon: -79.38 } }), { planWithOtp: async () => itinerary({ duration: 60, endTime: "2026-09-07T12:01:00-04:00", id: "unused" }), facilityRegistry: [opened] });
  assert.equal(result.status, "unroutable");
  assert.equal(result.unresolved.code, "CURRENT_POSITION_UNRESOLVED");
});

test("coordinate coercion and oversized via input are rejected before routing", async () => {
  let calls = 0;
  const planner = async () => { calls += 1; return itinerary({ duration: 60, endTime: "2026-09-07T12:01:00-04:00", id: "unused" }); };
  const nullCoordinate = await planWashroomDetour(input({ currentPosition: { lat: null, lon: null } }), { planWithOtp: planner, facilityRegistry: [opened] });
  assert.equal(nullCoordinate.unresolved.code, "CURRENT_POSITION_UNRESOLVED");
  const falseCoordinate = await planWashroomDetour(input({ to: { lat: false, lon: [] } }), { planWithOtp: planner, facilityRegistry: [opened] });
  assert.equal(falseCoordinate.unresolved.code, "DESTINATION_UNRESOLVED");
  const tooManyVia = await planWashroomDetour(input({ via: Array.from({ length: 6 }, (_, index) => ({ lat: 43.6 + index / 100, lon: -79.4 })) }), { planWithOtp: planner, facilityRegistry: [opened] });
  assert.equal(tooManyVia.unresolved.code, "VIA_LIMIT_EXCEEDED");
  assert.equal(calls, 0);
});

test("facility-only mode routes to a known-open library without inventing an onward journey", async () => {
  const calls = [];
  const result = await planWashroomDetour({ facilityOnly: true, currentPosition: { lat: 43.671, lon: -79.387 }, dateTime: "2026-09-08T12:00:00-04:00" }, {
    planWithOtp: async (request) => { calls.push(request); return itinerary({ duration: 90, endTime: "2026-09-08T12:01:30-04:00", id: "library" }); },
    facilityRegistry: [referenceLibraryFromF187]
  });
  assert.equal(calls.length, 1);
  assert.equal(result.status, "facility-only");
  assert.equal(result.scope, "facility-only");
  assert.equal(result.completeJourney, false);
  assert.equal(result.facility.facilityId, referenceLibraryFromF187.facilityId);
  assert.equal(result.continuation, null);
  assert.equal(result.unresolved, null);
});

test("a normal detour without the facility-only flag still requires a destination", async () => {
  let called = false;
  const result = await planWashroomDetour({ currentPosition: { lat: 43.671, lon: -79.387 }, dateTime: "2026-09-08T12:00:00-04:00" }, {
    planWithOtp: async () => { called = true; return itinerary({ duration: 90, endTime: "2026-09-08T12:01:30-04:00", id: "unused" }); },
    facilityRegistry: [referenceLibraryFromF187]
  });
  assert.equal(called, false);
  assert.equal(result.unresolved.code, "DESTINATION_UNRESOLVED");
  assert.equal(result.scope, undefined);
});

test("published facilities without coordinates remain explicitly unroutable", async () => {
  const result = await planWashroomDetour(input(), { planWithOtp: async () => { throw new Error("must not route"); }, facilityRegistry: [{ ...opened, coordinates: null, facilityId: "municipal-no-coordinate" }] });
  assert.equal(result.status, "unroutable");
  assert.equal(result.unresolved.code, "FACILITY_COORDINATES_UNAVAILABLE");
});

test("facility coordinates need official source evidence before routing", async () => {
  const unproven = { ...opened, facilityId: "unproven-coordinate", coordinates: { lat: 43.65, lon: -79.38 } };
  const result = await planWashroomDetour(input(), { planWithOtp: async () => { throw new Error("must not route"); }, facilityRegistry: [unproven] });
  assert.equal(result.unresolved.code, "FACILITY_COORDINATES_UNAVAILABLE");
});

test("a verified agency-qualified station identity can provide a facility coordinate", async () => {
  const identityFacility = {
    ...opened,
    facilityId: "station-index-facility",
    coordinates: null,
    stationIdentity: { agencyId: "go", stationId: "go:FIX", sourceUrl: "https://publisher.example/gtfs", sourceReceiptId: "official-gtfs", reference: "GO GTFS stop_id=FIX" }
  };
  const stopIndex = [{ id: "go:FIX", agencyId: "go", name: "Not Used For Matching", lat: 43.65, lon: -79.38 }];
  const planner = async (request) => request.to.lat === 43.65 ? itinerary({ duration: 60, endTime: "2026-09-07T12:01:00-04:00", id: "facility" }) : itinerary({ duration: 300, endTime: "2026-09-07T12:06:00-04:00", id: "continuation" });
  const result = await planWashroomDetour(input(), { planWithOtp: planner, facilityRegistry: [identityFacility], stopIndex });
  assert.equal(result.status, "complete");
  assert.equal(result.facilityLeg.locationSource.kind, "verified-stop-index");
  assert.equal(result.facilityLeg.locationSource.stopId, "go:FIX");
  assert.equal(result.facilityLeg.locationSource.sourceReceiptId, "official-gtfs");
});

test("unknown and closed-at-arrival facilities never become automatic detours", async () => {
  const unknown = { ...opened, facilityId: "unknown-hours", hours: { status: "unknown", timezone: "America/Toronto", weekly: null } };
  const unknownResult = await planWashroomDetour(input(), { planWithOtp: async () => { throw new Error("must not route"); }, facilityRegistry: [unknown] });
  assert.equal(unknownResult.unresolved.code, "NO_CONFIRMED_AVAILABILITY");
  const closed = { ...opened, facilityId: "closed-at-arrival", hours: { timeZone: "America/Toronto", weekly: { mon: [{ open: "08:00", close: "09:00" }] } } };
  let continuationCalls = 0;
  const closedResult = await planWashroomDetour(input(), { planWithOtp: async (request) => {
    if (request.from.lat === closed.coordinates.lat) continuationCalls += 1;
    return itinerary({ duration: 60, endTime: "2026-09-07T12:01:00-04:00", id: "facility" });
  }, facilityRegistry: [closed] });
  assert.equal(closedResult.unresolved.code, "NO_REACHABLE_OPEN_FACILITY");
  assert.equal(continuationCalls, 0);
});

test("a later complete facility wins over a nearer continuation failure and preserves destinations", async () => {
  const near = { ...opened, facilityId: "near", coordinates: { ...opened.coordinates, lat: 43.641, lon: -79.39 } };
  const farther = { ...opened, facilityId: "farther", coordinates: { ...opened.coordinates, lat: 43.645, lon: -79.39 } };
  const calls = [];
  const planner = async (request) => {
    calls.push(request);
    if (request.to.lat === near.coordinates.lat) return itinerary({ duration: 60, endTime: "2026-09-07T12:01:00-04:00", id: "near-leg" });
    if (request.to.lat === farther.coordinates.lat) return itinerary({ duration: 120, endTime: "2026-09-07T12:02:00-04:00", id: "farther-leg" });
    if (request.from.lat === near.coordinates.lat) return { itineraries: [] };
    return itinerary({ duration: 600, endTime: "2026-09-07T12:12:00-04:00", id: "remaining" });
  };
  const result = await planWashroomDetour(input(), { planWithOtp: planner, facilityRegistry: [near, farther] });
  assert.equal(result.status, "complete");
  assert.equal(result.completeJourney, true);
  assert.equal(result.facility.facilityId, "farther");
  assert.deepEqual(result.continuation.preservedTo, { lat: 43.7, lon: -79.35 });
  assert.deepEqual(result.continuation.preservedVia, [{ lat: 43.68, lon: -79.37 }]);
  assert.ok(calls.some((request) => request.from.lat === farther.coordinates.lat && request.via.length === 1));
});

test("a complete washroom request prioritizes facility arrival over a faster onward journey", async () => {
  const near = { ...opened, facilityId: "near-open", coordinates: { ...opened.coordinates, lat: 43.641, lon: -79.39 } };
  const farther = { ...opened, facilityId: "farther-open", coordinates: { ...opened.coordinates, lat: 43.645, lon: -79.39 } };
  const planner = async (request) => {
    if (request.to.lat === near.coordinates.lat) return itinerary({ duration: 60, endTime: "2026-09-07T12:01:00-04:00", id: "near-facility" });
    if (request.to.lat === farther.coordinates.lat) return itinerary({ duration: 120, endTime: "2026-09-07T12:02:00-04:00", id: "farther-facility" });
    if (request.from.lat === near.coordinates.lat) return itinerary({ duration: 1_000, endTime: "2026-09-07T12:27:40-04:00", id: "near-continuation" });
    return itinerary({ duration: 100, endTime: "2026-09-07T12:13:40-04:00", id: "farther-continuation" });
  };
  const result = await planWashroomDetour(input(), { planWithOtp: planner, facilityRegistry: [near, farther] });
  assert.equal(result.status, "complete");
  assert.equal(result.facility.facilityId, "near-open");
  assert.equal(result.facilityLeg.timeToFacilitySeconds, 60);
});

test("continuation starts after the planned visit duration and reports departure after visit", async () => {
  const calls = [];
  const planner = async (request) => {
    calls.push(request);
    return request.to.lat === opened.coordinates.lat
      ? itinerary({ duration: 60, endTime: "2026-09-07T12:01:00-04:00", id: "facility" })
      : itinerary({ duration: 300, endTime: "2026-09-07T12:21:00-04:00", id: "continuation" });
  };
  const result = await planWashroomDetour(input({ visitMinutes: 15 }), { planWithOtp: planner, facilityRegistry: [opened] });
  assert.equal(result.status, "complete");
  assert.equal(result.facilityLeg.visitDurationSeconds, 900);
  assert.equal(result.facilityLeg.departAfterVisit, "2026-09-07T16:16:00.000Z");
  assert.equal(result.continuation.departAfterVisit, "2026-09-07T16:16:00.000Z");
  assert.equal(calls[1].dateTime, "2026-09-07T16:16:00.000Z");
  assert.match(result.note, /not an observed dwell time/);
});

test("visit duration defaults to ten minutes and rejects invalid values before routing", async () => {
  let calls = 0;
  const planner = async (request) => { calls += 1; return request.to.lat === opened.coordinates.lat ? itinerary({ duration: 60, endTime: "2026-09-07T12:01:00-04:00", id: "facility" }) : itinerary({ duration: 300, endTime: "2026-09-07T12:16:00-04:00", id: "continuation" }); };
  const defaulted = await planWashroomDetour(input(), { planWithOtp: planner, facilityRegistry: [opened] });
  assert.equal(defaulted.facilityLeg.visitMinutes, DEFAULT_WASHROOM_VISIT_MINUTES);
  const invalid = await planWashroomDetour(input({ visitMinutes: 61 }), { planWithOtp: planner, facilityRegistry: [opened] });
  assert.equal(invalid.unresolved.code, "VISIT_DURATION_UNRESOLVED");
  assert.equal(calls, 2);
});

test("a confirmed immediate facility leg is partial when the continuation is unavailable", async () => {
  const planner = async (request) => request.to.lat === opened.coordinates.lat ? itinerary({ duration: 60, endTime: "2026-09-07T12:01:00-04:00", id: "facility" }) : { itineraries: [] };
  const result = await planWashroomDetour(input(), { planWithOtp: planner, facilityRegistry: [opened] });
  assert.equal(result.status, "partial");
  assert.equal(result.completeJourney, false);
  assert.equal(result.unresolved.code, "CONTINUATION_UNRESOLVED");
  assert.equal(result.facilityLeg.internalWalkingUnknown, true);
});

test("candidate pool and concurrent routing calls remain bounded", async () => {
  const facilities = Array.from({ length: 10 }, (_, index) => ({ ...opened, facilityId: `fixture-${index}`, coordinates: { ...opened.coordinates, lat: 43.641 + index / 10_000 } }));
  let active = 0; let maximum = 0; let calls = 0;
  const planner = async (request) => {
    calls += 1; active += 1; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return request.to.lat >= 43.7 ? itinerary({ duration: 300, endTime: "2026-09-07T12:05:00-04:00", id: "continuation" }) : itinerary({ duration: 60, endTime: "2026-09-07T12:01:00-04:00", id: "facility" });
  };
  const result = await planWashroomDetour(input(), { planWithOtp: planner, facilityRegistry: facilities });
  assert.ok(result.candidateCount <= MAX_WASHROOM_CANDIDATES);
  assert.ok(maximum <= MAX_WASHROOM_CONCURRENCY);
  assert.ok(calls <= MAX_WASHROOM_CANDIDATES * 2);
  assert.ok(MAX_WASHROOM_DETOUR_DEADLINE_MS < 25_000);
});
