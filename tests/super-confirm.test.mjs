import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  authorise,
  awaiting,
  cancelConfirm,
  describesTheAction,
  idleConfirm,
  isArmed,
  isAuthorised,
  isSwept,
  moveSlider,
  turnKey,
} from '../lib/super-confirm.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = (...parts) => readFileSync(path.join(root, ...parts), 'utf8');

const bothKeys = () => turnKey(turnKey(idleConfirm(), 'left'), 'right');
const swept = () => moveSlider(bothKeys(), 1);

test('the slider does not move until both keys are turned', () => {
  assert.equal(isArmed(idleConfirm()), false);
  const one = turnKey(idleConfirm(), 'left');
  assert.equal(isArmed(one), false);
  assert.equal(moveSlider(one, 1).slider, 0, 'one key is not enough to move it at all');
  assert.equal(isArmed(bothKeys()), true);
  assert.equal(moveSlider(bothKeys(), 0.5).slider, 0.5);
});

test('turning a key back off returns the slider to the start', () => {
  // Leaving it part-way would mean a later re-arm began half-swept, so the second
  // confirmation would take half the deliberate effort of the first.
  let state = moveSlider(bothKeys(), 0.9);
  state = turnKey(state, 'left');
  assert.equal(state.slider, 0);
  assert.equal(isArmed(state), false);
});

test('only a full sweep authorises', () => {
  // A threshold below the end would let a fast drag that overshot most of the way
  // count as a deliberate sweep, which is the accident this exists to prevent.
  for (const value of [0, 0.5, 0.9, 0.99]) {
    const state = moveSlider(bothKeys(), value);
    assert.equal(isSwept(state), false, `${value} is not a sweep`);
    assert.equal(isAuthorised(authorise(state)), false, `${value} must not authorise`);
  }
  assert.equal(isSwept(swept()), true);
  assert.equal(isAuthorised(authorise(swept())), true);
});

test('the slider cannot be pushed past its ends, or fed a value that is not one', () => {
  assert.equal(moveSlider(bothKeys(), 5).slider, 1);
  assert.equal(moveSlider(bothKeys(), -3).slider, 0);
  assert.equal(moveSlider(bothKeys(), Number.NaN).slider, 0);
  assert.equal(moveSlider(bothKeys(), undefined).slider, 0);
});

test('authorising twice is authorising once', () => {
  /*
   * The disabled button is the visible guard, not the real one: a keyboard submit
   * walks straight past it, and the action behind this cannot be taken back if it
   * runs a second time.
   */
  const first = authorise(swept(), 1000);
  const second = authorise(first, 2000);
  assert.equal(second.authorisedAt, 1000, 'the second attempt changes nothing');
  assert.equal(second, first, 'and returns the same state, so a caller cannot act on it again');
});

test('an authorised gate stops responding to its own controls', () => {
  const done = authorise(swept(), 1000);
  assert.equal(turnKey(done, 'left'), done);
  assert.equal(moveSlider(done, 0), done, 'dragging back does not un-authorise something already done');
});

test('cancelling returns it to the start, whatever state it was in', () => {
  assert.deepEqual(cancelConfirm(), idleConfirm());
  assert.deepEqual(cancelConfirm(moveSlider(bothKeys(), 0.8)), idleConfirm());
});

test('the gate says what it is waiting for rather than showing an inert control', () => {
  // A disabled thing with no explanation reads as broken.
  assert.equal(awaiting(idleConfirm()), 'both-keys');
  assert.equal(awaiting(turnKey(idleConfirm(), 'left')), 'right-key');
  assert.equal(awaiting(turnKey(idleConfirm(), 'right')), 'left-key');
  assert.equal(awaiting(bothKeys()), 'sweep');
  assert.equal(awaiting(authorise(swept())), 'done');
});

