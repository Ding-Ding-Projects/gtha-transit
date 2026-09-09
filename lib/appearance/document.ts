/**
 * The appearance system's global document: one record describing how the whole
 * interface is customised, independent of any single element's own overrides.
 *
 * This is deliberately the same shape every reader in this project already
 * knows from `lib/school-mode.ts`: a small `version` field, an explicit
 * `SHIPPED_*` constant naming the untouched defaults, a `serialize*`/`parse*`
 * pair that never throws, and per-field fallback rather than an all-or-nothing
 * rejection. A stored record with one bad field should lose that one field, not
 * the whole customisation somebody spent an afternoon building.
 *
 * `sources` and `recentColours` deliberately treat the animated rainbow choice
 * (`lib/colour.ts`'s `RAINBOW` sentinel) differently. A `sources` entry names
 * the colour behind one specific token override, and the rainbow is a legitimate
 * choice for a token to carry. `recentColours` is swatch history for the picker,
 * and the picker's own contract says the rainbow choice never enters the swatch
 * list -- so a rainbow sentinel that somehow reached storage here is dropped
 * rather than reproduced as a swatch nobody could have picked by clicking it.
 */

import { RAINBOW, parseColour } from '../colour.ts';

export type UiState = 'normal' | 'hover' | 'focus' | 'pressed' | 'selected' | 'disabled' | 'error';

export const UI_STATES: readonly UiState[] = ['normal', 'hover', 'focus', 'pressed', 'selected', 'disabled', 'error'];

export type AppearanceMode = 'shipped' | 'seed' | 'advanced';

const MODES: readonly AppearanceMode[] = ['shipped', 'seed', 'advanced'];

export type Density = 'compact' | 'default' | 'comfortable';

const DENSITIES: readonly Density[] = ['compact', 'default', 'comfortable'];

export type WeightShift = -1 | 0 | 1;

const WEIGHT_SHIFTS: readonly WeightShift[] = [-1, 0, 1];

export type RainbowLevel = 1 | 2 | 3 | 4 | 5;

const RAINBOW_LEVELS_HERE: readonly RainbowLevel[] = [1, 2, 3, 4, 5];

/**
 * Bounds shared across the appearance system.
 *
 * `MAX_ELEMENTS` and `MAX_SHEET_BYTES` describe the per-element override
 * document and the generated stylesheet, neither of which this file builds --
 * they live here so the lane that does build them shares one set of numbers
 * with the rest of the system rather than inventing its own. `MAX_LAYERS` is
 * used below, for the same reason `sources` exists: a "layer" here is one
 * token's overridden source colour, and 64 of them is already an extravagant
 * amount of manual per-token tuning for one seed.
 */
export const MAX_ELEMENTS = 400;
export const MAX_LAYERS = 64;
export const MAX_SHEET_BYTES = 262144;
export const MAX_APP_NAME = 40;
export const MAX_RECENT = 16;

export type AppearanceGlobal = {
  version: 1;
  mode: AppearanceMode;
  seed: string | null;
  sources: Record<string, string> | null;
  density: Density;
  sizeScale: number;
  weightShift: WeightShift;
  fontFamily: string | null;
  monoFamily: string | null;
  appName: string | null;
  showEmoji: boolean;
  rainbowLevel: RainbowLevel;
  activePresetId: string | null;
  recentColours: string[];
};

const SIZE_SCALE_MIN = 0.8;
const SIZE_SCALE_MAX = 1.5;
const MAX_TOKEN_NAME = 100;
const MAX_FONT_NAME = 200;
const MAX_PRESET_ID = 100;

export const GLOBAL_KEY = 'gtha-appearance-v1';

export const SHIPPED_GLOBAL: AppearanceGlobal = Object.freeze({
  version: 1,
  mode: 'shipped',
  seed: null,
  sources: null,
  density: 'default',
  sizeScale: 1,
  weightShift: 0,
  fontFamily: null,
  monoFamily: null,
  appName: null,
  showEmoji: true,
  rainbowLevel: 3,
  activePresetId: null,
  recentColours: [],
}) as AppearanceGlobal;

const clampNumber = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

