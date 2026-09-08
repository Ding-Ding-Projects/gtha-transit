import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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

test('a width-scoped step is recorded as such, and only at the widths it names', () => {
  // The rail lists every destination, so More exists on a phone and nowhere else.
  // Marking that not-applicable is honest; recording a pass for a display:none
  // control would be a green row about something nobody can reach.
  for (const tuple of REQUIRED_TUPLES) {
    const ledger = ledgers[tuple];
    for (const row of ledger.rows) {
      if (!row.applicableWidths) {
        assert.notEqual(row.outcome, 'not-applicable', `${tuple}/${row.step} is not applicable but names no widths`);
        continue;
      }
      const belongs = row.applicableWidths.includes(ledger.viewportWidth);
      assert.equal(
        row.outcome === 'not-applicable',
        !belongs,
        `${tuple}/${row.step} names widths ${row.applicableWidths.join(', ')} and recorded ${row.outcome}`,
      );
    }
  }
  // And every width-scoped step must actually run somewhere, or it is dead.
  const everywhere = REQUIRED_TUPLES.flatMap((tuple) => ledgers[tuple].rows);
  const scoped = new Set(everywhere.filter((row) => row.applicableWidths).map((row) => row.step));
  for (const step of scoped) {
    const ran = everywhere.some((row) => row.step === step && row.outcome !== 'not-applicable');
    assert.ok(ran, `${step} is not applicable at any tuple that was driven`);
  }
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

test('a tuple was actually recorded in the theme it claims', () => {
  /* The theme was set by assigning `data-theme`, which the application owns and
     rewrites from its own state on mount. The assignment was overwritten, nothing
     failed, and the dark tuples were the light interface with dark in the filename:
     eighty captures that looked like coverage and were the same eighty images as
     the light run. The declared theme was checked against itself, which is why it
     always agreed. This checks it against what the document actually carried. */
  for (const tuple of REQUIRED_TUPLES) {
    const ledger = ledgers[tuple];
    const first = ledger.rows[0];
    assert.equal(
      first.before.theme,
      ledger.theme,
      `${tuple} says ${ledger.theme} but the document carried ${first.before.theme} when the run began`,
    );
    /* Two steps toggle the appearance on purpose. Every other step must sit in the
       tuple's own theme, or a capture in the middle of the run is mislabelled. */
    const strayed = ledger.rows
      .filter((row) => !row.step.startsWith('nav.theme'))
      .filter((row) => row.before.theme && row.before.theme !== ledger.theme);
    assert.deepEqual(
      strayed.map((row) => `${row.step}=${row.before.theme}`),
      [],
      `${tuple} recorded steps outside its own theme`,
    );
  }
});

test('a shots directory holds one run, not several', () => {
  /* The recorder used to write beside whatever an earlier run had left, so a
     directory could hold two runs at once. The ledger stayed correct, because it
     names the files it wrote, but anything reaching for a capture by pattern got
     whichever run sorted first: a README published a light capture as the dark
     interface for exactly this reason. Captures are not committed, so this only
     checks where they actually are. */
  for (const tuple of REQUIRED_TUPLES) {
    const directory = path.join(root, 'docs', 'interface', 'ledger', `shots-${tuple}`);
    if (!existsSync(directory)) continue;
    const named = new Set(ledgers[tuple].rows.map((row) => row.screenshot.split('/').pop()));
    const orphans = readdirSync(directory).filter((file) => file.endsWith('.png') && !named.has(file));
    assert.deepEqual(orphans.slice(0, 5), [],
      `${tuple} has ${orphans.length} captures on disk that its ledger does not name, so the directory holds more than one run`);
  }
});

test('the README shows the captures that were actually published', async () => {
  /* Two ways this drifts, and neither announces itself: a capture is added to the
     matrix and never referenced, so nobody sees it; or the README references one
     that is no longer published, so a reader gets a broken image where the product
     should be. Both are checked against the matrix rather than against each other. */
  const { MATRIX } = await import('../scripts/ui-evidence/publish-captures.mjs');
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
  const referenced = [...readme.matchAll(/\]\((docs\/captures\/[^)]+)\)/g)].map((match) => match[1]);

  for (const [, , name] of MATRIX) {
    const published = referenced.find((file) => file.includes('/' + name + '-'));
    assert.ok(published, `${name} is published and the README never shows it`);
    assert.ok(existsSync(path.join(root, published)), `${published} is referenced and not on disk`);
  }
  for (const file of referenced) {
    assert.ok(existsSync(path.join(root, file)), `the README references ${file}, which is not on disk`);
  }
  // Alt text carries the picture to a reader who cannot see it, so an empty one is
  // the same as no picture for them.
  for (const [, , , alt] of MATRIX) {
    assert.ok(alt && alt.length > 10, 'a published capture has no useful alt text');
    assert.ok(readme.includes('![' + alt + ']'), `the README does not carry the alt text for: ${alt}`);
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
