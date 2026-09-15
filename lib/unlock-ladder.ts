/**
 * The unlock ladder: something to do while a toy lock makes somebody wait.
 *
 * Dim sum, then ten sums, then whack-a-mole, then the clock. Clearing a rung ends
 * the wait. Nothing about it is a punishment: falling to the bottom leaves the
 * person exactly where they already were.
 *
 * The rules that stop it becoming a second, weaker password are the design, and
 * each one has a test that breaks it on purpose.
 *
 * - **It clears the wait, never the credential.** `clearWait` returns an attempt
 *   state and nothing else. It cannot grant an unlock because it has no access
 *   to grants; the person is sent back to the ordinary prompt and still has to
 *   know their PIN or password.
 * - **It never refunds more than the clock would.** Clearing sets exactly the
 *   budget a served wait sets, through the same fields.
 * - **It is budgeted.** At most three waits skipped per rolling hour, across
 *   every lock in this browser. After that the clock is the only way through.
 * - **It never slows the escalation.** The consecutive-lockout count is left
 *   alone, so the next wall is just as long as it would have been.
 * - **Answers are graded against single-use nonces.** The nonce is consumed
 *   before grading, so a wrong answer cannot be retried against the same question
 *   and a right one cannot be replayed. Challenges expire.
 * - **A round cannot be won faster than it lasts**, and each mole counts once.
 *
 * Where the contract cannot apply literally: it asks for grading on a server.
 * That rule exists so a script cannot skip a lockout the server enforces. These
 * locks, their attempt budgets and their waits all live in the same browser
 * storage the visitor can clear, which is also the documented way out, so a
 * server grader would guard nothing a person could not already walk around. The
 * equivalent shipped here keeps the answers inside this module's closure, never
 * in anything the rendering layer receives, and enforces every other rule above.
 * `docs/interface/locks.md` says the same thing in the same words.
 */

import { type AttemptState } from './toy-locks.ts';

export const LADDER_SKIPS_PER_HOUR = 3;
export const LADDER_WINDOW_MS = 60 * 60_000;
export const CHALLENGE_TTL_MS = 5 * 60_000;
export const DIM_SUM_WRONG_LIMIT = 5;
export const SUM_COUNT = 10;
export const MOLE_GRID = 9;
export const MOLE_COUNT = 14;
export const MOLE_ROUND_MS = 20_000;
export const MOLE_VISIBLE_MS = 1_200;
export const MOLE_HITS_NEEDED = 8;

export type Rung = 'dim-sum' | 'sums' | 'moles' | 'clock';

/**
 * Where the ladder starts.
 *
 * The one function that decides it, so no surface can get School mode wrong
 * locally: under School mode the dim sum rung is absent, not skipped with a
 * message naming it. With no dish pictures available it is absent too, rather
 * than being a question with no picture.
 */
export const startingRung = (schoolOn: boolean, dishesAvailable: boolean): Rung => (schoolOn || !dishesAvailable ? 'sums' : 'dim-sum');

export type LadderDish = { id: string; en: string; zh: string; image: string };

export type SumProblem = { left: number; operator: '+' | '-' | '×'; right: number };
export type Mole = { index: number; cell: number; appearsAt: number; visibleMs: number };

export type Challenge =
  | { rung: 'dim-sum'; nonce: string; expiresAt: number; image: string; choices: { id: string; en: string; zh: string }[]; wrongSoFar: number }
  | { rung: 'sums'; nonce: string; expiresAt: number; problems: SumProblem[] }
  | { rung: 'moles'; nonce: string; expiresAt: number; issuedAt: number; durationMs: number; grid: number; needed: number; moles: Mole[] };

export type MoleHit = { mole: number; cell: number; at: number };

export type SubmitOutcome = 'cleared' | 'wrong' | 'fell' | 'expired' | 'unknown-nonce' | 'too-early';

export type SubmitResult = { outcome: SubmitOutcome; rung: Rung; challenge: Challenge | null; score?: number };

/* ------------------------------------------------------------ budget -- */

export const skipsInWindow = (skips: readonly number[], now: number): number[] =>
  skips.filter((at) => Number.isFinite(at) && at <= now && now - at < LADDER_WINDOW_MS);

