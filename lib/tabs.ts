/**
 * The tab strip model: the state and the reducers over it, with nothing else in it.
 *
 * The rail is going away in favour of a browser-style strip that docks to any
 * edge of the workspace, and the same strip is reused verbatim for the settings
 * workspace's own sections. Two surfaces sharing one component only works if the
 * thing the component renders is a plain data structure neither surface has to
 * special-case -- so this module has no DOM, no React, and no dependency on
 * where it is rendered. Every function here takes a `TabStripState` and returns
 * a new one; nothing is mutated in place, and nothing here knows what a pixel is.
 *
 * Three invariants are load-bearing and worth stating once rather than
 * rediscovering in each function below.
 *
 * **The pinned region is always a prefix of `order`.** `state.pinned` is not just
 * a set membership test; it is the exact sequence of ids occupying
 * `order.slice(0, state.pinned.length)`. Every function that touches `order`
 * keeps that true, so a caller can always find "the pinned tabs, in the order
 * they are pinned" without a second lookup, and a reorder can never smuggle an
 * unpinned tab ahead of a pinned one.
 *
 * **A closed tab is not a forgotten one.** It stays in `order` and is listed in
 * `closed`; `visibleTabs` is the only place that subtracts the two. Reopening is
 * therefore just removing an id from one array, not reconstructing where the tab
 * used to sit.
 *
 * **A tab belongs to at most one group.** `moveIntoGroup` enforces this by
 * removing the id from every other group before adding it to the target, so the
 * group list never needs to be scanned to find where a tab "really" lives.
 *
 * Bulk close reuses the workbench's own `plainTextMatches` and
 * `validateSearchInput` rather than a private matcher, for the same reason the
 * command palette does: a bulk-close query and the search bar six inches away
 * from it must answer identically to the same text.
 */

import type { SearchState } from './search-workbench';
import { plainTextMatches, validateSearchInput } from './search-workbench.ts';

/* ------------------------------------------------------------------ types -- */

export const TAB_DOCKS = ['left', 'right', 'top', 'bottom'] as const;
export type TabDock = (typeof TAB_DOCKS)[number];

/** Left is the default: a screen is wider than it is tall, and a vertical strip shows more tabs legibly than a horizontal one. */
export const DEFAULT_DOCK: TabDock = 'left';

export type TabGroup = {
  id: string;
  name: string;
  colour: string | null;
  collapsed: boolean;
  /** Ids of the tabs in this group. A tab appears in at most one group's members. */
  members: string[];
};

export type TabStripState = {
  version: 1;
  surface: string;
  /** Every known id, pinned region first, in render order. */
  order: string[];
  /** Pinned ids, in the exact sequence they occupy at the start of `order`. */
  pinned: string[];
  /** Ids that are closed. They remain in `order`; `visibleTabs` filters them out. */
  closed: string[];
  groups: TabGroup[];
  dock: TabDock;
};

/** Labels are supplied by the caller at render time; the model stores ids only. */
export type TabDescriptor = {
  id: string;
  label: string;
};

export type Orientation = 'horizontal' | 'vertical';

export type TabStripKeyAction = 'previous' | 'next' | 'home' | 'end';

export type LabelPredicate = (label: string) => boolean;

export type BulkCloseQuery = {
  query: string;
  mode: 'plain' | 'regex';
  flags?: string;
  negate: boolean;
};

export type BulkCloseSkipReason = 'pinned' | 'already-closed' | 'locked';

export type BulkCloseSkip = {
  id: string;
  reason: BulkCloseSkipReason;
};

export type BulkClosePreview = {
  /** Ids that will actually close. */
  affected: string[];
  /** Ids the query matched but that will not close, and why. */
  skipped: BulkCloseSkip[];
  scope: 'strip';
};

export type BulkCloseOptions = {
  includePinned: boolean;
};

export type TabMeasurement = {
  id: string;
  size: number;
};

export type OverflowSplit = {
  visible: string[];
  overflow: string[];
};

/* --------------------------------------------------------------- helpers -- */

