/**
 * A structural diff between two JSON-shaped values.
 *
 * This exists so a version-history panel can say what changed between two
 * snapshots of a record — a saved trip, a settings blob, a labelled checkpoint —
 * without either side needing to know the record's shape. It walks objects and
 * arrays together, index by index and key by key, and reports every leaf that
 * was added, removed or changed, at a stable dotted/bracketed path such as
 * `a.b[2].c`.
 *
 * **It is bounded on purpose.** A record a person edited by hand, or a snapshot
 * from a future feature nobody has imagined yet here, could in principle nest
 * arbitrarily deep or differ in thousands of places. Recursing without a limit
 * turns a diff into a stack overflow or a multi-second freeze on somebody's
 * phone; enumerating every difference without a limit turns a diff into a wall
 * of noise nobody reads anyway. So the walk stops at 32 levels of nesting and
 * 2,000 recorded entries, and says so — `truncated: true` — rather than
 * silently returning a partial answer that looks complete. A caller that cares
 * only about equality (`entries.length === 0`) should still check `truncated`:
 * a truncated empty result means "nothing found yet", not "nothing differs".
 */

export type DiffKind = 'added' | 'removed' | 'changed';

export type DiffEntry = {
  path: string;
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
};

export type DiffResult = {
  entries: DiffEntry[];
  /** True when the walk stopped early because of the depth or entry bound below. */
  truncated: boolean;
};

/** How many levels of nesting the walk will descend into before giving up. */
export const MAX_DIFF_DEPTH = 32;

/** How many entries the walk will record before giving up. */
export const MAX_DIFF_ENTRIES = 2_000;

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The stable path notation this module reads and writes: dotted for object
 * keys, bracketed for array indices, e.g. `a.b[2].c`. A key that itself
 * contains a `.` or a `[` renders ambiguously — nothing in this codebase's
 * record shapes does that, and a general-purpose escaping scheme would cost
 * more than it is worth for the diff panel this feeds.
 */
function renderPath(segments: readonly (string | number)[]): string {
  let out = '';
  for (const segment of segments) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else out += out === '' ? segment : `.${segment}`;
  }
  return out;
}

type WalkState = { entries: DiffEntry[]; truncated: boolean };

function push(state: WalkState, entry: DiffEntry): void {
  state.entries.push(entry);
  if (state.entries.length >= MAX_DIFF_ENTRIES) state.truncated = true;
}

function walk(before: unknown, after: unknown, segments: readonly (string | number)[], depth: number, state: WalkState): void {
  if (state.truncated) return;
  if (depth > MAX_DIFF_DEPTH) {
    state.truncated = true;
    return;
  }

  const beforeIsArray = Array.isArray(before);
  const afterIsArray = Array.isArray(after);

  if (beforeIsArray && afterIsArray) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      if (state.truncated) return;
      const path = [...segments, index];
      const hasBefore = index < before.length;
      const hasAfter = index < after.length;
      if (hasBefore && hasAfter) {
        walk(before[index], after[index], path, depth + 1, state);
      } else if (hasAfter) {
        push(state, { path: renderPath(path), kind: 'added', after: after[index] });
      } else {
        push(state, { path: renderPath(path), kind: 'removed', before: before[index] });
      }
    }
    return;
  }

  const beforeIsObject = isPlainObject(before);
  const afterIsObject = isPlainObject(after);

  if (beforeIsObject && afterIsObject) {
    const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      if (state.truncated) return;
      const path = [...segments, key];
      const hasBefore = hasOwn(before, key);
      const hasAfter = hasOwn(after, key);
      if (hasBefore && hasAfter) {
        walk(before[key], after[key], path, depth + 1, state);
      } else if (hasAfter) {
        push(state, { path: renderPath(path), kind: 'added', after: after[key] });
      } else {
        push(state, { path: renderPath(path), kind: 'removed', before: before[key] });
      }
    }
    return;
  }

  // Either two comparable leaves, or a shape mismatch (an object where an array
  // used to be, a primitive where an object used to be, and so on). A shape
  // mismatch is reported as one `changed` entry for the whole node rather than
  // being torn into synthetic adds and removes — the two sides do not
  // correspond key-for-key, so there is nothing structural left to walk into.
  if (!Object.is(before, after)) {
    push(state, { path: renderPath(segments), kind: 'changed', before, after });
  }
}

/**
 * Diff two JSON-shaped values.
 *
 * `path` seeds the walk with a starting location, for a caller diffing a
 * sub-tree it already knows the address of (`diffJson(a.settings, b.settings,
 * ['settings'])`) so the reported paths still read as though the whole record
 * had been diffed.
 */
export function diffJson(before: unknown, after: unknown, path: readonly string[] = []): DiffResult {
  const state: WalkState = { entries: [], truncated: false };
  walk(before, after, path, 0, state);
  return { entries: state.entries, truncated: state.truncated };
}

/** How many of each kind a diff holds, so a panel can show zero rather than nothing. */
export function summariseDiff(entries: readonly DiffEntry[]): Record<DiffKind, number> {
  const counts: Record<DiffKind, number> = { added: 0, removed: 0, changed: 0 };
  for (const entry of entries) counts[entry.kind] += 1;
  return counts;
}
