import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const registryUrl = new URL("../data/transit-washrooms.json", import.meta.url);
const officialHosts = new Set(["www.ttc.ca", "www.gotransit.com", "www.upexpress.com", "www.yrt.ca", "www.mississauga.ca", "www.hamilton.ca", "tpl.ca"]);
const knownAgencyIds = new Set(["ttc", "go", "up", "yrt", "miway", "brampton", "drt", "oakville", "burlington", "milton", "hsr", "toronto"]);
const expectedSourceIds = new Set(["ttc-washrooms", "go-union-facilities", "go-usbt", "up-union-facilities", "metrolinx-gtfs", "yrt-facilities", "miway-city-centre", "hsr-customer-service", "tpl-toronto-reference-library", "tpl-high-park"]);
const expectedFacilityIds = new Set(["ttc-bloor-yonge", "ttc-eglinton", "ttc-finch", "ttc-sheppard-yonge", "ttc-sheppard-west", "ttc-vaughan-metropolitan-centre", "ttc-wilson", "ttc-finch-west", "ttc-kennedy", "ttc-kipling", "ttc-don-mills", "ttc-mount-dennis", "ttc-cedarvale", "ttc-humber-college", "go-union-station", "go-union-station-bus-terminal", "up-union-station", "yrt-newmarket-terminal", "yrt-pioneer-village-terminal", "yrt-richmond-hill-centre-terminal", "yrt-smartvmc-bus-terminal", "miway-city-centre-transit-terminal", "hsr-frank-a-cooke-transit-terminal", "toronto-library-toronto-reference-library", "toronto-library-high-park"]);
const weekdays = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
const normalizeForLegacyNameMatching = (value) => String(value).toLowerCase().replace(/\b(station|go|terminal|subway|lrt|platform)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const isTimestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const assertStableFacilityIdentity = (facility) => {
  assert.ok(knownAgencyIds.has(facility.agencyId));
  assert.match(facility.facilityId, /^[a-z0-9-]+$/);
};

test("washroom registry has source receipts and conservative hours metadata", async () => {
  const registry = JSON.parse(await readFile(registryUrl, "utf8"));
  assert.equal(registry.schemaVersion, 2);
  assert.equal(registry.updatedAt, "2026-09-05");
  assert.ok(Array.isArray(registry.officialSources));
  assert.ok(registry.officialSources.length >= 10);
  const receipts = new Map(registry.officialSources.map((receipt) => [receipt.id, receipt]));
  assert.equal(receipts.size, registry.officialSources.length);
  assert.deepEqual([...receipts.keys()].sort(), [...expectedSourceIds].sort());
  for (const receipt of receipts.values()) {
    assert.equal(new URL(receipt.url).protocol, "https:");
    assert.ok(officialHosts.has(new URL(receipt.url).hostname));
    assert.ok(isTimestamp(receipt.retrievedAt));
  }

  const facilityIds = new Set();
  for (const facility of registry.facilities) {
    assertStableFacilityIdentity(facility);
    assert.equal(facilityIds.has(facility.facilityId), false);
    facilityIds.add(facility.facilityId);
    assert.ok(["transit-station", "transit-terminal", "library"].includes(facility.facilityType));
    assert.ok(Array.isArray(facility.names) && facility.names.length > 0);
    assert.equal(new URL(facility.source).protocol, "https:");
    assert.ok(isTimestamp(facility.sourceRetrievedAt));
    assert.equal(receipts.get(facility.sourceReceiptId)?.url, facility.source);
    assert.ok([null, "public"].includes(facility.access));
    assert.ok([null, "accessible"].includes(facility.wheelchair));
    assert.equal(facility.fee, null);
    assert.equal(facility.hours.timezone, "America/Toronto");
    assert.ok(["published", "unknown"].includes(facility.hours.status));

    if (facility.coordinates !== null) {
      assert.ok(Number.isFinite(facility.coordinates.lat) && Math.abs(facility.coordinates.lat) <= 90);
      assert.ok(Number.isFinite(facility.coordinates.lon) && Math.abs(facility.coordinates.lon) <= 180);
      assert.equal(receipts.get(facility.coordinates.sourceReceiptId)?.url, facility.coordinates.sourceUrl);
      assert.ok(isTimestamp(facility.coordinates.sourceRetrievedAt));
    }

    if (facility.hours.status === "unknown") {
      assert.equal(facility.hours.weekly, null);
      assert.equal(facility.hours.holidaySchedule, null);
      assert.equal(facility.hours.exceptions, null);
      assert.equal(facility.sourceHoursURL, null);
      assert.equal(facility.hoursRetrievedAt, null);
      continue;
    }

    assert.ok(Array.isArray(facility.hours.weekly) && facility.hours.weekly.length > 0);
    assert.equal(facility.sourceHoursURL, facility.source);
    assert.ok(isTimestamp(facility.hoursRetrievedAt));
    for (const interval of facility.hours.weekly) {
      assert.ok(interval.days.every((day) => weekdays.has(day)));
      assert.match(interval.opens, /^\d{2}:\d{2}$/);
      assert.match(interval.closes, /^\d{2}:\d{2}$/);
      assert.equal(typeof interval.endsNextDay, "boolean");
    }
  }
  assert.deepEqual([...facilityIds].sort(), [...expectedFacilityIds].sort());
});

test("identity guard rejects a missing agency identifier", async () => {
  const registry = JSON.parse(await readFile(registryUrl, "utf8"));
  const broken = { ...registry.facilities[0], agencyId: null };
  assert.throws(() => assertStableFacilityIdentity(broken));
});

test("agency and facility identifiers keep normalized Union records separate", async () => {
  const registry = JSON.parse(await readFile(registryUrl, "utf8"));
  const goUnion = registry.facilities.find((facility) => facility.facilityId === "go-union-station");
  const upUnion = registry.facilities.find((facility) => facility.facilityId === "up-union-station");
  const ttcUnionFixture = { agencyId: "ttc", facilityId: "ttc-union-station", names: ["Union Station"] };
  assert.ok(goUnion && upUnion);
  assert.equal(normalizeForLegacyNameMatching(goUnion.names[0]), normalizeForLegacyNameMatching(ttcUnionFixture.names[0]));
  assert.equal(normalizeForLegacyNameMatching(upUnion.names[0]), normalizeForLegacyNameMatching(ttcUnionFixture.names[0]));
  assert.notEqual(goUnion.agencyId, ttcUnionFixture.agencyId);
  assert.notEqual(upUnion.agencyId, ttcUnionFixture.agencyId);
  assert.notEqual(goUnion.facilityId, ttcUnionFixture.facilityId);
  assert.notEqual(upUnion.facilityId, ttcUnionFixture.facilityId);
  assert.equal(goUnion.coordinates.reference, "GO GTFS stop_id=UN");
  assert.equal(upUnion.coordinates.reference, "UP Express GTFS stop_id=UN");
  assert.notEqual(goUnion.agencyId, upUnion.agencyId);
});
