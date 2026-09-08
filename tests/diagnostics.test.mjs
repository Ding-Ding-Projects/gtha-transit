import assert from 'node:assert/strict';
import test from 'node:test';
import { record, recent, reset, routePattern } from '../server/diagnostics.mjs';

/**
 * The diagnostics buffer exists to make a broken deployment visible. It is also
 * an unauthenticated write on a public origin that then reads back over HTTP, so
 * what it refuses to keep matters more than what it keeps.
 *
 * A journey planner's query string is where somebody lives and where they are
 * going. These check that no arrangement of caller input gets one in there.
 */

test('a query string never survives, whatever is in it', () => {
  reset();
  record({ kind: 'request', route: '/api/plan?from=43.6532,-79.3832&to=HomeAddress&rider=QueenStreetWest' });
  const text = JSON.stringify(recent());
  /* Distinctive values on purpose. A needle like "me" is a substring of
     "message" and fails on the buffer's own field names, which reads as a leak
     and is only a badly chosen needle. */
  for (const secret of ['43.6532', '-79.3832', 'HomeAddress', 'rider', 'QueenStreetWest']) {
    assert.ok(!text.includes(secret), `${secret} reached the buffer`);
  }
  assert.equal(recent().entries[0].route, '/api/plan');
});

test('an identifier in a path is replaced rather than kept', () => {
  assert.equal(routePattern('/api/stops/1234/departures'), '/api/stops/:id/departures');
  assert.equal(routePattern('/api/vehicles/8432'), '/api/vehicles/:id');
  assert.equal(routePattern('/api/trip/a1b2c3d4e5f6'), '/api/trip/:id');
  // A real route segment is not an identifier and must survive.
  assert.equal(routePattern('/api/vehicles/divisions'), '/api/vehicles/divisions');
});

test('a message is bounded, and control characters are stripped', () => {
  reset();
  record({ kind: 'client', message: 'x'.repeat(5000) });
  assert.equal(recent().entries[0].message.length, 240);
  reset();
  record({ kind: 'client', message: `line${String.fromCharCode(10)}break${String.fromCharCode(0)}nul` });
  const message = recent().entries[0].message;
  assert.ok(!/\p{Cc}/u.test(message), 'a control character survived');
  // An emoji is several code points and must not be taken apart.
  reset();
  record({ kind: 'client', message: 'subway \u{1F687} sign' });
  assert.ok(recent().entries[0].message.includes('\u{1F687}'), 'the emoji was broken up');
});

test('the buffer is bounded and says what it dropped', () => {
  reset();
  for (let index = 0; index < 260; index += 1) record({ kind: 'request', message: `failure ${index}` });
  const report = recent();
  assert.equal(report.retained, report.capacity, 'the buffer grew past its capacity');
  assert.equal(report.recorded, 260);
  assert.equal(report.dropped, 260 - report.capacity);
  // Newest first, so a reader sees what just broke rather than what broke first.
  assert.equal(report.entries[0].message, 'failure 259');
});

test('recording never throws, whatever it is handed', () => {
  reset();
  for (const bad of [undefined, null, {}, { kind: 'nonsense' }, { route: 12345 }, { message: {} }, { millis: 'soon' }]) {
    assert.doesNotThrow(() => record(bad), `record threw on ${JSON.stringify(bad)}`);
  }
  // An unknown kind is recorded as unknown rather than silently dropped.
  reset();
  record({ kind: 'nonsense', message: 'still worth keeping' });
  assert.equal(recent().entries[0].kind, 'unknown');
});

test('the report says plainly what it does not collect', () => {
  reset();
  const report = recent();
  assert.match(report.note, /No addresses, agents, queries or bodies/);
  assert.equal(report.service, 'gtha-transit-web');
});
