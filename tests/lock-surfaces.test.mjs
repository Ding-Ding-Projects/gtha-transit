import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { lockCovering, settingsCatalog } from '../lib/settings-catalog.ts';
import { paletteEntries } from '../lib/command-palette.ts';
import {
  addLock,
  attemptsFor,
  isTargetLocked,
  ladderCleared,
  newAttempt,
  relock,
  removeLock,
  lockStoreSnapshot,
  submitFactor,
} from '../lib/use-toy-locks.ts';
import { ATTEMPTS_PER_WAIT } from '../lib/toy-locks.ts';
import { base32Encode, totpAt } from '../lib/totp.ts';

/* A browser's storage, as far as the store needs one. Without it every write is
   refused, which is its own tested path: the history declines a record it cannot
   keep rather than claiming it. */
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => { memory.set(key, String(value)); },
  removeItem: (key) => { memory.delete(key); },
};

const t = (en) => en;
const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

function narrator() {
  return {
    settings: { enabled: true, language: 'en', englishVoiceURI: '', cantoneseVoiceURI: '', rate: 1, pitch: 1, quiet: false },
    updateSettings: () => {}, speechAvailable: true, voices: [], voicesLoaded: true,
  };
}

const catalog = (locked, calls = []) => settingsCatalog({
  t, lang: 'en', setLang: (value) => calls.push(['lang', value]), dark: false, setDark: (value) => calls.push(['dark', value]),
  funEn: 5, setFunEn: (value) => calls.push(['funEn', value]), funZh: 5, setFunZh: () => {}, narrator: narrator(),
  appearance: { ready: true, global: { appName: null, seed: null, density: 'default', sizeScale: 1, showEmoji: true }, set: (patch) => calls.push(['appearance', patch]) },
  locked,
});

/* ------------------------------------------------------ search and palette -- */

test('a locked section stays in every search, labelled, and its control is refused', () => {
  const calls = [];
  const open = catalog([], calls);
  const shut = catalog(['settings-section:language'], calls);
  assert.equal(shut.length, open.length, 'nothing leaves the search because it is locked');
  const language = shut.find((entry) => entry.id === 'language');
  assert.equal(language.locked, true);
  assert.equal(language.control.kind, 'none', 'the palette gets nothing to operate');
  assert.match(language.unavailable, /Locked/);
  assert.match(language.value, /locked/);
  assert.equal(language.selector, '[data-lock-target="settings-section:language"] [data-ui="lock.unlock"]', 'the teleport lands on the unlock control');
  assert.equal(shut.find((entry) => entry.id === 'theme').locked, undefined, 'another section is untouched');
});

test('the palette cannot change a value through a locked row', () => {
  const calls = [];
  const settings = catalog(['settings-section:appearance'], calls);
  const rows = paletteEntries({ t, destinations: [], settings, actions: [] });
  const theme = rows.find((row) => row.id === 'setting:theme');
  assert.equal(theme.setting.control.kind, 'none');
  assert.equal(typeof theme.setting.control.apply, 'undefined', 'there is no setter to call');
  assert.equal(theme.unavailable, 'Locked. Unlock it first to change this.');
  assert.deepEqual(calls, []);
});

test('the studio lock covers the studio rows and not the theme beside it', () => {
  assert.equal(lockCovering({ id: 'appearance-name', section: 'appearance' }, ['appearance-studio:studio']), 'appearance-studio:studio');
  assert.equal(lockCovering({ id: 'theme', section: 'appearance' }, ['appearance-studio:studio']), null);
  assert.equal(lockCovering({ id: 'theme', section: 'appearance' }, ['settings-section:appearance']), 'settings-section:appearance');
  const shut = catalog(['appearance-studio:studio']);
  assert.equal(shut.find((entry) => entry.id === 'appearance-name').control.kind, 'none');
  assert.equal(shut.find((entry) => entry.id === 'theme').control.kind, 'choice');
});

test('locks, the authenticator, the desk and the history are all reachable from the search', () => {
  const ids = catalog([]).map((entry) => entry.id);
  for (const id of ['toy-locks', 'authenticator', 'support-tickets', 'secret-history']) assert.ok(ids.includes(id), `${id} is missing`);
});

