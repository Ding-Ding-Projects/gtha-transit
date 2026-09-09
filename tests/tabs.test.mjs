import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_DOCK,
  MAX_STRIP_BYTES,
  STRIP_KEY,
  activeTab,
  applyBulkClose,
  assertBounded,
  bulkClosePredicate,
  close,
  collapseGroup,
  createGroup,
  createStripState,
  groupsInOrder,
  keyForOrientation,
  moveIntoGroup,
  moveRelative,
  orientationFor,
  overflowSplit,
  parseStripState,
  pin,
  pinGroup,
  previewBulkClose,
  reconcile,
  recolourGroup,
  removeGroup,
  renameGroup,
  reopen,
  reorder,
  reorderGroup,
  serializeStripState,
  setDock,
  unpin,
  visibleTabs,
} from '../lib/tabs.ts';
import { allStrips, registerStrip, searchAllTabs, unregisterStrip } from '../lib/tab-registry.ts';

const ids = ['plan', 'status', 'vehicles', 'saved', 'race'];
const descriptor = (id, label) => ({ id, label: label ?? id });

/* --------------------------------------------------------- construction -- */

test('createStripState orders pinned ids first, ships left-docked by default', () => {
  const state = createStripState('rail', ids, { pinned: ['status'] });
  assert.equal(state.version, 1);
  assert.equal(state.surface, 'rail');
  assert.deepEqual(state.order, ['status', 'plan', 'vehicles', 'saved', 'race']);
  assert.deepEqual(state.pinned, ['status']);
  assert.deepEqual(state.closed, []);
  assert.deepEqual(state.groups, []);
  assert.equal(state.dock, 'left');
  assert.equal(DEFAULT_DOCK, 'left');
});

test('createStripState drops duplicate ids and ignores a pinned id that does not exist', () => {
  const state = createStripState('rail', ['a', 'a', 'b'], { pinned: ['z'] });
  assert.deepEqual(state.order, ['a', 'b']);
  assert.deepEqual(state.pinned, []);
});

/* ---------------------------------------------------------------- reconcile -- */

test('reconcile appends a newly registered id to the end, unpinned and open', () => {
  const state = createStripState('rail', ['a', 'b'], { pinned: ['a'] });
  const next = reconcile(state, ['a', 'b', 'c']);
  assert.deepEqual(next.order, ['a', 'b', 'c']);
  assert.deepEqual(next.pinned, ['a']);
  assert.equal(visibleTabs(next).includes('c'), true);
});

test('reconcile drops a removed id from order, pinned, closed and every group', () => {
  let state = createStripState('rail', ['a', 'b', 'c'], { pinned: ['a'] });
  state = close(state, 'b');
  state = createGroup(state, { id: 'g1', name: 'Group', members: ['b', 'c'] });
  const next = reconcile(state, ['a', 'c']);
  assert.deepEqual(next.order, ['a', 'c']);
  assert.deepEqual(next.pinned, ['a']);
  assert.deepEqual(next.closed, []);
  assert.deepEqual(next.groups[0].members, ['c']);
});

test('reconcile keeps everything else: dock, group identity, closed state', () => {
  let state = createStripState('rail', ['a', 'b'], { dock: 'bottom' });
  state = close(state, 'b');
  state = createGroup(state, { id: 'g1', name: 'Kept', colour: '#ff0000', members: ['a'] });
  const next = reconcile(state, ['a', 'b']);
  assert.equal(next.dock, 'bottom');
  assert.deepEqual(next.closed, ['b']);
  assert.deepEqual(next.groups, [{ id: 'g1', name: 'Kept', colour: '#ff0000', collapsed: false, members: ['a'] }]);
});

/* ------------------------------------------------------------------ reorder -- */

test('reorder moves an unpinned tab within the unpinned region', () => {
  const state = createStripState('rail', ['a', 'b', 'c', 'd']);
  const next = reorder(state, 'd', 1);
  assert.deepEqual(next.order, ['a', 'd', 'b', 'c']);
});

