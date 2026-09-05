import { classifyOutOfDivision } from './divisions.mjs';

const WINDOW_MS = 7_200_000;
const timestampMs = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? (value < 10_000_000_000 ? value * 1000 : value) : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()) ? timestampMs(Number(value)) : typeof value === 'string' && value.trim() ? Date.parse(value) : null;
const routeId = (value) => String(value ?? '').trim().replace(/^(?:ttc|ttc-next):/i, '');
const isTtcFeed = (value) => ['ttc', 'ttc-next'].includes(String(value ?? '').trim().toLocaleLowerCase());
const disclosure = 'Observed current route-level vehicles do not identify a departure vehicle or guarantee future availability.';
const unknown = (route, reason) => ({ state: 'unknown', routeId: route, reason, disclosure });

function eligibleLeg(leg, now) {
  if (['WALK', 'WALKING'].includes(String(leg?.mode ?? '').toUpperCase())) return { ignored: true };
  const route = routeId(leg?.routeId); const start = timestampMs(leg?.startTime); const end = timestampMs(leg?.endTime);
  if (!isTtcFeed(leg?.agencyFeedId) || !route) return { route, evidence: unknown(route, 'not-a-ttc-route-leg') };
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return { route, evidence: unknown(route, 'invalid-leg-time') };
  if (end < now || start > now + WINDOW_MS) return { route, evidence: unknown(route, 'leg-is-not-current') };
  return { route, start, end };
}

export function annotateJourneyRouteOpportunities(itineraries, snapshot, registry, { now = Date.now() } = {}) {
  const byRoute = new Map();
  const distinct = new Map();
  if (snapshot?.state === 'live' && snapshot?.agencyId === 'ttc') for (const vehicle of snapshot.vehicles ?? []) {
    const id = String(vehicle?.id ?? '').trim(), observed = timestampMs(vehicle?.timestamp);
    if (!id || vehicle.agencyId !== 'ttc' || !Number.isFinite(observed)) continue;
    const previous = distinct.get(id);
    if (!previous || observed > previous.observed) distinct.set(id, { vehicle, observed, ambiguous: false });
    else if (observed === previous.observed && routeId(vehicle.routeId) !== routeId(previous.vehicle.routeId)) previous.ambiguous = true;
  }
  for (const { vehicle, ambiguous } of distinct.values()) {
    if (ambiguous) continue;
    const route = routeId(vehicle?.routeId); if (!route) continue;
    const classification = classifyOutOfDivision(vehicle, route, registry, { now });
    const group = byRoute.get(route) ?? { out: [], reasons: [] };
    if (classification.state === 'out-of-division') group.out.push({ vehicle, classification });
    else if (classification.state === 'unknown') group.reasons.push(classification.reason);
    byRoute.set(route, group);
  }
  const routeEvidence = (leg) => {
    const eligibility = eligibleLeg(leg, now); if (eligibility.ignored) return { state: 'ignored', reason: 'walking-leg' };
    if (eligibility.evidence) return eligibility.evidence;
    if (snapshot?.state !== 'live' || snapshot?.agencyId !== 'ttc') return unknown(eligibility.route, 'snapshot-not-live-ttc');
    const group = byRoute.get(eligibility.route);
    if (!group?.out.length) return unknown(eligibility.route, group?.reasons[0] ?? 'no-verified-out-of-division-vehicle');
    const selected = [...group.out].sort((left, right) => timestampMs(right.vehicle.timestamp) - timestampMs(left.vehicle.timestamp)).slice(0, 20);
    const observations = selected.map(({ vehicle }) => ({ id: String(vehicle.id), fleetNumber: String(vehicle.fleetNumber ?? vehicle.label ?? ''), validUntil: Math.min(eligibility.end, timestampMs(vehicle.timestamp) + 120_000) }));
    return { state: 'observed', routeId: eligibility.route, vehicleCount: group.out.length, vehicleIds: observations.map((vehicle) => vehicle.id), fleetNumbers: observations.map((vehicle) => vehicle.fleetNumber).filter(Boolean), observations, truncated: group.out.length > observations.length, checkedAt: now, validUntil: Math.max(...observations.map((vehicle) => vehicle.validUntil)), source: selected[0].classification.source, disclosure };
  };
  const annotated = (Array.isArray(itineraries) ? itineraries : []).map((itinerary) => ({ ...itinerary, legs: (Array.isArray(itinerary?.legs) ? itinerary.legs : []).map((leg) => ({ ...leg, routeDivisionOpportunity: routeEvidence(leg) })) }));
  return { itineraries: annotated };
}
