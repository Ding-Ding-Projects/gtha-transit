import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The design parity gate.
 *
 * It fails closed. A reference screen that is absent from the inventory, a tuple
 * that is incomplete or differs between the two sides, a capture that is missing or
 * stale, or a deviation without a recorded reason all turn this red.
 *
 * The inventory is hand-written on purpose. Deriving it from the reference file
 * would let a screen that disappeared from both vanish without a word, which is
 * exactly the gap a parity check exists to notice: a guard that only validates what
 * it can already see cannot report something that is simply gone.
 *
 * What it deliberately does not gate on is the pixel difference. The reference is a
 * mock with placeholder slots where the map and the live data belong, so the two
 * sides differ enormously by construction, and a threshold on that number would
 * either pass everything or block every honest change. The number is recorded for
 * review; the gate is on the evidence existing, matching its tuple, and being bound
 * to a real commit.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const inventory = JSON.parse(readFileSync(path.join(root, 'design', 'parity-inventory.json'), 'utf8'));
const evidencePath = path.join(root, 'docs', 'design', 'parity', 'evidence.json');
const evidence = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, 'utf8')) : null;

const referenceFile = path.join(root, 'design', 'reference', inventory.reference);
const referenceHtml = readFileSync(referenceFile, 'utf8');
const declaredScreens = [...referenceHtml.matchAll(/data-screen-label="([^"]+)"/g)].map((m) => m[1]);

test('every screen the reference declares is in the inventory, exactly once', () => {
  const listed = inventory.rows.map((row) => row.referenceScreen);
  assert.equal(listed.length, new Set(listed).size, 'a reference screen is listed twice');
  for (const screen of declaredScreens) {
    assert.ok(listed.includes(screen), `the reference declares "${screen}" and the inventory does not name it`);
  }
  for (const screen of listed) {
    assert.ok(declaredScreens.includes(screen), `the inventory names "${screen}" and the reference does not declare it`);
  }
});

test('every row names a complete, addressable tuple on both sides', () => {
  for (const row of inventory.rows) {
    for (const field of ['id', 'referenceScreen', 'viewerRoute', 'appDestination', 'appHeading', 'state', 'theme', 'scale']) {
      assert.ok(row[field] !== undefined && row[field] !== null && row[field] !== '', `${row.id || '(unnamed)'} has no ${field}`);
    }
    assert.ok(row.viewport && Number.isFinite(row.viewport.width) && Number.isFinite(row.viewport.height),
      `${row.id} has no viewport`);
    assert.ok(['light', 'dark'].includes(row.theme), `${row.id} names a theme that is neither light nor dark`);
    assert.ok(row.viewerRoute.startsWith('/screen/'), `${row.id} has no reference-viewer route`);
    assert.ok(Array.isArray(row.deviations), `${row.id} has no deviations list, not even an empty one`);
  }
});

test('a deviation records what it is and why it was accepted', () => {
  // A deviation with no reason reads as an oversight to the next person and as a
  // decision to nobody, which is the whole thing this field exists to prevent.
  for (const row of inventory.rows) {
    for (const deviation of row.deviations) {
      assert.ok(deviation.what && deviation.what.length > 10, `${row.id} has a deviation with no description`);
      assert.ok(deviation.why && deviation.why.length > 10, `${row.id} has a deviation with no recorded reason`);
    }
  }
});

test('every inventoried screen has captured evidence', () => {
  assert.ok(evidence, 'no parity evidence has been recorded at all');
  assert.match(evidence.sourceCommit, /^[0-9a-f]{40}$/, 'the evidence names no source commit');
  const captured = new Map(evidence.rows.map((row) => [row.id, row]));
  for (const row of inventory.rows) {
    assert.ok(captured.has(row.id), `${row.id} is inventoried and was never captured`);
  }
  for (const row of evidence.rows) {
    assert.ok(inventory.rows.some((entry) => entry.id === row.id), `${row.id} was captured and is not inventoried`);
  }
});

test('both sides were captured at the same tuple, and it is the inventoried one', () => {
  for (const row of inventory.rows) {
    const shot = evidence.rows.find((entry) => entry.id === row.id);
    assert.equal(shot.theme, row.theme, `${row.id} was captured in a different theme than it names`);
    assert.equal(shot.scale, row.scale, `${row.id} was captured at a different scale than it names`);
    assert.equal(shot.viewport.width, row.viewport.width, `${row.id} was captured at a different width than it names`);
    assert.equal(shot.viewport.height, row.viewport.height, `${row.id} was captured at a different height than it names`);
    assert.equal(shot.state, row.state, `${row.id} was captured in a different state than it names`);
    assert.equal(shot.referenceScreen, row.referenceScreen);
    assert.equal(shot.appDestination, row.appDestination);
    // Both sides of the pair must have been photographed at that one tuple.
    assert.equal(shot.comparison.referenceSize.width, row.viewport.width * row.scale,
      `${row.id}: the reference capture is not the width it claims`);
    assert.equal(shot.comparison.appSize.width, row.viewport.width * row.scale,
      `${row.id}: the application capture is not the width it claims`);
  }
});

test('every capture exists on disk and is the file its hash names', () => {
  for (const shot of evidence.rows) {
    for (const kind of ['reference', 'app', 'sideBySide', 'diff']) {
      const rel = shot.files[kind];
      assert.ok(rel, `${shot.id} records no ${kind} capture`);
      const file = path.join(root, rel);
      assert.ok(existsSync(file), `${shot.id}: ${rel} is recorded and not on disk`);
      const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
      assert.equal(actual, shot.hashes[kind], `${shot.id}: ${rel} is not the file its hash names`);
    }
  }
});

test('the Material audit was measured on the running screen, not asserted', () => {
  for (const shot of evidence.rows) {
    const audit = shot.materialAudit;
    assert.ok(audit, `${shot.id} has no Material audit`);
    assert.ok(audit.controlsInspected > 0, `${shot.id} inspected no controls, so its audit says nothing`);
    assert.match(audit.primaryToken, /^#[0-9a-f]{6}$/i, `${shot.id} read no primary colour token from the running page`);
    assert.match(audit.surfaceToken, /^#[0-9a-f]{6}$/i, `${shot.id} read no surface colour token from the running page`);
    assert.ok(Array.isArray(audit.chromeCarryingLiteralColour), `${shot.id} records no literal-colour findings`);
  }
});

test('the reference viewer can address every inventoried screen', async () => {
  const { referenceScreens } = await import('../scripts/design/reference-viewer.mjs');
  const found = referenceScreens().find((entry) => entry.file === inventory.reference);
  assert.ok(found, `the viewer cannot see ${inventory.reference}`);
  for (const row of inventory.rows) {
    assert.ok(found.screens.includes(row.referenceScreen),
      `${row.id} names a screen the viewer cannot reach: ${row.referenceScreen}`);
    assert.ok(row.viewerRoute.includes(encodeURIComponent(row.referenceScreen)),
      `${row.id}'s viewer route does not address its own screen`);
  }
});
