/**
 * Turning OpenTripPlanner's raw real-time fields into one small state a rider
 * can actually read.
 *
 * Every classification here traces back to something the routing backend or
 * the live-coverage endpoint actually published: a signed delay, a realtime
 * status word, or a feed's own admission that it cannot join its updates to
 * this trip. Nothing is guessed - a leg the backend cannot vouch for reads as
 * "timetable only" or "not matched", never as a made-up on-time.
 */

export type LiveState =
  | 'early'
  | 'on-time'
  | 'late'
  | 'cancelled'
  | 'scheduled-only'
  | 'live-unmatched'
  | 'stale'
  | 'unknown';

/** Where a reported time or delay actually came from. */
export type LiveBasis = 'estimated' | 'scheduled' | 'none';

export type LiveLegStatus = {
  state: LiveState;
  delaySeconds: number | null;
  delayMinutes: number | null;
  basis: LiveBasis;
  /** When this classification's live data was checked, as epoch milliseconds. */
  checkedAt: number | null;
  source: 'plan' | 'leg-refetch' | 'trip-stoptimes';
  /** Only present when `state` is `'late'`. */
  tier?: 'late' | 'very-late';
};

/** The shape `GET /api/live-coverage` returns, keyed by agency feed id. */
export type FeedLiveCoverage = {
  feeds: Record<string, { state: 'applied' | 'published-unjoinable' | 'none' | 'shadow'; reason?: string }>;
  checkedAt?: string;
};

/**
 * A vehicle logged more than a minute ahead of its timetable stop counts as
 * running early: a rider who trusted the printed schedule and arrived on
 * time for it would already have missed it. Smaller negative numbers than
 * this are GPS and dwell-time noise, not a genuinely early trip.
 */
export const EARLY_MAX_SECONDS = -60;

/**
 * Three minutes late is where a rider waiting at a stop actually starts to
 * notice and adjust for it; anything short of that is ordinary traffic-light
 * and dwell-time variance the timetable was never precise enough to rule out.
 */
export const LATE_MIN_SECONDS = 180;

/**
 * Five minutes late is late enough to change what a rider does next - catch
 * an earlier connection, start walking - so it gets its own, worse tier
 * rather than reading identically to a three-minute delay.
 */
export const VERY_LATE_MIN_SECONDS = 300;

/**
 * How long a live check is trusted before it is treated as stale. Matches the
 * vehicle feed's own staleness threshold, so a rider sees one consistent
 * definition of "this is too old to act on" across the app.
 */
export const STALE_AFTER_MS = 120_000;

/**
 * Every value `LiveState` can take, ordered the way `summariseJourney`
 * prefers them when a journey's legs disagree - a single source of truth so
 * the two never drift apart.
 */
export const LIVE_STATES: readonly LiveState[] = [
  'cancelled',
  'late',
  'early',
  'stale',
  'live-unmatched',
  'scheduled-only',
  'unknown',
  'on-time',
];

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;
const SECONDS_PER_WEEK = 7 * SECONDS_PER_DAY;
// Nominal lengths only. A real delay duration from OTP never carries a month
// or year component; these exist purely so a well-formed but unexpected ISO
// duration string cannot crash the parser.
const SECONDS_PER_MONTH = 30 * SECONDS_PER_DAY;
const SECONDS_PER_YEAR = 365 * SECONDS_PER_DAY;

const PLAIN_NUMBER_PATTERN = /^[+-]?\d+(?:\.\d+)?$/;

// ISO-8601 duration, e.g. "PT13S", "-PT26S", "PT-1M-30S", "PT1H2M3.5S", "P0D".
// An overall leading sign negates the whole duration; each field may also
// carry its own sign, since that is how OTP's own duration encoder writes a
// negative delay ("PT-1M-30S" rather than "-PT1M30S"). Groups are positional
// rather than named: the project's TypeScript target predates the regex
// named-capture-group syntax, and this parser has no need for it.
const ISO_DURATION_PATTERN =
  /^([+-])?P(?:([+-]?\d+(?:\.\d+)?)Y)?(?:([+-]?\d+(?:\.\d+)?)M)?(?:([+-]?\d+(?:\.\d+)?)W)?(?:([+-]?\d+(?:\.\d+)?)D)?(?:T(?:([+-]?\d+(?:\.\d+)?)H)?(?:([+-]?\d+(?:\.\d+)?)M)?(?:([+-]?\d+(?:\.\d+)?)S)?)?$/;

function fieldSeconds(raw: string | undefined, unitSeconds: number): number {
  if (raw === undefined) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed * unitSeconds : 0;
}

