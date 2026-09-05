import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../data/regional-fleet-additions.json', import.meta.url), 'utf8'));
const agencies = new Map(data.agencies.map((agency) => [agency.agencyId, agency]));

test('regional fleet additions retain each supported agency and explicit capacity semantics', () => {
  assert.equal(data.schemaVersion, 1);
  for (const id of ['miway', 'hsr', 'burlington', 'go', 'up']) assert.ok(agencies.has(id), `missing ${id}`);
  for (const agency of data.agencies) for (const entry of agency.entries) {
    assert.deepEqual(Object.keys(entry.capacity).sort(), ['basis', 'reason', 'seated', 'standing', 'total']);
    assert.ok(entry.sources.every((url) => /^https:\/\//.test(url)));
    if (entry.capacity.total !== null) {
      assert.equal(entry.capacity.seated, null);
      assert.equal(entry.capacity.standing, null);
      assert.match(entry.capacity.reason, /does not publish/i);
    }
  }
  assert.equal(agencies.get('go').entries[0].model, 'D4500');
  assert.equal(agencies.get('go').entries[0].capacity.total, 55);
  assert.equal(agencies.get('go').entries[1].model, 'Enviro500');
  assert.equal(agencies.get('go').entries[1].capacity.total, 81);
  assert.equal(agencies.get('up').entries[0].manufacturer, 'Nippon Sharyo');
  assert.equal(agencies.get('up').entries[0].capacity.total, 180);
  assert.equal(agencies.get('hsr').entries[0].unitLabel, '2283');
  assert.equal(agencies.get('hsr').entries[0].photo.exactUnit, true);
});

test('photo records preserve licence, creator, digest, and exact-unit boundaries', () => {
  for (const entry of data.agencies.flatMap((agency) => agency.entries)) {
    if (!entry.photo) {
      assert.ok(entry.photoReason);
      continue;
    }
    assert.match(entry.photo.sourceUrl, /^https:\/\/commons[.]wikimedia[.]org\/wiki\/File:/);
    assert.match(entry.photo.imageUrl, /^https:\/\/upload[.]wikimedia[.]org\//);
    assert.ok(entry.photo.creator);
    assert.match(entry.photo.licenseUrl, /^https:\/\/creativecommons[.]org\//);
    assert.match(entry.photo.sha256, /^[a-f0-9]{64}$/);
    assert.equal(entry.photo.exactUnit, entry.unitLabel !== null && entry.unitLabel === entry.photo.depictedUnitLabel);
  }
});
