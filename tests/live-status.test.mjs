import test from 'node:test';
import assert from 'node:assert/strict';
import {
  signedDurationSeconds,
  classifyDelay,
  delayMinutes,
  classifyLeg,
  classifyStop,
  summariseJourney,
  describeState,
  LIVE_STATES,
  STATE_ICONS,
  STATE_CLASS,
} from '../lib/live-status.ts';

const NOW = Date.parse('2026-09-09T12:00:00.000Z');

const leg = (overrides = {}) => ({
  mode: 'BUS',
  agencyFeedId: 'ttc',
  realtime: true,
  realtimeState: 'UPDATED',
  departureDelaySeconds: 90,
  arrivalDelaySeconds: 90,
  startTime: '2026-09-09T12:05:00.000Z',
  scheduledStartTime: '2026-09-09T12:03:30.000Z',
  endTime: '2026-09-09T12:20:00.000Z',
  scheduledEndTime: '2026-09-09T12:18:30.000Z',
  ...overrides,
});

const coverage = (state, extra = {}) => ({
  feeds: { ttc: { state, ...extra } },
  checkedAt: new Date(NOW).toISOString(),
});

// --- signedDurationSeconds -------------------------------------------------

test('signedDurationSeconds reads plain numbers, numeric strings, and ISO-8601 durations', () => {
  assert.equal(signedDurationSeconds('PT13S'), 13);
  assert.equal(signedDurationSeconds('-PT26S'), -26);
  assert.equal(signedDurationSeconds('PT-1M-30S'), -90);
  assert.equal(signedDurationSeconds('PT1H2M3.5S'), 3723.5);
  assert.equal(signedDurationSeconds('P0D'), 0);
  assert.equal(signedDurationSeconds(42), 42);
  assert.equal(signedDurationSeconds('42'), 42);
});

test('signedDurationSeconds never coerces junk to zero', () => {
  assert.equal(signedDurationSeconds('junk'), null);
  assert.equal(signedDurationSeconds(null), null);
  assert.equal(signedDurationSeconds(undefined), null);
  assert.equal(signedDurationSeconds({}), null);
});

// --- classifyDelay ----------------------------------------------------------

test('classifyDelay treats -60 seconds and earlier as early', () => {
  assert.equal(classifyDelay(-61).state, 'early');
  assert.equal(classifyDelay(-60).state, 'early');
  assert.equal(classifyDelay(-59).state, 'on-time');
});

test('classifyDelay treats 180 seconds and later as late, with a very-late tier from 300', () => {
  assert.deepEqual(classifyDelay(179), { state: 'on-time' });
  assert.deepEqual(classifyDelay(180), { state: 'late', tier: 'late' });
  assert.deepEqual(classifyDelay(299), { state: 'late', tier: 'late' });
  assert.deepEqual(classifyDelay(300), { state: 'late', tier: 'very-late' });
});

test('classifyDelay reports unknown for null, never a guessed on-time', () => {
  assert.deepEqual(classifyDelay(null), { state: 'unknown' });
});

// --- delayMinutes -------------------------------------------------------------

test('delayMinutes rounds to the nearest whole minute and keeps the sign', () => {
  assert.equal(delayMinutes(120), 2);
  assert.equal(delayMinutes(125), 2);
  assert.equal(delayMinutes(155), 3);
  assert.equal(delayMinutes(-125), -2);
  assert.equal(delayMinutes(-155), -3);
  assert.equal(delayMinutes(null), null);
});

// --- classifyLeg: walking and cancellation ----------------------------------

test('a walking leg is always unknown, even with coverage and a delay field', () => {
  const status = classifyLeg(leg({ mode: 'WALK' }), { coverage: coverage('applied'), now: NOW, checkedAt: NOW });
  assert.equal(status.state, 'unknown');
  assert.equal(status.basis, 'none');
  assert.equal(status.delaySeconds, null);
});

test('a cancelled realtime state wins over a large delay', () => {
  const status = classifyLeg(leg({ realtimeState: 'CANCELED', departureDelaySeconds: 900 }), {
    coverage: coverage('applied'),
    now: NOW,
    checkedAt: NOW,
  });
  assert.equal(status.state, 'cancelled');
});

// --- classifyLeg: feed coverage ----------------------------------------------

test('no live feed for the agency reads as scheduled-only', () => {
  const status = classifyLeg(leg(), { coverage: coverage('none'), now: NOW, checkedAt: NOW });
  assert.equal(status.state, 'scheduled-only');
  assert.equal(status.basis, 'scheduled');
});

test('missing coverage altogether also reads as scheduled-only', () => {
  const status = classifyLeg(leg(), { now: NOW, checkedAt: NOW });
  assert.equal(status.state, 'scheduled-only');
});

test('a published-but-unjoinable feed reads as live-unmatched', () => {
  const status = classifyLeg(leg(), { coverage: coverage('published-unjoinable'), now: NOW, checkedAt: NOW });
  assert.equal(status.state, 'live-unmatched');
});