test('reorder moves a pinned tab within the pinned region', () => {
  const state = createStripState('rail', ['a', 'b', 'c', 'd'], { pinned: ['a', 'b'] });
  const next = reorder(state, 'b', 0);
  assert.deepEqual(next.order, ['b', 'a', 'c', 'd']);
  assert.deepEqual(next.pinned, ['b', 'a'], 'pinned ids retain the exact prefix sequence after a pinned reorder');
});

test('reorder clamps rather than crossing the pinned/unpinned boundary in either direction', () => {
  const state = createStripState('rail', ['a', 'b', 'c', 'd'], { pinned: ['a', 'b'] });
  const pushedPastEnd = reorder(state, 'a', 99);
  assert.deepEqual(pushedPastEnd.order, ['b', 'a', 'c', 'd'], 'a is clamped to the last pinned slot, never past it');
  const pushedBeforeStart = reorder(state, 'c', -99);
  assert.deepEqual(pushedBeforeStart.order, ['a', 'b', 'c', 'd'], 'c is already first-unpinned, so this is a no-op');
});

test('reorder on an unknown id is a no-op', () => {
  const state = createStripState('rail', ['a', 'b']);
  assert.deepEqual(reorder(state, 'ghost', 0), state);
});

test('moveRelative shifts a tab by delta within its own region and refuses to leave it', () => {
  const state = createStripState('rail', ['a', 'b', 'c', 'd'], { pinned: ['a', 'b'] });
  const movedLeft = moveRelative(state, 'c', -1);
  assert.deepEqual(movedLeft.order, ['a', 'b', 'c', 'd'], 'c is already the first unpinned tab');
  const movedRight = moveRelative(state, 'a', 1);
  assert.deepEqual(movedRight.order, ['b', 'a', 'c', 'd']);
  const blocked = moveRelative(movedRight, 'a', 1);
  assert.deepEqual(blocked.order, ['b', 'a', 'c', 'd'], 'a is now last-pinned; it cannot move into the unpinned region');
});

/* -------------------------------------------------------------- pin/unpin -- */

test('pin moves a tab to the end of the pinned region and is idempotent', () => {
  let state = createStripState('rail', ['a', 'b', 'c'], { pinned: ['a'] });
  state = pin(state, 'c');
  assert.deepEqual(state.order, ['a', 'c', 'b']);
  assert.deepEqual(state.pinned, ['a', 'c']);
  const again = pin(state, 'c');
  assert.deepEqual(again, state, 'pinning an already-pinned tab changes nothing');
});

test('pin on an unknown id is a no-op', () => {
  const state = createStripState('rail', ['a']);
  assert.deepEqual(pin(state, 'ghost'), state);
});

test('unpin moves a tab to the start of the unpinned region and is idempotent', () => {
  let state = createStripState('rail', ['a', 'b', 'c'], { pinned: ['a', 'b'] });
  state = unpin(state, 'a');
  assert.deepEqual(state.order, ['b', 'a', 'c']);
  assert.deepEqual(state.pinned, ['b']);
  const again = unpin(state, 'a');
  assert.deepEqual(again, state, 'unpinning an already-unpinned tab changes nothing');
});

test('pin then unpin round-trips back to an equivalent unpinned position at the front of the unpinned run', () => {
  let state = createStripState('rail', ['a', 'b', 'c']);
  state = pin(state, 'b');
  state = unpin(state, 'b');
  assert.deepEqual(state.order, ['b', 'a', 'c']);
  assert.deepEqual(state.pinned, []);
});

/* ---------------------------------------------------------- close/reopen -- */

test('close refuses a pinned tab, unchanged, no throw', () => {
  const state = createStripState('rail', ['a', 'b'], { pinned: ['a'] });
  assert.doesNotThrow(() => close(state, 'a'));
  assert.deepEqual(close(state, 'a'), state);
});

test('close on an unknown id is a no-op', () => {
  const state = createStripState('rail', ['a']);
  assert.deepEqual(close(state, 'ghost'), state);
});

test('close keeps the id in order and lists it in closed; visibleTabs subtracts it', () => {
  let state = createStripState('rail', ['a', 'b', 'c']);
  state = close(state, 'b');
  assert.deepEqual(state.order, ['a', 'b', 'c']);
  assert.deepEqual(state.closed, ['b']);
  assert.deepEqual(visibleTabs(state), ['a', 'c']);
});

