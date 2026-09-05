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
  const classification = classifyOutOfDivision(leg.vehicle, route, registry, { now });
  return { ...classification, checkedAt: now, validUntil: Math.min(end, (timestampMs(leg.vehicle.timestamp) ?? 0) + 120_000) };
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

export { applyJourneyDivisionPreference } from './journey-division-preference.mjs';
