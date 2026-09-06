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
