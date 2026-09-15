import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXTERNAL_KIND,
  MAX_EXTERNAL_SCHEDULE_BYTES,
  MAX_RULES,
  SCHEDULE_STARTERS,
  SHIPPED_SCHEDULE,
  evaluateSchedule,
  externalScheduleMessage,
  findActiveRule,
  nextScheduleChange,
  parseExternalSchedule,
  parseSchedule,
  ruleActiveAt,
  serializeSchedule,
  torontoParts,
} from '../lib/scheduled-settings.ts';

const t = (en) => en;

test('torontoParts reads the real weekday and minute-of-day, and crosses the Daylight Saving boundary correctly', () => {
  // 2026-03-08 07:30 UTC is 02:30 EST the instant before the spring-forward, and 2026-03-08 07:30 UTC
  // itself lands after clocks jump from 2:00 to 3:00 -- so this is a real, verifiable DST edge.
  const beforeSpringForward = new Date('2026-03-08T06:59:00Z');
  const afterSpringForward = new Date('2026-03-08T07:01:00Z');
  const before = torontoParts(beforeSpringForward);
  const after = torontoParts(afterSpringForward);
  // EST is UTC-5, so 06:59Z is 01:59 local -- one minute before the 2am jump.
  assert.equal(before.minutes, 1 * 60 + 59);
  // EDT is UTC-4, so 07:01Z is 03:01 local -- the wall clock skipped straight from 01:59 to 03:00.
  assert.equal(after.minutes, 3 * 60 + 1);
  assert.equal(before.weekday, after.weekday, 'still the same Sunday on both sides of the jump');

  // 2026-11-01 06:30 UTC is 01:30 EDT, the instant before fall-back; 2026-11-01 07:30 UTC is 01:30 EST,
  // after clocks have fallen back an hour -- so 06:30Z and 07:30Z land on the *same* local wall-clock minute.
  const beforeFallBack = torontoParts(new Date('2026-11-01T05:30:00Z'));
  const afterFallBack = torontoParts(new Date('2026-11-01T06:30:00Z'));
  assert.equal(beforeFallBack.minutes, 1 * 60 + 30);
  assert.equal(afterFallBack.minutes, 1 * 60 + 30);
});

test('a same-day rule matches only its own window and day', () => {
  const rule = { id: 'morning', label: 'Morning', enabled: true, days: [1, 2, 3, 4, 5], startMinutes: 7 * 60, endMinutes: 9 * 60, lang: 'zh', dark: null, presetId: null };
  assert.equal(ruleActiveAt(rule, 1, 7 * 60), true, 'the start minute is inclusive');
  assert.equal(ruleActiveAt(rule, 1, 9 * 60), false, 'the end minute is exclusive');
  assert.equal(ruleActiveAt(rule, 1, 8 * 60), true);
  assert.equal(ruleActiveAt(rule, 0, 8 * 60), false, 'Sunday is not in days');
  assert.equal(ruleActiveAt({ ...rule, enabled: false }, 1, 8 * 60), false, 'a disabled rule never matches');
});

test('an overnight rule wraps past midnight onto the next calendar day', () => {
  const rule = { id: 'evening', label: 'Evening', enabled: true, days: [5], startMinutes: 19 * 60, endMinutes: 6 * 60, lang: null, dark: true, presetId: null };
  // Friday 8pm: still Friday, after the start.
  assert.equal(ruleActiveAt(rule, 5, 20 * 60), true);
  // Saturday 2am: the window that *started* Friday is still open, matched via the previous-day branch.
  assert.equal(ruleActiveAt(rule, 6, 2 * 60), true);
  // Saturday 7am: past the wrapped end.
  assert.equal(ruleActiveAt(rule, 6, 7 * 60), false);
  // Thursday 11pm: Thursday is not in days, so the window never opened.
  assert.equal(ruleActiveAt(rule, 4, 23 * 60), false);
});

test('the first matching rule wins, in document order', () => {
  const rules = [
    { id: 'a', label: 'A', enabled: true, days: [0, 1, 2, 3, 4, 5, 6], startMinutes: 0, endMinutes: 1439, lang: 'en', dark: null, presetId: null },
    { id: 'b', label: 'B', enabled: true, days: [0, 1, 2, 3, 4, 5, 6], startMinutes: 0, endMinutes: 1439, lang: 'zh', dark: null, presetId: null },
  ];
  const now = new Date('2026-06-15T15:00:00Z');
  assert.equal(findActiveRule(rules, now)?.id, 'a');
  assert.equal(findActiveRule([rules[1]], now)?.id, 'b');
  assert.equal(findActiveRule([], now), null);
});

test('the manual override wins over every rule until it expires, then the rule resumes', () => {
  const document = parseSchedule(serializeSchedule({
    ...SHIPPED_SCHEDULE,
    rules: [{ id: 'always-en', label: 'Always English', enabled: true, days: [0, 1, 2, 3, 4, 5, 6], startMinutes: 0, endMinutes: 1439, lang: 'en', dark: null, presetId: null }],
    overrideUntil: '2026-06-15T18:00:00.000Z',
    overrideLang: 'zh',
    overrideDark: true,
    overridePresetId: null,
  }));
  const duringOverride = evaluateSchedule(document, new Date('2026-06-15T17:00:00Z'));
  assert.deepEqual(duringOverride, { lang: 'zh', dark: true, presetId: null, source: 'override', ruleId: null });
  const afterOverride = evaluateSchedule(document, new Date('2026-06-15T18:01:00Z'));
  assert.equal(afterOverride.source, 'rule');
  assert.equal(afterOverride.lang, 'en');
});

