import assert from 'node:assert/strict';
import test from 'node:test';
import { distinctRoutes, drawRoutes, routeSignature, routeSummary, shuffle, toRaceRoutes } from '../lib/race-routes.ts';

/**
 * A draw hands out real itineraries. Where the routing engine returns fewer
 * genuinely different journeys than there are teams, the shortfall is counted
 * and reported: two teams sent down the same lines must never look like a
 * deliberate pairing.
 */

const itinerary = (id, lines, minutes = 30) => ({
  id,
  startTime: '2026-09-06T14:00:00.000Z',
  endTime: '2026-09-06T14:30:00.000Z',
  duration: minutes * 60,
  legs: [
    { mode: 'WALK', from: {}, to: {}, startTime: 0, endTime: 0, duration: 300 },
    ...lines.map((route) => ({ mode: 'SUBWAY', route, from: {}, to: {}, startTime: 0, endTime: 0, duration: 600 })),
  ],
});

test('a route is identified by the lines it rides, in order', () => {
  assert.equal(routeSignature(itinerary('a', ['1', '2'])), '1 > 2');
  assert.notEqual(routeSignature(itinerary('a', ['1', '2'])), routeSignature(itinerary('b', ['2', '1'])));
  assert.equal(routeSummary(itinerary('a', ['1', '2'])), '1 → 2');
});

test('an all-walking itinerary is still a route, and says so', () => {
  const walk = { id: 'w', startTime: 0, endTime: 0, duration: 600, legs: [{ mode: 'WALK', from: {}, to: {}, startTime: 0, endTime: 0, duration: 600 }] };
  assert.equal(routeSignature(walk), 'WALK');
  assert.equal(routeSummary(walk), 'Walk the whole way');
});

test('two departures on the same lines are one route, not two', () => {
  const routes = toRaceRoutes([itinerary('a', ['1', '2']), itinerary('b', ['1', '2']), itinerary('c', ['4'])]);
  assert.equal(routes.length, 3);
  assert.deepEqual(distinctRoutes(routes).map((route) => route.id), ['a', 'c']);
});

test('duration and transfer count come from the itinerary, not from guessing', () => {
  const [route] = toRaceRoutes([itinerary('a', ['1', '2'], 47)]);
  assert.equal(route.minutes, 47);
  assert.equal(route.transfers, 1);
});

test('every team gets a different route when routing supplies enough', () => {
  const routes = toRaceRoutes([itinerary('a', ['1']), itinerary('b', ['2']), itinerary('c', ['4'])]);
  const draw = drawRoutes(['red', 'blue', 'green'], routes, () => 0.5);
  assert.equal(draw.assignments.length, 3);
  assert.equal(draw.shortfall, 0);
  assert.equal(draw.repeatedTeams, 0);
  assert.equal(new Set(draw.assignments.map((entry) => entry.route.signature)).size, 3);
  assert.deepEqual(draw.assignments.map((entry) => entry.teamId).sort(), ['blue', 'green', 'red']);
});

test('a shortfall is counted rather than hidden behind a silent repeat', () => {
  const routes = toRaceRoutes([itinerary('a', ['1']), itinerary('b', ['1'])]);
  const draw = drawRoutes(['red', 'blue', 'green'], routes, () => 0.5);
  assert.equal(draw.distinctRoutes, 1);
  assert.equal(draw.shortfall, 2);
  assert.equal(draw.repeatedTeams, 2);
  assert.equal(draw.assignments.length, 3);
});

test('the draw is a shuffle, and the same randomness replays the same result', () => {
  const routes = toRaceRoutes([itinerary('a', ['1']), itinerary('b', ['2']), itinerary('c', ['4'])]);
  const sequence = () => { const values = [0.9, 0.1, 0.7, 0.3, 0.5, 0.2]; let index = 0; return () => values[index++ % values.length]; };
  const first = drawRoutes(['red', 'blue', 'green'], routes, sequence());
  const second = drawRoutes(['red', 'blue', 'green'], routes, sequence());
  assert.deepEqual(first.assignments.map((entry) => [entry.teamId, entry.route.id]), second.assignments.map((entry) => [entry.teamId, entry.route.id]));
});

test('a shuffle keeps every item exactly once', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];
  const mixed = shuffle(items, () => 0.42);
  assert.deepEqual([...mixed].sort(), [...items].sort());
  assert.equal(mixed.length, items.length);
});

test('no teams or no routes draws nothing rather than inventing a pairing', () => {
  const routes = toRaceRoutes([itinerary('a', ['1'])]);
  assert.deepEqual(drawRoutes([], routes).assignments, []);
  assert.deepEqual(drawRoutes(['red'], []).assignments, []);
  assert.equal(drawRoutes(['red', 'blue'], []).shortfall, 2);
});
