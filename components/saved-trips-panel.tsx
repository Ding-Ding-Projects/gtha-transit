'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, MapPin, X } from 'lucide-react';
import { SearchWorkbench, emptySearchState, useSearchMatches, type SearchState } from './search-workbench';
import SuperConfirm from './super-confirm';
import {
  clearSelection,
  emptySelection,
  invert,
  isSelected,
  previewBulk,
  selectAllMatches,
  selectPage,
  selectedCount,
  skipSummary,
  toggle,
  type Selection,
} from '../lib/list-selection';
import { EXPORT_FORMATS, EXPORT_MEDIA, describeLoss, exportFilename, exportRecords, type ExportFormat } from '../lib/export';
import type { Place } from '../lib/types';

type Translate = (en: string, zh: string) => string;

export type SavedTrip = {
  id: string;
  from: Place;
  to: Place;
  via?: Place[];
  requiredRoute?: { feedId: string; routeId: string } | null;
  preferDivision?: boolean;
  divisionMode?: 'exact' | 'route';
};

export type SavedTripsPanelProps = {
  saved: SavedTrip[];
  setSaved: (next: SavedTrip[]) => void;
  onOpen: (trip: SavedTrip) => void;
  t: Translate;
};

const tripSample = (trip: SavedTrip): string =>
  [trip.from.name, trip.to.name, ...(trip.via ?? []).map((place) => place.name)].filter(Boolean).join(' ');

/**
 * The saved-trips list's own multi-select, export and bulk removal.
 *
 * Every other list in this codebase that holds more than a couple of rows
 * has search, select-all-that-says-which-all, a preview that separates what
 * is selected from what an action actually changes, and a destructive
 * confirmation gated the same way everywhere else. A saved trip is deleted
 * one at a time before this: the delete button is kept for a single trip
 * a person is looking right at, and everything here is additive on top of it.
 */
