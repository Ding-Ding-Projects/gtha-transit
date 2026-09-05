import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { matchWashroom } from "../shared/washrooms.mjs";
import { resolveFacilityStopIdentities } from "../shared/washroom-identities.mjs";
import { washroomIdentityMap } from "./washrooms.mjs";

const registry = JSON.parse(await readFile(new URL("../data/transit-washrooms.json", import.meta.url), "utf8"));

const officialStopIndex = {
  source: "scripts/data/build-stop-index.py from validated official GTFS archives",
  stops: [
    { id: "ttc:EL", name: "Eglinton Station", feedId: "ttc", graphFeedId: "ttc", locationType: 1, lat: 43.7, lon: -79.4 },
    { id: "ttc-next:EL", name: "Eglinton Station", feedId: "ttc", graphFeedId: "ttc-next", locationType: 1, lat: 43.7, lon: -79.4 },
    { id: "ttc:FI", name: "Finch Station", feedId: "ttc", graphFeedId: "ttc", locationType: 1, lat: 43.78, lon: -79.41 },
    { id: "ttc:ROAD", name: "Eglinton Avenue at Yonge", feedId: "ttc", graphFeedId: "ttc", locationType: 0, lat: 43.7, lon: -79.4 },
    { id: "ttc:UN", name: "Union Station", feedId: "ttc", graphFeedId: "ttc", locationType: 1, lat: 43.64, lon: -79.38 },
    { id: "go:UN", name: "GO Union Station", feedId: "go", graphFeedId: "go", locationType: 1, lat: 43.645195, lon: -79.3806 },
    { id: "go:USBT", name: "Union Station Bus Terminal", feedId: "go", graphFeedId: "go", locationType: 1, lat: 43.644042, lon: -79.376939 },
    { id: "up:UN", name: "Union Station", feedId: "up", graphFeedId: "up", locationType: 1, lat: 43.644238, lon: -79.383555 },
    { id: "toronto:HP", name: "High Park Station", feedId: "toronto", graphFeedId: "toronto", locationType: 1, lat: 43.65, lon: -79.46 }
  ]
};

test("production-shaped facilities gain only source-backed qualified station identities", () => {
  assert.equal(registry.facilities.length, 25);
  assert.ok(registry.facilities.every((facility) => !facility.stationIds && !facility.stationIdentity));
  const resolved = resolveFacilityStopIdentities(registry.facilities, officialStopIndex);
  const byFacility = new Map(resolved.identityMap.entries.map((entry) => [entry.facilityId, entry]));
  assert.deepEqual(byFacility.get("ttc-eglinton").stationIds, ["ttc-next:EL", "ttc:EL"]);
  assert.deepEqual(byFacility.get("ttc-finch").stationIds, ["ttc:FI"]);
  assert.deepEqual(byFacility.get("go-union-station").stationIds, ["go:UN"]);
  assert.deepEqual(byFacility.get("up-union-station").stationIds, ["up:UN"]);
  assert.equal(byFacility.has("ttc-union-station"), false);
  assert.equal(byFacility.has("toronto-library-high-park"), false);
  assert.equal(resolved.identityMap.source, officialStopIndex.source);
  assert.equal(registry.facilities.find((facility) => facility.facilityId === "ttc-eglinton").stationIds, undefined);

  assert.equal(matchWashroom({ agencyFeedId: "ttc-next", stopId: "ttc-next:EL" }, resolved.facilities)?.facilityId, "ttc-eglinton");
  assert.equal(matchWashroom({ agencyFeedId: "ttc", stationId: "ttc:FI" }, resolved.facilities)?.facilityId, "ttc-finch");
  assert.equal(matchWashroom({ agencyFeedId: "go", stopId: "go:UN" }, resolved.facilities)?.facilityId, "go-union-station");
  assert.equal(matchWashroom({ agencyFeedId: "ttc", stopId: "ttc:UN" }, resolved.facilities), null);
  assert.equal(matchWashroom({ agencyFeedId: "ttc", stopId: "ttc:ROAD", name: "Eglinton Avenue at Yonge" }, resolved.facilities), null);
});

test("unvalidated stop indexes cannot create facility identities", () => {
  const unresolved = resolveFacilityStopIdentities(registry.facilities, { ...officialStopIndex, source: "unverified import" });
  assert.equal(unresolved.identityMap.entries.length, 0);
  const reasons = new Map(unresolved.identityMap.unresolved.map((entry) => [entry.facilityId, entry.reason]));
  for (const facility of registry.facilities.filter((facility) => ["transit-station", "transit-terminal"].includes(facility.facilityType))) assert.equal(reasons.get(facility.facilityId), "stop-index-not-validated");
  assert.equal(reasons.get("toronto-library-high-park"), "facility-not-transit-station-or-terminal");
});

test("the backend exposes the cached identity map for a selected-places API adapter", async () => {
  const map = await washroomIdentityMap();
  assert.equal(map.schemaVersion, 1);
  assert.match(map.source, /validated official GTFS/i);
  assert.ok(Array.isArray(map.entries));
  assert.ok(Array.isArray(map.unresolved));
});
