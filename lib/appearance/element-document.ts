import { MAX_ELEMENTS, MAX_LAYERS, UI_STATES, type UiState } from './document.ts';
import { sanitiseOverrides, type ElementOverride, type ElementStyle } from './style-model.ts';
import { appearanceElement } from './elements.ts';

export type LayerKind = 'fill' | 'border' | 'shadow' | 'glow';
export type AppearanceLayer = { id: string; kind: LayerKind; name: string; visible: boolean; locked: boolean; opacity: number; value: string; elementId?: string; state?: UiState };
export type ElementAppearanceDocument = { version: 1; overrides: ElementOverride[]; layers: AppearanceLayer[] };
const KINDS = new Set<LayerKind>(['fill', 'border', 'shadow', 'glow']);
const LAYER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().slice(0, max);
  return clean && !/[{};]/u.test(clean) ? clean : null;
}
function readLayer(value: unknown): AppearanceLayer | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>; const id = text(raw.id, 64); const name = text(raw.name, 80); const content = text(raw.value, 200);
  if (!id || !LAYER_ID.test(id) || !name || !content || /url\s*\(|expression\s*\(|@import/i.test(content) || typeof raw.kind !== 'string' || !KINDS.has(raw.kind as LayerKind)) return null;
  const elementId = typeof raw.elementId === 'string' ? raw.elementId : 'shell';
  if (!appearanceElement(elementId)) return null;
  const state = UI_STATES.includes(raw.state as UiState) ? raw.state as UiState : 'normal';
  const opacity = typeof raw.opacity === 'number' && Number.isFinite(raw.opacity) ? Math.min(1, Math.max(0, raw.opacity)) : 1;
  return { id, kind: raw.kind as LayerKind, name, visible: raw.visible !== false, locked: raw.locked === true, opacity, value: content, elementId, state };
}
export const EMPTY_ELEMENT_DOCUMENT: ElementAppearanceDocument = Object.freeze({ version: 1, overrides: [], layers: [] });
export function parseElementDocument(rawText: string | null | undefined): ElementAppearanceDocument {
  if (!rawText) return EMPTY_ELEMENT_DOCUMENT;
  let raw: unknown; try { raw = JSON.parse(rawText); } catch { return EMPTY_ELEMENT_DOCUMENT; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw as Record<string, unknown>).version !== 1) return EMPTY_ELEMENT_DOCUMENT;
  const record = raw as Record<string, unknown>; const layers: AppearanceLayer[] = []; const ids = new Set<string>();
  if (Array.isArray(record.layers)) for (const candidate of record.layers) { const accepted = readLayer(candidate); if (accepted && !ids.has(accepted.id) && layers.length < MAX_LAYERS) { ids.add(accepted.id); layers.push(accepted); } }
  return { version: 1, overrides: sanitiseOverrides(record.overrides).slice(0, MAX_ELEMENTS), layers };
}
export const serialiseElementDocument = (document: ElementAppearanceDocument) => JSON.stringify(parseElementDocument(JSON.stringify(document)));
export function setOverrideStyle(document: ElementAppearanceDocument, id: string, state: UiState, style: ElementStyle): ElementAppearanceDocument {
  if (!(UI_STATES as readonly string[]).includes(state)) return document;
  const overrides = sanitiseOverrides(document.overrides); const index = overrides.findIndex((item) => item.id === id);
  const next = index < 0 ? [...overrides, { id, states: { [state]: style } }] : overrides.map((item, i) => i === index ? { ...item, states: { ...item.states, [state]: style } } : item);
  return parseElementDocument(JSON.stringify({ version: 1, overrides: next, layers: document.layers }));
}
export function resetOverrideStyle(document: ElementAppearanceDocument, id: string, state?: UiState): ElementAppearanceDocument {
  const overrides = document.overrides.flatMap((item) => { if (item.id !== id) return [item]; if (!state) return []; const states = { ...item.states }; delete states[state]; return Object.keys(states).length ? [{ ...item, states }] : []; });
  return { ...document, overrides };
}
