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
