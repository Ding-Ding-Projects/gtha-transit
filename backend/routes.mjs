import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const indexPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/routes.json");
let cached = null;

const normalize = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const dateInRange = (date, validity) => !date || (!validity?.serviceStart || validity.serviceStart <= date.replaceAll("-", "")) && (!validity?.serviceEnd || validity.serviceEnd >= date.replaceAll("-", ""));
const activeRank = (route, date) => dateInRange(date, route.validity) ? 0 : route.validity?.promoteAfter && route.validity.promoteAfter <= date ? 1 : 2;
const currentTorontoDate = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

async function loadRoutes() {
  if (!cached) {
    const parsed = JSON.parse(await readFile(indexPath, "utf8"));
    cached = Array.isArray(parsed.routes) ? parsed.routes : [];
  }
  return cached;
}

export function filterRouteCatalog(routes, { agency = null, query = null, date = null, limit = 50 } = {}) {
  const requestedAgency = normalize(agency); const requestedQuery = normalize(query); const effectiveDate = date ?? currentTorontoDate();
  const matches = routes.filter((route) => (!requestedAgency || normalize(route.feedId) === requestedAgency || normalize(route.agency) === requestedAgency) && (!requestedQuery || [route.shortName, route.longName, route.routeId].some((value) => normalize(value).includes(requestedQuery))));
  const selected = new Map();
  for (const route of matches.sort((left, right) => activeRank(left, effectiveDate) - activeRank(right, effectiveDate) || String(left.id).localeCompare(String(right.id)))) {
    const key = `${route.feedId}|${route.routeId}`;
    if (!selected.has(key)) selected.set(key, route);
  }
  return [...selected.values()].sort((left, right) => natural.compare(left.agency ?? "", right.agency ?? "") || natural.compare(left.shortName ?? left.routeId, right.shortName ?? right.routeId) || natural.compare(left.longName ?? "", right.longName ?? "") || natural.compare(left.routeId, right.routeId) || natural.compare(left.version, right.version)).slice(0, limit).map((route) => ({ id: String(route.id), routeId: String(route.routeId), shortName: route.shortName ?? null, longName: route.longName ?? null, agency: route.agency ?? null, agencyId: route.agencyId ?? null, feedId: route.feedId ?? null, version: route.version ?? null, color: route.color ?? null, textColor: route.textColor ?? null, routeType: route.routeType ?? null, validity: route.validity ?? {} }));
}

export async function routeCatalog(options) { return filterRouteCatalog(await loadRoutes(), options); }

const cursorFor = (offset) => Buffer.from(String(offset), "utf8").toString("base64url");
const offsetFor = (cursor) => {
  const decoded = Buffer.from(String(cursor), "base64url").toString("utf8");
  if (!/^(0|[1-9]\d*)$/.test(decoded)) throw new Error("cursor is invalid");
  const offset = Number(decoded);
  if (!Number.isSafeInteger(offset) || offset > 1_000_000) throw new Error("cursor is invalid");
  return offset;
};

export function routeCatalogPage(routes, options = {}) {
  const { limit = 50, cursor = null, offset = 0, date = null } = options;
  const start = cursor == null ? offset : offsetFor(cursor);
  const all = filterRouteCatalog(routes, { ...options, date, limit: Number.MAX_SAFE_INTEGER });
  const page = all.slice(start, start + limit);
  const exact = page.filter((route) => dateInRange(date ?? currentTorontoDate(), route.validity)).length;
  return { routes: page, total: all.length, nextCursor: start + page.length < all.length ? cursorFor(start + page.length) : null, coverage: { date: date ?? currentTorontoDate(), exact, fallback: page.length - exact } };
}

export async function routeCatalogPageFromIndex(options) { return routeCatalogPage(await loadRoutes(), options); }
