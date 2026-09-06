const TRANSIT_MODES = new Set(["BUS", "RAIL", "SUBWAY", "TRAM"]);
const DEFAULT_REQUIRED_ROUTE = Object.freeze({ feedId: "ttc", routeId: "5", routeRef: "5" });
const DEFAULT_DEADLINE_MS = 24_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_DETOUR_CANDIDATES = 4;
const MAX_SOURCE_PATTERNS = 4;
const MAX_STOPS_PER_PATTERN = 512;
const DEFAULT_MAX_VIA = 5;

export const requiredLineFailure = Object.freeze({
  invalidRoute: "INVALID_REQUIRED_ROUTE",
  anchorsUnavailable: "REQUIRED_ROUTE_ANCHORS_UNAVAILABLE",
  viaCapacityUnavailable: "REQUIRED_ROUTE_VIA_CAPACITY_UNAVAILABLE",
  timeout: "REQUIRED_ROUTE_SEARCH_TIMEOUT",
  upstreamUnavailable: "REQUIRED_ROUTE_UPSTREAM_UNAVAILABLE",
  incomplete: "REQUIRED_ROUTE_SEARCH_INCOMPLETE",
  notFoundWithinBounds: "REQUIRED_ROUTE_NOT_FOUND_WITHIN_BOUNDS",
});

