'use client';
import { useEffect, useRef, useState } from 'react';
import type { Place, Itinerary } from '../lib/types';
import 'leaflet/dist/leaflet.css';
function decode(encoded: string): [number, number][] {
  let i = 0,
    lat = 0,
    lon = 0;
  const points: [number, number][] = [];
  while (i < encoded.length && points.length < 50000) {
    const read = () => {
      let n = 0,
        shift = 0,
        b = 0;
      do {
        if (i >= encoded.length || shift > 30) throw Error('Invalid geometry');
        b = encoded.charCodeAt(i++) - 63;
        n |= (b & 31) << shift;
        shift += 5;
      } while (b >= 32);
      return n & 1 ? ~(n >> 1) : n >> 1;
    };
    lat += read();
    lon += read();
    points.push([lat / 1e5, lon / 1e5]);
  }
  return points.filter(
    ([a, b]) =>
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      Math.abs(a) <= 90 &&
      Math.abs(b) <= 180,
  );
}
export default function TransitMap({
  from,
  to,
  journey,
  onPick,
  picking,
  t,
}: {
  from: Place | null;
  to: Place | null;
  journey?: Itinerary;
  onPick: (lat: number, lon: number) => void;
  picking: boolean;
  t: (en: string, zh: string) => string;
}) {
  const [tileError, setTileError] = useState(false),
    [lat, setLat] = useState('43.6532'),
    [lon, setLon] = useState('-79.3832');
  const el = useRef<HTMLDivElement>(null),
    map = useRef<any>(null),
    layer = useRef<any>(null),
    callback = useRef(onPick),
    pickRef = useRef(picking);
  useEffect(() => {
    callback.current = onPick;
    pickRef.current = picking;
  }, [onPick, picking]);
  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver;
    import('leaflet').then((L) => {
      if (disposed || !el.current) return;
      map.current = L.map(el.current, { zoomControl: false }).setView(
        [43.67, -79.53],
        10,
      );
      L.control.zoom({ position: 'bottomright' }).addTo(map.current);
      L.tileLayer('/tiles/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '© OpenStreetMap contributors',
      })
        .on('tileerror', () => setTileError(true))
        .addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
      map.current.on('click', (e: any) => {
        if (pickRef.current) callback.current(e.latlng.lat, e.latlng.lng);
      });
      observer = new ResizeObserver(() => map.current?.invalidateSize());
      observer.observe(el.current);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      map.current?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const draw = async () => {
      const L = await import('leaflet');
      if (cancelled) return;
      if (!map.current || !layer.current) {
        timer = setTimeout(draw, 200);
        return;
      }
      layer.current.clearLayers();
      const bounds: [number, number][] = [];
      [from, to].forEach((p, i) => {
        if (!p) return;
        bounds.push([p.lat, p.lon]);
        const tooltip=document.createElement('span');tooltip.textContent=p.name;
        L.marker([p.lat, p.lon], {
          icon: L.divIcon({
            className: 'place-marker',
            html: i ? 'B' : 'A',
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
        })
          .bindTooltip(tooltip)
          .addTo(layer.current);
      });
      journey?.legs.forEach((leg) => {
        const raw =
          typeof leg.geometry === 'string'
            ? leg.geometry
            : leg.geometry?.points;
        let points: [number, number][] = [];
        try {
          if (raw) points = decode(raw);
        } catch {}
        if (!points.length) return;
        bounds.push(...points);
        L.polyline(points, {
          color: leg.mode === 'WALK' ? '#65756c' : '#1b7556',
          weight: leg.mode === 'WALK' ? 4 : 6,
          dashArray: leg.mode === 'WALK' ? '5 8' : undefined,
        }).addTo(layer.current);
      });
      if (bounds.length)
        map.current.fitBounds(bounds, { padding: [55, 55], maxZoom: 14 });
    };
    draw();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [from, to, journey]);
  return (
    <>
      <div
        className={'map-canvas ' + (picking ? 'picking' : '')}
        ref={el}
        role="region"
        aria-label={t(
          'Journey map. Text itinerary provides complete directions.',
          '行程地圖。文字行程提供完整指示。',
        )}
      />
      {tileError && (
        <div className="map-warning" role="status">
          {t(
            'Base map unavailable. Search for a place or enter coordinates.',
            '底圖暫時無法使用，請搜尋地點或輸入座標。',
          )}
        </div>
      )}
      {picking && (
        <form
          className="coordinate-picker"
          onSubmit={(e) => {
            e.preventDefault();
            const a = Number(lat),
              b = Number(lon);
            if (
              lat &&
              lon &&
              Number.isFinite(a) &&
              Number.isFinite(b) &&
              Math.abs(a) <= 90 &&
              Math.abs(b) <= 180
            )
              onPick(a, b);
          }}
        >
          <label>
            {t('Latitude', '緯度')}
            <input
              type="number"
              min="-90"
              max="90"
              step="any"
              required
              value={lat}
              onChange={(e) => setLat(e.target.value)}
            />
          </label>
          <label>
            {t('Longitude', '經度')}
            <input
              type="number"
              min="-180"
              max="180"
              step="any"
              required
              value={lon}
              onChange={(e) => setLon(e.target.value)}
            />
          </label>
          <button type="submit">{t('Use coordinates', '使用座標')}</button>
        </form>
      )}
    </>
  );
}
