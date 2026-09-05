'use client';
import { useEffect, useState } from 'react';
import {
  CalendarDays,
  ChevronDown,
  Download,
  RefreshCw,
  Search,
} from 'lucide-react';
type Row = {
  id: string;
  title?: string;
  description?: string;
  firstSeen: string;
  lastSeen: string;
  status: string;
  lines?: string[];
  versions?: unknown[];
  alert?: { title: string; description: string };
};
export default function DisruptionHistory({
  t,
}: {
  t: (a: string, b: string) => string;
}) {
  const [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [line, setLine] = useState(''),
    [q, setQ] = useState(''),
    [rows, setRows] = useState<Row[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0);
  const params = () => {
    const p = new URLSearchParams({ limit: '50' });
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (line) p.set('line', line);
    if (q) p.set('q', q);
    return p;
  };
  useEffect(() => {
    const c = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      setError('');
      fetch('/api/history?' + params(), { signal: c.signal })
        .then(async (r) => {
          if (!r.ok)
            throw Error(
              t('History is temporarily unavailable.', '暫時無法讀取歷史。'),
            );
          return r.json() as Promise<{
            records?: Row[];
            items?: Row[];
            nextCursor?: string;
          }>;
        })
        .then((d) => {
          setRows(d.records || d.items || []);
          setCursor(d.nextCursor || null);
        })
        .catch((e) => {
          if (!c.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!c.signal.aborted) setBusy(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [from, to, line, q, refresh, t]);
  async function more() {
    if (!cursor) return;
    setBusy(true);
    try {
      const p = params();
      p.set('cursor', cursor);
      const r = await fetch('/api/history?' + p, {
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw Error();
      const d = (await r.json()) as {
        records?: Row[];
        items?: Row[];
        nextCursor?: string;
      };
      setRows((prev) => [...prev, ...(d.records || d.items || [])]);
      setCursor(d.nextCursor || null);
    } catch {
      setError(t('Could not load more records.', '未能載入更多記錄。'));
    } finally {
      setBusy(false);
    }
  }
  const stamp = (s: string) =>
    new Date(s).toLocaleString('en-CA', {
      timeZone: 'America/Toronto',
      timeZoneName: 'short',
    });
  return (
    <div className="page-panel">
      <span className="eyebrow">
        {t('A RECORD OF WHAT WAS REPORTED', '記錄曾經通報嘅狀況')}
      </span>
      <h2>{t('Disruption history', '服務事故歷史')}</h2>
      <p>
        {t(
          'Observed TTC alerts are retained indefinitely. History begins when collection starts, not before. All dates use Toronto time.',
          '已觀察到嘅 TTC 提示會永久保留，歷史由收集開始時計起，日期以多倫多時間顯示。',
        )}
      </p>
      <div className="history-filters">
        <label>
          <CalendarDays size={16} />
          {t('From date', '開始日期')}
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          <CalendarDays size={16} />
          {t('Through date', '結束日期')}
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label>
          {t('Line', '路線')}
          <select value={line} onChange={(e) => setLine(e.target.value)}>
            <option value="">{t('All lines', '全部路線')}</option>
            {['1', '2', '4', '5', '6'].map((n) => (
              <option key={n} value={n}>
                {t('Line', '路線')} {n}
              </option>
            ))}
          </select>
        </label>
        <label className="history-query">
          <Search size={16} />
          {t('Search recorded alerts', '搜尋已記錄提示')}
          <input
            type="search"
            value={q}
            maxLength={200}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t(
              'Station, disruption, or description',
              '車站、事故或描述',
            )}
          />
        </label>
      </div>
      <div className="results-toolbar">
        <button
          className="pill"
          onClick={() => {
            const d = new Intl.DateTimeFormat('en-CA', {
              timeZone: 'America/Toronto',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(new Date());
            setFrom(d);
            setTo(d);
          }}
        >
          {t('Today', '今日')}
        </button>
        <button
          className="pill"
          onClick={() => {
            setFrom('');
            setTo('');
            setLine('');
            setQ('');
          }}
        >
          {t('All dates', '所有日期')}
        </button>
        <button
          className="pill"
          onClick={() => setRefresh((x) => x + 1)}
          disabled={busy}
        >
          <RefreshCw size={15} />
          {t('Refresh', '重新整理')}
        </button>
        <a className="pill" href={'/api/history/export?' + params()}>
          <Download size={15} />
          {t('Export matching history', '匯出符合條件嘅歷史')}
        </a>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {busy && !rows.length && (
        <p role="status">
          {t('Loading recorded alerts…', '載入已記錄提示中…')}
        </p>
      )}
      {!busy && !error && !rows.length && (
        <div className="empty">
          <CalendarDays />
          <h3>
            {t(
              'No recorded alerts match these filters',
              '無符合篩選條件嘅記錄',
            )}
          </h3>
          <p>
            {t(
              'Records appear as the collector observes official alerts. An empty history is not proof that no disruption occurred.',
              '收集器觀察到官方提示後會加入記錄。空白歷史唔代表從來無事故。',
            )}
          </p>
        </div>
      )}
      {rows.map((row) => (
        <details className="history-record" key={row.id}>
          <summary>
            <div>
              <strong>
                {row.title ||
                  row.alert?.title ||
                  t('TTC service alert', 'TTC 服務提示')}
              </strong>
              <span>
                {row.status === 'active'
                  ? t('Still reported at last check', '上次檢查仍有通報')
                  : t('No longer reported', '已不再通報')}
              </span>
            </div>
            <ChevronDown size={18} />
          </summary>
          <div>
            <p>{row.description || row.alert?.description}</p>
            <dl>
              <dt>{t('First observed', '首次觀察')}</dt>
              <dd>{stamp(row.firstSeen)}</dd>
              <dt>{t('Last observed', '最後觀察')}</dt>
              <dd>{stamp(row.lastSeen)}</dd>
            </dl>
            <small>
              {t(
                'Disappearance from the source is not a confirmed resolution.',
                '來源不再顯示提示，唔等於已確認解決。',
              )}
            </small>
          </div>
        </details>
      ))}
      {cursor && (
        <button className="pill" onClick={() => void more()} disabled={busy}>
          {t('Load more history', '載入更多歷史')}
        </button>
      )}
    </div>
  );
}