function parseIsoDuration(value: string): number | null {
  const match = ISO_DURATION_PATTERN.exec(value);
  if (!match) return null;
  const [, sign, years, months, weeks, days, hours, minutes, seconds] = match;
  if ([years, months, weeks, days, hours, minutes, seconds].every((field) => field === undefined)) {
    // "P", "PT", or anything else with no actual component is not a duration.
    return null;
  }
  const magnitude =
    fieldSeconds(years, SECONDS_PER_YEAR) +
    fieldSeconds(months, SECONDS_PER_MONTH) +
    fieldSeconds(weeks, SECONDS_PER_WEEK) +
    fieldSeconds(days, SECONDS_PER_DAY) +
    fieldSeconds(hours, SECONDS_PER_HOUR) +
    fieldSeconds(minutes, SECONDS_PER_MINUTE) +
    fieldSeconds(seconds, 1);
  return sign === '-' ? -magnitude : magnitude;
}

/**
 * A signed number of seconds from whatever shape the backend handed us: a
 * finite number as-is, a numeric string, or the ISO-8601 duration string
 * OpenTripPlanner serialises `estimated.delay` as. Anything else - `null`,
 * `undefined`, an object, text that is not a duration - is `null`. Junk is
 * never coerced to zero, because a zero delay is a real, meaningful claim.
 */
export function signedDurationSeconds(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (PLAIN_NUMBER_PATTERN.test(trimmed)) {
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return parseIsoDuration(trimmed);
}

/**
 * Sort a signed delay into the band a rider would call it, using the
 * thresholds above. `null` (nothing published) is `'unknown'`, never a
 * guessed `'on-time'`.
 */
export function classifyDelay(
  delaySeconds: number | null,
): { state: 'early' | 'on-time' | 'late' | 'unknown'; tier?: 'late' | 'very-late' } {
  if (delaySeconds === null || !Number.isFinite(delaySeconds)) return { state: 'unknown' };
  if (delaySeconds <= EARLY_MAX_SECONDS) return { state: 'early' };
  if (delaySeconds < LATE_MIN_SECONDS) return { state: 'on-time' };
  return { state: 'late', tier: delaySeconds >= VERY_LATE_MIN_SECONDS ? 'very-late' : 'late' };
}

/** Whole minutes, keeping the sign. `null` in, `null` out. */
export function delayMinutes(seconds: number | null): number | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  return Math.round(seconds / 60);
}

