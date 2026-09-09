import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A custom property declared twice on the same selector is decided by load
 * order, not by whichever file you happen to have open.
 *
 * This is not hypothetical here. `globals.css` redeclared forty-six of the
 * generated theme's tokens with the previous palette's literal hex values, on
 * the very same `:root` and `html[data-theme='dark']` selectors, and it is
 * imported second - so every rule reading `--bg`, `--surface`, `--text`,
 * `--muted`, `--border` or `--primary` got the old colours. Nothing failed. The
 * build was clean, the generated theme was committed and correct, and the
 * generated theme was also almost entirely dead.
 *
 * So this asserts the two things that matter and cannot be seen by reading one
 * file: that the theme is imported first, and that nothing after it redeclares
 * a token it already owns on the same selector.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (file) => readFileSync(path.join(root, 'app', file), 'utf8').replace(/\r\n/g, '\n');

/**
 * Stylesheets in the order `app/layout.tsx` imports them. Hand-written: deriving
 * it from the layout would let a stylesheet added there escape this check by
 * being added to both at once, which is exactly the change that needs checking.
 */
const LOAD_ORDER = [
  'material-theme.css', 'globals.css', 'map-controls.css', 'transit-interface.css',
  'workspace.css', 'settings-workspace.css', 'journey-time.css', 'vehicle-preferences.css',
  'dim-sum.css', 'comfort.css', 'notifications.css', 'command-palette.css', 'catch-vehicle.css', 'shell.css',
];

/** Top-level rules as [selector, body], with comments stripped and at-rules skipped. */
function rules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  let depth = 0, start = 0, selector = '';
  for (let i = 0; i < clean.length; i += 1) {
    const character = clean[i];
    if (character === '{') {
      if (depth === 0) { selector = clean.slice(start, i).trim(); start = i + 1; }
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        // An at-rule's body holds further rules; its own braces are not declarations.
        if (!selector.startsWith('@')) found.push([selector, clean.slice(start, i)]);
        start = i + 1;
      }
    }
  }
  return found;
}

/** Custom properties declared directly in a rule body, by name. */
function declaredTokens(body) {
  if (body.includes('{')) return [];
  return body.split(';')
    .map((piece) => piece.trim())
    .filter((piece) => piece.startsWith('--') && piece.includes(':'))
    .map((piece) => piece.slice(0, piece.indexOf(':')).trim())
    .filter((name) => /^--[a-z0-9-]+$/i.test(name));
}

test('the generated theme is imported before every stylesheet that reads it', () => {
  const layout = readFileSync(path.join(root, 'app', 'layout.tsx'), 'utf8');
  const imported = [...layout.matchAll(/import '\.\/([a-z-]+\.css)'/g)].map((match) => match[1]);
  assert.equal(imported[0], 'material-theme.css', 'the design system must load first');
  for (const file of LOAD_ORDER) {
    assert.ok(imported.includes(file), `${file} is in the checked order but the layout never imports it`);
  }
  // A stylesheet the layout imports but this test does not know about is unchecked.
  const unchecked = imported.filter((file) => !LOAD_ORDER.includes(file));
  assert.deepEqual(unchecked, [], 'add it to LOAD_ORDER, or it is exempt from this check by accident');
});

test('nothing loaded after the theme redeclares a token the theme already owns', () => {
  const owned = new Map();
  for (const [selector, body] of rules(read('material-theme.css'))) {
    for (const name of declaredTokens(body)) {
      if (!owned.has(selector)) owned.set(selector, new Set());
      owned.get(selector).add(name);
    }
  }
  assert.ok(owned.size >= 2, 'the theme should own tokens on at least the light and dark selectors');

  const shadowed = [];
  for (const file of LOAD_ORDER.slice(1)) {
    for (const [selector, body] of rules(read(file))) {
      const ownedHere = owned.get(selector);
      if (!ownedHere) continue;
      for (const name of declaredTokens(body)) {
        if (ownedHere.has(name)) shadowed.push(`${file} redeclares ${name} on ${selector}`);
      }
    }
  }
  assert.deepEqual(shadowed, [], 'a redeclaration wins on load order and silently replaces the generated value');
});

test('no stylesheet hard-codes a hex colour on the selectors the theme owns', () => {
  // The palette lives in one generated file. A literal here is a value that
  // cannot follow the theme into the other scheme.
  const themed = new Set(rules(read('material-theme.css')).map(([selector]) => selector));
  const literals = [];
  for (const file of LOAD_ORDER.slice(1)) {
    for (const [selector, body] of rules(read(file))) {
      if (!themed.has(selector)) continue;
      for (const piece of body.split(';')) {
        const declaration = piece.trim();
        if (!declaration.startsWith('--')) continue;
        if (/#[0-9a-f]{3,8}\b/i.test(declaration)) literals.push(`${file}: ${selector} { ${declaration} }`);
      }
    }
  }
  assert.deepEqual(literals, [], 'put the colour in the generator, not in a stylesheet that loads after it');
});

test('the browser chrome colour still matches the generated surface roles', () => {
  // theme-color cannot read a custom property, so the two values in the layout
  // are copies. A copy of a generated value drifts the moment the generator runs
  // again, and nothing about a stale browser chrome colour looks wrong until you
  // put the two schemes side by side.
  const layout = readFileSync(path.join(root, 'app', 'layout.tsx'), 'utf8');
  const theme = read('material-theme.css');
  const surfaceIn = (selector) => {
    const rule = rules(theme).find(([name]) => name === selector);
    assert.ok(rule, `the theme has no ${selector} rule`);
    const match = rule[1].match(/--md-sys-color-surface:\s*(#[0-9a-f]{6})/i);
    assert.ok(match, `${selector} declares no surface colour`);
    return match[1].toLowerCase();
  };
  // Found by plain string search rather than a pattern. The literal parentheses
  // in a media query need escaping, and an escape that goes missing turns them
  // into a capture group that matches nothing, which reads as a failing check
  // rather than as a broken one.
  const declared = (scheme) => {
    const marker = `media="(prefers-color-scheme: ${scheme})" content="`;
    const at = layout.indexOf(marker);
    assert.notEqual(at, -1, `the layout declares no ${scheme} theme-color`);
    const value = layout.slice(at + marker.length, at + marker.length + 7);
    assert.match(value, /^#[0-9a-f]{6}$/i, `the ${scheme} theme-color is ${value}`);
    return value.toLowerCase();
  };
  assert.equal(declared('light'), surfaceIn(':root'), 'the light chrome colour is not the light surface');
  assert.equal(declared('dark'), surfaceIn("html[data-theme='dark']"), 'the dark chrome colour is not the dark surface');
});
