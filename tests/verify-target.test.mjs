import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPage } from '../scripts/ui-evidence/verify-target.mjs';

/**
 * The capture helper refused every promotion because the verifier it spawns was
 * never committed. These pin the one question it answers: is the endpoint showing
 * exactly one page, and is it the page we mean to photograph?
 */
const endpoint = new URL('http://127.0.0.1:39471/json/list');
const expected = new URL('https://toronto-transit.org/');
const page = (overrides = {}) => ({
  type: 'page',
  url: 'https://toronto-transit.org/',
  webSocketDebuggerUrl: 'ws://127.0.0.1:39471/devtools/page/ABC123',
  ...overrides,
});

test('exactly one page target on the expected URL is accepted', () => {
  const chosen = selectPage([page()], expected, endpoint);
  assert.equal(chosen.page.url, 'https://toronto-transit.org/');
  assert.equal(chosen.socket.pathname.startsWith('/devtools/page/'), true);
});

test('a second page target is refused, however plausible the first one looks', () => {
  assert.throws(() => selectPage([page(), page({ url: 'https://toronto-transit.org/' })], expected, endpoint), /target-count/);
});

test('no page target at all is refused', () => {
  assert.throws(() => selectPage([{ type: 'iframe', url: 'https://ads.example/' }], expected, endpoint), /target-count/);
});

test('page-created iframes are not counted, so one page beside them is accepted', () => {
  const targets = [
    { type: 'iframe', url: 'https://googleads.g.doubleclick.net/x' },
    page(),
    { type: 'iframe', url: 'https://www.google.com/recaptcha/api2/aframe' },
  ];
  assert.equal(selectPage(targets, expected, endpoint).page.type, 'page');
});

test('a page on another URL is refused rather than photographed', () => {
  assert.throws(() => selectPage([page({ url: 'https://example.com/' })], expected, endpoint), /target-url/);
  assert.throws(() => selectPage([page({ url: 'https://toronto-transit.org/settings' })], expected, endpoint), /target-url/);
});

test('a socket that does not belong to this endpoint is refused', () => {
  assert.throws(() => selectPage([page({ webSocketDebuggerUrl: 'ws://127.0.0.1:39999/devtools/page/A' })], expected, endpoint), /target-socket/);
  assert.throws(() => selectPage([page({ webSocketDebuggerUrl: 'wss://127.0.0.1:39471/devtools/page/A' })], expected, endpoint), /target-socket/);
  assert.throws(() => selectPage([page({ webSocketDebuggerUrl: 'ws://127.0.0.1:39471/devtools/browser/A' })], expected, endpoint), /target-socket/);
});

test('a socket carrying credentials or a query is refused', () => {
  assert.throws(() => selectPage([page({ webSocketDebuggerUrl: 'ws://user:pass@127.0.0.1:39471/devtools/page/A' })], expected, endpoint), /target-socket/);
  assert.throws(() => selectPage([page({ webSocketDebuggerUrl: 'ws://127.0.0.1:39471/devtools/page/A?x=1' })], expected, endpoint), /target-socket/);
});
