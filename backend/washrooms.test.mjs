import test from "node:test";
import assert from "node:assert/strict";
import { facilityAvailability, matchWashroom } from "../shared/washrooms.mjs";

const facility = {
  id: "ttc:finch", agencyId: "ttc", stationIds: ["ttc:FINCH"],
  hours: { timeZone: "America/Toronto", weekly: { mon: [{ open: "08:00", close: "20:00" }], tue: [{ open: "22:00", close: "02:00" }], sun: [{ open: "01:00", close: "03:00" }] } }
};

test("weekly schedules confirm open and closed times", () => {
  assert.equal(facilityAvailability(facility, "2026-09-07T13:00:00Z"), "confirmed-open");
  assert.equal(facilityAvailability(facility, "2026-09-07T02:00:00Z"), "closed");
});

test("cross-midnight weekly hours belong to the previous local day", () => {
  assert.equal(facilityAvailability(facility, "2026-09-09T05:30:00Z"), "confirmed-open");
  assert.equal(facilityAvailability(facility, "2026-09-09T07:30:00Z"), "closed");
});

test("named timezones follow DST and dated exceptions override weekly hours", () => {
  assert.equal(facilityAvailability(facility, "2026-03-08T06:30:00Z"), "confirmed-open");
  const closed = { ...facility, hours: { ...facility.hours, exceptions: [{ date: "2026-09-07", closed: true }] } };
  assert.equal(facilityAvailability(closed, "2026-09-07T13:00:00Z"), "closed");
  const earlyClose = { ...facility, hours: { ...facility.hours, exceptions: [{ date: "2026-09-07", status: "modified", closes: "13:00" }] } };
  assert.equal(facilityAvailability(earlyClose, "2026-09-07T18:30:00Z"), "closed");
  const sameDayClose = { ...facility, hours: { ...facility.hours, exceptions: [{ date: "2026-09-08", status: "modified", closes: "23:00", endsNextDay: false }] } };
  assert.equal(facilityAvailability(sameDayClose, "2026-09-09T05:30:00Z"), "closed");
  const closedAfterOvernight = { ...facility, hours: { ...facility.hours, weekly: { sun: [{ open: "22:00", close: "02:00" }] }, exceptions: [{ date: "2026-09-07", status: "closed" }] } };
  assert.equal(facilityAvailability(closedAfterOvernight, "2026-09-07T04:30:00Z"), "closed");
});

test("unknown schedules never become confirmed open", () => {
  assert.equal(facilityAvailability({ id: "ttc:unknown" }, "2026-09-07T13:00:00Z"), "unknown");
  assert.equal(facilityAvailability({ hours: { status: "unknown", timezone: "America/Toronto" } }, "2026-09-07T13:00:00Z"), "unknown");
});

test("published registry schedules support days, endsNextDay, and direct official identities", () => {
  const published = { agencyId: "go", stationIdentity: { agencyId: "go", stationId: "go:UNION" }, sourceCoordinateIdentity: { lat: 43.645, lon: -79.38 }, hours: { status: "published", timezone: "America/Toronto", weekly: [{ days: ["wed"], opens: "22:00", closes: "02:00", endsNextDay: true }] } };
  assert.equal(facilityAvailability(published, "2026-09-10T05:30:00Z"), "confirmed-open");
  assert.equal(matchWashroom({ agencyId: "go", stationId: "go:UNION" }, [published], { at: "2026-09-10T06:00:00Z" })?.availability, "closed");
  assert.equal(matchWashroom({ agencyFeedId: "go", stopId: "go:UNION" }, [published])?.stationIdentity.stationId, "go:UNION");
  assert.equal(matchWashroom({ agencyId: "go", sourceCoordinateIdentity: { lat: 43.645, lon: -79.38 } }, [published])?.stationIdentity.stationId, "go:UNION");
});

test("matching requires a unique agency-qualified station identity", () => {
  const stop = { stationId: "ttc:FINCH", agencyId: "ttc", name: "Finch Station" };
  assert.equal(matchWashroom(stop, [facility])?.id, "ttc:finch");
  assert.equal(matchWashroom({ ...stop, agencyId: "go" }, [facility]), null);
  assert.equal(matchWashroom(stop, [facility, { ...facility, id: "ttc:other" }]), null);
});

test("Union remains agency-specific and names do not match roads or places", () => {
  const union = { id: "go:union", agencyId: "go", stationIds: ["go:UNION"] };
  const ttcUnion = { id: "ttc:union", agencyId: "ttc", stationIds: ["ttc:UNION"] };
  assert.equal(matchWashroom({ stationId: "go:UNION", agencyId: "go", name: "Union Station" }, [union, ttcUnion])?.id, "go:union");
  assert.equal(matchWashroom({ name: "Eglinton Avenue at Yonge", agencyId: "ttc" }, [{ ...facility, names: ["Eglinton"] }]), null);
});
