import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptySelection, previewBulk, toggle } from '../lib/list-selection.ts';

const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

// The saved-trips bulk tools and the per-trip toy lock arrived in separate lanes. Each was fine
// alone; together, bulk delete and export would have walked straight past a locked card.

test('a protected row is skipped by a bulk action with its reason, and the rest still change', () => {
  const rows = [{ id: 'open' }, { id: 'locked' }];
  let selection = emptySelection();
  selection = toggle(selection, 'open');
  selection = toggle(selection, 'locked');
  const preview = previewBulk(selection, rows, rows.length, (row) => (row.id === 'locked' ? 'locked, unlock it first' : null));
  assert.deepEqual(preview.affected.map((row) => row.id), ['open']);
  assert.deepEqual(preview.skipped, [{ id: 'locked', reason: 'locked, unlock it first' }]);
});

test('the saved-trips panel passes its protection to the bulk preview and to the export', () => {
  const panel = source('components/saved-trips-panel.tsx');
  assert.match(panel, /previewBulk\(selection, matched, matched\.length, protect\)/);
  assert.match(panel, /matched\.filter\(\(trip\) => protect\(trip\) === null\)/);
  assert.match(panel, /return wrapRow \? <Fragment key=\{s\.id\}>\{wrapRow\(s, row\)\}<\/Fragment> : row;/);
});

test('the planner protects every saved trip by its own lock and gates each row', () => {
  const page = source('app/page.tsx');
  // A leading space, so a renamed `data-protect=` or `oldWrapRow=` cannot satisfy it by substring.
  assert.match(page, /\sprotect=\{\(s\) => \(isTargetLocked\(`saved-trip:\$\{s\.id\}`\) \?/);
  assert.match(page, /\swrapRow=\{\(s, row\) => \(/);
});
