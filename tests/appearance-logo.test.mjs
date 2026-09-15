import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CUSTOM_LOGO_ID,
  LOGO_ALLOWED_TYPES,
  LOGO_CANVAS_SIZE,
  LOGO_PRESETS,
  MAX_LOGO_STORED_BYTES,
  MAX_LOGO_SOURCE_DIMENSION,
  MAX_LOGO_UPLOAD_BYTES,
  SHIPPED_LOGO_ID,
  computeLogoDrawRect,
  isKnownLogoId,
  logoPreset,
  logoUploadMessage,
  presetFaviconDataUrl,
  validateLogoDimensions,
  validateLogoFile,
  validateStoredLogo,
} from '../lib/appearance/logo.ts';
import { SHIPPED_GLOBAL, parseGlobal, serializeGlobal } from '../lib/appearance/document.ts';

const t = (en) => en;

test('presets are unique, include the shipped mark and resolve by id', () => {
  assert.ok(LOGO_PRESETS.length >= 3);
  assert.equal(new Set(LOGO_PRESETS.map((preset) => preset.id)).size, LOGO_PRESETS.length);
  assert.ok(logoPreset(SHIPPED_LOGO_ID));
  assert.equal(logoPreset('not-a-real-preset'), null);
  for (const preset of LOGO_PRESETS) {
    assert.ok(preset.strokes.length > 0, `${preset.id} draws at least one stroke`);
    assert.ok(preset.label.en.length > 0 && preset.label.zh.length > 0, `${preset.id} is bilingual`);
  }
});

test('isKnownLogoId accepts every preset and the custom sentinel, and nothing else', () => {
  for (const preset of LOGO_PRESETS) assert.equal(isKnownLogoId(preset.id), true);
  assert.equal(isKnownLogoId(CUSTOM_LOGO_ID), true);
  assert.equal(isKnownLogoId('made-up'), false);
  assert.equal(isKnownLogoId(''), false);
});

test('global document falls back to the shipped mark for a missing or unknown logo id', () => {
  assert.equal(SHIPPED_GLOBAL.logoId, SHIPPED_LOGO_ID);
  assert.equal(parseGlobal(null).logoId, SHIPPED_LOGO_ID);
  assert.equal(parseGlobal(JSON.stringify({ version: 1, logoId: 'not-a-real-preset' })).logoId, SHIPPED_LOGO_ID);
  assert.equal(parseGlobal(JSON.stringify({ version: 1, logoId: CUSTOM_LOGO_ID })).logoId, CUSTOM_LOGO_ID);
  const roundTripped = parseGlobal(serializeGlobal({ ...SHIPPED_GLOBAL, logoId: 'compass' }));
  assert.equal(roundTripped.logoId, 'compass');
});

test('logo file validation checks the type allow-list before the byte cap', () => {
  assert.equal(validateLogoFile({ type: 'image/png', size: 1024 }), null);
  assert.equal(validateLogoFile({ type: 'image/svg+xml', size: 1024 }), null);
  assert.equal(validateLogoFile({ type: 'application/pdf', size: 1024 }), 'type');
  assert.equal(validateLogoFile({ type: 'image/png', size: 0 }), 'too-large');
  assert.equal(validateLogoFile({ type: 'image/png', size: MAX_LOGO_UPLOAD_BYTES + 1 }), 'too-large');
  assert.equal(validateLogoFile({ type: 'image/png', size: MAX_LOGO_UPLOAD_BYTES }), null);
  for (const type of LOGO_ALLOWED_TYPES) assert.equal(validateLogoFile({ type, size: 100 }), null);
});

test('logo dimension validation rejects a decompression-bomb-sized source', () => {
  assert.equal(validateLogoDimensions(64, 64), null);
  assert.equal(validateLogoDimensions(0, 64), 'decode');
  assert.equal(validateLogoDimensions(64, Number.NaN), 'decode');
  assert.equal(validateLogoDimensions(MAX_LOGO_SOURCE_DIMENSION + 1, 64), 'dimensions');
  assert.equal(validateLogoDimensions(64, MAX_LOGO_SOURCE_DIMENSION + 1), 'dimensions');
  assert.equal(validateLogoDimensions(MAX_LOGO_SOURCE_DIMENSION, MAX_LOGO_SOURCE_DIMENSION), null);
});

test('the draw rect preserves aspect ratio and centres the result on the square canvas', () => {
  const wide = computeLogoDrawRect(400, 200);
  assert.equal(wide.drawWidth, LOGO_CANVAS_SIZE);
  assert.equal(wide.drawHeight, LOGO_CANVAS_SIZE / 2);
  assert.equal(wide.x, 0);
  assert.equal(wide.y, LOGO_CANVAS_SIZE / 4);

  const tall = computeLogoDrawRect(100, 400);
  assert.equal(tall.drawHeight, LOGO_CANVAS_SIZE);
  assert.equal(tall.drawWidth, LOGO_CANVAS_SIZE / 4);
  assert.equal(tall.y, 0);

  const square = computeLogoDrawRect(50, 50);
  assert.equal(square.drawWidth, LOGO_CANVAS_SIZE);
  assert.equal(square.drawHeight, LOGO_CANVAS_SIZE);
  assert.equal(square.x, 0);
  assert.equal(square.y, 0);
});

test('stored logo bytes are bounded independently of the upload cap', () => {
  assert.equal(validateStoredLogo('data:image/png;base64,AA=='), null);
  assert.equal(validateStoredLogo('data:image/png;base64,' + 'A'.repeat(MAX_LOGO_STORED_BYTES)), 'stored-too-large');
});

test('every upload failure reason has a bilingual message', () => {
  for (const reason of ['type', 'too-large', 'dimensions', 'decode', 'stored-too-large']) {
    assert.ok(logoUploadMessage(reason, t).length > 0, reason);
  }
});

test('a preset favicon renders as a self-contained SVG data URL', () => {
  const href = presetFaviconDataUrl(logoPreset('compass'), false);
  assert.match(href, /^data:image\/svg\+xml;utf8,/);
  const svg = decodeURIComponent(href.slice('data:image/svg+xml;utf8,'.length));
  assert.match(svg, /<svg /);
  assert.match(svg, /<rect width="64" height="64" rx="20"/);
  assert.doesNotMatch(svg, /<script/i);
});
