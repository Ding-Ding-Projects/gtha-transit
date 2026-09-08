/**
 * The local personal-vocabulary file: reading it, bounding it, and refusing it.
 *
 * A person can point the planner at a JSON file of their own wording and have the
 * interface use their words instead of ours. The whole feature is defined by what
 * it will not do.
 *
 * **Nothing ships with it.** No built-in mappings, no samples, no templates, no
 * defaults. Until somebody supplies a valid file, every surface renders the
 * wording it shipped with, unchanged. The control is always visible so it can be
 * found; that is not permission to seed it with anything.
 *
 * **It never leaves this browser.** No network request, no telemetry, no export,
 * no crash report, no log. The validated file is cached in local storage and
 * nowhere else, and clearing it purges the cache and restores the original
 * wording immediately.
 *
 * **A rejected file applies nothing.** Not partially, not the entries before the
 * bad one. A vocabulary half-applied is an interface speaking two languages at
 * once with no way to tell which words are whose.
 *
 * Replacement happens only at the text boundary, and commands, URLs, identifiers,
 * code, file paths and factual external records are never touched: a person who
 * renames "station" has not renamed a station id.
 */

export const VOCABULARY_STORAGE_KEY = 'gtha-personal-vocabulary-v1';

/** The bounds. Every one of them is enforced before a single word is displayed. */
export const VOCABULARY_LIMITS = Object.freeze({
  maxBytes: 64 * 1024,
  maxEntries: 400,
  maxTermLength: 120,
  maxReplacementLength: 240,
  schemaVersion: 1,
});

export type VocabularyEntry = { term: string; replacement: string };

export type VocabularyFile = {
  version: number;
  entries: VocabularyEntry[];
};

export type VocabularyRejection =
  | 'too-large' | 'not-json' | 'not-an-object' | 'unsupported-version'
  | 'entries-not-a-list' | 'too-many-entries' | 'entry-not-an-object'
  | 'term-not-a-string' | 'replacement-not-a-string' | 'term-empty'
  | 'term-too-long' | 'replacement-too-long' | 'duplicate-term' | 'unexpected-field';

export type VocabularyResult =
  | { ok: true; file: VocabularyFile }
  | { ok: false; reason: VocabularyRejection };

const ALLOWED_TOP = new Set(['version', 'entries']);
const ALLOWED_ENTRY = new Set(['term', 'replacement']);

/**
 * Read a candidate file.
 *
 * The complete byte payload is checked before anything is displayed or cached.
 * Every rejection is named, because "that file did not work" is not something a
 * person can act on.
 */
export function readVocabulary(text: string): VocabularyResult {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text).length : Number.POSITIVE_INFINITY;
  if (bytes > VOCABULARY_LIMITS.maxBytes) return { ok: false, reason: 'too-large' };

  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ok: false, reason: 'not-json' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'not-an-object' };

  const record = parsed as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!ALLOWED_TOP.has(key)) return { ok: false, reason: 'unexpected-field' };
  if (record.version !== VOCABULARY_LIMITS.schemaVersion) return { ok: false, reason: 'unsupported-version' };
  if (!Array.isArray(record.entries)) return { ok: false, reason: 'entries-not-a-list' };
  if (record.entries.length > VOCABULARY_LIMITS.maxEntries) return { ok: false, reason: 'too-many-entries' };

  const entries: VocabularyEntry[] = [];
  const seen = new Set<string>();
  for (const candidate of record.entries) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return { ok: false, reason: 'entry-not-an-object' };
    const entry = candidate as Record<string, unknown>;
    for (const key of Object.keys(entry)) if (!ALLOWED_ENTRY.has(key)) return { ok: false, reason: 'unexpected-field' };
    if (typeof entry.term !== 'string') return { ok: false, reason: 'term-not-a-string' };
    if (typeof entry.replacement !== 'string') return { ok: false, reason: 'replacement-not-a-string' };
    const term = entry.term.trim();
    if (!term) return { ok: false, reason: 'term-empty' };
    if (term.length > VOCABULARY_LIMITS.maxTermLength) return { ok: false, reason: 'term-too-long' };
    if (entry.replacement.length > VOCABULARY_LIMITS.maxReplacementLength) return { ok: false, reason: 'replacement-too-long' };
    const key = term.toLowerCase();
    if (seen.has(key)) return { ok: false, reason: 'duplicate-term' };
    seen.add(key);
    entries.push({ term, replacement: entry.replacement });
  }
  return { ok: true, file: { version: VOCABULARY_LIMITS.schemaVersion, entries } };
}

