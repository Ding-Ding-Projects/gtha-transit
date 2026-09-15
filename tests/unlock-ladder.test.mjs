import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  CHALLENGE_TTL_MS,
  DIM_SUM_WRONG_LIMIT,
  LADDER_SKIPS_PER_HOUR,
  LADDER_WINDOW_MS,
  MOLE_HITS_NEEDED,
  clearWait,
  createLadderSession,
  ladderAvailability,
  spendLadder,
  startingRung,
} from '../lib/unlock-ladder.ts';
import {
  ATTEMPTS_PER_WAIT,
  createLock,
  freshAttempts,
  isLockedNow,
  recordFailure,
  serveClock,
} from '../lib/toy-locks.ts';

const NOW = 1_700_000_000_000;
const dishes = ['har-gow', 'siu-mai', 'char-siu-bao', 'cheung-fun', 'lo-mai-gai'].map((id) => ({ id, en: id, zh: id, image: `/dim-sum/${id}.jpg` }));

/** A lockout in progress: five wrong answers just now. */
function lockedOut(now = NOW) {
  let state = freshAttempts();
  for (let index = 0; index < ATTEMPTS_PER_WAIT; index += 1) state = recordFailure(state, now);
  return state;
}

/** The dish a dim sum challenge is about, found by its picture. Only a test knows the image names match ids. */
const rightDish = (challenge) => challenge.choices.find((choice) => challenge.image.includes(choice.id)).id;
const wrongDish = (challenge) => challenge.choices.find((choice) => !challenge.image.includes(choice.id)).id;

const solve = ({ left, operator, right }) => (operator === '+' ? left + right : operator === '-' ? left - right : left * right);

/** Walk a School-mode session (which starts at the sums) down to the moles. */
function toMoles(session, now) {
  const sums = session.begin(now);
  return session.submit(sums.nonce, [], now).challenge;
}

test('the ladder starts at dim sum, and under School mode it starts at the sums', () => {
  assert.equal(startingRung(false, true), 'dim-sum');
  assert.equal(startingRung(true, true), 'sums');
  assert.equal(startingRung(false, false), 'sums', 'with no pictures the dim sum rung is absent, not pictureless');
  const school = createLadderSession({ schoolOn: true, dishes });
  assert.equal(school.rung, 'sums');
  assert.equal(school.begin(NOW).rung, 'sums', 'no dim sum question is ever issued under School mode');
});

test('rung 1: the right dish clears the wait', () => {
  const session = createLadderSession({ schoolOn: false, dishes });
  const challenge = session.begin(NOW);
  assert.equal(challenge.rung, 'dim-sum');
  assert.equal(challenge.choices.length, 4);
  assert.equal(JSON.stringify(challenge).includes('answer'), false, 'the challenge carries the question, never the answer');
  assert.equal(session.submit(challenge.nonce, rightDish(challenge), NOW).outcome, 'cleared');
});

test('rung 1 falls to the sums after five wrong dishes, not before', () => {
  const session = createLadderSession({ schoolOn: false, dishes });
  let challenge = session.begin(NOW);
  for (let index = 1; index < DIM_SUM_WRONG_LIMIT; index += 1) {
    const result = session.submit(challenge.nonce, wrongDish(challenge), NOW);
    assert.equal(result.outcome, 'wrong');
    challenge = result.challenge;
  }
  const fell = session.submit(challenge.nonce, wrongDish(challenge), NOW);
  assert.equal(fell.outcome, 'fell');
  assert.equal(fell.challenge.rung, 'sums');
  assert.equal(fell.challenge.problems.length, 10);
});

test('rung 2: all ten right clears; one wrong falls to the moles', () => {
  const clear = createLadderSession({ schoolOn: true, dishes });
  const sums = clear.begin(NOW);
  for (const problem of sums.problems) assert.ok(problem.left < 100 && problem.right < 100, 'nothing anybody needs paper for');
  assert.equal(clear.submit(sums.nonce, sums.problems.map(solve), NOW).outcome, 'cleared');

  const miss = createLadderSession({ schoolOn: true, dishes });
  const second = miss.begin(NOW);
  const answers = second.problems.map(solve);
  answers[7] += 1;
  const fell = miss.submit(second.nonce, answers, NOW);
  assert.equal(fell.outcome, 'fell');
  assert.equal(fell.challenge.rung, 'moles');
});

