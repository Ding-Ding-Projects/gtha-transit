import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTtcRoute, groupTtcDisruptions } from '../lib/disruption-groups.ts';

const catalog = [
  { feedId: 'ttc', routeId: '301', routeType: 0 },
  { feedId: 'ttc', routeId: '324', routeType: 3 },
  { feedId: 'ttc', routeId: '501', routeType: 0 },
  { feedId: 'go', routeId: '501', routeType: 3 },
];

test('uses the official route catalog rather than a TTC route-number pattern', () => {
  assert.deepEqual(classifyTtcRoute({ routeId: '324' }, catalog), { group: 'bus', mode: 'bus' });
  assert.deepEqual(classifyTtcRoute({ routeId: '501' }, catalog), { group: 'streetcar', mode: 'streetcar' });
  assert.deepEqual(classifyTtcRoute({ routeId: '301' }, catalog), { group: 'streetcar', mode: 'streetcar' });
});

test('keeps known subway and light-rail line identities in rapid transit before generic GTFS type zero', () => {
  assert.deepEqual(classifyTtcRoute({ routeId: '1', routeType: 1 }, catalog), { group: 'rapidTransit', mode: 'subway' });
  assert.deepEqual(classifyTtcRoute({ routeId: '5', routeType: 0 }, catalog), { group: 'rapidTransit', mode: 'light-rail' });
});

test('uses explicit route mode metadata when it is present and leaves unrecognized metadata honest', () => {
  assert.deepEqual(classifyTtcRoute({ routeType: 'Bus' }, catalog), { group: 'bus', mode: 'bus' });
  assert.deepEqual(classifyTtcRoute({ routeId: '501', routeType: 'Bus' }, catalog), { group: 'streetcar', mode: 'streetcar' });
  assert.deepEqual(classifyTtcRoute({ routeId: 'x', routeType: 'Escalator' }, catalog), { group: 'unknown', mode: 'unknown' });
  assert.deepEqual(classifyTtcRoute({ routeId: 'x' }, catalog), { group: 'unknown', mode: 'unknown' });
});

test('groups network-wide and unknown alerts without inventing a route mode', () => {
  const grouped = groupTtcDisruptions([
    { id: 'network', routeScope: 'network' },
    { id: 'unknown', routeScope: 'unknown', routeIds: ['not-published'] },
  ], catalog);
  assert.deepEqual(grouped.networkWide.map((alert) => alert.id), ['network']);
  assert.deepEqual(grouped.unknown.map((alert) => alert.id), ['unknown']);
  assert.equal(grouped.totalDistinct, 2);
});

test('puts one mixed alert in each applicable group while retaining one distinct total', () => {
  const mixed = { id: 'mixed', routeRefs: [{ routeId: '324' }, { routeId: '501' }] };
  const duplicate = { id: 'mixed', routeRefs: [{ routeId: '501' }, { routeId: '324' }] };
  const grouped = groupTtcDisruptions([mixed, duplicate], catalog);
  assert.deepEqual(grouped.bus, [mixed]);
  assert.deepEqual(grouped.streetcar, [mixed]);
  assert.equal(grouped.totalDistinct, 1);
});
