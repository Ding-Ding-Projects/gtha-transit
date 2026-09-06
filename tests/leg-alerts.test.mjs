import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectLegAlerts, alertKind, alertSubject, stationName } from '../lib/leg-alerts.ts';

/**
 * Shapes below are copied from the real TTC website alert feed observed on
 * 2026-09-06 through the deployed /api/status/ttc endpoint. Facility notices
 * arrive on the same per-line list as service alerts and are distinguished only
 * by the publisher own routeType and title subject.
 */
const line5Delay = {
  id: '75679',
  title: 'Line 5 Eglinton: Delays westbound at Don Valley station due to a track intrusion alarm.',
  description: 'Delays westbound at Don Valley station due to a track intrusion alarm.',
  routeIds: ['5'],
  routeRefs: [{ routeId: '5', routeType: 'Subway' }],
  routeScope: 'routes',
  activeFrom: '2026-09-06T01:15:08.100Z',
};
const kennedyEscalator = {
  id: '75651',
  title: 'Kennedy: Escalator 16D2E out of service from Line 2 platform to concourse while we perform maintenance.',
  description: 'from Line 2 platform to concourse',
  routeIds: ['2', '5'],
  routeRefs: [{ routeId: '2', routeType: 'Escalator' }, { routeId: '5', routeType: 'Escalator' }],
  routeScope: 'routes',
  activeFrom: '2026-09-01T00:00:00.000Z',
};
const keelesdaleEscalator = {
  id: '75652',
  title: 'Keelesdale: Escalator 6 out of service between mid-level and grade while we perform maintenance.',
  description: 'between mid-level and grade',
  routeIds: ['5'],
  routeRefs: [{ routeId: '5', routeType: 'Escalator' }],
  routeScope: 'routes',
  activeFrom: '2026-09-01T00:00:00.000Z',
};
const networkNotice = {
  id: '90001',
  title: 'TTC: Reduced overnight service across the network.',
  description: 'Reduced overnight service.',
  routeIds: [],
  routeRefs: [{ routeId: '', routeType: 'Subway' }],
  routeScope: 'network',
};

/** Eglinton to Kennedy on Line 5, exactly as the routing API returned it. */
const line5Leg = {
  mode: 'TRAM',
  route: '5',
  agency: 'TTC',
  from: { name: 'Eglinton Station - Eastbound Platform' },
  to: { name: 'Kennedy Station - Subway Platform' },
  intermediateStops: [
    { name: 'Leaside Station - Eastbound Platform' },
    { name: 'Golden Mile Station - Eastbound Platform' },
    { name: 'Ionview Station - Eastbound Platform' },
  ],
  startTime: '2026-09-06T09:05:44-04:00',
  endTime: '2026-09-06T09:36:44-04:00',
};

test('a facility notice for a station the leg never calls at is not shown beside the leg', () => {
  assert.deepEqual(selectLegAlerts({ alerts: [keelesdaleEscalator], leg: line5Leg }), []);
});

test('a facility notice for a station on the leg is shown and labelled as a facility', () => {
  const selected = selectLegAlerts({ alerts: [kennedyEscalator], leg: line5Leg });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].kind, 'facility');
  assert.equal(selected[0].station, 'kennedy');
  assert.equal(selected[0].alert.title, kennedyEscalator.title);
});

test('every matching alert is returned, not only the first entry of a line', () => {
  const selected = selectLegAlerts({
    alerts: [keelesdaleEscalator, kennedyEscalator, line5Delay],
    leg: line5Leg,
  });
  assert.deepEqual(selected.map((entry) => entry.alert.id), ['75651', '75679']);
  assert.deepEqual(selected.map((entry) => entry.kind), ['facility', 'service']);
});

test('a service alert on the leg route is shown without needing a station match', () => {
  const selected = selectLegAlerts({ alerts: [line5Delay], leg: line5Leg });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].kind, 'service');
  assert.equal(selected[0].station, undefined);
});

test('an alert scoped to another route is never attached to this leg', () => {
  const busDetour = {
    id: '75672',
    title: '83 Jones: Detour via Danforth Ave due to a collision.',
    description: 'Detour via Danforth Ave.',
    routeIds: ['83'],
    routeRefs: [{ routeId: '83', routeType: 'Bus' }],
    routeScope: 'routes',
  };
  assert.deepEqual(selectLegAlerts({ alerts: [busDetour], leg: line5Leg }), []);
});

test('a network-scoped alert reaches every TTC transit leg as a service alert', () => {
  const selected = selectLegAlerts({ alerts: [networkNotice], leg: line5Leg });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].kind, 'service');
});

test('an alert whose active window ended before the leg is not shown', () => {
  const expired = { ...line5Delay, id: 'expired', activeTo: '2026-09-06T08:00:00-04:00' };
  assert.deepEqual(selectLegAlerts({ alerts: [expired], leg: line5Leg }), []);
});

test('an alert starting after the leg finishes is not shown', () => {
  const later = { ...line5Delay, id: 'later', activeFrom: '2026-09-06T20:00:00-04:00' };
  assert.deepEqual(selectLegAlerts({ alerts: [later], leg: line5Leg }), []);
});

test('an alert overlapping only part of the leg window is still shown', () => {
  const overlapping = {
    ...line5Delay,
    id: 'overlapping',
    activeFrom: '2026-09-06T09:30:00-04:00',
    activeTo: '2026-09-06T11:00:00-04:00',
  };
  assert.equal(selectLegAlerts({ alerts: [overlapping], leg: line5Leg }).length, 1);
});

test('walking legs and non-TTC legs receive no TTC alerts', () => {
  const walk = { ...line5Leg, mode: 'WALK', route: undefined, agency: null };
  assert.deepEqual(selectLegAlerts({ alerts: [line5Delay], leg: walk }), []);
  const goLeg = { ...line5Leg, agency: 'GO Transit' };
  assert.deepEqual(selectLegAlerts({ alerts: [line5Delay], leg: goLeg }), []);
});

test('an unpublished route type is treated as a facility notice rather than as service', () => {
  const elevator = {
    ...kennedyEscalator,
    id: 'elevator',
    title: 'Kennedy: Elevator out of service between concourse and platform.',
    routeRefs: [{ routeId: '5', routeType: 'Elevator' }],
  };
  assert.equal(alertKind(elevator, '5'), 'facility');
  const selected = selectLegAlerts({ alerts: [elevator], leg: line5Leg });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].kind, 'facility');
});

test('station names are read from published stop names and alert subjects only', () => {
  assert.equal(stationName('Kennedy Station - Subway Platform'), 'kennedy');
  assert.equal(stationName('Aga Khan Park & Museum Station - Eastbound Platform'), 'aga khan park & museum');
  assert.equal(stationName('Yonge St at Bloor St East'), 'yonge st at bloor st east');
  assert.equal(stationName(undefined), '');
  assert.equal(alertSubject(kennedyEscalator.title), 'kennedy');
  assert.equal(alertSubject('No colon in this title'), '');
});

test('the same alert is never attached twice to one leg', () => {
  assert.equal(selectLegAlerts({ alerts: [line5Delay, line5Delay], leg: line5Leg }).length, 1);
});
