import assert from 'node:assert/strict';
import test from 'node:test';
import { SHORTCUTS, formatShortcut, matchesShortcut, shortcutFor } from '../lib/appearance/shortcuts.ts';

const IDS = ['palette', 'edit-appearance', 'context-menu', 'reset-element', 'copy-style', 'paste-style'];

test('every shortcut id has a binding, and every binding is its own id', () => {
  assert.deepEqual(Object.keys(SHORTCUTS).sort(), [...IDS].sort());
  for (const id of IDS) assert.equal(shortcutFor(id).id, id);
});

test('no two shortcuts collide on the same physical key and modifiers', () => {
  const signatures = IDS.map((id) => {
    const binding = shortcutFor(id);
    return [binding.code, binding.primary, binding.shift, binding.alt].join('|');
  });
  assert.equal(new Set(signatures).size, signatures.length, 'two shortcuts share exactly the same chord');
});

test('Ctrl+Shift+E opens the appearance editor, case-insensitively and by physical key', () => {
  assert.equal(matchesShortcut({ key: 'E', ctrlKey: true, shiftKey: true }, 'edit-appearance'), true);
  assert.equal(matchesShortcut({ key: 'e', ctrlKey: true, shiftKey: true }, 'edit-appearance'), true);
  // A non-Latin layout reports a different key and the same physical code.
  assert.equal(matchesShortcut({ key: 'у', code: 'KeyE', ctrlKey: true, shiftKey: true }, 'edit-appearance'), true);
  assert.equal(matchesShortcut({ key: 'e', metaKey: true, shiftKey: true }, 'edit-appearance'), true, 'the Mac equivalent');
  assert.equal(matchesShortcut({ key: 'e', ctrlKey: true }, 'edit-appearance'), false, 'missing Shift is a different chord');
  assert.equal(matchesShortcut({ key: 'e', ctrlKey: true, shiftKey: true, altKey: true }, 'edit-appearance'), false, 'Alt makes it another chord');
});

test('Shift+F10 opens the context menu, and carries no Ctrl or Cmd', () => {
  assert.equal(matchesShortcut({ key: 'F10', shiftKey: true }, 'context-menu'), true);
  assert.equal(matchesShortcut({ key: 'F10', code: 'F10', shiftKey: true }, 'context-menu'), true);
  assert.equal(matchesShortcut({ key: 'F10', shiftKey: true, ctrlKey: true }, 'context-menu'), false, 'Ctrl turns it into a different chord');
  assert.equal(matchesShortcut({ key: 'F10' }, 'context-menu'), false, 'Shift alone is required');
});

test('copy-style and paste-style match Word and PowerPoint\'s own copy/paste-formatting chords', () => {
  assert.equal(matchesShortcut({ key: 'c', ctrlKey: true, shiftKey: true }, 'copy-style'), true);
  assert.equal(matchesShortcut({ key: 'v', ctrlKey: true, shiftKey: true }, 'paste-style'), true);
  assert.equal(matchesShortcut({ key: 'c', ctrlKey: true, shiftKey: true }, 'paste-style'), false, 'copy and paste do not answer to each other\'s chord');
});

test('reset-element requires Ctrl+Shift+R exactly, and a bare click event never matches by accident', () => {
  assert.equal(matchesShortcut({ key: 'r', ctrlKey: true, shiftKey: true }, 'reset-element'), true);
  assert.equal(matchesShortcut({ key: 'r', ctrlKey: true }, 'reset-element'), false);
  assert.equal(matchesShortcut({}, 'reset-element'), false);
  assert.equal(matchesShortcut({ ctrlKey: true, shiftKey: true }, 'reset-element'), false, 'a modifier alone, with no key at all, is not the shortcut');
});

test('formatShortcut renders the platform\'s own written form', () => {
  assert.equal(formatShortcut('edit-appearance', 'win'), 'Ctrl+Shift+E');
  assert.equal(formatShortcut('edit-appearance', 'mac'), '⌘⇧E');
  assert.equal(formatShortcut('context-menu', 'win'), 'Shift+F10');
  assert.equal(formatShortcut('palette'), 'Ctrl+Shift+F', 'defaults to the Windows form');
  assert.equal(formatShortcut('copy-style', 'win'), 'Ctrl+Shift+C');
  assert.equal(formatShortcut('paste-style', 'win'), 'Ctrl+Shift+V');
});
