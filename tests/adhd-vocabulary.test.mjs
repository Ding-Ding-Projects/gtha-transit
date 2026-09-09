import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ADHD_MODES,
  ADHD_STORAGE_KEY,
  IDLE_MS,
  MAX_ONE_THING,
  SNOOZE_MS,
  adhdClassNames,
  elapsedMinutes,
  emptyAdhdState,
  idleMinutes,
  isOn,
  momentumDue,
  parseAdhd,
  quietMotion,
  serializeAdhd,
  setOneThing,
  snooze,
  toggleMode,
  touch,
} from '../lib/adhd-modes.ts';

import {
  VOCABULARY_LIMITS,
  VOCABULARY_STORAGE_KEY,
  buildReplacer,
  entryCount,
  parseVocabularyCache,
  readVocabulary,
  rejectionText,
  serializeVocabulary,
} from '../lib/personal-vocabulary.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const NOW = Date.parse('2026-09-08T15:00:00Z');
const t = (en) => en;

/* ------------------------------------------------------------- ADHD modes -- */

test('every mode ships off, and they are independent of one another', () => {
  /*
   * Attention difficulties do not arrive as a single setting. Somebody may want
   * the interface quieter without wanting time nudges, and bundling them means
   * most people turn the whole thing off to escape the one part that does not
   * suit them.
   */
  const state = emptyAdhdState(NOW);
  assert.equal(ADHD_MODES.length, 5);
  for (const mode of ADHD_MODES) assert.equal(isOn(state, mode), false, `${mode} must ship off`);

  const one = toggleMode(state, 'lowStimulation', NOW);
  assert.equal(isOn(one, 'lowStimulation'), true);
  for (const mode of ADHD_MODES.filter((item) => item !== 'lowStimulation')) {
    assert.equal(isOn(one, mode), false, `turning one on must not turn ${mode} on`);
  }
  assert.equal(isOn(toggleMode(one, 'lowStimulation', NOW), 'lowStimulation'), false, 'and off again');
});

test('the session clock states a number and never a judgement', () => {
  // Time blindness is one of the most consistently reported difficulties and
  // almost no software helps. Stating the number is the whole feature.
  const state = emptyAdhdState(NOW);
  assert.equal(elapsedMinutes(state, NOW), 0);
  assert.equal(elapsedMinutes(state, NOW + 90 * 60_000), 90);
  assert.equal(elapsedMinutes(state, NOW - 5000), 0, 'a clock that went backwards reports zero, not a negative');
});

test('momentum waits for real stillness, and a not-now is respected for a stated period', () => {
  let state = toggleMode(emptyAdhdState(NOW), 'momentum', NOW);
  assert.equal(momentumDue(state, NOW), false, 'nothing has been still yet');
  assert.equal(momentumDue(state, NOW + IDLE_MS), true);

  /*
   * Checked at a moment when the idle clock has already run out again, or this
   * passes for the wrong reason: `snooze` also resets that clock, so a check a
   * second after the snooze is quiet because nothing has been still yet, whether
   * or not the snooze is honoured at all. Deleting the quiet check left this
   * green, which is how the weak assertion was found.
   */
  const snoozedAt = NOW + IDLE_MS;
  state = snooze(state, snoozedAt);
  assert.ok(SNOOZE_MS > IDLE_MS, 'a snooze has to outlast the idle window, or it cannot be tested at all');
  assert.equal(momentumDue(state, snoozedAt + IDLE_MS + 1000), false, 'still quiet, though it has been still long enough');
  assert.equal(momentumDue(state, snoozedAt + SNOOZE_MS + 1), true, 'and speaks again once the quiet expires');
  assert.ok(SNOOZE_MS >= 20 * 60_000, 'thirty seconds would not be respecting it');

  const off = emptyAdhdState(NOW);
  assert.equal(momentumDue(off, NOW + IDLE_MS * 10), false, 'the mode is off, so it says nothing at all');
});

test('activity resets the idle clock', () => {
  let state = toggleMode(emptyAdhdState(NOW), 'momentum', NOW);
  assert.equal(idleMinutes(state, NOW + 30 * 60_000), 30);
  state = touch(state, NOW + 30 * 60_000);
  assert.equal(idleMinutes(state, NOW + 30 * 60_000), 0);
  assert.equal(momentumDue(state, NOW + 30 * 60_000), false);
});

