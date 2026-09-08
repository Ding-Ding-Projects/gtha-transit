const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' });
const torontoDate = (now) => { const parts = Object.fromEntries(formatter.formatToParts(new Date(now)).map((part) => [part.type, part.value])); return `${parts.year}-${parts.month}-${parts.day}`; };
/**
 * The observed route opportunity, if it can still be used.
 *
 * Same two clocks as the division evidence beside it, and the same correction:
 * the observation still expires quickly, but the allocation summary is only
 * refused before its period starts. A period that has ended is the last one the
 * operator published, and refusing it made this go silent on the day a board
 * period rolled over while the tracker carried on answering with a caveat.
 */
export function usableRouteOpportunity(evidence, { now = Date.now() } = {}) {
  if (!evidence || evidence.state !== 'observed' || !Number.isFinite(evidence.checkedAt) || now < evidence.checkedAt) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(evidence.source?.validFrom ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(evidence.source?.validThrough ?? '') || !Array.isArray(evidence.observations) || evidence.observations.length > 20) return null;
  if (torontoDate(now) < evidence.source?.validFrom) return null;
  const observations = (evidence.observations ?? []).filter((item) => Number.isFinite(item.validUntil) && now <= item.validUntil);
  return observations.length ? { ...evidence, observations, vehicleIds: observations.map((item) => item.id), fleetNumbers: observations.map((item) => item.fleetNumber).filter(Boolean), vehicleCount: observations.length, validUntil: Math.max(...observations.map((item) => item.validUntil)) } : null;
}
export function applyJourneyRouteOpportunityPreference(itineraries, { enabled = false, now = Date.now() } = {}) {
  const entries = (Array.isArray(itineraries) ? itineraries : []).map((itinerary) => ({ itinerary, observed: (itinerary?.legs ?? []).some((leg) => usableRouteOpportunity(leg?.routeDivisionOpportunity, { now })) }));
  const ordered = enabled ? [...entries.filter((entry) => entry.observed), ...entries.filter((entry) => !entry.observed)] : entries;
  return { itineraries: ordered.map((entry) => entry.itinerary), matched: entries.filter((entry) => entry.observed).length, preferenceApplied: Boolean(enabled) && entries.some((entry) => entry.observed) };
}