test('an answer of the wrong kind is graded as wrong, not retried', () => {
  const session = createLadderSession({ schoolOn: true, dishes });
  const sums = session.begin(NOW);
  const result = session.submit(sums.nonce, 'forty-two', NOW);
  assert.equal(result.outcome, 'fell');
  assert.equal(session.submit(sums.nonce, sums.problems.map(solve), NOW).outcome, 'unknown-nonce');
});

test('a nonce is consumed before grading: a replayed right answer is refused', () => {
  const session = createLadderSession({ schoolOn: false, dishes });
  const challenge = session.begin(NOW);
  const answer = rightDish(challenge);
  assert.equal(session.submit(challenge.nonce, answer, NOW).outcome, 'cleared');
  assert.equal(session.submit(challenge.nonce, answer, NOW).outcome, 'unknown-nonce');
  assert.equal(session.submit('made-up-nonce', answer, NOW).outcome, 'unknown-nonce');
});

test('a wrong answer cannot be retried against the same question', () => {
  const session = createLadderSession({ schoolOn: false, dishes });
  const challenge = session.begin(NOW);
  session.submit(challenge.nonce, wrongDish(challenge), NOW);
  assert.equal(session.submit(challenge.nonce, rightDish(challenge), NOW).outcome, 'unknown-nonce');
});

test('an expired challenge clears nothing', () => {
  const session = createLadderSession({ schoolOn: false, dishes });
  const challenge = session.begin(NOW);
  const result = session.submit(challenge.nonce, rightDish(challenge), NOW + CHALLENGE_TTL_MS);
  assert.equal(result.outcome, 'expired');
  assert.equal(result.challenge.rung, 'dim-sum', 'a fresh question is issued instead');
});

test('rung 3: a round submitted before it has lasted its own duration is lost', () => {
  const session = createLadderSession({ schoolOn: true, dishes });
  const moles = toMoles(session, NOW);
  assert.equal(moles.rung, 'moles');
  const perfect = moles.moles.map((mole) => ({ mole: mole.index, cell: mole.cell, at: mole.appearsAt + 10 }));
  const early = session.submit(moles.nonce, perfect, NOW + moles.durationMs - 1);
  assert.equal(early.outcome, 'too-early');
  assert.equal(session.rung, 'clock');
});

test('rung 3: enough real hits after the round clears it', () => {
  const session = createLadderSession({ schoolOn: true, dishes });
  const moles = toMoles(session, NOW);
  const hits = moles.moles.slice(0, MOLE_HITS_NEEDED).map((mole) => ({ mole: mole.index, cell: mole.cell, at: mole.appearsAt + 100 }));
  const result = session.submit(moles.nonce, hits, NOW + moles.durationMs);
  assert.equal(result.outcome, 'cleared');
  assert.equal(result.score, MOLE_HITS_NEEDED);
});

test('rung 3: each mole counts once, and only when it was really there', () => {
  const session = createLadderSession({ schoolOn: true, dishes });
  const moles = toMoles(session, NOW);
  const first = moles.moles[0];
  const spam = Array.from({ length: 50 }, () => ({ mole: first.index, cell: first.cell, at: first.appearsAt + 5 }));
  const wrongCell = moles.moles.map((mole) => ({ mole: mole.index, cell: (mole.cell + 1) % moles.grid, at: mole.appearsAt + 5 }));
  const outsideWindow = moles.moles.map((mole) => ({ mole: mole.index, cell: mole.cell, at: mole.appearsAt + mole.visibleMs + 1 }));
  const beforeAppearing = moles.moles.map((mole) => ({ mole: mole.index, cell: mole.cell, at: mole.appearsAt - 1 }));
  const outsideRound = moles.moles.map((mole) => ({ mole: mole.index, cell: mole.cell, at: moles.durationMs + 1 }));
  const result = session.submit(moles.nonce, [...spam, ...wrongCell, ...outsideWindow, ...beforeAppearing, ...outsideRound], NOW + moles.durationMs);
  assert.equal(result.score, 1, 'one mole, hit once, is one hit however many taps arrived');
  assert.equal(result.outcome, 'fell');
  assert.equal(session.rung, 'clock', 'a lost round falls to the clock');
  assert.equal(result.challenge, null, 'and the ladder is not offered again');
});

