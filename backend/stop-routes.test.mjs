import test from "node:test";
import assert from "node:assert/strict";
import { withServingRoutes } from "./places.mjs";
import { routeStopAnchorsFromIndexes, servingRoutesFromIndexes } from "./stop-routes.mjs";

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
    "ttc:CHILD-B": ["ttc-next:1", "ttc:1"],
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

test("route stop anchors choose a dated version alias and retain official direction-specific full sequences", () => {
  const fall = routeStopAnchorsFromIndexes(routeIndex, patternIndex, { feedId: "ttc", routeId: "1" }, { date: "2026-09-06" });
  assert.equal(fall.route.id, "ttc-next:1");
  assert.deepEqual(fall.patterns, [{ id: "ttc-next:1:outbound", directionId: "0", stops: [{ id: "ttc-next:CHILD-A", sequence: 10, name: "Child A", lat: 43.7, lon: -79.4 }, { id: "ttc-next:CHILD-C", sequence: 30, name: "Child C", lat: 43.72, lon: -79.42 }] }]);
  const summer = routeStopAnchorsFromIndexes(routeIndex, patternIndex, "ttc:1", { date: "2026-09-05" });
  assert.deepEqual(summer.patterns.map((pattern) => pattern.directionId), ["0", "1"]);
  assert.deepEqual(summer.patterns[1].stops.map((stop) => stop.id), ["ttc:CHILD-B", "ttc:CHILD-A"]);
  assert.equal(routeStopAnchorsFromIndexes(routeIndex, patternIndex, { feedId: "ttc", routeId: "2" }, { date: "2026-09-06" }), null);
});
