import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PALETTE_SIZES,
  SHIPPED_PALETTE_SIZE,
  isPaletteShortcut,
  movePaletteFocus,
  normalizePaletteSize,
  paletteEntries,
  paletteGroups,
  paletteSample,
  paletteSamples,
  sectionGlyph,
  sectionLabel,
  settingKeywords,
  workspaceActions,
} from '../lib/command-palette.ts';
import { destinationHeading, primaryDestinations, secondaryDestinations, workspaceDestinations } from '../lib/destinations.ts';
import { NARRATOR_LANGUAGES, SETTINGS_SECTIONS, settingsCatalog, voiceUnavailability, voicesForLanguage } from '../lib/settings-catalog.ts';
import { plainTextMatches } from '../lib/search-workbench.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/** English mode, so an assertion reads as the sentence a person would see. */
const t = (en) => en;

function narrator(overrides = {}) {
  return {
    settings: {
      enabled: true,
      language: 'en',
      englishVoiceURI: '',
      cantoneseVoiceURI: '',
      rate: 1,
      pitch: 1,
      quiet: false,
      ...(overrides.settings ?? {}),
    },
    updateSettings: overrides.updateSettings ?? (() => {}),
    speechAvailable: overrides.speechAvailable ?? true,
    voices: overrides.voices ?? [
      { voiceURI: 'uri-en', name: 'Emma', lang: 'en-CA' },
      { voiceURI: 'uri-zh', name: '小明', lang: 'zh-HK' },
    ],
    voicesLoaded: overrides.voicesLoaded ?? true,
  };
}

function catalog(overrides = {}) {
  const calls = [];
  const entries = settingsCatalog({
    t,
    lang: overrides.lang ?? 'en',
    setLang: (value) => calls.push(['lang', value]),
    dark: overrides.dark ?? false,
    setDark: (value) => calls.push(['dark', value]),
    funEn: overrides.funEn ?? 5,
    setFunEn: (value) => calls.push(['funEn', value]),
    funZh: overrides.funZh ?? 5,
    setFunZh: (value) => calls.push(['funZh', value]),
    narrator: overrides.narrator ?? narrator({ updateSettings: (patch) => calls.push(['narrator', patch]) }),
  });
  return { entries, calls };
}

function palette(overrides = {}) {
  const { entries, calls } = catalog(overrides);
  const rows = paletteEntries({
    t,
    destinations: workspaceDestinations(t),
    settings: entries,
    actions: workspaceActions({
      t,
      dark: overrides.dark ?? false,
      setDark: (value) => calls.push(['dark', value]),
      setFunEn: (value) => calls.push(['funEn', value]),
      setFunZh: (value) => calls.push(['funZh', value]),
    }),
  });
  return { rows, settings: entries, calls };
}

/* ------------------------------------------------------------ the shortcut -- */

test('Ctrl+Shift+F opens the palette, and its near neighbours do not', () => {
  assert.equal(isPaletteShortcut({ key: 'F', ctrlKey: true, shiftKey: true }), true);
  // Shift makes it an uppercase F, so a case-sensitive comparison would never fire.
  assert.equal(isPaletteShortcut({ key: 'f', ctrlKey: true, shiftKey: true }), true);
  // A non-Latin layout reports a different key and the same physical code.
  assert.equal(isPaletteShortcut({ key: 'ф', code: 'KeyF', ctrlKey: true, shiftKey: true }), true);
  assert.equal(isPaletteShortcut({ key: 'F', metaKey: true, shiftKey: true }), true, 'the Mac equivalent');

  assert.equal(isPaletteShortcut({ key: 'f', ctrlKey: true }), false, 'Ctrl+F belongs to the browser');
  assert.equal(isPaletteShortcut({ key: 'f', shiftKey: true }), false, 'Shift+F is typing');
  assert.equal(isPaletteShortcut({ key: 'g', ctrlKey: true, shiftKey: true }), false);
  assert.equal(isPaletteShortcut({ key: 'f', ctrlKey: true, shiftKey: true, altKey: true }), false, 'Alt makes it another chord');
  assert.equal(isPaletteShortcut({ ctrlKey: true, shiftKey: true }), false, 'a modifier alone is not the shortcut');
});

