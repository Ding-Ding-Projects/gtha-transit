import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLiveIntoJourneys, trackableLegs } from '../lib/use-live-journeys.ts';

const now = Date.parse('2026-09-09T12:00:00Z');
const start = '2026-09-09T12:05:00Z', end = '2026-09-09T12:15:00Z';
const make = () => [{ id: 'j', startTime: start, endTime: end, duration: 600, legs: [{ legId: 'leg', tripId: 'go:1', mode: 'BUS', startTime: start, endTime: end, duration: 600, realtime: true, departureDelaySeconds: 180, realtimeState: 'UPDATED', from: { stopId: 'go:a' }, to: { stopId: 'go:b' }, intermediateStops: [{ stopId: 'go:x', name: 'Original', arrival: { scheduledTime: start } }] }] }];

test('refresh removes an obsolete live flag when the publisher returns scheduled service', () => {
  const base = make();
  const next = mergeLiveIntoJourneys(base, new Map([['leg', { legId: 'leg', realtimeState: 'SCHEDULED', startTime: start, endTime: end, checkedAt: now }]]));
  assert.equal(next[0].legs[0].realtime, false);
  assert.equal(next[0].legs[0].departureDelaySeconds, undefined);
  assert.equal(next[0].legs[0].liveCheckedAt, now);
  assert.equal(base[0].legs[0].realtime, true);
});

test('an unavailable refresh cannot give old predictions a new checked-at stamp', () => {
  const base = make();
  const next = mergeLiveIntoJourneys(base, new Map([['leg', { legId: 'leg', error: 'unavailable', checkedAt: now }]]));
  assert.equal(next[0], base[0]);
});

test('intermediate stops match by identity and never by array position', () => {
  const base = make();
  const next = mergeLiveIntoJourneys(base, new Map([['leg', { legId: 'leg', realtimeState: 'UPDATED', intermediateStops: [{ stopId: 'go:other', arrival: { estimatedTime: end } }] }]]));
  assert.deepEqual(next[0].legs[0].intermediateStops, base[0].legs[0].intermediateStops);
});

test('refreshed duration reflects the changed end time without replacing option identity', () => {
  const next = mergeLiveIntoJourneys(make(), new Map([['leg', { legId: 'leg', endTime: '2026-09-09T12:20:00Z', realtimeState: 'UPDATED' }]]));
  assert.equal(next[0].duration, 900);
  assert.equal(next[0].id, 'j');
});

test('tracking handles numeric instants and excludes completed and distant legs', () => {
  const base = make();
  base[0].legs[0].startTime = now + 4 * 3600_000;
  assert.equal(trackableLegs(base, now).length, 0);
  base[0].legs[0].startTime = now;
  base[0].legs[0].endTime = now - 31 * 60_000;
  assert.equal(trackableLegs(base, now).length, 0);
  base[0].legs[0].endTime = now + 1000;
  assert.equal(trackableLegs(base, now).length, 1);
});
