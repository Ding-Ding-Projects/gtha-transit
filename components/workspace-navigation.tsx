'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight, Bookmark, BusFront, ChartNoAxesCombined, CircleHelp, History, Menu, Moon, Route, Settings, Sun, TrainFront, X } from 'lucide-react';

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
  const destinations = [
    { id: 'plan', label: t('Plan a trip', '規劃行程'), icon: Route, primary: true },
    { id: 'vehicles', label: t('Vehicles', '車輛'), icon: BusFront, primary: true },
    { id: 'status', label: t('Live TTC', '即時 TTC'), icon: TrainFront, primary: true },
    { id: 'divisions', label: t('Out of division', '跨車廠'), icon: ChartNoAxesCombined },
    { id: 'history', label: t('History', '歷史'), icon: History },
    { id: 'saved', label: t('Saved trips', '已儲存行程'), icon: Bookmark },
    { id: 'coverage', label: t('Our region', '服務範圍'), icon: CircleHelp },
    { id: 'settings', label: t('Settings', '設定'), icon: Settings },
  ];
  useEffect(() => {
    if (moreOpen) dialog.current?.showModal();
  }, [moreOpen]);
  const closeMore = () => { dialog.current?.close(); setMoreOpen(false); moreButton.current?.focus(); };
  const navigate = (id: string) => {
    if (moreOpen) closeMore();
    onChange(id);
    requestAnimationFrame(() => document.getElementById('workspace-heading')?.focus());
  };
  return <>
    <header className="topbar transit-navigation">
      <Link href="/" className="brand" aria-label="GTHA Transit">
        <Image unoptimized src="/logo.svg" alt="" width={40} height={40} />
        <span>GTHA<span className="brand-light">transit</span><small>{t('A CONNECTED REGION', '連繫整個地區')}</small></span>
      </Link>
      <span className="navigation-caption">{t('YOUR WORKSPACE', '你嘅工作區')}</span>
      <nav aria-label={t('Main navigation', '主要導覽')}>
        {destinations.map(({ id, label, icon: Icon, primary }) => <button key={id} type="button" className={`${active === id ? 'active ' : ''}${primary ? 'nav-primary' : 'nav-secondary'}`} onClick={() => navigate(id)} aria-current={active === id ? 'page' : undefined}>
          <Icon size={21} aria-hidden="true" /><span>{label}</span>{id === 'status' && <span className="live-dot" aria-hidden="true" />}
        </button>)}
        <button ref={moreButton} type="button" className={`nav-more ${!destinations.find(item => item.id === active)?.primary ? 'active' : ''}`} aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}><Menu size={21} aria-hidden="true" /><span>{t('More', '更多')}</span></button>
      </nav>
      <div className="navigation-footer">
        <p>{t('One region. Every connection.', '一個地區，接通每一程。')}</p>
        <a href="https://github.com/Ding-Ding-Projects/gtha-transit" target="_blank" rel="noreferrer">{t('Independent & open source', '獨立開源')}<ArrowUpRight size={14} aria-hidden="true" /></a>
      </div>
      <div className="header-actions">
        <button type="button" className="icon-button" onClick={onTheme} aria-label={t('Switch colour theme', '切換色彩主題')}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button>
        <span>{dark ? t('Dark appearance', '深色外觀') : t('Light appearance', '淺色外觀')}</span>
      </div>
    </header>
    {moreOpen && <dialog ref={dialog} className="navigation-dialog" aria-label={t('More destinations', '更多目的地')} onCancel={closeMore} onClose={() => setMoreOpen(false)}>
      <header><div><span className="eyebrow">GTHA TRANSIT</span><h2>{t('Your workspace', '你嘅工作區')}</h2></div><button type="button" className="icon-button" aria-label={t('Close navigation', '關閉導覽')} onClick={closeMore}><X size={20} /></button></header>
      <div className="navigation-destinations">{destinations.filter(item => !item.primary).map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-current={active === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={22} aria-hidden="true" /><span>{label}</span><ArrowUpRight size={17} aria-hidden="true" /></button>)}</div>
    </dialog>}
  </>;
}
