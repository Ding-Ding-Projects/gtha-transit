import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DESTRUCTIVE_ACTIONS,
  clearSelection,
  emptySelection,
  hasSelection,
  invert,
  isDestructive,
  isSelected,
  previewBulk,
  resolveSelected,
  selectAllMatches,
  selectPage,
  selectRange,
  selectedCount,
  skipSummary,
  toggle,
} from '../lib/list-selection.ts';

import {
  EXPORT_FORMATS,
  EXPORT_MEDIA,
  describeLoss,
  exportFilename,
  exportRecords,
} from '../lib/export.ts';

const rows = (...ids) => ids.map((id) => ({ id }));
const visible = ['a', 'b', 'c', 'd', 'e'];

/* ------------------------------------------------------------- selection -- */

test('a row toggles on and off', () => {
  let selection = emptySelection();
  assert.equal(isSelected(selection, 'a'), false);
  selection = toggle(selection, 'a');
  assert.equal(isSelected(selection, 'a'), true);
  selection = toggle(selection, 'a');
  assert.equal(isSelected(selection, 'a'), false);
});

test('a range follows the order the rows are rendered in, not the underlying one', () => {
  // Somebody shift-clicking is selecting what they can see between two rows. Using
  // an underlying order would select a set they never pointed at.
  const selection = selectRange(emptySelection(), visible, 'b', 'd');
  assert.deepEqual(visible.filter((id) => isSelected(selection, id)), ['b', 'c', 'd']);
  const backwards = selectRange(emptySelection(), visible, 'd', 'b');
  assert.deepEqual(visible.filter((id) => isSelected(backwards, id)), ['b', 'c', 'd'], 'dragging upward is the same range');
  assert.deepEqual(selectRange(emptySelection(), visible, 'b', 'nope'), emptySelection(), 'a row that is not there selects nothing');
});

test('select-all has two meanings and the selection records which one', () => {
  /*
   * A list showing 50 of 1,200 rows has two honest answers to "select all" and
   * they differ by 1,150 items. Choosing silently is how somebody deletes the
   * wrong 1,150.
   */
  const page = selectPage(visible);
  assert.equal(page.scope, 'page');
  assert.equal(selectedCount(page, 1200), 5, 'this page means the five on it');

  const all = selectAllMatches();
  assert.equal(all.scope, 'matches');
  assert.equal(selectedCount(all, 1200), 1200, 'every match means all twelve hundred');
  assert.equal(isSelected(all, 'a-row-not-on-this-page'), true);
});

test('deselecting out of an all-matches selection excludes rather than enumerating', () => {
  let all = selectAllMatches();
  all = toggle(all, 'c');
  assert.equal(isSelected(all, 'c'), false);
  assert.equal(isSelected(all, 'a'), true);
  assert.equal(selectedCount(all, 1200), 1199);
  all = toggle(all, 'c');
  assert.equal(selectedCount(all, 1200), 1200, 'and back again');
});

test('inverting selects everything visible that was not selected', () => {
  const selection = selectRange(emptySelection(), visible, 'a', 'b');
  const inverted = invert(selection, visible);
  assert.deepEqual(visible.filter((id) => isSelected(inverted, id)), ['c', 'd', 'e']);
});

test('clearing empties it, and an empty selection has nothing to act on', () => {
  const selection = selectPage(visible);
  assert.equal(hasSelection(selection, 5), true);
  assert.equal(hasSelection(clearSelection(), 5), false);
  assert.equal(hasSelection(selectAllMatches(), 0), false, 'every match of nothing is nothing');
});

test('resolving gives the rows a bulk action will actually run over', () => {
  const selection = selectRange(emptySelection(), visible, 'b', 'c');
  assert.deepEqual(resolveSelected(selection, rows(...visible)).map((row) => row.id), ['b', 'c']);
});

/* --------------------------------------------------------------- preview -- */

test('a preview separates what will change from what is selected', () => {
  // "42 selected" must never quietly mean "39 will change".
  const pinned = new Set(['b', 'd']);
  const preview = previewBulk(selectPage(visible), rows(...visible), 5, (row) => (pinned.has(row.id) ? 'pinned' : null));
  assert.deepEqual(preview.affected.map((row) => row.id), ['a', 'c', 'e']);
  assert.deepEqual(preview.skipped, [{ id: 'b', reason: 'pinned' }, { id: 'd', reason: 'pinned' }]);
  assert.equal(preview.selected, 5, 'five were selected');
  assert.equal(preview.affected.length, 3, 'three will change');
});

