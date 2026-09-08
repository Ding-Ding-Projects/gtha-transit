import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DISMISS_AFTER,
  HISTORY_STORAGE_KEY,
  MAX_HISTORY,
  MAX_VISIBLE,
  SEVERITIES,
  countsBySeverity,
  dayOf,
  dismiss,
  dismissAll,
  emptyNotifications,
  expired,
  filterHistory,
  forget,
  notificationSample,
  notify,
  parseHistory,
  politeness,
  resetNotificationIds,
  serializeHistory,
} from '../lib/notifications.ts';

const NOW = Date.parse('2026-09-08T15:00:00Z');
const add = (state, overrides = {}, now = NOW) =>
  notify(state, { severity: 'info', title: 'Saved', ...overrides }, now);

test('a second notification stacks beside the first rather than replacing it', () => {
  // The single-string toast this replaces showed exactly one of two simultaneous
  // messages and never said which it dropped.
  resetNotificationIds();
  let state = add(emptyNotifications(), { title: 'Trip saved' });
  state = add(state, { title: 'Route request failed', severity: 'error' });
  assert.deepEqual(state.live.map((item) => item.title), ['Trip saved', 'Route request failed']);
  assert.equal(state.history.length, 2);
  assert.equal(state.history[0].title, 'Route request failed', 'the history reads newest first');
});

test('a notification that supersedes another replaces it instead of piling up', () => {
  resetNotificationIds();
  let state = emptyNotifications();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    state = add(state, { title: `Retrying (${attempt})`, supersedes: 'route-request' });
  }
  assert.equal(state.live.length, 1, 'three attempts at one thing is one story');
  assert.equal(state.live[0].title, 'Retrying (3)');
  assert.equal(state.history.length, 3, 'though all three are still reviewable');
});

test('the visible stack is capped and what falls off it is not lost', () => {
  resetNotificationIds();
  let state = emptyNotifications();
  for (let index = 0; index < MAX_VISIBLE + 3; index += 1) state = add(state, { title: `Notice ${index}` });
  assert.equal(state.live.length, MAX_VISIBLE);
  assert.equal(state.live[0].title, `Notice ${3}`, 'the oldest visible one has moved on');
  assert.equal(state.history.length, MAX_VISIBLE + 3, 'and every one of them is still in the centre');
});

test('warnings and errors do not remove themselves while you are reading them', () => {
  assert.equal(DISMISS_AFTER.warning, null);
  assert.equal(DISMISS_AFTER.error, null);
  assert.equal(DISMISS_AFTER.progress, null, 'progress ends when the work does, not on a timer');
  assert.ok(DISMISS_AFTER.info > 0);
  assert.ok(DISMISS_AFTER.success > 0);

  resetNotificationIds();
  let state = add(emptyNotifications(), { severity: 'info', title: 'Copied' });
  state = add(state, { severity: 'error', title: 'Could not reach the routing service' });
  assert.deepEqual(expired(state, NOW), [], 'nothing has timed out yet');
  assert.deepEqual(expired(state, NOW + DISMISS_AFTER.info).length, 1, 'the info one has');
  assert.deepEqual(expired(state, NOW + 86_400_000).length, 1, 'and a day later the error is still there');
});

test('dismissing takes it off the stack and keeps it in the centre, with the time it went', () => {
  resetNotificationIds();
  let state = add(emptyNotifications(), { title: 'Trip saved' });
  const [only] = state.live;
  state = dismiss(state, only.id, NOW + 1000);
  assert.deepEqual(state.live, []);
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].dismissedAt, NOW + 1000);
  assert.equal(dismiss(state, 'not-a-notification'), state, 'dismissing nothing changes nothing');
});

test('dismiss all clears the stack and marks every one of them', () => {
  resetNotificationIds();
  let state = emptyNotifications();
  for (let index = 0; index < 3; index += 1) state = add(state, { title: `Notice ${index}` });
  state = dismissAll(state, NOW + 500);
  assert.deepEqual(state.live, []);
  assert.equal(state.history.filter((item) => item.dismissedAt === NOW + 500).length, 3);
});

test('forgetting removes it from the centre as well, which is the destructive one', () => {
  resetNotificationIds();
  let state = add(emptyNotifications(), { title: 'Trip saved' });
  state = add(state, { title: 'Trip shared' });
  const going = state.history[0].id;
  state = forget(state, [going]);
  assert.equal(state.history.length, 1);
  assert.equal(state.live.length, 1);
  assert.ok(!state.history.some((item) => item.id === going));
  assert.ok(!state.live.some((item) => item.id === going), 'and off the stack too, or it would reappear');
});

test('the history is bounded, so a long session cannot grow without limit', () => {
  resetNotificationIds();
  let state = emptyNotifications();
  for (let index = 0; index < MAX_HISTORY + 20; index += 1) state = add(state, { title: `Notice ${index}` });
  assert.equal(state.history.length, MAX_HISTORY);
  assert.equal(state.history[0].title, `Notice ${MAX_HISTORY + 19}`, 'the newest is kept');
});

test('only an error interrupts a screen reader', () => {
  assert.equal(politeness('error'), 'assertive');
  for (const severity of SEVERITIES.filter((item) => item !== 'error')) {
    assert.equal(politeness(severity), 'polite', `${severity} must not talk over what is being read`);
  }
});

/* ---------------------------------------------------------------- reading -- */

