'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Itinerary, Leg } from './types';

/**
 * Keeping a set of planned journeys' trip-update predictions current.
 *
 * A plan response is a photograph: it is accurate the moment it arrives and
 * says nothing about a delay that starts ten minutes later. This polls
 * `POST /api/journeys/live` for exactly the legs still worth checking --
 * nothing that has not started within the next three hours, nothing that
 * ended more than half an hour ago -- and only while the tab is actually
 * visible, so a backgrounded tab does not spend a rider's data on a screen
 * nobody is reading.
 */

const POLL_MS = 30_000;
const BACKOFF_STEPS_MS = [30_000, 60_000, 120_000];
const TRACKING_HORIZON_MS = 3 * 60 * 60 * 1000; // do not yet poll a leg starting more than 3 h out
const TRACKING_GRACE_MS = 30 * 60 * 1000; // stop polling a leg once it ended more than 30 min ago
const MAX_LEGS_PER_REQUEST = 40;
const FETCH_DEADLINE_MS = 17_000;

export type LiveJourneyStopTime = { scheduledTime?: string; estimatedTime?: string; delaySeconds?: number };

export type LiveJourneyStop = {
  stopId?: string;
  arrival?: LiveJourneyStopTime;
  departure?: LiveJourneyStopTime;
};

/** One leg's refreshed shape, as `POST /api/journeys/live` reports it. */
export type LiveJourneyLeg = {
  legId: string;
  realtimeState?: string;
  startTime?: string;
  endTime?: string;
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  departureDelaySeconds?: number;
  arrivalDelaySeconds?: number;
  intermediateStops?: LiveJourneyStop[];
  source?: string;
  error?: string;
  checkedAt?: number;
};

export type UseLiveJourneysOptions = {
  /** Polling runs only while this is true; false tears any live state back down. */
  enabled?: boolean;
  /** The instant used to decide which legs are still worth checking. Defaults to `Date.now()`. */
  now?: number;
};

export type UseLiveJourneysResult = {
  live: Map<string, LiveJourneyLeg>;
  checkedAt: number | null;
  failed: boolean;
  refreshNow: () => void;
};

type TrackableLeg = { legId: string; tripId?: string; serviceDate?: string; fromStopId?: string; toStopId?: string };

const toInstant = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Every transit leg still worth polling: it has a live-lookup identity, and it has not clearly finished. */
export function trackableLegs(journeys: Itinerary[], now: number): TrackableLeg[] {
  const seen = new Set<string>();
  const legs: TrackableLeg[] = [];
  for (const journey of journeys) {
    for (const leg of journey.legs) {
      if (leg.mode === 'WALK' || !leg.legId || seen.has(leg.legId)) continue;
      const start = toInstant(leg.startTime);
      const end = toInstant(leg.endTime);
      if (start !== null && start - now > TRACKING_HORIZON_MS) continue;
      if (end !== null && now - end > TRACKING_GRACE_MS) continue;
      seen.add(leg.legId);
      legs.push({
        legId: leg.legId,
        ...(leg.tripId ? { tripId: leg.tripId } : {}),
        ...(leg.serviceDate ? { serviceDate: leg.serviceDate } : {}),
        ...(leg.from?.stopId ? { fromStopId: leg.from.stopId } : {}),
        ...(leg.to?.stopId ? { toStopId: leg.to.stopId } : {}),
      });
      if (legs.length >= MAX_LEGS_PER_REQUEST) return legs;
    }
  }
  return legs;
}

/**
 * Polls the live status of every trackable transit leg across a set of
 * planned journeys.
 *
 * Every ref here is read only inside an effect or a callback, never during
 * render: the tracked-leg list changes on nearly every render (a fresh `now`
 * moves the tracking window), and restarting the whole poll loop each time
 * would reset its backoff and its next-tick timer for no reason. So the loop
 * itself keys off a stable string of leg ids, and reads the fuller per-leg
 * detail it needs through a ref that a separate effect keeps current.
 */
