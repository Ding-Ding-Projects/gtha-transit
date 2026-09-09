/**
 * A local, Git-shaped version history for the records this app keeps in your
 * browser: saved trips, preferences, appearance overrides, tab strips,
 * notification history, School mode, and whatever else starts calling
 * `recordHistory`.
 *
 * **Git-shaped, honestly not Git.** Every commit is content-addressed — its id
 * is the SHA-256 of its own contents — and carries a `parent`, so the history
 * of one record is a hash-linked chain exactly the way a Git branch is. That is
 * where the resemblance ends. There is no remote, no clone, no account, no
 * network request anywhere in this file: every commit lives in this browser's
 * own IndexedDB and never leaves it. Calling it "Git" would promise sync,
 * conflict resolution and a server nobody is building.
 *
 * **Append-only, and restoring never rewinds.** Nothing here ever deletes a
 * commit except `prune`, on purpose, within its stated retention. Restoring an
 * old snapshot does not move the head backward to that old commit — it writes
 * a brand-new commit carrying the old snapshot, parented on whatever the head
 * currently is, with `action: 'restore'`. That is what makes it safe to
 * experiment: restoring a restore is just another restore, and the state you
 * restored *from* is never thrown away to get there.
 *
 * **Labels are the one mutable field.** A commit's id is a hash of
 * `{ kind, parent, snapshot, at, action }` — deliberately not `label` — so
 * labelling a commit after the fact does not change its identity or break the
 * parent chain that points at it. Everything else about a written commit is
 * fixed forever.
 *
 * **A snapshot has a size limit and a redaction pass on the way out.** Recording
 * refuses anything over 256 KiB rather than let one runaway record blow the
 * IndexedDB budget for everyone else's history. Exporting runs every snapshot
 * through `redact`, which never lets a field that looks like a secret leave in
 * the clear — see `redact` below for exactly what that means and does not mean.
 */

import { sha256 } from './pbkdf2.ts';
import { diffJson, type DiffResult } from './json-diff.ts';
import { exportRecords, type ExportFormat, type ExportRecord } from './export.ts';

/* ------------------------------------------------------------------ kinds -- */

/**
 * What kind of record a commit belongs to.
 *
 * Left as a plain string, not a union of the list below, so a feature can
 * start writing its own history before this file has ever heard of it — the
 * whole point of a shared history module is that it does not gate who gets to
 * use it. `KNOWN_HISTORY_KINDS` exists so a reader has one place to see what is
 * actually in use; it documents, it does not enforce.
 */
export type HistoryKind = string;

export const KNOWN_HISTORY_KINDS: readonly HistoryKind[] = [
  'saved-trips',
  'preferences',
  'appearance',
  'tabs',
  'notifications',
  'school-mode',
  'authenticator',
  'locks',
];

/**
 * The verb a commit records — what happened, in the panel's own words.
 *
 * Also left open for the same reason `HistoryKind` is. `KNOWN_HISTORY_ACTIONS`
 * documents the verbs this codebase currently writes.
 */
export type HistoryAction = string;

export const KNOWN_HISTORY_ACTIONS: readonly HistoryAction[] = [
  'save',
  'delete',
  'reorder',
  'rename',
  'restore',
  'import',
  'settings-change',
  'lock',
  'rotate-secret',
  'prune',
  'label',
];

/* -------------------------------------------------------------- commits --- */

export type HistoryCommit = {
  /** sha256 of `canonicalJson({ kind, parent, snapshot, at, action })`. */
  id: string;
  kind: HistoryKind;
  /** The previous head for this kind at the moment this commit was written, or null for the first. */
  parent: string | null;
  snapshot: unknown;
  /** Epoch milliseconds. */
  at: number;
  action: HistoryAction;
  /** The one field that can change after a commit is written. See `label()`. */
  label: string;
  /** Byte length of `canonicalJson(snapshot)`, checked against `MAX_SNAPSHOT_BYTES`. */
  size: number;
};

