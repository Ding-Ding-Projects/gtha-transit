import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  TICKET_DISCLOSURE,
  TICKET_STATUSES,
  addTicket,
  advanceTicket,
  cannedReply,
  createTicket,
  parseTickets,
  removeTickets,
  resolutionSteps,
  serializeTickets,
  ticketRows,
} from '../lib/support-tickets.ts';
import {
  AUTHENTICATOR_STORAGE_KEY,
  addEntry,
  entryFromUri,
  exportEntryRows,
  makeEntry,
  moveEntry,
  parseEntries,
  removeEntries,
  serializeEntries,
  updateEntry,
} from '../lib/authenticator.ts';
import {
  appendHistory,
  historyRows,
  labelHistory,
  parseHistory,
  pruneHistory,
  serializeHistory,
  verifyHistory,
} from '../lib/secret-history.ts';

const NOW = 1_700_000_000_000;
const t = (en) => en;
const zh = (_, cantonese) => cantonese;
const FAKE_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

/* -------------------------------------------------------- tickets -- */

test('a ticket is created, listed and advanced, and never goes backwards', () => {
  let ticket = createTicket({ category: 'forgot-pin', severity: 'catastrophic', description: 'I set a PIN on my own trip' }, NOW, () => 0.123456);
  assert.equal(ticket.number, 'DESK-123456');
  assert.equal(ticket.status, 'received');
  const list = addTicket([], ticket);
  assert.equal(list.length, 1);
  for (let index = 1; index < TICKET_STATUSES.length + 2; index += 1) ticket = advanceTicket(ticket, NOW + index);
  assert.equal(ticket.status, 'resolved');
  assert.deepEqual(parseTickets(serializeTickets([ticket])), [ticket]);
  assert.deepEqual(removeTickets(list, [ticket.number]), []);
});

test('the disclosure says nothing leaves the browser, in both languages', () => {
  assert.match(TICKET_DISCLOSURE.en, /Nothing is sent anywhere/);
  assert.match(TICKET_DISCLOSURE.en, /no network request/);
  assert.match(TICKET_DISCLOSURE.en, /nobody is reading it/);
  assert.match(TICKET_DISCLOSURE.zh, /冇任何嘢會傳送出去/);
});

test('the resolution names the exact site and never claims to delete anything itself', () => {
  const steps = resolutionSteps('https://planner.example.test', t);
  assert.ok(steps.some((step) => step.includes('https://planner.example.test')));
  assert.ok(steps.some((step) => /saved trips/.test(step)), 'the cost of the way out is stated');
  assert.ok(resolutionSteps('https://planner.example.test', zh).every((step) => step.length > 0));
  for (const category of ['forgot-pin', 'forgot-password', 'lost-authenticator', 'locked-out', 'other']) {
    assert.ok(cannedReply(createTicket({ category, severity: 'low', description: '' }, NOW), t).length > 0);
  }
});

test('the desk makes no network call and has no delete route of its own', () => {
  for (const file of ['lib/support-tickets.ts', 'components/locks-settings.tsx']) {
    const code = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|navigator\.sendBeacon/, `${file} reaches the network`);
    assert.doesNotMatch(code, /localStorage\.clear\(|indexedDB\.deleteDatabase|caches\.delete/, `${file} deletes site data behind the joke`);
  }
});

test('the disclosure is rendered as its own plain line, unstyled by the funny level', () => {
  const surface = readFileSync(new URL('../components/locks-settings.tsx', import.meta.url), 'utf8');
  assert.match(surface, /data-ui="tickets\.disclosure"[^>]*>\{t\(TICKET_DISCLOSURE\.en, TICKET_DISCLOSURE\.zh\)\}/);
});

test('a stored ticket that does not look like one is dropped', () => {
  assert.deepEqual(parseTickets(JSON.stringify({ version: 1, tickets: [{ number: 'REAL-CASE-1', category: 'other', severity: 'low', status: 'received' }] })), []);
  assert.deepEqual(parseTickets('{'), []);
  assert.equal(ticketRows([createTicket({ category: 'other', severity: 'low', description: 'x' }, NOW)]).length, 1);
});

/* -------------------------------------------------- authenticator -- */

test('an entry keeps the parameters its URI carried', () => {
  const made = entryFromUri(`otpauth://totp/Example:rider?secret=${FAKE_SECRET}&algorithm=SHA512&digits=8&period=60`);
  assert.ok('entry' in made);
  assert.equal(made.entry.algorithm, 'sha512');
  assert.equal(made.entry.digits, 8);
  assert.equal(made.entry.period, 60);
  assert.equal(made.entry.issuer, 'Example');
});

