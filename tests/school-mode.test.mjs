import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_NAME,
  MIN_SECRET,
  PBKDF2_ITERATIONS,
  RECOVERY,
  SCHOOL_STORAGE_KEY,
  SHIPPED_NAME,
  SUPPRESSED,
  deriveHash,
  effectiveFunLevel,
  effectiveLanguage,
  emptySchoolState,
  hasChosenName,
  lock,
  parseSchool,
  renameSchool,
  schoolName,
  secretIsUsable,
  serializeSchool,
  suppresses,
  unlock,
  verify,
} from '../lib/school-mode.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = (...parts) => readFileSync(path.join(root, ...parts), 'utf8');

/* ---------------------------------------------------------------- the lock -- */

test('it ships off, and turning it on needs a secret', async () => {
  const off = emptySchoolState();
  assert.equal(off.on, false);
  assert.equal(off.hash, '');
  const on = await lock(off, 'exam-time');
  assert.equal(on.on, true);
  assert.ok(on.salt.length > 0 && on.hash.length > 0);
});

test('the secret itself is never stored', async () => {
  const state = await lock(emptySchoolState(), 'my-secret-words');
  const stored = serializeSchool(state);
  assert.ok(!stored.includes('my-secret-words'), 'the stored record must not contain it');
  assert.ok(!JSON.stringify(state).includes('my-secret-words'), 'nor the state in memory');
});

test('the right secret opens it and a wrong one does not', async () => {
  const state = await lock(emptySchoolState(), 'exam-time');
  assert.equal(await verify(state, 'exam-time'), true);
  assert.equal(await verify(state, 'exam-times'), false);
  assert.equal(await verify(state, 'Exam-time'), false, 'case matters');
  assert.equal(await verify(state, ''), false);
});

test('two locks with the same secret store different hashes, because each is salted', async () => {
  const first = await lock(emptySchoolState(), 'same');
  const second = await lock(emptySchoolState(), 'same');
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash, 'an unsalted hash is a rainbow table away from the secret');
  assert.equal(await verify(first, 'same'), true);
  assert.equal(await verify(second, 'same'), true);
});

test('nothing verifies against a mode that is off, or a record with no credential', async () => {
  assert.equal(await verify(emptySchoolState(), 'anything'), false);
  const broken = { on: true, name: '', salt: '', hash: '' };
  assert.equal(await verify(broken, 'anything'), false);
  const damaged = { on: true, name: '', salt: 'not base64 !!!', hash: 'x' };
  assert.equal(await verify(damaged, 'anything'), false, 'a corrupt salt is a refusal, not a throw');
});

test('unlocking forgets the credential and keeps the chosen name', async () => {
  let state = await lock(renameSchool(emptySchoolState(), 'Exam mode'), 'exam-time');
  state = unlock(state);
  assert.equal(state.on, false);
  assert.equal(state.salt, '');
  assert.equal(state.hash, '');
  assert.equal(state.name, 'Exam mode', 'the name is the person choice, not part of the lock');
});

test('the work factor is real and the secret has a floor', () => {
  assert.ok(PBKDF2_ITERATIONS >= 100_000, 'a token iteration count is a token defence');
  assert.equal(secretIsUsable('1234'), true);
  assert.equal(secretIsUsable('123'), false);
  assert.equal(secretIsUsable('   '), false);
  assert.equal(secretIsUsable(null), false);
  assert.ok(MIN_SECRET >= 4);
});

test('a hash is derived from the salt it is given, not from a fixed one', async () => {
  const salt = new Uint8Array(16).fill(7);
  const other = new Uint8Array(16).fill(9);
  assert.notEqual(await deriveHash('x', salt), await deriveHash('x', other));
  assert.equal(await deriveHash('x', salt), await deriveHash('x', salt), 'and is stable for the same pair');
});

/* ---------------------------------------------------------------- the name -- */

test('a chosen name replaces the shipped one everywhere', () => {
  const shipped = emptySchoolState();
  assert.equal(schoolName(shipped), SHIPPED_NAME);
  assert.equal(hasChosenName(shipped), false);

  const renamed = renameSchool(shipped, 'Exam mode');
  assert.equal(schoolName(renamed), 'Exam mode');
  assert.equal(hasChosenName(renamed), true);
  // A rename that leaked the original name in one tooltip would defeat the rename.
  assert.notEqual(schoolName(renamed), SHIPPED_NAME);
});

test('a blank rename falls back rather than showing nothing', () => {
  assert.equal(schoolName(renameSchool(emptySchoolState(), '   ')), SHIPPED_NAME);
  assert.equal(schoolName(renameSchool(emptySchoolState(), '')), SHIPPED_NAME);
});

test('a name is bounded, so a stored blob cannot become the interface', () => {
  assert.equal(renameSchool(emptySchoolState(), 'x'.repeat(500)).name.length, MAX_NAME);
});

