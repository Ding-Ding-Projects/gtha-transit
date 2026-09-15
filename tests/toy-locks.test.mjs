import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  ATTEMPTS_PER_WAIT,
  ATTEMPT_TTL_MS,
  FIRST_WAIT_MS,
  LOCKABLE_SECTIONS,
  LOCK_DISCLOSURE,
  LOCK_POLICIES,
  LOCK_RECOVERY,
  MAX_WAIT_MS,
  POLICY_FACTORS,
  attemptsLeft,
  beginAttempt,
  checkFactor,
  createLock,
  createLocks,
  draftProblems,
  freshAttempts,
  grantFor,
  isLockedNow,
  matchesFactor,
  parseAttempts,
  parseLocks,
  recordFailure,
  redactLock,
  serializeLocks,
  serveClock,
  submitStep,
  targetId,
  waitFor,
} from '../lib/toy-locks.ts';
import { base32Encode, totpAt } from '../lib/totp.ts';

/* Obviously fake test credentials. Low iterations so the suite stays quick;
   the shipped count is asserted separately. */
const FAST = 10;
const PIN = '4821';
const PASSWORD = 'not-a-real-password';
const SECRET = base32Encode(new TextEncoder().encode('fake-test-secret-1234'));
const OTP = { algorithm: 'sha1', digits: 6, period: 30 };
const NOW = 1_700_000_000_000;
const seconds = Math.floor(NOW / 1000);

const target = (key = 'trip-1') => ({ kind: 'saved-trip', key, label: { en: `Trip ${key}`, zh: `行程 ${key}` } });

function draft(policy, overrides = {}) {
  return {
    target: target(),
    policy,
    pin: PIN, pinConfirm: PIN,
    password: PASSWORD, passwordConfirm: PASSWORD,
    otpSecret: SECRET, otp: OTP, otpConfirmCode: totpAt(new TextEncoder().encode('fake-test-secret-1234'), seconds, OTP),
    duration: { kind: 'surface' },
    acknowledged: true,
    ...overrides,
  };
}

const answerFor = (factor) => (factor === 'pin' ? PIN : factor === 'password' ? PASSWORD : totpAt(new TextEncoder().encode('fake-test-secret-1234'), seconds, OTP));

test('exactly the six policies, each with its factors in a stated order', () => {
  assert.deepEqual([...LOCK_POLICIES], ['pin', 'password', 'pin+password', 'password+totp', 'pin+totp', 'password+pin+totp']);
  assert.deepEqual(POLICY_FACTORS['password+pin+totp'], ['password', 'pin', 'totp']);
  assert.deepEqual(POLICY_FACTORS['pin+totp'], ['pin', 'totp']);
  for (const policy of LOCK_POLICIES) assert.ok(POLICY_FACTORS[policy].length >= 1, `${policy} asks for nothing`);
});

for (const policy of LOCK_POLICIES) {
  test(`policy ${policy}: the right factors in order unlock, and each wrong factor is refused`, () => {
    const { lock, otpSecret } = createLock(draft(policy), NOW, FAST);
    const factors = POLICY_FACTORS[policy];

    let attempt = beginAttempt(lock, NOW);
    let attempts = freshAttempts();
    for (let index = 0; index < factors.length; index += 1) {
      const result = submitStep(lock, attempt, attempts, answerFor(factors[index]), otpSecret, NOW);
      assert.equal(result.outcome, index === factors.length - 1 ? 'unlocked' : 'next', `${policy} step ${index}`);
      attempt = result.attempt;
      attempts = result.attempts;
    }

    for (let wrongAt = 0; wrongAt < factors.length; wrongAt += 1) {
      let tryAttempt = beginAttempt(lock, NOW);
      let budget = freshAttempts();
      let outcome;
      for (let index = 0; index <= wrongAt; index += 1) {
        const value = index === wrongAt ? (factors[index] === 'totp' ? '000000' : 'wrong-value-9') : answerFor(factors[index]);
        const result = submitStep(lock, tryAttempt, budget, value, otpSecret, NOW);
        tryAttempt = result.attempt; budget = result.attempts; outcome = result.outcome;
      }
      assert.equal(outcome, 'wrong', `${policy} accepted a wrong ${factors[wrongAt]}`);
      assert.equal(tryAttempt.step, 0, 'a wrong answer sends the attempt back to its first factor');
      assert.equal(budget.failures, 1, 'and spends exactly one attempt');
    }
  });
}

