'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Code2,
  Copy,
  Download,
  FileUp,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  ECMASCRIPT_REGEX_CAPABILITIES,
  SEARCH_LIMITS,
  describeRegexTokens,
  escapeRegexLiteral,
  parseRegexSnippets,
  serializeRegexSnippets,
  staticRegexRiskNotes,
  type RegexCapability,
  type RegexCase,
  type RegexSnippet,
  type RegexToken,
  type SearchState,
  useRegexWorkbenchEvaluation,
} from '@/lib/search-workbench';

export type Translate = (en: string, zh: string) => string;

export type SearchWorkbenchProps = {
  label: string;
  value: SearchState;
  onChange: (next: SearchState) => void;
  samples?: string[];
  t: Translate;
};

const EMPTY_SAMPLES: string[] = [];
const SNIPPET_STORAGE_KEY = 'gtha.regex-workbench.snippets.v1';

function message(t: Translate, code: string): string {
  const copy: Record<string, [string, string]> = {
    'query-too-long': ['The text query is too long.', '文字查詢太長。'],
    'pattern-too-long': ['The pattern is too long.', '規則太長。'],
    'invalid-flags': ['Use each supported flag once. The u and v flags cannot be combined.', '每個支援旗標只可用一次，而且 u 同 v 不能一齊用。'],
    'replacement-too-long': ['The replacement text is too long.', '取代文字太長。'],
    'too-many-samples': ['This field accepts at most 10,000 short values at once.', '呢個欄位一次最多處理 10,000 個短文字。'],
    'invalid-sample': ['A sample is not usable text.', '其中一個樣本唔係可用文字。'],
    'sample-too-long': ['A sample is longer than the safe 512-character limit.', '其中一個樣本超過安全嘅 512 字元上限。'],
    'samples-too-large': ['The combined sample text exceeds the 1 MiB safety limit.', '所有樣本加埋超過 1 MiB 安全上限。'],
    'too-many-cases': ['Keep the test suite to 24 cases or fewer.', '測試組合最多 24 個案例。'],
    'case-too-long': ['A test case is too long.', '其中一個測試案例太長。'],
    'invalid-pattern': ['The JavaScript engine rejected this pattern.', 'JavaScript 引擎拒絕咗呢個規則。'],
    'invalid-samples': ['The worker rejected the bounded sample payload.', '工作程序拒絕咗受限制嘅樣本資料。'],
    'invalid-cases': ['The worker rejected the bounded test cases.', '工作程序拒絕咗受限制嘅測試案例。'],
    'regex-timeout': ['The pattern exceeded the safety deadline and was stopped.', '規則超過安全時限，已經停止。'],
    'worker-unavailable': ['Regex mode is unavailable because this browser cannot start a worker.', '呢個瀏覽器無法啟動工作程序，所以規則模式暫時未能使用。'],
    'worker-failed': ['Regex evaluation stopped before returning a result.', '規則檢查未完成已經停止。'],
    'worker-invalid-response': ['Regex evaluation returned an invalid result.', '規則檢查返回咗無效結果。'],
    'invalid-snippet-json': ['The snippet file is not valid JSON.', '呢個規則檔案唔係有效 JSON。'],
    'invalid-snippet-shape': ['The snippet file has an unsupported shape or value.', '呢個規則檔案嘅格式或者內容唔支援。'],
    'snippet-too-large': ['The snippet import is too large.', '規則匯入檔案太大。'],
    'snippet-loaded': ['Saved snippets loaded on this device.', '已經讀取呢部裝置儲存嘅規則。'],
    'snippet-saved': ['The snippet was saved on this device.', '規則已儲存喺呢部裝置。'],
    'snippet-deleted': ['The snippet was removed from this device.', '規則已經由呢部裝置移除。'],
    'snippet-imported': ['The snippet collection was imported.', '規則組合已經匯入。'],
    'snippet-exported': ['The snippet collection was copied.', '規則組合已經複製。'],
    'clipboard-unavailable': ['Copy is unavailable. Use the download or select the export text.', '而家未能複製。請下載或者自行選取匯出文字。'],
    'snippet-name-invalid': ['Give this snippet a name of 64 characters or fewer.', '請為規則改一個唔超過 64 字元嘅名稱。'],
    'snippet-storage-failed': ['Saved snippets could not be stored on this device.', '呢部裝置未能儲存規則。'],
  };
  const entry = copy[code] ?? ['Regex workbench could not complete that action.', '規則工作台未能完成呢個動作。'];
  return t(entry[0], entry[1]);
}

