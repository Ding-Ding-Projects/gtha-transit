import test from "node:test";
import assert from "node:assert/strict";
import { itineraryUsesRequiredLine, planWithRequiredLine, requiredLineFailure } from "../backend/required-line.mjs";

const FROM = { id: "from", name: "From", lat: 43.7000, lon: -79.4000 };
const TO = { id: "to", name: "To", lat: 43.8000, lon: -79.3000 };
const requiredRoute = { feedId: "ttc", routeId: "5", routeRef: "5" };
const input = (overrides = {}) => ({ from: FROM, to: TO, dateTime: "2026-09-05T09:00:00-04:00", arriveBy: false, wheelchair: false, maxWalkDistance: 2_000, preference: "fastest", maxResults: 4, requiredRoute, ...overrides });
const leg = (overrides = {}) => ({ mode: "TRAM", agencyFeedId: "ttc", routeId: "5", tripId: "ttc:trip-5", startTime: "2026-09-05T09:10:00-04:00", endTime: "2026-09-05T09:30:00-04:00", from: FROM, to: TO, ...overrides });
const journey = (overrides = {}) => ({ id: "journey", duration: 1_800, walkDistance: 100, transfers: 0, startTime: "2026-09-05T09:00:00-04:00", endTime: "2026-09-05T09:30:00-04:00", legs: [leg()], ...overrides });
const result = (itineraries) => ({ itineraries });
const anchors = (patterns) => ({ route: { feedId: "ttc", routeId: "5", id: "ttc:5" }, patterns });
const pattern = (id, stops) => ({ id, directionId: "0", stops });
const stop = (id, sequence, lat, lon) => ({ id, sequence, name: id, lat, lon });
const ordinary = journey({ id: "ordinary", legs: [leg({ routeId: "4", tripId: "ttc:trip-4" })], duration: 1_200 });

test("a native itinerary with a canonical TTC Line 5 transit leg succeeds without anchor lookup", async () => {
  let anchorsCalled = 0;
  const seen = [];
  const output = await planWithRequiredLine(input(), {
    planWithOtp: async (request) => { seen.push(request); return result([journey({ legs: [leg({ agencyFeedId: "ttc-next", routeId: "ttc-next:5" })] })]); },
    routeStopAnchors: async () => { anchorsCalled += 1; return null; },
  });
  assert.equal(output.requiredLine.status, "satisfied");
  assert.equal(output.requiredLine.strategy, "native");
  assert.equal(output.requiredLine.estimate.extraDurationSeconds, 0);
  assert.equal(anchorsCalled, 0);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].requiredRoute, requiredRoute);
});

test("actual transit identity rejects route-like display text, station visits, route 50, and other agencies", () => {
  const falsePositives = [
    journey({ legs: [leg({ mode: "WALK", routeId: "5", agencyFeedId: "ttc", route: "5" })] }),
    journey({ legs: [leg({ routeId: "50", agencyFeedId: "ttc", route: "5" })] }),
    journey({ legs: [leg({ routeId: "5", agencyFeedId: "go", route: "5" })] }),
    journey({ legs: [leg({ routeId: "5", agencyFeedId: null, route: "5" })] }),
    journey({ legs: [leg({ routeId: null, agencyFeedId: "ttc", tripId: "ttc:trip-5", route: "5" })] }),
  ];
  for (const itinerary of falsePositives) assert.equal(itineraryUsesRequiredLine(itinerary, requiredRoute), false);
  assert.equal(itineraryUsesRequiredLine(journey({ legs: [leg({ agencyFeedId: "ttc-next", routeId: "ttc-next:5" })] }), requiredRoute), true);
  assert.equal(itineraryUsesRequiredLine(journey({ legs: [leg({ routeId: "5", agencyFeedId: "go" })] }), { feedId: "go", routeId: "5" }), true);
});

test("a supplied partial route is rejected instead of inheriting TTC identity", async () => {
  const output = await planWithRequiredLine(input({ requiredRoute: { routeId: "5" } }), { planWithOtp: async () => result([]), routeStopAnchors: async () => null });
  assert.deepEqual(output.itineraries, []);
  assert.equal(output.requiredLine.reason, requiredLineFailure.invalidRoute);
});

