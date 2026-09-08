'use client';

import { useEffect, useMemo, useState } from 'react';
import { Icon } from './icon';
import type { RaceCheckin } from '../lib/race-client';

/**
 * The whole rapid transit network as a checklist, for a speed run that has to
 * visit every station.
 *
 * The list is fetched, never written down here. A hand-typed station list is
 * wrong the day a line opens or a station is renamed, and this one decides
 * whether somebody's run is finished, so it comes from the same published index
 * the planner uses.
 *
 * **A tick means a check-in was recorded, not that anybody was there.** Nothing
 * in this project verifies that a photo shows the station it names, and the copy
 * says so wherever the progress is shown. Calling it verification would be the
 * one claim the data cannot support.
 */

type Station = { name: string; sequence: number; lat: number | null; lon: number | null };
type Line = { routeId: string; stations: Station[]; expected: number | null; matchesPublished: boolean | null; reason?: string };
type Network = {
  lines: Line[];
  totalStations: number;
  interchanges: string[];
  matchesPublished: boolean;
  mismatchedRoutes: string[];
  derivation?: string;
};

/** How the operator names its lines. The feed gives an id; a rider reads a name. */
const LINE_NAMES: Record<string, [string, string]> = {
  'ttc:1': ['Line 1 Yonge-University', '1 號線 央街-大學'],
  'ttc:2': ['Line 2 Bloor-Danforth', '2 號線 布羅-丹福'],
  'ttc:4': ['Line 4 Sheppard', '4 號線 錫柏'],
  'ttc:5': ['Line 5 Eglinton', '5 號線 艾靈頓'],
  'ttc:6': ['Line 6 Finch West', '6 號線 芬治西'],
};

export default function SpeedRunStations({
  checkins,
  teamId,
  onChoose,
  t,
}: {
  checkins: RaceCheckin[];
  teamId: string | null;
  onChoose: (stationName: string) => void;
  t: (en: string, zh: string) => string;
}) {
  const [network, setNetwork] = useState<Network | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [openLine, setOpenLine] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/rapid-transit-stations')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body) => {
        if (cancelled) return;
        const payload = body as Network | null;
        if (!payload?.lines?.length) { setState('unavailable'); return; }
        setNetwork(payload);
        setState('ready');
        setOpenLine(payload.lines[0]?.routeId ?? null);
      })
      .catch(() => { if (!cancelled) setState('unavailable'); });
    return () => { cancelled = true; };
  }, []);

  /* A station counts as reached when this team recorded a check-in naming it.
     Matched on the exact published name, because a run that ticks a station on a
     near miss is a run that can be finished without going there. */
  const reached = useMemo(() => {
    const names = new Set<string>();
    for (const entry of checkins) {
      if (teamId && entry.teamId !== teamId) continue;
      if (entry.kind !== 'station') continue;
      names.add(entry.target.trim());
    }
    return names;
  }, [checkins, teamId]);

  const visited = useMemo(() => {
    if (!network) return 0;
    const all = new Set<string>();
    for (const line of network.lines) for (const station of line.stations) all.add(station.name);
    let count = 0;
    for (const name of all) if (reached.has(name)) count += 1;
    return count;
  }, [network, reached]);

  if (state === 'loading') {
    return <p className="data-note">{t('Reading the station list…', '讀取車站清單中…')}</p>;
  }
  if (state === 'unavailable' || !network) {
    return (
      <p className="data-note">
        {t(
          'The station list could not be read, so a run cannot be measured against the whole network right now.',
          '而家讀唔到車站清單，所以未能對住全網計算進度。',
        )}
      </p>
    );
  }

  const total = network.totalStations;
  const percent = total ? Math.round((visited / total) * 100) : 0;

  return (
    <section className="speed-run" aria-label={t('Every station', '全部車站')}>
      <div className="speed-run__progress">
        <strong>
          {t(`${visited} of ${total} stations`, `${total} 個站入面去咗 ${visited} 個`)}
        </strong>
        {/* The bar repeats the numbers rather than replacing them, so progress is
            readable without seeing a colour or a length. */}
        {/* The native element, which already carries the value semantics an
            ARIA role only describes. Styled through ::-webkit-progress-value so
            the bar is ours while the announcement stays the platform's. */}
        <progress
          className="speed-run__bar"
          value={visited}
          max={total || 1}
          aria-label={t('Stations reached', '已到達車站')}
        >
          {percent}%
        </progress>
      </div>

      <p className="data-note">
        {t(
          'A tick means a check-in was recorded naming that station. Nothing here checks that a photo shows the station it names, so this is a record of what was claimed and when, not a verification.',
          '打咗剔即係有一次打卡寫住嗰個站。呢度冇任何嘢會檢查張相真係影到嗰個站，所以呢個係「幾時聲稱去過」嘅記錄，唔係核實。',
        )}
      </p>

      {!network.matchesPublished && (
        <output className="speed-run__warning">
          {t(
            `The derived list does not match the published station count for ${network.mismatchedRoutes.join(', ')}, so a full-network run cannot be scored against it until that is resolved.`,
            `推導出嘅清單同 ${network.mismatchedRoutes.join('、')} 嘅官方站數對唔上，未解決之前唔可以用嚟計全網進度。`,
          )}
        </output>
      )}

      <ul className="speed-run__lines">
        {network.lines.map((line) => {
          const [en, zh] = LINE_NAMES[line.routeId] ?? [line.routeId, line.routeId];
          const done = line.stations.filter((station) => reached.has(station.name)).length;
          const open = openLine === line.routeId;
          return (
            <li key={line.routeId}>
              <button
                type="button"
                className="speed-run__line"
                aria-expanded={open}
                onClick={() => setOpenLine(open ? null : line.routeId)}
              >
                <span className="speed-run__line-name">{t(en, zh)}</span>
                <span className="speed-run__line-count">{done}/{line.stations.length}</span>
                <Icon name={open ? 'expand_less' : 'expand_more'} size={18} />
              </button>
              {open && (
                <ol className="speed-run__stations">
                  {line.stations.map((station) => {
                    const been = reached.has(station.name);
                    return (
                      <li key={station.name} className={been ? 'is-reached' : undefined}>
                        <button type="button" onClick={() => onChoose(station.name)}>
                          <Icon name={been ? 'check_circle' : 'place'} size={16} />
                          <span>{station.name}</span>
                          {been && <span className="sr-only">{t('reached', '已到達')}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </li>
          );
        })}
      </ul>

      <p className="data-note">
        {t(
          `${network.interchanges.length} stations serve more than one line and count once: ${network.interchanges.join(', ')}.`,
          `有 ${network.interchanges.length} 個站接駁多過一條線，只計一次：${network.interchanges.join('、')}。`,
        )}
      </p>
    </section>
  );
}
