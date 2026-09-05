import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(
  readFileSync(new URL('../lib/map-tiles.ts', import.meta.url), 'utf8'),
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  },
).outputText;
const first = 'a'.repeat(64),
  second = 'b'.repeat(64);
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('Warnings reflect current failed tiles and recover without erasing other failures', async () => {
  const handlers = {},
    errors = [];
  let poll,
    available = true,
    redraws = 0;
  const layer = {
    on(name, handler) {
      handlers[name] = handler;
      return this;
    },
    addTo() {
      return this;
    },
    remove() {},
    redraw() {
      redraws++;
    },
    setUrl() {},
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval(fn) {
      poll = fn;
      return 1;
    },
    clearInterval() {},
    async fetch() {
      return {
        ok: available,
        async json() {
          return { revision: first };
        },
      };
    },
  });
  const stop = exports.attachMapTiles(
    {
      tileLayer() {
        return layer;
      },
    },
    {},
    (failed) => errors.push(failed),
  );
  await settle();
  const one = {},
    two = {};
  for (const tile of [one, two]) {
    handlers.tileloadstart({ tile });
    handlers.tileerror({ tile });
  }
  assert.equal(errors.at(-1), true);
  handlers.tileload({ tile: one });
  assert.equal(errors.at(-1), true);
  poll();
  await settle();
  assert.equal(redraws, 1);
  handlers.tileunload({ tile: two });
  assert.equal(errors.at(-1), false);
  handlers.tileerror({ tile: two });
  assert.equal(errors.at(-1), false);
  const aborted = {};
  handlers.tileloadstart({ tile: aborted });
  handlers.tileerror({ tile: aborted });
  assert.equal(errors.at(-1), true);
  handlers.tileabort({ tile: aborted });
  assert.equal(errors.at(-1), false);
  handlers.tileerror({ tile: aborted });
  assert.equal(errors.at(-1), false);
  poll(); await settle();
  assert.equal(redraws, 1);
  available = false;
  poll();
  await settle();
  assert.equal(errors.at(-1), true);
  handlers.tileload({ tile: one });
  assert.equal(errors.at(-1), true);
  available = true;
  poll();
  await settle();
  assert.equal(errors.at(-1), false);
  stop();
});

test('Both maps can refresh their tile URL when the actual dataset revision changes', async () => {
  let revision = first,
    poll,
    cleared = false,
    removed = false;
  const urls = [],
    errors = [],
    requests = [];
  const layer = {
    on() {
      return this;
    },
    addTo() {
      return this;
    },
    setUrl(url) {
      urls.push(url);
    },
    remove() {
      removed = true;
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval(fn) {
      poll = fn;
      return 1;
    },
    clearInterval() {
      cleared = true;
    },
    async fetch(url, options) {
      requests.push({ url, cache: options.cache });
      return {
        ok: true,
        async json() {
          return { revision };
        },
      };
    },
  });
  const stop = exports.attachMapTiles(
    {
      tileLayer(url) {
        urls.push(url);
        return layer;
      },
    },
    {},
    (failed) => errors.push(failed),
  );
  await settle();
  assert.equal(urls[0], `/tiles/${first}/{z}/{x}/{y}.png`);
  poll();
  await settle();
  assert.equal(urls.length, 1);
  revision = second;
  poll();
  await settle();
  assert.equal(urls[1], `/tiles/${second}/{z}/{x}/{y}.png`);
  revision = '../invalid';
  poll();
  await settle();
  assert.equal(urls.length, 2);
  assert.equal(errors.at(-1), true);
  assert.ok(
    requests.every(
      (request) =>
        request.url === '/api/map-info' && request.cache === 'no-store',
    ),
  );
  stop();
  assert.equal(cleared, true);
  assert.equal(removed, true);
  poll();
  await settle();
  assert.equal(requests.length, 4);
});

test('Unmount aborts the revision request and a late response cannot add a tile layer', async () => {
  let finish,
    signal,
    added = false;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval() {
      return 1;
    },
    clearInterval() {},
    fetch(_, options) {
      signal = options.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const stop = exports.attachMapTiles(
    {
      tileLayer() {
        added = true;
      },
    },
    {},
    () => {},
  );
  stop();
  assert.equal(signal.aborted, true);
  finish({
    ok: true,
    async json() {
      return { revision: first };
    },
  });
  await settle();
  assert.equal(added, false);
});
