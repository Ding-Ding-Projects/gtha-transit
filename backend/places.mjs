import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const indexPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/stops.json");
const manifestPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/feeds/manifest.json");
let cached = null;

async function loadStops() {
  if (!cached) {
    const parsed = JSON.parse(await readFile(indexPath, "utf8"));
    cached = Array.isArray(parsed.stops) ? parsed.stops : [];
  }
  return cached;
}

export async function searchPlaces(query, limit = 20) {
  const q = String(query ?? "").trim().toLocaleLowerCase();
  if (!q) return [];
  const stops = await loadStops();
  return stops.filter((stop) => `${stop.name} ${stop.agency ?? ""}`.toLocaleLowerCase().includes(q)).slice(0, limit).map((stop) => ({
    id: String(stop.id), name: String(stop.name), lat: Number(stop.lat), lon: Number(stop.lon), kind: "stop", ...(stop.agency ? { agency: String(stop.agency) } : {})
  }));
}

export async function coverage() {
  const stops = await loadStops();
  let manifest = { generatedAt: null, feeds: [] };
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch {}
  const counts = new Map();
  for (const stop of stops) counts.set(stop.feedId, (counts.get(stop.feedId) ?? 0) + 1);
  const feeds = (manifest.feeds ?? []).map((feed) => ({ id: feed.id, name: feed.name, loaded: counts.has(feed.id), indexedStops: counts.get(feed.id) ?? 0, serviceStart: feed.serviceStart ?? null, serviceEnd: feed.serviceEnd ?? null, source: feed.source, sha256: feed.sha256, bytes: feed.bytes }));
  return { generatedAt: manifest.generatedAt, indexedStops: stops.length, agencies: feeds, feeds, source: "validated official GTFS feeds" };
}
