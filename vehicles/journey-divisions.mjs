import { classifyOutOfDivision } from './divisions.mjs';

const timestampMs = (value) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === 'string' && value.trim()) {
    if (/^\d+(?:\.\d+)?$/.test(value.trim())) return timestampMs(Number(value));
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};
const isTtcFeed = (value) => ['ttc', 'ttc-next'].includes(String(value ?? '').trim().toLocaleLowerCase());
const routeId = (value) => String(value ?? '').trim().replace(/^(?:ttc|ttc-next):/i, '');
const unknown = (reason) => ({ state: 'unknown', reason });

function classifyJourneyLeg(leg, registry, now) {
  if (['WALK', 'WALKING'].includes(String(leg?.mode ?? '').toUpperCase())) return { state: 'ignored', reason: 'walking-leg' };
  if (leg?.vehicleAssignment?.state !== 'matched' || leg.vehicleAssignment.method !== 'exact-trip-id') return unknown('no-exact-vehicle-assignment');
  if (!leg?.vehicle || !isTtcFeed(leg.agencyFeedId) || leg.vehicle.agencyId !== 'ttc') return unknown('not-a-ttc-exact-vehicle-assignment');
  const route = routeId(leg.routeId);
  if (!route) return unknown('missing-leg-route');
  if (leg.vehicle.routeId && routeId(leg.vehicle.routeId) !== route) return unknown('vehicle-route-mismatch');
  const start = timestampMs(leg.startTime); const end = timestampMs(leg.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return unknown('invalid-leg-time');
  if (end < now || start > now + 7_200_000) return unknown('leg-is-not-current');
  return classifyOutOfDivision(leg.vehicle, route, registry, { now });
}

/** Attach dated, assignment-bound division evidence without changing itinerary or leg inputs. */
export function annotateJourneyDivisions(itineraries, registry, { now = Date.now() } = {}) {
  const list = Array.isArray(itineraries) ? itineraries : [];
  const reasons = {};
  let matched = 0; let unknownCount = 0;
  const annotated = list.map((itinerary) => ({
    ...itinerary,
    legs: (Array.isArray(itinerary?.legs) ? itinerary.legs : []).map((leg) => {
      const vehicleDivision = classifyJourneyLeg(leg, registry, now);
      if (vehicleDivision.state === 'out-of-division') matched += 1;
      if (vehicleDivision.state === 'unknown') { unknownCount += 1; reasons[vehicleDivision.reason] = (reasons[vehicleDivision.reason] ?? 0) + 1; }
      return { ...leg, vehicleDivision };
    }),
  }));
  return { itineraries: annotated, matched, unknown: unknownCount, reasons };
}

/** Stable soft preference that moves only itineraries with verified out-of-division evidence. */
export function applyJourneyDivisionPreference(itineraries, options = {}) {
  const enabled = Boolean(options.enabled);
  const list = Array.isArray(itineraries) ? itineraries : [];
  const entries = list.map((itinerary, index) => {
    const divisions = Array.isArray(itinerary?.legs) ? itinerary.legs.map((leg) => leg?.vehicleDivision).filter(Boolean) : [];
    const verifiedOut = divisions.some((division) => division.state === 'out-of-division');
    const unknownReasons = divisions.filter((division) => division.state === 'unknown').map((division) => division.reason);
    return { itinerary, index, verifiedOut, unknownReasons };
  });
  const reasons = {};
  for (const entry of entries) for (const reason of entry.unknownReasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
  const matched = entries.filter((entry) => entry.verifiedOut).length;
  const unknownCount = entries.filter((entry) => entry.unknownReasons.length > 0).length;
  const ordered = enabled ? [...entries.filter((entry) => entry.verifiedOut), ...entries.filter((entry) => !entry.verifiedOut)] : entries;
  return { itineraries: ordered.map((entry) => entry.itinerary), options: { ...options, enabled }, matched, unknown: unknownCount, reasons, preferenceApplied: enabled && matched > 0 };
}