test('close is idempotent and reopen removes from closed without touching order', () => {
  let state = createStripState('rail', ['a', 'b']);
  state = close(state, 'a');
  state = close(state, 'a');
  assert.deepEqual(state.closed, ['a']);
  state = reopen(state, 'a');
  assert.deepEqual(state.closed, []);
  assert.deepEqual(state.order, ['a', 'b']);
  assert.deepEqual(reopen(state, 'a'), state, 'reopening an already-open tab is a no-op');
});

/* -------------------------------------------------------------------- groups -- */

test('createGroup drops unknown members and ignores a duplicate group id', () => {
  const state = createStripState('rail', ['a', 'b']);
  const withGroup = createGroup(state, { id: 'g1', name: 'Group', members: ['a', 'ghost', 'a'] });
  assert.deepEqual(withGroup.groups, [{ id: 'g1', name: 'Group', colour: null, collapsed: false, members: ['a'] }]);
  const unchanged = createGroup(withGroup, { id: 'g1', name: 'Ignored' });
  assert.deepEqual(unchanged, withGroup);
});

test('a tab belongs to at most one group: creating a second group with an overlapping member moves it', () => {
  let state = createStripState('rail', ['a', 'b']);
  state = createGroup(state, { id: 'g1', name: 'First', members: ['a', 'b'] });
  state = createGroup(state, { id: 'g2', name: 'Second', members: ['b'] });
  const g1 = state.groups.find((group) => group.id === 'g1');
  const g2 = state.groups.find((group) => group.id === 'g2');
  assert.deepEqual(g1.members, ['a']);
  assert.deepEqual(g2.members, ['b']);
});

test('renameGroup, recolourGroup and collapseGroup change only the named group', () => {
  let state = createStripState('rail', ['a', 'b']);
  state = createGroup(state, { id: 'g1', name: 'Old', members: ['a'] });
  state = createGroup(state, { id: 'g2', name: 'Other', members: ['b'] });
  state = renameGroup(state, 'g1', 'New');
  state = recolourGroup(state, 'g1', '#00ff00');
  state = collapseGroup(state, 'g1', true);
  const g1 = state.groups.find((group) => group.id === 'g1');
  const g2 = state.groups.find((group) => group.id === 'g2');
  assert.equal(g1.name, 'New');
  assert.equal(g1.colour, '#00ff00');
  assert.equal(g1.collapsed, true);
  assert.deepEqual(g2, { id: 'g2', name: 'Other', colour: null, collapsed: false, members: ['b'] });
});

test('removeGroup with keepMembers ungroups the tabs but never closes or reorders them', () => {
  let state = createStripState('rail', ['a', 'b']);
  state = createGroup(state, { id: 'g1', name: 'Group', members: ['a'] });
  state = removeGroup(state, 'g1', { keepMembers: true });
  assert.deepEqual(state.groups, []);
  assert.deepEqual(state.order, ['a', 'b']);
  assert.deepEqual(visibleTabs(state), ['a', 'b']);
});

test('moveIntoGroup removes a tab from its previous group before adding it to the new one', () => {
  let state = createStripState('rail', ['a', 'b']);
  state = createGroup(state, { id: 'g1', name: 'First' });
  state = createGroup(state, { id: 'g2', name: 'Second' });
  state = moveIntoGroup(state, 'a', 'g1');
  state = moveIntoGroup(state, 'a', 'g2');
  assert.deepEqual(state.groups.find((group) => group.id === 'g1').members, []);
  assert.deepEqual(state.groups.find((group) => group.id === 'g2').members, ['a']);
});

test('moveIntoGroup(tab, null) removes a tab from any group', () => {
  let state = createStripState('rail', ['a']);
  state = createGroup(state, { id: 'g1', name: 'Group', members: ['a'] });
  state = moveIntoGroup(state, 'a', null);
  assert.deepEqual(state.groups[0].members, []);
});

