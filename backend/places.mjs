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
  const normalize = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const q = normalize(query);
  if (!q) return [];
  const stops = await loadStops();
  const tokens = q.split(" ");
  const score = (stop) => {
    const name = normalize(stop.name); const agency = normalize(stop.agency); const code = normalize(stop.code);
    const words = new Set(name.split(" "));
    if (!tokens.every((token) => words.has(token) || agency.split(" ").includes(token) || code.split(" ").includes(token))) return null;
    let value = 1000;
    if (name === q) value -= 700;
    else if (name.startsWith(`${q} `)) value -= 500;
    else if (name.split(" ").some((_, index, words) => words.slice(index, index + tokens.length).join(" ") === q)) value -= 350;
    else if (agency === q) value -= 250;
    if (Number(stop.locationType) === 1) value -= 180;
    if (/\b(station|terminal|centre|center)\b/.test(name) || /\bgo\b/.test(name)) value -= 220;
    if (!stop.parentStation) value -= 20;
    return value + Math.min(name.length, 200);
  };
  return stops.map((stop) => ({ stop, score: score(stop) })).filter((item) => item.score !== null).sort((a, b) => a.score - b.score || a.stop.name.localeCompare(b.stop.name)).slice(0, limit).map(({ stop }) => ({
    id: String(stop.id), name: String(stop.name), lat: Number(stop.lat), lon: Number(stop.lon), kind: "stop", ...(stop.agency ? { agency: String(stop.agency) } : {})
  }));
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
  const provenanceFeeds = new Map((provenance.feeds ?? []).map((feed) => [feed.id, feed]));
  const counts = new Map();
  for (const stop of stops) counts.set(stop.feedId, (counts.get(stop.feedId) ?? 0) + 1);
  const feeds = (manifest.feeds ?? []).map((feed) => { const graphFeed = provenanceFeeds.get(feed.id); const activeTripsToday = graphFeed?.activeTripsByDate?.[today] ?? null; return { id: feed.id, name: feed.name, loaded: Boolean(graphFeed), availableToday: activeTripsToday === null ? null : activeTripsToday > 0, activeTripsToday, activeTripsByDate: graphFeed?.activeTripsByDate ?? {}, indexedStops: counts.get(feed.id) ?? 0, serviceStart: graphFeed?.serviceStart ?? null, serviceEnd: graphFeed?.serviceEnd ?? null, source: feed.source, sha256: graphFeed?.sha256 ?? null, bytes: feed.bytes, warning: activeTripsToday === 0 ? `No scheduled trips are available for ${today} in the active graph.` : null }; });
  return { generatedAt: provenance.updatedAt, graphBuiltAt: provenance.graphBuiltAt, timezone: provenance.timezone, indexedStops: stops.length, agencies: feeds, feeds, warnings: feeds.filter((feed) => feed.warning).map((feed) => ({ id: feed.id, message: feed.warning })), source: "active OpenTripPlanner graph and validated official GTFS feeds" };
}
