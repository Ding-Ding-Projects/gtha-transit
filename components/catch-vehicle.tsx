'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Footprints, LocateFixed, RefreshCw, X } from 'lucide-react';
import { SearchWorkbench, emptySearchState, useSearchMatches } from './search-workbench';
import type { Itinerary, Place } from '../lib/types';

type Vehicle = { id: string; agencyId?: string; vehicleKey?: string; label?: string; fleetNumber?: string };
type Option = { stop: { id: string; name: string; lat: number; lon: number }; arrivalAt: string; arriveByAt: string; basis: 'scheduled' | 'estimated' | 'realtime'; walk: Itinerary; slackSeconds: number };
type Result = { state: string; checkedAt?: string; options?: Option[]; reason?: string };
type Props = { vehicle: Vehicle; t: (en: string, zh: string) => string; onClose: () => void; onWalk?: (journey: Itinerary) => void };
const clock = (value: string) => new Date(value).toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit' });

/** A selected unit is resolved again on the server; the browser never supplies its trip assignment. */
export default function CatchVehicle({ vehicle, t, onClose, onWalk }: Props) {
  const [find, setFind] = useState(emptySearchState);
  const [places, setPlaces] = useState<Place[]>([]);
  const [origin, setOrigin] = useState<Place | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [gps, setGps] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [nonce, refresh] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const watch = useRef<number | null>(null);
  const lastPosition = useRef<{ lat: number; lon: number; at: number } | null>(null);
  const vehicleKey = vehicle.vehicleKey ?? `${vehicle.agencyId ?? ''}:${vehicle.id}`;
  const samples = useMemo(() => places.map(place => `${place.name} ${place.address ?? ''} ${place.city ?? ''}`), [places]);
  const matched = useSearchMatches(samples, find.mode === 'regex' ? find : { ...find, query: '' });
  const stopGps = () => { if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current); watch.current = null; setGps(false); };
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { const pause = () => { if (document.visibilityState !== 'visible') stopGps(); }; document.addEventListener('visibilitychange', pause); return () => { if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current); document.removeEventListener('visibilitychange', pause); }; }, []);
  const locate = () => {
    if (!navigator.geolocation) { setNotice(t('Location is unavailable. Choose a place below.', '未能提供位置，請喺下面選擇地點。')); return; }
    stopGps(); setNotice(''); setGps(true);
    watch.current = navigator.geolocation.watchPosition(position => {
      const { latitude: lat, longitude: lon, accuracy } = position.coords;
      setAccuracy(accuracy);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || accuracy > 1000) { setNotice(t('Location is too approximate for an interception. Choose a place instead.', '位置太模糊，未能規劃追車；請改為選擇地點。')); return; }
      const previous = lastPosition.current;
      if (previous && Date.now() - previous.at < 15_000 && Math.hypot(lat - previous.lat, lon - previous.lon) < 0.0004) return;
      lastPosition.current = { lat, lon, at: Date.now() };
      setOrigin({ id: 'current-location', name: t('Your reported location', '你通報嘅位置'), lat, lon });
    }, () => { stopGps(); setNotice(t('Location could not be obtained. Choose a place below.', '未能取得位置，請喺下面選擇地點。')); }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 });
  };
  useEffect(() => {
    const query = find.query.trim();
    if (query.length < 2) { setPlaces([]); return; }
    const controller = new AbortController(); let disposed = false;
    const timer = setTimeout(async () => { setPlaceBusy(true); try { const response = await fetch(`/api/places?q=${encodeURIComponent(query.slice(0,160))}`, { signal: controller.signal }); if (!response.ok) throw Error(); const value = await response.json() as { places?: Place[] }; if (!disposed) setPlaces((value.places ?? []).filter(place => Number.isFinite(place.lat) && Number.isFinite(place.lon)).slice(0,20)); } catch { if (!disposed) setNotice(t('Place suggestions are unavailable. Try again.', '地點建議暫未能提供，請再試。')); } finally { if (!disposed) setPlaceBusy(false); } }, 250);
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [find.query]);
  useEffect(() => {
    if (!origin) return;
    let disposed = false; let timer: ReturnType<typeof setTimeout> | undefined; let current: AbortController | null = null;
    let delay = 30_000;
    setResult(null);
    const run = async () => {
      if (disposed) return;
      if (document.visibilityState !== 'visible') { timer = setTimeout(run,30_000); return; }
      current?.abort(); const controller = new AbortController(); current = controller;
      const timeout = setTimeout(() => controller.abort(),28_000); setBusy(true);
      try {
        const response = await fetch('/api/vehicles/intercept', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ vehicleKey, origin:{ lat:origin.lat,lon:origin.lon,name:origin.name.slice(0,100) } }), signal:controller.signal, cache:'no-store' });
        if (!response.ok) throw Error();
        const value = await response.json() as Result;
        if (!disposed && current === controller) { setResult(value); setNotice(''); delay=30_000; }
      } catch { if (!disposed && current === controller) { setResult(null); setNotice(t('The interception could not be refreshed. Previous options are no longer offered.', '未能更新追車規劃，之前嘅選項唔會繼續提供。')); delay=Math.min(delay*2,120_000); } }
      finally { clearTimeout(timeout); if (!disposed && current === controller) { setBusy(false); timer=setTimeout(run,delay); } }
    };
    const visible = () => { clearTimeout(timer); if (document.visibilityState === 'visible') void run(); else current?.abort(); };
    document.addEventListener('visibilitychange',visible); void run();
    return () => { disposed=true; clearTimeout(timer); current?.abort(); document.removeEventListener('visibilitychange',visible); };
  }, [vehicleKey,origin?.lat,origin?.lon,nonce]);
  return <section className="catch-vehicle" aria-labelledby="catch-vehicle-heading">
    <header><h3 id="catch-vehicle-heading">{t('Catch this vehicle', '追上此車輛')} · {vehicle.fleetNumber ?? vehicle.label ?? vehicle.id}</h3><button type="button" onClick={onClose} aria-label={t('Close interception planner', '關閉追車規劃')}><X size={20} /></button></header>
    <p>{t('Choose where you are starting. The planner checks this exact reported vehicle and real walking routes to its upcoming stops, leaving a two-minute boarding margin. It cannot guarantee the vehicle will wait.', '選擇出發位置。規劃器會檢查此架通報車輛同前往之後車站嘅真實步行路線，預留兩分鐘上車時間；無法保證車輛會等候。')}</p>
    <p className="data-note">{t('Your starting coordinates are sent only to calculate this interception and are not saved in request logs. Closing this panel stops location watching and refresh requests.', '出發座標只用作計算追車路線，唔會儲存喺請求記錄。關閉此面板會停止定位同更新請求。')}</p>
    <button type="button" onClick={gps ? stopGps : locate}><LocateFixed size={18} />{gps ? t('Stop location updates', '停止位置更新') : t('Use and follow my location', '使用並跟隨我嘅位置')}</button>
    {accuracy !== null && <p>{t(`Last reported location accuracy: about ${Math.round(accuracy)} metres.`, `上次通報位置準確度：約 ${Math.round(accuracy)} 米。`)}</p>}
    <SearchWorkbench storageId="catch-origin" label={t('Search for a starting place', '搜尋出發地點')} value={find} onChange={setFind} samples={samples} t={t} />
    {placeBusy && <p role="status">{t('Finding places…','搜尋地點中…')}</p>}
    <ul className="catch-places">{places.map((place,index) => matched.matches[index] && <li key={place.id}><button type="button" onClick={() => { stopGps();setAccuracy(null);setOrigin(place);setPlaces([]); }}>{place.name}{place.address && <small>{place.address}</small>}</button></li>)}</ul>
    {origin && <p><strong>{t('Starting from', '出發地點')}: {origin.name}</strong><button type="button" onClick={() => { stopGps(); setOrigin(null); setResult(null); }}>{t('Clear starting place', '清除出發地點')}</button></p>}
    {origin && <button type="button" disabled={busy} onClick={() => refresh(value=>value+1)}><RefreshCw size={16}/>{busy?t('Checking this vehicle…','檢查此車輛中…'):t('Check again','再次檢查')}</button>}
    <div role="status">{notice || (result && result.state !== 'catchable' ? result.state === 'stale' ? t('The vehicle report is too old to plan a safe interception.','車輛通報太舊，未能規劃可靠追車路線。') : result.state === 'vehicle-missing' ? t('This vehicle is no longer in the current feed.','目前資料已無此車輛。') : t('No catchable stop was verified for this vehicle from this starting point. Try a nearer place or a different vehicle.','未能確認由此出發地點追上呢架車嘅車站。可試較近地點或其他車輛。') : '')}</div>
    {!busy && result?.state === 'catchable' && result.options?.map(option => <article className="catch-option" key={option.stop.id}><h4>{option.stop.name}</h4><p>{t('Vehicle arrival', '車輛到站')}: {clock(option.arrivalAt)} ({option.basis === 'scheduled' ? t('timetable','時間表') : t('published live prediction','已公布即時預測')})</p><p>{t('Reach the stop by','請於此時間前到站')}: <strong>{clock(option.arriveByAt)}</strong> · {t('Toronto time','多倫多時間')}</p><p><Footprints size={16}/>{Math.ceil(option.walk.duration/60)} {t('minutes walking','分鐘步行')} · {Math.round(option.walk.walkDistance)} m · {t(`${Math.floor(option.slackSeconds/60)} extra minutes beyond the boarding margin`, `上車預留時間以外仲有 ${Math.floor(option.slackSeconds/60)} 分鐘`)}</p>{onWalk && <button type="button" disabled={now + option.walk.duration * 1000 > Date.parse(option.arriveByAt)} onClick={() => { if (Date.now() + option.walk.duration * 1000 <= Date.parse(option.arriveByAt)) onWalk(option.walk); else refresh(value => value + 1); }}>{t('Follow this walking route','跟隨此步行路線')}</button>}</article>)}
    {result?.checkedAt && <small>{t('Last checked','上次檢查')}: {clock(result.checkedAt)} · {t('Toronto time','多倫多時間')}</small>}
  </section>;
}
