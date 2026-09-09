import assert from 'node:assert/strict';
import test from 'node:test';
import { parseColour, rgbToHsv } from '../lib/colour.ts';
import { angleFromHue, clampHsv, fieldToHsv, hsvToField, hsvToRgb, hueFromAngle, stepHsv } from '../lib/appearance/colour-field.ts';

test('clampHsv wraps hue and clamps saturation and value, including non-finite input', () => {
  assert.deepEqual(clampHsv({ h: 370, s: 50, v: 50 }), { h: 10, s: 50, v: 50 });
  assert.deepEqual(clampHsv({ h: -10, s: 150, v: -20 }), { h: 350, s: 100, v: 0 });
  assert.deepEqual(clampHsv({ h: NaN, s: NaN, v: NaN }), { h: 0, s: 0, v: 0 });
});

test('fieldToHsv and hsvToField are inverses across the square, and clamp an out-of-bounds pointer', () => {
  const width = 200, height = 100;
  for (const [s, v] of [[0, 0], [100, 100], [37, 62], [0, 100], [100, 0]]) {
    const { x, y } = hsvToField(210, s, v, width, height);
    const back = fieldToHsv(x, y, width, height, 210);
    assert.ok(Math.abs(back.s - s) < 0.001, `saturation round-trips at ${s}`);
    assert.ok(Math.abs(back.v - v) < 0.001, `value round-trips at ${v}`);
  }
  // A drag that runs past the square under pointer capture still lands inside it.
  assert.deepEqual(fieldToHsv(-50, -50, width, height, 90), { h: 90, s: 0, v: 100 });
  assert.deepEqual(fieldToHsv(width + 999, height + 999, width, height, 90), { h: 90, s: 100, v: 0 });
  // A not-yet-measured (zero-sized) square never divides by zero.
  assert.equal(Number.isFinite(fieldToHsv(0, 0, 0, 0, 0).s), true);
});

test('hueFromAngle and angleFromHue are exact inverses at every whole degree', () => {
  for (let hue = 0; hue < 360; hue += 1) {
    const angle = angleFromHue(hue);
    const back = hueFromAngle(Math.cos(angle), Math.sin(angle));
    assert.ok(Math.abs(back - hue) < 0.01 || Math.abs(back - hue - 360) < 0.01, `hue ${hue} round-trips, got ${back}`);
  }
  assert.equal(angleFromHue(0), 0);
  assert.ok(Math.abs(angleFromHue(360) - 0) < 1e-9, 'a full turn wraps back to angle 0');
});

test('stepHsv moves saturation and value by one unit, or ten with shift, and is a no-op for any other key', () => {
  const start = { h: 40, s: 50, v: 50 };
  assert.deepEqual(stepHsv(start, 'ArrowRight', false), { h: 40, s: 51, v: 50 });
  assert.deepEqual(stepHsv(start, 'ArrowLeft', true), { h: 40, s: 40, v: 50 });
  assert.deepEqual(stepHsv(start, 'ArrowUp', true), { h: 40, s: 50, v: 60 });
  assert.deepEqual(stepHsv(start, 'ArrowDown', false), { h: 40, s: 50, v: 49 });
  assert.deepEqual(stepHsv(start, 'Enter', false), start);
  // Stepping past an edge clamps rather than wrapping.
  assert.deepEqual(stepHsv({ h: 40, s: 95, v: 50 }, 'ArrowRight', true), { h: 40, s: 100, v: 50 });
});

test('hsvToRgb agrees with lib/colour.ts on every corner of the hue wheel', () => {
  // Pure hues at maximum saturation and value are the six named RGB corners.
  const corners = [
    [0, '#ff0000'], [60, '#ffff00'], [120, '#00ff00'],
    [180, '#00ffff'], [240, '#0000ff'], [300, '#ff00ff'],
  ];
  for (const [hue, hex] of corners) {
    const rgb = hsvToRgb(hue, 100, 100);
    const expected = parseColour(hex);
    assert.ok(Math.abs(rgb.r - expected.r) <= 1 && Math.abs(rgb.g - expected.g) <= 1 && Math.abs(rgb.b - expected.b) <= 1, `hue ${hue} should be close to ${hex}, got rgb(${rgb.r} ${rgb.g} ${rgb.b})`);
  }
  // Zero value is always black, whatever the hue or saturation.
  assert.deepEqual(hsvToRgb(123, 80, 0), { r: 0, g: 0, b: 0, a: 1 });
  // Zero saturation is a neutral grey at every hue.
  const grey = hsvToRgb(77, 0, 40);
  assert.ok(Math.abs(grey.r - grey.g) < 0.001 && Math.abs(grey.g - grey.b) < 0.001);
  // Round-trips through lib/colour.ts's own forward conversion.
  const rgb = hsvToRgb(210, 65, 80);
  const [h, s, v] = rgbToHsv(rgb);
  assert.ok(Math.abs(h - 210) < 0.5 && Math.abs(s - 65) < 0.5 && Math.abs(v - 80) < 0.5, `rgbToHsv(hsvToRgb(...)) should recover the input, got h=${h} s=${s} v=${v}`);
});
