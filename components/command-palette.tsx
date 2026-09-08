'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Icon } from './icon';
import { SearchWorkbench, emptySearchState, useSearchMatches, type SearchState } from './search-workbench';
import { useLocalSetting } from '../lib/use-local-setting';
import { SETTINGS_SECTION_KEY, type SettingsEntry } from '../lib/settings-catalog';
import type { WorkspaceDestination } from '../lib/destinations';
import {
  PALETTE_SIZE_KEY,
  isPaletteShortcut,
  movePaletteFocus,
  normalizePaletteSize,
  paletteEntries,
  paletteGroups,
  paletteSamples,
  type PaletteAction,
  type PaletteEntry,
} from '../lib/command-palette';

type Translate = (en: string, zh: string) => string;

/**
 * How many options a choice can have before the palette stops mirroring it.
 *
 * Two or three options fit a row as segmented buttons, which are operable with
 * one key press and need no popup. An installed-voice list can be forty, and a
 * forty-item dropdown inside a palette row would need its own search field and
 * regex builder to meet this project's own contract for a dropdown. Rather than
 * ship a dropdown that quietly does not, a long choice keeps its full control on
 * the settings surface and this row says so and takes you there.
 */
const INLINE_CHOICE_LIMIT = 4;

/** How long the landing outline stays on the element a teleport arrived at. */
const LANDING_MS = 1800;

export type CommandPaletteProps = {
  t: Translate;
  destinations: readonly WorkspaceDestination[];
  settings: readonly SettingsEntry[];
  actions: readonly PaletteAction[];
  /** Move the workspace to a destination. */
  onNavigate: (tab: string) => void;
};

/**
 * The Ctrl+Shift+F command palette.
 *
 * It searches every destination, every setting and the few things that are
 * actions, and a row does one of two things: it changes the value in place
 * through the control the settings surface itself would have used, or it takes
 * you to the exact element and puts the focus on it. Landing on the page that
 * contains a control and leaving somebody to find it is not what this is for.
 *
 * Rows are traversed with the arrow keys and entered with Tab, so a row's own
 * control is reached deliberately rather than trapping the keyboard on every
 * row between here and the one you wanted.
 */
