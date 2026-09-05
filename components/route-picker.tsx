'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Route, X } from 'lucide-react';
import { SearchWorkbench, useSearchMatches, type SearchState } from './search-workbench';

type RouteRecord = {
  id: string; routeId: string; shortName: string | null; longName: string | null;
  feedId: string; agency: string; color: string | null; textColor: string | null;
  validity: { serviceStart?: string; serviceEnd?: string };
};
const emptySearch = (): SearchState => ({ query: '', pattern: '', flags: 'i', mode: 'text' });
const routeColor = (value: string | null) => value && /^[a-f0-9]{6}$/i.test(value) ? '#' + value : undefined;
export default function RoutePicker({ agency, route, onChange, t, allowedAgencyIds, storageId = 'tracker-route-picker', date: requestedDate, singleRoute = false }: {
  agency: string; route: string;
  onChange: (agency: string, route: string) => void;
  t: (en: string, zh: string) => string;
  allowedAgencyIds?: readonly string[];
  storageId?: string;
  date?: string;
  singleRoute?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<RouteRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [catalogDate, setCatalogDate] = useState('');
  const [chosenAgency, setChosenAgency] = useState(agency);
  const [agencySearch, setAgencySearch] = useState(emptySearch);
  const [routeSearch, setRouteSearch] = useState(emptySearch);
  useEffect(() => {
    if (!open) return;
    setChosenAgency(agency);
    dialog.current?.showModal();
    const controller = new AbortController();
    let active = true;
    const deadline = setTimeout(() => controller.abort(), 15000);
    setBusy(true); setError(false);
    void (async () => {
      try {
        const all: RouteRecord[] = [];
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
        const date = requestedDate || `${parts.year}-${parts.month}-${parts.day}`;
        setCatalogDate(date);
        const cursors = new Set<string>();
        let cursor: string | null = null;
        for (let page = 0; page < 50; page++) {
          const params = new URLSearchParams({ limit: '200', date });
          if (cursor) params.set('cursor', cursor);
          const response = await fetch('/api/routes?' + params, { signal: controller.signal });
          if (!response.ok) throw new Error('catalog unavailable');
          const data = await response.json() as { routes?: RouteRecord[]; nextCursor?: unknown };
          if (!Array.isArray(data.routes) || data.routes.length > 200) throw new Error('invalid catalog');
          all.push(...data.routes);
          if (!data.nextCursor) {
            if (!controller.signal.aborted) setRecords(all);
            return;
          }
          if (typeof data.nextCursor !== 'string' || cursors.has(data.nextCursor)) throw new Error('invalid pagination');
          const nextCursor = data.nextCursor;
          cursors.add(nextCursor); cursor = nextCursor;
        }
        throw new Error('catalog exceeds supported bound');
      } catch {
        if (active) setError(true);
      } finally {
        clearTimeout(deadline);
        if (active) setBusy(false);
      }
    })();
    return () => { active = false; clearTimeout(deadline); controller.abort(); };
  }, [open, refresh, requestedDate]);
  const agencies = useMemo(() => [...new Map(records.filter(r => !allowedAgencyIds || allowedAgencyIds.includes(r.feedId)).map(r => [r.feedId, r.agency])).entries()], [records, allowedAgencyIds]);
  const agencySamples = useMemo(() => agencies.map(([id, name]) => `${id} ${name}`), [agencies]);
  const agencyMatches = useSearchMatches(agencySamples, agencySearch);
  const availableRoutes = useMemo(() => records.filter(r => (!allowedAgencyIds || allowedAgencyIds.includes(r.feedId)) && (chosenAgency === 'all' || r.feedId === chosenAgency)), [records, chosenAgency, allowedAgencyIds]);
  const routeSamples = useMemo(() => availableRoutes.map(r => `${r.shortName || r.routeId} ${r.longName || ''} ${r.agency}`), [availableRoutes]);
  const routeMatches = useSearchMatches(routeSamples, routeSearch);
  const selectedRoute = records.find(record => record.feedId === agency && record.routeId === route);
  const close = () => { dialog.current?.close(); setOpen(false); trigger.current?.focus(); };
  const choose = (agencyId: string, routeId: string) => { onChange(agencyId, routeId); close(); };
  return <>
    <button ref={trigger} type="button" className="route-picker-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog">
      <Route size={20} aria-hidden="true" /><span><small>{t('Choose agency & route', '選擇交通公司及路線')}</small><strong>{agency === 'all' ? t('All agencies', '所有交通公司') : agency.toUpperCase()}{route ? ` · ${selectedRoute?.shortName || route}` : ` · ${t('All routes', '全部路線')}`}</strong>{selectedRoute?.longName && <small>{selectedRoute.longName}</small>}</span>
    </button>
    <dialog ref={dialog} className="route-picker-dialog" aria-label={t('Choose an agency and route', '選擇交通公司及路線')} onCancel={close} onClose={() => setOpen(false)}>
      <header><div><span className="eyebrow">{t('FIND YOUR SERVICE', '揀選服務')}</span><h2>{t('Agency & route', '交通公司及路線')}</h2></div><button type="button" className="icon-button" aria-label={t('Close route picker', '關閉路線選擇')} onClick={close}><X /></button></header>
      <p className="data-note">{t('Official timetable catalog for Toronto date', '多倫多日期嘅官方時間表路線清單')} {catalogDate}. {t('Listed routes may not have a currently reported vehicle.', '清單內嘅路線未必有正通報位置嘅車輛。')}</p>
      {busy ? <p role="status">{t('Loading official routes…', '載入官方路線中…')}</p> : error ? <div role="status"><p>{t('The route catalog could not be loaded. Your existing selection is unchanged.', '未能載入路線清單，現有選擇保持不變。')}</p><button className="pill" onClick={() => setRefresh(x => x + 1)}>{t('Retry', '再試')}</button></div> : <div className="route-picker-columns">
        <section aria-label={t('Agencies', '交通公司')}>
          <h3>{t('1. Choose an agency', '1. 選擇交通公司')}</h3>
          <SearchWorkbench storageId={storageId + '-agency'} label={t('Find an agency', '搜尋交通公司')} value={agencySearch} onChange={setAgencySearch} samples={agencySamples} t={t} />
          <div className="route-picker-agencies">
            {!allowedAgencyIds && <button className={chosenAgency === 'all' ? 'selected' : ''} aria-pressed={chosenAgency === 'all'} onClick={() => setChosenAgency('all')}>{t('All agencies', '所有交通公司')}</button>}
            {!agencyMatches.busy && !agencyMatches.error && agencies.map(([id, name], i) => agencyMatches.matches[i] && <button key={id} className={chosenAgency === id ? 'selected' : ''} aria-pressed={chosenAgency === id} onClick={() => setChosenAgency(id)}>{name}</button>)}
          </div>
        </section>
        <section aria-label={t('Routes', '路線')}>
          <h3>{t('2. Choose a route', '2. 選擇路線')}</h3>
          <SearchWorkbench storageId={storageId + '-route'} label={t('Find a route', '搜尋路線')} value={routeSearch} onChange={setRouteSearch} samples={routeSamples} t={t} />
          {!singleRoute && <button className="pill" onClick={() => choose(chosenAgency, '')}>{t('Use all routes in this selection', '使用所選公司嘅全部路線')}</button>}
          <div className="route-picker-results" aria-busy={routeMatches.busy}>
            {routeMatches.error ? <p role="status">{routeMatches.error}</p> : routeMatches.busy ? <p role="status">{t('Matching routes…', '配對路線中…')}</p> : availableRoutes.filter((_, i) => routeMatches.matches[i]).length === 0 ? <p role="status">{t('No matching routes.', '冇符合嘅路線。')}</p> : availableRoutes.map((r, i) => routeMatches.matches[i] && <button key={r.id} className="route-picker-result" onClick={() => choose(r.feedId, r.routeId)}>
              <strong className="route-picker-badge" style={{ background: routeColor(r.color), color: routeColor(r.textColor) }}>{r.shortName || r.routeId}</strong>
              <span><strong>{r.longName || t('Route name unavailable', '未有路線名稱')}</strong><small>{r.agency}</small>{!r.color && <small>{t('Official color unavailable', '未有官方顏色')}</small>}</span>
            </button>)}
          </div>
        </section>
      </div>}
    </dialog>
  </>;
}
