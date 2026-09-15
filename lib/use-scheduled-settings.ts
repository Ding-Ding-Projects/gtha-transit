'use client';
import { useCallback, useMemo } from 'react';
import { useLocalSetting } from './use-local-setting';
import {
  SCHEDULE_KEY,
  evaluateSchedule,
  nextScheduleChange,
  parseSchedule,
  serializeSchedule,
  type Lang,
  type ScheduleDocument,
  type ScheduleRule,
} from './scheduled-settings';

/**
 * The React-facing wrapper around the pure schedule module: reads and writes
 * the bounded `gtha-scheduled-settings-v1` record through the same
 * hydration-safe `useLocalSetting` every other small global preference uses,
 * and memoises the current effect and the next-change preview against the
 * caller-supplied clock (so a component drives the ticking, this hook does
 * not start its own timer).
 */
export function useScheduledSettings(now: Date) {
  const stored = useLocalSetting(SCHEDULE_KEY);
  const document = useMemo(() => parseSchedule(stored.value), [stored.value]);

  const persist = useCallback((next: ScheduleDocument) => stored.setValue(serializeSchedule(next)), [stored]);

  const setRules = useCallback((rules: readonly ScheduleRule[]) => persist({ ...document, rules: [...rules] }), [document, persist]);

  const setOverride = useCallback(
    (untilIso: string, lang: Lang | null, dark: boolean | null, presetId: string | null) =>
      persist({ ...document, overrideUntil: untilIso, overrideLang: lang, overrideDark: dark, overridePresetId: presetId }),
    [document, persist],
  );

  const clearOverride = useCallback(() => persist({ ...document, overrideUntil: null, overrideLang: null, overrideDark: null, overridePresetId: null }), [document, persist]);

  const importDocument = useCallback((next: ScheduleDocument) => persist(next), [persist]);

  const effect = useMemo(() => evaluateSchedule(document, now), [document, now]);
  const upcoming = useMemo(() => nextScheduleChange(document, now), [document, now]);

  return { document, unavailable: stored.unavailable, effect, upcoming, setRules, setOverride, clearOverride, importDocument };
}

export type ScheduledSettingsController = ReturnType<typeof useScheduledSettings>;