test("a selected route without display metadata remains matchable across agencies", async () => {
  const selected = { feedId: "go", routeId: "5" };
  const output = await planWithRequiredLine(input({ requiredRoute: selected }), {
    planWithOtp: async () => result([journey({ legs: [leg({ agencyFeedId: "go", routeId: "go:5" })] })]),
    routeStopAnchors: async () => null,
  });
  assert.equal(output.requiredLine.status, "satisfied");
  assert.deepEqual(output.requiredLine.route, { feedId: "go", routeId: "5", routeRef: null });
});

test("official directional anchors enter one original via gap without mutating or reordering the request", async () => {
  const via = [
    { id: "A", name: "A", lat: 43.7200, lon: -79.3800 },
    { id: "B", name: "B", lat: 43.7500, lon: -79.3500 },
    { id: "C", name: "C", lat: 43.7700, lon: -79.3300 },
  ];
  const original = input({ via, maxResults: 2 });
  const before = structuredClone(original);
  const requests = [];
  let anchorRequest = null;
  const output = await planWithRequiredLine(original, {
    planWithOtp: async (request) => {
      requests.push(request);
      if (request.via.length === via.length) return result([ordinary]);
      return result([journey({ id: "required", duration: 1_500 })]);
    },
    routeStopAnchors: async (reference, options) => {
      anchorRequest = { reference, options };
      return anchors([
      pattern("official-0", [stop("board", 10, 43.7201, -79.3801), stop("alight", 20, 43.7499, -79.3501)]),
      ]);
    },
  });
  assert.equal(output.requiredLine.strategy, "anchor-detour");
  assert.equal(output.requiredLine.estimate.baselineDurationSeconds, 1_200);
  assert.equal(output.requiredLine.estimate.extraDurationSeconds, 300);
  assert.deepEqual(original, before);
  const detour = requests.find((request) => request.via.length === via.length + 2);
  assert.ok(detour);
  assert.deepEqual(detour.via.map((place) => place.id), ["A", "board", "alight", "B", "C"]);
  assert.deepEqual(detour.via.map((place) => place.stopId ?? null), [null, "board", "alight", null, null]);
  assert.equal(detour.arriveBy, false);
  assert.equal(detour.maxWalkDistance, 2_000);
  assert.deepEqual(anchorRequest.reference, { feedId: "ttc", routeId: "5" });
  assert.equal(anchorRequest.options.date, "2026-09-05");
});

test("invalid official patterns are rejected and a route with no usable anchors remains unavailable", async () => {
  const output = await planWithRequiredLine(input(), {
    planWithOtp: async () => result([ordinary]),
    routeStopAnchors: async () => anchors([
      pattern("bad-coordinates", [stop("a", 1, Number.NaN, -79.4), stop("b", 2, 43.8, -79.3)]),
      pattern("same-order", [stop("a", 2, 43.7, -79.4), stop("b", 1, 43.8, -79.3)]),
      pattern("duplicate-stop", [stop("ttc:repeat", 1, 43.7, -79.4), stop("ttc:repeat", 2, 43.8, -79.3)]),
      pattern("mixed-feed", [stop("go:board", 1, 43.7, -79.4), stop("go:alight", 2, 43.8, -79.3)]),
      pattern("null-coordinate", [{ id: "ttc:a", sequence: 1, name: "A", lat: null, lon: -79.4 }, stop("ttc:b", 2, 43.8, -79.3)]),
      pattern("empty-coordinate", [{ id: "ttc:a", sequence: 1, name: "A", lat: "", lon: -79.4 }, stop("ttc:b", 2, 43.8, -79.3)]),
      pattern("null-sequence", [{ id: "ttc:a", sequence: null, name: "A", lat: 43.7, lon: -79.4 }, stop("ttc:b", 2, 43.8, -79.3)]),
      pattern("hex-coordinate", [{ id: "ttc:a", sequence: 1, name: "A", lat: "0x2b", lon: -79.4 }, stop("ttc:b", 2, 43.8, -79.3)]),
      pattern("hex-sequence", [{ id: "ttc:a", sequence: "0x1", name: "A", lat: 43.7, lon: -79.4 }, stop("ttc:b", 2, 43.8, -79.3)]),
      pattern("fraction-sequence", [{ id: "ttc:a", sequence: 1.5, name: "A", lat: 43.7, lon: -79.4 }, stop("ttc:b", 2, 43.8, -79.3)]),
      { ...pattern("declared-wrong-route", [stop("ttc:a", 1, 43.7, -79.4), stop("ttc:b", 2, 43.8, -79.3)]), feedId: "ttc", routeId: "50" },
      { id: "missing-direction", stops: [stop("a", 1, 43.7, -79.4), stop("b", 2, 43.8, -79.3)] },
    ]),
  });
  assert.equal(output.requiredLine.reason, requiredLineFailure.anchorsUnavailable);
  assert.equal(output.requiredLine.attemptedCandidates, 0);
});

