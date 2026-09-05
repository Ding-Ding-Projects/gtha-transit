import test from "node:test";
import assert from "node:assert/strict";
import { calendarDateInTimeZone, coverage, coverageContextForDate, graphProvenance, groupGraphFeeds, rankPlaces, searchPlaces } from "./places.mjs";
import { applyWashroomPreference } from "./washrooms.mjs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { spawn } from "node:child_process";
import { graphqlDocument, publicAgencyFeedId, rankItineraries } from "./otp-client.mjs";

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
  assert.match(graphqlDocument, /legGeometry/);
  assert.match(graphqlDocument, /trip \{ gtfsId \}/);
  assert.match(graphqlDocument, /agency \{ gtfsId name \}/);
});
test("graph provenance has a safe unavailable state", async () => {
  const result = await graphProvenance();
  assert.equal(result.source, "OpenTripPlanner");
  assert.ok(Array.isArray(result.feeds));
});
test("washroom preference only promotes confirmed transit facilities", async () => {
  const base = { duration: 1000, walkDistance: 100, legs: [{ distance: 500, from: { name: "Origin", lat: 43.6, lon: -79.4 }, to: { name: "Finch Station", lat: 43.78, lon: -79.41 } }] };
  const other = { duration: 900, walkDistance: 50, legs: [{ distance: 400, from: { name: "Origin", lat: 43.6, lon: -79.4 }, to: { name: "Generic Mall", lat: 43.7, lon: -79.4 } }] };
  const result = await applyWashroomPreference([other, base], true);
  assert.equal(result.itineraries[0].washrooms[0].name, "Finch Station");
  assert.equal(result.itineraries[0].washroomPreferenceApplied, true);
  assert.equal(result.itineraries[0].totalDistance, 500);
});
test("service readiness uses a typed public code without guessing an agency", async () => {
  const source = await readFile(new URL("./server.mjs", import.meta.url), "utf8");
  assert.match(source, /code: "ROUTER_UNAVAILABLE"/);
  assert.match(source, /await otpReady\(/);
  assert.doesNotMatch(source, /inTtcArea|SCHEDULE_DATE_UNAVAILABLE/);
  assert.match(source, /"\/api\/vehicles\/metrolinx"/);
  assert.match(source, /code: "VEHICLE_DATA_UNAVAILABLE"/);
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
test("HTTP planning returns a neutral empty result when OTP finds no itinerary", async (context) => {
  const mock = http.createServer(async (request, response) => {
    let body = ""; for await (const chunk of request) body += chunk;
    const query = JSON.parse(body).query;
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
});
