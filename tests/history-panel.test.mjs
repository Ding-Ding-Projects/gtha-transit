import test from 'node:test';
import assert from 'node:assert/strict';

import { actionCounts, actionsInUse, commitDayOf, commitSample, filterCommits } from '../lib/history-panel.ts';

const commit = (overrides = {}) => ({
  id: overrides.id ?? 'id',
  kind: 'saved-trips',
  parent: null,
  snapshot: {},
  at: overrides.at ?? Date.parse('2026-09-10T12:00:00Z'),
  action: overrides.action ?? 'save',
  label: overrides.label ?? '',
  size: 0,
  ...overrides,
});

test('commitDayOf reads the Toronto calendar day, not the raw UTC date', () => {
  // 2026-09-10T02:30:00Z is still 2026-09-09 evening in Toronto (EDT, UTC-4).
  assert.equal(commitDayOf(Date.parse('2026-09-10T02:30:00Z')), '2026-09-09');
});

test('commitSample joins label and action, dropping an empty label', () => {
  assert.equal(commitSample(commit({ label: 'Before the trip to the airport', action: 'save' })), 'Before the trip to the airport save');
  assert.equal(commitSample(commit({ label: '', action: 'delete' })), 'delete');
});

test('filterCommits with no filter keeps everything', () => {
  const commits = [commit({ id: 'a' }), commit({ id: 'b', action: 'delete' })];
  assert.equal(filterCommits(commits, {}).length, 2);
});

test('filterCommits narrows by action', () => {
  const commits = [commit({ id: 'a', action: 'save' }), commit({ id: 'b', action: 'delete' }), commit({ id: 'c', action: 'restore' })];
  const kept = filterCommits(commits, { actions: ['delete', 'restore'] });
  assert.deepEqual(kept.map((c) => c.id), ['b', 'c']);
});

test('filterCommits narrows by date range, inclusive of both ends', () => {
  const commits = [
    commit({ id: 'early', at: Date.parse('2026-09-01T12:00:00Z') }),
    commit({ id: 'middle', at: Date.parse('2026-09-10T12:00:00Z') }),
    commit({ id: 'late', at: Date.parse('2026-09-20T12:00:00Z') }),
  ];
  const kept = filterCommits(commits, { from: '2026-09-10', to: '2026-09-10' });
  assert.deepEqual(kept.map((c) => c.id), ['middle']);
});

test('filterCommits drops rows a supplied match list says do not match, by index', () => {
  const commits = [commit({ id: 'a' }), commit({ id: 'b' }), commit({ id: 'c' })];
  const kept = filterCommits(commits, {}, [true, false, true]);
  assert.deepEqual(kept.map((c) => c.id), ['a', 'c']);
});

test('filterCommits combines action, date and match filters together (AND, not OR)', () => {
  const commits = [
    commit({ id: 'a', action: 'save', at: Date.parse('2026-09-10T12:00:00Z') }),
    commit({ id: 'b', action: 'delete', at: Date.parse('2026-09-10T12:00:00Z') }),
    commit({ id: 'c', action: 'save', at: Date.parse('2026-01-01T12:00:00Z') }),
  ];
  const kept = filterCommits(commits, { actions: ['save'], from: '2026-09-01' }, [true, true, true]);
  assert.deepEqual(kept.map((c) => c.id), ['a']);
});

test('actionCounts counts by action, and an action with no commits is simply absent', () => {
  const commits = [commit({ action: 'save' }), commit({ action: 'save' }), commit({ action: 'delete' })];
  assert.deepEqual(actionCounts(commits), { save: 2, delete: 1 });
  assert.equal('restore' in actionCounts(commits), false);
});

test('actionsInUse lists each action once, in first-seen order', () => {
  const commits = [commit({ action: 'save' }), commit({ action: 'delete' }), commit({ action: 'save' }), commit({ action: 'restore' })];
  assert.deepEqual(actionsInUse(commits), ['save', 'delete', 'restore']);
});

test('actionsInUse on an empty list is empty', () => {
  assert.deepEqual(actionsInUse([]), []);
});
