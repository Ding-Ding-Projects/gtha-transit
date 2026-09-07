'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCcw, TrainFront, TriangleAlert } from 'lucide-react';
import { cancellationsFrom, type GoCancellation, type GoJourney } from '../lib/go-alternatives';
import { torontoIso } from '../lib/journey-utils';
import type { Itinerary } from '../lib/types';

/**
 * GO and UP cancellations, with the alternatives they name already planned.
 *
 * Metrolinx writes the replacement trains into the alert itself. Reading them is
 * one thing; being able to travel on one is another, so each named alternative is
 * looked up in the real timetable and shown as a journey with its own verified
 * state. The publisher's exact wording is kept beside it, because the alert is
 * the source and the plan is only our reading of it.
 */

type Alert = {
  id?: string;
  title?: string;
  description?: string;
  url?: string;
  activeFrom?: string;
  updatedAt?: string;
};

type AlertStatus = {
  state: string;
  agencyName?: string;
  sourceUrl?: string;
  fetchedAt?: string;
  alerts?: Alert[];
  reason?: string;
};

type PlanState =
  | { state: 'planning' }
  | { state: 'planned'; legs: string; minutes: number }
  | { state: 'unconfirmed'; reason: string };

type Props = { t: (english: string, cantonese: string) => string };

/** At most this many alternatives are planned, so one alert cannot spend the routing service. */
const MAX_PLANNED = 6;

const key = (cancellation: GoCancellation, journey: GoJourney) =>
  `${cancellation.alertId}|${journey.from}|${journey.departs}|${journey.to}`;

const millis = (value: number | string): number =>
  typeof value === 'number' ? (Math.abs(value) < 100_000_000_000 ? value * 1000 : value) : Date.parse(String(value));

