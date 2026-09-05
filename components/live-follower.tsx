'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BusFront,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Pause,
  Play,
  RefreshCw,
  X,
} from 'lucide-react';
import type { LayerGroup, Map as LeafletMap } from 'leaflet';
import type { Itinerary } from '../lib/types';
import {
  buildTripStopTimeline,
  exactReportedVehicle,
  positionTimestampMilliseconds,
  previewTimelineStop,
  publisherNextStopId,
  reportedPositionState,
  type TripProgressPlace,
  type TripProgressStop,
} from '../lib/trip-progress';
import { attachMapTiles } from '../lib/map-tiles';
import 'leaflet/dist/leaflet.css';

const LIVE_POLL_MS = 20_000;
const FETCH_DEADLINE_MS = 8_000;
const PREVIEW_STEP_MS = 4_500;

export type LiveFollowerVehicle = {
  id: string;
  agencyId?: string;
  agencyName?: string;
  label?: string;
  fleetNumber?: string;
  routeId?: string;
  lat?: number;
  lon?: number;
  bearing?: number;
  speedKph?: number;
  timestamp?: string | number;
  stale?: boolean;
  stopId?: string;
  stopStatus?: string;
  nextStopId?: string;
};

export type LiveFollowerWashroomTarget = {
  name: string;
  etaSeconds: number;
  availability: 'confirmed-open' | 'unknown';
  note?: string;
};

export type LiveFollowerProps = {
  journey?: Itinerary;
  vehicle?: LiveFollowerVehicle | null;
  onClose: () => void;
  t: (english: string, cantonese: string) => string;
  onAnnounce?: (message: { en: string; zh: string }) => void;
  onChooseVehicle?: () => void;
  onWashroomRequest?: (request: {
    position?: { lat: number; lon: number; timestamp: number };
    legIndex: number;
  }) => void;
  washroomTarget?: LiveFollowerWashroomTarget | null;
};

