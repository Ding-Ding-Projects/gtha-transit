'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowUpRight, Bookmark, BusFront, ChartNoAxesCombined, CircleHelp, Flag, History,
  Menu, Moon, Route, Settings, Sun, TrainFront, X,
} from 'lucide-react';

/**
 * Navigation: a rail on desktop, a bar on mobile, four destinations either way.
 *
 * Nine destinations in one list meant nine things to read before choosing one,
 * and the three that matter were buried among six that do not. Four are primary
 * because four is what people actually reach for; the rest live behind More,
 * which is one target rather than six.
 *
 * The rail and the bar are the same component and the same list. Two navigations
 * that drift apart is the failure this avoids: a destination added here appears
 * in both, or in neither.
 */

type Props = {
  active: string;
  onChange: (value: string) => void;
  dark: boolean;
  onTheme: () => void;
  t: (en: string, zh: string) => string;
};

export default function WorkspaceNavigation({ active, onChange, dark, onTheme, t }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);

  /** The four that earn a permanent place, and everything else. */
  const primary = [
    { id: 'plan', label: t('Plan', '規劃'), icon: Route },
    { id: 'status', label: t('Live', '即時'), icon: TrainFront },
    { id: 'vehicles', label: t('Vehicles', '車輛'), icon: BusFront },
    { id: 'saved', label: t('Saved', '已儲存'), icon: Bookmark },
  ];
  const secondary = [
    { id: 'race', label: t('Race', '比賽'), icon: Flag },
    { id: 'divisions', label: t('Out of division', '跨車廠'), icon: ChartNoAxesCombined },
    { id: 'history', label: t('History', '歷史'), icon: History },
    { id: 'coverage', label: t('Our region', '服務範圍'), icon: CircleHelp },
    { id: 'settings', label: t('Settings', '設定'), icon: Settings },
  ];
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
   * The active indicator is a shape behind the icon rather than a colour change
   * alone, so which destination is current does not depend on seeing a hue.
   */
  const destination = ({ id, label, icon: Icon }: { id: string; label: string; icon: typeof Route }) => (
    <button
      key={id}
      type="button"
      className={`m3-nav__item${active === id ? ' is-active' : ''}`}
      onClick={() => navigate(id)}
      aria-current={active === id ? 'page' : undefined}
    >
      <span className="m3-nav__indicator">
        <Icon size={22} aria-hidden="true" />
        {id === 'status' && <span className="m3-nav__badge" aria-hidden="true" />}
      </span>
      <span className="m3-nav__label">{label}</span>
    </button>
  );

  return <>
    <header className="m3-nav" aria-label={t('Main navigation', '主要導覽')}>
      <Link href="/" className="m3-nav__brand" aria-label="GTHA Transit">
        <Image unoptimized src="/logo.svg" alt="" width={36} height={36} />
        <span className="m3-nav__brand-text">GTHA<span className="brand-light">transit</span></span>
      </Link>

      <nav className="m3-nav__items" aria-label={t('Destinations', '目的地')}>
        {primary.map(destination)}
        <button
          ref={moreButton}
          type="button"
          className={`m3-nav__item${inMore ? ' is-active' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
        >
          <span className="m3-nav__indicator"><Menu size={22} aria-hidden="true" /></span>
          <span className="m3-nav__label">{t('More', '更多')}</span>
        </button>
      </nav>

      <div className="m3-nav__tail">
        <button
          type="button"
          className="m3-nav__theme"
          onClick={onTheme}
          aria-label={dark ? t('Switch to light appearance', '切換淺色外觀') : t('Switch to dark appearance', '切換深色外觀')}
        >
          {dark ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
        </button>
      </div>
    </header>

    <dialog ref={dialog} className="m3-more" onClose={() => setMoreOpen(false)} aria-label={t('More destinations', '更多目的地')}>
      <div className="m3-more__head">
        <h2>{t('More', '更多')}</h2>
        <button type="button" className="m3-more__close" onClick={closeMore} aria-label={t('Close', '關閉')}>
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="m3-more__items">
        {secondary.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`m3-more__item${active === id ? ' is-active' : ''}`}
            onClick={() => navigate(id)}
            aria-current={active === id ? 'page' : undefined}
          >
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="m3-more__foot">
        <p>{t('One region. Every connection.', '一個地區，接通每一程。')}</p>
        <a href="https://github.com/Ding-Ding-Projects/gtha-transit" target="_blank" rel="noreferrer">
          {t('Independent & open source', '獨立開源')}<ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>
    </dialog>
  </>;
}
