import type { Itinerary, Leg, Place } from './types';

/**
 * Minutes to the stops still ahead, and an answer to "are we there yet".
 *
 * Every minute here comes from a time the publisher supplied: the leg's own
 * boarding and alighting times, and the scheduled or estimated stop times the
 * routing service returns for each intermediate stop. A stop with no published
 * time is listed with none. Nothing is interpolated between two stops, because a
 * made-up arrival is worse than an honest gap.
 */

export type PublishedStopTime = {
  scheduledTime?: string;
  estimatedTime?: string;
  delaySeconds?: number;
};

export type UpcomingStop = {
  name: string;
  /** Position in the leg, boarding stop first. */
  index: number;
  /** The instant this stop is expected, when the publisher gave one. */
  at: string | null;
  /** Whether that instant is the timetable's or a live estimate. */
  basis: 'estimated' | 'scheduled' | 'none';
  /** Whole minutes from now. Negative once the time has passed. */
  minutesAway: number | null;
  /** The last stop of this leg, where the rider gets off. */
  destination: boolean;
  /** How far the live estimate ran from the timetable, when the basis is 'estimated'. */
  delaySeconds?: number;
};

export type ArrivalAnswer = {
  answer: 'yes' | 'nearly' | 'not-yet' | 'unknown';
  stopsRemaining: number | null;
  minutesAway: number | null;
  destinationName: string | null;
};

const NEARLY_METRES = 250;
const NEARLY_MINUTES = 2;

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