test('the one thing is the person choice, and is bounded', () => {
  const state = setOneThing(emptyAdhdState(NOW), 'Get to Kennedy before six', NOW);
  assert.equal(state.oneThingText, 'Get to Kennedy before six');
  assert.equal(setOneThing(state, 'x'.repeat(500), NOW).oneThingText.length, MAX_ONE_THING);
  assert.equal(setOneThing(state, null, NOW).oneThingText, '', 'nothing is not a crash');
});

test('low stimulation composes with the platform preference and never overrides it', () => {
  // Somebody who has already asked the operating system for less motion has asked
  // once, and must not have to ask again.
  const off = emptyAdhdState(NOW);
  const on = toggleMode(off, 'lowStimulation', NOW);
  assert.equal(quietMotion(off, true), true, 'the platform alone is enough');
  assert.equal(quietMotion(on, false), true, 'and so is the mode alone');
  assert.equal(quietMotion(off, false), false);
  assert.equal(quietMotion(on, true), true);
});

test('the classes name only the modes that are on', () => {
  assert.equal(adhdClassNames(emptyAdhdState(NOW)), '');
  const state = toggleMode(toggleMode(emptyAdhdState(NOW), 'focus', NOW), 'lowStimulation', NOW);
  assert.equal(adhdClassNames(state), 'adhd-focus adhd-low-stimulation');
});

test('an unreadable stored file leaves every accommodation off', () => {
  /*
   * This is the one setting where guessing matters most: turning a mode on for
   * somebody is deciding something about them.
   */
  for (const junk of [null, '', '{', '[]', '{"version":2,"modes":{"focus":true}}', '{"version":1}']) {
    const state = parseAdhd(junk, NOW);
    for (const mode of ADHD_MODES) assert.equal(isOn(state, mode), false, `${JSON.stringify(junk)} switched ${mode} on`);
  }
});

test('what is stored comes back, except the session clock, which is about this session', () => {
  let state = toggleMode(emptyAdhdState(NOW), 'timeAwareness', NOW);
  state = setOneThing(state, 'Union to Kennedy', NOW);
  state = snooze(state, NOW);
  const later = NOW + 86_400_000;
  const restored = parseAdhd(serializeAdhd(state), later);
  assert.equal(isOn(restored, 'timeAwareness'), true);
  assert.equal(restored.oneThingText, 'Union to Kennedy');
  assert.equal(restored.startedAt, later, 'yesterday start would report a number about nothing');
  assert.equal(restored.quietUntil, 0, 'and a snooze that has expired does not come back');
});

test('a truthy-looking value that is not true does not switch a mode on', () => {
  const state = parseAdhd('{"version":1,"modes":{"focus":"yes","momentum":1}}', NOW);
  assert.equal(isOn(state, 'focus'), false);
  assert.equal(isOn(state, 'momentum'), false);
});

test('the storage key follows the convention', () => {
  assert.match(ADHD_STORAGE_KEY, /^gtha-[a-z-]+-v\d+$/);
});

/* --------------------------------------------------- personal vocabulary -- */

const file = (entries) => JSON.stringify({ version: 1, entries });

test('a valid file is read, and its entries kept in order', () => {
  const result = readVocabulary(file([{ term: 'stop', replacement: 'halt' }, { term: 'station', replacement: 'depot' }]));
  assert.equal(result.ok, true);
  assert.equal(entryCount(result.file), 2);
  assert.deepEqual(result.file.entries.map((entry) => entry.term), ['stop', 'station']);
});

test('nothing ships with it: an absent file replaces nothing at all', () => {
  // Until somebody supplies a valid file, every surface renders the wording it
  // shipped with, unchanged.
  const replace = buildReplacer(null);
  assert.equal(replace('Choose a station and a stop'), 'Choose a station and a stop');
  assert.equal(entryCount(null), 0);
  assert.equal(buildReplacer({ version: 1, entries: [] })('Choose a stop'), 'Choose a stop');
});

