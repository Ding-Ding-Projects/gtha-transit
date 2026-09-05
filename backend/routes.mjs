import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const indexPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/routes.json");
let cached = null;

const normalize = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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
  return [...selected.values()].slice(0, limit).map((route) => ({ id: String(route.id), routeId: String(route.routeId), shortName: route.shortName ?? null, longName: route.longName ?? null, agency: route.agency ?? null, agencyId: route.agencyId ?? null, feedId: route.feedId ?? null, version: route.version ?? null, color: route.color ?? null, textColor: route.textColor ?? null, routeType: route.routeType ?? null, validity: route.validity ?? {} }));
}

export async function routeCatalog(options) { return filterRouteCatalog(await loadRoutes(), options); }
