import test from "node:test";
import assert from "node:assert/strict";
import { calendarDateInTimeZone, coverage, coverageContextForDate, graphProvenance, groupGraphFeeds, rankPlaces, searchPlaces } from "./places.mjs";
import { applyWashroomPreference } from "./washrooms.mjs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { spawn } from "node:child_process";
import { graphqlDocument, planWithOtp, publicAgencyFeedId, rankItineraries } from "./otp-client.mjs";
import { filterRouteCatalog, isCalendarDate, routeCatalogPage } from "./routes.mjs";

let viaResolverModule = null;
async function resolveViaPlacesForTest() {
  if (viaResolverModule) return viaResolverModule.resolveViaPlaces;
  viaResolverModule = await import(`./server.mjs?via-resolver=${Date.now()}`);
  return viaResolverModule.resolveViaPlaces;
}

test("via resolution uses only a date-valid published stop with compatible coordinates", async () => {
  const resolveViaPlaces = await resolveViaPlacesForTest();
  const calls = [];
  const places = await resolveViaPlaces([
    { id: "ttc:old-platform", name: "Selected platform", lat: 43.7, lon: -79.4 },
    { stopId: "untrusted:stop", name: "Untrusted", lat: 43.71, lon: -79.41 },
    { stationId: "ttc:old-platform", name: "Moved coordinate", lat: 43.9, lon: -79.4 },
    { id: "map", name: "Map point", lat: 43.72, lon: -79.42 },
  ], {
    date: "2026-09-06",
    lookup: async (id, options) => {
      calls.push({ id, options });
      return id === "ttc:old-platform" ? { id: "ttc-next:live-platform", lat: 43.7002, lon: -79.4002 } : null;
    },
  });
  assert.deepEqual(calls, [
    { id: "ttc:old-platform", options: { date: "2026-09-06" } },
    { id: "untrusted:stop", options: { date: "2026-09-06" } },
    { id: "ttc:old-platform", options: { date: "2026-09-06" } },
  ]);
  assert.deepEqual(places, [
    { name: "Selected platform", lat: 43.7, lon: -79.4, stopId: "ttc-next:live-platform" },
    { name: "Untrusted", lat: 43.71, lon: -79.41 },
    { name: "Moved coordinate", lat: 43.9, lon: -79.4 },
    { name: "Map point", lat: 43.72, lon: -79.42 },
  ]);
});

test("places are sourced from the generated local stop index", async () => {
  const places = await searchPlaces("union");
  assert.ok(Array.isArray(places));
  assert.ok(places.every((place) => place.kind === "stop" && Number.isFinite(place.lat)));
});
test("coverage reflects only validated feeds", async () => {
  const result = await coverage();
  assert.equal(result.indexedStops, 0);
  assert.deepEqual(result.agencies, []);
});
test("OTP query uses the real planConnection GraphQL operation", () => {
  assert.match(graphqlDocument, /planConnection/);
  assert.match(graphqlDocument, /\$via:\[PlanViaLocationInput!\]/);
  assert.match(graphqlDocument, /via:\$via/);
  assert.match(graphqlDocument, /viaLocationType/);
  assert.match(graphqlDocument, /stop \{ gtfsId locationType parentStation \{ gtfsId \} \}/);
  assert.match(graphqlDocument, /intermediatePlaces \{ name lat lon stop \{ gtfsId locationType parentStation \{ gtfsId \} \} \}/);
  assert.match(graphqlDocument, /legGeometry/);
  assert.match(graphqlDocument, /trip \{ gtfsId \}/);
  assert.match(graphqlDocument, /agency \{ gtfsId name \}/);
});

