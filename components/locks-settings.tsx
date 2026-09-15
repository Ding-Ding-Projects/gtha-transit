'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Download, History, KeyRound, Lock, LockOpen, Ticket, Trash2 } from 'lucide-react';
import SuperConfirm from './super-confirm';
import { LockGate, revealLock } from './toy-lock';
import { SearchWorkbench, emptySearchState, useSearchMatches } from './search-workbench';
import { exportFilename, exportRecords } from '../lib/export';
import { LOCKABLE_SECTIONS, LOCK_RECOVERY, isLockedNow, policyLabel, redactLock, targetId, type LockRecord, type LockTarget } from '../lib/toy-locks';
import { OTP_ALGORITHMS, base32Decode, counterAt, secondsRemaining, totpAt, type OtpAlgorithm } from '../lib/totp';
import { addEntry, entryFromUri, entryName, exportEntryRows, makeEntry, moveEntry, removeEntries, updateEntry, type AuthenticatorEntry } from '../lib/authenticator';
import {
  TICKET_CATEGORIES,
  TICKET_DISCLOSURE,
  TICKET_SEVERITIES,
  addTicket,
  advanceTicket,
  cannedReply,
  createTicket,
  removeTickets,
  resolutionSteps,
  ticketRows,
  type TicketCategory,
  type TicketSeverity,
} from '../lib/support-tickets';
import { HISTORY_ACTIONS, historyRows, labelHistory, pruneHistory, verifyHistory, type HistoryAction } from '../lib/secret-history';
import { recordHistory, removeLock, replaceHistory, setEntries, setTickets, useToyLocks } from '../lib/use-toy-locks';
import type { DestructiveAction } from '../lib/super-confirm';

type Translate = (en: string, zh: string) => string;

function download(name: string, rows: Record<string, unknown>[], note: string) {
  const text = exportRecords(rows, 'json', { name, note });
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = exportFilename(name, 'json', new Date().toISOString().slice(0, 10));
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useNow(every = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(timer);
  }, [every]);
  return now;
}

type Pending = { action: DestructiveAction; run: () => void; origin: HTMLElement | null } | null;

function useConfirm(t: Translate) {
  const [pending, setPending] = useState<Pending>(null);
  const gate = pending && (
    <SuperConfirm open action={pending.action} origin={pending.origin} t={t}
      onConfirm={() => { pending.run(); setPending(null); }}
      onCancel={() => setPending(null)} />
  );
  return { ask: (action: DestructiveAction, run: () => void, origin: HTMLElement | null) => setPending({ action, run, origin }), gate };
}

const SECTION_LABELS: Record<(typeof LOCKABLE_SECTIONS)[number], [string, string]> = {
  appearance: ['Appearance settings', '外觀設定'],
  language: ['Language settings', '語言設定'],
  comfort: ['Comfort settings', '舒適設定'],
  narrator: ['Narrator settings', '旁白設定'],
};

export const sectionTarget = (section: (typeof LOCKABLE_SECTIONS)[number]): LockTarget =>
  ({ kind: 'settings-section', key: section, label: { en: SECTION_LABELS[section][0], zh: SECTION_LABELS[section][1] } });

/* ============================================================== locks == */

