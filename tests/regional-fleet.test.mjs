import test from 'node:test';
import assert from 'node:assert/strict';
import { REGIONAL_FLEET_RANGES } from '../vehicles/regional-fleet.mjs';
import { matchCptdb } from '../vehicles/fleet-registry.mjs';
test('every researched regional series resolves both boundaries without crossing namespaces', () => {
  for (const [agencyId, rows] of Object.entries(REGIONAL_FLEET_RANGES)) {
    for (const row of rows) for (const number of [row.first,row.last]) {
      const result=matchCptdb(`${row.prefix}${number}`,'',{agencyId,agencyName:agencyId});
      assert.equal(result.model,row.model); assert.equal(result.year,row.year);
      assert.equal(result.source.url,row.source.url);
      assert.ok(result.url.startsWith('https://cptdb.ca/'));
      if(!row.source.url.startsWith('https://cptdb.ca/')) assert.ok(result.url.includes('?search='));
    }
    for(let i=0;i<rows.length;i++) for(let j=i+1;j<rows.length;j++) assert.ok(rows[i].prefix!==rows[j].prefix || rows[i].last<rows[j].first || rows[j].last<rows[i].first, `${agencyId} overlap`);
  }
});
test('YRT electric prefix is preserved and cannot match an unprefixed bus', () => {
  assert.equal(matchCptdb('e1911','',{agencyId:'yrt'}).model,'XE40');
  assert.equal(matchCptdb('E1911','',{agencyId:'yrt'}).model,'XE40');
  assert.equal(matchCptdb('1911','',{agencyId:'yrt'}).model,undefined);
  assert.equal(matchCptdb('e1911','',{agencyId:'miway'}).model,undefined);
});
test('Milton build years are not inferred from numbering and repowered units remain distinct', () => {
  const get=id=>matchCptdb(id,'',{agencyId:'milton'});
  assert.equal(get('2401').year,'2025'); assert.equal(get('2001').year,'2021');
  assert.match(get('1701').propulsion,/Battery electric/); assert.equal(get('1702').propulsion,'Diesel');
});
test('regional source evidence does not invent capacity, photo permission or current roster status', () => {
  for(const rows of Object.values(REGIONAL_FLEET_RANGES)) for(const row of rows){
    assert.equal(row.capacity,undefined); assert.equal(row.photo,undefined);
    assert.match(row.source.coverage,/unconfirmed/);
  }
});
test('every row whose propulsion is read from a model designation cites a manufacturer source with an https URL and a title', () => {
  let modelDesignationRows = 0;
  for (const rows of Object.values(REGIONAL_FLEET_RANGES)) {
    for (const row of rows) {
      if (row.propulsionBasis !== 'model-designation') continue;
      modelDesignationRows += 1;
      const label = `${row.manufacturer} ${row.model} ${row.first}-${row.last}`;
      assert.ok(row.propulsion, `${label} carries propulsionBasis without a propulsion string`);
      assert.ok(row.propulsionSource, `${label} carries propulsionBasis without a propulsionSource`);
      assert.match(row.propulsionSource.url, /^https:\/\//, `${label} propulsionSource.url must be https`);
      assert.ok(row.propulsionSource.title && row.propulsionSource.title.trim().length > 0, `${label} propulsionSource.title must not be blank`);
      // The citation is to the manufacturer's own product page, distinct from the row's
      // own `source` (the agency roster) - the two may legitimately point elsewhere.
      assert.notEqual(row.propulsionSource.url, row.source.url, `${label} propulsionSource should not just repeat the roster source`);
    }
  }
  assert.ok(modelDesignationRows > 0, 'expected at least one regional row sourced from a model designation');
});
test('a row without propulsionBasis carries no propulsionSource, so the basis and the citation cannot drift apart', () => {
  for (const rows of Object.values(REGIONAL_FLEET_RANGES)) {
    for (const row of rows) {
      if (row.propulsionBasis === undefined) assert.equal(row.propulsionSource, undefined, `${row.manufacturer} ${row.model} ${row.first}-${row.last}`);
    }
  }
});
