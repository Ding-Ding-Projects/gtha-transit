'use client';


export type JourneyVehicleCriteria = {
  manufacturer?: string;
  model?: string;
  yearFrom?: number;
  yearTo?: number;
  match?: 'all' | 'any';
};

export type JourneyVehiclePreferenceOptions = {
  prefer?: boolean;
  avoid?: boolean;
  includeUnconfirmed?: boolean;
};

/** Facts must come from already verified fleet/CPTDB data, never route inference. */
export type VerifiedFleetFact = {
  manufacturer?: string | null;
  model?: string | null;
  year?: string | number | null;
};

export type JourneyVehiclePreferencesPanelProps = {
  criteria: JourneyVehicleCriteria;
  options: JourneyVehiclePreferenceOptions;
  verifiedFleetFacts: readonly VerifiedFleetFact[];
  excludedCount?: number;
  onCriteriaChange: (criteria: JourneyVehicleCriteria) => void;
  onOptionsChange: (options: JourneyVehiclePreferenceOptions) => void;
  t?: (english: string, cantonese: string) => string;
};

const chipStyle = (active: boolean) => ({
  border: `1px solid ${active ? '#005ac1' : '#6f7883'}`,
  borderRadius: 999,
  background: active ? '#d9e8ff' : '#ffffff',
  color: '#10233d',
  cursor: 'pointer',
  minHeight: 40,
  padding: '8px 12px',
  font: 'inherit',
});

const panelStyle = {
  border: '1px solid #b7c4d5',
  borderRadius: 16,
  background: '#f8faff',
  color: '#10233d',
  maxWidth: 720,
  padding: 20,
};

function values(facts: readonly VerifiedFleetFact[], field: 'manufacturer' | 'model') {
  const found = new Set<string>();
  for (const fact of facts ?? []) {
    const value = fact[field]?.trim();
    if (value) found.add(value);
  }
  return Array.from(found).sort((left, right) => left.localeCompare(right));
}

/**
 * Parent integration recipe:
 * 1. Pass only fleet facts that the parent has independently verified from CPTDB.
 * 2. Keep criteria/options in parent state and call applyJourneyPreferences separately.
 * 3. Send the returned excluded count back through excludedCount for this recovery message.
 */
