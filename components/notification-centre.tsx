'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icon';
import { SearchWorkbench, emptySearchState, useSearchMatches, type SearchState } from './search-workbench';
import SuperConfirm from './super-confirm';
import { useLocalSetting } from '../lib/use-local-setting';
import {
  DISMISS_AFTER,
  HISTORY_STORAGE_KEY,
  SEVERITIES,
  countsBySeverity,
  dayOf,
  dismiss,
  dismissAll,
  expired,
  filterHistory,
  forget,
  notificationSample,
  parseHistory,
  politeness,
  serializeHistory,
  type Notification,
  type NotificationState,
  type Severity,
} from '../lib/notifications';
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

const SEVERITY_GLYPH: Record<Severity, string> = {
  info: 'sensors', success: 'check_circle', progress: 'schedule', warning: 'warning', error: 'warning',
};

const severityLabel = (severity: Severity, t: Translate) => ({
  info: t('Information', '資訊'),
  success: t('Success', '成功'),
  progress: t('In progress', '進行中'),
  warning: t('Warning', '警告'),
  error: t('Error', '錯誤'),
}[severity]);

export type NotificationCentreProps = {
  state: NotificationState;
  setState: (next: NotificationState | ((current: NotificationState) => NotificationState)) => void;
  t: Translate;
};

/**
 * The toast stack, and the centre that keeps what the stack let go.
 *
 * The stack is anchored in a corner and never blocks anything. Warnings and
 * errors stay until dismissed; the rest leave on their own timer. Nothing is
 * lost when it leaves: everything is in the centre, which is the whole reason
 * the centre exists.
 *
 * The centre is a list, so it is a list in the way every other list here has to
 * be: searchable with the planner's own matcher and its regex builder, filterable
 * by severity and day, multi-selectable, and bulk-actionable with a preview that
 * separates what is selected from what will change. Forgetting is irreversible
 * and goes through the two-key gate.
 */