test('moveIntoGroup with an unknown group id or an unknown tab id changes nothing', () => {
  const state = createStripState('rail', ['a']);
  assert.deepEqual(moveIntoGroup(state, 'a', 'ghost-group'), state);
  assert.deepEqual(moveIntoGroup(state, 'ghost-tab', null), state);
});

test('moving a tab into a collapsed group leaves the group collapsed', () => {
  let state = createStripState('rail', ['a', 'b']);
  state = createGroup(state, { id: 'g1', name: 'Group', members: ['a'] });
  state = collapseGroup(state, 'g1', true);
  state = moveIntoGroup(state, 'b', 'g1');
  const group = state.groups.find((candidate) => candidate.id === 'g1');
  assert.equal(group.collapsed, true, 'adding a member never expands the group');
  assert.deepEqual(group.members, ['a', 'b']);
});

/* ---------------------------------------------------------------- group order -- */

test('groupsInOrder sorts by each group\'s earliest surviving member', () => {
  let state = createStripState('rail', ['a', 'b', 'c', 'd']);
  state = createGroup(state, { id: 'late', name: 'Late', members: ['d'] });
  state = createGroup(state, { id: 'early', name: 'Early', members: ['a'] });
  assert.deepEqual(groupsInOrder(state).map((group) => group.id), ['early', 'late']);
});

test('an empty group sorts after every anchored group, in creation order', () => {
  let state = createStripState('rail', ['a', 'b']);
  state = createGroup(state, { id: 'empty', name: 'Empty' });
  state = createGroup(state, { id: 'anchored', name: 'Anchored', members: ['a'] });
  assert.deepEqual(groupsInOrder(state).map((group) => group.id), ['anchored', 'empty']);
});

test('reorderGroup moves a group\'s block among the other groups without moving any ungrouped tab', () => {
  let state = createStripState('rail', ['a', 'g1a', 'g1b', 'b', 'g2a', 'c', 'g3a']);
  state = createGroup(state, { id: 'g1', name: 'One', members: ['g1a', 'g1b'] });
  state = createGroup(state, { id: 'g2', name: 'Two', members: ['g2a'] });
  state = createGroup(state, { id: 'g3', name: 'Three', members: ['g3a'] });
  assert.deepEqual(groupsInOrder(state).map((group) => group.id), ['g1', 'g2', 'g3']);

  const next = reorderGroup(state, 'g3', 0);
  assert.deepEqual(groupsInOrder(next).map((group) => group.id), ['g3', 'g1', 'g2']);
  // The g3 block (a single tab here) now occupies the slot g1's block used to occupy; every
  // ungrouped tab, a, b, c, keeps its exact original position and cannot be crossed.
  assert.deepEqual(next.order.filter((id) => ['a', 'b', 'c'].includes(id)), ['a', 'b', 'c']);
  assert.deepEqual(next.order, ['a', 'g3a', 'b', 'g1a', 'g1b', 'c', 'g2a']);
});

test('reorderGroup is a no-op for an unknown group id, a group with no members, or the group\'s current slot', () => {
  let state = createStripState('rail', ['a', 'b']);
  state = createGroup(state, { id: 'g1', name: 'One', members: ['a'] });
  state = createGroup(state, { id: 'empty', name: 'Empty' });
  assert.deepEqual(reorderGroup(state, 'ghost', 0), state);
  assert.deepEqual(reorderGroup(state, 'empty', 0), state);
  assert.deepEqual(reorderGroup(state, 'g1', 0), state, 'g1 is already at position 0');
});

test('reorderGroup refuses a move that would land an unpinned member ahead of a pinned tab', () => {
  let state = createStripState('rail', ['p1', 'u1', 'u2'], { pinned: ['p1'] });
  // Pin only one of the two members: the group now straddles both regions.
  state = createGroup(state, { id: 'mixed', name: 'Mixed', members: ['p1', 'u1'] });
  state = createGroup(state, { id: 'other', name: 'Other', members: ['u2'] });
  const attempted = reorderGroup(state, 'other', 0);
  assert.deepEqual(attempted, state, 'the pinned-prefix invariant wins over honouring the requested move');
});