export function JourneyVehiclePreferencesPanel({
  criteria,
  options,
  verifiedFleetFacts,
  excludedCount = 0,
  onCriteriaChange,
  onOptionsChange,
  t = (english) => english,
}: JourneyVehiclePreferencesPanelProps) {
  const manufacturers = values(verifiedFleetFacts, 'manufacturer');
  const models = values(verifiedFleetFacts, 'model');
  const updateCriteria = (change: Partial<JourneyVehicleCriteria>) => onCriteriaChange({ ...criteria, ...change });
  const updateOptions = (change: Partial<JourneyVehiclePreferenceOptions>) => onOptionsChange({ ...options, ...change });
  const avoidActive = Boolean(options.avoid);

  return <section aria-labelledby="vehicle-preferences-heading" style={panelStyle}>
    <h2 id="vehicle-preferences-heading" style={{ marginTop: 0 }}>{t('Vehicle preferences', '車輛偏好')}</h2>
    <p>{t('Choices below come only from verified fleet facts. A route or timetable never supplies a guessed vehicle.', '以下選項只來自已核實車隊資料，路線同時刻表唔會估車輛。')}</p>

    <fieldset>
      <legend>{t('Policy', '偏好方式')}</legend>
      <div role="group" aria-label={t('Vehicle preference policy', '車輛偏好方式')} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" aria-pressed={Boolean(options.prefer)} onClick={() => updateOptions({ prefer: !options.prefer })} style={chipStyle(Boolean(options.prefer))}>{t('Prefer matches', '優先相符')}</button>
        <button type="button" aria-pressed={avoidActive} onClick={() => updateOptions({ avoid: !avoidActive })} style={chipStyle(avoidActive)}>{t('Avoid matches', '避開相符')}</button>
      </div>
    </fieldset>

    <fieldset>
      <legend>{t('Manufacturer', '製造商')}</legend>
      <div role="group" aria-label={t('Manufacturer choices', '製造商選項')} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {manufacturers.map((manufacturer) => <button key={manufacturer} type="button" aria-pressed={criteria.manufacturer === manufacturer} onClick={() => updateCriteria({ manufacturer: criteria.manufacturer === manufacturer ? undefined : manufacturer })} style={chipStyle(criteria.manufacturer === manufacturer)}>{manufacturer}</button>)}
        {!manufacturers.length && <p role="status">{t('No verified manufacturers are available yet.', '暫時未有已核實製造商。')}</p>}
      </div>
    </fieldset>

    <fieldset>
      <legend>{t('Model', '型號')}</legend>
      <div role="group" aria-label={t('Model choices', '型號選項')} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {models.map((model) => <button key={model} type="button" aria-pressed={criteria.model === model} onClick={() => updateCriteria({ model: criteria.model === model ? undefined : model })} style={chipStyle(criteria.model === model)}>{model}</button>)}
        {!models.length && <p role="status">{t('No verified models are available yet.', '暫時未有已核實型號。')}</p>}
      </div>
    </fieldset>

    <fieldset>
      <legend>{t('Build-year interval', '建造年份範圍')}</legend>
      <label>{t('From', '由')} <input type="number" inputMode="numeric" min="1800" max="3000" value={criteria.yearFrom ?? ''} onChange={(event) => updateCriteria({ yearFrom: event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value) })} /></label>{' '}
      <label>{t('To', '至')} <input type="number" inputMode="numeric" min="1800" max="3000" value={criteria.yearTo ?? ''} onChange={(event) => updateCriteria({ yearTo: event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value) })} /></label>
      <p>{t('Published year ranges that only partly overlap remain unconfirmed.', '已公布年份範圍只係部分重疊時會保持未確認。')}</p>
    </fieldset>

    <fieldset>
      <legend>{t('When more than one criterion is set', '設定多於一項條件時')}</legend>
      <div role="group" aria-label={t('Criteria combination', '條件組合')} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" aria-pressed={(criteria.match ?? 'all') === 'all'} onClick={() => updateCriteria({ match: 'all' })} style={chipStyle((criteria.match ?? 'all') === 'all')}>{t('Match all', '全部相符')}</button>
        <button type="button" aria-pressed={criteria.match === 'any'} onClick={() => updateCriteria({ match: 'any' })} style={chipStyle(criteria.match === 'any')}>{t('Match any', '任何一項相符')}</button>
      </div>
    </fieldset>

    {avoidActive && <aside aria-live="polite" style={{ borderLeft: '4px solid #8b4200', marginTop: 16, paddingLeft: 12 }}>
      <strong>{t('Avoid can remove unconfirmed options.', '避開模式可以移除未確認選項。')}</strong>
      <p>{t('A journey with an assigned vehicle that cannot be verified against these facts is excluded by default. Choose the option below to keep it.', '已配車輛未能按這些資料核實嘅行程預設會被移除。選以下項目即可保留。')}</p>
      <button type="button" aria-pressed={Boolean(options.includeUnconfirmed)} onClick={() => updateOptions({ includeUnconfirmed: !options.includeUnconfirmed })} style={chipStyle(Boolean(options.includeUnconfirmed))}>{t('Include unconfirmed assignments', '包括未確認配車')}</button>
      {excludedCount > 0 && <p role="status">{t(`${excludedCount} option${excludedCount === 1 ? '' : 's'} excluded. Include unconfirmed assignments to recover unconfirmed options.`, `${excludedCount} 個選項已移除。包括未確認配車可恢復未確認選項。`)}</p>}
    </aside>}

    <p><small>{t('Search is intentionally not added here yet. Each future search needs an adjacent full regex builder; this panel will integrate with the shared builder when it exists.', '暫時刻意未加搜尋。每個將來搜尋都需要相鄰完整正規表示式建立器；共用建立器完成後，此面板會接駁。')}</small></p>
  </section>;
}

export default JourneyVehiclePreferencesPanel;
