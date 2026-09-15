'use client';

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BookOpen, Download, ExternalLink, History, RotateCcw } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { SearchWorkbench, emptySearchState, useSearchMatches } from './search-workbench';
import { useLocalSetting } from '../lib/use-local-setting';
import {
  CHANGELOG_CATEGORIES,
  exportEntries,
  filterEntries,
  type ChangelogCategory,
  type ChangelogEntry,
  type ChangelogExportFormat,
} from '../lib/changelog';
import { inlineText, parseInline, parseMarkdown, resolveDocLink, type Block, type Inline } from '../lib/doc-markdown';

type Translate = (en: string, zh: string) => string;

export const ABOUT_TAB_KEY = 'gtha.about.tab.v1';
export const ABOUT_ARTICLE_KEY = 'gtha.about.article.v1';
const ABOUT_TABS = ['changes', 'guides'] as const;

type ChangelogFile = { schemaVersion: 1; version: string; unreleased: boolean; generatedAt: string; validated: string; entries: ChangelogEntry[] };
type ArticleRow = { path: string; category: string; title: string; bytes: number; sha256: string };
type DocsIndex = { schemaVersion: 1; articles: ArticleRow[] };
type Load<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'failed'; message: string };

export function categoryLabel(t: Translate, category: string): string {
  const labels: Record<string, [string, string]> = {
    interface: ['Interface', '介面'], planning: ['Planning', '路線規劃'], vehicles: ['Vehicles', '車輛'],
    status: ['Live status', '即時狀況'], data: ['Data', '資料'], deployment: ['Deployment', '部署'],
    evidence: ['Evidence', '證據'], docs: ['Documentation', '文件'], race: ['Race', '比賽'],
    accessibility: ['Accessibility', '無障礙'], design: ['Design', '設計'], release: ['Release', '發佈'],
    unknown: ['Uncategorised', '未分類'], overview: ['Overview', '總覽'], history: ['History', '歷史'],
    maps: ['Maps', '地圖'], realtime: ['Realtime feeds', '即時資料源'], search: ['Search', '搜尋'],
    verification: ['Verification', '驗證'],
  };
  const pair = labels[category];
  return pair ? t(pair[0], pair[1]) : category;
}

function useJson<T>(url: string): Load<T> {
  const [load, setLoad] = useState<Load<T>>({ state: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal, cache: 'no-cache' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setLoad({ state: 'ready', data: (await response.json()) as T });
      })
      .catch((error: Error) => { if (!controller.signal.aborted) setLoad({ state: 'failed', message: error.message }); });
    return () => controller.abort();
  }, [url]);
  return load;
}

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/* ------------------------------------------------------------- changes -- */

