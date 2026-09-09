'use client';
import { useEffect, useState } from 'react';
import type { FeedLiveCoverage } from '../lib/live-status';
type Agency = {
  id: string;
  name: string;
  state: string;
  capabilities: Record<string, string>;
  lastSuccessfulFetch?: string;
  feeds?: Record<string, unknown>;
};
export default function RealtimeCoverage({
  t,
  liveCoverage,
}: {
  t: (en: string, zh: string) => string;
  liveCoverage?: FeedLiveCoverage | null;
}) {
  const [data, setData] = useState<Agency[] | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    const run = () => {
      fetch('/api/realtime', { signal: c.signal })
        .then(async (r) => {
          if (!r.ok) throw Error();
          return r.json() as Promise<{ agencies: Agency[] }>;
        })
        .then((d) => {
          setData(d.agencies);
          setFailed(false);
        })
        .catch(() => {
          if (!c.signal.aborted) setFailed(true);
        });
    };
    run();
    const timer = setInterval(run, 60000);
    return () => {
      clearInterval(timer);
      c.abort();
    };
  }, []);
  return (
    <section className="help-block">
      <h3>{t('Live GTFS coverage', '即時 GTFS 覆蓋')}</h3>
      {liveCoverage?.ttcMatcher && <section className="source-details" aria-label={t('TTC matching observations', 'TTC 配對觀察')}>
        <h4>{t('TTC matching observations', 'TTC 配對觀察')}</h4>
        <p>{liveCoverage.ttcMatcher.state === 'shadow' ? t('Observing candidate matches. These estimates are not applied to routed journey times.', '正在觀察候選配對；呢啲估算未套用到規劃行程時間。') : liveCoverage.ttcMatcher.state === 'stale' ? t('The last matching observations are stale. They are not applied to routed times.', '上次配對觀察已過時，唔會套用到路線時間。') : t('Matching observations are currently unavailable.', '目前未能提供配對觀察。')}</p>
        <dl><div><dt>{t('Observed updates', '已觀察更新')}</dt><dd>{liveCoverage.ttcMatcher.rolling24h.total}</dd></div><div><dt>{t('Unique candidates', '唯一候選配對')}</dt><dd>{liveCoverage.ttcMatcher.rolling24h.unique}{liveCoverage.ttcMatcher.rolling24h.total > 0 ? ` (${(100 * liveCoverage.ttcMatcher.rolling24h.unique / liveCoverage.ttcMatcher.rolling24h.total).toFixed(1)}%)` : ''}</dd></div><div><dt>{t('Unverified updates', '未核實更新')}</dt><dd>{liveCoverage.ttcMatcher.rolling24h.unverified}</dd></div><div><dt>{t('Completed observation polls', '已完成觀察輪次')}</dt><dd>{liveCoverage.ttcMatcher.rolling24h.polls}</dd></div></dl>
        <p>{t('This window covers observations since the matcher restarted, up to 24 hours. It does not by itself establish matching accuracy or authorize live routing updates.', '此視窗涵蓋配對服務重新啟動後最多 24 小時嘅觀察，單憑呢啲數字唔代表配對準確，亦唔代表可啟用即時路線更新。')}</p>
        {liveCoverage.ttcMatcher.lastPollAt && <small>{t('Last observation', '最後觀察')}: {new Date(liveCoverage.ttcMatcher.lastPollAt).toLocaleString('en-CA', {timeZone:'America/Toronto',timeZoneName:'short'})}</small>}
      </section>}
      <p>
        {t(
          'Live vehicle, trip-update and alert feeds are monitored independently. Feed availability is not proof that every vehicle or journey is live.',
          '車輛位置、班次更新同提示會分開監察。有即時資料唔代表每架車或每個行程都有即時更新。',
        )}
      </p>
      {failed && (
        <p role="status">
          {t(
            'Live-feed monitoring is currently unavailable.',
            '暫時無法取得即時資料監察。',
          )}
        </p>
      )}
      {!data && !failed && (
        <p>{t('Checking official feeds…', '檢查官方資料中…')}</p>
      )}
      {data?.map((a) => (
        <article className="realtime-row" key={a.id}>
          <strong>{a.name}</strong>
          <span>
            {a.state === 'live'
              ? t('Live feeds connected', '已連接即時資料')
              : a.state === 'partial'
                ? t('Partial live coverage', '部分即時覆蓋')
                : a.state === 'stale'
                  ? t('Stale live data', '即時資料過時')
                  : t(
                      'Scheduled only / live access unavailable',
                      '只提供時間表／未能存取即時資料',
                    )}
          </span>
          <small>
            {t('Trip updates in journeys', '行程內班次更新')}: {liveCoverage?.feeds[a.id]?.state === 'applied' ? t('Configured in the routing engine; individual trips still require a live match.', '已於路線引擎設定；每個班次仍須成功即時配對。') : liveCoverage?.feeds[a.id]?.state === 'shadow' ? t('Matching under observation; not applied.', '配對觀察中；未套用。') : liveCoverage?.feeds[a.id]?.state === 'published-unjoinable' ? t('Published updates cannot be matched reliably to the timetable.', '已公布更新未能可靠配對時間表。') : t('Timetable only, or coverage unavailable.', '只有時間表，或未能取得覆蓋資料。')}
          </small>
          <small>
            {Object.entries(a.capabilities)
              .map(
                ([k, v]) =>
                  `${k === 'vehiclePositions' ? t('Vehicles', '車輛') : k === 'tripUpdates' ? t('Trip updates', '班次更新') : t('Alerts', '提示')}: ${v === 'configured' ? t('connected integration', '已接駁服務') : v === 'public' ? t('public feed', '公開來源') : v === 'access_required' ? t('registration required', '需要註冊') : t('unavailable', '未能提供')}`,
              )
              .join(' · ')}
          </small>
          {a.lastSuccessfulFetch && (
            <small>
              {t('Last successful refresh', '上次成功更新')}:{' '}
              {new Date(a.lastSuccessfulFetch).toLocaleString('en-CA', {
                timeZone: 'America/Toronto',
                timeZoneName: 'short',
              })}
            </small>
          )}
        </article>
      ))}
    </section>
  );
}