/** Exactly the fields that go into a commit's id — not the commit itself, which does not exist until this is hashed. */
export type HistoryCommitInput = Pick<HistoryCommit, 'kind' | 'parent' | 'snapshot' | 'at' | 'action'>;

export type HistoryHead = { kind: HistoryKind; commit: string | null };

/* --------------------------------------------------------------- backend -- */

/**
 * What a storage backend has to do. Two implementations follow:
 * `indexedDbBackend()` for the real browser, `memoryBackend()` for tests and
 * for wherever the browser has refused IndexedDB outright.
 *
 * `listCommits` with no `limit` returns every commit for that kind, newest
 * first by `at`; with `limit` it returns at most that many; with `before` it
 * excludes anything at or after that timestamp, for paging backward through
 * time. Both bundled backends share one `paginate` helper so this contract
 * reads identically regardless of which one is answering.
 */
export type HistoryBackend = {
  getHead(kind: HistoryKind): Promise<HistoryHead>;
  putCommit(commit: HistoryCommit): Promise<void>;
  getCommit(id: string): Promise<HistoryCommit | null>;
  listCommits(kind: HistoryKind, options?: { limit?: number; before?: number }): Promise<HistoryCommit[]>;
  setHead(kind: HistoryKind, id: string): Promise<void>;
  deleteCommits(ids: readonly string[]): Promise<void>;
  listKinds(): Promise<HistoryKind[]>;
};

function paginate(commits: readonly HistoryCommit[], options: { limit?: number; before?: number }): HistoryCommit[] {
  let list = [...commits].sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  if (options.before !== undefined) list = list.filter((commit) => commit.at < (options.before as number));
  if (options.limit !== undefined) list = list.slice(0, options.limit);
  return list;
}

/** An in-memory backend. What the test suite uses, and what a caller can fall back to when storage is refused. */
export function memoryBackend(): HistoryBackend {
  const commits = new Map<string, HistoryCommit>();
  const heads = new Map<HistoryKind, string | null>();

  return {
    async getHead(kind) {
      return { kind, commit: heads.get(kind) ?? null };
    },
    async putCommit(commit) {
      commits.set(commit.id, { ...commit });
    },
    async getCommit(id) {
      const found = commits.get(id);
      return found ? { ...found } : null;
    },
    async listCommits(kind, options = {}) {
      const forKind = [...commits.values()].filter((commit) => commit.kind === kind);
      return paginate(forKind, options).map((commit) => ({ ...commit }));
    },
    async setHead(kind, id) {
      heads.set(kind, id);
    },
    async deleteCommits(ids) {
      for (const id of ids) commits.delete(id);
    },
    async listKinds() {
      return [...heads.keys()];
    },
  };
}

const DB_NAME = 'gtha-history-v1';
const DB_VERSION = 1;
const COMMITS_STORE = 'commits';
const HEADS_STORE = 'heads';
const KIND_INDEX = 'kind';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(COMMITS_STORE)) {
        const store = db.createObjectStore(COMMITS_STORE, { keyPath: 'id' });
        store.createIndex(KIND_INDEX, 'kind');
      }
      if (!db.objectStoreNames.contains(HEADS_STORE)) {
        db.createObjectStore(HEADS_STORE, { keyPath: 'kind' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`Could not open ${DB_NAME}`));
  });
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * The real backend, backed by this browser's IndexedDB.
 *
 * Commits keep a single-field index on `kind`; a personal per-browser history
 * for one record kind is small enough that sorting and paging the result by
 * `at` in this module, after that lookup, is simpler than a compound `kind+at`
 * index and answers exactly the same queries. `heads` is keyed by `kind`
 * directly, one row per record kind.
 *
 * Returns null rather than a broken backend when this origin has no
 * `indexedDB` at all, so a caller can fall back to `memoryBackend()` instead of
 * discovering the gap the first time a write throws.
 */
