import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The audit's job is that no canonical feature can be silently absent.
 *
 * It deliberately does not assert that every feature exists. Most of them do not,
 * and a guard that is permanently red tells nobody anything they can act on. What
 * it asserts is that every feature named in the canonical list has a row, that
 * every row carries a verdict, and that a row claiming something ships can point
 * at the file that ships it. A feature that disappears loses its evidence and the
 * guard goes red; a feature that was never built is recorded as absent with a
 * reason, which is a decision rather than a gap.
 *
 * The list is hand-written. Deriving it from the audit file would make the audit
 * grade its own homework: a feature dropped from both would vanish without a word.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const audit = JSON.parse(readFileSync(path.join(root, 'docs', 'interface', 'feature-audit.json'), 'utf8'));

/** Every canonical feature this project is measured against. */
const CANONICAL = [
  'language-modes', 'funny-levels', 'narrator', 'regex-builder', 'notifications',
  'local-history', 'exports', 'accessibility', 'responsive-sizing', 'material-design-3',
  'tabbed-navigation', 'command-palette', 'appearance-editor', 'toy-locks', 'unlock-ladder',
  'adhd-modes', 'school-mode', 'personal-vocabulary-upload', 'bulk-actions', 'changelog-viewer',
  'dim-sum-surprise', 'app-logo-customization', 'file-converter', 'ollama-manager',
  'browser-extension-downloads', 'destructive-confirmation', 'share-embed-graphic',
  'scheduled-settings', 'external-editor', 'guided-forms', 'landing-page',
];

const VERDICTS = ['present', 'partial', 'absent', 'not-applicable'];
const byId = new Map(audit.features.map((feature) => [feature.id, feature]));

test('every canonical feature has a row', () => {
  const missing = CANONICAL.filter((id) => !byId.has(id));
  assert.deepEqual(missing, [], 'a feature with no row is a gap nobody decided on');
});

test('the audit invents no feature the canonical list does not name', () => {
  const extra = audit.features.map((feature) => feature.id).filter((id) => !CANONICAL.includes(id));
  assert.deepEqual(extra, [], 'add it to the canonical list, or it is padding');
});

test('every row carries a known verdict', () => {
  for (const feature of audit.features) {
    assert.ok(VERDICTS.includes(feature.verdict), `${feature.id} has verdict ${feature.verdict}`);
  }
});

test('a row that claims something ships points at the file that ships it', () => {
  for (const feature of audit.features) {
    if (feature.verdict !== 'present' && feature.verdict !== 'partial') continue;
    assert.ok(Array.isArray(feature.implementation) && feature.implementation.length,
      `${feature.id} claims to ship and names no implementation`);
    for (const file of feature.implementation) {
      assert.ok(existsSync(path.join(root, file)), `${feature.id} names ${file}, which does not exist`);
    }
  }
});

test('a documentation, test or capture path that is named actually exists', () => {
  for (const feature of audit.features) {
    for (const key of ['documentation', 'test', 'capture']) {
      const value = feature[key];
      if (!value) continue;
      assert.ok(existsSync(path.join(root, value)), `${feature.id} names a ${key} at ${value}, which does not exist`);
    }
  }
});

test('a present feature carries documentation and a test', () => {
  // Partial is allowed to be missing one; present is not.
  for (const feature of audit.features) {
    if (feature.verdict !== 'present') continue;
    assert.ok(feature.documentation, `${feature.id} is present with no documentation`);
    assert.ok(feature.test, `${feature.id} is present with no test`);
  }
});

test('an absent or partial feature says what is missing, and why', () => {
  for (const feature of audit.features) {
    if (feature.verdict === 'partial') {
      assert.ok(feature.missing && feature.missing.length > 25, `${feature.id} is partial without saying what is missing`);
    }
    if (feature.verdict === 'absent') {
      assert.ok(feature.reason && feature.reason.length > 10, `${feature.id} is absent without a reason`);
    }
  }
});

test('not-applicable is argued, never asserted', () => {
  // The exemption most likely to be reached for out of convenience, so it carries
  // the heaviest requirement: say why it cannot apply here, in a sentence.
  const exempt = audit.features.filter((feature) => feature.verdict === 'not-applicable');
  for (const feature of exempt) {
    assert.ok(feature.reason && feature.reason.length > 60,
      `${feature.id} claims not-applicable without arguing it`);
    assert.ok(!/convenien|later|for now|too small/i.test(feature.reason),
      `${feature.id} gives convenience as a reason, which is not one`);
  }
  assert.ok(exempt.length <= 6, 'not-applicable is an exemption, not a default');
});

test('the audit states what it is for, so nobody reads it as a scorecard', () => {
  assert.ok(audit.purpose && audit.purpose.length > 80);
  assert.equal(audit.version, 1);
  for (const verdict of VERDICTS) assert.ok(audit.verdicts[verdict], `${verdict} is undefined`);
});