/* --------------------------------------------------------------- the sizes -- */

test('the palette ships bounded and remembers only a size it recognises', () => {
  assert.deepEqual([...PALETTE_SIZES], ['card', 'full']);
  assert.equal(SHIPPED_PALETTE_SIZE, 'card');
  assert.equal(normalizePaletteSize('full'), 'full');
  assert.equal(normalizePaletteSize('card'), 'card');
  // Anything a hand-edited store or an older version could hold falls back rather than breaking layout.
  for (const junk of [null, undefined, '', 'FULL', 'window', 0, {}, []]) {
    assert.equal(normalizePaletteSize(junk), 'card', `${JSON.stringify(junk)} is not a size`);
  }
});

/* ------------------------------------------------------------- the sources -- */

test('every destination the navigation renders is reachable from the palette', () => {
  const destinations = workspaceDestinations(t);
  const { rows } = palette();
  const rowIds = rows.filter((row) => row.kind === 'destination').map((row) => row.tab);
  assert.deepEqual(rowIds, destinations.map((destination) => destination.id));
  assert.equal(destinations.length, 9, 'nine destinations, primary and secondary together');
  // The split is about phone width, and both halves are in the palette.
  assert.equal(primaryDestinations(t).length, 4);
  assert.equal(secondaryDestinations(t).length, 5);
  assert.equal(primaryDestinations(t).length + secondaryDestinations(t).length, destinations.length);
});

test('every setting the settings workspace renders is reachable from the palette', () => {
  const { rows, settings } = palette();
  const settingRows = rows.filter((row) => row.kind === 'setting');
  assert.equal(settingRows.length, settings.length);
  for (const setting of settings) {
    const row = settingRows.find((candidate) => candidate.id === 'setting:' + setting.id);
    assert.ok(row, `${setting.id} has no palette row`);
    assert.equal(row.tab, 'settings', 'a setting row lands on the settings destination');
    assert.equal(row.selector, setting.selector, 'and on the control itself, not the page holding it');
  }
});

test('the catalog covers every settings section, and every entry names a real one', () => {
  const { entries } = catalog();
  const sections = new Set(entries.map((entry) => entry.section));
  for (const section of SETTINGS_SECTIONS) {
    assert.ok(sections.has(section), `${section} has no settings, so its tab would be empty`);
  }
  for (const entry of entries) {
    assert.ok(SETTINGS_SECTIONS.includes(entry.section), `${entry.id} claims section ${entry.section}`);
    assert.ok(entry.selector.length > 1, `${entry.id} has no selector to teleport to`);
    assert.ok(entry.label.length > 0 && entry.description.length > 0, `${entry.id} is unlabelled`);
  }
});

/* -------------------------------------------------------- the real setters -- */

test('a palette control changes the value through the settings surface own setter', () => {
  const { rows, calls } = palette();
  const byId = new Map(rows.map((row) => [row.id, row]));

  byId.get('setting:theme').setting.control.apply('dark');
  byId.get('setting:language').setting.control.apply('zh');
  byId.get('setting:english-tone').setting.control.apply(2);
  byId.get('setting:cantonese-tone').setting.control.apply(3);
  byId.get('setting:narration').setting.control.apply(false);
  byId.get('setting:quiet').setting.control.apply(true);

  assert.deepEqual(calls, [
    ['dark', true],
    ['lang', 'zh'],
    ['funEn', 2],
    ['funZh', 3],
    ['narrator', { enabled: false }],
    ['narrator', { quiet: true }],
  ]);
});

test('the narration language control refuses a value the narrator does not understand', () => {
  const { rows, calls } = palette();
  const control = rows.find((row) => row.id === 'setting:narration-language').setting.control;
  for (const language of NARRATOR_LANGUAGES) control.apply(language);
  control.apply('klingon');
  assert.deepEqual(calls, NARRATOR_LANGUAGES.map((language) => ['narrator', { language }]));
});

