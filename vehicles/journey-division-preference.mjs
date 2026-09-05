const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' });
export function isCurrentDivisionEvidence(evidence, { now = Date.now() } = {}) {
  if (!evidence || !['out-of-division', 'in-division'].includes(evidence.state) || !Number.isFinite(evidence.checkedAt) || !Number.isFinite(evidence.validUntil) || now < evidence.checkedAt || now > evidence.validUntil) return false;
  const parts = Object.fromEntries(dateFormat.formatToParts(new Date(now)).map(part => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return typeof evidence.source?.validFrom === 'string' && typeof evidence.source?.validThrough === 'string' && date >= evidence.source.validFrom && date <= evidence.source.validThrough;
}

/** Stable soft preference that moves only itineraries with current verified out-of-division evidence. */
export function applyJourneyDivisionPreference(itineraries, options = {}) {
  const enabled = Boolean(options.enabled);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const list = Array.isArray(itineraries) ? itineraries : [];
  const entries = list.map((itinerary, index) => {
    const divisions = Array.isArray(itinerary?.legs) ? itinerary.legs.map((leg) => leg?.vehicleDivision).filter(Boolean) : [];
    const verifiedOut = divisions.some((division) => division.state === 'out-of-division' && isCurrentDivisionEvidence(division, { now }));
    const unknownReasons = divisions.flatMap((division) => division.state === 'unknown' ? [division.reason] : ['out-of-division', 'in-division'].includes(division.state) && !isCurrentDivisionEvidence(division, { now }) ? ['division-evidence-expired'] : []);
    return { itinerary, index, verifiedOut, unknownReasons };
  });
  const reasons = {};
  for (const entry of entries) for (const reason of entry.unknownReasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
  const matched = entries.filter((entry) => entry.verifiedOut).length;
  const unknownCount = entries.filter((entry) => entry.unknownReasons.length > 0).length;
  const ordered = enabled ? [...entries.filter((entry) => entry.verifiedOut), ...entries.filter((entry) => !entry.verifiedOut)] : entries;
  return { itineraries: ordered.map((entry) => entry.itinerary), options: { ...options, enabled }, matched, unknown: unknownCount, reasons, preferenceApplied: enabled && matched > 0 };
}
