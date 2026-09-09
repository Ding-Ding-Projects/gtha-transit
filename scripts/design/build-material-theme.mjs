/**
 * Generate the Material Design 3 token layer from this project's own brand colours.
 *
 * The interface had no design system underneath it: seventeen different corner
 * radii, eighteen font sizes and four shadows, each invented by whichever
 * component needed one. This produces the scales those should have come from.
 *
 * **Tones are generated in OKLCH, not HCT.** Material's own tonal palettes are
 * built in HCT, and this is not that: it is a perceptually uniform space with the
 * same tone numbering and the same role mapping, solved for CIE L* so a tone
 * number means the lightness Material says it means. Where the two differ it is
 * in chroma handling at the extremes. Saying so is the point - a palette that
 * claims to be HCT and is not would mislead anyone comparing it against the spec.
 *
 * Every role pair that carries text is contrast-checked against the WCAG ratio
 * Material requires, and a failure stops the build rather than shipping a theme
 * nobody can read.
 *
 * Usage: node scripts/design/build-material-theme.mjs [--check]
 *   --check verifies the committed file matches what this would generate.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inGamut, oklabToOklch, oklabToRgbTriple, oklchToOklab, toLinear, tripleToOklab } from '../../lib/colour.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.resolve(here, '..', '..', 'app', 'material-theme.css');
const checkOnly = process.argv.includes('--check');

/**
 * The source colours, read off the owner's own design export in
 * `design/reference/GTHA Transit Redesign v2.dc.html`.
 *
 * A source contributes its hue and its chroma ceiling and nothing else - its own
 * lightness is discarded, because every tone is solved for the CIE L* the tone
 * number names. So `#ffb545` is not "the amber" so much as the amber's hue at the
 * saturation the design asked for, and tone 80 of it lands within five units of
 * the value the design actually writes down.
 *
 * Tertiary is the outgoing teal. The design is a single-accent system and names
 * no chrome tertiary, but the role has to be something, and a hue the project
 * already owned beats one invented here. It must not be green or red, which
 * belong to on-time and delayed, nor any agency's colour.
 *
 * A source may name one colour or one per scheme. The design deliberately runs
 * warm paper by day and blue ink by night; that is two hues, not two lightnesses
 * of one, and a single tonal palette cannot express it.
 */
const SOURCES = {
  primary: '#ffb545',
  secondary: '#8a7355',
  tertiary: '#006b68',
  neutral: { light: '#5c5a52', dark: '#243248' },
  neutralVariant: { light: '#5f5b4f', dark: '#28364c' },
  error: '#ba1a1a',
};

/**
 * Delay-severity hues for the live-status chip, solved through the identical
 * OKLCH tone path as every role above.
 *
 * These are bare hues rather than hex swatches, because nothing in the design
 * export owns a swatch for "three minutes late" - the hue is chosen directly
 * and given a chroma ceiling in the same neighbourhood as the other sources
 * (compare `primary` at C 0.150 and `error` at C 0.193). Cancelled is not a
 * hue of its own: it borrows the error role outright, because "cancelled"
 * already means what error means everywhere else in this theme, and giving it
 * a second red would only invite the two to drift apart.
 */
const STATUS_SOURCES = {
  early: { hue: 250, chroma: 0.15 },
  'on-time': { hue: 145, chroma: 0.15 },
  late: { hue: 75, chroma: 0.16 },
  'very-late': { hue: 25, chroma: 0.18 },
};

/** Material's tone stops. A tone number is a lightness, not a shade name. */
const TONES = [0, 4, 6, 10, 12, 17, 20, 22, 24, 30, 40, 50, 60, 70, 80, 87, 90, 92, 94, 95, 96, 98, 99, 100];

// ---------------------------------------------------------------------------
// Colour conversion. sRGB <-> linear <-> XYZ <-> OKLab <-> OKLCH, plus CIE L*.
// ---------------------------------------------------------------------------

const clamp01 = (value) => Math.min(1, Math.max(0, value));

function hexToRgb(hex) {
  const text = hex.replace('#', '');
  return [0, 2, 4].map((at) => parseInt(text.slice(at, at + 2), 16) / 255);
}

