import test from "node:test";
import assert from "node:assert/strict";
import { filterStopsForDate, rankPlaces, withServingRoutes } from "./places.mjs";
import { publishedStopForIdFromIndexes, routeStopAnchorsFromIndexes, servingRoutesFromIndexes } from "./stop-routes.mjs";

const routeIndex = {
  routes: [
    { id: "ttc:1", routeId: "1", shortName: "1", longName: "Summer One", agency: "TTC", feedId: "ttc", version: "ttc", color: "ED1B2F", textColor: "FFFFFF", routeType: "3", validity: { serviceStart: "20260726", serviceEnd: "20260905" } },
    { id: "ttc-next:1", routeId: "1", shortName: "1", longName: "Fall One", agency: "TTC", feedId: "ttc", version: "ttc-next", color: null, textColor: null, routeType: "3", validity: { serviceStart: "20260906", serviceEnd: "20261031", promoteAfter: "2026-09-05" } },
    { id: "ttc:2", routeId: "2", shortName: "2", longName: "Two", agency: "TTC", feedId: "ttc", version: "ttc", color: "00853F", textColor: "000000", routeType: "3", validity: { serviceStart: "20260726", serviceEnd: "20260905" } },
    { id: "go:40", routeId: "40", shortName: "40", longName: "Airport", agency: "GO Transit", feedId: "go", version: "go", color: "00AA44", textColor: "000000", routeType: "2", validity: {} },
  ],
};

const patternIndex = {
  stopRoutes: {
    "ttc:PARENT": ["ttc-next:1", "ttc:1", "ttc:2"],
    "ttc:CHILD-A": ["ttc-next:1", "ttc:1", "ttc:2"],
    "ttc-next:CHILD-A": ["ttc-next:1", "ttc:1", "ttc:2"],
    "ttc:CHILD-B": ["ttc-next:1", "ttc:1"],
  },
  stopAliases: {
    "ttc:PARENT": ["ttc-next:PARENT", "ttc:PARENT"],
    "ttc:CHILD-A": ["ttc-next:CHILD-A", "ttc:CHILD-A"],
    "ttc-next:CHILD-A": ["ttc-next:CHILD-A", "ttc:CHILD-A"],
    "ttc:ALIAS-ONLY": ["ttc-next:ALIAS-ONLY"],
  },
  routePatterns: {
    "ttc:1": [
      { id: "ttc:1:outbound", directionId: "0", stops: [{ id: "ttc:CHILD-A", sequence: 10, name: "Child A", lat: 43.7, lon: -79.4 }, { id: "ttc:CHILD-B", sequence: 20, name: "Child B", lat: 43.71, lon: -79.41 }] },
      { id: "ttc:1:inbound", directionId: "1", stops: [{ id: "ttc:CHILD-B", sequence: 10, name: "Child B", lat: 43.71, lon: -79.41 }, { id: "ttc:CHILD-A", sequence: 20, name: "Child A", lat: 43.7, lon: -79.4 }] },
    ],
    "ttc-next:1": [
      { id: "ttc-next:1:outbound", directionId: "0", stops: [{ id: "ttc-next:CHILD-A", sequence: 10, name: "Child A", lat: 43.7, lon: -79.4 }, { id: "ttc-next:CHILD-C", sequence: 30, name: "Child C", lat: 43.72, lon: -79.42 }] },
    ],
  },
};

