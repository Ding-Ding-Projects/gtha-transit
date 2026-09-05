'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, LocateFixed, MapPin, Navigation, RefreshCw, Trash2, X } from 'lucide-react';
import type { Itinerary, Place } from '../lib/types';

export type WashroomTranslate = (english: string, cantonese: string) => string;
export type WashroomPosition = { lat: number; lon: number; timestamp?: string | number };
export type WashroomFollowTarget = { name: string; etaSeconds: number; availability: 'confirmed-open' };
export type WashroomDetourPanelProps = {
  position?: WashroomPosition;
  destinations: Place[];
  t: WashroomTranslate;
  onClose: () => void;
  onFollow: (journey: Itinerary, target: WashroomFollowTarget) => void;
};

type DestinationStatus = 'remaining' | 'visited' | 'removed';
type DestinationReview = { rowKey: string; place: Place; status: DestinationStatus };
type Facility = { name?: string | null; source?: string | null; availability?: 'confirmed-open' | 'closed' | 'unknown' | null };
type FacilityLeg = { itinerary?: unknown; timeToFacilitySeconds?: number; expectedArrival?: string | null; visitMinutes?: number; visitDurationSeconds?: number; departAfterVisit?: string | null; internalWalkingUnknown?: boolean };
type Continuation = { itinerary?: unknown; durationSeconds?: number; departAfterVisit?: string | null; preservedTo?: Place; preservedVia?: Place[] };
type DetourResponse = {
  status?: string;
  scope?: string;
  completeJourney?: boolean;
  facility?: Facility | null;
  facilityLeg?: FacilityLeg | null;
  continuation?: Continuation | null;
  unresolved?: { code?: string } | null;
  note?: string;
  error?: string;
};

export const WASHROOM_CLIENT_DEADLINE_MS = 35_000;
export const WASHROOM_POSITION_MAX_AGE_MS = 60_000;
export const DEFAULT_WASHROOM_VISIT_MINUTES = 10;
export const MIN_WASHROOM_VISIT_MINUTES = 1;
export const MAX_WASHROOM_VISIT_MINUTES = 60;

const isFinitePosition = (position?: WashroomPosition | null): position is WashroomPosition =>
  Boolean(position && Number.isFinite(position.lat) && Number.isFinite(position.lon) && Math.abs(position.lat) <= 90 && Math.abs(position.lon) <= 180);

function positionTimestamp(value: WashroomPosition['timestamp']) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.abs(value) < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function isFreshWashroomPosition(position: WashroomPosition | null | undefined, now = Date.now()) {
  if (!isFinitePosition(position)) return false;
  const capturedAt = positionTimestamp(position.timestamp);
  return capturedAt !== null && capturedAt <= now && now - capturedAt <= WASHROOM_POSITION_MAX_AGE_MS;
}

const isItinerary = (value: unknown): value is Itinerary => Boolean(value && typeof value === 'object' && typeof (value as Itinerary).id === 'string' && Array.isArray((value as Itinerary).legs));

const safeUrl = (value?: string | null) => {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};

const destinationKey = (destinations: readonly Place[]) => destinations.map((place, index) => `${index}\u0000${place.id}\u0000${place.name}\u0000${place.lat}\u0000${place.lon}`).join('\u0001');

export function reviewDestinations(destinations: readonly Place[]): DestinationReview[] {
  return destinations.map((place, index) => ({ rowKey: `${index}\u0000${place.id}\u0000${place.name}\u0000${place.lat}\u0000${place.lon}`, place, status: 'remaining' }));
}

export function remainingDestinationPlaces(items: readonly DestinationReview[]) {
  return items.filter((item) => item.status === 'remaining').map((item) => item.place);
}