test('a preview says when the selection reaches past what it can enumerate', () => {
  const preview = previewBulk(selectAllMatches(), rows(...visible), 1200);
  assert.equal(preview.beyondThisPage, true, 'twelve hundred selected, five on the page');
  assert.equal(preview.selected, 1200);
  assert.equal(preview.affected.length, 5);
  const page = previewBulk(selectPage(visible), rows(...visible), 5);
  assert.equal(page.beyondThisPage, false);
});

test('skips are summarised by reason, so one line can say what was left out', () => {
  const preview = previewBulk(selectPage(visible), rows(...visible), 5, (row) =>
    row.id === 'a' ? 'unsaved work' : ['b', 'c'].includes(row.id) ? 'pinned' : null);
  assert.deepEqual(skipSummary(preview), [{ reason: 'pinned', count: 2 }, { reason: 'unsaved work', count: 1 }]);
  assert.deepEqual(skipSummary(previewBulk(selectPage(visible), rows(...visible), 5)), [], 'nothing skipped is an empty summary');
});

test('the irreversible actions are the ones that need the confirmation gate', () => {
  for (const action of DESTRUCTIVE_ACTIONS) assert.equal(isDestructive(action), true);
  for (const action of ['export', 'dismiss', 'tag', 'move']) assert.equal(isDestructive(action), false, `${action} is undoable`);
});

/* ---------------------------------------------------------------- export -- */

const sample = [
  { id: '1', title: 'Trip saved', severity: 'success', count: 2 },
  { id: '2', title: 'Routing "failed", badly', severity: 'error', count: 11 },
];

test('every offered format writes something, and each has a media type and extension', () => {
  for (const format of EXPORT_FORMATS) {
    const text = exportRecords(sample, format, { name: 'notifications' });
    assert.ok(text.length > 0, `${format} wrote nothing`);
    assert.ok(EXPORT_MEDIA[format].extension, `${format} has no extension`);
    assert.match(EXPORT_MEDIA[format].type, /charset=utf-8/, `${format} does not state its encoding`);
  }
  assert.equal(EXPORT_FORMATS.length, 11);
});

test('an empty set exports as an empty set rather than as a broken file', () => {
  for (const format of EXPORT_FORMATS) {
    const text = exportRecords([], format, { name: 'notifications' });
    assert.ok(!text.includes('undefined'), `${format} wrote the word undefined`);
    assert.ok(!text.includes('NaN'), `${format} wrote NaN`);
  }
  assert.equal(exportRecords([], 'json'), '[]\n');
  assert.equal(exportRecords([], 'jsonl'), '');
});

test('a separator, a quote or a newline inside a value is quoted, or the file loses its columns', () => {
  const awkward = [{ id: 'a,b', title: 'He said "no"', body: 'line one\nline two' }];
  const csv = exportRecords(awkward, 'csv');
  assert.match(csv, /"a,b"/, 'a comma inside a value is quoted');
  assert.match(csv, /"He said ""no"""/, 'a quote is doubled');
  assert.match(csv, /"line one\nline two"/, 'a newline stays inside its cell');
  // One record whose value spans two physical lines is still one record: the
  // embedded newline is inside the quotes, and rows are separated by CRLF.
  assert.equal(csv.split('\r\n').filter(Boolean).length, 2, 'a header and one record');
  assert.equal(csv.split('\n').filter(Boolean).length, 3, 'across three physical lines');
  const tsv = exportRecords([{ id: 'a\tb' }], 'tsv');
  assert.match(tsv, /"a\tb"/, 'and a tab in a TSV');
});

test('json round trips, and jsonl is one record per line', () => {
  assert.deepEqual(JSON.parse(exportRecords(sample, 'json')), sample);
  const lines = exportRecords(sample, 'jsonl').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((line) => JSON.parse(line)), sample);
});

test('yaml quotes its strings, so a value cannot be read back as something else', () => {
  // Unquoted, `yes`, `null` and `12:30` come back as a boolean, a null and a
  // sexagesimal number.
  const yaml = exportRecords([{ id: 'yes', when: '12:30', note: 'null' }], 'yaml');
  assert.match(yaml, /id: "yes"/);
  assert.match(yaml, /when: "12:30"/);
  assert.match(yaml, /note: "null"/);
});

