import test from "node:test";
import assert from "node:assert/strict";
import { searchPlaces, coverage } from "./places.mjs";
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
