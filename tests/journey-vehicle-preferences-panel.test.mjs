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
const manufacturerChoices = exports.manufacturerChoices;
const modelChoicesForManufacturer = exports.modelChoicesForManufacturer;
const fleetFacts = () => vm.runInContext("[{ manufacturer: 'New Flyer', model: 'Xcelsior', year: '2020' }, { manufacturer: 'Nova Bus', model: 'LFS', year: '2018' }]", context);
const render = (options = {}, facts = fleetFacts(), criteria = {}) => renderToStaticMarkup(React.createElement(Panel, { criteria, options, verifiedFleetFacts: facts, excludedCount: 2, onCriteriaChange() {}, onOptionsChange() {} }));

test('gates model choices behind a selected company and renders modern panel class seams', () => {
  const html = render();
  assert.match(html, /Select a company first to see its verified models/);
  assert.doesNotMatch(html, />Xcelsior<|>LFS</);
  assert.match(html, /class="vehicle-pref-panel"/);
  assert.match(html, /class="vehicle-pref-step"/);
  assert.match(html, /class="vehicle-pref-chip"/);
  assert.match(html, /class="vehicle-pref-policy"/);
  assert.match(html, /class="vehicle-pref-year-grid"/);
  assert.doesNotMatch(html, /style=/);
  const selected = render({}, fleetFacts(), { manufacturer: 'New Flyer' });
  assert.match(html, />New Flyer<.*>Nova Bus<|>Nova Bus<.*>New Flyer</);
  assert.match(selected, />Xcelsior</);
  assert.doesNotMatch(selected, />LFS</);
  assert.doesNotMatch(html, /<select/);
});

test('cascades models by exact selected manufacturer and excludes cross-company models', () => {
  const facts = fleetFacts();
  assert.equal(manufacturerChoices(facts).join('|'), 'New Flyer|Nova Bus');
  assert.equal(modelChoicesForManufacturer(facts).join('|'), '');
  assert.equal(modelChoicesForManufacturer(facts, 'New Flyer').join('|'), 'Xcelsior');
  assert.equal(modelChoicesForManufacturer(facts, 'Nova Bus').join('|'), 'LFS');
});

test('renders accessible avoid recovery and does not fabricate a search control', () => {
  const html = render({ avoid: true });
  assert.match(html, /Avoid can remove unconfirmed options/);
  assert.match(html, /Include unconfirmed assignments/);
  assert.match(html, /2 options excluded/);
  assert.match(html, /Select a company first to see its verified models/);
  assert.doesNotMatch(html, /type="search"|placeholder="Search/);
});

test('preserves empty verified-fact states honestly', () => {
  const html = render({}, []);
  assert.match(html, /No verified companies are available yet/);
  assert.match(html, /Select a company first to see its verified models/);
});

test('reports invalid and reversed year intervals inline without normalising them', () => {
  const reversed = render({}, fleetFacts(), { yearFrom: 2025, yearTo: 2020 });
  assert.match(reversed, /The start year must be the same as or earlier than the end year/);
  assert.match(reversed, /aria-invalid="true"/);
  assert.match(reversed, /value="2025"/);
  assert.match(reversed, /value="2020"/);
  assert.match(render({}, fleetFacts(), { yearFrom: 1700 }), /Enter a whole year from 1800 through 3000/);
});
