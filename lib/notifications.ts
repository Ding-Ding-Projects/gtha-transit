/**
 * Notifications: the queue, the severities, and the history that survives dismissal.
 *
 * What this replaces was one `useState('')` in app/page.tsx rendering a single
 * `.toast` with a 6.5 second timeout. It worked, and it had three problems that
 * only show up when two things happen at once. A second notice replaced the
 * first, so saving a trip while a route request failed showed you exactly one of
 * those and never said which it dropped. Everything auto-dismissed on the same
 * timer, so an error you looked away from was gone. And nothing was kept, so a
 * message you half-read was unrecoverable.
 *
 * No React here, so the rules are testable on their own: what auto-dismisses,
 * what does not, what supersedes what, and what the centre still holds.
 */

export type Severity = 'info' | 'success' | 'progress' | 'warning' | 'error';

export const SEVERITIES: readonly Severity[] = ['info', 'success', 'progress', 'warning', 'error'];

export type NotificationAction = {
  id: string;
  /** Shown on the control. The caller has already put it through its language mode. */
  label: string;
  /** A link instead of a button, when the action is somewhere to go rather than something to do. */
  href?: string;
};

export type Notification = {
  id: string;
  severity: Severity;
  title: string;
  body?: string;
  actions?: NotificationAction[];
  /** When it arrived, in epoch milliseconds. */
  at: number;
  /**
   * Replaces any live notification sharing this key rather than stacking beside it.
   * A route request that retries three times is one story, not three toasts.
   */
  supersedes?: string;
  /** Set once it leaves the stack; the centre still has it. */
  dismissedAt?: number;
};

export type NotificationInput = Omit<Notification, 'id' | 'at' | 'dismissedAt'> & { id?: string; at?: number };

/**
 * How long each severity stays on screen.
 *
 * Warnings and errors do not leave on their own. A message telling you something
 * went wrong, which removes itself while you are reading the thing that went
 * wrong, has told you nothing and cost you the chance to find out.
 */
export const DISMISS_AFTER: Readonly<Record<Severity, number | null>> = Object.freeze({
  info: 6_500,
  success: 5_000,
  progress: null,
  warning: null,
  error: null,
});

/** At most this many on screen at once; the rest are in the centre. */
export const MAX_VISIBLE = 4;

/** At most this many kept for review, newest first. */
export const MAX_HISTORY = 100;

export const HISTORY_STORAGE_KEY = 'gtha-notification-history-v1';

export type NotificationState = {
  /** Newest last, so the stack reads downward in the order things happened. */
  live: Notification[];
  /** Newest first, because a review list is read from the top. */
  history: Notification[];
};

export const emptyNotifications = (): NotificationState => ({ live: [], history: [] });

let counter = 0;
/** Ids are sequential rather than random, so a test can name one and a key is stable. */
export function nextNotificationId(): string {
  counter += 1;
  return `notification-${counter}`;
}

/** Reset the id counter. Tests only; nothing in the application calls this. */
export function resetNotificationIds(): void {
  counter = 0;
}

/**
 * Add one, superseding its predecessor where it says so.
 *
 * The visible stack is capped, and what falls off the top is not lost: it is
 * already in the history, which is the whole reason the history exists.
 */
export function notify(state: NotificationState, input: NotificationInput, now = Date.now()): NotificationState {
  const notification: Notification = {
    ...input,
    id: input.id ?? nextNotificationId(),
    at: input.at ?? now,
  };
  const replaced = input.supersedes
    ? state.live.filter((item) => item.supersedes !== input.supersedes)
    : state.live;
  const live = [...replaced, notification].slice(-MAX_VISIBLE);
  const history = [notification, ...state.history.filter((item) => item.id !== notification.id)].slice(0, MAX_HISTORY);
  return { live, history };
}

/** Take one off the stack. It stays in the history, marked with when it went. */
export function dismiss(state: NotificationState, id: string, now = Date.now()): NotificationState {
  if (!state.live.some((item) => item.id === id)) return state;
  return {
    live: state.live.filter((item) => item.id !== id),
    history: state.history.map((item) => (item.id === id ? { ...item, dismissedAt: now } : item)),
  };
}

export function dismissAll(state: NotificationState, now = Date.now()): NotificationState {
  const going = new Set(state.live.map((item) => item.id));
  return {
    live: [],
    history: state.history.map((item) => (going.has(item.id) ? { ...item, dismissedAt: now } : item)),
  };
}