function dedupe(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function moveWithinArray<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/* --------------------------------------------------------- constructing --- */

export function createStripState(
  surface: string,
  ids: readonly string[],
  options: { pinned?: readonly string[]; dock?: TabDock } = {},
): TabStripState {
  const known = dedupe(ids);
  const requestedPinned = new Set(options.pinned ?? []);
  const pinned = known.filter((id) => requestedPinned.has(id));
  const unpinned = known.filter((id) => !requestedPinned.has(id));
  return {
    version: 1,
    surface,
    order: [...pinned, ...unpinned],
    pinned,
    closed: [],
    groups: [],
    dock: options.dock ?? DEFAULT_DOCK,
  };
}

/**
 * Adapt a strip to the destinations that actually exist right now.
 *
 * A newly registered id joins the end of `order` (unpinned, open, ungrouped); an
 * id that no longer exists is dropped from every array that mentions it,
 * including group membership. Everything else -- pin state, closed state, group
 * membership and colour, dock -- survives untouched.
 */
export function reconcile(state: TabStripState, ids: readonly string[]): TabStripState {
  const knownIds = dedupe(ids);
  const known = new Set(knownIds);
  const survivingOrder = state.order.filter((id) => known.has(id));
  const freshIds = knownIds.filter((id) => !state.order.includes(id));
  const pinned = state.pinned.filter((id) => known.has(id));
  const pinnedSet = new Set(pinned);
  const order = [...pinned, ...survivingOrder.filter((id) => !pinnedSet.has(id)), ...freshIds];
  const closed = state.closed.filter((id) => known.has(id));
  const groups = state.groups.map((group) => ({ ...group, members: group.members.filter((id) => known.has(id)) }));
  return { ...state, order, pinned, closed, groups };
}

/* -------------------------------------------------------------- ordering -- */

/**
 * Move a tab to `toIndex`, read as a position in the full `order` array and then
 * clamped to the region -- pinned or unpinned -- that tab already belongs to.
 * The move can never cross the boundary: clamping happens against that region's
 * own bounds, not the whole array's, so an unpinned tab cannot be dragged ahead
 * of the last pinned one no matter how small `toIndex` is.
 */
export function reorder(state: TabStripState, id: string, toIndex: number): TabStripState {
  const pinnedCount = state.pinned.length;
  const isPinned = state.pinned.includes(id);
  const regionStart = isPinned ? 0 : pinnedCount;
  const regionEnd = isPinned ? pinnedCount : state.order.length;
  const region = state.order.slice(regionStart, regionEnd);
  const from = region.indexOf(id);
  if (from === -1) return state;
  const localTarget = Math.max(0, Math.min(region.length - 1, toIndex - regionStart));
  if (localTarget === from) return state;
  const nextRegion = moveWithinArray(region, from, localTarget);
  const order = [...state.order.slice(0, regionStart), ...nextRegion, ...state.order.slice(regionEnd)];
  return { ...state, order, pinned: isPinned ? nextRegion : state.pinned };
}

/** Move a tab by `delta` positions within its own region. Negative moves it earlier. */
export function moveRelative(state: TabStripState, id: string, delta: number): TabStripState {
  const index = state.order.indexOf(id);
  if (index === -1) return state;
  return reorder(state, id, index + delta);
}

/** Pin a tab: it joins the end of the pinned region. Already pinned is a no-op. */
export function pin(state: TabStripState, id: string): TabStripState {
  if (!state.order.includes(id)) return state;
  if (state.pinned.includes(id)) return state;
  const withoutId = state.order.filter((existing) => existing !== id);
  const pinnedCount = state.pinned.length;
  const order = [...withoutId.slice(0, pinnedCount), id, ...withoutId.slice(pinnedCount)];
  return { ...state, order, pinned: [...state.pinned, id] };
}

/** Unpin a tab: it joins the start of the unpinned region. Already unpinned is a no-op. */
export function unpin(state: TabStripState, id: string): TabStripState {
  if (!state.pinned.includes(id)) return state;
  const withoutId = state.order.filter((existing) => existing !== id);
  const remainingPinnedCount = state.pinned.length - 1;
  const order = [...withoutId.slice(0, remainingPinnedCount), id, ...withoutId.slice(remainingPinnedCount)];
  return { ...state, order, pinned: state.pinned.filter((existing) => existing !== id) };
}

/** Close a tab. A pinned tab refuses silently: pinned means pinned. An unknown id is also a no-op. */
export function close(state: TabStripState, id: string): TabStripState {
  if (state.pinned.includes(id)) return state;
  if (!state.order.includes(id)) return state;
  if (state.closed.includes(id)) return state;
  return { ...state, closed: [...state.closed, id] };
}

export function reopen(state: TabStripState, id: string): TabStripState {
  if (!state.closed.includes(id)) return state;
  return { ...state, closed: state.closed.filter((existing) => existing !== id) };
}

export function visibleTabs(state: TabStripState): string[] {
  return state.order.filter((id) => !state.closed.includes(id));
}

/**
 * Keep an active destination available after close, reconciliation, or a stale
 * persisted selection. The caller's current id wins while it is visible; when
 * it no longer is, the first visible tab in strip order is the deterministic
 * fallback. `null` means that this strip has no open destinations.
 */
export function activeTab(state: TabStripState, activeId: string | null): string | null {
  const visible = visibleTabs(state);
  return activeId !== null && visible.includes(activeId) ? activeId : (visible[0] ?? null);
}

/* ---------------------------------------------------------------- groups -- */

export type CreateGroupOptions = {
  id: string;
  name: string;
  colour?: string | null;
  members?: readonly string[];
};

/**
 * Create a group. Ids in `members` that are not part of this strip are dropped
 * silently, and any that already belong to another group are moved out of it,
 * since a tab belongs to at most one group. A duplicate group id is a no-op.
 */
export function createGroup(state: TabStripState, options: CreateGroupOptions): TabStripState {
  if (state.groups.some((group) => group.id === options.id)) return state;
  const members = dedupe((options.members ?? []).filter((id) => state.order.includes(id)));
  const groups = state.groups.map((group) => ({ ...group, members: group.members.filter((id) => !members.includes(id)) }));
  const created: TabGroup = { id: options.id, name: options.name, colour: options.colour ?? null, collapsed: false, members };
  return { ...state, groups: [...groups, created] };
}

export function renameGroup(state: TabStripState, id: string, name: string): TabStripState {
  return { ...state, groups: state.groups.map((group) => (group.id === id ? { ...group, name } : group)) };
}

export function recolourGroup(state: TabStripState, id: string, colour: string | null): TabStripState {
  return { ...state, groups: state.groups.map((group) => (group.id === id ? { ...group, colour } : group)) };
}

export function collapseGroup(state: TabStripState, id: string, collapsed: boolean): TabStripState {
  return { ...state, groups: state.groups.map((group) => (group.id === id ? { ...group, collapsed } : group)) };
}

/**
 * Remove a group. `keepMembers` is always `true`: there is no mode here that
 * deletes the member tabs themselves, only the grouping over them. The option is
 * still required at the call site so removing a group is never mistaken, at a
 * glance, for closing the tabs in it.
 */
export function removeGroup(state: TabStripState, id: string, options: { keepMembers: true }): TabStripState {
  if (!options.keepMembers) return state;
  return { ...state, groups: state.groups.filter((group) => group.id !== id) };
}

/**
 * Move a tab into `groupId`, or out of any group when `groupId` is `null`.
 *
 * The tab is removed from whichever group currently holds it before being added
 * to the target, so membership never doubles up. Moving into a collapsed group
 * does not expand it -- `collapsed` is untouched here, on purpose. An unknown
 * `groupId` leaves the state exactly as it was, rather than removing the tab
 * from its old group without anywhere to put it.
 */
export function moveIntoGroup(state: TabStripState, tabId: string, groupId: string | null): TabStripState {
  if (!state.order.includes(tabId)) return state;
  if (groupId !== null && !state.groups.some((group) => group.id === groupId)) return state;
  const groups = state.groups.map((group) => {
    if (group.id === groupId) {
      return group.members.includes(tabId) ? group : { ...group, members: [...group.members, tabId] };
    }
    return group.members.includes(tabId) ? { ...group, members: group.members.filter((id) => id !== tabId) } : group;
  });
  return { ...state, groups };
}

/**
 * Groups do not carry their own order field. Where a group sits, relative to the
 * other groups, is entirely a function of where its members sit in `order`: the
 * group's anchor is the earliest position among its surviving members. A group
 * with no members left has no anchor and sorts last, in the order it was
 * created, since there is nothing left to place it by.
 */
export function groupsInOrder(state: TabStripState): TabGroup[] {
  const anchorOf = (group: TabGroup): number => {
    let min = Number.POSITIVE_INFINITY;
    for (const id of group.members) {
      const index = state.order.indexOf(id);
      if (index !== -1 && index < min) min = index;
    }
    return min;
  };
  return state.groups
    .map((group, index) => ({ group, index, anchor: anchorOf(group) }))
    .sort((a, b) => a.anchor - b.anchor || a.index - b.index)
    .map((entry) => entry.group);
}

/**
 * Move a group among the other groups, without disturbing any ungrouped tab.
 *
 * `order` is reduced to a sequence of slots: an ungrouped tab stands for itself,
 * and the first appearance of any member of a group stands for that group's
 * whole block. The target group's slot is moved among the other group slots to
 * `toIndex`, then every slot is expanded back out -- a group's block back into
 * its members (in their existing relative order), an ungrouped slot back into
 * its single tab. Ungrouped tabs never move.
 *
 * A group with no surviving members has no slot to move and this is a no-op,
 * and a move that would land an unpinned member of the group ahead of a pinned
 * tab -- possible only when a single tab was pinned without pinning the rest of
 * its group -- is refused rather than risked: the pinned-region invariant every
 * other function here maintains is worth more than this one reorder.
 */
export function reorderGroup(state: TabStripState, groupId: string, toIndex: number): TabStripState {
  const anchored = groupsInOrder(state).filter((group) => group.members.length > 0);
  const currentPosition = anchored.findIndex((group) => group.id === groupId);
  if (currentPosition === -1) return state;
  const clampedIndex = Math.max(0, Math.min(anchored.length - 1, toIndex));
  if (clampedIndex === currentPosition) return state;

  const finalSequence = moveWithinArray(anchored.map((group) => group.id), currentPosition, clampedIndex);
  const memberOf = new Map<string, string>();
  for (const group of anchored) for (const id of group.members) memberOf.set(id, group.id);

  type Slot = { kind: 'tab'; id: string } | { kind: 'group'; id: string };
  const slots: Slot[] = [];
  const seen = new Set<string>();
  for (const id of state.order) {
    const owner = memberOf.get(id);
    if (!owner) {
      slots.push({ kind: 'tab', id });
      continue;
    }
    if (seen.has(owner)) continue;
    seen.add(owner);
    slots.push({ kind: 'group', id: owner });
  }

  let cursor = 0;
  const groupsById = new Map(state.groups.map((group) => [group.id, group] as const));
  const order = slots.flatMap((slot) => {
    if (slot.kind === 'tab') return [slot.id];
    const nextGroupId = finalSequence[cursor];
    cursor += 1;
    const group = groupsById.get(nextGroupId);
    return group ? state.order.filter((id) => group.members.includes(id)) : [];
  });

  const pinnedSet = new Set(state.pinned);
  const prefixHolds = order.slice(0, state.pinned.length).every((id) => pinnedSet.has(id));
  if (!prefixHolds) return state;

  return { ...state, order };
}

/** Pin every member of a group, in their existing member order, at the end of the pinned region. */
export function pinGroup(state: TabStripState, groupId: string): TabStripState {
  const group = state.groups.find((candidate) => candidate.id === groupId);
  if (!group) return state;
  let next = state;
  for (const id of group.members) next = pin(next, id);
  return next;
}

/* ------------------------------------------------------------------ dock -- */

export function setDock(state: TabStripState, dock: TabDock): TabStripState {
  return state.dock === dock ? state : { ...state, dock };
}

/* ------------------------------------------------------------ bulk close -- */

/**
 * Build the match predicate for a bulk-close query, or `null` when the query is
 * not valid enough to run -- an unknown flag, an over-length pattern, or (regex
 * mode only) a pattern that does not compile. Plain mode is
 * `plainTextMatches`, exactly what every other search bar in the workspace
 * uses; regex mode is a bounded `RegExp`, reset to index 0 before every test so
 * a global or sticky flag cannot leave it silently skipping every other label.
 * `negate` inverts the result; it is applied last, so the inverse of a
 * predicate is always the exact logical complement of the positive one.
 */
export function bulkClosePredicate(query: BulkCloseQuery): LabelPredicate | null {
  const flags = query.flags ?? '';
  const state: SearchState = {
    query: query.query,
    pattern: query.query,
    flags,
    mode: query.mode === 'regex' ? 'regex' : 'text',
  };
  if (validateSearchInput([], state) !== null) return null;

  if (query.mode === 'plain') {
    const positive: LabelPredicate = (label) => plainTextMatches([label], query.query)[0] === true;
    return query.negate ? (label) => !positive(label) : positive;
  }

  let regex: RegExp;
  try {
    regex = new RegExp(query.query, flags);
  } catch {
    return null;
  }
  const positive: LabelPredicate = (label) => {
    regex.lastIndex = 0;
    return regex.test(label);
  };
  return query.negate ? (label) => !positive(label) : positive;
}

/**
 * What a bulk close would do, before it does it.
 *
 * A tab the query does not match is neither affected nor skipped -- it is
 * simply not part of this action. Among tabs the query does match: one this
 * strip does not track at all is `locked` (checked first, so it can never be
 * mistaken for an ordinary affected tab just because it is absent from both
 * `closed` and `pinned`); one already closed is `already-closed`; one pinned is
 * `pinned` unless `includePinned` says otherwise. A `null` predicate -- an
 * invalid query -- previews as empty, the same as never having been asked.
 */
export function previewBulkClose(
  state: TabStripState,
  tabs: readonly TabDescriptor[],
  predicate: LabelPredicate | null,
  options: BulkCloseOptions,
): BulkClosePreview {
  if (!predicate) return { affected: [], skipped: [], scope: 'strip' };
  const affected: string[] = [];
  const skipped: BulkCloseSkip[] = [];
  for (const tab of tabs) {
    if (!predicate(tab.label)) continue;
    if (!state.order.includes(tab.id)) {
      skipped.push({ id: tab.id, reason: 'locked' });
      continue;
    }
    if (state.closed.includes(tab.id)) {
      skipped.push({ id: tab.id, reason: 'already-closed' });
      continue;
    }
    if (state.pinned.includes(tab.id) && !options.includePinned) {
      skipped.push({ id: tab.id, reason: 'pinned' });
      continue;
    }
    affected.push(tab.id);
  }
  return { affected, skipped, scope: 'strip' };
}

/**
 * Apply a preview. This adds `preview.affected` straight to `closed`, bypassing
 * the pinned refusal that the single-tab `close` enforces: the preview already
 * decided, through `includePinned`, that a pinned tab in `affected` is meant to
 * close. Pinning itself is untouched -- a bulk-closed pinned tab reopens back
 * into its pinned position.
 */
export function applyBulkClose(state: TabStripState, preview: BulkClosePreview): TabStripState {
  const additions = preview.affected.filter((id) => state.order.includes(id) && !state.closed.includes(id));
  if (additions.length === 0) return state;
  return { ...state, closed: [...state.closed, ...additions] };
}

/* -------------------------------------------------------------- keyboard -- */

export function orientationFor(dock: TabDock): Orientation {
  return dock === 'top' || dock === 'bottom' ? 'horizontal' : 'vertical';
}

/**
 * Translate a physical arrow key into a logical strip action, given which edge
 * the strip is docked to. Home and End are axis-independent. The arrow pair for
 * the *other* axis -- ArrowUp/ArrowDown on a horizontal strip, ArrowLeft/
 * ArrowRight on a vertical one -- returns `null` rather than a guess, so the
 * caller can let that key do whatever it would otherwise do (scroll the page,
 * for instance) instead of silently eating it.
 */
export function keyForOrientation(dock: TabDock, key: string): TabStripKeyAction | null {
  if (key === 'Home') return 'home';
  if (key === 'End') return 'end';
  if (orientationFor(dock) === 'horizontal') {
    if (key === 'ArrowLeft') return 'previous';
    if (key === 'ArrowRight') return 'next';
    return null;
  }
  if (key === 'ArrowUp') return 'previous';
  if (key === 'ArrowDown') return 'next';
  return null;
}

/* ------------------------------------------------------------ persistence -- */

export const MAX_STRIP_BYTES = 12_288;

export function STRIP_KEY(surface: string): string {
  return `gtha-tabs-${surface}-v1`;
}

export function serializeStripState(state: TabStripState): string {
  return JSON.stringify(state);
}

const byteLengthEncoder = new TextEncoder();

/** Throws when the serialized state exceeds `MAX_STRIP_BYTES`, so a runaway strip is caught long before it hits the 16 KiB per-key storage cap. */
export function assertBounded(state: TabStripState): void {
  const size = byteLengthEncoder.encode(serializeStripState(state)).length;
  if (size > MAX_STRIP_BYTES) {
    throw new Error(`tab strip state for "${state.surface}" is ${size} bytes, over the ${MAX_STRIP_BYTES} byte bound`);
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isTabDock(value: unknown): value is TabDock {
  return typeof value === 'string' && (TAB_DOCKS as readonly string[]).includes(value);
}

function isValidGroup(value: unknown): value is TabGroup {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    (candidate.colour === null || typeof candidate.colour === 'string') &&
    typeof candidate.collapsed === 'boolean' &&
    isStringArray(candidate.members)
  );
}

/**
 * Repair internal consistency after a raw parse, before `reconcile` adapts the
 * result to the current id list. A hand-edited or truncated record could claim
 * a pinned id that is not in `order`, or a pinned id sitting out of position;
 * this rebuilds `order` so the pinned ids -- filtered to ones that still exist,
 * in the sequence the record gave them -- are always its prefix, exactly the
 * invariant every reducer above maintains.
 */
function normalizeStrip(state: TabStripState): TabStripState {
  const orderIds = dedupe(state.order);
  const knownOrder = new Set(orderIds);
  const pinned = dedupe(state.pinned).filter((id) => knownOrder.has(id));
  const closed = dedupe(state.closed).filter((id) => knownOrder.has(id));
  const pinnedSet = new Set(pinned);
  const order = [...pinned, ...orderIds.filter((id) => !pinnedSet.has(id))];
  const assigned = new Set<string>();
  const groups = state.groups.map((group) => {
    const members = dedupe(group.members).filter((id) => knownOrder.has(id) && !assigned.has(id));
    for (const id of members) assigned.add(id);
    return { ...group, members };
  });
  return { ...state, order, pinned, closed, groups };
}

/**
 * Restore a strip from storage, or build a fresh one when the record is
 * missing, unreadable, or written by a version this reader does not know.
 * `surface` is always the caller's value, never whatever the record itself
 * claims -- the storage key already namespaces per surface, so the record is
 * either for this surface or it should not have been handed to this call.
 * A structurally valid record is still normalized and reconciled against
 * `ids`, so neither a corrupted invariant nor a stale destination list can
 * reach the strip component.
 */
export function parseStripState(text: string | null, surface: string, ids: readonly string[]): TabStripState {
  const fallback = () => createStripState(surface, ids);
  if (!text) return fallback();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fallback();
  }
  if (!parsed || typeof parsed !== 'object') return fallback();
  const candidate = parsed as Record<string, unknown>;
  if (candidate.version !== 1) return fallback();
  if (!isStringArray(candidate.order) || !isStringArray(candidate.pinned) || !isStringArray(candidate.closed)) return fallback();
  if (!Array.isArray(candidate.groups) || !candidate.groups.every(isValidGroup)) return fallback();
  if (!isTabDock(candidate.dock)) return fallback();
  const raw: TabStripState = {
    version: 1,
    surface,
    order: candidate.order,
    pinned: candidate.pinned,
    closed: candidate.closed,
    groups: candidate.groups,
    dock: candidate.dock,
  };
  return reconcile(normalizeStrip(raw), ids);
}

/* --------------------------------------------------------------- overflow -- */

/**
 * Split measured tabs into what fits and what overflows, for either axis: the
 * caller passes widths for a horizontal strip and heights for a vertical one.
 * Pinned tabs are always visible, first, even if they alone exceed `available`
 * -- pinned means pinned, not pinned-until-crowded. Unpinned tabs are then
 * accepted in sequence by cumulative size; the moment one does not fit, every
 * unpinned tab after it overflows too, even a smaller one that would have fit
 * on its own, because a real strip cannot skip over a tab without reordering
 * the ones on screen.
 */
export function overflowSplit(
  measurements: readonly TabMeasurement[],
  available: number,
  pinnedIds: readonly string[],
): OverflowSplit {
  const pinnedSet = new Set(pinnedIds);
  const pinned = measurements.filter((item) => pinnedSet.has(item.id));
  const unpinned = measurements.filter((item) => !pinnedSet.has(item.id));

  const visible = pinned.map((item) => item.id);
  let used = pinned.reduce((total, item) => total + item.size, 0);
  const overflow: string[] = [];
  let full = false;
  for (const item of unpinned) {
    if (!full && used + item.size <= available) {
      visible.push(item.id);
      used += item.size;
    } else {
      full = true;
      overflow.push(item.id);
    }
  }
  return { visible, overflow };
}
