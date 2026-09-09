'use client';

import Link from 'next/link';
import { BrandMark } from './brand-mark';
import { Icon } from './icon';
import { workspaceDestinations } from '../lib/destinations';
import TabStrip from './tab-strip';

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
  appName?: string;
  active: string;
  onChange: (value: string) => void;
  dark: boolean;
  onTheme: () => void;
  lang: Language;
  onLang: (value: Language) => void;
  /**
   * Leave the language buttons out entirely, rather than disabling them.
   *
   * A greyed-out row still reads "Cantonese" to everybody looking at the screen,
   * which is exactly what somebody who turned that mode on did not want.
   */
  hideLanguages?: boolean;
  t: (en: string, zh: string) => string;
};

export default function WorkspaceNavigation({ appName, active, onChange, dark, onTheme, lang, onLang, t, hideLanguages }: Props) {
  const languages: { id: Language; short: string; name: string }[] = [
    { id: 'en', short: 'EN', name: t('English', '英文') },
    { id: 'zh', short: '中', name: t('Cantonese', '廣東話') },
    // One glyph, because three labels share 84px. The accessible name says it fully.
    { id: 'both', short: '雙', name: t('Both languages', '雙語') },
  ];

  return <>
    <header className="m3-nav" data-ui="navigation.rail" aria-label={t('Main navigation', '主要導覽')}>
      <Link href="/" className="m3-nav__brand" aria-label={appName || 'GTHA Transit'} data-ui="brand.mark">
        <BrandMark size={36} />
        <span className="m3-nav__brand-text" data-ui="brand.name">{appName || <>GTHA<span className="brand-light">transit</span></>}</span>
      </Link>

      <TabStrip surface="navigation" tabs={workspaceDestinations(t)} active={active} onChange={onChange} pinned={['plan']} panelId="workspace-panel" t={t} />

      <div className="m3-nav__tail">
        {/* fieldset rather than role="group": the native element carries the
            grouping semantics, which is what assistive technology reads first. */}
        {!hideLanguages && <fieldset className="m3-nav__langs" aria-label={t('Language', '語言')}>
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
        </fieldset>}
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

  </>;
}
