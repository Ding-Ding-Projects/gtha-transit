# Local version history

Every record this app keeps about you — a saved trip, your settings, School
mode, and whatever gains its own history next — has a local, append-only
version history: every real change kept as a labelled, restorable checkpoint,
entirely in this browser.

This documents both halves: `lib/record-history.ts` and `lib/json-diff.ts`,
the logic and storage underneath the feature, and `components/history-panel.tsx`,
the panel that reads and writes them. Two call sites use it today — saved
trips and the settings workspace's language, theme and playfulness settings —
reachable from a **History** button beside the heading on each of those two
surfaces.

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

Nothing in this module deletes a commit except `forgetCommits` and `prune`,
deliberately and within the rules below. Everything else only ever adds.

**`restore` does not move the head backward.** Restoring an old snapshot
writes a brand-new commit carrying that old snapshot, with `action:
'restore'`, parented on whatever the *current* head is — never on the commit
being restored. That is what makes it safe to restore something and then
change your mind: restoring a restore is just another restore, appended the
same way, and the state you restored *from* is still sitting right there in
the chain rather than thrown away to make room. The panel's own **Restore**
button applies the restored snapshot back to the live surface (the saved
trips list, or the settings that produced it) the moment it lands.

## Labels are the one mutable field

A commit's id hashes `{ kind, parent, snapshot, at, action }` — deliberately
not `label`. That is what makes `label()` safe: renaming a commit after the
fact never changes its id, never breaks a child commit's `parent` pointer to
it, and never needs the rest of the chain to be touched. Every other field on
a written commit is fixed for good. The panel exposes this as a plain text
field on every row; it saves on blur, when the text actually changed.

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
  `restore`, `label`, `prune` and `forgetCommits` — every mutating function in
  this module resolves to a result object on failure rather than rejecting.

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
of what the two numbers say. Nothing in the application calls `prune`
automatically yet; it remains available for a future retention sweep.

## Forgetting specific revisions

`forgetCommits(backend, kind, ids)` is the panel's own bulk "forget" action —
the counterpart to `prune`'s age/rank retention, aimed instead at whatever a
person selected in the panel. It deletes exactly the ids it is given, with
one exception: **the current head is always refused**, reported back as
`{ removed: [...], skipped: [{ id, reason: 'head' }] }` rather than silently
dropped from the request. A history with no head cannot record its next real
change against anything, since every write reads the head to find its
parent.

The panel gates this behind the same two-key, full-slider destructive
confirmation (`SuperConfirm`) every other irreversible bulk action in this
codebase uses, and the same bulk-selection preview
(`lib/list-selection.ts#previewBulk`) that separates "selected" from "will
actually change" — here, the one thing that never changes is the head, and
the preview's skip reason says so.

## Redaction on export

The panel's export button runs every selected commit's snapshot through
`redact` (the same function `exportHistory` uses) before handing it to
`exportRecords` (`lib/export.ts`), in any of its eleven formats.

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

`exportHistory(backend, kind, { from, to, actions }, format)` remains
available for a caller that wants a whole kind's history by date/action
filter rather than by an on-screen selection; the panel builds its own export
rows directly from what is loaded and selected, through the same `redact`.

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
absent, rather than throwing. The panel does not call `diffCommits`: every
commit it has loaded already carries its own `snapshot`, so it diffs a
revision against its parent's already-loaded snapshot directly with
`diffJson`, and says plainly when the parent fell outside the loaded window
instead of guessing.

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

`defaultHistoryBackend()` is the one backend the whole page shares: the saved
trips history opener and the settings history opener both call it and get the
same instance, rather than each opening its own `indexedDB.open()` connection
to the same database. It resolves the fallback exactly once, on first use.

## Serialised writes

`queueHistoryWrite(fn)` is a single global queue: every mutating operation in
this module — recording, restoring, labelling, pruning, forgetting — runs one
at a time through it, so two writes fired without awaiting one another (a
save and an auto-save landing in the same tick) never both read the same head
and write a forked or stale one back. It is one queue for the whole module
rather than one per kind — simpler, and correct for the write volumes a
personal history actually sees, at the cost of writes to unrelated kinds not
running concurrently with each other either. One entry failing does not
wedge the ones behind it; each caller still sees its own call's own result.

## Wiring: what calls `recordHistory` today

