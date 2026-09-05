import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = readFileSync(new URL('../components/vehicle-photo-caption.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
} }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: createRequire(import.meta.url), URL });
const photo = { exactVehicle: false, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg', credit: 'Example photographer', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' };
const render = (changes = {}, t = (en) => en) => renderToStaticMarkup(React.createElement(exports.default, { photo: { ...photo, ...changes }, t }));

test('Representative photo identification is visible, with separate source and licence links', () => {
  const html = render();
  assert.match(html, /<strong>Representative photo, not the assigned vehicle<\/strong>/);
  assert.match(html, /href="https:\/\/commons[.]wikimedia[.]org\/wiki\/File:Example[.]jpg"/);
  assert.match(html, /href="https:\/\/creativecommons[.]org\/licenses\/by\/4[.]0\/"/);
  assert.equal((html.match(/<a /g) ?? []).length, 2);
  assert.match(render({ exactVehicle: true }), /<strong>Exact vehicle photo<\/strong>/);
  assert.doesNotMatch(render({ exactVehicle: true }), /Representative photo/);
});

test('Caption translation preserves attribution and unsafe links remain plain text', () => {
  const html = render({ sourceUrl: 'javascript:alert(1)', licenseUrl: 'http://example.com', credit: '<script>bad</script>' }, (_, zh) => zh);
  assert.match(html, /代表照片，並非已編配車輛/);
  assert.doesNotMatch(html, /<a |<script>|javascript:|http:\/\//);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html, /CC BY 4[.]0/);
});
