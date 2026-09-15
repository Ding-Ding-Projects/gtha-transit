/**
 * A small Markdown reader for the project's own documentation.
 *
 * It turns an article into typed blocks and inline spans that a component
 * renders as ordinary React elements. Nothing here produces HTML, so nothing an
 * article contains, including a stray `<script>` in a code sample, can become
 * markup. That is the whole reason not to reach for an HTML renderer: the docs
 * are ours, but the browser showing them should not have to trust that.
 *
 * It covers what docs/ actually uses: ATX headings, paragraphs, bullet and
 * numbered lists, fenced code, block quotes, pipe tables and horizontal rules,
 * with inline code, bold, italic and links. Images are shown as their alt text,
 * because the captures they point at are not bundled. Anything it does not
 * recognise is kept as plain paragraph text rather than dropped.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'link'; href: string; children: Inline[] }
  | { kind: 'image'; alt: string };

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: Inline[]; id: string }
  | { kind: 'paragraph'; text: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'code'; language: string; text: string }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { kind: 'rule' };

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

const INLINE_RE = /(`+)([\s\S]*?)\1|!\[([^\]]*)\]\([^)]*\)|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*([^*\s][\s\S]*?)\*|_([^_\s][\s\S]*?)_/g;

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of source.matchAll(INLINE_RE)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: source.slice(last, at) });
    if (match[1]) out.push({ kind: 'code', text: match[2].trim() });
    else if (match[3] !== undefined && match[0].startsWith('!')) out.push({ kind: 'image', alt: match[3] });
    else if (match[4] !== undefined) out.push({ kind: 'link', href: match[5], children: parseInline(match[4]) });
    else if (match[6] !== undefined || match[7] !== undefined) out.push({ kind: 'strong', children: parseInline(match[6] ?? match[7]) });
    else out.push({ kind: 'em', children: parseInline(match[8] ?? match[9]) });
    last = at + match[0].length;
  }
  if (last < source.length) out.push({ kind: 'text', text: source.slice(last) });
  return out;
}

/** Plain text of inline spans, for headings' ids, titles and search. */
export function inlineText(spans: readonly Inline[]): string {
  return spans.map((span) => {
    if (span.kind === 'text' || span.kind === 'code') return span.text;
    if (span.kind === 'image') return span.alt;
    return inlineText(span.children);
  }).join('');
}

const tableCells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
const isTableRule = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
const listItem = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  const seen = new Map<string, number>();
  let index = 0;
  const uniqueId = (text: string) => {
    const base = slugify(text) || 'section';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  };

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const fence = /^\s*(```+|~~~+)\s*([\w+-]*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) { body.push(lines[index]); index += 1; }
      index += 1;
      blocks.push({ kind: 'code', language: fence[2] ?? '', text: body.join('\n') });
      continue;
    }

    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const text = parseInline(heading[2]);
      blocks.push({ kind: 'heading', level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6, text, id: uniqueId(inlineText(text)) });
      index += 1;
      continue;
    }

    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) { blocks.push({ kind: 'rule' }); index += 1; continue; }

    if (line.trim().startsWith('>')) {
      const body: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('>')) { body.push(lines[index].trim().replace(/^>\s?/, '')); index += 1; }
      blocks.push({ kind: 'quote', blocks: parseMarkdown(body.join('\n')) });
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isTableRule(lines[index + 1])) {
      const header = tableCells(line).map(parseInline);
      index += 2;
      const rows: Inline[][][] = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) { rows.push(tableCells(lines[index]).map(parseInline)); index += 1; }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    const first = listItem.exec(line);
    if (first) {
      const ordered = Boolean(first[2]);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index];
        const item = listItem.exec(current);
        if (item && Boolean(item[2]) === ordered && /^\s{0,3}\S/.test(current)) { items.push(item[3]); index += 1; continue; }
        if (current.trim() && /^\s{2,}/.test(current) && items.length && !listItem.exec(current)) { items[items.length - 1] += ` ${current.trim()}`; index += 1; continue; }
        if (item && /^\s{2,}/.test(current) && items.length) { items[items.length - 1] += ` ${item[3]}`; index += 1; continue; }
        break;
      }
      blocks.push({ kind: 'list', ordered, items: items.map(parseInline) });
      continue;
    }

    const body: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,6})\s/.test(lines[index]) && !/^\s*(```|~~~)/.test(lines[index]) && !lines[index].trim().startsWith('>') && !listItem.exec(lines[index])) {
      body.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ kind: 'paragraph', text: parseInline(body.join(' ')) });
  }
  return blocks;
}

/**
 * Where a link inside an article should go.
 *
 * A relative link to another article becomes an in-app route to it, resolved
 * against the article's own folder, with any `#anchor` kept. A link to a file the
 * bundle does not carry, or that climbs out of docs/, goes to the repository on
 * GitHub instead. Only http and https leave the app; any other scheme is refused.
 */
export type ResolvedLink =
  | { kind: 'article'; path: string; anchor: string | null }
  | { kind: 'anchor'; anchor: string }
  | { kind: 'external'; href: string }
  | { kind: 'refused' };

export const REPOSITORY_URL = 'https://github.com/Ding-Ding-Projects/gtha-transit';

export function resolveDocLink(href: string, fromPath: string, known: ReadonlySet<string>): ResolvedLink {
  const trimmed = href.trim();
  if (trimmed.startsWith('#')) return { kind: 'anchor', anchor: trimmed.slice(1) };
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  if (scheme) return /^https?$/i.test(scheme[1]) ? { kind: 'external', href: trimmed } : { kind: 'refused' };
  const [target, anchor = null] = trimmed.split('#', 2) as [string, string | null];
  const folder = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  const parts = [...(folder ? folder.split('/') : []), ...target.split('/')];
  const resolved: string[] = [];
  let escaped = false;
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') { if (resolved.length) resolved.pop(); else escaped = true; continue; }
    resolved.push(part);
  }
  const joined = resolved.join('/');
  if (!escaped && known.has(joined)) return { kind: 'article', path: joined, anchor };
  if (!escaped && known.has(`${joined}/README.md`)) return { kind: 'article', path: `${joined}/README.md`, anchor };
  const repoPath = escaped ? resolved.join('/') : `docs/${joined}`;
  return { kind: 'external', href: `${REPOSITORY_URL}/blob/main/${repoPath}${anchor ? `#${anchor}` : ''}` };
}
