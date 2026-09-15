/**
 * Scheduled settings: time-of-day and weekday rules that switch language
 * mode and appearance automatically, in America/Toronto time.
 *
 * This is deliberately the same shape every other bounded local document in
 * this project already uses -- a small `version` field, a `SHIPPED_*`
 * constant naming the untouched defaults, a `parse*`/`serialize*` pair that
 * never throws, and per-field fallback rather than an all-or-nothing
 * rejection. The whole document is small enough for the existing
 * `useLocalSetting` 16 KiB budget; there is no per-rule binary payload here
 * the way there is for a custom logo.
 *
 * The time zone is fixed rather than user-chosen: every evaluation happens in
 * America/Toronto, labelled as such wherever it is shown, using the
 * platform's own ICU time zone database via `Intl.DateTimeFormat` rather than
 * a bundled table -- which is also what makes the Daylight Saving transition
 * correct for free. `torontoParts` is the one function that reads a real
 * clock; everything else here is pure given the parts it returns.
 */

export type Lang = 'en' | 'zh' | 'both';
const LANGS: readonly Lang[] = ['en', 'zh', 'both'];

export const TIME_ZONE = 'America/Toronto';

export type ScheduleRule = {
  id: string;
  label: string;
  enabled: boolean;
  /** 0 = Sunday .. 6 = Saturday, in America/Toronto local time. */
  days: readonly number[];
  /** Minutes since local midnight, 0-1439. */
  startMinutes: number;
  /** Minutes since local midnight, 0-1439. Less than or equal to start means the window wraps past midnight. */
  endMinutes: number;
  /** `null` leaves the language mode untouched while this rule is active. */
  lang: Lang | null;
  /** `null` leaves the theme untouched while this rule is active. */
  dark: boolean | null;
  /** An appearance preset id to apply, or `null` to leave the palette untouched. */
  presetId: string | null;
};

export type ScheduleDocument = {
  version: 1;
  timeZone: typeof TIME_ZONE;
  rules: readonly ScheduleRule[];
  /** ISO timestamp; while `Date.now()` is before it, the override below wins over every rule. */
  overrideUntil: string | null;
  overrideLang: Lang | null;
  overrideDark: boolean | null;
  overridePresetId: string | null;
};

export const MAX_RULES = 20;
export const MAX_LABEL = 60;
const RULE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PRESET_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;

export const SCHEDULE_KEY = 'gtha-scheduled-settings-v1';

export const SHIPPED_SCHEDULE: ScheduleDocument = Object.freeze({
  version: 1,
  timeZone: TIME_ZONE,
  rules: [],
  overrideUntil: null,
  overrideLang: null,
  overrideDark: null,
  overridePresetId: null,
}) as ScheduleDocument;

/* -------------------------------------------------------------- parsing -- */

function readLang(value: unknown): Lang | null {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value) ? (value as Lang) : null;
}

function readOptionalBool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readPresetId(value: unknown): string | null {
  return typeof value === 'string' && PRESET_ID.test(value) ? value : null;
}

function readDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const days = new Set<number>();
  for (const item of value) if (typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 6) days.add(item);
  return [...days].sort((a, b) => a - b);
}

function readMinutes(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1439 ? value : null;
}

function readRule(value: unknown): ScheduleRule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!RULE_ID.test(id)) return null;
  const days = readDays(raw.days);
  if (days.length === 0) return null;
  const startMinutes = readMinutes(raw.startMinutes);
  const endMinutes = readMinutes(raw.endMinutes);
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return null;
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, MAX_LABEL) : id;
  const lang = readLang(raw.lang);
  const dark = readOptionalBool(raw.dark);
  const presetId = readPresetId(raw.presetId);
  if (lang === null && dark === null && presetId === null) return null;
  return { id, label, enabled: raw.enabled !== false, days, startMinutes, endMinutes, lang, dark, presetId };
}

/**
 * Restore a schedule document. Unknown fields are dropped because the result
 * is built field by field; one bad rule is skipped rather than discarding
 * every other rule, and only a missing or wrong `version` discards the whole
 * document, matching `lib/appearance/document.ts`'s own rule.
 */
export function parseSchedule(text: string | null | undefined): ScheduleDocument {
  if (!text) return SHIPPED_SCHEDULE;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return SHIPPED_SCHEDULE; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return SHIPPED_SCHEDULE;
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1) return SHIPPED_SCHEDULE;

  const rules: ScheduleRule[] = [];
  const ids = new Set<string>();
  if (Array.isArray(record.rules)) {
    for (const candidate of record.rules) {
      const rule = readRule(candidate);
      if (rule && !ids.has(rule.id) && rules.length < MAX_RULES) { ids.add(rule.id); rules.push(rule); }
    }
  }

  const overrideUntilRaw = typeof record.overrideUntil === 'string' ? record.overrideUntil : null;
  const overrideUntil = overrideUntilRaw && !Number.isNaN(new Date(overrideUntilRaw).valueOf()) ? overrideUntilRaw : null;

  return {
    version: 1,
    timeZone: TIME_ZONE,
    rules,
    overrideUntil,
    overrideLang: overrideUntil ? readLang(record.overrideLang) : null,
    overrideDark: overrideUntil ? readOptionalBool(record.overrideDark) : null,
    overridePresetId: overrideUntil ? readPresetId(record.overridePresetId) : null,
  };
}

