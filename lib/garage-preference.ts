/**
 * Prefer journeys that ride routes a chosen garage operates.
 *
 * Somebody who wants to ride a Mount Dennis bus cannot ask for one directly: no
 * feed publishes "this departure will be a Mount Dennis vehicle" ahead of time,
 * and the vehicle on a trip is decided on the day. What the TTC does publish is
 * which garage operates which route, so the honest version of the question is
 * "which of these journeys ride routes that garage runs", and that is what this
 * answers.
 *
 * **It orders, it never filters.** A journey that rides none of the chosen
 * garages' routes is still returned, last, and labelled as an alternate. Dropping
 * it would answer a preference by hiding the only way of getting somewhere, which
 * is not a preference, it is a refusal.
 *
 * Three bands, in order:
 *
 *   every    every transit leg rides a route the chosen garages operate
 *   some     at least one leg does
 *   none     no leg does; these are the alternates
 *
 * Within a band the routing service's own order is preserved, because it already
 * sorted by whatever the rider asked for and this is a tie-break, not a re-sort.
 *
 * **The registry has an expiry and it is not decoration.** Garage assignments are
 * published per board period and change between them. When the source has run
 * out, the ordering is still offered, because a route's garage is far more stable
 * than a vehicle's, but the result says so and the interface has to repeat it.
 */

import type { Itinerary, Leg } from './types';

export type GarageRegistry = {
  garageNames: Record<string, string>;
  routesByGarage: Record<string, string[]>;
  source?: { validFrom?: string; validThrough?: string; title?: string; publisherPage?: string };
};

export type GarageBand = 'every' | 'some' | 'none';

export type GarageDisclosure = {
  enabled: boolean;
  /** Garage codes asked for, after unknown ones are dropped. */
  garages: string[];
  unknownGarages: string[];
  counts: Record<GarageBand, number>;
  /** True when the published source no longer covers today. */
  sourceExpired: boolean;
  validThrough: string | null;
  /** Set when the preference could not change anything, with the reason. */
  note: string | null;
};

const TRANSIT_MODES = new Set(['BUS', 'RAIL', 'SUBWAY', 'TRAM', 'FERRY', 'CABLE_CAR', 'FUNICULAR', 'GONDOLA']);

/** A leg somebody rides, as opposed to one they walk. */
export function isRidden(leg: Leg): boolean {
  return TRANSIT_MODES.has(String(leg?.mode ?? '').toUpperCase());
}

/** The route identifier as the garage registry writes it: "506", not "ttc:506". */
export function bareRoute(leg: Leg): string | null {
  if (leg?.route == null) return null;
  const text = String(leg.route);
  const afterFeed = text.includes(':') ? text.slice(text.lastIndexOf(':') + 1) : text;
  return afterFeed.trim() || null;
}

/** Which of the chosen garages operate a route. */
export function garagesForRoute(routeId: string | null, registry: GarageRegistry, within?: string[]): string[] {
  if (!routeId) return [];
  const codes = within?.length ? within : Object.keys(registry.routesByGarage ?? {});
  return codes.filter((code) => (registry.routesByGarage?.[code] ?? []).includes(routeId));
}

/** Which band an itinerary falls into for the chosen garages. */
export function bandFor(itinerary: Itinerary, registry: GarageRegistry, garages: string[]): GarageBand {
  const ridden = (itinerary?.legs ?? []).filter(isRidden);
  // A journey with nothing to ride cannot ride a chosen garage's route.
  if (!ridden.length) return 'none';
  let matched = 0;
  for (const leg of ridden) {
    if (garagesForRoute(bareRoute(leg), registry, garages).length) matched += 1;
  }
  if (matched === ridden.length) return 'every';
  return matched ? 'some' : 'none';
}

const RANK: Record<GarageBand, number> = { every: 0, some: 1, none: 2 };

/** Whether the registry's published period still covers a given day. */
export function sourceHasExpired(registry: GarageRegistry, today: string): boolean {
  const through = registry?.source?.validThrough;
  if (typeof through !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(through)) return false;
  return today > through;
}

export function applyGaragePreference(
  itineraries: Itinerary[],
  {
    garages = [],
    registry,
    today,
  }: { garages?: string[]; registry: GarageRegistry; today: string },
): { itineraries: Itinerary[]; bands: Map<string, GarageBand>; disclosure: GarageDisclosure } {
  const list = Array.isArray(itineraries) ? itineraries : [];
  const known = Object.keys(registry?.routesByGarage ?? {});
  const wanted = [...new Set(garages)].filter((code) => known.includes(code));
  const unknownGarages = [...new Set(garages)].filter((code) => !known.includes(code));
  const sourceExpired = sourceHasExpired(registry, today);

  const disclosure: GarageDisclosure = {
    enabled: wanted.length > 0,
    garages: wanted,
    unknownGarages,
    counts: { every: 0, some: 0, none: 0 },
    sourceExpired,
    validThrough: registry?.source?.validThrough ?? null,
    note: null,
  };

  if (!wanted.length) {
    disclosure.note = garages.length ? 'No known garage was selected.' : null;
    return { itineraries: list, bands: new Map(), disclosure };
  }

  const bands = new Map<string, GarageBand>();
  for (const itinerary of list) {
    const band = bandFor(itinerary, registry, wanted);
    bands.set(itinerary.id, band);
    disclosure.counts[band] += 1;
  }

  /* A stable sort by band only. The routing service already ordered these by
     whatever the rider asked for, and re-sorting would quietly overrule that. */
  const ordered = list
    .map((itinerary, index) => ({ itinerary, index, rank: RANK[bands.get(itinerary.id) ?? 'none'] }))
    .sort((first, second) => first.rank - second.rank || first.index - second.index)
    .map((entry) => entry.itinerary);

  if (!disclosure.counts.every && !disclosure.counts.some) {
    disclosure.note = 'No option rides a route these garages operate. Every option below is an alternate.';
  } else if (!disclosure.counts.every) {
    disclosure.note = 'No option rides these garages the whole way. The closest ones are first.';
  }

  return { itineraries: ordered, bands, disclosure };
}