test('with no rule active and no override, the schedule has no opinion', () => {
  const effect = evaluateSchedule(SHIPPED_SCHEDULE, new Date());
  assert.deepEqual(effect, { lang: null, dark: null, presetId: null, source: 'default', ruleId: null });
});

test('nextScheduleChange finds the next boundary and reports null when nothing will change', () => {
  assert.equal(nextScheduleChange(SHIPPED_SCHEDULE, new Date(), 60), null, 'no rules, no override, nothing will ever change');

  const document = parseSchedule(serializeSchedule({
    ...SHIPPED_SCHEDULE,
    rules: [{ id: 'morning', label: 'Morning', enabled: true, days: [1], startMinutes: 7 * 60, endMinutes: 9 * 60, lang: 'zh', dark: null, presetId: null }],
  }));
  // A Sunday well before the Monday-morning window; the horizon has to reach across at least one day.
  const now = new Date('2026-06-14T12:00:00Z');
  const change = nextScheduleChange(document, now, 20160);
  assert.ok(change, 'a boundary exists within two weeks');
  assert.equal(change.effect.source, 'rule');
  assert.equal(change.effect.lang, 'zh');
});

test('rules and the whole document are bounded and reject a malformed entry per-field', () => {
  const tooManyRules = Array.from({ length: MAX_RULES + 5 }, (_, index) => ({
    id: 'rule-' + index, label: 'Rule', enabled: true, days: [1], startMinutes: 0, endMinutes: 60, lang: 'en', dark: null, presetId: null,
  }));
  const parsed = parseSchedule(JSON.stringify({ version: 1, rules: tooManyRules }));
  assert.equal(parsed.rules.length, MAX_RULES);

  assert.equal(parseSchedule(null), SHIPPED_SCHEDULE);
  assert.equal(parseSchedule('not json'), SHIPPED_SCHEDULE);
  assert.equal(parseSchedule(JSON.stringify({ version: 2, rules: [] })), SHIPPED_SCHEDULE);

  const withJunk = parseSchedule(JSON.stringify({
    version: 1,
    rules: [
      { id: 'ok', label: 'Ok', enabled: true, days: [1], startMinutes: 60, endMinutes: 120, lang: 'en', dark: null, presetId: null },
      { id: 'Bad Id!', days: [1], startMinutes: 0, endMinutes: 60 },
      { id: 'no-effect', days: [1], startMinutes: 0, endMinutes: 60, lang: null, dark: null, presetId: null },
      { id: 'zero-length', days: [1], startMinutes: 60, endMinutes: 60, lang: 'en', dark: null, presetId: null },
      { id: 'no-days', days: [], startMinutes: 0, endMinutes: 60, lang: 'en', dark: null, presetId: null },
    ],
  }));
  assert.deepEqual(withJunk.rules.map((rule) => rule.id), ['ok']);
});

test('serialize/parse round-trips and always pins the fixed time zone', () => {
  const roundTripped = parseSchedule(serializeSchedule({ ...SHIPPED_SCHEDULE, timeZone: 'America/Toronto' }));
  assert.equal(roundTripped.timeZone, 'America/Toronto');
});

test('the blank-slate starters are bilingual, bounded and each names a real effect', () => {
  assert.ok(SCHEDULE_STARTERS.length >= 3);
  for (const starter of SCHEDULE_STARTERS) {
    assert.ok(starter.label.en && starter.label.zh);
    assert.ok(starter.description.en && starter.description.zh);
    assert.ok(starter.rule.lang !== null || starter.rule.dark !== null || starter.rule.presetId !== null, `${starter.id} does nothing`);
    assert.ok(starter.rule.days.length > 0);
  }
});

test('the external settings source is bounded, versioned and refuses anything unexpected', () => {
  const good = JSON.stringify({ version: 1, kind: EXTERNAL_KIND, schedule: { version: 1, rules: [] } });
  const result = parseExternalSchedule(good);
  assert.equal(result.ok, true);

  assert.deepEqual(parseExternalSchedule(''), { ok: false, reason: 'empty' });
  assert.deepEqual(parseExternalSchedule('x'.repeat(MAX_EXTERNAL_SCHEDULE_BYTES + 1)), { ok: false, reason: 'too-large' });
  assert.deepEqual(parseExternalSchedule('not json'), { ok: false, reason: 'invalid-json' });
  assert.deepEqual(parseExternalSchedule(JSON.stringify({ version: 1, kind: EXTERNAL_KIND, schedule: {}, extra: true })), { ok: false, reason: 'invalid-content' });
  assert.deepEqual(parseExternalSchedule(JSON.stringify({ version: 2, kind: EXTERNAL_KIND, schedule: {} })), { ok: false, reason: 'wrong-version' });
  assert.deepEqual(parseExternalSchedule(JSON.stringify({ version: 1, kind: 'something-else', schedule: {} })), { ok: false, reason: 'wrong-kind' });
  assert.deepEqual(parseExternalSchedule(JSON.stringify({ version: 1, kind: EXTERNAL_KIND, schedule: 'nope' })), { ok: false, reason: 'invalid-content' });

  for (const reason of ['empty', 'too-large', 'invalid-json', 'wrong-version', 'wrong-kind', 'invalid-content', 'network', 'insecure']) {
    assert.ok(externalScheduleMessage(reason, t).length > 0, reason);
  }
});
