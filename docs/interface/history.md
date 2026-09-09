# Local version history

Every record this app keeps about you — a saved trip, your settings, School
mode, and whatever gains its own history next — can have a local, append-only
version history: every real change kept as a labelled, restorable checkpoint,
entirely in this browser.

This page documents `lib/record-history.ts` and `lib/json-diff.ts`, the logic
and storage underneath that feature. **The panel that reads them, and the
call sites that write to them from a save, a settings change, a rename, are
not built yet.** What is here is complete and tested on its own; nothing in
the app calls it yet.

## Git-shaped, honestly not Git

Every commit is content-addressed — its id is the SHA-256 hash of its own
contents — and carries a `parent`, so one record's history is a hash-linked
chain in exactly the shape a Git branch is. That is where the resemblance
stops on purpose.

There is no remote, no clone, no account, and no network request anywhere in
this module. Every commit lives in this browser's own `gtha-history-v1`
IndexedDB database and never leaves it, the same way a saved trip or a
setting never leaves it. Calling this "Git" would promise sync and conflict
resolution across devices that nothing here builds. What it borrows from Git
is the shape of a hash-linked, content-addressed history — not the network
model around it.

A commit's id is the SHA-256 of the canonical JSON encoding of exactly five
fields: `{ kind, parent, snapshot, at, action }`. `canonicalJson` sorts object
keys so the same content always hashes the same way regardless of the order
its keys happened to be set in, which is what makes the id stable and
verifiable rather than an opaque random token.

## Append-only, and restoring never rewinds

Nothing in this module deletes a commit except `prune`, deliberately and
within the retention rules below. Everything else only ever adds.

**`restore` does not move the head backward.** Restoring an old snapshot
writes a brand-new commit carrying that old snapshot, with `action:
'restore'`, parented on whatever the *current* head is — never on the commit
being restored. That is what makes it safe to restore something and then
change your mind: restoring a restore is just another restore, appended the
same way, and the state you restored *from* is still sitting right there in
the chain rather than thrown away to make room.

## Labels are the one mutable field

A commit's id hashes `{ kind, parent, snapshot, at, action }` — deliberately
not `label`. That is what makes `label()` safe: renaming a commit after the
fact never changes its id, never breaks a child commit's `parent` pointer to
it, and never needs the rest of the chain to be touched. Every other field on
a written commit is fixed for good.

## What gets recorded, and what does not

`recordHistory(backend, { kind, label, before, after, action })` resolves
always; nothing about calling it after a save needs its own try/catch.

- **Nothing is written when nothing changed.** `before` and `after` go through
  `diffJson` (see below); if it finds no differences — and did not have to
  give up early to say so — the call returns `{ recorded: false, reason:
  'unchanged' }` and touches storage not at all.
- **A snapshot over 262,144 bytes (`MAX_SNAPSHOT_BYTES`), canonically encoded,
  is refused**: `{ recorded: false, reason: 'too-large' }`. One runaway record
  should not be able to spend the whole IndexedDB budget this browser gives
  the app.
- **A backend failure never throws.** A full IndexedDB quota, a browser that
  has refused storage mid-session, or any other backend error is caught and
  reported as `{ recorded: false, reason: 'storage' }`. The same is true of
  `restore`, `label` and `prune` — every mutating function in this module
  resolves to a result object on failure rather than rejecting.

## Retention

`prune(backend, kind, { keepLast, keepDays })` — defaults `keepLast: 200`,
`keepDays: 90` — removes commits for one kind down to what those two numbers
and two hard rules keep. A commit survives if *any* of the following hold:

- it is the current head;
- it carries a non-empty label;
- it is among the `keepLast` most recent commits by rank;
- it is newer than `keepDays` days old.

That is a deliberately generous, any-good-reason-is-enough reading: the two
numeric bounds are added together, not intersected, so raising either one
only ever keeps more history, never less, and a commit is never removed for
being merely *old* if it is also recent by rank, or merely low-ranked if it
is also recent by age. The head and every labelled commit are kept regardless
of what the two numbers say.

## Redaction on export

`exportHistory(backend, kind, { from, to, actions }, format)` runs every
selected commit through `exportRecords` (`lib/export.ts`), in any of its
eleven formats, after first running each snapshot through `redact`.

`redact` walks a snapshot recursively and replaces the value of any field
whose name — case-insensitively, as a substring — contains `secret`,
`password`, `pin`, `token` or `key` with `fp:` followed by the first 8 hex
characters of the SHA-256 of that value's canonical JSON. `apiKey` and
`authToken` are caught by this the same as `password` is; the match is
broader than an exact field name on purpose, because this is the one path a
piece of history can leave the browser by, and a false positive that
over-redacts an unimportant field costs far less than a false negative that
ships a real secret in a file somebody hands to someone else. The fingerprint
is deterministic, so two exported revisions can still show *that* a secret
changed between them without ever showing what either one was.

