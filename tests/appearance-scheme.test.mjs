import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { contrastRatio, parseColour } from '../lib/colour.ts';
import { ROLE_TONES, schemeForSeed } from '../lib/appearance/token-scheme.mjs';

const pairs = [['on-primary', 'primary'], ['on-primary-container', 'primary-container'], ['on-secondary', 'secondary'], ['on-secondary-container', 'secondary-container'], ['on-tertiary', 'tertiary'], ['on-tertiary-container', 'tertiary-container'], ['on-error', 'error'], ['on-error-container', 'error-container'], ['on-surface', 'surface'], ['on-surface-variant', 'surface-variant']];
const colour = (value) => parseColour(value);

test('seeded schemes emit every Material role and preserve text contrast', () => {
  for (const seed of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#808080', '#ff00ff']) for (const dark of [false, true]) {
    const scheme = schemeForSeed(seed, dark);
    assert.equal(Object.keys(scheme).length, Object.keys(ROLE_TONES[dark ? 'dark' : 'light']).length);
    for (const [foreground, background] of pairs) assert.ok(contrastRatio(colour(scheme[`--md-sys-color-${foreground}`]), colour(scheme[`--md-sys-color-${background}`])) >= 4.5, `${seed} ${dark} ${foreground}`);
  }
});

test('only six #rrggbb source families can override a generated scheme', () => {
  const baseline = schemeForSeed('#ff0000', false);
  assert.deepEqual(schemeForSeed('#ff0000', false, { bad: '#00ff00', primary: 'red' }), baseline);
  assert.notEqual(schemeForSeed('#ff0000', false, { secondary: '#00ff00' })['--md-sys-color-secondary'], baseline['--md-sys-color-secondary']);
});

test('the generator consumes the shared core rather than retaining a second scheme algorithm', () => {
  const source = readFileSync(path.resolve('scripts/design/build-material-theme.mjs'), 'utf8');
  assert.match(source, /from '..\/..\/lib\/appearance\/token-scheme\.mjs'/);
  assert.doesNotMatch(source, /function toneAtHue|function toneOf|const roleTones|const TONES/);
});
