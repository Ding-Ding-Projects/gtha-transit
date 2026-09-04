import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const registryPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/transit-washrooms.json");
let registry;
const normalize = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(station|go|terminal|subway|lrt|platform|northbound|southbound|eastbound|westbound|towards)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\b(line )?\d+\b/g, " ").replace(/\s+/g, " ").trim();
async function load() { return registry ??= JSON.parse(await readFile(registryPath, "utf8")); }

export async function applyWashroomPreference(itineraries, enabled) {
  const data = await load();
  const facilities = data.facilities.map((facility) => ({ ...facility, keys: facility.names.map(normalize) }));
  const enriched = itineraries.map((itinerary) => {
    const places = itinerary.legs.flatMap((leg) => [leg.from, leg.to]);
    const found = [];
    for (const place of places) {
      const key = normalize(place.name);
      const facility = facilities.find((item) => item.keys.includes(key));
      if (facility && !found.some((item) => item.source === facility.source && item.name === place.name)) found.push({ name: place.name, lat: place.lat, lon: place.lon, openingHours: null, access: null, wheelchair: facility.wheelchair ?? null, fee: null, distanceToRoute: 0, source: facility.source });
    }
    return { ...itinerary, totalDistance: itinerary.legs.reduce((sum, leg) => sum + Number(leg.distance || 0), 0), washrooms: found, washroomPreferenceApplied: false };
  });
  if (!enabled || !enriched.length) return { itineraries: enriched, washroomPreferenceApplied: false, note: "Only officially confirmed station and terminal washrooms are included. Availability and opening hours are not guaranteed." };
  const fastest = Math.min(...enriched.map((item) => item.duration));
  const leastWalk = Math.min(...enriched.map((item) => item.walkDistance));
  const eligible = enriched.filter((item) => item.duration <= fastest + 1200 && item.walkDistance <= leastWalk + 1000);
  eligible.sort((a, b) => b.washrooms.length - a.washrooms.length || a.duration - b.duration);
  const selected = eligible[0];
  if (selected?.washrooms.length) selected.washroomPreferenceApplied = true;
  const rest = enriched.filter((item) => item !== selected).sort((a, b) => a.duration - b.duration);
  return { itineraries: selected ? [selected, ...rest] : enriched, washroomPreferenceApplied: Boolean(selected?.washrooms.length), note: selected?.washrooms.length ? "Preferred connections with confirmed station or terminal washrooms, within 20 minutes and 1,000 metres walking of the fastest eligible trip. Availability and opening hours are not guaranteed." : "No confirmed station or terminal washroom matched these itineraries, so the original ranking was retained." };
}
