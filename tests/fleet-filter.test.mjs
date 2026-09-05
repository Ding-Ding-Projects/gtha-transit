import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emptyFleetFilter,
  filterFleetVehicles,
  manufacturerOptions,
  modelOptions,
} from '../lib/fleet-filter.ts';

const filter = (changes = {}) => ({ ...emptyFleetFilter(), ...changes });
const ids = (result) => result.vehicles.map((vehicle) => vehicle.id);

test('returns a fresh empty filter and preserves every vehicle for empty criteria', () => {
  const first = emptyFleetFilter();
  const second = emptyFleetFilter();
  assert.deepEqual(first, {
    manufacturer: '',
    model: '',
    yearFrom: '',
    yearTo: '',
    includeUnknown: false,
  });
  assert.notEqual(first, second);

  const vehicles = [
    {
      id: 'known',
      cptdb: { manufacturer: 'Nova Bus', model: 'LFS', year: '2020' },
    },
    { id: 'unknown' },
  ];
  const result = filterFleetVehicles(vehicles, first);
  assert.deepEqual(ids(result), ['known', 'unknown']);
  assert.notEqual(result.vehicles, vehicles);
  assert.equal(result.active, false);
  assert.equal(result.error, null);
  assert.equal(result.unknownCount, 0);
  assert.equal(result.excludedUnknownCount, 0);
});

test('matches exact manufacturer and model values after Unicode-aware case normalisation', () => {
  const vehicles = [
    {
      id: 'matching',
      cptdb: { manufacturer: ' M\u00c9TRO ', model: ' LFS Artic ' },
    },
    {
      id: 'partial-text-only',
      cptdb: { manufacturer: 'M\u00e9trobus', model: 'LFS Artic' },
    },
    {
      id: 'model-mismatch',
      cptdb: { manufacturer: 'M\u00e9tro', model: 'LFS' },
    },
  ];

  const result = filterFleetVehicles(
    vehicles,
    filter({ manufacturer: 'me\u0301tro', model: 'lfs artic' }),
  );
  assert.deepEqual(ids(result), ['matching']);
  assert.equal(result.unknownCount, 0);
});

test('derives manufacturer and cascaded model options only from CPTDB metadata', () => {
  const vehicles = [
    {
      id: 'one',
      manufacturer: 'Do not read this',
      cptdb: { manufacturer: ' Nova Bus ', model: 'LFS' },
    },
    { id: 'two', cptdb: { manufacturer: 'new flyer', model: 'Xcelsior' } },
    { id: 'three', cptdb: { manufacturer: 'New Flyer', model: 'Xcelsior' } },
    { id: 'four', cptdb: { manufacturer: 'New Flyer', model: 'XE40' } },
    { id: 'five', cptdb: { manufacturer: '', model: 'Unattributed' } },
    { id: 'six' },
  ];

  assert.deepEqual(manufacturerOptions(vehicles), ['new flyer', 'Nova Bus']);
  assert.deepEqual(modelOptions(vehicles, ''), []);
  assert.deepEqual(modelOptions(vehicles, 'NEW FLYER'), ['Xcelsior', 'XE40']);
  assert.deepEqual(modelOptions(vehicles, 'nova bus'), ['LFS']);
});

test('uses overlap against a numeric year or published year range while preserving input order', () => {
  const vehicles = Object.freeze([
    Object.freeze({
      id: 'first-range',
      cptdb: Object.freeze({ year: '2007-2010' }),
    }),
    Object.freeze({
      id: 'outside',
      cptdb: Object.freeze({ year: '2001-2004' }),
    }),
    Object.freeze({ id: 'numeric', cptdb: Object.freeze({ year: 2012 }) }),
    Object.freeze({
      id: 'last-range',
      cptdb: Object.freeze({ year: '2010\u20132013' }),
    }),
  ]);

  const before = JSON.parse(JSON.stringify(vehicles));
  const result = filterFleetVehicles(
    vehicles,
    filter({ yearFrom: '2009', yearTo: '2011' }),
  );
  assert.deepEqual(ids(result), ['first-range', 'last-range']);
  assert.deepEqual(vehicles, before);

  const numericResult = filterFleetVehicles(
    vehicles,
    filter({ yearFrom: '2012' }),
  );
  assert.deepEqual(ids(numericResult), ['numeric', 'last-range']);
});