test("oversized official patterns are rejected before candidate expansion", async () => {
  let plannerCalls = 0;
  const oversized = Array.from({ length: 513 }, (_, index) => stop(`ttc:${index}`, index + 1, 43.7 + index / 100_000, -79.4));
  const output = await planWithRequiredLine(input(), {
    planWithOtp: async () => { plannerCalls += 1; return result([ordinary]); },
    routeStopAnchors: async () => anchors([pattern("oversized", oversized)]),
  });
  assert.equal(output.requiredLine.reason, requiredLineFailure.anchorsUnavailable);
  assert.equal(output.requiredLine.truncated, true);
  assert.equal(plannerCalls, 1);
});

test("a selected pattern contributes only source-adjacent stops from one direction", async () => {
  let detourVia = null;
  const output = await planWithRequiredLine(input(), {
    planWithOtp: async (request) => {
      if (!request.via.length) return result([ordinary]);
      detourVia = request.via.map((place) => place.id);
      return result([journey()]);
    },
    routeStopAnchors: async () => anchors([
      pattern("loop-safe", [stop("first", 1, 43.7000, -79.4000), stop("middle", 2, 43.7500, -79.3500), stop("last", 3, 43.8000, -79.3000)]),
    ]),
  });
  assert.equal(output.requiredLine.status, "satisfied");
  assert.ok(["first,middle", "middle,last"].includes(detourVia.join(",")));
  assert.notDeepEqual(detourVia, ["first", "last"]);
});

test("a circular official pattern can still contribute a distinct consecutive pair", async () => {
  let detours = 0;
  const output = await planWithRequiredLine(input(), {
    planWithOtp: async (request) => { if (request.via.length) detours += 1; return result(request.via.length ? [journey()] : [ordinary]); },
    routeStopAnchors: async () => anchors([
      pattern("loop", [stop("loop", 1, 43.70, -79.40), stop("middle", 2, 43.75, -79.35), stop("loop", 3, 43.76, -79.34), stop("end", 4, 43.80, -79.30)]),
    ]),
  });
  assert.equal(output.requiredLine.status, "satisfied");
  assert.equal(detours, 1);
});

test("an official anchor response for another route cannot trigger a detour", async () => {
  let detours = 0;
  const output = await planWithRequiredLine(input(), {
    planWithOtp: async (request) => { if (request.via.length) detours += 1; return result([ordinary]); },
    routeStopAnchors: async () => ({ route: { feedId: "ttc", routeId: "50" }, patterns: [pattern("wrong-route", [stop("a", 1, 43.7, -79.4), stop("b", 2, 43.8, -79.3)])] }),
  });
  assert.equal(output.requiredLine.reason, requiredLineFailure.anchorsUnavailable);
  assert.equal(detours, 0);
});

