# Tabbed navigation

The tab strip component itself — the rendered element a person clicks, drags,
and navigates with a keyboard — is **not yet built**. What exists and is
tested is the layer underneath it: a pure state model (`lib/tabs.ts`) and a
cross-strip registry (`lib/tab-registry.ts`) that the eventual component will
be built against. Nothing below describes rendered behaviour; it describes the
data contract.

## The state record

Each surface that will eventually mount a strip gets its own `TabStripState`:
an id order, a pinned subset, a closed subset, a list of groups, and a dock
edge. Three invariants hold across every function in `lib/tabs.ts`:

- **The pinned region is always a prefix of `order`.** `state.pinned` is not
  just a membership test; it is the exact sequence of ids occupying
  `order.slice(0, state.pinned.length)`.
- **A closed tab stays in `order`.** It is not removed, only listed in
  `state.closed`; `visibleTabs` is the one place that subtracts the two, so
  reopening a tab is just removing its id from `closed`, not reconstructing
  where it used to sit.
- **A tab belongs to at most one group.** `moveIntoGroup` removes a tab from
  every other group before adding it to the target.

`TabDock` is one of `'left' | 'right' | 'top' | 'bottom'`. `DEFAULT_DOCK` is
`'left'`.

## Persistence and recovery

`STRIP_KEY(surface)` returns `` `gtha-tabs-${surface}-v1` ``, so each surface's
record lives under its own storage key and the `v1` segment is free to become
`v2` if the shape ever changes incompatibly.

`assertBounded(state)` throws once `serializeStripState(state)` — plain
`JSON.stringify` — exceeds `MAX_STRIP_BYTES`, which is `12_288` (exactly 12
KiB). That is well under the browser's 16 KiB limit per storage key, so a
strip that has accumulated an unreasonable number of groups or very long ids
is caught by `assertBounded` long before storage itself would reject the
write.

`parseStripState(text, surface, ids)` restores a record, or calls
`createStripState(surface, ids)` for a fresh one, whenever `text` is `null`,
unparsable JSON, not an object, carries a `version` other than `1`, has the
wrong shape for `order`, `pinned`, `closed` or `groups`, contains a
structurally invalid group, or names a `dock` outside the four known values.
`surface` always comes from the caller, never from whatever the stored record
claims — the storage key already namespaces by surface, so a record handed to
this function is either for that surface or should not have been handed to
it. A structurally valid record is still normalized (repairing, for example,
a pinned id that is not actually a prefix of `order`, or a tab claimed by two
groups at once, where the first group listed keeps it) and then reconciled
against the current `ids` before it is returned.

`reconcile(state, ids)` adapts a strip to the destinations that currently
exist: an id not seen before is appended to the end of `order`, unpinned,
open and in no group; an id no longer present is removed from `order`,
`pinned`, `closed`, and every group's `members`. Everything else — pin state,
closed state, group identity, colour, collapsed state, and dock — survives
untouched.

## State transitions

`lib/tabs.ts` is React-free: every exported function takes a `TabStripState`
and returns a new one, and nothing here knows what a pixel is.

- **Construction** — `createStripState(surface, ids, { pinned?, dock? })`,
  `reconcile(state, ids)`.
- **Ordering** — `reorder(state, id, toIndex)`, clamped to the tab's own
  pinned-or-unpinned region so a reorder can never cross that boundary;
  `moveRelative(state, id, delta)`, a relative shift within the same region.
- **Pin state** — `pin(state, id)` and `unpin(state, id)`, both idempotent.
  Pinning moves a tab to the end of the pinned region; unpinning moves it to
  the start of the unpinned region.
- **Open and closed state** — `close(state, id)` (silently refused for a
  pinned or unknown id), `reopen(state, id)`, `visibleTabs(state)`, and
  `activeTab(state, activeId)`, which keeps `activeId` while it is still
  visible and otherwise falls back to the first visible tab, or `null` when
  none are open.
- **Groups** — `createGroup(state, { id, name, colour?, members? })`,
  `renameGroup`, `recolourGroup`, `collapseGroup`,
  `removeGroup(state, id, { keepMembers: true })` (there is no mode that
  deletes the member tabs, only the grouping over them),
  `moveIntoGroup(state, tabId, groupId | null)`, `groupsInOrder(state)`
  (sorted by each group's earliest surviving member; a group with no members
  sorts after every anchored group, in creation order), `reorderGroup(state,
  groupId, toIndex)` (moves a group's whole block without disturbing any
  ungrouped tab, and refuses a move that would land an unpinned member ahead
  of a pinned tab), and `pinGroup(state, groupId)` (pins every member,
  contiguously, in the group's own member order).
- **Dock** — `setDock(state, dock)`.

## Overflow

`overflowSplit(measurements, available, pinnedIds)` splits a list of
`{ id, size }` measurements into `{ visible, overflow }`. The caller supplies
widths for a horizontal strip (top or bottom dock) or heights for a vertical
one (left or right dock); the function itself is axis-agnostic.

- **Pinned tabs are always visible, first**, in the order given, even if
  their combined size alone exceeds `available`. Pinned means pinned, not
  pinned-until-crowded.
- **Unpinned tabs are then accepted in sequence by cumulative size.** The
  moment one would push the running total past `available`, that tab and
  every unpinned tab after it overflow too — even a smaller, later tab that
  would have fit on its own — because a real strip cannot skip over a tab
  without reordering what is on screen.

## Keyboard axis mapping

`orientationFor(dock)` returns `'horizontal'` for `top` and `bottom`, and
`'vertical'` for `left` and `right`. `keyForOrientation(dock, key)` translates
a physical key into a logical `TabStripKeyAction` (`'previous' | 'next' |
'home' | 'end'`), or `null` when this dock does not claim that key — the
caller lets an unclaimed key do whatever it would otherwise do (scroll the
page, for instance) rather than eating it.

| Dock | Orientation | Previous | Next | Unclaimed |
| --- | --- | --- | --- | --- |
| `left`, `right` | vertical | <kbd>↑</kbd> | <kbd>↓</kbd> | <kbd>←</kbd> <kbd>→</kbd> |
| `top`, `bottom` | horizontal | <kbd>←</kbd> | <kbd>→</kbd> | <kbd>↑</kbd> <kbd>↓</kbd> |

<kbd>Home</kbd> and <kbd>End</kbd> map to `'home'` and `'end'` on every dock,
regardless of orientation. Any other key returns `null`.

## Bulk close

`bulkClosePredicate(query)` takes a `BulkCloseQuery` — `{ query, mode: 'plain'
| 'regex', flags?, negate }` — and returns a `(label: string) => boolean`, or
`null`. **A `null` result means the query never runs**: this happens when the
query fails the workspace's own `validateSearchInput` (over the length bound,
or an unrecognized or duplicated regex flag) or, in regex mode only, when the
pattern does not compile.