const summerValidity = { serviceStart: "20260726", serviceEnd: "20260905", promoteAfter: null, retireAfter: null };
const fallValidity = { serviceStart: "20260906", serviceEnd: "20261031", promoteAfter: "2026-09-05", retireAfter: null };
const unknownValidity = { serviceStart: null, serviceEnd: null, promoteAfter: null, retireAfter: null };
const stopIndex = {
  stops: [
    { id: "ttc:PARENT", name: "Summer Parent", lat: 43.7, lon: -79.4, feedId: "ttc", graphFeedId: "ttc", locationType: 1, parentStation: null, code: "P", agency: "TTC", validity: summerValidity },
    { id: "ttc-next:PARENT", name: "Fall Parent", lat: 43.7, lon: -79.4, feedId: "ttc", graphFeedId: "ttc-next", locationType: 1, parentStation: null, code: "P", agency: "TTC", validity: fallValidity },
    { id: "ttc:CHILD-A", name: "Summer Platform A", lat: 43.7, lon: -79.4, feedId: "ttc", graphFeedId: "ttc", locationType: 0, parentStation: "PARENT", code: "A", agency: "TTC", validity: summerValidity },
    { id: "ttc-next:CHILD-A", name: "Fall Platform A", lat: 43.7, lon: -79.4, feedId: "ttc", graphFeedId: "ttc-next", locationType: 0, parentStation: "PARENT", code: "A", agency: "TTC", validity: fallValidity },
    { id: "ttc-next:ALIAS-ONLY", name: "Alias Only", lat: 43.71, lon: -79.41, feedId: "ttc", graphFeedId: "ttc-next", locationType: 0, parentStation: null, code: null, agency: "TTC", validity: fallValidity },
    { id: "ttc:NEARBY", name: "Nearby but unserved", lat: 43.7001, lon: -79.4001, feedId: "ttc", graphFeedId: "ttc", locationType: 0, parentStation: null, code: "N", agency: "TTC", validity: summerValidity },
  ],
};

test("a parent station receives the scheduled union of its direct children with official colors only", () => {
  const summer = servingRoutesFromIndexes(routeIndex, patternIndex, "ttc:PARENT", { date: "2026-09-05" });
  assert.deepEqual(summer.map((route) => route.id), ["ttc:1", "ttc:2"]);
  assert.equal(summer[0].color, "ED1B2F");
  assert.equal(summer[0].textColor, "FFFFFF");
  const fall = servingRoutesFromIndexes(routeIndex, patternIndex, "ttc:PARENT", { date: "2026-09-06" });
  assert.deepEqual(fall.map((route) => route.id), ["ttc-next:1"]);
  assert.equal(fall[0].color, null);
  assert.equal(fall[0].textColor, null);
  assert.equal(fall.some((route) => route.id === "go:40"), false);
});

test("serving routes are exact stop or parent-child matches, never nearby-coordinate guesses", () => {
  assert.deepEqual(servingRoutesFromIndexes(routeIndex, patternIndex, "ttc:CHILD-A", { date: "2026-09-05" }).map((route) => route.id), ["ttc:1", "ttc:2"]);
  assert.deepEqual(servingRoutesFromIndexes(routeIndex, patternIndex, "ttc:NEARBY", { date: "2026-09-05" }), []);
});

test("place suggestions attach the date-aware scheduled badge list without changing the source-backed stop", async () => {
  const calls = [];
  const result = await withServingRoutes([{ id: "ttc:PARENT", name: "Parent Station", lat: 43.7, lon: -79.4, kind: "stop" }], "2026-09-06", async (stopId, options) => {
    calls.push({ stopId, options });
    return servingRoutesFromIndexes(routeIndex, patternIndex, stopId, options);
  });
  assert.deepEqual(calls, [{ stopId: "ttc:PARENT", options: { date: "2026-09-06" } }]);
  assert.equal(result[0].name, "Parent Station");
  assert.deepEqual(result[0].servingRoutes.map((route) => route.id), ["ttc-next:1"]);
});