function tokenLabel(t: Translate, token: RegexToken): string {
  const labels: Record<RegexToken['kind'], [string, string]> = {
    anchor: ['anchor', '錨點'],
    alternation: ['alternative', '分支'],
    'character-class': ['character class', '字元類別'],
    'escaped-literal': ['escaped character', '已跳脫字元'],
    group: ['group opener', '群組開始'],
    'group-end': ['group end', '群組結束'],
    literal: ['literal', '文字'],
    quantifier: ['quantifier', '數量符號'],
    wildcard: ['any character', '任何字元'],
  };
  return t(labels[token.kind][0], labels[token.kind][1]);
}

function capabilityCopy(t: Translate, capability: RegexCapability): { title: string; detail: string } {
  const copies: Record<string, [string, string]> = {
    'Literals, escaped characters, and Unicode code points': ['Literals, escaped characters, and Unicode code points', '文字、跳脫字元及 Unicode 字元碼'],
    'Character classes and negated classes': ['Character classes and negated classes', '字元類別及排除類別'],
    'Anchors and boundaries': ['Anchors and boundaries', '錨點及界線'],
    'Named and numbered capture groups': ['Named and numbered capture groups', '命名及編號擷取群組'],
    'Alternation and greedy or lazy quantifiers': ['Alternation and greedy or lazy quantifiers', '分支、貪婪及非貪婪數量符號'],
    'Lookahead and lookbehind': ['Lookahead and lookbehind', '前瞻及後顧'],
    'Unicode Sets with the v flag': ['Unicode Sets with the v flag', '使用 v 旗標嘅 Unicode 集合'],
    'Atomic groups (?>...)': ['Atomic groups (?>...)', '原子群組 (?>...)'],
    'Possessive quantifiers such as *+ or ++': ['Possessive quantifiers such as *+ or ++', '佔有式數量符號，例如 *+ 或 ++'],
    'Conditionals and subroutines': ['Conditionals and subroutines', '條件式及子規則'],
    'Portable backtracking step trace': ['Portable backtracking step trace', '可攜式回溯步驟追蹤'],
  };
  const title = copies[capability.syntax] ?? [capability.syntax, capability.syntax];
  const support: Record<RegexCapability['support'], [string, string]> = {
    supported: ['Supported', '支援'],
    'runtime-dependent': ['Depends on this browser', '視乎呢個瀏覽器'],
    unavailable: ['Not available in JavaScript', 'JavaScript 暫未支援'],
  };
  const details: Record<string, [string, string]> = {
    'Supported by the JavaScript RegExp engine used by this workbench.': ['Supported by this JavaScript engine.', '呢個 JavaScript 引擎支援。'],
    'Use brackets such as [A-Z] or [^0-9].': ['Use brackets such as [A-Z] or [^0-9].', '可以使用 [A-Z] 或 [^0-9]。'],
    'Use ^, $, and \\b with the JavaScript engine.': ['Use ^, $, and \\b with the JavaScript engine.', '可以使用 ^、$ 同 \\b。'],
    'Use (?<name>...) or (...) and inspect bounded captures below.': ['Use (?<name>...) or (...) and inspect bounded captures below.', '可以使用 (?<name>...) 或 (...)，再喺下面查看受限制嘅擷取結果。'],
    'Use |, *, +, ?, {min,max}, and a trailing ? for lazy matching.': ['Use |, *, +, ?, {min,max}, and a trailing ? for lazy matching.', '可以使用 |、*、+、?、{min,max} 同尾隨 ? 做非貪婪比對。'],
    'Modern JavaScript supports positive and negative lookaround.': ['Modern JavaScript supports positive and negative lookaround.', '現代 JavaScript 支援正向及負向前瞻和後顧。'],
    'Availability depends on the browser JavaScript engine. The worker reports a syntax error when unavailable.': ['Availability depends on this browser. The worker will report an error if it cannot use this feature.', '支援情況視乎瀏覽器。工作程序無法使用時會清楚報錯。'],
    'ECMAScript RegExp does not implement atomic groups.': ['JavaScript regular expressions do not implement atomic groups.', 'JavaScript 規則未有原子群組。'],
    'ECMAScript RegExp does not implement possessive quantifiers.': ['JavaScript regular expressions do not implement possessive quantifiers.', 'JavaScript 規則未有佔有式數量符號。'],
    'ECMAScript RegExp does not implement conditional branches or subroutine calls.': ['JavaScript regular expressions do not implement conditional branches or subroutine calls.', 'JavaScript 規則未有條件分支或者子規則呼叫。'],
    'JavaScript does not expose a portable RegExp step trace, so this workbench does not claim to provide one.': ['JavaScript does not expose a portable step trace, so this workbench does not claim to provide one.', 'JavaScript 未有可攜式步驟追蹤，所以呢個工作台唔會聲稱提供。'],
  };
  return {
    title: `${support[capability.support][0]}: ${t(title[0], title[1])}`,
    detail: t(...(details[capability.reason] ?? [capability.reason, capability.reason])),
  };
}

