'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadRouteCatalog, type RouteRecord } from './route-catalog';
import { buildRouteColourIndex, lookupRouteColour, type RouteColour } from './route-colours';

/**
 * The operator's own colour for a route, looked up by the identifier a live vehicle
 * reports.
 *
 * The lookup itself lives in `route-colours.ts`, with no React in it, so the part
 * worth guarding can be tested directly: a route with no published colour gets none,
 * and never a generated one.
 */

export type { RouteColour };
export { buildRouteColourIndex, lookupRouteColour };

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
    // The early return does not clear state synchronously: that would be a setState
    // in an effect body, and an agency with no catalogue is already answered by the
    // lookup returning nulls.
    if (!agency || agency === 'all') return;
    const controller = new AbortController();
    loadRouteCatalog(date, { signal: controller.signal })
      .then((snapshot) => { if (!controller.signal.aborted) setRecords(snapshot.records); })
      .catch(() => { if (!controller.signal.aborted) setRecords(null); });
    return () => controller.abort();
  }, [agency, date]);

  return useMemo(() => {
    const byRoute = buildRouteColourIndex(records);
    return {
      loaded: records != null,
      forRoute: (routeId: string | null | undefined) => lookupRouteColour(byRoute, routeId),
    };
  }, [records]);
}