export function serializeSchedule(document: ScheduleDocument): string {
  return JSON.stringify({ ...document, version: 1, timeZone: TIME_ZONE });
}

/* ------------------------------------------------------------ evaluation -- */

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const TORONTO_FORMATTER = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** The current America/Toronto weekday (0 = Sunday) and minutes-since-midnight for an instant. */
export function torontoParts(date: Date): { weekday: number; minutes: number } {
  const parts = TORONTO_FORMATTER.formatToParts(date);
  const weekdayValue = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return { weekday: WEEKDAY_INDEX[weekdayValue] ?? 0, minutes: hour * 60 + minute };
}

/** Whether `rule` is the one active at this local weekday and minute-of-day, handling a window that wraps past midnight. */
export function ruleActiveAt(rule: ScheduleRule, weekday: number, minutes: number): boolean {
  if (!rule.enabled) return false;
  const previousWeekday = (weekday + 6) % 7;
  const wraps = rule.endMinutes <= rule.startMinutes;
  if (!wraps) return rule.days.includes(weekday) && minutes >= rule.startMinutes && minutes < rule.endMinutes;
  return (rule.days.includes(weekday) && minutes >= rule.startMinutes) || (rule.days.includes(previousWeekday) && minutes < rule.endMinutes);
}

/** The first enabled rule, in document order, active for this instant -- or `null` if none is. */
export function findActiveRule(rules: readonly ScheduleRule[], now: Date): ScheduleRule | null {
  const { weekday, minutes } = torontoParts(now);
  for (const rule of rules) if (ruleActiveAt(rule, weekday, minutes)) return rule;
  return null;
}

export type ScheduleEffect = { lang: Lang | null; dark: boolean | null; presetId: string | null; source: 'override' | 'rule' | 'default'; ruleId: string | null };

/**
 * What the schedule says should be in effect right now: the manual override
 * while it has not yet expired, otherwise the first matching rule, otherwise
 * nothing -- `source: 'default'` means "the schedule has no opinion", not
 * "reset everything to the shipped defaults".
 */
export function evaluateSchedule(document: ScheduleDocument, now: Date): ScheduleEffect {
  if (document.overrideUntil) {
    const until = new Date(document.overrideUntil);
    if (!Number.isNaN(until.valueOf()) && now.getTime() < until.getTime()) {
      return { lang: document.overrideLang, dark: document.overrideDark, presetId: document.overridePresetId, source: 'override', ruleId: null };
    }
  }
  const rule = findActiveRule(document.rules, now);
  if (rule) return { lang: rule.lang, dark: rule.dark, presetId: rule.presetId, source: 'rule', ruleId: rule.id };
  return { lang: null, dark: null, presetId: null, source: 'default', ruleId: null };
}

const effectKey = (effect: ScheduleEffect) => `${effect.lang ?? ''}|${effect.dark ?? ''}|${effect.presetId ?? ''}|${effect.source}|${effect.ruleId ?? ''}`;

export type ScheduleChange = { at: Date; effect: ScheduleEffect };

/**
 * The next moment the schedule's effect actually changes, found by probing
 * forward minute by minute -- boundaries can only ever fall on a whole
 * minute, and probing directly through `Intl` sidesteps every Daylight
 * Saving edge case a closed-form calculation would have to reconstruct by
 * hand. `horizonMinutes` bounds the work; `null` means no change was found
 * within it (for example, no rules and no override are configured at all).
 */
export function nextScheduleChange(document: ScheduleDocument, now: Date, horizonMinutes = 20160): ScheduleChange | null {
  const currentKey = effectKey(evaluateSchedule(document, now));
  for (let minute = 1; minute <= horizonMinutes; minute += 1) {
    const at = new Date(now.getTime() + minute * 60_000);
    const effect = evaluateSchedule(document, at);
    if (effectKey(effect) !== currentKey) return { at, effect };
  }
  return null;
}

/* --------------------------------------------------------- starter rules -- */

export type ScheduleStarter = { id: string; label: { en: string; zh: string }; description: { en: string; zh: string }; rule: Omit<ScheduleRule, 'id'> };

/**
 * Blank-slate presets for the schedule editor.
 *
 * A schedule editor with zero rules is a wall of "add a rule" and nothing
 * else to react to; these are ready-made starting points a person can accept
 * as-is or open straight into editing, the same idea this project already
 * ships for the appearance studio's named presets.
 */
