import { readFileSync } from "node:fs";
const feeds = JSON.parse(readFileSync(new URL("../data/feeds.json", import.meta.url), "utf8")).agencies;
const MAX_STOPS = 40;
const MAX_CANDIDATES = 3;
const SAFETY_MARGIN_SECONDS = 120;
const MAX_AGE_MS = 120_000;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const boundedId = (value) => typeof value === "string" && Buffer.byteLength(value) <= 200 && /^[^\s:\u0000-\u001f\u007f]+$/.test(value);
const qualified = (value) => typeof value === "string" && Buffer.byteLength(value) <= 200 && /^[^:\s\u0000-\u001f\u007f]+:[^:\s\u0000-\u001f\u007f]+$/.test(value);

export function isServiceDate(value) {
  if (typeof value !== "string" || !/^\d{8}$/.test(value)) return false;
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const date = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso;
}

function torontoDate(now) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type).value).join("");
}

function scopedId(value, agencyId, feedId) {
  if (boundedId(value)) return Buffer.byteLength(`${feedId}:${value}`) <= 200 ? `${feedId}:${value}` : null;
  if (!qualified(value)) return null;
  const [prefix, id] = value.split(":");
  return prefix === agencyId || prefix === feedId ? scopedId(id, agencyId, feedId) : null;
}

/** Adapt one actual combineVehicleSnapshots vehicle, supplied only by the web collector. */
export function collectorSnapshot(raw, now = Date.now()) {
  if (!raw || Array.isArray(raw) || Object.keys(raw).some((key) => key !== "snapshot")) return null;
  const item = raw.snapshot;
  if (!item || typeof item !== "object" || !boundedId(item.agencyId) || item.stale === true || !finite(now)) return null;
  if (typeof item.timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(item.timestamp)) return null;
  const timestamp = Date.parse(item.timestamp);
  if (!finite(timestamp) || now - timestamp > MAX_AGE_MS || timestamp > now + 30_000) return null;
  // A published service date is authoritative, including service past midnight.
  // Without one, only the Toronto calendar date of the observation is attempted.
  const serviceDate = item.startDate == null ? torontoDate(timestamp) : item.startDate;
  if (!isServiceDate(serviceDate)) return null;
  const today = torontoDate(now);
  const previous = new Date(`${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}T12:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  if (serviceDate !== today && serviceDate !== previous.toISOString().slice(0, 10).replaceAll("-", "")) return null;
  const date = `${serviceDate.slice(0, 4)}-${serviceDate.slice(4, 6)}-${serviceDate.slice(6, 8)}`;
  const candidates = feeds.filter((feed) => (feed.publicAgencyId ?? feed.id) === item.agencyId && (!feed.retireAfter || date <= feed.retireAfter) && (!feed.promoteAfter || date > feed.promoteAfter));
  if (candidates.length !== 1) return null;
  const feedId = candidates[0].id;
  const id = scopedId(item.id, item.agencyId, item.agencyId);
  const tripId = scopedId(item.tripId, item.agencyId, feedId);
  if (!id || !tripId || item.vehicleKey !== id) return null;
  const nextStopId = item.nextStopId == null ? null : scopedId(item.nextStopId, item.agencyId, feedId);
  if (item.nextStopId != null && !nextStopId) return null;
  return { id, vehicleKey: id, agencyId: item.agencyId, tripId, serviceDate, serviceDateSource: item.startDate == null ? "observation-calendar" : "publisher", timestamp: new Date(timestamp).toISOString(), nextStopId };
}

/** Choose only upcoming, non-cancelled publisher times that leave a safety margin. */
export function interceptCandidates({ stops, now = Date.now(), nextStopId = null, safetyMarginSeconds = SAFETY_MARGIN_SECONDS }) {
  if (!finite(now) || !finite(safetyMarginSeconds) || safetyMarginSeconds < 0) return [];
  const ordered = Array.isArray(stops) ? stops : [];
  const start = nextStopId ? ordered.findIndex((stop) => stop?.id === nextStopId) : 0;
  if (start < 0) return [];
  return ordered.slice(start, start + MAX_STOPS).filter((stop) => {
    const at = Date.parse(stop?.arrivalAt ?? stop?.departureAt ?? stop?.scheduledArrivalAt ?? stop?.scheduledDepartureAt ?? "");
    return finite(at) && at > now + safetyMarginSeconds * 1000 && !["CANCELED", "CANCELLED", "SKIPPED"].includes(stop?.realtimeState) && qualified(stop?.id) && finite(stop?.lat) && Math.abs(stop.lat) <= 90 && finite(stop?.lon) && Math.abs(stop.lon) <= 180;
  }).slice(0, MAX_STOPS).slice(0, MAX_CANDIDATES).map((stop) => { const arrivalAt = stop.arrivalAt ?? stop.departureAt ?? stop.scheduledArrivalAt ?? stop.scheduledDepartureAt; return { ...stop, basis: stop.arrivalAt || stop.departureAt ? "realtime" : "scheduled", arriveByAt: new Date((Date.parse(arrivalAt) - safetyMarginSeconds * 1000)).toISOString() }; });
}