/** Builds the backend request without changing the caller's original destination list. */
export function washroomDetourRequest(position: WashroomPosition, remaining: readonly Place[], dateTime: string, visitMinutes = DEFAULT_WASHROOM_VISIT_MINUTES) {
  const currentPosition = { lat: position.lat, lon: position.lon };
  if (!remaining.length) return { currentPosition, dateTime, visitMinutes, facilityOnly: true };
  const points = remaining.map(({ id, name, lat, lon }) => ({ id, name, lat, lon }));
  return { currentPosition, dateTime, visitMinutes, to: points.at(-1), via: points.slice(0, -1) };
}

function displaySeconds(seconds: number | undefined, t: WashroomTranslate) {
  if (!Number.isFinite(seconds) || seconds === undefined || seconds < 0) return t('ETA unavailable', '未能提供預計時間');
  const rounded = Math.max(1, Math.ceil(seconds / 60));
  return t(`${rounded} minute${rounded === 1 ? '' : 's'}`, `${rounded} 分鐘`);
}

function destinationStateLabel(status: DestinationStatus, t: WashroomTranslate) {
  if (status === 'visited') return t('Marked visited for this detour', '已為今次繞道標示為已到訪');
  if (status === 'removed') return t('Removed from this detour', '已由今次繞道移除');
  return t('Included in continuation', '會包括喺後續行程');
}

function displayClock(value: number | string | undefined, t: WashroomTranslate) {
  const numeric = typeof value === 'number' ? (Math.abs(value) < 10_000_000_000 ? value * 1000 : value) : Date.parse(value ?? '');
  if (!Number.isFinite(numeric)) return t('Time unavailable', '未能提供時間');
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(numeric));
}

function JourneyDirections({ journey, heading, t }: { journey: Itinerary; heading: string; t: WashroomTranslate }) {
  return <section className="washroom-detour-panel__directions" aria-label={heading}>
    <ol>
      {journey.legs.map((leg, index) => <li key={`${index}-${leg.from.name}-${leg.to.name}`}>
        <strong>{leg.mode}{leg.route ? ` · ${leg.route}` : ''}</strong>
        <span>{leg.from.name} → {leg.to.name}</span>
        <time>{displayClock(leg.startTime, t)} – {displayClock(leg.endTime, t)}</time>
      </li>)}
    </ol>
  </section>;
}