type FollowerMode = 'trip' | 'vehicle';
type LiveSnapshot = {
  state: string;
  fetchedAt: string | null;
  vehicle: LiveFollowerVehicle | null;
};
type LocalPosition = { lat: number; lon: number; timestamp: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const text = (value: unknown, limit = 200): string | undefined =>
  typeof value === 'string' && value.trim()
    ? value.trim().slice(0, limit)
    : undefined;

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const validCoordinates = (value: { lat?: unknown; lon?: unknown } | null) => {
  const lat = finite(value?.lat);
  const lon = finite(value?.lon);
  return (
    lat !== undefined &&
    lon !== undefined &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
};

const vehicleIdentity = (vehicle: Pick<LiveFollowerVehicle, 'agencyId' | 'id'>) =>
  `${vehicle.agencyId || 'ttc'}:${vehicle.id}`;

const vehicleFromUnknown = (value: unknown): LiveFollowerVehicle | null => {
  if (!isRecord(value)) return null;
  const id = text(value.id, 128);
  if (!id) return null;

  const numeric = (field: string) => finite(value[field]);
  const timestamp = value.timestamp;
  return {
    id,
    ...(text(value.agencyId, 80) ? { agencyId: text(value.agencyId, 80) } : {}),
    ...(text(value.agencyName, 160)
      ? { agencyName: text(value.agencyName, 160) }
      : {}),
    ...(text(value.label, 160) ? { label: text(value.label, 160) } : {}),
    ...(text(value.fleetNumber, 160)
      ? { fleetNumber: text(value.fleetNumber, 160) }
      : {}),
    ...(text(value.routeId, 160) ? { routeId: text(value.routeId, 160) } : {}),
    ...(numeric('lat') !== undefined ? { lat: numeric('lat') } : {}),
    ...(numeric('lon') !== undefined ? { lon: numeric('lon') } : {}),
    ...(numeric('bearing') !== undefined ? { bearing: numeric('bearing') } : {}),
    ...(numeric('speedKph') !== undefined
      ? { speedKph: numeric('speedKph') }
      : {}),
    ...(typeof timestamp === 'string' || typeof timestamp === 'number'
      ? { timestamp }
      : {}),
    ...(value.stale === true ? { stale: true } : {}),
    ...(text(value.stopId, 160) ? { stopId: text(value.stopId, 160) } : {}),
    ...(text(value.stopStatus, 160)
      ? { stopStatus: text(value.stopStatus, 160) }
      : {}),
    ...(text(value.nextStopId, 160)
      ? { nextStopId: text(value.nextStopId, 160) }
      : {}),
  };
};

const timeLabel = (value: string | number | undefined, unavailable: string) => {
  const milliseconds = positionTimestampMilliseconds(value);
  if (milliseconds === null) return unavailable;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime())
    ? unavailable
    : date.toLocaleTimeString('en-CA', {
        timeZone: 'America/Toronto',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      });
};

const stopName = (stop: TripProgressPlace | null | undefined, fallback: string) =>
  text(stop?.name, 240) || fallback;

const mapPoint = (value: { lat?: unknown; lon?: unknown } | null) =>
  validCoordinates(value)
    ? ([Number(value?.lat), Number(value?.lon)] as [number, number])
    : null;

const previewStorageKey = (journeyId: string | undefined) =>
  `gtha-live-follower-preview:${journeyId || 'unknown'}`;

export default function LiveFollower({
  journey,
  vehicle,
  onClose,
  t,
  onAnnounce,
  onChooseVehicle,
  onWashroomRequest,
  washroomTarget,
}: LiveFollowerProps) {
  const timeline = useMemo(
    () => (journey ? buildTripStopTimeline(journey) : buildTripStopTimeline(null)),
    [journey],
  );
  const requestedAgency = vehicle?.agencyId || 'ttc';
  const requestedVehicleId = vehicle?.id || '';
  const requestedVehicleKey = vehicle ? vehicleIdentity(vehicle) : '';
  const initialMode: FollowerMode = journey ? 'trip' : 'vehicle';
  const [mode, setMode] = useState<FollowerMode>(initialMode);
  const [now, setNow] = useState(() => Date.now());
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [liveError, setLiveError] = useState('');
  const [loadingLive, setLoadingLive] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [localPosition, setLocalPosition] = useState<LocalPosition | null>(null);
  const [locationStatus, setLocationStatus] = useState('');
  const [tileError, setTileError] = useState(false);
  const [mapEpoch, setMapEpoch] = useState(0);
  const mapHost = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const markers = useRef<LayerGroup | null>(null);
  const liveAbort = useRef<AbortController | null>(null);
  const liveInFlight = useRef(false);
  const liveInterval = useRef<number | null>(null);
  const liveRetry = useRef<number | null>(null);
  const mapOriginRef = useRef<{ lat?: unknown; lon?: unknown } | null>(null);
  const closed = useRef(false);
  const translated = useRef(t);
  const announced = useRef(onAnnounce);

  useEffect(() => {
    translated.current = t;
    announced.current = onAnnounce;
  }, [onAnnounce, t]);

  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
      liveAbort.current?.abort();
      if (liveInterval.current) window.clearInterval(liveInterval.current);
      if (liveRetry.current) window.clearTimeout(liveRetry.current);
    };
  }, []);

  useEffect(() => {
    if (!journey) setMode('vehicle');
    else if (!vehicle) setMode('trip');
  }, [journey, vehicle]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  const defaultPreviewIndex = Math.min(1, Math.max(0, timeline.stops.length - 1));
  const currentPreviewKey = previewStorageKey(journey?.id);
  useEffect(() => {
    setPreviewReady(false);
    setPreviewPlaying(false);
    let next = defaultPreviewIndex;
    try {
      const raw = window.sessionStorage.getItem(currentPreviewKey);
      const stored = raw === null ? NaN : Number(raw);
      if (Number.isInteger(stored) && stored >= 0 && stored < timeline.stops.length)
        next = stored;
    } catch {}
    setPreviewIndex(next);
    setPreviewReady(true);
  }, [currentPreviewKey, defaultPreviewIndex, timeline.stops.length]);

  useEffect(() => {
    if (!previewReady || !journey || timeline.stops.length === 0) return;
    try {
      window.sessionStorage.setItem(currentPreviewKey, String(previewIndex));
    } catch {}
  }, [currentPreviewKey, journey, previewIndex, previewReady, timeline.stops.length]);

  useEffect(() => {
    if (!previewPlaying || mode !== 'trip' || timeline.stops.length < 2) return;
    const timer = window.setInterval(
      () => setPreviewIndex((index) => (index + 1) % timeline.stops.length),
      PREVIEW_STEP_MS,
    );
    return () => clearInterval(timer);
  }, [mode, previewPlaying, timeline.stops.length]);

  useEffect(() => {
    if (!requestedVehicleKey || !requestedVehicleId) {
      setSnapshot(null);
      setLiveError('');
      setLoadingLive(false);
      return;
    }

    let disposed = false;
    let timeout: number | null = null;
    const request = async () => {
      if (disposed) return;
      if (liveInFlight.current) {
        liveRetry.current = window.setTimeout(() => void request(), 100);
        return;
      }
      liveInFlight.current = true;
      const controller = new AbortController();
      liveAbort.current = controller;
      timeout = window.setTimeout(() => controller.abort(), FETCH_DEADLINE_MS);
      setLoadingLive(true);
      try {
        const query = new URLSearchParams({
          agency: requestedAgency,
          q: requestedVehicleId,
          limit: '100',
        });
        const response = await fetch(`/api/vehicles?${query}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('vehicle request failed');
        const payload: unknown = await response.json();
        const record = isRecord(payload) ? payload : {};
        const candidates: LiveFollowerVehicle[] = Array.isArray(record.vehicles)
          ? record.vehicles
              .map(vehicleFromUnknown)
              .filter((candidate): candidate is LiveFollowerVehicle => candidate !== null)
          : [];
        const matched = exactReportedVehicle(candidates, {
          agencyId: requestedAgency,
          id: requestedVehicleId,
        });
        if (!disposed) {
          const state = text(record.state, 64) || 'unavailable';
          setSnapshot({
            state,
            fetchedAt: text(record.fetchedAt, 128) || null,
            vehicle:
              matched && state === 'stale' ? { ...matched, stale: true } : matched || null,
          });
          setLiveError('');
          setNow(Date.now());
        }
      } catch (cause) {
        if (!disposed && !controller.signal.aborted) {
          setSnapshot((previous) =>
            previous?.vehicle
              ? { ...previous, state: 'stale', vehicle: { ...previous.vehicle, stale: true } }
              : previous,
          );
          setLiveError(
            translated.current(
              'Live vehicle position is temporarily unavailable.',
              '即時車輛位置暫時未能提供。',
            ),
          );
        }
      } finally {
        if (timeout) window.clearTimeout(timeout);
        if (liveAbort.current === controller) liveAbort.current = null;
        liveInFlight.current = false;
        if (!disposed) setLoadingLive(false);
      }
    };

    void request();
    liveInterval.current = window.setInterval(() => void request(), LIVE_POLL_MS);
    return () => {
      disposed = true;
      if (timeout) window.clearTimeout(timeout);
      if (liveInterval.current) window.clearInterval(liveInterval.current);
      if (liveRetry.current) window.clearTimeout(liveRetry.current);
      liveAbort.current?.abort();
    };
  }, [refreshNonce, requestedAgency, requestedVehicleId, requestedVehicleKey]);

  const currentVehicle = snapshot?.vehicle || null;
  const liveState = reportedPositionState(currentVehicle, now);
  const observedAt = timeLabel(
    currentVehicle?.timestamp,
    t('Observation time not supplied', '未有提供觀察時間'),
  );
  const previewStop = previewTimelineStop(timeline, previewIndex);
  const publisherNext = useMemo(() => {
    if (liveState !== 'fresh') return null;
    const stopId = publisherNextStopId(currentVehicle);
    if (!stopId) return null;
    const stop = timeline.stops.find((entry) => entry.place.id === stopId) || null;
    return { stopId, stop };
  }, [currentVehicle, liveState, timeline.stops]);

  const nextStop: TripProgressStop | null = publisherNext?.stop || previewStop;
  const nextStopTitle = publisherNext
    ? stopName(
        publisherNext.stop?.place,
        `${t('Publisher stop', '來源站點')} ${publisherNext.stopId}`,
      )
    : mode === 'trip' && nextStop
      ? stopName(nextStop.place, t('Unnamed scheduled stop', '未命名嘅預定站點'))
      : t('Not supplied', '未有提供');
  const nextStopLabel = publisherNext
    ? t('Publisher-reported next stop', '來源通報嘅下一站')
    : mode === 'trip' && nextStop
      ? t('Estimated sequence preview', '預計行程序列預覽')
      : t('Next stop', '下一站');
  const nextStopDescription = publisherNext
    ? t(
        'The feed labels this stop as upcoming. It is not inferred from a route.',
        '資料來源將此站標示為即將到達，並非由路線推測。',
      )
    : mode === 'trip' && nextStop
      ? t(
        'Simulation only. Use the preview controls to change this scheduled sequence view.',
        '僅為模擬。請用預覽控制項更改此預定行程序列檢視。',
      )
      : t(
        'The feed did not supply next-stop metadata, so no stop is invented.',
        '資料來源未有提供下一站資料，因此不會虛構站點。',
      );

  const firstPublishedPoint = useMemo(
    () => timeline.stops.map((entry) => entry.place).find((place) => validCoordinates(place)) || null,
    [timeline.stops],
  );
  const livePoint =
    liveState === 'fresh' && validCoordinates(currentVehicle) ? currentVehicle : null;
  const mapOrigin = livePoint || localPosition || firstPublishedPoint;
  const canRenderMap = Boolean(mapPoint(mapOrigin));

  useEffect(() => {
    mapOriginRef.current = mapOrigin;
  }, [mapOrigin]);

  useEffect(() => {
    let disposed = false;
    let stopTiles: (() => void) | undefined;
    let observer: ResizeObserver | undefined;
    if (!canRenderMap || !mapHost.current || map.current) return;
    void import('leaflet').then((leaflet) => {
      if (disposed || !mapHost.current || map.current) return;
      const origin = mapPoint(mapOriginRef.current);
      if (!origin) return;
      map.current = leaflet.map(mapHost.current, { zoomControl: false }).setView(origin, 14);
      leaflet.control.zoom({ position: 'bottomright' }).addTo(map.current);
      stopTiles = attachMapTiles(leaflet, map.current, setTileError);
      markers.current = leaflet.layerGroup().addTo(map.current);
      observer = new ResizeObserver(() => map.current?.invalidateSize());
      observer.observe(mapHost.current);
      setMapEpoch((epoch) => epoch + 1);
    });
    return () => {
      disposed = true;
      stopTiles?.();
      observer?.disconnect();
      markers.current?.clearLayers();
      markers.current = null;
      map.current?.remove();
      map.current = null;
    };
  }, [canRenderMap]);

  useEffect(() => {
    let cancelled = false;
    const draw = async () => {
      const leaflet = await import('leaflet');
      if (cancelled || !map.current || !markers.current) return;
      markers.current.clearLayers();
      const renderedStops = new Set<string>();
      for (const entry of timeline.stops) {
        const point = mapPoint(entry.place);
        if (!point) continue;
        const coordinateKey = point.join(',');
        if (renderedStops.has(coordinateKey)) continue;
        renderedStops.add(coordinateKey);
        const marker = leaflet.marker(point, {
          icon: leaflet.divIcon({
            className: 'live-follower-map-stop',
            html: '',
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          }),
        });
        marker.bindTooltip(stopName(entry.place, t('Unnamed stop', '未命名站點')));
        marker.addTo(markers.current);
      }

      const targetPoint = mapPoint(publisherNext?.stop?.place || previewStop?.place || null);
      if (targetPoint) {
        leaflet
          .marker(targetPoint, {
            icon: leaflet.divIcon({
              className: 'live-follower-map-target',
              html: '',
              iconSize: [24, 24],
              iconAnchor: [12, 12],
            }),
          })
          .bindTooltip(nextStopTitle)
          .addTo(markers.current);
      }

      const observedPoint = mapPoint(currentVehicle);
      if (observedPoint) {
        leaflet
          .marker(observedPoint, {
            icon: leaflet.divIcon({
              className:
                liveState === 'fresh'
                  ? 'live-follower-map-vehicle'
                  : 'live-follower-map-vehicle is-stale',
              html: '',
              iconSize: [26, 26],
              iconAnchor: [13, 13],
            }),
          })
          .bindTooltip(
            liveState === 'fresh'
              ? t('Fresh reported vehicle position', '最新通報車輛位置')
              : t('Stale reported vehicle position', '過時通報車輛位置'),
          )
          .addTo(markers.current);
        if (liveState === 'fresh')
          map.current.setView(observedPoint, Math.max(map.current.getZoom(), 14), {
            animate: false,
          });
      }

      const personalPoint = mapPoint(localPosition);
      if (personalPoint) {
        leaflet
          .marker(personalPoint, {
            icon: leaflet.divIcon({
              className: 'live-follower-map-person',
              html: '',
              iconSize: [22, 22],
              iconAnchor: [11, 11],
            }),
          })
          .bindTooltip(t('Your local browser position', '你嘅本機瀏覽器位置'))
          .addTo(markers.current);
      }
    };
    void draw();
    return () => {
      cancelled = true;
    };
  }, [currentVehicle, liveState, localPosition, mapEpoch, nextStopTitle, previewStop, publisherNext, t, timeline.stops]);

  const announcePreview = useCallback(
    (index: number) => {
      const stop = timeline.stops[index];
      if (!stop) return;
      announced.current?.({
        en: `Simulation preview stop: ${stopName(stop.place, 'Unnamed scheduled stop')}.`,
        zh: `模擬預覽站點：${stopName(stop.place, '未命名嘅預定站點')}。`,
      });
    },
    [timeline.stops],
  );

  const choosePreview = (next: number) => {
    if (!timeline.stops.length) return;
    const normalized = Math.min(timeline.stops.length - 1, Math.max(0, next));
    setPreviewPlaying(false);
    setPreviewIndex(normalized);
    announcePreview(normalized);
  };

  const requestBrowserPosition = () => {
    if (!navigator.geolocation) {
      setLocationStatus(
        t(
          'This browser cannot provide a local position.',
          '此瀏覽器未能提供本機位置。',
        ),
      );
      return;
    }
    setLocationStatus(
      t(
        'Requesting a local browser position. It is not sent to the service.',
        '正在要求本機瀏覽器位置，位置不會傳送到服務。',
      ),
    );
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (closed.current) return;
        const point = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          timestamp: Date.now(),
        };
        if (!validCoordinates(point)) {
          setLocationStatus(t('The browser returned no usable position.', '瀏覽器未有回傳可用位置。'));
          return;
        }
        setLocalPosition(point);
        setLocationStatus(
          t(
            'Local browser position is shown only in this follower session.',
            '本機瀏覽器位置只會在此追蹤工作階段顯示。',
          ),
        );
      },
      () => {
        if (!closed.current)
          setLocationStatus(
            t('Local position was not shared with this browser.', '本機位置未有與此瀏覽器分享。'),
          );
      },
      { enableHighAccuracy: false, maximumAge: 0, timeout: 10_000 },
    );
  };

  const closeFollower = () => {
    closed.current = true;
    liveAbort.current?.abort();
    if (liveInterval.current) window.clearInterval(liveInterval.current);
    if (liveRetry.current) window.clearTimeout(liveRetry.current);
    onClose();
  };

  const liveHeading =
    liveState === 'fresh'
      ? t('Live position is fresh', '即時位置最新')
      : liveState === 'stale'
        ? t('Live position is stale', '即時位置已過時')
        : t('Live position is unavailable', '即時位置未能提供');
  const liveDetail =
    liveState === 'fresh' || liveState === 'stale'
      ? `${t('Observed', '觀察時間')} ${observedAt}`
      : currentVehicle
        ? t(
            'The feed returned a vehicle record without a usable current observation timestamp.',
            '資料來源回傳咗車輛記錄，但未有可用嘅目前觀察時間。',
          )
        : vehicle
          ? t(
              'No exact vehicle identity was reported by the live feed.',
              '即時資料來源未有通報完全相同嘅車輛身分。',
            )
          : t(
              'No exact vehicle has been verified for this trip.',
              '未有為此行程核實完全相同嘅車輛。',
            );
  const followedStop = publisherNext?.stop || previewStop;
  const followedLegIndex = followedStop?.references[0]?.legIndex ?? 0;
  const washroomEta =
    washroomTarget &&
    Number.isFinite(washroomTarget.etaSeconds) &&
    washroomTarget.etaSeconds >= 0
      ? Math.ceil(washroomTarget.etaSeconds / 60)
      : null;
  const requestWashroom = () => {
    if (!onWashroomRequest) return;
    onWashroomRequest({
      ...(localPosition
        ? {
            position: {
              lat: localPosition.lat,
              lon: localPosition.lon,
              timestamp: localPosition.timestamp,
            },
          }
        : {}),
      legIndex: followedLegIndex,
    });
  };

  return (
    <section className="live-follower" aria-labelledby="live-follower-heading">
      <div className="live-follower__header">
        <div>
          <span className="eyebrow">{t('LIVE FOLLOWER', '即時跟隨')}</span>
          <h2 id="live-follower-heading">{t('Follow this trip', '跟隨此行程')}</h2>
        </div>
        <button
          className="icon-button live-follower__close"
          type="button"
          onClick={closeFollower}
          aria-label={t('Close live follower', '關閉即時跟隨')}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      {journey && vehicle && (
        <div className="live-follower__modes" role="group" aria-label={t('Follower mode', '跟隨模式')}>
          <button
            type="button"
            className="pill"
            aria-pressed={mode === 'trip'}
            onClick={() => setMode('trip')}
          >
            {t('Trip sequence', '行程序列')}
          </button>
          <button
            type="button"
            className="pill"
            aria-pressed={mode === 'vehicle'}
            onClick={() => setMode('vehicle')}
          >
            {t('Vehicle position', '車輛位置')}
          </button>
        </div>
      )}

      <div className={`live-follower__live-state is-${liveState}`} role="status" aria-live="polite">
        <BusFront size={18} aria-hidden="true" />
        <div>
          <strong>{liveHeading}</strong>
          <span>{liveDetail}</span>
        </div>
        {vehicle && (
          <button
            type="button"
            className="pill"
            disabled={loadingLive}
            onClick={() => setRefreshNonce((value) => value + 1)}
          >
            <RefreshCw size={16} aria-hidden="true" />
            {loadingLive ? t('Checking', '檢查中') : t('Refresh', '重新整理')}
          </button>
        )}
      </div>
      {liveError && <p className="data-note live-follower__error" role="status">{liveError}</p>}

      <section className="live-follower__next" aria-live="polite">
        <span>{nextStopLabel}</span>
        <strong>{nextStopTitle}</strong>
        <p>{nextStopDescription}</p>
      </section>

      {mode === 'trip' && (
        <section className="live-follower__preview" aria-labelledby="live-follower-preview-heading">
          <div>
            <span className="live-follower__simulation">{t('Simulation', '模擬')}</span>
            <h3 id="live-follower-preview-heading">{t('Manual sequence preview', '手動行程序列預覽')}</h3>
            <p>
              {t(
                'This control never creates a live position, vehicle assignment, or arrival prediction.',
                '此控制項不會建立即時位置、車輛編配或到站預測。',
              )}
            </p>
          </div>
          <div className="live-follower__preview-controls">
            <button
              type="button"
              className="pill"
              disabled={timeline.stops.length === 0 || previewIndex === 0}
              onClick={() => choosePreview(previewIndex - 1)}
            >
              <ChevronLeft size={17} aria-hidden="true" />
              {t('Previous', '上一個')}
            </button>
            <button
              type="button"
              className="pill"
              disabled={timeline.stops.length < 2}
              onClick={() => setPreviewPlaying((playing) => !playing)}
              aria-pressed={previewPlaying}
            >
              {previewPlaying ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
              {previewPlaying ? t('Pause preview', '暫停預覽') : t('Play preview', '播放預覽')}
            </button>
            <button
              type="button"
              className="pill"
              disabled={timeline.stops.length === 0 || previewIndex + 1 >= timeline.stops.length}
              onClick={() => choosePreview(previewIndex + 1)}
            >
              {t('Next', '下一個')}
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          </div>
        </section>
      )}

      {!vehicle && journey && (
        <section className="live-follower__recovery" aria-labelledby="live-follower-recovery-heading">
          <h3 id="live-follower-recovery-heading">{t('Live vehicle unavailable', '即時車輛未能提供')}</h3>
          <p>
            {t(
              'No exact current vehicle is verified for this trip. You can use the manual sequence preview or choose a current vehicle separately.',
              '未有為此行程核實完全相同嘅目前車輛。你可以使用手動行程序列預覽，或者另外選擇目前車輛。',
            )}
          </p>
          {onChooseVehicle && (
            <button type="button" className="pill" onClick={onChooseVehicle}>
              {t('Choose current vehicle', '選擇目前車輛')}
            </button>
          )}
        </section>
      )}

      {(washroomTarget || onWashroomRequest) && (
        <section
          className="live-follower__washroom"
          aria-labelledby="live-follower-washroom-heading"
        >
          <div>
            <h3 id="live-follower-washroom-heading">
              {t('Washroom on this trip', '此行程嘅洗手間')}
            </h3>
            {washroomTarget ? (
              <>
                <strong>{washroomTarget.name}</strong>
                <p>
                  {washroomEta === null
                    ? t('Time until this washroom was not supplied.', '未有提供到達此洗手間嘅時間。')
                    : t(
                        `${washroomEta} min until this washroom.`,
                        `距離此洗手間約 ${washroomEta} 分鐘。`,
                      )}
                </p>
                <small>
                  {washroomTarget.availability === 'confirmed-open'
                    ? t('Confirmed open by the supplied source.', '所提供來源確認開放。')
                    : t('Current availability is unknown.', '目前開放狀況未知。')}
                  {washroomTarget.note ? ` ${washroomTarget.note}` : ''}
                </small>
              </>
            ) : (
              <p>
                {t(
                  'No washroom target has been supplied for this trip yet.',
                  '此行程暫時未有提供洗手間目標。',
                )}
              </p>
            )}
          </div>
          {onWashroomRequest && (
            <button type="button" className="pill" onClick={requestWashroom}>
              {t('I need to use the washroom', '我需要用洗手間')}
            </button>
          )}
        </section>
      )}

      <section className="live-follower__privacy" aria-labelledby="live-follower-privacy-heading">
        <div>
          <h3 id="live-follower-privacy-heading">{t('Optional local position', '可選本機位置')}</h3>
          <p>
            {t(
              'Only choose this if you want this browser to show its local position on this map. It is not persisted or sent to the planning service.',
              '只有你想讓此瀏覽器在地圖上顯示本機位置時先選擇。位置不會被儲存或傳送至規劃服務。',
            )}
          </p>
        </div>
        <button type="button" className="pill" onClick={requestBrowserPosition}>
          <MapPin size={17} aria-hidden="true" />
          {t('Show my local position', '顯示我嘅本機位置')}
        </button>
      </section>
      {locationStatus && <p className="data-note" role="status">{locationStatus}</p>}

      <div
        ref={mapHost}
        className="live-follower__map"
        role="region"
        aria-label={t(
          'Follower map. The stop list below is the complete text alternative.',
          '跟隨地圖。下方站點清單提供完整文字替代。',
        )}
      >
        {!canRenderMap && (
          <p className="live-follower__map-empty">
            {t(
              'No published trip coordinate or fresh vehicle position is available for this map.',
              '此地圖未有已發布嘅行程座標或最新車輛位置。',
            )}
          </p>
        )}
      </div>
      {tileError && (
        <p className="data-note">
          {t(
            'Some base map tiles are unavailable. The live state and text stop list remain available.',
            '部分底圖未能提供，即時狀態同文字站點清單仍然可用。',
          )}
        </p>
      )}

      {timeline.stops.length > 0 && (
        <section className="live-follower__stops" aria-labelledby="live-follower-stops-heading">
          <div className="content-heading">
            <div>
              <h3 id="live-follower-stops-heading">{t('Upcoming stops', '即將到達嘅站點')}</h3>
              <p>{t('Published trip sequence', '已發布嘅行程序列')}</p>
            </div>
            <span>{timeline.stops.length}</span>
          </div>
          <ol>
            {timeline.stops.slice(0, 60).map((stop, index) => (
              <li
                key={`${stop.key || 'unknown'}:${index}`}
                className={index === previewIndex && !publisherNext ? 'is-preview' : ''}
              >
                <span className="live-follower__stop-index">{index + 1}</span>
                <span>
                  <strong>{stopName(stop.place, t('Unnamed scheduled stop', '未命名嘅預定站點'))}</strong>
                  <small>
                    {stop.transfer
                      ? t('Transfer boundary', '轉車分界')
                      : stop.references.map((reference) => `${t('Leg', '行程段')} ${reference.legIndex + 1}`).join(' · ')}
                  </small>
                </span>
              </li>
            ))}
          </ol>
          {timeline.stops.length > 60 && (
            <p className="data-note">
              {t(
                'The follower shows the first 60 published stops to keep the list bounded.',
                '為保持清單有界，跟隨器顯示頭 60 個已發布站點。',
              )}
            </p>
          )}
        </section>
      )}

      {mode === 'vehicle' && (
        <p className="live-follower__vehicle-note">
          <Clock size={16} aria-hidden="true" />
          {t(
            'A route, headsign, or location never identifies a rider vehicle or a next stop by itself.',
            '路線、目的地牌或位置本身永遠不能識別乘客車輛或下一站。',
          )}
        </p>
      )}
    </section>
  );
}
