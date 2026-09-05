import assert from 'node:assert/strict';
import test from 'node:test';
import { applyJourneyPreferences, evaluateJourneyPreferences } from '../vehicles/journey-preferences.mjs';

const leg = (cptdb, mode = 'BUS') => ({ mode, vehicle: cptdb ? { cptdb } : undefined });
const journey = (...legs) => ({ legs });

test('matches manufacturer and model as distinct exact normalised CPTDB values', () => {
  const result = evaluateJourneyPreferences(journey(leg({ manufacturer: ' New Flyer ', model: 'Xcelsior' })), { manufacturer: 'new flyer', model: 'XCELSIOR' });
  assert.equal(result.legs[0].state, 'true');
  assert.equal(evaluateJourneyPreferences(journey(leg({ manufacturer: 'New Flyer', model: 'Xcelsior' })), { manufacturer: 'new flyer', model: 'different' }).legs[0].state, 'false');
});

test('returns uncertainty for partially overlapping CPTDB build-year ranges', () => {
  assert.equal(evaluateJourneyPreferences(journey(leg({ year: '2007-2010' })), { yearFrom: 2009, yearTo: 2012 }).legs[0].state, 'unknown');
  assert.equal(evaluateJourneyPreferences(journey(leg({ year: '2009-2010' })), { yearFrom: 2009, yearTo: 2012 }).legs[0].state, 'true');
  assert.equal(evaluateJourneyPreferences(journey(leg({ year: '2007-2008' })), { yearFrom: 2009, yearTo: 2012 }).legs[0].state, 'false');
});

test('supports all and any matching across criteria', () => {
  const value = journey(leg({ manufacturer: 'Nova Bus', model: 'LFS' }));
  assert.equal(evaluateJourneyPreferences(value, { manufacturer: 'Nova Bus', model: 'Other', match: 'all' }).legs[0].state, 'false');
  assert.equal(evaluateJourneyPreferences(value, { manufacturer: 'Nova Bus', model: 'Other', match: 'any' }).legs[0].state, 'true');
});

test('ignores walking legs and does not infer a vehicle', () => {
  const result = evaluateJourneyPreferences(journey({ mode: 'WALK' }, leg(null)), { manufacturer: 'Nova Bus' });
  assert.equal(result.legs[0].state, 'ignored');
  assert.equal(result.legs[1].state, 'unknown');
});

test('avoid excludes unknown assignments by default and preserves them when requested', () => {
  const unconfirmed = journey(leg(null));
  assert.equal(applyJourneyPreferences([unconfirmed], { manufacturer: 'Nova Bus' }, { avoid: true }).excluded.length, 1);
  assert.equal(applyJourneyPreferences([unconfirmed], { manufacturer: 'Nova Bus' }, { avoid: true, includeUnconfirmed: true }).itineraries.length, 1);
});

test('empty preferences preserve the original array ordering and values', () => {
  const input = [journey(leg({ manufacturer: 'A' })), journey(leg({ manufacturer: 'B' }))];
  const result = applyJourneyPreferences(input, {}, { prefer: true, avoid: true });
  assert.deepEqual(result.itineraries, input);
  assert.equal(result.preferenceApplied, false);
});

test('prefer applies a stable boost only to verified matching itineraries', () => {
  const first = journey(leg({ manufacturer: 'Nova Bus' }));
  const middle = journey(leg({ manufacturer: 'Other' }));
  const last = journey(leg({ manufacturer: 'Nova Bus' }));
  const result = applyJourneyPreferences([first, middle, last], { manufacturer: 'Nova Bus' }, { prefer: true });
  assert.deepEqual(result.itineraries, [first, last, middle]);
});