test('pinGroup pins every member, contiguously, in the group\'s own member order', () => {
  let state = createStripState('rail', ['a', 'b', 'c', 'd'], { pinned: ['a'] });
  state = createGroup(state, { id: 'g1', name: 'Group', members: ['c', 'b'] });
  state = pinGroup(state, 'g1');
  assert.deepEqual(state.pinned, ['a', 'c', 'b']);
  assert.deepEqual(state.order, ['a', 'c', 'b', 'd']);
});

test('pinGroup on an unknown group id is a no-op', () => {
  const state = createStripState('rail', ['a']);
  assert.deepEqual(pinGroup(state, 'ghost'), state);
});

/* ------------------------------------------------------------------------ dock -- */

test('setDock changes the dock and is a referential no-op when unchanged', () => {
  const state = createStripState('rail', ['a']);
  const moved = setDock(state, 'bottom');
  assert.equal(moved.dock, 'bottom');
  assert.equal(setDock(moved, 'bottom'), moved);
});

/* ------------------------------------------------------------------- bulk close -- */

const bulkFixture = [
  descriptor('alpha', 'Plan a trip'),
  descriptor('beta', 'Live status'),
  descriptor('gamma', 'Vehicles nearby'),
  descriptor('delta', 'Saved trips'),
];

test('bulkClosePredicate in plain mode matches case-insensitively via plainTextMatches', () => {
  const predicate = bulkClosePredicate({ query: 'TRIP', mode: 'plain', negate: false });
  assert.notEqual(predicate, null);
  assert.equal(predicate('Plan a trip'), true);
  assert.equal(predicate('Live status'), false);
});

test('bulkClosePredicate returns null for an invalid query: bad flags or an unparseable regex', () => {
  assert.equal(bulkClosePredicate({ query: 'x', mode: 'regex', flags: 'gg', negate: false }), null, 'duplicate flag');
  assert.equal(bulkClosePredicate({ query: 'x', mode: 'regex', flags: 'z', negate: false }), null, 'unknown flag');
  assert.equal(bulkClosePredicate({ query: '(', mode: 'regex', negate: false }), null, 'unbalanced group, fails to compile');
  assert.equal(bulkClosePredicate({ query: 'x'.repeat(600), mode: 'plain', negate: false }), null, 'over the query length bound');
});

test('regex negate is the exact logical inverse of the positive predicate, across a fixture list', () => {
  const labels = bulkFixture.map((tab) => tab.label);
  const positive = bulkClosePredicate({ query: '^(Plan|Live)', mode: 'regex', negate: false });
  const negated = bulkClosePredicate({ query: '^(Plan|Live)', mode: 'regex', negate: true });
  assert.notEqual(positive, null);
  assert.notEqual(negated, null);
  for (const label of labels) {
    assert.equal(negated(label), !positive(label), `negate disagreed with !positive for "${label}"`);
  }
  assert.deepEqual(labels.map(positive), [true, true, false, false]);
  assert.deepEqual(labels.map(negated), [false, false, true, true]);
});

test('a stateful global-flag regex still answers correctly across repeated calls (lastIndex is reset each time)', () => {
  const predicate = bulkClosePredicate({ query: 'a', mode: 'regex', flags: 'g', negate: false });
  const label = 'alpha';
  assert.equal(predicate(label), true);
  assert.equal(predicate(label), true, 'a stale lastIndex must not make the second call miss');
  assert.equal(predicate(label), true);
});

test('previewBulkClose: predicate null previews as empty', () => {
  const state = createStripState('rail', bulkFixture.map((tab) => tab.id));
  const preview = previewBulkClose(state, bulkFixture, null, { includePinned: false });
  assert.deepEqual(preview, { affected: [], skipped: [], scope: 'strip' });
});

test('previewBulkClose skips pinned by default, with reasons, and includes them on request', () => {
  const state = createStripState('rail', bulkFixture.map((tab) => tab.id), { pinned: ['alpha'] });
  const predicate = () => true;
  const excluding = previewBulkClose(state, bulkFixture, predicate, { includePinned: false });
  assert.deepEqual(excluding.scope, 'strip');
  assert.deepEqual(new Set(excluding.affected), new Set(['beta', 'gamma', 'delta']));
  assert.deepEqual(excluding.skipped, [{ id: 'alpha', reason: 'pinned' }]);

  const including = previewBulkClose(state, bulkFixture, predicate, { includePinned: true });
  assert.deepEqual(new Set(including.affected), new Set(['alpha', 'beta', 'gamma', 'delta']));
  assert.deepEqual(including.skipped, []);
});

