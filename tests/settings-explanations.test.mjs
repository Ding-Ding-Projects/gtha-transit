import assert from 'node:assert/strict';
import test from 'node:test';
import { settingsCatalog } from '../lib/settings-catalog.ts';
import { EXPLAINED_SETTINGS, explanationFor, provenanceLine } from '../lib/settings-explanations.ts';

/** English mode, so an assertion reads as the sentence a person would see. */
const t = (en) => en;

function narrator(overrides = {}) {
  return {
    settings: { enabled: true, language: 'en', englishVoiceURI: '', cantoneseVoiceURI: '', rate: 1, pitch: 1, quiet: false, ...(overrides.settings ?? {}) },
    updateSettings: overrides.updateSettings ?? (() => {}),
    speechAvailable: overrides.speechAvailable ?? true,
    voices: overrides.voices ?? [
      { voiceURI: 'uri-en', name: 'Emma', lang: 'en-CA' },
      { voiceURI: 'uri-zh', name: '小明', lang: 'zh-HK' },
    ],
    voicesLoaded: overrides.voicesLoaded ?? true,
  };
}

/**
 * Every optional input supplied, the way `tests/command-palette.test.mjs`'s own
 * `catalog()` helper builds one -- except this also supplies `school`, which
 * that helper does not, because `school-mode` only joins the catalog's id list
 * when a caller has School mode to offer. Leaving it out here would silently
 * shrink the id set this test is supposed to be checking completeness against.
 */
function fullCatalog() {
  return settingsCatalog({
    t,
    lang: 'en',
    setLang: () => {},
    dark: false,
    setDark: () => {},
    funEn: 5,
    setFunEn: () => {},
    funZh: 5,
    setFunZh: () => {},
    narrator: narrator(),
    comfort: {
      modes: { focus: false, lowStimulation: false, timeAwareness: false, oneThing: false, momentum: false },
      toggleMode: () => {},
      vocabularyEntries: 0,
    },
    school: { on: false, name: 'School mode' },
  });
}

test('every catalog id has an explanation, and every explanation is a real catalog id', () => {
  const catalogIds = new Set(fullCatalog().map((entry) => entry.id));
  const explainedIds = new Set(EXPLAINED_SETTINGS.map((row) => row.id));
  assert.deepEqual([...explainedIds].sort(), [...catalogIds].sort());
});

test('EXPLAINED_SETTINGS has no duplicate ids, and every row explains rather than restates', () => {
  const ids = EXPLAINED_SETTINGS.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const row of EXPLAINED_SETTINGS) {
    assert.ok(row.en.length > 0, `${row.id} needs an English explanation`);
    assert.ok(row.zh.length > 0, `${row.id} needs a Cantonese explanation`);
    assert.ok(row.shipped.length > 0, `${row.id} needs a named shipped value`);
    assert.notEqual(row.shipped, 'default', `${row.id} must name the real value, not the word "default"`);
  }
});

test('explanationFor finds a real id and returns null for one that does not exist', () => {
  const theme = explanationFor('theme');
  assert.ok(theme);
  assert.equal(theme.shipped, 'Light');
  assert.equal(explanationFor('not-a-real-setting-id'), null);
});

test('provenanceLine says a stored value came from you, and names the real shipped value otherwise', () => {
  assert.equal(provenanceLine({ stored: true, shipped: 'Light' }, t), 'From your saved value');
  assert.equal(provenanceLine({ stored: false, shipped: 'Light' }, t), 'Shipped default: Light');
  assert.equal(provenanceLine({ stored: false, shipped: '5' }, t), 'Shipped default: 5');
  // The Cantonese branch names the value too, not just the English one.
  const zh = (en, cantonese) => cantonese;
  assert.equal(provenanceLine({ stored: false, shipped: 'Light' }, zh), '預設:Light');
});
