import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { currentTorontoDate, filterRouteCatalog, routeIndex, validityState } from "./routes.mjs";

const patternIndexPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/route-patterns.json");
const MAX_STOP_ROUTE_BADGES = 12;
let cachedPatterns = null;

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
      routePatterns: parsed && typeof parsed.routePatterns === "object" && !Array.isArray(parsed.routePatterns) ? parsed.routePatterns : {},
    };
  }
  return cachedPatterns;
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
    lat: stop.lat === null ? null : Number(stop.lat),
    lon: stop.lon === null ? null : Number(stop.lon),
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

export async function servingRoutesForStop(stopId, options) {
  const [index, patterns] = await Promise.all([routeIndex(), routePatternIndex()]);
  return servingRoutesFromIndexes(index, patterns, stopId, options);
}

export async function routeStopAnchors(reference, options) {
  const [index, patterns] = await Promise.all([routeIndex(), routePatternIndex()]);
  return routeStopAnchorsFromIndexes(index, patterns, reference, options);
}
