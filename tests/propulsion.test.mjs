import assert from 'node:assert/strict';
import test from 'node:test';
import { isElectric, propulsionClass, propulsionLabel } from '../vehicles/propulsion.mjs';

test('classifies published propulsion conservatively and keeps unknown facts out of electric matches', () => {
  for (const [propulsion, expected] of [
    ['Battery electric', 'battery-electric'], ['Diesel-electric hybrid', 'hybrid'], ['Electric', 'electric'], ['Compressed natural gas', 'cng'], ['Diesel multiple unit', 'diesel'], [undefined, 'unknown'], ['Solar assisted', 'unknown'],
  ]) assert.equal(propulsionClass({ propulsion }), expected);
  assert.equal(isElectric('battery-electric'), true);
  assert.equal(isElectric('electric'), true);
  assert.equal(isElectric('hybrid'), false);
  assert.equal(isElectric('unknown'), false);
});

test('labels electric streetcars distinctly without changing the underlying class', () => {
  assert.deepEqual(propulsionLabel('electric', { streetcar: true }), { en: 'Electric (streetcar)', zh: '電動（電車）' });
  assert.deepEqual(propulsionLabel('battery-electric'), { en: 'Battery electric', zh: '電池電動' });
  assert.deepEqual(propulsionLabel('not-a-class'), { en: 'Unknown', zh: '未知' });
});