export function LocksCard({ t }: { t: Translate }) {
  const store = useToyLocks();
  const now = useNow(5000);
  const [search, setSearch] = useState(emptySearchState);
  const samples = useMemo(() => store.locks.map((lock) => `${t(lock.target.label.en, lock.target.label.zh)} ${policyLabel(lock.policy, t)}`), [store.locks, t]);
  const result = useSearchMatches(samples, search);
  const { ask, gate } = useConfirm(t);
  const [notice, setNotice] = useState('');

  const remove = (lock: LockRecord, origin: HTMLElement) => {
    const name = t(lock.target.label.en, lock.target.label.zh);
    ask({
      title: t(`Remove the lock on ${name}`, `移除「${name}」嘅鎖`),
      detail: t(`${name} will open without a ${policyLabel(lock.policy, t)}. Its PIN, password or authenticator key for this lock is forgotten.`, `「${name}」之後唔使${policyLabel(lock.policy, t)}都開到。呢把鎖嘅 PIN 碼、密碼或者驗證器金鑰會被刪除。`),
    }, () => setNotice(removeLock(lock.id) ? t(`The lock on ${name} was removed.`, `已移除「${name}」嘅鎖。`) : t('Unlock it first. A shut lock cannot be removed from here.', '請先解鎖。鎖住咗嘅鎖唔可以喺度移除。')), origin);
  };

  return (
    <section data-ui="settings.card" id="toy-locks" tabIndex={-1} className="preference-card locks-card" aria-labelledby="toy-locks-heading">
      <div className="preference-card-heading"><Lock size={23} aria-hidden="true" /><div><h3 id="toy-locks-heading">{t('Toy locks', '玩具鎖')}</h3><p>{t('Put a speed bump in front of a saved trip, a settings section or the appearance studio.', '喺已儲存行程、設定部分或者外觀工作室前面擺個減速壆。')}</p></div></div>
      <p className="locks-card__truth"><strong>{t('These locks are for fun.', '呢啲鎖係玩下嘅。')}</strong> {t(LOCK_RECOVERY.en, LOCK_RECOVERY.zh)}</p>
      {store.dropped > 0 && <output className="settings-notice">{t(`${store.dropped} stored locks were missing their PIN, password or key, so those surfaces are unlocked rather than unreachable.`, `有 ${store.dropped} 把已儲存嘅鎖唔見咗 PIN 碼、密碼或者金鑰，所以嗰啲地方而家冇鎖，唔會開唔到。`)}</output>}
      {store.storageFailed && <output className="settings-notice">{t('This browser refused to save a change. Locks set now last only until the planner is closed.', '呢個瀏覽器唔俾儲存改動。而家設定嘅鎖只會維持到關閉規劃工具為止。')}</output>}

      <h4>{t('Lock a settings section', '鎖住設定部分')}</h4>
      <p className="toy-lock__hint">{t('The Privacy section cannot be locked, because it holds this list and the way out.', '私隱部分唔可以鎖，因為呢個清單同出路都喺度。')}</p>
      <div className="locks-card__sections">
        {LOCKABLE_SECTIONS.map((section) => {
          const id = targetId(sectionTarget(section));
          const has = store.locks.some((lock) => targetId(lock.target) === id);
          return (
            <button key={section} type="button" className="toy-lock__action is-quiet" data-ui={`locks.section.${section}`} disabled={has}
              onClick={() => revealLock(sectionTarget(section))}>
              <Lock size={16} aria-hidden="true" />{has ? t(`${SECTION_LABELS[section][0]}: locked`, `${SECTION_LABELS[section][1]}：已有鎖`) : t(`Lock ${SECTION_LABELS[section][0]}…`, `鎖住${SECTION_LABELS[section][1]}…`)}
            </button>
          );
        })}
      </div>
      <p className="toy-lock__hint">{t('Each button opens the lock wizard at the top of that section, and every lock gets its own PIN, password or key.', '每個掣都會喺嗰個部分頂部打開鎖設定精靈，每把鎖都有自己嘅 PIN 碼、密碼或者金鑰。')}</p>

      <h4>{t('Your locks', '你嘅鎖')}</h4>
      {store.locks.length === 0 ? (
        <p className="toy-lock__hint">{t('No locks yet. Nothing in the planner is locked.', '未有鎖，規劃工具入面冇嘢鎖住。')}</p>
      ) : (
        <>
          <SearchWorkbench storageId="locks-list-search" label={t('Find a lock', '搵把鎖')} value={search} onChange={setSearch} samples={samples} t={t} />
          <ul className="locks-card__list">
            {store.locks.map((lock, index) => {
              if ((search.mode === 'regex' ? search.pattern : search.query).trim() && !result.matches[index]) return null;
              const shut = isLockedNow(lock, store.grants[lock.id], now);
              const name = t(lock.target.label.en, lock.target.label.zh);
              return (
                <li key={lock.id} data-ui="locks.row">
                  {shut ? <Lock size={18} aria-hidden="true" /> : <LockOpen size={18} aria-hidden="true" />}
                  <span><strong>{name}</strong><small>{policyLabel(lock.policy, t)} · {shut ? t('Locked', '已鎖') : t('Unlocked for now', '暫時已解鎖')}</small></span>
                  {shut ? (
                    <button type="button" className="toy-lock__action is-quiet" onClick={() => revealLock(lock.target)}>
                      {t('Unlock where it lives to remove it', '去佢所在位置解鎖先可以移除')}
                    </button>
                  ) : (
                    <button type="button" className="toy-lock__action is-quiet" data-ui="locks.remove" onClick={(event) => remove(lock, event.currentTarget)}><Trash2 size={16} aria-hidden="true" />{t('Remove…', '移除…')}</button>
                  )}
                </li>
              );
            })}
          </ul>
          <button type="button" className="toy-lock__action is-quiet" data-ui="locks.export" onClick={() => download('toy-locks', store.locks.map(redactLock), 'PIN and password hashes, salts and authenticator keys are omitted from this export.')}>
            <Download size={16} aria-hidden="true" />{t('Export the list (without any credential)', '匯出清單（唔包括任何密碼資料）')}
          </button>
        </>
      )}
      {notice && <output className="toy-lock__message" aria-live="polite">{notice}</output>}
      {gate}
    </section>
  );
}

