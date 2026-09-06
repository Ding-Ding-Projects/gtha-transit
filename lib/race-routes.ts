/**
 * Drawing a route for each team.
 *
 * Two rules decide everything here. A team is given a real itinerary the routing
 * engine returned, never a route invented to make the draw come out even. And
 * when there are fewer genuinely different routes than teams, the shortfall is
 * counted and shown rather than hidden behind a repeat that looks deliberate.
 */

import type { Itinerary, Leg } from './types';

export type RaceRoute = {
  id: string;
  signature: string;
  summary: string;
  minutes: number;
  transfers: number;
  itinerary: Itinerary;
};

export type Draw = {
  assignments: { teamId: string; route: RaceRoute }[];
  distinctRoutes: number;
  repeatedTeams: number;
  shortfall: number;
};

const transitLegs = (itinerary: Itinerary): Leg[] =>
  (itinerary.legs || []).filter((leg) => leg.mode !== 'WALK');

/**
 * What makes two itineraries the same journey.
 *
 * The ordered list of lines ridden. Two itineraries a few minutes apart on the
 * same lines are the same route to a racer, so departure time is deliberately
 * not part of this: a draw that handed two teams the same lines and called them
 * distinct would be exactly the silent repeat this is written to prevent.
 */
export function routeSignature(itinerary: Itinerary): string {
  const ridden = transitLegs(itinerary).map((leg) => String(leg.route || leg.agency || leg.mode).toUpperCase());
  return ridden.length ? ridden.join(' > ') : 'WALK';
}

/** The lines ridden, in order, as a rider would say them. */
export function routeSummary(itinerary: Itinerary): string {
  const ridden = transitLegs(itinerary).map((leg) => String(leg.route || leg.mode));
  return ridden.length ? ridden.join(' → ') : 'Walk the whole way';
}

const millis = (value: number | string): number => {
  if (typeof value === 'number') return Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
  return Date.parse(String(value));
};

export function toRaceRoutes(itineraries: Itinerary[]): RaceRoute[] {
  return (itineraries || []).map((itinerary, index) => {
    const start = millis(itinerary.startTime);
    const end = millis(itinerary.endTime);
    const minutes = Number.isFinite(itinerary.duration) && itinerary.duration > 0
      ? Math.round(itinerary.duration / 60)
      : Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 60000) : 0;
    return {
      id: String(itinerary.id ?? index),
      signature: routeSignature(itinerary),
      summary: routeSummary(itinerary),
      minutes,
      transfers: Math.max(0, transitLegs(itinerary).length - 1),
      itinerary,
    };
  });
}

/** Keep the first itinerary for each distinct set of lines, in the order given. */
export function distinctRoutes(routes: RaceRoute[]): RaceRoute[] {
  const seen = new Set<string>();
  const kept: RaceRoute[] = [];
  for (const route of routes) {
    if (seen.has(route.signature)) continue;
    seen.add(route.signature);
    kept.push(route);
  }
  return kept;
}

/** A shuffle whose randomness is supplied, so a draw can be replayed in a test. */
export function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [out[index], out[swap]] = [out[swap], out[index]];
  }
  return out;
}

/**
 * Give every team a route, preferring a different one each time.
 *
 * Distinct routes are dealt first. Only once they run out does a team receive a
 * repeat, and the count of teams that had to share is returned so the interface
 * can say so plainly instead of implying every team got its own.
 */
export function drawRoutes(teamIds: string[], routes: RaceRoute[], random: () => number = Math.random): Draw {
  const teams = teamIds.filter((id) => typeof id === 'string' && id.length > 0);
  const distinct = distinctRoutes(routes);
  if (!teams.length || !distinct.length) {
    return { assignments: [], distinctRoutes: distinct.length, repeatedTeams: 0, shortfall: Math.max(0, teams.length - distinct.length) };
  }
  const order = shuffle(teams, random);
  const pool = shuffle(distinct, random);
  const assignments = order.map((teamId, index) => ({ teamId, route: pool[index % pool.length] }));
  const repeatedTeams = Math.max(0, order.length - pool.length);
  return {
    assignments,
    distinctRoutes: pool.length,
    repeatedTeams,
    shortfall: repeatedTeams,
  };
}