- **Plain mode** delegates to `plainTextMatches`, the exact matcher every
  other search bar in the workspace uses, so a bulk-close query can never
  disagree with the search bar next to it.
- **Regex mode** compiles a bounded `RegExp` and resets `lastIndex` to `0`
  before every test, so a global (`g`) or sticky (`y`) flag cannot leave the
  match silently skipping labels across repeated calls.
- **`negate` is applied last**, so the negated predicate is always the exact
  logical complement of the positive one for every label, never an
  independently-built inverse that could drift from it.

`previewBulkClose(state, tabs, predicate, { includePinned })` reports what a
bulk close would do before it does it, as a `BulkClosePreview` — `{ affected,
skipped, scope: 'strip' }`, where each skipped entry names an id and a reason
(`'pinned' | 'already-closed' | 'locked'`).

- A `null` predicate previews as empty — the same as never having been asked.
- A tab the predicate does not match takes no part in the preview: it is
  neither affected nor skipped.
- Among tabs the predicate does match, reasons are checked in this order: an
  id this strip does not track at all is `'locked'`; an already-closed id is
  `'already-closed'`; a pinned id is `'pinned'` unless `includePinned` is
  `true`, in which case it becomes `affected` like any other match. Locked is
  checked first so an untracked id is never mistaken for an ordinary affected
  tab just because it is absent from both `closed` and `pinned`.

`applyBulkClose(state, preview)` adds `preview.affected` straight to
`state.closed`, bypassing the single-tab `close()`'s refusal to close a
pinned tab — the preview already decided, through `includePinned`, that a
pinned tab in `affected` is meant to close. `pinned` itself is untouched, so a
bulk-closed pinned tab reopens back into its pinned position. Applying a
preview with nothing left to close is a referential no-op.

## Cross-strip registry and search

`lib/tab-registry.ts` is the one piece of module-level mutable state in this
pair of files; `lib/tabs.ts` stays a pure reducer set. The registry exists so
a master tab search can be built without any one strip knowing the others
exist, the same way the destinations registry backs the command palette's
destination search.

- `registerStrip(surface, getter)` registers, or replaces, the getter for a
  surface. A `StripGetter` is a zero-argument function returning a
  `StripSnapshot` — `{ tabs: TabDescriptor[], state: TabStripState }` — read
  fresh on every call rather than a snapshot taken at registration time, so a
  tab pinned a moment ago shows as pinned the next time somebody searches.
  **Registering an already-registered surface replaces its getter; it does
  not create a second entry, and it does not move the surface's position in
  `allStrips()`.**
- `unregisterStrip(surface)` removes a surface. Calling it for a surface that
  was never registered, or already removed, is a no-op.
- `allStrips(): string[]` lists every currently registered surface, in
  registration order.
- `searchAllTabs(matches)` takes a plain `(label: string) => boolean` —
  ordinarily the same matcher every other search bar in the workspace builds,
  though the function itself does not require that — and walks every
  registered strip's current snapshot, returning one `TabSearchResult` per
  tab whose label `matches` accepts: `{ surface, id, label, group, pinned,
  closed }`. `group` is the id of the group containing that tab, or `null`
  when the tab is in no group; `pinned` and `closed` are read straight from
  that strip's `state.pinned` and `state.closed`.

A test file that registers a strip is expected to unregister it when done,
since tests within one file share this one module instance.

## Verification

`tests/tabs.test.mjs`, 63 checks, covers the pure state model in
`lib/tabs.ts`: construction, reconciliation, ordering and the pinned/unpinned
boundary, pin/unpin, close/reopen, groups and group ordering, dock, bulk
close (predicate, preview, apply), the keyboard axis mapping, persistence
(bounds, round-tripping, and recovery from missing, unreadable, wrong-version
or tampered records), and overflow splitting.

`tests/tab-registry.test.mjs`, 7 checks, covers `lib/tab-registry.ts` in
isolation: registration and unregistration (including that unregistering an
unknown surface does not throw); that `allStrips()` reflects registration
order and does not reorder a surface when it is registered a second time;
that `searchAllTabs` reports the full result shape — surface, id, label,
group, pinned, closed — across two simultaneously registered strips,
including a pinned tab, a grouped tab and a closed tab; that unregistering a
strip removes its tabs from every later search; and that registering the
same surface twice replaces its getter rather than duplicating the entry.

Run both together with `node --test tests/tabs.test.mjs
tests/tab-registry.test.mjs` — 70 checks, all passing. Neither file needs a
browser, a build, or the strip component, which does not exist yet.