/* ====================================================== authenticator == */

export function AuthenticatorCard({ t }: { t: Translate }) {
  const store = useToyLocks();
  const now = useNow(1000);
  const seconds = Math.floor(now / 1000);
  const [uri, setUri] = useState('');
  const [manual, setManual] = useState({ issuer: '', account: '', secret: '', algorithm: 'sha1' as OtpAlgorithm, digits: 6, period: 30 });
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState(emptySearchState);
  const [selected, setSelected] = useState<string[]>([]);
  const samples = useMemo(() => store.entries.map((entry) => `${entryName(entry)} ${entry.group}`), [store.entries]);
  const result = useSearchMatches(samples, search);
  const filtering = (search.mode === 'regex' ? search.pattern : search.query).trim().length > 0;
  const { ask, gate } = useConfirm(t);

  const add = (made: ReturnType<typeof makeEntry>) => {
    if ('problem' in made) {
      setNotice({
        secret: t('That key is not a valid base32 authenticator key.', '呢條唔係有效嘅 base32 驗證器金鑰。'),
        parameters: t('The algorithm, digits or period is not one this authenticator supports.', '演算法、位數或者週期唔支援。'),
        account: t('Give it an issuer or an account name so you can tell it apart.', '請填發行者或者帳戶名，方便分辨。'),
      }[made.problem]);
      return;
    }
    const ok = setEntries(addEntry(store.entries, made.entry), { action: 'totp-added', subject: entryName(made.entry), fields: ['issuer', 'account', 'algorithm', 'digits', 'period'] });
    setNotice(ok ? t(`Added ${entryName(made.entry)}.`, `已加入 ${entryName(made.entry)}。`) : t('The history could not record this, so nothing was added.', '歷史紀錄記錄唔到，所以冇加入任何嘢。'));
    if (ok) { setUri(''); setManual({ ...manual, issuer: '', account: '', secret: '' }); }
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setNotice(t('Code copied.', '已複製驗證碼。')); }
    catch { setNotice(t('Copy is not available here. Select the digits and copy them yourself.', '呢度用唔到複製，請自己揀選數字再複製。')); }
  };

  const removeSelected = (origin: HTMLElement) => {
    const names = store.entries.filter((entry) => selected.includes(entry.id)).map(entryName);
    ask({
      title: t(`Remove ${names.length} authenticator entries`, `移除 ${names.length} 個驗證器項目`),
      detail: names.join(', '),
      consequences: [t('Their keys are deleted from this browser and cannot be shown again.', '佢哋嘅金鑰會喺呢個瀏覽器刪除，之後唔可以再顯示。')],
    }, () => {
      const ok = setEntries(removeEntries(store.entries, selected), { action: 'totp-removed', subject: names.join(', ').slice(0, 150), fields: ['entry'] });
      if (ok) setSelected([]);
      setNotice(ok ? t(`Removed ${names.length}.`, `已移除 ${names.length} 個。`) : t('The history could not record this, so nothing was removed.', '歷史紀錄記錄唔到，所以冇移除任何嘢。'));
    }, origin);
  };

  return (
    <section data-ui="settings.card" id="authenticator" tabIndex={-1} className="preference-card authenticator-card" aria-labelledby="authenticator-heading">
      <div className="preference-card-heading"><KeyRound size={23} aria-hidden="true" /><div><h3 id="authenticator-heading">{t('Authenticator', '驗證器')}</h3><p>{t('Keep time-based codes for any account, generated here without any network.', '為任何帳戶保存按時間轉嘅驗證碼，喺度產生，唔使上網。')}</p></div></div>
      <p className="locks-card__truth">{t('Keys are kept in this browser\'s own storage, which anybody using this browser can read. Codes come from this device\'s clock: if a code is refused, check the clock first.', '金鑰存喺呢個瀏覽器自己嘅儲存空間，用呢個瀏覽器嘅人都睇得到。驗證碼跟呢部裝置嘅時鐘計：如果驗證碼唔被接受，請先檢查時鐘。')}</p>
      <p className="toy-lock__hint">{t(`This device's clock reads ${new Date(now).toISOString().slice(11, 19)} UTC. The planner has no other clock to compare it with.`, `呢部裝置嘅時鐘係 UTC ${new Date(now).toISOString().slice(11, 19)}。規劃工具冇第二個時鐘可以比較。`)}</p>

      <details className="authenticator-card__add">
        <summary>{t('Add an entry', '加入項目')}</summary>
        <form onSubmit={(event) => { event.preventDefault(); add(entryFromUri(uri)); }}>
          <label htmlFor="authenticator-uri">{t('Paste an otpauth:// link', '貼上 otpauth:// 連結')}</label>
          <input id="authenticator-uri" data-ui="authenticator.uri" type="password" autoComplete="off" value={uri} onChange={(event) => setUri(event.target.value)} />
          <button type="submit" className="toy-lock__action" disabled={!uri}>{t('Add from link', '用連結加入')}</button>
        </form>
        <form onSubmit={(event) => { event.preventDefault(); add(makeEntry(manual)); }}>
          <label htmlFor="authenticator-issuer">{t('Issuer', '發行者')}</label>
          <input id="authenticator-issuer" value={manual.issuer} maxLength={80} onChange={(event) => setManual({ ...manual, issuer: event.target.value })} />
          <label htmlFor="authenticator-account">{t('Account', '帳戶')}</label>
          <input id="authenticator-account" value={manual.account} maxLength={120} onChange={(event) => setManual({ ...manual, account: event.target.value })} />
          <label htmlFor="authenticator-secret">{t('Key (base32)', '金鑰（base32）')}</label>
          <input id="authenticator-secret" data-ui="authenticator.secret" type="password" autoComplete="off" value={manual.secret} onChange={(event) => setManual({ ...manual, secret: event.target.value })} />
          <label htmlFor="authenticator-algorithm">{t('Algorithm', '演算法')}</label>
          <select id="authenticator-algorithm" value={manual.algorithm} onChange={(event) => setManual({ ...manual, algorithm: event.target.value as OtpAlgorithm })}>
            {OTP_ALGORITHMS.map((algorithm) => <option key={algorithm} value={algorithm}>{algorithm.toUpperCase()}</option>)}
          </select>
          <label htmlFor="authenticator-digits">{t('Digits', '位數')}</label>
          <select id="authenticator-digits" value={manual.digits} onChange={(event) => setManual({ ...manual, digits: Number(event.target.value) })}>
            {[6, 7, 8].map((digits) => <option key={digits} value={digits}>{digits}</option>)}
          </select>
          <label htmlFor="authenticator-period">{t('Period in seconds', '週期（秒）')}</label>
          <input id="authenticator-period" type="number" min={1} max={300} value={manual.period} onChange={(event) => setManual({ ...manual, period: Math.round(Number(event.target.value)) })} />
          <button type="submit" className="toy-lock__action" disabled={!manual.secret}>{t('Add by hand', '手動加入')}</button>
        </form>
        <p className="toy-lock__hint">{t('Reading a QR code from a picture or a camera is not available: the planner includes no QR reader, and it will not send a picture of your key anywhere to be read.', '暫時唔可以由相片或者相機讀 QR code：規劃工具冇 QR 讀取器，亦唔會將你金鑰嘅相傳去任何地方讀。')}</p>
      </details>

      {store.entries.length === 0 ? (
        <p className="toy-lock__hint">{t('No entries yet.', '未有項目。')}</p>
      ) : (
        <>
          <SearchWorkbench storageId="authenticator-search" label={t('Find an entry', '搵項目')} value={search} onChange={setSearch} samples={samples} t={t} />
          <ul className="authenticator-card__list">
            {store.entries.map((entry, index) => {
              if (filtering && !result.matches[index]) return null;
              const key = base32Decode(entry.secret);
              if (!key) return null;
              const params = { algorithm: entry.algorithm, digits: entry.digits, period: entry.period };
              const code = totpAt(key, seconds, params);
              const next = totpAt(key, seconds + entry.period, params);
              const left = secondsRemaining(seconds, entry.period);
              const grouped = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : `${code.slice(0, 4)} ${code.slice(4)}`;
              return (
                <li key={entry.id} data-ui="authenticator.row">
                  <label className="toy-lock__check"><input type="checkbox" checked={selected.includes(entry.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, entry.id] : current.filter((id) => id !== entry.id))} /><span className="sr-only">{t(`Select ${entryName(entry)}`, `揀選 ${entryName(entry)}`)}</span></label>
                  <span className="authenticator-card__name"><strong>{entryName(entry)}</strong>{entry.group && <small>{entry.group}</small>}</span>
                  {/* Announced when the code changes, not every second. */}
                  <output className="authenticator-card__code" aria-live="polite" key={counterAt(seconds, entry.period)} data-ui="authenticator.code">{grouped}</output>
                  <small className="authenticator-card__time">{t(`${left} s left · next ${next}`, `仲有 ${left} 秒 · 下一個 ${next}`)}</small>
                  <span className="authenticator-card__tools">
                    <button type="button" aria-label={t(`Copy the code for ${entryName(entry)}`, `複製 ${entryName(entry)} 嘅驗證碼`)} onClick={() => void copy(code)}><Copy size={16} aria-hidden="true" /></button>
                    <button type="button" aria-label={t(`Move ${entryName(entry)} up`, `將 ${entryName(entry)} 移上`)} disabled={index === 0} onClick={() => setEntries(moveEntry(store.entries, entry.id, -1), null)}><ArrowUp size={16} aria-hidden="true" /></button>
                    <button type="button" aria-label={t(`Move ${entryName(entry)} down`, `將 ${entryName(entry)} 移落`)} disabled={index === store.entries.length - 1} onClick={() => setEntries(moveEntry(store.entries, entry.id, 1), null)}><ArrowDown size={16} aria-hidden="true" /></button>
                  </span>
                  <details className="authenticator-card__edit">
                    <summary>{t('Rename or group', '改名或者分組')}</summary>
                    <EntryEditor entry={entry} t={t} onSave={(patch) => {
                      const changed = updateEntry(store.entries, entry.id, patch);
                      if (changed.fields.length === 0) return;
                      setNotice(setEntries(changed.entries, { action: 'totp-changed', subject: entryName(entry), fields: changed.fields }) ? t('Saved.', '已儲存。') : t('The history could not record this, so nothing was changed.', '歷史紀錄記錄唔到，所以冇改動。'));
                    }} />
                  </details>
                </li>
              );
            })}
          </ul>
          <div className="toy-lock__buttons">
            <button type="button" className="toy-lock__action is-quiet" disabled={selected.length === 0} data-ui="authenticator.remove" onClick={(event) => removeSelected(event.currentTarget)}><Trash2 size={16} aria-hidden="true" />{t(`Remove selected (${selected.length})…`, `移除已揀選（${selected.length}）…`)}</button>
            <button type="button" className="toy-lock__action is-quiet" data-ui="authenticator.export" onClick={() => download('authenticator-entries', exportEntryRows(store.entries), 'Authenticator keys are omitted from this export.')}><Download size={16} aria-hidden="true" />{t('Export (keys left out)', '匯出（唔包括金鑰）')}</button>
          </div>
          <p className="toy-lock__hint">{t('The export lists every entry and states on each row that its key was left out. There is no export that includes keys.', '匯出會列出每個項目，並喺每行註明冇包括金鑰。冇任何匯出會包括金鑰。')}</p>
        </>
      )}
      {notice && <output className="toy-lock__message" aria-live="polite">{notice}</output>}
      {gate}
    </section>
  );
}

