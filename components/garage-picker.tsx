'use client';

import { useEffect, useMemo, useState } from 'react';
import { Icon } from './icon';
import type { GarageDisclosure, GarageRegistry } from '../lib/garage-preference';

/**
 * Choose the garages whose routes you would rather ride.
 *
 * The honest shape of the question. No feed says which vehicle a departure will
 * be before it arrives, so this cannot promise a Mount Dennis bus; what the TTC
 * publishes is which garage runs which route, and that is what is offered. The
 * copy says so rather than implying a guarantee nobody can make.
 *
 * Each garage opens to show the routes it operates and the vehicles running on
 * them right now, which is as close to "the vehicles in that garage" as published
 * data reaches while the allocation source is between board periods.
 */

type LiveVehicle = { id: string; fleetNumber?: string; routeId?: string; label?: string };

export default function GaragePicker({
  registry,
  selected,
  onChange,
  disclosure,
  t,
}: {
  registry: GarageRegistry;
  selected: string[];
  onChange: (next: string[]) => void;
  disclosure: GarageDisclosure | null;
  t: (en: string, zh: string) => string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, LiveVehicle[] | 'unavailable'>>({});

  const garages = useMemo(
    () =>
      Object.entries(registry.garageNames ?? {})
        .map(([code, name]) => ({ code, name, routes: registry.routesByGarage?.[code] ?? [] }))
        .filter((garage) => garage.routes.length)
        .sort((first, second) => first.name.localeCompare(second.name)),
    [registry],
  );

  /* Fetched only when a garage is opened. Loading ten garages' fleets to render a
     checkbox list nobody expanded would be a lot of traffic for nothing. */
  useEffect(() => {
    if (!open || live[open]) return;
    let cancelled = false;
    /* Loading is derived below rather than stored. Writing a 'loading' marker here
       would be a setState in the body of an effect, which cascades a render for a
       fact the component can already work out: open, with no entry yet. */
    const routes = new Set(registry.routesByGarage?.[open] ?? []);
    fetch('/api/vehicles?agency=ttc&limit=2500')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body) => {
        if (cancelled) return;
        // json() is unknown, and it comes from the network, so it is narrowed here
        // rather than asserted into a shape nobody checked.
        const payload = body as { vehicles?: LiveVehicle[] } | null;
        const onThoseRoutes = (Array.isArray(payload?.vehicles) ? payload.vehicles : [])
          .filter((vehicle) => vehicle?.routeId && routes.has(String(vehicle.routeId)))
          .slice(0, 200);
        setLive((current) => ({ ...current, [open]: onThoseRoutes }));
      })
      .catch(() => {
        if (!cancelled) setLive((current) => ({ ...current, [open]: 'unavailable' }));
      });
    return () => { cancelled = true; };
  }, [open, registry, live]);

  const toggle = (code: string) =>
    onChange(selected.includes(code) ? selected.filter((one) => one !== code) : [...selected, code]);

  return (
    <section className="garage-picker" aria-label={t('Ride a garage', '指定車廠')}>
      <h3>{t('Garages you would rather ride', '你想搭邊個車廠')}</h3>
      <p className="data-note">
        {t(
          'No feed says which vehicle a departure will be before it arrives. What the TTC publishes is which garage runs which route, so these move journeys on those routes to the top. Nothing is hidden: anything that rides none of them is still listed, last, as an alternate.',
          '冇任何資料源可以喺班車埋站前話你知係邊架車。TTC 公布嘅係邊個車廠行邊條線，所以揀咗之後，行嗰啲線嘅行程會排喺前面。冇嘢會被隱藏：完全唔行嗰啲照樣會喺最後面列出嚟做替代路線。',
        )}
      </p>

      <ul className="garage-list">
        {garages.map((garage) => {
          const checked = selected.includes(garage.code);
          const detailId = `garage-detail-${garage.code}`;
          const vehicles = live[garage.code];
          const loading = open === garage.code && vehicles === undefined;
          return (
            <li key={garage.code}>
              <label className="garage-choice">
                <input type="checkbox" checked={checked} onChange={() => toggle(garage.code)} />
                <span className="garage-choice__name">{garage.name}</span>
                <span className="garage-choice__count">
                  {t(`${garage.routes.length} routes`, `${garage.routes.length} 條線`)}
                </span>
              </label>
              <button
                type="button"
                className="text-button garage-more"
                aria-expanded={open === garage.code}
                aria-controls={detailId}
                onClick={() => setOpen(open === garage.code ? null : garage.code)}
              >
                {open === garage.code ? t('Hide details', '收起詳情') : t('Show more details', '顯示更多詳情')}
                <Icon name={open === garage.code ? 'expand_less' : 'expand_more'} size={16} />
              </button>
              {open === garage.code && (
                <div className="garage-detail" id={detailId}>
                  <h4>{t('Routes this garage operates', '呢個車廠行嘅路線')}</h4>
                  <p className="garage-routes">{garage.routes.join(' · ')}</p>
                  <h4>{t('Running on those routes right now', '而家喺呢啲線上行緊嘅車')}</h4>
                  {loading && <p className="data-note">{t('Reading the live feed…', '讀取即時資料中…')}</p>}
                  {vehicles === 'unavailable' && (
                    <p className="data-note">{t('The live vehicle feed did not answer.', '即時車輛資料未有回應。')}</p>
                  )}
                  {Array.isArray(vehicles) && !vehicles.length && (
                    <p className="data-note">{t('No vehicles are reporting on these routes right now.', '呢啲線而家冇車輛回報位置。')}</p>
                  )}
                  {Array.isArray(vehicles) && vehicles.length > 0 && (
                    <>
                      <ul className="garage-vehicles">
                        {vehicles.map((vehicle) => (
                          <li key={vehicle.id}>
                            <strong>{vehicle.fleetNumber || vehicle.label || vehicle.id}</strong>
                            <span>{vehicle.routeId}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="data-note">
                        {t(
                          `${vehicles.length} vehicles are on this garage's routes now. That is where they are running, not a confirmation of where they sleep: the published allocation source is what says that, and it is between board periods.`,
                          `而家有 ${vehicles.length} 架車喺呢個車廠嘅線上行緊。呢個係佢哋而家喺邊行，唔係確認佢哋屬邊個車廠；要確認就要睇官方配車資料，而嗰份而家喺兩個班期之間。`,
                        )}
                      </p>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {disclosure?.enabled && (
        <output className="garage-outcome">
          {disclosure.note
            ? disclosure.note
            : t(
                `${disclosure.counts.every} options ride these garages the whole way.`,
                `${disclosure.counts.every} 個行程全程都行呢啲車廠嘅線。`,
              )}
          {disclosure.sourceExpired && disclosure.validThrough && (
            <small>
              {t(
                `Route assignments come from a published summary covering service through ${disclosure.validThrough}, and a newer one is not out. Routes change between board periods, so treat this as the last published answer rather than today's.`,
                `路線分配來自涵蓋至 ${disclosure.validThrough} 嘅官方摘要，新一份未出。班期之間路線會變，所以呢個係最後一次公布嘅答案，唔等於今日嘅實際情況。`,
              )}
            </small>
          )}
        </output>
      )}
    </section>
  );
}
