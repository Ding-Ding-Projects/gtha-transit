import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { matchWashroom } from "../shared/washrooms.mjs";
import { resolveFacilityStopIdentities } from "../shared/washroom-identities.mjs";

const registryPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/transit-washrooms.json");
const stopIndexPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/stops.json");
const TRANSIT_MODES = new Set(["BUS", "RAIL", "SUBWAY", "TRAM"]);
const TRANSIT_FACILITY_TYPES = new Set(["transit-station", "transit-terminal"]);
let registry;

async function load() {
  if (!registry) {
    const [facilityRegistry, stopIndex] = await Promise.all([readFile(registryPath, "utf8"), readFile(stopIndexPath, "utf8")]);
    const parsedRegistry = JSON.parse(facilityRegistry); const parsedStopIndex = JSON.parse(stopIndex);
    const resolution = resolveFacilityStopIdentities(parsedRegistry.facilities, parsedStopIndex);
    registry = { ...parsedRegistry, facilities: resolution.facilities, washroomIdentityMap: resolution.identityMap };
  }
  return registry;
}

/** Exposes the source-backed identity map for the selected-places API adapter. */
export async function washroomIdentityMap() { return (await load()).washroomIdentityMap; }

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const stamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : new Date(0).toISOString();

function publicWashroom(match, place, availability) {
  return {
    facilityId: match.facilityId ?? match.id ?? null,
    agencyId: match.agencyId ?? null,
    facilityType: match.facilityType ?? null,
    name: Array.isArray(match.names) ? match.names[0] ?? null : match.name ?? null,
    source: match.source ?? null,
    availability,
    location: { name: place.name ?? null, lat: finite(place.lat), lon: finite(place.lon) }
  };
}

function annotatePlace(place, facilities, agencyId, at) {
  const original = place && typeof place === "object" ? place : {};
  const match = matchWashroom(original, facilities, { agencyId, at });
  if (!match) return { ...original, washroom: null };
  return { ...original, washroom: publicWashroom(match, original, match.availability) };
}

function isTransit(leg) { return TRANSIT_MODES.has(String(leg?.mode ?? "").toUpperCase()); }

function annotatedLeg(leg, facilities) {
  const agencyId = leg?.agencyId ?? leg?.agencyFeedId ?? null;
  const from = annotatePlace(leg?.from, facilities, agencyId, stamp(leg?.startTime));
  const to = annotatePlace(leg?.to, facilities, agencyId, stamp(leg?.endTime ?? leg?.startTime));
  const intermediateStops = Array.isArray(leg?.intermediateStops) ? leg.intermediateStops.map((place) => annotatePlace(place, facilities, agencyId, stamp(leg?.startTime))) : [];
  return { ...leg, from, to, intermediateStops };
}

function boostableWashrooms(legs) {
  const found = [];
  for (const leg of legs) {
    if (!isTransit(leg)) continue;
    for (const place of [leg.from, leg.to]) {
      const washroom = place?.washroom;
      const transitFacility = TRANSIT_FACILITY_TYPES.has(String(washroom?.facilityType ?? ""));
      const eligible = transitFacility ? washroom?.availability !== "closed" : washroom?.availability === "confirmed-open";
      if (!washroom || !eligible) continue;
      const key = `${washroom.agencyId ?? "unknown"}|${washroom.facilityId ?? "unknown"}`;
      if (!found.some((item) => item.key === key)) found.push({ ...washroom, key });
    }
  }
  return found.map(({ key, ...washroom }) => washroom);
}

/** Preserves the existing two-argument API. The optional registry is test-only. */
export async function applyWashroomPreference(itineraries, enabled, { facilityRegistry = null } = {}) {
  const data = facilityRegistry ?? await load();
  const facilities = Array.isArray(data) ? data : Array.isArray(data?.facilities) ? data.facilities : [];
  const enriched = (Array.isArray(itineraries) ? itineraries : []).map((itinerary) => {
    const legs = (Array.isArray(itinerary?.legs) ? itinerary.legs : []).map((leg) => annotatedLeg(leg, facilities));
    return { ...itinerary, legs, totalDistance: legs.reduce((sum, leg) => sum + Number(leg.distance || 0), 0), washrooms: boostableWashrooms(legs), washroomPreferenceApplied: false };
  });
  if (!enabled || !enriched.length) return { itineraries: enriched, washroomPreferenceApplied: false, note: "Only official facility records are shown. Transit facilities may be preferred by confirmed presence when hours are unknown, while municipal facilities require confirmed-open hours." };
  const fastest = Math.min(...enriched.map((item) => Number(item.duration) || Infinity));
  const leastWalk = Math.min(...enriched.map((item) => Number(item.walkDistance) || Infinity));
  const eligible = enriched.filter((item) => Number(item.duration) <= fastest + 1200 && Number(item.walkDistance) <= leastWalk + 1000);
  eligible.sort((left, right) => right.washrooms.length - left.washrooms.length || Number(left.duration) - Number(right.duration));
  const selected = eligible[0];
  if (selected?.washrooms.length) selected.washroomPreferenceApplied = true;
  const rest = enriched.filter((item) => item !== selected).sort((left, right) => Number(left.duration) - Number(right.duration));
  return {
    itineraries: selected ? [selected, ...rest] : enriched,
    washroomPreferenceApplied: Boolean(selected?.washrooms.length),
    note: selected?.washrooms.length ? selected.washrooms.some((washroom) => TRANSIT_FACILITY_TYPES.has(String(washroom.facilityType ?? "")) && washroom.availability === "unknown") ? "Preferred a connection with an official transit facility at a boarding or alighting point. Its opening hours are unknown, so this is a facility-presence preference, not an open claim." : "Preferred a connection with an official facility confirmed open at a boarding or alighting time. Intermediate pass-through stops do not change ranking." : "No eligible official facility was available at a boarding or alighting time, so the original ranking was retained."
  };
}
