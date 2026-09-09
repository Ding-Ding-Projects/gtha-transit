import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contextExtensions,
  extensionItems,
  filterMenuItems,
  menuKeyboard,
  registerContextExtension,
  unregisterContextExtension,
  universalItems,
} from '../lib/appearance/context-menu.ts';

const target = { id: 'journey.option.card', label: { en: 'Journey option card', zh: '行程選項卡' } };

test('universalItems always renders the same five rows, disabled with a reason when an action is missing', () => {
  const wired = universalItems(target, {
    editAppearance: () => {}, copyStyle: () => {}, pasteStyle: () => {}, resetElement: () => {}, history: () => {},
  });
  assert.deepEqual(wired.map((item) => item.id), ['edit-appearance', 'copy-style', 'paste-style', 'reset-element', 'history']);
  assert.ok(wired.every((item) => item.disabled !== true), 'every action is available, so nothing is disabled');
  assert.equal(wired.find((item) => item.id === 'reset-element').destructive, true);

  const nothingWired = universalItems(target, {});
  assert.equal(nothingWired.length, 5, 'the shape of the menu never changes -- rows are disabled, not removed');
  for (const item of nothingWired) {
    assert.equal(item.disabled, true);
    assert.ok(item.disabledReason.en.length > 0);
    assert.ok(item.disabledReason.zh.length > 0);
    assert.doesNotThrow(() => item.run(), 'a disabled row\'s run is still a safe no-op, never undefined');
  }
  // paste-style says something different from the other four when it alone is missing.
  const onlyPasteMissing = universalItems(target, { editAppearance: () => {}, copyStyle: () => {}, resetElement: () => {}, history: () => {} });
  const paste = onlyPasteMissing.find((item) => item.id === 'paste-style');
  assert.equal(paste.disabled, true);
  assert.match(paste.disabledReason.en, /copy/i);
});

test('universalItems words its edit and reset rows with the target\'s own label', () => {
  const items = universalItems(target, { editAppearance: () => {} });
  const edit = items.find((item) => item.id === 'edit-appearance');
  assert.match(edit.label.en, /Journey option card/);
  assert.match(edit.label.zh, /行程選項卡/);
});

test('filterMenuItems never reorders, and null means no filter is active', () => {
  const items = universalItems(target, {});
  assert.deepEqual(filterMenuItems(items, null), items);
  const onlyPasteAndHistory = items.map((item) => item.id === 'paste-style' || item.id === 'history');
  const filtered = filterMenuItems(items, onlyPasteAndHistory);
  assert.deepEqual(filtered.map((item) => item.id), ['paste-style', 'history'], 'kept in the original order, not the order they were matched');
  assert.deepEqual(filterMenuItems(items, items.map(() => false)), []);
});

test('menuKeyboard wraps at both ends and answers Home/End, without moving on an unrelated key', () => {
  assert.equal(menuKeyboard(-1, 5, 'ArrowDown'), 0, 'nothing focused yet, so ArrowDown lands on the first row');
  assert.equal(menuKeyboard(4, 5, 'ArrowDown'), 0, 'wraps past the last row');
  assert.equal(menuKeyboard(0, 5, 'ArrowUp'), 4, 'wraps past the first row');
  assert.equal(menuKeyboard(2, 5, 'Home'), 0);
  assert.equal(menuKeyboard(2, 5, 'End'), 4);
  assert.equal(menuKeyboard(2, 5, 'a'), 2, 'an unrelated key leaves the focus where it was');
  assert.equal(menuKeyboard(2, 0, 'ArrowDown'), -1, 'an empty menu has nothing to focus');
});

test('registerContextExtension joins every menu, and a name nobody registered contributes nothing', () => {
  assert.equal(contextExtensions().size, 0, 'the registry starts empty in a fresh test file');
  assert.deepEqual(extensionItems(target), []);

  registerContextExtension('lock-element', (forTarget) => [{
    id: 'lock-element',
    label: { en: `Lock ${forTarget.label.en}`, zh: `鎖定「${forTarget.label.zh}」` },
    run: () => {},
  }]);
  try {
    assert.equal(contextExtensions().size, 1);
    assert.ok(contextExtensions().has('lock-element'));
    const items = extensionItems(target);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'lock-element');
    assert.match(items[0].label.en, /Journey option card/);

    // The snapshot is a copy: mutating it never touches the live registry.
    contextExtensions().delete('lock-element');
    assert.equal(contextExtensions().size, 1, 'the live registry is unaffected by mutating a returned snapshot');
  } finally {
    unregisterContextExtension('lock-element');
  }
  assert.equal(contextExtensions().size, 0, 'unregistering removes it, so later tests see an empty registry again');
  assert.deepEqual(extensionItems(target), []);
});

test('a provider registered for one name does not answer for a name nobody registered', () => {
  registerContextExtension('only-this-one', () => [{ id: 'x', label: { en: 'X', zh: 'X' }, run: () => {} }]);
  try {
    assert.equal(contextExtensions().size, 1);
    assert.equal(contextExtensions().get('does-not-exist'), undefined);
  } finally {
    unregisterContextExtension('only-this-one');
  }
});