const finite = (value, fallback = null) => {
  if (value === null || value === undefined || typeof value === "boolean" || Array.isArray(value) || (typeof value === "object" && value !== null)) return fallback;
  if (typeof value === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const text = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && !/[\u0000-\u001f\u007f]/.test(trimmed) ? trimmed : null;
};

const canonicalFeedId = (value) => {
  const feedId = text(value);
  if (!feedId) return null;
  const normalized = feedId.toLowerCase();
  return normalized === "ttc-next" ? "ttc" : normalized;
};

const canonicalRoute = (value) => {
  if (value === undefined) return { ...DEFAULT_REQUIRED_ROUTE };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const feedId = canonicalFeedId(value.feedId);
  const routeId = text(value.routeId);
  const routeRef = value.routeRef == null ? null : text(value.routeRef);
  if (!feedId || !routeId || (value.routeRef !== undefined && value.routeRef !== null && !routeRef)) return null;
  return { feedId, routeId, routeRef };
};

const publicRoute = (route) => ({ feedId: route?.feedId ?? null, routeId: route?.routeId ?? null, routeRef: route?.routeRef ?? null });
const point = (value) => {
  const lat = finite(value?.lat);
  const lon = finite(value?.lon);
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { id: text(value?.id), name: text(value?.name) ?? "", lat, lon, sequence: finite(value?.sequence) };
};
const copyPlace = (value) => value && typeof value === "object" && !Array.isArray(value) ? { ...value } : value;
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function normalizedLegRoute(leg) {
  if (!TRANSIT_MODES.has(String(leg?.mode ?? "").toUpperCase())) return null;
  const feedId = canonicalFeedId(leg?.agencyFeedId);
  const rawRouteId = text(leg?.routeId);
  if (!feedId || !rawRouteId) return null;
  const colon = rawRouteId.indexOf(":");
  if (colon < 0) return { feedId, routeId: rawRouteId };
  const routeFeedId = canonicalFeedId(rawRouteId.slice(0, colon));
  const routeId = text(rawRouteId.slice(colon + 1));
  return routeFeedId === feedId && routeId ? { feedId, routeId } : null;
}

export function itineraryUsesRequiredLine(itinerary, requiredRoute) {
  const route = canonicalRoute(requiredRoute);
  if (!route || !Array.isArray(itinerary?.legs)) return false;
  return itinerary.legs.some((leg) => {
    const actual = normalizedLegRoute(leg);
    return actual?.feedId === route.feedId && actual.routeId === route.routeId;
  });
}

const durationSeconds = (itinerary) => {
  const value = finite(itinerary?.duration);
  return value === null || value < 0 ? null : value;
};

const timestamp = (value, fallback = Infinity) => {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
};

function rankKey(itinerary, preference, arriveBy) {
  const duration = durationSeconds(itinerary) ?? Infinity;
  const walkDistance = Math.max(0, finite(itinerary?.walkDistance, Infinity));
  const transfers = Math.max(0, finite(itinerary?.transfers, Infinity));
  const timing = arriveBy ? -timestamp(itinerary?.startTime) : timestamp(itinerary?.endTime);
  if (preference === "transfers") return [transfers, timing, duration];
  if (preference === "walking") return [walkDistance, timing, duration];
  if (preference === "waiting") return [itinerary?.transferWaitKnown === false ? 1 : 0, Math.max(0, finite(itinerary?.transferWaitSeconds, Infinity)), timing, duration];
  return [timing, duration, walkDistance, transfers];
}

const compareNumbers = (left, right) => left === right ? 0 : left < right ? -1 : 1;
const itinerarySignature = (itinerary) => JSON.stringify((Array.isArray(itinerary?.legs) ? itinerary.legs : []).map((leg) => {
  const actual = normalizedLegRoute(leg);
  const from = point(leg?.from);
  const to = point(leg?.to);
  return [String(leg?.mode ?? "").toUpperCase(), actual?.feedId ?? null, actual?.routeId ?? null, text(leg?.tripId), leg?.startTime ?? null, leg?.endTime ?? null, from?.lat ?? null, from?.lon ?? null, to?.lat ?? null, to?.lon ?? null];
}));

function orderItineraries(items, input) {
  return [...items].sort((left, right) => {
    const a = rankKey(left.itinerary, input.preference, Boolean(input.arriveBy));
    const b = rankKey(right.itinerary, input.preference, Boolean(input.arriveBy));
    for (let index = 0; index < a.length; index += 1) {
      const comparison = compareNumbers(a[index], b[index]);
      if (comparison) return comparison;
    }
    const candidateComparison = compareNumbers(left.ordinal, right.ordinal);
    if (candidateComparison) return candidateComparison;
    return itinerarySignature(left.itinerary).localeCompare(itinerarySignature(right.itinerary));
  });
}

const haversineMetres = (from, to) => {
  if (!from || !to) return Infinity;
  const radians = Math.PI / 180;
  const latitude = (to.lat - from.lat) * radians;
  const longitude = (to.lon - from.lon) * radians;
  const a = Math.sin(latitude / 2) ** 2 + Math.cos(from.lat * radians) * Math.cos(to.lat * radians) * Math.sin(longitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(Math.min(1, Math.max(0, a))), Math.sqrt(1 - Math.min(1, Math.max(0, a))));
};

function validPattern(pattern, route) {
  const id = text(pattern?.id);
  const directionId = typeof pattern?.directionId === "string" ? text(pattern.directionId) : typeof pattern?.directionId === "number" && Number.isFinite(pattern.directionId) ? String(pattern.directionId) : null;
  if (!id || !directionId || !Array.isArray(pattern.stops) || pattern.stops.length < 2 || pattern.stops.length > MAX_STOPS_PER_PATTERN) return null;
  if (pattern.feedId !== undefined && canonicalFeedId(pattern.feedId) !== route.feedId) return null;
  if (pattern.routeId !== undefined && text(pattern.routeId) !== route.routeId) return null;
  const stops = [];
  for (const rawStop of pattern.stops) {
    const stop = point(rawStop);
    if (!stop?.id || stop.sequence === null || !Number.isInteger(stop.sequence)) return null;
    const separator = stop.id.indexOf(":");
    if (separator >= 1 && canonicalFeedId(stop.id.slice(0, separator)) !== route.feedId) return null;
    if (stops.length && stops[stops.length - 1].sequence >= stop.sequence) return null;
    stops.push(stop);
  }
  return { id, directionId, stops };
}

function consecutivePairForGap(pattern, start, end, insertBeforeViaIndex, route, { deadlineAt, now, patternOrdinal }) {
  let best = null;
  for (let edgeIndex = 0; edgeIndex < pattern.stops.length - 1; edgeIndex += 1) {
    if (edgeIndex % 16 === 0 && now() >= deadlineAt) return { candidate: null, timedOut: true };
    const board = pattern.stops[edgeIndex];
    const alight = pattern.stops[edgeIndex + 1];
    if (board.id === alight.id) continue;
    const score = haversineMetres(start, board) + haversineMetres(alight, end);
    if (!Number.isFinite(score)) continue;
    const candidate = { route, patternId: pattern.id, directionId: pattern.directionId, board, alight, insertBeforeViaIndex, patternOrdinal, edgeIndex, score };
    if (!best || score < best.score || (score === best.score && edgeIndex < best.edgeIndex)) best = candidate;
  }
  return { candidate: best, timedOut: false };
}

function sameRoute(left, right) {
  return canonicalFeedId(left?.feedId) === right?.feedId && text(left?.routeId) === right?.routeId;
}

function calendarDate(value) {
  const date = text(value);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? date : null;
}

function serviceDateFor(input) {
  const instant = Date.parse(input?.dateTime ?? "");
  if (!Number.isFinite(instant)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  const value = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return calendarDate(`${value.year}-${value.month}-${value.day}`);
}

function anchorCandidates(anchorResponse, input, requiredRoute, { deadlineAt, now }) {
  if (!isObject(anchorResponse) || !sameRoute(anchorResponse.route, requiredRoute)) return { candidates: [], total: 0, truncated: false, timedOut: false };
  const via = Array.isArray(input.via) ? input.via : [];
  const gaps = [];
  const endpoints = [point(input.from), ...via.map(point), point(input.to)];
  for (let index = 0; index < endpoints.length - 1; index += 1) if (endpoints[index] && endpoints[index + 1]) gaps.push({ start: endpoints[index], end: endpoints[index + 1], insertBeforeViaIndex: index });
  const rawPatterns = Array.isArray(anchorResponse.patterns) ? anchorResponse.patterns : [];
  const unique = new Map();
  let sourceTruncated = rawPatterns.length > MAX_SOURCE_PATTERNS;
  for (let patternOrdinal = 0; patternOrdinal < Math.min(rawPatterns.length, MAX_SOURCE_PATTERNS); patternOrdinal += 1) {
    if (now() >= deadlineAt) return { candidates: [], total: 0, truncated: sourceTruncated, timedOut: true };
    const rawPattern = rawPatterns[patternOrdinal];
    if (Array.isArray(rawPattern?.stops) && rawPattern.stops.length > MAX_STOPS_PER_PATTERN) sourceTruncated = true;
    const pattern = validPattern(rawPattern, requiredRoute);
    if (!pattern) continue;
    for (const gap of gaps) {
      const pair = consecutivePairForGap(pattern, gap.start, gap.end, gap.insertBeforeViaIndex, requiredRoute, { deadlineAt, now, patternOrdinal });
      if (pair.timedOut) return { candidates: [], total: 0, truncated: sourceTruncated, timedOut: true };
      const candidate = pair.candidate;
      if (!candidate) continue;
      const key = `${candidate.insertBeforeViaIndex}|${candidate.board.id}|${candidate.alight.id}`;
      const existing = unique.get(key);
      if (!existing || candidate.score < existing.score || (candidate.score === existing.score && (candidate.patternOrdinal < existing.patternOrdinal || candidate.patternOrdinal === existing.patternOrdinal && candidate.edgeIndex < existing.edgeIndex))) unique.set(key, candidate);
    }
  }
  const ordered = [...unique.values()].sort((left, right) => left.score - right.score || left.patternOrdinal - right.patternOrdinal || left.edgeIndex - right.edgeIndex || left.insertBeforeViaIndex - right.insertBeforeViaIndex);
  return { candidates: ordered.slice(0, MAX_DETOUR_CANDIDATES), total: ordered.length, truncated: sourceTruncated || ordered.length > MAX_DETOUR_CANDIDATES, timedOut: false };
}

function anchorVisit(stop) {
  return { id: stop.id, stopId: stop.id, name: stop.name, lat: stop.lat, lon: stop.lon, passThrough: true };
}

function plannerInput(input, requiredRoute, timeoutMs, signal, via = input.via) {
  return {
    ...input,
    from: copyPlace(input.from),
    to: copyPlace(input.to),
    via: Array.isArray(via) ? via.map(copyPlace) : [],
    requiredRoute: { ...requiredRoute },
    timeoutMs,
    signal,
  };
}

function detourInput(input, candidate, requiredRoute, timeoutMs, signal) {
  const existing = Array.isArray(input.via) ? input.via : [];
  const via = [
    ...existing.slice(0, candidate.insertBeforeViaIndex).map(copyPlace),
    anchorVisit(candidate.board),
    anchorVisit(candidate.alight),
    ...existing.slice(candidate.insertBeforeViaIndex).map(copyPlace),
  ];
  return plannerInput(input, requiredRoute, timeoutMs, signal, via);
}

function joinedSignal(signals) {
  const active = signals.filter(Boolean);
  if (typeof AbortSignal.any === "function") return AbortSignal.any(active);
  const controller = new AbortController();
  for (const signal of active) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

async function boundedCall(invoke, { globalController, deadlineAt, now, requestTimeoutMs }) {
  const remaining = Math.floor(deadlineAt - now());
  if (remaining <= 0 || globalController.signal.aborted) return { state: "deadline" };
  const timeoutMs = Math.max(1, Math.min(remaining, requestTimeoutMs));
  const localController = new AbortController();
  const signal = joinedSignal([globalController.signal, localController.signal]);
  let timer = null;
  let removeGlobal = null;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => { localController.abort(); resolve({ state: "timeout" }); }, timeoutMs);
  });
  const globallyAborted = new Promise((resolve) => {
    const onAbort = () => { localController.abort(); resolve({ state: "deadline" }); };
    if (globalController.signal.aborted) onAbort();
    else {
      globalController.signal.addEventListener("abort", onAbort, { once: true });
      removeGlobal = () => globalController.signal.removeEventListener("abort", onAbort);
    }
  });
  const operation = Promise.resolve().then(() => invoke({ timeoutMs, signal })).then(
    (value) => ({ state: signal.aborted ? (globalController.signal.aborted ? "deadline" : "timeout") : "success", value }),
    (error) => ({ state: signal.aborted ? (globalController.signal.aborted ? "deadline" : "timeout") : "error", error }),
  );
  try {
    return await Promise.race([operation, timedOut, globallyAborted]);
  } finally {
    clearTimeout(timer);
    removeGlobal?.();
  }
}