export function indexedDbBackend(): HistoryBackend | null {
  if (typeof indexedDB === 'undefined') return null;

  let dbPromise: Promise<IDBDatabase> | null = null;
  const db = (): Promise<IDBDatabase> => (dbPromise ??= openDatabase());

  return {
    async getHead(kind) {
      const database = await db();
      const store = database.transaction(HEADS_STORE, 'readonly').objectStore(HEADS_STORE);
      const found = await wrap(store.get(kind) as IDBRequest<HistoryHead | undefined>);
      return found ?? { kind, commit: null };
    },
    async putCommit(commit) {
      const database = await db();
      const store = database.transaction(COMMITS_STORE, 'readwrite').objectStore(COMMITS_STORE);
      await wrap(store.put(commit));
    },
    async getCommit(id) {
      const database = await db();
      const store = database.transaction(COMMITS_STORE, 'readonly').objectStore(COMMITS_STORE);
      const found = await wrap(store.get(id) as IDBRequest<HistoryCommit | undefined>);
      return found ?? null;
    },
    async listCommits(kind, options = {}) {
      const database = await db();
      const store = database.transaction(COMMITS_STORE, 'readonly').objectStore(COMMITS_STORE);
      const all = await wrap(store.index(KIND_INDEX).getAll(kind) as IDBRequest<HistoryCommit[]>);
      return paginate(all, options);
    },
    async setHead(kind, id) {
      const database = await db();
      const store = database.transaction(HEADS_STORE, 'readwrite').objectStore(HEADS_STORE);
      const head: HistoryHead = { kind, commit: id };
      await wrap(store.put(head));
    },
    async deleteCommits(ids) {
      if (ids.length === 0) return;
      const database = await db();
      const store = database.transaction(COMMITS_STORE, 'readwrite').objectStore(COMMITS_STORE);
      await Promise.all(ids.map((id) => wrap(store.delete(id))));
    },
    async listKinds() {
      const database = await db();
      const store = database.transaction(HEADS_STORE, 'readonly').objectStore(HEADS_STORE);
      const all = await wrap(store.getAll() as IDBRequest<HistoryHead[]>);
      return all.map((head) => head.kind);
    },
  };
}

/* --------------------------------------------------------- canonical json -- */

/**
 * A deterministic JSON encoding: object keys sorted, no whitespace. Two
 * snapshots that are structurally identical always produce the same string
 * from this, regardless of the order their keys happened to be set in — which
 * is what makes hashing them into a stable commit id possible at all.
 *
 * Follows `JSON.stringify`'s own conventions for the edges: `undefined` object
 * values are omitted (the key disappears, exactly as `JSON.stringify` drops
 * it), `undefined` array elements and non-finite numbers become `null`. A
 * function, symbol or bigint — never a shape a real snapshot should contain —
 * becomes `null` rather than throwing, so hashing can never fail on a value
 * that slipped past whatever produced the snapshot.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  const type = typeof value;
  if (type === 'number') return Number.isFinite(value as number) ? JSON.stringify(value) : 'null';
  if (type === 'string' || type === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (type === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return 'null';
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

const toHex = (bytes: Uint8Array): string => {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
};

/** The id a commit with these contents would have. Pure — computing it never writes anything. */
export function commitId(commit: HistoryCommitInput): string {
  const canonical = canonicalJson({ kind: commit.kind, parent: commit.parent, snapshot: commit.snapshot, at: commit.at, action: commit.action });
  return toHex(sha256(new TextEncoder().encode(canonical)));
}

/* ------------------------------------------------------------- the queue -- */

let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * Serialise a write against this module's storage.
 *
 * Every mutating function below — `recordHistory`, `restore`, `label`,
 * `prune` — routes through this one queue, so two calls fired without waiting
 * for one another (a save and an auto-save landing in the same tick, say)
 * never race on reading a head and then writing a stale one back. It is a
 * single global queue rather than one per kind: simpler, and correct for the
 * write volumes a personal browser history actually sees, at the cost of
 * unrelated kinds not writing concurrently with each other either.
 *
 * One entry failing does not wedge the ones behind it — the chain moves on
 * regardless of whether the previous entry resolved or rejected — but each
 * caller still sees its own call's own result or rejection.
 */
