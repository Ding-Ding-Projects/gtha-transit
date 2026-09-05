import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { canChooseCatalogRoute, loadRouteCatalog, routePeriodState } from '../lib/route-catalog.ts';

const date = '2026-09-05';
const row = (routeId = '5', feedId = 'ttc') => ({ id: feedId + ':' + routeId, routeId, feedId, agency: feedId.toUpperCase(), shortName: routeId, longName: 'Published route', color: 'F58025', textColor: 'FFFFFF', validity: { serviceStart: '20260726', serviceEnd: '20260905' } });
const page = (routes, total = routes.length, nextCursor = null) => ({ routes, total, nextCursor, coverage: { date } });
const response = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

test('loads a complete paginated snapshot through real HTTP and binds it to one date', async () => {
  const requests = [];
  const server = createServer((request, reply) => {
    const url = new URL(request.url, 'http://localhost');
    requests.push(url);
    reply.setHeader('content-type', 'application/json');
    reply.end(JSON.stringify(url.searchParams.has('cursor') ? page([row('6')], 2) : page([row()], 2, 'MQ')));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const counts = [];
    const snapshot = await loadRouteCatalog(date, { signal: new AbortController().signal, fetcher: (url, init) => fetch('http://127.0.0.1:' + server.address().port + url, init), onProgress: count => counts.push(count) });
    assert.equal(snapshot.date, date);
    assert.deepEqual(snapshot.records.map(record => record.routeId), ['5', '6']);
    assert.deepEqual(counts, [1, 2]);
    assert.equal(requests.length, 2);
    for (const request of requests) { assert.equal(request.pathname, '/api/routes'); assert.equal(request.searchParams.get('date'), date); assert.equal(request.searchParams.get('limit'), '200'); }
    assert.equal(requests[1].searchParams.get('cursor'), 'MQ');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('never accepts partial data when a later page fails or changes total', async () => {
  for (const failure of [new Response('', { status: 503 }), response(page([row('6')], 3))]) {
    let calls = 0;
    await assert.rejects(loadRouteCatalog(date, { signal: new AbortController().signal, fetcher: async () => ++calls === 1 ? response(page([row()], 2, 'MQ')) : failure }), /catalog-unavailable|catalog-changed/);
    assert.equal(calls, 2);
  }
});

test('rejects malformed identities, cursors and incomplete or duplicate catalogs', async () => {
  const invalid = [page([null]), page([{ ...row(), routeId: '' }]), page([row()], 1, false), page([row()], 1, ''), page([row()], 1, 0), page([row()], 2), page([row(), row()], 2), { ...page([row()]), coverage: { date: '2026-09-06' } }];
  for (const data of invalid) await assert.rejects(loadRouteCatalog(date, { signal: new AbortController().signal, fetcher: async () => response(data) }));
  let calls = 0;
  await assert.rejects(loadRouteCatalog(date, { signal: new AbortController().signal, fetcher: async () => response(page([row(String(++calls))], 3, 'MQ')) }), /invalid-catalog-cursor/);
  assert.equal(calls, 2);
});

test('aborted work cannot return a snapshot even when the transport ignores cancellation', async () => {
  const controller = new AbortController();
  let finish;
  const pending = loadRouteCatalog(date, { signal: controller.signal, fetcher: () => new Promise(resolve => { finish = resolve; }) });
  controller.abort();
  finish(response(page([row()])));
  await assert.rejects(pending, { name: 'AbortError' });
  let called = false;
  await assert.rejects(loadRouteCatalog(date, { signal: controller.signal, fetcher: async () => { called = true; return response(page([])); } }), { name: 'AbortError' });
  assert.equal(called, false);
});

test('normalizes unavailable colors without inventing a swatch and exposes timetable boundaries', async () => {
  const result = await loadRouteCatalog(date, { signal: new AbortController().signal, fetcher: async () => response(page([{ ...row(), color: 'not-a-color', textColor: null }])) });
  assert.equal(result.records[0].color, null);
  assert.equal(result.records[0].textColor, null);
  assert.equal(routePeriodState(row(), date), 'within');
  assert.equal(routePeriodState(row(), '2026-09-06'), 'outside');
  assert.equal(routePeriodState({ ...row(), validity: {} }, date), 'unknown');
  assert.equal(routePeriodState({ ...row(), validity: { serviceEnd: '20260905' } }, date), 'unknown');
});

test('only commits real allowed routes and respects single-route mode', () => {
  const records = [row(), row('UP', 'up')];
  assert.equal(canChooseCatalogRoute(records, 'ttc', '5', ['ttc'], true), true);
  assert.equal(canChooseCatalogRoute(records, 'up', 'UP', ['ttc'], true), false);
  assert.equal(canChooseCatalogRoute(records, 'ttc', '5', [], true), false);
  assert.equal(canChooseCatalogRoute(records, 'ttc', '999', undefined, false), false);
  assert.equal(canChooseCatalogRoute(records, 'ttc', '', ['ttc'], true), false);
  assert.equal(canChooseCatalogRoute(records, 'ttc', '', ['ttc'], false), true);
  assert.equal(canChooseCatalogRoute(records, 'all', '', undefined, false), true);
  assert.equal(canChooseCatalogRoute(records, 'all', '', ['ttc'], false), false);
});

test('invalid calendar dates and periods fail before a selection can render', async () => {
  let called = false;
  await assert.rejects(loadRouteCatalog('2026-02-30', { signal: new AbortController().signal, fetcher: async () => { called = true; return response(page([])); } }), /invalid-catalog-date/);
  assert.equal(called, false);
  for (const validity of [{ serviceStart: '20260230' }, { serviceStart: '20260906', serviceEnd: '20260905' }]) {
    await assert.rejects(loadRouteCatalog(date, { signal: new AbortController().signal, fetcher: async () => response(page([{ ...row(), validity }])) }), /invalid-route-validity|invalid-route-period/);
  }
});

test('a nonterminating catalog stops at the documented fifty-page bound', async () => {
  let calls = 0;
  await assert.rejects(loadRouteCatalog(date, { signal: new AbortController().signal, fetcher: async () => {
    const offset = calls++ * 200;
    return response(page(Array.from({ length: 200 }, (_, index) => row(String(offset + index))), 10000, 'page' + calls));
  } }), /catalog-page-limit/);
  assert.equal(calls, 50);
});