The exported file's own note field says this happened, in the file, so an
export never looks more complete than it is — the same honesty
`describeLoss` already asks of every format in `lib/export.ts`.

## What a diff is

`diffJson(before, after, path?)` (`lib/json-diff.ts`) is the structural diff
one commit's snapshot to another's — or `before`/`after` generally — walks
into. It compares objects key by key and arrays index by index, and reports
every leaf that was added, removed or changed at a stable path such as
`a.b[2].c`. A value whose *shape* changed — an object where an array used to
be, say — is one `changed` entry for the whole node rather than a torn-open
subtree of synthetic adds and removes, since the two sides no longer
correspond key for key.

It is bounded: 32 levels of nesting, 2,000 recorded entries. Past either
bound it stops and reports `truncated: true` rather than a partial answer
that looks complete. `recordHistory`'s own "did anything change" check treats
a truncated *empty* result as "yes, something changed" rather than risking a
false "unchanged" — a truncated walk found nothing only because it gave up,
not because there was nothing to find.

`diffCommits(backend, aId, bId)` is `diffJson` applied to two commits' own
snapshots by id; a missing commit diffs as though its side were simply
absent, rather than throwing.

## Storage, and what happens when it is refused

`indexedDbBackend()` opens `gtha-history-v1` in this browser's IndexedDB: one
`commits` store keyed by commit id, with a single-field index on `kind`, and
one `heads` store keyed by kind. A personal, per-browser history for one
record kind is small enough that fetching by that index and sorting and
paging the result by `at` in this module is simpler than a compound
`kind`+`at` index, and answers exactly the same queries.

When this origin has no `indexedDB` at all, `indexedDbBackend()` returns
`null` rather than a backend that would fail on its first real call — a
caller checks for that and falls back to `memoryBackend()`, an in-memory
implementation of the same `HistoryBackend` interface that keeps history only
for the lifetime of the page. Both implementations share one pagination
helper, so `history()`'s newest-first ordering and `before`/`limit`
semantics read identically regardless of which one is answering.

## Serialised writes

`queueHistoryWrite(fn)` is a single global queue: every mutating operation in
this module — recording, restoring, labelling, pruning — runs one at a time
through it, so two writes fired without awaiting one another (a save and an
auto-save landing in the same tick) never both read the same head and write a
forked or stale one back. It is one queue for the whole module rather than
one per kind — simpler, and correct for the write volumes a personal history
actually sees, at the cost of writes to unrelated kinds not running
concurrently with each other either. One entry failing does not wedge the
ones behind it; each caller still sees its own call's own result.

## Verification

`tests/json-diff.test.mjs` — structural diffs at nested paths, arrays
compared by index, a shape mismatch collapsing to one `changed` entry, `null`
handled distinctly from both an object and a missing key, `NaN` compared
correctly, the depth and entry bounds each producing `truncated: true` (and
each *not* firing when the input is well within them), and `summariseDiff`'s
counts.

`tests/record-history.test.mjs` — the scenarios that should hold for either
storage backend run against both `memoryBackend()` and `indexedDbBackend()`
(backed by the hand-written stub in `tests/helpers/indexeddb-stub.mjs`):
the first record creating a head, an identical snapshot recording nothing,
the parent chain growing with real changes, twenty concurrent
`recordHistory` calls still producing one linear chain with no fork or
orphan, restore always writing forward and never rewinding (including
against an unknown commit id and a commit id from the wrong kind), labels
sticking without changing the commit id, prune keeping the head, labelled
commits and the most recent N while removing the rest, `diffCommits` against
real and missing ids, and `actionsPresent`'s counts. Backend-agnostic
behaviour — the size limit, a backend that throws, export and redaction,
canonical JSON's key ordering, and `commitId`'s stability — is tested once
against `memoryBackend()` or a deliberately broken hand-written backend.

Two invariants were broken on purpose and watched go red, then restored and
watched go green, before this was trusted:

- **`restore` pointed the head at the old commit instead of writing a new
  one.** The "restore writes a new commit... it never rewinds the head" test
  failed immediately: the restored commit's id no longer differed from the
  original, and the chain-length assertion caught that nothing new had been
  appended.
- **`prune` dropped a labelled commit along with the rest of the old ones.**
  Both the dedicated "never removes a labelled commit even when it is the
  oldest of all" test and the combined retention test failed, each reporting
  the labelled commit's id missing from what remained.

## What is not done

- **No panel.** Nothing renders this history, diffs it, offers restore, or
  lets somebody type a label. That is the next piece of work this file makes
  possible, not something this file does.
- **No call sites.** Nothing in the app calls `recordHistory` yet — not saved
  trips, not settings, not School mode, not tabs. Every kind in
  `KNOWN_HISTORY_KINDS` is a name this module is ready for, not a feature
  that is wired up.
- **No date-range or action-filter UI**, though `exportHistory` already
  accepts both and `actionsPresent` already gives a filter panel real counts
  to render once one exists.
- **No captures.** There is no built surface yet to capture.