test('a shadow-matched feed also reads as live-unmatched', () => {
  const status = classifyLeg(leg(), { coverage: coverage('shadow'), now: NOW, checkedAt: NOW });
  assert.equal(status.state, 'live-unmatched');
});

test('an applied feed that never actually updated this leg reads as live-unmatched', () => {
  const status = classifyLeg(leg({ realtime: false, realtimeState: 'SCHEDULED' }), {
    coverage: coverage('applied'),
    now: NOW,
    checkedAt: NOW,
  });
  assert.equal(status.state, 'live-unmatched');
});

test('an applied feed with an updated leg is classified by its actual delay', () => {
  const status = classifyLeg(leg({ departureDelaySeconds: 200 }), {
    coverage: coverage('applied'),
    now: NOW,
    checkedAt: NOW,
  });
  assert.equal(status.state, 'late');
  assert.equal(status.tier, 'late');
  assert.equal(status.delaySeconds, 200);
  assert.equal(status.delayMinutes, 3);
  assert.equal(status.basis, 'estimated');
});

// --- classifyLeg: staleness ---------------------------------------------------

test('a check older than the staleness window reports stale but keeps the last delay', () => {
  const checkedAt = NOW - 5 * 60 * 1000; // five minutes old, well past the two-minute window
  const status = classifyLeg(leg({ departureDelaySeconds: 200 }), {
    coverage: coverage('applied'),
    now: NOW,
    checkedAt,
  });
  assert.equal(status.state, 'stale');
  assert.equal(status.delaySeconds, 200);
  assert.equal(status.delayMinutes, 3);
  assert.equal(status.tier, 'late');
});

test('a check inside the staleness window is classified normally', () => {
  const checkedAt = NOW - 30_000; // thirty seconds old
  const status = classifyLeg(leg({ departureDelaySeconds: 200 }), {
    coverage: coverage('applied'),
    now: NOW,
    checkedAt,
  });
  assert.equal(status.state, 'late');
});

// --- classifyLeg: boarding vs alighting ---------------------------------------

test('the boarding edge reads the departure delay and the alighting edge reads the arrival delay', () => {
  const options = { coverage: coverage('applied'), now: NOW, checkedAt: NOW };
  const twoSided = leg({ departureDelaySeconds: 10, arrivalDelaySeconds: 400 });

  const boarding = classifyLeg(twoSided, { ...options, edge: 'boarding' });
  assert.equal(boarding.delaySeconds, 10);
  assert.equal(boarding.state, 'on-time');

  const alighting = classifyLeg(twoSided, { ...options, edge: 'alighting' });
  assert.equal(alighting.delaySeconds, 400);
  assert.equal(alighting.state, 'late');
  assert.equal(alighting.tier, 'very-late');
});

// --- classifyLeg: derived delay ------------------------------------------------

test('an absent delay field is derived from the actual and scheduled times of the leg', () => {
  const options = { coverage: coverage('applied'), now: NOW, checkedAt: NOW };

  const derivedBoarding = classifyLeg(
    leg({
      departureDelaySeconds: undefined,
      arrivalDelaySeconds: undefined,
      startTime: '2026-09-09T12:05:00.000Z',
      scheduledStartTime: '2026-09-09T12:03:30.000Z',
    }),
    options,
  );
  assert.equal(derivedBoarding.delaySeconds, 90);
  assert.equal(derivedBoarding.basis, 'estimated');
  assert.equal(derivedBoarding.state, 'on-time');

  const derivedAlighting = classifyLeg(
    leg({
      departureDelaySeconds: undefined,
      arrivalDelaySeconds: undefined,
      endTime: '2026-09-09T12:25:00.000Z',
      scheduledEndTime: '2026-09-09T12:20:00.000Z',
    }),
    { ...options, edge: 'alighting' },
  );
  assert.equal(derivedAlighting.delaySeconds, 300);
  assert.equal(derivedAlighting.state, 'late');
  assert.equal(derivedAlighting.tier, 'very-late');
});

test('with no delay field and no parseable time pair, the leg falls back to unknown', () => {
  const status = classifyLeg(
    leg({
      departureDelaySeconds: undefined,
      arrivalDelaySeconds: undefined,
      startTime: undefined,
      scheduledStartTime: undefined,
    }),
    { coverage: coverage('applied'), now: NOW, checkedAt: NOW },
  );
  assert.equal(status.delaySeconds, null);
  assert.equal(status.basis, 'none');
  assert.equal(status.state, 'unknown');
});

// --- classifyStop ----------------------------------------------------------------

const stop = (overrides = {}) => ({
  arrival: { scheduledTime: '2026-09-09T12:10:00.000Z', estimatedTime: '2026-09-09T12:12:00.000Z' },
  ...overrides,
});

