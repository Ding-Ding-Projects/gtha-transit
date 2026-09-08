/**
 * ADHD modes: five accommodations, each switched on by itself.
 *
 * Modes, plural, and independently toggleable. Attention difficulties do not
 * arrive as a single setting: somebody may want the interface quieter without
 * wanting time nudges, or want time nudges precisely because they are
 * hyperfocusing and want interrupting. Bundling them into one switch means most
 * people turn the whole thing off to escape the one part that does not suit them.
 *
 * Every one of them is off by default. These are accommodations, not an opinion
 * about how everybody should work, and a mode that switches itself on has decided
 * something about the person it has no standing to decide.
 *
 * They are named for what they DO, so somebody can use them without disclosing
 * anything about themselves to a colleague reading over their shoulder. Nothing
 * here is medical: no diagnosis, no assessment, no advice, no claim of benefit.
 */

export type AdhdMode = 'focus' | 'lowStimulation' | 'timeAwareness' | 'oneThing' | 'momentum';

export const ADHD_MODES: readonly AdhdMode[] = ['focus', 'lowStimulation', 'timeAwareness', 'oneThing', 'momentum'];

export const ADHD_STORAGE_KEY = 'gtha-adhd-modes-v1';

export type AdhdState = {
  modes: Record<AdhdMode, boolean>;
  /** The one thing the person chose to be doing, when that mode is on. */
  oneThingText: string;
  /** When the session's clock started, for the time-awareness readout. */
  startedAt: number;
  /** The last time anything changed, for the momentum prompt. */
  lastChangeAt: number;
  /** Momentum stays quiet until this moment, after a "not now". */
  quietUntil: number;
};

/** How long a "not now" is respected. Thirty seconds would not be respecting it. */
export const SNOOZE_MS = 30 * 60 * 1000;

/** How long a surface sits untouched before momentum offers a prompt. */
export const IDLE_MS = 20 * 60 * 1000;

export const MAX_ONE_THING = 120;

export function emptyAdhdState(now = Date.now()): AdhdState {
  return {
    modes: Object.fromEntries(ADHD_MODES.map((mode) => [mode, false])) as Record<AdhdMode, boolean>,
    oneThingText: '',
    startedAt: now,
    lastChangeAt: now,
    quietUntil: 0,
  };
}

export const isOn = (state: AdhdState, mode: AdhdMode): boolean => state.modes[mode] === true;

export function toggleMode(state: AdhdState, mode: AdhdMode, now = Date.now()): AdhdState {
  return { ...state, modes: { ...state.modes, [mode]: !state.modes[mode] }, lastChangeAt: now };
}

export function setOneThing(state: AdhdState, text: string, now = Date.now()): AdhdState {
  return { ...state, oneThingText: String(text ?? '').slice(0, MAX_ONE_THING), lastChangeAt: now };
}

/** Something happened. Momentum measures from here. */
export const touch = (state: AdhdState, now = Date.now()): AdhdState => ({ ...state, lastChangeAt: now });

/** "Not now", respected for a stated period rather than for a moment. */
export const snooze = (state: AdhdState, now = Date.now()): AdhdState => ({ ...state, quietUntil: now + SNOOZE_MS, lastChangeAt: now });

/**
 * How long this session has been open, in whole minutes.
 *
 * Time blindness is one of the most consistently reported difficulties and almost
 * no software helps with it. Stating a number is the whole feature. Nagging about
 * it is not, which is why this returns a duration and never a judgement.
 */
export function elapsedMinutes(state: AdhdState, now = Date.now()): number {
  return Math.max(0, Math.floor((now - state.startedAt) / 60_000));
}

export function idleMinutes(state: AdhdState, now = Date.now()): number {
  return Math.max(0, Math.floor((now - state.lastChangeAt) / 60_000));
}

/**
 * Should momentum say something?
 *
 * Only when the mode is on, the surface has genuinely been still, and the person
 * has not asked for quiet. It is a prompt, never a blocker, and it says what is
 * true rather than what somebody should feel about it.
 */
export function momentumDue(state: AdhdState, now = Date.now()): boolean {
  if (!isOn(state, 'momentum')) return false;
  if (now < state.quietUntil) return false;
  return now - state.lastChangeAt >= IDLE_MS;
}

/**
 * The classes a surface carries for the modes that are on.
 *
 * Focus dims and de-emphasises and never hides anything that cannot be got back
 * in one obvious action: an interface that disappears work is a worse problem
 * than a busy one.
 */
export function adhdClassNames(state: AdhdState): string {
  return ADHD_MODES.filter((mode) => isOn(state, mode)).map((mode) => `adhd-${mode.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`).join(' ');
}

/**
 * Does low stimulation apply on top of the platform's own preference?
 *
 * It composes with `prefers-reduced-motion` and never overrides it. Somebody who
 * has already asked the operating system for less motion has asked once, and must
 * not have to ask again.
 */
export const quietMotion = (state: AdhdState, platformPrefersReduced: boolean): boolean =>
  platformPrefersReduced || isOn(state, 'lowStimulation');

/* -------------------------------------------------------------- persistence -- */

export function serializeAdhd(state: AdhdState): string {
  return JSON.stringify({
    version: 1,
    modes: Object.fromEntries(ADHD_MODES.map((mode) => [mode, state.modes[mode] === true])),
    oneThingText: state.oneThingText.slice(0, MAX_ONE_THING),
    quietUntil: state.quietUntil,
  });
}

/**
 * Restore, defaulting every mode to off.
 *
 * A stored file that cannot be read leaves every accommodation off, which is the
 * shipped state. Guessing at a partially readable one could switch something on
 * that the person never chose, and this is the one setting where that matters
 * most: turning a mode on for somebody is deciding something about them.
 *
 * `startedAt` is deliberately not restored. The session clock measures this
 * session; carrying yesterday's start forward would report a number that is not
 * about anything the person is doing.
 */
export function parseAdhd(raw: string | null | undefined, now = Date.now()): AdhdState {
  const empty = emptyAdhdState(now);
  if (!raw) return empty;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return empty; }
  if (!parsed || typeof parsed !== 'object') return empty;
  const { version, modes, oneThingText, quietUntil } = parsed as Record<string, unknown>;
  if (version !== 1 || !modes || typeof modes !== 'object') return empty;
  return {
    modes: Object.fromEntries(ADHD_MODES.map((mode) => [mode, (modes as Record<string, unknown>)[mode] === true])) as Record<AdhdMode, boolean>,
    oneThingText: typeof oneThingText === 'string' ? oneThingText.slice(0, MAX_ONE_THING) : '',
    startedAt: now,
    lastChangeAt: now,
    quietUntil: Number.isFinite(quietUntil) && (quietUntil as number) > now ? (quietUntil as number) : 0,
  };
}
