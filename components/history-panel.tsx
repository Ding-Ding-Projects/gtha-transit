'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, History as HistoryIcon, RotateCcw, X } from 'lucide-react';
import { SearchWorkbench, emptySearchState, useSearchMatches, type SearchState } from './search-workbench';
import SuperConfirm from './super-confirm';
import { diffJson, summariseDiff, type DiffEntry } from '../lib/json-diff';
import {
  forgetCommits,
  history as historyList,
  label as labelCommit,
  redact,
  restore,
  type HistoryBackend,
  type HistoryCommit,
  type HistoryKind,
} from '../lib/record-history';
import { actionCounts, actionsInUse, commitSample, filterCommits } from '../lib/history-panel';
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

type Translate = (en: string, zh: string) => string;

const ACTION_LABEL: Record<string, [string, string]> = {
  save: ['Saved', '已儲存'],
  delete: ['Deleted', '已刪除'],
  reorder: ['Reordered', '已重新排序'],
  rename: ['Renamed', '已重新命名'],
  restore: ['Restored', '已還原'],
  import: ['Imported', '已匯入'],
  'settings-change': ['Changed', '已更改'],
  lock: ['Locked', '已鎖定'],
  'rotate-secret': ['Secret rotated', '密鑰已更換'],
  prune: ['Pruned', '已清理'],
  label: ['Labelled', '已標籤'],
};

function actionLabel(action: string, t: Translate): string {
  const entry = ACTION_LABEL[action];
  return entry ? t(entry[0], entry[1]) : action;
}

