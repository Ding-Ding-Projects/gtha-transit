const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' });

const torontoDate = (now) => {
  const parts = Object.fromEntries(dateFormat.formatToParts(new Date(now)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

/**
 * Can this division evidence still be used to order journeys?
 *
 * Two different clocks decide it, and only one of them is about the operator.
 *
 * The observation has to be fresh: a vehicle seen four minutes ago is not where
 * it was. That is `checkedAt`/`validUntil`, and it expires quickly by design.
 *
 * The allocation summary is the other, and it used to be read as a window with
 * two closed ends, which meant that the moment a board period ended this went
 * silent: the ordering stopped moving anything and the "Verified out of
 * division" badge disappeared, on the same data the vehicle tracker was still
 * happily showing with a dated caveat. Two surfaces disagreeing about the same
 * fact, and neither saying so.
 *
 * Only the near end is a real boundary now. A summary whose period has not
 * started cannot say anything about today, so it is refused: that would be a
 * claim about the future. A summary whose period has ended is the last
 * allocation the operator published, and a route's garage outlives a board
 * period far better than a vehicle's does, so it keeps answering. Which of the
 * two it is travels with the answer as `sourceCoverage`, and the surface that
 * renders it has to say so.
 */
export function isUsableDivisionEvidence(evidence, { now = Date.now() } = {}) {
  if (!evidence || !['out-of-division', 'in-division'].includes(evidence.state) || !Number.isFinite(evidence.checkedAt) || !Number.isFinite(evidence.validUntil) || now < evidence.checkedAt || now > evidence.validUntil) return false;
  if (typeof evidence.source?.validFrom !== 'string' || typeof evidence.source?.validThrough !== 'string') return false;
  return torontoDate(now) >= evidence.source.validFrom;
}

/** Whether the summary behind this evidence covers today, or is the last one published. */
export function divisionEvidenceCoverage(evidence, { now = Date.now() } = {}) {
  const from = evidence?.source?.validFrom;
  const through = evidence?.source?.validThrough;
  if (typeof from !== 'string' || typeof through !== 'string') return null;
  const date = torontoDate(now);
  if (date < from) return 'not-yet-in-effect';
  if (date > through) return 'last-published';
  return 'current';
}

/** Stable soft preference that moves only itineraries with usable verified out-of-division evidence. */
export function applyJourneyDivisionPreference(itineraries, options = {}) {
  const enabled = Boolean(options.enabled);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const list = Array.isArray(itineraries) ? itineraries : [];
  const entries = list.map((itinerary, index) => {
    const divisions = Array.isArray(itinerary?.legs) ? itinerary.legs.map((leg) => leg?.vehicleDivision).filter(Boolean) : [];
    const verifiedOut = divisions.some((division) => division.state === 'out-of-division' && isUsableDivisionEvidence(division, { now }));
    /* Why an itinerary was not moved, separated by which clock ran out. A summary
       that has not started yet is a different problem from an observation that has
       gone stale, and reporting both as "expired" hid the first one entirely. */
    const unknownReasons = divisions.flatMap((division) => {
      if (division.state === 'unknown') return [division.reason];
      if (!['out-of-division', 'in-division'].includes(division.state)) return [];
      if (isUsableDivisionEvidence(division, { now })) return [];
      return divisionEvidenceCoverage(division, { now }) === 'not-yet-in-effect'
        ? ['division-source-not-yet-in-effect']
        : ['division-evidence-expired'];
    });
    return { itinerary, index, verifiedOut, unknownReasons };
  });
  const reasons = {};
  for (const entry of entries) for (const reason of entry.unknownReasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
  const matched = entries.filter((entry) => entry.verifiedOut).length;
  const unknownCount = entries.filter((entry) => entry.unknownReasons.length > 0).length;
  const ordered = enabled ? [...entries.filter((entry) => entry.verifiedOut), ...entries.filter((entry) => !entry.verifiedOut)] : entries;
  return { itineraries: ordered.map((entry) => entry.itinerary), options: { ...options, enabled }, matched, unknown: unknownCount, reasons, preferenceApplied: enabled && matched > 0 };
}
