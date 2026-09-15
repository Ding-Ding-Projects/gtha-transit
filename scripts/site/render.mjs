/**
 * Pure HTML rendering for the generated documentation site.
 *
 * Everything here is a function of its arguments: no filesystem access, no
 * network access, nothing global. `build-site.mjs` does the I/O and calls
 * these; `tests/site-builder.test.mjs` calls them directly, which is the whole
 * reason the two are split.
 *
 * Markdown is parsed once by the project's own `lib/doc-markdown.ts` (the same
 * reader the in-app guides browser uses), and this module turns its typed
 * blocks into HTML strings. Nothing here reads raw Markdown text and nothing
 * here trusts a source string enough to write it into the page unescaped -
 * every text node in an `Inline` span goes through `escapeHtml` on its way
 * out, exactly as the parser's own comment promises: "nothing here produces
 * HTML, so nothing an article contains ... can become markup."
 */

import { parseMarkdown, resolveDocLink } from '../../lib/doc-markdown.ts';
import { categoryLabel, chrome } from './site-copy.mjs';

/** @typedef {'en' | 'zh' | 'bilingual'} SiteLanguage */
/** @typedef {'light' | 'dark'} SiteTheme */
/** @typedef {{ path: string; category: string; title: string; bytes: number; sha256: string }} ArticleRow */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for use inside HTML content or a double-quoted attribute. The
 * one function every rendered string passes through before it reaches a
 * template literal - see the module comment for why that is not optional. */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/**
 * Where an article's path (as recorded by `docs-bundle.mjs`, e.g.
 * `planning/vehicle-preferences.md`) is served on the generated site. A
 * `README.md` becomes its folder's `index.html`, matching the convention every
 * static host uses, so `docs/planning/README.md` -> `docs/planning/index.html`
 * and the bare `docs/README.md` -> `docs/index.html`.
 */
export function articleUrl(path) {
  const slash = path.lastIndexOf('/');
  const dir = slash === -1 ? '' : path.slice(0, slash);
  const base = slash === -1 ? path : path.slice(slash + 1);
  if (base === 'README.md') return dir ? `docs/${dir}/index.html` : 'docs/index.html';
  return `docs/${path.replace(/\.md$/, '.html')}`;
}

function renderInlineSpans(spans, ctx) {
  return spans.map((span) => renderInline(span, ctx)).join('');
}