test("published stops resolve exact source IDs and explicit stable aliases without route or proximity guesses", () => {
  const summer = publishedStopForIdFromIndexes(stopIndex, routeIndex, patternIndex, "ttc:CHILD-A", { date: "2026-09-05" });
  assert.equal(summer.id, "ttc:CHILD-A");
  assert.equal(summer.name, "Summer Platform A");
  assert.deepEqual(summer.servingRoutes.map((route) => route.id), ["ttc:1", "ttc:2"]);
  const fall = publishedStopForIdFromIndexes(stopIndex, routeIndex, patternIndex, "ttc:CHILD-A", { date: "2026-09-06" });
  assert.equal(fall.id, "ttc-next:CHILD-A");
  assert.equal(fall.name, "Fall Platform A");
  assert.deepEqual(fall.servingRoutes.map((route) => route.id), ["ttc-next:1"]);
  assert.equal(publishedStopForIdFromIndexes(stopIndex, routeIndex, patternIndex, "ttc:ALIAS-ONLY", { date: "2026-09-06" })?.id, "ttc-next:ALIAS-ONLY");
  assert.equal(publishedStopForIdFromIndexes(stopIndex, routeIndex, patternIndex, "ttc:NOT-A-STOP", { date: "2026-09-06" }), null);
  assert.deepEqual(publishedStopForIdFromIndexes(stopIndex, routeIndex, patternIndex, "ttc:NEARBY", { date: "2026-09-05" })?.servingRoutes, []);
});

test("published stop anchors require exact source validity and select one active alias", () => {
  const stops = structuredClone(stopIndex);
  const patterns = structuredClone(patternIndex);
  stops.stops.push(
    { id: "ttc:STALE-DIRECT", name: "Stale direct", lat: 43.73, lon: -79.43, feedId: "ttc", graphFeedId: "ttc", locationType: 0, parentStation: null, code: null, agency: "TTC", validity: summerValidity },
    { id: "ttc:UNKNOWN-VALIDITY", name: "Unknown validity", lat: 43.74, lon: -79.44, feedId: "ttc", graphFeedId: "ttc", locationType: 0, parentStation: null, code: null, agency: "TTC", validity: unknownValidity },
    { id: "ttc:OLD-ALIAS", name: "Old alias", lat: 43.75, lon: -79.45, feedId: "ttc", graphFeedId: "ttc", locationType: 0, parentStation: null, code: null, agency: "TTC", validity: summerValidity },
    { id: "ttc-next:ACTIVE-ALIAS", name: "Active alias", lat: 43.75, lon: -79.45, feedId: "ttc", graphFeedId: "ttc-next", locationType: 0, parentStation: null, code: null, agency: "TTC", validity: fallValidity },
    { id: "ttc:STALE-ALIAS", name: "Stale alias source", lat: 43.76, lon: -79.46, feedId: "ttc", graphFeedId: "ttc", locationType: 0, parentStation: null, code: null, agency: "TTC", validity: summerValidity },
    { id: "ttc-next:STALE-ALIAS", name: "Stale alias target", lat: 43.76, lon: -79.46, feedId: "ttc", graphFeedId: "ttc-next", locationType: 0, parentStation: null, code: null, agency: "TTC", validity: summerValidity },
  );
  patterns.stopAliases["ttc:OLD-ALIAS"] = ["ttc:OLD-ALIAS", "ttc-next:ACTIVE-ALIAS"];
  patterns.stopAliases["ttc:STALE-ALIAS"] = ["ttc:STALE-ALIAS", "ttc-next:STALE-ALIAS"];
  assert.equal(publishedStopForIdFromIndexes(stops, routeIndex, patterns, "ttc:STALE-DIRECT", { date: "2026-09-06" }), null);
  assert.equal(publishedStopForIdFromIndexes(stops, routeIndex, patterns, "ttc:UNKNOWN-VALIDITY", { date: "2026-09-06" }), null);
  assert.equal(publishedStopForIdFromIndexes(stops, routeIndex, patterns, "ttc:STALE-ALIAS", { date: "2026-09-06" }), null);
  assert.equal(publishedStopForIdFromIndexes(stops, routeIndex, patterns, "ttc:OLD-ALIAS", { date: "2026-09-06" })?.id, "ttc-next:ACTIVE-ALIAS");
});

