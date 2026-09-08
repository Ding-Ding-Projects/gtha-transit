'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BrandMark } from './brand-mark';
import { Icon } from './icon';
import { primaryDestinations, secondaryDestinations } from '../lib/destinations';

/**
 * Navigation: a rail on desktop, a bar on mobile, one list behind both.
 *
 * The rail shows every destination, grouped. It can: a vertical strip has room
 * for nine labels where a horizontal one has room for four, which is the whole
 * reason the design docks it to the left edge rather than the top. Hiding six
 * destinations behind a dialog on a screen with room for them was solving the
 * phone's problem on the desktop.
 *
 * The bar is still four and More, because a phone genuinely cannot show nine
 * targets at a size anyone can hit. Same list, same order, one component; two
 * navigations that drift apart is the failure this avoids.
 *
 * Which one you get is decided in CSS, at the Material breakpoint, by display
 * rather than by visibility. A control hidden but still focusable is a control
 * that traps the keyboard on a surface where it does not appear.
 */

type Language = 'en' | 'zh' | 'both';

type Props = {
  active: string;
  onChange: (value: string) => void;
  dark: boolean;
  onTheme: () => void;
  lang: Language;
  onLang: (value: Language) => void;
  t: (en: string, zh: string) => string;
};

export default function WorkspaceNavigation({ active, onChange, dark, onTheme, lang, onLang, t }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);

  /**
   * The four that earn a place on a phone, and the rest, which the rail still shows.
   *
   * Both come from the destinations registry rather than being written here, so the
   * rail, the More dialog, the workspace heading and the command palette cannot end
   * up navigating to four different lists of the same nine places.
   */
  const primary = primaryDestinations(t);
  const secondary = secondaryDestinations(t);
  const inMore = secondary.some((item) => item.id === active);

  useEffect(() => { if (moreOpen) dialog.current?.showModal(); }, [moreOpen]);
  const closeMore = () => { dialog.current?.close(); setMoreOpen(false); moreButton.current?.focus(); };
  const navigate = (id: string) => {
    if (moreOpen) closeMore();
    onChange(id);
    requestAnimationFrame(() => document.getElementById('workspace-heading')?.focus());
  };

  /**
   * One destination target.
   *
   * The active indicator is a shape behind the glyph, not a colour change alone,
   * so which destination is current does not depend on seeing a hue.
   */
  const destination = (
    { id, label, glyph }: { id: string; label: string; glyph: string },
    group: 'primary' | 'secondary' = 'primary',
  ) => (
    <button
      key={id}
      type="button"
      className={`m3-nav__item m3-nav__item--${group}${active === id ? ' is-active' : ''}`}
      onClick={() => navigate(id)}
      aria-current={active === id ? 'page' : undefined}
    >
      <span className="m3-nav__indicator">
        <Icon name={glyph} size={22} />
        {id === 'status' && <span className="m3-nav__badge" aria-hidden="true" />}
      </span>
      <span className="m3-nav__label">{label}</span>
    </button>
  );

  const languages: { id: Language; short: string; name: string }[] = [
    { id: 'en', short: 'EN', name: t('English', '英文') },
    { id: 'zh', short: '中', name: t('Cantonese', '廣東話') },
    // One glyph, because three labels share 84px. The accessible name says it fully.
    { id: 'both', short: '雙', name: t('Both languages', '雙語') },
  ];

  return <>
    <header className="m3-nav" aria-label={t('Main navigation', '主要導覽')}>
      <Link href="/" className="m3-nav__brand" aria-label="GTHA Transit">
        <BrandMark size={36} />
        <span className="m3-nav__brand-text">GTHA<span className="brand-light">transit</span></span>
      </Link>

      <nav className="m3-nav__items" aria-label={t('Destinations', '目的地')}>
        {/* Wrapped, not passed bare: map hands the index in as the second argument. */}
        {primary.map((item) => destination(item))}
        {/* Only the phone bar shows this. The rail lists the same items below it. */}
        <button
          ref={moreButton}
          type="button"
          className={`m3-nav__item m3-nav__item--more${inMore ? ' is-active' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
        >
          <span className="m3-nav__indicator"><Icon name="more_horiz" size={22} /></span>
          <span className="m3-nav__label">{t('More', '更多')}</span>
        </button>
        <span className="m3-nav__divider" aria-hidden="true" />
        {secondary.map((item) => destination(item, 'secondary'))}
      </nav>

      <div className="m3-nav__tail">
        {/* fieldset rather than role="group": the native element carries the
            grouping semantics, which is what assistive technology reads first. */}
        <fieldset className="m3-nav__langs" aria-label={t('Language', '語言')}>
          {languages.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`m3-nav__lang${lang === option.id ? ' is-active' : ''}`}
              aria-pressed={lang === option.id}
              aria-label={option.name}
              onClick={() => onLang(option.id)}
            >
              {option.short}
            </button>
          ))}
        </fieldset>
        <button
          type="button"
          className="m3-nav__theme"
          onClick={onTheme}
          aria-label={dark ? t('Switch to day appearance', '切換日間外觀') : t('Switch to night appearance', '切換夜間外觀')}
        >
          <Icon name={dark ? 'light_mode' : 'dark_mode'} size={20} />
        </button>
      </div>
    </header>

    <dialog ref={dialog} className="m3-more" onClose={() => setMoreOpen(false)} aria-label={t('More destinations', '更多目的地')}>
      <div className="m3-more__head">
        <h2>{t('More', '更多')}</h2>
        <button type="button" className="m3-more__close" onClick={closeMore} aria-label={t('Close', '關閉')}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="m3-more__items">
        {secondary.map(({ id, label, glyph }) => (
          <button
            key={id}
            type="button"
            className={`m3-more__item${active === id ? ' is-active' : ''}`}
            onClick={() => navigate(id)}
            aria-current={active === id ? 'page' : undefined}
          >
            <Icon name={glyph} size={20} />
            {/* Classed, because the icon before it is a span too: a ligature font
                makes the glyph literally text, so "the first span" is "flag". */}
            <span className="m3-more__label">{label}</span>
          </button>
        ))}
      </div>
      <div className="m3-more__foot">
        <p>{t('One region. Every connection.', '一個地區，接通每一程。')}</p>
        <a href="https://github.com/Ding-Ding-Projects/gtha-transit" target="_blank" rel="noreferrer">
          {t('Independent & open source', '獨立開源')}<Icon name="arrow_forward" size={14} />
        </a>
      </div>
    </dialog>
  </>;
}