function instant(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Prefer a live estimate over the timetable, exactly as the publisher labelled it. */
export function publishedTime(time: PublishedStopTime | undefined | null): {
  at: string | null;
  basis: 'estimated' | 'scheduled' | 'none';
  delaySeconds?: number;
} {
  const estimated = text(time?.estimatedTime);
  if (estimated) return { at: estimated, basis: 'estimated', ...(typeof time?.delaySeconds === 'number' ? { delaySeconds: time.delaySeconds } : {}) };
  const scheduled = text(time?.scheduledTime);
  if (scheduled) return { at: scheduled, basis: 'scheduled' };
  return { at: null, basis: 'none' };
}

type StopLike = Place & { arrival?: PublishedStopTime; departure?: PublishedStopTime };

/**
 * Whether a leg's own boarding or alighting instant is the timetable's or a
 * live estimate.
 *
 * The instant itself (`leg.startTime`/`leg.endTime`) already prefers a live
 * estimate over the schedule -- that is what the routing service hands back.
 * What was missing was the label: it was hard-coded to `'scheduled'`
 * regardless, so a departure running four minutes late still read as the
 * timetable. A leg only earns `'estimated'` when the publisher actually marked
 * it live and that live instant differs from what was scheduled; an on-time
 * live leg and an unmarked leg both keep reading as the timetable, which is
 * what they are.
 */
function edgeBasis(leg: Leg, scheduled: string | null | undefined, at: string | null): 'estimated' | 'scheduled' | 'none' {
  if (!at) return 'none';
  if (!leg.realtime) return 'scheduled';
  const scheduledInstant = instant(text(scheduled ?? null));
  const actualInstant = instant(at);
  return scheduledInstant !== null && actualInstant !== null && scheduledInstant !== actualInstant
    ? 'estimated'
    : 'scheduled';
}

/** Every stop of one transit leg in order, boarding through alighting. */
export function legStops(leg: Leg): { place: StopLike; at: string | null; basis: 'estimated' | 'scheduled' | 'none'; delaySeconds?: number }[] {
  const boardingAt = text(typeof leg.startTime === 'string' ? leg.startTime : null);
  const alightingAt = text(typeof leg.endTime === 'string' ? leg.endTime : null);
  const middle = (leg.intermediateStops || []) as StopLike[];
  const boardingBasis = edgeBasis(leg, leg.scheduledStartTime, boardingAt);
  const alightingBasis = edgeBasis(leg, leg.scheduledEndTime, alightingAt);
  return [
    {
      place: leg.from as StopLike,
      at: boardingAt,
      basis: boardingBasis,
      ...(boardingBasis === 'estimated' && typeof leg.departureDelaySeconds === 'number' ? { delaySeconds: leg.departureDelaySeconds } : {}),
    },
    ...middle.map((stop) => {
      const time = publishedTime(stop.arrival ?? stop.departure);
      return { place: stop, at: time.at, basis: time.basis, ...(typeof time.delaySeconds === 'number' ? { delaySeconds: time.delaySeconds } : {}) };
    }),
    {
      place: leg.to as StopLike,
      at: alightingAt,
      basis: alightingBasis,
      ...(alightingBasis === 'estimated' && typeof leg.arrivalDelaySeconds === 'number' ? { delaySeconds: leg.arrivalDelaySeconds } : {}),
    },
  ];
}

/**
 * The stops still ahead on this leg, with whole minutes from now.
 *
 * `currentIndex` is the stop the rider is approaching. Anything before it has
 * been passed and is left out.
 */
export function upcomingStops(options: {
  leg: Leg | null | undefined;
  currentIndex?: number;
  now?: number;
  limit?: number;
}): UpcomingStop[] {
  const { leg } = options;
  if (!leg || leg.mode === 'WALK') return [];
  const now = options.now ?? Date.now();
  const stops = legStops(leg);
  if (!stops.length) return [];
  const from = Math.max(0, Math.min(options.currentIndex ?? 0, stops.length - 1));
  const limit = options.limit ?? stops.length;
  const lastIndex = stops.length - 1;
  return stops.slice(from, from + limit).map((stop, offset) => {
    const index = from + offset;
    const at = instant(stop.at);
    return {
      name: stop.place?.name || '',
      index,
      at: stop.at,
      basis: stop.basis,
      minutesAway: at === null ? null : Math.round((at - now) / 60000),
      destination: index === lastIndex,
      ...(typeof stop.delaySeconds === 'number' ? { delaySeconds: stop.delaySeconds } : {}),
    };
  });
}

/**
 * Answer "are we there yet" from what is actually known.
 *
 * A measured distance to the alighting stop settles it outright. Otherwise the
 * count of stops still ahead and the published time answer it, and when neither
 * exists the answer is that it cannot be told.
 */
export function areWeThereYet(options: {
  leg: Leg | null | undefined;
  currentIndex?: number;
  now?: number;
  metresToDestination?: number | null;
}): ArrivalAnswer {
  const { leg } = options;
  const empty: ArrivalAnswer = { answer: 'unknown', stopsRemaining: null, minutesAway: null, destinationName: null };
  if (!leg || leg.mode === 'WALK') return empty;
  const stops = legStops(leg);
  if (stops.length < 2) return empty;
  const destination = stops[stops.length - 1];
  const destinationName = destination.place?.name || null;
  const now = options.now ?? Date.now();
  const at = instant(destination.at);
  const minutesAway = at === null ? null : Math.round((at - now) / 60000);
  const metres = typeof options.metresToDestination === 'number' && Number.isFinite(options.metresToDestination)
    ? options.metresToDestination
    : null;

  if (metres !== null && metres <= NEARLY_METRES) {
    return { answer: 'yes', stopsRemaining: 0, minutesAway, destinationName };
  }
  const currentIndex = options.currentIndex;
  const stopsRemaining = typeof currentIndex === 'number'
    ? Math.max(0, stops.length - 1 - Math.min(currentIndex, stops.length - 1))
    : null;
  if (stopsRemaining === 0) {
    return { answer: 'yes', stopsRemaining, minutesAway, destinationName };
  }
  if (stopsRemaining === null && minutesAway === null) return { ...empty, destinationName };
  const nearlyByTime = minutesAway !== null && minutesAway <= NEARLY_MINUTES;
  const nearlyByStops = stopsRemaining !== null && stopsRemaining === 1;
  if (nearlyByTime || nearlyByStops) {
    return { answer: 'nearly', stopsRemaining, minutesAway, destinationName };
  }
  return { answer: 'not-yet', stopsRemaining, minutesAway, destinationName };
}

/** Choose the transit leg a follower is currently riding. */
export function currentLeg(itinerary: Itinerary | null | undefined, now = Date.now()): Leg | null {
  const legs = (itinerary?.legs || []).filter((leg) => leg.mode !== 'WALK');
  if (!legs.length) return null;
  for (const leg of legs) {
    const start = instant(typeof leg.startTime === 'string' ? leg.startTime : null);
    const end = instant(typeof leg.endTime === 'string' ? leg.endTime : null);
    if (start !== null && end !== null && now >= start && now <= end) return leg;
  }
  const upcoming = legs
    .map((leg) => ({ leg, start: instant(typeof leg.startTime === 'string' ? leg.startTime : null) }))
    .filter((entry) => entry.start !== null && entry.start >= now)
    .sort((left, right) => (left.start as number) - (right.start as number));
  return upcoming.length ? upcoming[0].leg : legs[0];
}
