import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRouteColourIndex, lookupRouteColour } from '../lib/route-colours.ts';

/**
 * A route number on its own is a number. The colour is the thing people recognise,
 * so it belongs on every badge, and it has to be the operator's own.
 *
 * The behaviour worth guarding is the refusal. Inventing a colour for a route that
 * publishes none would be a claim about branding nobody made, and two unrelated
 * routes that collide on a generated colour look related. A fallback added later
 * "so the badge is never blank" would not throw and would not fail anything else.
 */

const records = [
  { id: 'ttc:29', routeId: '29', shortName: '29', longName: 'Dufferin', color: 'D42C2C', textColor: 'FFFFFF' },
  { id: 'ttc:501', routeId: '501', shortName: '501', longName: 'Queen', color: null, textColor: null },
];

test('a published colour comes back as the operator published it', () => {
  const index = buildRouteColourIndex(records);
  const found = lookupRouteColour(index, '29');
  assert.equal(found.color, '#D42C2C');
  assert.equal(found.textColor, '#FFFFFF');
  assert.equal(found.longName, 'Dufferin');
});

test('a route the catalogue knows by its qualified id resolves the same way', () => {
  // A live vehicle reports "29"; the catalogue also knows it as "ttc:29". A lookup
  // that handled only one of them would find nothing and show a plain badge, which
  // reads as "this route has no colour" rather than "we looked in one place".
  const index = buildRouteColourIndex(records);
  assert.equal(lookupRouteColour(index, 'ttc:29').color, '#D42C2C');
  assert.equal(lookupRouteColour(index, '29').color, '#D42C2C');
});

test('a route with no published colour gets none, not a generated one', () => {
  const index = buildRouteColourIndex(records);
  const found = lookupRouteColour(index, '501');
  assert.equal(found.color, null, 'a colour was invented for a route that publishes none');
  assert.equal(found.textColor, null);
  assert.equal(found.longName, 'Queen', 'the name is still known even without a colour');
});

test('an unknown route, an empty catalogue and a missing id all answer with nulls', () => {
  const index = buildRouteColourIndex(records);
  for (const [label, value] of [
    ['unknown route', lookupRouteColour(index, '999')],
    ['no route id', lookupRouteColour(index, null)],
    ['empty string', lookupRouteColour(index, '')],
    ['empty catalogue', lookupRouteColour(buildRouteColourIndex(null), '29')],
  ]) {
    assert.equal(value.color, null, `${label} produced a colour`);
    assert.equal(value.shortName, null, `${label} produced a name`);
  }
});

test('the first record for a key wins, so a later duplicate cannot repaint a route', () => {
  const index = buildRouteColourIndex([
    ...records,
    { id: 'other:29', routeId: '29', shortName: '29', longName: 'Something else', color: '00FF00', textColor: '000000' },
  ]);
  assert.equal(lookupRouteColour(index, '29').color, '#D42C2C');
});
