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
import { attachMapTiles } from '../lib/map-tiles';
type Vehicle = {
  id: string;
  label?: string;
  fleetNumber?: string;
  routeId?: string;
  lat: number;
  lon: number;
  bearing?: number;
  speedKph?: number;
  timestamp?: string | number;
  stale?: boolean;
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
}: {
  t: (a: string, b: string) => string;
}) {
  const [data, setData] = useState<Snapshot | null>(null),
    [q, setQ] = useState(''),
    [route, setRoute] = useState(''),
    [agency, setAgency] = useState('ttc'),
    [selected, setSelected] = useState<Vehicle | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0),
    [tileError, setTileError] = useState(false);
  const el = useRef<HTMLDivElement>(null),
    map = useRef<LeafletMap | null>(null),
    markers = useRef<LayerGroup | null>(null),
    pick = useRef<(v: Vehicle) => void>(() => {});
  useEffect(() => {
    pick.current = setSelected;
  }, []);
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
        const r = await fetch('/api/vehicles?' + p, { signal: c.signal });
        if (!r.ok)
          throw Error(
            t(
              'Vehicle tracking is temporarily unavailable.',
              '暫時無法追蹤車輛。',
            ),
          );
        const next = (await r.json()) as Snapshot;
        if (!c.signal.aborted) {
          setData(next);
          setError('');
          setSelected((prev) =>
            prev ? next.vehicles.find((v) => v.id === prev.id) || prev : null,
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
  }, [q, route, refresh, t, agency]);
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
        label.textContent = `${v.fleetNumber || v.label || v.id} · ${v.routeId || 'Route unknown'}`;
        L.circleMarker([v.lat, v.lon], {
          radius: selected?.id === v.id ? 9 : 5,
          color: v.stale ? '#877659' : '#153e31',
          weight: 2,
          fillColor:
            selected?.id === v.id ? '#d2f574' : v.stale ? '#aaa' : '#348b67',
          fillOpacity: 0.9,
        })
          .bindTooltip(label)
          .on('click', () => pick.current(v))
          .addTo(markers.current);
      }
    };
    void draw();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [data, selected]);
  const choose = (v: Vehicle) => {
    setSelected(v);
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
          <h2>{t('Live vehicle tracker', '即時車輛追蹤')}</h2>
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
        <label>
          {t('Transit agency', '交通公司')}
          <select
            value={agency}
            onChange={(e) => {
              setAgency(e.target.value);
              setSelected(null);
            }}
          >
            {[
              ['ttc', 'TTC'],
              ['go', 'GO Transit'],
              ['up', 'UP Express'],
              ['miway', 'MiWay'],
              ['burlington', 'Burlington Transit'],
              ['hsr', 'HSR'],
            ].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
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
        <label>
          {t('Route', '路線')}
          <input
            value={route}
            list="tracker-routes"
            onChange={(e) => setRoute(e.target.value)}
            maxLength={20}
            placeholder={t('All routes', '全部路線')}
          />
          <datalist id="tracker-routes">
            {[
              ...new Set(
                (data?.vehicles || []).map((v) => v.routeId).filter(Boolean),
              ),
            ]
              .sort()
              .map((id) => (
                <option key={id} value={id} />
              ))}
          </datalist>
        </label>
      </div>
      <div className="source-state">
        <span className="live-dot" />
        {data?.state === 'live'
          ? t('Live feed connected', '已連接即時資料')
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
      {tileError && (
        <p className="data-note">
          {t(
            'Some base map tiles are unavailable. Vehicle coordinates and the list remain usable.',
            '部分底圖未能提供，車輛座標同清單仍然可用。',
          )}
        </p>
      )}
      {selected && (
        <section
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
        aria-label={t('Reported TTC vehicles', '已通報 TTC 車輛')}
      >
        {data?.vehicles.slice(0, 100).map((v) => (
          <button
            key={v.id}
            onClick={() => choose(v)}
            aria-pressed={selected?.id === v.id}
          >
            <BusFront size={18} />
            <strong>{v.fleetNumber || v.label || v.id}</strong>
            <span>
              {t('Route', '路線')} {v.routeId || '?'}
            </span>
            <small>
              {v.cptdb?.model || t('Details unverified', '資料未核實')}
            </small>
            <ChevronRight size={16} />
          </button>
        ))}
      </div>
      {data && data.vehicles.length > 100 && (
        <p className="data-note">
          {t(
            'The map shows up to 2,500 matches; the list shows the first 100. Narrow the route or fleet search to find a specific vehicle.',
            '地圖最多顯示 2,500 個結果，清單顯示首 100 個。請收窄路線或車隊搜尋以搵指定車輛。',
          )}
        </p>
      )}
    </div>
  );
}