/* --------------------------------------------------------------- suppression -- */

test('everything it hides is named in one list', () => {
  assert.deepEqual([...SUPPRESSED], ['cantonese', 'bilingual', 'playfulness', 'vocabulary', 'dim-sum']);
  const off = emptySchoolState();
  const on = { ...off, on: true };
  for (const what of SUPPRESSED) {
    assert.equal(suppresses(off, what), false, `${what} is visible while the mode is off`);
    assert.equal(suppresses(on, what), true, `${what} must be hidden while it is on`);
  }
});

test('it forces English without overwriting what was chosen', () => {
  const on = { ...emptySchoolState(), on: true };
  assert.equal(effectiveLanguage(on, 'zh'), 'en');
  assert.equal(effectiveLanguage(on, 'both'), 'en');
  // The previous choice is still in its own setting and returns when the mode goes.
  assert.equal(effectiveLanguage(emptySchoolState(), 'zh'), 'zh');
  assert.equal(effectiveFunLevel(on, 1), 5);
  assert.equal(effectiveFunLevel(emptySchoolState(), 1), 1);
});

/* -------------------------------------------------------------- persistence -- */

test('what is stored comes back', async () => {
  const state = await lock(renameSchool(emptySchoolState(), 'Exam mode'), 'exam-time');
  const restored = parseSchool(serializeSchool(state));
  assert.equal(restored.on, true);
  assert.equal(restored.name, 'Exam mode');
  assert.equal(await verify(restored, 'exam-time'), true, 'the lock survives a reload');
});

test('a record claiming to be on with no credential restores as off', () => {
  /*
   * A lock nobody can open is the one failure this must never have: the whole
   * thing is a speed bump somebody put on themselves, and being shut out of your
   * own planner by a corrupt record is not a speed bump.
   */
  const orphan = JSON.stringify({ version: 1, on: true, name: 'Exam mode', salt: '', hash: '' });
  const restored = parseSchool(orphan);
  assert.equal(restored.on, false);
  assert.equal(restored.name, 'Exam mode', 'though the name is kept, because it costs nothing');
});

test('an unreadable record leaves the mode off', () => {
  for (const junk of [null, '', '{', '[]', '{"version":2,"on":true}', '"text"']) {
    assert.equal(parseSchool(junk).on, false, `${JSON.stringify(junk)} switched it on`);
  }
});

test('the storage key follows the convention', () => {
  assert.match(SCHOOL_STORAGE_KEY, /^gtha-[a-z-]+-v\d+$/);
});

/* ------------------------------------------------------------------ honesty -- */

test('the recovery route is stated in both languages', () => {
  // Forgetting the secret is a normal outcome for a lock somebody set on
  // themselves, and a lock with no way out is not a speed bump, it is a wall.
  assert.match(RECOVERY.en, /Clearing this site/);
  assert.match(RECOVERY.en, /also clears your saved trips/, 'and what that costs is said too');
  assert.ok(RECOVERY.zh.length > 10);
});

test('nothing here claims to be security', () => {
  const text = source('lib', 'school-mode.ts');
  assert.match(text, /speed bump, not a security boundary/);
  assert.ok(!/\bencrypt|\bprotect(s|ed)?\b|\bsecure(s|d)?\b/i.test(text.replace(/security boundary/g, '')),
    'a self-imposed lock must not be described as protecting anything');
});

