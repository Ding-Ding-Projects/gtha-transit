import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifiedStopId, samePublishedStop } from '../lib/stop-identity.ts';
test('publisher bare stop IDs resolve against their agency and known TTC version alias',()=>{
 assert.equal(qualifiedStopId('123','ttc'),'ttc:123');
 assert.equal(samePublishedStop('ttc-next:123','123','ttc'),true);
 assert.equal(samePublishedStop('ttc:123','ttc-next:123','ttc'),true);
 assert.equal(samePublishedStop('miway:123','123','ttc'),false);
 assert.equal(samePublishedStop('ttc:1234','123','ttc'),false);
 assert.equal(samePublishedStop(undefined,'123','ttc'),false);
});
