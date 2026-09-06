'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import PlaceSuggestionInfo from '../components/place-suggestion-info';
import DisruptionHistory from '../components/disruption-history';
import RealtimeCoverage from '../components/realtime-coverage';
import VehicleTracker from '../components/vehicle-tracker';
import RoutePicker from '../components/route-picker';
import LiveFollower, { type LiveFollowerVehicle } from '../components/live-follower';
import WashroomDetourPanel, { type WashroomFollowTarget, type WashroomPosition } from '../components/washroom-detour-panel';
import DestinationList, { type Destination } from '../components/destination-list';
import SelectedStopInfo, { RouteBadges, WashroomBadge } from '../components/stop-route-badges';
import VehiclePhotoCaption from '../components/vehicle-photo-caption';
import SettingsWorkspace from '../components/settings-workspace';
import JourneyTimeControls from '../components/journey-time-controls';
import WorkspaceNavigation from '../components/workspace-navigation';
import { useNarrator } from '../lib/narrator';
import { JourneyVehiclePreferencesPanel, type JourneyVehicleCriteria, type JourneyVehiclePreferenceOptions } from '../components/journey-vehicle-preferences';
import { applyJourneyPreferences } from '../vehicles/journey-preferences.mjs';
import { applyJourneyDivisionPreference, isCurrentDivisionEvidence } from '../vehicles/journey-division-preference.mjs';
import { applyJourneyRouteOpportunityPreference, currentRouteOpportunity } from '../vehicles/journey-route-opportunity-preference.mjs';
import { TTC_FLEET_RANGES, OTHER_FLEET_RANGES } from '../vehicles/fleet-registry.mjs';
import { copyAt } from '../lib/copy';
import { rideMetrics, kilometres } from '../lib/ride-metrics';
import { journeyWaits } from '../lib/journey-waits';
import { groupTtcDisruptions, type OfficialTtcRoute } from '../lib/disruption-groups';
import type { Place, Itinerary, TransitStatus, Line } from '../lib/types';
import {
  resolveTorontoTime,
  shiftTorontoTime,
  torontoLocalInput,
  isPlace,
  readStored,
} from '../lib/journey-utils';

