import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../data/vehicle-capacities.json', import.meta.url), 'utf8'));
const fields = ['basis', 'notes', 'retrievedAt', 'seated', 'sourceUrl', 'standing', 'total'];

test('capacity records preserve the source boundary for every retained series', () => {
  assert.equal(data.schemaVersion, 1);
  assert.match(data.retrievedAt, /^2026-09-05T08:41:36[.]1781308-04:00$/);
  assert.ok(data.series.length <= 10);
  for (const entry of data.series) {
    assert.deepEqual(Object.keys(entry.capacityDetails).sort(), fields);
    assert.match(entry.capacityDetails.sourceUrl, /^https:\/\//);
    assert.match(entry.capacityDetails.retrievedAt, /^2026-09-05T08:41:36[.]1781308-04:00$/);
    for (const key of ['seated', 'standing', 'total']) assert.ok(entry.capacityDetails[key] === null || Number.isInteger(entry.capacityDetails[key]));
  }
});

test('TTC seats and GO passenger maxima do not manufacture standing counts', () => {
  const find = (agencyId, model) => data.series.find((entry) => entry.agencyId === agencyId && entry.model === model);
  assert.equal(find('ttc', 'LFS').capacityDetails.seated, 33);
  assert.equal(find('ttc', 'LFS Artic').capacityDetails.seated, 46);
  assert.equal(find('ttc', 'Xcelsior XDE60').capacityDetails.seated, 50);
  assert.equal(find('ttc', 'FLEXITY M-1').capacityDetails.seated, 70);
  assert.equal(find('go', 'D4500').capacityDetails.total, 55);
  assert.equal(find('go', 'Enviro500').capacityDetails.total, 81);
  assert.equal(find('ttc', 'LFLRV Streetcar').capacityDetails.standing, 181);
  assert.equal(find('ttc', 'LFS Artic').capacityDetails.standing, null);
});

test('UP Express trip capacity is never assigned to an individual DMU', () => {
  const up = data.series.find((entry) => entry.agencyId === 'up');
  assert.deepEqual([up.capacityDetails.seated, up.capacityDetails.standing, up.capacityDetails.total], [null, null, null]);
  assert.match(up.capacityDetails.notes, /train trip/i);
});