/** Remove from the history entirely. This is the destructive one. */
export function forget(state: NotificationState, ids: readonly string[]): NotificationState {
  const going = new Set(ids);
  return {
    live: state.live.filter((item) => !going.has(item.id)),
    history: state.history.filter((item) => !going.has(item.id)),
  };
}

/** Which live notifications have outlived their severity's timeout. */
export function expired(state: NotificationState, now = Date.now()): string[] {
  return state.live
    .filter((item) => {
      const after = DISMISS_AFTER[item.severity];
      return after !== null && now - item.at >= after;
    })
    .map((item) => item.id);
}

/**
 * How a notification is announced to a screen reader.
 *
 * An error interrupts; nothing else does. `assertive` on a success message talks
 * over whatever the person was listening to, which is how a live region becomes
 * the thing everyone switches off.
 */
export const politeness = (severity: Severity): 'assertive' | 'polite' => (severity === 'error' ? 'assertive' : 'polite');

/* ----------------------------------------------------------------- reading -- */

export type HistoryFilter = { severities?: readonly Severity[]; query?: string; from?: string; to?: string };

/** The searchable text of one notification, which is everything it showed. */
export const notificationSample = (item: Notification): string =>
  [item.title, item.body, item.severity, ...(item.actions ?? []).map((action) => action.label)].filter(Boolean).join(' ');

/**
 * The history a filter selects.
 *
 * Regex is the caller's business: this takes an already-computed match list when
 * one is in play, so the centre uses the same matcher as every other search field
 * in the planner rather than a private one that answers differently.
 */
export function filterHistory(history: readonly Notification[], filter: HistoryFilter, matches?: readonly boolean[]): Notification[] {
  const severities = filter.severities && filter.severities.length ? new Set(filter.severities) : null;
  return history.filter((item, index) => {
    if (severities && !severities.has(item.severity)) return false;
    if (matches && matches[index] === false) return false;
    if (filter.from && dayOf(item.at) < filter.from) return false;
    if (filter.to && dayOf(item.at) > filter.to) return false;
    return true;
  });
}

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' });

/** The Toronto calendar day a notification arrived on, which is what a date filter means here. */
export function dayOf(at: number): string {
  const parts = Object.fromEntries(dayFormat.formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** How many of each severity the history holds, so a filter with no results is visibly empty rather than mysteriously so. */
export function countsBySeverity(history: readonly Notification[]): Record<Severity, number> {
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<Severity, number>;
  for (const item of history) counts[item.severity] += 1;
  return counts;
}

/* -------------------------------------------------------------- persistence -- */

/**
 * The history survives a reload, within bounds.
 *
 * Stored through the same bounded local setting every other preference uses, so
 * it inherits the 16 KiB cap and the volatile fallback rather than growing without
 * limit. Anything unreadable is dropped rather than partially restored: half a
 * history is worse than none, because it looks complete.
 */
export function serializeHistory(history: readonly Notification[]): string {
  return JSON.stringify({ version: 1, history: history.slice(0, MAX_HISTORY) });
}

export function parseHistory(raw: string | null | undefined): Notification[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!parsed || typeof parsed !== 'object') return [];
  const { version, history } = parsed as { version?: unknown; history?: unknown };
  if (version !== 1 || !Array.isArray(history)) return [];
  const restored: Notification[] = [];
  for (const item of history) {
    if (!item || typeof item !== 'object') continue;
    const { id, severity, title, body, at, dismissedAt, actions } = item as Record<string, unknown>;
    if (typeof id !== 'string' || typeof title !== 'string') continue;
    if (!SEVERITIES.includes(severity as Severity)) continue;
    if (!Number.isFinite(at)) continue;
    restored.push({
      id,
      severity: severity as Severity,
      title: title.slice(0, 400),
      body: typeof body === 'string' ? body.slice(0, 2000) : undefined,
      at: at as number,
      dismissedAt: Number.isFinite(dismissedAt) ? (dismissedAt as number) : undefined,
      /* Actions are deliberately not restored. Their handlers do not survive a
         reload, so a restored button would look live and do nothing, which is the
         decorative-control defect this project refuses everywhere else. A link is
         dropped with them rather than kept alone, because a row showing one of its
         two actions misrepresents what happened. */
      actions: Array.isArray(actions) && actions.length ? [] : undefined,
    });
    if (restored.length >= MAX_HISTORY) break;
  }
  return restored;
}
