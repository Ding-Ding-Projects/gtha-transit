import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastReport } from '../scripts/design/build-material-theme.mjs';

/**
 * The design system, and the guards that keep it one.
 *
 * Before this the interface had no system underneath it: seventeen corner radii,
 * eighteen font sizes and four shadows, each invented by whichever component
 * needed one, and no Material tokens at all. These assertions exist so that
 * cannot quietly happen again - a component that needs a value it cannot find in
 * a scale is a component that will invent one.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const theme = readFileSync(path.join(root, 'app', 'material-theme.css'), 'utf8');
const shell = readFileSync(path.join(root, 'app', 'shell.css'), 'utf8');
const workspace = readFileSync(path.join(root, 'app', 'workspace.css'), 'utf8');
const layout = readFileSync(path.join(root, 'app', 'layout.tsx'), 'utf8');
const navigation = readFileSync(path.join(root, 'components', 'workspace-navigation.tsx'), 'utf8');
const destinations = readFileSync(path.join(root, 'lib', 'destinations.ts'), 'utf8');

/** The roles anything drawn on this interface is allowed to use. */
const REQUIRED_ROLES = [
  'primary', 'on-primary', 'primary-container', 'on-primary-container',
  'secondary', 'on-secondary', 'secondary-container', 'on-secondary-container',
  'tertiary', 'on-tertiary', 'tertiary-container', 'on-tertiary-container',
  'error', 'on-error', 'error-container', 'on-error-container',
  'surface', 'on-surface', 'surface-variant', 'on-surface-variant',
  'surface-container-lowest', 'surface-container-low', 'surface-container',
  'surface-container-high', 'surface-container-highest',
  'inverse-surface', 'inverse-on-surface', 'inverse-primary',
  'outline', 'outline-variant', 'scrim', 'shadow',
];

test('every colour role exists in both themes', () => {
  const light = theme.slice(theme.indexOf(':root'), theme.indexOf("html[data-theme='dark']"));
  const dark = theme.slice(theme.indexOf("html[data-theme='dark']"));
  for (const role of REQUIRED_ROLES) {
    assert.match(light, new RegExp(`--md-sys-color-${role}:\\s*#[0-9a-f]{6};`), `light is missing ${role}`);
    assert.match(dark, new RegExp(`--md-sys-color-${role}:\\s*#[0-9a-f]{6};`), `dark is missing ${role}`);
  }
});

test('every text pair meets the 4.5:1 minimum in both themes', () => {
  assert.deepEqual(contrastReport(), [], 'a theme nobody can read is not a theme');
});

/**
 * The delay-severity roles the live-status chip renders from.
 *
 * Hand-written, same as REQUIRED_ROLES above: a rule that only checks "every
 * role present is well-formed" would pass on a theme that never grew these
 * roles at all, because it never looked for them.
 */
const REQUIRED_STATUS_ROLES = ['early', 'on-time', 'late', 'very-late'];

test('every live-status role exists in both themes', () => {
  const light = theme.slice(theme.indexOf(':root'), theme.indexOf("html[data-theme='dark']"));
  const dark = theme.slice(theme.indexOf("html[data-theme='dark']"));
  for (const role of REQUIRED_STATUS_ROLES) {
    for (const suffix of ['container', 'on']) {
      assert.match(light, new RegExp(`--gt-status-${role}-${suffix}:\\s*#[0-9a-f]{6};`), `light is missing ${role}-${suffix}`);
      assert.match(dark, new RegExp(`--gt-status-${role}-${suffix}:\\s*#[0-9a-f]{6};`), `dark is missing ${role}-${suffix}`);
    }
  }
  // Cancelled retains the shipped error colours even when the editable palette changes; it
  // has fixed generated values rather than mutable role aliases.
  for (const suffix of ['container', 'on']) {
    assert.match(light, new RegExp(`--gt-status-cancelled-${suffix}:\\s*#[0-9a-f]{6};`), `light is missing cancelled-${suffix}`);
    assert.match(dark, new RegExp(`--gt-status-cancelled-${suffix}:\\s*#[0-9a-f]{6};`), `dark is missing cancelled-${suffix}`);
  }
});

