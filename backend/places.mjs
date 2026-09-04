import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const indexPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/stops.json");
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
  return { agencies: [...new Set(stops.map((stop) => stop.agency).filter(Boolean))].sort(), indexedStops: stops.length, source: "GTFS stop index" };
}