test('previewBulkClose reports already-closed and locked (untracked) ids separately from pinned', () => {
  let state = createStripState('rail', bulkFixture.map((tab) => tab.id));
  state = close(state, 'beta');
  const tabsWithAStranger = [...bulkFixture, descriptor('untracked', 'Untracked stray tab')];
  const preview = previewBulkClose(state, tabsWithAStranger, () => true, { includePinned: false });
  assert.deepEqual(new Set(preview.affected), new Set(['alpha', 'gamma', 'delta']));
  assert.deepEqual(preview.skipped.sort((a, b) => a.id.localeCompare(b.id)), [
    { id: 'beta', reason: 'already-closed' },
    { id: 'untracked', reason: 'locked' },
  ]);
});

test('previewBulkClose never reports a tab the predicate did not match', () => {
  const state = createStripState('rail', bulkFixture.map((tab) => tab.id), { pinned: ['alpha'] });
  const predicate = bulkClosePredicate({ query: 'Saved trips', mode: 'plain', negate: false });
  const preview = previewBulkClose(state, bulkFixture, predicate, { includePinned: false });
  assert.deepEqual(preview.affected, ['delta']);
  assert.deepEqual(preview.skipped, [], 'alpha did not match the exact Saved trips label, so it is not reported at all, pinned or not');
});

test('applyBulkClose closes every affected id, including a pinned one the preview chose to include', () => {
  const state = createStripState('rail', bulkFixture.map((tab) => tab.id), { pinned: ['alpha'] });
  const preview = previewBulkClose(state, bulkFixture, () => true, { includePinned: true });
  const applied = applyBulkClose(state, preview);
  assert.deepEqual(new Set(applied.closed), new Set(['alpha', 'beta', 'gamma', 'delta']));
  assert.deepEqual(applied.pinned, ['alpha'], 'closing a pinned tab in bulk does not unpin it');
  assert.deepEqual(applied.order, state.order);
});

test('applyBulkClose with nothing affected is a referential no-op', () => {
  const state = createStripState('rail', bulkFixture.map((tab) => tab.id));
  assert.equal(applyBulkClose(state, { affected: [], skipped: [], scope: 'strip' }), state);
});

/* -------------------------------------------------------------------- keyboard -- */

test('keyForOrientation: Home and End work on every dock', () => {
  for (const dock of ['left', 'right', 'top', 'bottom']) {
    assert.equal(keyForOrientation(dock, 'Home'), 'home');
    assert.equal(keyForOrientation(dock, 'End'), 'end');
  }
});

test('keyForOrientation maps ArrowLeft/ArrowRight on top and bottom docks', () => {
  for (const dock of ['top', 'bottom']) {
    assert.equal(orientationFor(dock), 'horizontal');
    assert.equal(keyForOrientation(dock, 'ArrowLeft'), 'previous');
    assert.equal(keyForOrientation(dock, 'ArrowRight'), 'next');
    assert.equal(keyForOrientation(dock, 'ArrowUp'), null, 'the other axis is not handled');
    assert.equal(keyForOrientation(dock, 'ArrowDown'), null);
  }
});

test('keyForOrientation maps ArrowUp/ArrowDown on left and right docks', () => {
  for (const dock of ['left', 'right']) {
    assert.equal(orientationFor(dock), 'vertical');
    assert.equal(keyForOrientation(dock, 'ArrowUp'), 'previous');
    assert.equal(keyForOrientation(dock, 'ArrowDown'), 'next');
    assert.equal(keyForOrientation(dock, 'ArrowLeft'), null, 'the other axis is not handled');
    assert.equal(keyForOrientation(dock, 'ArrowRight'), null);
  }
});

test('keyForOrientation returns null for a key it does not know', () => {
  assert.equal(keyForOrientation('left', 'Enter'), null);
  assert.equal(keyForOrientation('top', 'a'), null);
});

