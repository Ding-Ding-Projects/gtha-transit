/** Bounded immutable undo/redo history, usable by any appearance editor UI. */
export type AppearanceHistory<T> = { past: readonly T[]; present: T; future: readonly T[]; limit: number };
export const DEFAULT_HISTORY_LIMIT = 100;

export function createAppearanceHistory<T>(present: T, limit = DEFAULT_HISTORY_LIMIT): AppearanceHistory<T> {
  return { past: [], present, future: [], limit: Math.max(1, Math.min(500, Math.floor(limit) || DEFAULT_HISTORY_LIMIT)) };
}

export function commitAppearanceHistory<T>(history: AppearanceHistory<T>, next: T, equal: (a: T, b: T) => boolean = Object.is): AppearanceHistory<T> {
  if (equal(history.present, next)) return history;
  return { ...history, past: [...history.past, history.present].slice(-history.limit), present: next, future: [] };
}

export function undoAppearanceHistory<T>(history: AppearanceHistory<T>): AppearanceHistory<T> {
  const previous = history.past.at(-1);
  return previous === undefined ? history : { ...history, past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redoAppearanceHistory<T>(history: AppearanceHistory<T>): AppearanceHistory<T> {
  const next = history.future[0];
  return next === undefined ? history : { ...history, past: [...history.past, history.present].slice(-history.limit), present: next, future: history.future.slice(1) };
}
