import { RAINBOW, parseColour } from '../colour.ts';
import { MAX_ELEMENTS, MAX_LAYERS, type UiState } from './document.ts';
import { appearanceElement } from './elements.ts';

export const STYLE_PROPS = ['color', 'background-color', 'border-color', 'outline-color', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'line-height', 'border-radius', 'opacity'] as const;
export type StyleProp = (typeof STYLE_PROPS)[number];
export type ElementStyle = Partial<Record<StyleProp, string>>;
export type ElementOverride = { id: string; states: Partial<Record<UiState, ElementStyle>> };

const PROPERTY_SET = new Set<string>(STYLE_PROPS);
const SAFE_VALUE = /^[\w\s#(),.%+\-/'"!]+$/u;

export function sanitiseStyle(style: unknown): ElementStyle {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return {};
  const result: ElementStyle = {};
  for (const [property, value] of Object.entries(style as Record<string, unknown>)) {
    if (!PROPERTY_SET.has(property) || typeof value !== 'string') continue;
    const cleaned = value.trim().slice(0, 200);
    if (!cleaned || !SAFE_VALUE.test(cleaned) || /url\s*\(|expression\s*\(|@import|[{};]/iu.test(cleaned)) continue;
    if (property.endsWith('color') && cleaned !== RAINBOW && parseColour(cleaned) === null) continue;
    result[property as StyleProp] = cleaned;
  }
  return result;
}

export function sanitiseOverrides(value: unknown): ElementOverride[] {
  if (!Array.isArray(value)) return [];
  const result: ElementOverride[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (result.length >= MAX_ELEMENTS || !candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const raw = candidate as Record<string, unknown>;
    if (typeof raw.id !== 'string' || ids.has(raw.id) || !appearanceElement(raw.id)) continue;
    const states: ElementOverride['states'] = {};
    if (raw.states && typeof raw.states === 'object' && !Array.isArray(raw.states)) {
      for (const state of ['normal', 'hover', 'focus', 'pressed', 'selected', 'disabled', 'error'] as const) {
        const accepted = sanitiseStyle((raw.states as Record<string, unknown>)[state]);
        if (Object.keys(accepted).length) states[state] = accepted;
      }
    }
    if (Object.keys(states).length) { ids.add(raw.id); result.push({ id: raw.id, states }); }
  }
  return result;
}

function selector(id: string, state: UiState): string {
  const base = `[data-ui="${id}"]`;
  if (state === 'normal') return base;
  const map: Record<Exclude<UiState, 'normal'>, string> = {
    hover: `${base}:hover,${base}[data-ui-preview="hover"]`,
    focus: `${base}:focus-visible,${base}[data-ui-preview="focus"]`,
    pressed: `${base}:active,${base}[data-ui-preview="pressed"]`,
    selected: `${base}[aria-pressed="true"],${base}[aria-selected="true"],${base}[aria-current],${base}:checked,${base}[data-ui-preview="selected"]`,
    disabled: `${base}:disabled,${base}[aria-disabled="true"],${base}[data-ui-preview="disabled"]`,
    error: `${base}[aria-invalid="true"],${base}.is-error,${base}[data-ui-preview="error"]`,
  };
  return map[state];
}

function declarations(style: ElementStyle): string {
  return Object.entries(style).map(([property, value]) => `${property}:${value === RAINBOW ? 'oklch(70% 0.15 var(--gtha-rainbow-hue))' : value}!important`).join(';');
}

/** Compile only registered data-ui identifiers. No caller supplied selector is accepted. */
export function compileOverride(override: ElementOverride): string {
  if (!appearanceElement(override.id)) return '';
  return (Object.entries(override.states) as [UiState, ElementStyle][])
    .map(([state, style]) => { const body = declarations(sanitiseStyle(style)); return body ? `${selector(override.id, state)}{${body}}` : ''; })
    .join('');
}

export function compileOverrides(value: unknown): string {
  return sanitiseOverrides(value).slice(0, MAX_LAYERS).map(compileOverride).join('');
}