test('every rejection is named, because that file did not work is not actionable', () => {
  assert.equal(readVocabulary('x'.repeat(VOCABULARY_LIMITS.maxBytes + 1)).reason, 'too-large');
  assert.equal(readVocabulary('{').reason, 'not-json');
  assert.equal(readVocabulary('[]').reason, 'not-an-object');
  assert.equal(readVocabulary('"text"').reason, 'not-an-object');
  assert.equal(readVocabulary(JSON.stringify({ version: 2, entries: [] })).reason, 'unsupported-version');
  assert.equal(readVocabulary(JSON.stringify({ version: 1, entries: 'nope' })).reason, 'entries-not-a-list');
  assert.equal(readVocabulary(JSON.stringify({ version: 1, entries: [], extra: 1 })).reason, 'unexpected-field');
  assert.equal(readVocabulary(file(Array.from({ length: VOCABULARY_LIMITS.maxEntries + 1 }, (_, i) => ({ term: 't' + i, replacement: 'r' })))).reason, 'too-many-entries');
  assert.equal(readVocabulary(file([['not', 'an object']])).reason, 'entry-not-an-object');
  assert.equal(readVocabulary(file([{ term: 5, replacement: 'r' }])).reason, 'term-not-a-string');
  assert.equal(readVocabulary(file([{ term: 't', replacement: 5 }])).reason, 'replacement-not-a-string');
  assert.equal(readVocabulary(file([{ term: '   ', replacement: 'r' }])).reason, 'term-empty');
  assert.equal(readVocabulary(file([{ term: 'x'.repeat(VOCABULARY_LIMITS.maxTermLength + 1), replacement: 'r' }])).reason, 'term-too-long');
  assert.equal(readVocabulary(file([{ term: 't', replacement: 'x'.repeat(VOCABULARY_LIMITS.maxReplacementLength + 1) }])).reason, 'replacement-too-long');
  assert.equal(readVocabulary(file([{ term: 'Stop', replacement: 'a' }, { term: 'stop', replacement: 'b' }])).reason, 'duplicate-term');
  assert.equal(readVocabulary(file([{ term: 't', replacement: 'r', note: 'x' }])).reason, 'unexpected-field');
});

test('every rejection has copy in both languages', () => {
  const reasons = ['too-large', 'not-json', 'not-an-object', 'unsupported-version', 'entries-not-a-list',
    'too-many-entries', 'entry-not-an-object', 'term-not-a-string', 'replacement-not-a-string', 'term-empty',
    'term-too-long', 'replacement-too-long', 'duplicate-term', 'unexpected-field'];
  for (const reason of reasons) {
    const english = rejectionText(reason, (en) => en);
    const cantonese = rejectionText(reason, (_, zh) => zh);
    assert.ok(english.length > 8, `${reason} has no English`);
    assert.ok(cantonese.length > 2, `${reason} has no Cantonese`);
    assert.notEqual(english, cantonese);
  }
});

test('a rejected file applies nothing, not even the entries before the bad one', () => {
  // A vocabulary half-applied is an interface speaking two languages at once with
  // no way to tell which words are whose.
  const result = readVocabulary(file([
    { term: 'stop', replacement: 'halt' },
    { term: 'station', replacement: 5 },
  ]));
  assert.equal(result.ok, false);
  assert.equal(result.file, undefined, 'nothing usable comes back from a refusal');
});

test('replacement is whole words only, so renaming stop does not rename stopwatch', () => {
  const replace = buildReplacer(readVocabulary(file([{ term: 'stop', replacement: 'halt' }])).file);
  assert.equal(replace('the next stop'), 'the next halt');
  assert.equal(replace('a stopwatch'), 'a stopwatch');
  assert.equal(replace('nonstop'), 'nonstop');
  assert.equal(replace('stop, then go'), 'halt, then go');
});

test('a longer phrase wins over a shorter term inside it', () => {
  const replace = buildReplacer(readVocabulary(file([
    { term: 'stop', replacement: 'halt' },
    { term: 'transit stop', replacement: 'pickup point' },
  ])).file);
  assert.equal(replace('the transit stop'), 'the pickup point');
});

test('the original capitalisation is kept', () => {
  const replace = buildReplacer(readVocabulary(file([{ term: 'station', replacement: 'depot' }])).file);
  assert.equal(replace('Station closed'), 'Depot closed');
  assert.equal(replace('the station'), 'the depot');
});

test('a term containing regex punctuation is matched literally, not compiled', () => {
  const replace = buildReplacer(readVocabulary(file([{ term: 'a.b', replacement: 'ok' }])).file);
  assert.equal(replace('a.b'), 'ok');
  assert.equal(replace('axb'), 'axb', 'the dot is a dot, not any character');
});