test('reports model and strict year validation errors without producing false matches', () => {
  const vehicles = [
    {
      id: 'candidate',
      cptdb: { manufacturer: 'Nova Bus', model: 'LFS', year: 2020 },
    },
  ];

  const modelError = filterFleetVehicles(vehicles, filter({ model: 'LFS' }));
  assert.equal(modelError.active, true);
  assert.equal(
    modelError.error,
    'Select a manufacturer before filtering by model.',
  );
  assert.deepEqual(ids(modelError), []);

  for (const yearFrom of ['1799', '3001', '2020.0', '20 20', '20200']) {
    const result = filterFleetVehicles(vehicles, filter({ yearFrom }));
    assert.equal(result.error, 'Enter a whole year from 1800 through 3000.');
    assert.deepEqual(ids(result), []);
  }

  const reversed = filterFleetVehicles(
    vehicles,
    filter({ yearFrom: '2021', yearTo: '2020' }),
  );
  assert.equal(
    reversed.error,
    'The start year must be the same as or earlier than the end year.',
  );
  assert.deepEqual(ids(reversed), []);
});

test('treats malformed published year values as unknown, not as a fabricated match', () => {
  const vehicles = [
    { id: 'valid', cptdb: { year: '2020-2021' } },
    { id: 'reversed-range', cptdb: { year: '2021-2020' } },
    { id: 'free-text', cptdb: { year: 'built in 2020' } },
    { id: 'too-many-years', cptdb: { year: '2019-2020-2021' } },
  ];

  const excluded = filterFleetVehicles(
    vehicles,
    filter({ yearFrom: '2020', yearTo: '2020' }),
  );
  assert.deepEqual(ids(excluded), ['valid']);
  assert.equal(excluded.unknownCount, 3);
  assert.equal(excluded.excludedUnknownCount, 3);

  const included = filterFleetVehicles(
    vehicles,
    filter({ yearFrom: '2020', yearTo: '2020', includeUnknown: true }),
  );
  assert.deepEqual(ids(included), [
    'valid',
    'reversed-range',
    'free-text',
    'too-many-years',
  ]);
  assert.equal(included.unknownCount, 3);
  assert.equal(included.excludedUnknownCount, 0);
});

test('only admits unknown vehicles when requested and never lets unknown override a known mismatch', () => {
  const vehicles = [
    {
      id: 'known-match',
      cptdb: { manufacturer: 'Nova Bus', model: 'LFS', year: '2020' },
    },
    { id: 'missing-model', cptdb: { manufacturer: 'Nova Bus', year: '2020' } },
    { id: 'missing-manufacturer', cptdb: { model: 'LFS', year: '2020' } },
    {
      id: 'manufacturer-mismatch-missing-model',
      cptdb: { manufacturer: 'Other', year: '2020' },
    },
    {
      id: 'model-mismatch-missing-year',
      cptdb: { manufacturer: 'Nova Bus', model: 'Other' },
    },
    { id: 'missing-everything' },
  ];
  const criteria = { manufacturer: 'nova bus', model: 'lfs', yearFrom: '2020' };

  const excluded = filterFleetVehicles(vehicles, filter(criteria));
  assert.deepEqual(ids(excluded), ['known-match']);
  assert.equal(excluded.unknownCount, 3);
  assert.equal(excluded.excludedUnknownCount, 3);

  const included = filterFleetVehicles(
    vehicles,
    filter({ ...criteria, includeUnknown: true }),
  );
  assert.deepEqual(ids(included), [
    'known-match',
    'missing-model',
    'missing-manufacturer',
    'missing-everything',
  ]);
  assert.equal(included.unknownCount, 3);
  assert.equal(included.excludedUnknownCount, 0);
});
