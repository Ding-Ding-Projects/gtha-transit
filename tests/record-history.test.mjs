import test from 'node:test';
import assert from 'node:assert/strict';

import {
  memoryBackend,
  indexedDbBackend,
  recordHistory,
  history,
  diffCommits,
  restore,
  label as labelCommit,
  prune,
  actionsPresent,
  exportHistory,
  redact,
  canonicalJson,
  commitId,
  MAX_SNAPSHOT_BYTES,
} from '../lib/record-history.ts';
import { installIndexedDbStub } from './helpers/indexeddb-stub.mjs';

const stub = installIndexedDbStub();

/** Every scenario that should hold for either storage backend runs against both. */
function backendMatrix() {
  return [
    ['memory backend', () => memoryBackend()],
    [
      'indexeddb backend',
      () => {
        stub.reset();
        const backend = indexedDbBackend();
        assert.ok(backend, 'indexedDbBackend() must not be null once the stub is installed');
        return backend;
      },
    ],
  ];
}

function withBothBackends(name, fn) {
  for (const [backendLabel, make] of backendMatrix()) {
    test(`${name} (${backendLabel})`, async () => {
      await fn(make());
    });
  }
}

function brokenBackend() {
  const boom = async () => {
    throw new Error('boom');
  };
  return { getHead: boom, putCommit: boom, getCommit: boom, listCommits: boom, setHead: boom, deleteCommits: boom, listKinds: boom };
}

/** Build a commit directly against the backend, bypassing recordHistory, so prune tests can control `at` precisely. */
function buildCommit(kind, parent, snapshot, at, action) {
  const id = commitId({ kind, parent, snapshot, at, action });
  return { id, kind, parent, snapshot, at, action, label: '', size: new TextEncoder().encode(canonicalJson(snapshot)).length };
}

/* ------------------------------------------------------------ recordHistory */

withBothBackends('the first record creates a head', async (backend) => {
  const result = await recordHistory(backend, { kind: 'saved-trips', before: null, after: { trips: [1] }, action: 'save' });
  assert.equal(result.recorded, true);
  assert.equal(result.commit.parent, null);
  assert.equal(result.commit.action, 'save');
  const head = await backend.getHead('saved-trips');
  assert.equal(head.commit, result.commit.id);
});

withBothBackends('an identical snapshot records nothing', async (backend) => {
  const snapshot = { trips: [1, 2, 3] };
  const first = await recordHistory(backend, { kind: 'saved-trips', before: null, after: snapshot, action: 'save' });
  assert.equal(first.recorded, true);

  const second = await recordHistory(backend, { kind: 'saved-trips', before: snapshot, after: structuredClone(snapshot), action: 'save' });
  assert.deepEqual(second, { recorded: false, reason: 'unchanged' });

  const commits = await history(backend, 'saved-trips');
  assert.equal(commits.length, 1);
});

withBothBackends('the parent chain grows with each real change, newest first', async (backend) => {
  const r1 = await recordHistory(backend, { kind: 'preferences', before: null, after: { theme: 'light' }, action: 'settings-change' });
  const r2 = await recordHistory(backend, { kind: 'preferences', before: { theme: 'light' }, after: { theme: 'dark' }, action: 'settings-change' });
  const r3 = await recordHistory(backend, {
    kind: 'preferences',
    before: { theme: 'dark' },
    after: { theme: 'dark', density: 'compact' },
    action: 'settings-change',
  });

  assert.equal(r1.commit.parent, null);
  assert.equal(r2.commit.parent, r1.commit.id);
  assert.equal(r3.commit.parent, r2.commit.id);

  const commits = await history(backend, 'preferences');
  assert.equal(commits.length, 3);
  assert.deepEqual(
    commits.map((commit) => commit.id),
    [r3.commit.id, r2.commit.id, r1.commit.id],
  );
});