function toInstant(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // OTP occasionally hands back Unix seconds rather than milliseconds.
    return value < 1e12 ? value * 1000 : value;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function feedCoverageState(
  feedId: string | null | undefined,
  coverage: FeedLiveCoverage | null | undefined,
): 'applied' | 'published-unjoinable' | 'none' | 'shadow' {
  if (!feedId) return 'none';
  const entry = coverage?.feeds?.[feedId];
  return entry?.state ?? 'none';
}

/** The point of a transit leg being classified: where it is boarded, or where it is left. */
export type LegEdge = 'boarding' | 'alighting';

/** The minimal shape of a transit leg `classifyLeg` needs to see. */
export type LegLiveInput = {
  mode?: string;
  agencyFeedId?: string | null;
  realtime?: boolean;
  realtimeState?: string | null;
  departureDelaySeconds?: unknown;
  arrivalDelaySeconds?: unknown;
  startTime?: string | number;
  scheduledStartTime?: string | null;
  endTime?: string | number;
  scheduledEndTime?: string | null;
};

function legEdgeTimes(
  leg: LegLiveInput,
  edge: LegEdge,
): { actual: string | number | null | undefined; scheduled: string | null | undefined; delayField: unknown } {
  return edge === 'alighting'
    ? { actual: leg.endTime, scheduled: leg.scheduledEndTime, delayField: leg.arrivalDelaySeconds }
    : { actual: leg.startTime, scheduled: leg.scheduledStartTime, delayField: leg.departureDelaySeconds };
}

function legHasEdgeTime(leg: LegLiveInput, edge: LegEdge): boolean {
  const { actual, scheduled } = legEdgeTimes(leg, edge);
  return toInstant(actual) !== null || toInstant(scheduled) !== null;
}

/**
 * The delay for one edge of a leg: the backend's own signed-delay field when
 * it published one, otherwise the gap between the leg's actual and scheduled
 * time for that edge, when both parse as instants. `basis` says which of the
 * two happened, so a caller never mistakes a derived number for a published one.
 */
function legEdgeDelay(leg: LegLiveInput, edge: LegEdge): { delaySeconds: number | null; basis: LiveBasis } {
  const { actual, scheduled, delayField } = legEdgeTimes(leg, edge);
  const explicit = signedDurationSeconds(delayField);
  if (explicit !== null) return { delaySeconds: explicit, basis: 'estimated' };
  const actualInstant = toInstant(actual);
  const scheduledInstant = toInstant(scheduled);
  if (actualInstant !== null && scheduledInstant !== null) {
    return { delaySeconds: (actualInstant - scheduledInstant) / 1000, basis: 'estimated' };
  }
  return { delaySeconds: null, basis: actualInstant !== null || scheduledInstant !== null ? 'scheduled' : 'none' };
}

// A realtime feed can flag an added, modified, or otherwise updated trip
// without ever setting the leg's plain `realtime` boolean; either signal
// counts as the feed's update having actually reached this leg.
const REALTIME_APPLIED_STATES = new Set(['UPDATED', 'MODIFIED', 'ADDED']);

export type ClassifyLegOptions = {
  coverage?: FeedLiveCoverage | null;
  now: number;
  checkedAt?: number | null;
  source?: LiveLegStatus['source'];
  edge?: LegEdge;
};

/**
 * One transit leg's live status, settled in the order a rider would want it
 * settled: is this leg even running; do we have anything live for its agency
 * at all; is what we have actually matched to this trip; is the match too old
 * to trust; and only once all of that is answered, is it early, on time, or
 * late.
 */
export function classifyLeg(leg: LegLiveInput, options: ClassifyLegOptions): LiveLegStatus {
  const source = options.source ?? 'plan';
  const checkedAt = options.checkedAt ?? null;
  const edge: LegEdge = options.edge ?? 'boarding';

  if (leg.mode === 'WALK') {
    return { state: 'unknown', delaySeconds: null, delayMinutes: null, basis: 'none', checkedAt, source };
  }
  if (leg.realtimeState === 'CANCELED') {
    return { state: 'cancelled', delaySeconds: null, delayMinutes: null, basis: 'none', checkedAt, source };
  }

  const feedState = feedCoverageState(leg.agencyFeedId, options.coverage);
  if (feedState === 'none') {
    return {
      state: 'scheduled-only',
      delaySeconds: null,
      delayMinutes: null,
      basis: legHasEdgeTime(leg, edge) ? 'scheduled' : 'none',
      checkedAt,
      source,
    };
  }
  if (feedState === 'published-unjoinable' || feedState === 'shadow') {
    return {
      state: 'live-unmatched',
      delaySeconds: null,
      delayMinutes: null,
      basis: legHasEdgeTime(leg, edge) ? 'scheduled' : 'none',
      checkedAt,
      source,
    };
  }
  const appliedToThisLeg =
    leg.realtime === true || (leg.realtimeState != null && REALTIME_APPLIED_STATES.has(leg.realtimeState));
  if (!appliedToThisLeg) {
    return {
      state: 'live-unmatched',
      delaySeconds: null,
      delayMinutes: null,
      basis: legHasEdgeTime(leg, edge) ? 'scheduled' : 'none',
      checkedAt,
      source,
    };
  }

  const { delaySeconds, basis } = legEdgeDelay(leg, edge);
  const stale = checkedAt !== null && Number.isFinite(checkedAt) && options.now - checkedAt > STALE_AFTER_MS;
  const classified = classifyDelay(delaySeconds);
  return {
    state: stale ? 'stale' : classified.state,
    delaySeconds,
    delayMinutes: delayMinutes(delaySeconds),
    basis,
    checkedAt,
    source,
    ...(classified.tier ? { tier: classified.tier } : {}),
  };
}

/** One published stop time, as `Place.arrival` / `Place.departure` carries it. */
export type StopTimeInput = { scheduledTime?: string; estimatedTime?: string; delaySeconds?: unknown };

export type ClassifyStopOptions = {
  now: number;
  checkedAt?: number | null;
  /** Whether the trip this stop belongs to has a live match at all. */
  live: boolean;
  edge?: 'arrival' | 'departure';
};

/**
 * One upcoming stop's live status, for the rider-facing list `upcomingStops`
 * (in `upcoming-stops.ts`) builds from the same scheduled and estimated stop
 * times. Without a live match (`live: false`), only the timetable is honest
 * to show, so the stop reads as `'scheduled-only'` regardless of what its
 * fields contain.
 */
export function classifyStop(
  stop: { arrival?: StopTimeInput; departure?: StopTimeInput },
  options: ClassifyStopOptions,
): LiveLegStatus {
  const checkedAt = options.checkedAt ?? null;
  const edge = options.edge ?? 'arrival';
  const time = edge === 'departure' ? stop.departure : stop.arrival;
  const source: LiveLegStatus['source'] = 'trip-stoptimes';
  const hasAnyTime = Boolean(time?.scheduledTime || time?.estimatedTime);

  if (!options.live) {
    return {
      state: 'scheduled-only',
      delaySeconds: null,
      delayMinutes: null,
      basis: hasAnyTime ? 'scheduled' : 'none',
      checkedAt,
      source,
    };
  }

  let delaySeconds = signedDurationSeconds(time?.delaySeconds);
  if (delaySeconds === null && time?.estimatedTime && time?.scheduledTime) {
    const estimatedInstant = toInstant(time.estimatedTime);
    const scheduledInstant = toInstant(time.scheduledTime);
    if (estimatedInstant !== null && scheduledInstant !== null) {
      delaySeconds = (estimatedInstant - scheduledInstant) / 1000;
    }
  }
  const basis: LiveBasis = delaySeconds !== null ? 'estimated' : hasAnyTime ? 'scheduled' : 'none';
  const stale = checkedAt !== null && Number.isFinite(checkedAt) && options.now - checkedAt > STALE_AFTER_MS;
  const classified = classifyDelay(delaySeconds);
  return {
    state: stale ? 'stale' : classified.state,
    delaySeconds,
    delayMinutes: delayMinutes(delaySeconds),
    basis,
    checkedAt,
    source,
    ...(classified.tier ? { tier: classified.tier } : {}),
  };
}

/**
 * One state and one worst delay for a whole journey, from its legs' own
 * statuses. A single cancelled leg cancels the trip in the rider's eyes no
 * matter how late another leg runs, which is why `cancelled` outranks
 * `late` here rather than the largest delay winning outright.
 */
export function summariseJourney(
  statuses: LiveLegStatus[],
  agencies: (string | null | undefined)[] = [],
): { state: LiveState; worstDelayMinutes: number | null; agencies: string[] } {
  let winner: LiveState = 'unknown';
  for (const state of LIVE_STATES) {
    if (statuses.some((status) => status.state === state)) {
      winner = state;
      break;
    }
  }

  let worstDelayMinutes: number | null = null;
  for (const status of statuses) {
    if (status.state !== winner || status.delayMinutes === null) continue;
    if (worstDelayMinutes === null) {
      worstDelayMinutes = status.delayMinutes;
    } else if (winner === 'early') {
      // Running early is "worse" the further ahead of schedule it is.
      worstDelayMinutes = Math.min(worstDelayMinutes, status.delayMinutes);
    } else {
      worstDelayMinutes = Math.max(worstDelayMinutes, status.delayMinutes);
    }
  }

  const seen = new Set<string>();
  const distinctAgencies: string[] = [];
  for (const agency of agencies) {
    if (!agency || seen.has(agency)) continue;
    seen.add(agency);
    distinctAgencies.push(agency);
  }

  return { state: winner, worstDelayMinutes, agencies: distinctAgencies };
}

/** Rider-facing copy for a state, in English and in Chinese. */
export function describeState(state: LiveState, delayMinutes: number | null): { en: string; zh: string } {
  switch (state) {
    case 'on-time':
      return { en: 'On time', zh: '準時' };
    case 'late': {
      if (delayMinutes === null) return { en: 'Running late', zh: '遲咗' };
      const minutes = Math.abs(delayMinutes);
      return { en: `${minutes} min late`, zh: `遲 ${minutes} 分鐘` };
    }
    case 'early': {
      if (delayMinutes === null) return { en: 'Running early', zh: '早咗' };
      const minutes = Math.abs(delayMinutes);
      return { en: `${minutes} min early`, zh: `早 ${minutes} 分鐘` };
    }
    case 'cancelled':
      return { en: 'Cancelled', zh: '已取消' };
    case 'scheduled-only':
      return { en: 'Timetable only', zh: '只有時間表' };
    case 'live-unmatched':
      return { en: 'Live data not matched to this trip', zh: '即時資料未能對應此班次' };
    case 'stale':
      return { en: 'Last live check is stale', zh: '即時資料已過時' };
    case 'unknown':
    default:
      return { en: 'No time information', zh: '沒有時間資料' };
  }
}

/** A lucide-react icon name for each state, for the UI to render without this module knowing about React. */
export const STATE_ICONS: Record<LiveState, string> = {
  early: 'CircleAlert',
  'on-time': 'CircleCheck',
  late: 'CircleAlert',
  cancelled: 'Ban',
  'scheduled-only': 'Clock',
  'live-unmatched': 'CircleHelp',
  stale: 'History',
  unknown: 'CircleHelp',
};

/** A CSS class suffix for each state, e.g. `live-status--on-time`. */
export const STATE_CLASS: Record<LiveState, string> = {
  early: 'live-status--early',
  'on-time': 'live-status--on-time',
  late: 'live-status--late',
  cancelled: 'live-status--cancelled',
  'scheduled-only': 'live-status--scheduled-only',
  'live-unmatched': 'live-status--live-unmatched',
  stale: 'live-status--stale',
  unknown: 'live-status--unknown',
};