test('a bad secret or parameter is refused with its reason', () => {
  assert.deepEqual(makeEntry({ issuer: 'x', account: 'y', secret: 'nope!', algorithm: 'sha1', digits: 6, period: 30 }), { problem: 'secret' });
  assert.deepEqual(makeEntry({ issuer: 'x', account: 'y', secret: FAKE_SECRET, algorithm: 'md5', digits: 6, period: 30 }), { problem: 'parameters' });
  assert.deepEqual(makeEntry({ issuer: '', account: '', secret: FAKE_SECRET, algorithm: 'sha1', digits: 6, period: 30 }), { problem: 'account' });
});

test('entries reorder, rename, remove and survive a reload', () => {
  const a = makeEntry({ issuer: 'A', account: 'a', secret: FAKE_SECRET, algorithm: 'sha1', digits: 6, period: 30 }).entry;
  const b = makeEntry({ issuer: 'B', account: 'b', secret: FAKE_SECRET, algorithm: 'sha1', digits: 6, period: 30 }).entry;
  let entries = addEntry(addEntry([], a), b);
  entries = moveEntry(entries, b.id, -1);
  assert.deepEqual(entries.map((entry) => entry.issuer), ['B', 'A']);
  const renamed = updateEntry(entries, a.id, { issuer: 'Renamed', group: 'Work' });
  assert.deepEqual(renamed.fields, ['issuer', 'group']);
  assert.deepEqual(parseEntries(serializeEntries(renamed.entries)), renamed.entries);
  assert.equal(removeEntries(renamed.entries, [a.id]).length, 1);
  assert.equal(AUTHENTICATOR_STORAGE_KEY, 'gtha-authenticator-v1');
});

test('the ordinary export omits every secret, and says so on every row', () => {
  const entry = makeEntry({ issuer: 'A', account: 'a', secret: FAKE_SECRET, algorithm: 'sha1', digits: 6, period: 30 }).entry;
  const rows = exportEntryRows([entry]);
  assert.ok(!JSON.stringify(rows).includes(FAKE_SECRET));
  assert.match(rows[0].secret, /omitted/);
});

/* -------------------------------------------------------- history -- */

test('every mutation appends a record, and the chain verifies', () => {
  let log = [];
  log = appendHistory(log, { action: 'totp-added', subject: 'Example (rider)', fields: ['issuer', 'account'] }, NOW, [FAKE_SECRET]);
  log = appendHistory(log, { action: 'display-name-changed', subject: 'display name', detail: 'My planner' }, NOW + 1);
  log = labelHistory(log, 1, 'before the trip', NOW + 2);
  assert.deepEqual(log.map((record) => record.seq), [1, 2, 3]);
  assert.equal(verifyHistory(log).intact, true);
  assert.deepEqual(parseHistory(serializeHistory(log)), log);
});

test('an edited record breaks the chain and says where', () => {
  let log = appendHistory([], { action: 'totp-added', subject: 'A' }, NOW);
  log = appendHistory(log, { action: 'totp-removed', subject: 'A' }, NOW + 1);
  const tampered = [{ ...log[0], subject: 'B' }, log[1]];
  assert.deepEqual(verifyHistory(tampered), { intact: false, brokenAt: 1 });
});

test('a record can never carry a secret, as a field name or as text', () => {
  assert.throws(() => appendHistory([], { action: 'totp-changed', subject: 'A', fields: ['secret'] }, NOW));
  assert.throws(() => appendHistory([], { action: 'lock-created', subject: 'A', fields: ['pin'] }, NOW));
  assert.throws(() => appendHistory([], { action: 'totp-added', subject: `pasted ${FAKE_SECRET}` }, NOW, [FAKE_SECRET]));
  assert.throws(() => appendHistory([], { action: 'totp-added', subject: 'x', detail: FAKE_SECRET.toLowerCase().replace(/(.{4})/g, '$1 ') }, NOW, [FAKE_SECRET]));
});

test('pruning keeps the newest records and records that it pruned', () => {
  let log = [];
  for (let index = 0; index < 10; index += 1) log = appendHistory(log, { action: 'totp-added', subject: `E${index}` }, NOW + index);
  const pruned = pruneHistory(log, 3, NOW + 100);
  assert.equal(pruned.length, 4);
  assert.equal(pruned.at(-1).action, 'pruned');
  assert.equal(verifyHistory(pruned).intact, true, 'a pruned history still verifies from its new anchor');
});

test('the redacted history export states what it never contains', () => {
  const log = appendHistory([], { action: 'totp-added', subject: 'A', fields: ['issuer'] }, NOW);
  const rows = historyRows(log);
  assert.match(rows[0].omitted, /no secret/);
});