test("published stop anchors require numeric in-range source coordinates", () => {
  const invalid = [null, "", "   ", false, "43.7", Number.NaN, Infinity, 91];
  for (const [index, value] of invalid.entries()) {
    const stops = structuredClone(stopIndex);
    stops.stops.push({ id: `ttc-next:INVALID-${index}`, name: "Invalid coordinate", lat: value, lon: -79.4, feedId: "ttc", graphFeedId: "ttc-next", locationType: 0, parentStation: null, code: null, agency: "TTC", validity: fallValidity });
    assert.equal(publishedStopForIdFromIndexes(stops, routeIndex, patternIndex, `ttc-next:INVALID-${index}`, { date: "2026-09-06" }), null);
  }
  const zero = structuredClone(stopIndex);
  zero.stops.push({ id: "ttc-next:ZERO", name: "Prime Meridian", lat: 0, lon: 0, feedId: "ttc", graphFeedId: "ttc-next", locationType: 0, parentStation: null, code: null, agency: "TTC", validity: fallValidity });
  assert.deepEqual(publishedStopForIdFromIndexes(zero, routeIndex, patternIndex, "ttc-next:ZERO", { date: "2026-09-06" })?.id, "ttc-next:ZERO");
});

test("date-scoped place search excludes only known out-of-range feed versions before generic ranking", () => {
  const stops = [
    { id: "ttc-next:43274", name: "Eglinton Station", agency: "TTC", feedId: "ttc", locationType: 1, lat: 43.7, lon: -79.4, validity: { serviceStart: "20260906", serviceEnd: "20261031" } },
    { id: "ttc:43275", name: "Eglinton Station Platform", agency: "TTC", feedId: "ttc", locationType: 0, lat: 43.7001, lon: -79.4001, validity: { serviceStart: "20260726", serviceEnd: "20260905" } },
    { id: "ttc:unknown", name: "Eglinton Station Accessible Entrance", agency: "TTC", feedId: "ttc", locationType: 0, lat: 43.7002, lon: -79.4002, validity: {} },
  ];
  assert.equal(rankPlaces(stops, "Eglinton")[0].id, "ttc-next:43274");
  const septemberFive = filterStopsForDate(stops, "2026-09-05");
  assert.deepEqual(septemberFive.map((stop) => stop.id), ["ttc:43275", "ttc:unknown"]);
  assert.equal(rankPlaces(septemberFive, "Eglinton")[0].id, "ttc:43275");
  const septemberSix = filterStopsForDate(stops, "2026-09-06");
  assert.deepEqual(septemberSix.map((stop) => stop.id), ["ttc-next:43274", "ttc:unknown"]);
  assert.equal(rankPlaces(septemberSix, "Eglinton")[0].id, "ttc-next:43274");
});

test("route stop anchors choose a dated version alias and retain official direction-specific full sequences", () => {
  const fall = routeStopAnchorsFromIndexes(routeIndex, patternIndex, { feedId: "ttc", routeId: "1" }, { date: "2026-09-06" });
  assert.equal(fall.route.id, "ttc-next:1");
  assert.deepEqual(fall.patterns, [{ id: "ttc-next:1:outbound", directionId: "0", stops: [{ id: "ttc-next:CHILD-A", sequence: 10, name: "Child A", lat: 43.7, lon: -79.4 }, { id: "ttc-next:CHILD-C", sequence: 30, name: "Child C", lat: 43.72, lon: -79.42 }] }]);
  const summer = routeStopAnchorsFromIndexes(routeIndex, patternIndex, "ttc:1", { date: "2026-09-05" });
  assert.deepEqual(summer.patterns.map((pattern) => pattern.directionId), ["0", "1"]);
  assert.deepEqual(summer.patterns[1].stops.map((stop) => stop.id), ["ttc:CHILD-B", "ttc:CHILD-A"]);
  assert.equal(routeStopAnchorsFromIndexes(routeIndex, patternIndex, { feedId: "ttc", routeId: "2" }, { date: "2026-09-06" }), null);
});
