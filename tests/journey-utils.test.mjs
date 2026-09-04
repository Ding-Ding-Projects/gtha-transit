import test from 'node:test';
import assert from 'node:assert/strict';
import {torontoIso,torontoLocalInput,isPlace} from '../lib/journey-utils.ts';
test('Toronto date conversion accounts for winter, summer and the actual DST transition',()=>{assert.equal(torontoIso('2026-01-15T12:00'),'2026-01-15T17:00:00.000Z');assert.equal(torontoIso('2026-07-15T12:00'),'2026-07-15T16:00:00.000Z');assert.equal(torontoIso('2026-03-08T03:30'),'2026-03-08T07:30:00.000Z');});
test('Nonexistent time is rejected and repeated time explicitly chooses earlier occurrence',()=>{assert.throws(()=>torontoIso('2026-03-08T02:30'));assert.equal(torontoIso('2026-11-01T01:30'),'2026-11-01T05:30:00.000Z');assert.throws(()=>torontoIso('2026-02-30T12:00'));});
test('Saved coordinates cannot inject invalid values into the map',()=>{assert.equal(isPlace({id:'a',name:'Union',lat:43.64,lon:-79.38}),true);for(const lat of [NaN,Infinity,91,'43'])assert.equal(isPlace({id:'a',name:'Union',lat,lon:0}),false);assert.equal(isPlace({name:'Incomplete'}),false);});
