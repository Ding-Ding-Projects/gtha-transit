'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import AnchoredPopover from './anchored-popover.tsx';
import { SearchWorkbench, emptySearchState, useSearchMatches, type SearchState } from '../search-workbench.tsx';
import { filterMenuItems, menuKeyboard, type MenuItem } from '../../lib/appearance/context-menu.ts';
import { formatShortcut } from '../../lib/appearance/shortcuts.ts';

export type Translate = (en: string, zh: string) => string;

export type ContextMenuTarget = { id: string; label: { en: string; zh: string } };

export type ContextMenuProps = {
  items: readonly MenuItem[];
  target: ContextMenuTarget;
  open: boolean;
  /** A concrete point, for a real right-click. Used only when `anchor` is absent. */
  position?: { x: number; y: number };
  /** The element the menu belongs to, for a keyboard-triggered open (Shift+F10). Also where focus returns on close. */
  anchor?: RefObject<HTMLElement | null>;
  onClose: () => void;
  storageId: string;
  t: Translate;
};

/**
 * The appearance system's right-click menu: the same five universal rows plus
 * whatever a caller supplied, filtered by a search field that carries this
 * project's own regex builder, and fully keyboard-operable.
 *
 * `position` and `anchor` answer two different questions and only one is ever
 * needed at a time. A real right-click has a pointer position but often no
 * single element worth returning focus to that is more specific than wherever
 * focus already was -- right-clicking does not itself move focus in most
 * browsers, so leaving the synthetic point non-focusable and letting
 * `AnchoredPopover`'s own `.focus()` call quietly no-op is the correct outcome,
 * not a bug: focus simply stays where the right-click found it. Shift+F10 has
 * the opposite shape -- no pointer position, but a definite already-focused
 * element -- so it supplies `anchor` instead, which both places the menu and
 * receives focus back on close.
 */
export default function ContextMenu({ items, target, open, position, anchor, onClose, storageId, t }: ContextMenuProps) {
  const pointRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState<SearchState>(emptySearchState);
  const [activeIndex, setActiveIndex] = useState(-1);

  const labels = useMemo(
    () => items.map((item) => [item.label.en, item.label.zh, item.disabledReason?.en, item.disabledReason?.zh].filter(Boolean).join(' ')),
    [items],
  );
  const result = useSearchMatches(labels, search);
  const query = (search.mode === 'regex' ? search.pattern : search.query).trim();
  const visible = useMemo(
    () => (query.length === 0 ? [...items] : filterMenuItems(items, result.matches)),
    [items, query, result.matches],
  );

  useEffect(() => {
    if (!open) return;
    setSearch(emptySearchState());
    const frame = window.requestAnimationFrame(() => {
      surfaceRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (activeIndex < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-menu-index="${activeIndex}"]`)?.focus({ preventScroll: true });
  }, [activeIndex]);

  /** A new query re-aims the roving tabindex at the first row rather than one that may have scrolled off. */
  useEffect(() => {
    setActiveIndex(visible.length ? 0 : -1);
  }, [query, visible.length]);

  if (!open) return null;

  const effectiveAnchor = anchor ?? pointRef;

  const activate = (item: MenuItem) => {
    if (item.disabled) return;
    item.run();
    onClose();
  };

  /** Escape clears an active filter first; a second, unfiltered Escape bubbles up to `AnchoredPopover` and actually closes. */
  const onSurfaceKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || query.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSearch(emptySearchState());
  };

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActiveIndex((current) => menuKeyboard(current, visible.length, event.key));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      const item = visible[activeIndex];
      if (!item) return;
      event.preventDefault();
      activate(item);
    }
  };

  return (
    <>
      {!anchor && position && (
        // A zero-size, non-focusable point: only a placement anchor for
        // `AnchoredPopover`, never a real element for the DOM tree.
        <span ref={pointRef} aria-hidden="true" style={{ position: 'fixed', top: position.y, left: position.x, width: 0, height: 0, pointerEvents: 'none' }} />
      )}
      <AnchoredPopover id={`${storageId}-menu`} anchor={effectiveAnchor} open={open} onClose={onClose} label={t(`Actions for ${target.label.en}`, `「${target.label.zh}」嘅動作`)} preferred="bottom" t={t}>
        <div className="appearance-context-menu" data-ui="appearance.context.menu" ref={surfaceRef} onKeyDown={onSurfaceKeyDown}>
          <SearchWorkbench storageId={storageId} label={t('Filter actions', '篩選動作')} value={search} onChange={setSearch} samples={labels} t={t} />
          <ul
            role="menu"
            aria-label={t(`Actions for ${target.label.en}`, `「${target.label.zh}」嘅動作`)}
            ref={listRef}
            onKeyDown={onListKeyDown}
            className="appearance-context-menu__list"
          >
            {visible.length === 0 && (
              <li className="appearance-context-menu__empty" role="none">{t('No matching actions', '冇符合嘅動作')}</li>
            )}
            {visible.map((item, index) => (
              <li key={item.id} role="none">
                <button
                  type="button"
                  role="menuitem"
                  data-menu-index={index}
                  tabIndex={index === activeIndex ? 0 : -1}
                  aria-disabled={item.disabled || undefined}
                  data-destructive={item.destructive || undefined}
                  onFocus={() => setActiveIndex(index)}
                  onClick={() => activate(item)}
                >
                  <span className="appearance-context-menu__label">{t(item.label.en, item.label.zh)}</span>
                  {item.shortcutId && <kbd>{formatShortcut(item.shortcutId)}</kbd>}
                </button>
                {item.disabled && item.disabledReason && (
                  <p className="appearance-context-menu__reason">{t(item.disabledReason.en, item.disabledReason.zh)}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      </AnchoredPopover>
    </>
  );
}
