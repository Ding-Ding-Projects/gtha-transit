'use client';
import { useEffect, useRef, useState } from 'react';
import {
  BusFront,
  ChevronRight,
  Clock,
  ExternalLink,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
import VehiclePhotoCaption from './vehicle-photo-caption';
import RoutePicker from './route-picker';
import { attachMapTiles } from '../lib/map-tiles';
import { vehiclePage } from '../lib/vehicle-page';
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
}: {
  t: (a: string, b: string) => string;
  divisionMode?: boolean;
}) {
  const [snapshot, setData] = useState<(Snapshot & { scope: string }) | null>(
      null,
    ),
    [pageSelection, setPageSelection] = useState({ scope: '', page: 0 }),
    [q, setQ] = useState(''),
    [route, setRoute] = useState(''),
    [agency, setAgency] = useState(divisionMode ? 'ttc' : 'all'),
    [classification, setClassification] = useState('out-of-division'),
    [detailRequest, setDetailRequest] = useState(0),
    [selected, setSelected] = useState<Vehicle | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0),
    [tileError, setTileError] = useState(false);
  const scope = JSON.stringify([agency, q, route, divisionMode, classification]);
  const data = snapshot?.scope === scope ? snapshot : null;
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
        if (q) p.set('q', q);
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
          setData({ ...next, scope });
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
  }, [q, route, refresh, t, agency, scope]);
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
      <div className="content-heading">
        <div>
          <span className="eyebrow">{t('FOLLOW THE FLEET', '追蹤車隊')}</span>
          <h2>{divisionMode ? t('Out-of-division vehicles', '跨車廠車輛') : t('Live vehicle tracker', '即時車輛追蹤')}</h2>
        </div>
        <button
          className="pill"
          disabled={busy}
          onClick={() => setRefresh((x) => x + 1)}
        >
          <RefreshCw size={16} />
          {t('Refresh', '重新整理')}
        </button>
      </div>
      <p>
        {t(
          'Reported vehicle locations from official agency feeds. Select a marker or list entry for fleet details. Vehicles absent from the feed cannot be tracked.',
          '官方交通公司資料通報嘅車輛位置。揀地圖標記或清單車輛查看車隊資料。來源無提供嘅車輛未能追蹤。',
        )}
      </p>
      <div className="tracker-filters">
        <RoutePicker agency={agency} route={route} t={t} storageId={divisionMode ? 'division-route-picker' : 'tracker-route-picker'} allowedAgencyIds={divisionMode ? TTC_ONLY : undefined} onChange={(nextAgency, nextRoute) => {
          setAgency(nextAgency); setRoute(nextRoute); setSelected(null);
        }} />
        <label>
          <Search size={16} />
          {t('Vehicle or fleet details', '車輛或車隊資料')}
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={100}
            placeholder={t(
              'Fleet number, manufacturer, model',
              '車隊編號、製造商、型號',
            )}
          />
        </label>
      </div>
      {divisionMode && <section className="division-overview" aria-label={t('Garage assignment filters', '車廠分配篩選')}>
        <p>{t('Compare a verified vehicle home garage with the garages assigned to its route. Ambiguous and expired evidence stays unconfirmed.', '比較已核實車輛所屬車廠同路線分配車廠。模糊或過期資料保持未確認。')}</p>
        <div className="division-filter-chips" role="group" aria-label={t('Assignment classification', '配車分類')}>
          {[
            ['out-of-division', t('Out of division', '跨車廠'), data?.counts?.outOfDivision],
            ['in-division', t('Assigned garage', '原定車廠'), data?.counts?.inDivision],
            ['unknown', t('Unconfirmed', '未確認'), data?.counts?.unknown],
            ['all', t('All TTC vehicles', '所有 TTC 車輛'), data?.counts?.all],
          ].map(([id, label, count]) => <button key={String(id)} className="pill" aria-pressed={classification === id} onClick={() => { setClassification(String(id)); setSelected(null); }}>{label}{typeof count === 'number' && <strong>{count}</strong>}</button>)}
        </div>
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
      {data?.agencies && (
        <div
          className="agency-legend"
          aria-label={t(
            'Agency colours and feed status',
            '交通公司顏色及資料狀態',
          )}
        >
          {data.agencies.map((item) => (
            <span
              key={item.id}
              style={{
                borderLeft: `5px solid ${agencyColors[item.id] || '#777'}`,
              }}
            >
              {item.name} · {item.total} · {item.state}
            </span>
          ))}
        </div>
      )}
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
                  <dd>{String(v ?? t('Unknown', '未知'))}</dd>
                </div>
              ))}
            </dl>
          )}
          {selected.photo && safe(selected.photo.url) ? (
            <figure>
              <img
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