test('the type, shape, elevation, state and motion scales are all present', () => {
  for (const size of ['display-large', 'headline-small', 'title-medium', 'body-medium', 'label-large', 'label-medium']) {
    assert.match(theme, new RegExp(`--md-sys-typescale-${size}:`), `missing type step ${size}`);
  }
  for (const corner of ['none', 'extra-small', 'small', 'medium', 'large', 'extra-large', 'full']) {
    assert.match(theme, new RegExp(`--md-sys-shape-corner-${corner}:`), `missing shape step ${corner}`);
  }
  for (let level = 0; level <= 5; level += 1) {
    assert.match(theme, new RegExp(`--md-sys-elevation-level${level}:`), `missing elevation level ${level}`);
  }
  assert.match(theme, /--md-sys-state-hover-opacity:/);
  assert.match(theme, /--md-sys-motion-easing-standard:/);
});

test('the legacy names still resolve, so an untouched rule still reads the system', () => {
  // Without this every rule would have to be rewritten in one commit to gain
  // anything. With it there is one source of truth either way.
  for (const legacy of ['--bg', '--surface', '--surface2', '--text', '--muted', '--border', '--primary', '--shadow']) {
    assert.match(theme, new RegExp(`\\${legacy}: var\\(--md-sys-`), `${legacy} must map onto a role`);
  }
});