export default function CommandPalette({ t, destinations, settings, actions, onNavigate }: CommandPaletteProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const landing = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState<SearchState>(emptySearchState);
  const [active, setActive] = useState(0);
  const baseId = useId().replaceAll(':', '');
  const storedSize = useLocalSetting(PALETTE_SIZE_KEY);
  const storedSection = useLocalSetting(SETTINGS_SECTION_KEY);
  const size = normalizePaletteSize(storedSize.value);

  const entries = useMemo(
    () => paletteEntries({ t, destinations, settings, actions }),
    [t, destinations, settings, actions],
  );
  const samples = useMemo(() => paletteSamples(entries), [entries]);
  const result = useSearchMatches(samples, search);
  const query = (search.mode === 'regex' ? search.pattern : search.query).trim();
  const matched = useMemo(
    () => (query.length === 0 ? entries : entries.filter((_, index) => result.matches[index])),
    [entries, query, result.matches],
  );
  const groups = useMemo(() => paletteGroups(matched, t), [matched, t]);
  /** The flat order the arrow keys walk, which is the order the groups render. */
  const ordered = useMemo(() => groups.flatMap((group) => group.entries), [groups]);

  const close = useCallback(() => {
    dialog.current?.close();
  }, []);

  /** Open, remembering where the focus came from so Escape can put it back. */
  const show = useCallback(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActive(0);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      if (dialog.current?.open) close();
      else show();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, show]);

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    const frame = window.requestAnimationFrame(() => {
      surface.current?.querySelector<HTMLInputElement>('input[type="search"], input[type="text"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => () => { if (landing.current) window.clearTimeout(landing.current); }, []);

  /** Keep the highlighted row inside the list as the arrows move it. */
  useEffect(() => {
    if (!open) return;
    const row = list.current?.querySelector<HTMLElement>(`[data-palette-index="${active}"] .palette-row__go`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  /** A new query re-aims at the first result rather than leaving focus past the end. */
  useEffect(() => { setActive(0); }, [query]);

  /**
   * Put the focus on the exact element, having opened whatever is folded over it.
   *
   * Two frames, not one: the destination has to render before its controls exist,
   * and a settings section has to react to the stored section changing. Scrolling
   * is instant because the reduced-motion preference is a request not to animate,
   * and this is a jump rather than a journey.
   */
  const reveal = useCallback((selector: string) => {
    const land = () => {
      const target = document.querySelector<HTMLElement>(selector);
      if (!target) return;
      let ancestor = target.parentElement;
      while (ancestor) {
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
        ancestor = ancestor.parentElement;
      }
      const disabled = target.matches(':disabled');
      const focusTarget = disabled
        ? target.closest<HTMLElement>('fieldset') ?? target.closest<HTMLElement>('.narrator-card') ?? target
        : target;
      if (!focusTarget.hasAttribute('tabindex') && disabled) focusTarget.tabIndex = -1;
      focusTarget.scrollIntoView({ block: 'center', behavior: 'instant' });
      focusTarget.focus({ preventScroll: true });
      focusTarget.classList.add('palette-landed');
      if (landing.current) window.clearTimeout(landing.current);
      landing.current = window.setTimeout(() => focusTarget.classList.remove('palette-landed'), LANDING_MS);
    };
    window.requestAnimationFrame(() => window.requestAnimationFrame(land));
  }, []);

  /**
   * What Enter, or a click on the row, does.
   *
   * An action runs and the palette stays open, because an action changes
   * something you can see from here and you may well want another. Anything with
   * a target closes and takes you to it, because staying would leave the palette
   * covering the thing you asked to see.
   */
  const activate = (entry: PaletteEntry) => {
    if (entry.run) {
      entry.run();
      return;
    }
    close();
    onNavigate(entry.tab);
    if (entry.setting) storedSection.setValue(entry.setting.section);
    if (entry.selector) reveal(entry.selector);
  };

  /**
   * Escape closes the palette, which a native dialog does not manage on its own here.
   *
   * `showModal` gives a dialog Escape for free, and it was not working: the palette
   * puts the focus in the search field on open, and Chromium treats Escape on an
   * `input[type="search"]` as "clear this field" and consumes the key. So the very
   * first Escape anybody pressed did nothing at all, which the unit suite could
   * never have seen -- it was found by pressing the key in a real browser.
   *
   * An inner handler that already dealt with Escape wins, so the regex builder's
   * popover still closes first and leaves the palette open behind it.
   */
  const onSurfaceKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    close();
  };

  const onListKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => movePaletteFocus(current, event.key === 'ArrowDown' ? 1 : -1, ordered.length));
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActive(event.key === 'Home' ? 0 : Math.max(0, ordered.length - 1));
    }
  };

  const status = result.error
    ? t('This expression could not be evaluated. Edit it or choose plain text.', '未能配對此規則，請修改或選擇純文字。')
    : result.busy
      ? t('Searching…', '搜尋緊…')
      : query.length === 0
        ? t('Everything you can go to, change or run.', '所有可以前往、更改或執行嘅項目。')
        : ordered.length === 0
          ? t('Nothing matched. Try a destination, a setting or a word like dark, voice or share.', '冇符合項目。試下目的地、設定，或者深色、語音、分享等字眼。')
          : ordered.length === 1
            ? t('1 result', '1 個結果')
            : t(`${ordered.length} results`, `${ordered.length} 個結果`);

  return (
    <dialog
      ref={dialog}
      className={`palette palette--${size}`}
      aria-label={t('Command palette', '指令面板')}
      onClose={() => {
        setOpen(false);
        returnFocus.current?.focus();
      }}
      onCancel={() => setOpen(false)}
    >
      <div className="palette__surface" ref={surface} onKeyDown={onSurfaceKey}>
        <div className="palette__head">
          <h2 className="palette__title">
            <Icon name="search" size={20} />
            {t('Find anything', '搵任何嘢')}
          </h2>
          <div className="palette__tools">
            <fieldset className="palette__size" aria-label={t('Palette size', '面板大小')}>
              <button
                type="button"
                aria-pressed={size === 'card'}
                onClick={() => storedSize.setValue('card')}
              >
                {t('Card', '卡片')}
              </button>
              <button
                type="button"
                aria-pressed={size === 'full'}
                onClick={() => storedSize.setValue('full')}
              >
                {t('Full window', '全視窗')}
              </button>
            </fieldset>
            <button type="button" className="palette__close" onClick={close} aria-label={t('Close', '關閉')}>
              <Icon name="close" size={20} />
            </button>
          </div>
        </div>

        {storedSize.unavailable && (
          <output className="palette__notice">
            {t('Your palette size could not be saved. It still works for this visit.', '未能儲存面板大小，今次使用仍然有效。')}
          </output>
        )}

        <SearchWorkbench
          storageId="command-palette-search"
          label={t('Find anything', '搵任何嘢')}
          value={search}
          onChange={setSearch}
          samples={samples}
          t={t}
        />

        <output className="palette__status" aria-live="polite">{status}</output>

        <div className="palette__list" ref={list} onKeyDown={onListKey}>
          {groups.map((group) => (
            <section key={group.kind} className="palette__group" aria-label={group.label}>
              <h3 className="palette__group-label">{group.label}</h3>
              <ul>
                {group.entries.map((entry) => {
                  const index = ordered.indexOf(entry);
                  return (
                    <li key={entry.id} className="palette-row" data-palette-index={index}>
                      <button
                        type="button"
                        className="palette-row__go"
                        tabIndex={index === active ? 0 : -1}
                        onFocus={() => setActive(index)}
                        onClick={() => activate(entry)}
                      >
                        <Icon name={entry.glyph} size={22} />
                        <span className="palette-row__text">
                          <strong>{entry.label}</strong>
                          <small>{entry.description}</small>
                        </span>
                        {entry.value && <span className="palette-row__value">{entry.value}</span>}
                        <Icon name={entry.run ? 'refresh' : 'chevron_right'} size={18} />
                      </button>
                      <PaletteRowControl entry={entry} idPrefix={`${baseId}-${entry.id.replace(/[^a-z0-9-]/gi, '-')}`} t={t} />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <p className="palette__foot">
          {t(
            'Ctrl+Shift+F opens this anywhere. Arrow keys move between rows, Tab reaches a row control, Enter goes, Escape closes.',
            'Ctrl+Shift+F 隨時開啟。方向鍵揀行，Tab 入去該行嘅控制項，Enter 前往，Esc 關閉。',
          )}
        </p>
      </div>
    </dialog>
  );
}

/**
 * The live control for a row, when the row has one worth showing here.
 *
 * These are the settings surface's own setters, so a change made here is the
 * same change made there: same validation, same persistence, same history. A
 * row that cannot carry its control says why rather than showing nothing.
 */
function PaletteRowControl({ entry, idPrefix, t }: { entry: PaletteEntry; idPrefix: string; t: Translate }) {
  const setting = entry.setting;
  if (!setting) return null;
  const control = setting.control;
  const blocked = setting.unavailable;

  if (control.kind === 'none') {
    return <p className="palette-row__note">{blocked || control.reason}</p>;
  }

  if (blocked) {
    return <p className="palette-row__note">{blocked}</p>;
  }

  if (control.kind === 'switch') {
    return (
      <div className="palette-row__control">
        <input
          id={`${idPrefix}-switch`}
          type="checkbox"
          role="switch"
          checked={control.value}
          onChange={(event) => control.apply(event.target.checked)}
        />
        <label htmlFor={`${idPrefix}-switch`}>{setting.label}</label>
      </div>
    );
  }

  if (control.kind === 'range') {
    return (
      <div className="palette-row__control">
        <label htmlFor={`${idPrefix}-range`}>{setting.label}</label>
        <input
          id={`${idPrefix}-range`}
          type="range"
          min={control.min}
          max={control.max}
          step={control.step}
          value={control.value}
          onChange={(event) => control.apply(Number(event.target.value))}
        />
        <output htmlFor={`${idPrefix}-range`}>{control.value}</output>
      </div>
    );
  }

  if (control.choices.length > INLINE_CHOICE_LIMIT) {
    return (
      <p className="palette-row__note">
        {t(
          'This list is long enough to need its own searchable picker, which is on the settings surface. Open the row to reach it.',
          '呢個清單太長，需要自己嘅搜尋選擇器，喺設定頁度。㩒入去就到。',
        )}
      </p>
    );
  }

  return (
    <fieldset className="palette-row__control palette-row__choices" aria-label={setting.label}>
      {control.choices.map((choice) => (
        <label key={choice.value || 'automatic'}>
          <input
            type="radio"
            name={`${idPrefix}-choice`}
            checked={control.value === choice.value}
            onChange={() => control.apply(choice.value)}
          />
          <span>{choice.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