function renderInline(span, ctx) {
  switch (span.kind) {
    case 'text':
      return escapeHtml(span.text);
    case 'code':
      return `<code>${escapeHtml(span.text)}</code>`;
    case 'strong':
      return `<strong>${renderInlineSpans(span.children, ctx)}</strong>`;
    case 'em':
      return `<em>${renderInlineSpans(span.children, ctx)}</em>`;
    case 'image':
      // Captures are not bundled with article text (see doc-markdown.ts), so
      // an inline image is shown as its alt text, exactly as the in-app
      // guides browser shows it. The landing page's own gallery uses real
      // committed captures directly, outside of any parsed article body.
      return `<span class="doc-image-alt">[${escapeHtml(span.alt)}]</span>`;
    case 'link': {
      const resolved = resolveDocLink(span.href, ctx.fromPath, ctx.known);
      const label = renderInlineSpans(span.children, ctx);
      if (resolved.kind === 'article') {
        const href = `${ctx.rootPrefix}${articleUrl(resolved.path)}${resolved.anchor ? `#${resolved.anchor}` : ''}`;
        return `<a href="${escapeHtml(href)}">${label}</a>`;
      }
      if (resolved.kind === 'anchor') return `<a href="#${escapeHtml(resolved.anchor)}">${label}</a>`;
      if (resolved.kind === 'external') {
        return `<a href="${escapeHtml(resolved.href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      }
      // 'refused': a non-http(s) scheme. Rendered as plain text, matching the
      // in-app browser's refusal to follow it anywhere.
      return label;
    }
    default:
      return '';
  }
}

function renderBlocks(blocks, ctx) {
  return blocks.map((block) => renderBlock(block, ctx)).join('\n');
}

function renderBlock(block, ctx) {
  switch (block.kind) {
    case 'heading': {
      // The article's own title is rendered by the page header, so a first
      // top-level heading that repeats it is skipped by the caller before
      // this runs; every remaining heading is offset by one level so the page
      // keeps a single h1.
      const level = Math.min(6, block.level + 1);
      return `<h${level} id="${escapeHtml(block.id)}">${renderInlineSpans(block.text, ctx)}</h${level}>`;
    }
    case 'paragraph':
      return `<p>${renderInlineSpans(block.text, ctx)}</p>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      const items = block.items.map((item) => `<li>${renderInlineSpans(item, ctx)}</li>`).join('');
      return `<${tag}>${items}</${tag}>`;
    }
    case 'code':
      return `<pre class="doc-code" tabindex="0"><code${block.language ? ` class="language-${escapeHtml(block.language)}"` : ''}>${escapeHtml(block.text)}</code></pre>`;
    case 'quote':
      return `<blockquote>${renderBlocks(block.blocks, ctx)}</blockquote>`;
    case 'table': {
      const head = block.header.map((cell) => `<th scope="col">${renderInlineSpans(cell, ctx)}</th>`).join('');
      const rows = block.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${renderInlineSpans(cell, ctx)}</td>`).join('')}</tr>`)
        .join('');
      return `<div class="doc-table" tabindex="0" role="region" aria-label="Table"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    case 'rule':
      return '<hr />';
    default:
      return '';
  }
}

/**
 * Renders one article's body to HTML. `source` is the raw Markdown text,
 * `path` is its docs-relative path (used to resolve relative links), and
 * `known` is the set of every article path the site publishes.
 */
export function renderArticleBody(source, path, known, siteBase = '/') {
  const blocks = parseMarkdown(source);
  const ctx = { fromPath: path, known, rootPrefix: siteBase };
  // Drop a leading level-1 heading that only repeats the page's own title,
  // exactly as the in-app reader does, so the title is never drawn twice.
  const withoutRepeatedTitle =
    blocks.length && blocks[0].kind === 'heading' && blocks[0].level === 1 ? blocks.slice(1) : blocks;
  return renderBlocks(withoutRepeatedTitle, ctx);
}

const REGEX_LIMITS = Object.freeze({ maxPatternLength: 512 });

/**
 * The client-side search index: one small JSON row per article, carrying only
 * what the search box needs to filter and link to it. No article body text is
 * included, so the index stays tiny at 70 articles or 7000.
 */
export function buildSearchIndex(articles, siteBase = '/') {
  return articles.map((article) => ({
    title: article.title,
    category: article.category,
    path: article.path,
    url: `${siteBase}${articleUrl(article.path)}`,
  }));
}

/** A small inline script, identical on every page, that drives the plain-text
 * search box and its regular-expression option against the page's own
 * `<script type="application/json" id="search-index">` payload. Kept as one
 * exported string so the same bytes are trivially testable and never diverge
 * between pages. */
export const SEARCH_SCRIPT = `(() => {
  const MAX_PATTERN_LENGTH = ${REGEX_LIMITS.maxPatternLength};
  const dataNode = document.getElementById('search-index');
  const input = document.getElementById('doc-search-input');
  const regexToggle = document.getElementById('doc-search-regex');
  const list = document.getElementById('doc-search-results');
  const errorNode = document.getElementById('doc-search-error');
  const emptyNode = document.getElementById('doc-search-empty');
  if (!dataNode || !input || !list) return;
  const index = JSON.parse(dataNode.textContent || '[]');
  const staticList = document.getElementById('doc-static-list');
  const render = () => {
    const query = input.value;
    let rows = index;
    let error = null;
    if (query.trim().length > 0) {
      if (regexToggle && regexToggle.checked) {
        if (query.length > MAX_PATTERN_LENGTH) {
          error = 'pattern-too-long';
        } else {
          try {
            const pattern = new RegExp(query, 'iu');
            rows = index.filter((row) => pattern.test(row.title + ' ' + row.category + ' ' + row.path));
          } catch {
            error = 'invalid-pattern';
          }
        }
      } else {
        const needle = query.toLocaleLowerCase();
        rows = index.filter((row) => (row.title + ' ' + row.category + ' ' + row.path).toLocaleLowerCase().includes(needle));
      }
    }
    if (error) rows = index;
    const active = query.trim().length > 0;
    if (errorNode) errorNode.hidden = !error;
    if (emptyNode) emptyNode.hidden = !active || rows.length !== 0 || Boolean(error);
    if (staticList) staticList.hidden = active;
    list.hidden = !active;
    list.innerHTML = rows
      .map((row) => '<li><a href="' + row.url.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '">' + row.title.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '<small>' + row.category.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</small></a></li>')
      .join('');
  };
  input.addEventListener('input', render);
  if (regexToggle) regexToggle.addEventListener('change', render);
  render();
})();`;

/** Reads and applies the persisted theme/language before first paint, so the
 * page never flashes the wrong theme. Kept tiny and inlined in <head>. */
export const PREFERENCES_SCRIPT = `(() => {
  const root = document.documentElement;
  const themeKey = 'gtha-docs-site.theme';
  const langKey = 'gtha-docs-site.language';
  let theme = 'light';
  try { theme = localStorage.getItem(themeKey) || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch {}
  let language = 'en';
  try { language = localStorage.getItem(langKey) || 'en'; } catch {}
  root.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
  root.setAttribute('data-lang', ['en', 'zh', 'bilingual'].includes(language) ? language : 'en');
})();`;

export const CONTROLS_SCRIPT = `(() => {
  const root = document.documentElement;
  const themeKey = 'gtha-docs-site.theme';
  const langKey = 'gtha-docs-site.language';
  const themeButton = document.getElementById('doc-theme-toggle');
  if (themeButton) {
    themeButton.addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(themeKey, next); } catch {}
    });
  }
  const langSelect = document.getElementById('doc-language-select');
  if (langSelect) {
    langSelect.value = root.getAttribute('data-lang') || 'en';
    langSelect.addEventListener('change', () => {
      const next = langSelect.value;
      root.setAttribute('data-lang', next);
      try { localStorage.setItem(langKey, next); } catch {}
    });
  }
})();`;

/**
 * The full HTML document for one page. `chromeLanguage` styles only the
 * chrome (nav, buttons, headings this function itself writes); article bodies
 * passed in `bodyHtml` are already rendered and are never re-translated.
 */
export function pageShell({
  siteBase,
  origin,
  path,
  title,
  description,
  bodyHtml,
  searchIndexJson,
  ogImagePath,
  headExtra = '',
}) {
  const canonical = `${origin}${siteBase}${path}`;
  const ogImage = `${origin}${siteBase}${ogImagePath}`;
  const assetBase = `${siteBase}assets/`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<link rel="canonical" href="${escapeHtml(canonical)}" />
<link rel="icon" href="${escapeHtml(`${siteBase}assets/favicon.svg`)}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${escapeHtml(canonical)}" />
<meta property="og:site_name" content="GTHA Transit" />
<meta property="og:image" content="${escapeHtml(ogImage)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="The GTHA Transit journey planner" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#071327" />
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#fcf9f0" />
<link rel="stylesheet" href="${escapeHtml(`${assetBase}fonts/space-grotesk/space-grotesk.css`)}" />
<link rel="stylesheet" href="${escapeHtml(`${assetBase}fonts/ibm-plex-mono/ibm-plex-mono.css`)}" />
<link rel="stylesheet" href="${escapeHtml(`${assetBase}fonts/material-symbols-outlined/material-symbols-outlined.css`)}" />
<link rel="stylesheet" href="${escapeHtml(`${assetBase}material-theme.css`)}" />
<link rel="stylesheet" href="${escapeHtml(`${assetBase}site.css`)}" />
<script>${PREFERENCES_SCRIPT}</script>
${headExtra}
</head>
<body>
<a class="skip-link" href="#doc-main"><span class="lang-en">${escapeHtml(chrome('skipToContent', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('skipToContent', 'zh'))}</span></a>
<header class="doc-header">
  <div class="doc-header__row">
    <a class="doc-header__brand" href="${escapeHtml(`${siteBase}index.html`)}">
      <span class="material-symbols-outlined" aria-hidden="true">directions_bus</span>
      <span>GTHA Transit</span>
    </a>
    <nav class="doc-header__nav" aria-label="Site">
      <a href="${escapeHtml(`${siteBase}index.html`)}"><span class="lang-en">${escapeHtml(chrome('navHome', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('navHome', 'zh'))}</span></a>
      <a href="${escapeHtml(`${siteBase}docs/index.html`)}"><span class="lang-en">${escapeHtml(chrome('navDocs', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('navDocs', 'zh'))}</span></a>
      <a href="https://toronto-transit.org"><span class="lang-en">${escapeHtml(chrome('openPlanner', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('openPlanner', 'zh'))}</span></a>
    </nav>
    <div class="doc-header__controls">
      <label class="doc-language-picker">
        <span class="sr-only">${escapeHtml(chrome('languageLabel', 'en'))}</span>
        <select id="doc-language-select">
          <option value="en">${escapeHtml(chrome('languageEnglish', 'en'))}</option>
          <option value="zh">${escapeHtml(chrome('languageCantonese', 'en'))}</option>
          <option value="bilingual">${escapeHtml(chrome('languageBilingual', 'en'))}</option>
        </select>
      </label>
      <button type="button" id="doc-theme-toggle" aria-label="${escapeHtml(chrome('themeToggle', 'en'))}">
        <span class="material-symbols-outlined" aria-hidden="true">dark_mode</span>
      </button>
    </div>
  </div>
</header>
<main id="doc-main">
${bodyHtml}
</main>
<footer class="doc-footer">
  <p><span class="lang-en">${escapeHtml(chrome('footerBuiltFrom', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('footerBuiltFrom', 'zh'))}</span></p>
  <p><span class="lang-en">${escapeHtml(chrome('footerNotAffiliated', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('footerNotAffiliated', 'zh'))}</span></p>
  <p><a href="https://github.com/Ding-Ding-Projects/gtha-transit" target="_blank" rel="noopener noreferrer">${escapeHtml(chrome('viewOnGitHub', 'en'))}</a></p>
</footer>
${searchIndexJson ? `<script id="search-index" type="application/json">${searchIndexJson.replace(/<\/script/gi, '<\\/script')}</script>` : ''}
<script>${CONTROLS_SCRIPT}</script>
${searchIndexJson ? `<script>${SEARCH_SCRIPT}</script>` : ''}
</body>
</html>
`;
}

export { categoryLabel, chrome };
