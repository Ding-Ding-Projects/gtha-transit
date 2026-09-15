'use client';
import { useState } from 'react';
import { Clock, Plus, Trash2 } from 'lucide-react';
import type { ScheduledSettingsController } from '../lib/use-scheduled-settings';
import { MAX_RULES, SCHEDULE_STARTERS, TIME_ZONE, type Lang, type ScheduleRule } from '../lib/scheduled-settings';
import { externalScheduleMessage } from '../lib/scheduled-settings';
import { fetchExternalSchedule } from '../lib/fetch-external-schedule';
import type { AppearancePreset } from '../lib/appearance/presets';

type Translate = (en: string, zh: string) => string;

const DAY_NAMES: [string, string][] = [['Sun', '日'], ['Mon', '一'], ['Tue', '二'], ['Wed', '三'], ['Thu', '四'], ['Fri', '五'], ['Sat', '六']];
const uid = () => 'rule-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const minutesToClock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const clockToMinutes = (clock: string) => { const [h, m] = clock.split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0; };

function effectSummary(effect: { lang: Lang | null; dark: boolean | null; presetId: string | null }, presets: readonly AppearancePreset[], t: Translate): string {
  const parts: string[] = [];
  if (effect.lang) parts.push(effect.lang === 'en' ? t('English', '英文') : effect.lang === 'zh' ? t('Cantonese', '廣東話') : t('Bilingual', '雙語'));
  if (effect.dark !== null) parts.push(effect.dark ? t('Dark theme', '深色主題') : t('Light theme', '淺色主題'));
  if (effect.presetId) parts.push(presets.find(preset => preset.id === effect.presetId)?.name ?? effect.presetId);
  return parts.length ? parts.join(', ') : t('No change', '冇改動');
}

