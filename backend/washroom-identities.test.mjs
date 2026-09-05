import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { matchWashroom } from "../shared/washrooms.mjs";
import { resolveFacilityStopIdentities } from "../shared/washroom-identities.mjs";
import { resolveWashroomRegistry, resolvedWashroomRegistry, washroomForPublishedPlaceFromRegistry, washroomIdentityMap } from "./washrooms.mjs";

const registry = JSON.parse(await readFile(new URL("../data/transit-washrooms.json", import.meta.url), "utf8"));

const officialStopIndex = {
  source: "scripts/data/build-stop-index.py from official GTFS archives",
  stops: [
    { id: "ttc:14669", name: "Eglinton Station", feedId: "ttc", graphFeedId: "ttc", locationType: 0, parentStation: null, lat: 43.704582, lon: -79.39846 },
    { id: "ttc:14670", name: "Eglinton Station", feedId: "ttc", graphFeedId: "ttc", locationType: 0, parentStation: null, lat: 43.70476, lon: -79.398499 },
    { id: "ttc:14672", name: "Eglinton Station", feedId: "ttc", graphFeedId: "ttc", locationType: 0, parentStation: null, lat: 43.705256, lon: -79.398613 },
    { id: "ttc:14673", name: "Eglinton Station", feedId: "ttc", graphFeedId: "ttc", locationType: 0, parentStation: null, lat: 43.705532, lon: -79.399237 },
    { id: "ttc:14674", name: "Eglinton Station", feedId: "ttc", graphFeedId: "ttc", locationType: 0, parentStation: null, lat: 43.705572, lon: -79.399461 },
    { id: "ttc:14675", name: "Eglinton Station", feedId: "ttc", graphFeedId: "ttc", locationType: 0, parentStation: null, lat: 43.705608, lon: -79.399657 },
    { id: "ttc:13795", name: "Eglinton Station - Southbound Platform", feedId: "ttc", graphFeedId: "ttc", locationType: 0, parentStation: null, lat: 43.704648, lon: -79.39889 },
    { id: "ttc:13796", name: "Eglinton Station - Northbound Platform", feedId: "ttc", graphFeedId: "ttc", locationType: 0, parentStation: null, lat: 43.706548, lon: -79.39839 },
    { id: "ttc:16073", name: "Eglinton Station Eastbound Platform", feedId: "ttc", graphFeedId: "ttc", locationType: 0, parentStation: null, lat: 43.70638, lon: -79.398765 },
    { id: "ttc-next:13795", name: "Eglinton Station - Southbound Platform", feedId: "ttc", graphFeedId: "ttc-next", locationType: 0, parentStation: "43274", lat: 43.704648, lon: -79.39889 },
    { id: "ttc-next:13796", name: "Eglinton Station - Northbound Platform", feedId: "ttc", graphFeedId: "ttc-next", locationType: 0, parentStation: "43274", lat: 43.706548, lon: -79.39839 },
    { id: "ttc-next:43274", name: "Eglinton", feedId: "ttc", graphFeedId: "ttc-next", locationType: 1, parentStation: null, lat: 43.70525, lon: -79.398392 },
    { id: "ttc:FI", name: "Finch Station", feedId: "ttc", graphFeedId: "ttc", locationType: 1, lat: 43.78, lon: -79.41 },
    { id: "ttc:road-alias-fixture", name: "Yonge St at Eglinton Ave - Eglinton Station", feedId: "ttc", graphFeedId: "ttc", locationType: 0, parentStation: null, lat: 43.7, lon: -79.4 },
    { id: "ttc:UN", name: "Union Station", feedId: "ttc", graphFeedId: "ttc", locationType: 0, parentStation: null, lat: 43.64, lon: -79.38 },
    { id: "go:UN", name: "GO Union Station", feedId: "go", graphFeedId: "go", locationType: 1, lat: 43.645195, lon: -79.3806 },
    { id: "go:USBT", name: "Union Station Bus Terminal", feedId: "go", graphFeedId: "go", locationType: 1, lat: 43.644042, lon: -79.376939 },
    { id: "up:UN", name: "Union Station", feedId: "up", graphFeedId: "up", locationType: 1, lat: 43.644238, lon: -79.383555 },
    { id: "toronto:HP", name: "High Park Station", feedId: "toronto", graphFeedId: "toronto", locationType: 1, lat: 43.65, lon: -79.46 }
  ]
};

