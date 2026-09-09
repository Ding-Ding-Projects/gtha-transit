'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { SearchWorkbench, emptySearchState, useSearchMatches } from './search-workbench';
import { emptyFleetFilter, manufacturerOptions, modelOptions, type FleetFilter } from '../lib/fleet-filter';
import { useLocalSetting } from '../lib/use-local-setting';

type FactVehicle = { cptdb?: { manufacturer?: string | null; model?: string | null; year?: string | number | null; propulsion?: string | null } };
export default function FleetFilterPanel({ vehicles, value, onChange, storageId, error, excludedUnknownCount = 0, t }: {
  vehicles: readonly FactVehicle[];
  value: FleetFilter;
  onChange: (value: FleetFilter) => void;
  storageId: string;
  error?: string | null;
  /** Vehicles currently excluded because a required detail (propulsion included) is unconfirmed, under every active filter. */
  excludedUnknownCount?: number;
  t: (en: string, zh: string) => string;
}) {
  const [companySearch, setCompanySearch] = useState(emptySearchState);
  const storedExpansion = useLocalSetting(storageId + '-expanded');
  const expanded = storedExpansion.value === 'true';
  const [modelSearch, setModelSearch] = useState(emptySearchState);
  const companies = useMemo(() => manufacturerOptions(vehicles), [vehicles]);
  const models = useMemo(() => modelOptions(vehicles, value.manufacturer), [vehicles, value.manufacturer]);
  const companyMatches = useSearchMatches(companies, companySearch);
  const modelMatches = useSearchMatches(models, modelSearch);
  const electricOnly = value.propulsion === 'electric';
  const active = electricOnly || [value.manufacturer, value.model, value.yearFrom, value.yearTo].some(item => !!item.trim());
  const equal = (left: string, right: string) => left.normalize('NFKC').trim().toLocaleLowerCase() === right.normalize('NFKC').trim().toLocaleLowerCase();
  const update = (patch: Partial<FleetFilter>) => onChange({ ...value, ...patch });
  return <details className="fleet-filter-panel" open={expanded}>
    <summary onClick={event => { event.preventDefault(); storedExpansion.setValue(String(!expanded)); }}><SlidersHorizontal size={18} aria-hidden="true" /><strong>{t('Fleet filters', '車隊篩選')}</strong><span>{active ? [value.manufacturer, value.model, value.yearFrom || value.yearTo ? `${value.yearFrom || '…'} to ${value.yearTo || '…'}` : '', electricOnly ? t('Electric only', '只限電動') : ''].filter(Boolean).join(' · ') : t('Company, model and year', '製造商、型號及年份')}</span><ChevronDown size={18} aria-hidden="true" /></summary>
    <div className="fleet-filter-panel__content">
      <p className="data-note">{t('Filter the map and list together using published fleet details. Build-year ranges can overlap your selection without proving an exact unit year.', '用已公布車隊資料一齊篩選地圖同清單。製造年份範圍可以同所選範圍重疊，但唔代表已核實個別車輛年份。')}</p>
      <div className="fleet-filter-panel__columns">
        <section aria-label={t('Manufacturer filter', '製造商篩選')}>
          <h3>{t('1. Manufacturer', '1. 製造商')}</h3>
          <SearchWorkbench storageId={storageId + '-company'} label={t('Find a manufacturer', '搜尋製造商')} value={companySearch} onChange={setCompanySearch} samples={companies} t={t} />
          <fieldset className="fleet-filter-choices" aria-label={t('Manufacturer choices', '製造商選擇')}>
            <button type="button" aria-pressed={!value.manufacturer} onClick={() => update({ manufacturer: '', model: '' })}>{t('Any manufacturer', '任何製造商')}</button>
            {!companyMatches.busy && !companyMatches.error && companies.map((name, index) => companyMatches.matches[index] && <button type="button" key={name} aria-pressed={equal(value.manufacturer, name)} onClick={() => { update(equal(value.manufacturer, name) ? { manufacturer: name } : { manufacturer: name, model: '' }); setModelSearch(emptySearchState()); }}>{name}</button>)}
          </fieldset>
          {companyMatches.error && <output>{companyMatches.error}</output>}
          {!companies.length && <p>{t('No manufacturer details are reported in this loaded selection.', '目前載入選擇未有製造商資料。')}</p>}
        </section>
        <section aria-label={t('Model filter', '型號篩選')}>
          <h3>{t('2. Model', '2. 型號')}</h3>
          {value.manufacturer ? <>
            <SearchWorkbench storageId={storageId + '-model'} label={t('Find a model', '搜尋型號')} value={modelSearch} onChange={setModelSearch} samples={models} t={t} />
            <fieldset className="fleet-filter-choices" aria-label={t('Model choices', '型號選擇')}>
              <button type="button" aria-pressed={!value.model} onClick={() => update({ model: '' })}>{t('Any model', '任何型號')}</button>
              {!modelMatches.busy && !modelMatches.error && models.map((name, index) => modelMatches.matches[index] && <button type="button" key={name} aria-pressed={equal(value.model, name)} onClick={() => update({ model: name })}>{name}</button>)}
            </fieldset>
            {modelMatches.error && <output>{modelMatches.error}</output>}
            {!models.length && <p>{t('No model details are reported for this manufacturer in the loaded selection.', '目前載入選擇未有此製造商嘅型號資料。')}</p>}
          </> : <p className="data-note">{t('Choose a manufacturer first to see its models.', '先揀製造商，再睇佢嘅型號。')}</p>}
        </section>
      </div>
      <div className="fleet-filter-years">
        <label>{t('Built from year', '製造年份由')}<input type="text" inputMode="numeric" maxLength={4} aria-invalid={!!error} aria-describedby={storageId + '-year-help'} value={value.yearFrom} onChange={event => update({ yearFrom: event.target.value })} /></label>
        <label>{t('Built through year', '製造年份至')}<input type="text" inputMode="numeric" maxLength={4} aria-invalid={!!error} aria-describedby={storageId + '-year-help'} value={value.yearTo} onChange={event => update({ yearTo: event.target.value })} /></label>
      </div>
      <p id={storageId + '-year-help'} className={error ? 'error' : 'data-note'} role={error ? 'alert' : undefined}>{error || t('Enter a four-digit year from 1800 through 3000, or leave either bound empty.', '輸入 1800 至 3000 之間嘅四位年份，亦可留空任何一邊。')}</p>
      <section aria-label={t('Propulsion filter', '推進方式篩選')} className="fleet-filter-electric">
        <h3>{t('3. Propulsion', '3. 推進方式')}</h3>
        <label htmlFor={storageId + '-electric'} className="fleet-filter-electric-switch">
          <input id={storageId + '-electric'} role="switch" type="checkbox" checked={electricOnly} onChange={event => update({ propulsion: event.target.checked ? 'electric' : '' })} />
          <span>{t('Electric only', '只限電動')}</span>
        </label>
        <p className="data-note">{t('Matches a verified battery-electric or electric vehicle, such as a streetcar. A vehicle whose propulsion is not published is excluded unless included below.', '只計已核實電池電動或電動車輛（包括電車）。未公布推進方式嘅車輛會被剔除，除非喺下面選擇包括。')}</p>
        {electricOnly && excludedUnknownCount > 0 && <p className="data-note">{t(`${excludedUnknownCount} vehicles with unconfirmed details are currently excluded by the active filters.`, `${excludedUnknownCount} 架車因資料未能核實而被目前篩選剔除。`)}</p>}
      </section>
      <label className="fleet-filter-unknown"><input type="checkbox" checked={value.includeUnknown} onChange={event => update({ includeUnknown: event.target.checked })} />{t('Include vehicles whose details cannot confirm this filter', '包括資料未能確認符合篩選嘅車輛')}</label>
      {active && <button type="button" className="pill" onClick={() => onChange(emptyFleetFilter())}><X size={16} aria-hidden="true" />{t('Clear fleet filters', '清除車隊篩選')}</button>}
    </div>
  </details>;
}
