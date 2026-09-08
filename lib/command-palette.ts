/**
 * The command palette's logic, with no React in it.
 *
 * The palette is one list built from three sources -- every destination, every
 * setting, and the handful of things that are actions rather than values -- and
 * the point of assembling it here is that none of those three can be a second
 * copy of a list that already exists. Destinations come from the destinations
 * registry the navigation renders; settings come from the catalog the settings
 * workspace renders. If a surface gains a control, the palette gains it in the
 * same edit or not at all.
 *
 * Searching is deliberately dull: plain text is the default, the regex builder
 * is an explicit opt-in, and the matching itself is the same code every other
 * search bar in the planner uses. A palette with its own private matcher would
 * answer differently from the search bar six inches away from it.
 */

import type { SettingsEntry, SettingsSection, Translate } from './settings-catalog';
import type { WorkspaceDestination } from './destinations';

export type PaletteKind = 'destination' | 'setting' | 'action';

export type PaletteEntry = {
  /** Unique across the whole palette, so a row's key cannot collide across kinds. */
  id: string;
  kind: PaletteKind;
  label: string;
  description: string;
  /** The current value in words, when the entry has one. */
  value?: string;
  /** The destination this row lands on. */
  tab: string;
  /** The exact element within that destination, when the row targets one. */
  selector?: string;
  /** Extra words a person might search by that the label does not contain. */
  keywords?: string;
  /** The live control to render inline, for settings that have one. */
  setting?: SettingsEntry;
  /** What an action row does. Actions never teleport. */
  run?: () => void;
  /** Why this row cannot be operated right now, if it cannot. */
  unavailable?: string;
  glyph: string;
};

export type PaletteAction = {
  id: string;
  label: string;
  description: string;
  glyph: string;
  /** Where the equivalent control lives, so the row can say where the change is visible. */
  tab: string;
  run: () => void;
};

export const PALETTE_SIZES = ['card', 'full'] as const;
export type PaletteSize = (typeof PALETTE_SIZES)[number];

/** The bounded card is the shipped default; the full window is a deliberate choice. */
export const SHIPPED_PALETTE_SIZE: PaletteSize = 'card';

export const PALETTE_SIZE_KEY = 'gtha-command-palette-size-v1';

export function normalizePaletteSize(value: unknown): PaletteSize {
  return value === 'full' ? 'full' : SHIPPED_PALETTE_SIZE;
}

/**
 * Is this keystroke the palette's?
 *
 * Ctrl+Shift+F on Windows and Linux, and the platform's own equivalent on a Mac,
 * where Ctrl+Shift+F is not a chord anybody reaches for. `event.key` is compared
 * case-insensitively because Shift makes it an uppercase F, and `code` is
 * accepted as well so a non-Latin keyboard layout can still reach it.
 */
export function isPaletteShortcut(event: { key?: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }): boolean {
  if (!event.shiftKey || event.altKey) return false;
  const modifier = event.metaKey || event.ctrlKey;
  if (!modifier) return false;
  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  return key === 'f' || event.code === 'KeyF';
}

/**
 * The searchable text for one row.
 *
 * Everything visible on the row goes in, so searching for what you can see
 * works, plus the keywords for the words a person uses that the interface does
 * not -- somebody looking for "dark mode" should not have to know we call it a
 * colour theme.
 */
export function paletteSample(entry: PaletteEntry): string {
  return [entry.label, entry.description, entry.value, entry.keywords, entry.id, entry.kind].filter(Boolean).join(' ');
}

export function paletteSamples(entries: readonly PaletteEntry[]): string[] {
  return entries.map(paletteSample);
}

/** The section a setting belongs to, used to say where a teleport will land. */
export function sectionLabel(section: SettingsSection, t: Translate): string {
  if (section === 'appearance') return t('Appearance', '外觀');
  if (section === 'language') return t('Language', '語言');
  if (section === 'narrator') return t('Narrator', '旁白');
  return t('Privacy', '私隱');
}

/**
 * A glyph per settings section, so a row is scannable rather than a wall of text.
 *
 * Every name here has to be one the shipped icon font actually carries. The font
 * is subset at vendoring time to an explicit list, and a ligature font answers a
 * name it does not have by rendering the English word at icon size -- which looks
 * like unfinished copy rather than a missing glyph, and never throws. A padlock
 * would suit privacy better than a tick; the subset has no padlock, so this uses
 * what ships and the palette's own test checks each name against the binary.
 */
export function sectionGlyph(section: SettingsSection): string {
  if (section === 'appearance') return 'tune';
  if (section === 'language') return 'translate';
  if (section === 'narrator') return 'volume_up';
  return 'check_circle';
}

export type PaletteInput = {
  t: Translate;
  destinations: readonly WorkspaceDestination[];
  settings: readonly SettingsEntry[];
  actions: readonly PaletteAction[];
};

/**
 * Every row the palette can show, destinations first.
 *
 * Destinations lead because moving somewhere is the commonest reason to open a
 * palette, and because a settings row that changes a value in place is the more
 * surprising of the two -- better met after the familiar thing.
 */