const outcomeItineraries = (outcome) => Array.isArray(outcome?.value?.itineraries) ? outcome.value.itineraries.filter(isObject) : [];
const bestDuration = (itineraries) => itineraries.map(durationSeconds).filter((value) => value !== null).reduce((best, value) => best === null || value < best ? value : best, null);

function lineResult(requiredRoute, values = {}) {
  const baselineDurationSeconds = values.baselineDurationSeconds ?? null;
  const selectedDurationSeconds = values.selectedDurationSeconds ?? null;
  return {
    route: publicRoute(requiredRoute),
    status: values.status ?? "unavailable",
    strategy: values.strategy ?? "none",
    reason: values.reason ?? null,
    attemptedCandidates: values.attemptedCandidates ?? 0,
    completedCandidates: values.completedCandidates ?? 0,
    failedCandidates: values.failedCandidates ?? 0,
    truncated: Boolean(values.truncated),
    estimate: {
      baselineDurationSeconds,
      selectedDurationSeconds,
      extraDurationSeconds: baselineDurationSeconds === null || selectedDurationSeconds === null ? null : selectedDurationSeconds - baselineDurationSeconds,
    },
  };
}

function unavailable(requiredRoute, reason, values = {}) {
  return { itineraries: [], requiredLine: lineResult(requiredRoute, { ...values, reason }) };
}

