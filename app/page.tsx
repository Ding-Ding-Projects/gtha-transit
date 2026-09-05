'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownUp,
  ArrowRight,
  ArrowLeft,
  Bookmark,
  ChevronRight,
  Clock,
  Footprints,
  LocateFixed,
  MapPin,
  Map as MapIcon,
  Route,
  Settings,
  ShieldCheck,
  TrainFront,
  TriangleAlert,
  X,
  RefreshCw,
  Share2,
  Download,
  Sun,
  Moon,
  Accessibility,
  ExternalLink,
  Info,
} from 'lucide-react';
import TransitMap from '../components/transit-map';
import DisruptionHistory from '../components/disruption-history';
import RealtimeCoverage from '../components/realtime-coverage';
import VehicleTracker from '../components/vehicle-tracker';
import {copyAt} from '../lib/copy';
import {rideMetrics,kilometres} from '../lib/ride-metrics';
import type { Place, Itinerary, TransitStatus, Line } from '../lib/types';
import {
  torontoIso as asIso,
  torontoLocalInput,
  isPlace,
  readStored,
} from '../lib/journey-utils';

type Lang = 'en' | 'zh' | 'both';
type Saved = { id: string; from: Place; to: Place };
const time = (v: number | string) =>
  new Date(typeof v === 'number' && v < 1e12 ? v * 1000 : v).toLocaleTimeString(
    'en-CA',
    { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit' },
  );
const mins = (seconds: number) => seconds>0&&seconds<60?'<1':Math.round(seconds / 60);
const distance = (m: number) =>
  m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
const localInput = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date())
    .replace(' ', 'T');