function riskCopy(t: Translate, code: string): string {
  const copy: Record<string, [string, string]> = {
    'long-pattern': ['Long patterns take more time to inspect.', '較長規則需要更多時間檢查。'],
    'repeated-wildcard': ['Repeated wildcards may backtrack heavily on near matches.', '重複萬用字元喺接近吻合時可能大幅回溯。'],
    'nested-repeat': ['A repeated group contains another repeat, which can be expensive on near matches.', '重複群組入面仲有重複符號，接近吻合時可能好花時間。'],
  };
  const item = copy[code] ?? ['This pattern may take longer on some inputs.', '呢個規則喺某啲文字可能需要較長時間。'];
  return t(item[0], item[1]);
}

function copyToClipboard(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) return Promise.reject(new Error('clipboard-unavailable'));
  return navigator.clipboard.writeText(text);
}

function downloadJson(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SearchWorkbench({
  label,
  value,
  onChange,
  samples = EMPTY_SAMPLES,
  t,
}: SearchWorkbenchProps) {
  const id = useId().replaceAll(':', '');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const patternInputRef = useRef<HTMLInputElement>(null);
  const caseId = useRef(1);
  const [open, setOpen] = useState(false);
  const [replacement, setReplacement] = useState('');
  const [cases, setCases] = useState<RegexCase[]>([]);
  const [snippetName, setSnippetName] = useState('');
  const [snippets, setSnippets] = useState<RegexSnippet[]>([]);
  const [snippetsLoaded, setSnippetsLoaded] = useState(false);
  const [importText, setImportText] = useState('');
  const [snippetNotice, setSnippetNotice] = useState<string | null>(null);
  const tokens = useMemo(() => describeRegexTokens(value.pattern), [value.pattern]);
  const risks = useMemo(() => staticRegexRiskNotes(value.pattern), [value.pattern]);
  const evaluation = useRegexWorkbenchEvaluation(samples, value, replacement, cases);
  const fieldId = `${id}-query`;
  const panelId = `${id}-builder`;
  const activeValue = value.mode === 'text' ? value.query : value.pattern;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SNIPPET_STORAGE_KEY);
      if (raw) setSnippets(parseRegexSnippets(raw));
    } catch {
      setSnippetNotice('invalid-snippet-json');
    } finally {
      setSnippetsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!snippetsLoaded) return;
    try {
      window.localStorage.setItem(SNIPPET_STORAGE_KEY, serializeRegexSnippets(snippets));
    } catch {
      setSnippetNotice('snippet-storage-failed');
    }
  }, [snippets, snippetsLoaded, t]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => patternInputRef.current?.focus());
    const closeIfOutside = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    };
    document.addEventListener('pointerdown', closeIfOutside);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', closeIfOutside);
    };
  }, [open]);

  const update = (next: Partial<SearchState>) => onChange({ ...value, ...next });
  const close = () => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };
  const switchMode = (mode: SearchState['mode']) => {
    if (mode === value.mode) return;
    if (mode === 'regex') {
      update({ mode, pattern: value.pattern || escapeRegexLiteral(value.query) });
      return;
    }
    update({ mode, query: value.query || value.pattern });
  };
  const updateActive = (next: string) =>
    value.mode === 'text' ? update({ query: next }) : update({ pattern: next });
  const appendPattern = (fragment: string) => {
    update({ mode: 'regex', pattern: `${value.pattern}${fragment}` });
  };
  const toggleFlag = (flag: string) => {
    const enabled = value.flags.includes(flag);
    let next = enabled ? value.flags.replaceAll(flag, '') : `${value.flags}${flag}`;
    if (flag === 'u' && !enabled) next = next.replaceAll('v', '');
    if (flag === 'v' && !enabled) next = next.replaceAll('u', '');
    update({ flags: next });
  };
  const updateCase = (caseIdValue: string, patch: Partial<RegexCase>) =>
    setCases((items) => items.map((item) => (item.id === caseIdValue ? { ...item, ...patch } : item)));
  const addCase = () => {
    if (cases.length >= SEARCH_LIMITS.maxCases) {
      setSnippetNotice('too-many-cases');
      return;
    }
    setCases((items) => [
      ...items,
      { id: `case-${caseId.current++}`, text: '', expected: true },
    ]);
  };
  const saveSnippet = () => {
    const name = snippetName.trim();
    if (!name || name.length > SEARCH_LIMITS.maxSnippetNameLength) {
      setSnippetNotice('snippet-name-invalid');
      return;
    }
    const candidate: RegexSnippet = { name, pattern: value.pattern, flags: value.flags, replacement };
    setSnippets((items) => [
      ...items.filter((item) => item.name !== name),
      candidate,
    ].slice(-SEARCH_LIMITS.maxSnippetCount));
    setSnippetName('');
    setSnippetNotice('snippet-saved');
  };
  const applySnippet = (snippet: RegexSnippet) => {
    update({ mode: 'regex', pattern: snippet.pattern, flags: snippet.flags });
    setReplacement(snippet.replacement);
  };
  const importSnippets = (raw = importText) => {
    try {
      setSnippets(parseRegexSnippets(raw));
      setImportText('');
      setSnippetNotice('snippet-imported');
    } catch (error) {
      setSnippetNotice(error instanceof Error ? error.message : 'invalid-snippet-json');
    }
  };
  const exportSnippets = () => serializeRegexSnippets(snippets);
  const detailsCount = evaluation.details.length;
  const sampleInspector = samples.slice(0, 12);

  return (
    <div className="regex-workbench" ref={rootRef}>
      <div className="regex-workbench__field">
        <label htmlFor={fieldId}>{label}</label>
        <div className="regex-workbench__input-line">
          <Search size={17} aria-hidden="true" />
          <input
            id={fieldId}
            type="search"
            value={activeValue}
            maxLength={value.mode === 'text' ? SEARCH_LIMITS.maxQueryLength : SEARCH_LIMITS.maxPatternLength}
            onChange={(event) => updateActive(event.target.value)}
            placeholder={
              value.mode === 'text'
                ? t('Search text', '搜尋文字')
                : t('JavaScript regular expression', 'JavaScript 規則')
            }
            aria-describedby={`${id}-mode ${id}-state`}
          />
          <button
            type="button"
            className="regex-workbench__trigger"
            ref={triggerRef}
            aria-controls={panelId}
            aria-expanded={open}
            aria-haspopup="dialog"
            onClick={() => setOpen((isOpen) => !isOpen)}
          >
            <Code2 size={17} aria-hidden="true" />
            <span>{t('Build regex', '建立規則')}</span>
          </button>
        </div>
        <p id={`${id}-mode`} className="regex-workbench__mode">
          {value.mode === 'text'
            ? t('Plain text mode is active.', '而家使用純文字模式。')
            : t('Regular expression mode is active.', '而家使用規則模式。')}
        </p>
        <p id={`${id}-state`} className="regex-workbench__state" aria-live="polite">
          {evaluation.busy
            ? t('Checking the bounded sample set…', '檢查受限制樣本中…')
            : evaluation.error
              ? message(t, evaluation.error)
              : t(
                  `${evaluation.matches.filter(Boolean).length} of ${evaluation.matches.length} values match.`,
                  `${evaluation.matches.filter(Boolean).length} 個，共 ${evaluation.matches.length} 個文字符合。`,
                )}
        </p>
      </div>

      {open && (
        <section
          id={panelId}
          className="regex-workbench__popover"
          role="dialog"
          aria-label={t('Regular expression workbench', '規則工作台')}
          aria-modal="false"
          style={{ maxHeight: 'min(72vh, 48rem)', maxWidth: 'calc(100vw - 2rem)' }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
          }}
        >
          <header className="regex-workbench__header">
            <div>
              <span className="eyebrow">{t('SEARCH WORKBENCH', '搜尋工作台')}</span>
              <h3>{t('Build, test, and explain a JavaScript regular expression', '建立、測試及解釋 JavaScript 規則')}</h3>
            </div>
            <button type="button" className="icon-button" onClick={close} aria-label={t('Close regex workbench', '關閉規則工作台')}>
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <fieldset className="regex-workbench__mode-picker">
            <legend>{t('Search mode', '搜尋模式')}</legend>
            <label>
              <input type="radio" name={`${id}-mode`} checked={value.mode === 'text'} onChange={() => switchMode('text')} />
              {t('Plain text', '純文字')}
            </label>
            <label>
              <input type="radio" name={`${id}-mode`} checked={value.mode === 'regex'} onChange={() => switchMode('regex')} />
              {t('Regular expression', '規則')}
            </label>
          </fieldset>

          <div className="regex-workbench__editor-grid">
            <label>
              {t('Pattern', '規則')}
              <input
                ref={patternInputRef}
                value={value.pattern}
                maxLength={SEARCH_LIMITS.maxPatternLength}
                onChange={(event) => update({ mode: 'regex', pattern: event.target.value })}
                spellCheck="false"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder={t('Example: ^(?<agency>TTC|GO)\\s+(?<route>\\d+)$', '例子：^(?<agency>TTC|GO)\\s+(?<route>\\d+)$')}
              />
            </label>
            <label>
              {t('Flags', '旗標')}
              <input
                value={value.flags}
                maxLength={SEARCH_LIMITS.maxFlags}
                onChange={(event) => update({ mode: 'regex', flags: event.target.value })}
                spellCheck="false"
                autoCapitalize="none"
                autoCorrect="off"
                aria-describedby={`${id}-flags-help`}
              />
              <small id={`${id}-flags-help`}>
                {t('Known JavaScript flags: d g i m s u v y. The u and v flags are alternatives.', '支援嘅 JavaScript 旗標：d g i m s u v y。u 同 v 係二選一。')}
              </small>
            </label>
          </div>

          <div className="regex-workbench__flag-chips" aria-label={t('Flag shortcuts', '旗標捷徑')}>
            {[
              ['i', 'Case-insensitive', '不分大小寫'],
              ['m', 'Multiline anchors', '多行錨點'],
              ['s', 'Dot matches line breaks', '點號包括換行'],
              ['g', 'Find every occurrence', '搵每一個結果'],
              ['u', 'Unicode mode', 'Unicode 模式'],
              ['v', 'Unicode Sets mode', 'Unicode 集合模式'],
              ['d', 'Match indices', '結果索引'],
            ].map(([flag, en, zh]) => (
              <button
                type="button"
                key={flag}
                aria-pressed={value.flags.includes(flag)}
                onClick={() => toggleFlag(flag)}
                title={t(en, zh)}
              >
                <code>{flag}</code>
              </button>
            ))}
          </div>

          <section className="regex-workbench__guided" aria-labelledby={`${id}-guided`}>
            <h4 id={`${id}-guided`}>{t('Guided construction', '導引建立')}</h4>
            <p>{t('Each control inserts JavaScript syntax at the end of the pattern. Edit the result freely.', '每個控制會喺規則尾部加入 JavaScript 語法，之後可以自由修改。')}</p>
            <div className="regex-workbench__guides">
              <button type="button" onClick={() => appendPattern(escapeRegexLiteral(value.query))}>{t('Escape current text', '跳脫目前文字')}</button>
              <button type="button" onClick={() => appendPattern('[A-Za-z0-9]')}>{t('Character class', '字元類別')}</button>
              <button type="button" onClick={() => appendPattern('^')}>{t('Start anchor', '開頭錨點')}</button>
              <button type="button" onClick={() => appendPattern('$')}>{t('End anchor', '結尾錨點')}</button>
              <button type="button" onClick={() => appendPattern('(?<name>...)')}>{t('Named group', '命名群組')}</button>
              <button type="button" onClick={() => appendPattern('|')}>{t('Alternative', '分支')}</button>
              <button type="button" onClick={() => appendPattern('{2,5}')}>{t('Range quantifier', '範圍數量符號')}</button>
              <button type="button" onClick={() => appendPattern('(?=...)')}>{t('Positive lookahead', '正向前瞻')}</button>
              <button type="button" onClick={() => appendPattern('(?<=...)')}>{t('Positive lookbehind', '正向後顧')}</button>
            </div>
          </section>

          <section className="regex-workbench__explanation" aria-labelledby={`${id}-explanation`}>
            <h4 id={`${id}-explanation`}>{t('Pattern annotation', '規則註解')}</h4>
            <p>{t('This is a structured token explanation, not a parser or a claimed execution trace.', '呢個係結構化字元註解，並非完整分析器或者執行步驟追蹤。')}</p>
            {tokens.length ? (
              <ul>
                {tokens.map((token, index) => (
                  <li key={`${token.raw}-${index}`}>
                    <code>{token.raw}</code>
                    <span>{tokenLabel(t, token)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t('Enter a pattern to see its tokens.', '輸入規則後會顯示字元結構。')}</p>
            )}
          </section>

          <section className="regex-workbench__risk" aria-labelledby={`${id}-risk`}>
            <h4 id={`${id}-risk`}>{t('Performance and risk', '效能及風險')}</h4>
            <p>{t('Evaluation runs off the main interface in a worker and stops at a short deadline. These warnings are static hints, not a proof of cost.', '規則會喺主介面以外嘅工作程序運行，並會喺短時限停止。以下只係靜態提示，唔係成本保證。')}</p>
            {risks.length ? (
              <ul>{risks.map((risk) => <li key={risk}>{riskCopy(t, risk)}</li>)}</ul>
            ) : (
              <p>{t('No simple static risk pattern was found.', '未有發現簡單嘅靜態風險模式。')}</p>
            )}
          </section>

          <section className="regex-workbench__samples" aria-labelledby={`${id}-samples`}>
            <h4 id={`${id}-samples`}>{t('Live sample matches', '即時樣本結果')}</h4>
            <p>{t(`The filter evaluated all ${evaluation.matches.length} supplied values. This inspector shows its first ${sampleInspector.length} values.`, `篩選器已經檢查全部 ${evaluation.matches.length} 個文字。呢個檢視只顯示頭 ${sampleInspector.length} 個。`)}</p>
            <ul>
              {sampleInspector.map((sample, index) => (
                <li key={`${sample}-${index}`} data-match={evaluation.matches[index] ? 'true' : 'false'}>
                  <code>{sample}</code>
                  <span>{evaluation.matches[index] ? t('Match', '符合') : t('No match', '不符合')}</span>
                </li>
              ))}
            </ul>
            {evaluation.error && <p role="alert">{message(t, evaluation.error)}</p>}
          </section>

          <section className="regex-workbench__captures" aria-labelledby={`${id}-captures`}>
            <h4 id={`${id}-captures`}>{t('Capture table and match navigation', '擷取表及結果導航')}</h4>
            <p>{t(`Showing ${detailsCount} inspection records. Capture text is bounded so a broad pattern cannot fill the page.`, `顯示 ${detailsCount} 個檢視記錄。擷取文字有上限，避免太闊嘅規則填滿畫面。`)}</p>
            {evaluation.details.length ? (
              <ol>
                {evaluation.details.map((detail, index) => (
                  <li key={`${detail.sampleIndex}-${detail.start}-${index}`}>
                    <a href={`#${fieldId}`} onClick={(event) => { event.preventDefault(); document.getElementById(fieldId)?.focus(); }}>
                      {t(`Sample ${detail.sampleIndex + 1}, characters ${detail.start}–${detail.end}`, `樣本 ${detail.sampleIndex + 1}，字元 ${detail.start} 至 ${detail.end}`)}
                    </a>
                    <code>{detail.text}</code>
                    {detail.captures.length > 0 && (
                      <ul>
                        {detail.captures.map((capture) => (
                          <li key={capture.name}><code>{capture.name}</code>: {capture.value ?? t('not captured', '未擷取')}</li>
                        ))}
                      </ul>
                    )}
                    {detail.truncated && <small>{t('Displayed text was shortened safely.', '顯示文字已安全縮短。')}</small>}
                  </li>
                ))}
              </ol>
            ) : (
              <p>{t('No bounded captures are available yet.', '而家未有受限制擷取結果。')}</p>
            )}
          </section>

          <section className="regex-workbench__replacement" aria-labelledby={`${id}-replacement`}>
            <h4 id={`${id}-replacement`}>{t('Replacement preview', '取代預覽')}</h4>
            <label>
              {t('Replacement template', '取代範本')}
              <input value={replacement} maxLength={SEARCH_LIMITS.maxReplacementLength} onChange={(event) => setReplacement(event.target.value)} placeholder={t('Example: $<route>', '例子：$<route>')} />
            </label>
            {evaluation.replacementPreview ? (
              <output>
                <strong>{t(`Sample ${evaluation.replacementPreview.sampleIndex + 1}`, `樣本 ${evaluation.replacementPreview.sampleIndex + 1}`)}</strong>
                <code>{evaluation.replacementPreview.value}</code>
                {evaluation.replacementPreview.truncated && <small>{t('Preview shortened safely.', '預覽已安全縮短。')}</small>}
              </output>
            ) : (
              <p>{t('A preview appears after the pattern matches a sample.', '規則符合樣本後會顯示預覽。')}</p>
            )}
          </section>

          <section className="regex-workbench__cases" aria-labelledby={`${id}-cases`}>
            <h4 id={`${id}-cases`}>{t('Expected-match test cases', '預期符合測試案例')}</h4>
            <p>{t('Each case records an expected result. The worker compares the actual result without running a pattern on the main interface.', '每個案例都有預期結果。工作程序會比較實際結果，主介面唔會直接運行規則。')}</p>
            {cases.map((item) => {
              const result = evaluation.cases.find((candidate) => candidate.id === item.id);
              return (
                <div className="regex-workbench__case" key={item.id}>
                  <label>
                    {t('Case text', '案例文字')}
                    <input value={item.text} maxLength={SEARCH_LIMITS.maxCaseLength} onChange={(event) => updateCase(item.id, { text: event.target.value })} />
                  </label>
                  <label>
                    {t('Expected result', '預期結果')}
                    <select value={item.expected ? 'match' : 'no-match'} onChange={(event) => updateCase(item.id, { expected: event.target.value === 'match' })}>
                      <option value="match">{t('Match', '符合')}</option>
                      <option value="no-match">{t('No match', '不符合')}</option>
                    </select>
                  </label>
                  <output aria-live="polite">
                    {result ? (result.passed ? t('Pass', '通過') : t('Different result', '結果不同')) : t('Waiting', '等候中')}
                  </output>
                  <button type="button" onClick={() => setCases((items) => items.filter((candidate) => candidate.id !== item.id))} aria-label={t('Remove test case', '移除測試案例')}>
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
            <button type="button" onClick={addCase}><Plus size={16} aria-hidden="true" /> {t('Add test case', '新增測試案例')}</button>
          </section>

          <section className="regex-workbench__snippets" aria-labelledby={`${id}-snippets`}>
            <h4 id={`${id}-snippets`}>{t('Saved snippets', '已儲存規則')}</h4>
            <p>{t('Snippets stay in this browser on this device. Export before clearing browser storage.', '規則只會儲存喺呢部裝置嘅瀏覽器。清除瀏覽器資料之前請先匯出。')}</p>
            <div className="regex-workbench__snippet-save">
              <label>
                {t('Snippet name', '規則名稱')}
                <input value={snippetName} maxLength={SEARCH_LIMITS.maxSnippetNameLength} onChange={(event) => setSnippetName(event.target.value)} placeholder={t('Example: TTC route code', '例子：TTC 路線代碼')} />
              </label>
              <button type="button" onClick={saveSnippet}>{t('Save snippet', '儲存規則')}</button>
            </div>
            {snippets.length ? (
              <ul>
                {snippets.map((snippet) => (
                  <li key={snippet.name}>
                    <button type="button" onClick={() => applySnippet(snippet)}><code>{snippet.name}</code></button>
                    <code>{`/${snippet.pattern}/${snippet.flags}`}</code>
                    <button type="button" onClick={() => { setSnippets((items) => items.filter((item) => item.name !== snippet.name)); setSnippetNotice('snippet-deleted'); }} aria-label={t('Delete saved snippet', '刪除已儲存規則')}>
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t('No snippets are saved on this device.', '呢部裝置未有儲存規則。')}</p>
            )}
            <div className="regex-workbench__snippet-transfer">
              <button type="button" onClick={() => copyToClipboard(exportSnippets()).then(() => setSnippetNotice('snippet-exported')).catch(() => setSnippetNotice('clipboard-unavailable'))}>
                <Copy size={16} aria-hidden="true" /> {t('Copy export', '複製匯出')}
              </button>
              <button type="button" onClick={() => downloadJson('regex-snippets.json', exportSnippets())}>
                <Download size={16} aria-hidden="true" /> {t('Download export', '下載匯出')}
              </button>
              <label className="regex-workbench__file-import">
                <FileUp size={16} aria-hidden="true" />
                <span>{t('Choose JSON file', '選擇 JSON 檔案')}</span>
                <input type="file" accept="application/json,.json" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file || file.size > SEARCH_LIMITS.maxSnippetPayloadLength) {
                    if (file) setSnippetNotice('snippet-too-large');
                    return;
                  }
                  void file.text().then(importSnippets).catch(() => setSnippetNotice('invalid-snippet-json'));
                }} />
              </label>
            </div>
            <label>
              {t('Paste snippet JSON', '貼上規則 JSON')}
              <textarea value={importText} maxLength={SEARCH_LIMITS.maxSnippetPayloadLength} onChange={(event) => setImportText(event.target.value)} />
            </label>
            <button type="button" onClick={() => importSnippets()} disabled={!importText.trim()}>{t('Import pasted JSON', '匯入已貼上 JSON')}</button>
            {snippetNotice && <p role="status">{message(t, snippetNotice)}</p>}
          </section>

          <section className="regex-workbench__capabilities" aria-labelledby={`${id}-capabilities`}>
            <h4 id={`${id}-capabilities`}>{t('JavaScript engine capabilities', 'JavaScript 引擎功能')}</h4>
            <ul>
              {ECMASCRIPT_REGEX_CAPABILITIES.map((capability) => {
                const copy = capabilityCopy(t, capability);
                return <li key={capability.syntax}><strong>{copy.title}</strong><span>{copy.detail}</span></li>;
              })}
            </ul>
          </section>
        </section>
      )}
    </div>
  );
}

export { emptySearchState, useSearchMatches } from '@/lib/search-workbench';
export type { SearchState } from '@/lib/search-workbench';
