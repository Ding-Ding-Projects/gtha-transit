import { formatHex8, parseColour } from '../colour.ts';
import { compileOverride, compileOverrides } from './style-model.ts';
import { parseElementDocument, type AppearanceLayer } from './element-document.ts';
import { MAX_SHEET_BYTES, type UiState } from './document.ts';

/** Layer values have no network or arbitrary-selector capabilities. */
export function compileLayers(input: AppearanceLayer[]): string {
  const layers = parseElementDocument(JSON.stringify({ version: 1, overrides: [], layers: input })).layers;
  const groups = new Map<string, { id: string; state: UiState; fills: string[]; shadows: string[]; border?: string }>();
  for (const layer of layers) {
    if (!layer.visible) continue;
    const id = layer.elementId ?? 'shell', state = layer.state ?? 'normal', key = `${id}|${state}`;
    const group = groups.get(key) ?? { id, state, fills: [], shadows: [] };
    const value = layer.value.replace(/#[0-9a-f]{3,8}\b/gi, colour => { const parsed = parseColour(colour); return parsed ? formatHex8({ ...parsed, a: parsed.a * layer.opacity }) : colour; });
    if (layer.kind === 'fill') group.fills.push(parseColour(value) ? `linear-gradient(${value},${value})` : value);
    else if (layer.kind === 'border') group.border = value;
    else group.shadows.push(value);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => compileOverride({ id: group.id, states: { [group.state]: { ...(group.fills.length ? { 'background-image': group.fills.join(',') } : {}), ...(group.shadows.length ? { 'box-shadow': group.shadows.join(',') } : {}), ...(group.border ? { 'border-color': group.border, 'border-width': '2px', 'border-style': 'solid' } : {}) } } }, 16384)).join('');
}

export function compileAppearance(document: { overrides: unknown; layers: AppearanceLayer[] }): string {
  const css = compileOverrides(document.overrides) + compileLayers(document.layers);
  if (new TextEncoder().encode(css).byteLength > MAX_SHEET_BYTES) throw new RangeError('Appearance stylesheet exceeds its supported size.');
  return css;
}