export default function SavedTripsPanel({ saved, setSaved, onOpen, t }: SavedTripsPanelProps) {
  const [search, setSearch] = useState<SearchState>(emptySearchState);
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const [format, setFormat] = useState<ExportFormat>('json');
  const [confirming, setConfirming] = useState(false);

  const samples = useMemo(() => saved.map(tripSample), [saved]);
  const result = useSearchMatches(samples, search);
  const query = (search.mode === 'regex' ? search.pattern : search.query).trim();
  const matched = useMemo(
    () => (query && !result.error ? saved.filter((_, index) => result.matches[index]) : saved),
    [saved, query, result.error, result.matches],
  );
  const chosen = selectedCount(selection, matched.length);
  const preview = useMemo(() => previewBulk(selection, matched, matched.length), [selection, matched]);

  const losses = useMemo(
    () => describeLoss(matched.map((trip) => ({ id: trip.id, from: trip.from.name, to: trip.to.name, via: (trip.via ?? []).map((place) => place.name) })), format),
    [matched, format],
  );

  const download = () => {
    const rows = preview.affected.length ? preview.affected : matched;
    const records = rows.map((trip) => ({
      id: trip.id,
      from: trip.from.name,
      fromLat: trip.from.lat,
      fromLon: trip.from.lon,
      to: trip.to.name,
      toLat: trip.to.lat,
      toLon: trip.to.lon,
      via: (trip.via ?? []).map((place) => place.name),
      requiredRoute: trip.requiredRoute ?? null,
    }));
    const note = t(
      `Saved trips kept in this browser: ${records.length} of ${saved.length}, filtered as shown.`,
      `本機儲存嘅行程：共 ${saved.length} 個之中嘅 ${records.length} 個，已按畫面篩選。`,
    );
    const text = exportRecords(records, format, { name: 'saved-trips', note });
    const blob = new Blob([text], { type: EXPORT_MEDIA[format].type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = exportFilename('saved-trips', format, new Date().toISOString().slice(0, 10));
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const doDelete = () => {
    const going = new Set(preview.affected.map((trip) => trip.id));
    setSaved(saved.filter((trip) => !going.has(trip.id)));
    setSelection(clearSelection());
    setConfirming(false);
  };

  if (saved.length === 0) return null;

  return (
    <div className="saved-trips-panel" data-ui="saved.bulk">
      <SearchWorkbench storageId="saved-trips-search" label={t('Search saved trips', '搜尋已儲存行程')} value={search} onChange={setSearch} samples={samples} t={t} />

      <div className="saved-trips-panel__bulk">
        <button type="button" onClick={() => setSelection(selectPage(matched.map((trip) => trip.id)))}>
          {t(`Select these ${matched.length}`, `選取呢 ${matched.length} 個`)}
        </button>
        <button type="button" onClick={() => setSelection(selectAllMatches())}>
          {t(`Select every match (${matched.length})`, `選取所有符合 (${matched.length})`)}
        </button>
        <button type="button" onClick={() => setSelection((current) => invert(current, matched.map((trip) => trip.id)))}>
          {t('Invert', '反選')}
        </button>
        <button type="button" onClick={() => setSelection(clearSelection())} disabled={chosen === 0}>
          {t('Clear selection', '清除選取')}
        </button>
      </div>

      <output className="saved-trips-panel__status" aria-live="polite">
        {result.error
          ? t('This expression could not be evaluated. Edit it or choose plain text.', '未能配對此規則，請修改或選擇純文字。')
          : chosen === 0
            ? t(`${matched.length} of ${saved.length} shown`, `顯示 ${saved.length} 個之中嘅 ${matched.length} 個`)
            : preview.skipped.length === 0
              ? t(`${chosen} selected`, `已選 ${chosen} 個`)
              : t(
                  `${chosen} selected, ${preview.affected.length} will change, ${preview.skipped.length} skipped: ${skipSummary(preview).map((item) => `${item.count} ${item.reason}`).join(', ')}`,
                  `已選 ${chosen} 個，會變更 ${preview.affected.length} 個，略過 ${preview.skipped.length} 個：${skipSummary(preview).map((item) => `${item.count} 個${item.reason}`).join('、')}`,
                )}
      </output>

      <div className="saved-trips-panel__export">
        <label htmlFor="saved-trips-format">{t('Export as', '匯出格式')}</label>
        <select id="saved-trips-format" value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)}>
          {EXPORT_FORMATS.map((item) => <option key={item} value={item}>{EXPORT_MEDIA[item].label}</option>)}
        </select>
        <button type="button" onClick={download} disabled={matched.length === 0}>
          {chosen > 0 ? t(`Export ${preview.affected.length} selected`, `匯出已選 ${preview.affected.length} 個`) : t(`Export these ${matched.length}`, `匯出呢 ${matched.length} 個`)}
        </button>
        <button type="button" className="saved-trips-panel__delete" disabled={preview.affected.length === 0} onClick={() => setConfirming(true)}>
          {t(`Delete ${preview.affected.length} selected`, `刪除已選 ${preview.affected.length} 個`)}
        </button>
        {losses.length > 0 && <p className="saved-trips-panel__loss">{t('This format cannot carry everything: ', '呢個格式載唔晒：') + losses.join('; ')}</p>}
      </div>

      {matched.length === 0 && saved.length > 0 && (
        <p className="saved-trips-panel__empty">{t('No saved trip matches this search.', '冇已儲存行程符合呢個搜尋。')}</p>
      )}

      {matched.map((s) => (
        <article className="saved-card" key={s.id}>
          <label className="saved-card__select">
            <input type="checkbox" checked={isSelected(selection, s.id)} onChange={() => setSelection((current) => toggle(current, s.id))} />
            <span className="sr-only">{t('Select', '選取')} {s.from.name} {t('to', '至')} {s.to.name}</span>
          </label>
          <button onClick={() => onOpen(s)}>
            <MapPin size={20} />
            <span>
              <strong>{s.from.name}</strong>
              {s.via?.length ? <small>{t('Via', '經')}: {s.via.map((place) => place.name).join(' → ')}</small> : null}
              <small>{t('to', '至')} {s.to.name}</small>
            </span>
            <ArrowRight size={18} />
          </button>
          <button className="icon-button" aria-label={t('Remove saved trip', '移除已儲存行程')} onClick={() => setSaved(saved.filter((x) => x.id !== s.id))}>
            <X size={18} />
          </button>
        </article>
      ))}

      <SuperConfirm
        open={confirming}
        t={t}
        action={{
          title: t(`Delete ${preview.affected.length} saved trips`, `刪除 ${preview.affected.length} 個已儲存行程`),
          detail: t(
            `${preview.affected.length} of the ${saved.length} trips saved in this browser will be removed.`,
            `呢個瀏覽器儲存嘅 ${saved.length} 個行程之中，${preview.affected.length} 個會被移除。`,
          ),
          consequences: [
            t('They are stored only in this browser, so there is no copy anywhere else.', '佢哋只係存喺呢個瀏覽器，第二度冇副本。'),
            t('Export first if you want to keep a record. A local history revision is kept even after this.', '想留底就先匯出。就算刪除之後，本機歷史記錄仍然保留一個版本。'),
          ],
        }}
        onCancel={() => setConfirming(false)}
        onConfirm={doDelete}
      />
    </div>
  );
}
