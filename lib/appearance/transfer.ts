import { parseGlobal, serializeGlobal, type AppearanceGlobal } from './document.ts';
import { normalisePresets, type AppearancePreset } from './presets.ts';
import { sanitiseOverrides, type ElementOverride } from './style-model.ts';
import { parseElementDocument, type AppearanceLayer } from './element-document.ts';

export const TRANSFER_VERSION = 1;
export const MAX_TRANSFER_BYTES = 256 * 1024;
export type AppearanceTransfer = { version: 1; kind: 'gtha-appearance'; global: AppearanceGlobal; elements: ElementOverride[]; layers: AppearanceLayer[]; presets: AppearancePreset[] };
export type TransferFailure = 'empty' | 'too-large' | 'invalid-json' | 'wrong-version' | 'wrong-kind' | 'unknown-field' | 'invalid-content';
export type TransferResult = { ok: true; value: AppearanceTransfer } | { ok: false; reason: TransferFailure };

const KEYS = new Set(['version', 'kind', 'global', 'elements', 'layers', 'presets']);
const stable = (value: unknown): string => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([a],[b]) => a.localeCompare(b))) : entry);

export function exportAppearance(value: Omit<AppearanceTransfer, 'version' | 'kind'>): string {
  const elementDocument = parseElementDocument(JSON.stringify({ version: 1, overrides: value.elements, layers: value.layers }));
  const safe: AppearanceTransfer = { version: TRANSFER_VERSION, kind: 'gtha-appearance', global: parseGlobal(serializeGlobal(value.global)), elements: elementDocument.overrides, layers: elementDocument.layers, presets: normalisePresets(value.presets) };
  return JSON.stringify(safe);
}

/** Imports are fail-closed: unknown top-level fields need a versioned decision first. */
export function importAppearance(text: string | null | undefined): TransferResult {
  if (!text || !text.trim()) return { ok: false, reason: 'empty' };
  if (new TextEncoder().encode(text).byteLength > MAX_TRANSFER_BYTES) return { ok: false, reason: 'too-large' };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, reason: 'invalid-json' }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'invalid-json' };
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).some((key) => !KEYS.has(key))) return { ok: false, reason: 'unknown-field' };
  if (record.version !== TRANSFER_VERSION) return { ok: false, reason: 'wrong-version' };
  if (record.kind !== 'gtha-appearance') return { ok: false, reason: 'wrong-kind' };
  if (!record.global || typeof record.global !== 'object' || Array.isArray(record.global) || (record.global as Record<string, unknown>).version !== 1 || !Array.isArray(record.elements) || !Array.isArray(record.layers) || !Array.isArray(record.presets)) return { ok: false, reason: 'invalid-content' };
  const elementDocument = parseElementDocument(JSON.stringify({ version: 1, overrides: record.elements, layers: record.layers }));
  const global = parseGlobal(JSON.stringify(record.global)), presets = normalisePresets(record.presets);
  if (stable(record.global) !== stable(global) || stable(record.elements) !== stable(elementDocument.overrides) || stable(record.layers) !== stable(elementDocument.layers) || stable(record.presets) !== stable(presets)) return { ok: false, reason: 'invalid-content' };
  return { ok: true, value: { version: 1, kind: 'gtha-appearance', global, elements: elementDocument.overrides, layers: elementDocument.layers, presets } };
}