test('nothing outside the generated theme hard-codes the palette', () => {
  // The shell describes a navigation surface that is brand ink rather than a
  // role, and says so. Everything else reads a token.
  const hexes = [...shell.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);
  assert.deepEqual(hexes, [], 'the shell must not name a colour directly');
  const workspaceHexes = [...workspace.matchAll(/--(?:bg|surface2?|text|muted|border|primary):\s*#/g)];
  assert.deepEqual(workspaceHexes.map((m) => m[0]), [], 'the palette lives in the generated theme');
});

test('the generated theme is committed exactly as the generator produces it', () => {
  // A hand-edited generated file drifts from its source the moment anyone runs
  // the generator again, and the edit is lost without a word.
  execFileSync(process.execPath, [path.join(root, 'scripts', 'design', 'build-material-theme.mjs'), '--check'], { cwd: root });
});

test('the design system loads before every stylesheet that reads it', () => {
  const themeAt = layout.indexOf("import './material-theme.css'");
  assert.ok(themeAt >= 0, 'the theme must be imported');
  for (const sheet of ['globals.css', 'workspace.css', 'shell.css']) {
    assert.ok(themeAt < layout.indexOf(`import './${sheet}'`), `${sheet} must load after the theme`);
  }
  // The shell owns the navigation, so it wins over anything older.
  assert.ok(layout.indexOf("import './shell.css'") > layout.indexOf("import './workspace.css'"));
});

test('navigation carries four destinations and a More, in one list', () => {
  // The list moved out to lib/destinations.ts when the command palette arrived,
  // because the rail, the More dialog, the workspace heading and the palette all
  // navigate to the same nine places and each was free to hold its own copy.
  // What this still guards is the shape: four on the phone bar, the rest behind
  // one More target, and the navigation reading the registry rather than growing
  // a second list beside it.
  const ids = [...destinations.matchAll(/\{ id: '([a-z]+)'[^}]*group: 'primary' \}/g)].map((match) => match[1]);
  assert.deepEqual(ids, ['plan', 'status', 'vehicles', 'saved'], 'four destinations earn a permanent place');
  assert.match(navigation, /aria-haspopup="dialog"/, 'the rest live behind one More target');
  assert.match(navigation, /^\s*const primary = primaryDestinations\(t\);$/m, 'the rail reads the registry');
  assert.match(navigation, /^\s*const secondary = secondaryDestinations\(t\);$/m, 'and so does the More dialog');
  assert.ok(!/const primary = \[/.test(navigation), 'a second inline list here is the drift the registry prevents');
});

test('the rail is the Material width, and the bar appears below the Material breakpoint', () => {
  assert.match(shell, /@media \(min-width: 905px\)/, 'the rail appears at the medium window class');
  // 84px is the design's rail. It was 80px, and 216px before that.
  assert.match(shell, /--workspace-rail: 84px/, 'the rail is the design width, not the old 216px list');
  assert.match(shell, /@media \(max-width: 904px\)/, 'below it the destinations move to a bottom bar');
  assert.match(shell, /padding-bottom: env\(safe-area-inset-bottom/, 'the bar clears the home indicator');
  assert.match(shell, /prefers-reduced-motion/, 'the indicator transition is opt-out');
});

test('no rule from the replaced navigation survives', () => {
  // A scratch redesign that leaves the old rules in place is two navigations
  // fighting over specificity, which is how the bar collapsed to one pixel.
  for (const dead of ['transit-navigation', 'navigation-caption', 'navigation-footer', 'nav-primary', 'nav-secondary']) {
    assert.ok(!workspace.includes(dead), `workspace.css still carries ${dead}`);
    assert.ok(!navigation.includes(dead), `the component still carries ${dead}`);
  }
});

test('a minimum target size is a system rule, not a per-component decision', () => {
  // Chasing this control by control is how the interface ended up with icon
  // buttons at 36px, pills at 42px and map controls at 30px - each reasonable
  // alone, none of them big enough.
  assert.match(shell, /:where\(button, summary, select, \[role='button'\], \[role='tab'\]\) \{\s*min-height: 44px;\s*min-width: 44px;/);
  assert.match(shell, /input:not\(\[type='checkbox'\]\)/, 'a text input is a target too');
  assert.match(shell, /:where\(label\):has\(> :where\(input\[type='checkbox'\], input\[type='radio'\]\)\)/, 'the label around a checkbox is the real target');
  assert.match(shell, /leaflet-bar a \{\s*width: 44px;/, 'a third-party default is not an exemption');
  assert.match(shell, /is-inline-target/, 'a deliberately inline control can say so');
});

test('the target rule records why an inline link is exempt', () => {
  // Measuring without the exemption reported 52 failures on one screen where
  // there were three, and "fixing" the 49 would have been 49 wrong changes.
  assert.match(shell, /WCAG 2\.5\.8/);
  assert.match(shell, /inline link inside a sentence/);
});

/**
 * Rules allowed to set a minimum below 44px, and why.
 *
 * A hand-written list, because a rule alone cannot tell a control from a label:
 * it would pass on a file with no minimums at all, and fail on a badge that was
 * never a target. Each entry is a decision someone made on purpose.
 */
const NOT_TARGETS = [
  ['.route-picker-badge', 'a route badge is a label, not something you press'],
];

test('no stylesheet still sets an interactive minimum below 44px', () => {
  // The 40px minimums were everywhere and each looked fine in isolation.
  for (const [name, css] of [['globals', readFileSync(path.join(root, 'app', 'globals.css'), 'utf8')],
                             ['workspace', workspace],
                             ['shell', shell]]) {
    const offenders = css.split(/\r?\n/)
      .filter((line) => {
        const match = /min-height:\s*(\d+)px/.exec(line);
        if (!match) return false;
        const value = Number(match[1]);
        if (value < 24 || value >= 44) return false;
        return !NOT_TARGETS.some(([selector]) => line.includes(selector));
      })
      .map((line) => line.trim().slice(0, 60));
    assert.deepEqual(offenders, [], `${name}.css sets an interactive minimum below 44px`);
  }
});

test('every exemption from the target minimum is named and reasoned', () => {
  // An exemption nobody wrote a reason for is a hole nobody decided on.
  for (const [selector, reason] of NOT_TARGETS) {
    assert.ok(selector.startsWith('.'), 'an exemption names an exact selector');
    assert.ok(reason.length > 20, `${selector} needs a reason, not a shrug`);
  }
});
