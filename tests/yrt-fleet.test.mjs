import assert from 'node:assert/strict';
import test from 'node:test';
import { matchCptdb } from '../vehicles/fleet-registry.mjs';
import { VEHICLE_FEEDS } from '../vehicles/index.mjs';

/**
 * YRT contracts its operations out and prefixes every vehicle with the operator's
 * letter, so the same bus appears as C1513, M1513 or V1513 depending on who is
 * driving it that day. The published roster numbers those buses without a letter.
 *
 * Matching on the letter therefore found nothing at all, for the whole fleet, and
 * did it quietly: every YRT vehicle simply reported "Unverified" for every fact,
 * which is indistinguishable from a roster that does not cover them.
 */

test('a YRT operator prefix does not stop the fleet series matching', () => {
  const options = { agencyId: 'yrt', agencyName: 'York Region Transit' };
  // 1513 is a 2015 Nova Bus LFS on the published roster, whoever is operating it.
  for (const identity of ['C1513', 'M1513', 'V1513', '1513']) {
    const found = matchCptdb(identity, identity, options);
    assert.equal(found.manufacturer, 'Nova Bus', `${identity} lost its manufacturer`);
    assert.equal(found.model, 'LFS', `${identity} lost its model`);
    assert.equal(found.year, '2015', `${identity} lost its year`);
  }
});

test('YRT keeps its own roster prefix, which means something', () => {
  /* The rule drops only the contractor letters the roster never uses, and only
     after an exact match has failed. e1911 is an electric XE40 on the published
     roster and 1911 is not a bus at all, so a blunter rule that ignored every
     prefix would have quietly turned one into the other. */
  const options = { agencyId: 'yrt', agencyName: 'York Region Transit' };
  assert.equal(matchCptdb('e1911', '', options).model, 'XE40');
  assert.equal(matchCptdb('E1911', '', options).model, 'XE40');
  assert.equal(matchCptdb('1911', '', options).model, undefined, 'an unprefixed number matched an electric');
});

test('the prefix rule is YRT only, and other agencies still respect theirs', () => {
  // A TTC identity with a letter is a different vehicle from one without, and
  // ignoring the letter everywhere would have quietly mismatched them.
  const withLetter = matchCptdb('C1513', 'C1513', { agencyId: 'ttc', agencyName: 'Toronto Transit Commission' });
  const without = matchCptdb('1513', '1513', { agencyId: 'ttc', agencyName: 'Toronto Transit Commission' });
  assert.notDeepEqual(
    [withLetter.manufacturer, withLetter.model],
    [without.manufacturer, without.model],
    'the TTC prefix stopped being meaningful',
  );
});

test('a number outside the published roster reports nothing rather than guessing', () => {
  const options = { agencyId: 'yrt', agencyName: 'York Region Transit' };
  const found = matchCptdb('M0945', 'M0945', options);
  assert.equal(found.manufacturer, undefined, 'a vehicle outside the roster was given facts');
  // It still offers somewhere to look, which is the honest fallback.
  assert.equal(found.match, 'search');
});

test('YRT realtime is configured, and at its own host', () => {
  // The schedule comes from yrt.ca and the vehicles do not, which is why the
  // timetable was loaded for months while the buses were missing.
  assert.ok(VEHICLE_FEEDS.yrt, 'YRT has no vehicle feed');
  assert.equal(VEHICLE_FEEDS.yrt.name, 'York Region Transit');
  assert.match(VEHICLE_FEEDS.yrt.url, /^https:\/\/rtu\.york\.ca\//);
});
