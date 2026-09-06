import test from 'node:test';
import assert from 'node:assert/strict';
import { elapsed, metresBetween } from '../lib/race-client.ts';

test('elapsed counts up from the start, and shows hours only when there are hours', () => {
  const start = '2026-09-06T17:00:00.000Z';
  assert.equal(elapsed(start, Date.parse('2026-09-06T17:00:07.000Z')), '0:07');
  assert.equal(elapsed(start, Date.parse('2026-09-06T17:04:09.000Z')), '4:09');
  assert.equal(elapsed(start, Date.parse('2026-09-06T18:23:04.000Z')), '1:23:04');
});

test('elapsed never runs backwards before the start', () => {
  assert.equal(elapsed('2026-09-06T17:00:00.000Z', Date.parse('2026-09-06T16:00:00.000Z')), '0:00');
});

test('a race that has not started shows no clock rather than a zero', () => {
  assert.equal(elapsed(null, Date.now()), '--:--');
  assert.equal(elapsed('not a time', Date.now()), '--:--');
});

test('distance between two published coordinates is measured, not estimated', () => {
  // Union Station to Bloor-Yonge, about 2.9 km apart.
  const metres = metresBetween(43.6452, -79.3806, 43.6709, -79.3857);
  assert.equal(metres > 2700 && metres < 3100, true, `measured ${Math.round(metres)} m`);
  assert.equal(Math.round(metresBetween(43.6452, -79.3806, 43.6452, -79.3806)), 0);
});
