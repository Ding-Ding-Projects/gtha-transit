'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  BusFront,
  ChevronRight,
  Clock,
  ExternalLink,
  RefreshCw,
  X,
} from 'lucide-react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
import VehiclePhotoCaption from './vehicle-photo-caption';
import RoutePicker from './route-picker';
import FleetFilterPanel from './fleet-filter-panel';
import { useLocalSetting } from '../lib/use-local-setting';
import { emptyFleetFilter, filterFleetVehicles } from '../lib/fleet-filter';
import { SearchWorkbench, emptySearchState, useSearchMatches } from './search-workbench';
import { attachMapTiles } from '../lib/map-tiles';
import { vehiclePage } from '../lib/vehicle-page';
import { superExpressFor } from '../lib/go-express';
import SuperExpressBadge from './super-express-badge';
type Vehicle = {
  id: string;
  agencyId?: string;
  agencyName?: string;
  label?: string;
  fleetNumber?: string;
  routeId?: string;
  lat: number;
  lon: number;
  bearing?: number;
  speedKph?: number;
  timestamp?: string | number;
  stale?: boolean;
  division?: { state: string; reason: string; homeGarageName?: string; assignedGarageNames?: string[]; routeGarages?: string[]; rarity?: { state: string; eligible?: boolean; percentage?: number | null; rarity?: string | null; sample?: { vehicleRouteDays: number; routeObservedDays: number }; note?: string } };
  cptdb?: {
    url?: string;
    match?: string;
    manufacturer?: string;
    model?: string;
    year?: string | number;
    propulsion?: string;
    length?: string;
    capacity?: string;
    fleetRange?: string;
    details?: Record<string, unknown>;
  };
  photo?: {
    url: string;
    sourceUrl: string;
    credit: string;
    license: string;
    licenseUrl?: string;
    exactVehicle: boolean;
  } | null;
};
type Snapshot = {
  state: string;
  fetchedAt?: string;
  total: number;
  vehicles: Vehicle[];
  nextCursor?: string | null;
  agencies?: { id: string; name: string; state: string; total: number }[];
  counts?: { all: number; outOfDivision: number; inDivision: number; unknown: number };
  source?: { title?: string; validThrough?: string; publisherPage?: string };
};
const identity = (v?: Vehicle | null) =>
  v ? `${v.agencyId || 'ttc'}:${v.id}` : '';
