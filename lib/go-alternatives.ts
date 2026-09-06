/**
 * The alternatives a GO cancellation names.
 *
 * When Metrolinx cancels a train, the alert itself lists the trains a rider can
 * take instead, in a fixed published form:
 *
 *   Train cancelled - Aurora GO 16:55 - Union Station 17:46
 *   By GO train: Aurora GO 15:55 - Union Station 16:46
 *
 * Those lines are the publisher's own words and are kept verbatim. What this
 * module adds is the structure needed to plan one: an origin, a destination and
 * a Toronto departure time, so the journey the alert describes can be looked up
 * in the real timetable instead of only read.
 *
 * Nothing is inferred from a line that does not match the published form. An
 * unrecognised line stays as text with no plan offered, because a half-parsed
 * station name would send a rider to the wrong platform.
 *
 * Turning a Toronto wall time into an instant is the planner's own job and is
 * passed in, so the daylight-saving rules have exactly one owner rather than a
 * second copy here that could quietly disagree with it.
 */

/** Resolve `YYYY-MM-DDTHH:MM` in Toronto to an ISO instant, or throw. */
export type TorontoResolver = (localValue: string) => string;

export type GoJourney = {
  /** The publisher's exact line, kept for display. */
  text: string;
  mode: string;
  from: string;
  to: string;
  /** Toronto wall-clock times exactly as published. */
  departs: string;
  arrives: string;
  /** Resolved instants, present only when a service date could be established. */
  departsAt?: string;
  arrivesAt?: string;
};

export type GoCancellation = {
  alertId: string;
  title: string;
  cancelled: GoJourney | null;
  alternatives: GoJourney[];
  /** Lines that look like options but do not match the published form. */
  unparsed: string[];
  serviceDate: string | null;
};

const JOURNEY = /^(.+?)\s+(\d{1,2}:\d{2})\s*[-–—]\s*(.+?)\s+(\d{1,2}:\d{2})$/;
const OPTION = /^By\s+([^:]{1,40}):\s*(.+)$/i;
const CANCELLED_TITLE = /^\s*(?:train|trip|bus)\s+cancell?ed\s*[-–—]\s*(.+)$/i;
const OPTIONS_HEADING = /consider the following/i;
const MAX_ALTERNATIVES = 8;

const tidy = (value: unknown): string => (typeof value === 'string' ? value : '').replace(/\s+/g, ' ').trim();

/** A published `HH:MM` in 24-hour form, or null. */
function wallTime(value: string): string | null {
  const parts = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!parts) return null;
  const hours = Number(parts[1]);
  const minutes = Number(parts[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${parts[2]}`;
}

/** Split `Origin HH:MM - Destination HH:MM` into its four published parts. */
export function parseJourneyText(text: string, mode = 'GO train'): GoJourney | null {
  const line = tidy(text);
  const match = JOURNEY.exec(line);
  if (!match) return null;
  const from = tidy(match[1]);
  const to = tidy(match[3]);
  const departs = wallTime(match[2]);
  const arrives = wallTime(match[4]);
  if (!from || !to || !departs || !arrives) return null;
  return { text: line, mode: tidy(mode) || 'GO train', from, to, departs, arrives };
}

/** The Toronto calendar day an alert's times belong to, as `YYYY-MM-DD`. */
export function serviceDateOf(alert: { activeFrom?: string; updatedAt?: string }): string | null {
  const stamp = alert?.activeFrom || alert?.updatedAt;
  const at = stamp ? Date.parse(stamp) : Number.NaN;
  if (!Number.isFinite(at)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return year && month && day ? `${year}-${month}-${day}` : null;
}

/**
 * Put a published wall time on a service date.
 *
 * An arrival earlier than its departure has crossed midnight, so it belongs to
 * the next day. Nothing else is adjusted: a time the operator published is the
 * time the operator published.
 */
export function resolveTimes(journey: GoJourney, serviceDate: string | null, toIso?: TorontoResolver): GoJourney {
  if (!serviceDate || !toIso) return journey;
  try {
    const departsAt = toIso(`${serviceDate}T${journey.departs}`);
    const sameDay = toIso(`${serviceDate}T${journey.arrives}`);
    const arrivesAt = Date.parse(sameDay) >= Date.parse(departsAt)
      ? sameDay
      : new Date(Date.parse(sameDay) + 86_400_000).toISOString();
    return { ...journey, departsAt, arrivesAt };
  } catch {
    // A time that does not exist on that date - the spring clock change - is left
    // unresolved rather than moved to a time the operator never published.
    return journey;
  }
}

/**
 * Read a cancellation alert into the journey it cancels and the ones it offers.
 *
 * Returns null when the alert is not a cancellation with named options, so an
 * ordinary service alert is never dressed up as one.
 */
export function parseCancellation(alert: {
  id?: string; title?: string; description?: string; activeFrom?: string; updatedAt?: string;
}, toIso?: TorontoResolver): GoCancellation | null {
  const title = tidy(alert?.title);
  const titleMatch = CANCELLED_TITLE.exec(title);
  if (!titleMatch) return null;
  const serviceDate = serviceDateOf(alert);
  const cancelled = parseJourneyText(titleMatch[1]);
  const lines = String(alert?.description ?? '').split(/\r?\n/).map(tidy).filter(Boolean);
  const headingAt = lines.findIndex((line) => OPTIONS_HEADING.test(line));
  const alternatives: GoJourney[] = [];
  const unparsed: string[] = [];
  const seen = new Set<string>();
  for (const line of headingAt >= 0 ? lines.slice(headingAt + 1) : lines) {
    const option = OPTION.exec(line);
    if (!option) continue;
    if (alternatives.length >= MAX_ALTERNATIVES) break;
    const journey = parseJourneyText(option[2], option[1]);
    if (!journey) { if (unparsed.length < MAX_ALTERNATIVES) unparsed.push(line); continue; }
    const key = `${journey.from}|${journey.departs}|${journey.to}|${journey.arrives}`;
    if (seen.has(key)) continue;
    seen.add(key);
    alternatives.push(resolveTimes(journey, serviceDate, toIso));
  }
  if (!alternatives.length && !unparsed.length) return null;
  return {
    alertId: tidy(alert?.id),
    title,
    cancelled: cancelled ? resolveTimes(cancelled, serviceDate, toIso) : null,
    alternatives,
    unparsed,
    serviceDate,
  };
}

/** Every cancellation in a set of alerts, newest first as published. */
export function cancellationsFrom(alerts: Parameters<typeof parseCancellation>[0][], toIso?: TorontoResolver): GoCancellation[] {
  return (alerts || []).map((alert) => parseCancellation(alert, toIso)).filter((entry): entry is GoCancellation => entry !== null);
}