/* ------------------------------------------------------------------ persistence -- */

test('STRIP_KEY namespaces the storage key per surface, version 1', () => {
  assert.equal(STRIP_KEY('rail'), 'gtha-tabs-rail-v1');
  assert.equal(STRIP_KEY('settings'), 'gtha-tabs-settings-v1');
});

test('serialize/parse round trip reproduces an equivalent state', () => {
  let state = createStripState('rail', ['a', 'b', 'c'], { pinned: ['a'], dock: 'right' });
  state = createGroup(state, { id: 'g1', name: 'Group', colour: '#123456', members: ['b'] });
  state = collapseGroup(state, 'g1', true);
  state = close(state, 'c');
  const text = serializeStripState(state);
  const restored = parseStripState(text, 'rail', ['a', 'b', 'c']);
  assert.deepEqual(restored, state);
});

test('parseStripState falls back to createStripState for missing, unreadable or wrong-version input', () => {
  const fresh = createStripState('rail', ['a', 'b']);
  assert.deepEqual(parseStripState(null, 'rail', ['a', 'b']), fresh, 'missing');
  assert.deepEqual(parseStripState('not json at all {{{', 'rail', ['a', 'b']), fresh, 'unreadable');
  assert.deepEqual(parseStripState(JSON.stringify({ ...fresh, version: 2 }), 'rail', ['a', 'b']), fresh, 'wrong version');
  assert.deepEqual(parseStripState(JSON.stringify({ ...fresh, order: 'not-an-array' }), 'rail', ['a', 'b']), fresh, 'invalid shape');
  assert.deepEqual(parseStripState(JSON.stringify({ ...fresh, dock: 'diagonal' }), 'rail', ['a', 'b']), fresh, 'invalid dock');
  assert.deepEqual(parseStripState(JSON.stringify({ ...fresh, groups: [{ id: 'g1' }] }), 'rail', ['a', 'b']), fresh, 'malformed group');
});

test('parseStripState always reconciles the restored state against the current ids', () => {
  const state = createStripState('rail', ['a', 'b', 'c']);
  const text = serializeStripState(state);
  const restored = parseStripState(text, 'rail', ['a', 'c', 'd']);
  assert.deepEqual(restored.order, ['a', 'c', 'd']);
});

test('parseStripState repairs a tampered pinned-region invariant rather than trusting it', () => {
  // Hand-built: "b" claims to be pinned but sits second in `order`, behind an unpinned "a".
  const tampered = { version: 1, surface: 'rail', order: ['a', 'b', 'c'], pinned: ['b'], closed: [], groups: [], dock: 'left' };
  const restored = parseStripState(JSON.stringify(tampered), 'rail', ['a', 'b', 'c']);
  assert.deepEqual(restored.order.slice(0, restored.pinned.length), restored.pinned);
  assert.deepEqual(restored.order, ['b', 'a', 'c']);
});

test('parseStripState always uses the caller\'s surface, not whatever the record claims', () => {
  const state = createStripState('rail', ['a']);
  const text = serializeStripState(state);
  const restored = parseStripState(text, 'settings', ['a']);
  assert.equal(restored.surface, 'settings');
});

test('parseStripState removes duplicate membership across groups, keeping the first group as the owner', () => {
  const raw = {
    version: 1,
    surface: 'rail',
    order: ['a', 'b'],
    pinned: [],
    closed: [],
    groups: [
      { id: 'first', name: 'First', colour: null, collapsed: false, members: ['a'] },
      { id: 'second', name: 'Second', colour: null, collapsed: false, members: ['a', 'b'] },
    ],
    dock: 'left',
  };
  const restored = parseStripState(JSON.stringify(raw), 'rail', ['a', 'b']);
  assert.deepEqual(restored.groups.map((group) => group.members), [['a'], ['b']]);
});

test('activeTab keeps a visible selection and otherwise falls back to the first visible tab', () => {
  let state = createStripState('rail', ['a', 'b', 'c']);
  assert.equal(activeTab(state, 'b'), 'b');
  state = close(state, 'b');
  assert.equal(activeTab(state, 'b'), 'a');
  state = close(state, 'a');
  state = close(state, 'c');
  assert.equal(activeTab(state, 'stale'), null);
});