test('a gate whose copy does not name what it destroys is refused', () => {
  // A confirmation that does not say what it is confirming is a confirmation for
  // a question the person was never asked, and ceremony around it fixes nothing.
  assert.equal(describesTheAction({ title: 'Forget 12 notifications', detail: '12 of 40 will be removed.' }), true);
  assert.equal(describesTheAction({ title: 'Forget 12 notifications', detail: '' }), false);
  assert.equal(describesTheAction({ title: '   ', detail: 'something' }), false);
  assert.equal(describesTheAction({}), false);
  assert.equal(describesTheAction(null), false);
});

/* --------------------------------------------------------------- the wiring -- */

test('the gate is guarded twice, because a disabled button does not stop a keyboard submit', () => {
  const component = source('components', 'super-confirm.tsx');
  assert.match(component, /^\s*const next = authorise\(state\);$/m);
  assert.match(component, /^\s*if \(!isAuthorised\(next\)\) return;$/m, 'the real guard');
  assert.match(component, /disabled=\{!swept \|\| isAuthorised\(state\)\}/, 'and the visible one');
});

test('the emergency exit is never disabled', () => {
  // Somebody who wants out of a destructive dialog gets out of it.
  const component = source('components', 'super-confirm.tsx');
  const exit = component.slice(component.indexOf('super-confirm__exit'));
  const button = exit.slice(0, exit.indexOf('</button>'));
  assert.ok(!button.includes('disabled'), 'the way out has no condition on it');
  assert.match(component, /if \(event\.key !== 'Escape'/, 'and Escape reaches it');
});

test('the irreversible sentence is rendered plainly, not styled away', () => {
  const component = source('components', 'super-confirm.tsx');
  assert.match(component, /This cannot be undone\./);
  assert.match(component, /呢個操作無法還原。/, 'in both languages');
  assert.match(component, /\{action\.title\}/, 'and the action names itself');
  assert.match(component, /\{action\.detail\}/);
});

test('forgetting a notification goes through the gate', () => {
  const centre = source('components', 'notification-centre.tsx');
  assert.match(centre, /^import SuperConfirm from '\.\/super-confirm';$/m);
  assert.match(centre, /<SuperConfirm$/m);
  assert.match(centre, /forget\(current, preview\.affected\.map/, 'and only what the preview said would change');
  // Dismissing is not destructive and must not be gated: the centre still has it.
  const dismissAt = centre.indexOf('Dismiss everything on screen');
  const confirmAt = centre.indexOf('setConfirming(true)');
  assert.ok(dismissAt > 0 && confirmAt > 0 && dismissAt < confirmAt, 'dismiss sits before the gated action, ungated');
});

test('the notification surface is rendered in the shell and the old single toast is gone', () => {
  const page = source('app', 'page.tsx');
  assert.match(page, /<NotificationCentre state=\{notifications\} setState=\{setNotifications\} t=\{t\} \/>/);
  assert.ok(!page.includes('setNotice('), 'the single-string notifier is gone');
  assert.ok(!/className="toast"/.test(page), 'and so is the single toast it rendered');
  assert.match(page, /^\s*const notice = useCallback\(\(title: string, severity: Severity = 'info'/m);
});

test('every notification the shell raises names a severity, or is deliberately the default', () => {
  const page = source('app', 'page.tsx');
  const calls = [...page.matchAll(/notice\((?:[^;]|\n)*?\);/g)].map((match) => match[0]);
  assert.ok(calls.length >= 8, `expected the shell's notifications, found ${calls.length}`);
  const failures = calls.filter((call) => /could not|Choose a valid|invalid or unsupported/.test(call) && !/'warning'|'error'/.test(call));
  assert.deepEqual(failures, [], 'a failure raised as an ordinary notice would auto-dismiss while being read');
});

test('the notification stylesheet is loaded, and after the ones it overrides', () => {
  const layout = source('app', 'layout.tsx');
  const notifications = layout.indexOf("import './notifications.css';");
  assert.ok(notifications > 0, 'the stylesheet is imported, or none of this is styled');
  for (const earlier of ['globals.css', 'workspace.css', 'map-controls.css']) {
    assert.ok(layout.indexOf(`import './${earlier}';`) < notifications, `${earlier} still describes the old toast and must load first`);
  }
});