test('classifyStop reads scheduled-only when the trip has no live match', () => {
  const status = classifyStop(stop(), { now: NOW, checkedAt: NOW, live: false });
  assert.equal(status.state, 'scheduled-only');
  assert.equal(status.basis, 'scheduled');
});

test('classifyStop trusts a published delaySeconds directly', () => {
  const status = classifyStop(
    { arrival: { scheduledTime: '2026-09-09T12:10:00.000Z', estimatedTime: '2026-09-09T12:10:00.000Z', delaySeconds: 200 } },
    { now: NOW, checkedAt: NOW, live: true },
  );
  assert.equal(status.delaySeconds, 200);
  assert.equal(status.basis, 'estimated');
  assert.equal(status.state, 'late');
});

test('classifyStop derives the delay from the estimate and the schedule when none is published', () => {
  const status = classifyStop(stop(), { now: NOW, checkedAt: NOW, live: true });
  assert.equal(status.delaySeconds, 120);
  assert.equal(status.basis, 'estimated');
  assert.equal(status.state, 'on-time');
});

test('classifyStop reads the departure edge when asked for it', () => {
  const status = classifyStop(
    { departure: { scheduledTime: '2026-09-09T12:10:00.000Z', estimatedTime: '2026-09-09T12:16:00.000Z' } },
    { now: NOW, checkedAt: NOW, live: true, edge: 'departure' },
  );
  assert.equal(status.delaySeconds, 360);
  assert.equal(status.state, 'late');
  assert.equal(status.tier, 'very-late');
});

// --- summariseJourney ---------------------------------------------------------

const statusFixture = (state, delayMinutesValue = null) => ({
  state,
  delaySeconds: delayMinutesValue === null ? null : delayMinutesValue * 60,
  delayMinutes: delayMinutesValue,
  basis: 'estimated',
  checkedAt: NOW,
  source: 'plan',
});

test('summariseJourney lets a cancelled leg outrank every other state', () => {
  const summary = summariseJourney([statusFixture('on-time'), statusFixture('cancelled'), statusFixture('late', 20)]);
  assert.equal(summary.state, 'cancelled');
});

test('summariseJourney reports the largest delay among several late legs', () => {
  const summary = summariseJourney([statusFixture('late', 5), statusFixture('late', 12), statusFixture('on-time')]);
  assert.equal(summary.state, 'late');
  assert.equal(summary.worstDelayMinutes, 12);
});

test('summariseJourney ranks early ahead of on-time', () => {
  const summary = summariseJourney([statusFixture('on-time'), statusFixture('early', -3)]);
  assert.equal(summary.state, 'early');
  assert.equal(summary.worstDelayMinutes, -3);
});

test('summariseJourney falls back to unknown when nothing is known', () => {
  const summary = summariseJourney([]);
  assert.equal(summary.state, 'unknown');
  assert.equal(summary.worstDelayMinutes, null);
  assert.deepEqual(summary.agencies, []);
});

test('summariseJourney de-duplicates agencies while keeping first-seen order', () => {
  const summary = summariseJourney([], ['TTC', 'GO', 'TTC', null, '', 'MiWay', undefined, 'GO']);
  assert.deepEqual(summary.agencies, ['TTC', 'GO', 'MiWay']);
});

// --- describeState -------------------------------------------------------------

test('describeState gives the fixed-text states in both languages', () => {
  assert.deepEqual(describeState('on-time', 0), { en: 'On time', zh: '準時' });
  assert.deepEqual(describeState('cancelled', null), { en: 'Cancelled', zh: '已取消' });
  assert.deepEqual(describeState('scheduled-only', null), { en: 'Timetable only', zh: '只有時間表' });
  assert.deepEqual(describeState('live-unmatched', null), {
    en: 'Live data not matched to this trip',
    zh: '即時資料未能對應此班次',
  });
  assert.deepEqual(describeState('stale', 4), { en: 'Last live check is stale', zh: '即時資料已過時' });
  assert.deepEqual(describeState('unknown', null), { en: 'No time information', zh: '沒有時間資料' });
});

test('describeState reports late and early minutes, falling back when the count is unknown', () => {
  assert.deepEqual(describeState('late', 7), { en: '7 min late', zh: '遲 7 分鐘' });
  assert.deepEqual(describeState('early', -4), { en: '4 min early', zh: '早 4 分鐘' });
  assert.deepEqual(describeState('late', null), { en: 'Running late', zh: '遲咗' });
  assert.deepEqual(describeState('early', null), { en: 'Running early', zh: '早咗' });
});

// --- LIVE_STATES / STATE_ICONS / STATE_CLASS ------------------------------------

test('LIVE_STATES lists every state exactly once, and STATE_ICONS/STATE_CLASS cover all of them', () => {
  assert.equal(LIVE_STATES.length, 8);
  assert.equal(new Set(LIVE_STATES).size, 8);
  for (const state of LIVE_STATES) {
    assert.equal(typeof STATE_ICONS[state], 'string');
    assert.equal(STATE_CLASS[state], `live-status--${state}`);
  }
});