function RuleEditor({ rule, presets, t, onChange, onRemove }: { rule: ScheduleRule; presets: readonly AppearancePreset[]; t: Translate; onChange: (next: ScheduleRule) => void; onRemove: () => void }) {
  const toggleDay = (day: number) => onChange({ ...rule, days: rule.days.includes(day) ? rule.days.filter(item => item !== day) : [...rule.days, day].sort((a, b) => a - b) });
  return <fieldset className="schedule-rule">
    <legend><input aria-label={t('Rule name', '規則名稱')} maxLength={60} value={rule.label} onChange={event => onChange({ ...rule, label: event.target.value || rule.label })} /></legend>
    <label><input type="checkbox" checked={rule.enabled} onChange={event => onChange({ ...rule, enabled: event.target.checked })} />{t('Enabled', '啟用')}</label>
    <fieldset className="schedule-days"><legend className="sr-only">{t('Days of the week', '星期')}</legend>
      {DAY_NAMES.map(([en, zh], day) => <label key={day}><input type="checkbox" checked={rule.days.includes(day)} onChange={() => toggleDay(day)} />{t(en, zh)}</label>)}
    </fieldset>
    <label>{t('Start', '開始')}<input type="time" value={minutesToClock(rule.startMinutes)} onChange={event => onChange({ ...rule, startMinutes: clockToMinutes(event.target.value) })} /></label>
    <label>{t('End', '結束')}<input type="time" value={minutesToClock(rule.endMinutes)} onChange={event => onChange({ ...rule, endMinutes: clockToMinutes(event.target.value) })} /></label>
    {rule.endMinutes <= rule.startMinutes && <p role="status">{t('Wraps past midnight onto the next day.', '會跨越午夜到第二日。')}</p>}
    <label>{t('Language', '語言')}<select value={rule.lang ?? ''} onChange={event => onChange({ ...rule, lang: (event.target.value || null) as Lang | null })}>
      <option value="">{t('No change', '冇改動')}</option>
      <option value="en">{t('English', '英文')}</option>
      <option value="zh">{t('Cantonese', '廣東話')}</option>
      <option value="both">{t('Bilingual', '雙語')}</option>
    </select></label>
    <label>{t('Theme', '主題')}<select value={rule.dark === null ? '' : String(rule.dark)} onChange={event => onChange({ ...rule, dark: event.target.value === '' ? null : event.target.value === 'true' })}>
      <option value="">{t('No change', '冇改動')}</option>
      <option value="false">{t('Light', '淺色')}</option>
      <option value="true">{t('Dark', '深色')}</option>
    </select></label>
    {presets.length > 0 && <label>{t('Appearance preset', '外觀預設')}<select value={rule.presetId ?? ''} onChange={event => onChange({ ...rule, presetId: event.target.value || null })}>
      <option value="">{t('No change', '冇改動')}</option>
      {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
    </select></label>}
    <button type="button" onClick={onRemove}><Trash2 size={16} aria-hidden="true" />{t('Remove rule', '刪除規則')}</button>
  </fieldset>;
}

export default function ScheduledSettingsEditor({ schedule, presets, t }: { schedule: ScheduledSettingsController; presets: readonly AppearancePreset[]; t: Translate }) {
  const [externalUrl, setExternalUrl] = useState('');
  const [externalBusy, setExternalBusy] = useState(false);
  const [externalNotice, setExternalNotice] = useState('');
  const [pendingImport, setPendingImport] = useState<ScheduledSettingsController['document'] | null>(null);

  const setRule = (id: string, next: ScheduleRule) => schedule.setRules(schedule.document.rules.map(rule => rule.id === id ? next : rule));
  const removeRule = (id: string) => schedule.setRules(schedule.document.rules.filter(rule => rule.id !== id));
  const addBlankRule = () => schedule.setRules([...schedule.document.rules, { id: uid(), label: t('New rule', '新規則'), enabled: true, days: [1, 2, 3, 4, 5], startMinutes: 9 * 60, endMinutes: 17 * 60, lang: null, dark: null, presetId: null }]);
  const addStarter = (starterId: string) => {
    const starter = SCHEDULE_STARTERS.find(item => item.id === starterId);
    if (starter) schedule.setRules([...schedule.document.rules, { id: uid(), ...starter.rule }]);
  };

  const hasOverride = Boolean(schedule.document.overrideUntil);
  const setOverrideUntilNextChange = () => {
    const until = schedule.upcoming?.at ?? new Date(Date.now() + 60 * 60 * 1000);
    schedule.setOverride(until.toISOString(), schedule.effect.lang, schedule.effect.dark, schedule.effect.presetId);
  };

  const runImport = async () => {
    setExternalBusy(true); setExternalNotice('');
    const result = await fetchExternalSchedule(externalUrl.trim());
    setExternalBusy(false);
    if (!result.ok) { setExternalNotice(externalScheduleMessage(result.reason, t)); return; }
    if (schedule.document.rules.length > 0) { setPendingImport(result.value); return; }
    schedule.importDocument(result.value);
    setExternalNotice(t('Schedule imported.', '已匯入排程。'));
  };

  return <section id="settings-schedule-editor" className="schedule-editor" data-ui="schedule.editor.panel">
    <header><Clock size={22} aria-hidden="true" /><h3>{t('Scheduled settings', '排程設定')}</h3></header>
    <p className="data-note">{t(`All times are America/Toronto (${TIME_ZONE}), and adjust automatically for Daylight Saving. Rules stay in this browser.`, `所有時間均為美國東部（多倫多，${TIME_ZONE}）時區，並會自動配合夏令時間調整。規則只留喺此瀏覽器。`)}</p>

    <section id="schedule-rules" tabIndex={-1} data-ui="settings.card" className="preference-card">
      <p role="status">{t('Currently in effect: ', '現正生效：') + (schedule.effect.source === 'default' ? t('nothing — no rule or override is active.', '無 — 冇規則或覆蓋生效。') : effectSummary(schedule.effect, presets, t) + (schedule.effect.source === 'override' ? t(' (manual override)', '（手動覆蓋）') : ''))}</p>
      {schedule.upcoming && <p>{t('Next change: ', '下次改動：') + schedule.upcoming.at.toLocaleString('en-CA', { timeZone: TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' }) + ' — ' + effectSummary(schedule.upcoming.effect, presets, t)}</p>}

      {schedule.document.rules.length === 0 && <div className="schedule-starters">
        <p>{t('No rules yet. Start from one of these, or add a blank rule.', '未有任何規則。可以由以下其中一個開始，或者新增空白規則。')}</p>
        {SCHEDULE_STARTERS.map(starter => <button data-ui="settings.action" type="button" key={starter.id} onClick={() => addStarter(starter.id)}><strong>{t(starter.label.en, starter.label.zh)}</strong><small>{t(starter.description.en, starter.description.zh)}</small></button>)}
      </div>}

      {schedule.document.rules.map(rule => <RuleEditor key={rule.id} rule={rule} presets={presets} t={t} onChange={next => setRule(rule.id, next)} onRemove={() => removeRule(rule.id)} />)}
      <button data-ui="settings.action" type="button" disabled={schedule.document.rules.length >= MAX_RULES} onClick={addBlankRule}><Plus size={16} aria-hidden="true" />{t('Add a blank rule', '新增空白規則')}</button>
    </section>

    <section id="schedule-override" tabIndex={-1} data-ui="settings.card" className="preference-card">
      <h4>{t('Manual override', '手動覆蓋')}</h4>
      <p>{hasOverride ? t('An override is active until ', '覆蓋現正生效，直至 ') + new Date(schedule.document.overrideUntil!).toLocaleString('en-CA', { timeZone: TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' }) + '.' : t('No override is active. Setting one freezes the current effective settings until the schedule would next change.', '未有覆蓋生效。設定覆蓋會凍結現時生效嘅設定，直至排程下次本應改動為止。')}</p>
      <button data-ui="settings.action" type="button" onClick={setOverrideUntilNextChange} disabled={!schedule.upcoming && hasOverride}>{t('Override until the next scheduled change', '覆蓋直至下次排程改動')}</button>
      <button data-ui="settings.action" type="button" onClick={schedule.clearOverride} disabled={!hasOverride}>{t('Clear override', '清除覆蓋')}</button>
    </section>

    <section id="schedule-external" tabIndex={-1} data-ui="settings.card" className="preference-card">
      <h4>{t('Import from a settings address', '從設定網址匯入')}</h4>
      <p>{t('Enter a web address that serves a scheduled-settings document. It is fetched only when you press Import — never automatically or on a timer.', '輸入一個提供排程設定文件嘅網址。只會喺你按下匯入時先抓取 — 絕不自動或定時進行。')}</p>
      <label className="sr-only" htmlFor="schedule-external-url">{t('Settings address', '設定網址')}</label>
      <input id="schedule-external-url" type="url" placeholder="https://example.com/gtha-schedule.json" value={externalUrl} onChange={event => setExternalUrl(event.target.value)} />
      <button data-ui="settings.action" type="button" disabled={externalBusy || !externalUrl.trim()} onClick={runImport}>{t('Import', '匯入')}</button>
      {externalNotice && <p role="status">{externalNotice}</p>}
      {pendingImport && <fieldset><legend>{t('Replace existing rules?', '取代現有規則？')}</legend><p>{t('This address has its own rules. Importing replaces every rule currently saved in this browser.', '此網址有自己嘅規則，匯入會取代此瀏覽器現時儲存嘅所有規則。')}</p>
        <button type="button" onClick={() => { schedule.importDocument(pendingImport); setPendingImport(null); setExternalNotice(t('Schedule imported.', '已匯入排程。')); }}>{t('Replace and import', '取代並匯入')}</button>
        <button type="button" onClick={() => setPendingImport(null)}>{t('Cancel', '取消')}</button>
      </fieldset>}
    </section>
    {schedule.unavailable && <p role="status">{t('The schedule could not be saved. Changes still work in this session.', '未能儲存排程，此次使用仍可操作。')}</p>}
  </section>;
}
