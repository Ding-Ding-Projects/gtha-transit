import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXPECTED_STATION_COUNTS, RAPID_TRANSIT_ROUTES,
  rapidTransitStationsFromIndexes, stationNameFromPlatform,
} from '../backend/rapid-transit-stations.mjs';

/**
 * The station list decides what a speed run asks somebody to do. A list that is
 * one station short is a run nobody can finish and a leaderboard that means
 * nothing, so the derivation is checked rather than trusted.
 *
 * These use the real naming shapes from the TTC feed, including the one station
 * on the network whose name does not contain the word "Station".
 */

test('a platform name resolves to the station it belongs to', () => {
  assert.equal(stationNameFromPlatform('St Clair Station - Southbound Platform'), 'St Clair Station');
  assert.equal(stationNameFromPlatform('Eglinton Station Eastbound Platform'), 'Eglinton Station');
  assert.equal(stationNameFromPlatform('Humber College Station LRT Platform'), 'Humber College Station');
  // The long one: Union names its platforms by where the train is going.
  assert.equal(
    stationNameFromPlatform('Union Station - Northbound Platform Towards Vaughan Metropolitan Centre'),
    'Union Station',
  );
  // A station whose name contains "Station" mid-name keeps the whole prefix.
  assert.equal(stationNameFromPlatform('Sheppard-Yonge Station - Eastbound Platform'), 'Sheppard-Yonge Station');
});

test('the one station with no "Station" in its name still resolves', () => {
  // York University is the exception on the current network. Without this branch
  // its two platforms would count as two stations and Line 1 would ask for 39.
  assert.equal(stationNameFromPlatform('York University - Northbound Platform'), 'York University');
  assert.equal(stationNameFromPlatform('York University - Southbound Platform'), 'York University');
});

test('nothing usable resolves to nothing rather than to a guess', () => {
  assert.equal(stationNameFromPlatform(''), null);
  assert.equal(stationNameFromPlatform('   '), null);
  assert.equal(stationNameFromPlatform(null), null);
  assert.equal(stationNameFromPlatform(42), null);
});

const patterns = {
  routePatterns: {
    'ttc:4': [
      { id: 'a', stops: [
        { name: 'Sheppard-Yonge Station - Eastbound Platform', lat: 43.76, lon: -79.41, sequence: 1 },
        { name: 'Bayview Station - Eastbound Platform', lat: 43.767, lon: -79.387, sequence: 2 },
        { name: 'Bessarion Station - Eastbound Platform', lat: 43.769, lon: -79.376, sequence: 3 },
        { name: 'Leslie Station - Eastbound Platform', lat: 43.771, lon: -79.366, sequence: 4 },
        { name: 'Don Mills Station - Eastbound Platform', lat: 43.775, lon: -79.346, sequence: 5 },
      ] },
      // A short turn, which must not decide where the line starts.
      { id: 'b', stops: [
        { name: 'Leslie Station - Westbound Platform', lat: 43.771, lon: -79.367, sequence: 1 },
        { name: 'Bayview Station - Westbound Platform', lat: 43.767, lon: -79.388, sequence: 2 },
      ] },
    ],
  },
};

test('the order comes from the longest pattern, not from a short turn', () => {
  const result = rapidTransitStationsFromIndexes(patterns, { routes: ['ttc:4'] });
  assert.deepEqual(
    result.lines[0].stations.map((station) => station.name),
    ['Sheppard-Yonge Station', 'Bayview Station', 'Bessarion Station', 'Leslie Station', 'Don Mills Station'],
  );
  assert.equal(result.lines[0].matchesPublished, true, 'Line 4 has five stations');
});

test('a station is placed at the middle of its platforms, not at one side', () => {
  const result = rapidTransitStationsFromIndexes(patterns, { routes: ['ttc:4'] });
  const bayview = result.lines[0].stations.find((station) => station.name === 'Bayview Station');
  // Eastbound -79.387 and westbound -79.388 average to the station between them.
  assert.equal(bayview.lon, -79.3875);
  assert.equal(bayview.lat, 43.767);
});

test('a station only on a secondary pattern is still included', () => {
  const withExtra = {
    routePatterns: {
      'ttc:4': [
        patterns.routePatterns['ttc:4'][0],
        { id: 'c', stops: [{ name: 'Somewhere Else Station - Westbound Platform', lat: 43.7, lon: -79.3 }] },
      ],
    },
  };
  const result = rapidTransitStationsFromIndexes(withExtra, { routes: ['ttc:4'] });
  const names = result.lines[0].stations.map((station) => station.name);
  assert.ok(names.includes('Somewhere Else Station'), 'a station on another pattern was dropped');
  // It goes last rather than being inserted into an order it does not belong to.
  assert.equal(names[names.length - 1], 'Somewhere Else Station');
});

test('a count that disagrees with the published network is reported, not hidden', () => {
  const short = { routePatterns: { 'ttc:4': [{ id: 'a', stops: [{ name: 'Leslie Station - Eastbound Platform' }] }] } };
  const result = rapidTransitStationsFromIndexes(short, { routes: ['ttc:4'] });
  assert.equal(result.lines[0].matchesPublished, false);
  assert.equal(result.matchesPublished, false);
  assert.deepEqual(result.mismatchedRoutes, ['ttc:4']);
});

test('a route missing from the index says so rather than reporting an empty line', () => {
  const result = rapidTransitStationsFromIndexes({ routePatterns: {} }, { routes: ['ttc:1'] });
  assert.equal(result.lines[0].reason, 'route-not-in-index');
  assert.deepEqual(result.lines[0].stations, []);
  assert.equal(result.matchesPublished, false);
});

test('an interchange is counted once and knows both its lines', () => {
  const twoLines = {
    routePatterns: {
      'ttc:1': [{ id: 'a', stops: [{ name: 'Spadina Station - Southbound Platform', lat: 43.667, lon: -79.404 }] }],
      'ttc:2': [{ id: 'b', stops: [{ name: 'Spadina Station - Eastbound Platform', lat: 43.667, lon: -79.404 }] }],
    },
  };
  const result = rapidTransitStationsFromIndexes(twoLines, { routes: ['ttc:1', 'ttc:2'] });
  assert.equal(result.totalStations, 1, 'the interchange was counted twice');
  assert.deepEqual(result.interchanges, ['Spadina Station']);
  assert.deepEqual(result.stations[0].routes, ['ttc:1', 'ttc:2']);
});

test('the routes and published counts are stated, so a change in the network shows', () => {
  assert.deepEqual(RAPID_TRANSIT_ROUTES, ['ttc:1', 'ttc:2', 'ttc:4', 'ttc:5', 'ttc:6']);
  assert.deepEqual(EXPECTED_STATION_COUNTS, { 'ttc:1': 38, 'ttc:2': 31, 'ttc:4': 5, 'ttc:5': 25, 'ttc:6': 18 });
  // 110 across the network, which is the sum less the seven interchanges counted twice.
  const total = Object.values(EXPECTED_STATION_COUNTS).reduce((sum, count) => sum + count, 0);
  assert.equal(total, 117);
});
