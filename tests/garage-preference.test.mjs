import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyGaragePreference, bandFor, bareRoute, garagesForRoute, isRidden, sourceHasExpired,
} from '../lib/garage-preference.ts';

/**
 * Somebody who wants to ride a Mount Dennis bus cannot ask for one: no feed says
 * which vehicle a departure will be until it turns up. What is published is which
 * garage runs which route, so these check the honest version of the question and,
 * more importantly, that the answer never hides a journey.
 */

const registry = {
  garageNames: { MtD: 'Mount Dennis', Qsy: 'Queensway', Wil: 'Wilson' },
  routesByGarage: { MtD: ['32', '35', '52'], Qsy: ['501', '504'], Wil: ['96', '97'] },
  source: { validFrom: '2026-07-26', validThrough: '2026-09-05' },
};

const ride = (route) => ({ mode: 'BUS', route });
const walk = () => ({ mode: 'WALK' });
const journey = (id, ...legs) => ({ id, legs });

test('a ridden leg is told apart from a walked one', () => {
  assert.equal(isRidden(ride('32')), true);
  assert.equal(isRidden({ mode: 'SUBWAY' }), true);
  assert.equal(isRidden(walk()), false);
  assert.equal(isRidden({}), false);
});

test('a route identifier is read the way the registry writes it', () => {
  assert.equal(bareRoute(ride('32')), '32');
  assert.equal(bareRoute(ride('ttc:32')), '32');
  assert.equal(bareRoute(walk()), null);
});

test('a route maps to the garages that operate it', () => {
  assert.deepEqual(garagesForRoute('32', registry), ['MtD']);
  assert.deepEqual(garagesForRoute('501', registry), ['Qsy']);
  assert.deepEqual(garagesForRoute('999', registry), []);
  // Asking within a subset only answers from that subset.
  assert.deepEqual(garagesForRoute('32', registry, ['Qsy']), []);
});

test('a journey is banded by how much of it rides the chosen garages', () => {
  assert.equal(bandFor(journey('a', ride('32'), walk(), ride('52')), registry, ['MtD']), 'every');
  assert.equal(bandFor(journey('b', ride('32'), ride('501')), registry, ['MtD']), 'some');
  assert.equal(bandFor(journey('c', ride('501')), registry, ['MtD']), 'none');
  // Walking legs are not ridden, so they neither match nor spoil a match.
  assert.equal(bandFor(journey('d', walk(), ride('35'), walk()), registry, ['MtD']), 'every');
  // A journey with nothing to ride cannot ride a garage's route.
  assert.equal(bandFor(journey('e', walk()), registry, ['MtD']), 'none');
});

test('ordering never removes a journey, it only moves it', () => {
  const list = [
    journey('none-1', ride('501')),
    journey('some-1', ride('32'), ride('501')),
    journey('every-1', ride('32')),
  ];
  const result = applyGaragePreference(list, { garages: ['MtD'], registry, today: '2026-08-01' });
  assert.deepEqual(result.itineraries.map((one) => one.id), ['every-1', 'some-1', 'none-1']);
  assert.equal(result.itineraries.length, list.length, 'a journey went missing');
  assert.deepEqual(result.disclosure.counts, { every: 1, some: 1, none: 1 });
});

test('within a band the routing service order is left alone', () => {
  // Both ride only Mount Dennis routes, so nothing here should reorder them.
  const list = [journey('first', ride('35')), journey('second', ride('32'))];
  const result = applyGaragePreference(list, { garages: ['MtD'], registry, today: '2026-08-01' });
  assert.deepEqual(result.itineraries.map((one) => one.id), ['first', 'second']);
});

test('choosing nothing changes nothing', () => {
  const list = [journey('a', ride('501')), journey('b', ride('32'))];
  const result = applyGaragePreference(list, { garages: [], registry, today: '2026-08-01' });
  assert.deepEqual(result.itineraries.map((one) => one.id), ['a', 'b']);
  assert.equal(result.disclosure.enabled, false);
  assert.equal(result.disclosure.note, null);
});

test('an unknown garage is reported rather than silently ignored', () => {
  const result = applyGaragePreference([journey('a', ride('32'))], {
    garages: ['MtD', 'Nowhere'], registry, today: '2026-08-01',
  });
  assert.deepEqual(result.disclosure.garages, ['MtD']);
  assert.deepEqual(result.disclosure.unknownGarages, ['Nowhere']);
});

test('when nothing matches, it says so instead of looking like a filter that found nothing', () => {
  const result = applyGaragePreference([journey('a', ride('501')), journey('b', ride('504'))], {
    garages: ['MtD'], registry, today: '2026-08-01',
  });
  assert.equal(result.itineraries.length, 2, 'the alternates were dropped');
  assert.match(result.disclosure.note, /Every option below is an alternate/);
});

test('a partial match says the closest ones are first', () => {
  const result = applyGaragePreference([journey('a', ride('32'), ride('501'))], {
    garages: ['MtD'], registry, today: '2026-08-01',
  });
  assert.match(result.disclosure.note, /not.*whole way|whole way/i);
  assert.equal(result.disclosure.counts.some, 1);
});

test('an expired published period is reported, and does not stop the ordering', () => {
  assert.equal(sourceHasExpired(registry, '2026-09-05'), false, 'the last covered day is still covered');
  assert.equal(sourceHasExpired(registry, '2026-09-06'), true);
  assert.equal(sourceHasExpired({ routesByGarage: {}, garageNames: {} }, '2026-09-06'), false);

  const result = applyGaragePreference([journey('a', ride('501')), journey('b', ride('32'))], {
    garages: ['MtD'], registry, today: '2026-09-08',
  });
  assert.equal(result.disclosure.sourceExpired, true);
  assert.equal(result.disclosure.validThrough, '2026-09-05');
  // Still ordered: a route's garage outlives a board period far better than a
  // vehicle's does, so the answer is offered with the caveat rather than withheld.
  assert.deepEqual(result.itineraries.map((one) => one.id), ['b', 'a']);
});