test("a full ordered-via request remains intact when a safe required-line detour cannot fit", async () => {
  const via = Array.from({ length: 5 }, (_, index) => ({ id: `via-${index}`, name: `Via ${index}`, lat: 43.71 + index / 100, lon: -79.39 + index / 100 }));
  let anchorsCalled = 0;
  const output = await planWithRequiredLine(input({ via }), {
    planWithOtp: async (request) => result([ordinary]),
    routeStopAnchors: async () => { anchorsCalled += 1; return null; },
  });
  assert.equal(output.requiredLine.reason, requiredLineFailure.viaCapacityUnavailable);
  assert.equal(anchorsCalled, 0);
  assert.equal(output.requiredLine.attemptedCandidates, 0);
});

test("a native timeout remains visible when ordered-via capacity leaves no safe detour", async () => {
  const via = Array.from({ length: 5 }, (_, index) => ({ id: `via-${index}`, name: `Via ${index}`, lat: 43.71 + index / 100, lon: -79.39 + index / 100 }));
  const output = await planWithRequiredLine(input({ via }), {
    deadlineMs: 80,
    requestTimeoutMs: 20,
    planWithOtp: async (request) => new Promise((resolve) => request.signal.addEventListener("abort", () => resolve(result([])), { once: true })),
    routeStopAnchors: async () => { throw new Error("must not be called"); },
  });
  assert.equal(output.requiredLine.reason, requiredLineFailure.timeout);
});

test("the helper caps official anchor detours at four and never runs more than two concurrently", async () => {
  let active = 0;
  let peak = 0;
  let calls = 0;
  const output = await planWithRequiredLine(input(), {
    planWithOtp: async (request) => {
      calls += 1;
      if (!request.via.length) return result([ordinary]);
      active += 1; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 8));
      active -= 1;
      return result([ordinary]);
    },
    routeStopAnchors: async () => anchors(Array.from({ length: 6 }, (_, index) => pattern(`official-${index}`, [stop(`board-${index}`, 1, 43.7000 + index / 10_000, -79.4000), stop(`alight-${index}`, 2, 43.8000, -79.3000 + index / 10_000)]))),
  });
  assert.equal(calls, 5);
  assert.ok(peak <= 2);
  assert.equal(output.requiredLine.attemptedCandidates, 4);
  assert.equal(output.requiredLine.truncated, true);
  assert.equal(output.requiredLine.reason, requiredLineFailure.notFoundWithinBounds);
});

test("anchor visits do not prove a ride, but a later verified required-line candidate succeeds", async () => {
  let detours = 0;
  const output = await planWithRequiredLine(input(), {
    planWithOtp: async (request) => {
      if (!request.via.length) return result([ordinary]);
      detours += 1;
      return detours === 1
        ? result([journey({ id: "walk-between-anchors", legs: [leg({ mode: "WALK", routeId: "5", agencyFeedId: "ttc" })] })])
        : result([journey({ id: "verified-second", legs: [leg({ routeId: "ttc:5", agencyFeedId: "ttc" })] })]);
    },
    routeStopAnchors: async () => anchors([
      pattern("official-a", [stop("a1", 1, 43.70, -79.40), stop("a2", 2, 43.80, -79.30)]),
      pattern("official-b", [stop("b1", 1, 43.701, -79.401), stop("b2", 2, 43.801, -79.301)]),
    ]),
  });
  assert.equal(output.requiredLine.status, "satisfied");
  assert.equal(output.requiredLine.strategy, "anchor-detour");
  assert.deepEqual(output.itineraries.map((item) => item.id), ["verified-second"]);
});

test("duplicate candidate responses collapse in deterministic candidate order even when completions invert", async () => {
  const output = await planWithRequiredLine(input(), {
    planWithOtp: async (request) => {
      if (!request.via.length) return result([ordinary]);
      const board = request.via.find((place) => String(place.id).startsWith("board"));
      if (board.id === "board-first") await new Promise((resolve) => setTimeout(resolve, 20));
      return result([journey({ id: board.id === "board-first" ? "first" : "second", legs: [leg({ tripId: "ttc:shared-trip" })] })]);
    },
    routeStopAnchors: async () => anchors([
      pattern("first", [stop("board-first", 1, 43.7000, -79.4000), stop("alight-first", 2, 43.8000, -79.3000)]),
      pattern("second", [stop("board-second", 1, 43.7001, -79.4001), stop("alight-second", 2, 43.8001, -79.3001)]),
    ]),
  });
  assert.deepEqual(output.itineraries.map((item) => item.id), ["first"]);
});

