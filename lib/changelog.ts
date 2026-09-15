/**
 * Parsing, filtering and exporting the project's own CHANGELOG.md.
 *
 * The file on disk is prose for a human reading it top to bottom on GitHub, not
 * a data file, so this module reads it as one: a single version heading
 * followed by `- ` bullets, newest first. `scripts/changelog-backfill.mjs`
 * rewrote every bullet it could resolve into `- YYYY-MM-DD · category · text`,
 * with the category decided from the commit's own touched files -- see that
 * script's header for the exact rule table. A bullet it could not resolve, and
 * anything written by hand before that convention existed, keeps its text and
 * carries `unknown-date · unknown` instead of a guess.
 *
 * `parseChangelog` reads both shapes so a hand-added bullet that has not been
 * through the backfill script still parses -- it just carries a null date and
 * an unknown category rather than failing closed. Nothing here ever invents a
 * date, a category or a commit: what cannot be read from the text is null.
 */

export const CHANGELOG_CATEGORIES = [
  'interface',
  'planning',
  'vehicles',
  'status',
  'data',
  'deployment',
  'evidence',
  'docs',
  'race',
  'accessibility',
  'design',
  'release',
  'unknown',
] as const;

export type ChangelogCategory = (typeof CHANGELOG_CATEGORIES)[number];

function isKnownCategory(value: string): value is ChangelogCategory {
  return (CHANGELOG_CATEGORIES as readonly string[]).includes(value);
}

export type ChangelogEntry = {
  /** YYYY-MM-DD, or null when the entry carries no resolvable date. */
  date: string | null;
  category: ChangelogCategory;
  /** The bullet's full text, exactly as written, links included. */
  text: string;
  /** The last commit sha the text links to, or null when it links to none. */
  sha: string | null;
  /** The GitHub URL for `sha`, or null. */
  url: string | null;
  /** Every commit URL found in `text`, in the order they appear. */
  links: readonly string[];
};

export type ParsedChangelog = {
  version: string;
  unreleased: boolean;
  entries: ChangelogEntry[];
};

const SEPARATOR = ' · ';
/** `## 0.1.0, unreleased` or a released `## 0.1.0`. Only the first heading counts; a file with more than one is not this project's shape. */
const HEADING_RE = /^##\s+(\S+?)(?:,\s*(unreleased))?\s*$/i;
/** `- 2026-09-08 · interface · text` or `- unknown-date · unknown · text`. */
const NEW_SHAPE_RE = /^-\s+(\d{4}-\d{2}-\d{2}|unknown-date)\s*·\s*([a-z][a-z-]*)\s*·\s*(.+)$/;
/** A commit link exactly as scripts/changelog-backfill.mjs and CHANGELOG.md's own preamble both use: `([sha7](url))`. */
const LINK_RE = /\[([0-9a-f]{7,40})\]\((https:\/\/github\.com\/[^)\s]+\/commit\/[0-9a-f]{7,40})\)/g;

function findLinks(text: string): { sha: string; url: string }[] {
  return [...text.matchAll(LINK_RE)].map((match) => ({ sha: match[1], url: match[2] }));
}

function parseEntryLine(line: string): ChangelogEntry {
  const body = line.slice(2);
  const shaped = NEW_SHAPE_RE.exec(line);
  const rawDate = shaped ? shaped[1] : null;
  const rawCategory = shaped ? shaped[2] : null;
  const text = shaped ? shaped[3] : body;
  const date = rawDate && rawDate !== 'unknown-date' ? rawDate : null;
  const category: ChangelogCategory = rawCategory && isKnownCategory(rawCategory) ? rawCategory : 'unknown';
  const links = findLinks(text);
  const last = links.length ? links[links.length - 1] : null;
  return {
    date,
    category,
    text,
    sha: last ? last.sha : null,
    url: last ? last.url : null,
    links: links.map((link) => link.url),
  };
}

/** Reads both the dated/categorised shape and a bare `- text` bullet nobody has backfilled yet. */
export function parseChangelog(text: string): ParsedChangelog {
  const lines = text.split(/\r\n|\n/);
  let version = '';
  let unreleased = false;
  let headingSeen = false;
  const entries: ChangelogEntry[] = [];
  for (const line of lines) {
    if (!headingSeen) {
      const heading = HEADING_RE.exec(line.trim());
      if (heading) {
        headingSeen = true;
        version = heading[1];
        unreleased = Boolean(heading[2]);
        continue;
      }
    }
    if (!line.startsWith('- ')) continue;
    entries.push(parseEntryLine(line));
  }
  return { version, unreleased, entries };
}

export type ChangelogFilter = {
  /** YYYY-MM-DD, inclusive. An entry with no date never matches an active date range. */
  from?: string | null;
  to?: string | null;
  /** Only these categories. Empty or omitted means every category. */
  categories?: readonly string[] | null;
  /** A boolean per entry, same order and length as `entries` -- typically `useSearchMatches` output. */
  matches?: readonly boolean[] | null;
};

/** Date, category and text-search compose: each is a separate, independent narrowing of the same list. */
export function filterEntries(entries: readonly ChangelogEntry[], filter: ChangelogFilter = {}): ChangelogEntry[] {
  const { from, to, categories, matches } = filter;
  const activeCategories = categories && categories.length ? categories : null;
  const activeRange = Boolean(from || to);
  return entries.filter((entry, index) => {
    if (matches && matches[index] === false) return false;
    if (activeCategories && !activeCategories.includes(entry.category)) return false;
    if (activeRange) {
      if (!entry.date) return false;
      if (from && entry.date < from) return false;
      if (to && entry.date > to) return false;
    }
    return true;
  });
}

export type ChangelogExportFormat = 'markdown' | 'text';

export type ChangelogExportOptions = {
  range?: { from?: string | null; to?: string | null } | null;
  filters?: { categories?: readonly string[] | null; query?: string | null } | null;
};

/** Describes the exported slice in one line, so a file that left this app still says what it covers. */
function rangeLine(options: ChangelogExportOptions): string {
  const from = options.range?.from;
  const to = options.range?.to;
  const dates = from || to ? `${from ?? 'the first entry'} through ${to ?? 'the latest entry'}` : 'the full changelog';
  const categories = options.filters?.categories && options.filters.categories.length
    ? `categories: ${options.filters.categories.join(', ')}`
    : 'all categories';
  const query = options.filters?.query ? `matching "${options.filters.query}"` : null;
  return [`Exported range: ${dates}`, categories, query].filter(Boolean).join(' — ');
}

/** Serialises a filtered slice back to text. The caller has already applied `filterEntries`. */
export function exportEntries(entries: readonly ChangelogEntry[], format: ChangelogExportFormat, options: ChangelogExportOptions = {}): string {
  const header = rangeLine(options);
  const line = (entry: ChangelogEntry) => `${entry.date ?? 'unknown-date'}${SEPARATOR}${entry.category}${SEPARATOR}${entry.text}`;
  if (format === 'markdown') {
    const heading = `# GTHA Transit changelog export\n\n${header}\n`;
    return entries.length
      ? `${heading}\n${entries.map((entry) => `- ${line(entry)}`).join('\n')}\n`
      : `${heading}\n_No entries match the current filters._\n`;
  }
  const banner = `${header}\n${'-'.repeat(header.length)}\n`;
  return entries.length
    ? `${banner}\n${entries.map(line).join('\n\n')}\n`
    : `${banner}\nNo entries match the current filters.\n`;
}
