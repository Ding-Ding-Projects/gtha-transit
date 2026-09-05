import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = readFileSync(new URL('../components/journey-vehicle-preferences.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
const context = vm.createContext({ exports, require: createRequire(import.meta.url) });
vm.runInContext(compiled, context);
const Panel = exports.JourneyVehiclePreferencesPanel;
const fleetFacts = () => vm.runInContext("[{ manufacturer: 'New Flyer', model: 'Xcelsior', year: '2020' }, { manufacturer: 'Nova Bus', model: 'LFS', year: '2018' }]", context);
const render = (options = {}, facts = fleetFacts()) => renderToStaticMarkup(React.createElement(Panel, { criteria: {}, options, verifiedFleetFacts: facts, excludedCount: 2, onCriteriaChange() {}, onOptionsChange() {} }));

test('renders independent manufacturer and model button choices from supplied verified facts', () => {
  const html = render();
  assert.match(html, /Manufacturer choices/);
  assert.match(html, /Model choices/);
  assert.match(html, />New Flyer<.*>Nova Bus<|>Nova Bus<.*>New Flyer</);
  assert.match(html, />Xcelsior<.*>LFS<|>LFS<.*>Xcelsior</);
  assert.doesNotMatch(html, /<select/);
});

test('renders accessible avoid recovery and does not fabricate a search control', () => {
  const html = render({ avoid: true });
  assert.match(html, /Avoid can remove unconfirmed options/);
  assert.match(html, /Include unconfirmed assignments/);
  assert.match(html, /2 options excluded/);
  assert.match(html, /full regex builder/);
  assert.doesNotMatch(html, /type="search"|placeholder="Search/);
});

test('preserves empty verified-fact states honestly', () => {
  const html = render({}, []);
  assert.match(html, /No verified manufacturers are available yet/);
  assert.match(html, /No verified models are available yet/);
});
