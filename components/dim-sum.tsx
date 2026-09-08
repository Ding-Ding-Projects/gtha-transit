'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './icon';
import {
  DIM_SUM_MANIFEST,
  DIM_SUM_MS,
  chooseDish,
  dishImage,
  dishName,
  drawsSurprise,
  momentIsRight,
  parseManifest,
  type DimSumDish,
} from '../lib/dim-sum';

type Translate = (en: string, zh: string) => string;

export type DimSumProps = {
  t: Translate;
  /** Conditions in which a surprise would be an interruption rather than a delight. */
  firstRun?: boolean;
  error?: boolean;
  busy?: boolean;
  suppressed?: boolean;
};

/**
 * A one-in-ten chance of a dim sum dish, at startup.
 *
 * There is no setting for this, deliberately. What makes an un-optable surprise
 * polite is that it costs nothing: it does not gate startup, does not take focus,
 * does not appear during a first run or an error, and goes away on its own. The
 * draw happens once, on mount, from one random value.
 *
 * The picture comes from this origin, out of the set the vendoring script brings
 * in from the public catalog and downscales. When that set is not there — nobody
 * has run the script, or the fetch failed — nothing is shown at all, because a
 * dish with a missing picture is not a smaller surprise, it is a broken one.
 */
export default function DimSum({ t, firstRun, error, busy, suppressed }: DimSumProps) {
  const [dish, setDish] = useState<DimSumDish | null>(null);
  const [gone, setGone] = useState(false);
  const drawn = useRef(false);

  useEffect(() => {
    if (drawn.current) return;
    if (!momentIsRight({ firstRun, error, busy, suppressed })) return;
    drawn.current = true;

    /* One draw per launch, before anything is fetched. Nine launches in ten cost
       nothing at all: no request, no manifest, no image. */
    if (!drawsSurprise(Math.random())) return;

    let cancelled = false;
    fetch(DIM_SUM_MANIFEST, { cache: 'force-cache' })
      .then((response) => (response.ok ? response.json() : null))
      .then((raw) => {
        if (cancelled) return;
        const chosen = chooseDish(parseManifest(raw), Math.random());
        if (chosen) setDish(chosen);
      })
      .catch(() => { /* No set vendored. Nothing is shown, and nothing is said. */ });
    return () => { cancelled = true; };
  }, [firstRun, error, busy, suppressed]);

  useEffect(() => {
    if (!dish) return;
    const timer = window.setTimeout(() => setGone(true), DIM_SUM_MS);
    return () => window.clearTimeout(timer);
  }, [dish]);

  if (!dish || gone) return null;

  return (
    <aside className="dim-sum" aria-label={t('A dim sum dish', '一味點心')}>
      {/*
        * Not a dialog, not a live region, and nothing that takes focus. It is
        * decoration that happens to be pleasant, and a screen reader finds it in
        * the reading order rather than being interrupted by it.
        */}
      <img src={dishImage(dish)} alt={dish.alt} width={480} height={480} loading="eager" decoding="async" />
      <div className="dim-sum__text">
        <small>{t('A little something', '一味嘢')}</small>
        {/* The dish's own name, in both languages, whatever the language mode and
            whatever the playfulness level: it is a name, not copy. */}
        <strong lang="zh-Hant">{dishName(dish)}</strong>
      </div>
      <button type="button" className="dim-sum__close" aria-label={t('Dismiss', '關閉')} onClick={() => setGone(true)}>
        <Icon name="close" size={18} />
      </button>
    </aside>
  );
}
