import type { RouteRecord } from './route-catalog';

/**
 * The route colour lookup, kept apart from the hook that uses it.
 *
 * A route number on its own is a number: "29" says nothing about which line it is
 * unless you already know. The colour is published in the feed and is the thing
 * people actually recognise, so it belongs on every badge rather than only in the
 * picker where it happened to be used first.
 *
 * **A route with no published colour gets none.** Not a generated one, not a hash of
 * its name. An invented colour is a claim about the operator's branding that nobody
 * made, and two unrelated routes that collide on it look related. That refusal is the
 * behaviour most likely to be undone by a well-meaning later change, so it lives here,
 * free of React, where it can be tested directly.
 */

export type RouteColour = {
  color: string | null;
  textColor: string | null;
  shortName: string | null;
  longName: string | null;
};

export const NO_COLOUR: RouteColour = { color: null, textColor: null, shortName: null, longName: null };

const swatch = (value: string | null) => (value ? `#${value}` : null);

export function buildRouteColourIndex(records: RouteRecord[] | null): Map<string, RouteColour> {
  const byRoute = new Map<string, RouteColour>();
  for (const record of records ?? []) {
    /* Keyed by the bare route id and the feed-qualified one, because a live vehicle
       reports "29" while the catalogue also knows it as "ttc:29", and a lookup that
       handles only one of them silently finds nothing. */
    const value: RouteColour = {
      color: swatch(record.color),
      textColor: swatch(record.textColor),
      shortName: record.shortName,
      longName: record.longName,
    };
    for (const key of [record.routeId, record.shortName, record.id].filter(Boolean) as string[]) {
      if (!byRoute.has(key)) byRoute.set(key, value);
    }
  }
  return byRoute;
}

/** The published colour for a route, or nulls when the feed gives none. */
export function lookupRouteColour(index: Map<string, RouteColour>, routeId: string | null | undefined): RouteColour {
  if (!routeId) return NO_COLOUR;
  return index.get(String(routeId)) ?? NO_COLOUR;
}