export function paletteEntries(input: PaletteInput): PaletteEntry[] {
  const { t, destinations, settings, actions } = input;
  const rows: PaletteEntry[] = [];

  for (const destination of destinations) {
    rows.push({
      id: 'destination:' + destination.id,
      kind: 'destination',
      label: destination.label,
      description: destination.heading,
      tab: destination.id,
      glyph: destination.glyph,
      keywords: destination.id,
    });
  }

  for (const setting of settings) {
    rows.push({
      id: 'setting:' + setting.id,
      kind: 'setting',
      label: setting.label,
      description: setting.description,
      value: setting.value,
      tab: 'settings',
      selector: setting.selector,
      glyph: sectionGlyph(setting.section),
      keywords: [sectionLabel(setting.section, t), settingKeywords(setting.id, t)].filter(Boolean).join(' '),
      setting,
      unavailable: setting.unavailable,
    });
  }

  for (const action of actions) {
    rows.push({
      id: 'action:' + action.id,
      kind: 'action',
      label: action.label,
      description: action.description,
      tab: action.tab,
      glyph: action.glyph,
      run: action.run,
    });
  }

  return rows;
}

/**
 * The words people actually type for a setting, which are rarely its label.
 *
 * Kept beside the palette rather than in the catalog because they are a search
 * concern: the settings surface shows the label, and nobody needs "dark mode"
 * printed under "Colour theme" there.
 */
export function settingKeywords(id: string, t: Translate): string {
  const map: Record<string, string> = {
    theme: t('dark mode light mode night day appearance contrast', '深色模式 淺色模式 夜間 日間 外觀'),
    language: t('english cantonese chinese bilingual translate', '英文 廣東話 中文 雙語 翻譯'),
    'english-tone': t('humour humor funny serious playful tone voice wording', '幽默 有趣 認真 語氣 用詞'),
    'cantonese-tone': t('humour humor funny serious playful tone voice wording', '幽默 有趣 認真 語氣 用詞'),
    narration: t('speak speech voice talk announce tts read aloud', '朗讀 語音 講嘢 報站'),
    'narration-language': t('speak speech voice language', '朗讀 語音 語言'),
    'english-voice': t('speech synthesis voice picker', '語音合成 語音選擇'),
    'cantonese-voice': t('speech synthesis voice picker', '語音合成 語音選擇'),
    rate: t('speed fast slow tempo', '速度 快 慢'),
    pitch: t('tone high low', '音調 高 低'),
    quiet: t('mute silence screen reader', '靜音 讀屏'),
    preview: t('sample hear test listen', '試聽 樣本'),
    'local-data': t('privacy storage tracking analytics account', '私隱 儲存 追蹤 分析 帳戶'),
    'shared-links': t('share link url send', '分享 連結 網址'),
    reliability: t('accuracy official source trust', '準確 官方 來源'),
  };
  return map[id] ?? '';
}

/** The three things that are actions rather than values. */
export function workspaceActions(input: {
  t: Translate;
  dark: boolean;
  setDark: (value: boolean) => void;
  setFunEn: (value: number) => void;
  setFunZh: (value: number) => void;
}): PaletteAction[] {
  const { t, dark, setDark, setFunEn, setFunZh } = input;
  return [
    {
      id: 'toggle-theme',
      label: dark ? t('Switch to the light theme', '切換至淺色主題') : t('Switch to the dark theme', '切換至深色主題'),
      description: t('Change the appearance without opening settings', '毋須開設定就轉換外觀'),
      glyph: dark ? 'light_mode' : 'dark_mode',
      tab: 'settings',
      run: () => setDark(!dark),
    },
    {
      id: 'reset-english-tone',
      label: t('Reset English playfulness to 5', '將英文趣味程度重設為 5'),
      description: t('Return the English tone to the level it ships at', '將英文語氣還原至預設級數'),
      glyph: 'refresh',
      tab: 'settings',
      run: () => setFunEn(5),
    },
    {
      id: 'reset-cantonese-tone',
      label: t('Reset Cantonese playfulness to 5', '將廣東話趣味程度重設為 5'),
      description: t('Return the Cantonese tone to the level it ships at', '將廣東話語氣還原至預設級數'),
      glyph: 'refresh',
      tab: 'settings',
      run: () => setFunZh(5),
    },
  ];
}

export type PaletteGroup = { kind: PaletteKind; label: string; entries: PaletteEntry[] };

/**
 * Rows grouped for rendering, in a fixed order, with empty groups dropped.
 *
 * An empty group heading is worse than no heading: it reads as a category that
 * failed to load rather than as one nothing matched.
 */
export function paletteGroups(entries: readonly PaletteEntry[], t: Translate): PaletteGroup[] {
  const order: PaletteKind[] = ['destination', 'setting', 'action'];
  const labels: Record<PaletteKind, string> = {
    destination: t('Go to', '前往'),
    setting: t('Settings', '設定'),
    action: t('Actions', '操作'),
  };
  return order
    .map((kind) => ({ kind, label: labels[kind], entries: entries.filter((entry) => entry.kind === kind) }))
    .filter((group) => group.entries.length > 0);
}

/**
 * Where the arrow keys move to.
 *
 * It wraps, because a list that stops at the end makes somebody travel back
 * through it to reach the first row, and the palette is short enough that
 * wrapping never disorients.
 */
export function movePaletteFocus(current: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}
