import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { createHistoryStore } from '../history/store.mjs';

const snap = (fetchedAt, alerts, extra = {}) => ({ state: 'live', fetchedAt, sourceUrl: 'https://source.test/alerts', alerts, lines: [{ id: '1', alerts }] , ...extra });
const alert = (id, title = 'Signal issue') => ({ id, title, description: 'Details', url: 'https://ttc.ca/a', updatedAt: '2026-09-04T12:00:00Z', lines: ['1'] });
async function cleanup(directory) { for (let i = 0; i < 8; i++) { try { await rm(directory, { recursive: true, force: true }); return; } catch (error) { if (error.code !== 'EBUSY') throw error; await pause(25); } } }

test('history persists, deduplicates unchanged payloads and appends changed versions', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'gtha-history-'));
  try {
    let store = createHistoryStore({ directory });
    store.observe(snap('2026-09-04T12:00:00Z', [alert('a')]));
    store.observe(snap('2026-09-04T12:01:00Z', [alert('a')]));
    let result = store.query(); assert.equal(result.items.length, 1); assert.equal(result.items[0].versions.length, 1); assert.equal(result.items[0].lastSeen, '2026-09-04T12:01:00.000Z');
    store.observe(snap('2026-09-04T12:02:00Z', [alert('a', 'Changed')]));
    assert.equal(store.query().items[0].versions.length, 2); store.close();
    store = createHistoryStore({ directory }); assert.equal(store.query().items[0].versions.length, 2); store.close();
  } finally { await cleanup(directory); }
});

test('only a complete live snapshot marks absence, and a reappearance starts an episode', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'gtha-history-'));
  try { const store = createHistoryStore({ directory }); store.observe(snap('2026-09-04T12:00:00Z', [alert('a'), alert('b')])); store.observe({ ...snap('2026-09-04T12:01:00Z', []), state: 'stale' }); assert.equal(store.query().items.every((x) => x.status === 'active'), true); store.observe(snap('2026-09-04T12:02:00Z', [alert('a')])); assert.equal(store.query().items.find((x) => x.alertId === 'b').status, 'no_longer_reported'); store.observe(snap('2026-09-04T12:03:00Z', [alert('b')])); const b = store.query({ q: 'b' }).items; assert.equal(b.length, 2); assert.equal(b[1].status, 'active'); assert.equal(b[1].resolvedAt, null); store.close(); } finally { await cleanup(directory); }
});

test('source changes retain prior source and filters and cursor are bounded', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'gtha-history-'));
  try { const store = createHistoryStore({ directory }); store.observe(snap('2026-09-01T12:00:00Z', [alert('a')])); store.observe(snap('2026-09-02T12:00:00Z', [alert('a')], { sourceUrl: 'https://other.test/feed' })); assert.equal(store.query().items.length, 2); assert.equal(store.query({ from: '2026-09-02', to: '2026-09-03' }).items.length, 1); const page = store.query({ limit: 1 }); assert.ok(page.nextCursor); assert.equal(store.query({ limit: 1, cursor: page.nextCursor }).items.length, 1); assert.throws(() => store.query({ limit: 1000 }), /./); assert.throws(() => store.query({ cursor: 'bad' }), /invalid/i); store.close(); } finally { await cleanup(directory); }
});