/**
 * Is the ladder on offer for this wait?
 *
 * Only while a wait is running, only once per lockout, and only while the hourly
 * budget has room. Each of those is a separate reason it is not offered, and the
 * surface says which.
 */
export function ladderAvailability(attempts: AttemptState, skips: readonly number[], now: number): 'offered' | 'no-wait' | 'spent-this-lockout' | 'hourly-budget' {
  if (attempts.waitUntil === null || attempts.waitUntil <= now) return 'no-wait';
  if (attempts.ladderSpentFor === attempts.lockouts) return 'spent-this-lockout';
  if (skipsInWindow(skips, now).length >= LADDER_SKIPS_PER_HOUR) return 'hourly-budget';
  return 'offered';
}

/**
 * The only thing clearing the ladder does.
 *
 * Exactly the budget `serveClock` restores -- failures back to zero, no wait --
 * and the lockout count untouched, so the escalation stands. No grant, no
 * session, no credential: this function cannot open a lock, because it is not
 * handed anything that could.
 */
export function clearWait(attempts: AttemptState, skips: readonly number[], now: number): { attempts: AttemptState; skips: number[] } {
  if (ladderAvailability(attempts, skips, now) !== 'offered') return { attempts, skips: skipsInWindow(skips, now) };
  return {
    attempts: { ...attempts, failures: 0, waitUntil: null, ladderSpentFor: attempts.lockouts },
    skips: [...skipsInWindow(skips, now), now],
  };
}

/** The ladder was lost to the clock: it is not offered again for this lockout. */
export const spendLadder = (attempts: AttemptState): AttemptState => ({ ...attempts, ladderSpentFor: attempts.lockouts });

/* ------------------------------------------------------------ session -- */

type Pending =
  | { rung: 'dim-sum'; expiresAt: number; answer: string }
  | { rung: 'sums'; expiresAt: number; answers: number[] }
  | { rung: 'moles'; expiresAt: number; issuedAt: number; durationMs: number; moles: Mole[] };

const secureRandom = (): number => {
  const source = globalThis.crypto;
  if (!source || typeof source.getRandomValues !== 'function') throw new Error('No secure random source is available in this browser.');
  return source.getRandomValues(new Uint32Array(1))[0] / 0x1_0000_0000;
};