export default function NotificationCentre({ state, setState, t }: NotificationCentreProps) {
  const stored = useLocalSetting(HISTORY_STORAGE_KEY);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState<SearchState>(emptySearchState);
  const [severities, setSeverities] = useState<Severity[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const [format, setFormat] = useState<ExportFormat>('json');
  const [confirming, setConfirming] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const restored = useRef(false);

  /* Restore once, and only into an empty history: a reload that lands while a
     notification is already live must not push the live one behind stored rows. */
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const history = parseHistory(stored.value);
    if (history.length) setState((current) => (current.history.length ? current : { ...current, history }));
  }, [stored.value, setState]);

  useEffect(() => {
    if (!restored.current) return;
    stored.setValue(serializeHistory(state.history));
  }, [state.history, stored]);

  /* Auto-dismiss, checked on a tick rather than one timer per notification: a
     timer per row leaks one for every notification that is dismissed by hand. */
  useEffect(() => {
    if (!state.live.some((item) => DISMISS_AFTER[item.severity] !== null)) return;
    const timer = window.setInterval(() => {
      setState((current) => {
        const going = expired(current);
        return going.length ? going.reduce((next, id) => dismiss(next, id), current) : current;
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [state.live, setState]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const samples = useMemo(() => state.history.map(notificationSample), [state.history]);
  const result = useSearchMatches(samples, search);
  const query = (search.mode === 'regex' ? search.pattern : search.query).trim();
  const matched = useMemo(
    () => filterHistory(state.history, { severities, from: from || undefined, to: to || undefined }, query ? result.matches : undefined),
    [state.history, severities, from, to, query, result.matches],
  );
  const counts = useMemo(() => countsBySeverity(state.history), [state.history]);
  const chosen = selectedCount(selection, matched.length);

  const preview = useMemo(
    () => previewBulk(selection, matched, matched.length, (row) => (state.live.some((item) => item.id === row.id) ? t('still on screen', '仲喺畫面度') : null)),
    [selection, matched, state.live, t],
  );

  const download = useCallback(() => {
    const rows = preview.affected.length ? preview.affected : matched;
    const records = rows.map((item) => ({
      id: item.id, severity: item.severity, title: item.title, body: item.body ?? null,
      at: new Date(item.at).toISOString(), day: dayOf(item.at),
      dismissedAt: item.dismissedAt ? new Date(item.dismissedAt).toISOString() : null,
    }));
    const note = t(
      `Notification history, ${records.length} of ${state.history.length} records, filtered as shown.`,
      `通知記錄，共 ${state.history.length} 條之中嘅 ${records.length} 條，已按畫面篩選。`,
    );
    const text = exportRecords(records, format, { name: 'notifications', note });
    const blob = new Blob([text], { type: EXPORT_MEDIA[format].type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = exportFilename('notification-history', format, dayOf(Date.now()));
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [preview.affected, matched, format, state.history.length, t]);

  const losses = useMemo(
    () => describeLoss(matched.map((item) => ({ id: item.id, actions: item.actions })), format),
    [matched, format],
  );

  const unread = state.history.filter((item) => !item.dismissedAt).length;

  return (
    <>
      {/* ------------------------------------------------------------- stack -- */}
      <div className="toast-stack" aria-label={t('Notifications', '通知')}>
        {state.live.map((item) => (
          <div key={item.id} className={`toast toast--${item.severity}`} role={item.severity === 'error' ? 'alert' : 'status'} aria-live={politeness(item.severity)}>
            <Icon name={SEVERITY_GLYPH[item.severity]} size={20} />
            <div className="toast__text">
              <strong>{item.title}</strong>
              {item.body && <span>{item.body}</span>}
              {item.actions && item.actions.length > 0 && (
                <div className="toast__actions">
                  {item.actions.map((action) => action.href
                    ? <a key={action.id} href={action.href}>{action.label}</a>
                    : <button key={action.id} type="button" onClick={() => setState((current) => dismiss(current, item.id))}>{action.label}</button>)}
                </div>
              )}
            </div>
            <button type="button" className="toast__close" aria-label={t('Dismiss', '關閉') + ': ' + item.title} onClick={() => setState((current) => dismiss(current, item.id))}>
              <Icon name="close" size={18} />
            </button>
          </div>
        ))}
        {state.live.length > 1 && (
          <button type="button" className="toast-stack__clear" onClick={() => setState(dismissAll)}>
            {t('Dismiss all', '全部關閉')}
          </button>
        )}
      </div>

      {/* ------------------------------------------------------------ opener -- */}
      <button
        ref={opener}
        type="button"
        className="notification-opener"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Icon name="history" size={20} />
        <span>{t('Notifications', '通知')}</span>
        {unread > 0 && <span className="notification-opener__count" aria-label={t(`${unread} not yet dismissed`, `${unread} 條未關閉`)}>{unread}</span>}
      </button>

      {/* ------------------------------------------------------------ centre -- */}
      <dialog
        ref={dialog}
        className="notification-centre"
        aria-label={t('Notification centre', '通知中心')}
        onClose={() => { setOpen(false); opener.current?.focus(); }}
        onCancel={() => setOpen(false)}
      >
        <div className="notification-centre__surface">
          <div className="notification-centre__head">
            <h2>{t('Notification centre', '通知中心')}</h2>
            <button type="button" className="notification-centre__close" aria-label={t('Close', '關閉')} onClick={() => setOpen(false)}>
              <Icon name="close" size={20} />
            </button>
          </div>

          <SearchWorkbench
            storageId="notification-centre-search"
            label={t('Search notifications', '搜尋通知')}
            value={search}
            onChange={setSearch}
            samples={samples}
            t={t}
          />

          <fieldset className="notification-centre__severities" aria-label={t('Filter by kind', '按類別篩選')}>
            {SEVERITIES.map((severity) => (
              <label key={severity} className={severities.includes(severity) ? 'is-on' : undefined}>
                <input
                  type="checkbox"
                  checked={severities.includes(severity)}
                  onChange={() => setSeverities((current) => current.includes(severity) ? current.filter((item) => item !== severity) : [...current, severity])}
                />
                <span>{severityLabel(severity, t)}</span>
                {/* A kind with none is shown as zero rather than hidden, so an empty
                    result is visibly empty rather than mysteriously so. */}
                <small>{counts[severity]}</small>
              </label>
            ))}
          </fieldset>

          <div className="notification-centre__dates">
            <label htmlFor="notification-from">{t('From', '由')}</label>
            <input id="notification-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            <label htmlFor="notification-to">{t('To', '至')}</label>
            <input id="notification-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            {(from || to) && (
              <button type="button" onClick={() => { setFrom(''); setTo(''); }}>{t('Clear dates', '清除日期')}</button>
            )}
          </div>

          <div className="notification-centre__bulk">
            <button type="button" onClick={() => setSelection(selectPage(matched.map((item) => item.id)))}>
              {t(`Select these ${matched.length}`, `選取呢 ${matched.length} 條`)}
            </button>
            <button type="button" onClick={() => setSelection(selectAllMatches())}>
              {t(`Select every match (${matched.length})`, `選取所有符合 (${matched.length})`)}
            </button>
            <button type="button" onClick={() => setSelection((current) => invert(current, matched.map((item) => item.id)))}>
              {t('Invert', '反選')}
            </button>
            <button type="button" onClick={() => setSelection(clearSelection())} disabled={chosen === 0}>
              {t('Clear selection', '清除選取')}
            </button>
          </div>

          <output className="notification-centre__status" aria-live="polite">
            {result.error
              ? t('This expression could not be evaluated. Edit it or choose plain text.', '未能配對此規則，請修改或選擇純文字。')
              : chosen === 0
                ? t(`${matched.length} of ${state.history.length} shown`, `顯示 ${state.history.length} 條之中嘅 ${matched.length} 條`)
                : preview.skipped.length === 0
                  ? t(`${chosen} selected, ${preview.affected.length} will change`, `已選 ${chosen} 條，會變更 ${preview.affected.length} 條`)
                  : t(
                      `${chosen} selected, ${preview.affected.length} will change, ${preview.skipped.length} skipped: ${skipSummary(preview).map((item) => `${item.count} ${item.reason}`).join(', ')}`,
                      `已選 ${chosen} 條，會變更 ${preview.affected.length} 條，略過 ${preview.skipped.length} 條：${skipSummary(preview).map((item) => `${item.count} 條${item.reason}`).join('、')}`,
                    )}
          </output>

          <div className="notification-centre__export">
            <label htmlFor="notification-format">{t('Export as', '匯出格式')}</label>
            <select id="notification-format" value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)}>
              {EXPORT_FORMATS.map((item) => <option key={item} value={item}>{EXPORT_MEDIA[item].label}</option>)}
            </select>
            <button type="button" onClick={download} disabled={matched.length === 0}>
              {chosen > 0 ? t(`Export ${preview.affected.length} selected`, `匯出已選 ${preview.affected.length} 條`) : t(`Export these ${matched.length}`, `匯出呢 ${matched.length} 條`)}
            </button>
            {/* Said before the file is written, which is the only moment it is useful. */}
            {losses.length > 0 && <p className="notification-centre__loss">{t('This format cannot carry everything: ', '呢個格式載唔晒：') + losses.join('; ')}</p>}
          </div>

          <ul className="notification-centre__list">
            {matched.length === 0 && (
              <li className="notification-centre__empty">
                {state.history.length === 0
                  ? t('Nothing has happened yet.', '暫時未有任何通知。')
                  : t('No notification matches these filters.', '冇通知符合呢啲條件。')}
              </li>
            )}
            {matched.map((item) => (
              <li key={item.id} className={`notification-row notification-row--${item.severity}`}>
                <label className="notification-row__select">
                  <input type="checkbox" checked={isSelected(selection, item.id)} onChange={() => setSelection((current) => toggle(current, item.id))} />
                  <span className="sr-only">{t('Select', '選取')} {item.title}</span>
                </label>
                <Icon name={SEVERITY_GLYPH[item.severity]} size={20} />
                <div className="notification-row__text">
                  <strong>{item.title}</strong>
                  {item.body && <small>{item.body}</small>}
                  <time dateTime={new Date(item.at).toISOString()}>
                    {new Date(item.at).toLocaleString('en-CA', { timeZone: 'America/Toronto', hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </time>
                </div>
                <span className="notification-row__kind">{severityLabel(item.severity, t)}</span>
              </li>
            ))}
          </ul>

          <div className="notification-centre__foot">
            <button type="button" onClick={() => setState(dismissAll)} disabled={state.live.length === 0}>
              {t('Dismiss everything on screen', '關閉畫面上所有通知')}
            </button>
            <button
              type="button"
              className="notification-centre__forget"
              disabled={preview.affected.length === 0}
              onClick={() => setConfirming(true)}
            >
              {t(`Forget ${preview.affected.length} permanently`, `永久刪除 ${preview.affected.length} 條`)}
            </button>
          </div>
        </div>
      </dialog>

      <SuperConfirm
        open={confirming}
        t={t}
        action={{
          title: t(`Forget ${preview.affected.length} notifications`, `永久刪除 ${preview.affected.length} 條通知`),
          detail: t(
            `${preview.affected.length} of the ${state.history.length} notifications in this browser will be removed from the centre.`,
            `呢個瀏覽器儲存嘅 ${state.history.length} 條通知之中，有 ${preview.affected.length} 條會喺通知中心移除。`,
          ),
          consequences: [
            t('They are stored only in this browser, so there is no copy anywhere else.', '佢哋只係存喺呢個瀏覽器，第二度冇副本。'),
            t('Export first if you want to keep a record.', '想留底就先匯出。'),
          ],
        }}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setState((current) => forget(current, preview.affected.map((item) => item.id)));
          setSelection(clearSelection());
          setConfirming(false);
        }}
      />
    </>
  );
}