test("a global deadline aborts in-flight detours before a queued third request can start", async () => {
  let detours = 0;
  const started = performance.now();
  const output = await planWithRequiredLine(input(), {
    deadlineMs: 35,
    planWithOtp: async (request) => {
      if (!request.via.length) return result([ordinary]);
      detours += 1;
      return new Promise((resolve) => request.signal.addEventListener("abort", () => resolve(result([])), { once: true }));
    },
    routeStopAnchors: async () => anchors([
      pattern("one", [stop("one-a", 1, 43.7000, -79.4000), stop("one-b", 2, 43.8000, -79.3000)]),
      pattern("two", [stop("two-a", 1, 43.7001, -79.4001), stop("two-b", 2, 43.8001, -79.3001)]),
      pattern("three", [stop("three-a", 1, 43.7002, -79.4002), stop("three-b", 2, 43.8002, -79.3002)]),
    ]),
  });
  assert.equal(output.requiredLine.reason, requiredLineFailure.timeout);
  assert.ok(detours <= 2);
  assert.ok(performance.now() - started < 500);
});

test("an official-anchor lookup that consumes its request budget reports a timeout", async () => {
  const output = await planWithRequiredLine(input(), {
    deadlineMs: 80,
    requestTimeoutMs: 20,
    planWithOtp: async () => result([ordinary]),
    routeStopAnchors: async (_reference, options) => new Promise((resolve) => options.signal.addEventListener("abort", () => resolve(null), { once: true })),
  });
  assert.equal(output.requiredLine.reason, requiredLineFailure.timeout);
});

test("a verified detour remains available when a sibling detour reaches its request timeout", async () => {
  const output = await planWithRequiredLine(input(), {
    deadlineMs: 80,
    requestTimeoutMs: 20,
    planWithOtp: async (request) => {
      if (!request.via.length) return result([ordinary]);
      if (request.via[0].id === "fast") return result([journey({ id: "verified-fast" })]);
      return new Promise((resolve) => request.signal.addEventListener("abort", () => resolve(result([])), { once: true }));
    },
    routeStopAnchors: async () => anchors([
      pattern("fast", [stop("fast", 1, 43.7000, -79.4000), stop("fast-end", 2, 43.8000, -79.3000)]),
      pattern("slow", [stop("slow", 1, 43.7100, -79.4100), stop("slow-end", 2, 43.8100, -79.3100)]),
    ]),
  });
  assert.equal(output.requiredLine.status, "satisfied");
  assert.deepEqual(output.itineraries.map((item) => item.id), ["verified-fast"]);
  assert.equal(output.requiredLine.failedCandidates, 1);
});

test("a per-request timeout stops new dispatches while an abort-ignoring call remains unresolved", async () => {
  let active = 0;
  let peak = 0;
  let calls = 0;
  let releaseHung = null;
  const output = await planWithRequiredLine(input(), {
    deadlineMs: 90,
    requestTimeoutMs: 20,
    planWithOtp: async (request) => {
      calls += 1;
      if (!request.via.length) return result([ordinary]);
      const board = request.via[0].id;
      active += 1; peak = Math.max(peak, active);
      if (board === "hang") return new Promise((resolve) => { releaseHung = () => { active -= 1; resolve(result([])); }; });
      await new Promise((resolve) => setTimeout(resolve, board === "quick" ? 2 : 30));
      active -= 1;
      return result([ordinary]);
    },
    routeStopAnchors: async () => anchors([
      pattern("hang", [stop("hang", 1, 43.7000, -79.4000), stop("hang-end", 2, 43.8000, -79.3000)]),
      pattern("quick", [stop("quick", 1, 43.7001, -79.4001), stop("quick-end", 2, 43.8001, -79.3001)]),
      pattern("third", [stop("third", 1, 43.7002, -79.4002), stop("third-end", 2, 43.8002, -79.3002)]),
      pattern("fourth", [stop("fourth", 1, 43.7003, -79.4003), stop("fourth-end", 2, 43.8003, -79.3003)]),
    ]),
  });
  releaseHung?.();
  assert.equal(output.requiredLine.reason, requiredLineFailure.timeout);
  assert.ok(peak <= 2);
  assert.ok(calls <= 4);
});

