'use client';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Building2, LoaderCircle, Route, X } from 'lucide-react';
import { SearchWorkbench, useSearchMatches, type SearchState } from './search-workbench';
import { agencySearchText, canChooseCatalogRoute, loadRouteCatalog, routePeriodState, type RouteCatalogSnapshot } from '../lib/route-catalog';

const emptySearch = (): SearchState => ({ query: '', pattern: '', flags: 'i', mode: 'text' });
const swatch = (value: string | null) => value && /^[a-f0-9]{6}$/i.test(value) ? '#' + value : undefined;
const currentTorontoDate = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

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
  const agencyPanel = useRef<HTMLElement>(null);
  const routePanel = useRef<HTMLElement>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<RouteCatalogSnapshot>({ records: [], date: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [progress, setProgress] = useState({ date: '', count: 0 });
  const [loadingDate, setLoadingDate] = useState('');
  const [chosenAgency, setChosenAgency] = useState(agency);
  const [step, setStep] = useState<'agency' | 'route'>('agency');
  const [agencyChosen, setAgencyChosen] = useState(false);
  const [agencySearch, setAgencySearch] = useState(emptySearch);
  const [routeSearch, setRouteSearch] = useState(emptySearch);
  const effectiveDate = requestedDate || currentTorontoDate();
  const loadedCount = progress.date === effectiveDate ? progress.count : 0;

  const performRequest = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const ticket = ++generation.current;
    const date = effectiveDate;
    const deadline = setTimeout(() => controller.abort(), 15000);
    try {
      const next = await loadRouteCatalog(date, { signal: controller.signal, onProgress: count => { if (ticket === generation.current) setProgress({ date, count }); } });
      if (ticket === generation.current) {
        setSnapshot(next);
        setBusy(false); setError(false); setLoadingDate(date);
      }
    } catch {
      if (ticket === generation.current) { setError(true); setBusy(false); setLoadingDate(date); }
    } finally { clearTimeout(deadline); }
  };
  const fetchCatalog = () => {
    setBusy(true); setError(false); setProgress({ date: effectiveDate, count: 0 }); setLoadingDate(effectiveDate);
    void performRequest();
  };
  const openPicker = () => {
    const initial = allowedAgencyIds?.length === 1 ? allowedAgencyIds[0] : agency;
    const validInitial = initial !== 'all' && (!allowedAgencyIds || allowedAgencyIds.includes(initial));
    const initialStep = validInitial ? 'route' : 'agency';
    setChosenAgency(validInitial ? initial : 'all');
    setAgencyChosen(validInitial);
    setStep(initialStep);
    setOpen(true);
    fetchCatalog();
  };
  const close = () => {
    ++generation.current;
    request.current?.abort();
    dialog.current?.close();
    setOpen(false); setBusy(false);
    trigger.current?.focus();
  };
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  useEffect(() => () => { ++generation.current; request.current?.abort(); }, []);
  const reloadForDate = useEffectEvent(() => { void performRequest(); });
  useEffect(() => {
    if (open && loadingDate !== effectiveDate) reloadForDate();
  }, [open, loadingDate, effectiveDate]);
  const currentError = error && loadingDate === effectiveDate;
  const pending = busy || (open && snapshot.date !== effectiveDate && !currentError);
  useEffect(() => {
    if (!open || pending || currentError) return;
    const frame = requestAnimationFrame(() => {
      const panel = step === 'agency' ? agencyPanel.current : routePanel.current;
      panel?.querySelector<HTMLInputElement>('input[type="search"]')?.focus({ preventScroll: true });
      dialog.current?.scrollTo({ top: 0, behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, pending, currentError, step, chosenAgency]);

  const agencies = useMemo(() => {
    const groups = new Map<string, { name: string; count: number }>();
    for (const record of snapshot.records) {
      if (allowedAgencyIds && !allowedAgencyIds.includes(record.feedId)) continue;
      const prior = groups.get(record.feedId);
      groups.set(record.feedId, { name: record.agency || record.feedId.toUpperCase(), count: (prior?.count || 0) + 1 });
    }
    return Array.from(groups, ([id, group]) => [id, group.name, group.count] as const);
  }, [snapshot, allowedAgencyIds]);
  const agencySamples = useMemo(() => agencies.map(([id, name]) => agencySearchText(id, name)), [agencies]);
  const agencyMatches = useSearchMatches(agencySamples, agencySearch);
  const availableRoutes = useMemo(() => snapshot.records.filter(record => (!allowedAgencyIds || allowedAgencyIds.includes(record.feedId)) && (chosenAgency === 'all' || record.feedId === chosenAgency)), [snapshot, chosenAgency, allowedAgencyIds]);
  const routeSamples = useMemo(() => availableRoutes.map(record => (record.shortName || record.routeId) + ' ' + (record.longName || '') + ' ' + (record.agency || record.feedId)), [availableRoutes]);
  const routeMatches = useSearchMatches(routeSamples, routeSearch);
  const visibleRoutes = availableRoutes.filter((_, index) => routeMatches.matches[index]);
  const visibleAgencies = agencies.filter((_, index) => agencyMatches.matches[index]);
  const selectedRoute = snapshot.records.find(record => record.feedId === agency && record.routeId === route);
  const agencyName = (id: string) => id === 'all' ? t('All agencies', '所有交通公司') : agencies.find(([key]) => key === id)?.[1] || id.toUpperCase();
  const chooseAgency = (id: string) => {
    if (allowedAgencyIds && !allowedAgencyIds.includes(id)) return;
    if (chosenAgency !== id) setRouteSearch(emptySearch());
    setChosenAgency(id); setAgencyChosen(true); setStep('route');
  };
  const choose = (id: string, routeId: string) => {
    if (busy || error || snapshot.date !== effectiveDate || !canChooseCatalogRoute(snapshot.records, id, routeId, allowedAgencyIds, singleRoute)) return;
    onChange(id, routeId); close();
  };

  return <>
    <button ref={trigger} type="button" className="route-picker-trigger" onClick={openPicker} aria-haspopup="dialog" aria-expanded={open}>
      {selectedRoute ? <strong className="route-picker-badge" style={{ background: swatch(selectedRoute.color), color: swatch(selectedRoute.textColor) }}>{selectedRoute.shortName || route}</strong> : <Route size={20} aria-hidden="true" />}
      <span><small>{t('Choose agency & route', '選擇交通公司及路線')}</small><strong>{agencyName(agency)}{route ? ' · ' + (selectedRoute?.shortName || route) : ' · ' + t('All routes', '全部路線')}</strong>{selectedRoute?.longName && <small>{selectedRoute.longName}</small>}</span>
    </button>
    <dialog ref={dialog} className="route-picker-dialog guided-route-picker" aria-label={t('Choose an agency and route', '選擇交通公司及路線')} onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => {
      if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.target instanceof HTMLInputElement && !['button', 'submit', 'reset'].includes(event.target.type)) event.preventDefault();
    }}>
      <header><div><span className="eyebrow">{t('FIND YOUR SERVICE', '揀選服務')}</span><h2>{t('Choose your route', '選擇你嘅路線')}</h2></div><button type="button" className="icon-button" aria-label={t('Close route picker', '關閉路線選擇')} onClick={close}><X size={20} /></button></header>
      <div className="route-picker-progress" aria-label={t('Selection steps', '選擇步驟')}>
        <button type="button" aria-current={step === 'agency' ? 'step' : undefined} onClick={() => { setStep('agency'); }}><span>1</span>{t('Agency', '交通公司')}</button><ArrowRight size={16} aria-hidden="true" />
        <button type="button" aria-current={step === 'route' ? 'step' : undefined} disabled={!agencyChosen} title={!agencyChosen ? t('Choose an agency first', '請先選擇交通公司') : undefined} onClick={() => { setStep('route'); }}><span>2</span>{t('Route', '路線')}</button>
      </div>
      {pending ? <div className="route-picker-loading"><LoaderCircle size={26} className="spin" aria-hidden="true" /><output>{t('Loading official routes', '載入官方路線')}<small>{t(loadedCount + ' routes received for ' + effectiveDate, '已收到 ' + effectiveDate + ' 嘅 ' + loadedCount + ' 條路線')}</small></output></div> : currentError ? <div className="route-picker-unavailable"><p role="alert">{t('The route catalog could not be loaded. Your existing selection is unchanged.', '未能載入路線清單，現有選擇保持不變。')}</p><button type="button" className="pill" onClick={() => fetchCatalog()}>{t('Retry', '再試')}</button></div> : <div className="route-picker-columns" data-step={step}>
        <section ref={agencyPanel} className="route-step-agencies" aria-label={t('Agencies', '交通公司')}>
          <h3>{t('Choose an agency', '選擇交通公司')}</h3>
          <SearchWorkbench storageId={storageId + '-agency'} label={t('Find an agency', '搜尋交通公司')} value={agencySearch} onChange={setAgencySearch} samples={agencySamples} t={t} />
          <div className="route-picker-agencies">
            {!allowedAgencyIds && <button type="button" className={chosenAgency === 'all' && agencyChosen ? 'selected' : ''} aria-pressed={chosenAgency === 'all' && agencyChosen} onClick={() => chooseAgency('all')}><Building2 size={18} aria-hidden="true" /><span>{t('All agencies', '所有交通公司')}<small>{t(snapshot.records.length + ' routes', snapshot.records.length + ' 條路線')}</small></span><ArrowRight size={16} aria-hidden="true" /></button>}
            {agencyMatches.error ? <output>{t('The search expression could not be evaluated. Edit it or use plain text.', '未能配對搜尋規則，請修改或使用純文字。')}</output> : agencyMatches.busy ? <output>{t('Matching agencies…', '配對交通公司中…')}</output> : !visibleAgencies.length ? <output>{t('No agencies match. Clear the search to see available agencies.', '未有符合嘅交通公司，清除搜尋可查看可用公司。')}</output> : visibleAgencies.map(([id, name, count]) => <button type="button" key={id} className={chosenAgency === id && agencyChosen ? 'selected' : ''} aria-pressed={chosenAgency === id && agencyChosen} onClick={() => chooseAgency(id)}><Building2 size={18} aria-hidden="true" /><span>{name}<small>{t(count + ' routes', count + ' 條路線')}</small></span>{chosenAgency === id && agencyChosen ? <Check size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}</button>)}
          </div>
        </section>
        <section ref={routePanel} className="route-step-routes" aria-label={t('Routes', '路線')}>
          {!agencyChosen ? <div className="route-picker-prompt"><Route size={32} aria-hidden="true" /><h3>{t('Start with an agency', '由交通公司開始')}</h3><p>{t('Choose who you want to ride with, then find the route.', '先選擇交通公司，再搵路線。')}</p></div> : <>
            <div className="chosen-agency"><button type="button" className="icon-button" aria-label={t('Back to agencies', '返回交通公司')} onClick={() => { setStep('agency'); }}><ArrowLeft size={18} /></button><div><small>{t('SELECTED AGENCY', '已選擇交通公司')}</small><h3>{agencyName(chosenAgency)}</h3></div></div>
            <SearchWorkbench storageId={storageId + '-route'} label={t('Find a route', '搜尋路線')} value={routeSearch} onChange={setRouteSearch} samples={routeSamples} t={t} />
            {!singleRoute && <button type="button" className="route-picker-all" onClick={() => choose(chosenAgency, '')}><Route size={18} aria-hidden="true" /><span>{t('Use all routes in this selection', '使用所選公司嘅全部路線')}</span><ArrowRight size={17} aria-hidden="true" /></button>}
            <div className="route-picker-results" aria-busy={routeMatches.busy}>
              {routeMatches.error ? <output>{t('The search expression could not be evaluated. Edit it or use plain text.', '未能配對搜尋規則，請修改或使用純文字。')}</output> : routeMatches.busy ? <output>{t('Matching routes…', '配對路線中…')}</output> : !visibleRoutes.length ? <output>{t('No matching routes. Try a route number or part of its name.', '未有符合嘅路線，試下路線號碼或部分名稱。')}</output> : visibleRoutes.map(record => {
                const period = routePeriodState(record, snapshot.date);
                return <button type="button" key={record.id} className="route-picker-result" aria-pressed={record.feedId === agency && record.routeId === route} onClick={() => choose(record.feedId, record.routeId)}>
                  <strong className="route-picker-badge" style={{ background: swatch(record.color), color: swatch(record.textColor) }}>{record.shortName || record.routeId}</strong>
                  <span><strong>{record.longName || t('Route name unavailable', '未有路線名稱')}</strong><small>{record.agency || record.feedId.toUpperCase()}</small>{period !== 'within' && <small className="route-period-note">{period === 'outside' ? t('Outside this timetable period', '不在此時間表有效期內') : t('Timetable period unconfirmed', '時間表有效期未確認')}</small>}{!record.color && <small>{t('Official color unavailable', '未有官方顏色')}</small>}</span>
                  {record.feedId === agency && record.routeId === route ? <Check size={18} aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}
                </button>;
              })}
            </div>
          </>}
        </section>
      </div>}
      <footer className="route-picker-footnote"><span>{t('Timetable date', '時間表日期')}: {pending || currentError ? effectiveDate : snapshot.date}</span><small>{t('Listed routes may not have a currently reported vehicle. Timetable periods do not prove service on every date.', '列出嘅路線未必有正通報位置嘅車輛，時間表有效期亦唔代表每日都有服務。')}</small></footer>
    </dialog>
  </>;
}