const safeUrl = (url?: string) => {
  try {
    const u = new URL(url || '');
    return u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
};

function PlaceField({
  label,
  value,
  onChange,
  t,
  onMap,
}: {
  label: string;
  value: Place | null;
  onChange: (p: Place | null) => void;
  t: (en: string, zh: string) => string;
  onMap: () => void;
}) {
  const [query, setQuery] = useState(value?.name || ''),
    [items, setItems] = useState<Place[]>([]),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [active, setActive] = useState(-1),
    [error, setError] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const listId = 'places-' + label.replaceAll(' ', '');
  useEffect(() => {
    if (value) setQuery(value.name);
  }, [value]);
  useEffect(() => {
    if (query.length < 2 || query === value?.name) {
      setItems([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      setError('');
      try {
        const r = await fetch('/api/places?q=' + encodeURIComponent(query), {
          signal: controller.signal,
        });
        if (!r.ok) throw Error();
        const data = (await r.json()) as { places?: Place[] };
        setItems(data.places || []);
        setActive(-1);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            t(
              'Place search is unavailable. Choose a point on the map.',
              '暫時無法搜尋地點，請喺地圖選擇。',
            ),
          );
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, value, t]);
  const choose = (p: Place) => {
    onChange(p);
    setQuery(p.name);
    setOpen(false);
  };
  return (
    <div className="place-field" ref={box}>
      <label htmlFor={listId}>{label}</label>
      <div className="input-line">
        <MapPin size={19} />
        <input
          id={listId}
          value={query}
          placeholder={t('Address, station or stop', '地址、車站或巴士站')}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId + '-list'}
          aria-activedescendant={
            active >= 0 ? listId + '-' + active : undefined
          }
          onFocus={() => setOpen(true)}
          onBlur={() =>
            setTimeout(() => {
              if (!box.current?.contains(document.activeElement))
                setOpen(false);
            }, 120)
          }
          onChange={(e) => {
            setQuery(e.target.value);
            if (value) onChange(null);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((x) => Math.min(x + 1, items.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((x) => Math.max(0, x - 1));
            }
            if (e.key === 'Enter' && open && active >= 0 && items[active]) {
              e.preventDefault();
              choose(items[active]);
            }
          }}
        />
        <button
          type="button"
          className="icon-button"
          onClick={onMap}
          title={t('Choose on map', '喺地圖選擇')}
          aria-label={t('Choose on map', '喺地圖選擇')}
        >
          <MapIcon size={17} />
        </button>
      </div>
      {value&&<div className="selected-place-name">{value.name}</div>}
      {open && query.length >= 2 && query !== value?.name && (
        <div
          className="suggestions"
          id={listId + '-list'}
          role="listbox"
          aria-label={label}
        >
          {busy ? (
            <p>{t('Finding places…', '搜尋地點中…')}</p>
          ) : error ? (
            <p role="status">{error}</p>
          ) : items.length ? (
            items.map((p, i) => (
              <button
                type="button"
                id={listId + '-' + i}
                role="option"
                aria-selected={i === active}
                key={p.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(p)}
              >
                <MapPin size={17} />
                <span>
                  {p.name}
                  <small>
                    {[p.agency, p.kind].filter(Boolean).join(' · ')}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p>
              {t(
                'No matching places. Try a station name or choose on the map.',
                '搵唔到地點，試下車站名或者喺地圖選擇。',
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [lang, setLang] = useState<Lang>('en'),
    [dark, setDark] = useState(false),
    [funEn, setFunEn] = useState(5),
    [funZh, setFunZh] = useState(5),
    [tab, setTab] = useState('plan');
  const [from, setFrom] = useState<Place | null>(null),
    [to, setTo] = useState<Place | null>(null),
    [when, setWhen] = useState(''),
    [arriveBy, setArriveBy] = useState(false),
    [preference, setPreference] = useState('fastest'),
    [wheelchair, setWheelchair] = useState(false),
    [preferWashrooms, setPreferWashrooms] = useState(false),
    [maxWalk, setMaxWalk] = useState(1500);
  const [journeys, setJourneys] = useState<Itinerary[]>([]),
    [selected, setSelected] = useState(0),
    [loading, setLoading] = useState(false),
    [planned, setPlanned] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [picking, setPicking] = useState<'from' | 'to' | null>(null),
    [mapVisible, setMapVisible] = useState(true);
  const [status, setStatus] = useState<TransitStatus | null>(null),
    [statusBusy, setStatusBusy] = useState(false),
    [expandedLine, setExpandedLine] = useState<string | null>(null),
    [saved, setSaved] = useState<Saved[]>([]),
    [coverage, setCoverage] = useState<any>(null),
    [version, setVersion] = useState<any>(null),
    [provenance, setProvenance] = useState<any>(null);
  const request = useRef<AbortController | null>(null),
    generation = useRef(0),
    hydrated = useRef(false);
  const t = useCallback((en:string,zh:string)=>{const a=copyAt(en,'en',funEn),b=copyAt(zh,'zh',funZh);return lang==='zh'?b:lang==='both'?`${a} · ${b}`:a;},[lang,funEn,funZh]);
  const translate = t;
  const statusRequest = useRef<AbortController | null>(null),
    statusGeneration = useRef(0);
  const activeInputs = useRef('');
  useEffect(() => {
    if (
      activeInputs.current ===
      JSON.stringify([
        from,
        to,
        when,
        arriveBy,
        preference,
        wheelchair,
        maxWalk,
        preferWashrooms,
      ])
    )
      return;
    request.current?.abort();
    generation.current++;
    setLoading(false);
    setPlanned(false);
    setJourneys([]);
    setError('');
  }, [from, to, when, arriveBy, preference, wheelchair, maxWalk,preferWashrooms]);
  useEffect(() => {
    setWhen(localInput());
    try {
      const prefs =
        readStored<Record<string, any>>('gtha-preferences', {}) || {};
      if (['en', 'zh', 'both'].includes(prefs.lang)) setLang(prefs.lang);
      setDark(prefs.dark === true);
      if (prefs.funEn >= 1 && prefs.funEn <= 5) setFunEn(prefs.funEn);
      if (prefs.funZh >= 1 && prefs.funZh <= 5) setFunZh(prefs.funZh);
      const list = readStored<unknown[]>('gtha-saved', []);
      if (Array.isArray(list))
        setSaved(
          list
            .filter(
              (x): x is Saved =>
                !!x &&
                typeof x === 'object' &&
                typeof (x as Saved).id === 'string' &&
                isPlace((x as Saved).from) &&
                isPlace((x as Saved).to),
            )
            .slice(0, 100),
        );
      const params = new URLSearchParams(location.search);
      const read = (key: string) => {
        const raw = params.get(key);
        if (!raw) return null;
        const [lat, lon, ...name] = raw.split(',');
        return Number.isFinite(+lat) &&
          Number.isFinite(+lon) &&
          Math.abs(+lat) <= 90 &&
          Math.abs(+lon) <= 180
          ? {
              id: key,
              name: name.join(',').slice(0, 200) || key,
              lat: +lat,
              lon: +lon,
            }
          : null;
      };
      setFrom(read('from'));
      setTo(read('to'));
    } catch {}
    hydrated.current = true;
    fetch('/api/coverage')
      .then((r) => r.json())
      .then(setCoverage)
      .catch(() => {});
    fetch('/version.json')
      .then((r) => r.json())
      .then(setVersion)
      .catch(() => {});
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
    if (hydrated.current)
      try {
        localStorage.setItem(
          'gtha-preferences',
          JSON.stringify({ lang, dark, funEn, funZh }),
        );
      } catch {
        setNotice(
          t(
            'Preferences could not be saved in this browser.',
            '呢個瀏覽器無法儲存設定。',
          ),
        );
      }
  }, [lang, dark, funEn, funZh]);
  useEffect(() => {
    if (hydrated.current)
      try {
        localStorage.setItem('gtha-saved', JSON.stringify(saved));
      } catch {}
  }, [saved]);
  async function refreshStatus() {
    statusRequest.current?.abort();
    const controller = new AbortController();
    statusRequest.current = controller;
    const id = ++statusGeneration.current;
    const timer = setTimeout(() => controller.abort(), 18000);
    setStatusBusy(true);
    try {
      const r = await fetch('/api/status/ttc', {
        signal: controller.signal,
      });
      if (!r.ok) throw Error();
      const result = (await r.json()) as TransitStatus;
      if (id === statusGeneration.current) setStatus(result);
    } catch {
      if (id === statusGeneration.current)
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                state: 'stale',
                lines: prev.lines.map((x) => ({ ...x, state: 'unknown' })),
              }
            : { state: 'unavailable', lines: [], alerts: [] },
        );
    } finally {
      clearTimeout(timer);
      if (id === statusGeneration.current) setStatusBusy(false);
    }
  }
  useEffect(() => {
    refreshStatus();
    const timer = setInterval(refreshStatus, 60000);
    return () => {
      clearInterval(timer);
      request.current?.abort();
      statusRequest.current?.abort();
    };
  }, []);
  async function plan(override?: string) {
    if (!from || !to) {
      setError(
        t(
          'Choose both places from the suggestions or map.',
          '請喺建議清單或地圖選擇起點同終點。',
        ),
      );
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const id = ++generation.current;
    activeInputs.current = JSON.stringify([
      from,
      to,
      override || when,
      arriveBy,
      preference,
      wheelchair,
      maxWalk,
      preferWashrooms,
    ]);
    setLoading(true);
    setError('');
    setPlanned(true);
    setJourneys([]);
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const r = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from,
          to,
          dateTime: asIso(override || when || localInput()),
          arriveBy,
          preference,
          wheelchair,
          maxWalkDistance: maxWalk,
          preferWashrooms,
        }),
        signal: controller.signal,
      });
      const data = (await r.json()) as {
        message?: string;
        error?: string;
        itineraries?: Itinerary[];
        data?: unknown;
      };
      if (!r.ok)
        throw Error(
          data.message ||
            data.error ||
            t(
              'Journey planning is temporarily unavailable.',
              '暫時無法規劃行程。',
            ),
        );
      if (id !== generation.current) return;
      setJourneys(data.itineraries || []);
      setSelected(0);
      setProvenance(data.data);
      setTab('plan');
    } catch (e: any) {
      if (id === generation.current)
        setError(
          e.name === 'AbortError'
            ? t('The search timed out. Please try again.', '搜尋逾時，請再試。')
            : e.message,
        );
    } finally {
      clearTimeout(timer);
      if (id === generation.current) setLoading(false);
    }
  }
  function swap() {
    setFrom(to);
    setTo(from);
    setJourneys([]);
    setPlanned(false);
  }
  function save() {
    if (!from || !to) return;
    const id = `${from.lat},${from.lon}:${to.lat},${to.lon}`;
    setSaved((prev) =>
      [{ id, from, to }, ...prev.filter((x) => x.id !== id)].slice(0, 100),
    );
    setNotice(t('Trip saved on this device.', '行程已儲存喺呢部裝置。'));
  }
  async function share() {
    if (!from || !to) return;
    const url = new URL(location.origin);
    url.searchParams.set('from', `${from.lat},${from.lon},${from.name}`);
    url.searchParams.set('to', `${to.lat},${to.lon},${to.name}`);
    try {
      await navigator.clipboard.writeText(url.href);
      setNotice(
        t(
          'Link copied. It includes both trip locations.',
          '連結已複製，包含起點同終點。',
        ),
      );
    } catch {
      setNotice(url.href);
    }
  }
  function exportJourney() {
    const j = journeys[selected];
    if (!j) return;
    const content = {
      schemaVersion: 1,
      timezone: 'America/Toronto',
      from,
      to,
      itinerary: j,
      data: provenance,
      exportedAt: new Date().toISOString(),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(content, null, 2)], {
        type: 'application/json',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gtha-transit-journey.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function locate() {
    if (!navigator.geolocation) {
      setError(
        t(
          'Location is unavailable. Search for a place instead.',
          '無法定位，請搜尋地點。',
        ),
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        setFrom({
          id: 'current',
          name: t('Current location', '目前位置'),
          lat: p.coords.latitude,
          lon: p.coords.longitude,
        }),
      () =>
        setError(
          t(
            'Location was not available. You can still search or choose on the map.',
            '無法取得位置，你仍然可以搜尋或喺地圖選擇。',
          ),
        ),
      { timeout: 10000, maximumAge: 60000 },
    );
  }
  const current = journeys[selected];
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),6500);return()=>clearTimeout(timer);},[notice]);
  const totalAlerts = status?.alerts?.length || 0;
  const agencies = coverage?.agencies || [];
  const serviceDate=(when||localInput()).slice(0,10).replaceAll('-','');
  const dateGaps=agencies.filter((a:any)=>a.activeTripsByDate?.[(when||localInput()).slice(0,10)]===0||(a.serviceStart&&String(a.serviceStart)>serviceDate)||(a.serviceEnd&&String(a.serviceEnd)<serviceDate));
  const nextCoveredDate=[...new Set<string>(agencies.flatMap((a:any)=>Object.keys(a.activeTripsByDate||{})))].sort().find(d=>d>(when||localInput()).slice(0,10)&&dateGaps.every((a:any)=>(a.activeTripsByDate?.[d]||0)>0));
  const lineState = (line: Line) =>
    line.state === 'good'
      ? t('No reported disruption', '未有通報事故')
      : line.state === 'disrupted'
        ? t('Service alert', '服務提示')
        : t('Status unconfirmed', '狀態未確認');
  return (
    <div className="shell" data-tab={tab}>
      <a className="skip" href="#main">
        {t('Skip to journey planner', '跳到行程規劃')}
      </a>
      <header className="topbar">
        <a href="/" className="brand">
          <img src="/logo.svg" alt="" width="40" height="40" />
          <span>
            GTHA<span className="brand-light">transit</span>
            <small>{t('GREATER TORONTO & HAMILTON', '大多倫多及咸美頓')}</small>
          </span>
        </a>
        <nav aria-label={t('Main navigation', '主要導覽')}>
          {[
            ['plan', t('Plan a trip', '規劃行程')],
            ['status', t('Live TTC', '即時 TTC')],
            ['history',t('History','歷史')],
            ['vehicles',t('Vehicles','車輛')],
            ['saved', t('Saved trips', '已儲存行程')],
            ['coverage', t('Our region', '服務範圍')],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={tab === id ? 'active' : ''}
              aria-current={tab === id ? 'page' : undefined}
            >
              {label}
              {id === 'status' && <span className="live-dot" />}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <button
            className="icon-button"
            onClick={() => setDark(!dark)}
            aria-label={t('Switch colour theme', '切換色彩主題')}
          >
            {dark ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <button
            className="icon-button"
            onClick={() => setTab('settings')}
            aria-label={t('Settings', '設定')}
          >
            <Settings size={20} />
          </button>
        </div>
      </header>
      <main id="main" className="workspace">
        <aside className="planner">
          <div className="eyebrow">
            {t('A BETTER WAY ACROSS THE REGION', '輕鬆接駁全個地區')}
          </div>
          <h1>{t('Where to next?', '下一站，去邊？')}</h1>
          <p className="lede">
            {t('One journey. Every connection.', '一個行程，接通每一程。')}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              plan();
            }}
          >
            <div className="endpoints">
              <PlaceField
                label={t('From', '起點')}
                value={from}
                onChange={setFrom}
                t={translate}
                onMap={() => {
                  setPicking('from');
                  setMapVisible(true);
                  setTab('plan');
                }}
              />
              <button
                type="button"
                className="swap"
                onClick={swap}
                aria-label={t('Swap origin and destination', '交換起點同終點')}
              >
                <ArrowDownUp size={18} />
              </button>
              <PlaceField
                label={t('To', '終點')}
                value={to}
                onChange={setTo}
                t={translate}
                onMap={() => {
                  setPicking('to');
                  setMapVisible(true);
                  setTab('plan');
                }}
              />
            </div>
            <button
              type="button"
              className="text-button locate"
              onClick={locate}
            >
              <LocateFixed size={16} />
              {t('Use my location', '使用目前位置')}
            </button>
            <div className="time-row">
              <label>
                <span>{t('Travel time', '出發時間')}</span>
                <select
                  value={arriveBy ? 'arrive' : 'depart'}
                  onChange={(e) => setArriveBy(e.target.value === 'arrive')}
                >
                  <option value="depart">{t('Depart at', '出發')}</option>
                  <option value="arrive">{t('Arrive by', '到達')}</option>
                </select>
              </label>
              <label className="datetime">
                <span>{t('Toronto local time', '多倫多當地時間')}</span>
                <input
                  type="datetime-local"
                  required
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                />
              </label>
            </div>
              <div className="date-presets"><button type="button" className="pill" onClick={()=>setWhen(localInput())}>{t('Leave now','而家出發')}</button><button type="button" className="pill" onClick={()=>{const tomorrow=new Date(Date.now()+86400000);setWhen(torontoLocalInput(tomorrow).slice(0,10)+'T09:00');}}>{t('Tomorrow at 9','聽朝 9 點')}</button></div>
            <details className="options">
              <summary>
                <Settings size={16} />
                {t('Journey preferences', '行程偏好')}
                <ChevronRight size={16} />
              </summary>
              <label>
                {t('Prioritize', '優先考慮')}
                <select
                  value={preference}
                  onChange={(e) => setPreference(e.target.value)}
                >
                  <option value="fastest">
                    {t('Fastest journey', '最快到達')}
                  </option>
                  <option value="transfers">
                    {t('Fewer transfers', '減少轉車')}
                  </option>
                  <option value="walking">
                    {t('Less walking', '減少步行')}
                  </option>
                </select>
              </label>
              <label>
                {t('Maximum walking distance', '最長步行距離')}
                <select
                  value={maxWalk}
                  onChange={(e) => setMaxWalk(+e.target.value)}
                >
                  {[500, 1000, 1500, 3000].map((n) => (
                    <option key={n} value={n}>
                      {distance(n)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check"><input type="checkbox" checked={preferWashrooms} onChange={e=>setPreferWashrooms(e.target.checked)}/>{t('Prefer washrooms','優先經有洗手間嘅車站')}</label>
              <small>{t('Transit-facility washrooms only. Prefers practical connections through confirmed stations or terminals; opening hours and availability may be unknown.','只限交通設施內嘅洗手間，優先選擇經已確認車站或總站嘅合理接駁，開放時間及可用狀況可能未有資料。')}</small>
              <label className="check">
                <input
                  type="checkbox"
                  checked={wheelchair}
                  onChange={(e) => setWheelchair(e.target.checked)}
                />
                <Accessibility size={17} />
                {t('Wheelchair-accessible journeys', '輪椅無障礙行程')}
              </label>
              <small>
                {t(
                  'Accessibility follows available data. Elevator status and unreported barriers may not be included.',
                  '無障礙資料視乎供應來源，未必包括升降機狀況或未通報障礙。',
                )}
              </small>
            </details>
            <button className="primary" disabled={loading} type="submit">
              {loading ? (
                <RefreshCw size={19} className="spin" />
              ) : (
                <Route size={19} />
              )}
              <span>
                {loading
                  ? t('Finding your connections…', '搜尋接駁中…')
                  : t('Plan my trip', '規劃我嘅行程')}
              </span>
              <ArrowRight size={19} />
            </button>
          </form>
          {!!dateGaps.length&&<div className="error" role="status"><TriangleAlert size={18}/><span>{t('No scheduled trips are loaded for this date for:','所選日期未有載入以下公司嘅有效班次：')} {dateGaps.map((a:any)=>a.name).join(', ')}. {t('This is a data-coverage gap, not a report that transit is closed.','呢個係資料覆蓋缺口，唔係交通停駛通報。')}{nextCoveredDate&&<button className="pill" onClick={()=>setWhen(nextCoveredDate+'T'+(when.slice(11)||'09:00'))}>{t('Use next covered date','使用下一個有資料嘅日期')}: {nextCoveredDate}</button>}</span></div>}
          {error && (
            <div className="error" role="alert">
              <TriangleAlert size={19} />
              <span>{error}</span>
            </div>
          )}
          <div className="planner-bottom">
            <span className="schedule-badge">
              <Clock size={14} />
              {t('Scheduled journeys', '按時間表規劃')}
            </span>
            <p>
              {t(
                'Independent, open-source, and built for the whole region. No account needed.',
                '獨立開源，服務整個地區，毋須帳戶。',
              )}
            </p>
            <a
              href="https://github.com/Ding-Ding-Projects/gtha-transit"
              target="_blank"
              rel="noreferrer"
            >
              {t('About this project', '關於呢個項目')}
              <ExternalLink size={13} />
            </a>
          </div>
        </aside>
        <section className="content">
          {tab==='history'&&<DisruptionHistory t={t}/>}
          {tab==='vehicles'&&<VehicleTracker t={t}/>}
          {tab==='coverage'&&<RealtimeCoverage t={t}/>}
          {tab === 'plan' && (
            <>
              <div className="content-heading">
                <div>
                  <span className="eyebrow">
                    {t('MAKE THE CONNECTION', '接通每一程')}
                  </span>
                  <h2>
                    {planned
                      ? t('Your journey options', '你嘅行程選擇')
                      : t(
                          'Your region, within reach.',
                          '全個地區，一程接一程。',
                        )}
                  </h2>
                </div>
                <button
                  className="pill"
                  onClick={() => setMapVisible(!mapVisible)}
                >
                  <MapIcon size={16} />
                  {mapVisible
                    ? t('Hide map', '收起地圖')
                    : t('Show map', '顯示地圖')}
                </button>
              </div>
              <div className={'map-wrap ' + (mapVisible ? 'visible' : '')}>
                <TransitMap
                  t={t}
                  from={from}
                  to={to}
                  journey={current}
                  picking={!!picking}
                  onPick={(lat, lon) => {
                    const p = {
                      id: 'map',
                      name: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
                      lat,
                      lon,
                    };
                    picking === 'from' ? setFrom(p) : setTo(p);
                    setPicking(null);
                  }}
                />
                <div className="map-label">
                  <MapPin size={14} />
                  {picking
                    ? t(
                        'Click the map to choose your location',
                        '按地圖選擇位置',
                      )
                    : t('Greater Toronto & Hamilton', '大多倫多及咸美頓')}
                  {picking && (
                    <button
                      onClick={() => setPicking(null)}
                      aria-label={t('Cancel map selection', '取消地圖選擇')}
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              </div>
              {!planned && (
                <div className="welcome">
                  <div className="connection-art" aria-hidden="true">
                    <span>A</span>
                    <i />
                    <TrainFront size={34} />
                    <i />
                    <span>B</span>
                  </div>
                  <h3>
                    {t(
                      'The whole trip. Not just your first ride.',
                      '由起點到終點，每一程都清楚。',
                    )}
                  </h3>
                  <p>
                    {t(
                      'Find connections across Toronto, Hamilton, Durham, Halton, Peel and York. Start with a place or a station.',
                      '跨越多倫多、咸美頓、杜林、荷頓、皮爾同約克。由地點或車站開始。',
                    )}
                  </p>
                  <div className="benefits">
                    <span>
                      <Footprints size={17} />
                      {t('Walking connections', '步行接駁')}
                    </span>
                    <span>
                      <ArrowDownUp size={17} />
                      {t('Cross-agency routes', '跨公司路線')}
                    </span>
                    <span>
                      <ShieldCheck size={17} />
                      {t('Clear data sources', '資料來源清晰')}
                    </span>
                  </div>
                </div>
              )}
              {loading && (
                <div className="empty" role="status">
                  <RefreshCw className="spin" />
                  <h3>{t('Connecting the dots', '搜尋接駁中')}</h3>
                  <p>
                    {t(
                      'Checking schedules and walking connections.',
                      '核對班次同步行接駁。',
                    )}
                  </p>
                </div>
              )}
              {planned && !loading && !error && !journeys.length && (
                <div className="empty">
                  <Route />
                  <h3>
                    {t(
                      'No journey found for this search',
                      '呢次搜尋搵唔到行程',
                    )}
                  </h3>
                  <p>
                    {t(
                      'Try another time, allow more walking, or check the coverage page. No result does not necessarily mean no service exists.',
                      '試下另一個時間、增加步行距離，或者查閱服務範圍。無搜尋結果唔代表一定無服務。',
                    )}
                  </p>
                  <button className="pill" onClick={() => setTab('coverage')}>
                    {t('Check coverage', '查閱服務範圍')}
                  </button>
                </div>
              )}
              {!!journeys.length && (
                <>
                  <div className="results-toolbar">
                    <span>
                      {journeys.length} {t('options', '個選擇')}
                    </span>
                    <div>
                      <button onClick={save}>
                        <Bookmark size={16} />
                        {t('Save', '儲存')}
                      </button>
                      <button onClick={share}>
                        <Share2 size={16} />
                        {t('Share locations', '分享地點')}
                      </button>
                      <button onClick={exportJourney}>
                        <Download size={16} />
                        {t('Export', '匯出')}
                      </button>
                    </div>
                  </div>
                  <div className="journeys">
                    {journeys.map((j, index) => (
                      <article
                        className={
                          'journey ' + (index === selected ? 'selected' : '')
                        }
                        key={j.id}
                      >
                        <button
                          className="journey-summary"
                          onClick={() => setSelected(index)}
                          aria-expanded={index === selected}
                        >
                          <div className="journey-times">
                            <strong>
                              {time(j.startTime)} <ArrowRight size={16} />{' '}
                              {time(j.endTime)}
                            </strong>
                            <b>
                              {mins(j.duration)} <small>min</small>
                            </b>
                          </div>
                          <div className="route-chain">
                            {j.legs.map((leg, i) => (
                              <span
                                key={i}
                                className={
                                  leg.mode === 'WALK'
                                    ? 'walk-leg'
                                    : 'transit-leg'
                                }
                              >
                                {leg.mode === 'WALK' ? (
                                  <Footprints size={15} />
                                ) : (
                                  <TrainFront size={15} />
                                )}{' '}
                                {leg.route || `${mins(leg.duration)} min`}
                              </span>
                            ))}
                          </div>
                          <div className="journey-meta">
                            <span className="ride-stat"><TrainFront size={18}/><strong>{mins(rideMetrics(j).rideSeconds)} min</strong>{t('on transit','乘車')}</span>
                            <span className="ride-stat"><Route size={18}/><strong>{kilometres(rideMetrics(j).totalMetres)}</strong>{t('total distance','全程距離')}</span>
                            <span className="ride-stat"><Footprints size={18}/><strong>{mins(rideMetrics(j).walkSeconds)} min · {kilometres(j.walkDistance)}</strong>{t('walking','步行')}</span>
                            <span className="ride-stat"><Clock size={18}/><strong>{mins(rideMetrics(j).waitSeconds)} min</strong>{t('waiting / transfers','等車／轉車')}</span>
                            <span>
                              {j.transfers} {t('transfers', '次轉車')}
                            </span>
                            <span>
                              <Footprints size={14} />
                              {distance(j.walkDistance)}
                            </span>
                            <span>{j.legs.some(l=>l.realtime)?t('Includes live predictions','包含即時預測'):t('Scheduled', '時間表')}</span>
                          </div>
                        </button>
                        {index === selected && (
                          <div className="leg-list">
                            {!!j.washrooms?.length&&<div className="washroom-result"><strong>{t('Transit-facility washrooms','交通設施洗手間')}</strong>{j.washroomPreferenceApplied&&<p>{t('Preferred for confirmed washroom connections.','因已確認洗手間接駁而優先顯示。')}</p>}<ul>{j.washrooms.map((w,i)=><li key={i}><a href={safeUrl(w.source)} target="_blank" rel="noreferrer">{w.name}</a><small>{w.openingHours||t('Opening hours and current availability unconfirmed','開放時間及目前可用狀況未能確認')}</small></li>)}</ul></div>}
                            {j.legs.map((leg, i) => (
                              <div className="leg" key={i}>
                                <div className="leg-time">
                                  {time(leg.startTime)}
                                </div>
                                <div
                                  className={
                                    'leg-dot ' +
                                    (leg.mode === 'WALK' ? 'walking' : '')
                                  }
                                >
                                  {leg.mode === 'WALK' ? (
                                    <Footprints size={14} />
                                  ) : (
                                    <TrainFront size={14} />
                                  )}
                                </div>
                                <div>
                                  <strong>
                                    {leg.mode === 'WALK'
                                      ? t('Walk to', '步行至')
                                      : leg.route +
                                        ' · ' +
                                        (leg.headsign || leg.to.name)}
                                  </strong>
                                  <p>
                                    {leg.mode === 'WALK'
                                      ? leg.to.name
                                      : leg.from.name}
                                  </p>
                                  <small>
                                    {leg.mode === 'WALK'
                                      ? distance(leg.distance || 0)
                                      : leg.agency}{' '}
                                    · {mins(leg.duration)} min
                                  </small>
                                  <div className="leg-metrics"><strong>{mins(leg.duration)} min</strong><span>{kilometres(leg.distance)}</span></div>
                                  {leg.realtime&&<p className="schedule-badge">{t('Live prediction','即時預測')}{leg.scheduledStartTime?' · '+t('scheduled','原定')+' '+time(leg.scheduledStartTime):''}</p>}
                                  {leg.mode!=='WALK'&&(leg.vehicle?<div className="assigned-vehicle"><strong>{t('Currently assigned vehicle','目前編配車輛')} {leg.vehicle.label||leg.vehicle.id}</strong><p>{[leg.vehicle.cptdb?.manufacturer,leg.vehicle.cptdb?.model,leg.vehicle.cptdb?.year].filter(Boolean).join(' · ')||t('Fleet details not verified','車隊資料未核實')}</p><small>{t('Live assignments can change before boarding.','上車前車輛編配可能改變。')}</small>{safeUrl(leg.vehicle.cptdb?.url)&&<a href={safeUrl(leg.vehicle.cptdb?.url)} target="_blank" rel="noreferrer">{t('Fleet source','車隊資料來源')}</a>}{leg.vehicle.photo&&safeUrl(leg.vehicle.photo.url)&&<figure><img loading="lazy" src={'/api/vehicle-photo?source='+encodeURIComponent(leg.vehicle.photo.url)} alt={leg.vehicle.photo.exactVehicle?t('Assigned vehicle photo','已編配車輛照片'):t('Representative fleet photo','代表車隊照片')}/><figcaption><a href={safeUrl(leg.vehicle.photo.sourceUrl)} target="_blank" rel="noreferrer">{leg.vehicle.photo.credit} · {leg.vehicle.photo.license}</a></figcaption></figure>}</div>:<p className="data-note">{t('A vehicle has not been verified for this exact trip.','未能核實呢個指定班次嘅車輛。')}</p>)}
                                  {leg.mode !== 'WALK' && (
                                    <>
                                      <p className="alight">
                                        {t('Get off at', '落車站')}{' '}
                                        <b>{leg.to.name}</b>
                                      </p>
                                      {leg.intermediateStops?.length ? (
                                        <details>
                                          <summary>
                                            {leg.intermediateStops.length}{' '}
                                            {t(
                                              'intermediate stops',
                                              '個中途站',
                                            )}
                                          </summary>
                                          <ol>
                                            {leg.intermediateStops.map(
                                              (s, k) => (
                                                <li key={k}>{s.name}</li>
                                              ),
                                            )}
                                          </ol>
                                        </details>
                                      ) : null}
                                      {status?.lines
                                        ?.filter(
                                          (l) =>
                                            l.state === 'disrupted' &&
                                            leg.agency?.includes('TTC') &&
                                            leg.route === l.id,
                                        )
                                        .map((l) => (
                                          <p
                                            className="inline-alert"
                                            key={l.id}
                                          >
                                            <TriangleAlert size={14} />
                                            {l.alerts[0]?.title}
                                          </p>
                                        ))}
                                    </>
                                  )}
                                </div>
                              </div>
                            ))}
                            <div className="arrival">
                              <MapPin size={17} />
                              <strong>
                                {time(j.endTime)} · {to?.name}
                              </strong>
                            </div>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                  <div className="results-footer">
                    <button
                      className="pill"
                      onClick={() => {
                        const d = new Date(asIso(when));
                        d.setMinutes(d.getMinutes() - 30);
                        const v = new Intl.DateTimeFormat('sv-SE', {
                          timeZone: 'America/Toronto',
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                          .format(d)
                          .replace(' ', 'T');
                        setWhen(v);
                        plan(v);
                      }}
                    >
                      <ArrowLeft size={15} />
                      {t('30 min earlier', '早 30 分鐘')}
                    </button>
                    <button
                      className="pill"
                      onClick={() => {
                        const d = new Date(asIso(when));
                        d.setMinutes(d.getMinutes() + 30);
                        const v = new Intl.DateTimeFormat('sv-SE', {
                          timeZone: 'America/Toronto',
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                          .format(d)
                          .replace(' ', 'T');
                        setWhen(v);
                        plan(v);
                      }}
                    >
                      {t('30 min later', '遲 30 分鐘')}
                      <ArrowRight size={15} />
                    </button>
                    <button className="pill" onClick={swap}>
                      <ArrowDownUp size={15} />
                      {t('Plan return trip', '規劃回程')}
                    </button>
                  </div>
                  <p className="data-note">
                    {t(
                      'Times use Toronto local time. Check live alerts before leaving. Fares are not calculated.',
                      '時間以多倫多當地時間顯示。出發前請查閱即時提示，車費未有計算。',
                    )}
                    {provenance?.updatedAt &&
                      ' ' +
                        t('Data updated', '資料更新') +
                        ': ' +
                        new Date(provenance.updatedAt).toLocaleString()}
                  </p>
                </>
              )}
            </>
          )}
          {tab === 'status' && (
            <div className="page-panel">
              <div className="content-heading">
                <div>
                  <span className="eyebrow">
                    {t('BEFORE YOU GO', '出發之前')}
                  </span>
                  <h2>{t('Live TTC line status', 'TTC 即時路線狀態')}</h2>
                </div>
                <button
                  className="pill"
                  onClick={refreshStatus}
                  disabled={statusBusy}
                >
                  <RefreshCw size={16} />
                  {t('Refresh', '重新整理')}
                </button>
              </div>
              <p>
                {t(
                  'Subway and light rail conditions from official TTC sources. Alerts are preserved in their original wording.',
                  '官方 TTC 地鐵及輕鐵狀況。服務提示保留原文。',
                )}
              </p>
              <div
                className={
                  'source-state ' + (status?.state === 'live' ? 'fresh' : '')
                }
              >
                <span className="live-dot" />
                {status?.state === 'live'
                  ? t('Source connected', '已連接資料來源')
                  : status?.state === 'stale'
                    ? t(
                        'Stale data. Current service is unconfirmed.',
                        '資料已過時，目前服務未能確認。',
                      )
                    : t('Live source unavailable', '即時資料來源暫時無法使用')}
                {status?.fetchedAt && (
                  <small>
                    {t('Last fetched', '上次取得資料')} {time(status.fetchedAt)}
                  </small>
                )}
              </div>
              <div className="line-list">
                {status?.lines?.map((line) => (
                  <div className="line-card" key={line.id}>
                    <button
                      onClick={() =>
                        setExpandedLine(
                          expandedLine === line.id ? null : line.id,
                        )
                      }
                      aria-expanded={expandedLine === line.id}
                    >
                      <span
                        className="line-number"
                        style={{
                          background: line.color?.startsWith('#')
                            ? line.color
                            : '#555',
                        }}
                      >
                        {line.id}
                      </span>
                      <strong>{line.name.replace(/^Line \d+\s*/, '')}</strong>
                      <span className={'line-state ' + line.state}>
                        {lineState(line)}
                      </span>
                      <ChevronRight size={17} />
                    </button>
                    {expandedLine === line.id && (
                      <div className="line-detail">
                        {line.alerts.length ? (
                          line.alerts.map((a) => (
                            <article key={a.id}>
                              <h4>{a.title}</h4>
                              <p>{a.description}</p>
                              {safeUrl(a.url) && (
                                <a
                                  href={safeUrl(a.url)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {t('Official alert', '官方提示')}
                                  <ExternalLink size={14} />
                                </a>
                              )}
                            </article>
                          ))
                        ) : (
                          <p>
                            {line.state === 'good'
                              ? t(
                                  'No active disruption was reported by this source. Conditions can change.',
                                  '資料來源未有通報事故，狀況隨時可能改變。',
                                )
                              : t(
                                  'This source cannot confirm the current state of this line. Check TTC before travelling.',
                                  '呢個來源未能確認目前路線狀態，乘車前請查閱 TTC。',
                                )}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <h3>
                {t('All active TTC alerts', '所有生效中 TTC 提示')}{' '}
                <span className="count">{totalAlerts}</span>
              </h3>
              {status?.alerts?.map((a) => (
                <article className="alert-card" key={a.id}>
                  <TriangleAlert size={18} />
                  <div>
                    <h4>{a.title}</h4>
                    <p>{a.description}</p>
                    {safeUrl(a.url) && (
                      <a href={safeUrl(a.url)} target="_blank" rel="noreferrer">
                        {t('Read official update', '閱讀官方更新')}
                      </a>
                    )}
                  </div>
                </article>
              ))}
              <a
                className="source-link"
                href="https://www.ttc.ca/service-alerts"
                target="_blank"
                rel="noreferrer"
              >
                {t('Check TTC service alerts', '查閱 TTC 服務提示')}
                <ExternalLink size={15} />
              </a>
            </div>
          )}
          {tab === 'saved' && (
            <div className="page-panel">
              <span className="eyebrow">
                {t('READY FOR NEXT TIME', '下次出發更方便')}
              </span>
              <h2>{t('Your saved trips', '你儲存嘅行程')}</h2>
              <p>
                {t(
                  'Kept only in this browser. Always search again for current schedules.',
                  '只儲存喺呢個瀏覽器。出發前請重新搜尋最新班次。',
                )}
              </p>
              {!saved.length ? (
                <div className="empty">
                  <Bookmark />
                  <h3>
                    {t(
                      'Your regular journeys belong here',
                      '常用行程，儲存喺呢度',
                    )}
                  </h3>
                  <p>
                    {t(
                      'Plan a trip, then choose Save above the results.',
                      '規劃行程後，按結果上方嘅儲存。',
                    )}
                  </p>
                </div>
              ) : (
                saved.map((s) => (
                  <article className="saved-card" key={s.id}>
                    <button
                      onClick={() => {
                        setFrom(s.from);
                        setTo(s.to);
                        setPlanned(false);
                        setJourneys([]);
                        setTab('plan');
                      }}
                    >
                      <MapPin size={20} />
                      <span>
                        <strong>{s.from.name}</strong>
                        <small>
                          {t('to', '至')} {s.to.name}
                        </small>
                      </span>
                      <ArrowRight size={18} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={t('Remove saved trip', '移除已儲存行程')}
                      onClick={() =>
                        setSaved((prev) => prev.filter((x) => x.id !== s.id))
                      }
                    >
                      <X size={18} />
                    </button>
                  </article>
                ))
              )}
            </div>
          )}
          {tab === 'coverage' && (
            <div className="page-panel">
              <span className="eyebrow">
                {t('ONE CONNECTED REGION', '連接整個地區')}
              </span>
              <h2>{t('Know what is covered', '清楚掌握服務範圍')}</h2>
              <p>
                {t(
                  'Coverage is measured from loaded schedules, not from an agency logo. A missing or expired feed is shown here.',
                  '服務範圍根據已載入班次確認。缺少或過期嘅資料會喺呢度顯示。',
                )}
              </p>
              {!coverage ? (
                <div className="error">
                  {t(
                    'Coverage information is unavailable. Do not assume all agencies are loaded.',
                    '暫時無法取得服務範圍，請勿假設所有公司資料已載入。',
                  )}
                </div>
              ) : (
                <div className="coverage-grid">
                  {agencies.map((a: any) => (
                    <article key={a.id}>
                      <TrainFront size={22} />
                      <h3>{a.name}</h3>
                      <span className="schedule-badge">
                        {a.loaded ||
                        a.status === 'ready' ||
                        a.status === 'valid'
                          ? (a.availableToday===false?t('No trips in today’s loaded schedule','已載入時間表今日無班次'):t('Schedules loaded', '已載入時間表'))
                          : t('Not yet verified', '尚未核實')}
                      </span>
                      <p>
                        {a.serviceStart || a.startDate || ''}{' '}
                        {a.serviceEnd || a.endDate
                          ? '→ ' + (a.serviceEnd || a.endDate)
                          : ''}
                      </p>
                      {safeUrl(a.source) && (
                        <a
                          href={safeUrl(a.source)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t('Official source', '官方來源')}
                          <ExternalLink size={13} />
                        </a>
                      )}
                    </article>
                  ))}
                </div>
              )}
              <div className="help-block">
                <h3>{t('What to know before travelling', '出發前要知道')}</h3>
                <p>
                  {t(
                    'Journeys use scheduled service. Unplanned closures, elevator outages and replacement buses may not be reflected in routing. Live TTC warnings are a separate source.',
                    '行程以時間表為基礎，突發封線、升降機故障及接駁巴士未必反映喺規劃結果。TTC 即時提示屬獨立來源。',
                  )}
                </p>
                <p>
                  {t(
                    'On-demand and specialized transit require a separate booking. This planner does not book rides or calculate fares.',
                    '預約及特殊交通服務需要另外訂車。呢個規劃工具唔會訂車或計算車費。',
                  )}
                </p>
                <p>
                  {t(
                    'Map data © OpenStreetMap contributors. Agency data is used under each source licence. This project is not affiliated with TTC, Metrolinx or Triplinx.',
                    '地圖資料 © OpenStreetMap contributors。交通資料按各來源授權使用。本項目與 TTC、Metrolinx 或 Triplinx 並無聯繫。',
                  )}
                </p>
              </div>
            </div>
          )}
          {tab === 'settings' && (
            <div className="page-panel settings">
              <span className="eyebrow">{t('MAKE IT YOURS', '按你喜好')}</span>
              <h2>{t('Settings & privacy', '設定及私隱')}</h2>
              <label>
                {t('Language', '語言')}
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value as Lang)}
                >
                  <option value="en">English</option>
                  <option value="zh">香港廣東話</option>
                  <option value="both">English + 廣東話</option>
                </select>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={dark}
                  onChange={(e) => setDark(e.target.checked)}
                />
                {t('Dark appearance', '深色外觀')}
              </label>
              <label>
                {t('English playfulness', '英文趣味程度')}{' '}
                <output>{funEn}/5</output>
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={funEn}
                  onChange={(e) => setFunEn(+e.target.value)}
                />
                <small>
                  {funEn === 1
                    ? 'Clear directions, at your pace.'
                    : funEn === 5
                      ? 'Your next connection. Minus the timetable gymnastics.'
                      : funEn === 2
                        ? 'Plan a straightforward journey.'
                        : funEn === 3
                          ? 'A smoother route to your next stop.'
                          : 'Find your route and let the region connect.'}
                </small>
              </label>
              <label>
                {t('Cantonese playfulness', '廣東話趣味程度')}{' '}
                <output>{funZh}/5</output>
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={funZh}
                  onChange={(e) => setFunZh(+e.target.value)}
                />
                <small>
                  {funZh === 1
                    ? '按需要規劃行程。'
                    : funZh === 5
                      ? '轉車可以，轉到頭暈就唔使喇。'
                      : funZh === 2
                        ? '清晰規劃每一程。'
                        : funZh === 3
                          ? '下一站，輕鬆到達。'
                          : '搵好路線，出門就放心啲。'}
                </small>
              </label>
              <div className="help-block">
                <h3>{t('Your journey stays yours', '你嘅行程，由你掌握')}</h3>
                <p>
                  {t(
                    'No account. No advertising. No analytics. Saved trips and preferences stay in this browser. Journey searches are sent to our routing service to calculate a route; precise locations are not retained in request logs.',
                    '毋須帳戶，無廣告，無追蹤分析。已儲存行程同設定只留喺呢個瀏覽器。搜尋會傳送到路線服務計算行程，請求記錄唔會保留精確位置。',
                  )}
                </p>
                <p>
                  {t(
                    'Sharing a trip creates a link containing both locations. Only share locations you are comfortable disclosing. Clearing browser storage removes saved trips and settings.',
                    '分享行程嘅連結包含起點同終點，只分享你願意公開嘅位置。清除瀏覽器儲存資料會移除行程同設定。',
                  )}
                </p>
                <h3>{t('Data and reliability', '資料及可靠程度')}</h3>
                <p>
                  {t(
                    'This is an independent planner. Always allow time for transfers and check official notices before travelling.',
                    '呢個係獨立規劃工具。請預留轉車時間，出發前查閱官方通告。',
                  )}
                </p>
              </div>
            </div>
          )}
        </section>
        <aside className="status-rail">
          <div className="rail-heading">
            <span className="eyebrow">{t('ON THE NETWORK', '交通網絡')}</span>
            <span
              className={
                'live-label ' + (status?.state === 'live' ? '' : 'muted')
              }
            >
              <span className="live-dot" />
              {status?.state === 'live'
                ? t('LIVE', '即時')
                : t('UNCONFIRMED', '未確認')}
            </span>
          </div>
          <h3>{t('TTC at a glance', 'TTC 一覽')}</h3>
          <p>{t('Subway & light rail', '地鐵及輕鐵')}</p>
          <div className="mini-lines">
            {status?.lines?.length ? (
              status.lines.map((line) => (
                <button
                  key={line.id}
                  onClick={() => {
                    setTab('status');
                    setExpandedLine(line.id);
                  }}
                >
                  <span
                    className="line-number"
                    style={{
                      background: line.color?.startsWith('#')
                        ? line.color
                        : '#555',
                    }}
                  >
                    {line.id}
                  </span>
                  <span>
                    <strong>{line.name.replace(/^Line \d+\s*/, '')}</strong>
                    <small>{lineState(line)}</small>
                  </span>
                  {line.state === 'disrupted' ? (
                    <TriangleAlert size={16} />
                  ) : (
                    <ChevronRight size={15} />
                  )}
                </button>
              ))
            ) : (
              <p className="data-note">
                {statusBusy
                  ? t('Connecting to TTC…', '連接 TTC 中…')
                  : t(
                      'Live status is unavailable. Check the official TTC updates.',
                      '暫時無法取得即時狀態，請查閱 TTC 官方更新。',
                    )}
              </p>
            )}
          </div>
          <button className="rail-link" onClick={() => setTab('status')}>
            {t('All service alerts', '所有服務提示')}
            <span>{totalAlerts}</span>
            <ArrowRight size={16} />
          </button>
          <div className="rail-tip">
            <Info size={21} />
            <h4>{t('A little transfer time helps.', '轉車，預鬆少少。')}</h4>
            <p>
              {t(
                'Scheduled connections are not a guarantee. Leave a buffer when your arrival matters.',
                '按時間表接駁並非保證，重要行程記得預留時間。',
              )}
            </p>
          </div>
          <div className="rail-footer">
            <ShieldCheck size={16} />
            <p>
              {t(
                'Official data. Independent perspective.',
                '官方資料，獨立規劃。',
              )}
            </p>
          </div>
        </aside>
      </main>
      <footer className="footer">
        <span>
          GTHA Transit{' '}
          <b>
            {version?.version
              ? 'v' + version.version
              : t('Version unavailable', '版本未能提供')}
          </b>
        </span>
        <span>
          {version?.builtAt
            ? t('Built', '建置') +
              ' ' +
              new Date(version.builtAt).toLocaleString('en-CA', {
                timeZone: 'America/Toronto',
                timeZoneName: 'short',
                hour12: false,
              })
            : t('Build provenance unavailable', '建置資料未能提供')}
        </span>
        <a href="https://github.com/Ding-Ding-Projects/gtha-transit">
          {t('Open source', '開源')}
        </a>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            onClick={() => setNotice('')}
            aria-label={t('Dismiss notification', '關閉通知')}
          >
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
