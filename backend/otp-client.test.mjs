import test from "node:test";
import assert from "node:assert/strict";
import { blockPredecessorWithOtp, orderBlockTrips, planModes, planWithOtp, serviceDateOf } from "./otp-client.mjs";

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
test('internal required-line anchors permit staying aboard and verify intermediate stop order', async () => {
  const a={stopId:'ttc:a',name:'A',lat:43.7,lon:-79.4,passThrough:true};
  const b={stopId:'ttc:b',name:'B',lat:43.71,lon:-79.4,passThrough:true};
  const payload=planPayload(stop('ttc:origin',43.69,-79.4,null),stop('ttc:end',43.72,-79.4,null));
  payload.data.planConnection.edges[0].node.legs[0].intermediatePlaces=[stop('ttc:a',43.7,-79.4,null),stop('ttc:b',43.71,-79.4,null)];
  const {result,requests}=await withResponse(payload,()=>planWithOtp(input({via:[a,b]})));
  assert.deepEqual(requests[0].variables.via[0],{passThrough:{stopLocationIds:['ttc:a'],label:'A'}});
  assert.equal(result.itineraries.length,1);assert.equal(result.itineraries[0].legs.length,1);
  const reverse=await withResponse(payload,()=>planWithOtp(input({via:[b,a]})));
  assert.equal(reverse.result.itineraries.length,0);
});
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