withBothBackends('concurrent recordHistory calls still produce one strictly linear chain', async (backend) => {
  const kind = 'saved-trips';
  const writes = [];
  for (let index = 0; index < 20; index += 1) {
    // Fired without awaiting one another: without queueHistoryWrite these would
    // all read the same stale head and fork instead of chaining.
    writes.push(recordHistory(backend, { kind, before: { step: index }, after: { step: index + 1 }, action: 'save' }));
  }
  const results = await Promise.all(writes);
  assert.ok(results.every((result) => result.recorded === true));

  const commits = await history(backend, kind, { limit: 200 });
  assert.equal(commits.length, 20);

  const byId = new Map(commits.map((commit) => [commit.id, commit]));
  const seen = new Set();
  let current = commits[0];
  while (current) {
    assert.ok(!seen.has(current.id), 'the chain must not revisit a commit');
    seen.add(current.id);
    current = current.parent ? (byId.get(current.parent) ?? null) : null;
  }
  assert.equal(seen.size, 20, 'every commit must be reachable by walking parents from the head, with no fork and no orphan');
});

test('a snapshot over the size limit is refused, and nothing is written', async () => {
  const backend = memoryBackend();
  const big = { blob: 'x'.repeat(MAX_SNAPSHOT_BYTES + 1000) };
  const result = await recordHistory(backend, { kind: 'saved-trips', before: null, after: big, action: 'save' });
  assert.deepEqual(result, { recorded: false, reason: 'too-large' });
  assert.equal((await history(backend, 'saved-trips')).length, 0);
});

test('a snapshot exactly at the size limit is accepted', async () => {
  const backend = memoryBackend();
  const overhead = canonicalJson({ blob: '' }).length;
  const snapshot = { blob: 'x'.repeat(MAX_SNAPSHOT_BYTES - overhead) };
  assert.equal(new TextEncoder().encode(canonicalJson(snapshot)).length, MAX_SNAPSHOT_BYTES);
  const result = await recordHistory(backend, { kind: 'saved-trips', before: null, after: snapshot, action: 'save' });
  assert.equal(result.recorded, true);
  assert.equal(result.commit.size, MAX_SNAPSHOT_BYTES);
});

test('a backend that throws yields recorded:false reason:storage, and never throws', async () => {
  const result = await recordHistory(brokenBackend(), { kind: 'locks', before: null, after: { locked: true }, action: 'lock' });
  assert.deepEqual(result, { recorded: false, reason: 'storage' });
});

/* ------------------------------------------------------------------ restore */

withBothBackends('restore writes a new commit with the restored snapshot; it never rewinds the head', async (backend) => {
  const r1 = await recordHistory(backend, { kind: 'appearance', before: null, after: { accent: 'blue' }, action: 'settings-change' });
  const r2 = await recordHistory(backend, { kind: 'appearance', before: { accent: 'blue' }, after: { accent: 'green' }, action: 'settings-change' });

  const result = await restore(backend, 'appearance', r1.commit.id);
  assert.equal(result.restored, true);
  assert.deepEqual(result.commit.snapshot, { accent: 'blue' });
  assert.equal(result.commit.action, 'restore');
  assert.notEqual(result.commit.id, r1.commit.id, 'restoring writes a brand-new commit, not a pointer back to the old one');
  assert.equal(result.commit.parent, r2.commit.id, 'the restore is parented on the OLD head, never on the commit being restored');

  const head = await backend.getHead('appearance');
  assert.equal(head.commit, result.commit.id);

  const commits = await history(backend, 'appearance');
  assert.equal(commits.length, 3, 'nothing already written is deleted by a restore');
});

withBothBackends('restoring an unknown commit id reports not-found rather than throwing', async (backend) => {
  const result = await restore(backend, 'appearance', 'not-a-real-commit-id');
  assert.deepEqual(result, { restored: false, reason: 'not-found' });
});

withBothBackends('restoring a commit id that belongs to a different kind reports not-found', async (backend) => {
  const written = await recordHistory(backend, { kind: 'tabs', before: null, after: { order: [1] }, action: 'save' });
  const result = await restore(backend, 'preferences', written.commit.id);
  assert.deepEqual(result, { restored: false, reason: 'not-found' });
});

test('restore against a throwing backend yields restored:false reason:storage', async () => {
  const result = await restore(brokenBackend(), 'locks', 'whatever');
  assert.deepEqual(result, { restored: false, reason: 'storage' });
});

/* -------------------------------------------------------------------- label */

withBothBackends('a label sticks and does not change the commit id', async (backend) => {
  const written = await recordHistory(backend, { kind: 'school-mode', before: null, after: { on: true }, action: 'lock' });
  const originalId = written.commit.id;

  const result = await labelCommit(backend, originalId, 'Before exam week');
  assert.equal(result.labelled, true);
  assert.equal(result.commit.id, originalId, 'labelling must not change the content-addressed id');

  const fetched = await backend.getCommit(originalId);
  assert.equal(fetched.label, 'Before exam week');
});

