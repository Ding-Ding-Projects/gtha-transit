import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { currentTorontoDate, filterRouteCatalog, routeIndex, validityState } from "./routes.mjs";

const patternIndexPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/route-patterns.json");
const stopIndexPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/stops.json");
const MAX_STOP_ROUTE_BADGES = 1000;
let cachedPatterns = null;
let cachedStops = null;

const geographicCoordinate = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;

const boundedLimit = (value, fallback = MAX_STOP_ROUTE_BADGES) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(MAX_STOP_ROUTE_BADGES, Math.floor(number)));
};

async function routePatternIndex() {
  if (!cachedPatterns) {
    let parsed = {};
    try { parsed = JSON.parse(await readFile(patternIndexPath, "utf8")); } catch {}
    cachedPatterns = {
      ...parsed,
      stopRoutes: parsed && typeof parsed.stopRoutes === "object" && !Array.isArray(parsed.stopRoutes) ? parsed.stopRoutes : {},
      stopAliases: parsed && typeof parsed.stopAliases === "object" && !Array.isArray(parsed.stopAliases) ? parsed.stopAliases : {},
      routePatterns: parsed && typeof parsed.routePatterns === "object" && !Array.isArray(parsed.routePatterns) ? parsed.routePatterns : {},
    };
  }
  return cachedPatterns;
}

async function publishedStopIndex() {
  if (!cachedStops) {
    const parsed = JSON.parse(await readFile(stopIndexPath, "utf8"));
    cachedStops = { ...parsed, stops: Array.isArray(parsed.stops) ? parsed.stops : [] };
  }
  return cachedStops;
}

const catalogForDate = (index, date) => filterRouteCatalog(Array.isArray(index?.routes) ? index.routes : [], { date, limit: Number.MAX_SAFE_INTEGER });
const scheduledCatalogForDate = (index, date) => {
  const effectiveDate = date ?? currentTorontoDate();
  return catalogForDate(index, effectiveDate).filter((route) => validityState(effectiveDate, route.validity) === "exact");
};

export function servingRoutesFromIndexes(index, patterns, stopId, { date = null, limit = MAX_STOP_ROUTE_BADGES } = {}) {
  const references = patterns?.stopRoutes?.[String(stopId ?? "")];
  if (!Array.isArray(references) || !references.length) return [];
  const requested = new Set(references.filter((reference) => typeof reference === "string" && reference));
  if (!requested.size) return [];
  return scheduledCatalogForDate(index, date).filter((route) => requested.has(route.id)).slice(0, boundedLimit(limit));
}

const exactRoute = (index, reference) => {
  if (typeof reference === "string") return (index?.routes ?? []).find((route) => route.id === reference) ?? null;
  if (!reference || typeof reference !== "object") return null;
  if (typeof reference.id === "string") return (index?.routes ?? []).find((route) => route.id === reference.id) ?? null;
  const routeId = typeof reference.routeId === "string" ? reference.routeId : null;
  const feedId = typeof reference.feedId === "string" ? reference.feedId : null;
  if (!routeId || !feedId) return null;
  return scheduledCatalogForDate(index, reference.date ?? null).find((route) => route.routeId === routeId && route.feedId === feedId) ?? null;
};

const copyPattern = (pattern) => ({
  id: String(pattern.id),
  directionId: pattern.directionId ?? null,
  stops: Array.isArray(pattern.stops) ? pattern.stops.map((stop) => ({
    id: String(stop.id),
    sequence: Number(stop.sequence),
    name: String(stop.name ?? ""),
    lat: geographicCoordinate(stop.lat, -90, 90),
    lon: geographicCoordinate(stop.lon, -180, 180),
  })) : [],
});

export function routeStopAnchorsFromIndexes(index, patterns, reference, { date = null } = {}) {
  const route = typeof reference === "object" && reference && !Array.isArray(reference) && !reference.id
    ? exactRoute(index, { ...reference, date })
    : exactRoute(index, reference);
  if (!route) return null;
  const entries = Array.isArray(patterns?.routePatterns?.[route.id]) ? patterns.routePatterns[route.id] : [];
  return { route, patterns: entries.filter((pattern) => pattern && typeof pattern.id === "string").map(copyPattern) };
}

const sourceStopMap = (stops) => new Map((Array.isArray(stops?.stops) ? stops.stops : []).filter((stop) => stop && typeof stop.id === "string").map((stop) => [stop.id, stop]));

const stableStopForDate = (stops, index, patterns, requestedId, date) => {
  const direct = stops.get(requestedId) ?? null;
  const aliases = patterns?.stopAliases?.[requestedId];
  const effectiveDate = date ?? currentTorontoDate();
  const exact = (stop) => validityState(effectiveDate, stop?.validity) === "exact";
  if (!Array.isArray(aliases) || !aliases.length) return exact(direct) ? direct : null;
  const candidates = [...new Map([direct, ...aliases.map((id) => stops.get(id))].filter(Boolean).map((stop) => [stop.id, stop])).values()].filter(exact);
  if (!candidates.length) return null;
  const activeVersions = new Set((index?.routes ?? []).filter((route) => validityState(effectiveDate, route.validity) === "exact").map((route) => route.version));
  const exactCandidates = candidates.filter((stop) => activeVersions.has(stop.graphFeedId));
  if (exactCandidates.length === 1) return exactCandidates[0];
  if (exactCandidates.length > 1) return null;
  return candidates.length === 1 && candidates[0].id === requestedId ? candidates[0] : null;
};

export function publishedStopForIdFromIndexes(stops, index, patterns, qualifiedStopId, { date = null } = {}) {
  if (typeof qualifiedStopId !== "string" || !qualifiedStopId) return null;
  const byId = sourceStopMap(stops);
  const source = stableStopForDate(byId, index, patterns, qualifiedStopId, date);
  if (!source) return null;
  const lat = geographicCoordinate(source.lat, -90, 90);
  const lon = geographicCoordinate(source.lon, -180, 180);
  if (lat === null || lon === null) return null;
  return {
    id: String(source.id),
    name: String(source.name ?? ""),
    lat,
    lon,
    feedId: source.feedId ?? null,
    graphFeedId: source.graphFeedId ?? null,
    locationType: Number(source.locationType ?? 0),
    parentStation: source.parentStation ?? null,
    code: source.code ?? null,
    agency: source.agency ?? null,
    servingRoutes: servingRoutesFromIndexes(index, patterns, source.id, { date }),
  };
}

export async function servingRoutesForStop(stopId, options) {
  const [index, patterns] = await Promise.all([routeIndex(), routePatternIndex()]);
  return servingRoutesFromIndexes(index, patterns, stopId, options);
}

export async function routeStopAnchors(reference, options) {
  const [index, patterns] = await Promise.all([routeIndex(), routePatternIndex()]);
  return routeStopAnchorsFromIndexes(index, patterns, reference, options);
}

export async function publishedStopForId(qualifiedStopId, options) {
  const [stops, index, patterns] = await Promise.all([publishedStopIndex(), routeIndex(), routePatternIndex()]);
  return publishedStopForIdFromIndexes(stops, index, patterns, qualifiedStopId, options);
}
