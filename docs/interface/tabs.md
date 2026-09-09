# Tabbed navigation

The planner's tab strip is backed by a small, browser-local state record for each mounted surface. It remembers tab order, pinned destinations, closed destinations, groups, and the chosen dock edge. The current format is version 1 and uses the key `gtha-tabs-<surface>-v1`.

Closed destinations are deliberately retained in the record. They can be reopened from the overflow view, the master tab search, or the add-tab list. Pinned destinations always occupy the leading part of the strip and a normal close action leaves them open. A bulk close previews every affected destination first and excludes pinned destinations unless the user explicitly includes them.

## Persistence and recovery

The state is limited to 12 KiB, leaving room under the project's per-key browser storage limit. On restore, malformed or unsupported records are replaced with a fresh strip. A valid older record is reconciled with the destinations that currently exist: removed ids vanish from all strip collections, and new ids are appended open and unpinned. The active destination uses the currently active visible id when possible, then falls back to the first visible tab, or no tab if every destination is closed.

## Integration guide

`lib/tabs.ts` is React-free. Create a state with `createStripState`, pass registered destination ids to `parseStripState` on load, use reducers for every state transition, call `assertBounded` before persisting, and call `activeTab` after a close or destination-list change. `visibleTabs` supplies the renderable ids. `orientationFor` and `keyForOrientation` supply the ARIA orientation and arrow-key behaviour from the current dock.

Each mounted strip registers a live getter through `registerStrip(surface, getter)` from `lib/tab-registry.ts`, and unregisters on unmount. `searchAllTabs` then provides the master tab search with current labels, group ids, and pinned or closed state. Registration replaces a previous getter for the same surface, so remounting remains deterministic.