test("direct walking is opt-in and keeps the ordinary planner transit-only", async () => {
  assert.deepEqual(planModes(), {
    transitOnly: true,
    transit: { access: ["WALK"], egress: ["WALK"], transfer: ["WALK"], transit: ["BUS", "RAIL", "SUBWAY", "TRAM"].map((mode) => ({ mode })) },
  });
  assert.deepEqual(planModes({ allowDirectWalking: true }), {
    direct: ["WALK"],
    transit: { access: ["WALK"], egress: ["WALK"], transfer: ["WALK"], transit: ["BUS", "RAIL", "SUBWAY", "TRAM"].map((mode) => ({ mode })) },
  });
  const ordinary = await withResponse({ data: { planConnection: { edges: [] } } }, () => planWithOtp(input()));
  assert.equal(ordinary.requests[0].variables.modes.transitOnly, true);
  assert.equal(ordinary.requests[0].variables.modes.direct, undefined);
  const walking = await withResponse({ data: { planConnection: { edges: [] } } }, () => planWithOtp(input({ allowDirectWalking: true })));
  assert.deepEqual(walking.requests[0].variables.modes.direct, ["WALK"]);
  assert.equal(walking.requests[0].variables.modes.transitOnly, undefined);
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

/**
 * The vehicle block.
 *
 * `block_id` is published on trips, so the trip before this one on the same block
 * is the one whose vehicle is about to arrive. The routing engine offers no query
 * for trips by block, only by route, so the search runs within the leg's own
 * route and records that limitation rather than implying a whole-block view.
 */

const BLOCK_TRIPS = [
  { gtfsId: "ttc:c", blockId: "680880", activeDates: ["20260906"], departureStoptime: { serviceDay: 1788660000, scheduledDeparture: 54360 }, arrivalStoptime: { serviceDay: 1788660000, scheduledArrival: 57720 } },
  { gtfsId: "ttc:a", blockId: "680880", activeDates: ["20260906"], departureStoptime: { serviceDay: 1788660000, scheduledDeparture: 46800 }, arrivalStoptime: { serviceDay: 1788660000, scheduledArrival: 50220 } },
  { gtfsId: "ttc:b", blockId: "680880", activeDates: ["20260906"], departureStoptime: { serviceDay: 1788660000, scheduledDeparture: 50400 }, arrivalStoptime: { serviceDay: 1788660000, scheduledArrival: 53820 } },
  { gtfsId: "ttc:other-block", blockId: "680999", activeDates: ["20260906"], departureStoptime: { serviceDay: 1788660000, scheduledDeparture: 50400 }, arrivalStoptime: { serviceDay: 1788660000, scheduledArrival: 53820 } },
  { gtfsId: "ttc:other-day", blockId: "680880", activeDates: ["20260907"], departureStoptime: { serviceDay: 1788746400, scheduledDeparture: 50400 }, arrivalStoptime: { serviceDay: 1788746400, scheduledArrival: 53820 } },
];

test("a service date is the operator's own calendar day, not a UTC one", () => {
  // 03:30 UTC on 7 September is still the evening of 6 September in Toronto.
  assert.equal(serviceDateOf(Date.parse("2026-09-07T03:30:00.000Z")), "20260906");
  assert.equal(serviceDateOf(Date.parse("2026-09-06T16:00:00.000Z")), "20260906");
});

test("a block runs in departure order, and only today's trips on that block", () => {
  const ordered = orderBlockTrips(BLOCK_TRIPS, "680880", "20260906");
  assert.deepEqual(ordered.map((trip) => trip.tripId), ["ttc:a", "ttc:b", "ttc:c"]);
});

test("a trip with no published departure time cannot be placed in the block", () => {
  const ordered = orderBlockTrips([{ gtfsId: "ttc:untimed", blockId: "680880", activeDates: ["20260906"] }], "680880", "20260906");
  assert.deepEqual(ordered, []);
});

const blockOtp = (responses) => async (url, options) => {
  const body = JSON.parse(options.body);
  for (const [needle, data] of responses) {
    if (body.query.includes(needle)) return new Response(JSON.stringify({ data }), { headers: { "content-type": "application/json" } });
  }
  throw new Error(`unexpected query: ${body.query}`);
};

const chain = async (responses, overrides = {}) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = blockOtp(responses);
  try {
    return await blockPredecessorWithOtp({
      otpUrl: "http://otp.example",
      timeoutMs: 1_000,
      tripId: "ttc:b",
      routeId: "ttc:68",
      atMillis: Date.parse("2026-09-06T18:00:00.000Z"),
      ...overrides,
    });
  } finally { globalThis.fetch = originalFetch; }
};

test("the previous trip on the block is resolved with its published stop times", async () => {
  const result = await chain([
    ["TripBlock", { trip: { gtfsId: "ttc:b", blockId: "680880", route: { gtfsId: "ttc:68" } } }],
    ["RouteBlockTrips", { route: { patterns: [{ trips: BLOCK_TRIPS }] } }],
    ["TripTimes", { trip: { gtfsId: "ttc:a", stoptimesForDate: [
      { scheduledArrival: 46800, scheduledDeparture: 46800, serviceDay: 1788660000, stop: { gtfsId: "ttc:1", name: "A", lat: 43.6, lon: -79.3 } },
      { scheduledArrival: 50220, scheduledDeparture: 50220, serviceDay: 1788660000, stop: { gtfsId: "ttc:2", name: "B", lat: 43.7, lon: -79.3 } },
    ] } }],
  ]);
  assert.equal(result.blockId, "680880");
  assert.equal(result.previousTripId, "ttc:a");
  assert.equal(result.positionInBlock, 2);
  assert.equal(result.tripsOnBlockToday, 3);
  assert.equal(result.scope, "same-route-only");
  assert.equal(result.stops.length, 2);
  assert.equal(result.stops[0].name, "A");
  assert.equal(typeof result.stops[0].arrivalAt, "string");
});

test("a trip with no published block says so rather than guessing one", async () => {
  const result = await chain([["TripBlock", { trip: { gtfsId: "ttc:b", blockId: null, route: { gtfsId: "ttc:68" } } }]]);
  assert.deepEqual(result, { blockId: null, reason: "no-block-published" });
});

test("the first trip of a block has no predecessor", async () => {
  const result = await chain([
    ["TripBlock", { trip: { gtfsId: "ttc:a", blockId: "680880", route: { gtfsId: "ttc:68" } } }],
    ["RouteBlockTrips", { route: { patterns: [{ trips: BLOCK_TRIPS }] } }],
  ], { tripId: "ttc:a" });
  assert.deepEqual(result, { blockId: "680880", reason: "first-trip-of-the-block" });
});

test("a trip not running today on that block is reported, not chained", async () => {
  const result = await chain([
    ["TripBlock", { trip: { gtfsId: "ttc:z", blockId: "680880", route: { gtfsId: "ttc:68" } } }],
    ["RouteBlockTrips", { route: { patterns: [{ trips: BLOCK_TRIPS }] } }],
  ], { tripId: "ttc:z" });
  assert.deepEqual(result, { blockId: "680880", reason: "trip-not-on-block-today" });
});

test("a previous trip with no published stop times chains nothing", async () => {
  const result = await chain([
    ["TripBlock", { trip: { gtfsId: "ttc:b", blockId: "680880", route: { gtfsId: "ttc:68" } } }],
    ["RouteBlockTrips", { route: { patterns: [{ trips: BLOCK_TRIPS }] } }],
    ["TripTimes", { trip: { gtfsId: "ttc:a", stoptimesForDate: [] } }],
  ]);
  assert.deepEqual(result, { blockId: "680880", reason: "no-published-times-for-previous-trip" });
});
