import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COLOUR_FORMATS,
  NAMED_COLOURS,
  RAINBOW,
  RAINBOW_LEVELS,
  RAINBOW_SECONDS,
  SHIPPED_RAINBOW_LEVEL,
  cmykToRgb,
  contrastRatio,
  contrastVerdict,
  formatColour,
  formatHex,
  formatHex8,
  hslToRgb,
  inGamut,
  isRainbow,
  labToLch,
  nameFor,
  oklabToRgbTriple,
  tripleToOklab,
  oklabToOklch,
  oklchToOklab,
  parseColour,
  rainbowDuration,
  rgbToCmyk,
  rgbToHsl,
  rgbToHsv,
  rgbToHwb,
  rgbToLab,
  rgbToOklab,
  translateColour,
} from '../lib/colour.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const rgb = (r, g, b, a = 1) => ({ r, g, b, a });
const close = (actual, expected, tolerance, what) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} is not within ${tolerance} of ${expected}`);

/* --------------------------------------------------------------- parsing -- */

test('every hex shape is read, including the short forms and the alpha ones', () => {
  assert.deepEqual(parseColour('#fff'), rgb(255, 255, 255));
  assert.deepEqual(parseColour('#FFF'), rgb(255, 255, 255));
  assert.deepEqual(parseColour('fff'), rgb(255, 255, 255), 'the hash is optional');
  assert.deepEqual(parseColour('#00b7a8'), rgb(0, 183, 168));
  assert.deepEqual(parseColour('#0000'), rgb(0, 0, 0, 0));
  assert.deepEqual(parseColour('#00b7a880'), rgb(0, 183, 168, 128 / 255));
  // Two, five and seven digits are not hex colours, and guessing at one loses what was typed.
  for (const bad of ['#gg', '#12', '#12345', '#1234567', '#', '']) {
    assert.equal(parseColour(bad), null, `${bad || '(empty)'} is not a colour`);
  }
});

test('a CSS name resolves, and so does transparent', () => {
  assert.deepEqual(parseColour('rebeccapurple'), rgb(102, 51, 153));
  assert.deepEqual(parseColour('  RebeccaPurple '), rgb(102, 51, 153), 'case and padding do not matter');
  assert.deepEqual(parseColour('transparent'), rgb(0, 0, 0, 0));
  assert.equal(parseColour('nosuchcolour'), null);
  assert.equal(Object.keys(NAMED_COLOURS).length, 148, 'the CSS named colour list');
});

test('the functional notations are read, with alpha after a slash', () => {
  assert.deepEqual(parseColour('rgb(0 183 168)'), rgb(0, 183, 168));
  assert.deepEqual(parseColour('rgb(0, 183, 168)'), rgb(0, 183, 168), 'commas too');
  assert.deepEqual(parseColour('rgb(0 183 168 / 0.5)'), rgb(0, 183, 168, 0.5));
  const fromHsl = parseColour('hsl(175 100% 36%)');
  close(fromHsl.r, 0, 1, 'hsl red');
  close(fromHsl.g, 183.6, 1, 'hsl green');
  assert.equal(parseColour('rgb(not a colour)'), null);
  assert.equal(parseColour('nonsense(1 2 3)'), null);
});

test('a value the picker wrote is a value the picker can read back', () => {
  // The round trip is the whole contract of a translator: anything it prints in
  // one format has to come back as the same colour when pasted into the field.
  const original = rgb(0, 183, 168);
  for (const format of COLOUR_FORMATS) {
    if (format === 'hsv' || format === 'lab' || format === 'lch') continue; // written, not read: see below
    const written = formatColour(original, format);
    const read = parseColour(written);
    assert.ok(read, `${format} produced ${written}, which did not parse`);
    for (const channel of ['r', 'g', 'b']) {
      close(read[channel], original[channel], 1.5, `${format} round trip ${channel} (${written})`);
    }
  }
});

test('the formats the translator shows but cannot read back say so by being absent from parsing', () => {
  // hsv, lab and lch are readable values a person copies into a design tool; they
  // are not CSS colour functions this parser accepts, and pretending otherwise
  // would mean accepting a string no browser would.
  for (const format of ['hsv', 'lab', 'lch']) {
    const written = formatColour(rgb(0, 183, 168), format);
    assert.equal(parseColour(written), null, `${written} is presented for reading, not for pasting back`);
  }
});

/* ------------------------------------------------------------ conversions -- */

test('the grey axis has no hue and no saturation in any space', () => {
  for (const value of [0, 64, 128, 255]) {
    const grey = rgb(value, value, value);
    assert.deepEqual(rgbToHsl(grey).slice(0, 2), [0, 0], `hsl of ${value}`);
    assert.deepEqual(rgbToHsv(grey).slice(0, 2), [0, 0], `hsv of ${value}`);
    const [, chroma] = oklabToOklch(rgbToOklab(grey));
    close(chroma, 0, 0.0005, `oklch chroma of ${value}`);
  }
});

test('the primaries land on the hues they are supposed to', () => {
  for (const [colour, hue] of [[rgb(255, 0, 0), 0], [rgb(255, 255, 0), 60], [rgb(0, 255, 0), 120], [rgb(0, 255, 255), 180], [rgb(0, 0, 255), 240], [rgb(255, 0, 255), 300]]) {
    close(rgbToHsl(colour)[0], hue, 0.01, `hsl hue of ${formatHex(colour)}`);
    close(rgbToHsv(colour)[0], hue, 0.01, `hsv hue of ${formatHex(colour)}`);
  }
});

test('hsl converts both ways without drifting', () => {
  for (const colour of [rgb(0, 183, 168), rgb(255, 138, 0), rgb(17, 34, 51), rgb(250, 250, 250)]) {
    const [h, s, l] = rgbToHsl(colour);
    const back = hslToRgb(h, s, l);
    for (const channel of ['r', 'g', 'b']) close(back[channel], colour[channel], 0.6, `hsl ${channel} of ${formatHex(colour)}`);
  }
});

test('oklab converts both ways, and its lightness runs the right way', () => {
  for (const colour of [rgb(0, 183, 168), rgb(255, 138, 0), rgb(17, 34, 51)]) {
    const [r, g, b] = oklabToRgbTriple(rgbToOklab(colour));
    close(r * 255, colour.r, 0.6, 'oklab r');
    close(g * 255, colour.g, 0.6, 'oklab g');
    close(b * 255, colour.b, 0.6, 'oklab b');
  }
  close(rgbToOklab(rgb(0, 0, 0))[0], 0, 0.001, 'black is 0');
  close(rgbToOklab(rgb(255, 255, 255))[0], 1, 0.001, 'white is 1');
  assert.ok(rgbToOklab(rgb(200, 200, 200))[0] > rgbToOklab(rgb(50, 50, 50))[0], 'lighter is larger');
});

test('oklch and oklab are the same colour in polar and rectangular form', () => {
  const lab = rgbToOklab(rgb(0, 183, 168));
  const back = oklchToOklab(oklabToOklch(lab));
  for (let index = 0; index < 3; index += 1) close(back[index], lab[index], 1e-9, `oklab component ${index}`);
});

test('CIE Lab puts white at 100 and black at 0', () => {
  close(rgbToLab(rgb(255, 255, 255))[0], 100, 0.01, 'white');
  close(rgbToLab(rgb(0, 0, 0))[0], 0, 0.01, 'black');
  const [, chroma] = labToLch(rgbToLab(rgb(128, 128, 128)));
  close(chroma, 0, 0.05, 'grey has no chroma');
});

test('hwb describes how much white and black are mixed into the hue', () => {
  assert.deepEqual(rgbToHwb(rgb(255, 255, 255)).slice(1), [100, 0], 'white is all white');
  assert.deepEqual(rgbToHwb(rgb(0, 0, 0)).slice(1), [0, 100], 'black is all black');
  assert.deepEqual(rgbToHwb(rgb(255, 0, 0)).slice(1), [0, 0], 'a pure hue has neither');
  const parsed = parseColour('hwb(0 0% 0%)');
  assert.deepEqual([Math.round(parsed.r), Math.round(parsed.g), Math.round(parsed.b)], [255, 0, 0]);
  const grey = parseColour('hwb(0 50% 50%)');
  close(grey.r, grey.b, 0.001, 'white and black in equal measure is grey whatever the hue');
});

test('cmyk converts both ways, and says nothing it cannot', () => {
  assert.deepEqual(rgbToCmyk(rgb(0, 0, 0)), [0, 0, 0, 100], 'black is all key');
  assert.deepEqual(rgbToCmyk(rgb(255, 255, 255)), [0, 0, 0, 0]);
  for (const colour of [rgb(0, 183, 168), rgb(255, 138, 0)]) {
    const [c, m, y, k] = rgbToCmyk(colour);
    const back = cmykToRgb(c, m, y, k);
    for (const channel of ['r', 'g', 'b']) close(back[channel], colour[channel], 0.6, `cmyk ${channel}`);
  }
  const source = readFileSync(path.join(root, 'lib', 'colour.ts'), 'utf8');
  assert.match(source, /no colour profile behind this/, 'the naivety of this conversion is stated, not implied away');
});

/* -------------------------------------------------------------- contrast -- */

test('contrast is the WCAG ratio, and the extremes are exactly 21 and 1', () => {
  close(contrastRatio(rgb(0, 0, 0), rgb(255, 255, 255)), 21, 0.001, 'black on white');
  close(contrastRatio(rgb(255, 255, 255), rgb(0, 0, 0)), 21, 0.001, 'and the other way round');
  close(contrastRatio(rgb(120, 120, 120), rgb(120, 120, 120)), 1, 0.001, 'a colour against itself');
  assert.deepEqual(contrastVerdict(21), { normal: 'AAA', large: 'AAA' });
  assert.deepEqual(contrastVerdict(4.5), { normal: 'AA', large: 'AAA' });
  assert.deepEqual(contrastVerdict(3), { normal: 'fail', large: 'AA' });
  assert.deepEqual(contrastVerdict(2.9), { normal: 'fail', large: 'fail' });
});

test('gamut is judged with the tolerance a round trip actually needs', () => {
  assert.equal(inGamut([0, 0.5, 1]), true);
  assert.equal(inGamut([-0.00005, 1.00005, 0.5]), true, 'a rounding whisker is not out of gamut');
  assert.equal(inGamut([-0.01, 0.5, 0.5]), false);
  assert.equal(inGamut([0.5, 1.2, 0.5]), false);
});

/* ------------------------------------------------------------- formatting -- */

test('formatting never emits a negative zero or a bare alpha of 1', () => {
  assert.equal(formatHex(rgb(0, 0, 0)), '#000000');
  assert.equal(formatHex8(rgb(0, 0, 0, 1)), '#000000ff');
  assert.equal(formatHex8(rgb(0, 0, 0, 0)), '#00000000');
  for (const format of COLOUR_FORMATS) {
    const written = formatColour(rgb(0, 0, 0), format);
    assert.ok(!written.includes('-0 ') && !written.includes('-0%') && !written.includes('(-0'), `${format} printed a negative zero: ${written}`);
    assert.ok(!written.includes('NaN'), `${format} printed NaN: ${written}`);
  }
});

test('the translator answers in every format at once', () => {
  const all = translateColour(rgb(0, 183, 168));
  assert.deepEqual(Object.keys(all).sort(), [...COLOUR_FORMATS].sort());
  assert.equal(all.hex, '#00b7a8');
  for (const [format, written] of Object.entries(all)) assert.ok(written.length > 0, `${format} is empty`);
});

test('an exact CSS name is offered, and an inexact one is not invented', () => {
  assert.equal(nameFor(rgb(102, 51, 153)), 'rebeccapurple');
  assert.equal(nameFor(rgb(103, 51, 153)), null, 'one off is not that colour');
  assert.equal(nameFor(rgb(102, 51, 153, 0.5)), null, 'a name cannot carry alpha');
});

/* -------------------------------------------------------------- rainbow -- */

test('the rainbow is a sentinel, and is not a colour anything can format', () => {
  assert.equal(isRainbow(RAINBOW), true);
  assert.equal(isRainbow('#00b7a8'), false);
  assert.equal(isRainbow(null), false);
  /*
   * This is the trap the sentinel exists to survive. A call site that builds a
   * tint by appending alpha to a stored value produces `rainbow33`, which is not
   * an error but an ignored declaration: the surface renders with no background
   * and nothing says why. Parsing has to refuse it outright.
   */
  assert.equal(parseColour(RAINBOW), null, 'the sentinel is not parseable as a colour');
  assert.equal(parseColour(RAINBOW + '33'), null);
  assert.equal(Object.values(NAMED_COLOURS).includes(RAINBOW), false);
  assert.equal(Object.keys(NAMED_COLOURS).includes(RAINBOW), false, 'and it is not in the swatch palette');
});

test('rainbow speed is a level, and an unusable one falls back rather than emitting invalid CSS', () => {
  assert.deepEqual([...RAINBOW_LEVELS], [1, 2, 3, 4, 5]);
  assert.equal(rainbowDuration(SHIPPED_RAINBOW_LEVEL), '6s');
  assert.equal(rainbowDuration(1), '24s');
  assert.equal(rainbowDuration(5), '1.5s');
  // A hand-edited settings file otherwise puts NaN into a CSS duration, which
  // disables the animation silently rather than failing.
  for (const junk of [undefined, null, 'fast', 0, 9, NaN, {}]) {
    assert.equal(rainbowDuration(junk), '6s', `${String(junk)} falls back to the shipped level`);
  }
  assert.ok(RAINBOW_SECONDS[1] > RAINBOW_SECONDS[5], 'a higher level is a faster cycle, so the number is not seconds');
});
