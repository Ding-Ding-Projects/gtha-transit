import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

/**
 * The outage this endpoint exists for: a private routing origin stayed down for
 * hours while the frontend reported itself healthy, because its own health check
 * only ever answered for its own process. That contract is deliberately kept, so
 * the dependency state lives on its own route.
 */

const listen = (handler) => new Promise((resolve) => {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
});

const startWeb = (env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['server/web.mjs'], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const timer = setTimeout(() => reject(new Error('web server did not start')), 20000);
  const ready = async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${env.PORT}/health`);
        if (response.ok) { clearTimeout(timer); resolve(child); return; }
      } catch { /* not listening yet */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    reject(new Error('web server never answered /health'));
  };
  void ready();
});

test('dependencies are reported ready when both private origins answer', async () => {
  const routing = await listen((request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"ok":true}'); });
  const maps = await listen((request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"revision":"x"}'); });
  const port = 8121;
  const web = await startWeb({
    PORT: String(port),
    HISTORY_DIR: mkdtempSync(path.join(tmpdir(), 'deps-')),
    ROUTING_ORIGIN: `http://127.0.0.1:${routing.port}`,
    MAPS_ORIGIN: `http://127.0.0.1:${maps.port}`,
  });
  try {
    const payload = await (await fetch(`http://127.0.0.1:${port}/api/dependencies`)).json();
    assert.equal(payload.state, 'ready');
    assert.deepEqual(payload.dependencies.map((entry) => entry.name).sort(), ['maps', 'routing']);
    assert.equal(payload.dependencies.every((entry) => entry.state === 'available'), true);
    // The process check keeps its own contract and stays 200.
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
  } finally {
    web.kill('SIGKILL');
    routing.server.close();
    maps.server.close();
  }
});

test('an unreachable routing origin is reported degraded, and health stays 200', async () => {
  const maps = await listen((request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"revision":"x"}'); });
  const port = 8122;
  const web = await startWeb({
    PORT: String(port),
    HISTORY_DIR: mkdtempSync(path.join(tmpdir(), 'deps-')),
    // Nothing is listening here, exactly as during the outage.
    ROUTING_ORIGIN: 'http://127.0.0.1:9',
    MAPS_ORIGIN: `http://127.0.0.1:${maps.port}`,
  });
  try {
    const payload = await (await fetch(`http://127.0.0.1:${port}/api/dependencies`)).json();
    assert.equal(payload.state, 'degraded');
    const routingEntry = payload.dependencies.find((entry) => entry.name === 'routing');
    assert.equal(routingEntry.state, 'unreachable');
    assert.match(payload.note, /did not answer/);
    // A frontend that is working is not restarted because a private origin is not.
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
  } finally {
    web.kill('SIGKILL');
    maps.server.close();
  }
});
