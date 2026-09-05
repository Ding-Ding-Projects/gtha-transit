'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, SlidersHorizontal, TrainFront, X } from 'lucide-react';
import { SearchWorkbench, emptySearchState, useSearchMatches } from './search-workbench';
import { chooseVehicleManufacturer, criteriaFromDraft, manufacturerChoices, modelChoicesForManufacturer, optionsForPolicy, vehiclePolicy, yearDraftError, yearDraftFor, type JourneyVehicleCriteria, type JourneyVehiclePreferenceOptions, type VerifiedFleetFact, type VehiclePolicy } from '../lib/journey-vehicle-controls';
export type { JourneyVehicleCriteria, JourneyVehiclePreferenceOptions, VerifiedFleetFact } from '../lib/journey-vehicle-controls';
export { manufacturerChoices, modelChoicesForManufacturer } from '../lib/journey-vehicle-controls';
type Translate = (en: string, zh: string) => string;
export type JourneyVehiclePreferencesPanelProps = {
  criteria: JourneyVehicleCriteria; options: JourneyVehiclePreferenceOptions; verifiedFleetFacts: readonly VerifiedFleetFact[]; excludedCount?: number;
  onCriteriaChange: (criteria: JourneyVehicleCriteria) => void; onOptionsChange: (options: JourneyVehiclePreferenceOptions) => void; t?: Translate;
};
const defaultTranslate: Translate = en => en;
const policyLabel = (policy: VehiclePolicy, t: Translate) => policy === 'avoid' ? t('Avoid', '避開') : policy === 'prefer' ? t('Prefer', '優先') : t('Off', '關閉');

function FactChoices({ choices, selected, onSelect, label, anyLabel, storageId, t }: {
  choices: string[]; selected?: string; onSelect: (value?: string) => void; label: string; anyLabel: string; storageId: string; t: Translate;
}) {
  const [search, setSearch] = useState(emptySearchState);
  const matches = useSearchMatches(choices, search);
  const id = useId();
  const visible = choices.filter((_, index) => matches.matches[index]);
  return <div className="vehicle-fact-choices">
    <SearchWorkbench storageId={storageId} label={label} value={search} onChange={setSearch} samples={choices} t={t} />
    <output className="vehicle-choice-count">{matches.busy ? t('Searching…', '搜尋中…') : t(`${visible.length} choices`, `${visible.length} 個選項`)}</output>
    <fieldset className="vehicle-choice-list"><legend className="sr-only">{label}</legend>
      {[undefined, ...visible].map(value => <label className="vehicle-choice-row" key={value ?? '__any__'}>
        <input type="radio" name={id} checked={selected === value} onChange={() => onSelect(value)} />
        <span>{value ?? anyLabel}</span><Check size={17} aria-hidden="true" />
      </label>)}
    </fieldset>
    {!matches.busy && !visible.length && <p className="vehicle-editor-note">{choices.length ? t('No matching choices. Change or clear the search.', '未有相符選項，請更改或清除搜尋。') : t('No verified choices are available yet.', '暫時未有已核實選項。')}</p>}
    {selected && <p className="vehicle-editor-note">{t('Selected', '已選擇')}: <strong>{selected}</strong></p>}
  </div>;
}