test('the actions run the same setters, and the theme action follows the current theme', () => {
  const light = palette({ dark: false });
  light.rows.find((row) => row.id === 'action:toggle-theme').run();
  assert.deepEqual(light.calls, [['dark', true]]);
  assert.match(light.rows.find((row) => row.id === 'action:toggle-theme').label, /dark theme/);

  const dark = palette({ dark: true });
  dark.rows.find((row) => row.id === 'action:toggle-theme').run();
  assert.deepEqual(dark.calls, [['dark', false]]);
  assert.match(dark.rows.find((row) => row.id === 'action:toggle-theme').label, /light theme/);

  const reset = palette({ funEn: 1, funZh: 1 });
  reset.rows.find((row) => row.id === 'action:reset-english-tone').run();
  reset.rows.find((row) => row.id === 'action:reset-cantonese-tone').run();
  assert.deepEqual(reset.calls, [['funEn', 5], ['funZh', 5]]);
});

/* ------------------------------------------------- what cannot be operated -- */

test('a control that cannot be operated says which condition is unmet', () => {
  const silent = catalog({ narrator: narrator({ speechAvailable: false }) });
  const narration = silent.entries.find((entry) => entry.id === 'narration');
  assert.match(narration.unavailable, /does not provide speech synthesis/);

  const off = catalog({ narrator: narrator({ settings: { enabled: false } }) });
  assert.match(off.entries.find((entry) => entry.id === 'rate').unavailable, /Turn narration on/);
  assert.equal(off.entries.find((entry) => entry.id === 'english-voice').control.kind, 'none');

  const ready = catalog();
  for (const id of ['rate', 'pitch', 'quiet', 'narration-language']) {
    assert.equal(ready.entries.find((entry) => entry.id === id).unavailable, undefined, `${id} is operable`);
  }
});

test('the voice gap names the actual reason rather than the first one', () => {
  const gap = (overrides, language) => voiceUnavailability(narrator(overrides), t, language);
  assert.match(gap({ speechAvailable: false }, 'en'), /speech synthesis/);
  assert.match(gap({ settings: { enabled: false } }, 'en'), /Turn narration on/);
  assert.match(gap({ voicesLoaded: false }, 'en'), /still loading/);
  assert.match(gap({ voices: [{ voiceURI: 'z', name: '小明', lang: 'zh-HK' }] }, 'en'), /No English voice/);
  assert.match(gap({ voices: [{ voiceURI: 'e', name: 'Emma', lang: 'en-CA' }] }, 'zh'), /No Cantonese voice/);
  assert.equal(gap({}, 'en'), '', 'nothing is wrong, so nothing is said');
});

test('voices are matched on the language tag prefix, not on an exact region', () => {
  const voices = [
    { voiceURI: 'a', name: 'A', lang: 'en-CA' },
    { voiceURI: 'b', name: 'B', lang: 'EN-GB' },
    { voiceURI: 'c', name: 'C', lang: 'zh-HK' },
    { voiceURI: 'd', name: 'D', lang: 'fr-CA' },
    { voiceURI: 'e', name: 'E' },
  ];
  assert.deepEqual(voicesForLanguage(voices, 'en').map((voice) => voice.voiceURI), ['a', 'b']);
  assert.deepEqual(voicesForLanguage(voices, 'zh').map((voice) => voice.voiceURI), ['c']);
  assert.deepEqual(voicesForLanguage([], 'en'), [], 'no voices is not a crash');
});

test('a stored voice this computer no longer has reads as automatic rather than as a missing option', () => {
  const { entries } = catalog({
    narrator: narrator({ settings: { englishVoiceURI: 'a-voice-that-was-uninstalled' } }),
  });
  const voice = entries.find((entry) => entry.id === 'english-voice');
  assert.equal(voice.control.kind, 'choice');
  assert.equal(voice.control.value, '', 'the choice falls back rather than selecting nothing at all');
  assert.equal(voice.value, 'Choose automatically');
  assert.equal(voice.control.choices[0].value, '', 'automatic leads the list');
});

/* -------------------------------------------------------------- searching -- */