/* ------------------------------------------------------------------ store -- */

const trip = { kind: 'saved-trip', key: 'test-trip', label: { en: 'Union to Finch', zh: 'Union 至 Finch' } };
const draft = (overrides = {}) => ({ target: trip, policy: 'pin', pin: '4821', pinConfirm: '4821', duration: { kind: 'session' }, acknowledged: true, ...overrides });

test('a shut lock cannot be removed, and an open one can', () => {
  const lock = addLock(draft({ target: { ...trip, key: 'remove-me' } }));
  relock(lock.id);
  assert.equal(isTargetLocked('saved-trip:remove-me'), true);
  assert.equal(removeLock(lock.id), false, 'the lock list is not a way around the lock');
  const attempt = newAttempt(lock.id);
  assert.equal(submitFactor(lock.id, attempt, '4821').outcome, 'unlocked');
  assert.equal(removeLock(lock.id), true);
});

test('a surface with a lock refuses a second one rather than stacking a hidden credential', () => {
  addLock(draft({ target: { ...trip, key: 'only-one' } }));
  assert.throws(() => addLock(draft({ target: { ...trip, key: 'only-one' } })));
});

test('clearing the ladder in the store ends the wait and leaves the surface locked', () => {
  const lock = addLock(draft({ target: { ...trip, key: 'ladder' } }));
  relock(lock.id);
  let attempt = newAttempt(lock.id);
  for (let index = 0; index < ATTEMPTS_PER_WAIT; index += 1) attempt = submitFactor(lock.id, attempt, '0000').attempt;
  assert.notEqual(attemptsFor(lock.id).waitUntil, null);
  ladderCleared(lock.id);
  assert.equal(attemptsFor(lock.id).waitUntil, null);
  assert.equal(attemptsFor(lock.id).lockouts, 1, 'the escalation stands');
  assert.equal(isTargetLocked('saved-trip:ladder'), true, 'no grant came with it');
});

test('the history records locks being made and removed, and never their credential', () => {
  const secret = base32Encode(new TextEncoder().encode('fake-history-secret-1'));
  const code = totpAt(new TextEncoder().encode('fake-history-secret-1'), Math.floor(Date.now() / 1000));
  const lock = addLock(draft({
    target: { ...trip, key: 'history' }, policy: 'password+pin+totp', password: 'fake-password-1', passwordConfirm: 'fake-password-1',
    otpSecret: secret, otp: { algorithm: 'sha1', digits: 6, period: 30 }, otpConfirmCode: code,
  }));
  assert.equal(removeLock(lock.id), true);
  const history = lockStoreSnapshot().history;
  const actions = history.filter((record) => record.subject.includes('saved-trip:history')).map((record) => record.action);
  assert.deepEqual(actions, ['lock-created', 'lock-removed']);
  const text = JSON.stringify(history);
  for (const forbidden of [secret, 'fake-password-1', '4821', code]) assert.ok(!text.includes(forbidden), 'no credential reaches the history');
});

/* --------------------------------------------------------------- the gate -- */