withBothBackends('labelling an unknown commit reports not-found', async (backend) => {
  const result = await labelCommit(backend, 'not-a-real-commit-id', 'anything');
  assert.deepEqual(result, { labelled: false, reason: 'not-found' });
});

/* -------------------------------------------------------------------- prune */

withBothBackends('prune keeps the last N, labelled commits, and the head; removes the rest', async (backend) => {
  const kind = 'notifications';
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();

  let parent = null;
  const commits = [];
  for (let index = 0; index < 10; index += 1) {
    const at = now - (200 - index) * dayMs; // oldest first, all roughly 190-200 days old
    const commit = buildCommit(kind, parent, { step: index }, at, 'save');
    await backend.putCommit(commit);
    parent = commit.id;
    commits.push(commit);
  }
  await backend.setHead(kind, parent); // head is commits[9], the newest

  const labelled = await labelCommit(backend, commits[2].id, 'Before the big rename');
  assert.equal(labelled.labelled, true);

  const result = await prune(backend, kind, { keepLast: 3, keepDays: 30 });
  const remaining = await history(backend, kind, { limit: 200 });
  const remainingIds = new Set(remaining.map((commit) => commit.id));

  assert.ok(remainingIds.has(commits[2].id), 'the labelled commit survives regardless of age or rank');
  assert.ok(remainingIds.has(commits[9].id), 'the head survives');
  assert.ok(remainingIds.has(commits[8].id), 'the second-most-recent survives (within keepLast)');
  assert.ok(remainingIds.has(commits[7].id), 'the third-most-recent survives (within keepLast)');
  for (const index of [0, 1, 3, 4, 5, 6]) {
    assert.ok(!remainingIds.has(commits[index].id), `commit ${index} is old, unranked and unlabelled, and must be removed`);
  }
  assert.equal(remainingIds.size, 4);
  assert.equal(result.removed.length, 6);
});

withBothBackends('prune never removes a labelled commit even when it is the oldest of all', async (backend) => {
  const kind = 'authenticator';
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const old = buildCommit(kind, null, { secretRotated: 1 }, now - 500 * dayMs, 'rotate-secret');
  await backend.putCommit(old);
  const recent = buildCommit(kind, old.id, { secretRotated: 2 }, now, 'rotate-secret');
  await backend.putCommit(recent);
  await backend.setHead(kind, recent.id);
  await labelCommit(backend, old.id, 'Original enrolment');

  await prune(backend, kind, { keepLast: 1, keepDays: 1 });
  const remainingIds = new Set((await history(backend, kind)).map((commit) => commit.id));
  assert.ok(remainingIds.has(old.id), 'a labelled commit is kept no matter how old or low-ranked it is');
  assert.ok(remainingIds.has(recent.id));
});

test('prune against a throwing backend removes nothing and does not throw', async () => {
  const result = await prune(brokenBackend(), 'locks');
  assert.deepEqual(result, { removed: [] });
});

/* ---------------------------------------------------------------- diffing */

withBothBackends('diffCommits reports the structural diff between two commits', async (backend) => {
  const r1 = await recordHistory(backend, { kind: 'saved-trips', before: null, after: { trips: ['a'] }, action: 'save' });
  const r2 = await recordHistory(backend, { kind: 'saved-trips', before: { trips: ['a'] }, after: { trips: ['a', 'b'] }, action: 'save' });

  const diff = await diffCommits(backend, r1.commit.id, r2.commit.id);
  assert.equal(diff.truncated, false);
  assert.equal(diff.entries.length, 1);
  assert.equal(diff.entries[0].path, 'trips[1]');
  assert.equal(diff.entries[0].kind, 'added');
  assert.equal(diff.a.id, r1.commit.id);
  assert.equal(diff.b.id, r2.commit.id);
});

withBothBackends('diffCommits treats a missing commit id as absent rather than throwing', async (backend) => {
  const r1 = await recordHistory(backend, { kind: 'saved-trips', before: null, after: { trips: ['a'] }, action: 'save' });
  const diff = await diffCommits(backend, r1.commit.id, 'not-a-real-id');
  assert.equal(diff.b, null);
  assert.ok(diff.entries.some((entry) => entry.kind === 'removed' && entry.path === 'trips[0]'));
});