export function JourneyVehiclePreferencesPanel({ criteria, options, verifiedFleetFacts, excludedCount = 0, onCriteriaChange, onOptionsChange, t = defaultTranslate }: JourneyVehiclePreferencesPanelProps) {
  const trigger = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const navigationFrame = useRef<number | null>(null);
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(criteria), [draftOptions, setDraftOptions] = useState(options);
  const [years, setYears] = useState(() => yearDraftFor(criteria));
  const [step, setStep] = useState<'company' | 'model' | 'years'>('company');
  const id = useId(), mode = vehiclePolicy(draftOptions), activeMode = vehiclePolicy(options), error = yearDraftError(years);
  const manufacturers = useMemo(() => manufacturerChoices(verifiedFleetFacts), [verifiedFleetFacts]);
  const models = useMemo(() => modelChoicesForManufacturer(verifiedFleetFacts, draft.manufacturer), [verifiedFleetFacts, draft.manufacturer]);
  const hasCriteria = !!(criteria.manufacturer || criteria.model || criteria.yearFrom !== undefined || criteria.yearTo !== undefined);
  const appliedYearError = yearDraftError(yearDraftFor(criteria));
  const summary = [criteria.manufacturer || t('Any company', '任何公司'), criteria.model, criteria.yearFrom !== undefined || criteria.yearTo !== undefined ? `${criteria.yearFrom ?? '…'} → ${criteria.yearTo ?? '…'}` : t('Any year', '任何年份')].filter(Boolean).join(' · ');
  const close = () => { if (navigationFrame.current !== null) cancelAnimationFrame(navigationFrame.current); navigationFrame.current = null; dialog.current?.close(); setOpen(false); trigger.current?.focus(); };
  const goToStep = (next: 'company' | 'model' | 'years') => {
    setStep(next);
    if (navigationFrame.current !== null) cancelAnimationFrame(navigationFrame.current);
    navigationFrame.current = requestAnimationFrame(() => {
      const section = dialog.current?.querySelector<HTMLElement>(`.vehicle-${next}-section`);
      const target = section?.querySelector<HTMLInputElement>('input') ?? section;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      navigationFrame.current = null;
    });
  };
  const begin = () => { setDraft({ ...criteria }); setDraftOptions(optionsForPolicy(activeMode, options)); setYears(yearDraftFor(criteria)); setStep('company'); setOpen(true); };
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  useEffect(() => () => { if (navigationFrame.current !== null) cancelAnimationFrame(navigationFrame.current); }, []);
  const apply = () => {
    const next = criteriaFromDraft(draft, years);
    if (!next) return;
    onCriteriaChange({ ...next, model: modelChoicesForManufacturer(verifiedFleetFacts, next.manufacturer).includes(next.model || '') ? next.model : undefined });
    onOptionsChange(optionsForPolicy(mode, draftOptions)); close();
  };
  return <>
    <button ref={trigger} type="button" className="vehicle-preference-entry" onClick={begin} aria-haspopup="dialog" aria-expanded={open}>
      <span className="vehicle-preference-entry-icon"><TrainFront size={21} aria-hidden="true" /></span>
      <span className="vehicle-preference-entry-copy"><strong>{t('Vehicle preferences', '車輛偏好')}</strong><small>{summary}</small></span>
      <span className="vehicle-preference-entry-mode">{appliedYearError ? t('Review years', '檢查年份') : hasCriteria ? policyLabel(activeMode, t) : t('Off', '關閉')}</span><ArrowRight size={17} aria-hidden="true" />
    </button>
    {appliedYearError && <output className="vehicle-preference-result-note">{t('The saved year range is invalid. Vehicle preferences are not applied until it is corrected.', '已儲存年份範圍無效，修正前唔會套用車輛偏好。')}</output>}
    {options.avoid && hasCriteria && excludedCount > 0 && <output className="vehicle-preference-result-note">{t(`${excludedCount} journey options hidden by vehicle preferences.`, `${excludedCount} 個行程因車輛偏好而隱藏。`)}</output>}
    {open && <dialog ref={dialog} className="vehicle-preference-dialog" aria-labelledby={`${id}-title`}
      onCancel={event => { event.preventDefault(); close(); }}
      onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault(); }}>
      <header className="vehicle-editor-header"><div><span className="vehicle-editor-kicker"><SlidersHorizontal size={15} aria-hidden="true" />{t('YOUR RIDE', '你嘅車程')}</span><h2 id={`${id}-title`}>{t('Vehicle preferences', '車輛偏好')}</h2></div><button type="button" className="icon-button" onClick={close} aria-label={t('Cancel vehicle preferences', '取消車輛偏好')}><X size={21} aria-hidden="true" /></button></header>
      <div className="vehicle-editor-body">
        <fieldset className="vehicle-policy-choices"><legend>{t('How should these choices affect your trip?', '呢啲選擇應該點樣影響行程？')}</legend>
          {(['off', 'prefer', 'avoid'] as const).map(value => <label key={value} className="vehicle-policy-choice" aria-label={policyLabel(value, t)}>
            <input type="radio" name={`${id}-policy`} checked={mode === value} onChange={() => setDraftOptions(optionsForPolicy(value, draftOptions))} />
            <span><strong>{policyLabel(value, t)}</strong><small>{value === 'off' ? t('Normal trip order', '正常行程次序') : value === 'prefer' ? t('Bring matches forward', '相符行程排前') : t('Hide matching trips', '隱藏相符行程')}</small></span>
          </label>)}
        </fieldset>
        <p className="vehicle-editor-note">{t('Only confirmed vehicle assignments can match. A route or timetable does not confirm which vehicle you will board.', '只有已確認配車先可以相符，路線同時刻表唔能夠確認你會搭邊部車。')}</p>
        {mode === 'avoid' && <section className="vehicle-unknown-choice" aria-labelledby={`${id}-unknown`}>
          <h3 id={`${id}-unknown`}>{t('When the vehicle is unconfirmed', '車輛未確認時')}</h3>
          <label><input type="checkbox" checked={!!draftOptions.includeUnconfirmed} onChange={event => setDraftOptions({ ...draftOptions, includeUnconfirmed: event.target.checked })} /><span>{t('Keep unconfirmed journeys', '保留未確認配車嘅行程')}</span></label>
          <p>{draftOptions.includeUnconfirmed ? t('Unconfirmed journeys stay available. They are not verified to avoid your selection.', '未確認行程會保留，但未能保證避開所選車輛。') : t('Unconfirmed journeys will also be hidden. This can remove every result when live assignments are unavailable.', '未確認行程亦會隱藏；如果未有即時配車資料，可能全部結果都會被移除。')}</p>
        </section>}
        <div className="vehicle-editor-steps" aria-label={t('Vehicle selection steps', '車輛選擇步驟')}>
          {(['company', 'model', 'years'] as const).map((value, index) => <button key={value} type="button" aria-pressed={step === value} onClick={() => goToStep(value)}><span>{index + 1}</span>{value === 'company' ? t('Company', '公司') : value === 'model' ? t('Model', '型號') : t('Years', '年份')}</button>)}
        </div>
        <div className="vehicle-choice-columns" data-step={step}>
          <section className="vehicle-editor-section vehicle-company-section" tabIndex={-1} aria-labelledby={`${id}-company`}><h3 id={`${id}-company`}>{t('1. Manufacturer', '1. 製造商')}</h3>
            <FactChoices choices={manufacturers} selected={draft.manufacturer} onSelect={manufacturer => setDraft(chooseVehicleManufacturer(draft, manufacturer))} label={t('Search manufacturers', '搜尋製造商')} anyLabel={t('Any manufacturer', '任何製造商')} storageId="journey-vehicle-company" t={t} />
          </section>
          <section className="vehicle-editor-section vehicle-model-section" tabIndex={-1} aria-labelledby={`${id}-model`}><h3 id={`${id}-model`}>{t('2. Model', '2. 型號')}</h3>
            {draft.manufacturer ? <FactChoices key={draft.manufacturer} choices={models} selected={draft.model} onSelect={model => setDraft({ ...draft, model })} label={t('Search models', '搜尋型號')} anyLabel={t('Any model', '任何型號')} storageId={`journey-vehicle-model-${draft.manufacturer}`} t={t} /> : <div className="vehicle-model-empty"><TrainFront size={28} aria-hidden="true" /><p>{t('Choose a manufacturer first to see its verified models.', '請先選擇製造商，先會顯示該公司已核實型號。')}</p><button type="button" onClick={() => goToStep('company')}>{t('Choose manufacturer', '選擇製造商')}</button></div>}
          </section>
          <section className="vehicle-editor-section vehicle-years-section" tabIndex={-1} aria-labelledby={`${id}-years`}><h3 id={`${id}-years`}>{t('3. Build years', '3. 建造年份')}</h3>
            <div className="vehicle-editor-years">
              <label htmlFor={`${id}-from`}>{t('From year', '開始年份')}<input id={`${id}-from`} type="text" inputMode="numeric" maxLength={4} value={years.from} aria-invalid={!!error} aria-describedby={`${id}-year-note${error ? ` ${id}-year-error` : ''}`} onChange={event => setYears({ ...years, from: event.target.value })} /></label>
              <label htmlFor={`${id}-to`}>{t('Through year', '結束年份')}<input id={`${id}-to`} type="text" inputMode="numeric" maxLength={4} value={years.to} aria-invalid={!!error} aria-describedby={`${id}-year-note${error ? ` ${id}-year-error` : ''}`} onChange={event => setYears({ ...years, to: event.target.value })} /></label>
            </div>
            {error && <p id={`${id}-year-error`} className="vehicle-editor-error" role="alert">{error === 'reversed' ? t('The start year must be the same as or earlier than the end year.', '開始年份必須早過或等於結束年份。') : t('Enter a whole year from 1800 through 3000.', '請輸入介乎 1800 至 3000 嘅整數年份。')}</p>}
            <p id={`${id}-year-note`} className="vehicle-editor-note">{t('Leave either end blank for no limit within 1800–3000. Both blank means any year. Partly overlapping published year ranges remain unconfirmed.', '留空一邊表示在 1800 至 3000 年範圍內該邊不限；兩邊留空即任何年份。公布年份範圍只部分重疊時，仍然視為未確認。')}</p>
            <fieldset className="vehicle-match-choices"><legend>{t('Combine the selected details', '合併所選條件')}</legend>{(['all', 'any'] as const).map(value => <label key={value}><input type="radio" name={`${id}-match`} checked={(draft.match ?? 'all') === value} onChange={() => setDraft({ ...draft, match: value })} /><span>{value === 'all' ? t('Match every detail', '全部條件相符') : t('Match any detail', '任何條件相符')}</span></label>)}</fieldset>
          </section>
        </div>
        {mode === 'off' && <p className="vehicle-editor-note">{t('Your selection will be saved. Choose Prefer or Avoid to apply it to journeys.', '選擇會儲存；選取優先或避開，先會套用到行程。')}</p>}
      </div>
      <footer className="vehicle-editor-footer">
        <button className="vehicle-editor-reset" type="button" onClick={() => { setDraft({ match: 'all' }); setYears({ from: '', to: '' }); setDraftOptions({ prefer: false, avoid: false, includeUnconfirmed: false }); }}>{t('Reset', '重設')}</button>
        <div><button type="button" className="pill" onClick={close}>{t('Cancel', '取消')}</button><button type="button" className="primary" onClick={apply} disabled={!!error} title={error ? t('Correct the year range before applying.', '套用前請修正年份範圍。') : undefined}>{t('Apply preferences', '套用偏好')}</button></div>
        {error && <output className="vehicle-editor-apply-note">{t('Correct the year range before applying.', '套用前請修正年份範圍。')}<button type="button" onClick={() => goToStep('years')}>{t('Edit years', '修改年份')}</button></output>}
      </footer>
    </dialog>}
  </>;
}
export default JourneyVehiclePreferencesPanel;