/** Why a file was refused, in words the person can do something about. */
export function rejectionText(reason: VocabularyRejection, t: (en: string, zh: string) => string): string {
  const messages: Record<VocabularyRejection, [string, string]> = {
    'too-large': [`That file is larger than the ${VOCABULARY_LIMITS.maxBytes / 1024} KB limit.`, `個檔案超過 ${VOCABULARY_LIMITS.maxBytes / 1024} KB 上限。`],
    'not-json': ['That file is not valid JSON.', '個檔案唔係有效嘅 JSON。'],
    'not-an-object': ['That file must contain a single object.', '個檔案要係一個物件。'],
    'unsupported-version': [`This planner reads version ${VOCABULARY_LIMITS.schemaVersion} files.`, `呢個規劃工具只讀第 ${VOCABULARY_LIMITS.schemaVersion} 版嘅檔案。`],
    'entries-not-a-list': ['The entries field must be a list.', 'entries 要係一個清單。'],
    'too-many-entries': [`A file may hold at most ${VOCABULARY_LIMITS.maxEntries} entries.`, `一個檔案最多 ${VOCABULARY_LIMITS.maxEntries} 條。`],
    'entry-not-an-object': ['Every entry must be an object with a term and a replacement.', '每條都要係一個有 term 同 replacement 嘅物件。'],
    'term-not-a-string': ['Every term must be text.', '每個 term 都要係文字。'],
    'replacement-not-a-string': ['Every replacement must be text.', '每個 replacement 都要係文字。'],
    'term-empty': ['A term cannot be blank.', 'term 唔可以留空。'],
    'term-too-long': [`A term may be at most ${VOCABULARY_LIMITS.maxTermLength} characters.`, `term 最多 ${VOCABULARY_LIMITS.maxTermLength} 個字元。`],
    'replacement-too-long': [`A replacement may be at most ${VOCABULARY_LIMITS.maxReplacementLength} characters.`, `replacement 最多 ${VOCABULARY_LIMITS.maxReplacementLength} 個字元。`],
    'duplicate-term': ['Two entries use the same term, so which one wins would be arbitrary.', '有兩條用同一個 term，邊條贏會變成隨機。'],
    'unexpected-field': ['That file contains a field this planner does not know, so it was not applied.', '個檔案有本規劃工具唔認識嘅欄位，所以冇套用。'],
  };
  const [en, zh] = messages[reason];
  return t(en, zh);
}

/**
 * The replacer, built once from a validated file.
 *
 * Longest term first, so a longer phrase is not broken up by a shorter one inside
 * it. Whole words only, and case-insensitive with the original's capitalisation
 * kept, because a person renaming "stop" did not mean "stopwatch".
 */
export function buildReplacer(file: VocabularyFile | null): (text: string) => string {
  if (!file || file.entries.length === 0) return (text) => text;
  const ordered = [...file.entries].sort((a, b) => b.term.length - a.term.length);
  const escaped = ordered.map((entry) => entry.term.replace(/[.*+?^${}()|[\]\\]/g, (match) => '\\' + match));
  const lookup = new Map(ordered.map((entry) => [entry.term.toLowerCase(), entry.replacement]));
  let pattern: RegExp;
  try {
    pattern = new RegExp('(?<![\\p{L}\\p{N}])(' + escaped.join('|') + ')(?![\\p{L}\\p{N}])', 'giu');
  } catch {
    // A term that somehow still breaks the engine leaves the wording untouched
    // rather than throwing inside a render.
    return (text) => text;
  }
  return (text) => {
    if (typeof text !== 'string' || !text) return text;
    return text.replace(pattern, (match) => {
      const replacement = lookup.get(match.toLowerCase());
      if (replacement === undefined) return match;
      // Keep the shape of the original: a term capitalised at the start of a
      // sentence stays capitalised.
      if (match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase()) {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      return replacement;
    });
  };
}

/** How many entries a loaded file holds, for the status line. */
export const entryCount = (file: VocabularyFile | null): number => file?.entries.length ?? 0;

/* -------------------------------------------------------------- persistence -- */

export function serializeVocabulary(file: VocabularyFile): string {
  return JSON.stringify(file);
}

/**
 * Read the cache back, revalidating from scratch.
 *
 * The cache is checked with exactly the same reader as a freshly chosen file, so
 * a value that has been edited by hand, truncated by a storage bound or written
 * by an older version cannot reach the interface through a shorter path than the
 * one the file picker uses.
 */
export function parseVocabularyCache(raw: string | null | undefined): VocabularyFile | null {
  if (!raw) return null;
  const result = readVocabulary(raw);
  return result.ok ? result.file : null;
}
