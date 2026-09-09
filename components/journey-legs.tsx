import type { Itinerary } from '../lib/types';

const clock = (value: string | number) => new Date(value).toLocaleTimeString('en-CA', {
  timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit',
});

export default function JourneyLegs({ journey, t }: {
  journey: Itinerary;
  t: (en: string, zh: string) => string;
}) {
  return <ol className="catch-directions" aria-label={t('Journey directions', '行程指示')}>
    {journey.legs.map((leg, index) => <li key={index + ':' + leg.from.id + ':' + leg.to.id}>
      <strong>{leg.mode === 'WALK' ? t('Walk', '步行') : ((leg.agency ?? '') + ' ' + (leg.route ?? leg.mode)).trim()}</strong>
      {' · '}{leg.from.name} → {leg.to.name}
      <small>{clock(leg.startTime)} – {clock(leg.endTime)} · {t('Toronto time', '多倫多時間')}</small>
      {leg.headsign && <small>{t('Towards', '往')}: {leg.headsign}</small>}
    </li>)}
  </ol>;
}
