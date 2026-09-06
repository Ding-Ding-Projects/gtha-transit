import test from 'node:test';
import assert from 'node:assert/strict';
import { upcomingStops, areWeThereYet, legStops, publishedTime, currentLeg } from '../lib/upcoming-stops.ts';

/**
 * Times below are the shape the routing service returns after asking OTP for
 * intermediate stop times: a scheduled instant per stop, and an estimate only
 * where the publisher supplied one. Nothing here is interpolated.
 */
const NOW = Date.parse('2026-09-06T17:08:00.000Z'); // 13:08 Toronto

const leg = (overrides = {}) => ({
  mode: 'TRAM',
  route: '5',
  agency: 'TTC',
  from: { name: 'Eglinton Station', lat: 43.7057, lon: -79.3985 },
  intermediateStops: [
    { name: 'Mount Pleasant Station', lat: 43.7085, lon: -79.3903, arrival: { scheduledTime: '2026-09-06T17:07:30.000Z' } },
    { name: 'Leaside Station', lat: 43.7091, lon: -79.3651, arrival: { scheduledTime: '2026-09-06T17:09:54.000Z' } },
    { name: 'Laird Station', lat: 43.7096, lon: -79.3639, arrival: { scheduledTime: '2026-09-06T17:12:00.000Z' } },
    { name: 'Sunnybrook Park', lat: 43.7222, lon: -79.3535, arrival: { scheduledTime: '2026-09-06T17:15:00.000Z', estimatedTime: '2026-09-06T17:17:00.000Z', delaySeconds: 120 } },
    { name: 'Unnamed platform', lat: 43.73, lon: -79.34 },
  ],
  to: { name: 'Kennedy Station', lat: 43.7325, lon: -79.2635 },
  startTime: '2026-09-06T17:06:00.000Z',
  endTime: '2026-09-06T17:37:00.000Z',
  ...overrides,
});

test('a leg lists every stop in order, boarding through alighting', () => {
  const stops = legStops(leg());
  assert.equal(stops.length, 7);
  assert.equal(stops[0].place.name, 'Eglinton Station');
  assert.equal(stops[6].place.name, 'Kennedy Station');
});

test('a live estimate is preferred over the timetable, and labelled as one', () => {
  assert.deepEqual(publishedTime({ scheduledTime: 'a', estimatedTime: 'b' }), { at: 'b', basis: 'estimated' });
  assert.deepEqual(publishedTime({ scheduledTime: 'a' }), { at: 'a', basis: 'scheduled' });
  assert.deepEqual(publishedTime(undefined), { at: null, basis: 'none' });
});

test('minutes come from published times, and count down from now', () => {
  const stops = upcomingStops({ leg: leg(), currentIndex: 2, now: NOW });
  assert.equal(stops[0].name, 'Leaside Station');
  assert.equal(stops[0].minutesAway, 2);
  assert.equal(stops[0].basis, 'scheduled');
  assert.equal(stops[1].name, 'Laird Station');
  assert.equal(stops[1].minutesAway, 4);
});

test('a stop the publisher estimated reports the estimate, not the timetable', () => {
  const stops = upcomingStops({ leg: leg(), currentIndex: 4, now: NOW });
  assert.equal(stops[0].name, 'Sunnybrook Park');
  assert.equal(stops[0].basis, 'estimated');
  assert.equal(stops[0].minutesAway, 9);
});

test('a stop with no published time is listed with none rather than a guess', () => {
  const stops = upcomingStops({ leg: leg(), currentIndex: 5, now: NOW });
  assert.equal(stops[0].name, 'Unnamed platform');
  assert.equal(stops[0].at, null);
  assert.equal(stops[0].basis, 'none');
  assert.equal(stops[0].minutesAway, null);
});

test('stops already passed are left out, and the alighting stop is marked', () => {
  const stops = upcomingStops({ leg: leg(), currentIndex: 5, now: NOW });
  assert.equal(stops.every((stop) => stop.index >= 5), true);
  assert.equal(stops[stops.length - 1].destination, true);
  assert.equal(stops.filter((stop) => stop.destination).length, 1);
});

test('the list can be limited without changing the indices', () => {
  const stops = upcomingStops({ leg: leg(), currentIndex: 1, now: NOW, limit: 2 });
  assert.equal(stops.length, 2);
  assert.deepEqual(stops.map((stop) => stop.index), [1, 2]);
});

test('a walking leg has no stop list and no arrival answer', () => {
  assert.deepEqual(upcomingStops({ leg: leg({ mode: 'WALK' }), now: NOW }), []);
  assert.equal(areWeThereYet({ leg: leg({ mode: 'WALK' }), now: NOW }).answer, 'unknown');
});

test('are we there yet says not yet when stops and minutes remain', () => {
  const answer = areWeThereYet({ leg: leg(), currentIndex: 2, now: NOW });
  assert.equal(answer.answer, 'not-yet');
  assert.equal(answer.stopsRemaining, 4);
  assert.equal(answer.minutesAway, 29);
  assert.equal(answer.destinationName, 'Kennedy Station');
});

test('one stop to go reads as nearly, not as arrived', () => {
  const answer = areWeThereYet({ leg: leg(), currentIndex: 5, now: NOW });
  assert.equal(answer.answer, 'nearly');
  assert.equal(answer.stopsRemaining, 1);
});

test('a measured distance to the destination settles it outright', () => {
  const answer = areWeThereYet({ leg: leg(), currentIndex: 2, now: NOW, metresToDestination: 40 });
  assert.equal(answer.answer, 'yes');
  assert.equal(answer.stopsRemaining, 0);
});

test('a distance well short of the destination does not claim arrival', () => {
  const answer = areWeThereYet({ leg: leg(), currentIndex: 2, now: NOW, metresToDestination: 4000 });
  assert.equal(answer.answer, 'not-yet');
});

test('reaching the alighting stop answers yes', () => {
  const answer = areWeThereYet({ leg: leg(), currentIndex: 6, now: NOW });
  assert.equal(answer.answer, 'yes');
  assert.equal(answer.stopsRemaining, 0);
});

test('with no position and no published arrival the answer is that it cannot be told', () => {
  const timeless = leg({ endTime: undefined, startTime: undefined });
  const answer = areWeThereYet({ leg: timeless, now: NOW });
  assert.equal(answer.answer, 'unknown');
  assert.equal(answer.destinationName, 'Kennedy Station');
});

test('the current leg is the one being ridden right now', () => {
  const first = leg({ startTime: '2026-09-06T16:30:00.000Z', endTime: '2026-09-06T16:50:00.000Z', route: '1' });
  const riding = leg({ route: '5' });
  const later = leg({ startTime: '2026-09-06T18:00:00.000Z', endTime: '2026-09-06T18:30:00.000Z', route: '2' });
  const itinerary = { legs: [first, { mode: 'WALK', from: {}, to: {} }, riding, later] };
  assert.equal(currentLeg(itinerary, NOW).route, '5');
});

test('before boarding, the next transit leg is chosen rather than a finished one', () => {
  const finished = leg({ startTime: '2026-09-06T16:30:00.000Z', endTime: '2026-09-06T16:50:00.000Z', route: '1' });
  const later = leg({ startTime: '2026-09-06T18:00:00.000Z', endTime: '2026-09-06T18:30:00.000Z', route: '2' });
  assert.equal(currentLeg({ legs: [finished, later] }, NOW).route, '2');
});
