import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const indexPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/stops.json");
const manifestPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/feeds/manifest.json");
const provenancePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/graph-provenance.json");
let cached = null;

async function loadStops() {
  if (!cached) {
    const parsed = JSON.parse(await readFile(indexPath, "utf8"));
    cached = Array.isArray(parsed.stops) ? parsed.stops : [];
  }
  return cached;
}

export async function searchPlaces(query, limit = 20) {
  return rankPlaces(await loadStops(), query, limit);
}

const normalize = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function rankPlaces(stops, query, limit = 20) {
  const q = normalize(query);
  if (!q) return [];
  const tokens = q.split(" ");
  const score = (stop) => {
    const name = normalize(stop.name); const agency = normalize(stop.agency); const code = normalize(stop.code);
    const words = new Set(name.split(" "));
    if (!tokens.every((token) => words.has(token) || agency.split(" ").includes(token) || code.split(" ").includes(token))) return null;
    const exact = name === q;
    const hub = /\b(station|terminal|airport|centre|center)\b/.test(name);
    const prefix = name.startsWith(`${q} `);
    const phraseIndex = name.split(" ").findIndex((_, index, all) => all.slice(index, index + tokens.length).join(" ") === q);
    const tier = exact ? 0 : hub ? 1 : prefix ? 2 : phraseIndex >= 0 ? 3 : agency === q ? 4 : 5;
    return [tier, Number(stop.locationType) === 1 ? 0 : 1, phraseIndex < 0 ? 999 : phraseIndex, name.length, name, agency, String(stop.id)];
  };
  const compare = (a, b) => { for (let index = 0; index < a.length; index += 1) { const value = typeof a[index] === "number" ? a[index] - b[index] : String(a[index]).localeCompare(String(b[index])); if (value) return value; } return 0; };
  const ranked = stops.map((stop) => ({ stop, score: score(stop) })).filter((item) => item.score !== null).sort((a, b) => compare(a.score, b.score));
  const seen = new Set();
  return ranked.filter(({ stop }) => { const lat = Number(stop.lat); const lon = Number(stop.lon); const location = Number.isFinite(lat) && Number.isFinite(lon) ? `${lat}|${lon}` : `id:${stop.id}`; const key = `${normalize(stop.name)}|${normalize(stop.agency)}|${location}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, limit).map(({ stop }) => ({
    id: String(stop.id), name: String(stop.name), lat: Number(stop.lat), lon: Number(stop.lon), kind: "stop", feedId: stop.feedId ?? null, locationType: Number(stop.locationType ?? 0), parentStation: stop.parentStation ?? null, ...(stop.agency ? { agency: String(stop.agency) } : {})
  }));
}

export function coverageContextForDate(provenance, date) {
  const unavailableAgencies = groupGraphFeeds(provenance.feeds ?? []).filter((feed) => feed.activeTripsByDate?.[date] === 0).map((feed) => ({ id: feed.id, nextServiceDate: Object.entries(feed.activeTripsByDate).sort(([left], [right]) => left.localeCompare(right)).find(([candidate, count]) => candidate > date && count > 0)?.[0] ?? null }));
  return { date, unavailableAgencies };
}

export function groupGraphFeeds(feeds) {
  const grouped = new Map();
  for (const feed of feeds) {
    const id = feed.publicAgencyId ?? feed.id;
    const current = grouped.get(id) ?? { ...feed, id, activeTripsByDate: {} };
    current.serviceStart = [current.serviceStart, feed.serviceStart].filter(Boolean).sort()[0] ?? null;
    current.serviceEnd = [current.serviceEnd, feed.serviceEnd].filter(Boolean).sort().at(-1) ?? null;
    for (const [date, count] of Object.entries(feed.activeTripsByDate ?? {})) current.activeTripsByDate[date] = (current.activeTripsByDate[date] ?? 0) + Number(count);
    grouped.set(id, current);
  }
  return [...grouped.values()];
}

export function calendarDateInTimeZone(dateTime, timeZone = "America/Toronto") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(dateTime));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function graphProvenance() {
  try { return JSON.parse(await readFile(provenancePath, "utf8")); } catch { return { source: "OpenTripPlanner", graphBuiltAt: null, timezone: "America/Toronto", feeds: [] }; }
}

export async function coverage() {
  const stops = await loadStops();
  let manifest = { generatedAt: null, feeds: [] };
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch {}
  const provenance = await graphProvenance();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: provenance.timezone ?? "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const provenanceFeeds = new Map(groupGraphFeeds(provenance.feeds ?? []).map((feed) => [feed.id, feed]));
  const counts = new Map();
  for (const stop of stops) counts.set(stop.feedId, (counts.get(stop.feedId) ?? 0) + 1);
  const manifestFeeds = new Map();
  for (const feed of manifest.feeds ?? []) { const id = feed.publicAgencyId ?? feed.id; if (!manifestFeeds.has(id) || feed.id === id) manifestFeeds.set(id, { ...feed, id }); }
  const feeds = [...manifestFeeds.values()].map((feed) => { const graphFeed = provenanceFeeds.get(feed.id); const activeTripsToday = graphFeed?.activeTripsByDate?.[today] ?? null; return { id: feed.id, name: feed.name, loaded: Boolean(graphFeed), availableToday: activeTripsToday === null ? null : activeTripsToday > 0, activeTripsToday, activeTripsByDate: graphFeed?.activeTripsByDate ?? {}, indexedStops: counts.get(feed.id) ?? 0, serviceStart: graphFeed?.serviceStart ?? null, serviceEnd: graphFeed?.serviceEnd ?? null, source: feed.source, sha256: graphFeed?.sha256 ?? null, bytes: feed.bytes, warning: activeTripsToday === 0 ? `No scheduled trips are available for ${today} in the active graph.` : null }; });
  return { generatedAt: provenance.updatedAt, graphBuiltAt: provenance.graphBuiltAt, timezone: provenance.timezone, indexedStops: stops.length, agencies: feeds, feeds, warnings: feeds.filter((feed) => feed.warning).map((feed) => ({ id: feed.id, message: feed.warning })), source: "active OpenTripPlanner graph and validated official GTFS feeds" };
}