const nonceFrom = (): string => {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

/**
 * One ladder, for one lockout.
 *
 * Everything that could answer a question -- the right dish, the sums' results,
 * which nonces are live -- is held in this closure and never returned. What the
 * surface gets is the question.
 */
export function createLadderSession(options: { schoolOn: boolean; dishes: readonly LadderDish[]; random?: () => number }) {
  const random = options.random ?? secureRandom;
  const dishes = options.dishes.filter((dish) => dish && dish.id && dish.image);
  const pending = new Map<string, Pending>();
  let rung: Rung = startingRung(options.schoolOn, dishes.length >= 4);
  let dimSumWrong = 0;
  const pick = (count: number) => Math.min(count - 1, Math.floor(random() * count));

  const issue = (now: number): Challenge | null => {
    const nonce = nonceFrom();
    const expiresAt = now + CHALLENGE_TTL_MS;
    if (rung === 'dim-sum') {
      const pool = [...dishes];
      const chosen: LadderDish[] = [];
      while (chosen.length < 4 && pool.length > 0) chosen.push(pool.splice(pick(pool.length), 1)[0]);
      const answer = chosen[pick(chosen.length)];
      pending.set(nonce, { rung, expiresAt, answer: answer.id });
      return { rung, nonce, expiresAt, image: answer.image, choices: chosen.map(({ id, en, zh }) => ({ id, en, zh })), wrongSoFar: dimSumWrong };
    }
    if (rung === 'sums') {
      const problems: SumProblem[] = [];
      const answers: number[] = [];
      for (let index = 0; index < SUM_COUNT; index += 1) {
        const kind = pick(3);
        if (kind === 0) { const left = 1 + pick(40); const right = 1 + pick(40); problems.push({ left, operator: '+', right }); answers.push(left + right); }
        else if (kind === 1) { const left = 10 + pick(60); const right = 1 + pick(left); problems.push({ left, operator: '-', right }); answers.push(left - right); }
        else { const left = 2 + pick(8); const right = 2 + pick(8); problems.push({ left, operator: '×', right }); answers.push(left * right); }
      }
      pending.set(nonce, { rung, expiresAt, answers });
      return { rung, nonce, expiresAt, problems };
    }
    if (rung === 'moles') {
      const moles: Mole[] = [];
      const span = MOLE_ROUND_MS - 1_000 - MOLE_VISIBLE_MS;
      for (let index = 0; index < MOLE_COUNT; index += 1) {
        moles.push({ index, cell: pick(MOLE_GRID), appearsAt: 800 + Math.round((span * index) / (MOLE_COUNT - 1)), visibleMs: MOLE_VISIBLE_MS });
      }
      pending.set(nonce, { rung, expiresAt, issuedAt: now, durationMs: MOLE_ROUND_MS, moles });
      return { rung, nonce, expiresAt, issuedAt: now, durationMs: MOLE_ROUND_MS, grid: MOLE_GRID, needed: MOLE_HITS_NEEDED, moles: moles.map((mole) => ({ ...mole })) };
    }
    return null;
  };

  const settle = (outcome: SubmitOutcome, now: number, score?: number): SubmitResult =>
    ({ outcome, rung, challenge: outcome === 'cleared' || rung === 'clock' ? null : issue(now), ...(score === undefined ? {} : { score }) });

  return {
    get rung(): Rung { return rung; },
    begin: (now: number): Challenge | null => issue(now),

    /**
     * Move from the dim sum picture to the sums, by choice.
     *
     * A picture question cannot be answered by somebody who cannot see the
     * picture, and its text alternative cannot name the dish without giving the
     * answer away. Moving down is always allowed and gains nothing: every pending
     * dim sum question is withdrawn, and the sums are as hard as ever.
     */
    descend(now: number): Challenge | null {
      if (rung !== 'dim-sum') return null;
      for (const [nonce, entry] of pending) if (entry.rung === 'dim-sum') pending.delete(nonce);
      rung = 'sums';
      return issue(now);
    },

    submit(nonce: string, answer: unknown, now: number): SubmitResult {
      const entry = pending.get(nonce);
      /* Consumed before anything is graded. A wrong answer cannot be retried
         against this question, and a right one cannot be sent twice. */
      pending.delete(nonce);
      if (!entry || entry.rung !== rung) return { outcome: 'unknown-nonce', rung, challenge: null };
      if (entry.expiresAt <= now) return settle('expired', now);

      if (entry.rung === 'dim-sum') {
        if (typeof answer === 'string' && answer === entry.answer) return settle('cleared', now);
        dimSumWrong += 1;
        if (dimSumWrong >= DIM_SUM_WRONG_LIMIT) { rung = 'sums'; return settle('fell', now); }
        return settle('wrong', now);
      }

      if (entry.rung === 'sums') {
        const given = Array.isArray(answer) ? answer : [];
        const allRight = given.length === entry.answers.length
          && entry.answers.every((expected, index) => typeof given[index] === 'number' && given[index] === expected);
        if (allRight) return settle('cleared', now);
        rung = 'moles';
        return settle('fell', now);
      }

      /* Moles. */
      if (now - entry.issuedAt < entry.durationMs) { rung = 'clock'; return settle('too-early', now, 0); }
      const hits = Array.isArray(answer) ? (answer as MoleHit[]).slice(0, 200) : [];
      const counted = new Set<number>();
      for (const hit of hits) {
        const mole = entry.moles[hit?.mole];
        if (!mole || counted.has(mole.index)) continue;
        if (hit.cell !== mole.cell) continue;
        if (!Number.isFinite(hit.at) || hit.at < mole.appearsAt || hit.at > mole.appearsAt + mole.visibleMs || hit.at > entry.durationMs) continue;
        counted.add(mole.index);
      }
      if (counted.size >= MOLE_HITS_NEEDED) return settle('cleared', now, counted.size);
      rung = 'clock';
      return settle('fell', now, counted.size);
    },
  };
}

export type LadderSession = ReturnType<typeof createLadderSession>;
