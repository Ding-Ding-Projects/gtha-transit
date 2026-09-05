import test from "node:test";
import assert from "node:assert/strict";
import { planWithOtp } from "./otp-client.mjs";

const input = (overrides = {}) => ({
  otpUrl: "http://otp.example",
  timeoutMs: 1_000,
  from: { lat: 43.7000, lon: -79.4000 },
  to: { lat: 43.8000, lon: -79.3000 },
  via: [],
  dateTime: "2026-09-05T12:00:00-04:00",
  arriveBy: false,
  wheelchair: false,
  maxWalkDistance: 1_500,
  preference: "fastest",
  maxResults: 4,
  ...overrides,
});

async function withResponse(payload, run) {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  try { return { result: await run(), requests }; }
  finally { globalThis.fetch = originalFetch; }
}

const stop = (id, lat, lon, viaLocationType = "VISIT") => ({ name: id, lat, lon, viaLocationType, stop: { gtfsId: id, locationType: "STOP", parentStation: null } });
const planPayload = (fromStop, toStop) => ({ data: { planConnection: { edges: [{ node: {
  start: "2026-09-05T12:00:00-04:00",
  end: "2026-09-05T12:10:00-04:00",
  duration: "PT10M",
  walkDistance: 0,
  numberOfTransfers: 0,
  legs: [{
    mode: "TRAM",
    realTime: false,
    start: { scheduledTime: "2026-09-05T12:00:00-04:00" },
    end: { scheduledTime: "2026-09-05T12:10:00-04:00" },
    duration: "PT10M",
    distance: 1_000,
    headsign: "Line 5",
    from: fromStop,
    to: toStop,
    intermediatePlaces: [],
    route: { gtfsId: "ttc:5", shortName: "5", longName: "Line 5", agency: { gtfsId: "ttc:1", name: "TTC" } },
    trip: { gtfsId: "ttc:trip" },
    legGeometry: { points: "" },
  }],
} }] } } });

test("official anchor stops use OTP visit.stopLocationIds while ordinary places remain coordinate visits", async () => {
  const anchor = { id: "ttc:16073", stopId: "ttc:16073", name: "Eglinton", lat: 43.70638, lon: -79.398765 };
  const coordinate = { id: "saved-place", name: "Saved place", lat: 43.71, lon: -79.39 };
  const { requests } = await withResponse({ data: { planConnection: { edges: [] } } }, () => planWithOtp(input({ via: [anchor, coordinate] })));
  const visits = requests[0].variables.via.map((entry) => entry.visit);
  assert.deepEqual(visits[0], { minimumWaitTime: "PT0S", stopLocationIds: ["ttc:16073"], label: "Eglinton" });
  assert.deepEqual(visits[1], { minimumWaitTime: "PT0S", coordinate: { latitude: 43.71, longitude: -79.39 }, label: "Saved place" });
});

test("a stop-identity visit completes only at the requested official stop", async () => {
  const requested = [
    { id: "ttc:16073", stopId: "ttc:16073", name: "Eglinton", lat: 43.70638, lon: -79.398765 },
    { id: "ttc:16212", stopId: "ttc:16212", name: "Mount Pleasant", lat: 43.708503, lon: -79.390329 },
  ];
  const matched = await withResponse(planPayload(stop("ttc:16073", requested[0].lat, requested[0].lon), stop("ttc:16212", requested[1].lat, requested[1].lon)), () => planWithOtp(input({ via: requested })));
  assert.equal(matched.result.itineraries.length, 1);
  assert.equal(matched.result.itineraries[0].viaComplete, true);
  const wrongStop = await withResponse(planPayload(stop("ttc:other", requested[0].lat, requested[0].lon), stop("ttc:16212", requested[1].lat, requested[1].lon)), () => planWithOtp(input({ via: requested })));
  assert.deepEqual(wrongStop.result.itineraries, []);
  assert.equal(wrongStop.result.failedSegment.state, "unverified");
});