test('the cache is revalidated with the same reader the file picker uses', () => {
  /*
   * A value edited by hand, truncated by a storage bound, or written by an older
   * version must not reach the interface through a shorter path than a chosen
   * file takes.
   */
  const valid = readVocabulary(file([{ term: 'stop', replacement: 'halt' }])).file;
  assert.deepEqual(parseVocabularyCache(serializeVocabulary(valid)), valid);
  assert.equal(parseVocabularyCache('{"version":1,"entries":[{"term":"a","replacement":1}]}'), null);
  assert.equal(parseVocabularyCache('{"version":9,"entries":[]}'), null);
  assert.equal(parseVocabularyCache(null), null);
  assert.equal(parseVocabularyCache('truncated'), null);
});

test('the file format is bounded on every axis it could grow along', () => {
  assert.equal(VOCABULARY_LIMITS.schemaVersion, 1);
  assert.ok(VOCABULARY_LIMITS.maxBytes <= 128 * 1024);
  assert.ok(VOCABULARY_LIMITS.maxEntries <= 1000);
  assert.ok(VOCABULARY_LIMITS.maxTermLength <= 200);
  assert.ok(VOCABULARY_LIMITS.maxReplacementLength <= 500);
  assert.match(VOCABULARY_STORAGE_KEY, /^gtha-[a-z-]+-v\d+$/);
});

test('the module ships no vocabulary of its own, and reaches no network', () => {
  // The control is always visible so it can be found. That is not permission to
  // seed it with samples, templates or defaults.
  const source = readFileSync(path.join(root, 'lib', 'personal-vocabulary.ts'), 'utf8');
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|https?:\/\//.test(source), 'nothing here leaves the browser');
  const shipped = readVocabulary(file([]));
  assert.equal(shipped.ok, true);
  assert.equal(entryCount(shipped.file), 0, 'an empty file is valid and replaces nothing');
});

/* --------------------------------------------------------------- the wiring -- */

const source = (...parts) => readFileSync(path.join(root, ...parts), 'utf8');

test('the replacer sits inside t, which is the one boundary every surface goes through', () => {
  /*
   * Applied at each call site instead, a replacement reaches some surfaces and
   * not others, and the interface speaks two vocabularies at once with no way to
   * tell which words are whose.
   */
  const page = source('app', 'page.tsx');
  assert.match(page, /^\s*const replaceWords = useMemo\(\(\) => buildReplacer\(vocabulary\), \[vocabulary\]\);$/m);
  assert.match(page, /const originalLine = shownLang === 'zh' \? b : shownLang === 'both'/,
    'and after the language mode and playfulness have chosen the sentence, so it renames what is shown');
  assert.match(page, /\? line : replaceWords\(line\)/, 'the replacement is the last step, on the finished sentence');
  assert.match(page, /const line = appearance\.global\.showEmoji \? originalLine : originalLine\.replace/);
  assert.match(page, /\[shownLang, shownFunEn, shownFunZh, replaceWords, school, appearance\.global\.showEmoji\]/, 'wording and decoration changes must invalidate the translated result');
});

