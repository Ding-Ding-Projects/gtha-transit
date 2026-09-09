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

test('a start year alone includes later ranges with finite inclusive evidence', () => {
  for (const [year, state] of [['2020', 'true'], ['2021-2024', 'true'], ['3000', 'true'], ['2018-2019', 'false'], ['2018-2021', 'unknown'], [undefined, 'unknown']]) {
    const result = evaluateJourneyPreferences(journey(leg({ year })), { yearFrom: '2020' });
    assert.equal(result.legs[0].state, state, String(year));
    assert.deepEqual(result.criteria.range, { from: 2020, to: 3000 });
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  }
});

test('an end year alone includes earlier ranges with finite inclusive evidence', () => {
  for (const [year, state] of [['2020', 'true'], ['2018-2019', 'true'], ['1800', 'true'], ['2021-2024', 'false'], ['2018-2021', 'unknown'], [undefined, 'unknown']]) {
    const result = evaluateJourneyPreferences(journey(leg({ year })), { yearTo: 2020 });
    assert.equal(result.legs[0].state, state, String(year));
    assert.deepEqual(result.criteria.range, { from: 1800, to: 2020 });
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  }
});

test('invalid endpoints cannot silently parse, hide results, or award preference boosts', () => {
  const input = [journey(leg({ manufacturer: 'Other', year: '2019' })), journey(leg({ manufacturer: 'Nova Bus', year: '2020' }))];
  for (const invalid of ['2020junk', '2020.0', '2e3', '20 20', '20200', '02020', '0x7e4', 1799, 3001, 2020.5, NaN, Infinity, true, [], [2020], {}]) {
    for (const field of ['yearFrom', 'yearTo']) {
      const criteria = { manufacturer: 'Nova Bus', [field]: invalid, match: 'any' };
      const result = applyJourneyPreferences(input, criteria, { prefer: true, avoid: true });
      assert.deepEqual(result.itineraries, input);
      assert.equal(result.preferenceApplied, false);
      assert.equal(result.excluded.length, 0);
      const evidence = result.kept[0].evidence;
      assert.equal(evidence.criteria.valid, false);
      assert.equal(evidence.criteria.validationErrors[0].field, field);
      assert.equal(evidence.legs[0].state, 'unknown');
      assert.equal(evidence.summary.matched, false);
    }
  }
});

test('reversed years are invalid and remain unswapped in evidence', () => {
  const result = evaluateJourneyPreferences(journey(leg({ year: '2022' }), leg(null), leg(null, 'WALK')), { yearFrom: 2025, yearTo: 2020 });
  assert.deepEqual(result.criteria.range, { from: 2025, to: 2020 });
  assert.equal(result.criteria.valid, false);
  assert.equal(result.criteria.validationErrors[0].field, 'year');
  assert.equal(result.active, false);
  assert.deepEqual(result.legs.map(item => item.state), ['unknown', 'unknown', 'ignored']);
});

test('blank bounds are omitted and complete numeric strings are accepted without mutation', () => {
  for (const omitted of [undefined, null, '', '  ']) {
    const criteria = { yearFrom: ' 2020 ', yearTo: omitted };
    const input = journey(leg({ year: '2020-2024' }));
    const before = structuredClone({ input, criteria });
    const result = evaluateJourneyPreferences(input, criteria);
    assert.equal(result.criteria.valid, true);
    assert.equal(result.legs[0].state, 'true');
    assert.deepEqual({ input, criteria }, before);
    assert.equal(evaluateJourneyPreferences(input, { yearFrom: omitted, yearTo: omitted }).active, false);
  }
});

