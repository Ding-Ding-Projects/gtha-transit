'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadRouteCatalog, type RouteRecord } from './route-catalog';

/**
 * The operator's own colour for a route, looked up by the identifier a live
 * vehicle reports.
 *
 * A route number on its own is a number: "29" tells a rider nothing about which
 * line it is until they already know. The colour is published in the GTFS feed
 * and is the thing people actually recognise, so it belongs on every badge rather
 * than only in the route picker where it happened to be used first.
 *
 * **A route with no published colour gets none.** Not a generated one, not a hash
 * of its name: an invented colour is a claim about the operator's branding that
 * nobody made, and two routes that collide on it look related when they are not.
 * Those fall back to the surface colours and say so in their title.
 */

export type RouteColour = { color: string | null; textColor: string | null; shortName: string | null; longName: string | null };

const swatch = (value: string | null) => (value ? `#${value}` : null);

/** Today in Toronto, since a route catalogue is asked for by service date. */
function torontoToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function useRouteColours(agency: string | null) {
  const [records, setRecords] = useState<RouteRecord[] | null>(null);
  const date = torontoToday();

  useEffect(() => {
    // The early return does not clear state synchronously: that would be a
    // setState in an effect body, and an agency with no catalogue is already
    // answered by the lookup returning nulls.
    if (!agency || agency === 'all') return;
    const controller = new AbortController();
    loadRouteCatalog(date, { signal: controller.signal })
      .then((snapshot) => { if (!controller.signal.aborted) setRecords(snapshot.records); })
      .catch(() => { if (!controller.signal.aborted) setRecords(null); });
    return () => controller.abort();
  }, [agency, date]);

  return useMemo(() => {
    const byRoute = new Map<string, RouteColour>();
    for (const record of records ?? []) {
      /* Keyed by both the bare route id and the feed-qualified one, because a
         live vehicle reports "29" while the catalogue also knows it as "ttc:29"
         and a lookup that only handles one of them silently finds nothing. */
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
    return {
      loaded: records != null,
      /** The published colour for a route, or nulls when the feed gives none. */
      forRoute(routeId: string | null | undefined): RouteColour {
        if (!routeId) return { color: null, textColor: null, shortName: null, longName: null };
        return byRoute.get(String(routeId))
          ?? { color: null, textColor: null, shortName: null, longName: null };
      },
    };
  }, [records]);
}
