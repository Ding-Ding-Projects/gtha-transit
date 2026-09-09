# Tabbed navigation

> **Not mounted since 9 September 2026, by owner decision.** The strip replaced the
> navigation rail and the settings sections for one deployment, made the interface a
> mess on phones and cluttered the desktop rail with per-tab manage and drag buttons,
> and the owner asked for the previous design back. The Material navigation rail, the
> phone bottom bar with its More dialog, and the base-ui settings tabs are the shipped
> navigation again ([workspaces](workspaces.md), [settings](settings.md)). The strip
> component, its state model, its registry and their tests remain in the tree unmounted,
> so a later decision can mount them without rebuilding them. Everything below
> describes the component as it exists, not what the planner shows today.

The main navigation and settings now use the same tab strip. Plan starts pinned. The tab tools provide search, reopening, docking on any edge, named groups, group colour and collapse, and previews for closing tabs containing or not containing text. Closed destinations remain available through the tab tools and command palette. School mode temporarily hides the Language tab while preserving its underlying tab arrangement.

Arrow keys follow the dock orientation; Home and End select the ends, Control with an arrow reorders, Delete closes an unpinned tab, and Shift+F10 opens tab actions. The active tab scrolls into view. Main navigation moves focus to the workspace heading. All-closed states keep the reopen control available.

The strip, group list, individual group and master searches have independent regex workbenches. Tab and group appearance actions open the shared element editor. User group names remain local.

The planner's tab strip is backed by a small, browser-local state record for each mounted surface. It remembers tab order, pinned destinations, closed destinations, groups, and the chosen dock edge. The current format is version 1 and uses the key `gtha-tabs-<surface>-v1`.

Closed destinations are deliberately retained in the record. They can be reopened from the overflow view, the master tab search, or the add-tab list. Pinned destinations always occupy the leading part of the strip and a normal close action leaves them open. A bulk close previews every affected destination first and excludes pinned destinations unless the user explicitly includes them.

## Persistence and recovery

The state is limited to 12 KiB, leaving room under the project's per-key browser storage limit. On restore, malformed or unsupported records are replaced with a fresh strip. A valid older record is reconciled with the destinations that currently exist: removed ids vanish from all strip collections, and new ids are appended open and unpinned. The active destination uses the currently active visible id when possible, then falls back to the first visible tab, or no tab if every destination is closed.

## Integration guide

`lib/tabs.ts` is React-free. Create a state with `createStripState`, pass registered destination ids to `parseStripState` on load, use reducers for every state transition, call `assertBounded` before persisting, and call `activeTab` after a close or destination-list change. `visibleTabs` supplies the renderable ids. `orientationFor` and `keyForOrientation` supply the ARIA orientation and arrow-key behaviour from the current dock.

Each mounted strip registers a live getter through `registerStrip(surface, getter)` from `lib/tab-registry.ts`, and unregisters on unmount. `searchAllTabs` then provides the master tab search with current labels, group ids, and pinned or closed state. Registration replaces a previous getter for the same surface, so remounting remains deterministic.
