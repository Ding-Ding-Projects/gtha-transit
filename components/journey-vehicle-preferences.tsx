'use client';

import { useEffect, useRef, useState } from 'react';

export type JourneyVehicleCriteria = { manufacturer?: string; model?: string; yearFrom?: number; yearTo?: number; match?: 'all' | 'any' };
export type JourneyVehiclePreferenceOptions = { prefer?: boolean; avoid?: boolean; includeUnconfirmed?: boolean };
/** Facts must come from verified fleet metadata, never route inference. */
export type VerifiedFleetFact = { manufacturer?: string | null; model?: string | null; year?: string | number | null };
export type JourneyVehiclePreferencesPanelProps = {
  criteria: JourneyVehicleCriteria;
  options: JourneyVehiclePreferenceOptions;
  verifiedFleetFacts: readonly VerifiedFleetFact[];
  excludedCount?: number;
  onCriteriaChange: (criteria: JourneyVehicleCriteria) => void;
  onOptionsChange: (options: JourneyVehiclePreferenceOptions) => void;
  t?: (english: string, cantonese: string) => string;
};

const text = (value?: string | null) => value?.trim() || undefined;
export function manufacturerChoices(facts: readonly VerifiedFleetFact[]) {
  return Array.from(new Set(Array.from(facts ?? [], (fact) => text(fact.manufacturer)).filter((value): value is string => Boolean(value)))).sort((left, right) => left.localeCompare(right));
}
/** Models are deliberately gated by exact selected manufacturer metadata. */
export function modelChoicesForManufacturer(facts: readonly VerifiedFleetFact[], manufacturer?: string) {
  if (!manufacturer) return [];
  return Array.from(new Set(Array.from(facts ?? [], (fact) => text(fact.manufacturer) === manufacturer ? text(fact.model) : undefined).filter((value): value is string => Boolean(value)))).sort((left, right) => left.localeCompare(right));
}

type YearDraft = { from: string; to: string };
const persistedYearDraft = (criteria: JourneyVehicleCriteria): YearDraft => ({ from: criteria.yearFrom === undefined ? '' : String(criteria.yearFrom), to: criteria.yearTo === undefined ? '' : String(criteria.yearTo) });
const yearKey = (criteria: JourneyVehicleCriteria) => `${criteria.yearFrom ?? ''}:${criteria.yearTo ?? ''}`;
function yearValidation({ from, to }: YearDraft) {
  const parse = (value: string) => value === '' ? undefined : Number(value);
  const fromYear = parse(from), toYear = parse(to);
  if ((fromYear !== undefined && (!Number.isInteger(fromYear) || fromYear < 1800 || fromYear > 3000)) || (toYear !== undefined && (!Number.isInteger(toYear) || toYear < 1800 || toYear > 3000))) return 'Enter a whole year from 1800 through 3000.';
  if (fromYear !== undefined && toYear !== undefined && fromYear > toYear) return 'The start year must be the same as or earlier than the end year.';
  return null;
}

