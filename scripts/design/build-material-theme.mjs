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
import { toLinear } from '../../lib/colour.ts';
import { palette, ROLE_TONES, schemeForSeed, SHIPPED_SOURCES, toneAtHue, toneOf, TONES } from '../../lib/appearance/token-scheme.mjs';

// Keep this script's public helpers stable for existing test imports while the
// browser-safe module becomes the shared API for runtime appearance overrides.
export { palette, ROLE_TONES, schemeForSeed, SHIPPED_SOURCES, toneAtHue, toneOf, TONES };

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
const SOURCES = SHIPPED_SOURCES;

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

function hexToRgb(hex) {
  const text = hex.replace('#', '');
  return [0, 2, 4].map((at) => parseInt(text.slice(at, at + 2), 16) / 255);
}

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

const roleValue = (scheme, role) => {
  const [source, tone] = ROLE_TONES[scheme][role];
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

const roleBlock = (scheme) => Object.keys(ROLE_TONES[scheme])
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
const statusCancelled = scheme => `  --gt-status-cancelled-container: ${roleValue(scheme, 'error-container')};
  --gt-status-cancelled-on: ${roleValue(scheme, 'on-error-container')};`;

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
${statusCancelled('light')}

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
${statusCancelled('dark')}

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
  console.log(`${Object.keys(ROLE_TONES.light).length} colour roles per scheme, ${CONTRAST_PAIRS.length} text pairs checked in both`);
}