`app/page.tsx` keeps one baseline ref per wired kind (`savedHistoryBaseline`,
`preferencesHistoryBaseline`), set once from the browser's own restored state
on hydration without writing a commit, then diffed against on every later
change through the same effects that already persist that state to
`localStorage`:

- **`saved-trips`** — every add or removal of a saved trip. The whole trips
  array is the snapshot, so a revision is "the saved list as it stood", and
  the action recorded is `save` when the list grew and `delete` when it
  shrank.
- **`preferences`** — `{ lang, dark, funEn, funZh }` from the settings
  workspace, recorded as `settings-change`. Appearance, narrator, comfort
  modes, vehicle criteria and other settings are not yet wired to their own
  history kind; `KNOWN_HISTORY_KINDS` already names `appearance` for the day
  that changes.

Restoring from either panel updates its baseline ref *before* applying the
restored value, so the very effect that would otherwise notice "the state
changed" sees no difference from its own new baseline and does not write a
second, redundant commit on top of the one `HistoryPanel` already wrote for
the restore itself.

## The panel

`components/history-panel.tsx` is one panel, parameterised by `kind`, reused
for both wired surfaces. It follows the shape `components/notification-centre.tsx`
already established for a searchable, filterable, bulk-actionable, exportable
list in this codebase, with what is specific to a commit history layered on
top:

- **Search**, through the shared `SearchWorkbench` (plain text by default,
  the regular-expression builder beside it), matching each revision's label
  and action.
- **Filter by action**, showing only the actions present in the loaded
  window, each with a live count.
- **A date range**, by the commit's own Toronto calendar day.
- **Multi-select, with select-all saying which all it means** — "select
  these N" (the loaded page) and "select every match (N)" are the same two
  honest answers `lib/list-selection.ts` already gives every other list here.
- **A preview that separates what is selected from what will change** — here,
  the one thing that never changes under a bulk action is the current
  revision.
- **Export**, in the same eleven formats every other export in this app
  offers, redacted the same way `exportHistory` redacts.
- **A diff toggle per row**, showing what changed against the previous
  revision, with added/removed/changed counts and a bounded, truncation-aware
  entry list.
- **An editable label per row.**
- **Restore**, disabled on the current revision (there is nothing to restore
  it to).
- **Forget, gated behind the two-key destructive confirmation**, disabled
  when nothing selected can be forgotten.

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
commits and the most recent N while removing the rest, `forgetCommits`
deleting exactly the ids it is given while always refusing the current head,
`diffCommits` against real and missing ids, `defaultHistoryBackend` returning
one shared working instance, and `actionsPresent`'s counts. Backend-agnostic
behaviour — the size limit, a backend that throws, export and redaction,
canonical JSON's key ordering, and `commitId`'s stability — is tested once
against `memoryBackend()` or a deliberately broken hand-written backend.

`tests/history-panel.test.mjs` — the panel's own pure filtering and
formatting logic in `lib/history-panel.ts`: the Toronto calendar day a
commit belongs to, the searchable sample text a commit produces, an
action/date/search filter narrowing a commit list correctly on its own and
combined with the others, and the per-action counts and first-seen action
list a filter row renders from.

Four invariants were broken on purpose and watched go red, then restored and
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
- **`forgetCommits` deleted the current head when it was named in the
  request.** "forgetCommits refuses to delete the current head, and says
  why" failed: the head disappeared from the remaining history and the head
  pointer itself was left dangling.
- **`filterCommits`'s date-range lower bound was disabled.** Both
  "filterCommits narrows by date range, inclusive of both ends" and the
  combined action/date/search test failed, each keeping a commit that was
  well before the requested `from` day.

## What is not done

- **Not every kind is wired.** `appearance`, `tabs`, `notifications`,
  `school-mode`, `authenticator` and `locks` are named in
  `KNOWN_HISTORY_KINDS` and ready for a caller; nothing writes to them yet.
- **`prune` is never called automatically.** Retention exists and is tested,
  but nothing in the running application schedules it, so a very long-lived
  browser profile's history for a wired kind grows without an automatic
  sweep. `forgetCommits` covers the deliberate case; an automatic one remains
  future work.
- **No built-artifact captures.** The panel has focused logic tests and typed
  integration, but no screenshot evidence from a real running build yet.