/*
 * The conversions come from lib/colour.ts rather than being repeated here.
 *
 * They were repeated here, and the colour picker was about to become a second
 * copy of the same matrices. Two implementations of a colour space agree right
 * up until one of them is corrected, and then they disagree silently: the
 * generated theme and the picker showing you that theme would describe the same
 * colour differently, and nothing would fail. One of the copies already had a
 * D50 white point paired with a D65 matrix.
 *
 * `oklabToRgb` keeps its name here because that is what the generator calls it;
 * it is the shared function, which returns gamma-encoded channels in 0..1.
 */
const oklabToRgb = oklabToRgbTriple;
const rgbToOklab = tripleToOklab;

/** CIE L*, the lightness a Material tone number names. */
function cieLightness([red, green, blue]) {
  const y = 0.2126729 * toLinear(red) + 0.7151522 * toLinear(green) + 0.0721750 * toLinear(blue);
  return y <= 216 / 24389 ? y * (24389 / 27) : 116 * Math.cbrt(y) - 16;
}

/**
 * One tone of a palette: the source hue at the requested lightness.
 *
 * Chroma is reduced only as far as the gamut demands, which is what keeps a tone
 * recognisably the brand colour rather than drifting grey the moment it is asked
 * for something light or dark.
 */
/**
 * One tone at a bare hue and chroma ceiling, with no swatch behind it.
 *
 * This is the body `toneOf` always had; a source colour and a bare hue meet
 * here once the hue and the chroma ceiling are known, so the two ways of
 * naming a colour cannot solve tones differently.
 */
function toneAtHue(hue, sourceChroma, tone) {
  if (tone <= 0) return '#000000';
  if (tone >= 100) return '#ffffff';
  // Solve OKLab lightness for the CIE L* the tone number names.
  let low = 0;
  let high = 1;
  for (let step = 0; step < 40; step += 1) {
    const middle = (low + high) / 2;
    const rgb = oklabToRgb(oklchToOklab([middle, 0, hue])).map(clamp01);
    if (cieLightness(rgb) < tone) low = middle; else high = middle;
  }
  const lightness = (low + high) / 2;
  // Then take as much chroma as this lightness can actually hold.
  let usable = 0;
  let tooMuch = Math.max(sourceChroma, 0.0001) * 1.2;
  for (let step = 0; step < 30; step += 1) {
    const middle = (usable + tooMuch) / 2;
    if (inGamut(oklabToRgb(oklchToOklab([lightness, middle, hue])))) usable = middle; else tooMuch = middle;
  }
  const rgb = oklabToRgb(oklchToOklab([lightness, Math.min(usable, sourceChroma), hue])).map(clamp01);
  return '#' + rgb.map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0')).join('');
}

export function toneOf(sourceHex, tone) {
  const [, sourceChroma, hue] = oklabToOklch(rgbToOklab(hexToRgb(sourceHex)));
  return toneAtHue(hue, sourceChroma, tone);
}

export const palette = (sourceHex) => Object.fromEntries(TONES.map((tone) => [tone, toneOf(sourceHex, tone)]));

/** One full status palette per delay-severity hue, at the same tone stops as every other source. */
const statusPalettes = Object.fromEntries(
  Object.entries(STATUS_SOURCES).map(([name, { hue, chroma }]) => [
    name,
    Object.fromEntries(TONES.map((tone) => [tone, toneAtHue(hue, chroma, tone)])),
  ]),
);

const sourceFor = (source, scheme) => (typeof source === 'string' ? source : source[scheme]);

/** One full set of palettes per scheme, because a source may differ between them. */
const palettes = Object.fromEntries(['light', 'dark'].map((scheme) => [
  scheme,
  Object.fromEntries(Object.entries(SOURCES).map(([name, source]) => [name, palette(sourceFor(source, scheme))])),
]));

// ---------------------------------------------------------------------------
// Role mapping. These tone assignments are Material's, not chosen here.
// ---------------------------------------------------------------------------