test('the gate makes its content inert and refuses every route in while locked', () => {
  const gate = source('components/toy-lock.tsx');
  assert.match(gate, /inert=\{locked\}/);
  for (const route of ['onClickCapture', 'onPointerDownCapture', 'onKeyDownCapture', 'onInputCapture', 'onChangeCapture', 'onSubmitCapture', 'onDragStartCapture', 'onDropCapture']) {
    assert.match(gate, new RegExp(`${route}=\\{refuse\\}`), `${route} is not refused`);
  }
  assert.match(gate, /const refuse = useCallback\(\(event: SyntheticEvent\) => \{\s*if \(!locked\) return;\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*setPrompt\(true\);/);
});

test('the keypad and the typed field feed one validator and one attempt budget', () => {
  const gate = source('components/toy-lock.tsx');
  assert.equal((gate.match(/submitFactor\(/g) ?? []).length, 1, 'one call site, so the two routes cannot disagree');
  assert.match(gate, /data-ui=\{`lock\.keypad\.\$\{digit\}`\} onClick=\{\(\) => setValue\(/, 'the keypad only fills the same value the field holds');
});

test('every lockable settings section is gated, and the way out is not', () => {
  const workspace = source('components/settings-workspace.tsx');
  for (const section of ['appearance', 'language', 'comfort', 'narrator']) {
    assert.match(workspace, new RegExp(`<LockGate target=\\{sectionTarget\\('${section}'\\)\\}`), `${section} has no gate`);
  }
  const privacy = workspace.slice(workspace.indexOf('<TabsContent value="privacy"'), workspace.indexOf('</TabsContent>', workspace.indexOf('<TabsContent value="privacy"')));
  assert.ok(privacy.includes('<LocksCard'), 'the privacy panel was found');
  assert.doesNotMatch(privacy, /<LockGate\b/, 'nothing in the Privacy section, which holds the way out, is behind a lock of its own section');
  assert.match(workspace, /<LockGate target=\{STUDIO_TARGET\}/);
  const comfortGateEnd = workspace.indexOf('</LockGate>', workspace.indexOf("sectionTarget('comfort')"));
  assert.ok(workspace.indexOf('<SchoolMode') > comfortGateEnd, 'School mode, itself a way out, sits outside the Comfort lock');
});

test('no lock source or test carries an invisible control character', () => {
  /* A script once turned a regular expression's word boundary into a literal
     backspace here, and the guard it belonged to matched nothing while staying
     green. A pattern nobody can see is a pattern nobody can review. */
  const files = ['lib/toy-locks.ts', 'lib/unlock-ladder.ts', 'lib/totp.ts', 'lib/use-toy-locks.ts', 'lib/secret-history.ts', 'lib/authenticator.ts', 'lib/support-tickets.ts',
    'components/toy-lock.tsx', 'components/locks-settings.tsx', 'tests/toy-locks.test.mjs', 'tests/unlock-ladder.test.mjs', 'tests/totp.test.mjs', 'tests/support-tickets.test.mjs', 'tests/lock-surfaces.test.mjs'];
  for (const file of files) assert.ok(![...source(file)].some((character) => { const code = character.charCodeAt(0); return code < 32 && code !== 9 && code !== 10 && code !== 13; }), `${file} has a control character in it`);
});

test('every saved trip is gated with its own target', () => {
  const page = source('app/page.tsx');
  assert.match(page, /<LockGate key=\{s\.id\} compact schoolOn=\{school\.on\} t=\{t\} target=\{\{ kind: 'saved-trip', key: s\.id,/);
});

test('the history opens only behind its own lock', () => {
  assert.match(source('components/locks-settings.tsx'), /<LockGate target=\{HISTORY_TARGET\} t=\{t\} requireLock>/);
});

test('under School mode the ladder asks for no dish pictures at all', () => {
  const gate = source('components/toy-lock.tsx');
  assert.match(gate, /const dishes = schoolOn \? \[\] : await loadDishes\(\);/);
  assert.match(gate, /createLadderSession\(\{ schoolOn, dishes \}\)/);
});

test('the unlock prompt carries the disclosure, the recovery line and the desk', () => {
  const gate = source('components/toy-lock.tsx');
  const prompt = gate.slice(gate.indexOf('function UnlockPrompt'), gate.indexOf('async function loadDishes'));
  assert.match(prompt, /LOCK_DISCLOSURE\.en, LOCK_DISCLOSURE\.zh/);
  assert.match(prompt, /LOCK_RECOVERY\.en, LOCK_RECOVERY\.zh/);
  assert.match(prompt, /data-ui="lock\.forgot"/);
});

test('removing a lock, an entry, tickets or history goes through the two-key gate', () => {
  const surface = source('components/locks-settings.tsx');
  assert.match(surface, /<SuperConfirm open action=\{pending\.action\}/);
  for (const marker of ['removeLock(lock.id)', "action: 'totp-removed'", 'removeTickets(store.tickets, selected)', 'pruneHistory(store.history, keep)']) {
    const at = surface.indexOf(marker);
    assert.ok(at > 0, `${marker} is missing`);
    assert.ok(surface.lastIndexOf('ask(', at) > surface.lastIndexOf('</section>', at), `${marker} is not behind ask()`);
  }
});
