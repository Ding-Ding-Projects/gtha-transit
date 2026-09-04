import test from "node:test";
import assert from "node:assert/strict";
import { searchPlaces, coverage, graphProvenance } from "./places.mjs";
import { applyWashroomPreference } from "./washrooms.mjs";
import { graphqlDocument } from "./otp-client.mjs";

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