export default function GoCancellations({ t }: Props) {
  const [status, setStatus] = useState<AlertStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [plans, setPlans] = useState<Record<string, PlanState>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/status/metrolinx?agency=go');
      setStatus((await response.json()) as AlertStatus);
    } catch {
      setStatus({ state: 'unavailable', reason: 'The alert feed could not be reached from this browser.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const cancellations = useMemo(
    () => cancellationsFrom(status?.alerts || [], torontoIso),
    [status],
  );

  // Every alternative the alert names is planned as soon as it is read. A rider
  // reading a cancellation wants the journey, not a button that fetches it.
  useEffect(() => {
    const wanted: { id: string; journey: GoJourney }[] = [];
    for (const cancellation of cancellations) {
      for (const journey of cancellation.alternatives) {
        if (!journey.departsAt) continue;
        const id = key(cancellation, journey);
        if (plans[id]) continue;
        wanted.push({ id, journey });
      }
    }
    if (!wanted.length) return undefined;
    const batch = wanted.slice(0, MAX_PLANNED);
    setPlans((current) => {
      const next = { ...current };
      for (const entry of batch) next[entry.id] = { state: 'planning' };
      return next;
    });
    let cancelled = false;
    void (async () => {
      for (const entry of batch) {
        let result: PlanState;
        try {
          const response = await fetch('/api/plan', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              from: { name: entry.journey.from },
              to: { name: entry.journey.to },
              via: [],
              dateTime: entry.journey.departsAt,
              arriveBy: false,
              preference: 'fastest',
              wheelchair: false,
              maxWalkDistance: 2000,
            }),
          });
          const payload = (await response.json()) as { itineraries?: Itinerary[]; error?: string; message?: string };
          const itinerary = (payload.itineraries || [])[0];
          if (!response.ok || !itinerary) {
            result = {
              state: 'unconfirmed',
              reason: payload.message || payload.error || 'The loaded timetable did not confirm a journey between these two stations at that time.',
            };
          } else {
            const legs = (itinerary.legs || [])
              .filter((leg) => leg.mode !== 'WALK')
              .map((leg) => String(leg.route || leg.mode))
              .join(' to ');
            const minutes = Math.max(0, Math.round((millis(itinerary.endTime) - millis(itinerary.startTime)) / 60000));
            result = { state: 'planned', legs: legs || 'Walking', minutes };
          }
        } catch {
          result = { state: 'unconfirmed', reason: 'The journey planner could not be reached.' };
        }
        if (cancelled) return;
        setPlans((current) => ({ ...current, [entry.id]: result }));
      }
    })();
    return () => { cancelled = true; };
  }, [cancellations, plans]);

  if (!status) return null;

  return (
    <section className="go-cancellations">
      <div className="content-heading">
        <div>
          <span className="eyebrow">{t('GO TRANSIT', 'GO 交通')}</span>
          <h3><TrainFront size={18} aria-hidden="true" />{t('Cancellations, and the trains offered instead', '取消班次，同官方建議嘅替代班次')}</h3>
        </div>
        <button type="button" className="pill" onClick={() => void load()} disabled={loading}>
          <RefreshCcw size={16} aria-hidden="true" />{loading ? t('Checking', '查緊') : t('Check again', '再查一次')}
        </button>
      </div>

      {status.state === 'unavailable' && (
        <output className="data-note">
          <TriangleAlert size={16} aria-hidden="true" />
          {t(
            'GO service alerts are unavailable right now, so this list is empty for that reason rather than because service is running normally.',
            'GO 服務通告而家攞唔到，所以下面係空嘅，並唔代表一切正常。',
          )}
          {status.reason ? ` ${status.reason}` : ''}
        </output>
      )}

      {status.state !== 'unavailable' && cancellations.length === 0 && (
        <p className="data-note">{t('No cancellation with named alternatives is published right now.', '而家冇取消班次連建議替代班次嘅通告。')}</p>
      )}

      <ol className="go-cancellation-list">
        {cancellations.map((cancellation) => (
          <li key={cancellation.alertId || cancellation.title}>
            <strong>{cancellation.title}</strong>
            {cancellation.cancelled && (
              <p className="data-note">{t(
                `Cancelled: ${cancellation.cancelled.from} ${cancellation.cancelled.departs} to ${cancellation.cancelled.to} ${cancellation.cancelled.arrives}.`,
                `已取消：${cancellation.cancelled.from} ${cancellation.cancelled.departs} 開往 ${cancellation.cancelled.to} ${cancellation.cancelled.arrives}。`,
              )}</p>
            )}
            {cancellation.advice && cancellation.alternatives.length === 0 && cancellation.unparsed.length === 0 && (
              <p className="go-advice">
                {/* The operator's own sentence, whole. Nothing is read out of it. */}
                {cancellation.advice}
                <small className="go-unconfirmed">{t(
                  'This alert describes what to do in prose rather than naming trains, so no journey could be looked up for it. Follow the operator wording above.',
                  '呢個通告係用文字講點做，冇列明邊班車，所以搵唔到對應行程。請跟返上面營運商嘅講法。',
                )}</small>
              </p>
            )}
            <ul className="go-alternatives">
              {cancellation.alternatives.map((journey) => {
                const plan = plans[key(cancellation, journey)];
                return (
                  <li key={key(cancellation, journey)}>
                    {/* The operator's own line, word for word. */}
                    <b>{journey.mode}: {journey.text}</b>
                    {plan?.state === 'planning' && <small>{t('Looking this up in the timetable', '喺時間表搵緊')}</small>}
                    {plan?.state === 'planned' && (
                      <small className="go-planned">
                        {t(
                          `Planned from the timetable: ${plan.legs}, about ${plan.minutes} min.`,
                          `按時間表計出：${plan.legs}，大約 ${plan.minutes} 分鐘。`,
                        )}
                      </small>
                    )}
                    {plan?.state === 'unconfirmed' && (
                      <small className="go-unconfirmed">
                        {t(
                          'The operator published this option and the loaded timetable did not confirm a journey for it, so ride it on the operator word rather than ours.',
                          '呢個係營運商公布嘅選擇，但我哋載入嘅時間表確認唔到呢段行程，請以營運商公布為準。',
                        )}
                        {' '}
                        {plan.reason}
                      </small>
                    )}
                    {!journey.departsAt && (
                      <small className="go-unconfirmed">{t(
                        'This alert carries no date, so the published time could not be placed on a day and no journey was looked up.',
                        '呢個通告冇日期，所以未能將公布時間放喺某一日，亦冇搵行程。',
                      )}</small>
                    )}
                  </li>
                );
              })}
              {cancellation.unparsed.map((line) => (
                <li key={line}>
                  <b>{line}</b>
                  <small className="go-unconfirmed">{t(
                    'This option is not written as a station and a time, so it is shown exactly as published rather than guessed at.',
                    '呢個選擇冇寫成車站同時間，所以照原文顯示，唔會亂估。',
                  )}</small>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      {status.sourceUrl && (
        <p className="data-note">
          <a href={status.sourceUrl} target="_blank" rel="noreferrer noopener">
            {t('Service updates published by the operator', '營運商公布嘅服務更新')} <ExternalLink size={14} aria-hidden="true" />
          </a>
          {status.fetchedAt
            ? ` · ${t('read at', '讀取時間')} ${new Date(status.fetchedAt).toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit' })}`
            : ''}
        </p>
      )}
    </section>
  );
}