export function useLiveJourneys(journeys: Itinerary[], options: UseLiveJourneysOptions = {}): UseLiveJourneysResult {
  const enabled = options.enabled ?? true;
  const now = options.now ?? Date.now();

  const [live, setLive] = useState<Map<string, LiveJourneyLeg>>(() => new Map());
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);

  const trackable = useMemo(() => trackableLegs(journeys, now), [journeys, now]);
  const trackableKey = JSON.stringify(trackable);

  const trackableRef = useRef(trackable);
  useEffect(() => {
    trackableRef.current = trackable;
  }, [trackable]);

  const refreshNow = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!enabled || !trackableKey) {
      setLive(new Map());
      setCheckedAt(null);
      setFailed(false);
      return;
    }

    let disposed = false;
    let timer: number | null = null;
    let abort: AbortController | null = null;
    let backoffIndex = 0;
    setLive(new Map());
    setCheckedAt(null);

    const schedule = (delay: number) => {
      if (disposed) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void run(), delay);
    };

    const run = async () => {
      if (disposed) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        schedule(POLL_MS);
        return;
      }
      const legs = trackableRef.current;
      if (!legs.length) {
        schedule(POLL_MS);
        return;
      }
      abort?.abort();
      const controller = new AbortController();
      abort = controller;
      const timeout = window.setTimeout(() => controller.abort(), FETCH_DEADLINE_MS);
      try {
        const response = await fetch('/api/journeys/live', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            legs: legs.map(({ legId, tripId, serviceDate, fromStopId, toStopId }) => ({
              legId,
              ...(tripId ? { tripId } : {}),
              ...(serviceDate ? { serviceDate } : {}),
              ...(fromStopId ? { fromStopId } : {}),
              ...(toStopId ? { toStopId } : {}),
            })),
          }),
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('live journeys request failed');
        const payload = (await response.json()) as { checkedAt?: string; legs?: LiveJourneyLeg[] };
        if (disposed || abort !== controller) return;
        if (!Array.isArray(payload.legs)) throw new Error('Invalid live response');
        const checked = toInstant(payload.checkedAt);
        if (checked === null || checked > Date.now() + 60_000) throw new Error('Invalid live timestamp');
        const requested = new Set(legs.map(leg => leg.legId));
        const valid = payload.legs.filter(leg => leg && requested.has(leg.legId) && !leg.error && leg.startTime && leg.endTime);
        setLive(previous => {
          const next = new Map(previous);
          for (const leg of valid) next.set(leg.legId, { ...leg, checkedAt: checked });
          return next;
        });
        if (valid.length) setCheckedAt(checked);
        setFailed(valid.length < legs.length);
        backoffIndex = 0;
        schedule(POLL_MS);
      } catch (cause) {
        if (disposed || abort !== controller) return;
        setFailed(true);
        const delay = BACKOFF_STEPS_MS[Math.min(backoffIndex, BACKOFF_STEPS_MS.length - 1)];
        backoffIndex = Math.min(backoffIndex + 1, BACKOFF_STEPS_MS.length - 1);
        schedule(delay);
      } finally {
        window.clearTimeout(timeout);
        if (abort === controller) abort = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') { abort?.abort(); return; }
      if (timer !== null) window.clearTimeout(timer);
      void run();
    };
    document.addEventListener('visibilitychange', onVisibility);
    void run();

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer !== null) window.clearTimeout(timer);
      abort?.abort();
    };
  }, [enabled, trackableKey, nonce]);

  return { live, checkedAt, failed, refreshNow };
}

const timeDiffers = (a: string | undefined, b: string | undefined): boolean => {
  if (!a || !b) return false;
  const first = Date.parse(a);
  const second = Date.parse(b);
  return Number.isFinite(first) && Number.isFinite(second) && first !== second;
};

/**
 * OTP marks a leg `SCHEDULED` when no real-time data has been applied to it --
 * the opposite of every other value it uses (`UPDATED`, `CANCELED`, `ADDED`,
 * `MODIFIED`). A freshly polled leg only counts as live when it says more than
 * that, or when it actually published a delay figure.
 */
function isLivePayload(payload: LiveJourneyLeg): boolean {
  if (payload.realtimeState && payload.realtimeState !== 'SCHEDULED') return true;
  return !payload.realtimeState && (typeof payload.departureDelaySeconds === 'number' || typeof payload.arrivalDelaySeconds === 'number');
}

function mergeIntermediateStops(leg: Leg, payload: LiveJourneyLeg): Leg['intermediateStops'] {
  if (!leg.intermediateStops?.length || !payload.intermediateStops?.length) return leg.intermediateStops;
  return leg.intermediateStops.map((stop) => {
    const update = stop.stopId ? payload.intermediateStops?.find((candidate) => candidate.stopId === stop.stopId) : undefined;
    if (!update) return stop;
    return {
      ...stop,
      ...(update.arrival ? { arrival: update.arrival } : {}),
      ...(update.departure ? { departure: update.departure } : {}),
    };
  });
}

/**
 * Applies a polled live-leg map onto scheduled itineraries.
 *
 * Never mutates `journeys` or anything inside it: a journey without a live
 * update for any of its legs comes back as the exact same reference, so a
 * caller that only re-renders on a changed itinerary does not re-render every
 * unaffected card on every poll.
 */
export function mergeLiveIntoJourneys(journeys: Itinerary[], live: Map<string, LiveJourneyLeg>): Itinerary[] {
  if (!live.size) return journeys;
  return journeys.map((journey) => {
    let changed = false;
    const legs = journey.legs.map((leg) => {
      const payload = leg.legId ? live.get(leg.legId) : undefined;
      if (!payload || payload.error) return leg;
      changed = true;
      return {
        ...leg,
        ...(payload.startTime ? { startTime: payload.startTime } : {}),
        ...(payload.endTime ? { endTime: payload.endTime } : {}),
        ...(payload.scheduledStartTime ? { scheduledStartTime: payload.scheduledStartTime } : {}),
        ...(payload.scheduledEndTime ? { scheduledEndTime: payload.scheduledEndTime } : {}),
        realtimeState: payload.realtimeState as Leg['realtimeState'],
        departureDelaySeconds: payload.departureDelaySeconds,
        arrivalDelaySeconds: payload.arrivalDelaySeconds,
        liveCheckedAt: payload.checkedAt,
        realtime: isLivePayload(payload),
        intermediateStops: mergeIntermediateStops(leg, payload),
      };
    });
    const startTime = legs[0]?.startTime ?? journey.startTime;
    const endTime = legs[legs.length - 1]?.endTime ?? journey.endTime;
    const start = toInstant(startTime), end = toInstant(endTime);
    return changed ? { ...journey, legs, startTime, endTime, duration: start !== null && end !== null ? Math.max(0, (end - start) / 1000) : journey.duration } : journey;
  });
}

/** Exported for callers that want to know a leg's live/scheduled times actually differ, without duplicating the parse. */
export { timeDiffers };