export function queueHistoryWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/* ----------------------------------------------------------------- write -- */

/** A snapshot larger than this, canonically encoded, is refused rather than recorded. */
export const MAX_SNAPSHOT_BYTES = 262_144;

export type RecordHistoryInput = {
  kind: HistoryKind;
  label?: string;
  before: unknown;
  after: unknown;
  action: HistoryAction;
};

export type RecordHistoryResult = { recorded: true; commit: HistoryCommit } | { recorded: false; reason: 'unchanged' | 'too-large' | 'storage' };

/**
 * Record one change, if it is one.
 *
 * Resolves always — a caller can fire this after every save without wrapping
 * it in its own try/catch. Nothing is written when `before` and `after` are
 * structurally identical (`diffJson` finds no differences and did not have to
 * give up early to say so), when the new snapshot is over `MAX_SNAPSHOT_BYTES`,
 * or when the backend itself throws — a full IndexedDB quota, most likely, on
 * a real browser. Every one of those is a `{ recorded: false, reason }`, never
 * a throw.
 */
export async function recordHistory(backend: HistoryBackend, input: RecordHistoryInput): Promise<RecordHistoryResult> {
  const { kind, before, after, action } = input;
  const label = input.label ?? '';
  try {
    const { entries, truncated }: DiffResult = diffJson(before, after);
    if (entries.length === 0 && !truncated) return { recorded: false, reason: 'unchanged' };

    const canonicalAfter = canonicalJson(after);
    const size = byteLength(canonicalAfter);
    if (size > MAX_SNAPSHOT_BYTES) return { recorded: false, reason: 'too-large' };

    return await queueHistoryWrite(async () => {
      const head = await backend.getHead(kind);
      const at = Date.now();
      const id = commitId({ kind, parent: head.commit, snapshot: after, at, action });
      const commit: HistoryCommit = { id, kind, parent: head.commit, snapshot: after, at, action, label, size };
      await backend.putCommit(commit);
      await backend.setHead(kind, id);
      return { recorded: true, commit };
    });
  } catch {
    return { recorded: false, reason: 'storage' };
  }
}

/* ------------------------------------------------------------------ read -- */

/** At most this many commits come back from `history()` when the caller does not say. */
export const DEFAULT_HISTORY_LIMIT = 50;

/** However many the caller asks for, `history()` never returns more than this many at once. */
export const MAX_HISTORY_LIMIT = 200;

const clampLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_HISTORY_LIMIT;
  return Math.min(MAX_HISTORY_LIMIT, Math.max(1, Math.trunc(limit)));
};

/** The commits for one kind, newest first, bounded and optionally paged backward in time with `before`. */
export async function history(backend: HistoryBackend, kind: HistoryKind, options: { limit?: number; before?: number } = {}): Promise<HistoryCommit[]> {
  return backend.listCommits(kind, { limit: clampLimit(options.limit), before: options.before });
}

export type CommitDiff = DiffResult & { a: HistoryCommit | null; b: HistoryCommit | null };

/** The diff between two commits' snapshots, by id. A missing commit diffs as though its side were absent, rather than throwing. */
export async function diffCommits(backend: HistoryBackend, aId: string, bId: string): Promise<CommitDiff> {
  const [a, b] = await Promise.all([backend.getCommit(aId), backend.getCommit(bId)]);
  const { entries, truncated } = diffJson(a?.snapshot, b?.snapshot);
  return { entries, truncated, a, b };
}