/** A value shown in a diff row, clamped so one giant field cannot fill the panel. */
function previewValue(value: unknown): string {
  if (value === undefined) return '—';
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text === undefined) text = String(value);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function formatWhen(at: number): string {
  return new Date(at).toLocaleString('en-CA', { timeZone: 'America/Toronto', hour12: false, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export type HistoryPanelProps = {
  /** Which record kind this panel reads and writes — see `KNOWN_HISTORY_KINDS`. */
  kind: HistoryKind;
  backend: HistoryBackend;
  t: Translate;
  /** Label on the button that opens the panel, e.g. "Trip history". */
  openerLabel: string;
  /** Heading inside the opened panel, e.g. "Saved trip history". */
  panelLabel: string;
  /** Applies a restored (or reverted-to) snapshot back into the live surface that owns this kind. */
  onRestore: (snapshot: unknown, commit: HistoryCommit) => void;
  /** A one-line description of a snapshot, for a caller whose snapshots are not self-explanatory JSON. */
  describeSnapshot?: (snapshot: unknown) => string;
};

/**
 * Read, search, diff, restore, label and export a record's local version
 * history — the panel `docs/interface/history.md` describes as the piece
 * `lib/record-history.ts` was built to support and nothing has called yet.
 *
 * Shaped after `NotificationCentre`, the other list this codebase already
 * makes searchable, multi-selectable and exportable: a regex-capable search
 * field, filters that show a live count rather than hiding to zero, a bulk
 * toolbar whose select-all says which all it means, a preview that separates
 * what is selected from what an action will actually touch, and forgetting
 * gated behind the two-key destructive confirmation. What is specific to a
 * commit history rather than a notification queue is the diff and the
 * restore, both native to `lib/record-history.ts` and `lib/json-diff.ts`.
 */
export default function HistoryPanel({ kind, backend, t, openerLabel, panelLabel, onRestore, describeSnapshot }: HistoryPanelProps) {
  const [open, setOpen] = useState(false);
  const [commits, setCommits] = useState<HistoryCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState<SearchState>(emptySearchState);
  const [actions, setActions] = useState<string[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const [format, setFormat] = useState<ExportFormat>('json');
  const [confirming, setConfirming] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await historyList(backend, kind, { limit: 200 });
      setCommits(rows);
    } finally {
      setLoading(false);
    }
  }, [backend, kind]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const headId = commits[0]?.id ?? null;
  const byId = useMemo(() => new Map(commits.map((commit) => [commit.id, commit])), [commits]);
  const samples = useMemo(() => commits.map(commitSample), [commits]);
  const result = useSearchMatches(samples, search);
  const query = (search.mode === 'regex' ? search.pattern : search.query).trim();
  const matched = useMemo(
    () => filterCommits(commits, { actions, from: from || undefined, to: to || undefined }, query ? result.matches : undefined),
    [commits, actions, from, to, query, result.matches],
  );
  const counts = useMemo(() => actionCounts(commits), [commits]);
  const availableActions = useMemo(() => actionsInUse(commits), [commits]);
  const chosen = selectedCount(selection, matched.length);

  const preview = useMemo(
    () => previewBulk(selection, matched, matched.length, (row) => (row.id === headId ? t('is the current revision', '係目前版本') : null)),
    [selection, matched, headId, t],
  );

  const losses = useMemo(
    () => describeLoss(matched.map((commit) => ({ id: commit.id, action: commit.action, label: commit.label, snapshot: commit.snapshot })), format),
    [matched, format],
  );

  const download = useCallback(() => {
    const rows = preview.affected.length ? preview.affected : matched;
    const records = rows.map((commit) => ({
      id: commit.id,
      kind: commit.kind,
      parent: commit.parent,
      action: commit.action,
      label: commit.label,
      at: new Date(commit.at).toISOString(),
      size: commit.size,
      snapshot: redact(commit.snapshot),
    }));
    const note = t(
      `Redacted local history for "${kind}": ${records.length} of ${commits.length} revisions, filtered as shown. Fields whose name contains secret, password, pin, token or key are replaced with fp:<8 hex characters>, a fingerprint of the original value.`,
      `本機「${kind}」歷史記錄（已遮蔽）：共 ${commits.length} 個版本之中嘅 ${records.length} 個，已按畫面篩選。名稱包含 secret、password、pin、token 或 key 嘅欄位會顯示為 fp:<8 個十六進位字元>，即原值嘅指紋。`,
    );
    const text = exportRecords(records, format, { name: `history-${kind}`, note });
    const blob = new Blob([text], { type: EXPORT_MEDIA[format].type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = exportFilename(`history-${kind}`, format, new Date().toISOString().slice(0, 10));
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [preview.affected, matched, format, kind, commits.length, t]);

  const doRestore = useCallback(
    async (commit: HistoryCommit) => {
      const result = await restore(backend, kind, commit.id, t('Restored from the history panel', '從歷史記錄面板還原'));
      if (result.restored) {
        onRestore(result.commit.snapshot, result.commit);
        setNotice(t('Restored as a new revision. The one you restored from is still in this list.', '已還原為新版本，原本嗰個版本仍然喺呢個清單。'));
        await load();
      } else {
        setNotice(t('Could not restore that revision.', '未能還原呢個版本。'));
      }
    },
    [backend, kind, onRestore, load, t],
  );

  const saveLabel = useCallback(
    async (commit: HistoryCommit) => {
      const draft = labelDrafts[commit.id];
      if (draft === undefined || draft === commit.label) return;
      const result = await labelCommit(backend, commit.id, draft.slice(0, 200));
      if (result.labelled) {
        setCommits((current) => current.map((item) => (item.id === commit.id ? result.commit : item)));
      }
    },
    [backend, labelDrafts],
  );

  const doForget = useCallback(async () => {
    const ids = preview.affected.map((commit) => commit.id);
    const result = await forgetCommits(backend, kind, ids);
    setSelection(clearSelection());
    setConfirming(false);
    setNotice(
      result.skipped.length
        ? t(`Forgot ${result.removed.length}. The current revision is never forgotten by a bulk action.`, `已刪除 ${result.removed.length} 個版本，目前版本唔會被批量動作刪除。`)
        : t(`Forgot ${result.removed.length} revisions.`, `已刪除 ${result.removed.length} 個版本。`),
    );
    await load();
  }, [backend, kind, preview.affected, load, t]);

  const diffFor = (commit: HistoryCommit): { entries: DiffEntry[]; truncated: boolean; parentKnown: boolean } => {
    const parent = commit.parent ? byId.get(commit.parent) : null;
    const parentKnown = commit.parent === null || !!parent;
    const { entries, truncated } = diffJson(parent ? parent.snapshot : undefined, commit.snapshot);
    return { entries, truncated, parentKnown };
  };

  return (
    <>
      <button ref={opener} type="button" className="history-panel-opener" data-ui="history.opener" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <HistoryIcon size={18} aria-hidden="true" />
        <span>{openerLabel}</span>
      </button>

      <dialog
        ref={dialog}
        className="history-panel"
        aria-label={panelLabel}
        onClose={() => { setOpen(false); opener.current?.focus(); }}
        onCancel={() => setOpen(false)}
      >
        <div className="history-panel__surface">
          <div className="history-panel__head">
            <h2>{panelLabel}</h2>
            <button type="button" className="history-panel__close" aria-label={t('Close', '關閉')} onClick={() => setOpen(false)}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>

          <p className="history-panel__intro">
            {t(
              'Every real change is kept as a labelled, restorable revision, entirely in this browser. Restoring never rewinds: it writes the old snapshot forward as a brand-new revision.',
              '每次真正嘅變更都會保存為一個有標籤、可還原嘅版本，全部只留喺呢個瀏覽器。還原唔會倒帶：佢會將舊版本以新版本嘅方式寫返落去。',
            )}
          </p>

          <SearchWorkbench storageId={`history-panel-${kind}-search`} label={t('Search this history', '搜尋呢個歷史記錄')} value={search} onChange={setSearch} samples={samples} t={t} />

          {availableActions.length > 0 && (
            <fieldset className="history-panel__actions" aria-label={t('Filter by action', '按動作篩選')}>
              {availableActions.map((action) => (
                <label key={action} className={actions.includes(action) ? 'is-on' : undefined}>
                  <input
                    type="checkbox"
                    checked={actions.includes(action)}
                    onChange={() => setActions((current) => (current.includes(action) ? current.filter((item) => item !== action) : [...current, action]))}
                  />
                  <span>{actionLabel(action, t)}</span>
                  <small>{counts[action] ?? 0}</small>
                </label>
              ))}
            </fieldset>
          )}

          <div className="history-panel__dates">
            <label htmlFor={`history-${kind}-from`}>{t('From', '由')}</label>
            <input id={`history-${kind}-from`} type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            <label htmlFor={`history-${kind}-to`}>{t('To', '至')}</label>
            <input id={`history-${kind}-to`} type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            {(from || to) && <button type="button" onClick={() => { setFrom(''); setTo(''); }}>{t('Clear dates', '清除日期')}</button>}
          </div>

          <div className="history-panel__bulk">
            <button type="button" onClick={() => setSelection(selectPage(matched.map((commit) => commit.id)))}>
              {t(`Select these ${matched.length}`, `選取呢 ${matched.length} 個`)}
            </button>
            <button type="button" onClick={() => setSelection(selectAllMatches())}>
              {t(`Select every match (${matched.length})`, `選取所有符合 (${matched.length})`)}
            </button>
            <button type="button" onClick={() => setSelection((current) => invert(current, matched.map((commit) => commit.id)))}>
              {t('Invert', '反選')}
            </button>
            <button type="button" onClick={() => setSelection(clearSelection())} disabled={chosen === 0}>
              {t('Clear selection', '清除選取')}
            </button>
          </div>

          <output className="history-panel__status" aria-live="polite">
            {loading
              ? t('Loading this history…', '正在載入歷史記錄…')
              : result.error
                ? t('This expression could not be evaluated. Edit it or choose plain text.', '未能配對此規則，請修改或選擇純文字。')
                : chosen === 0
                  ? t(`${matched.length} of ${commits.length} shown`, `顯示 ${commits.length} 個之中嘅 ${matched.length} 個`)
                  : preview.skipped.length === 0
                    ? t(`${chosen} selected, ${preview.affected.length} will change`, `已選 ${chosen} 個，會變更 ${preview.affected.length} 個`)
                    : t(
                        `${chosen} selected, ${preview.affected.length} will change, ${preview.skipped.length} skipped: ${skipSummary(preview).map((item) => `${item.count} ${item.reason}`).join(', ')}`,
                        `已選 ${chosen} 個，會變更 ${preview.affected.length} 個，略過 ${preview.skipped.length} 個：${skipSummary(preview).map((item) => `${item.count} 個${item.reason}`).join('、')}`,
                      )}
          </output>
          {notice && <output className="history-panel__notice" aria-live="polite">{notice}</output>}

          <div className="history-panel__export">
            <label htmlFor={`history-${kind}-format`}>{t('Export as', '匯出格式')}</label>
            <select id={`history-${kind}-format`} value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)}>
              {EXPORT_FORMATS.map((item) => <option key={item} value={item}>{EXPORT_MEDIA[item].label}</option>)}
            </select>
            <button type="button" onClick={download} disabled={matched.length === 0}>
              {chosen > 0 ? t(`Export ${preview.affected.length} selected`, `匯出已選 ${preview.affected.length} 個`) : t(`Export these ${matched.length}`, `匯出呢 ${matched.length} 個`)}
            </button>
            {losses.length > 0 && <p className="history-panel__loss">{t('This format cannot carry everything: ', '呢個格式載唔晒：') + losses.join('; ')}</p>}
          </div>

          <ul className="history-panel__list">
            {matched.length === 0 && (
              <li className="history-panel__empty">
                {commits.length === 0
                  ? t('No revisions yet. One is kept every time this changes.', '暫時未有任何版本，每次變更都會保留一個版本。')
                  : t('No revision matches these filters.', '冇版本符合呢啲條件。')}
              </li>
            )}
            {matched.map((commit) => {
              const isHead = commit.id === headId;
              const diff = expanded === commit.id ? diffFor(commit) : null;
              const summary = diff ? summariseDiff(diff.entries) : null;
              const draft = labelDrafts[commit.id] ?? commit.label;
              return (
                <li key={commit.id} className={`history-row ${isHead ? 'history-row--head' : ''}`.trim()}>
                  <label className="history-row__select">
                    <input type="checkbox" checked={isSelected(selection, commit.id)} onChange={() => setSelection((current) => toggle(current, commit.id))} />
                    <span className="sr-only">{t('Select', '選取')} {commit.id.slice(0, 8)}</span>
                  </label>
                  <div className="history-row__text">
                    <div className="history-row__line">
                      <span className="history-row__action">{actionLabel(commit.action, t)}</span>
                      {isHead && <span className="history-row__head-badge">{t('Current', '目前')}</span>}
                      <time dateTime={new Date(commit.at).toISOString()}>{formatWhen(commit.at)}</time>
                    </div>
                    {describeSnapshot && <small>{describeSnapshot(commit.snapshot)}</small>}
                    <label className="history-row__label-field">
                      <span className="sr-only">{t('Label', '標籤')}</span>
                      <input
                        type="text"
                        maxLength={200}
                        placeholder={t('Add a label…', '加標籤…')}
                        value={draft}
                        onChange={(event) => setLabelDrafts((current) => ({ ...current, [commit.id]: event.target.value }))}
                        onBlur={() => void saveLabel(commit)}
                      />
                    </label>
                    <button type="button" className="history-row__diff-toggle" onClick={() => setExpanded((current) => (current === commit.id ? null : commit.id))} aria-expanded={expanded === commit.id}>
                      {expanded === commit.id ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                      {t('Diff from previous revision', '同上個版本嘅差異')}
                    </button>
                    {diff && (
                      <div className="history-row__diff" data-ui="history.diff">
                        {!diff.parentKnown ? (
                          <p>{t('The previous revision is outside the loaded window.', '上一個版本喺已載入範圍之外。')}</p>
                        ) : diff.entries.length === 0 && !diff.truncated ? (
                          <p>{t('No change from the previous revision.', '同上個版本冇分別。')}</p>
                        ) : (
                          <>
                            <p>
                              {t(
                                `${summary!.added} added, ${summary!.removed} removed, ${summary!.changed} changed.`,
                                `新增 ${summary!.added} 項，移除 ${summary!.removed} 項，變更 ${summary!.changed} 項。`,
                              )}
                              {diff.truncated && ' ' + t('This diff was too large to show in full.', '呢個差異太大，未能完整顯示。')}
                            </p>
                            <ul>
                              {diff.entries.slice(0, 200).map((entry, index) => (
                                <li key={`${entry.path}-${index}`} className={`history-diff-entry history-diff-entry--${entry.kind}`}>
                                  <code>{entry.path || '(root)'}</code>
                                  <span className="history-diff-entry__kind">{entry.kind}</span>
                                  {entry.kind !== 'added' && <code className="history-diff-entry__before">{previewValue(entry.before)}</code>}
                                  {entry.kind !== 'removed' && <code className="history-diff-entry__after">{previewValue(entry.after)}</code>}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <button type="button" className="history-row__restore" onClick={() => void doRestore(commit)} disabled={isHead} title={isHead ? t('This is already the current revision.', '已經係目前版本。') : undefined}>
                    <RotateCcw size={16} aria-hidden="true" />
                    {t('Restore', '還原')}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="history-panel__foot">
            <button
              type="button"
              className="history-panel__forget"
              disabled={preview.affected.length === 0}
              onClick={() => setConfirming(true)}
            >
              {t(`Forget ${preview.affected.length} permanently`, `永久刪除 ${preview.affected.length} 個`)}
            </button>
          </div>
        </div>
      </dialog>

      <SuperConfirm
        open={confirming}
        t={t}
        action={{
          title: t(`Forget ${preview.affected.length} revisions`, `永久刪除 ${preview.affected.length} 個版本`),
          detail: t(
            `${preview.affected.length} of the ${commits.length} revisions of this history, kept only in this browser, will be removed permanently. The current revision is never removed by this.`,
            `呢個歷史記錄只喺呢個瀏覽器保存，共 ${commits.length} 個版本之中有 ${preview.affected.length} 個會永久移除。目前版本唔會被移除。`,
          ),
          consequences: [
            t('They are stored only in this browser, so there is no copy anywhere else.', '佢哋只係存喺呢個瀏覽器，第二度冇副本。'),
            t('Export first if you want to keep a record.', '想留底就先匯出。'),
          ],
        }}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void doForget()}
      />
    </>
  );
}