test("native OTP planning submits ordered visit points in one request", async (context) => {
  const requests = [];
  const mock = http.createServer(async (request, response) => {
    let body = ""; for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    const data = {
      planConnection: {
        edges: [{ node: {
          start: "2026-09-05T09:00:00-04:00", end: "2026-09-05T09:35:00-04:00", duration: "PT35M", walkDistance: 80, numberOfTransfers: 1,
          legs: [
            { mode: "BUS", start: { scheduledTime: "2026-09-05T09:00:00-04:00" }, end: { scheduledTime: "2026-09-05T09:15:00-04:00" }, duration: "PT15M", distance: 1200, from: { name: "Origin", lat: 43.7, lon: -79.4, stop: { gtfsId: "ttc-next:origin-platform", locationType: "STOP", parentStation: { gtfsId: "ttc-next:origin-station" } } }, to: { name: "First", lat: 43.68, lon: -79.39, viaLocationType: "VISIT", stop: { gtfsId: "ttc-next:first-platform", locationType: "STOP", parentStation: { gtfsId: "ttc-next:first-station" } } }, intermediatePlaces: [{ name: "Passed platform", lat: 43.69, lon: -79.395, stop: { gtfsId: "ttc-next:passed-platform", locationType: "STOP", parentStation: null } }, { name: "Unmapped place", lat: 43.691, lon: -79.394 }], route: { gtfsId: "ttc-next:5", shortName: "5", longName: "Display route", agency: { gtfsId: "ttc-next:1", name: "TTC" } }, trip: { gtfsId: "ttc-next:trip-5" } },
            { mode: "RAIL", start: { scheduledTime: "2026-09-05T09:20:00-04:00" }, end: { scheduledTime: "2026-09-05T09:35:00-04:00" }, duration: "PT15M", distance: 1400, from: { name: "First", lat: 43.68, lon: -79.39, viaLocationType: "VISIT" }, to: { name: "Second", lat: 43.66, lon: -79.38, viaLocationType: "VISIT", stop: { gtfsId: "ttc-next:second-station", locationType: "STATION", parentStation: null } } }
          ]
        } }]
      }
    };
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ data }));
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  context.after(() => mock.close());
  const input = { otpUrl: `http://127.0.0.1:${mock.address().port}`, timeoutMs: 1000, from: { lat: 43.7, lon: -79.4, name: "Origin" }, to: { lat: 43.65, lon: -79.37, name: "Destination" }, via: [{ lat: 43.68, lon: -79.39, name: "First" }, { lat: 43.66, lon: -79.38, name: "Second" }], dateTime: "2026-09-05T09:00:00-04:00", arriveBy: false, wheelchair: false, maxWalkDistance: 2000, preference: "fastest", maxResults: 10 };
  const result = await planWithOtp(input);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].variables.first, 1);
  assert.deepEqual(requests[0].variables.dateTime, { earliestDeparture: input.dateTime });
  assert.deepEqual(requests[0].variables.via, [
    { visit: { coordinate: { latitude: 43.68, longitude: -79.39 }, label: "First", minimumWaitTime: "PT0S" } },
    { visit: { coordinate: { latitude: 43.66, longitude: -79.38 }, label: "Second", minimumWaitTime: "PT0S" } }
  ]);
  assert.equal(result.itineraries.length, 1);
  assert.equal(result.itineraries[0].viaComplete, true);
  assert.equal(result.itineraries[0].viaVisitCount, 2);
  assert.deepEqual(result.itineraries[0].legs.map((leg) => leg.to.viaLocationType), ["VISIT", "VISIT"]);
  assert.deepEqual(result.itineraries[0].legs[0].from, { name: "Origin", lat: 43.7, lon: -79.4, id: "ttc-next:origin-platform", stopId: "ttc-next:origin-platform", stationId: "ttc-next:origin-station", agencyFeedId: "ttc", locationType: "STOP" });
  assert.deepEqual(result.itineraries[0].legs[0].intermediateStops[0], { name: "Passed platform", lat: 43.69, lon: -79.395, id: "ttc-next:passed-platform", stopId: "ttc-next:passed-platform", agencyFeedId: "ttc", locationType: "STOP" });
  assert.equal(Object.hasOwn(result.itineraries[0].legs[0].intermediateStops[1], "id"), false);
  assert.deepEqual(result.itineraries[0].legs[1].to, { name: "Second", lat: 43.66, lon: -79.38, id: "ttc-next:second-station", stopId: "ttc-next:second-station", stationId: "ttc-next:second-station", agencyFeedId: "ttc", locationType: "STATION", viaLocationType: "VISIT" });
  assert.equal(result.itineraries[0].legs[0].routeId, "ttc-next:5");
  assert.equal(result.itineraries[0].legs[0].routeGtfsId, "ttc-next:5");
  assert.equal(result.itineraries[0].legs[0].route, "5");
  assert.equal(result.itineraries[0].legs[0].agencyFeedId, "ttc");
  await planWithOtp({ ...input, arriveBy: true });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].variables.dateTime, { latestArrival: input.dateTime });
  await planWithOtp({ ...input, via: [] });
  assert.equal(requests.length, 3);
  assert.equal(requests[2].variables.first, input.maxResults);
  assert.equal(requests[2].variables.via, null);
});

test("native OTP planning drops an incomplete ordered route instead of returning a partial journey", async (context) => {
  const mock = http.createServer(async (request, response) => {
    for await (const _chunk of request) {}
    const data = { planConnection: { edges: [{ node: {
      start: "2026-09-05T09:00:00-04:00", end: "2026-09-05T09:15:00-04:00", duration: "PT15M", walkDistance: 0, numberOfTransfers: 0,
      legs: [
        { mode: "BUS", start: { scheduledTime: "2026-09-05T09:00:00-04:00" }, end: { scheduledTime: "2026-09-05T09:15:00-04:00" }, duration: "PT15M", distance: 1200, from: { name: "Origin", lat: 43.7, lon: -79.4 }, to: { name: "First", lat: 43.68, lon: -79.39, viaLocationType: "VISIT" } },
        { mode: "RAIL", start: { scheduledTime: "2026-09-05T09:20:00-04:00" }, end: { scheduledTime: "2026-09-05T09:30:00-04:00" }, duration: "PT10M", distance: 1000, from: { name: "First", lat: 43.68, lon: -79.39, viaLocationType: "VISIT" }, to: { name: "Destination", lat: 43.65, lon: -79.37 } }
      ]
    } }] } };
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ data }));
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  context.after(() => mock.close());
  const result = await planWithOtp({ otpUrl: `http://127.0.0.1:${mock.address().port}`, timeoutMs: 1000, from: { lat: 43.7, lon: -79.4, name: "Origin" }, to: { lat: 43.65, lon: -79.37, name: "Destination" }, via: [{ lat: 43.68, lon: -79.39, name: "First" }, { lat: 43.66, lon: -79.38, name: "Second" }], dateTime: "2026-09-05T09:00:00-04:00", arriveBy: false, wheelchair: false, maxWalkDistance: 2000, preference: "fastest", maxResults: 10 });
  assert.deepEqual(result.itineraries, []);
  assert.equal(result.failedSegment.from.name, "First");
  assert.deepEqual(result.failedSegment, { from: { name: "First", lat: 43.68, lon: -79.39 }, to: { name: "Second", lat: 43.66, lon: -79.38 }, state: "unverified" });
});

