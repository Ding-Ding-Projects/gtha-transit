import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTripStopTimeline,
  createBrowserLocationWatch,
  estimatePreviewStopFromPosition,
  exactReportedVehicle,
  previewTimelineStop,
  publisherNextStopId,
  reportedPositionState,
} from '../lib/trip-progress.ts';

const stop = (id, name, lat, lon) => ({ id, name, lat, lon });

test('builds a published stop sequence across interleaved transit and walking legs', () => {
  const timeline = buildTripStopTimeline({
    legs: [
      {
        mode: 'BUS',
        from: stop('A', 'Alpha', 43.61, -79.41),
        intermediateStops: [
          stop('B', 'Bravo', 43.62, -79.42),
          stop('B', 'Bravo', 43.62, -79.42),
        ],
        to: stop('C', 'Charlie', 43.63, -79.43),
      },
      {
        mode: 'WALK',
        from: stop('C', 'Charlie', 43.63, -79.43),
        to: stop('D', 'Delta', 43.64, -79.44),
      },
      {
        mode: 'RAIL',
        from: stop('D', 'Delta', 43.64, -79.44),
        intermediateStops: [stop('E', 'Echo', 43.65, -79.45)],
        to: stop('F', 'Foxtrot', 43.66, -79.46),
      },
    ],
  });

  assert.deepEqual(
    timeline.stops.map((entry) => entry.place.id),
    ['A', 'B', 'C', 'D', 'E', 'F'],
  );
  assert.deepEqual(timeline.legBoundaries, [
    { legIndex: 0, fromIndex: 0, toIndex: 2 },
    { legIndex: 2, fromIndex: 3, toIndex: 5 },
  ]);
  assert.equal(timeline.stops[1].references.length, 2);
});

test('keeps reversed published stop order instead of sorting it into a made-up direction', () => {
  const timeline = buildTripStopTimeline({
    legs: [
      {
        mode: 'RAIL',
        from: stop('north', 'Northbound origin', 43.72, -79.31),
        intermediateStops: [stop('middle', 'Middle', 43.71, -79.31)],
        to: stop('south', 'Southbound destination', 43.7, -79.31),
      },
    ],
  });

  assert.deepEqual(
    timeline.stops.map((entry) => entry.place.id),
    ['north', 'middle', 'south'],
  );
});

test('deduplicates an exact physical transfer stop without erasing its leg boundaries', () => {
  const shared = stop('X', 'Interchange', 43.7, -79.4);
  const timeline = buildTripStopTimeline({
    legs: [
      { mode: 'BUS', from: stop('A', 'Alpha', 43.69, -79.4), to: shared },
      { mode: 'RAIL', from: { ...shared }, to: stop('B', 'Bravo', 43.71, -79.4) },
    ],
  });

  assert.deepEqual(
    timeline.stops.map((entry) => entry.place.id),
    ['A', 'X', 'B'],
  );
  assert.equal(timeline.stops[1].transfer, true);
  assert.deepEqual(timeline.stops[1].startsLegs, [1]);
  assert.deepEqual(timeline.stops[1].endsLegs, [0]);
  assert.deepEqual(timeline.stops[1].references, [
    { legIndex: 0, source: 'to' },
    { legIndex: 1, source: 'from' },
  ]);
  assert.deepEqual(timeline.legBoundaries, [
    { legIndex: 0, fromIndex: 0, toIndex: 1 },
    { legIndex: 1, fromIndex: 1, toIndex: 2 },
  ]);
});

test('marks stale, missing, and future vehicle observations without treating them as fresh', () => {
  const observed = 1_700_000_000_000;
  assert.equal(reportedPositionState({ timestamp: observed }, observed + 119_999), 'fresh');
  assert.equal(reportedPositionState({ timestamp: observed }, observed + 120_001), 'stale');
  assert.equal(reportedPositionState({ timestamp: observed, stale: true }, observed + 1), 'stale');
  assert.equal(reportedPositionState({}, observed), 'unavailable');
  assert.equal(reportedPositionState({ timestamp: observed + 31_000 }, observed), 'unavailable');
});