/** Parent integration owns route-following and original itinerary state. */
export function WashroomDetourPanel({ position, destinations, t, onClose, onFollow }: WashroomDetourPanelProps) {
  const key = destinationKey(destinations);
  const [currentPosition, setCurrentPosition] = useState<WashroomPosition | null>(() => isFinitePosition(position) ? position : null);
  const [review, setReview] = useState<DestinationReview[]>(() => reviewDestinations(destinations));
  const [busy, setBusy] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [visitDraft, setVisitDraft] = useState(String(DEFAULT_WASHROOM_VISIT_MINUTES));
  const [clock, setClock] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DetourResponse | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);
  const geolocationGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  const invalidateRequest = () => {
    requestGenerationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(false);
    setResult(null);
  };

  useEffect(() => {
    geolocationGenerationRef.current += 1;
    invalidateRequest();
    setCurrentPosition(isFinitePosition(position) ? position : null);
  }, [position?.lat, position?.lon, position?.timestamp]);

  useEffect(() => {
    invalidateRequest();
    setReview(reviewDestinations(destinations));
  }, [key]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    mountedRef.current = false;
    requestGenerationRef.current += 1;
    geolocationGenerationRef.current += 1;
    controllerRef.current?.abort();
  }, []);

  const remaining = useMemo(() => remainingDestinationPlaces(review), [review]);
  const freshPosition = isFreshWashroomPosition(currentPosition, clock);
  const visitMinutes = /^\d+$/.test(visitDraft) ? Number(visitDraft) : NaN;
  const validVisit = Number.isInteger(visitMinutes) && visitMinutes >= MIN_WASHROOM_VISIT_MINUTES && visitMinutes <= MAX_WASHROOM_VISIT_MINUTES;
  const facilityLeg = result?.facilityLeg ?? null;
  const facilityJourney = isItinerary(facilityLeg?.itinerary) ? facilityLeg.itinerary : null;
  const continuationJourney = isItinerary(result?.continuation?.itinerary) ? result?.continuation?.itinerary : null;
  const facilityName = result?.facility?.name ?? t('washroom facility', '洗手間設施');

  const updateDestination = (rowKey: string, status: DestinationStatus) => {
    if (busy) return;
    invalidateRequest();
    setReview((items) => items.map((item) => item.rowKey === rowKey ? { ...item, status } : item));
  };

  const requestLocation = () => {
    if (busy || geoBusy) return;
    if (!navigator.geolocation) {
      setError(t('This browser cannot provide a current location.', '呢個瀏覽器未能提供目前位置。'));
      return;
    }
    const generation = geolocationGenerationRef.current + 1;
    geolocationGenerationRef.current = generation;
    setGeoBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (next) => {
        if (!mountedRef.current || geolocationGenerationRef.current !== generation) return;
        invalidateRequest();
        setCurrentPosition({ lat: next.coords.latitude, lon: next.coords.longitude, timestamp: new Date(next.timestamp).toISOString() });
        setGeoBusy(false);
      },
      () => {
        if (!mountedRef.current || geolocationGenerationRef.current !== generation) return;
        setError(t('Current location was not shared. You can try again when ready.', '未有分享目前位置。準備好時可以再試。'));
        setGeoBusy(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  };

  const plan = async () => {
    if (busy || controllerRef.current) return;
    if (!isFinitePosition(currentPosition) || !freshPosition) {
      setError(t('Refresh current location within the last 60 seconds before planning a washroom detour.', '請喺最近 60 秒內更新目前位置，先可以規劃洗手間繞道。'));
      return;
    }
    if (!validVisit) {
      setError(t(`Visit time must be a whole number from ${MIN_WASHROOM_VISIT_MINUTES} through ${MAX_WASHROOM_VISIT_MINUTES} minutes.`, `停留時間必須係 ${MIN_WASHROOM_VISIT_MINUTES} 至 ${MAX_WASHROOM_VISIT_MINUTES} 分鐘嘅整數。`));
      return;
    }
    const controller = new AbortController();
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    controllerRef.current = controller;
    const deadline = window.setTimeout(() => controller.abort(), WASHROOM_CLIENT_DEADLINE_MS);
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch('/api/plan-washroom-detour', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(washroomDetourRequest(currentPosition, remaining, new Date().toISOString(), visitMinutes)),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as DetourResponse | null;
      if (!response.ok || !payload) throw new Error(payload?.error ?? t('Washroom planning is temporarily unavailable.', '洗手間規劃暫時未能使用。'));
      if (mountedRef.current && requestGenerationRef.current === generation) setResult(payload);
    } catch (cause) {
      if (!mountedRef.current || requestGenerationRef.current !== generation) return;
      if (controller.signal.aborted) setError(t('Washroom planning did not finish within 35 seconds. No route was changed.', '洗手間規劃未能喺 35 秒內完成。沒有更改路線。'));
      else setError(cause instanceof Error ? cause.message : t('Washroom planning could not complete.', '洗手間規劃未能完成。'));
    } finally {
      window.clearTimeout(deadline);
      if (controllerRef.current === controller) controllerRef.current = null;
      if (mountedRef.current && requestGenerationRef.current === generation) setBusy(false);
    }
  };

  const followFacility = () => {
    if (!facilityJourney || result?.facility?.availability !== 'confirmed-open') return;
    onFollow(facilityJourney, { name: facilityName, etaSeconds: Math.max(0, Number(facilityLeg?.timeToFacilitySeconds ?? 0)), availability: 'confirmed-open' });
  };

  return <section className="washroom-detour-panel" aria-labelledby="washroom-detour-heading">
    <header className="washroom-detour-panel__header">
      <div>
        <h2 id="washroom-detour-heading">{t('I need a washroom', '我需要洗手間')}</h2>
        <p>{t('Review this detour before following it. Your original journey is not changed here.', '跟隨之前請檢查繞道。呢度唔會更改原本行程。')}</p>
      </div>
      <button type="button" className="washroom-detour-panel__close" onClick={onClose} aria-label={t('Close washroom detour', '關閉洗手間繞道')}><X size={18} aria-hidden="true" /></button>
    </header>

    <section className="washroom-detour-panel__position" aria-labelledby="washroom-position-heading">
      <h3 id="washroom-position-heading">{t('Current position', '目前位置')}</h3>
      {freshPosition ? <p><MapPin size={16} aria-hidden="true" /> {t('Current position is fresh enough for a route request.', '目前位置夠新，可以作路線請求。')}</p> : <p>{isFinitePosition(currentPosition) ? t('Current position is older than 60 seconds. Refresh it before planning.', '目前位置超過 60 秒。規劃之前請更新。') : t('A fresh current position is required. Location is requested only after you choose this action.', '需要新嘅目前位置。只有你選擇此操作後先會請求位置。')}</p>}
      <button type="button" onClick={requestLocation} disabled={busy || geoBusy}><LocateFixed size={16} aria-hidden="true" /> {geoBusy ? t('Getting current location…', '取得目前位置中…') : t('Refresh current location', '更新目前位置')}</button>
    </section>

    <section className="washroom-detour-panel__destinations" aria-labelledby="washroom-destinations-heading">
      <h3 id="washroom-destinations-heading">{t('Remaining destinations', '剩餘目的地')}</h3>
      <p>{t('These choices apply only to this new detour request.', '呢啲選擇只會用喺今次新繞道請求。')}</p>
      {review.length ? <ul>
        {review.map(({ rowKey, place, status }) => <li key={rowKey} className="washroom-detour-panel__destination">
          <div><strong>{place.name}</strong><span>{destinationStateLabel(status, t)}</span></div>
          <div className="washroom-detour-panel__destination-actions">
            {status === 'remaining' ? <>
              <button type="button" onClick={() => updateDestination(rowKey, 'visited')} disabled={busy}><Check size={15} aria-hidden="true" /> {t('Mark visited', '標示為已到訪')}</button>
              <button type="button" onClick={() => updateDestination(rowKey, 'removed')} disabled={busy}><Trash2 size={15} aria-hidden="true" /> {t('Remove for this detour', '由今次繞道移除')}</button>
            </> : <button type="button" onClick={() => updateDestination(rowKey, 'remaining')} disabled={busy}><RefreshCw size={15} aria-hidden="true" /> {t('Restore to continuation', '還原到後續行程')}</button>}
          </div>
        </li>)}
      </ul> : <p>{t('No onward destination is selected. This request will stop at the facility only.', '未有選擇下一個目的地。今次請求只會去到設施。')}</p>}
    </section>

    <section className="washroom-detour-panel__visit" aria-labelledby="washroom-visit-heading">
      <h3 id="washroom-visit-heading">{t('Planned visit time', '預計停留時間')}</h3>
      <label>{t('Minutes at the facility', '設施停留分鐘')} <input type="number" inputMode="numeric" min={MIN_WASHROOM_VISIT_MINUTES} max={MAX_WASHROOM_VISIT_MINUTES} value={visitDraft} disabled={busy} aria-invalid={!validVisit} aria-describedby="washroom-visit-help" onChange={(event) => { setVisitDraft(event.currentTarget.value); invalidateRequest(); }} /></label>
      <p id="washroom-visit-help">{t('This is planning time only, not a measured queue or indoor access time.', '呢個只係規劃時間，唔係量度過嘅排隊或室內通行時間。')}</p>
      {!validVisit && <p role="alert">{t(`Choose a whole number from ${MIN_WASHROOM_VISIT_MINUTES} through ${MAX_WASHROOM_VISIT_MINUTES}.`, `請選擇 ${MIN_WASHROOM_VISIT_MINUTES} 至 ${MAX_WASHROOM_VISIT_MINUTES} 嘅整數。`)}</p>}
    </section>

    <div className="washroom-detour-panel__actions">
      <button type="button" onClick={plan} disabled={busy || !freshPosition || !validVisit}><Navigation size={16} aria-hidden="true" /> {busy ? t('Planning washroom detour…', '規劃洗手間繞道中…') : remaining.length ? t('Plan facility and continuation', '規劃設施與後續行程') : t('Plan facility only', '只規劃去設施')}</button>
    </div>

    {error && <p className="washroom-detour-panel__message" role="alert">{error}</p>}
    {result && <section className="washroom-detour-panel__result" aria-live="polite" aria-labelledby="washroom-result-heading">
      <h3 id="washroom-result-heading">{t('Washroom route result', '洗手間路線結果')}</h3>
      <p className="washroom-detour-panel__status">{result.scope === 'facility-only' ? t('Facility-only route', '只去設施路線') : result.status === 'complete' ? t('Complete facility and continuation plan', '設施及後續行程已完成規劃') : result.status === 'partial' ? t('Partial plan: facility route only', '部分規劃：只有去設施路線') : t('No complete washroom route', '未有完整洗手間路線')}</p>
      {result.note && <p>{result.note}</p>}
      {result.facility && <section className="washroom-detour-panel__facility" aria-labelledby="washroom-facility-heading">
        <h4 id="washroom-facility-heading">{facilityName}</h4>
        <p>{t('Availability', '開放狀況')}: {result.facility.availability === 'confirmed-open' ? t('Open at expected arrival according to published hours', '按已公布時間，預計到達時開放') : t('Not confirmed', '未能確認')}</p>
        {safeUrl(result.facility.source) && <a href={safeUrl(result.facility.source) ?? undefined} target="_blank" rel="noreferrer">{t('Official facility source', '官方設施來源')}</a>}
      </section>}
      <section className="washroom-detour-panel__leg" aria-labelledby="washroom-facility-leg-heading">
        <h4 id="washroom-facility-leg-heading">{t('Facility leg', '去設施路段')}</h4>
        {facilityJourney ? <><p>{t('ETA', '預計時間')}: {displaySeconds(facilityLeg?.timeToFacilitySeconds, t)}</p>{facilityLeg?.departAfterVisit && <p>{t('Planned departure after visit', '預計停留後出發')}: {displayClock(facilityLeg.departAfterVisit, t)}</p>}<p>{facilityLeg?.internalWalkingUnknown ? t('Indoor walking is not available in this route result.', '呢個路線結果未有室內步行資料。') : null}</p><JourneyDirections journey={facilityJourney} heading={t('Facility leg directions', '去設施路段指示')} t={t} /><button type="button" onClick={followFacility} disabled={result.facility?.availability !== 'confirmed-open'}>{t('Follow facility', '跟隨去設施')}</button></> : <p>{t('A facility leg is not available.', '未有去設施路段。')}</p>}
      </section>
      <section className="washroom-detour-panel__continuation" aria-labelledby="washroom-continuation-heading">
        <h4 id="washroom-continuation-heading">{t('Remaining journey', '後續行程')}</h4>
        {result.scope === 'facility-only' ? <p>{t('No onward journey was requested.', '未有請求後續行程。')}</p> : continuationJourney ? <><p>{t('A remaining journey is available. Following the facility leg does not skip it.', '後續行程已可用。跟隨去設施路段唔會跳過後續行程。')}</p>{result.continuation?.departAfterVisit && <p>{t('Continuation starts after the planned visit', '後續行程會喺預計停留後開始')}: {displayClock(result.continuation.departAfterVisit, t)}</p>}<JourneyDirections journey={continuationJourney} heading={t('Remaining journey directions', '後續行程指示')} t={t} /></> : <p>{result.status === 'partial' ? t('The facility route is available, but the remaining journey is unresolved.', '去設施路線可用，但後續行程未能解析。') : t('No remaining journey is available.', '未有後續行程。')}</p>}
      </section>
    </section>}
  </section>;
}

export default WashroomDetourPanel;