test('xml escapes, and a key that is not a valid element name becomes an attribute', () => {
  const xml = exportRecords([{ id: '1', 'not a name': 'x', title: 'a < b & c' }], 'xml', { name: 'notifications' });
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<title>a &lt; b &amp; c<\/title>/);
  assert.match(xml, /<field name="not a name">x<\/field>/, 'an invalid element name would not parse');
  assert.match(xml, /<notifications>/);
});

test('html escapes every cell, so an exported value cannot become markup', () => {
  const html = exportRecords([{ id: '<script>alert(1)</script>' }], 'html');
  assert.ok(!html.includes('<script>'), 'the value is escaped rather than executed');
  assert.match(html, /&lt;script&gt;/);
});

test('markdown escapes the pipe, which would otherwise become a column', () => {
  const markdown = exportRecords([{ id: 'a|b', note: 'one\ntwo' }], 'markdown');
  assert.match(markdown, /a\\\|b/);
  assert.ok(!markdown.includes('one\ntwo'), 'a newline inside a cell would end the row');
});

test('sql escapes quotes and infers a type from the values actually present', () => {
  const sql = exportRecords(sample, 'sql', { name: 'notifications' });
  assert.match(sql, /CREATE TABLE "notifications"/);
  assert.match(sql, /"count" INTEGER/);
  assert.match(sql, /"title" TEXT/);
  assert.match(sql, /'Routing "failed", badly'/, 'a double quote needs no escaping in a SQL string');
  assert.match(exportRecords([{ id: "O'Brien" }], 'sql'), /'O''Brien'/, "an apostrophe is doubled");
  assert.match(exportRecords([{ id: null }], 'sql'), /VALUES \(NULL\)/);
});

test('a schema describes the shape and says which columns are optional', () => {
  const schema = JSON.parse(exportRecords([{ id: '1', title: 'a', count: 2 }, { id: '2', title: 'b' }], 'schema', { name: 'notifications' }));
  assert.equal(schema.type, 'array');
  assert.equal(schema.items.properties.count.type, 'number');
  assert.equal(schema.items.properties.title.type, 'string');
  assert.deepEqual(schema.items.required.sort(), ['id', 'title'], 'a column missing from one record is optional');
});

test('a format that cannot carry the data says so before it writes', () => {
  // This is why the writers can be offered at all.
  const nested = [{ id: '1', actions: [{ id: 'retry', label: 'Retry' }] }];
  assert.match(describeLoss(nested, 'csv').join(' '), /structured values/);
  assert.match(describeLoss(nested, 'sql').join(' '), /structured values/);
  assert.deepEqual(describeLoss(nested, 'json'), [], 'json carries it exactly');
  assert.deepEqual(describeLoss(nested, 'jsonl'), []);
  assert.match(describeLoss(nested, 'schema').join(' '), /contains none of the records/);
  assert.match(describeLoss([{ id: '1', note: null }], 'toml').join(' '), /TOML has no null/);
  const ragged = [{ id: '1', title: 'a' }, { id: '2' }];
  assert.match(describeLoss(ragged, 'csv').join(' '), /empty cell, which is not the same as an empty value/);
});

test('a filename carries the day, and cannot escape its folder', () => {
  assert.equal(exportFilename('Notification history', 'csv', '2026-09-08'), 'notification-history-2026-09-08.csv');
  assert.equal(exportFilename('../../etc/passwd', 'json', '2026-09-08'), 'etc-passwd-2026-09-08.json');
  assert.equal(exportFilename('', 'json', '2026-09-08'), 'export-2026-09-08.json');
  assert.equal(exportFilename('x', 'schema', '2026-09-08'), 'x-2026-09-08.schema.json');
  for (const format of EXPORT_FORMATS) {
    const filename = exportFilename('notifications', format, '2026-09-08');
    assert.ok(!filename.includes('/') && !filename.includes('\\'), `${format} produced a path: ${filename}`);
  }
});

test('a note travels with the formats that can carry a comment', () => {
  const note = 'Filtered to errors, 8 September 2026';
  for (const format of ['json', 'yaml', 'toml', 'xml', 'markdown', 'html', 'sql']) {
    assert.ok(exportRecords(sample, format, { note }).includes('Filtered to errors'), `${format} dropped the note`);
  }
  // JSON Lines and CSV have nowhere to put one without corrupting the format, so
  // they do not pretend to.
  assert.ok(!exportRecords(sample, 'jsonl', { note }).includes(note));
  assert.ok(!exportRecords(sample, 'csv', { note }).includes(note));
});
