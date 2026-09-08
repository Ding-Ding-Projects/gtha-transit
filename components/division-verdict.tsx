'use client';

import type { RouteColour } from '../lib/use-route-colours';

/**
 * What the two garages mean, said once, instead of left to be worked out.
 *
 * The panel used to show "Home garage: Wilson" beside "Route garages: Mount
 * Dennis" and stop there. Both facts were right and neither said the thing the
 * reader came for, which is that those two being different IS the finding: this
 * bus is a long way from home. Two labels a reader has to compare is a puzzle,
 * not an answer.
 *
 * So the verdict leads, in a sentence, and the facts sit underneath it as
 * evidence for the sentence rather than in place of one.
 */

export type Division = {
  state: string;
  reason?: string;
  sourceCoverage?: string;
  homeGarageName?: string;
  assignedGarageNames?: string[];
  rarity?: {
    state: string;
    eligible?: boolean;
    percentage?: number | null;
    rarity?: string | null;
    sample?: { vehicleRouteDays: number; routeObservedDays: number };
    note?: string;
  };
};

/** The route number in the operator's own colour, or plainly when it has none. */
export function RouteChip({
  routeId,
  colour,
  t,
}: {
  routeId?: string | null;
  colour: RouteColour;
  t: (en: string, zh: string) => string;
}) {
  if (!routeId) return <span className="route-chip route-chip--none">{t('No route', '冇路線')}</span>;
  const label = colour.shortName || routeId;
  const styled = Boolean(colour.color);
  return (
    <span
      className={`route-chip${styled ? '' : ' route-chip--plain'}`}
      style={styled ? { background: colour.color!, color: colour.textColor ?? '#000' } : undefined}
      title={[colour.longName, styled ? null : t('No official colour is published for this route', '呢條線冇官方顏色')]
        .filter(Boolean).join(' · ') || undefined}
    >
      {label}
    </span>
  );
}

export default function DivisionVerdict({
  division,
  routeId,
  colour,
  t,
}: {
  division: Division;
  routeId?: string | null;
  colour: RouteColour;
  t: (en: string, zh: string) => string;
}) {
  const home = division.homeGarageName;
  const routeGarages = division.assignedGarageNames?.filter(Boolean) ?? [];
  const routeGarageText = routeGarages.join(t(' or ', ' 或 '));
  const rarity = division.rarity;
  const isRare = Boolean(rarity?.eligible && rarity.rarity);

  const headline =
    division.state === 'out-of-division'
      ? t('Out of division', '跨車廠')
      : division.state === 'in-division'
        ? t('Working from home', '喺自己車廠嘅線')
        : t('Home garage unconfirmed', '未確認所屬車廠');

  /* One sentence, in the order a person asks it: where does this bus live, and
     who is supposed to run this route. */
  const sentence =
    division.state === 'out-of-division' && home && routeGarageText
      ? t(
          `This bus lives at ${home}, and route ${routeId} is run from ${routeGarageText}. That is why it counts as out of division.`,
          `呢架車屬 ${home} 車廠，但 ${routeId} 線由 ${routeGarageText} 行。所以先叫跨車廠。`,
        )
      : division.state === 'in-division' && home
        ? t(
            `This bus lives at ${home}, which is one of the garages that runs route ${routeId}.`,
            `呢架車屬 ${home} 車廠，而 ${routeId} 線正是由呢個廠行。`,
          )
        : t(
            'The published allocation does not confirm where this bus is based, so it is neither in nor out of division.',
            '已公布嘅配車資料未能確認呢架車屬邊個廠，所以佢唔算喺自己廠，亦唔算跨廠。',
          );

  return (
    <div className={`division-verdict is-${division.state}`}>
      <div className="division-verdict__head">
        <strong>{headline}</strong>
        <RouteChip routeId={routeId} colour={colour} t={t} />
        {isRare && (
          <span className="division-verdict__rare" title={rarity?.note || undefined}>
            {rarity!.rarity}
            {typeof rarity!.percentage === 'number' ? ` · ${rarity!.percentage.toFixed(1)}%` : ''}
          </span>
        )}
      </div>
      <p>{sentence}</p>
      <dl className="division-verdict__facts">
        <div>
          <dt>{t('Lives at', '所屬車廠')}</dt>
          <dd>{home || t('Unconfirmed', '未確認')}</dd>
        </div>
        <div>
          <dt>{t('This route is run from', '呢條線由邊個廠行')}</dt>
          <dd>{routeGarageText || t('Unconfirmed', '未確認')}</dd>
        </div>
        <div>
          <dt>{t('Seen on this route', '喺呢條線見過')}</dt>
          <dd>
            {rarity?.eligible && typeof rarity.percentage === 'number'
              ? t(
                  `${rarity.percentage.toFixed(1)}% of observed days`,
                  `佔已觀察日子嘅 ${rarity.percentage.toFixed(1)}%`,
                )
              : t('Still collecting observations', '仲喺度儲觀察資料')}
            {rarity?.sample && (
              <small>
                {t(
                  `${rarity.sample.vehicleRouteDays} of ${rarity.sample.routeObservedDays} observed days`,
                  `${rarity.sample.routeObservedDays} 個已觀察日入面有 ${rarity.sample.vehicleRouteDays} 日`,
                )}
              </small>
            )}
          </dd>
        </div>
      </dl>
      {division.sourceCoverage === 'last-published' && (
        <small className="division-verdict__source">
          {t(
            'From the last published TTC allocation summary, which covers a period that has ended. Garages change between board periods.',
            '嚟自最後一份 TTC 配車摘要，而嗰段時期已經完結。班期之間車廠會變。',
          )}
        </small>
      )}
      {rarity?.note && <small className="division-verdict__source">{rarity.note}</small>}
    </div>
  );
}