/** How many commits of each action a kind's history holds, for the panel's action filter. An action nothing has used yet is simply absent, since the action list is open-ended — see `KNOWN_HISTORY_ACTIONS`. */
export async function actionsPresent(backend: HistoryBackend, kind: HistoryKind): Promise<Record<HistoryAction, number>> {
  const all = await backend.listCommits(kind, {});
  const counts: Record<HistoryAction, number> = {};
  for (const commit of all) counts[commit.action] = (counts[commit.action] ?? 0) + 1;
  return counts;
}

/* --------------------------------------------------------------- restore -- */

export type RestoreResult = { restored: true; commit: HistoryCommit } | { restored: false; reason: 'not-found' | 'storage' };

/**
 * Bring an old snapshot back — by writing it forward, never by rewinding.
 *
 * The new commit's parent is whatever the head currently is, not the commit
 * being restored, so the chain still shows every step that happened in
 * between. Restoring a restore is just another restore: nothing about this
 * ever moves the head backward or deletes what it passes over.
 */
export async function restore(backend: HistoryBackend, kind: HistoryKind, commitIdToRestore: string, labelText = ''): Promise<RestoreResult> {
  try {
    return await queueHistoryWrite(async () => {
      const target = await backend.getCommit(commitIdToRestore);
      if (!target || target.kind !== kind) return { restored: false, reason: 'not-found' };

      const head = await backend.getHead(kind);
      const at = Date.now();
      const action: HistoryAction = 'restore';
      const snapshot = target.snapshot;
      const id = commitId({ kind, parent: head.commit, snapshot, at, action });
      const size = byteLength(canonicalJson(snapshot));
      const commit: HistoryCommit = { id, kind, parent: head.commit, snapshot, at, action, label: labelText, size };
      await backend.putCommit(commit);
      await backend.setHead(kind, id);
      return { restored: true, commit };
    });
  } catch {
    return { restored: false, reason: 'storage' };
  }
}

/* ----------------------------------------------------------------- label -- */

export type LabelResult = { labelled: true; commit: HistoryCommit } | { labelled: false; reason: 'not-found' | 'storage' };

/**
 * Rename a commit, in place.
 *
 * `label` is the one field a commit can change after it is written — the
 * commit's id is a hash of everything else, so this cannot break the parent
 * chain that points at it, and `prune` (below) treats a labelled commit as
 * kept forever regardless of its age or position.
 */
export async function label(backend: HistoryBackend, commitIdToLabel: string, text: string): Promise<LabelResult> {
  try {
    return await queueHistoryWrite(async () => {
      const existing = await backend.getCommit(commitIdToLabel);
      if (!existing) return { labelled: false, reason: 'not-found' };
      const updated: HistoryCommit = { ...existing, label: text };
      await backend.putCommit(updated);
      return { labelled: true, commit: updated };
    });
  } catch {
    return { labelled: false, reason: 'storage' };
  }
}

/* ----------------------------------------------------------------- prune -- */

/** Kept regardless of age once retention runs, if nothing else already kept it. */
export const DEFAULT_KEEP_LAST = 200;
export const DEFAULT_KEEP_DAYS = 90;

export type PruneOptions = { keepLast?: number; keepDays?: number };
export type PruneResult = { removed: string[] };

/**
 * Enforce retention for one kind's history.
 *
 * A commit survives if *any* of these hold: it is the head, it carries a
 * non-empty label, it is one of the `keepLast` most recent commits, or it is
 * newer than `keepDays` days old. That is a deliberately generous, "any good
 * reason is enough" reading of the two knobs — the two bounds are added
 * together rather than intersected, so raising either one only ever keeps
 * more history, never less.
 */
