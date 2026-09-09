/**
 * The context menu's logic, with no React and no DOM in it.
 *
 * Every element the appearance system can edit shows the same five rows on its
 * right-click menu -- edit appearance, copy style, paste style, reset this
 * element, history -- plus whatever a later feature registers through
 * `registerContextExtension`. Building that list here, once, is what lets a
 * lock-this-element feature (or any later addition) join every menu in the
 * project by registering a provider rather than by editing every call site
 * that currently builds a menu by hand.
 */

import type { ShortcutId } from './shortcuts.ts';

export type MenuItem = {
  id: string;
  label: { en: string; zh: string };
  shortcutId?: ShortcutId;
  disabled?: boolean;
  disabledReason?: { en: string; zh: string };
  destructive?: boolean;
  run: () => void;
};

/** The element a context menu was opened on. Just enough to word its rows. */
export type ContextMenuTarget = { id: string; label: { en: string; zh: string } };

/**
 * Filter a menu's items against a search field's match result, without ever
 * reordering them.
 *
 * `matches` is a parallel boolean array in `items` order, the same shape
 * `useSearchMatches` returns -- or `null`, meaning no filter is active and
 * every item stays. Reordering on top of filtering would make a menu's rows
 * jump around as somebody types, which is the one thing a menu must not do.
 */
export function filterMenuItems(items: readonly MenuItem[], matches: readonly boolean[] | null): MenuItem[] {
  if (matches === null) return [...items];
  return items.filter((_, index) => matches[index] === true);
}

/**
 * Where the arrow keys, Home and End move a menu's roving focus. Wraps at both
 * ends, the same as the command palette's own list, because a five-row menu
 * that stops at the bottom makes somebody walk all the way back up it.
 */
export function menuKeyboard(index: number, count: number, key: string): number {
  if (count <= 0) return -1;
  if (key === 'ArrowDown') return index < 0 ? 0 : (index + 1) % count;
  if (key === 'ArrowUp') return index < 0 ? count - 1 : (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return index;
}

export type UniversalActions = {
  editAppearance?: () => void;
  copyStyle?: () => void;
  pasteStyle?: () => void;
  resetElement?: () => void;
  history?: () => void;
};

const NOT_WIRED = { en: 'This action is not available for this element.', zh: '呢個元素未有呢個功能。' };
const NOTHING_COPIED = { en: 'Copy a style first.', zh: '請先複製樣式。' };
const NO_HISTORY = { en: 'History is not available here.', zh: '呢度未有歷史紀錄。' };

/**
 * The five rows every element's context menu carries. A missing action is not
 * dropped from the menu -- it stays, disabled, with the reason named next to
 * it, so a right-click always shows the same shape of menu and never leaves
 * somebody wondering whether a row is missing by accident.
 */
export function universalItems(target: ContextMenuTarget, actions: UniversalActions): MenuItem[] {
  const noop = () => {};
  return [
    {
      id: 'edit-appearance',
      label: { en: `Edit appearance of ${target.label.en}…`, zh: `編輯「${target.label.zh}」外觀…` },
      shortcutId: 'edit-appearance',
      disabled: !actions.editAppearance,
      disabledReason: actions.editAppearance ? undefined : NOT_WIRED,
      run: actions.editAppearance ?? noop,
    },
    {
      id: 'copy-style',
      label: { en: 'Copy style', zh: '複製樣式' },
      shortcutId: 'copy-style',
      disabled: !actions.copyStyle,
      disabledReason: actions.copyStyle ? undefined : NOT_WIRED,
      run: actions.copyStyle ?? noop,
    },
    {
      id: 'paste-style',
      label: { en: 'Paste style', zh: '貼上樣式' },
      shortcutId: 'paste-style',
      disabled: !actions.pasteStyle,
      disabledReason: actions.pasteStyle ? undefined : NOTHING_COPIED,
      run: actions.pasteStyle ?? noop,
    },
    {
      id: 'reset-element',
      label: { en: `Reset ${target.label.en}`, zh: `重設「${target.label.zh}」` },
      shortcutId: 'reset-element',
      destructive: true,
      disabled: !actions.resetElement,
      disabledReason: actions.resetElement ? undefined : NOT_WIRED,
      run: actions.resetElement ?? noop,
    },
    {
      id: 'history',
      label: { en: 'History…', zh: '歷史紀錄…' },
      disabled: !actions.history,
      disabledReason: actions.history ? undefined : NO_HISTORY,
      run: actions.history ?? noop,
    },
  ];
}

/**
 * The extension point a later feature -- "Lock this element…" is the one this
 * project has already named -- joins without editing every menu call site.
 *
 * A name with no registered provider contributes nothing: `extensionItems`
 * only ever iterates providers that are actually registered, so there is no
 * state in which an unregistered name renders a broken or empty row.
 */
export type ContextExtensionProvider = (target: ContextMenuTarget) => MenuItem[];

const extensions = new Map<string, ContextExtensionProvider>();

export function registerContextExtension(name: string, provider: ContextExtensionProvider): void {
  extensions.set(name, provider);
}

/** Mostly for tests: undo a registration so one test's extension cannot leak into the next. */
export function unregisterContextExtension(name: string): void {
  extensions.delete(name);
}

/** A snapshot of the registry. A copy, so a caller cannot mutate the live registry through it. */
export function contextExtensions(): ReadonlyMap<string, ContextExtensionProvider> {
  return new Map(extensions);
}

/** Every registered extension's rows for this target, in registration order. */
export function extensionItems(target: ContextMenuTarget): MenuItem[] {
  const items: MenuItem[] = [];
  for (const provider of extensions.values()) items.push(...provider(target));
  return items;
}