test('open years keep conservative avoid and prefer policy behavior', () => {
  const outside = journey(leg({ year: '2018-2019' }));
  const partial = journey(leg({ year: '2019-2021' }));
  const matched = journey(leg({ year: '2021-2024' }));
  const unknown = journey(leg(null));
  const input = [outside, partial, matched, unknown];
  assert.deepEqual(applyJourneyPreferences(input, { yearFrom: 2020 }, { prefer: true }).itineraries, [matched, outside, partial, unknown]);
  assert.deepEqual(applyJourneyPreferences(input, { yearFrom: 2020 }, { avoid: true }).itineraries, [outside]);
  assert.deepEqual(applyJourneyPreferences(input, { yearFrom: 2020 }, { avoid: true, includeUnconfirmed: true }).itineraries, [outside, partial, unknown]);
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

// The `propulsion: 'electric'` criterion reuses the same manufacturer/model/year
// machinery through vehicles/propulsion.mjs's isElectric()/propulsionClass(), so these
// tests exercise the electric-specific wiring rather than re-testing the shared engine.
const electricLeg = journey(leg({ propulsion: 'Battery electric' }));
const dieselLeg = journey(leg({ propulsion: 'Diesel' }));
const noVehicle = journey(leg(null));
const vehicleWithoutPropulsion = journey(leg({ manufacturer: 'Nova Bus', model: 'LFS' }));

test('prefer boosts a verified electric assignment ahead of non-electric journeys', () => {
  const result = applyJourneyPreferences([dieselLeg, electricLeg], { propulsion: 'electric' }, { prefer: true });
  assert.deepEqual(result.itineraries, [electricLeg, dieselLeg]);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.unknownCount, 0);
  assert.equal(result.preferenceApplied, true);
});

test('avoid hides a verified electric assignment and reports why it was excluded', () => {
  const result = applyJourneyPreferences([electricLeg, dieselLeg], { propulsion: 'electric' }, { avoid: true });
  assert.deepEqual(result.itineraries, [dieselLeg]);
  assert.equal(result.excluded.length, 1);
  assert.equal(result.excluded[0].itinerary, electricLeg);
  assert.equal(result.excluded[0].cause, 'matched');
  assert.equal(result.matchedCount, 0);
});

test('an unconfirmed vehicle assignment never counts as electric, whether unassigned or merely missing a propulsion fact', () => {
  for (const unconfirmed of [noVehicle, vehicleWithoutPropulsion]) {
    const evidence = evaluateJourneyPreferences(unconfirmed, { propulsion: 'electric' });
    assert.equal(evidence.legs[0].state, 'unknown');
    assert.equal(evidence.summary.matched, false);
    assert.equal(evidence.summary.unknown, true);

    // Neither prefer nor avoid may read an unknown propulsion as a verified electric match.
    assert.equal(applyJourneyPreferences([unconfirmed], { propulsion: 'electric' }, { prefer: true }).matchedCount, 0);
    assert.equal(applyJourneyPreferences([unconfirmed], { propulsion: 'electric' }, { avoid: true }).excluded[0].cause, 'unknown');
  }
  // The assigned-vehicle path reports why, distinctly from "no vehicle at all".
  const withVehicle = evaluateJourneyPreferences(vehicleWithoutPropulsion, { propulsion: 'electric' });
  assert.deepEqual(withVehicle.legs[0].checks, [{
    field: 'propulsion',
    state: 'unknown',
    reason: 'The assigned vehicle has no recognised published propulsion.',
  }]);
});

test('avoid keeps an unconfirmed assignment only when includeUnconfirmed is requested', () => {
  const excluded = applyJourneyPreferences([electricLeg, noVehicle], { propulsion: 'electric' }, { avoid: true });
  assert.deepEqual(excluded.itineraries, []);
  assert.equal(excluded.excluded.length, 2);
  assert.deepEqual(excluded.excluded.map((entry) => entry.cause).sort(), ['matched', 'unknown']);

  const kept = applyJourneyPreferences([electricLeg, noVehicle], { propulsion: 'electric' }, { avoid: true, includeUnconfirmed: true });
  assert.deepEqual(kept.itineraries, [noVehicle]);
  assert.equal(kept.excluded.length, 1);
  assert.equal(kept.excluded[0].cause, 'matched');
});

test('electric preference counts matched, unknown-but-kept and excluded itineraries correctly', () => {
  const input = [electricLeg, dieselLeg, noVehicle];

  const unboosted = applyJourneyPreferences(input, { propulsion: 'electric' }, {});
  assert.deepEqual(unboosted.itineraries, input);
  assert.equal(unboosted.matchedCount, 1);
  assert.equal(unboosted.unknownCount, 1);
  assert.equal(unboosted.excluded.length, 0);

  const preferred = applyJourneyPreferences(input, { propulsion: 'electric' }, { prefer: true });
  assert.equal(preferred.matchedCount, 1);
  assert.equal(preferred.unknownCount, 1);
  assert.equal(preferred.itineraries[0], electricLeg);

  const avoided = applyJourneyPreferences(input, { propulsion: 'electric' }, { avoid: true, includeUnconfirmed: true });
  assert.deepEqual(avoided.itineraries, [dieselLeg, noVehicle]);
  assert.equal(avoided.matchedCount, 0);
  assert.equal(avoided.unknownCount, 1);
  assert.equal(avoided.excluded.length, 1);
});
