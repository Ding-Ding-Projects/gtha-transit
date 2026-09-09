'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GripVertical, MoreHorizontal, Pin, Plus, Search, Settings2, X } from 'lucide-react';
import { Icon } from './icon';
import { SearchWorkbench, emptySearchState, useSearchMatches } from './search-workbench';
import { useLocalSetting } from '../lib/use-local-setting';
import { activeTab, applyBulkClose, close, collapseGroup, createGroup, createStripState, groupsInOrder, keyForOrientation, moveIntoGroup, moveRelative, orientationFor, parseStripState, pin, pinGroup, recolourGroup, removeGroup, renameGroup, reopen, reorder, reorderGroup, serializeStripState, setDock, STRIP_KEY, unpin, visibleTabs, type TabStripState } from '../lib/tabs';
import { registerStrip, searchAllTabs, unregisterStrip } from '../lib/tab-registry';

type Tab = { id: string; label: string; glyph?: string };
type Props = { surface: string; tabs: Tab[]; allIds?: readonly string[]; active: string; onChange: (id: string) => void; t: (en: string, zh: string) => string; pinned?: string[]; panelId?: string };

/** A closed destination stays available in the reopen/search surface. */
export default function TabStrip({ surface, tabs, allIds, active, onChange, t, pinned = [], panelId }: Props) {
  const stored = useLocalSetting(STRIP_KEY(surface));
  const renderedIds = tabs.map(tab => tab.id).join('|');
  const idsKey = allIds?.join('|') ?? renderedIds;
  const state = useMemo(() => stored.value ? parseStripState(stored.value, surface, idsKey.split('|')) : createStripState(surface, idsKey.split('|'), { pinned }), [stored.value, surface, idsKey]);
  const [notice, setNotice] = useState('');
  const [find, setFind] = useState(emptySearchState);
  const [groupFind, setGroupFind] = useState(emptySearchState);
  const [masterFind, setMasterFind] = useState(emptySearchState);
  const [bulk, setBulk] = useState<'contains' | 'not-contains' | null>(null);
  const [includePinned, setIncludePinned] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [overflow, setOverflow] = useState<string[]>([]);
  const [menuTab, setMenuTab] = useState<string | null>(null);
  const [, refreshRegistry] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const drag = useRef<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const openIds = visibleTabs(state).filter(id => tabs.some(tab => tab.id === id));
  const match = useSearchMatches(tabs.map(tab => tab.label), find);
  const groups = groupsInOrder(state);
  const groupMatches = useSearchMatches(groups.map(group => group.name), groupFind);
  const allTabs = searchAllTabs(() => true);
  const masterMatches = useSearchMatches(allTabs.map(tab => `${tab.label} ${tab.surface}`), masterFind);
  const visible = openIds.filter(id => !state.groups.some(group => group.collapsed && group.members.includes(id) && id !== active && !state.pinned.includes(id)));
  const orientation = orientationFor(state.dock);
  const query = (find.mode === 'regex' ? find.pattern : find.query).trim();
  const affected = bulk && query && !match.error && !match.busy ? tabs.filter((tab, index) => openIds.includes(tab.id) && (includePinned || !state.pinned.includes(tab.id)) && (bulk === 'contains' ? match.matches[index] : !match.matches[index])).map(tab => tab.id) : [];
  const save = (next: TabStripState) => {
    try {
      if (!stored.setValue(serializeStripState(next))) setNotice(t('Tabs work for this session but could not be saved.', '分頁今次仍可使用，但未能儲存。'));
      const nextActive = activeTab({ ...next, order: next.order.filter(id => tabs.some(tab => tab.id === id)) }, active);
      if (nextActive !== active) { onChange(nextActive ?? ''); requestAnimationFrame(() => { if (nextActive) document.getElementById(`tab-${surface}-${nextActive}`)?.focus(); else button.current?.focus(); }); }
    } catch { setNotice(t('This tab arrangement is too large to save. Remove an unused group first.', '此分頁排列太大，未能儲存。請先移除無用群組。')); }
  };
  const activate = (id: string) => {
    let next = reopen(state, id);
    for (const group of next.groups) if (group.members.includes(id)) next = collapseGroup(next, group.id, false);
    save(next); onChange(id); popup.current?.hidePopover(); menu.current?.hidePopover();
    requestAnimationFrame(() => { document.getElementById(`tab-${surface}-${id}`)?.scrollIntoView({block:'nearest',inline:'nearest'}); if (surface === 'navigation') document.getElementById('workspace-heading')?.focus({preventScroll:true}); });
  };
  useEffect(() => {
    registerStrip(surface, () => ({ tabs, state }));
    const receive = (event: Event) => { const detail = (event as CustomEvent<{ surface: string; id: string }>).detail; if (detail.surface === surface) activate(detail.id); };
    window.addEventListener('gtha-open-tab', receive);
    return () => { unregisterStrip(surface); window.removeEventListener('gtha-open-tab', receive); };
  }, [surface, tabs, stored.value]);
  useEffect(() => {
    if (!state.closed.includes(active)) return;
    save(reopen(state, active));
  }, [active]);
  useEffect(() => {
    if (surface !== 'navigation') return;
    document.documentElement.dataset.navDock = state.dock;
    return () => { delete document.documentElement.dataset.navDock; };
  }, [surface, state.dock]);
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    const measure = () => {
      const box = node.getBoundingClientRect();
      const beyond = Array.from(node.querySelectorAll<HTMLElement>('[data-tab-id]')).filter(item => {
        const rect = item.getBoundingClientRect();
        return orientation === 'vertical' ? rect.bottom > box.bottom + 1 || rect.top < box.top - 1 : rect.right > box.right + 1 || rect.left < box.left - 1;
      }).map(item => item.dataset.tabId!);
      setOverflow(previous => previous.join('|') === beyond.join('|') ? previous : beyond);
    };
    const observer = new ResizeObserver(measure); observer.observe(node); measure(); node.addEventListener('scroll', measure);
    return () => { observer.disconnect(); node.removeEventListener('scroll', measure); };
  }, [orientation, idsKey, renderedIds, stored.value]);
  const editAppearance = (id: string) => window.dispatchEvent(new CustomEvent('gtha-edit-appearance', { detail: { id: `tab:${surface}:${id}` } }));
  const showMenu = (id: string) => { setMenuTab(id); menu.current?.showPopover(); };
  const key = (event: React.KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); showMenu(id); return; }
    const action = keyForOrientation(state.dock, event.key);
    if (action) {
      event.preventDefault();
      if (event.ctrlKey && (action === 'previous' || action === 'next')) { save(moveRelative(state, id, action === 'previous' ? -1 : 1)); return; }
      const index = visible.indexOf(id);
      const next = action === 'home' ? visible[0] : action === 'end' ? visible.at(-1) : visible[(index + (action === 'previous' ? -1 : 1) + visible.length) % visible.length];
      if (next) { activate(next); requestAnimationFrame(() => document.getElementById(`tab-${surface}-${next}`)?.focus()); }
    } else if (event.key === 'Delete') { event.preventDefault(); save(close(state, id)); }
  };
  return <div className="tab-strip" data-surface={surface} data-dock={state.dock}>
    {!openIds.length && <span className="sr-only" role="status">{t('All tabs are closed. Use tab tools to reopen a destination.','所有分頁已關閉，請使用分頁工具重新開啟目的地。')}</span>}
    <div className="tab-strip__list" ref={list} role="tablist" aria-label={t('Workspace tabs', '工作區分頁')} aria-orientation={orientation}>
      {visible.map(id => { const tab = tabs.find(item => item.id === id); if (!tab) return null; const group = state.groups.find(item => item.members.includes(id)); return <div className="tab-strip__item" key={id} data-tab-id={id}>
        <button type="button" className="tab-strip__tab" role="tab" id={`tab-${surface}-${id}`} aria-controls={panelId} aria-selected={active === id} tabIndex={active === id ? 0 : -1} onKeyDown={event => key(event, id)} onClick={() => activate(id)} onContextMenu={event => { event.preventDefault(); if (event.shiftKey) editAppearance(id); else showMenu(id); }} data-ui={`tab:${surface}:${id}`} title={tab.label}>
          {tab.glyph && <Icon name={tab.glyph} size={21} />}<span>{tab.label}</span>{state.pinned.includes(id) && <Pin size={12} aria-label={t('Pinned', '已固定')} />}{group && <small style={group.colour ? { borderBottom: '3px solid ' + group.colour } : undefined}>{group.name}</small>}
        </button>
        <button type="button" className="tab-strip__manage" onClick={() => showMenu(id)} aria-label={t(`Manage ${tab.label}`, `管理 ${tab.label}`)}><MoreHorizontal size={16} /></button>
        <button type="button" className="tab-strip__drag" aria-label={t(`Move ${tab.label}; use Control and arrow keys on the tab`, `移動 ${tab.label}；可於分頁使用 Control 加方向鍵`)} onPointerDown={event => { drag.current = id; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={event => { const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-tab-id]')?.dataset.tabId; if (drag.current && target) save(reorder(state, drag.current, state.order.indexOf(target))); drag.current = null; }} onPointerCancel={() => { drag.current = null; }}><GripVertical size={14} /></button>
      </div>; })}
    </div>
    <button type="button" className="tab-strip__overflow" ref={button} popoverTarget={`tabs-popup-${surface}`} onClick={() => refreshRegistry(value => value + 1)} aria-label={t('Find, reopen and arrange tabs', '搜尋、重開同排列分頁')}><Search size={18} /><Plus size={16} />{overflow.length > 0 && <span>{overflow.length}</span>}</button>
    <div id={`tabs-popup-${surface}`} ref={popup} popover="auto" className="tab-strip__popup">
      <header><h2>{t('Tabs', '分頁')}</h2><button type="button" onClick={() => { popup.current?.hidePopover(); button.current?.focus(); }} aria-label={t('Close tab tools', '關閉分頁工具')}><X size={20} /></button></header>
      <SearchWorkbench storageId={`tabs-strip-${surface}`} label={t('Find tabs in this strip', '搜尋此列分頁')} value={find} onChange={setFind} samples={tabs.map(tab => tab.label)} t={t} />
      <div className="tab-strip__results">{tabs.map((tab, index) => (!query || match.matches[index]) && <button type="button" key={tab.id} onClick={() => activate(tab.id)}>{tab.label}<small>{state.closed.includes(tab.id) ? t('Reopen', '重新開啟') : overflow.includes(tab.id) ? t('Outside visible strip', '位於可見分頁列之外') : t('Open', '已開啟')}</small></button>)}</div>
      {query && !match.busy && !match.error && !match.matches.some(Boolean) && <p>{t('No matching tabs.', '未有符合分頁。')}</p>}
      <fieldset><legend>{t('Dock edge', '停靠位置')}</legend>{(['left', 'right', 'top', 'bottom'] as const).map((dock, index) => <label key={dock}><input type="radio" name={`dock-${surface}`} checked={state.dock === dock} onChange={() => save(setDock(state, dock))} />{t(['Left', 'Right', 'Top', 'Bottom'][index], ['左', '右', '上', '下'][index])}</label>)}</fieldset>
      <fieldset><legend>{t('Close matching tabs', '關閉配對分頁')}</legend><label><input type="checkbox" checked={includePinned} onChange={event => setIncludePinned(event.target.checked)} />{t('Include pinned tabs', '包括已固定分頁')}</label><button type="button" onClick={() => setBulk('contains')}>{t('Close tabs containing text', '關閉包含文字嘅分頁')}</button><button type="button" onClick={() => setBulk('not-contains')}>{t('Close tabs not containing text', '關閉不包含文字嘅分頁')}</button>{bulk && <div><p>{query ? t(`${affected.length} tabs will close. Saved settings and trips remain.`, `將關閉 ${affected.length} 個分頁；設定同行程會保留。`) : t('Enter text or a valid expression above first.', '請先於上面輸入文字或有效規則。')}</p><button type="button" disabled={!affected.length || !!match.error || match.busy} onClick={() => { save(applyBulkClose(state, { affected, skipped: [], scope: 'strip' })); setBulk(null); }}>{t('Confirm close', '確認關閉')}</button><button type="button" onClick={() => setBulk(null)}>{t('Cancel', '取消')}</button></div>}</fieldset>
      <details><summary>{t('Tab groups', '分頁群組')}</summary><SearchWorkbench storageId={`tabs-groups-${surface}`} label={t('Find groups', '搜尋群組')} value={groupFind} onChange={setGroupFind} samples={groups.map(group => group.name)} t={t} /><label>{t('New group name', '新群組名稱')}<input maxLength={80} value={groupName} onChange={event => setGroupName(event.target.value)} /></label><button type="button" disabled={!groupName.trim()} onClick={() => { save(createGroup(state, { id: 'group-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9), name: groupName.trim(), members: [active] })); setGroupName(''); }}>{t('Create group with active tab', '以目前分頁建立群組')}</button>{groups.map((group, index) => groupMatches.matches[index] && <GroupTools key={group.id} group={group} state={state} tabs={tabs} save={save} t={t} activate={activate} index={index} />)}</details>
      <details><summary>{t('Find across all mounted tab strips', '搜尋所有已開啟分頁列')}</summary><SearchWorkbench storageId={`tabs-master-${surface}`} label={t('Find any tab', '搜尋任何分頁')} value={masterFind} onChange={setMasterFind} samples={allTabs.map(tab => `${tab.label} ${tab.surface}`)} t={t} />{allTabs.map((tab, index) => masterMatches.matches[index] && <button type="button" key={`${tab.surface}:${tab.id}`} onClick={() => { window.dispatchEvent(new CustomEvent('gtha-open-tab', { detail: tab })); popup.current?.hidePopover(); }}>{tab.label} <small>{tab.surface}</small></button>)}</details>
      {stored.unavailable && <p role="status">{t('Tab changes could not be saved on this browser.', '此瀏覽器未能儲存分頁變更。')}</p>}
      {notice && <p role="status">{notice}</p>}
    </div>
    <div ref={menu} popover="auto" className="tab-strip__popup tab-strip__menu"><h3>{tabs.find(tab => tab.id === menuTab)?.label}</h3>{menuTab && <><button type="button" onClick={() => save(state.pinned.includes(menuTab) ? unpin(state, menuTab) : pin(state, menuTab))}>{state.pinned.includes(menuTab) ? t('Unpin tab', '取消固定分頁') : t('Pin tab', '固定分頁')}</button><button type="button" disabled={state.pinned.includes(menuTab)} onClick={() => { save(close(state, menuTab)); menu.current?.hidePopover(); }}>{t('Close tab', '關閉分頁')}</button><button type="button" onClick={() => save(moveRelative(state, menuTab, -1))}>{t('Move earlier', '向前移')}</button><button type="button" onClick={() => save(moveRelative(state, menuTab, 1))}>{t('Move later', '向後移')}</button><button type="button" onClick={() => { editAppearance(menuTab); menu.current?.hidePopover(); }}>{t('Edit tab appearance', '編輯分頁外觀')}</button><button type="button" onClick={() => { menu.current?.hidePopover(); popup.current?.showPopover(); }}>{t('Find, group or bulk-close tabs', '搜尋、分組或批量關閉分頁')}</button><GroupPicker state={state} tabId={menuTab} save={save} t={t} /></>}</div>
  </div>;
}

function GroupPicker({ state, tabId, save, t }: { state: TabStripState; tabId: string; save: (state: TabStripState) => void; t: Props['t'] }) {
  const [search, setSearch] = useState(emptySearchState);
  const matches = useSearchMatches(state.groups.map(group => group.name), search);
  return <details><summary>{t('Move into group', '移入群組')}</summary><SearchWorkbench storageId={`tabs-move-group-${state.surface}`} label={t('Choose a group', '選擇群組')} value={search} onChange={setSearch} samples={state.groups.map(group => group.name)} t={t} /><button type="button" onClick={() => save(moveIntoGroup(state, tabId, null))}>{t('Ungrouped', '不分組')}</button>{state.groups.map((group, index) => matches.matches[index] && <button type="button" key={group.id} onClick={() => save(moveIntoGroup(state, tabId, group.id))}>{group.name}</button>)}</details>;
}

function GroupTools({ group, state, tabs, save, t, activate, index }: { group: TabStripState['groups'][number]; state: TabStripState; tabs: Tab[]; save: (state: TabStripState) => void; t: Props['t']; activate: (id: string) => void; index: number }) {
  const [search, setSearch] = useState(emptySearchState);
  const members = tabs.filter(tab => group.members.includes(tab.id));
  const matches = useSearchMatches(members.map(tab => tab.label), search);
  return <fieldset data-ui={`tab-group:${state.surface}:${group.id}`}><legend>{group.name}</legend><label>{t('Group name', '群組名稱')}<input maxLength={80} value={group.name} onChange={event => save(renameGroup(state, group.id, event.target.value))} /></label><label>{t('Group colour', '群組顏色')}<input type="color" value={group.colour || '#476b50'} onChange={event => save(recolourGroup(state, group.id, event.target.value))} /></label><label><input type="checkbox" checked={group.collapsed} onChange={event => save(collapseGroup(state, group.id, event.target.checked))} />{t('Collapse group', '收起群組')}</label><button type="button" onClick={() => save(pinGroup(state, group.id))}>{t('Pin group', '固定群組')}</button><button type="button" onClick={() => save(reorderGroup(state, group.id, Math.max(0, index - 1)))}>{t('Move group earlier', '群組向前移')}</button><button type="button" onClick={() => save(removeGroup(state, group.id, { keepMembers: true }))}>{t('Ungroup without closing tabs', '取消分組並保留分頁')}</button><SearchWorkbench storageId={`tabs-group-${group.id}`} label={t('Find tabs in this group', '搜尋此群組分頁')} value={search} onChange={setSearch} samples={members.map(tab => tab.label)} t={t} />{members.map((tab, i) => matches.matches[i] && <button type="button" key={tab.id} onClick={() => activate(tab.id)}>{tab.label}</button>)}</fieldset>;
}