function readMode(value: unknown): AppearanceMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value) ? (value as AppearanceMode) : SHIPPED_GLOBAL.mode;
}

function readDensity(value: unknown): Density {
  return typeof value === 'string' && (DENSITIES as readonly string[]).includes(value) ? (value as Density) : SHIPPED_GLOBAL.density;
}

function readSizeScale(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? clampNumber(value, SIZE_SCALE_MIN, SIZE_SCALE_MAX) : SHIPPED_GLOBAL.sizeScale;
}

function readWeightShift(value: unknown): WeightShift {
  return typeof value === 'number' && (WEIGHT_SHIFTS as readonly number[]).includes(value) ? (value as WeightShift) : SHIPPED_GLOBAL.weightShift;
}

function readRainbowLevel(value: unknown): RainbowLevel {
  return typeof value === 'number' && (RAINBOW_LEVELS_HERE as readonly number[]).includes(value) ? (value as RainbowLevel) : SHIPPED_GLOBAL.rainbowLevel;
}

/** A bounded, trimmed string, or null when the input is not a usable string. */
function readBoundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** A colour this project's own parser accepts, or null. Never the rainbow sentinel. */
function readStoredColour(value: unknown): string | null {
  return typeof value === 'string' && parseColour(value) !== null ? value : null;
}

/** A colour, or the rainbow sentinel, or null. Used for per-token sources, which may legitimately animate. */
function readColourOrRainbow(value: unknown): string | null {
  if (value === RAINBOW) return RAINBOW;
  return readStoredColour(value);
}

function readSources(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries: [string, string][] = [];
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (entries.length >= MAX_LAYERS) break;
    const name = key.trim().slice(0, MAX_TOKEN_NAME);
    const colour = readColourOrRainbow(raw);
    if (!name || colour === null) continue;
    entries.push([name, colour]);
  }
  return entries.length ? Object.fromEntries(entries) : null;
}

function readRecentColours(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (out.length >= MAX_RECENT) break;
    const colour = readStoredColour(item);
    if (colour !== null) out.push(colour);
  }
  return out;
}

/**
 * The migration seam.
 *
 * Version 1 is the only shape this project has ever shipped, so this is the
 * identity function today. A later version's migration hangs here, run before
 * `parseGlobal` looks at `version`, rather than growing as an ever-widening
 * chain of special cases inline below.
 */
export function migrate(document: unknown): unknown {
  return document;
}

export function serializeGlobal(global: AppearanceGlobal): string {
  return JSON.stringify({ ...global, version: 1 });
}

/**
 * Restore a global appearance document.
 *
 * Unknown fields are dropped because the result is built field by field rather
 * than spread from the parsed input. An invalid value for one field falls back
 * to that field's shipped default rather than discarding the rest of the
 * record; only a missing or wrong `version` discards everything, because at
 * that point there is no declared shape left to trust piece by piece.
 */
export function parseGlobal(text: string | null | undefined): AppearanceGlobal {
  if (!text) return SHIPPED_GLOBAL;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return SHIPPED_GLOBAL;
  }
  const migrated = migrate(parsed);
  if (!migrated || typeof migrated !== 'object' || Array.isArray(migrated)) return SHIPPED_GLOBAL;
  const record = migrated as Record<string, unknown>;
  if (record.version !== 1) return SHIPPED_GLOBAL;

  return {
    version: 1,
    mode: readMode(record.mode),
    seed: readStoredColour(record.seed),
    sources: readSources(record.sources),
    density: readDensity(record.density),
    sizeScale: readSizeScale(record.sizeScale),
    weightShift: readWeightShift(record.weightShift),
    fontFamily: readBoundedString(record.fontFamily, MAX_FONT_NAME),
    monoFamily: readBoundedString(record.monoFamily, MAX_FONT_NAME),
    appName: readBoundedString(record.appName, MAX_APP_NAME),
    showEmoji: readBoolean(record.showEmoji, SHIPPED_GLOBAL.showEmoji),
    rainbowLevel: readRainbowLevel(record.rainbowLevel),
    activePresetId: readBoundedString(record.activePresetId, MAX_PRESET_ID),
    recentColours: readRecentColours(record.recentColours),
  };
}
