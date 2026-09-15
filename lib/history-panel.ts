/**
 * The pure filtering and formatting logic behind the local version-history
 * panel — the surface `docs/interface/history.md` describes as built and
 * tested but not yet wired to anything. This module is what wires the panel's
 * own list-reading behaviour: which commits an action/date filter and a
 * search match keep, the calendar day one belongs to, and the searchable text
 * one row exposes to `SearchWorkbench`.
 *
 * Kept separate from the component for the same reason `lib/notifications.ts`
 * keeps its own `filterHistory`/`dayOf` out of the component that renders
 * them: no React needed to test what a filter keeps and drops.
 */

import type { HistoryAction, HistoryCommit } from './record-history.ts';

export type CommitFilter = {
  actions?: readonly HistoryAction[];
  from?: string;
  to?: string;
};

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' });

/** The Toronto calendar day a commit was written on, which is what a date filter here means. */
export function commitDayOf(at: number): string {
  const parts = Object.fromEntries(dayFormat.formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** The searchable text of one commit row: its label and its action, which is everything the row shows besides the diff itself. */
export const commitSample = (commit: HistoryCommit): string => [commit.label, commit.action].filter(Boolean).join(' ');

/**
 * The commits an action filter, a date range and an already-computed search
 * match keep.
 *
 * Regex is the caller's business, exactly as in `lib/notifications.ts`'s
 * `filterHistory`: this takes an already-computed match list when search is
 * active, so the panel uses the same matcher as every other search field in
 * the planner rather than a private one that answers differently.
 */
export function filterCommits(commits: readonly HistoryCommit[], filter: CommitFilter, matches?: readonly boolean[]): HistoryCommit[] {
  const actions = filter.actions && filter.actions.length ? new Set(filter.actions) : null;
  return commits.filter((commit, index) => {
    if (actions && !actions.has(commit.action)) return false;
    if (matches && matches[index] === false) return false;
    if (filter.from && commitDayOf(commit.at) < filter.from) return false;
    if (filter.to && commitDayOf(commit.at) > filter.to) return false;
    return true;
  });
}

/** How many commits carry each action, so a filter row can show zero rather than omitting an action nobody has used recently. */
export function actionCounts(commits: readonly HistoryCommit[]): Record<HistoryAction, number> {
  const counts: Record<HistoryAction, number> = {};
  for (const commit of commits) counts[commit.action] = (counts[commit.action] ?? 0) + 1;
  return counts;
}

/** Every action any loaded commit carries, in first-seen order — the checkbox list an action filter renders. */
export function actionsInUse(commits: readonly HistoryCommit[]): HistoryAction[] {
  const seen: HistoryAction[] = [];
  for (const commit of commits) if (!seen.includes(commit.action)) seen.push(commit.action);
  return seen;
}
