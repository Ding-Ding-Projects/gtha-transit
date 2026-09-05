import test from 'node:test';
import assert from 'node:assert/strict';
import { manufacturerChoices, modelChoicesForManufacturer, chooseVehicleManufacturer, vehiclePolicy, optionsForPolicy, yearDraftFor, yearDraftError, criteriaFromDraft } from '../lib/journey-vehicle-controls.ts';

const facts = [{ manufacturer: 'New Flyer', model: 'Xcelsior' }, { manufacturer: 'Nova Bus', model: 'LFS' }, { manufacturer: 'New Flyer ', model: 'Xcelsior ' }, { manufacturer: null, model: 'Unassigned' }];

test('catalog choices deduplicate verified names and never invent a company for an unassigned model', () => {
  assert.deepEqual(manufacturerChoices(facts), ['New Flyer', 'Nova Bus']);
  assert.deepEqual(manufacturerChoices([]), []);
  assert.deepEqual(modelChoicesForManufacturer(facts), []);
  assert.deepEqual(modelChoicesForManufacturer(facts, 'New Flyer'), ['Xcelsior']);
  assert.deepEqual(modelChoicesForManufacturer(facts, 'Nova Bus'), ['LFS']);
  assert.deepEqual(modelChoicesForManufacturer(facts, 'Other'), []);
});

test('choosing another company clears its predecessor model while preserving year and matching choices', () => {
  const original = { manufacturer: 'New Flyer', model: 'Xcelsior', yearFrom: 2020, match: 'any' };
  assert.deepEqual(chooseVehicleManufacturer(original, 'Nova Bus'), { ...original, manufacturer: 'Nova Bus', model: undefined });
  assert.deepEqual(chooseVehicleManufacturer(original), { ...original, manufacturer: undefined, model: undefined });
  assert.deepEqual(chooseVehicleManufacturer(original, 'New Flyer'), original);
  assert.equal(original.model, 'Xcelsior');
});

test('each policy transition is exclusive and retains the explicit unknown-assignment choice', () => {
  for (const previous of [{}, { prefer: true }, { avoid: true }, { prefer: true, avoid: true }]) {
    for (const mode of ['off', 'prefer', 'avoid']) {
      const options = { ...previous, includeUnconfirmed: true };
      const next = optionsForPolicy(mode, options);
      assert.equal(next.prefer, mode === 'prefer');
      assert.equal(next.avoid, mode === 'avoid');
      assert.equal(next.includeUnconfirmed, true);
      assert.equal(vehiclePolicy(next), mode);
      assert.deepEqual(options, { ...previous, includeUnconfirmed: true });
    }
  }
});

test('legacy simultaneous flags display the same avoidance precedence as the evaluator', () => {
  assert.equal(vehiclePolicy({ prefer: true, avoid: true }), 'avoid');
  assert.equal(vehiclePolicy({}), 'off');
});

test('year drafts preserve empty endpoints and build a new criteria record only when valid', () => {
  const original = { manufacturer: 'Nova Bus', model: 'LFS', yearFrom: 2020, yearTo: 2025 };
  assert.deepEqual(yearDraftFor(original), { from: '2020', to: '2025' });
  assert.deepEqual(yearDraftFor({}), { from: '', to: '' });
  assert.deepEqual(criteriaFromDraft(original, { from: '2022', to: '' }), { ...original, yearFrom: 2022, yearTo: undefined });
  assert.deepEqual(criteriaFromDraft(original, { from: '', to: '2022' }), { ...original, yearFrom: undefined, yearTo: 2022 });
  assert.deepEqual(criteriaFromDraft(original, { from: '', to: '' }), { ...original, yearFrom: undefined, yearTo: undefined });
  assert.equal(original.yearFrom, 2020);
});

test('invalid text and reversed year drafts cannot become applied criteria', () => {
  for (const from of ['1', '1700', '3001', '2020x', '2e3', '2020.5', ' 2020', '-100']) {
    assert.equal(yearDraftError({ from, to: '' }), 'invalid');
    assert.equal(criteriaFromDraft({}, { from, to: '' }), null);
  }
  assert.equal(yearDraftError({ from: '2025', to: '2020' }), 'reversed');
  assert.equal(criteriaFromDraft({}, { from: '2025', to: '2020' }), null);
  for (const year of ['1800', '2020', '3000']) assert.equal(yearDraftError({ from: year, to: year }), null);
});
