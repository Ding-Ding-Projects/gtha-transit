import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { RealtimeAggregator, inspectGtfsRealtime, loadRegistry } from './aggregator.mjs';

const message = Uint8Array.from([10, 5, 10, 3, 50, 46, 48, 18, 2, 10, 0]);

test('inspects a GTFS-RT protobuf FeedMessage envelope', () => {
  assert.deepEqual(inspectGtfsRealtime(message), { gtfsRealtimeVersion: '2.0', entityCount: 1 });
});

test('registry names every requested agency and uses only explicit capability states', async () => {
  const registry = await loadRegistry();
  assert.deepEqual(registry.agencies.map(agency => agency.id), ['ttc', 'go', 'up', 'miway', 'brampton', 'yrt', 'drt', 'oakville', 'burlington', 'milton', 'hsr']);
  const staticFeeds = JSON.parse(await readFile(new URL('../data/feeds.json', import.meta.url), 'utf8'));
  assert.deepEqual(registry.agencies.map(agency => agency.id), staticFeeds.agencies.map(agency => agency.id));
});

test('aggregator validates public feeds, preserves unavailable reasons, and caches bounded probes', async () => {
  const registry = await loadRegistry(); let calls = 0; let now = 1_000;
  const fetchImpl = async () => { calls += 1; return new Response(message, { status: 200, headers: { 'content-type': 'application/x-protobuf' } }); };
  const aggregator = new RealtimeAggregator({ registry, fetchImpl, now: () => now });
  const first = await aggregator.refresh(); const second = await aggregator.refresh();
  assert.equal(first.agencies.find(agency => agency.id === 'miway').state, 'live');
  assert.equal(first.agencies.find(agency => agency.id === 'oakville').state, 'scheduled_only');
  assert.equal(first.agencies.find(agency => agency.id === 'ttc').state, 'live');
  assert.equal(first.agencies.find(agency => agency.id === 'go').state, 'unavailable');
  assert.equal(calls, 12);
  assert.equal(second.agencies.find(agency => agency.id === 'hsr').feeds.tripUpdates.cached, true);
  now += 50_000; await aggregator.refresh(); assert.equal(calls, 24);
});
