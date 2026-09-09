import test from 'node:test';
import assert from 'node:assert/strict';
import { catchJourney, canStartCatch } from '../lib/catch-journey.ts';

const start = Date.parse('2026-09-09T15:00:00Z');
const route = (mode = 'BUS') => ({ id: 'fixture', startTime: new Date(start).toISOString(), endTime: new Date(start + 600000).toISOString(), duration: 600, walkDistance: 100, transfers: 0, legs: [{ mode, from: { id: 'a' }, to: { id: 'b' } }] });
const deadline = new Date(start + 720000).toISOString();

test('mixed-mode interception uses journey without requiring a walk alias', () => {
  const journey = route();
  assert.equal(catchJourney({ journey }), journey);
  assert.equal(catchJourney({ walk: route('WALK'), journey }), journey);
});
test('the earlier walking-only response remains readable', () => {
  const walk = route('WALK'); assert.equal(catchJourney({ walk }), walk);
  assert.equal(catchJourney({}), null);
  assert.equal(catchJourney({ journey: { ...walk, legs: [] } }), null);
});
test('a transit connection expires at its actual departure even with spare arrival margin', () => {
  assert.equal(canStartCatch(route(), deadline, start - 1000), true);
  assert.equal(canStartCatch(route(), deadline, start), true);
  assert.equal(canStartCatch(route(), deadline, start + 1), false);
});
test('walking expiry measures remaining time before the protected boarding deadline', () => {
  assert.equal(canStartCatch(route('WALK'), deadline, start + 120000), true);
  assert.equal(canStartCatch(route('WALK'), deadline, start + 120001), false);
});
test('invalid, missed, and inconsistent arrival boundaries never enable following', () => {
  assert.equal(canStartCatch(null, deadline, start), false);
  assert.equal(canStartCatch(route(), 'invalid', start), false);
  assert.equal(canStartCatch(route(), deadline, NaN), false);
  assert.equal(canStartCatch(route(), deadline, start + 720000), false);
  assert.equal(canStartCatch(route(), new Date(start + 300000).toISOString(), start), false);
  assert.equal(canStartCatch({ ...route(), startTime: 'invalid' }, deadline, start), false);
});
