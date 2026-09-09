import { parseGlobal, serializeGlobal, type AppearanceGlobal } from './document.ts';

export type AppearancePreset = { version: 1; id: string; name: string; createdAt: string; global: AppearanceGlobal };
export const MAX_PRESETS = 50;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function parsePreset(value: unknown): AppearancePreset | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || typeof raw.id !== 'string' || !ID.test(raw.id) || typeof raw.name !== 'string' || !raw.name.trim() || typeof raw.createdAt !== 'string') return null;
  const date = new Date(raw.createdAt);
  if (Number.isNaN(date.valueOf())) return null;
  const global = parseGlobal(JSON.stringify(raw.global));
  return { version: 1, id: raw.id, name: raw.name.trim().slice(0, 80), createdAt: date.toISOString(), global };
}

export function serialisePreset(preset: AppearancePreset): string {
  return JSON.stringify({ ...preset, global: JSON.parse(serializeGlobal(preset.global)) });
}

export function normalisePresets(value: unknown): AppearancePreset[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const result: AppearancePreset[] = [];
  for (const entry of value) {
    const preset = parsePreset(entry);
    if (!preset || ids.has(preset.id) || result.length >= MAX_PRESETS) continue;
    ids.add(preset.id); result.push(preset);
  }
  return result;
}
