'use client';
import { useEffect, useState } from 'react';
import type { Place, StopRoute, WashroomInfo } from '../lib/types';
import { torontoIso } from '../lib/journey-utils';

const color = (value?: string | null) => value && /^[0-9a-f]{6}$/i.test(value) ? '#' + value : undefined;
export function RouteBadges({ routes, limit = 4, t }: { routes: readonly StopRoute[]; limit?: number; t: (en: string, zh: string) => string }) {
  return <span className="stop-route-badges">
    {routes.slice(0, limit).map(route => <span key={route.id} className="stop-route-badge" style={{ backgroundColor: color(route.color), color: color(route.textColor) }} title={[route.agency, route.longName, !route.color ? t('Official color unavailable', '未有官方顏色') : ''].filter(Boolean).join(' · ')}>{route.shortName || route.routeId}</span>)}
    {routes.length > limit && <span className="stop-route-more">+{routes.length - limit} {t('more routes', '條路線')}</span>}
  </span>;
}
export function WashroomBadge({ washroom, t }: { washroom?: WashroomInfo | null; t: (en: string, zh: string) => string }) {
  if (!washroom) return null;
  return <span className="washroom-badge"><strong>{t('Washroom', '洗手間')}{washroom.name ? ` · ${washroom.name}` : ''}</strong><small>{washroom.availability === 'confirmed-open' ? t('Open according to published hours at this time', '按已公布時間，此時開放') : washroom.availability === 'closed' ? t('Closed according to published hours at this time', '按已公布時間，此時關閉') : t('Presence confirmed; opening hours unconfirmed', '已確認有設施，開放時間未確認')}</small></span>;
}
export default function SelectedStopInfo({ place, when, t }: { place: Place; when?: string; t: (en: string, zh: string) => string }) {
  const [result, setResult] = useState<{ scope: string; routes: StopRoute[]; washroom?: WashroomInfo | null } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const scope = `${place.id}|${when || ''}`;
  useEffect(() => {
    setExpanded(false);
    if (!place.id.includes(':') || (place.kind && !['stop', 'station'].includes(place.kind))) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    void (async () => {
      try {
        const params = new URLSearchParams({ stopId: place.id });
        if (when && /^\d{4}-\d{2}-\d{2}/.test(when)) {
          params.set('date', when.slice(0, 10));
          try { params.set('at', torontoIso(when)); } catch { /* The planner validates incomplete local times before submission. */ }
        }
        const response = await fetch('/api/stop-routes?' + params, { signal: controller.signal });
        if (!response.ok) return;
        const body = await response.json() as { routes?: StopRoute[]; washroom?: WashroomInfo | null };
        if (!controller.signal.aborted) setResult({ scope, routes: Array.isArray(body.routes) ? body.routes : [], washroom: body.washroom });
      } catch { /* Missing enrichment never erases a selected location. */ }
      finally { clearTimeout(timeout); }
    })();
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [place.id, place.kind, scope, when]);
  const data = result?.scope === scope ? result : null;
  const routes = data ? data.routes : place.servingRoutesDate === when?.slice(0, 10) ? place.servingRoutes || [] : [];
  const washroom = data ? data.washroom : place.washroom ? { ...place.washroom, availability: 'unknown' as const } : null;
  if (!routes.length && !washroom && !data) return null;
  return <div className="selected-stop-info">
    {data && !routes.length && <small>{t('No timetable routes are indexed for this selected stop.', '此所選車站未有已編入索引嘅時間表路線。')}</small>}
    {routes.length > 0 && <><small>{t('Timetable routes, not live arrivals', '時間表路線，並非即時到站')}</small><RouteBadges routes={routes} limit={expanded ? routes.length : 8} t={t} />{routes.length > 8 && <button type="button" className="text-button" onClick={() => setExpanded(value => !value)}>{expanded ? t('Show fewer routes', '顯示較少路線') : t(`Show all ${routes.length} routes`, `顯示全部 ${routes.length} 條路線`)}</button>}</>}
    <WashroomBadge washroom={washroom} t={t} />
  </div>;
}