function EntryEditor({ entry, t, onSave }: { entry: AuthenticatorEntry; t: Translate; onSave: (patch: { issuer: string; account: string; group: string }) => void }) {
  const [draft, setDraft] = useState({ issuer: entry.issuer, account: entry.account, group: entry.group });
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
      <label>{t('Issuer', '發行者')}<input value={draft.issuer} maxLength={80} onChange={(event) => setDraft({ ...draft, issuer: event.target.value })} /></label>
      <label>{t('Account', '帳戶')}<input value={draft.account} maxLength={120} onChange={(event) => setDraft({ ...draft, account: event.target.value })} /></label>
      <label>{t('Group', '分組')}<input value={draft.group} maxLength={40} onChange={(event) => setDraft({ ...draft, group: event.target.value })} /></label>
      <button type="submit" className="toy-lock__action">{t('Save', '儲存')}</button>
    </form>
  );
}

/* ===================================================== support tickets == */

export function SupportTicketsCard({ t }: { t: Translate }) {
  const store = useToyLocks();
  const [category, setCategory] = useState<TicketCategory>('forgot-password');
  const [severity, setSeverity] = useState<TicketSeverity>('catastrophic');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState(emptySearchState);
  const [origin, setOrigin] = useState('');
  const [notice, setNotice] = useState('');
  const samples = useMemo(() => store.tickets.map((ticket) => `${ticket.number} ${ticket.category} ${ticket.status} ${ticket.description}`), [store.tickets]);
  const result = useSearchMatches(samples, search);
  const filtering = (search.mode === 'regex' ? search.pattern : search.query).trim().length > 0;
  const { ask, gate } = useConfirm(t);
  useEffect(() => { setOrigin(window.location.origin); }, []);

  const categoryText: Record<TicketCategory, string> = {
    'forgot-pin': t('Forgotten PIN', '唔記得 PIN 碼'),
    'forgot-password': t('Forgotten password', '唔記得密碼'),
    'lost-authenticator': t('Lost authenticator', '唔見咗驗證器'),
    'locked-out': t('Locked out and waiting', '俾人鎖咗喺出面等緊'),
    other: t('Something else', '其他'),
  };
  const severityText: Record<TicketSeverity, string> = {
    low: t('Low', '低'), medium: t('Medium', '中'), high: t('High', '高'), catastrophic: t('Catastrophic', '天崩地裂'),
  };
  const statusText = { received: t('Received', '已收到'), triaged: t('Triaged', '已分流'), escalated: t('Escalated to the folder', '已上報到資料夾'), resolved: t('Resolved', '已解決') };

  const copyOrigin = async () => {
    try { await navigator.clipboard.writeText(origin); setNotice(t('Site address copied.', '已複製網站地址。')); }
    catch { setNotice(t('Copy is not available here. Select the address and copy it yourself.', '呢度用唔到複製，請自己揀選地址再複製。')); }
  };

  return (
    <section data-ui="settings.card" id="support-tickets" tabIndex={-1} className="preference-card tickets-card" aria-labelledby="support-tickets-heading">
      <div className="preference-card-heading"><Ticket size={23} aria-hidden="true" /><div><h3 id="support-tickets-heading">{t('Support Tickets', '服務單')}</h3><p>{t('Forgotten a lock? The desk is standing by, in a manner of speaking.', '唔記得把鎖？服務台隨時候命，講到尾都算係。')}</p></div></div>
      <p className="tickets-card__disclosure" data-ui="tickets.disclosure">{t(TICKET_DISCLOSURE.en, TICKET_DISCLOSURE.zh)}</p>

      <form className="tickets-card__form" onSubmit={(event) => {
        event.preventDefault();
        setTickets(addTicket(store.tickets, createTicket({ category, severity, description })));
        setDescription('');
        setNotice(t('Ticket received. A reply is below, because it was written in advance.', '已收到服務單。回覆喺下面，因為一早寫好咗。'));
      }}>
        <label htmlFor="ticket-category">{t('Category', '類別')}</label>
        <select id="ticket-category" data-ui="tickets.category" value={category} onChange={(event) => setCategory(event.target.value as TicketCategory)}>
          {TICKET_CATEGORIES.map((value) => <option key={value} value={value}>{categoryText[value]}</option>)}
        </select>
        <label htmlFor="ticket-severity">{t('Severity (it will not be honoured)', '嚴重程度（唔會理）')}</label>
        <select id="ticket-severity" data-ui="tickets.severity" value={severity} onChange={(event) => setSeverity(event.target.value as TicketSeverity)}>
          {TICKET_SEVERITIES.map((value) => <option key={value} value={value}>{severityText[value]}</option>)}
        </select>
        <label htmlFor="ticket-description">{t('What happened', '發生咩事')}</label>
        <textarea id="ticket-description" data-ui="tickets.description" maxLength={1000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
        <button type="submit" className="toy-lock__action" data-ui="tickets.submit">{t('Open ticket', '開單')}</button>
      </form>

      {store.tickets.length > 0 && (
        <>
          <SearchWorkbench storageId="support-tickets-search" label={t('Find a ticket', '搵服務單')} value={search} onChange={setSearch} samples={samples} t={t} />
          <ul className="tickets-card__list">
            {store.tickets.map((ticket, index) => {
              if (filtering && !result.matches[index]) return null;
              return (
                <li key={ticket.number} data-ui="tickets.row">
                  <div className="tickets-card__head">
                    <label className="toy-lock__check"><input type="checkbox" checked={selected.includes(ticket.number)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, ticket.number] : current.filter((number) => number !== ticket.number))} /><span className="sr-only">{t(`Select ${ticket.number}`, `揀選 ${ticket.number}`)}</span></label>
                    <strong>{ticket.number}</strong>
                    <span>{categoryText[ticket.category]} · {severityText[ticket.severity]} · {statusText[ticket.status]}</span>
                  </div>
                  {ticket.description && <p className="tickets-card__description">{ticket.description}</p>}
                  <p className="tickets-card__reply">{cannedReply(ticket, t)}</p>
                  {ticket.status === 'resolved' ? (
                    <div className="tickets-card__resolution">
                      <p><strong>{t('Resolution', '解決方法')}</strong></p>
                      <ol>{resolutionSteps(origin, t).map((step) => <li key={step}>{step}</li>)}</ol>
                      <p className="toy-lock__hint">{t('A web page cannot open your browser\'s settings or clear its own data, so these are steps for you to take. The planner deletes nothing for you.', '網頁打唔開你瀏覽器嘅設定，亦清唔到自己嘅資料，所以呢啲步驟要你自己做。規劃工具唔會幫你刪除任何嘢。')}</p>
                      <button type="button" className="toy-lock__action is-quiet" onClick={() => void copyOrigin()}><Copy size={16} aria-hidden="true" />{t('Copy the site address', '複製網站地址')}</button>
                    </div>
                  ) : (
                    <button type="button" className="toy-lock__action is-quiet" data-ui="tickets.advance" onClick={() => setTickets(store.tickets.map((item) => item.number === ticket.number ? advanceTicket(item) : item))}>{t('Chase this ticket', '催一催張單')}</button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="toy-lock__buttons">
            <button type="button" className="toy-lock__action is-quiet" disabled={selected.length === 0} data-ui="tickets.delete" onClick={(event) => ask({
              title: t(`Delete ${selected.length} tickets`, `刪除 ${selected.length} 張服務單`),
              detail: selected.join(', '),
            }, () => { setTickets(removeTickets(store.tickets, selected)); setSelected([]); }, event.currentTarget)}><Trash2 size={16} aria-hidden="true" />{t(`Delete selected (${selected.length})…`, `刪除已揀選（${selected.length}）…`)}</button>
            <button type="button" className="toy-lock__action is-quiet" data-ui="tickets.export" onClick={() => download('support-tickets', ticketRows(store.tickets), 'Local tickets. Nothing was ever sent anywhere.')}><Download size={16} aria-hidden="true" />{t('Export tickets', '匯出服務單')}</button>
          </div>
        </>
      )}
      {notice && <output className="toy-lock__message" aria-live="polite">{notice}</output>}
      {gate}
    </section>
  );
}

/* ============================================================= history == */

export const HISTORY_TARGET: LockTarget = { kind: 'history', key: 'secret-history', label: { en: 'Change history', zh: '改動紀錄' } };

export function HistoryCard({ t, onRestoreName }: { t: Translate; onRestoreName: (name: string | null) => void }) {
  return (
    <section data-ui="settings.card" id="secret-history" tabIndex={-1} className="preference-card history-card" aria-labelledby="secret-history-heading">
      <div className="preference-card-heading"><History size={23} aria-hidden="true" /><div><h3 id="secret-history-heading">{t('Change history', '改動紀錄')}</h3><p>{t('Every change to authenticator entries, the display name and locks, in order, with nothing secret in it.', '驗證器項目、顯示名稱同鎖嘅每次改動，按次序記低，入面冇任何秘密資料。')}</p></div></div>
      <LockGate target={HISTORY_TARGET} t={t} requireLock>
        <HistoryManager t={t} onRestoreName={onRestoreName} />
      </LockGate>
    </section>
  );
}

function HistoryManager({ t, onRestoreName }: { t: Translate; onRestoreName: (name: string | null) => void }) {
  const store = useToyLocks();
  const [action, setAction] = useState<HistoryAction | ''>('');
  const [since, setSince] = useState('');
  const [keep, setKeep] = useState(200);
  const [labelFor, setLabelFor] = useState<number | null>(null);
  const [labelText, setLabelText] = useState('');
  const [search, setSearch] = useState(emptySearchState);
  const [notice, setNotice] = useState('');
  const { ask, gate } = useConfirm(t);
  const chain = useMemo(() => verifyHistory(store.history), [store.history]);
  const newestFirst = useMemo(() => [...store.history].reverse(), [store.history]);
  const samples = useMemo(() => newestFirst.map((record) => `${record.action} ${record.subject} ${record.fields.join(' ')} ${record.detail}`), [newestFirst]);
  const result = useSearchMatches(samples, search);
  const filtering = (search.mode === 'regex' ? search.pattern : search.query).trim().length > 0;
  const sinceAt = since ? Date.parse(`${since}T00:00:00`) : NaN;
  const pruneOrigin = useRef<HTMLButtonElement>(null);

  return (
    <div className="history-card__manager">
      <p className={chain.intact ? 'toy-lock__hint' : 'settings-notice'}>
        {chain.intact
          ? t(`${store.history.length} records. Each one carries a fingerprint of the one before, and the chain checks out.`, `共 ${store.history.length} 條紀錄。每條都帶住上一條嘅指紋，成條鏈核對無誤。`)
          : t(`The chain is broken at record ${chain.brokenAt}: something edited this history outside the planner.`, `條鏈喺第 ${chain.brokenAt} 條斷咗：有嘢喺規劃工具以外改過呢份紀錄。`)}
      </p>
      {store.historyFailed && <output className="settings-notice">{t('The last change could not be written to the history, so it was not made.', '上一個改動寫唔入紀錄，所以冇改到。')}</output>}
      <SearchWorkbench storageId="secret-history-search" label={t('Find in the history', '搜尋紀錄')} value={search} onChange={setSearch} samples={samples} t={t} />
      <div className="history-card__filters">
        <label>{t('Action', '動作')}
          <select value={action} onChange={(event) => setAction(event.target.value as HistoryAction | '')}>
            <option value="">{t('All actions', '所有動作')}</option>
            {HISTORY_ACTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>{t('From date', '由日期')}<input type="date" value={since} onChange={(event) => setSince(event.target.value)} /></label>
      </div>
      <ol className="history-card__list">
        {newestFirst.map((record, index) => {
          if (filtering && !result.matches[index]) return null;
          if (action && record.action !== action) return null;
          if (Number.isFinite(sinceAt) && record.at < sinceAt) return null;
          return (
            <li key={record.seq} data-ui="history.row">
              <strong>{`#${record.seq} ${record.action}`}</strong>
              <span>{record.subject}</span>
              <small>{new Date(record.at).toLocaleString()}{record.fields.length ? ` · ${t('changed', '改咗')}: ${record.fields.join(', ')}` : ''}{record.detail ? ` · ${record.detail}` : ''}</small>
              <span className="toy-lock__buttons">
                {(record.action === 'display-name-changed' || record.action === 'display-name-reset') && (
                  <button type="button" className="toy-lock__action is-quiet" onClick={() => {
                    const name = record.action === 'display-name-reset' ? null : record.detail;
                    onRestoreName(name);
                    recordHistory({ action: 'restored', subject: 'display name', detail: `from record ${record.seq}` });
                    setNotice(t('Display name restored.', '已還原顯示名稱。'));
                  }}>{t('Restore this name', '還原呢個名')}</button>
                )}
                <button type="button" className="toy-lock__action is-quiet" onClick={() => { setLabelFor(record.seq); setLabelText(''); }}>{t('Label', '加標籤')}</button>
              </span>
              {labelFor === record.seq && (
                <form className="history-card__label" onSubmit={(event) => { event.preventDefault(); if (labelText.trim() && replaceHistory(labelHistory(store.history, record.seq, labelText))) setLabelFor(null); }}>
                  <label>{t('Label', '標籤')}<input value={labelText} maxLength={80} onChange={(event) => setLabelText(event.target.value)} /></label>
                  <button type="submit" className="toy-lock__action">{t('Add label', '加標籤')}</button>
                </form>
              )}
            </li>
          );
        })}
      </ol>
      <div className="history-card__filters">
        <label>{t('Keep the newest', '保留最新')}
          <select value={keep} onChange={(event) => setKeep(Number(event.target.value))}>
            {[50, 200, 500].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <button ref={pruneOrigin} type="button" className="toy-lock__action is-quiet" disabled={store.history.length <= keep} onClick={() => ask({
          title: t(`Prune the history to the newest ${keep} records`, `將紀錄刪剩最新 ${keep} 條`),
          detail: t(`${store.history.length - keep} older records will be deleted.`, `會刪除 ${store.history.length - keep} 條較舊嘅紀錄。`),
        }, () => { replaceHistory(pruneHistory(store.history, keep)); }, pruneOrigin.current)}>{t('Prune…', '刪減…')}</button>
        <button type="button" className="toy-lock__action is-quiet" data-ui="history.export" onClick={() => download('change-history', historyRows(store.history), 'No secret, PIN, password, code or authenticator key is ever recorded.')}><Download size={16} aria-hidden="true" />{t('Export history', '匯出紀錄')}</button>
      </div>
      {notice && <output className="toy-lock__message" aria-live="polite">{notice}</output>}
      {gate}
    </div>
  );
}
