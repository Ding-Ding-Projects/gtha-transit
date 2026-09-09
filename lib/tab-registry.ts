/**
 * The one place every tab strip the workspace has registers itself, so the
 * master tab search can be built without any strip knowing the others exist.
 *
 * This mirrors the destinations registry `command-palette.ts` already reads
 * from: a single list nobody has to remember to update in two places. A strip
 * registers a getter rather than a snapshot, because the master search has to
 * see live state -- a tab pinned a moment ago must show as pinned the next time
 * someone searches, not whatever it was when the strip mounted.
 *
 * The registry is deliberately the only piece of module-level mutable state in
 * this pair of files; `tabs.ts` stays a pure reducer set. A test file that
 * registers a strip should unregister it when done, since tests within one file
 * share this same module instance.
 */

import type { TabDescriptor, TabStripState } from './tabs.ts';

export type StripSnapshot = {
  tabs: TabDescriptor[];
  state: TabStripState;
};

export type StripGetter = () => StripSnapshot;

export type TabSearchResult = {
  surface: string;
  id: string;
  label: string;
  group: string | null;
  pinned: boolean;
  closed: boolean;
};

const registry = new Map<string, StripGetter>();

/** Register (or replace) the getter for a surface's strip. */
export function registerStrip(surface: string, getter: StripGetter): void {
  registry.set(surface, getter);
}

export function unregisterStrip(surface: string): void {
  registry.delete(surface);
}

/** Every surface currently registered, for diagnostics and tests. */
export function allStrips(): string[] {
  return [...registry.keys()];
}

/**
 * Every tab across every registered strip whose label matches, for the master
 * tab search. Pure over the getters supplied at registration time: the matcher
 * itself comes from the caller, which is expected to be the same regex-builder
 * matcher every other search surface uses.
 */
export function searchAllTabs(matches: (label: string) => boolean): TabSearchResult[] {
  const results: TabSearchResult[] = [];
  for (const [surface, getter] of registry) {
    const { tabs, state } = getter();
    const groupOf = new Map<string, string>();
    for (const group of state.groups) {
      for (const id of group.members) groupOf.set(id, group.id);
    }
    for (const tab of tabs) {
      if (!matches(tab.label)) continue;
      results.push({
        surface,
        id: tab.id,
        label: tab.label,
        group: groupOf.get(tab.id) ?? null,
        pinned: state.pinned.includes(tab.id),
        closed: state.closed.includes(tab.id),
      });
    }
  }
  return results;
}