type Lang = 'en' | 'zh' | 'both';
type RequiredRoute = { feedId: string; routeId: string };
const validRequiredRoute = (value: unknown): value is RequiredRoute => !!value && typeof value === 'object' && ['feedId', 'routeId'].every(key => typeof (value as Record<string, unknown>)[key] === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test((value as Record<string, string>)[key]));
type Saved = { id: string; from: Place; to: Place; via?: Place[]; requiredRoute?: RequiredRoute | null; preferDivision?: boolean; divisionMode?: 'exact' | 'route' };
const planPoint = (place: Place): Place => ({ id: place.id, name: place.name, lat: place.lat, lon: place.lon, ...(place.kind ? { kind: place.kind } : {}), ...(place.agency ? { agency: place.agency } : {}) });
const time = (v: number | string) =>
  new Date(typeof v === 'number' && v < 1e12 ? v * 1000 : v).toLocaleTimeString(
    'en-CA',
    { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit' },
  );
const mins = (seconds: number) =>
  seconds > 0 && seconds < 60 ? '<1' : Math.round(seconds / 60);
const distance = (m: number) =>
  m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
const localInput = torontoLocalInput;
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
  when,
}: {
  label: string;
  value: Place | null;
  onChange: (p: Place | null) => void;
  t: (en: string, zh: string) => string;
  onMap: () => void;
  when?: string;
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
    setActive(-1);
    setItems([]);
    setError('');
    if (query.length < 2 || query === value?.name) {
      setBusy(false);
      return;
    }
    setBusy(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query });
        if (when && /^\d{4}-\d{2}-\d{2}/.test(when)) params.set('date', when.slice(0, 10));
        const r = await fetch('/api/places?' + params, {
          signal: controller.signal,
        });
        if (!r.ok) throw Error();
        const data = (await r.json()) as { places?: Place[]; partial?: boolean };
        if (controller.signal.aborted) return;
        setItems((data.places || []).map(place => ({ ...place, servingRoutesDate: when?.slice(0, 10) })));
        if (data.partial && !data.places?.length) setError(t('Some place sources are unavailable. Try again or choose a point on the map.', '部分地點來源暫時未能使用，請再試或喺地圖揀選。'));
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
  }, [query, value, t, when]);
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
          aria-busy={busy}
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
            setItems([]);
            setActive(-1);
            setError('');
            setBusy(e.target.value.length >= 2);
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
        {query && <button type="button" className="icon-button clear-place" aria-label={t('Clear', '清除') + ' ' + label} onMouseDown={(event) => event.preventDefault()} onClick={() => {
          onChange(null); setQuery(''); setItems([]); setActive(-1); setError(''); setBusy(false); setOpen(false);
          box.current?.querySelector('input')?.focus();
        }}><X size={17} aria-hidden="true" /></button>}
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
      {value && <div className="selected-place-name">{value.name}</div>}
      {value && <SelectedStopInfo place={value} when={when} t={t} />}
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
                  <PlaceSuggestionInfo place={p} t={t} />
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
  const narrator = useNarrator();
  const [ttcRoutes, setTtcRoutes] = useState<OfficialTtcRoute[]>([]);
  const [vehicleCriteria, setVehicleCriteria] = useState<JourneyVehicleCriteria>({});
  const [vehicleOptions, setVehicleOptions] = useState<JourneyVehiclePreferenceOptions>({});
  const [preferDivision, setPreferDivision] = useState(false);
  const [divisionMode, setDivisionMode] = useState<'exact' | 'route'>('route');
  const [divisionNow, setDivisionNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setDivisionNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  const [destinations, setDestinations] = useState<Destination[]>([{ id: 'destination-1', place: null }]);
  const [requiredRoute, setRequiredRoute] = useState<{ feedId: string; routeId: string } | null>(null);
  const [follower, setFollower] = useState<{ journey?: Itinerary; vehicle?: LiveFollowerVehicle } | null>(null);
  const followerAnchor = useRef<HTMLDivElement>(null);
  const followerReturn = useRef<HTMLElement | null>(null);
  const [followerSession, setFollowerSession] = useState(0);
  const [washroomRequest, setWashroomRequest] = useState<{ position?: WashroomPosition; destinations: Place[] } | null>(null);
  const [washroomTarget, setWashroomTarget] = useState<(WashroomFollowTarget & { expectedArrival?: number | string }) | null>(null);
  const washroomAnchor = useRef<HTMLDivElement>(null);
  const washroomReturn = useRef<HTMLElement | null>(null);
  useEffect(() => { if (washroomRequest) washroomAnchor.current?.focus(); }, [washroomRequest]);
  const openFollower = (next: { journey?: Itinerary; vehicle?: LiveFollowerVehicle }) => {
    followerReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFollowerSession(value => value + 1);
    setWashroomTarget(null);
    setFollower(next);
  };
  const closeFollower = () => { setFollower(null); requestAnimationFrame(() => { if (followerReturn.current?.isConnected) followerReturn.current.focus(); }); };
  useEffect(() => {
    if (follower) followerAnchor.current?.focus();
  }, [follower]);
  const to = destinations[destinations.length - 1]?.place || null;
  const viaPlaces = useMemo(() => destinations.slice(0, -1).map(item => item.place), [destinations]);
  const setTo = useCallback((place: Place | null) => setDestinations(current => current.map((item, index) => index === current.length - 1 ? { ...item, place } : item)), []);
  const [lang, setLang] = useState<Lang>('en'),
    [dark, setDark] = useState(false),
    [funEn, setFunEn] = useState(5),
    [funZh, setFunZh] = useState(5),
    [tab, setTab] = useState('plan');
  const [from, setFrom] = useState<Place | null>(null),
    [arriveBy, setArriveBy] = useState(false),
    [preference, setPreference] = useState('fastest'),
    [wheelchair, setWheelchair] = useState(false),
    [preferWashrooms, setPreferWashrooms] = useState(false),
    [maxWalk, setMaxWalk] = useState(1500);
  const [travelTime, setTravelTime] = useState<{ local: string; instant?: string }>({ local: '' });
  const when = travelTime.local;
  const setWhen = useCallback((local: string, instant?: string) => setTravelTime({ local, instant }), []);
  const [allJourneys, setJourneys] = useState<Itinerary[]>([]),
    [plannedDeparture, setPlannedDeparture] = useState<string | null>(null),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [planned, setPlanned] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [picking, setPicking] = useState<string | null>(null),
    [mapVisible, setMapVisible] = useState(true);
  const [status, setStatus] = useState<TransitStatus | null>(null),
    [statusBusy, setStatusBusy] = useState(false),
    [expandedLine, setExpandedLine] = useState<string | null>(null),
    [saved, setSaved] = useState<Saved[]>([]),
    [coverage, setCoverage] = useState<any>(null),
    [version, setVersion] = useState<any>(null),
    [provenance, setProvenance] = useState<any>(null);
  const vehicleResult = useMemo(() => applyJourneyPreferences(allJourneys, vehicleCriteria, vehicleOptions), [allJourneys, vehicleCriteria, vehicleOptions]);
  const divisionResult = useMemo(() => divisionMode === 'route' ? applyJourneyRouteOpportunityPreference(vehicleResult.itineraries, { enabled: preferDivision, now: divisionNow }) : applyJourneyDivisionPreference(vehicleResult.itineraries, { enabled: preferDivision, now: divisionNow }), [vehicleResult.itineraries, preferDivision, divisionMode, divisionNow]);
  const journeys: Itinerary[] = divisionResult.itineraries;
  const selected = Math.max(0, journeys.findIndex(journey => journey.id === selectedId));
  useEffect(() => { if (!journeys.some(journey => journey.id === selectedId)) setSelectedId(journeys[0]?.id ?? null); }, [journeys, selectedId]);
  useEffect(() => setSelectedId(null), [vehicleCriteria, vehicleOptions]);
  const request = useRef<AbortController | null>(null),
    generation = useRef(0),
    hydrated = useRef(false);
  const t = useCallback(
    (en: string, zh: string) => {
      const a = copyAt(en, 'en', funEn),
        b = copyAt(zh, 'zh', funZh);
      return lang === 'zh' ? b : lang === 'both' ? `${a} · ${b}` : a;
    },
    [lang, funEn, funZh],
  );
  const translate = t;
  const narrate = (category: string, en: string, zh: string, critical = false) =>
    narrator.announce({ category, en: copyAt(en, 'en', funEn), zh: copyAt(zh, 'zh', funZh), critical });
  const statusRequest = useRef<AbortController | null>(null),
    statusGeneration = useRef(0);
  const activeInputs = useRef('');
  useEffect(() => {
    if (
      activeInputs.current ===
      JSON.stringify([
        from,
        to,
        travelTime,
        arriveBy,
        preference,
        wheelchair,
        maxWalk,
        preferWashrooms,
        viaPlaces,
        requiredRoute,
      ])
    )
      return;
    request.current?.abort();
    generation.current++;
    setLoading(false);
    setPlanned(false);
    setJourneys([]);
    setError('');
  }, [
    from,
    to,
    travelTime,
    arriveBy,
    preference,
    wheelchair,
    maxWalk,
    preferWashrooms,
    viaPlaces,
    requiredRoute,
  ]);
  useEffect(() => {
    const initialTime = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    setWhen(localInput(initialTime), initialTime.toISOString());
    try {
      const prefs =
        readStored<Record<string, any>>('gtha-preferences', {}) || {};
      if (['en', 'zh', 'both'].includes(prefs.lang)) setLang(prefs.lang);
      setDark(prefs.dark === true);
      if (prefs.funEn >= 1 && prefs.funEn <= 5) setFunEn(prefs.funEn);
      if (prefs.funZh >= 1 && prefs.funZh <= 5) setFunZh(prefs.funZh);
      const criteria = prefs.vehicleCriteria;
      if (criteria && typeof criteria === 'object') {
        setVehicleCriteria({
          manufacturer: typeof criteria.manufacturer === 'string' ? criteria.manufacturer.slice(0, 120) : undefined,
          model: typeof criteria.model === 'string' ? criteria.model.slice(0, 120) : undefined,
          yearFrom: Number.isInteger(criteria.yearFrom) && criteria.yearFrom >= 1800 && criteria.yearFrom <= 3000 ? criteria.yearFrom : undefined,
          yearTo: Number.isInteger(criteria.yearTo) && criteria.yearTo >= 1800 && criteria.yearTo <= 3000 ? criteria.yearTo : undefined,
          match: criteria.match === 'any' ? 'any' : 'all',
        });
      }
      if (prefs.vehicleOptions && typeof prefs.vehicleOptions === 'object') setVehicleOptions({ prefer: prefs.vehicleOptions.prefer === true, avoid: prefs.vehicleOptions.avoid === true, includeUnconfirmed: prefs.vehicleOptions.includeUnconfirmed === true });
      setPreferDivision(prefs.preferDivision === true);
      setDivisionMode(prefs.divisionMode === 'exact' || (prefs.preferDivision === true && !prefs.divisionMode) ? 'exact' : 'route');
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
                isPlace((x as Saved).to) &&
                ((x as Saved).via === undefined || (Array.isArray((x as Saved).via) && (x as Saved).via!.length <= 5 && (x as Saved).via!.every(isPlace))),
            )
            .slice(0, 100),
        );
      const params = new URLSearchParams(location.search);
      if (params.has('preferDivision')) setPreferDivision(params.get('preferDivision') === '1');
      if (['exact', 'route'].includes(params.get('divisionMode') || '')) setDivisionMode(params.get('divisionMode') as 'exact' | 'route');
      const sharedRoute = { feedId: params.get('requiredAgency'), routeId: params.get('requiredRoute') };
      if (validRequiredRoute(sharedRoute)) setRequiredRoute(sharedRoute);
      const sharedTime = params.get('dateTime');
      if (sharedTime && /(?:Z|[+-]\d{2}:\d{2})$/.test(sharedTime) && Number.isFinite(Date.parse(sharedTime))) setWhen(torontoLocalInput(new Date(sharedTime)), new Date(sharedTime).toISOString());
      if (params.get('arriveBy') === '1') setArriveBy(true);
      const sharedPreference = params.get('preference');
      if (sharedPreference && ['fastest', 'transfers', 'walking', 'waiting'].includes(sharedPreference)) setPreference(sharedPreference);
      const read = (key: string, raw = params.get(key)) => {
        if (!raw) return null;
        const [lat, lon, ...name] = raw.split(',');
        return lat?.trim() && lon?.trim() && Number.isFinite(+lat) &&
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
      const encodedVia = params.getAll('via');
      const sharedVia = encodedVia.slice(0, 5).map((raw, index) => read(`via-${index}`, raw));
      if (encodedVia.length > 5 || sharedVia.some(place => !place)) {
        setNotice('The shared trip contains an invalid or unsupported destination list. Choose the destinations again.');
        setDestinations([{ id: 'destination-1', place: null }]);
      } else setDestinations([...sharedVia, read('to')].map((place, index) => ({ id: `destination-${index}`, place })));
    } catch {}
    hydrated.current = true;
    fetch('/version.json')
      .then((r) => r.json())
      .then(setVersion)
      .catch(() => {});
  }, [setWhen]);
  useEffect(() => {
    let controller: AbortController | undefined;
    const refresh = async () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const response = await fetch('/api/coverage', {
          signal: current.signal,
          cache: 'no-store',
        });
        if (!response.ok) return;
        const next = await response.json();
        if (!current.signal.aborted) setCoverage(next);
      } catch {
        // Retain the last confirmed coverage during a transient outage.
      }
    };
    void refresh();
    const timer = setInterval(refresh, 60_000);
    return () => {
      clearInterval(timer);
      controller?.abort();
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
    if (hydrated.current)
      try {
        localStorage.setItem(
          'gtha-preferences',
          JSON.stringify({ lang, dark, funEn, funZh, vehicleCriteria, vehicleOptions, preferDivision, divisionMode }),
        );
      } catch {
        setNotice(
          t(
            'Preferences could not be saved in this browser.',
            '呢個瀏覽器無法儲存設定。',
          ),
        );
      }
  }, [lang, dark, funEn, funZh, vehicleCriteria, vehicleOptions, preferDivision, divisionMode]);
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
  async function plan(override?: { local: string; instant?: string }) {
    if (!from || !to || viaPlaces.some(place => !place)) {
      narrate('journey-error', 'Choose every location from the suggestions or map.', '請喺建議清單或地圖選擇每個地點。', true);
      setError(
        t(
          'Choose every location from the suggestions or map.',
          '請喺建議清單或地圖選擇每個地點。',
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
      override ?? travelTime,
      arriveBy,
      preference,
      wheelchair,
      maxWalk,
      preferWashrooms,
      viaPlaces,
      requiredRoute,
    ]);
    setLoading(true);
    setError('');
    setPlanned(true);
    setJourneys([]);
    const timer = setTimeout(() => controller.abort(), requiredRoute ? 35000 : 25000);
    try {
      const selectedTime = override ?? travelTime;
      const requestedTime = resolveTorontoTime(selectedTime.local, selectedTime.instant);
      const r = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: planPoint(from),
          to: planPoint(to),
          via: viaPlaces.filter((place): place is Place => !!place).map(planPoint),
          dateTime: requestedTime,
          arriveBy,
          preference,
          wheelchair,
          maxWalkDistance: maxWalk,
          preferWashrooms,
          ...(requiredRoute ? { requiredRoute } : {}),
        }),
        signal: controller.signal,
      });
      const data = (await r.json()) as {
        message?: string;
        error?: string;
        itineraries?: Itinerary[];
        data?: unknown;
        code?: string;
        failedSegment?: { from?: { name?: string }; to?: { name?: string } };
      };
      if (!r.ok && data.code === 'MULTI_STOP_INCOMPLETE') throw Error(t(
        `No complete trip was verified through every destination. Check the segment from ${data.failedSegment?.from?.name || 'the preceding location'} to ${data.failedSegment?.to?.name || 'the next location'}, or try another departure time.`,
        `未能確認途經全部目的地的完整行程。請檢查由 ${data.failedSegment?.from?.name || '上一個地點'} 至 ${data.failedSegment?.to?.name || '下一個地點'} 的路段，或嘗試其他出發時間。`,
      ));
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
      setPlannedDeparture(arriveBy ? null : requestedTime);
      setSelectedId(null);
      setDivisionNow(Date.now());
      setProvenance(data.data);
      setTab('plan');
      const count = applyJourneyPreferences(data.itineraries || [], vehicleCriteria, vehicleOptions).itineraries.length;
      narrate('journey-ready', count ? `${count} journey options are ready.` : 'No journey options were found for these choices.', count ? `已準備好 ${count} 個行程選項。` : '呢組選擇搵唔到行程選項。');
    } catch (e: any) {
      if (id === generation.current) {
        narrate('journey-error', e.name === 'AbortError' ? 'The search timed out. Please try again.' : 'Journey planning could not complete. The planner shows the details.', e.name === 'AbortError' ? '搜尋逾時，請再試。' : '未能完成行程規劃，請查看畫面詳情。', true);
        setError(
          e.name === 'AbortError'
            ? t('The search timed out. Please try again.', '搜尋逾時，請再試。')
            : e.message,
        );
      }
    } finally {
      clearTimeout(timer);
      if (id === generation.current) setLoading(false);
    }
  }
  function swap() {
    setPicking(null);
    const reversed = [from, ...destinations.map(item => item.place)].reverse();
    setFrom(reversed[0]);
    setDestinations(reversed.slice(1).map((place, index) => ({ id: `destination-reversed-${index}`, place })));
    setJourneys([]);
    setPlanned(false);
  }
  function save() {
    if (!from || !to) return;
    const id = `${from.lat},${from.lon}:${to.lat},${to.lon}`;
    if (viaPlaces.some(place => !place)) return;
    const via = viaPlaces.filter((place): place is Place => !!place).map(planPoint);
    const savedId = id + (via.length ? ':' + via.map(place => `${place.lat},${place.lon}`).join(';') : '') + (requiredRoute ? `:${requiredRoute.feedId}:${requiredRoute.routeId}` : '');
    const next = [{ id: savedId, from: planPoint(from), to: planPoint(to), via, requiredRoute, preferDivision, divisionMode }, ...saved.filter((x) => x.id !== savedId)].slice(0, 100);
    try {
      localStorage.setItem('gtha-saved', JSON.stringify(next));
    } catch {
      setNotice(t('This browser could not save the trip. Your current journey remains open.', '呢個瀏覽器未能儲存行程，目前行程仍然開啟。'));
      narrate('save-error', 'This browser could not save the trip. Your current journey remains open.', '呢個瀏覽器未能儲存行程，目前行程仍然開啟。', true);
      return;
    }
    setSaved(next);
    setNotice(t('Trip saved on this device.', '行程已儲存喺呢部裝置。'));
    narrate('trip-saved', 'Trip saved on this device.', '行程已儲存喺呢部裝置。');
  }
  function shiftJourney(minutes: number) {
    try {
      const next = shiftTorontoTime(when, minutes, travelTime.instant);
      setTravelTime(next);
      void plan(next);
    } catch {
      setNotice(t('Choose a valid date and time before moving the journey time.', '更改行程時間前，請選擇有效日期同時間。'));
    }
  }
  async function share() {
    if (!from || !to || viaPlaces.some(place => !place)) return;
    let sharedTime: string;
    try { sharedTime = resolveTorontoTime(when, travelTime.instant); }
    catch {
      setNotice(t('Choose a valid date and time before sharing this trip.', '分享行程前，請選擇有效日期同時間。'));
      return;
    }
    const url = new URL(location.origin);
    url.searchParams.set('from', `${from.lat},${from.lon},${from.name}`);
    url.searchParams.set('to', `${to.lat},${to.lon},${to.name}`);
    for (const place of viaPlaces) if (place) url.searchParams.append('via', `${place.lat},${place.lon},${place.name}`);
    url.searchParams.set('dateTime', sharedTime);
    if (arriveBy) url.searchParams.set('arriveBy', '1');
    url.searchParams.set('preference', preference);
    url.searchParams.set('preferDivision', preferDivision ? '1' : '0');
    url.searchParams.set('divisionMode', divisionMode);
    if (requiredRoute) { url.searchParams.set('requiredAgency', requiredRoute.feedId); url.searchParams.set('requiredRoute', requiredRoute.routeId); }
    try {
      await navigator.clipboard.writeText(url.href);
      setNotice(
        t(
          'Link copied. It includes every selected trip location and the selected travel time.',
          '連結已複製，包含所有已選行程地點同所選時間。',
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
      via: viaPlaces,
      requestedLocalTime: when,
      arriveBy,
      preference,
      vehiclePreferences: { criteria: vehicleCriteria, options: vehicleOptions },
      preferDivision,
      divisionMode,
      requiredRoute,
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
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  const disruptionGroups = useMemo(() => groupTtcDisruptions(status?.alerts || [], ttcRoutes), [status, ttcRoutes]);
  const totalAlerts = disruptionGroups.totalDistinct;
  useEffect(() => {
    if (tab !== 'status') return;
    const controller = new AbortController();
    void (async () => {
      try {
        const records: OfficialTtcRoute[] = [];
        let cursor: string | null = null;
        const date = localInput().slice(0, 10);
        for (let page = 0; page < 5; page++) {
          const params = new URLSearchParams({ agency: 'ttc', date, limit: '200' });
          if (cursor) params.set('cursor', cursor);
          const response = await fetch('/api/routes?' + params, { signal: controller.signal });
          if (!response.ok) return;
          const body = await response.json() as { routes?: OfficialTtcRoute[]; nextCursor?: string | null };
          if (!Array.isArray(body.routes)) return;
          records.push(...body.routes);
          if (!body.nextCursor) { if (!controller.signal.aborted) setTtcRoutes(records); return; }
          cursor = body.nextCursor;
        }
      } catch { /* Alerts remain visible with unknown route classifications. */ }
    })();
    return () => controller.abort();
  }, [tab]);
  const agencies = coverage?.agencies || [];
  let selectedDate = '';
  try { resolveTorontoTime(when, travelTime.instant); selectedDate = when.slice(0, 10); }
  catch { /* Incomplete fields do not establish a service-coverage verdict. */ }
  const serviceDate = selectedDate.replaceAll('-', '');
  const dateGaps = selectedDate ? agencies.filter(
    (a: any) =>
      a.activeTripsByDate?.[selectedDate] === 0 ||
      (a.serviceStart && String(a.serviceStart) > serviceDate) ||
      (a.serviceEnd && String(a.serviceEnd) < serviceDate),
  ) : [];
  const nextCoveredDate = selectedDate ? [
    ...new Set<string>(
      agencies.flatMap((a: any) => Object.keys(a.activeTripsByDate || {})),
    ),
  ]
    .sort()
    .find(
      (d) =>
        d > selectedDate &&
        dateGaps.every((a: any) => (a.activeTripsByDate?.[d] || 0) > 0),
    ) : undefined;
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
      <WorkspaceNavigation active={tab} onChange={setTab} dark={dark} onTheme={() => setDark(!dark)} t={t} />
      <div className="workspace-topline">
        <div><span className="workspace-label">{t('GREATER TORONTO & HAMILTON', '大多倫多及咸美頓')}</span><h1 id="workspace-heading" tabIndex={-1}>{({ plan: t('Plan your next connection', '規劃你嘅下一程'), vehicles: t('Find your next ride', '搵你嘅下一程車'), status: t('The network, right now', '交通網絡現況'), divisions: t('Beyond the usual garage', '跨越平日車廠分配'), history: t('The service record', '服務歷史記錄'), saved: t('Ready when you are', '隨時準備出發'), coverage: t('Across the whole region', '接通整個地區'), settings: t('Make yourself at home', '按你喜好設定') } as Record<string, string>)[tab]}</h1></div>
        <div className="build-stamp"><strong>{version?.version ? 'v' + version.version : t('Version unavailable', '版本未能提供')}{version?.commit ? ' · ' + version.commit.slice(0, 7) : ''}</strong><span>{version?.builtAt && Number.isFinite(Date.parse(version.builtAt)) ? t('Updated', '更新') + ' ' + new Date(version.builtAt).toLocaleString('en-CA', { timeZone: 'America/Toronto', timeZoneName: 'short', hour12: false, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : t('Build provenance unavailable', '建置資料未能提供')}</span></div>
      </div>
      <main id="main" className="workspace">
        <aside className="planner" hidden={tab !== 'plan'} aria-label={t('Journey planner', '行程規劃')}>
          <div className="eyebrow">
            {t('A BETTER WAY ACROSS THE REGION', '輕鬆接駁全個地區')}
          </div>
          <h2>{t('Where to next?', '下一站，去邊？')}</h2>
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
                when={when}
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
                title={t('Swap origin and destination', '交換起點同終點')}
              >
                <ArrowDownUp size={18} aria-hidden="true" />
                <span>{t('Reverse trip', '反轉行程')}</span>
              </button>
              <DestinationList items={destinations} t={t} onChange={next => {
                setDestinations(next);
                if (picking && picking !== 'from' && !next.some(item => item.id === picking)) setPicking(null);
              }} renderField={(item, index) => <PlaceField
                label={index === destinations.length - 1 ? t('To', '終點') : t(`Stop ${index + 1}`, `中途地點 ${index + 1}`)}
                value={item.place}
                onChange={place => setDestinations(current => current.map(row => row.id === item.id ? { ...row, place } : row))}
                t={translate}
                when={when}
                onMap={() => { setPicking(item.id); setMapVisible(true); setTab('plan'); }}
              />} />
            </div>
            <button
              type="button"
              className="text-button locate"
              onClick={locate}
            >
              <LocateFixed size={16} />
              {t('Use my location', '使用目前位置')}
            </button>
            <JourneyTimeControls value={when} instant={travelTime.instant} arriveBy={arriveBy}
              onChange={setWhen} onModeChange={setArriveBy} t={t} />
            <details className="options">
              <summary>
                <Settings size={16} />
                {t('Journey preferences', '行程偏好')}
                <ChevronRight size={16} />
              </summary>
              <section className="required-route-control" aria-label={t('Include a route in this trip', '行程必須包括路線')}>
                <h3>{t('A route you want to ride', '你想乘搭嘅路線')}</h3>
                <p className="data-note">{t('Take a detour to actually ride this route. Connections may take longer. Results must include a transit leg on your selected route.', '繞路實際乘搭此路線，接駁可能較長。結果必須包括所選路線嘅乘車路段。')}</p>
                <button type="button" className="pill" aria-pressed={requiredRoute?.feedId === 'ttc' && requiredRoute.routeId === '5'} onClick={() => setRequiredRoute({ feedId: 'ttc', routeId: '5' })}>{t('I want to ride Line 5', '我想搭 5 號線')}</button>
                <RoutePicker agency={requiredRoute?.feedId || 'ttc'} route={requiredRoute?.routeId || ''} date={when.slice(0, 10)} singleRoute storageId="journey-required-route" t={t} onChange={(feedId, routeId) => setRequiredRoute(routeId ? { feedId, routeId } : null)} />
                {requiredRoute ? <button type="button" className="text-button" onClick={() => setRequiredRoute(null)}>{t('Remove required route', '取消必經路線')}</button> : <small>{t('No required route selected', '未選擇必經路線')}</small>}
              </section>
              <div className="journey-priority" role="group" aria-label={t('Prioritize', '優先考慮')}>
                {[
                  ['fastest', t('Fastest journey', '最快到達')],
                  ['transfers', t('Fewer transfers', '減少轉車')],
                  ['walking', t('Less walking', '減少步行')],
                  ['waiting', t('Less transfer waiting', '減少轉車等候')],
                ].map(([value, label]) => <button key={value} type="button" aria-pressed={preference === value} onClick={() => setPreference(value)}>{label}</button>)}
              </div>
              {preference === 'waiting' && <p className="data-note">{t('Favors less time waiting between services, even when the ride takes longer. Walking and the longer journey remain visible.', '優先減少班次之間嘅等候，就算車程較長都可以。步行同增加嘅行程時間仍會清楚顯示。')}</p>}
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
              <label className="check">
                <input
                  type="checkbox"
                  checked={preferWashrooms}
                  onChange={(e) => setPreferWashrooms(e.target.checked)}
                />
                {t('Prefer washrooms', '優先經有洗手間嘅車站')}
              </label>
              <small>
                {t(
                  'Transit-facility washrooms only. Prefers practical connections through confirmed stations or terminals; opening hours and availability may be unknown.',
                  '只限交通設施內嘅洗手間，優先選擇經已確認車站或總站嘅合理接駁，開放時間及可用狀況可能未有資料。',
                )}
              </small>
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
            <JourneyVehiclePreferencesPanel criteria={vehicleCriteria} options={vehicleOptions} verifiedFleetFacts={[...TTC_FLEET_RANGES, ...Object.values(OTHER_FLEET_RANGES).flat()]} excludedCount={vehicleResult.excluded.length} onCriteriaChange={setVehicleCriteria} onOptionsChange={setVehicleOptions} t={t} />
            <details className="journey-division-options">
              <summary><TrainFront size={16} aria-hidden="true" />{t('TTC garage preference', 'TTC 車廠偏好')}{preferDivision ? t(' · Active', ' · 已啟用') : ''}</summary>
              <label className="journey-division-choice"><input type="checkbox" checked={preferDivision} onChange={event => setPreferDivision(event.target.checked)} /><span><strong>{t('Prefer out-of-division vehicles', '優先乘搭跨車廠車輛')}</strong><small>{t('Promote current TTC opportunities while keeping every unconfirmed option available. Choose which evidence to use below.', '優先顯示目前 TTC 乘車機會，同時保留所有未確認行程。請在下方選擇資料依據。')}</small></span></label>
              {preferDivision && <fieldset className="journey-division-modes"><legend>{t('Preference evidence', '偏好資料依據')}</legend><button type="button" className="pill" aria-pressed={divisionMode === 'route'} onClick={() => setDivisionMode('route')}>{t('Current route observations', '目前路線觀察')}</button><button type="button" className="pill" aria-pressed={divisionMode === 'exact'} onClick={() => setDivisionMode('exact')}>{t('Exact assigned trip', '確實編配班次')}</button><p className="data-note">{divisionMode === 'route' ? t('A route currently reports an out-of-division vehicle. This does not identify the vehicle for your departure. Observations expire automatically.', '路線目前通報有跨車廠車輛，但未能確認你班次嘅車輛。觀察資料會自動過期。') : t('Requires a fresh, exact vehicle assignment for your trip. Assignments can change before boarding.', '需要你班次嘅最新精確車輛編配。上車前編配可能改變。')}</p></fieldset>}
              {preferDivision && planned && <p className="data-note" role="status">{divisionResult.matched ? t(`${divisionResult.matched} options have verified out-of-division evidence.`, `${divisionResult.matched} 個行程有已核實跨車廠資料。`) : t('No returned option has verified out-of-division evidence. The existing options remain in order.', '返回嘅行程未有已核實跨車廠資料。現有選項保持次序。')}</p>}
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
          {!!dateGaps.length && (
            <div className="error" role="status">
              <TriangleAlert size={18} />
              <span>
                {t(
                  'No scheduled trips are loaded for this date for:',
                  '所選日期未有載入以下公司嘅有效班次：',
                )}{' '}
                {dateGaps.map((a: any) => a.name).join(', ')}.{' '}
                {t(
                  'This is a data-coverage gap, not a report that transit is closed.',
                  '呢個係資料覆蓋缺口，唔係交通停駛通報。',
                )}
                {nextCoveredDate && (
                  <button
                    className="pill"
                    onClick={() =>
                      setWhen(
                        nextCoveredDate + 'T' + (when.slice(11) || '09:00'),
                      )
                    }
                  >
                    {t('Use next covered date', '使用下一個有資料嘅日期')}:{' '}
                    {nextCoveredDate}
                  </button>
                )}
              </span>
            </div>
          )}
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
          {follower && <div ref={followerAnchor} tabIndex={-1} className="follower-anchor"><LiveFollower key={followerSession} {...follower} t={t} onClose={closeFollower} washroomTarget={washroomTarget} onWashroomRequest={({ position }) => { washroomReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setWashroomRequest({ position, destinations: destinations.map(item => item.place).filter((place): place is Place => !!place) }); }} onAnnounce={message => narrate('follower', message.en, message.zh)} onChooseVehicle={() => { setFollower(null); setTab('vehicles'); requestAnimationFrame(() => document.querySelector<HTMLElement>('.route-picker-trigger')?.focus()); }} /></div>}
          {washroomRequest && <div ref={washroomAnchor} tabIndex={-1} className="follower-anchor"><WashroomDetourPanel {...washroomRequest} t={t} onClose={() => { setWashroomRequest(null); requestAnimationFrame(() => { if (washroomReturn.current?.isConnected) washroomReturn.current.focus(); }); }} onFollow={(journey, target) => { openFollower({ journey }); setWashroomTarget({ ...target, expectedArrival: journey.endTime }); }} /></div>}
          {tab === 'history' && <DisruptionHistory t={t} />}
          {tab === 'vehicles' && <VehicleTracker t={t} onFollow={vehicle => openFollower({ vehicle })} />}
          {tab === 'divisions' && <VehicleTracker key="divisions" t={t} divisionMode onFollow={vehicle => openFollower({ vehicle })} />}
          {tab === 'coverage' && <RealtimeCoverage t={t} />}
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
                  via={viaPlaces}
                  journey={current}
                  picking={!!picking}
                  pickLabel={picking === 'from' ? t('Choose the origin', '選擇起點') : t(`Choose destination ${destinations.findIndex(item => item.id === picking) + 1}`, `選擇第 ${destinations.findIndex(item => item.id === picking) + 1} 個目的地`)}
                  onPick={(lat, lon) => {
                    const p = {
                      id: 'map',
                      name: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
                      lat,
                      lon,
                    };
                    if (picking === 'from') setFrom(p);
                    else if (picking) setDestinations(current => current.map(item => item.id === picking ? { ...item, place: p } : item));
                    else setTo(p);
                    setPicking(null);
                  }}
                />
                <div className="map-label">
                  <MapPin size={14} />
                  {picking
                    ? t(
                        `Choose ${picking === 'from' ? 'the origin' : 'destination ' + (destinations.findIndex(item => item.id === picking) + 1)} on the map`,
                        `在地圖選擇${picking === 'from' ? '起點' : '第 ' + (destinations.findIndex(item => item.id === picking) + 1) + ' 個目的地'}`,
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
                          onClick={() => setSelectedId(j.id)}
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
                          <div className="departure-comparison">
                            {journeyWaits(j, plannedDeparture)
                              .transferWaitSeconds === null && (
                              <span>
                                {t(
                                  'Transfer timing is unavailable or too short; check the connection before travelling.',
                                  '轉車時間未能核實或太短，出發前請確認接駁。',
                                )}
                              </span>
                            )}
                            {plannedDeparture && (
                              <span>
                                {t('If you leave at', '如果你喺以下時間出發')}{' '}
                                {time(plannedDeparture)}
                              </span>
                            )}
                            {journeyWaits(j, plannedDeparture)
                              .firstBoarding && (
                              <strong>
                                {t('First boarding', '首次上車')}{' '}
                                {time(
                                  journeyWaits(j, plannedDeparture)
                                    .firstBoarding!,
                                )}
                              </strong>
                            )}
                            {journeyWaits(j, plannedDeparture)
                              .firstWaitSeconds !== null && (
                              <span>
                                {mins(
                                  journeyWaits(j, plannedDeparture)
                                    .firstWaitSeconds!,
                                )}{' '}
                                min{' '}
                                {t(
                                  'waiting before first service, walking excluded',
                                  '首次上車前等候，不包括步行',
                                )}
                              </span>
                            )}
                            {journeyWaits(j, plannedDeparture)
                              .transferWaitSeconds !== null && (
                              <span>
                                {mins(
                                  journeyWaits(j, plannedDeparture)
                                    .transferWaitSeconds!,
                                )}{' '}
                                min {t('transfer waiting', '轉車等候')}
                              </span>
                            )}
                            {journeyWaits(j, plannedDeparture)
                              .elapsedSeconds !== null && (
                              <strong>
                                {mins(
                                  journeyWaits(j, plannedDeparture)
                                    .elapsedSeconds!,
                                )}{' '}
                                min{' '}
                                {t(
                                  'from your chosen departure time',
                                  '由你選定出發時間計起',
                                )}
                              </strong>
                            )}
                          </div>
                          <div className="journey-meta">
                            <span className="ride-stat">
                              <TrainFront size={18} />
                              <strong>
                                {mins(rideMetrics(j).rideSeconds)} min
                              </strong>
                              {t('on transit', '乘車')}
                            </span>
                            <span className="ride-stat">
                              <Route size={18} />
                              <strong>
                                {kilometres(rideMetrics(j).totalMetres)}
                              </strong>
                              {t('total distance', '全程距離')}
                            </span>
                            <span className="ride-stat">
                              <Footprints size={18} />
                              <strong>
                                {mins(rideMetrics(j).walkSeconds)} min ·{' '}
                                {kilometres(j.walkDistance)}
                              </strong>
                              {t('walking', '步行')}
                            </span>
                            <span className="ride-stat">
                              <Clock size={18} />
                              <strong>
                                {mins(rideMetrics(j).waitSeconds)} min
                              </strong>
                              {t('waiting / transfers', '等車／轉車')}
                            </span>
                            <span>
                              {j.transfers} {t('transfers', '次轉車')}
                            </span>
                            <span>
                              <Footprints size={14} />
                              {distance(j.walkDistance)}
                            </span>
                            <span>
                              {j.legs.some((l) => l.realtime)
                                ? t('Includes live predictions', '包含即時預測')
                                : t('Scheduled', '時間表')}
                            </span>
                          </div>
                        </button>
                        {index === selected && (
                          <div className="leg-list">
                            <button type="button" className="pill" onClick={() => { const assigned = j.legs.find(leg => leg.vehicle?.id && leg.agencyFeedId); openFollower({ journey: j, ...(assigned?.vehicle ? { vehicle: { ...assigned.vehicle, agencyId: assigned.agencyFeedId } } : {}) }); }}>{t('Follow this trip', '跟隨此行程')}</button>
                            {!!j.washrooms?.length && (
                              <div className="washroom-result">
                                <strong>
                                  {t(
                                    'Transit-facility washrooms',
                                    '交通設施洗手間',
                                  )}
                                </strong>
                                {j.washroomPreferenceApplied && (
                                  <p>
                                    {t(
                                      'Preferred for confirmed washroom connections.',
                                      '因已確認洗手間接駁而優先顯示。',
                                    )}
                                  </p>
                                )}
                                <ul>
                                  {j.washrooms.map((w, i) => (
                                    <li key={i}>
                                      <a
                                        href={safeUrl(w.source)}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {w.name}
                                      </a>
                                      <small>
                                        {w.openingHours ||
                                          t(
                                            'Opening hours and current availability unconfirmed',
                                            '開放時間及目前可用狀況未能確認',
                                          )}
                                      </small>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
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
                                  {leg.mode !== 'WALK' &&
                                    journeyWaits(
                                      j,
                                      plannedDeparture,
                                    ).waits.find((wait) => wait.legIndex === i)
                                      ?.seconds !== null &&
                                    journeyWaits(
                                      j,
                                      plannedDeparture,
                                    ).waits.find((wait) => wait.legIndex === i)
                                      ?.seconds !== undefined && (
                                      <p className="boarding-wait">
                                        <Clock size={14} />{' '}
                                        {mins(
                                          journeyWaits(
                                            j,
                                            plannedDeparture,
                                          ).waits.find(
                                            (wait) => wait.legIndex === i,
                                          )!.seconds!,
                                        )}{' '}
                                        min{' '}
                                        {journeyWaits(
                                          j,
                                          plannedDeparture,
                                        ).waits.find(
                                          (wait) => wait.legIndex === i,
                                        )!.transfer
                                          ? t(
                                              'transfer wait before boarding',
                                              '轉車上車前等候',
                                            )
                                          : t(
                                              'wait before first boarding',
                                              '首次上車前等候',
                                            )}
                                      </p>
                                    )}
                                  <div className="leg-metrics">
                                    <strong>{mins(leg.duration)} min</strong>
                                    <span>{kilometres(leg.distance)}</span>
                                  </div>
                                  {leg.realtime && (
                                    <p className="schedule-badge">
                                      {t('Live prediction', '即時預測')}
                                      {leg.scheduledStartTime
                                        ? ' · ' +
                                          t('scheduled', '原定') +
                                          ' ' +
                                          time(leg.scheduledStartTime)
                                        : ''}
                                    </p>
                                  )}
                                  {leg.mode !== 'WALK' &&
                                    <WashroomBadge washroom={leg.from.washroom} t={t} />}
                                  {leg.vehicleDivision?.state === 'out-of-division' && isCurrentDivisionEvidence(leg.vehicleDivision, { now: divisionNow }) && <p className="journey-division-evidence"><strong>{t('Verified out of division', '已核實跨車廠')}</strong><span>{leg.vehicleDivision.homeGarageName} → {leg.vehicleDivision.assignedGarageNames?.join(', ')}</span><small>{t('Allocation valid through', '配車資料有效至')} {leg.vehicleDivision.source?.validThrough}</small></p>}
                                  {(() => { const observed = currentRouteOpportunity(leg.routeDivisionOpportunity, { now: divisionNow }); return observed ? <div className="journey-division-evidence"><strong>{t('Out-of-division vehicles observed on this route', '此路線有跨車廠車輛觀察')}</strong><span>{observed.fleetNumbers.join(', ')}</span><small>{t('Current route observations do not identify your departure vehicle.', '目前路線觀察未能確認你班次嘅車輛。')}{observed.truncated ? ' ' + t('The identity list is limited to 20 vehicles.', '編號清單最多列出 20 架車輛。') : ''}</small></div> : null; })()}
                                  {leg.mode !== 'WALK' &&
                                    (leg.vehicle ? (
                                      <div className="assigned-vehicle">
                                        <strong>
                                          {t(
                                            'Currently assigned vehicle',
                                            '目前編配車輛',
                                          )}{' '}
                                          {leg.vehicle.fleetNumber ||
                                            leg.vehicle.label ||
                                            leg.vehicle.id}
                                        </strong>
                                        <p>
                                          {[
                                            leg.vehicle.cptdb?.manufacturer,
                                            leg.vehicle.cptdb?.model,
                                            leg.vehicle.cptdb?.year,
                                          ]
                                            .filter(Boolean)
                                            .join(' · ') ||
                                            t(
                                              'Fleet details not verified',
                                              '車隊資料未核實',
                                            )}
                                        </p>
                                        <small>
                                          {t(
                                            'Live assignments can change before boarding.',
                                            '上車前車輛編配可能改變。',
                                          )}
                                        </small>
                                        {safeUrl(leg.vehicle.cptdb?.url) && (
                                          <a
                                            href={safeUrl(
                                              leg.vehicle.cptdb?.url,
                                            )}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            {t('Fleet source', '車隊資料來源')}
                                          </a>
                                        )}
                                        {leg.vehicle.photo &&
                                          safeUrl(leg.vehicle.photo.url) && (
                                            <figure>
                                              <img
                                                loading="lazy"
                                                src={
                                                  '/api/vehicle-photo?source=' +
                                                  encodeURIComponent(
                                                    leg.vehicle.photo.url,
                                                  )
                                                }
                                                alt={
                                                  leg.vehicle.photo.exactVehicle
                                                    ? t(
                                                        'Assigned vehicle photo',
                                                        '已編配車輛照片',
                                                      )
                                                    : t(
                                                        'Representative fleet photo',
                                                        '代表車隊照片',
                                                      )
                                                }
                                              />
                                              <VehiclePhotoCaption
                                                photo={leg.vehicle.photo}
                                                t={t}
                                              />
                                            </figure>
                                          )}
                                      </div>
                                    ) : (
                                      <p className="data-note">
                                        {t(
                                          'A vehicle has not been verified for this exact trip.',
                                          '未能核實呢個指定班次嘅車輛。',
                                        )}
                                        {leg.vehicleAssignment?.state === 'no-match' && <small>{t('Live positions did not report a vehicle with this trip ID. A vehicle on the same route may be running a different departure.', '即時位置未有呢個班次編號嘅配車，同路線車輛可能正行駛另一班次。')}</small>}
                                        {['stale', 'unavailable', 'error'].includes(leg.vehicleAssignment?.state || '') && <small>{t('A fresh assignment is unavailable for this departure. Check the live tracker for current observations.', '呢個出發班次暫未有最新配車資料，可到即時追蹤查看目前觀察。')}</small>}
                                        <button type="button" className="text-button" onClick={() => setTab('vehicles')}>{t('Open live vehicle tracker', '開啟即時車輛追蹤')}</button>
                                      </p>
                                    ))}
                                  {leg.mode !== 'WALK' && (
                                    <>
                                      <p className="alight">
                                        {t('Get off at', '落車站')}{' '}
                                        <b>{leg.to.name}</b>
                                      </p>
                                      <WashroomBadge washroom={leg.to.washroom} t={t} />
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
                                                <li key={k}>{s.name}<WashroomBadge washroom={s.washroom ? { ...s.washroom, availability: 'unknown' } : null} t={t} /></li>
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
                      onClick={() => shiftJourney(-30)}
                    >
                      <ArrowLeft size={15} />
                      {t('30 min earlier', '早 30 分鐘')}
                    </button>
                    <button
                      className="pill"
                      onClick={() => shiftJourney(30)}
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
              <p className="data-note">{t('Alerts affecting multiple modes appear in each relevant group; the overall count is deduplicated.', '涉及多種交通服務嘅提示會喺相關組別出現，總數唔會重複計算。')}</p>
              {([
                ['bus', t('Bus routes', '巴士路線')],
                ['streetcar', t('Streetcar routes', '電車路線')],
                ['rapidTransit', t('Subway & light rail', '地鐵及輕鐵')],
                ['networkWide', t('Network-wide notices', '全網絡通告')],
                ['unknown', t('Route not identified', '未能識別路線')],
              ] as const).map(([key, title]) => <details className="alert-group" key={key}>
                <summary><strong>{title}</strong><span className="count">{disruptionGroups[key].length}</span></summary>
                {disruptionGroups[key].length === 0 && <p className="data-note">{t('No notices in this group in the received snapshot.', '已收到嘅資料快照未有呢組通告。')}</p>}
                {disruptionGroups[key].map(a => <article className="alert-card" key={a.id}>
                  <TriangleAlert size={18} />
                  <div><h4>{a.title}</h4><p>{a.description}</p>
                    {a.routeIds?.length ? <small>{t('Routes', '路線')}: {a.routeIds.join(', ')}</small> : null}
                    {safeUrl(a.url) && <a href={safeUrl(a.url)} target="_blank" rel="noreferrer">{t('Read official update', '閱讀官方更新')}</a>}
                  </div>
                </article>)}
              </details>)}
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
                        setPicking(null);
                        setRequiredRoute(validRequiredRoute(s.requiredRoute) ? s.requiredRoute : null);
                        setPreferDivision(s.preferDivision === true);
                        setDivisionMode(s.divisionMode === 'route' ? 'route' : 'exact');
                        setDestinations([...(s.via || []), s.to].map((place, index) => ({ id: `saved-destination-${index}`, place })));
                        setPlanned(false);
                        setJourneys([]);
                        setTab('plan');
                      }}
                    >
                      <MapPin size={20} />
                      <span>
                        <strong>{s.from.name}</strong>
                        {s.via?.length ? <small>{t('Via', '經')}: {s.via.map(place => place.name).join(' → ')}</small> : null}
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
                          ? a.availableToday === false
                            ? t(
                                'No trips in today’s loaded schedule',
                                '已載入時間表今日無班次',
                              )
                            : t('Schedules loaded', '已載入時間表')
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
          {tab === 'settings' && <SettingsWorkspace lang={lang} setLang={setLang} dark={dark} setDark={setDark} funEn={funEn} setFunEn={setFunEn} funZh={funZh} setFunZh={setFunZh} narrator={narrator} t={t} />}
        </section>
        {tab === 'plan' && <aside className="status-rail" aria-label={t('TTC service summary', 'TTC 服務摘要')}>
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
        </aside>}
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