test('the credential never reaches anywhere it could be read back', () => {
  const text = source('lib', 'school-mode.ts');
  assert.ok(!/console\.|fetch\(|sendBeacon|localStorage/.test(text),
    'this module neither logs, sends nor stores; the caller stores only what serializeSchool returns');
  const stored = serializeSchool({ on: true, name: 'n', salt: 's', hash: 'h' });
  assert.deepEqual(Object.keys(JSON.parse(stored)).sort(), ['hash', 'name', 'on', 'salt', 'version']);
});

/* ------------------------------------------------------- omitted, not disabled -- */

/*
 * These read the surfaces rather than the module, because the module cannot tell
 * whether anybody used it. Every one of them is written against an exact line so
 * a rename cannot carry the old name along and satisfy it -- the trap that made
 * four guards toothless in this repository before.
 */

test('the settings catalog drops every suppressed row while the mode is on', async () => {
  const { settingsCatalog, HIDDEN_BY_SCHOOL } = await import('../lib/settings-catalog.ts');
  const narrator = {
    speechAvailable: true, voicesLoaded: true, voices: [],
    settings: { enabled: false, language: 'en', englishVoiceURI: '', cantoneseVoiceURI: '', rate: 1, pitch: 1, quiet: false },
    setSettings: () => {}, preview: () => {},
  };
  const base = {
    t: (en) => en, lang: 'en', setLang: () => {}, dark: false, setDark: () => {},
    funEn: 5, setFunEn: () => {}, funZh: 5, setFunZh: () => {}, narrator,
    comfort: { modes: {}, toggleMode: () => {}, vocabularyEntries: 0 },
  };
  const off = settingsCatalog({ ...base, school: { on: false, name: 'School mode' } }).map((entry) => entry.id);
  const on = settingsCatalog({ ...base, school: { on: true, name: 'Exam mode' } }).map((entry) => entry.id);

  assert.deepEqual(
    [...HIDDEN_BY_SCHOOL].sort(),
    ['cantonese-tone', 'english-tone', 'language', 'personal-vocabulary'],
    'shortening this list is how a suppressed control quietly comes back',
  );
  assert.deepEqual(HIDDEN_BY_SCHOOL.filter((id) => !off.includes(id)), [], 'every hidden row exists to begin with');
  for (const id of HIDDEN_BY_SCHOOL) {
    assert.ok(!on.includes(id), `${id} is still in the catalog, so the settings search and the palette can both find it`);
  }
  // The way out is never hidden by the thing it turns off.
  assert.ok(on.includes('school-mode'), 'the mode itself must stay findable');
});

test('the catalog row carries the chosen name, not the shipped one', async () => {
  const { settingsCatalog } = await import('../lib/settings-catalog.ts');
  const narrator = {
    speechAvailable: false, voicesLoaded: false, voices: [],
    settings: { enabled: false, language: 'en', englishVoiceURI: '', cantoneseVoiceURI: '', rate: 1, pitch: 1, quiet: false },
    setSettings: () => {}, preview: () => {},
  };
  const entries = settingsCatalog({
    t: (en) => en, lang: 'en', setLang: () => {}, dark: false, setDark: () => {},
    funEn: 5, setFunEn: () => {}, funZh: 5, setFunZh: () => {}, narrator,
    school: { on: true, name: 'Exam mode' },
  });
  const row = entries.find((entry) => entry.id === 'school-mode');
  assert.equal(row.label, 'Exam mode');
  assert.ok(!JSON.stringify(entries).includes(SHIPPED_NAME), 'the shipped name must not survive a rename anywhere in the catalog');
});

test('the language tab and its controls are removed rather than disabled', () => {
  const text = source('components', 'settings-workspace.tsx');
  assert.match(text, /^\s*\.\.\.\(school\.on \? \[\] : \[\{ id: 'language',/m, 'the tab itself must leave the strip');
  assert.match(text, /^\s*\{!school\.on && <TabsContent value="language"/m, 'and its panel with it');
  assert.ok(!/disabled=\{school\.on\}/.test(text), 'a disabled control announces what was turned off');
  // Somebody sitting on the Language tab when it goes must land somewhere real.
  assert.match(text, /school\.on && stored === 'language' \? 'appearance' : stored/);
});

test('the navigation language buttons and the wording card are removed too', () => {
  const nav = source('components', 'workspace-navigation.tsx');
  assert.match(nav, /^\s*\{!hideLanguages && <fieldset className="m3-nav__langs"/m);
  const comfort = source('components', 'comfort-settings.tsx');
  assert.match(comfort, /^\s*\{!hideVocabulary && <section className="preference-card comfort-vocabulary"/m);
});

test('the page reads the mode rather than overwriting what somebody chose', () => {
  const text = source('app', 'page.tsx');
  assert.match(text, /^\s*const shownLang = effectiveLanguage\(school, lang\) as Lang;$/m);
  assert.match(text, /^\s*const shownFunEn = effectiveFunLevel\(school, funEn\);$/m);
  assert.match(text, /^\s*const shownFunZh = effectiveFunLevel\(school, funZh\);$/m);
  // Overwriting would turn a temporary mode into a permanent edit of a preference.
  assert.ok(!/setLang\('en'\)/.test(text), 'the stored language choice must not be rewritten');
  assert.ok(!/setFunEn\(5\);|setFunZh\(5\);/.test(text), 'nor the stored playfulness levels');
  assert.match(text, /suppresses\(school, 'vocabulary'\) \? line : replaceWords\(line\)/);
  assert.match(text, /suppresses\(school, 'dim-sum'\)/);
  assert.match(text, /hideLanguages=\{school\.on\}/);
});

test('the control states the recovery route on itself', () => {
  const text = source('components', 'school-mode.tsx');
  assert.match(text, /t\(RECOVERY\.en, RECOVERY\.en\)/, 'the way back in is on the control, not in a manual');
  assert.match(text, /speed bump, not a lock on your data/);
  assert.equal(
    (text.match(/type="password"/g) || []).length,
    2,
    'both secret fields -- setting it and giving it back -- must be typed under cover',
  );
});