function ChangelogPanel({ t }: { t: Translate }) {
  const load = useJson<ChangelogFile>('/changelog.json');
  const [search, setSearch] = useState(emptySearchState);
  const [categories, setCategories] = useState<ChangelogCategory[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const entries = load.state === 'ready' ? load.data.entries : [];
  const samples = useMemo(() => entries.map((entry) => `${entry.date ?? ''} ${entry.category} ${entry.text}`), [entries]);
  const result = useSearchMatches(samples, search);
  const query = (search.mode === 'regex' ? search.pattern : search.query).trim();
  const shown = useMemo(
    () => filterEntries(entries, { from: from || null, to: to || null, categories, matches: query && !result.error ? result.matches : null }),
    [entries, from, to, categories, query, result.error, result.matches],
  );
  const present = useMemo(() => CHANGELOG_CATEGORIES.filter((category) => entries.some((entry) => entry.category === category)), [entries]);
  const rangeInvalid = Boolean(from && to && from > to);

  const toggle = (category: ChangelogCategory) =>
    setCategories((current) => (current.includes(category) ? current.filter((item) => item !== category) : [...current, category]));
  const reset = () => { setSearch(emptySearchState()); setCategories([]); setFrom(''); setTo(''); };
  const exportAs = (format: ChangelogExportFormat) => {
    const text = exportEntries(shown, format, { range: { from, to }, filters: { categories, query: query || null } });
    download(`gtha-transit-changelog.${format === 'markdown' ? 'md' : 'txt'}`, text, format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8');
  };

  if (load.state === 'loading') return <output className="about-state">{t('Loading the changelog…', '載入更新紀錄中…')}</output>;
  if (load.state === 'failed') {
    return <p className="about-state" role="alert">{t('The changelog could not be loaded from this site. Refresh to try again.', '未能由呢個網站載入更新紀錄，請重新整理再試。')} <code>{load.message}</code></p>;
  }

  return (
    <div className="about-changes">
      <p className="about-lede">
        {t(`Version ${load.data.version}${load.data.unreleased ? ', not yet released' : ''}. ${entries.length} entries, newest first. Each is dated from the commit it describes.`,
          `版本 ${load.data.version}${load.data.unreleased ? '（未正式發佈）' : ''}。共 ${entries.length} 條，最新排先，日期取自佢描述嘅 commit。`)}
      </p>
      <SearchWorkbench storageId="about.changelog" label={t('Search the changelog', '搜尋更新紀錄')} value={search} onChange={setSearch} samples={samples} t={t} />
      <fieldset className="about-filters">
        <legend>{t('Categories', '類別')}</legend>
        <div className="about-chips">
          {present.map((category) => (
            <button key={category} data-ui="about.category" type="button" className="vehicle-pref-chip" aria-pressed={categories.includes(category)} onClick={() => toggle(category)}>
              {categoryLabel(t, category)}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="about-range">
        <label>{t('From', '由')}<input data-ui="about.from" type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} aria-invalid={rangeInvalid} /></label>
        <label>{t('To', '至')}<input data-ui="about.to" type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} aria-invalid={rangeInvalid} /></label>
        <button type="button" className="pill" data-ui="about.reset" onClick={reset}><RotateCcw size={16} aria-hidden="true" />{t('Clear filters', '清除篩選')}</button>
      </div>
      {rangeInvalid && <p role="alert" className="about-state">{t('The start date is after the end date. Move one of them to see entries.', '開始日期喺結束日期之後，請調整其中一個。')}</p>}
      {result.error && query && <p role="alert" className="about-state">{t('This expression could not be evaluated, so the search is not applied. Edit it or switch to plain text.', '未能配對此規則，搜尋未套用。請修改或轉返純文字。')}</p>}
      <div className="results-toolbar about-toolbar">
        <output aria-live="polite">{t(`${shown.length} of ${entries.length} entries`, `${entries.length} 條之中顯示 ${shown.length} 條`)}</output>
        <div>
          <button type="button" className="pill" data-ui="about.export.markdown" onClick={() => exportAs('markdown')} disabled={!shown.length}><Download size={16} aria-hidden="true" />{t('Export Markdown', '匯出 Markdown')}</button>
          <button type="button" className="pill" data-ui="about.export.text" onClick={() => exportAs('text')} disabled={!shown.length}><Download size={16} aria-hidden="true" />{t('Export text', '匯出文字')}</button>
        </div>
      </div>
      {shown.length === 0
        ? <p className="about-state">{t('No entries match these filters. Clear a filter to widen the list.', '冇條目符合篩選，清除一個篩選再睇。')}</p>
        : (
          <ol className="about-entries">
            {shown.map((entry, index) => (
              <li key={`${entry.date}-${index}`} className="about-entry" data-ui="about.entry">
                <div className="about-entry__meta">
                  <time dateTime={entry.date ?? undefined}>{entry.date ?? t('Date unknown', '日期不詳')}</time>
                  <span className="about-entry__category">{categoryLabel(t, entry.category)}</span>
                  {entry.url && <a href={entry.url} target="_blank" rel="noopener noreferrer">{entry.sha}<ExternalLink size={13} aria-hidden="true" /><span className="sr-only">{t('(opens GitHub)', '（開啟 GitHub）')}</span></a>}
                </div>
                <p><InlineSpans spans={parseInline(entry.text)} fromPath="" known={EMPTY_SET} onArticle={() => {}} t={t} /></p>
              </li>
            ))}
          </ol>
        )}
    </div>
  );
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/* -------------------------------------------------------------- guides -- */

function InlineSpans({ spans, fromPath, known, onArticle, t }: { spans: readonly Inline[]; fromPath: string; known: ReadonlySet<string>; onArticle: (path: string, anchor: string | null) => void; t: Translate }) {
  return <>{spans.map((span, index) => {
    switch (span.kind) {
      case 'text': return <Fragment key={index}>{span.text}</Fragment>;
      case 'code': return <code key={index}>{span.text}</code>;
      case 'strong': return <strong key={index}><InlineSpans spans={span.children} fromPath={fromPath} known={known} onArticle={onArticle} t={t} /></strong>;
      case 'em': return <em key={index}><InlineSpans spans={span.children} fromPath={fromPath} known={known} onArticle={onArticle} t={t} /></em>;
      case 'image': return <span key={index} className="about-image-alt">[{span.alt || t('image', '圖片')}]</span>;
      case 'link': {
        const label = <InlineSpans spans={span.children} fromPath={fromPath} known={known} onArticle={onArticle} t={t} />;
        const target = resolveDocLink(span.href, fromPath, known);
        if (target.kind === 'article') return <a key={index} href={`#doc:${target.path}`} onClick={(event) => { event.preventDefault(); onArticle(target.path, target.anchor); }}>{label}</a>;
        if (target.kind === 'anchor') return <a key={index} href={`#${target.anchor}`} onClick={(event) => { event.preventDefault(); document.getElementById(`doc-${target.anchor}`)?.scrollIntoView({ block: 'start' }); }}>{label}</a>;
        if (target.kind === 'external') return <a key={index} href={target.href} target="_blank" rel="noopener noreferrer">{label}<ExternalLink size={12} aria-hidden="true" /></a>;
        return <Fragment key={index}>{label}</Fragment>;
      }
    }
  })}</>;
}

function BlockView({ block, fromPath, known, onArticle, t }: { block: Block; fromPath: string; known: ReadonlySet<string>; onArticle: (path: string, anchor: string | null) => void; t: Translate }): ReactNode {
  const spans = (value: readonly Inline[]) => <InlineSpans spans={value} fromPath={fromPath} known={known} onArticle={onArticle} t={t} />;
  switch (block.kind) {
    case 'heading': {
      /* The article sits under the workspace h1 and the reader's own h2, so its
         headings start at h3 and never jump the outline back to the top. */
      const Tag = (`h${Math.min(6, block.level + 2)}`) as 'h3' | 'h4' | 'h5' | 'h6';
      return <Tag id={`doc-${block.id}`}>{spans(block.text)}</Tag>;
    }
    case 'paragraph': return <p>{spans(block.text)}</p>;
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul';
      return <List>{block.items.map((item, index) => <li key={index}>{spans(item)}</li>)}</List>;
    }
    case 'code': return <pre className="about-code" tabIndex={0} aria-label={t('Code sample', '程式碼範例')}><code>{block.text}</code></pre>;
    case 'quote': return <blockquote>{block.blocks.map((inner, index) => <BlockView key={index} block={inner} fromPath={fromPath} known={known} onArticle={onArticle} t={t} />)}</blockquote>;
    case 'table':
      return <div className="about-table" tabIndex={0} role="region" aria-label={t('Table', '表格')}><table>
        <thead><tr>{block.header.map((cell, index) => <th key={index} scope="col">{spans(cell)}</th>)}</tr></thead>
        <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, index) => <td key={index}>{spans(cell)}</td>)}</tr>)}</tbody>
      </table></div>;
    case 'rule': return <hr />;
  }
}