const roleTones = {
  light: {
    primary: ['primary', 40], 'on-primary': ['primary', 100],
    'primary-container': ['primary', 90], 'on-primary-container': ['primary', 30],
    secondary: ['secondary', 40], 'on-secondary': ['secondary', 100],
    'secondary-container': ['secondary', 90], 'on-secondary-container': ['secondary', 30],
    tertiary: ['tertiary', 40], 'on-tertiary': ['tertiary', 100],
    'tertiary-container': ['tertiary', 90], 'on-tertiary-container': ['tertiary', 30],
    error: ['error', 40], 'on-error': ['error', 100],
    'error-container': ['error', 90], 'on-error-container': ['error', 30],
    surface: ['neutral', 98], 'on-surface': ['neutral', 10],
    'surface-variant': ['neutralVariant', 90], 'on-surface-variant': ['neutralVariant', 30],
    'surface-dim': ['neutral', 87], 'surface-bright': ['neutral', 98],
    'surface-container-lowest': ['neutral', 100], 'surface-container-low': ['neutral', 96],
    'surface-container': ['neutral', 94], 'surface-container-high': ['neutral', 92],
    'surface-container-highest': ['neutral', 90],
    'inverse-surface': ['neutral', 20], 'inverse-on-surface': ['neutral', 95],
    'inverse-primary': ['primary', 80],
    outline: ['neutralVariant', 50], 'outline-variant': ['neutralVariant', 80],
    scrim: ['neutral', 0], shadow: ['neutral', 0],
  },
  dark: {
    primary: ['primary', 80], 'on-primary': ['primary', 20],
    'primary-container': ['primary', 30], 'on-primary-container': ['primary', 90],
    secondary: ['secondary', 80], 'on-secondary': ['secondary', 20],
    'secondary-container': ['secondary', 30], 'on-secondary-container': ['secondary', 90],
    tertiary: ['tertiary', 80], 'on-tertiary': ['tertiary', 20],
    'tertiary-container': ['tertiary', 30], 'on-tertiary-container': ['tertiary', 90],
    error: ['error', 80], 'on-error': ['error', 20],
    'error-container': ['error', 30], 'on-error-container': ['error', 90],
    surface: ['neutral', 6], 'on-surface': ['neutral', 90],
    'surface-variant': ['neutralVariant', 30], 'on-surface-variant': ['neutralVariant', 80],
    'surface-dim': ['neutral', 6], 'surface-bright': ['neutral', 24],
    'surface-container-lowest': ['neutral', 4], 'surface-container-low': ['neutral', 10],
    'surface-container': ['neutral', 12], 'surface-container-high': ['neutral', 17],
    'surface-container-highest': ['neutral', 22],
    'inverse-surface': ['neutral', 90], 'inverse-on-surface': ['neutral', 20],
    'inverse-primary': ['primary', 40],
    outline: ['neutralVariant', 60], 'outline-variant': ['neutralVariant', 30],
    scrim: ['neutral', 0], shadow: ['neutral', 0],
  },
};

const roleValue = (scheme, role) => {
  const [source, tone] = roleTones[scheme][role];
  return palettes[scheme][source][tone];
};

// ---------------------------------------------------------------------------
// Contrast. A theme nobody can read is not a theme.
// ---------------------------------------------------------------------------

function relativeLuminance([red, green, blue]) {
  return 0.2126 * toLinear(red) + 0.7152 * toLinear(green) + 0.0722 * toLinear(blue);
}