test('the centre filters by severity, by day and by an externally computed match', () => {
  resetNotificationIds();
  let state = emptyNotifications();
  state = add(state, { title: 'Trip saved', severity: 'success' }, Date.parse('2026-09-06T15:00:00Z'));
  state = add(state, { title: 'Routing failed', severity: 'error' }, Date.parse('2026-09-07T15:00:00Z'));
  state = add(state, { title: 'Map hidden', severity: 'info' }, Date.parse('2026-09-08T15:00:00Z'));
  const history = state.history;

  assert.deepEqual(filterHistory(history, { severities: ['error'] }).map((item) => item.title), ['Routing failed']);
  assert.equal(filterHistory(history, { severities: [] }).length, 3, 'no severity chosen means all of them');
  assert.deepEqual(filterHistory(history, { from: '2026-09-07' }).map((item) => item.title), ['Map hidden', 'Routing failed']);
  assert.deepEqual(filterHistory(history, { to: '2026-09-06' }).map((item) => item.title), ['Trip saved']);
  // The matcher is the planner's own, handed in already computed, so the centre
  // and the search bar six inches away cannot answer differently.
  assert.deepEqual(filterHistory(history, {}, [false, true, false]).map((item) => item.title), ['Routing failed']);
});

test('a notification is searchable by everything it showed', () => {
  const sample = notificationSample({
    id: 'x', severity: 'error', at: NOW,
    title: 'Could not reach the routing service', body: 'Try again in a moment',
    actions: [{ id: 'retry', label: 'Retry' }],
  });
  for (const part of ['Could not reach', 'Try again', 'error', 'Retry']) {
    assert.ok(sample.includes(part), `${part} is visible on the row and must be searchable`);
  }
});

test('the counts make an empty filter visibly empty rather than mysteriously so', () => {
  resetNotificationIds();
  let state = emptyNotifications();
  state = add(state, { severity: 'error' });
  state = add(state, { severity: 'error' });
  state = add(state, { severity: 'info' });
  const counts = countsBySeverity(state.history);
  assert.equal(counts.error, 2);
  assert.equal(counts.info, 1);
  assert.equal(counts.warning, 0, 'a severity with none is zero rather than absent');
  assert.deepEqual(Object.keys(counts).sort(), [...SEVERITIES].sort());
});

test('a day is a Toronto day, because that is the day the traveller had', () => {
  // 20:00 in Toronto on the 7th is already the 8th in UTC.
  assert.equal(dayOf(Date.parse('2026-09-08T00:30:00Z')), '2026-09-07');
  assert.equal(dayOf(Date.parse('2026-09-08T15:00:00Z')), '2026-09-08');
});

/* ------------------------------------------------------------ persistence -- */

test('the history survives a reload', () => {
  resetNotificationIds();
  let state = add(emptyNotifications(), { title: 'Trip saved', severity: 'success', body: 'Union to Kennedy' });
  state = dismiss(state, state.live[0].id, NOW + 10);
  const restored = parseHistory(serializeHistory(state.history));
  assert.equal(restored.length, 1);
  assert.equal(restored[0].title, 'Trip saved');
  assert.equal(restored[0].body, 'Union to Kennedy');
  assert.equal(restored[0].severity, 'success');
  assert.equal(restored[0].dismissedAt, NOW + 10);
});

test('a restored notification keeps no actions, because their handlers did not survive', () => {
  // A button that looks live and does nothing is the decorative-control defect
  // this project refuses everywhere else.
  const stored = serializeHistory([{ id: 'a', severity: 'error', title: 'Failed', at: NOW, actions: [{ id: 'retry', label: 'Retry' }] }]);
  const [restored] = parseHistory(stored);
  assert.deepEqual(restored.actions, [], 'the row still says an action was offered, and offers none');
});

test('an unreadable history is dropped rather than partially restored', () => {
  // Half a history is worse than none, because it looks complete.
  assert.deepEqual(parseHistory(null), []);
  assert.deepEqual(parseHistory(''), []);
  assert.deepEqual(parseHistory('{'), []);
  assert.deepEqual(parseHistory('[]'), []);
  assert.deepEqual(parseHistory('{"version":2,"history":[]}'), [], 'a version this code does not know');
  assert.deepEqual(parseHistory('{"version":1,"history":"nope"}'), []);
});

test('a malformed row is skipped and the readable ones around it survive', () => {
  const stored = JSON.stringify({ version: 1, history: [
    { id: 'good', severity: 'info', title: 'Kept', at: NOW },
    { id: 'no-severity', severity: 'catastrophe', title: 'Dropped', at: NOW },
    { severity: 'info', title: 'No id', at: NOW },
    { id: 'no-time', severity: 'info', title: 'Dropped' },
    { id: 'also-good', severity: 'error', title: 'Kept too', at: NOW },
  ] });
  assert.deepEqual(parseHistory(stored).map((item) => item.title), ['Kept', 'Kept too']);
});

test('a restored title and body are bounded, so a stored blob cannot become the interface', () => {
  const stored = JSON.stringify({ version: 1, history: [
    { id: 'big', severity: 'info', title: 'x'.repeat(5000), body: 'y'.repeat(9000), at: NOW },
  ] });
  const [restored] = parseHistory(stored);
  assert.equal(restored.title.length, 400);
  assert.equal(restored.body.length, 2000);
});

test('the storage key follows the convention every other stored preference uses', () => {
  assert.equal(HISTORY_STORAGE_KEY, 'gtha-notification-history-v1');
  assert.match(HISTORY_STORAGE_KEY, /^gtha-[a-z-]+-v\d+$/);
});