function GuidesPanel({ t }: { t: Translate }) {
  const index = useJson<DocsIndex>('/docs/index.json');
  const storedArticle = useLocalSetting(ABOUT_ARTICLE_KEY);
  const [search, setSearch] = useState(emptySearchState);
  const [article, setArticle] = useState<Load<string> | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  const articles = index.state === 'ready' ? index.data.articles : [];
  const known = useMemo(() => new Set(articles.map((row) => row.path)), [articles]);
  const selectedPath = known.has(storedArticle.value ?? '') ? (storedArticle.value as string) : (known.has('README.md') ? 'README.md' : articles[0]?.path ?? null);
  const selected = articles.find((row) => row.path === selectedPath) ?? null;
  const samples = useMemo(() => articles.map((row) => `${row.title} ${row.category} ${row.path}`), [articles]);
  const result = useSearchMatches(samples, search);
  const query = (search.mode === 'regex' ? search.pattern : search.query).trim();
  const visible = articles.filter((_, position) => !query || result.error || result.matches[position]);
  const grouped = useMemo(() => {
    const map = new Map<string, ArticleRow[]>();
    for (const row of visible) map.set(row.category, [...(map.get(row.category) ?? []), row]);
    return [...map.entries()];
  }, [visible]);

  useEffect(() => {
    if (!selectedPath) return;
    const controller = new AbortController();
    setArticle({ state: 'loading' });
    fetch(`/docs/${selectedPath}`, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); setArticle({ state: 'ready', data: await response.text() }); })
      .catch((error: Error) => { if (!controller.signal.aborted) setArticle({ state: 'failed', message: error.message }); });
    return () => controller.abort();
  }, [selectedPath]);

  const blocks = useMemo(() => (article?.state === 'ready' ? parseMarkdown(article.data) : []), [article]);

  useEffect(() => {
    if (!pendingAnchor || article?.state !== 'ready') return;
    document.getElementById(`doc-${pendingAnchor}`)?.scrollIntoView({ block: 'start' });
    setPendingAnchor(null);
  }, [pendingAnchor, article]);

  const open = (path: string, anchor: string | null = null) => {
    storedArticle.setValue(path);
    setPendingAnchor(anchor);
    requestAnimationFrame(() => document.getElementById('about-article-heading')?.focus());
  };

  if (index.state === 'loading') return <output className="about-state">{t('Loading the guides…', '載入說明文件中…')}</output>;
  if (index.state === 'failed') return <p className="about-state" role="alert">{t('The guides could not be loaded from this site. Refresh to try again.', '未能由呢個網站載入說明文件，請重新整理再試。')} <code>{index.message}</code></p>;

  return (
    <div className="about-guides">
      <nav className="about-guides__index" aria-label={t('Guides by category', '按類別分嘅說明')}>
        <SearchWorkbench storageId="about.guides" label={t('Find a guide', '搵說明')} value={search} onChange={setSearch} samples={samples} t={t} />
        {result.error && query && <p role="alert" className="about-state">{t('This expression could not be evaluated, so every guide is listed.', '未能配對此規則，所以列出全部說明。')}</p>}
        {grouped.length === 0 && <p className="about-state">{t('No guide matches. Try a shorter word.', '冇說明符合，試下短啲嘅字。')}</p>}
        {grouped.map(([category, rows]) => (
          <section key={category} className="about-guides__group">
            <h3>{categoryLabel(t, category)}</h3>
            <ul>
              {rows.map((row) => (
                <li key={row.path}>
                  <button type="button" data-ui="about.article" aria-current={row.path === selectedPath ? 'page' : undefined} onClick={() => open(row.path)}>
                    <span>{row.title}</span><small>{row.path}</small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
      <article className="about-reader" aria-labelledby="about-article-heading">
        <h2 id="about-article-heading" tabIndex={-1}>{selected ? selected.title : t('No guide selected', '未揀說明')}</h2>
        {selected && <p className="about-reader__source">
          <code>docs/{selected.path}</code> · {t(`${selected.bytes} bytes`, `${selected.bytes} 位元組`)} ·{' '}
          <a href={`https://github.com/Ding-Ding-Projects/gtha-transit/blob/main/docs/${selected.path}`} target="_blank" rel="noopener noreferrer">{t('View on GitHub', '喺 GitHub 睇')}<ExternalLink size={12} aria-hidden="true" /></a>
        </p>}
        {selected && <p className="about-reader__note">{t('Guides are written in English. The interface around them follows your language setting.', '說明文件以英文撰寫，周圍嘅介面會跟你嘅語言設定。')}</p>}
        {article?.state === 'loading' && <output className="about-state">{t('Opening the guide…', '開啟說明中…')}</output>}
        {article?.state === 'failed' && <p role="alert" className="about-state">{t('This guide could not be loaded. Choose it again to retry.', '未能載入呢份說明，再揀一次重試。')} <code>{article.message}</code></p>}
        {article?.state === 'ready' && blocks.map((block, position) => (
          <BlockView key={position} block={block.kind === 'heading' && position === 0 && block.level === 1 && selected && inlineText(block.text) === selected.title ? { kind: 'rule' } : block} fromPath={selectedPath ?? ''} known={known} onArticle={open} t={t} />
        ))}
      </article>
    </div>
  );
}

/* ---------------------------------------------------------------- about -- */

export default function AboutWorkspace({ t, version }: { t: Translate; version: { version?: string; commit?: string; builtAt?: string } | null }) {
  const storedTab = useLocalSetting(ABOUT_TAB_KEY);
  const active = (ABOUT_TABS as readonly string[]).includes(storedTab.value ?? '') ? (storedTab.value as string) : 'changes';
  return (
    <div className="page-panel about-workspace">
      <span className="eyebrow">{t('About this planner', '關於呢個規劃工具')}</span>
      <p>
        {t('Independent and open source, for the whole Greater Toronto and Hamilton Area. What changed, and how each part works, is below, readable offline.',
          '獨立開源，服務整個大多倫多及咸美頓地區。下面有每次改動同每部分點運作，離線都睇得到。')}
        {version?.commit && <> <code data-ui="about.version">v{version.version} · {version.commit.slice(0, 7)}</code></>}
      </p>
      <Tabs value={active} onValueChange={(value) => storedTab.setValue(String(value))} className="settings-tabs about-tabs">
        <TabsList aria-label={t('About sections', '關於部分')} className="settings-tab-strip">
          <TabsTrigger value="changes" data-ui="about.tab.changes"><History size={18} aria-hidden="true" /><span>{t('What changed', '更新紀錄')}</span></TabsTrigger>
          <TabsTrigger value="guides" data-ui="about.tab.guides"><BookOpen size={18} aria-hidden="true" /><span>{t('Guides', '說明文件')}</span></TabsTrigger>
        </TabsList>
        <TabsContent value="changes" className="settings-section"><ChangelogPanel t={t} /></TabsContent>
        <TabsContent value="guides" className="settings-section"><GuidesPanel t={t} /></TabsContent>
      </Tabs>
    </div>
  );
}