/* ---------------------------------------------------------------- actions */

withBothBackends('actionsPresent counts commits by action', async (backend) => {
  const kind = 'tabs';
  await recordHistory(backend, { kind, before: null, after: { order: [1] }, action: 'save' });
  await recordHistory(backend, { kind, before: { order: [1] }, after: { order: [1, 2] }, action: 'save' });
  await recordHistory(backend, { kind, before: { order: [1, 2] }, after: { order: [2, 1] }, action: 'reorder' });

  assert.deepEqual(await actionsPresent(backend, kind), { save: 2, reorder: 1 });
});

withBothBackends('actionsPresent on a kind with no commits is an empty object', async (backend) => {
  assert.deepEqual(await actionsPresent(backend, 'nothing-recorded-yet'), {});
});

/* ------------------------------------------------------------------ export */

test('exportHistory redacts secret-named fields into fingerprints, and the JSON export parses', async () => {
  const backend = memoryBackend();
  const snapshot = {
    name: 'Exam mode',
    salt: 'abc',
    password: 'hunter2',
    nested: { apiKey: 'sk-live-xyz', label: 'kept' },
  };
  await recordHistory(backend, { kind: 'school-mode', before: null, after: snapshot, action: 'lock' });

  const text = await exportHistory(backend, 'school-mode', {}, 'json');
  assert.equal(text.includes('hunter2'), false, 'the secret must never appear in the exported text');
  assert.equal(text.includes('sk-live-xyz'), false);

  const parsed = JSON.parse(text);
  assert.equal(parsed.length, 1);
  const exported = parsed[0].snapshot;
  assert.ok(exported.password.startsWith('fp:'));
  assert.ok(exported.nested.apiKey.startsWith('fp:'));
  assert.equal(exported.nested.label, 'kept', 'a field not named like a secret is left alone');
  assert.equal(exported.salt, 'abc', "'salt' does not match any redacted name fragment");
  assert.equal(exported.name, 'Exam mode');
});

test('exportHistory honours the action and date filters', async () => {
  const backend = memoryBackend();
  const kind = 'preferences';
  await recordHistory(backend, { kind, before: null, after: { a: 1 }, action: 'save' });
  await recordHistory(backend, { kind, before: { a: 1 }, after: { a: 2 }, action: 'settings-change' });

  const text = await exportHistory(backend, kind, { actions: ['save'] }, 'jsonl');
  const lines = text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].action, 'save');
});

test('redact leaves ordinary fields alone and fingerprints deterministically', () => {
  const value = { a: 1, list: [{ token: 'abc' }, { token: 'abc' }], plain: 'x' };
  const redacted = redact(value);
  assert.equal(redacted.plain, 'x');
  assert.equal(redacted.a, 1);
  assert.equal(redacted.list[0].token, redacted.list[1].token, 'the same secret redacts to the same fingerprint');
  assert.notEqual(redacted.list[0].token, 'abc');
  assert.ok(redacted.list[0].token.startsWith('fp:'));
});

/* ------------------------------------------------------------- canonical -- */

test('canonicalJson sorts object keys, so key order never changes the result', () => {
  const a = { z: 1, a: 2, m: { y: 1, x: 2 } };
  const b = { a: 2, z: 1, m: { x: 2, y: 1 } };
  assert.equal(canonicalJson(a), canonicalJson(b));
});

test('commitId is stable for identical content and changes when any hashed field changes', () => {
  const base = { kind: 'saved-trips', parent: null, snapshot: { a: 1 }, at: 1000, action: 'save' };
  const id = commitId(base);

  assert.equal(commitId({ ...base }), id);
  assert.match(id, /^[0-9a-f]{64}$/);

  assert.notEqual(commitId({ ...base, at: 1001 }), id);
  assert.notEqual(commitId({ ...base, action: 'import' }), id);
  assert.notEqual(commitId({ ...base, parent: 'something' }), id);
  assert.notEqual(commitId({ ...base, snapshot: { a: 2 } }), id);
});

test('a label is not part of the hash input, so it cannot change commitId', () => {
  const base = { kind: 'saved-trips', parent: null, snapshot: { a: 1 }, at: 1000, action: 'save' };
  const id = commitId(base);
  const withExtraFields = { ...base, id, label: 'anything', size: 999 };
  assert.equal(commitId(withExtraFields), id);
});
