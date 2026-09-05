import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = readFileSync(new URL('../components/washroom-detour-panel.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
const context = vm.createContext({ exports, require: createRequire(import.meta.url) });
vm.runInContext(compiled, context);
const Panel = exports.WashroomDetourPanel;
const request = exports.washroomDetourRequest;
const deadline = exports.WASHROOM_CLIENT_DEADLINE_MS;
const t = (english) => english;
const destinations = [
  { id: 'home', name: 'Home', lat: 43.7, lon: -79.4 },
  { id: 'work', name: 'Work', lat: 43.71, lon: -79.39 },
];

test('builds ordered continuation requests and facility-only requests without mutating destinations', () => {
  const position = { lat: 43.68, lon: -79.38 };
  const full = request(position, destinations, '2026-09-08T12:00:00.000Z');
  assert.deepEqual(JSON.parse(JSON.stringify(full)), { currentPosition: position, dateTime: '2026-09-08T12:00:00.000Z', to: destinations[1], via: [destinations[0]] });
  assert.deepEqual(JSON.parse(JSON.stringify(request(position, [], '2026-09-08T12:00:00.000Z'))), { currentPosition: position, dateTime: '2026-09-08T12:00:00.000Z', facilityOnly: true });
  assert.deepEqual(destinations.map((place) => place.id), ['home', 'work']);
  assert.equal(deadline, 35_000);
});

test('renders an accessible 320px seam without inventing a position search field', () => {
  const html = renderToStaticMarkup(React.createElement(Panel, { position: { lat: 43.68, lon: -79.38 }, destinations, t, onClose() {}, onFollow() {} }));
  assert.match(html, /class="washroom-detour-panel"/);
  assert.match(html, /washroom-detour-panel__position/);
  assert.match(html, /washroom-detour-panel__destinations/);
  assert.match(source, /washroom-detour-panel__leg/);
  assert.match(source, /washroom-detour-panel__continuation/);
  assert.match(html, /Remaining destinations/);
  assert.match(html, /Plan facility and continuation/);
  assert.doesNotMatch(source, /type=['"]search['"]|SearchWorkbench/);
  assert.match(source, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(source, /AbortController/);
  assert.match(source, /busy \|\| controllerRef\.current/);
  assert.match(source, /WASHROOM_CLIENT_DEADLINE_MS/);
  assert.match(source, /\/api\/plan-washroom-detour/);
  assert.match(source, /Complete facility and continuation plan/);
  assert.match(source, /Partial plan: facility route only/);
});

test('shows an explicit facility-only empty continuation state', () => {
  const html = renderToStaticMarkup(React.createElement(Panel, { destinations: [], t, onClose() {}, onFollow() {} }));
  assert.match(html, /No onward destination is selected/);
  assert.match(html, /Location is requested only after you choose this action/);
  assert.match(html, /disabled=""/);
});
