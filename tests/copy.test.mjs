import test from 'node:test';
import assert from 'node:assert/strict';
import {copyAt} from '../lib/copy.ts';
test('Independent copy levels reach real planner messages and preserve factual labels',()=>{assert.notEqual(copyAt('Where to next?','en',1),copyAt('Where to next?','en',5));assert.notEqual(copyAt('下一站，去邊？','zh',1),copyAt('下一站，去邊？','zh',5));assert.equal(copyAt('Line 1','en',5),'Line 1');assert.equal(new Set([1,2,3,4,5].map(n=>copyAt('Trip saved on this device.','en',n))).size,5);});