test('NEVER 1: clearing the ladder clears the wait, never the credential', () => {
  const { lock } = createLock({
    target: { kind: 'saved-trip', key: 't', label: { en: 't', zh: 't' } }, policy: 'pin', pin: '4821', pinConfirm: '4821',
    duration: { kind: 'session' }, acknowledged: true,
  }, NOW, 10);
  const attempts = lockedOut();
  const { attempts: cleared } = clearWait(attempts, [], NOW + 1);
  assert.equal(cleared.waitUntil, null);
  assert.equal(isLockedNow(lock, undefined, NOW + 1), true, 'the surface is exactly as closed as it was');
  const source = readFileSync(new URL('../lib/unlock-ladder.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(source, /grantFor|UnlockGrant|matchesFactor|checkFactor|localStorage|document\.cookie/, 'the ladder has no route to a grant, a credential or a session');
});

test('NEVER 2: clearing refunds exactly what serving the clock refunds, and not one more', () => {
  const attempts = lockedOut();
  const byClock = serveClock(attempts, attempts.waitUntil);
  const { attempts: byLadder } = clearWait(attempts, [], NOW + 1);
  assert.equal(byLadder.failures, byClock.failures);
  assert.equal(byLadder.waitUntil, byClock.waitUntil);
});

test('NEVER 3: at most three waits skipped per rolling hour, then only the clock', () => {
  let skips = [];
  for (let round = 0; round < LADDER_SKIPS_PER_HOUR; round += 1) {
    const at = NOW + round * 60_000;
    assert.equal(ladderAvailability(lockedOut(at), skips, at + 1), 'offered');
    skips = clearWait(lockedOut(at), skips, at + 1).skips;
  }
  const later = NOW + 10 * 60_000;
  const blocked = lockedOut(later);
  assert.equal(ladderAvailability(blocked, skips, later + 1), 'hourly-budget');
  assert.equal(clearWait(blocked, skips, later + 1).attempts.waitUntil, blocked.waitUntil, 'a spent budget clears nothing');
  assert.equal(ladderAvailability(lockedOut(NOW + LADDER_WINDOW_MS + 1), skips, NOW + LADDER_WINDOW_MS + 2), 'offered', 'and it refills on a rolling hour');
});

test('NEVER 4: the escalation stands after a cleared ladder', () => {
  const attempts = lockedOut();
  const { attempts: cleared } = clearWait(attempts, [], NOW + 1);
  assert.equal(cleared.lockouts, attempts.lockouts);
  let again = cleared;
  for (let index = 0; index < ATTEMPTS_PER_WAIT; index += 1) again = recordFailure(again, NOW + 2);
  assert.equal(again.lockouts, 2);
  assert.equal(again.waitUntil - (NOW + 2), 60_000, 'the second wall is twice the first, exactly as without the ladder');
});

test('NEVER 5: the answers stay inside the grader', () => {
  const session = createLadderSession({ schoolOn: true, dishes });
  const sums = session.begin(NOW);
  const shown = JSON.stringify(sums);
  assert.doesNotMatch(shown, /answers?"/);
  assert.deepEqual(Object.keys(session).sort(), ['begin', 'descend', 'rung', 'submit'], 'nothing else is exposed to the surface');
});

test('moving from the picture to the sums withdraws the picture question and gains nothing', () => {
  const session = createLadderSession({ schoolOn: false, dishes });
  const picture = session.begin(NOW);
  const sums = session.descend(NOW);
  assert.equal(sums.rung, 'sums');
  assert.equal(session.submit(picture.nonce, rightDish(picture), NOW).outcome, 'unknown-nonce', 'the withdrawn question no longer clears anything');
  assert.equal(session.descend(NOW), null, 'there is nowhere further to move by choice');
});

test('the ladder is offered once per lockout, and not at all without a wait', () => {
  assert.equal(ladderAvailability(freshAttempts(), [], NOW), 'no-wait');
  const attempts = spendLadder(lockedOut());
  assert.equal(ladderAvailability(attempts, [], NOW + 1), 'spent-this-lockout');
});
