import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_STEPS, SURFACES } from '../scripts/ui-evidence/interaction-inventory.mjs';

/**
 * The ledger is evidence about a build, so these check it is still about *this*
 * build and still covers the whole inventory.
 *
 * A recorded run whose commit has moved on is superseded evidence, and superseded
 * evidence that nobody notices is worse than none: it reads as a green result for
 * a tree that no longer exists.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dir = path.join(root, 'docs', 'interface', 'ledger');

/** The tuples that must have been driven. Hand-written, so a missing one shows. */
const REQUIRED_TUPLES = ['1440-light-1x', '1440-dark-1x', '390-light-1x', '390-dark-1x'];

const ledgers = Object.fromEntries(
  readdirSync(dir).filter((name) => name.endsWith('.json'))
    .map((name) => [name.replace(/\.json$/, ''), JSON.parse(readFileSync(path.join(dir, name), 'utf8'))]),
);

test('every required tuple was driven', () => {
  const missing = REQUIRED_TUPLES.filter((tuple) => !ledgers[tuple]);
  assert.deepEqual(missing, [], 'a tuple with no ledger was never driven');
});

test('each ledger covers the whole inventory, with nothing skipped', () => {
  for (const tuple of REQUIRED_TUPLES) {
    const ledger = ledgers[tuple];
    assert.equal(ledger.recordedRows, ALL_STEPS.length, `${tuple} recorded ${ledger.recordedRows} of ${ALL_STEPS.length} steps`);
    assert.equal(ledger.inventorySteps, ALL_STEPS.length, `${tuple} was driven against a different inventory`);
    const steps = new Set(ledger.rows.map((row) => row.step));
    for (const step of ALL_STEPS) assert.ok(steps.has(step.id), `${tuple} has no row for ${step.id}`);
  }
});

test('every click carries its own capture and a hash of it', () => {
  for (const tuple of REQUIRED_TUPLES) {
    for (const row of ledgers[tuple].rows) {
      assert.ok(row.screenshot, `${tuple}/${row.step} has no capture`);
      assert.match(row.screenshotSha256, /^[a-f0-9]{64}$/, `${tuple}/${row.step} has no capture hash`);
      // A final-state gallery cannot tell a control that worked from one never pressed.
      assert.ok(Object.hasOwn(row, 'before') && Object.hasOwn(row, 'after'), `${tuple}/${row.step} records no transition`);
      assert.ok(row.expected, `${tuple}/${row.step} asserts nothing about the state afterwards`);
    }
  }
});

test('every row is bound to the build it was recorded against', () => {
  for (const tuple of REQUIRED_TUPLES) {
    const ledger = ledgers[tuple];
    assert.match(ledger.sourceCommit, /^[0-9a-f]{40}$/, `${tuple} names no source commit`);
    for (const row of ledger.rows) {
      assert.equal(row.sourceCommit, ledger.sourceCommit, `${tuple}/${row.step} names a different commit`);
      assert.equal(row.viewport.width, ledger.viewportWidth);
      assert.equal(row.theme, ledger.theme);
      assert.equal(row.displayScale, ledger.displayScale);
    }
  }
});

test('all four tuples describe the same build', () => {
  // Four runs at four commits are four unrelated facts, not one verdict.
  const commits = new Set(REQUIRED_TUPLES.map((tuple) => ledgers[tuple].sourceCommit));
  assert.equal(commits.size, 1, `the tuples were recorded against ${commits.size} different commits`);
});

test('nothing failed, and nothing leaked', () => {
  for (const tuple of REQUIRED_TUPLES) {
    const ledger = ledgers[tuple];
    const bad = ledger.rows.filter((row) => row.outcome === 'absent' || row.outcome === 'state-not-reached');
    assert.deepEqual(bad.map((row) => row.step), [], `${tuple} has steps that did not reach their state`);
    const leaked = ledger.rows.filter((row) => row.privacy !== 'clean');
    assert.deepEqual(leaked.map((row) => row.step), [], `${tuple} leaked into its evidence`);
    assert.deepEqual(ledger.consoleErrors, [], `${tuple} threw during the run`);
  }
});

test('the inventory is hand-written and every step is named once', () => {
  // Discovery would pass on a surface whose controls had all disappeared.
  const ids = ALL_STEPS.map((step) => step.id);
  assert.equal(ids.length, new Set(ids).size, 'a step id is used twice');
  assert.ok(SURFACES.length >= 9, 'every destination is covered');
  for (const step of ALL_STEPS) {
    assert.ok(step.expect, `${step.id} asserts nothing afterwards`);
    assert.ok(step.describe && step.describe.length > 10, `${step.id} does not say what it proves`);
  }
});