test('a factor the policy does not name is never accepted, even with the right value', () => {
  const { lock } = createLock(draft('password'), NOW, FAST);
  assert.equal(lock.pin, undefined, 'a PIN supplied to a password policy is not stored');
  assert.equal(checkFactor(lock, 'pin', PIN, null, seconds), false);
  assert.equal(checkFactor(lock, 'password', PASSWORD, null, seconds), true);
});

test('credentials are stored as salted hashes, never as the value', () => {
  const { lock, otpSecret } = createLock(draft('password+pin+totp'), NOW, FAST);
  const stored = serializeLocks([lock]);
  assert.ok(!stored.includes(PIN), 'the PIN is not in the lock list');
  assert.ok(!stored.includes(PASSWORD), 'the password is not in the lock list');
  assert.ok(!stored.includes(SECRET), 'the authenticator secret is not in the lock list either');
  assert.equal(otpSecret, SECRET, 'the secret is returned separately, for its own record');
  assert.ok(lock.pin.salt && lock.pin.hash && lock.password.salt && lock.password.hash);
  assert.notEqual(lock.pin.salt, lock.password.salt, 'each factor has its own salt');
});

test('two locks with the same PIN store different hashes, and neither opens the other', () => {
  const [first, second] = createLocks({ ...draft('pin'), target: undefined }, [target('a'), target('b')], NOW, FAST).map((made) => made.lock);
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.pin.hash, second.pin.hash);
  const grant = grantFor(first, NOW);
  assert.equal(isLockedNow(first, grant, NOW), false);
  assert.equal(isLockedNow(second, grant, NOW), true, 'a grant for one lock never opens another');
});

test('the shipped work factor is the real one', () => {
  const { lock } = createLock(draft('pin'), NOW);
  assert.equal(lock.pin.iterations, 50_000);
  assert.equal(matchesFactor(lock.pin, PIN), true);
});

test('a draft names every problem, and a TOTP factor only arms on a matching code', () => {
  assert.deepEqual(draftProblems(draft('pin', { pin: '12', pinConfirm: '12' }), seconds), ['pin-unusable']);
  assert.deepEqual(draftProblems(draft('pin', { pinConfirm: '9999' }), seconds), ['pin-mismatch']);
  assert.deepEqual(draftProblems(draft('password', { password: 'short', passwordConfirm: 'short' }), seconds), ['password-unusable']);
  assert.deepEqual(draftProblems(draft('pin+totp', { otpConfirmCode: '000000' }), seconds), ['otp-confirm']);
  assert.deepEqual(draftProblems(draft('pin', { acknowledged: false }), seconds), ['not-acknowledged']);
  assert.deepEqual(draftProblems(draft('pin', { duration: { kind: 'minutes', minutes: 0 } }), seconds), ['duration']);
  assert.throws(() => createLock(draft('pin+totp', { otpConfirmCode: '000000' }), NOW, FAST));
});

test('five wrong answers start a wait; the wait doubles per lockout and is capped', () => {
  let state = freshAttempts();
  for (let index = 0; index < ATTEMPTS_PER_WAIT - 1; index += 1) state = recordFailure(state, NOW);
  assert.equal(state.waitUntil, null);
  assert.equal(attemptsLeft(state, NOW), 1);
  state = recordFailure(state, NOW);
  assert.equal(state.waitUntil, NOW + FIRST_WAIT_MS);
  assert.equal(attemptsLeft(state, NOW), 0);
  assert.equal(waitFor(2), FIRST_WAIT_MS * 2);
  assert.equal(waitFor(40), MAX_WAIT_MS);
});

test('a running wait refuses every answer, including the right one, and never wipes anything', () => {
  const { lock } = createLock(draft('pin'), NOW, FAST);
  let attempts = freshAttempts();
  for (let index = 0; index < ATTEMPTS_PER_WAIT; index += 1) attempts = recordFailure(attempts, NOW);
  const result = submitStep(lock, beginAttempt(lock, NOW), attempts, PIN, null, NOW + 1);
  assert.equal(result.outcome, 'waiting');
  assert.equal(result.attempts.lockouts, 1);
  const served = serveClock(attempts, NOW + FIRST_WAIT_MS);
  assert.equal(served.failures, 0, 'the clock restores the budget');
  assert.equal(served.lockouts, 1, 'but not the escalation');
  assert.equal(submitStep(lock, beginAttempt(lock, NOW + FIRST_WAIT_MS), served, PIN, null, NOW + FIRST_WAIT_MS).outcome, 'unlocked');
});

