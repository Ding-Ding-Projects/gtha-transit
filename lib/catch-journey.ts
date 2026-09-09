import type { Itinerary } from './types';

export function catchJourney(option: { journey?: Itinerary; walk?: Itinerary }): Itinerary | null {
  const journey = option.journey ?? option.walk;
  return journey && Array.isArray(journey.legs) && journey.legs.length > 0
    && Number.isFinite(journey.duration) && journey.duration >= 0 ? journey : null;
}

/** A transit departure cannot be replaced by a duration measured from now. */
export function canStartCatch(journey: Itinerary | null, arriveByAt: string, now: number): boolean {
  if (!journey || !Number.isFinite(now)) return false;
  const deadline = Date.parse(arriveByAt);
  const departure = new Date(journey.startTime).getTime();
  const arrival = new Date(journey.endTime).getTime();
  if (![deadline, departure, arrival].every(Number.isFinite) || arrival > deadline || now >= deadline) return false;
  return journey.legs.every(leg => leg.mode === 'WALK')
    ? now + journey.duration * 1000 <= deadline
    : now <= departure;
}