export async function prune(backend: HistoryBackend, kind: HistoryKind, options: PruneOptions = {}): Promise<PruneResult> {
  const keepLast = Math.max(0, options.keepLast ?? DEFAULT_KEEP_LAST);
  const keepDays = Math.max(0, options.keepDays ?? DEFAULT_KEEP_DAYS);

  try {
    return await queueHistoryWrite(async () => {
      const head = await backend.getHead(kind);
      const all = await backend.listCommits(kind, {}); // newest first

      const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
      const keep = new Set<string>();
      if (head.commit) keep.add(head.commit);
      for (const commit of all.slice(0, keepLast)) keep.add(commit.id);
      for (const commit of all) {
        if (commit.label.trim().length > 0) keep.add(commit.id);
        if (commit.at >= cutoff) keep.add(commit.id);
      }

      const removed = all.filter((commit) => !keep.has(commit.id)).map((commit) => commit.id);
      if (removed.length > 0) await backend.deleteCommits(removed);
      return { removed };
    });
  } catch {
    return { removed: [] };
  }
}

/* ---------------------------------------------------------------- export -- */

/**
 * Field names redacted out of an exported snapshot, matched case-insensitively
 * as a substring of the key — `password` catches `password` and
 * `confirmPassword` alike, `key` catches `apiKey`. Broader than an exact-name
 * match on purpose: this is the one path a piece of history can leave the
 * browser by, so a false positive that redacts a harmless field is a far
 * smaller cost than a false negative that ships a real secret in a file
 * somebody hands to someone else.
 */
const SENSITIVE_NAME_FRAGMENTS = ['secret', 'password', 'pin', 'token', 'key'];

const isSensitiveKey = (key: string): boolean => {
  const lower = key.toLowerCase();
  return SENSITIVE_NAME_FRAGMENTS.some((fragment) => lower.includes(fragment));
};

/** `fp:` plus the first 8 hex characters of the SHA-256 of the value's canonical JSON — stable, but not reversible. */
function fingerprint(value: unknown): string {
  const digest = sha256(new TextEncoder().encode(canonicalJson(value)));
  return `fp:${toHex(digest).slice(0, 8)}`;
}

/**
 * Replace every sensitive-looking field in a snapshot with a fingerprint of
 * its original value, recursively. The fingerprint is deterministic — the same
 * secret always redacts to the same fingerprint — so two exported revisions
 * can still show whether a secret changed between them without ever showing
 * what it was.
 */
export function redact(snapshot: unknown): unknown {
  if (Array.isArray(snapshot)) return snapshot.map((item) => redact(item));
  if (snapshot !== null && typeof snapshot === 'object') {
    const source = snapshot as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) out[key] = isSensitiveKey(key) ? fingerprint(source[key]) : redact(source[key]);
    return out;
  }
  return snapshot;
}

export type ExportHistoryFilter = { from?: number; to?: number; actions?: readonly HistoryAction[] };

/**
 * Export a kind's history through `exportRecords`, in any format it supports.
 *
 * Every exported snapshot has already gone through `redact`. The note carried
 * into the file says so, exactly as `describeLoss` in `lib/export.ts` tells a
 * caller what a format itself cannot carry — an export should never look more
 * complete than it is.
 */
export async function exportHistory(backend: HistoryBackend, kind: HistoryKind, filter: ExportHistoryFilter, format: ExportFormat): Promise<string> {
  const all = await backend.listCommits(kind, {});
  const actions = filter.actions && filter.actions.length > 0 ? new Set(filter.actions) : null;
  const selected = all.filter((commit) => {
    if (actions && !actions.has(commit.action)) return false;
    if (filter.from !== undefined && commit.at < filter.from) return false;
    if (filter.to !== undefined && commit.at > filter.to) return false;
    return true;
  });

  const rows: ExportRecord[] = selected.map((commit) => ({
    id: commit.id,
    kind: commit.kind,
    parent: commit.parent,
    action: commit.action,
    label: commit.label,
    at: commit.at,
    size: commit.size,
    snapshot: redact(commit.snapshot),
  }));

  return exportRecords(rows, format, {
    name: `history-${kind}`,
    note: 'Fields whose name contains secret, password, pin, token or key are replaced with fp:<8 hex characters>, a fingerprint of the original value.',
  });
}