test('rejects a route-only vehicle match and accepts only an exact agency plus vehicle identity', () => {
  const candidates = [
    { id: 'wrong-vehicle', agencyId: 'ttc', routeId: '501' },
    { id: 'same-number', agencyId: 'go', routeId: '501' },
  ];
  const expected = { id: 'same-number', agencyId: 'ttc', routeId: '501' };

  assert.equal(exactReportedVehicle(candidates, expected), null);
  const exact = exactReportedVehicle(
    [...candidates, { id: 'same-number', agencyId: 'ttc', routeId: '999' }],
    expected,
  );
  assert.deepEqual(exact, { id: 'same-number', agencyId: 'ttc', routeId: '999' });
});

test('keeps preview stops separate from live claims and requires explicit next-stop metadata', () => {
  const timeline = buildTripStopTimeline({
    legs: [
      {
        mode: 'BUS',
        from: stop('A', 'Alpha', 43.61, -79.41),
        to: stop('B', 'Bravo', 43.62, -79.42),
      },
    ],
  });

  assert.equal(previewTimelineStop(timeline, 1)?.place.id, 'B');
  assert.equal(previewTimelineStop(timeline, -1), null);
  assert.equal(previewTimelineStop(timeline, 4), null);
  assert.equal(publisherNextStopId({ routeId: '501' }), null);
  assert.equal(publisherNextStopId({ stopId: 'B', stopStatus: 'current' }), null);
  assert.equal(publisherNextStopId({ stopId: 'B', stopStatus: 'next' }), 'B');
});

test('starts and stops browser location watches only through the explicit controller lifecycle', () => {
  const watches = [];
  const cleared = [];
  const browser = {
    watchPosition(onPosition, onError, options) {
      watches.push({ onPosition, onError, options });
      return 42;
    },
    clearWatch(id) {
      cleared.push(id);
    },
  };
  const received = [];
  let errors = 0;
  const watcher = createBrowserLocationWatch(browser, (position) => received.push(position), () => {
    errors += 1;
  });

  assert.equal(watcher.active, false);
  assert.equal(watches.length, 0);
  assert.equal(watcher.start(), true);
  assert.equal(watcher.start(), false);
  assert.equal(watcher.active, true);
  assert.deepEqual(watches[0].options, {
    enableHighAccuracy: false,
    maximumAge: 0,
    timeout: 10_000,
  });
  watches[0].onPosition({
    coords: { latitude: 43.65, longitude: -79.38, accuracy: 20 },
    timestamp: 1_700_000_000_000,
  });
  assert.equal(received.length, 1);
  assert.equal(watcher.stop(), true);
  assert.equal(watcher.stop(), false);
  assert.deepEqual(cleared, [42]);
  watches[0].onPosition({
    coords: { latitude: 43.66, longitude: -79.39, accuracy: 20 },
    timestamp: 1_700_000_000_100,
  });
  assert.equal(received.length, 1);
  assert.equal(watcher.start(), true);
  watches[1].onError();
  assert.equal(watcher.active, false);
  assert.equal(errors, 1);
  assert.deepEqual(cleared, [42, 42]);
});

test('advances an estimated preview only for fresh, accurate locations near published geometry', () => {
  const timeline = buildTripStopTimeline({
    legs: [
      {
        mode: 'BUS',
        from: stop('A', 'Alpha', 43.6, -79.4),
        intermediateStops: [stop('B', 'Bravo', 43.601, -79.4)],
        to: stop('C', 'Charlie', 43.602, -79.4),
      },
    ],
  });
  const now = 1_700_000_000_000;
  const closeToSegment = {
    lat: 43.6015,
    lon: -79.4,
    accuracy: 20,
    timestamp: now,
  };

  const estimate = estimatePreviewStopFromPosition(
    timeline,
    closeToSegment,
    1,
    now,
  );
  assert.equal(estimate?.nextIndex, 2);
  assert.ok(Math.abs((estimate?.progress ?? 0) - 1.5) < 0.000_001);
  assert.equal(estimate?.distanceMetres, 0);
  assert.equal(
    estimatePreviewStopFromPosition(
      timeline,
      { ...closeToSegment, lon: -79.45 },
      1,
      now,
    ),
    null,
  );
  assert.equal(
    estimatePreviewStopFromPosition(
      timeline,
      { ...closeToSegment, accuracy: 151 },
      1,
      now,
    ),
    null,
  );
  assert.equal(
    estimatePreviewStopFromPosition(
      timeline,
      { ...closeToSegment, timestamp: now - 30_001 },
      1,
      now,
    ),
    null,
  );
  assert.equal(
    estimatePreviewStopFromPosition(
      timeline,
      { ...closeToSegment, timestamp: now + 30_001 },
      1,
      now,
    ),
    null,
  );
});