test("production-shaped facilities gain only source-backed qualified station identities", () => {
  assert.equal(registry.facilities.length, 32);
  assert.ok(registry.facilities.every((facility) => !facility.stationIds && !facility.stationIdentity));
  const resolved = resolveFacilityStopIdentities(registry.facilities, officialStopIndex);
  const byFacility = new Map(resolved.identityMap.entries.map((entry) => [entry.facilityId, entry]));
  assert.deepEqual(byFacility.get("ttc-eglinton").stationIds, ["ttc-next:13795", "ttc-next:13796", "ttc-next:43274", "ttc:13795", "ttc:13796", "ttc:14669", "ttc:14670", "ttc:14672", "ttc:14673", "ttc:14674", "ttc:14675", "ttc:16073"]);
  assert.deepEqual(byFacility.get("ttc-finch").stationIds, ["ttc:FI"]);
  assert.deepEqual(byFacility.get("go-union-station").stationIds, ["go:UN"]);
  assert.deepEqual(byFacility.get("up-union-station").stationIds, ["up:UN"]);
  assert.equal(byFacility.has("ttc-union-station"), false);
  assert.equal(byFacility.has("toronto-library-high-park"), false);
  const municipal = registry.facilities.filter((facility) => facility.agencyId === "toronto");
  assert.equal(municipal.length, 9);
  for (const facility of municipal) assert.equal(byFacility.has(facility.facilityId), false);
  assert.equal(resolved.identityMap.source, officialStopIndex.source);
  assert.equal(registry.facilities.find((facility) => facility.facilityId === "ttc-eglinton").stationIds, undefined);

  assert.equal(matchWashroom({ agencyFeedId: "ttc-next", stopId: "ttc-next:13795" }, resolved.facilities)?.facilityId, "ttc-eglinton");
  assert.equal(matchWashroom({ agencyFeedId: "ttc", stationId: "ttc:FI" }, resolved.facilities)?.facilityId, "ttc-finch");
  assert.equal(matchWashroom({ agencyFeedId: "go", stopId: "go:UN" }, resolved.facilities)?.facilityId, "go-union-station");
  assert.equal(matchWashroom({ agencyFeedId: "ttc", stopId: "ttc:UN" }, resolved.facilities), null);
  assert.equal(matchWashroom({ agencyFeedId: "ttc", stopId: "ttc:road-alias-fixture", name: "Yonge St at Eglinton Ave - Eglinton Station" }, resolved.facilities), null);
  const publicMetadata = washroomForPublishedPlaceFromRegistry({ agencyFeedId: "ttc-next", stopId: "ttc-next:13795", name: "Eglinton Station" }, resolveWashroomRegistry(registry, officialStopIndex), { at: "2026-09-08T12:00:00-04:00" });
  assert.deepEqual(publicMetadata, { facilityId: "ttc-eglinton", agencyId: "ttc", facilityType: "transit-station", name: "Eglinton", source: "https://www.ttc.ca/riding-the-ttc/Washrooms-at-TTC-subway-stations", availability: "unknown", location: { name: "Eglinton Station", lat: null, lon: null } });
});

test("unvalidated stop indexes cannot create facility identities", () => {
  const unresolved = resolveFacilityStopIdentities(registry.facilities, { ...officialStopIndex, source: "unverified import" });
  assert.equal(unresolved.identityMap.entries.length, 0);
  const reasons = new Map(unresolved.identityMap.unresolved.map((entry) => [entry.facilityId, entry.reason]));
  for (const facility of registry.facilities.filter((facility) => ["transit-station", "transit-terminal"].includes(facility.facilityType))) assert.equal(reasons.get(facility.facilityId), "stop-index-not-validated");
  assert.equal(reasons.get("toronto-library-high-park"), "facility-not-transit-station-or-terminal");
});

test("the backend exposes the cached identity map for a selected-places API adapter", async () => {
  const resolved = await resolvedWashroomRegistry();
  assert.ok(Array.isArray(resolved.facilities));
  assert.equal(resolved.washroomIdentityMap.schemaVersion, 1);
  const map = await washroomIdentityMap();
  assert.equal(map.schemaVersion, 1);
  assert.match(map.source, /validated official GTFS/i);
  assert.ok(Array.isArray(map.entries));
  assert.ok(Array.isArray(map.unresolved));
});