function outputLimit(value) {
  const limit = Math.floor(finite(value, MAX_DETOUR_CANDIDATES));
  return Math.max(1, Math.min(25, limit));
}

export async function planWithRequiredLine(input, { planWithOtp, routeStopAnchors, deadlineMs = DEFAULT_DEADLINE_MS, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, maxVia = DEFAULT_MAX_VIA, now = () => performance.now() } = {}) {
  const requiredRoute = canonicalRoute(input?.requiredRoute);
  if (!requiredRoute) return unavailable(null, requiredLineFailure.invalidRoute);
  if (typeof planWithOtp !== "function" || typeof routeStopAnchors !== "function") return unavailable(requiredRoute, requiredLineFailure.anchorsUnavailable);
  const overallDeadlineMs = Math.max(1, Math.min(DEFAULT_DEADLINE_MS, Math.floor(finite(deadlineMs, DEFAULT_DEADLINE_MS))));
  const perRequestTimeoutMs = Math.max(1, Math.min(DEFAULT_REQUEST_TIMEOUT_MS, Math.floor(finite(requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS))));
  const startedAt = now();
  const deadlineAt = startedAt + overallDeadlineMs;
  const globalController = new AbortController();
  const globalTimer = setTimeout(() => globalController.abort(), overallDeadlineMs);
  let nativeOutcome = null;
  let baselineDurationSeconds = null;
  try {
    nativeOutcome = await boundedCall(({ timeoutMs, signal }) => planWithOtp(plannerInput(input, requiredRoute, timeoutMs, signal)), { globalController, deadlineAt, now, requestTimeoutMs: perRequestTimeoutMs });
    if (nativeOutcome.state === "deadline") return unavailable(requiredRoute, requiredLineFailure.timeout);
    const nativeItineraries = outcomeItineraries(nativeOutcome);
    baselineDurationSeconds = bestDuration(nativeItineraries);
    const nativeMatches = nativeItineraries.filter((itinerary) => itineraryUsesRequiredLine(itinerary, requiredRoute)).map((itinerary) => ({ itinerary, ordinal: -1 }));
    if (nativeMatches.length) {
      const itineraries = orderItineraries(nativeMatches, input).slice(0, outputLimit(input.maxResults)).map((item) => item.itinerary);
      return { itineraries, requiredLine: lineResult(requiredRoute, { status: "satisfied", strategy: "native", baselineDurationSeconds, selectedDurationSeconds: durationSeconds(itineraries[0]) }) };
    }
    const nativeFailureReason = nativeOutcome.state === "timeout" ? requiredLineFailure.timeout : nativeOutcome.state === "error" ? requiredLineFailure.incomplete : null;
    if (globalController.signal.aborted || now() >= deadlineAt) return unavailable(requiredRoute, requiredLineFailure.timeout, { baselineDurationSeconds });
    const existingVia = Array.isArray(input?.via) ? input.via : [];
    if (existingVia.length + 2 > Math.max(0, Math.floor(finite(maxVia, DEFAULT_MAX_VIA)))) return unavailable(requiredRoute, nativeFailureReason ?? requiredLineFailure.viaCapacityUnavailable, { baselineDurationSeconds });
    const date = serviceDateFor(input);
    const anchorsOutcome = await boundedCall(({ timeoutMs, signal }) => routeStopAnchors({ feedId: requiredRoute.feedId, routeId: requiredRoute.routeId }, { date, timeoutMs, signal }), { globalController, deadlineAt, now, requestTimeoutMs: perRequestTimeoutMs });
    if (anchorsOutcome.state === "deadline" || anchorsOutcome.state === "timeout") return unavailable(requiredRoute, requiredLineFailure.timeout, { baselineDurationSeconds });
    if (anchorsOutcome.state !== "success") return unavailable(requiredRoute, nativeFailureReason ?? requiredLineFailure.anchorsUnavailable, { baselineDurationSeconds });
    const selected = anchorCandidates(anchorsOutcome.value, input, requiredRoute, { deadlineAt, now });
    if (selected.timedOut) return unavailable(requiredRoute, requiredLineFailure.timeout, { baselineDurationSeconds, truncated: selected.truncated });
    if (!selected.candidates.length) return unavailable(requiredRoute, nativeFailureReason ?? requiredLineFailure.anchorsUnavailable, { baselineDurationSeconds, truncated: selected.truncated });
    const outcomes = new Array(selected.candidates.length);
    let next = 0;
    let stopDispatch = false;
    const worker = async () => {
      while (!stopDispatch && !globalController.signal.aborted && now() < deadlineAt) {
        const index = next;
        if (index >= selected.candidates.length) return;
        next += 1;
        const candidate = selected.candidates[index];
        outcomes[index] = await boundedCall(({ timeoutMs, signal }) => planWithOtp(detourInput(input, candidate, requiredRoute, timeoutMs, signal)), { globalController, deadlineAt, now, requestTimeoutMs: perRequestTimeoutMs });
        if (outcomes[index].state === "timeout" || outcomes[index].state === "deadline") stopDispatch = true;
      }
    };
    await Promise.all([worker(), worker()]);
    const launched = outcomes.filter(Boolean);
    const completedCandidates = launched.filter((outcome) => outcome.state === "success").length;
    const failedCandidates = launched.filter((outcome) => outcome.state === "error" || outcome.state === "timeout").length;
    const matches = [];
    const seen = new Set();
    outcomes.forEach((outcome, ordinal) => {
      if (outcome?.state !== "success") return;
      for (const itinerary of outcomeItineraries(outcome)) {
        if (!itineraryUsesRequiredLine(itinerary, requiredRoute)) continue;
        const signature = itinerarySignature(itinerary);
        if (seen.has(signature)) continue;
        seen.add(signature);
        matches.push({ itinerary, ordinal });
      }
    });
    if (matches.length) {
      const itineraries = orderItineraries(matches, input).slice(0, outputLimit(input.maxResults)).map((item) => item.itinerary);
      return { itineraries, requiredLine: lineResult(requiredRoute, { status: "satisfied", strategy: "anchor-detour", baselineDurationSeconds, selectedDurationSeconds: durationSeconds(itineraries[0]), attemptedCandidates: launched.length, completedCandidates, failedCandidates, truncated: selected.truncated }) };
    }
    if (nativeOutcome?.state === "timeout" || globalController.signal.aborted || outcomes.some((outcome) => outcome?.state === "deadline" || outcome?.state === "timeout")) return unavailable(requiredRoute, requiredLineFailure.timeout, { strategy: "anchor-detour", baselineDurationSeconds, attemptedCandidates: launched.length, completedCandidates, failedCandidates, truncated: selected.truncated });
    const nativeFailed = nativeOutcome?.state === "error";
    const allPlannerCallsErrored = nativeFailed && launched.length > 0 && outcomes.every((outcome) => outcome?.state === "error");
    const reason = allPlannerCallsErrored
      ? requiredLineFailure.upstreamUnavailable
      : nativeFailed || failedCandidates > 0 ? requiredLineFailure.incomplete : requiredLineFailure.notFoundWithinBounds;
    return unavailable(requiredRoute, reason, { strategy: "anchor-detour", baselineDurationSeconds, attemptedCandidates: launched.length, completedCandidates, failedCandidates, truncated: selected.truncated });
  } finally {
    clearTimeout(globalTimer);
    globalController.abort();
  }
}