test('searching finds a setting by a word the interface never shows', () => {
  const { rows } = palette();
  const samples = paletteSamples(rows);
  const find = (query) => rows.filter((_, index) => plainTextMatches(samples, query)[index]).map((row) => row.id);

  assert.ok(find('dark mode').includes('setting:theme'), 'nobody searches for "colour theme"');
  assert.ok(find('mute').includes('setting:quiet'));
  assert.ok(find('garage').includes('destination:divisions'));
  assert.ok(find('analytics').includes('setting:local-data'));
  assert.deepEqual(find('a word that appears nowhere at all'), []);
});

test('a row is searchable by everything it shows', () => {
  const { rows } = palette();
  const theme = rows.find((row) => row.id === 'setting:theme');
  const sample = paletteSample(theme);
  for (const part of [theme.label, theme.description, theme.value, theme.keywords]) {
    assert.ok(sample.includes(part), `${part} is visible on the row and must be searchable`);
  }
});

/* --------------------------------------------------------------- grouping -- */

test('groups render in a fixed order and an empty one is dropped rather than shown', () => {
  const { rows } = palette();
  assert.deepEqual(paletteGroups(rows, t).map((group) => group.kind), ['destination', 'setting', 'action']);
  const onlySettings = rows.filter((row) => row.kind === 'setting');
  assert.deepEqual(paletteGroups(onlySettings, t).map((group) => group.kind), ['setting']);
  assert.deepEqual(paletteGroups([], t), [], 'no matches is no headings, not three empty ones');
});

test('every section carries a label and a glyph so a row is scannable', () => {
  for (const section of SETTINGS_SECTIONS) {
    assert.ok(sectionLabel(section, t).length > 0);
    assert.ok(sectionGlyph(section).length > 0);
  }
  assert.equal(new Set(SETTINGS_SECTIONS.map(sectionGlyph)).size, SETTINGS_SECTIONS.length, 'one glyph per section');
});

/* ------------------------------------------------------- keyboard movement -- */

test('the arrow keys wrap, and an empty list has nothing to move to', () => {
  assert.equal(movePaletteFocus(0, 1, 4), 1);
  assert.equal(movePaletteFocus(3, 1, 4), 0, 'down from the last row reaches the first');
  assert.equal(movePaletteFocus(0, -1, 4), 3, 'up from the first row reaches the last');
  assert.equal(movePaletteFocus(-1, 1, 4), 0, 'from nowhere, down means the first row');
  assert.equal(movePaletteFocus(-1, -1, 4), 3, 'and up means the last');
  assert.equal(movePaletteFocus(0, 1, 0), -1, 'nothing matched, so there is nowhere to go');
});

/* --------------------------------------------------- the glyphs that ship -- */

test('every glyph the palette can render is in the font that actually shipped', () => {
  /*
   * A ligature font answers a name it does not carry by rendering the English
   * word at icon size. Nothing throws, nothing logs, and the interface simply
   * looks unfinished. The shipped file is subset to an explicit list, so the
   * names are checked against the binary's own manifest rather than against a
   * gallery of names the font might have had.
   */
  const manifest = JSON.parse(
    readFileSync(path.join(root, 'public', 'fonts', 'material-symbols-outlined', 'manifest.json'), 'utf8'),
  );
  const shipped = new Set(manifest.iconNames);
  assert.ok(shipped.size > 0, 'the manifest lists the glyphs the subset carries');

  const { rows } = palette();
  const used = new Set(rows.map((row) => row.glyph));
  for (const section of SETTINGS_SECTIONS) used.add(sectionGlyph(section));
  // The palette chrome names these directly.
  for (const glyph of ['search', 'close', 'chevron_right', 'refresh']) used.add(glyph);

  for (const glyph of used) {
    assert.ok(shipped.has(glyph), `${glyph} is not in the shipped subset and would render as its own name`);
  }
});

/* ------------------------------------------------------- one list, not two -- */

test('the settings workspace reads the shared catalog rather than a list of its own', () => {
  const source = readFileSync(path.join(root, 'components', 'settings-workspace.tsx'), 'utf8');
  assert.match(source, /^import \{[^}]*settingsCatalog[^}]*\} from '\.\.\/lib\/settings-catalog';$/m);
  assert.match(source, /^\s*const entries = settingsCatalog\(\{/m,
    'a second inline list here is the drift this catalog exists to prevent');
});