const agencyColors: Record<string, string> = {
  ttc: '#bf3030',
  go: '#287641',
  up: '#79563a',
  miway: '#c45d15',
  hsr: '#2869a7',
  burlington: '#7858a1',
};
const TTC_ONLY = ['ttc'];
const EMPTY_VEHICLES: Vehicle[] = [];
const factText = (value: unknown, fallback: string) => {
  if (value == null) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value.toString();
  return JSON.stringify(value) ?? fallback;
};
const safe = (url?: string) => {
  try {
    const u = new URL(url || '');
    return u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
};
export default function VehicleTracker({
  t,
  divisionMode = false,
  onFollow,
}: {
  t: (a: string, b: string) => string;
  divisionMode?: boolean;
  onFollow?: (vehicle: Vehicle) => void;
}) {
  const [snapshot, setData] = useState<(Snapshot & { scope: string }) | null>(
      null,
    ),
    [pageSelection, setPageSelection] = useState({ scope: '', page: 0 }),
    [search, setSearch] = useState(emptySearchState),
    [route, setRoute] = useState(''),
    [agency, setAgency] = useState(divisionMode ? 'ttc' : 'all'),
    [classification, setClassification] = useState('out-of-division'),
    [detailRequest, setDetailRequest] = useState(0),
    [selectedRecord, setSelected] = useState<Vehicle | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0),
    [tileError, setTileError] = useState(false);
  const sourceScope = JSON.stringify([agency, route, divisionMode, classification]);
  const filterStorageKey = divisionMode ? 'gtha-division-fleet-filters' : 'gtha-tracker-fleet-filters';
  const savedFilter = useLocalSetting(filterStorageKey);
  const restoredFilter = useMemo(() => {
    if (!savedFilter.value) return { value: emptyFleetFilter(), invalid: false };
    try {
      const saved = JSON.parse(savedFilter.value), value = saved?.schemaVersion === 1 ? saved.filter : null;
      if (value && ['manufacturer', 'model', 'yearFrom', 'yearTo'].every(key => typeof value[key] === 'string' && value[key].length <= 100) && typeof value.includeUnknown === 'boolean') {
        return { value: { manufacturer: value.manufacturer.trim(), model: value.model.trim(), yearFrom: value.yearFrom.trim(), yearTo: value.yearTo.trim(), includeUnknown: value.includeUnknown }, invalid: false };
      }
    } catch {}
    return { value: emptyFleetFilter(), invalid: true };
  }, [savedFilter.value]);
  const fleetFilter = restoredFilter.value;
  const setFleetFilter = (filter: typeof fleetFilter) => savedFilter.setValue(JSON.stringify({ schemaVersion: 1, filter }));
  const filterStorageUnavailable = savedFilter.unavailable || restoredFilter.invalid;
  const scope = JSON.stringify([sourceScope, search, fleetFilter]);
  const sourceData = snapshot?.scope === sourceScope ? snapshot : null;
  const fleetResult = useMemo(() => filterFleetVehicles(sourceData?.vehicles ?? EMPTY_VEHICLES, fleetFilter), [sourceData, fleetFilter]);
  const samples = useMemo(() => fleetResult.vehicles.map(vehicle => [vehicle.id, vehicle.fleetNumber, vehicle.label, vehicle.agencyId, vehicle.agencyName, vehicle.routeId, vehicle.cptdb?.manufacturer, vehicle.cptdb?.model, vehicle.cptdb?.year].filter(Boolean).join(' ').slice(0, 512)), [fleetResult.vehicles]);
  const matching = useSearchMatches(samples, search);
  const filterError = fleetResult.error === 'Select a manufacturer before filtering by model.' ? t(fleetResult.error, '請先選擇製造商，再篩選型號。') : fleetResult.error === 'Enter a whole year from 1800 through 3000.' ? t(fleetResult.error, '請輸入 1800 至 3000 之間嘅完整年份。') : fleetResult.error === 'The start year must be the same as or earlier than the end year.' ? t(fleetResult.error, '開始年份必須早於或等於結束年份。') : fleetResult.error;
  const data = useMemo(() => sourceData ? { ...sourceData, vehicles: matching.busy || matching.error || fleetResult.error ? [] : fleetResult.vehicles.filter((_, index) => matching.matches[index]) } : null, [sourceData, fleetResult, matching.busy, matching.error, matching.matches]);
  const selected = selectedRecord ? data?.vehicles.find(vehicle => identity(vehicle) === identity(selectedRecord)) ?? null : null;
  const page = vehiclePage(
    data?.vehicles ?? [],
    pageSelection.scope === scope ? pageSelection.page : 0,
  );
  const el = useRef<HTMLDivElement>(null),
    detail = useRef<HTMLElement>(null),
    map = useRef<LeafletMap | null>(null),
    markers = useRef<LayerGroup | null>(null),
    pick = useRef<(v: Vehicle) => void>(() => {});
  useEffect(() => {
    pick.current = (vehicle) => {
      setSelected(vehicle);
      setDetailRequest((count) => count + 1);
      const index =
        data?.vehicles.findIndex(
          (item) => identity(item) === identity(vehicle),
        ) ?? -1;
      if (index >= 0)
        setPageSelection({ scope, page: Math.floor(index / 100) });
    };
  }, [data, scope]);
  useEffect(() => {
    const panel = detail.current;
    if (!detailRequest || !panel) return;
    const headerHeight =
      document.querySelector('header')?.getBoundingClientRect().height ?? 0;
    panel.style.scrollMarginTop = `${headerHeight + 16}px`;
    panel.focus({ preventScroll: true });
    panel.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [detailRequest]);
  useEffect(() => {
    let disposed = false;
    let stopTiles: (() => void) | undefined;
    let resize: ResizeObserver;
    void import('leaflet').then((L) => {
      if (disposed || !el.current) return;
      map.current = L.map(el.current, { preferCanvas: true }).setView(
        [43.72, -79.4],
        11,
      );
      stopTiles = attachMapTiles(L, map.current, setTileError);
      markers.current = L.layerGroup().addTo(map.current);
      resize = new ResizeObserver(() => map.current?.invalidateSize());
      resize.observe(el.current);
    });
    return () => {
      disposed = true;
      stopTiles?.();
      resize?.disconnect();
      map.current?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const c = new AbortController();
    let active = false;
    const load = async () => {
      if (active) return;
      active = true;
      setBusy(true);
      try {
        const p = new URLSearchParams({ limit: '2500', agency });
        if (route) p.set('route', route);
        if (divisionMode) p.set('classification', classification);
        const endpoint = divisionMode ? '/api/vehicles/divisions?' : '/api/vehicles?';
        const r = await fetch(endpoint + p, { signal: c.signal });
        if (!r.ok)
          throw Error(
            t(
              'Vehicle tracking is temporarily unavailable.',
              '暫時無法追蹤車輛。',
            ),
          );
        const next = (await r.json()) as Snapshot;
        const cursors = new Set<string>();
        for (let batch = 1; next.nextCursor && batch < 4; batch++) {
          if (cursors.has(next.nextCursor))
            throw new Error(
              t(
                'Vehicle pagination could not complete.',
                '未能完成車輛分頁載入。',
              ),
            );
          cursors.add(next.nextCursor);
          p.set('cursor', next.nextCursor);
          const response = await fetch(endpoint + p, {
            signal: c.signal,
          });
          if (!response.ok)
            throw new Error(
              t(
                'Vehicle pagination could not complete.',
                '未能完成車輛分頁載入。',
              ),
            );
          const chunk = (await response.json()) as Snapshot;
          next.vehicles.push(...chunk.vehicles);
          next.nextCursor = chunk.nextCursor;
        }
        next.vehicles = [
          ...new Map(
            next.vehicles.map((vehicle) => [identity(vehicle), vehicle]),
          ).values(),
        ].sort(
          (a, b) =>
            (a.fleetNumber || a.id).localeCompare(b.fleetNumber || b.id, 'en', {
              numeric: true,
            }) || a.id.localeCompare(b.id),
        );
        if (!c.signal.aborted) {
          setData({ ...next, scope: sourceScope });
          setError('');
          setSelected((prev) =>
            prev
              ? next.vehicles.find((v) => identity(v) === identity(prev)) ||
                null
              : null,
          );
        }
      } catch (e) {
        if (!c.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : t('Unable to refresh vehicles.', '未能更新車輛。'),
          );
      } finally {
        active = false;
        if (!c.signal.aborted) setBusy(false);
      }
    };
    const first = setTimeout(() => void load(), 250),
      timer = setInterval(() => void load(), 20000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      c.abort();
    };
  }, [route, refresh, t, agency, sourceScope, divisionMode, classification]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const draw = async () => {
      const L = await import('leaflet');
      if (stopped) return;
      if (!markers.current) {
        timer = setTimeout(() => void draw(), 150);
        return;
      }
      markers.current.clearLayers();
      for (const v of data?.vehicles || []) {
        if (
          !Number.isFinite(v.lat) ||
          !Number.isFinite(v.lon) ||
          Math.abs(v.lat) > 90 ||
          Math.abs(v.lon) > 180
        )
          continue;
        const label = document.createElement('span');
        label.textContent = `${v.agencyName || v.agencyId || 'TTC'} · ${v.fleetNumber || v.label || v.id} · ${v.routeId || 'Route unknown'}`;
        const summary = document.createElement('div');
        summary.className = 'vehicle-map-summary';
        const title = document.createElement('strong');
        title.textContent = `${t('Vehicle', '車輛')} ${v.fleetNumber || v.label || v.id}`;
        const routeLine = document.createElement('p');
        routeLine.textContent = `${t('Route', '路線')} ${v.routeId || t('Unknown', '未知')}`;
        const equipment = document.createElement('p');
        equipment.textContent =
          [v.cptdb?.manufacturer, v.cptdb?.model, v.cptdb?.year]
            .filter(Boolean)
            .join(' · ') || t('Fleet details unverified', '車隊資料未核實');
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'pill';
        more.textContent = t('More details', '更多資料');
        more.addEventListener('click', () => pick.current(v));
        for (const child of [title, routeLine, equipment, more])
          summary.appendChild(child);
        L.circleMarker([v.lat, v.lon], {
          radius: identity(selected) === identity(v) ? 9 : 5,
          color: v.stale
            ? '#877659'
            : agencyColors[v.agencyId || 'ttc'] || '#153e31',
          weight: 2,
          fillColor:
            identity(selected) === identity(v)
              ? '#d2f574'
              : v.stale
                ? '#aaa'
                : agencyColors[v.agencyId || 'ttc'] || '#348b67',
          fillOpacity: 0.9,
        })
          .bindTooltip(label)
          .bindPopup(summary, { maxWidth: 280, minWidth: 160 })
          .addTo(markers.current);
      }
    };
    void draw();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [data, selected, t]);
  const choose = (v: Vehicle) => {
    pick.current(v);
    map.current?.setView([v.lat, v.lon], Math.max(map.current.getZoom(), 14));
  };
  const observed = (v: Vehicle) => {
    if (!v.timestamp) return t('Observation time unavailable', '未有觀察時間');
    const n =
      typeof v.timestamp === 'number' && v.timestamp < 1e12
        ? v.timestamp * 1000
        : v.timestamp;
    const d = new Date(n);
    return Number.isNaN(d.getTime())
      ? t('Observation time unavailable', '未有觀察時間')
      : d.toLocaleTimeString('en-CA', {
          timeZone: 'America/Toronto',
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
        });
  };
  return (
    <div className="page-panel tracker">
      <div className="tracker-filters">
        <RoutePicker agency={agency} route={route} t={t} storageId={divisionMode ? 'division-route-picker' : 'tracker-route-picker'} allowedAgencyIds={divisionMode ? TTC_ONLY : undefined} onChange={(nextAgency, nextRoute) => {
          setAgency(nextAgency); setRoute(nextRoute); setSelected(null);
        }} />
        <SearchWorkbench storageId={divisionMode ? 'division-vehicle-search' : 'tracker-vehicle-search'} label={t('Vehicle, route or fleet details', '車輛、路線或車隊資料')} value={search} onChange={setSearch} samples={samples} t={t} />
        <button type="button" className="pill tracker-refresh" disabled={busy} onClick={() => setRefresh((x) => x + 1)} aria-label={t('Refresh vehicle positions', '重新整理車輛位置')}><RefreshCw size={16} aria-hidden="true" /><span>{t('Refresh', '重新整理')}</span></button>
      </div>
      {filterStorageUnavailable && <p className="data-note">{t('This browser could not restore or save fleet filters. Current filtering still works.', '此瀏覽器未能還原或儲存車隊篩選，目前篩選仍然可用。')}</p>}
      {matching.error && <p className="error" role="alert">{matching.error}</p>}
      {matching.busy && <output className="data-note">{t('Matching loaded vehicles…', '配對已載入車輛中…')}</output>}
      {fleetResult.active && !fleetResult.error && <p className="data-note">{t('Fleet filters apply to both the map and list.', '車隊篩選同時套用到地圖同清單。')} {fleetResult.excludedUnknownCount > 0 && t(`${fleetResult.excludedUnknownCount} vehicles lack details needed for this filter. Enable the unconfirmed option to include them.`, `${fleetResult.excludedUnknownCount} 架車未有所需資料。啟用未確認選項可包括佢哋。`)}</p>}
      {divisionMode && <section className="division-overview" aria-label={t('Garage assignment filters', '車廠分配篩選')}>
        <p>{t('Compare a verified vehicle home garage with the garages assigned to its route. Ambiguous and expired evidence stays unconfirmed.', '比較已核實車輛所屬車廠同路線分配車廠。模糊或過期資料保持未確認。')}</p>
        <fieldset className="division-filter-chips" aria-label={t('Assignment classification', '配車分類')}>
          {[
            ['out-of-division', t('Out of division', '跨車廠'), data?.counts?.outOfDivision],
            ['in-division', t('Assigned garage', '原定車廠'), data?.counts?.inDivision],
            ['unknown', t('Unconfirmed', '未確認'), data?.counts?.unknown],
            ['all', t('All TTC vehicles', '所有 TTC 車輛'), data?.counts?.all],
          ].map(([id, label, count]) => <button key={String(id)} className="pill" aria-pressed={classification === id} onClick={() => { setClassification(String(id)); setSelected(null); }}>{label}{typeof count === 'number' && <strong>{count}</strong>}</button>)}
        </fieldset>
        <p className="data-note">{t('Allocation source valid through', '配車來源有效至')} {data?.source?.validThrough || t('Unconfirmed', '未確認')}. {t('Counts describe all loaded TTC vehicles before route and text filters. Rarity needs at least seven observed days and is not a prediction.', '數量係路線同文字篩選前已載入嘅全部 TTC 車輛。稀有度需要最少七日觀察，唔係預測。')}</p>
      </section>}
      <div className="source-state">
        <span className="live-dot" />
        {data?.state === 'live'
          ? t('Live feed connected', '已連接即時資料')
          : data?.state === 'partial'
            ? t(
                'Some feeds unavailable; check agency status',
                '部分資料未能使用，請查看交通公司狀態',
              )
            : t('Current positions unconfirmed', '目前位置未能確認')}
        <small>
          {data
            ? `${data.vehicles.length} / ${data.total} ` +
              t('vehicles shown', '架車輛顯示中')
            : t('Connecting…', '連接中…')}
        </small>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div
        className="vehicle-map"
        ref={el}
        aria-label={t(
          'Live vehicle map. The list below provides an accessible alternative.',
          '即時車輛地圖，下方清單提供無障礙替代。',
        )}
      />
      <FleetFilterPanel vehicles={sourceData?.vehicles ?? EMPTY_VEHICLES} value={fleetFilter} onChange={setFleetFilter} error={filterError} storageId={divisionMode ? 'division-fleet-filter' : 'tracker-fleet-filter'} t={t} />
      <details className="source-details">
        <summary>{t('About these positions and agency feeds', '關於車輛位置同交通公司資料')}</summary>
        <p>{t('Reported vehicle locations from official agency feeds. Select a marker or list entry for fleet details. Vehicles absent from the feed cannot be tracked.', '官方交通公司資料通報嘅車輛位置。揀地圖標記或清單車輛查看車隊資料。來源無提供嘅車輛未能追蹤。')}</p>
        {data?.agencies && <div className="agency-legend" aria-label={t('Agency colours and feed status', '交通公司顏色及資料狀態')}>
          {data.agencies.map(item => <span key={item.id} style={{ borderLeft: `5px solid ${agencyColors[item.id] || '#777'}` }}>{item.name} · {item.total} · {item.state}</span>)}
        </div>}
      </details>
      {tileError && (
        <p className="data-note">
          {t(
            'Some base map tiles are unavailable. Vehicle coordinates and the list remain usable.',
            '部分底圖未能提供，車輛座標同清單仍然可用。',
          )}
        </p>
      )}
      {data && selected && (
        <section
          ref={detail}
          tabIndex={-1}
          className="vehicle-detail"
          aria-label={t('Selected vehicle details', '所選車輛資料')}
        >
          <div className="content-heading">
            <h3>
              <BusFront size={22} /> {t('Vehicle', '車輛')}{' '}
              {selected.fleetNumber || selected.label || selected.id}
            </h3>
            <button
              className="icon-button"
              onClick={() => setSelected(null)}
              aria-label={t('Close vehicle details', '關閉車輛資料')}
            >
              <X size={18} />
            </button>
          </div>
          <div className="vehicle-facts">
            {onFollow && <button type="button" className="pill" onClick={() => onFollow(selected)}>{t('Follow this vehicle', '跟隨此車輛')}</button>}
            {selected.division && <>
              <span><small>{t('Home garage', '所屬車廠')}</small><strong>{selected.division.homeGarageName || t('Unconfirmed', '未確認')}</strong></span>
              <span><small>{t('Route garages', '路線車廠')}</small><strong>{selected.division.assignedGarageNames?.join(', ') || t('Unconfirmed', '未確認')}</strong></span>
              <span><small>{t('Observed frequency', '已觀察頻率')}</small><strong>{selected.division.rarity?.eligible ? `${selected.division.rarity.percentage?.toFixed(1)}% · ${selected.division.rarity.rarity}` : t('Collecting observations', '收集觀察資料中')}</strong><small>{selected.division.rarity?.sample ? `${selected.division.rarity.sample.vehicleRouteDays} / ${selected.division.rarity.sample.routeObservedDays} ` + t('observed route days', '路線觀察日') : t('History unavailable', '未有歷史資料')}</small></span>
            </>}
            <span>
              <small>{t('Route', '路線')}</small>
              <strong>{selected.routeId || t('Unknown', '未知')}</strong>
            </span>
            <span>
              <small>{t('Manufacturer', '製造商')}</small>
              <strong>
                {selected.cptdb?.manufacturer || t('Unverified', '未核實')}
              </strong>
            </span>
            <span>
              <small>{t('Model', '型號')}</small>
              <strong>
                {selected.cptdb?.model || t('Unverified', '未核實')}
              </strong>
            </span>
            <span>
              <small>{t('Build year', '製造年份')}</small>
              <strong>
                {selected.cptdb?.year || t('Unverified', '未核實')}
              </strong>
            </span>
          </div>
          {selected.division?.state === 'unknown' && <p className="division-evidence-note">{selected.division.reason === 'allocation-source-expired'
            ? t('The official allocation source is outside its validity dates. A new source is needed to verify this assignment.', '官方配車來源已過有效日期，需要新資料先可以核實。')
            : selected.division.reason === 'multi-garage-fleet-allocation'
              ? t('This fleet series belongs to more than one garage, so this unit’s home garage cannot be confirmed from the series alone.', '呢個車隊系列分配到多個車廠，單靠系列未能核實呢架車嘅所屬車廠。')
              : t('The available route, fleet or observation evidence is insufficient to verify this garage assignment.', '現有路線、車隊或位置資料不足以核實呢個車廠分配。')}</p>}
          <p className="data-note">
            <Clock size={14} /> {t('Last observed', '最後觀察')}{' '}
            {observed(selected)} ·{' '}
            {selected.stale
              ? t('Stale position', '位置已過時')
              : t('Reported position', '通報位置')}
          </p>
          <div className="vehicle-facts">
            {[
              [t('Propulsion', '動力'), selected.cptdb?.propulsion],
              [t('Length', '車長'), selected.cptdb?.length],
              [t('Capacity', '容量'), selected.cptdb?.capacity],
              [t('Fleet series', '車隊系列'), selected.cptdb?.fleetRange],
            ]
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <span key={k}>
                  <small>{k}</small>
                  <strong>{v}</strong>
                </span>
              ))}
          </div>
          {selected.cptdb?.details && (
            <dl className="fleet-details">
              {Object.entries(selected.cptdb.details).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                    <dd>{factText(v, t('Unknown', '未知'))}</dd>
                </div>
              ))}
            </dl>
          )}
          {selected.photo && safe(selected.photo.url) ? (
            <figure>
              <Image unoptimized width={960} height={720}
                src={
                  '/api/vehicle-photo?source=' +
                  encodeURIComponent(selected.photo.url)
                }
                alt={`${selected.photo.exactVehicle ? t('Vehicle', '車輛') : t('Representative fleet photo', '車隊示意照片')} ${selected.fleetNumber || selected.label || selected.id}`}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
              <VehiclePhotoCaption photo={selected.photo} t={t} />
            </figure>
          ) : (
            <p className="data-note">
              {t('No verified photo available.', '未有經核實可用照片。')}
            </p>
          )}
          {safe(selected.cptdb?.url) && (
            <a
              className="source-link"
              href={safe(selected.cptdb?.url)}
              target="_blank"
              rel="noreferrer"
            >
              {selected.cptdb?.match === 'search'
                ? t('Search CPTDB for this vehicle', '喺 CPTDB 搜尋呢架車')
                : t('View CPTDB fleet source', '查看 CPTDB 車隊來源')}
              <ExternalLink size={15} />
            </a>
          )}
        </section>
      )}
      <div
        className="vehicle-list"
        aria-label={t('Reported vehicles', '已通報車輛')}
      >
        {data && !busy && !matching.busy && !matching.error && !fleetResult.error && !data.vehicles.length && <output>{t('No vehicles match these filters. Clear a filter or refresh the feed.', '未有車輛符合篩選。清除篩選或重新整理資料。')}</output>}
        {page.items.map((v) => (
          <button
            key={identity(v)}
            className="vehicle-row"
            style={{
              borderLeft: `5px solid ${agencyColors[v.agencyId || 'ttc'] || '#777'}`,
            }}
            onClick={() => choose(v)}
            aria-pressed={identity(selected) === identity(v)}
          >
            <span className="vehicle-row-main">
              <BusFront size={18} />
              <strong>{v.fleetNumber || v.label || v.id}</strong>
              <span className="vehicle-route-badge">
                {t('Route', '路線')} {v.routeId || '?'}
              </span>
              {superExpressFor({ agency: v.agencyName, route: v.routeId, headsign: null }) && (
                <SuperExpressBadge match={superExpressFor({ agency: v.agencyName, route: v.routeId, headsign: null })!} t={t} />
              )}
              <ChevronRight size={16} />
            </span>
            <span className="vehicle-row-agency">
              {v.agencyName || v.agencyId?.toUpperCase() || 'TTC'}
            </span>
            <span className="vehicle-row-spec">
              {[v.cptdb?.manufacturer, v.cptdb?.model]
                .filter(Boolean)
                .join(' · ') || t('Details unverified', '資料未核實')}
            </span>
            <span className="vehicle-row-year">
              {t('Built', '製造年份')} {v.cptdb?.year || t('Unknown', '未核實')}
            </span>
            {v.division && <span className="vehicle-row-division">{v.division.state === 'out-of-division' ? t('Out of division', '跨車廠') : v.division.state === 'in-division' ? t('Assigned garage', '原定車廠') : t('Assignment unconfirmed', '配車未確認')} · {v.division.homeGarageName || t('Unknown garage', '未知車廠')}</span>}
          </button>
        ))}
      </div>
      {data?.nextCursor && (
        <p className="data-note">
          {t(
            'The feed exceeds the 10,000-vehicle loading limit. Narrow your search to reach additional matches.',
            '資料超過 10,000 架車嘅載入上限，請收窄搜尋以查看其他結果。',
          )}
        </p>
      )}
      {data && data.vehicles.length > 0 && (
        <nav
          aria-label={t('Vehicle list pages', '車輛清單分頁')}
          className="tracker-pagination"
        >
          <button
            className="pill"
            disabled={page.page === 0}
            onClick={() => setPageSelection({ scope, page: page.page - 1 })}
          >
            {t('Previous', '上一頁')}
          </button>
          <p className="data-note" aria-live="polite">
            {page.start + 1}–{page.end} / {data.vehicles.length} ·{' '}
            {t('Page', '頁')} {page.page + 1} / {page.pageCount}
          </p>
          <button
            className="pill"
            disabled={page.page + 1 >= page.pageCount}
            onClick={() => setPageSelection({ scope, page: page.page + 1 })}
          >
            {t('Next', '下一頁')}
          </button>
        </nav>
      )}
    </div>
  );
}
