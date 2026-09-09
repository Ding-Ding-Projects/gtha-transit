import assert from 'node:assert/strict';
import test from 'node:test';
import { RAINBOW } from '../lib/colour.ts';
import { MAX_APP_NAME, SHIPPED_GLOBAL, parseGlobal, serializeGlobal } from '../lib/appearance/document.ts';
import { UI_ELEMENTS, appearanceElement, canInheritFrom } from '../lib/appearance/elements.ts';
import { compileOverrides, sanitiseOverrides } from '../lib/appearance/style-model.ts';
import { commitAppearanceHistory, createAppearanceHistory, redoAppearanceHistory, undoAppearanceHistory } from '../lib/appearance/history.ts';
import { exportAppearance, importAppearance, MAX_TRANSFER_BYTES } from '../lib/appearance/transfer.ts';
import { normalisePresets } from '../lib/appearance/presets.ts';
import { readBounded, writeBounded } from '../lib/appearance/persistence.ts';

test('global document clamps values, discards unknown fields and serialises version one', () => {
  const value = parseGlobal(JSON.stringify({ version: 1, seed: '#123456', sizeScale: 99, appName: ` x${'a'.repeat(MAX_APP_NAME + 9)} `, rainbowLevel: 9, unknown: 'nope' }));
  assert.equal(value.seed, '#123456'); assert.equal(value.sizeScale, 1.5); assert.equal(value.appName?.length, MAX_APP_NAME); assert.equal(value.rainbowLevel, 3);
  assert.deepEqual(Object.keys(JSON.parse(serializeGlobal(value))).sort(), Object.keys(SHIPPED_GLOBAL).sort());
});

test('registry is explicit, unique and inheritance is bounded', () => {
  assert.ok(UI_ELEMENTS.length >= 20); assert.equal(new Set(UI_ELEMENTS.map((item) => item.id)).size, UI_ELEMENTS.length);
  assert.ok(appearanceElement('journey.option.card')); assert.equal(appearanceElement('body'), null); assert.equal(canInheritFrom('journey.option.action', 'journey.list'), true); assert.equal(canInheritFrom('shell', 'shell'), false);
});

test('style compiler accepts registered safe data and rejects selectors, URLs and unknown IDs', () => {
  const accepted = sanitiseOverrides([{ id: 'journey.option.card', states: { hover: { color: '#123456', 'background-color': RAINBOW } } }]);
  const css = compileOverrides(accepted);
  assert.match(css, /\[data-ui="journey.option.card"\]:hover/); assert.match(css, /!important/); assert.match(css, /oklch/);
  assert.equal(sanitiseOverrides([{ id: 'body', states: { normal: { color: '#000' } } }]).length, 0);
  assert.equal(sanitiseOverrides([{ id: 'shell', states: { normal: { color: 'url(https://bad.example)' } } }]).length, 0);
});

test('history is bounded and undo/redo is reversible', () => {
  let history = createAppearanceHistory('one', 2); history = commitAppearanceHistory(history, 'two'); history = commitAppearanceHistory(history, 'three'); history = commitAppearanceHistory(history, 'four');
  assert.deepEqual(history.past, ['two', 'three']); history = undoAppearanceHistory(history); assert.equal(history.present, 'three'); history = redoAppearanceHistory(history); assert.equal(history.present, 'four');
});

test('transfer is bounded, reject-typed and cannot carry unknown fields', () => {
  const text = exportAppearance({ global: SHIPPED_GLOBAL, elements: [], presets: [] });
  assert.equal(importAppearance(text).ok, true); assert.deepEqual(importAppearance('{"version":1,"kind":"gtha-appearance","extra":true}'), { ok: false, reason: 'unknown-field' });
  assert.deepEqual(importAppearance('x'.repeat(MAX_TRANSFER_BYTES + 1)), { ok: false, reason: 'too-large' });
});

test('presets are bounded and persistence refuses oversized values', () => {
  const presets = normalisePresets([{ version: 1, id: 'night', name: 'Night', createdAt: '2026-09-09T00:00:00.000Z', global: SHIPPED_GLOBAL }, { version: 1, id: 'night', name: 'Duplicate', createdAt: '2026-09-09T00:00:00.000Z', global: SHIPPED_GLOBAL }]);
  assert.equal(presets.length, 1);
  const values = new Map(); const store = { get: (key) => values.get(key) ?? null, set: (key, value) => (values.set(key, value), true), remove: (key) => values.delete(key) };
  assert.equal(writeBounded(store, 'a', 'safe'), true); assert.equal(readBounded(store, 'a'), 'safe'); assert.equal(writeBounded(store, 'b', 'x'.repeat(13 * 1024)), false);
});