test('the navigation reads the shared destinations rather than a list of its own', () => {
  const source = readFileSync(path.join(root, 'components', 'workspace-navigation.tsx'), 'utf8');
  assert.match(source, /^\s*const primary = primaryDestinations\(t\);$/m);
  assert.match(source, /^\s*const secondary = secondaryDestinations\(t\);$/m);
});

/**
 * The nine destinations, written out by hand.
 *
 * Deriving this from the registry would make the check grade its own homework: a
 * destination renamed in the registry is renamed in the expectation too, and the
 * rename sails through while every `tab` value elsewhere in the workspace still
 * says the old id. A destination that disappeared entirely would disappear from
 * the check with it.
 */
const DESTINATION_IDS = ['plan', 'status', 'vehicles', 'saved', 'race', 'divisions', 'history', 'coverage', 'settings'];

test('the destination ids are the ones the rest of the workspace navigates by', () => {
  assert.deepEqual(workspaceDestinations(t).map((destination) => destination.id), DESTINATION_IDS);
  const page = readFileSync(path.join(root, 'app', 'page.tsx'), 'utf8');
  for (const id of DESTINATION_IDS) {
    assert.ok(
      page.includes(`tab === '${id}'`) || page.includes(`'${id}'`),
      `nothing in the shell answers to ${id}, so its destination is a button that goes nowhere`,
    );
  }
});

test('the workspace heading reads the shared destinations rather than a list of its own', () => {
  const source = readFileSync(path.join(root, 'app', 'page.tsx'), 'utf8');
  assert.match(source, /destinationHeading\(t, tab\)/);
  for (const destination of workspaceDestinations(t)) {
    assert.ok(destinationHeading(t, destination.id).length > 0, `${destination.id} has no heading`);
  }
  assert.equal(destinationHeading(t, 'a-destination-that-does-not-exist'), '',
    'an unknown id is an empty heading, never a guess at somebody else name');
});

test('the palette is rendered in the shell, wired to the shared registries', () => {
  const source = readFileSync(path.join(root, 'app', 'page.tsx'), 'utf8');
  assert.match(source, /^\s*<CommandPalette t=\{t\} destinations=\{paletteDestinations\} settings=\{paletteSettings\} actions=\{paletteActions\} onNavigate=\{setTab\} \/>$/m);
  assert.match(source, /^\s*const paletteSettings = useMemo\($/m);
});

test('Escape is handled by the palette rather than left to the dialog', () => {
  /*
   * A modal dialog closes on Escape for free, and here it did not: the palette
   * puts the focus in a search field on open, and Chromium treats Escape on an
   * `input[type="search"]` as "clear this field" and consumes the key. Every unit
   * test was green while the first Escape anybody pressed did nothing at all.
   *
   * This is a drift guard, not proof. The proof is pressing the key in a real
   * browser, which scripts/ui-evidence/drive-palette.mjs does.
   */
  const source = readFileSync(path.join(root, 'components', 'command-palette.tsx'), 'utf8');
  assert.match(source, /^\s*const onSurfaceKey = \(event: ReactKeyboardEvent<HTMLDivElement>\) => \{$/m);
  assert.match(source, /^\s*if \(event\.key !== 'Escape' \|\| event\.defaultPrevented\) return;$/m,
    'an inner handler that already dealt with Escape has to win, or the regex builder cannot close first');
  assert.match(source, /onKeyDown=\{onSurfaceKey\}/, 'the handler is wired to the surface');
});

test('the palette stylesheet is loaded, and the shell still loads after it', () => {
  const layout = readFileSync(path.join(root, 'app', 'layout.tsx'), 'utf8');
  const palette = layout.indexOf("import './command-palette.css';");
  const shell = layout.indexOf("import './shell.css';");
  assert.ok(palette > 0, 'the stylesheet is imported, or none of the palette is styled');
  assert.ok(shell > palette, 'the shell keeps the last word on navigation, as its own comment says');
});

test('settings keywords exist for every setting, so search reaches each one by a plain word', () => {
  const { entries } = catalog();
  for (const entry of entries) {
    assert.ok(settingKeywords(entry.id, t).length > 0, `${entry.id} has no keywords, so only its own label finds it`);
  }
});
