import test from 'node:test';
import assert from 'node:assert/strict';
import { journeyWaits } from '../lib/journey-waits.ts';

const time = minute => `2026-09-05T10:${String(minute).padStart(2,'0')}:00-04:00`;
const journey = {
  endTime: time(55),
  legs: [
    { mode: 'WALK', duration: 300 },
    { mode: 'BUS', startTime: time(12), endTime: time(30) },
    { mode: 'WALK', duration: 180 },
    { mode: 'BUS', startTime: time(40), endTime: time(55) },
  ],
};
test('Each departure option includes initial waiting and transfer waiting without counting walking', () => {
  const result = journeyWaits(journey, time(0));
  assert.equal(result.firstWaitSeconds, 420);
  assert.equal(result.transferWaitSeconds, 420);
  assert.equal(result.elapsedSeconds, 3300);
  assert.deepEqual(result.waits.map(wait => [wait.legIndex, wait.seconds, wait.transfer]), [[1,420,false],[3,420,true]]);
  assert.equal(journeyWaits(journey, time(5)).firstWaitSeconds, 120);
});
test('Arrive-by options do not invent an initial departure wait', () => {
  const result = journeyWaits(journey);
  assert.equal(result.firstWaitSeconds, null);
  assert.equal(result.elapsedSeconds, null);
  assert.equal(result.transferWaitSeconds, 420);
});
test('Invalid or overlapping connection times never become a zero-minute wait', () => {
  const result = journeyWaits({ ...journey, legs: [...journey.legs.slice(0,3), { mode:'BUS', startTime:time(31), endTime:time(55) }] }, time(0));
  assert.equal(result.waits[1].seconds, null);
  assert.equal(result.transferWaitSeconds, null);
  assert.equal(journeyWaits(journey, 'invalid').firstWaitSeconds, null);
});
