import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('../lib/map-tiles.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const first = 'a'.repeat(64), second = 'b'.repeat(64);
const settle = () => new Promise(resolve => setImmediate(resolve));

test('Both maps can refresh their tile URL when the actual dataset revision changes', async () => {
  let revision = first, poll, cleared = false, removed = false;
  const urls = [], errors = [], requests = [];
  const layer = { on() { return this; }, addTo() { return this; }, setUrl(url) { urls.push(url); }, remove() { removed = true; } };
  const exports = {};
  vm.runInNewContext(compiled, { exports, AbortController, setTimeout, clearTimeout,
    setInterval(fn) { poll = fn; return 1; }, clearInterval() { cleared = true; },
    async fetch(url, options) { requests.push({ url, cache: options.cache }); return { ok: true, async json() { return { revision }; } }; },
  });
  const stop = exports.attachMapTiles({ tileLayer(url) { urls.push(url); return layer; } }, {}, failed => errors.push(failed));
  await settle();
  assert.equal(urls[0], `/tiles/${first}/{z}/{x}/{y}.png`);
  poll(); await settle(); assert.equal(urls.length, 1);
  revision = second; poll(); await settle();
  assert.equal(urls[1], `/tiles/${second}/{z}/{x}/{y}.png`);
  revision = '../invalid'; poll(); await settle();
  assert.equal(urls.length, 2); assert.equal(errors.at(-1), true);
  assert.ok(requests.every(request => request.url === '/api/map-info' && request.cache === 'no-store'));
  stop(); assert.equal(cleared, true); assert.equal(removed, true);
  poll(); await settle(); assert.equal(requests.length, 4);
});

test('Unmount aborts the revision request and a late response cannot add a tile layer', async () => {
  let finish, signal, added = false;
  const exports = {};
  vm.runInNewContext(compiled, { exports, AbortController, setTimeout, clearTimeout, setInterval() { return 1; }, clearInterval() {},
    fetch(_, options) { signal = options.signal; return new Promise(resolve => { finish = resolve; }); },
  });
  const stop = exports.attachMapTiles({ tileLayer() { added = true; } }, {}, () => {});
  stop(); assert.equal(signal.aborted, true);
  finish({ ok: true, async json() { return { revision: first }; } });
  await settle(); assert.equal(added, false);
});