test('the cached vocabulary is revalidated rather than trusted', () => {
  const page = source('app', 'page.tsx');
  assert.match(page, /parseVocabularyCache\(localStorage\.getItem\(VOCABULARY_STORAGE_KEY\)\)/);
  assert.ok(!/JSON\.parse\(localStorage\.getItem\(VOCABULARY_STORAGE_KEY\)/.test(page),
    'a shorter path into the interface than the file picker takes is the whole risk here');
});

test('the shell carries only the modes that are on', () => {
  const page = source('app', 'page.tsx');
  assert.match(page, /className=\{`shell \$\{adhdClassNames\(adhd\)\}`\.trimEnd\(\)\}/);
  assert.match(page, /data-one-thing=\{isOn\(adhd, 'oneThing'\) && adhd\.oneThingText/,
    'the chosen action rides on the shell so it survives moving between destinations');
});

test('focus quietens and never removes', () => {
  // An interface that disappears work is a worse problem than a busy one.
  const css = source('app', 'comfort.css');
  const focus = css.slice(css.indexOf('.shell.adhd-focus'));
  const block = focus.slice(0, focus.indexOf('adhd-low-stimulation'));
  assert.ok(!/display:\s*none/.test(block), 'focus must not remove anything');
  assert.match(block, /opacity:\s*\.45/);
  assert.match(block, /:hover[\s\S]{0,400}opacity:\s*1/, 'and everything it quietens comes back');
});

test('low stimulation stops motion rather than slowing it', () => {
  // A slow animation is still motion, which is the thing being asked for less of.
  const css = source('app', 'comfort.css');
  assert.match(css, /\.shell\.adhd-low-stimulation[\s\S]{0,300}animation-duration:\s*0s\s*!important/);
  assert.match(css, /\.shell\.adhd-low-stimulation[\s\S]{0,300}transition-duration:\s*0s\s*!important/);
});

test('the comfort surface offers no vocabulary of its own', () => {
  /*
   * The control is always visible so it can be found. That is not permission to
   * seed it: a sample vocabulary here would be this planner shipping wording
   * nobody asked for, which is the one thing this feature must never do.
   */
  const component = source('components', 'comfort-settings.tsx');
  const format = component.slice(component.indexOf('comfort-vocabulary-format'));
  const sample = format.slice(format.indexOf('<pre>'), format.indexOf('</pre>'));
  assert.match(sample, /"term": ""/, 'the shape is shown with nothing in it');
  assert.match(sample, /"replacement": ""/);
  assert.ok(!/fetch\(|https?:\/\//.test(component), 'and nothing here leaves the browser');
  assert.match(component, /never uploaded, never logged, and never included in an export/);
});

test('the comfort rows are searchable and reachable from the palette', () => {
  const catalog = source('lib', 'settings-catalog.ts');
  assert.match(catalog, /'appearance' \| 'language' \| 'comfort' \| 'narrator' \| 'privacy'/);
  const palette = source('lib', 'command-palette.ts');
  for (const id of ['comfort-focus', 'comfort-low-stimulation', 'comfort-time-awareness', 'comfort-one-thing', 'comfort-momentum', 'personal-vocabulary']) {
    assert.ok(palette.includes(`'${id}'`), `${id} has no keywords, so only its own label finds it`);
  }
  // "adhd" is the word somebody types; it is deliberately not what the modes are called.
  assert.match(palette, /'comfort-focus': t\('adhd/);
});

/**
 * The copy a person actually reads: the arguments to `t`, and the mode strings.
 *
 * Scanning the whole file instead catches the comments that state these very
 * rules, so the guard fails on the sentence explaining why it exists. Both of
 * these did, on the first run. The rules are about what is shown, so what is
 * shown is what is scanned.
 */
function shownCopy(...parts) {
  const text = source(...parts);
  const quoted = [...text.matchAll(/t\(\s*'([^']*)'\s*,\s*'([^']*)'/g)];
  // Copy that interpolates a count is written as a template literal and is just
  // as visible as the rest; missing it would let the one sentence most likely to
  // scold somebody slip past.
  const templated = [...text.matchAll(/t\(\s*`([^`]*)`\s*,\s*`([^`]*)`/g)];
  const pairs = [...text.matchAll(/\[\s*'([^']*)'\s*,\s*'([^']*)'\s*\]/g)];
  /*
   * An interpolated expression is code, not words. Leaving it in matched the
   * variable name `adhd` inside `${elapsedMinutes(adhd, now)}` and reported the
   * session clock as clinical language, which is the sort of false positive that
   * gets a guard deleted rather than fixed.
   */
  const withoutExpressions = (text) => text.replace(/\$\{[^}]*\}/g, ' ');
  return [...quoted, ...templated, ...pairs]
    .map((match) => withoutExpressions(match[1] + ' ' + match[2]))
    .join('\n');
}

test('nothing a person reads claims to be medical', () => {
  const copy = shownCopy('components', 'comfort-settings.tsx');
  assert.ok(copy.length > 400, 'the copy was not extracted, so this would pass on anything');
  assert.ok(!/diagnos|symptom|treatment|therapy|disorder|ADHD|attention deficit/i.test(copy),
    'the modes are named for what they do, so nobody has to disclose anything by using one');
  assert.match(copy, /not an opinion about how anybody should work/);
  assert.match(copy, /medical advice/i);
});

test('no streak, no score, no scolding in anything shown', () => {
  const copy = shownCopy('components', 'comfort-settings.tsx');
  assert.ok(!/streak|congratulat|well done|you should|productivity|keep it up|good job/i.test(copy));
  // Momentum states what is true, never what somebody should feel about it.
  assert.match(copy, /Nothing has changed here for/);
});