function contrastRatio(foreground, background) {
  const first = relativeLuminance(hexToRgb(foreground));
  const second = relativeLuminance(hexToRgb(background));
  const [lighter, darker] = first > second ? [first, second] : [second, first];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Every pair where one role is drawn on the other. 4.5 is the text minimum. */
const CONTRAST_PAIRS = [
  ['on-primary', 'primary'], ['on-primary-container', 'primary-container'],
  ['on-secondary', 'secondary'], ['on-secondary-container', 'secondary-container'],
  ['on-tertiary', 'tertiary'], ['on-tertiary-container', 'tertiary-container'],
  ['on-error', 'error'], ['on-error-container', 'error-container'],
  ['on-surface', 'surface'], ['on-surface-variant', 'surface-variant'],
  ['on-surface', 'surface-container'], ['on-surface', 'surface-container-high'],
  ['on-surface', 'surface-container-highest'], ['on-surface', 'surface-container-low'],
  ['on-surface', 'surface-container-lowest'],
  ['inverse-on-surface', 'inverse-surface'],
];
const MINIMUM_TEXT_CONTRAST = 4.5;

export function contrastReport() {
  const failures = [];
  for (const scheme of ['light', 'dark']) {
    for (const [foreground, background] of CONTRAST_PAIRS) {
      const ratio = contrastRatio(roleValue(scheme, foreground), roleValue(scheme, background));
      if (ratio < MINIMUM_TEXT_CONTRAST) {
        failures.push(`${scheme}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1`);
      }
    }
  }
  // The status container/on pair swaps which tone is which between schemes, but it
  // is the same two colours either way, so one check covers both directions.
  for (const name of Object.keys(STATUS_SOURCES)) {
    const ratio = contrastRatio(statusPalettes[name][30], statusPalettes[name][90]);
    if (ratio < MINIMUM_TEXT_CONTRAST) {
      failures.push(`status: ${name} on-status over ${name}-container is ${ratio.toFixed(2)}:1`);
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// The emitted stylesheet.
// ---------------------------------------------------------------------------

const roleBlock = (scheme) => Object.keys(roleTones[scheme])
  .map((role) => `  --md-sys-color-${role}: ${roleValue(scheme, role)};`)
  .join('\n');

/**
 * The delay-severity roles the live-status chip renders from.
 *
 * Light reads the light-container/dark-on pairing every other container role
 * already uses (compare `error-container`/`on-error-container` above); dark
 * swaps which tone is the container and which is the text, exactly as dark
 * mode swaps it for every other role.
 */
const statusBlock = (scheme) => {
  const containerTone = scheme === 'light' ? 90 : 30;
  const onTone = scheme === 'light' ? 30 : 90;
  return Object.keys(STATUS_SOURCES)
    .map((name) => `  --gt-status-${name}-container: ${statusPalettes[name][containerTone]};\n  --gt-status-${name}-on: ${statusPalettes[name][onTone]};`)
    .join('\n');
};

/** Cancelled borrows the error role outright, so it is an alias rather than a tone. */
const STATUS_CANCELLED = `  --gt-status-cancelled-container: var(--md-sys-color-error-container);
  --gt-status-cancelled-on: var(--md-sys-color-on-error-container);`;

/**
 * The legacy names every existing rule still uses, mapped onto the roles.
 *
 * Without this the whole interface would have to be rewritten in one commit to
 * gain anything. With it, a rule that has not been touched yet still renders from
 * the design system, and a rule that has been touched reads from the role
 * directly. There is one source of truth either way.
 */
const LEGACY = `  --bg: var(--md-sys-color-surface-container-low);
  --surface: var(--md-sys-color-surface-container-lowest);
  --surface2: var(--md-sys-color-surface-container-high);
  --text: var(--md-sys-color-on-surface);
  --muted: var(--md-sys-color-on-surface-variant);
  --border: var(--md-sys-color-outline-variant);
  --primary: var(--md-sys-color-primary);
  --shadow: var(--md-sys-elevation-level1);`;

const stylesheet = `/* Generated by scripts/design/build-material-theme.mjs. Do not edit by hand.
   Run \`node scripts/design/build-material-theme.mjs\` after changing a source
   colour, and \`--check\` in CI to prove the committed file still matches.

   Tones are solved in OKLCH for the CIE L* each Material tone number names. That
   is not HCT, which Material itself uses; the numbering and role mapping are the
   same and the chroma handling at the extremes differs. */

:root {
${roleBlock('light')}

  /* Delay-severity roles the live-status chip renders from. Solved through the
     identical OKLCH tone path as every role above, at hues no source colour
     owns: early is blue, on time is green, late is amber, very late is red. */
${statusBlock('light')}
${STATUS_CANCELLED}

  /* Type scale. Every size the interface uses comes from here. */
  --md-sys-typescale-display-large: 700 57px/64px var(--md-ref-typeface-brand);
  --md-sys-typescale-display-medium: 700 45px/52px var(--md-ref-typeface-brand);
  --md-sys-typescale-display-small: 700 36px/44px var(--md-ref-typeface-brand);
  --md-sys-typescale-headline-large: 700 32px/40px var(--md-ref-typeface-brand);
  --md-sys-typescale-headline-medium: 700 28px/36px var(--md-ref-typeface-brand);
  --md-sys-typescale-headline-small: 700 24px/32px var(--md-ref-typeface-brand);
  --md-sys-typescale-title-large: 700 22px/28px var(--md-ref-typeface-brand);
  --md-sys-typescale-title-medium: 600 16px/24px var(--md-ref-typeface-plain);
  --md-sys-typescale-title-small: 600 14px/20px var(--md-ref-typeface-plain);
  --md-sys-typescale-body-large: 400 16px/24px var(--md-ref-typeface-plain);
  --md-sys-typescale-body-medium: 400 14px/20px var(--md-ref-typeface-plain);
  --md-sys-typescale-body-small: 400 12px/16px var(--md-ref-typeface-plain);
  --md-sys-typescale-label-large: 600 14px/20px var(--md-ref-typeface-plain);
  --md-sys-typescale-label-medium: 600 12px/16px var(--md-ref-typeface-plain);
  --md-sys-typescale-label-small: 600 11px/16px var(--md-ref-typeface-plain);
  /* The design's faces, vendored locally under public/fonts. The CJK fallbacks
     stay in the stack because neither Latin face covers Traditional Chinese, and
     bilingual mode puts both scripts on the same line. */
  --md-ref-typeface-brand: 'Space Grotesk', 'Segoe UI', 'Microsoft JhengHei', sans-serif;
  --md-ref-typeface-plain: 'Space Grotesk', 'Segoe UI', 'Microsoft JhengHei', sans-serif;
  --md-ref-typeface-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

  /* Shape scale. Seventeen ad-hoc radii collapse to these seven. */
  --md-sys-shape-corner-none: 0;
  --md-sys-shape-corner-extra-small: 4px;
  --md-sys-shape-corner-small: 8px;
  --md-sys-shape-corner-medium: 12px;
  --md-sys-shape-corner-large: 16px;
  --md-sys-shape-corner-extra-large: 28px;
  --md-sys-shape-corner-full: 9999px;

  /* Elevation. A shadow means a height, not a decoration. */
  --md-sys-elevation-level0: none;
  --md-sys-elevation-level1: 0 1px 2px 0 rgb(0 0 0 / .30), 0 1px 3px 1px rgb(0 0 0 / .15);
  --md-sys-elevation-level2: 0 1px 2px 0 rgb(0 0 0 / .30), 0 2px 6px 2px rgb(0 0 0 / .15);
  --md-sys-elevation-level3: 0 4px 8px 3px rgb(0 0 0 / .15), 0 1px 3px 0 rgb(0 0 0 / .30);
  --md-sys-elevation-level4: 0 6px 10px 4px rgb(0 0 0 / .15), 0 2px 3px 0 rgb(0 0 0 / .30);
  --md-sys-elevation-level5: 0 8px 12px 6px rgb(0 0 0 / .15), 0 4px 4px 0 rgb(0 0 0 / .30);

  /* State layers. An interaction is the same weight everywhere it happens. */
  --md-sys-state-hover-opacity: .08;
  --md-sys-state-focus-opacity: .12;
  --md-sys-state-pressed-opacity: .12;
  --md-sys-state-dragged-opacity: .16;
  --md-sys-state-disabled-content-opacity: .38;
  --md-sys-state-disabled-container-opacity: .12;

  /* Motion. Reduced motion is honoured separately, at the point of use. */
  --md-sys-motion-duration-short: 150ms;
  --md-sys-motion-duration-medium: 300ms;
  --md-sys-motion-duration-long: 450ms;
  --md-sys-motion-easing-standard: cubic-bezier(.2, 0, 0, 1);
  --md-sys-motion-easing-emphasized: cubic-bezier(.2, 0, 0, 1);
  --md-sys-motion-easing-decelerate: cubic-bezier(0, 0, 0, 1);

${LEGACY}
}

html[data-theme='dark'] {
${roleBlock('dark')}

${statusBlock('dark')}
${STATUS_CANCELLED}

${LEGACY}
}
`;

/**
 * Importing this module must not write anything.
 *
 * It did, and the cost was invisible: a test that imports `contrastReport` also
 * ran the generator, which regenerated the stylesheet before the assertions read
 * it. Every guard over that file passed no matter what was done to it, because
 * the file had been put back a moment earlier.
 */
const runningDirectly = process.argv[1] && process.argv[1].endsWith('build-material-theme.mjs');

if (!runningDirectly) {
  // Imported for its exports only.
} else if (checkOnly) {
  const failures = contrastReport();
  if (failures.length) { console.error('contrast failures:\n' + failures.join('\n')); process.exit(1); }
  const committed = readFileSync(OUTPUT, 'utf8').replace(/\r\n/g, '\n');
  if (committed !== stylesheet) {
    console.error('app/material-theme.css does not match the generator. Run: node scripts/design/build-material-theme.mjs');
    process.exit(1);
  }
  console.log('material theme is current, and every text pair meets 4.5:1');
} else {
  const failures = contrastReport();
  if (failures.length) { console.error('contrast failures:\n' + failures.join('\n')); process.exit(1); }
  writeFileSync(OUTPUT, stylesheet.replace(/\n/g, '\r\n'));
  console.log(`wrote ${OUTPUT}`);
  console.log(`${Object.keys(roleTones.light).length} colour roles per scheme, ${CONTRAST_PAIRS.length} text pairs checked in both`);
}
