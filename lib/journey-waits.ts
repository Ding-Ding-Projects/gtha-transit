import type { Itinerary } from './types';

const instant = (value: number | string | null | undefined) => {
  if (value == null) return NaN;
  return typeof value === 'number'
    ? value < 1e12
      ? value * 1000
      : value
    : Date.parse(value);
};

export function journeyWaits(
  journey: Itinerary,
  departure: string | null = null,
) {
  let ready = instant(departure);
  let boarded = false;
  const waits: {
    legIndex: number;
    seconds: number | null;
    transfer: boolean;
  }[] = [];
  for (const [legIndex, leg] of journey.legs.entries()) {
    if (leg.mode === 'WALK') {
      ready =
        Number.isFinite(leg.duration) && leg.duration >= 0
          ? ready + leg.duration * 1000
          : NaN;
      continue;
    }
    const start = instant(leg.startTime);
    waits.push({
      legIndex,
      seconds:
        Number.isFinite(start) && Number.isFinite(ready) && start >= ready
          ? (start - ready) / 1000
          : null,
      transfer: boarded,
    });
    ready = instant(leg.endTime);
    boarded = true;
  }
  const first = waits[0];
  const end = instant(journey.endTime),
    requested = instant(departure);
  return {
    waits,
    firstBoarding: first ? journey.legs[first.legIndex].startTime : null,
    firstWaitSeconds: first?.seconds ?? null,
    transferWaitSeconds: waits.slice(1).every((wait) => wait.seconds !== null)
      ? waits.slice(1).reduce((sum, wait) => sum + wait.seconds!, 0)
      : null,
    elapsedSeconds:
      Number.isFinite(end) && Number.isFinite(requested) && end >= requested
        ? (end - requested) / 1000
        : null,
  };
}