test('tab registry replaces a surface getter, exposes live status, and unregisters cleanly', () => {
  unregisterStrip('registry-test');
  let state = createStripState('registry-test', ['a'], { pinned: ['a'] });
  const tabs = [descriptor('a', 'Alpha')];
  registerStrip('registry-test', () => ({ tabs, state }));
  registerStrip('registry-test', () => ({ tabs, state }));
  assert.deepEqual(allStrips().filter((surface) => surface === 'registry-test'), ['registry-test']);
  assert.deepEqual(searchAllTabs((label) => label === 'Alpha'), [
    { surface: 'registry-test', id: 'a', label: 'Alpha', group: null, pinned: true, closed: false },
  ]);
  state = applyBulkClose(state, { affected: ['a'], skipped: [], scope: 'strip' });
  assert.equal(searchAllTabs(() => true)[0].closed, true, 'the registry reads the current getter snapshot');
  unregisterStrip('registry-test');
  assert.equal(allStrips().includes('registry-test'), false);
});

test('MAX_STRIP_BYTES and assertBounded: a realistic worst case stays under the bound', () => {
  const manyIds = Array.from({ length: 60 }, (_unused, index) => `destination-with-a-fairly-long-identifier-${index}`);
  let state = createStripState('settings', manyIds, { pinned: manyIds.slice(0, 6) });
  for (let index = 0; index < 12; index += 1) {
    const members = manyIds.slice(index * 4, index * 4 + 4);
    state = createGroup(state, { id: `group-with-a-long-id-${index}`, name: `A reasonably descriptive group name ${index}`, colour: '#a1b2c3', members });
  }
  assert.doesNotThrow(() => assertBounded(state));
  const size = new TextEncoder().encode(serializeStripState(state)).length;
  assert.ok(size <= MAX_STRIP_BYTES, `worst-case fixture was ${size} bytes, over the ${MAX_STRIP_BYTES} byte bound`);
});

test('assertBounded actually throws once the bound is exceeded', () => {
  const hugeIds = Array.from({ length: 2000 }, (_unused, index) => `id-${index}-${'x'.repeat(40)}`);
  const oversized = createStripState('settings', hugeIds);
  assert.throws(() => assertBounded(oversized), /exceeds|over the/i.test('over the') ? /over the/ : /./);
});

/* -------------------------------------------------------------------- overflow -- */

test('overflowSplit keeps every pinned tab visible, first, even beyond the available size', () => {
  const measurements = [
    { id: 'p1', size: 80 },
    { id: 'p2', size: 80 },
    { id: 'u1', size: 50 },
  ];
  const { visible, overflow } = overflowSplit(measurements, 100, ['p1', 'p2']);
  assert.deepEqual(visible, ['p1', 'p2']);
  assert.deepEqual(overflow, ['u1']);
});

test('overflowSplit accepts unpinned tabs in sequence by cumulative size', () => {
  const measurements = [
    { id: 'a', size: 40 },
    { id: 'b', size: 40 },
    { id: 'c', size: 40 },
  ];
  const { visible, overflow } = overflowSplit(measurements, 90, []);
  assert.deepEqual(visible, ['a', 'b']);
  assert.deepEqual(overflow, ['c']);
});

test('overflowSplit overflows a tab and everything after it once the strip is full, even a smaller later tab', () => {
  const measurements = [
    { id: 'wide', size: 90 },
    { id: 'narrow', size: 5 },
  ];
  const { visible, overflow } = overflowSplit(measurements, 90, []);
  assert.deepEqual(visible, ['wide']);
  assert.deepEqual(overflow, ['narrow'], 'narrow would fit alone, but the strip cannot skip over wide without reordering');
});

test('overflowSplit with everything fitting overflows nothing', () => {
  const measurements = [{ id: 'a', size: 10 }, { id: 'b', size: 10 }];
  assert.deepEqual(overflowSplit(measurements, 100, []), { visible: ['a', 'b'], overflow: [] });
});
