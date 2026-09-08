/**
 * The state machine behind the two-key confirmation gate.
 *
 * The gate is deliberately awkward. Two keys turned independently, then a slider
 * dragged its whole length, before anything irreversible happens. That is not
 * theatre for its own sake: the actions behind it cannot be undone, and a single
 * confirm button is a thing people press without reading.
 *
 * What must survive every bit of that awkwardness is the sentence saying what is
 * about to happen. The funny-level sliders style the copy around this gate like
 * they style everything else, and they never touch the count, the names, or the
 * word irreversible. A warning nobody can act on is a broken warning, not a
 * funny one.
 *
 * No React here, so the rules are testable without rendering: which key does
 * what, when the slider arms, what resets it, and the fact that an incomplete
 * slider authorises nothing.
 */

export type ConfirmKey = 'left' | 'right';

export type ConfirmState = {
  left: boolean;
  right: boolean;
  /** 0 to 1. Only a full sweep authorises. */
  slider: number;
  /** Set once the action has actually been authorised, so it cannot fire twice. */
  authorisedAt: number | null;
};

export const idleConfirm = (): ConfirmState => ({ left: false, right: false, slider: 0, authorisedAt: null });

/** Both keys turned. Until then the slider does not move. */
export const isArmed = (state: ConfirmState): boolean => state.left && state.right;

/**
 * The slider only counts as swept at its very end.
 *
 * A threshold below 1 would let a fast drag that overshot most of the way count
 * as a deliberate sweep, which is the accident this control exists to prevent.
 */
export const isSwept = (state: ConfirmState): boolean => isArmed(state) && state.slider >= 1;

export const isAuthorised = (state: ConfirmState): boolean => state.authorisedAt !== null;

export function turnKey(state: ConfirmState, key: ConfirmKey): ConfirmState {
  if (isAuthorised(state)) return state;
  const next = { ...state, [key]: !state[key] };
  /* Turning a key back off disarms, and the slider returns to the start. Leaving
     it part-way would mean a later re-arm began half-swept, so the second
     confirmation would take half the deliberate effort of the first. */
  return isArmed(next) ? next : { ...next, slider: 0 };
}

export function moveSlider(state: ConfirmState, value: number): ConfirmState {
  if (isAuthorised(state) || !isArmed(state)) return state;
  const slider = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return { ...state, slider };
}

/**
 * Authorise, once.
 *
 * Returns the same state when the sweep is incomplete, so a caller that asks
 * twice cannot get two authorisations out of one gesture. The re-entry guard is
 * here rather than at the call site because a disabled button is the visible
 * guard, not the real one: a keyboard submit walks straight past it.
 */
export function authorise(state: ConfirmState, now = Date.now()): ConfirmState {
  if (!isSwept(state) || isAuthorised(state)) return state;
  return { ...state, authorisedAt: now };
}

/** Back to the start. The emergency exit and a cancel both land here. */
export const cancelConfirm = idleConfirm;

/**
 * What the gate is waiting for, so the surface can say it rather than showing an
 * inert control. A disabled thing with no explanation reads as broken.
 */
export function awaiting(state: ConfirmState): 'left-key' | 'right-key' | 'both-keys' | 'sweep' | 'done' {
  if (isAuthorised(state)) return 'done';
  if (!state.left && !state.right) return 'both-keys';
  if (!state.left) return 'left-key';
  if (!state.right) return 'right-key';
  return 'sweep';
}

export type DestructiveAction = {
  /** What will happen, in a few words. Never styled away by a funny level. */
  title: string;
  /** What it will happen to: a count, or names, or both. */
  detail: string;
  /** Named consequences, each one a plain fact. */
  consequences?: readonly string[];
};

/**
 * Is this description good enough to gate on?
 *
 * A confirmation whose copy does not name the thing being destroyed is a
 * confirmation for a question the person was never asked, and no amount of
 * ceremony around it fixes that.
 */
export function describesTheAction(action: DestructiveAction): boolean {
  return Boolean(action?.title?.trim()) && Boolean(action?.detail?.trim());
}