test("native planner failure keeps an otherwise empty detour search incomplete", async () => {
  const output = await planWithRequiredLine(input(), {
    planWithOtp: async (request) => { if (!request.via.length) throw new Error("native unavailable"); return result([ordinary]); },
    routeStopAnchors: async () => anchors([pattern("one", [stop("a", 1, 43.7, -79.4), stop("b", 2, 43.8, -79.3)])]),
  });
  assert.equal(output.requiredLine.reason, requiredLineFailure.incomplete);
});

test("native planner timeout remains visible when later detours are empty", async () => {
  const output = await planWithRequiredLine(input(), {
    deadlineMs: 100,
    requestTimeoutMs: 20,
    planWithOtp: async (request) => {
      if (request.via.length) return result([ordinary]);
      return new Promise((resolve) => request.signal.addEventListener("abort", () => resolve(result([])), { once: true }));
    },
    routeStopAnchors: async () => anchors([pattern("one", [stop("a", 1, 43.7, -79.4), stop("b", 2, 43.8, -79.3)])]),
  });
  assert.equal(output.requiredLine.reason, requiredLineFailure.timeout);
});

test("native planner timeout remains visible when official anchors are empty", async () => {
  const output = await planWithRequiredLine(input(), {
    deadlineMs: 80,
    requestTimeoutMs: 20,
    planWithOtp: async (request) => new Promise((resolve) => request.signal.addEventListener("abort", () => resolve(result([])), { once: true })),
    routeStopAnchors: async () => anchors([]),
  });
  assert.equal(output.requiredLine.reason, requiredLineFailure.timeout);
});

test("native planner failure remains visible when official anchors are empty", async () => {
  const output = await planWithRequiredLine(input(), {
    planWithOtp: async () => { throw new Error("native unavailable"); },
    routeStopAnchors: async () => anchors([]),
  });
  assert.equal(output.requiredLine.reason, requiredLineFailure.incomplete);
});

test("service-date lookup uses the routing graph timezone across an offset boundary", async () => {
  let date = null;
  await planWithRequiredLine(input({ dateTime: "2026-09-06T00:30:00.000Z", serviceDate: "2026-12-31" }), {
    planWithOtp: async () => result([ordinary]),
    routeStopAnchors: async (_reference, options) => { date = options.date; return null; },
  });
  assert.equal(date, "2026-09-05");
});

test("missing itinerary durations never fabricate a zero-second estimate", async () => {
  const output = await planWithRequiredLine(input(), {
    planWithOtp: async () => result([journey({ duration: null })]),
    routeStopAnchors: async () => null,
  });
  assert.equal(output.requiredLine.status, "satisfied");
  assert.deepEqual(output.requiredLine.estimate, { baselineDurationSeconds: null, selectedDurationSeconds: null, extraDurationSeconds: null });
});

test("all planner failures and partial failures keep separate bounded reasons", async () => {
  const anchorData = anchors([pattern("only", [stop("board", 1, 43.7, -79.4), stop("alight", 2, 43.8, -79.3)])]);
  const unavailable = await planWithRequiredLine(input(), { planWithOtp: async () => { throw new Error("offline"); }, routeStopAnchors: async () => anchorData });
  assert.equal(unavailable.requiredLine.reason, requiredLineFailure.upstreamUnavailable);
  let calls = 0;
  const incomplete = await planWithRequiredLine(input(), { planWithOtp: async () => { calls += 1; if (calls === 1) return result([ordinary]); throw new Error("offline"); }, routeStopAnchors: async () => anchorData });
  assert.equal(incomplete.requiredLine.reason, requiredLineFailure.incomplete);
});
