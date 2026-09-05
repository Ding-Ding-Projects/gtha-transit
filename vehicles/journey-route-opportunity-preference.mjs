const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' });
const torontoDate = (now) => { const parts = Object.fromEntries(formatter.formatToParts(new Date(now)).map((part) => [part.type, part.value])); return `${parts.year}-${parts.month}-${parts.day}`; };
export function currentRouteOpportunity(evidence, { now = Date.now() } = {}) {
  if (!evidence || evidence.state !== 'observed' || !Number.isFinite(evidence.checkedAt) || now < evidence.checkedAt) return null;
  const date = torontoDate(now); if (date < evidence.source?.validFrom || date > evidence.source?.validThrough) return null;
  const observations = (evidence.observations ?? []).filter((item) => Number.isFinite(item.validUntil) && now <= item.validUntil);
  return observations.length ? { ...evidence, observations, vehicleIds: observations.map((item) => item.id), fleetNumbers: observations.map((item) => item.fleetNumber).filter(Boolean), vehicleCount: observations.length, validUntil: Math.max(...observations.map((item) => item.validUntil)) } : null;
}
export function applyJourneyRouteOpportunityPreference(itineraries, { enabled = false, now = Date.now() } = {}) {
  const entries = (Array.isArray(itineraries) ? itineraries : []).map((itinerary) => ({ itinerary, observed: (itinerary?.legs ?? []).some((leg) => currentRouteOpportunity(leg?.routeDivisionOpportunity, { now })) }));
  const ordered = enabled ? [...entries.filter((entry) => entry.observed), ...entries.filter((entry) => !entry.observed)] : entries;
  return { itineraries: ordered.map((entry) => entry.itinerary), matched: entries.filter((entry) => entry.observed).length, preferenceApplied: Boolean(enabled) && entries.some((entry) => entry.observed) };
}
