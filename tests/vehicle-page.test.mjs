import test from 'node:test';
import assert from 'node:assert/strict';
import { vehiclePage } from '../lib/vehicle-page.ts';

test('Vehicle pages expose every loaded item without removing map data', () => {
  const vehicles = Array.from({ length: 257 }, (_, id) => ({ id }));
  const pages = [0, 1, 2].map(index => vehiclePage(vehicles, index));
  assert.deepEqual(pages.map(page => page.items.length), [100, 100, 57]);
  assert.deepEqual(pages.flatMap(page => page.items), vehicles);
  assert.equal(vehicles.length, 257);
  assert.equal(pages[2].start, 200);
  assert.equal(pages[2].end, 257);
});

test('Vehicle pages clamp after a shrinking live snapshot and handle empty results', () => {
  assert.equal(vehiclePage([1, 2], 9).page, 0);
  assert.equal(vehiclePage([1, 2], -5).page, 0);
  assert.equal(vehiclePage([1, 2], NaN).page, 0);
  assert.deepEqual(vehiclePage([], 20), { page: 0, pageCount: 1, start: 0, end: 0, items: [] });
});
