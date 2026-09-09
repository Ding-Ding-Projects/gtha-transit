/**
 * One binding source for the appearance system's keyboard shortcuts.
 *
 * This is deliberately its own small registry rather than an extension of
 * `lib/command-palette.ts`'s `isPaletteShortcut`. That function only ever
 * answers "is this the palette shortcut", and duplicating its shape for six
 * different chords would mean six near-identical predicates instead of one
 * table a settings panel, a context menu and a right-click-menu keyboard hint
 * can all read from. A shortcut shown in a menu and a shortcut that actually
 * fires are two different pieces of code by nature -- one renders text, the
 * other reads a live KeyboardEvent -- and the risk this file exists to remove
 * is those two disagreeing about which chord it was.
 *
 * Every binding matches on `KeyboardEvent.code` (the physical key) as well as
 * `key`, the same reasoning `isPaletteShortcut` documents: a non-Latin keyboard
 * layout reports a different `key` for the same physical key, and `code` still
 * reaches it. The "primary" modifier is Ctrl on Windows and Linux and Cmd on a
 * Mac, accepted as either bit being set rather than encoded per platform --
 * this project's other shortcut already does that, and a second, different
 * convention here would be one more thing to remember.
 */

export type ShortcutId = 'palette' | 'edit-appearance' | 'context-menu' | 'reset-element' | 'copy-style' | 'paste-style';

export type ShortcutBinding = {
  id: ShortcutId;
  /** The physical key, matched against `KeyboardEvent.code`. */
  code: string;
  /** `KeyboardEvent.key`, matched case-insensitively, for a layout that does not report `code` reliably. */
  key: string;
  /** Ctrl on Windows/Linux, Cmd on a Mac -- true when the chord needs either. */
  primary: boolean;
  shift: boolean;
  alt: boolean;
};

type MinimalKeyboardEvent = { key?: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean };

/**
 * The six chords, chosen to be sensible rather than merely available.
 *
 * Copy style and paste style deliberately match the chord Word and PowerPoint
 * already use for "copy formatting" and "paste formatting" -- Ctrl+Shift+C and
 * Ctrl+Shift+V -- because that is the same idea under a different name, and
 * reusing a chord a lot of people already have in their hands beats inventing
 * a new one nobody will remember. Shift+F10 for the context menu is the
 * Windows-standard "open the context menu from the keyboard" chord and carries
 * no Ctrl/Cmd modifier, matching every other application that honours it.
 */
export const SHORTCUTS: Readonly<Record<ShortcutId, ShortcutBinding>> = Object.freeze({
  palette: { id: 'palette', code: 'KeyF', key: 'f', primary: true, shift: true, alt: false },
  'edit-appearance': { id: 'edit-appearance', code: 'KeyE', key: 'e', primary: true, shift: true, alt: false },
  'context-menu': { id: 'context-menu', code: 'F10', key: 'f10', primary: false, shift: true, alt: false },
  'reset-element': { id: 'reset-element', code: 'KeyR', key: 'r', primary: true, shift: true, alt: false },
  'copy-style': { id: 'copy-style', code: 'KeyC', key: 'c', primary: true, shift: true, alt: false },
  'paste-style': { id: 'paste-style', code: 'KeyV', key: 'v', primary: true, shift: true, alt: false },
});

export function shortcutFor(id: ShortcutId): ShortcutBinding {
  return SHORTCUTS[id];
}

const KEY_LABEL: Readonly<Record<string, string>> = { KeyF: 'F', KeyE: 'E', KeyR: 'R', KeyC: 'C', KeyV: 'V', F10: 'F10' };

/** A shortcut in the platform's own written form, for a menu row or a tooltip. */
export function formatShortcut(id: ShortcutId, platform: 'win' | 'mac' = 'win'): string {
  const binding = shortcutFor(id);
  const keyLabel = KEY_LABEL[binding.code] ?? binding.key.toUpperCase();
  if (platform === 'mac') {
    const parts: string[] = [];
    if (binding.primary) parts.push('⌘'); // Cmd
    if (binding.alt) parts.push('⌥'); // Option
    if (binding.shift) parts.push('⇧'); // Shift
    parts.push(keyLabel);
    return parts.join('');
  }
  const parts: string[] = [];
  if (binding.primary) parts.push('Ctrl');
  if (binding.alt) parts.push('Alt');
  if (binding.shift) parts.push('Shift');
  parts.push(keyLabel);
  return parts.join('+');
}

/** Does this keyboard event fire the named shortcut? Matches the physical key as well as `key`. */
export function matchesShortcut(event: MinimalKeyboardEvent, id: ShortcutId): boolean {
  const binding = shortcutFor(id);
  if (Boolean(event.shiftKey) !== binding.shift) return false;
  if (Boolean(event.altKey) !== binding.alt) return false;
  const modifierPressed = Boolean(event.ctrlKey) || Boolean(event.metaKey);
  if (modifierPressed !== binding.primary) return false;
  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  return key === binding.key || (typeof event.code === 'string' && event.code === binding.code);
}