/** Parent integration: supply verified metadata, own criteria/options state, then call applyJourneyPreferences separately. */
export function JourneyVehiclePreferencesPanel({ criteria, options, verifiedFleetFacts, excludedCount = 0, onCriteriaChange, onOptionsChange, t = (english) => english }: JourneyVehiclePreferencesPanelProps) {
  const manufacturers = manufacturerChoices(verifiedFleetFacts);
  const models = modelChoicesForManufacturer(verifiedFleetFacts, criteria.manufacturer);
  const [yearDraft, setYearDraft] = useState<YearDraft>(() => persistedYearDraft(criteria));
  const persistedYears = yearKey(criteria);
  const persistedYearsRef = useRef(persistedYears);
  const yearError = yearValidation(yearDraft);
  const avoidActive = Boolean(options.avoid);

  useEffect(() => {
    if (persistedYearsRef.current === persistedYears) return;
    persistedYearsRef.current = persistedYears;
    if (!yearValidation(yearDraft)) setYearDraft(persistedYearDraft(criteria));
  }, [criteria, persistedYears, yearDraft]);
  useEffect(() => {
    if (criteria.model && (!criteria.manufacturer || !models.includes(criteria.model))) onCriteriaChange({ ...criteria, model: undefined });
  }, [criteria, models, onCriteriaChange]);

  const updateCriteria = (change: Partial<JourneyVehicleCriteria>) => onCriteriaChange({ ...criteria, ...change });
  const updateOptions = (change: Partial<JourneyVehiclePreferenceOptions>) => onOptionsChange({ ...options, ...change });
  const updateManufacturer = (manufacturer?: string) => updateCriteria({ manufacturer, model: undefined });
  const updateYear = (field: keyof YearDraft, value: string) => {
    const next = { ...yearDraft, [field]: value };
    setYearDraft(next);
    if (yearValidation(next)) return;
    updateCriteria({ yearFrom: next.from === '' ? undefined : Number(next.from), yearTo: next.to === '' ? undefined : Number(next.to) });
  };

  return <section aria-labelledby="vehicle-preferences-heading" className="vehicle-pref-panel">
    <h2 id="vehicle-preferences-heading">{t('Vehicle preferences', '車輛偏好')}</h2>
    <p>{t('Choose from verified fleet metadata. Routes and timetables never guess a vehicle.', '請從已核實車隊資料選擇。路線同時刻表唔會估車輛。')}</p>
    <div className="vehicle-pref-policy" role="group" aria-label={t('Vehicle preference policy', '車輛偏好方式')}>
      <button className="vehicle-pref-chip" type="button" aria-pressed={Boolean(options.prefer)} onClick={() => updateOptions({ prefer: !options.prefer })}>{t('Prefer matches', '優先相符')}</button>
      <button className="vehicle-pref-chip" type="button" aria-pressed={avoidActive} onClick={() => updateOptions({ avoid: !avoidActive })}>{t('Avoid matches', '避開相符')}</button>
    </div>
    <section className="vehicle-pref-step" aria-labelledby="vehicle-preferences-company">
      <h3 id="vehicle-preferences-company">{t('1. Choose company', '1. 選擇公司')}</h3>
      <div role="group" aria-label={t('Verified company choices', '已核實公司選項')}>
        {manufacturers.map((manufacturer) => <button className="vehicle-pref-chip" key={manufacturer} type="button" aria-pressed={criteria.manufacturer === manufacturer} onClick={() => updateManufacturer(criteria.manufacturer === manufacturer ? undefined : manufacturer)}>{manufacturer}</button>)}
        {!manufacturers.length && <p role="status">{t('No verified companies are available yet.', '暫時未有已核實公司。')}</p>}
      </div>
    </section>
    <section className="vehicle-pref-step" aria-labelledby="vehicle-preferences-model" aria-disabled={!criteria.manufacturer}>
      <h3 id="vehicle-preferences-model">{t('2. Choose model', '2. 選擇型號')}</h3>
      {!criteria.manufacturer ? <p role="status">{t('Select a company first to see its verified models.', '請先選擇公司，先會顯示該公司已核實型號。')}</p> : <div role="group" aria-label={t('Verified model choices', '已核實型號選項')}>
        {models.map((model) => <button className="vehicle-pref-chip" key={model} type="button" aria-pressed={criteria.model === model} onClick={() => updateCriteria({ model: criteria.model === model ? undefined : model })}>{model}</button>)}
        {!models.length && <p role="status">{t('This company has no verified models yet.', '呢間公司暫時未有已核實型號。')}</p>}
      </div>}
    </section>
    <section className="vehicle-pref-step" aria-labelledby="vehicle-preferences-years">
      <h3 id="vehicle-preferences-years">{t('3. Build years (optional)', '3. 建造年份（可選）')}</h3>
      <div className="vehicle-pref-year-grid">
        <label>{t('From', '由')} <input type="number" inputMode="numeric" min="1800" max="3000" value={yearDraft.from} aria-invalid={Boolean(yearError)} aria-describedby="vehicle-year-error" onChange={(event) => updateYear('from', event.currentTarget.value)} /></label>
        <label>{t('To', '至')} <input type="number" inputMode="numeric" min="1800" max="3000" value={yearDraft.to} aria-invalid={Boolean(yearError)} aria-describedby="vehicle-year-error" onChange={(event) => updateYear('to', event.currentTarget.value)} /></label>
      </div>
      {yearError && <p id="vehicle-year-error" role="alert">{t(yearError, yearError === 'The start year must be the same as or earlier than the end year.' ? '開始年份必須早過或等於結束年份。' : '請輸入介乎 1800 至 3000 嘅整數年份。')}</p>}
      <p>{t('Published ranges that only partly overlap remain unconfirmed.', '已公布年份範圍只係部分重疊時會保持未確認。')}</p>
    </section>
    <details className="vehicle-pref-step">
      <summary>{t('Advanced matching and unknown assignments', '進階相符與未確認配車')}</summary>
      <div role="group" aria-label={t('Criteria combination', '條件組合')}>
        <button className="vehicle-pref-chip" type="button" aria-pressed={(criteria.match ?? 'all') === 'all'} onClick={() => updateCriteria({ match: 'all' })}>{t('Match all', '全部相符')}</button>
        <button className="vehicle-pref-chip" type="button" aria-pressed={criteria.match === 'any'} onClick={() => updateCriteria({ match: 'any' })}>{t('Match any', '任何一項相符')}</button>
      </div>
      {avoidActive && <aside aria-live="polite">
        <strong>{t('Avoid can remove unconfirmed options.', '避開模式可以移除未確認選項。')}</strong>
        <p>{t('A journey with an unconfirmed non-walking assignment is excluded by default.', '未能確認嘅非步行配車行程預設會被移除。')}</p>
        <button className="vehicle-pref-chip" type="button" aria-pressed={Boolean(options.includeUnconfirmed)} onClick={() => updateOptions({ includeUnconfirmed: !options.includeUnconfirmed })}>{t('Include unconfirmed assignments', '包括未確認配車')}</button>
        {excludedCount > 0 && <p role="status">{t(`${excludedCount} option${excludedCount === 1 ? '' : 's'} excluded. Include unconfirmed assignments to recover unconfirmed options.`, `${excludedCount} 個選項已移除。包括未確認配車可恢復未確認選項。`)}</p>}
      </aside>}
    </details>
    {(criteria.manufacturer || criteria.model || criteria.yearFrom !== undefined || criteria.yearTo !== undefined) && <button className="vehicle-pref-clear" type="button" onClick={() => { setYearDraft({ from: '', to: '' }); onCriteriaChange({ match: criteria.match }); }}>{t('Clear vehicle selection', '清除車輛選擇')}</button>}
  </section>;
}

export default JourneyVehiclePreferencesPanel;
