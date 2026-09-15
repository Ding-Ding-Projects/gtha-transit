import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHANGELOG_CATEGORIES, exportEntries, filterEntries, parseChangelog } from '../lib/changelog.ts';
import { ALREADY_SHAPED_RE, categoryFromPaths, RULES } from '../scripts/changelog-backfill.mjs';

const SAMPLE = [
  '# Changelog',
  '',
  '## 0.1.0, unreleased',
  '',
  '- 2026-09-14 · deployment · Bring routing back ([98bb8c2](https://github.com/o/r/commit/98bb8c2)).',
  '- 2026-09-09 · interface · Restore the rail ([d896185](https://github.com/o/r/commit/d896185)), from ([01a9ae9](https://github.com/o/r/commit/01a9ae9)).',
  '- unknown-date · unknown · Something nobody dated.',
  '- A bare bullet nobody backfilled.',
  '',
  'Preamble prose that is not an entry.',
].join('\n');

test('both entry shapes parse, and nothing is invented for the bare one', () => {
  const parsed = parseChangelog(SAMPLE);
  assert.equal(parsed.version, '0.1.0');
  assert.equal(parsed.unreleased, true);
  assert.equal(parsed.entries.length, 4);
  assert.deepEqual(parsed.entries.map((entry) => [entry.date, entry.category]), [
    ['2026-09-14', 'deployment'], ['2026-09-09', 'interface'], [null, 'unknown'], [null, 'unknown'],
  ]);
  assert.equal(parsed.entries[3].text, 'A bare bullet nobody backfilled.');
});

test('an entry keeps every link and points at the last commit it cites', () => {
  const [, rail] = parseChangelog(SAMPLE).entries;
  assert.equal(rail.sha, '01a9ae9');
  assert.equal(rail.links.length, 2);
});

test('date, category and search narrow independently, and an undated entry never matches a range', () => {
  const { entries } = parseChangelog(SAMPLE);
  assert.equal(filterEntries(entries, { from: '2026-09-10' }).length, 1);
  assert.equal(filterEntries(entries, { to: '2026-09-10' }).length, 1);
  assert.equal(filterEntries(entries, { categories: ['interface', 'unknown'] }).length, 3);
  assert.equal(filterEntries(entries, { matches: [true, false, true, false] }).length, 2);
  assert.equal(filterEntries(entries, { from: '2026-09-01', categories: ['unknown'] }).length, 0);
  assert.equal(filterEntries(entries, {}).length, 4);
});

test('an export says which slice it is, in both formats, including an empty one', () => {
  const { entries } = parseChangelog(SAMPLE);
  const markdown = exportEntries(entries.slice(0, 1), 'markdown', { range: { from: '2026-09-10' }, filters: { categories: ['deployment'], query: 'routing' } });
  assert.match(markdown, /^# GTHA Transit changelog export/);
  assert.match(markdown, /Exported range: 2026-09-10 through the latest entry — categories: deployment — matching "routing"/);
  assert.match(markdown, /^- 2026-09-14 · deployment · Bring routing back/m);
  assert.match(exportEntries([], 'text'), /No entries match the current filters\./);
});

test('a merge or broad commit is categorised by what most of its files are, not by one stray file', () => {
  assert.equal(categoryFromPaths(['HANDOFF.md', 'CHANGELOG.md', 'components/a.tsx', 'components/b.tsx', 'backend/x.mjs']), 'interface');
  assert.equal(categoryFromPaths(['backend/compose.yaml', 'backend/reattach-detached.sh', 'backend/compose-contract.test.mjs', 'docs/deployment/restarting.md']), 'deployment');
  assert.equal(categoryFromPaths(['HANDOFF.md', 'ROADMAP.md', 'CHANGELOG.md']), 'docs');
  assert.equal(categoryFromPaths(['package.json']), 'release');
  // A tie goes to the earlier, more specific rule.
  assert.equal(categoryFromPaths(['scripts/ui-evidence/a.mjs', 'app/page.tsx']), 'evidence');
});

test('every backfill rule names a category the parser knows', () => {
  for (const [category] of RULES) assert.ok(CHANGELOG_CATEGORIES.includes(category), category);
});

test('every entry in CHANGELOG.md is dated and categorised, so the viewer has nothing to guess', () => {
  const text = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const bullets = text.split(/\r?\n/).filter((line) => line.startsWith('- '));
  assert.ok(bullets.length > 100, `expected the real changelog, found ${bullets.length} entries`);
  const unshaped = bullets.filter((line) => !ALREADY_SHAPED_RE.test(line));
  assert.deepEqual(unshaped.map((line) => line.slice(0, 80)), [], 'write new entries as "- YYYY-MM-DD · category · text", or run node scripts/changelog-backfill.mjs');
  const undated = bullets.filter((line) => line.startsWith('- unknown-date'));
  assert.deepEqual(undated.map((line) => line.slice(0, 80)), []);
  for (const entry of parseChangelog(text).entries) assert.notEqual(entry.category, 'unknown', entry.text.slice(0, 60));
});
