/**
 * Multi-select and bulk actions, for every list in the planner.
 *
 * The contract this satisfies is blunt about the failure it exists to prevent:
 * selecting one item and repeating an action forty times is the interface failing
 * to do its job. It is equally blunt that the notification centre and the history
 * panels are not exempt for being logs.
 *
 * Two things here are load-bearing and are the reasons this is a module rather
 * than a hook written per list.
 *
 * **Select-all has to say which all it means.** A list showing 50 of 1,200 rows
 * has two honest answers to "select all" and they differ by 1,150 items. Choosing
 * silently is how somebody deletes the wrong 1,150. The scope is part of the
 * selection, and the caller renders it in words.
 *
 * **A count of what is selected is not a count of what will change.** Some rows
 * are protected, some are already in the state the action would put them in. The
 * preview separates the two, so "42 selected" never quietly means "39 will
 * change" without saying which three did not and why.
 */

export type SelectionScope = 'page' | 'matches';

export type Selection = {
  /** Explicitly chosen ids, when the scope is `page`. */
  ids: readonly string[];
  /**
   * Everything the current filter matches, minus `excluded`. The set is not
   * enumerated: it can be far larger than what is on screen.
   */
  scope: SelectionScope;
  /** Ids deselected out of an all-matches selection. */
  excluded: readonly string[];
};

export const emptySelection = (): Selection => ({ ids: [], scope: 'page', excluded: [] });

export const isSelected = (selection: Selection, id: string): boolean =>
  selection.scope === 'matches'
    ? !selection.excluded.includes(id)
    : selection.ids.includes(id);

export function toggle(selection: Selection, id: string): Selection {
  if (selection.scope === 'matches') {
    const excluded = selection.excluded.includes(id)
      ? selection.excluded.filter((item) => item !== id)
      : [...selection.excluded, id];
    return { ...selection, excluded };
  }
  const ids = selection.ids.includes(id)
    ? selection.ids.filter((item) => item !== id)
    : [...selection.ids, id];
  return { ...selection, ids };
}

/**
 * A shift-click range, over the order the rows are actually rendered in.
 *
 * The visible order, not the underlying one: a person shift-clicking is selecting
 * what they can see between two rows, and a list sorted differently underneath
 * would select a set they never pointed at.
 */
export function selectRange(selection: Selection, visible: readonly string[], from: string, to: string): Selection {
  const start = visible.indexOf(from);
  const end = visible.indexOf(to);
  if (start === -1 || end === -1) return selection;
  const range = visible.slice(Math.min(start, end), Math.max(start, end) + 1);
  if (selection.scope === 'matches') {
    return { ...selection, excluded: selection.excluded.filter((id) => !range.includes(id)) };
  }
  const ids = [...selection.ids];
  for (const id of range) if (!ids.includes(id)) ids.push(id);
  return { ...selection, ids };
}

/** Select what is on this page: an explicit, enumerable set. */
export const selectPage = (visible: readonly string[]): Selection => ({ ids: [...visible], scope: 'page', excluded: [] });

/** Select everything the filter matches, including what is not on screen. */
export const selectAllMatches = (): Selection => ({ ids: [], scope: 'matches', excluded: [] });

export const clearSelection = emptySelection;

/** Everything visible that is not selected, and nothing else. */
export function invert(selection: Selection, visible: readonly string[]): Selection {
  return selectPage(visible.filter((id) => !isSelected(selection, id)));
}

/**
 * How many are selected.
 *
 * `matched` is how many the current filter matches in total, which the caller
 * knows and this module cannot: an all-matches selection is defined by the query,
 * not by a list of ids.
 */
export function selectedCount(selection: Selection, matched: number): number {
  return selection.scope === 'matches' ? Math.max(0, matched - selection.excluded.length) : selection.ids.length;
}

export const hasSelection = (selection: Selection, matched: number): boolean => selectedCount(selection, matched) > 0;

/** The ids a bulk action will actually run over, from the rows the caller can enumerate. */
export function resolveSelected<T extends { id: string }>(selection: Selection, rows: readonly T[]): T[] {
  return rows.filter((row) => isSelected(selection, row.id));
}

/* ---------------------------------------------------------------- previews -- */

export type BulkSkip = { id: string; reason: string };

export type BulkPreview<T> = {
  /** What the action will change. */
  affected: T[];
  /** What it will not, each with the reason, because a silent skip is indistinguishable from a loss. */
  skipped: BulkSkip[];
  /** Everything selected, whether or not it will change. */
  selected: number;
  /** True when the selection reaches beyond the rows the caller can enumerate. */
  beyondThisPage: boolean;
};

/**
 * What a bulk action would do, before it does it.
 *
 * `protect` returns a reason to skip a row, or null to let it through. Anything
 * skipped is reported rather than dropped: an action that silently affects fewer
 * items than it said is the failure this whole preview exists to make impossible.
 */
export function previewBulk<T extends { id: string }>(
  selection: Selection,
  rows: readonly T[],
  matched: number,
  protect: (row: T) => string | null = () => null,
): BulkPreview<T> {
  const chosen = resolveSelected(selection, rows);
  const affected: T[] = [];
  const skipped: BulkSkip[] = [];
  for (const row of chosen) {
    const reason = protect(row);
    if (reason) skipped.push({ id: row.id, reason });
    else affected.push(row);
  }
  const selected = selectedCount(selection, matched);
  return { affected, skipped, selected, beyondThisPage: selection.scope === 'matches' && selected > chosen.length };
}

/** The reasons a preview skipped rows, with a count each, for saying so in one line. */
export function skipSummary(preview: BulkPreview<unknown>): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const skip of preview.skipped) counts.set(skip.reason, (counts.get(skip.reason) ?? 0) + 1);
  return [...counts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

/** Whether a bulk action needs the two-key confirmation gate: it is irreversible. */
export const DESTRUCTIVE_ACTIONS: readonly string[] = ['delete', 'forget', 'clear'];
export const isDestructive = (action: string): boolean => DESTRUCTIVE_ACTIONS.includes(action);
