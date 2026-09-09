import test from 'node:test';
import assert from 'node:assert/strict';

import { diffJson, summariseDiff, MAX_DIFF_DEPTH, MAX_DIFF_ENTRIES } from '../lib/json-diff.ts';

const byPath = (entries) => Object.fromEntries(entries.map((entry) => [entry.path, entry]));

test('reports an added, a removed and a changed field at nested paths', () => {
  const before = { a: { b: [1, 2, { c: 'x' }], d: 'gone' } };
  const after = { a: { b: [1, 2, { c: 'y' }], e: 'new' } };
  const { entries, truncated } = diffJson(before, after);
  assert.equal(truncated, false);
  assert.equal(entries.length, 3);

  const map = byPath(entries);
  assert.equal(map['a.b[2].c'].kind, 'changed');
  assert.equal(map['a.b[2].c'].before, 'x');
  assert.equal(map['a.b[2].c'].after, 'y');
  assert.equal(map['a.d'].kind, 'removed');
  assert.equal(map['a.d'].before, 'gone');
  assert.equal('after' in map['a.d'], false);
  assert.equal(map['a.e'].kind, 'added');
  assert.equal(map['a.e'].after, 'new');
  assert.equal('before' in map['a.e'], false);
});

test('compares arrays by index, not by value identity', () => {
  const before = { list: ['a', 'b', 'c'] };
  const after = { list: ['a', 'x', 'c', 'd'] };
  const { entries } = diffJson(before, after);
  const map = byPath(entries);
  assert.equal(entries.length, 2);
  assert.equal(map['list[1]'].kind, 'changed');
  assert.equal(map['list[1]'].before, 'b');
  assert.equal(map['list[1]'].after, 'x');
  assert.equal(map['list[3]'].kind, 'added');
  assert.equal(map['list[3]'].after, 'd');
});

test('a shrinking array reports the missing tail as removed', () => {
  const { entries } = diffJson({ list: [1, 2, 3] }, { list: [1] });
  const map = byPath(entries);
  assert.equal(entries.length, 2);
  assert.equal(map['list[1]'].kind, 'removed');
  assert.equal(map['list[2]'].kind, 'removed');
});

test('a shape mismatch is one changed entry for the whole node, not a torn-open subtree', () => {
  const before = { value: { nested: true } };
  const after = { value: [1, 2, 3] };
  const { entries } = diffJson(before, after);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, 'value');
  assert.equal(entries[0].kind, 'changed');
  assert.deepEqual(entries[0].before, { nested: true });
  assert.deepEqual(entries[0].after, [1, 2, 3]);
});

test('identical structures produce no entries and are not truncated', () => {
  const value = { a: [1, { b: 2 }], c: 'same', d: null };
  const { entries, truncated } = diffJson(value, structuredClone(value));
  assert.deepEqual(entries, []);
  assert.equal(truncated, false);
});

test('null is distinct from an object and from a missing key', () => {
  const { entries: nullVsObject } = diffJson({ x: null }, { x: {} });
  assert.equal(nullVsObject.length, 1);
  assert.equal(nullVsObject[0].kind, 'changed');

  const { entries: nullVsMissing } = diffJson({ x: null }, {});
  assert.equal(nullVsMissing.length, 1);
  assert.equal(nullVsMissing[0].kind, 'removed');
});

test('NaN compares equal to itself, unlike ===', () => {
  const { entries } = diffJson({ x: Number.NaN }, { x: Number.NaN });
  assert.deepEqual(entries, []);
});

function nest(depth, leaf) {
  let value = leaf;
  for (let i = 0; i < depth; i += 1) value = { child: value };
  return value;
}

test('a difference past the depth bound is truncated rather than reported', () => {
  const before = nest(MAX_DIFF_DEPTH + 10, 'before-leaf');
  const after = nest(MAX_DIFF_DEPTH + 10, 'after-leaf');
  const { truncated } = diffJson(before, after);
  assert.equal(truncated, true);
});

test('a difference well within the depth bound is found and not truncated', () => {
  const before = nest(5, 'before-leaf');
  const after = nest(5, 'after-leaf');
  const { entries, truncated } = diffJson(before, after);
  assert.equal(truncated, false);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'changed');
});

test('more differences than the entry bound stop at exactly the bound and report truncated', () => {
  const before = {};
  const after = {};
  for (let i = 0; i < MAX_DIFF_ENTRIES + 500; i += 1) {
    before[`k${i}`] = i;
    after[`k${i}`] = i + 1;
  }
  const { entries, truncated } = diffJson(before, after);
  assert.equal(truncated, true);
  assert.equal(entries.length, MAX_DIFF_ENTRIES);
});

test('fewer differences than the entry bound are not truncated', () => {
  const before = {};
  const after = {};
  for (let i = 0; i < 5; i += 1) {
    before[`k${i}`] = i;
    after[`k${i}`] = i + 1;
  }
  const { entries, truncated } = diffJson(before, after);
  assert.equal(truncated, false);
  assert.equal(entries.length, 5);
});

test('summariseDiff counts each kind, including zero for a kind absent entirely', () => {
  const entries = [
    { path: 'a', kind: 'added' },
    { path: 'b', kind: 'added' },
    { path: 'c', kind: 'removed' },
  ];
  assert.deepEqual(summariseDiff(entries), { added: 2, removed: 1, changed: 0 });
});

test('summariseDiff on an empty diff is all zero', () => {
  assert.deepEqual(summariseDiff([]), { added: 0, removed: 0, changed: 0 });
});

test('a starting path seeds every reported path', () => {
  const { entries } = diffJson({ x: 1, y: [1] }, { x: 2, y: [1, 2] }, ['settings']);
  const map = byPath(entries);
  assert.equal(map['settings.x'].kind, 'changed');
  assert.equal(map['settings.y[1]'].kind, 'added');
});