export const SCHEDULE_STARTERS: readonly ScheduleStarter[] = Object.freeze([
  {
    id: 'evening-dark',
    label: { en: 'Dark theme in the evening', zh: '晚間轉深色主題' },
    description: { en: 'Every night from 7pm to 6am, switch to the dark theme.', zh: '每晚 7 時至朝早 6 時，轉用深色主題。' },
    rule: { label: 'Evening dark theme', enabled: true, days: [0, 1, 2, 3, 4, 5, 6], startMinutes: 19 * 60, endMinutes: 6 * 60, lang: null, dark: true, presetId: null },
  },
  {
    id: 'weekday-cantonese-mornings',
    label: { en: 'Cantonese on weekday mornings', zh: '平日早上轉廣東話' },
    description: { en: 'Weekdays from 7am to 9am, switch to Hong Kong Cantonese.', zh: '平日朝早 7 時至 9 時，轉用香港廣東話。' },
    rule: { label: 'Weekday Cantonese mornings', enabled: true, days: [1, 2, 3, 4, 5], startMinutes: 7 * 60, endMinutes: 9 * 60, lang: 'zh', dark: null, presetId: null },
  },
  {
    id: 'weekend-bilingual',
    label: { en: 'Bilingual on weekends', zh: '週末轉雙語' },
    description: { en: 'All day Saturday and Sunday, show both languages together.', zh: '星期六、日全日，同時顯示兩種語言。' },
    rule: { label: 'Weekend bilingual mode', enabled: true, days: [0, 6], startMinutes: 0, endMinutes: 1439, lang: 'both', dark: null, presetId: null },
  },
]);

/* -------------------------------------------------- external settings source -- */

export const EXTERNAL_KIND = 'gtha-scheduled-settings';
export const MAX_EXTERNAL_SCHEDULE_BYTES = 64 * 1024;
export type ExternalScheduleFailure = 'empty' | 'too-large' | 'invalid-json' | 'wrong-version' | 'wrong-kind' | 'invalid-content' | 'network' | 'insecure';
export type ExternalScheduleResult = { ok: true; value: ScheduleDocument } | { ok: false; reason: ExternalScheduleFailure };
const EXTERNAL_KEYS = new Set(['version', 'kind', 'schedule']);

/**
 * The bounded, versioned envelope an external settings document must use.
 *
 * This is intentionally the narrowest possible external-settings feature:
 * one document, fetched only on explicit action (never polled), holding
 * nothing but a schedule. It reuses `parseSchedule`'s own per-field fallback
 * rather than a second validator, so a URL cannot smuggle in anything the
 * local editor would not also accept.
 */
export function parseExternalSchedule(text: string | null | undefined): ExternalScheduleResult {
  if (!text || !text.trim()) return { ok: false, reason: 'empty' };
  if (new TextEncoder().encode(text).byteLength > MAX_EXTERNAL_SCHEDULE_BYTES) return { ok: false, reason: 'too-large' };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, reason: 'invalid-json' }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'invalid-json' };
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).some((key) => !EXTERNAL_KEYS.has(key))) return { ok: false, reason: 'invalid-content' };
  if (record.version !== 1) return { ok: false, reason: 'wrong-version' };
  if (record.kind !== EXTERNAL_KIND) return { ok: false, reason: 'wrong-kind' };
  if (!record.schedule || typeof record.schedule !== 'object' || Array.isArray(record.schedule)) return { ok: false, reason: 'invalid-content' };
  return { ok: true, value: parseSchedule(JSON.stringify(record.schedule)) };
}

export function externalScheduleMessage(reason: ExternalScheduleFailure, t: (en: string, zh: string) => string): string {
  switch (reason) {
    case 'empty': return t('The address returned nothing to import.', '此網址未有返回任何可匯入嘅內容。');
    case 'too-large': return t('The document exceeds the 64 KiB limit.', '文件超過 64 KiB 限制。');
    case 'invalid-json': return t('This is not a readable settings document.', '此文件並非可讀嘅設定文件。');
    case 'wrong-version': return t('This settings document uses a version this planner does not understand.', '此設定文件使用未能識別嘅版本。');
    case 'wrong-kind': return t('This is not a scheduled-settings document.', '此文件並非排程設定文件。');
    case 'invalid-content': return t('This settings document has an unexpected shape. Existing rules were retained.', '此設定文件格式異常，原有規則會保留。');
    case 'network': return t('The address could not be reached. Check the address and your connection.', '未能連接此網址，請檢查網址同網絡連線。');
    case 'insecure': return t('Only secure (https://) addresses are accepted.', '只接受安全 (https://) 網址。');
    default: return t('This settings document could not be used.', '未能使用此設定文件。');
  }
}
