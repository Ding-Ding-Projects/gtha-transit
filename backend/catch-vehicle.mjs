const MAX_STOPS = 40;
const MAX_CANDIDATES = 3;
const SAFETY_MARGIN_SECONDS = 120;
const MAX_AGE_MS = 120_000;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const qualified = (value) => typeof value === "string" && value.length <= 200 && /^[^:\s]+:[^\s]+$/.test(value);

/** Validate the narrow shape accepted from the server-side collector, never a browser. */
export function collectorSnapshot(raw, now = Date.now()) {
  const item = raw?.snapshot;
  if (!item || typeof item !== "object" || !qualified(item.id) || !qualified(item.agencyId) || !qualified(item.tripId) || !/^\d{8}$/.test(item.serviceDate ?? "")) return null;
  if (!finite(item.timestamp) || now - item.timestamp > MAX_AGE_MS || item.timestamp > now + 30_000) return null;
  return { id: item.id, agencyId: item.agencyId, tripId: item.tripId, serviceDate: item.serviceDate, timestamp: item.timestamp };
}

/** Choose only upcoming, non-cancelled publisher times that leave a safety margin. */
export function interceptCandidates({ stops, now = Date.now(), safetyMarginSeconds = SAFETY_MARGIN_SECONDS }) {
  return (Array.isArray(stops) ? stops : []).filter((stop) => {
    const at = Date.parse(stop?.arrivalAt ?? stop?.departureAt ?? stop?.scheduledArrivalAt ?? stop?.scheduledDepartureAt ?? "");
    return finite(at) && at > now + safetyMarginSeconds * 1000 && stop?.realtimeState !== "CANCELED" && qualified(stop?.id) && finite(stop?.lat) && finite(stop?.lon);
  }).slice(0, MAX_STOPS).slice(0, MAX_CANDIDATES).map((stop) => { const arrivalAt = stop.arrivalAt ?? stop.departureAt ?? stop.scheduledArrivalAt ?? stop.scheduledDepartureAt; return { ...stop, basis: stop.arrivalAt || stop.departureAt ? "realtime" : "scheduled", arriveByAt: new Date((Date.parse(arrivalAt) - safetyMarginSeconds * 1000)).toISOString() }; });
}