test('verified factors are kept only for the attempt they belong to', () => {
  const { lock } = createLock(draft('pin+password'), NOW, FAST);
  const first = submitStep(lock, beginAttempt(lock, NOW), freshAttempts(), PIN, null, NOW);
  assert.equal(first.outcome, 'next');
  const late = submitStep(lock, first.attempt, first.attempts, PASSWORD, null, NOW + ATTEMPT_TTL_MS + 1);
  assert.equal(late.outcome, 'expired', 'a verified PIN does not wait forever for the password');
  assert.equal(late.attempt.step, 0);
});

test('a grant is memory only: every lock is locked on launch', () => {
  const { lock } = createLock(draft('pin', { duration: { kind: 'minutes', minutes: 5 } }), NOW, FAST);
  const grant = grantFor(lock, NOW);
  assert.equal(isLockedNow(lock, grant, NOW + 4 * 60_000), false);
  assert.equal(isLockedNow(lock, grant, NOW + 5 * 60_000), true, 'the chosen duration expires');
  const restored = parseLocks(serializeLocks([lock])).locks[0];
  assert.equal(isLockedNow(restored, undefined, NOW), true, 'a restored lock has no grant');
  assert.ok(!serializeLocks([lock]).includes('until'), 'grants are never written with the list');
});

test('a restored record missing its credential is dropped and counted, never restored weaker', () => {
  const { lock } = createLock(draft('pin+password'), NOW, FAST);
  const broken = { ...lock, password: undefined };
  const result = parseLocks(serializeLocks([broken]));
  assert.equal(result.locks.length, 0);
  assert.equal(result.dropped, 1);
  const { lock: otpLock, otpSecret } = createLock(draft('pin+totp'), NOW, FAST);
  assert.equal(parseLocks(serializeLocks([otpLock]), {}).locks.length, 0, 'a TOTP lock whose secret is gone is dropped');
  assert.equal(parseLocks(serializeLocks([otpLock]), { [otpLock.id]: otpSecret }).locks.length, 1);
  assert.deepEqual(parseLocks('not json'), { locks: [], dropped: 0 });
});

test('stored attempt counts are bounded when read back', () => {
  const parsed = parseAttempts(JSON.stringify({ a: { failures: 999, lockouts: -3, waitUntil: 'soon', ladderSpentFor: 2 } }));
  assert.deepEqual(parsed.a, { failures: ATTEMPTS_PER_WAIT, lockouts: 0, waitUntil: null, ladderSpentFor: 2 });
});

test('the export of a lock names it and carries no credential field', () => {
  const { lock } = createLock(draft('password+pin+totp'), NOW, FAST);
  const row = JSON.stringify(redactLock(lock));
  for (const forbidden of [PIN, PASSWORD, SECRET, lock.pin.hash, lock.pin.salt, lock.password.hash, lock.password.salt]) {
    assert.ok(!row.includes(forbidden), 'no credential or hash reaches the export');
  }
  assert.match(row, /omitted/);
  assert.equal(targetId(lock.target), 'saved-trip:trip-1');
});

test('the Privacy section, which holds the way out, cannot be locked', () => {
  assert.deepEqual([...LOCKABLE_SECTIONS], ['appearance', 'language', 'comfort', 'narrator']);
});

test('the copy says it is for fun, and names the way out and its cost', () => {
  assert.match(LOCK_DISCLOSURE.en, /for fun/);
  assert.match(LOCK_DISCLOSURE.en, /not protection/);
  assert.match(LOCK_RECOVERY.en, /Clear this site's data/);
  assert.match(LOCK_RECOVERY.en, /saved trips/);
  assert.ok(LOCK_DISCLOSURE.zh.length > 0 && LOCK_RECOVERY.zh.length > 0);
});

test('nothing in the lock code claims to secure, protect or encrypt anything', () => {
  for (const file of ['lib/toy-locks.ts', 'components/toy-lock.tsx', 'components/locks-settings.tsx']) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const copy = [...text.matchAll(/t\(\s*(['`])((?:\\.|(?!\1).)*)\1/g)].map((match) => match[2]).join('\n');
    /* "No secure random source" is a statement about the platform, not a claim
       about the lock, so the pattern looks for something being secured. */
    assert.doesNotMatch(copy, /\b(secures? (your|this|the|it)|encrypt\w*|keeps? (you|your \w+|it) safe|protects? (you|your|it))\b/i, `${file} makes a claim a toy lock cannot keep`);
  }
});
