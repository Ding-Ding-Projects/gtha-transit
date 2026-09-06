'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Flag, LocateFixed, MapPin, Play, Plus, Route, Shuffle, Timer, TriangleAlert, Users } from 'lucide-react';
import {
  addTeam,
  assignRoutes,
  checkIn,
  createRace,
  elapsed,
  joinRace,
  metresBetween,
  photoUrl,
  reEncodeJpeg,
  setSharing,
  startRace,
  viewRace,
  type LeaderCredentials,
  type ParticipantCredentials,
  type RaceMode,
  type RaceView,
} from '../lib/race-client';
import type { Itinerary, Place } from '../lib/types';
import { drawRoutes, toRaceRoutes, type Draw, type RaceRoute } from '../lib/race-routes';
import { resolveTorontoTime, torontoLocalInput } from '../lib/journey-utils';

type Props = { t: (en: string, zh: string) => string };

const LEADER_KEY = 'gtha-race-leader';
const PERSON_KEY = 'gtha-race-participant';

function readStored<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch { /* A room simply is not remembered when storage is unavailable. */ }
}

export default function RaceWorkspace({ t }: Props) {
  const [leader, setLeader] = useState<LeaderCredentials | null>(null);
  const [person, setPerson] = useState<ParticipantCredentials | null>(null);
  const [room, setRoom] = useState<RaceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const [mode, setMode] = useState<RaceMode>('race');
  const [title, setTitle] = useState('');
  const [teamName, setTeamName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [personName, setPersonName] = useState('');
  const [joinTeam, setJoinTeam] = useState('');

  const [target, setTarget] = useState('');
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [chosen, setChosen] = useState<Place | null>(null);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<{ mime: 'image/jpeg'; bytes: string; byteLength: number } | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  // A race needs a start and a finish before it can have routes at all.
  const [endpointField, setEndpointField] = useState<'from' | 'to'>('from');
  const [endpointQuery, setEndpointQuery] = useState('');
  const [endpointSuggestions, setEndpointSuggestions] = useState<Place[]>([]);
  const [startPlace, setStartPlace] = useState<Place | null>(null);
  const [finishPlace, setFinishPlace] = useState<Place | null>(null);
  const [departAt, setDepartAt] = useState(() => torontoLocalInput());
  const [routes, setRoutes] = useState<RaceRoute[]>([]);
  const [routeNote, setRouteNote] = useState<string | null>(null);
  const [draw, setDraw] = useState<Draw | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const [sharing, setSharingState] = useState(false);
  const watch = useRef<number | null>(null);
  const [position, setPosition] = useState<{ lat: number; lon: number } | null>(null);

  const code = leader?.code || person?.code || null;

  useEffect(() => {
    setLeader(readStored<LeaderCredentials>(LEADER_KEY));
    setPerson(readStored<ParticipantCredentials>(PERSON_KEY));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = useCallback(async () => {
    if (!code) return;
    try {
      setRoom(await viewRace(code));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [code]);

  useEffect(() => {
    if (!code) return undefined;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [code, refresh]);

  // Suggestions come from the same published place search the planner uses.
  useEffect(() => {
    const query = target.trim();
    if (query.length < 2) { setSuggestions([]); return undefined; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/places?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        const payload = (await response.json()) as { places?: Place[] };
        setSuggestions((payload.places || []).slice(0, 8));
      } catch { /* An aborted or failed lookup simply leaves the list as it was. */ }
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [target]);

  // The same published place search, for the race's own start and finish.
  useEffect(() => {
    const query = endpointQuery.trim();
    if (query.length < 2) { setEndpointSuggestions([]); return undefined; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/places?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        const payload = (await response.json()) as { places?: Place[] };
        setEndpointSuggestions((payload.places || []).slice(0, 8));
      } catch { /* An aborted or failed lookup leaves the list as it was. */ }
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [endpointQuery]);

  // A wheel that spins is decoration. Somebody who has asked for less motion gets
  // the same draw, written out, with no spin at all.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReducedMotion(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await action(); } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  const planPoint = (place: Place): Place => ({ id: place.id, name: place.name, lat: place.lat, lon: place.lon, ...(place.kind ? { kind: place.kind } : {}), ...(place.agency ? { agency: place.agency } : {}) });

  /**
   * Ask the routing engine for the real journeys between the two endpoints.
   *
   * Every route a team can be given is one of these. Nothing is composed here to
   * make the draw come out even: if the engine returns two journeys for four
   * teams, four teams share two journeys and the interface says so.
   */
  const findRoutes = () => run(async () => {
    if (!startPlace || !finishPlace) throw new Error('Choose a start and a finish first.');
    setDraw(null);
    const response = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: planPoint(startPlace),
        to: planPoint(finishPlace),
        via: [],
        dateTime: resolveTorontoTime(departAt),
        arriveBy: false,
        preference: 'fastest',
        wheelchair: false,
        maxWalkDistance: 2000,
      }),
    });
    const payload = (await response.json()) as { itineraries?: Itinerary[]; error?: string; message?: string };
    if (!response.ok) throw new Error(payload.message || payload.error || 'Journey planning is temporarily unavailable.');
    const found = toRaceRoutes(payload.itineraries || []);
    setRoutes(found);
    setRouteNote(found.length
      ? null
      : 'The routing engine returned no journey between these two places at that time.');
  });

  /** Draw a route for each team, then record the assignment in the room. */
  const spinWheel = () => run(async () => {
    if (!leader) throw new Error('Only the leader can draw routes.');
    const teams = room?.teams.map((team) => team.teamId) || [];
    if (!teams.length) throw new Error('Add at least one team first.');
    if (!routes.length) throw new Error('Find some routes first.');
    const result = drawRoutes(teams, routes);
    if (!reducedMotion) {
      setSpinning(true);
      await new Promise((resolve) => window.setTimeout(resolve, 1400));
      setSpinning(false);
    }
    setDraw(result);
    await assignRoutes(leader, result.assignments.map((entry) => ({
      teamId: entry.teamId,
      route: { summary: entry.route.summary, minutes: entry.route.minutes, transfers: entry.route.transfers },
      routeSignature: entry.route.signature,
    })));
    await refresh();
  });

  const leave = () => {
    if (watch.current !== null && typeof navigator !== 'undefined') {
      navigator.geolocation?.clearWatch(watch.current);
      watch.current = null;
    }
    setSharingState(false);
    setPosition(null);
    setLeader(null);
    setPerson(null);
    setRoom(null);
    writeStored(LEADER_KEY, null);
    writeStored(PERSON_KEY, null);
  };

  const stopSharing = useCallback(async () => {
    if (watch.current !== null && typeof navigator !== 'undefined') {
      navigator.geolocation?.clearWatch(watch.current);
      watch.current = null;
    }
    setSharingState(false);
    setPosition(null);
    if (person) await setSharing(person, { sharing: false });
    void refresh();
  }, [person, refresh]);

  useEffect(() => () => {
    if (watch.current !== null && typeof navigator !== 'undefined') navigator.geolocation?.clearWatch(watch.current);
  }, []);

  const startSharing = () => run(async () => {
    if (!person) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      throw new Error('This browser does not offer a location.');
    }
    watch.current = navigator.geolocation.watchPosition(
      (reading) => {
        const lat = reading.coords.latitude;
        const lon = reading.coords.longitude;
        setPosition({ lat, lon });
        void setSharing(person, { sharing: true, lat, lon }).catch(() => undefined);
      },
      () => { void stopSharing(); setError(t('Location sharing stopped because the browser refused a position.', '因為瀏覽器拒絕提供位置，位置分享已停止。')); },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
    setSharingState(true);
  });

  const attachPhoto = (file: File | null) => run(async () => {
    if (!file) { setPendingPhoto(null); setPhotoNote(null); return; }
    const encoded = await reEncodeJpeg(file);
    setPendingPhoto(encoded);
    setPhotoNote(t(
      `Re-encoded to ${Math.round(encoded.byteLength / 1024)} KB. Camera metadata, including any location tag, is not carried over.`,
      `已重新編碼為 ${Math.round(encoded.byteLength / 1024)} KB。相機中繼資料，包括任何位置標記，都唔會帶埋過去。`,
    ));
  });

  const myTeam = useMemo(
    () => room?.teams.find((team) => team.teamId === person?.teamId) || null,
    [room, person],
  );

  const board = useMemo(() => {
    if (!room) return [];
    return room.teams.map((team) => {
      const entries = room.checkins.filter((entry) => entry.teamId === team.teamId);
      const places = new Set(entries.map((entry) => entry.target.toLowerCase()));
      return { team, entries, distinct: places.size, last: entries.length ? entries[entries.length - 1] : null };
    }).sort((left, right) => right.distinct - left.distinct);
  }, [room]);

  if (!code) {
    return (
      <div className="race-workspace">
        <section className="race-card">
          <h3><Flag size={18} aria-hidden="true" />{t('Start a race', '開一場比賽')}</h3>
          <p className="data-note">{t('You become the leader. Everyone else joins with the code this gives you.', '你會成為主辦，其他人用呢度畀你嘅代碼加入。')}</p>
          <fieldset className="race-modes">
            <legend>{t('Challenge', '挑戰類型')}</legend>
            {(['race', 'speedrun'] as RaceMode[]).map((value) => (
              <label key={value}>
                <input type="radio" name="race-mode" checked={mode === value} onChange={() => setMode(value)} />
                <span>{value === 'race' ? t('Race to a finish', '鬥快去終點') : t('Subway speed run with photo proof', '地鐵極速挑戰，影相為證')}</span>
              </label>
            ))}
          </fieldset>
          <label htmlFor="race-title">{t('Name this race', '幫呢場比賽改個名')}</label>
          <input id="race-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={40}
            placeholder={mode === 'race' ? t('Friday dash', '星期五衝刺') : t('Line 1 end to end', '1 號線由頭到尾')} />
          <button type="button" className="primary" disabled={busy || !title.trim()} onClick={() => run(async () => {
            const created = await createRace({ mode, title });
            const credentials = { code: created.code, leaderSecret: created.leaderSecret };
            setLeader(credentials);
            writeStored(LEADER_KEY, credentials);
          })}>
            <Plus size={17} aria-hidden="true" />{t('Create the race', '建立比賽')}
          </button>
        </section>

        <section className="race-card">
          <h3><Users size={18} aria-hidden="true" />{t('Join a race', '加入比賽')}</h3>
          <label htmlFor="race-code">{t('Race code', '比賽代碼')}</label>
          <input id="race-code" value={joinCode} maxLength={6} autoComplete="off"
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="ABC234" />
          <button type="button" disabled={busy || joinCode.trim().length !== 6} onClick={() => run(async () => {
            const found = await viewRace(joinCode.trim());
            setRoom(found);
            setJoinTeam(found.teams[0]?.teamId || '');
          })}>{t('Find this race', '搵呢場比賽')}</button>
          {room && (
            <>
              <p><b>{room.title}</b> · {room.teams.length} {t('teams', '隊')}</p>
              <label htmlFor="race-person">{t('Your name', '你嘅名')}</label>
              <input id="race-person" value={personName} maxLength={40} onChange={(event) => setPersonName(event.target.value)} />
              <label htmlFor="race-team">{t('Your team', '你嘅隊伍')}</label>
              <select id="race-team" value={joinTeam} onChange={(event) => setJoinTeam(event.target.value)}>
                {room.teams.map((team) => <option key={team.teamId} value={team.teamId}>{team.name}</option>)}
              </select>
              <button type="button" className="primary" disabled={busy || !personName.trim() || !joinTeam} onClick={() => run(async () => {
                const joined = await joinRace(room.code, { name: personName, teamId: joinTeam });
                const credentials = { ...joined, code: room.code };
                setPerson(credentials);
                writeStored(PERSON_KEY, credentials);
              })}>{t('Join', '加入')}</button>
            </>
          )}
        </section>
        {error && <p className="error" role="alert"><TriangleAlert size={18} aria-hidden="true" />{error}</p>}
      </div>
    );
  }

  return (
    <div className="race-workspace">
      <section className="race-card race-headline">
        <div>
          <span className="eyebrow">{room?.mode === 'speedrun' ? t('Subway speed run', '地鐵極速挑戰') : t('Race', '比賽')}</span>
          <h3>{room?.title || t('Loading the race', '載入緊比賽')}</h3>
          <p className="data-note">{t('Race code', '比賽代碼')}: <b className="race-code">{code}</b></p>
        </div>
        <div className="race-clock">
          <Timer size={17} aria-hidden="true" />
          <strong>{elapsed(room?.startedAt || null, now)}</strong>
          <small>{room?.startedAt ? t('since the start', '由開始計') : t('not started', '未開始')}</small>
        </div>
      </section>

      {leader && (
        <section className="race-card">
          <h3><Users size={18} aria-hidden="true" />{t('Teams', '隊伍')}</h3>
          <div className="race-team-add">
            <input value={teamName} maxLength={40} aria-label={t('Team name', '隊伍名稱')}
              placeholder={t('Team name', '隊伍名稱')} onChange={(event) => setTeamName(event.target.value)} />
            <button type="button" disabled={busy || !teamName.trim()} onClick={() => run(async () => {
              await addTeam(leader, teamName);
              setTeamName('');
              await refresh();
            })}><Plus size={16} aria-hidden="true" />{t('Add team', '加入隊伍')}</button>
          </div>
          {!room?.startedAt && (
            <button type="button" className="primary" disabled={busy || !room?.teams.length} onClick={() => run(async () => {
              await startRace(leader);
              await refresh();
            })}><Play size={17} aria-hidden="true" />{t('Start the race', '開始比賽')}</button>
          )}
          <p className="data-note">{t('Only you can add a team or start this race. Your leader key is held in this browser session and is never shown again.', '只有你可以加入隊伍或者開始比賽。主辦密鑰只留喺呢個瀏覽器工作階段，唔會再顯示。')}</p>
        </section>
      )}

      {leader && (
        <section className="race-card">
          <h3><MapPin size={18} aria-hidden="true" />{t('Start and finish', '起點同終點')}</h3>
          <p className="data-note">{t('Everyone races between the same two places. Routes come from the real timetable, so the draw can only hand out journeys that actually run.', '大家由同一個起點跑到同一個終點。路線由真實時間表計出，所以抽到嘅一定係真係有得搭嘅行程。')}</p>
          <div className="race-endpoints">
            <button type="button" className={endpointField === 'from' ? 'pill selected' : 'pill'} aria-pressed={endpointField === 'from'}
              onClick={() => { setEndpointField('from'); setEndpointQuery(''); }}>
              {t('Start', '起點')}: <b>{startPlace ? startPlace.name : t('not chosen', '未揀')}</b>
            </button>
            <button type="button" className={endpointField === 'to' ? 'pill selected' : 'pill'} aria-pressed={endpointField === 'to'}
              onClick={() => { setEndpointField('to'); setEndpointQuery(''); }}>
              {t('Finish', '終點')}: <b>{finishPlace ? finishPlace.name : t('not chosen', '未揀')}</b>
            </button>
          </div>
          <label htmlFor="race-endpoint">{endpointField === 'from' ? t('Search for the start', '搵起點') : t('Search for the finish', '搵終點')}</label>
          <input id="race-endpoint" value={endpointQuery} autoComplete="off"
            placeholder={t('Station, stop or address', '車站、巴士站或地址')}
            onChange={(event) => setEndpointQuery(event.target.value)} />
          {endpointSuggestions.length > 0 && (
            <ul className="race-suggestions">
              {endpointSuggestions.map((place) => (
                <li key={place.id}>
                  <button type="button" onClick={() => {
                    if (endpointField === 'from') { setStartPlace(place); setEndpointField('to'); }
                    else setFinishPlace(place);
                    setEndpointQuery('');
                    setEndpointSuggestions([]);
                    setRoutes([]);
                    setDraw(null);
                  }}>{place.name}{place.city ? <small> · {place.city}</small> : null}</button>
                </li>
              ))}
            </ul>
          )}
          <label htmlFor="race-depart">{t('Everyone leaves at', '大家幾點出發')}</label>
          <input id="race-depart" type="datetime-local" value={departAt} onChange={(event) => { setDepartAt(event.target.value); setRoutes([]); setDraw(null); }} />
          <button type="button" disabled={busy || !startPlace || !finishPlace} onClick={findRoutes}>
            <Route size={17} aria-hidden="true" />{t('Find the routes', '搵路線')}
          </button>
          {routeNote && <p className="data-note">{routeNote}</p>}
          {routes.length > 0 && (
            <>
              <p className="data-note">{t(`${routes.length} journeys found, ${new Set(routes.map((route) => route.signature)).size} of them genuinely different.`, `搵到 ${routes.length} 條行程，其中 ${new Set(routes.map((route) => route.signature)).size} 條係真係唔同。`)}</p>
              <ol className="race-route-list">
                {routes.map((route) => (
                  <li key={route.id}><b>{route.summary}</b> · {t(`${route.minutes} min`, `${route.minutes} 分鐘`)} · {t(`${route.transfers} transfers`, `轉乘 ${route.transfers} 次`)}</li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}

      {leader && routes.length > 0 && room && room.teams.length > 0 && (
        <section className="race-card">
          <h3><Shuffle size={18} aria-hidden="true" />{t('Draw the routes', '抽路線')}</h3>
          <p className="data-note">{t('Each team is drawn a different route while different ones remain. The result is written out below, so the wheel is never the only way to read it.', '有唔同路線嘅時候，每隊都會抽到唔同嘅一條。結果會列喺下面，唔使靠轉盤先睇到。')}</p>
          <div className={spinning ? 'race-wheel spinning' : 'race-wheel'} role="group"
            aria-label={t(`A wheel of ${routes.length} routes`, `一個有 ${routes.length} 條路線嘅轉盤`)}>
            {routes.slice(0, 8).map((route, index) => (
              <span key={route.id} className="race-wheel-slice" style={{ ['--slice' as string]: String(index) }}>{route.summary}</span>
            ))}
          </div>
          <button type="button" className="primary" disabled={busy || spinning} onClick={spinWheel}>
            <Shuffle size={17} aria-hidden="true" />{spinning ? t('Drawing…', '抽緊…') : t('Draw for every team', '幫每隊抽')}
          </button>
          <p aria-live="polite" className="race-draw-live">
            {spinning ? t('Drawing a route for every team.', '幫每隊抽緊路線。') : draw ? t('The draw is done.', '抽好喇。') : ''}
          </p>
          {draw && (
            <>
              <ol className="race-assignments">
                {draw.assignments.map((entry) => {
                  const team = room.teams.find((candidate) => candidate.teamId === entry.teamId);
                  return (
                    <li key={entry.teamId}>
                      <b>{team?.name || entry.teamId}</b>
                      <span>{entry.route.summary}</span>
                      <small>{t(`${entry.route.minutes} min · ${entry.route.transfers} transfers`, `${entry.route.minutes} 分鐘 · 轉乘 ${entry.route.transfers} 次`)}</small>
                    </li>
                  );
                })}
              </ol>
              {draw.shortfall > 0 && (
                <output className="data-note">
                  <TriangleAlert size={16} aria-hidden="true" />
                  {t(
                    `The timetable offered only ${draw.distinctRoutes} genuinely different journeys, so ${draw.shortfall} ${draw.shortfall === 1 ? 'team is' : 'teams are'} riding a route another team also has. That is a real shortage of routes, not a pairing chosen for you.`,
                    `時間表只有 ${draw.distinctRoutes} 條真係唔同嘅行程，所以有 ${draw.shortfall} 隊要同人哋行同一條。呢個係真係唔夠路線，唔係特登配對。`,
                  )}
                </output>
              )}
            </>
          )}
        </section>
      )}

      {!person && room && room.teams.length > 0 && (
        <section className="race-card">
          <h3><Users size={18} aria-hidden="true" />{t('Ride in this race', '參加呢場比賽')}</h3>
          <p className="data-note">{t('Running a race does not put you in it. Pick a team to check in and share a position.', '主辦唔等於有份跑。揀一隊先可以打卡同分享位置。')}</p>
          <label htmlFor="race-own-name">{t('Your name', '你嘅名')}</label>
          <input id="race-own-name" value={personName} maxLength={40} onChange={(event) => setPersonName(event.target.value)} />
          <label htmlFor="race-own-team">{t('Your team', '你嘅隊伍')}</label>
          <select id="race-own-team" value={joinTeam || room.teams[0].teamId} onChange={(event) => setJoinTeam(event.target.value)}>
            {room.teams.map((team) => <option key={team.teamId} value={team.teamId}>{team.name}</option>)}
          </select>
          <button type="button" className="primary" disabled={busy || !personName.trim()} onClick={() => run(async () => {
            const joined = await joinRace(room.code, { name: personName, teamId: joinTeam || room.teams[0].teamId });
            const credentials = { ...joined, code: room.code };
            setPerson(credentials);
            writeStored(PERSON_KEY, credentials);
            await refresh();
          })}>{t('Join a team', '加入隊伍')}</button>
        </section>
      )}

      {person && (
        <section className="race-card">
          <h3><Camera size={18} aria-hidden="true" />{t('Check in', '打卡')}</h3>
          <p className="data-note">
            {t('Riding for', '你代表')} <b>{myTeam?.name || t('your team', '你隊')}</b>
          </p>
          <label htmlFor="race-target">{room?.mode === 'speedrun' ? t('Which station are you at?', '你而家喺邊個站？') : t('Where are you?', '你而家喺邊？')}</label>
          <input id="race-target" value={target} autoComplete="off" onChange={(event) => { setTarget(event.target.value); setChosen(null); }} />
          {suggestions.length > 0 && !chosen && (
            <ul className="race-suggestions">
              {suggestions.map((place) => (
                <li key={place.id}>
                  <button type="button" onClick={() => { setChosen(place); setTarget(place.name); setSuggestions([]); }}>
                    <MapPin size={15} aria-hidden="true" />
                    <span>{place.name}{place.agency ? ` · ${place.agency}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="race-photo">
            <input ref={photoInput} type="file" accept="image/*" capture="environment" id="race-photo"
              onChange={(event) => attachPhoto(event.target.files?.[0] || null)} />
            <label htmlFor="race-photo">{t('Photo proof (optional)', '相片證明（可選）')}</label>
          </div>
          {photoNote && <p className="data-note">{photoNote}</p>}

          <button type="button" className="primary" disabled={busy || !target.trim()} onClick={() => run(async () => {
            const distance = chosen && position && typeof chosen.lat === 'number' && typeof chosen.lon === 'number'
              ? Math.round(metresBetween(position.lat, position.lon, chosen.lat, chosen.lon))
              : undefined;
            await checkIn(person, {
              kind: room?.mode === 'speedrun' ? 'station' : 'meetup',
              target: chosen?.name || target,
              ...(position ? { lat: position.lat, lon: position.lon } : {}),
              ...(distance === undefined ? {} : { distanceMetres: distance }),
              ...(pendingPhoto ? { photo: { mime: pendingPhoto.mime, bytes: pendingPhoto.bytes } } : {}),
            });
            setTarget(''); setChosen(null); setPendingPhoto(null); setPhotoNote(null);
            if (photoInput.current) photoInput.current.value = '';
            await refresh();
          })}>{t('Record this check-in', '記錄呢次打卡')}</button>
          <p className="data-note">
            {t('A check-in records that you said you were here, at this time, with the photo you chose. It is not a verification: nothing here checks that a photo shows the place it names.', '打卡只係記低你話自己幾時喺呢度，連埋你揀嘅相。呢個唔係核實：呢度冇任何嘢會檢查張相真係影到嗰個地方。')}
          </p>

          <div className="race-sharing">
            <h4>{t('Share your position', '分享你嘅位置')}</h4>
            <p className="data-note">
              {sharing
                ? position
                  ? t(`Sharing with this race only. Last position ${position.lat.toFixed(4)}, ${position.lon.toFixed(4)}.`, `只分享畀呢場比賽。最新位置 ${position.lat.toFixed(4)}, ${position.lon.toFixed(4)}。`)
                  : t('Sharing with this race only. Waiting for a position.', '只分享畀呢場比賽，等緊定位。')
                : t('Off. Nothing is shared until you turn this on, and stopping clears the position already stored.', '未開。你唔開就乜都唔會分享，停止分享亦會清走已儲存嘅位置。')}
            </p>
            {sharing
              ? <button type="button" onClick={() => run(stopSharing)}>{t('Stop sharing', '停止分享')}</button>
              : <button type="button" onClick={startSharing} disabled={busy}><LocateFixed size={16} aria-hidden="true" />{t('Start sharing', '開始分享')}</button>}
          </div>
        </section>
      )}

      <section className="race-card">
        <h3><Flag size={18} aria-hidden="true" />{t('Board', '戰況')}</h3>
        {board.length === 0 && <p className="data-note">{t('No teams yet.', '仲未有隊伍。')}</p>}
        <ol className="race-board">
          {board.map(({ team, entries, distinct, last }) => (
            <li key={team.teamId}>
              <div className="race-board-head">
                <strong>{team.name}</strong>
                <span>{distinct} {room?.mode === 'speedrun' ? t('stations', '個站') : t('check-ins', '次打卡')}</span>
              </div>
              {last && <p className="data-note">{t('Last', '最近')}: {last.target} · {new Date(last.recordedAt).toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit' })}</p>}
              {(() => {
                const drawn = team.route as { summary?: string; minutes?: number; transfers?: number } | null;
                return drawn && typeof drawn.summary === 'string' ? (
                  <p className="race-team-route">
                    <b>{t('Drawn route', '抽到嘅路線')}:</b>
                    <span>{drawn.summary}</span>
                    {typeof drawn.minutes === 'number' && <small>{t(`${drawn.minutes} min`, `${drawn.minutes} 分鐘`)}{typeof drawn.transfers === 'number' ? t(` · ${drawn.transfers} transfers`, ` · 轉乘 ${drawn.transfers} 次`) : ''}</small>}
                  </p>
                ) : null;
              })()}
              {team.route != null && !team.distinctRoute && (
                <p className="data-note">{t('This team shares a route with another team; routing did not offer enough distinct options.', '呢隊同另一隊路線相同，因為路線規劃提供唔到足夠唔同嘅選擇。')}</p>
              )}
              <ul className="race-checkins">
                {entries.slice(-6).map((entry, index) => (
                  <li key={`${entry.recordedAt}-${index}`}>
                    {entry.photoId && code && (
                      <img src={photoUrl(code, entry.photoId)} alt={t(`Photo submitted for ${entry.target}`, `為 ${entry.target} 提交嘅相片`)} loading="lazy" />
                    )}
                    <span>
                      <b>{entry.target}</b>
                      <small>
                        {new Date(entry.recordedAt).toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit' })}
                        {typeof entry.distanceMetres === 'number' && ` · ${entry.distanceMetres} m ${t('from the published stop', '距離公布嘅車站')}`}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      {error && <p className="error" role="alert"><TriangleAlert size={18} aria-hidden="true" />{error}</p>}
      <button type="button" className="text-button" onClick={leave}>{t('Leave this race on this device', '喺呢部裝置離開呢場比賽')}</button>
    </div>
  );
}
