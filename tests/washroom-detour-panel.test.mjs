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
const freshPosition = exports.isFreshWashroomPosition;
const reviewDestinations = exports.reviewDestinations;
const t = (english) => english;
const destinations = [
  { id: 'home', name: 'Home', lat: 43.7, lon: -79.4 },
  { id: 'work', name: 'Work', lat: 43.71, lon: -79.39 },
];

test('builds ordered continuation requests and facility-only requests without mutating destinations', () => {
  const position = { lat: 43.68, lon: -79.38 };
  const full = request(position, destinations, '2026-09-08T12:00:00.000Z');
  assert.deepEqual(JSON.parse(JSON.stringify(full)), { currentPosition: position, dateTime: '2026-09-08T12:00:00.000Z', visitMinutes: 10, to: destinations[1], via: [destinations[0]] });
  assert.deepEqual(JSON.parse(JSON.stringify(request(position, [], '2026-09-08T12:00:00.000Z'))), { currentPosition: position, dateTime: '2026-09-08T12:00:00.000Z', visitMinutes: 10, facilityOnly: true });
  assert.deepEqual(destinations.map((place) => place.id), ['home', 'work']);
  assert.equal(deadline, 35_000);
  const enriched = request(position, [{ ...destinations[0], servingRoutes: [{ id: 'route', longName: 'x'.repeat(40000) }], washroom: { name: 'metadata' } }], '2026-09-08T12:00:00.000Z');
  assert.deepEqual(JSON.parse(JSON.stringify(enriched.to)), destinations[0]);
  assert.ok(JSON.stringify(enriched).length < 1000);
});

test('keeps duplicate place IDs in separate review rows and requires a fresh timestamp', () => {
  const rows = reviewDestinations([{ id: 'map', name: 'First', lat: 43.7, lon: -79.4 }, { id: 'map', name: 'Second', lat: 43.71, lon: -79.39 }]);
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].rowKey, rows[1].rowKey);
  assert.equal(freshPosition({ lat: 43.68, lon: -79.38, timestamp: new Date(50_000).toISOString() }, 100_000), true);
  assert.equal(freshPosition({ lat: 43.68, lon: -79.38, timestamp: new Date(39_999).toISOString() }, 100_000), false);
  assert.equal(freshPosition({ lat: 43.68, lon: -79.38 }, 100_000), false);
});

test('renders an accessible 320px seam without inventing a position search field', () => {
  const html = renderToStaticMarkup(React.createElement(Panel, { position: { lat: 43.68, lon: -79.38, timestamp: new Date().toISOString() }, destinations, t, onClose() {}, onFollow() {} }));
  assert.match(html, /class="washroom-detour-panel"/);
  assert.match(html, /washroom-detour-panel__position/);
  assert.match(html, /washroom-detour-panel__destinations/);
  assert.match(source, /washroom-detour-panel__leg/);
  assert.match(source, /washroom-detour-panel__continuation/);
  assert.match(source, /washroom-detour-panel__visit/);
  assert.match(source, /washroom-detour-panel__directions/);
  assert.match(html, /Remaining destinations/);
  assert.match(html, /Plan facility and continuation/);
  assert.doesNotMatch(source, /type=['"]search['"]|SearchWorkbench/);
  assert.match(source, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(source, /AbortController/);
  assert.match(source, /busy \|\| controllerRef\.current/);
  assert.match(source, /WASHROOM_POSITION_MAX_AGE_MS/);
  assert.match(source, /visitMinutes/);
  assert.match(source, /requestGenerationRef/);
  assert.match(source, /geolocationGenerationRef/);
  assert.match(source, /disabled=\{busy\}/);
  assert.match(source, /journey\.legs\.map/);
  assert.match(source, /leg\.from\.name/);
  assert.match(source, /leg\.to\.name/);
  assert.match(source, /WASHROOM_CLIENT_DEADLINE_MS/);
  assert.match(source, /\/api\/plan-washroom-detour/);
  assert.match(source, /Complete facility and continuation plan/);
  assert.match(source, /Partial plan: facility route only/);
});

test('shows an explicit facility-only empty continuation state', () => {
  const html = renderToStaticMarkup(React.createElement(Panel, { destinations: [], t, onClose() {}, onFollow() {} }));
  assert.match(html, /No onward destination is selected/);
  assert.match(html, /A fresh current position is required/);
  assert.match(html, /disabled=""/);
});