test("native OTP planning rejects visit markers that are not in the requested order", async (context) => {
  const mock = http.createServer(async (request, response) => {
    for await (const _chunk of request) {}
    const data = { planConnection: { edges: [{ node: {
      start: "2026-09-05T09:00:00-04:00", end: "2026-09-05T09:20:00-04:00", duration: "PT20M", walkDistance: 0, numberOfTransfers: 1,
      legs: [
        { mode: "BUS", start: { scheduledTime: "2026-09-05T09:00:00-04:00" }, end: { scheduledTime: "2026-09-05T09:10:00-04:00" }, duration: "PT10M", distance: 1000, from: { name: "Origin", lat: 43.7, lon: -79.4 }, to: { name: "Second", lat: 43.66, lon: -79.38, viaLocationType: "VISIT" } },
        { mode: "RAIL", start: { scheduledTime: "2026-09-05T09:10:00-04:00" }, end: { scheduledTime: "2026-09-05T09:20:00-04:00" }, duration: "PT10M", distance: 1000, from: { name: "Second", lat: 43.66, lon: -79.38, viaLocationType: "VISIT" }, to: { name: "First", lat: 43.68, lon: -79.39, viaLocationType: "VISIT" } }
      ]
    } }] } };
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ data }));
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  context.after(() => mock.close());
  const result = await planWithOtp({ otpUrl: `http://127.0.0.1:${mock.address().port}`, timeoutMs: 1000, from: { lat: 43.7, lon: -79.4, name: "Origin" }, to: { lat: 43.65, lon: -79.37, name: "Destination" }, via: [{ lat: 43.68, lon: -79.39, name: "First" }, { lat: 43.66, lon: -79.38, name: "Second" }], dateTime: "2026-09-05T09:00:00-04:00", arriveBy: false, wheelchair: false, maxWalkDistance: 2000, preference: "fastest", maxResults: 10 });
  assert.deepEqual(result.itineraries, []);
  assert.deepEqual(result.failedSegment, { from: { name: "First", lat: 43.68, lon: -79.39 }, to: { name: "Second", lat: 43.66, lon: -79.38 }, state: "unverified" });
});
test("graph provenance has a safe unavailable state", async () => {
  const result = await graphProvenance();
  assert.equal(result.source, "OpenTripPlanner");
  assert.ok(Array.isArray(result.feeds));
});
test("washroom preference only promotes confirmed transit facilities", async () => {
  const facilityRegistry = [{ agencyId: "ttc", facilityId: "ttc-finch", stationIds: ["ttc:FINCH"], facilityType: "transit-station", names: ["Finch"], source: "https://publisher.example/finch", hours: { timeZone: "America/Toronto", weekly: { mon: [{ open: "08:00", close: "20:00" }] } } }];
  const base = { duration: 1000, walkDistance: 100, legs: [{ mode: "SUBWAY", agencyId: "ttc", startTime: "2026-09-07T12:00:00-04:00", endTime: "2026-09-07T12:15:00-04:00", distance: 500, from: { name: "Origin", lat: 43.6, lon: -79.4 }, to: { name: "Finch Station", stationId: "ttc:FINCH", lat: 43.78, lon: -79.41 } }] };
  const other = { duration: 900, walkDistance: 50, legs: [{ distance: 400, from: { name: "Origin", lat: 43.6, lon: -79.4 }, to: { name: "Generic Mall", lat: 43.7, lon: -79.4 } }] };
  const result = await applyWashroomPreference([other, base], true, { facilityRegistry });
  assert.equal(result.itineraries[0].washrooms[0].name, "Finch");
  assert.equal(result.itineraries[0].legs[0].to.washroom.facilityId, "ttc-finch");
  assert.equal(result.itineraries[0].washroomPreferenceApplied, true);
  assert.equal(result.itineraries[0].totalDistance, 500);
});
test("washroom metadata reaches pass-through stops without changing preference ranking", async () => {
  const facilityRegistry = [{ agencyId: "ttc", facilityId: "ttc-pass-through", stationIds: ["ttc:PASS"], facilityType: "transit-station", names: ["Pass Through"], source: "https://publisher.example/pass-through", hours: { timeZone: "America/Toronto", weekly: { mon: [{ open: "08:00", close: "20:00" }] } } }];
  const route = { duration: 600, walkDistance: 100, legs: [{ mode: "SUBWAY", agencyId: "ttc", startTime: "2026-09-07T12:00:00-04:00", endTime: "2026-09-07T12:10:00-04:00", distance: 300, from: { name: "Boarding", lat: 43.6, lon: -79.4 }, to: { name: "Alighting", lat: 43.61, lon: -79.39 }, intermediateStops: [{ name: "Pass Through", stationId: "ttc:PASS", lat: 43.605, lon: -79.395 }] }] };
  const result = await applyWashroomPreference([route], true, { facilityRegistry });
  assert.equal(result.itineraries[0].legs[0].intermediateStops[0].washroom.facilityId, "ttc-pass-through");
  assert.deepEqual(result.itineraries[0].washrooms, []);
  assert.equal(result.washroomPreferenceApplied, false);
});
test("unknown transit presence can be preferred without presenting it as open", async () => {
  const at = "2026-09-07T12:00:00-04:00";
  const facilityRegistry = [
    { agencyId: "ttc", facilityId: "ttc-unknown", stationIds: ["ttc:UNKNOWN"], facilityType: "transit-station", names: ["Unknown Transit"], source: "https://publisher.example/transit", hours: { status: "unknown", timezone: "America/Toronto", weekly: null } },
    { agencyId: "toronto", facilityId: "municipal-unknown", stationIds: ["toronto:UNKNOWN"], facilityType: "library", names: ["Unknown Library"], source: "https://publisher.example/library", hours: { status: "unknown", timezone: "America/Toronto", weekly: null } },
    { agencyId: "ttc", facilityId: "ttc-closed", stationIds: ["ttc:CLOSED"], facilityType: "transit-station", names: ["Closed Transit"], source: "https://publisher.example/closed", hours: { timeZone: "America/Toronto", weekly: { mon: [{ open: "08:00", close: "09:00" }] } } }
  ];
  const leg = (agencyId, stationId, name) => ({ mode: "SUBWAY", agencyId, startTime: at, endTime: "2026-09-07T12:10:00-04:00", distance: 200, from: { name: "Origin", lat: 43.6, lon: -79.4 }, to: { name, stationId, lat: 43.61, lon: -79.39 } });
  const transitUnknown = { id: "transit-unknown", duration: 1000, walkDistance: 100, legs: [leg("ttc", "ttc:UNKNOWN", "Unknown Transit")] };
  const municipalUnknown = { id: "municipal-unknown", duration: 900, walkDistance: 100, legs: [leg("toronto", "toronto:UNKNOWN", "Unknown Library")] };
  const transitClosed = { id: "transit-closed", duration: 800, walkDistance: 100, legs: [leg("ttc", "ttc:CLOSED", "Closed Transit")] };
  const result = await applyWashroomPreference([municipalUnknown, transitClosed, transitUnknown], true, { facilityRegistry });
  assert.equal(result.itineraries[0].id, "transit-unknown");
  assert.equal(result.itineraries[0].washrooms[0].availability, "unknown");
  assert.equal(result.washroomPreferenceApplied, true);
  assert.deepEqual(result.itineraries.find((item) => item.id === "municipal-unknown").washrooms, []);
  assert.deepEqual(result.itineraries.find((item) => item.id === "transit-closed").washrooms, []);
  assert.match(result.note, /not an open claim/);
});
test("one facility across two platform endpoints does not outrank two distinct facilities", async () => {
  const at = "2026-09-07T12:00:00-04:00";
  const facility = (facilityId, stationIds) => ({ agencyId: "ttc", facilityId, stationIds, facilityType: "transit-station", names: [facilityId], source: `https://publisher.example/${facilityId}`, hours: { timeZone: "America/Toronto", weekly: { mon: [{ open: "08:00", close: "20:00" }] } } });
  const facilityRegistry = [facility("eglinton", ["ttc:EGL-1", "ttc:EGL-2"]), facility("finch", ["ttc:FINCH"])];
  const leg = (from, to) => ({ mode: "SUBWAY", agencyId: "ttc", startTime: at, endTime: "2026-09-07T12:10:00-04:00", distance: 200, from, to });
  const doubled = { id: "two-platforms", duration: 900, walkDistance: 50, legs: [leg({ name: "Eglinton South", stationId: "ttc:EGL-1", lat: 43.7, lon: -79.4 }, { name: "Elsewhere", lat: 43.71, lon: -79.4 }), leg({ name: "Elsewhere", lat: 43.71, lon: -79.4 }, { name: "Eglinton North", stationId: "ttc:EGL-2", lat: 43.7, lon: -79.4 })] };
  const distinct = { id: "two-facilities", duration: 1000, walkDistance: 100, legs: [leg({ name: "Eglinton", stationId: "ttc:EGL-1", lat: 43.7, lon: -79.4 }, { name: "Finch", stationId: "ttc:FINCH", lat: 43.78, lon: -79.41 })] };
  const result = await applyWashroomPreference([doubled, distinct], true, { facilityRegistry });
  assert.equal(result.itineraries[0].id, "two-facilities");
  assert.equal(result.itineraries.find((item) => item.id === "two-platforms").washrooms.length, 1);
  assert.equal(result.itineraries.find((item) => item.id === "two-facilities").washrooms.length, 2);
});
test("service readiness uses a typed public code without guessing an agency", async () => {
  const source = await readFile(new URL("./server.mjs", import.meta.url), "utf8");
  assert.match(source, /code: "ROUTER_UNAVAILABLE"/);
  assert.match(source, /await otpReady\(/);
  assert.doesNotMatch(source, /inTtcArea|SCHEDULE_DATE_UNAVAILABLE/);
  assert.match(source, /"\/api\/vehicles\/metrolinx"/);
  assert.match(source, /"\/api\/routes"/);
  assert.match(source, /Buffer\.byteLength\(req\.url \?\? ""\) > max/);
  assert.match(source, /isCalendarDate\(date\)/);
  assert.match(source, /code: "VEHICLE_DATA_UNAVAILABLE"/);
});
test("backend container copies the shared washroom matcher", async () => {
  const dockerfile = await readFile(new URL("./Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /^COPY shared\/washrooms\.mjs \/shared\/washrooms\.mjs$/m);
  assert.match(dockerfile, /^COPY shared\/washroom-identities\.mjs \/shared\/washroom-identities\.mjs$/m);
});
test("Pearson search ranks transit airports before unrelated street stops", () => {
  const streets = Array.from({ length: 25 }, (_, index) => ({ id: `yrt:${index}`, name: `Pearson Av at Street ${index}`, agency: "YRT", feedId: "yrt" }));
  const ranked = rankPlaces([...streets, { id: "up:PA", name: "UP Express Pearson Airport", agency: "UP Express", feedId: "up" }, { id: "go:PA", name: "Pearson Airport Terminal 1", agency: "GO Transit", feedId: "go" }], "Pearson", 20);
  assert.equal(ranked[0].id, "go:PA");
  assert.equal(ranked[1].id, "up:PA");
});
test("place ranking collapses coordinate duplicates but preserves distinct same-name stops", () => {
  const ranked = rankPlaces([{ id: "ttc:2", name: "Finch Station", agency: "TTC", feedId: "ttc", locationType: 0, lat: 43.7801, lon: -79.4151 }, { id: "ttc:1", name: "Finch Station", agency: "TTC", feedId: "ttc", locationType: 1, lat: 43.7801, lon: -79.4151 }, { id: "ttc:3", name: "Finch Station", agency: "TTC", feedId: "ttc", locationType: 0, lat: 43.7802, lon: -79.4152 }, { id: "ttc:4", name: "Finch Station", agency: "TTC", feedId: "ttc", locationType: 0 }], "Finch", 20);
  assert.deepEqual(ranked.map((place) => place.id), ["ttc:1", "ttc:3", "ttc:4"]);
  assert.equal(ranked[0].feedId, "ttc");
  assert.equal(ranked[0].locationType, 1);
});
test("place suggestions support bounded prefixes, road forms, diacritics, and intersection word order", () => {
  const stops = [
    { id: "fixture:warden-hwy7", name: "Warden Avenue & Highway 7", agency: "Fixture Transit", feedId: "fixture", locationType: 1 },
    { id: "fixture:ward-avenue", name: "Ward Avenue", agency: "Fixture Transit", feedId: "fixture" },
    { id: "fixture:highway7", name: "Highway 7", agency: "Fixture Transit", feedId: "fixture" },
    { id: "fixture:yonge-eglinton", name: "Yonge Street & Eglinton Avenue", agency: "Fixture Transit", feedId: "fixture", locationType: 1 },
    { id: "fixture:union-station", name: "Union Station", agency: "Fixture Transit", feedId: "fixture", locationType: 1 },
    { id: "fixture:union-avenue", name: "Union Avenue at Queen", agency: "Fixture Transit", feedId: "fixture" },
    { id: "fixture:saint-clair", name: "Saint Clair Avenue", agency: "Fixture Transit", feedId: "fixture" },
    { id: "fixture:station-clair", name: "Station Clair Avenue", agency: "Fixture Transit", feedId: "fixture" },
    { id: "fixture:high-park", name: "High Park", agency: "Fixture Transit", feedId: "fixture" },
    { id: "fixture:route-place", name: "Route Place", agency: "Fixture Transit", feedId: "fixture" },
    { id: "fixture:building-12a", name: "12A Warden Avenue", agency: "Fixture Transit", feedId: "fixture" },
    { id: "fixture:route-501x", name: "Route 501X", agency: "Fixture Transit", feedId: "fixture" },
    { id: "fixture:yonge-station", name: "Yonge Station", agency: "Fixture Transit", feedId: "fixture", locationType: 1 },
    { id: "fixture:york-mills", name: "York Mills Station", agency: "Fixture Transit", feedId: "fixture", locationType: 1 },
  ];
  for (const query of ["Warden Highway 7", "Warden Highway7", "Warden Hwy 7", "ward high 7", "ward high7", "Highway 7 Warden", "Highway7Warden", "highway7warden"]) assert.equal(rankPlaces(stops, query)[0]?.id, "fixture:warden-hwy7");
  assert.deepEqual(rankPlaces(stops, "ward high 7").map((place) => place.id), ["fixture:warden-hwy7"]);
  assert.deepEqual(rankPlaces(stops, "ward high7").map((place) => place.id), ["fixture:warden-hwy7"]);
  for (const query of ["Yonge Eglinton", "Églinton / Yonge", "Eglinton Yonge"]) assert.equal(rankPlaces(stops, query)[0]?.id, "fixture:yonge-eglinton");
  for (const query of ["Saint Clair", "St. Clair"]) assert.equal(rankPlaces(stops, query)[0]?.id, "fixture:saint-clair");
  assert.deepEqual(rankPlaces(stops, "st clair").map((place) => place.id), ["fixture:saint-clair"]);
  assert.equal(rankPlaces(stops, "union")[0]?.id, "fixture:union-station");
  assert.equal(rankPlaces(stops, "high park")[0]?.id, "fixture:high-park");
  assert.equal(rankPlaces(stops, "route place")[0]?.id, "fixture:route-place");
  assert.equal(rankPlaces(stops, "12A Warden")[0]?.id, "fixture:building-12a");
  assert.equal(rankPlaces(stops, "Route 501X")[0]?.id, "fixture:route-501x");
  const shortPrefixIds = rankPlaces(stops, "yo").map((place) => place.id);
  assert.ok(shortPrefixIds.includes("fixture:yonge-station"));
  assert.ok(shortPrefixIds.includes("fixture:york-mills"));
  assert.equal(rankPlaces(stops, "ward ".repeat(13)).length, 0);
  assert.deepEqual(rankPlaces(stops, "ward high 70"), []);
  assert.equal(rankPlaces(stops, "union", 200).length <= 20, true);
});
test("empty-route coverage reports every unavailable feed without selecting one", () => {
  const context = coverageContextForDate({ feeds: [{ id: "ttc", activeTripsByDate: { "2026-09-04": 0, "2026-09-09": 10, "2026-09-06": 10 } }, { id: "burlington", activeTripsByDate: { "2026-09-04": 0, "2026-09-07": 5 } }, { id: "up", activeTripsByDate: { "2026-09-04": 2 } }] }, "2026-09-04");
  assert.deepEqual(context, { date: "2026-09-04", unavailableAgencies: [{ id: "ttc", nextServiceDate: "2026-09-06" }, { id: "burlington", nextServiceDate: "2026-09-07" }] });
});
test("coverage date uses the graph timezone across an offset boundary", () => {
  assert.equal(calendarDateInTimeZone("2026-09-05T02:30:00Z", "America/Toronto"), "2026-09-04");
  assert.equal(calendarDateInTimeZone("2026-09-05T04:30:00Z", "America/Toronto"), "2026-09-05");
});
test("adjacent TTC graph snapshots expose one truthful public calendar", () => {
  const grouped = groupGraphFeeds([
    { id: "ttc", publicAgencyId: "ttc", sha256: "summer", publisherDownloadUrl: "https://archive.example/summer.zip", serviceStart: "20260726", serviceEnd: "20260905", retireAfter: "2026-09-05", activeTripsByDate: { "2026-09-05": 3000, "2026-09-06": 0 } },
    { id: "ttc-next", publicAgencyId: "ttc", sha256: "fall", publisherDownloadUrl: "https://publisher.example/fall.zip", serviceStart: "20260906", serviceEnd: "20261031", promoteAfter: "2026-09-05", activeTripsByDate: { "2026-09-05": 0, "2026-09-06": 3100 } }
  ]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].serviceStart, "20260726");
  assert.equal(grouped[0].serviceEnd, "20261031");
  assert.deepEqual(grouped[0].activeTripsByDate, { "2026-09-05": 3000, "2026-09-06": 3100 });
  assert.deepEqual(grouped[0].sources, ["https://archive.example/summer.zip", "https://publisher.example/fall.zip"]);
  assert.deepEqual(grouped[0].versions, [
    { id: "ttc", sha256: "summer", source: "https://archive.example/summer.zip", serviceStart: "20260726", serviceEnd: "20260905", retireAfter: "2026-09-05", promoteAfter: null },
    { id: "ttc-next", sha256: "fall", source: "https://publisher.example/fall.zip", serviceStart: "20260906", serviceEnd: "20261031", retireAfter: null, promoteAfter: "2026-09-05" }
  ]);
  assert.equal(publicAgencyFeedId("ttc-next"), "ttc");
});
test("journey ranking includes waiting time and respects arrival planning", () => {
  const leavingSoon = { id: "soon", startTime: "2026-09-05T12:05:00-04:00", endTime: "2026-09-05T12:25:00-04:00", duration: 1200, transfers: 1, walkDistance: 400 };
  const shortRideLater = { id: "later", startTime: "2026-09-05T13:00:00-04:00", endTime: "2026-09-05T13:10:00-04:00", duration: 600, transfers: 0, walkDistance: 100 };
  assert.equal(rankItineraries([shortRideLater, leavingSoon], "fastest", false)[0].id, "soon");
  assert.equal(rankItineraries([leavingSoon, shortRideLater], "fastest", true)[0].id, "later");
  assert.equal(rankItineraries([leavingSoon, shortRideLater], "transfers", false)[0].id, "later");
  assert.equal(rankItineraries([leavingSoon, shortRideLater], "walking", false)[0].id, "later");
});

test("waiting preference chooses valid shorter platform waits before duration and walk-only options", () => {
  const at = (time) => `2026-09-05T${time}:00-04:00`;
  const transit = (mode, startTime, endTime) => ({ mode, startTime: at(startTime), endTime: at(endTime) });
  const walk = (startTime, endTime) => ({ mode: "WALK", startTime: at(startTime), endTime: at(endTime) });
  const shorterTransferWait = { id: "less-wait", startTime: at("08:00"), endTime: at("09:00"), duration: 3600, legs: [transit("BUS", "08:00", "08:15"), walk("08:15", "08:25"), transit("RAIL", "08:30", "09:00")] };
  const shorterJourney = { id: "more-wait", startTime: at("08:00"), endTime: at("08:45"), duration: 2700, legs: [transit("BUS", "08:00", "08:15"), transit("RAIL", "08:30", "08:45")] };
  const invalidTiming = { id: "unknown-wait", startTime: at("08:00"), endTime: at("08:40"), duration: 2400, legs: [transit("BUS", "08:00", "08:20"), transit("RAIL", "08:15", "08:40")] };
  const walkOnly = { id: "walk-only", startTime: at("08:00"), endTime: at("08:10"), duration: 600, legs: [walk("08:00", "08:10")] };
  const ranked = rankItineraries([shorterJourney, walkOnly, invalidTiming, shorterTransferWait], "waiting", false);
  assert.deepEqual(ranked.map((item) => item.id), ["less-wait", "more-wait", "unknown-wait", "walk-only"]);
  assert.equal(shorterTransferWait.transferWaitSeconds, 300);
  assert.equal(shorterJourney.transferWaitSeconds, 900);
  assert.equal(invalidTiming.transferWaitSeconds, null);
  assert.equal(invalidTiming.transferWaitKnown, false);
});
test("route catalog chooses the active TTC snapshot and preserves validated colors", () => {
  const routes = [
    { id: "ttc:1", routeId: "1", shortName: "1", longName: "Summer", agency: "TTC", feedId: "ttc", version: "ttc", color: "FF0000", textColor: "FFFFFF", validity: { serviceStart: "20260726", serviceEnd: "20260905" } },
    { id: "ttc-next:1", routeId: "1", shortName: "1", longName: "Fall", agency: "TTC", feedId: "ttc", version: "ttc-next", color: null, textColor: null, validity: { serviceStart: "20260906", serviceEnd: "20261031", promoteAfter: "2026-09-05" } },
    { id: "go:40", routeId: "40", shortName: "40", longName: "Airport", agency: "GO Transit", feedId: "go", version: "go", color: "00AA44", textColor: "000000", validity: {} }
  ];
  assert.deepEqual(filterRouteCatalog(routes, { agency: "ttc", date: "2026-09-05" }), [{ id: "ttc:1", routeId: "1", shortName: "1", longName: "Summer", agency: "TTC", agencyId: null, feedId: "ttc", version: "ttc", color: "FF0000", textColor: "FFFFFF", routeType: null, validity: { serviceStart: "20260726", serviceEnd: "20260905" } }]);
  const septemberSix = filterRouteCatalog(routes, { agency: "ttc", date: "2026-09-06" });
  assert.equal(septemberSix[0].version, "ttc-next"); assert.equal(septemberSix[0].color, null); assert.equal(septemberSix[0].textColor, null);
  assert.equal(filterRouteCatalog(routes, { query: "airport" })[0].feedId, "go");
});
test("route catalog paginates canonical routes in natural route order", () => {
  const routes = [
    { id: "ttc:10", routeId: "10", shortName: "10", agency: "TTC", feedId: "ttc", version: "ttc", color: null, textColor: null, validity: { serviceStart: "20260101", serviceEnd: "20261231" } },
    { id: "ttc:2", routeId: "2", shortName: "2", agency: "TTC", feedId: "ttc", version: "ttc", color: "00AA44", textColor: "FFFFFF", validity: { serviceStart: "20260101", serviceEnd: "20261231" } },
    { id: "ttc-next:2", routeId: "2", shortName: "2", agency: "TTC", feedId: "ttc", version: "ttc-next", color: "00AA44", textColor: "FFFFFF", validity: { serviceStart: "20270101", serviceEnd: "20271231" } },
    { id: "ttc:1", routeId: "1", shortName: "1", agency: "TTC", feedId: "ttc", version: "ttc", color: null, textColor: null, validity: { serviceStart: "20260101", serviceEnd: "20261231" } }
  ];
  const first = routeCatalogPage(routes, { agency: "ttc", date: "2026-09-05", limit: 2 });
  assert.equal(first.total, 3); assert.deepEqual(first.routes.map((route) => route.routeId), ["1", "2"]); assert.equal(first.coverage.fallback, 0); assert.ok(first.nextCursor);
  const second = routeCatalogPage(routes, { agency: "ttc", date: "2026-09-05", limit: 2, cursor: first.nextCursor });
  assert.deepEqual(second.routes.map((route) => route.routeId), ["10"]); assert.equal(second.nextCursor, null);
  const outside = routeCatalogPage(routes, { agency: "ttc", date: "2028-01-01", limit: 2 });
  assert.equal(outside.coverage.exact, 0); assert.equal(outside.coverage.fallback, 2); assert.equal(outside.coverage.unknown, 0);
  assert.throws(() => routeCatalogPage(routes, { cursor: "invalid" }), /cursor is invalid/);
  assert.throws(() => routeCatalogPage(routes, { cursor: "MDE" }), /cursor is invalid/);
  assert.throws(() => routeCatalogPage(routes, { cursor: "A".repeat(17) }), /cursor is invalid/);
  assert.throws(() => routeCatalogPage(routes, { offset: 1.5 }), /offset is invalid/);
  const unknown = routeCatalogPage([{ id: "go:unknown", routeId: "unknown", shortName: "unknown", agency: "GO Transit", feedId: "go", version: "go", color: null, textColor: null, validity: {} }], { date: "2026-09-05" });
  assert.deepEqual(unknown.coverage, { date: "2026-09-05", exact: 0, fallback: 0, unknown: 1 });
  assert.equal(isCalendarDate("2026-02-28"), true); assert.equal(isCalendarDate("2026-02-29"), false); assert.equal(isCalendarDate("2026-99-99"), false);
});
test("HTTP planning returns a neutral empty result when OTP finds no itinerary", async (context) => {
  const plans = [];
  const mock = http.createServer(async (request, response) => {
    let body = ""; for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body); const query = payload.query;
    if (query.includes("planConnection")) plans.push(payload);
    const data = query.includes("planConnection") ? { planConnection: { edges: [] } } : { stop: { name: "Union Station GO" } };
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ data }));
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  context.after(() => mock.close());
  const probe = http.createServer(); await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve)); const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, ["server.mjs"], { cwd: new URL(".", import.meta.url), env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", OTP_URL: `http://127.0.0.1:${mock.address().port}` }, stdio: "ignore" });
  context.after(() => child.kill());
  let healthy = false; for (let attempt = 0; attempt < 40; attempt += 1) { try { const response = await fetch(`http://127.0.0.1:${port}/health`); if (response.ok) { healthy = true; break; } } catch {} await new Promise((resolve) => setTimeout(resolve, 50)); }
  assert.equal(healthy, true);
  const response = await fetch(`http://127.0.0.1:${port}/api/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: { lat: 43.68, lon: -79.61 }, to: { lat: 43.64, lon: -79.38 }, dateTime: "2026-09-04T20:08:00-04:00", maxWalkDistance: 1500, preference: "fastest" }) });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(payload.itineraries, []);
  assert.deepEqual(payload.coverage, { date: "2026-09-04", unavailableAgencies: [] });
  assert.equal(payload.agency, undefined);
  assert.equal(payload.error, undefined);

  const incomplete = await fetch(`http://127.0.0.1:${port}/api/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: { lat: 43.68, lon: -79.61 }, via: [{ lat: 43.66, lon: -79.5, name: "Required stop" }], to: { lat: 43.64, lon: -79.38 }, dateTime: "2026-09-04T20:08:00-04:00", maxWalkDistance: 1500, preference: "waiting" }) });
  const incompletePayload = await incomplete.json();
  assert.equal(incomplete.status, 422);
  assert.equal(incompletePayload.code, "MULTI_STOP_INCOMPLETE");
  assert.deepEqual(incompletePayload.itineraries, []);
  assert.deepEqual(incompletePayload.failedSegment, { from: { name: null, lat: 43.68, lon: -79.61 }, to: { name: "Required stop", lat: 43.66, lon: -79.5 }, state: "unverified" });

  const unverifiedId = await fetch(`http://127.0.0.1:${port}/api/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: { lat: 43.68, lon: -79.61 }, via: [{ id: "untrusted:stop", lat: 43.66, lon: -79.5, name: "Unverified anchor" }], to: { lat: 43.64, lon: -79.38 }, dateTime: "2026-09-04T20:08:00-04:00", maxWalkDistance: 1500, preference: "fastest" }) });
  assert.equal(unverifiedId.status, 422);
  assert.deepEqual(plans.at(-1).variables.via, [{ visit: { coordinate: { latitude: 43.66, longitude: -79.5 }, label: "Unverified anchor", minimumWaitTime: "PT0S" } }]);

  const tooMany = await fetch(`http://127.0.0.1:${port}/api/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: { lat: 43.68, lon: -79.61 }, via: Array.from({ length: 6 }, () => ({ lat: 43.66, lon: -79.5 })), to: { lat: 43.64, lon: -79.38 }, dateTime: "2026-09-04T20:08:00-04:00" }) });
  assert.equal(tooMany.status, 400);
  assert.match((await tooMany.json()).error, /at most 5 places/);

  const invalidCoordinate = await fetch(`http://127.0.0.1:${port}/api/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: { lat: 43.68, lon: -79.61 }, via: [{ lat: 91, lon: -79.5 }], to: { lat: 43.64, lon: -79.38 }, dateTime: "2026-09-04T20:08:00-04:00" }) });
  assert.equal(invalidCoordinate.status, 400);
  for (const bad of [null, false, [], {}, ""]) {
    const rejected = await fetch(`http://127.0.0.1:${port}/api/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: { lat: bad, lon: -79.4 }, to: { lat: 43.65, lon: -79.38 }, dateTime: "2026-09-05T12:00:00-04:00" }) });
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).error, /from.lat must be a finite number/);
  }
  assert.match((await invalidCoordinate.json()).error, /via\[0\]\.lat must be between -90 and 90/);

  const oversizedLabel = await fetch(`http://127.0.0.1:${port}/api/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: { lat: 43.68, lon: -79.61 }, via: [{ lat: 43.66, lon: -79.5, name: "a".repeat(201) }], to: { lat: 43.64, lon: -79.38 }, dateTime: "2026-09-04T20:08:00-04:00" }) });
  assert.equal(oversizedLabel.status, 400);
  assert.match((await oversizedLabel.json()).error, /via\[0\]\.name must be at most 200 bytes/);
});
