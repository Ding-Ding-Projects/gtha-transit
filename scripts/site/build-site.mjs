#!/usr/bin/env node
/**
 * Builds the public documentation and landing site from docs/.
 *
 * This is a second, separate publication of the same articles the in-app
 * About destination reads offline (see docs/interface/about.md): that browser
 * lives inside the planner and needs the planner running; this one is a
 * static site meant to be found before anyone has opened the app at all, so
 * it is generated straight to a gitignored output folder rather than shipped
 * inside the application bundle.
 *
 * It reuses the project's own article index (`scripts/docs-bundle.mjs`) and
 * its own Markdown reader and link resolver (`lib/doc-markdown.ts`), so an
 * article that is safe to show in the app is rendered by the same parser
 * here - the escaping and link-refusal rules do not have a second
 * implementation to fall out of step with the first.
 *
 * Usage:
 *   node scripts/site/build-site.mjs [--out <dir>] [--base </path/>] [--origin <https://host>] [--check]
 *
 *   --out     Output directory. Defaults to site-dist/ at the repository root.
 *   --base    The site's path prefix once deployed, always starting and
 *             ending with a slash. Defaults to /gtha-transit/, the path a
 *             GitHub Pages project site serves at.
 *   --origin  The scheme and host the site is served from, no trailing
 *             slash. Defaults to https://ding-ding-projects.github.io.
 *   --check   Builds in memory and reports counts without writing anything.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIndex } from '../docs-bundle.mjs';
import {
  articleUrl,
  buildSearchIndex,
  categoryLabel,
  chrome,
  escapeHtml,
  pageShell,
  renderArticleBody,
} from './render.mjs';
import { SITE_COPY } from './site-copy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

function cliArg(flag, fallback) {
  const at = process.argv.indexOf(flag);
  return at >= 0 && process.argv[at + 1] !== undefined ? process.argv[at + 1] : fallback;
}

const OUT_DIR = path.resolve(root, cliArg('--out', 'site-dist'));
const SITE_BASE = (() => {
  const value = cliArg('--base', process.env.SITE_BASE || '/gtha-transit/');
  return value.startsWith('/') ? value : `/${value}`;
})();
const SITE_ORIGIN = cliArg('--origin', process.env.SITE_ORIGIN || 'https://ding-ding-projects.github.io').replace(/\/$/, '');
const CHECK_ONLY = process.argv.includes('--check');

/** Real, committed captures of the built application. Never a mockup: every
 * file here is either the interaction ledger's own evidence (docs/interface/
 * captures/) or a design-parity capture of the real app (docs/design/parity/
 * *-app.png), exactly as the project's README already uses for its own
 * gallery. */
const GALLERY = [
  { file: 'design/parity/plan-app.png', alt: { en: 'The journey composer, planning a trip across agencies', zh: '行程規劃工具，跨機構規劃一程路線' } },
  { file: 'design/parity/live-app.png', alt: { en: 'Live TTC subway and light rail status, agency by agency', zh: 'TTC 地鐵同輕鐵嘅即時狀況，按機構顯示' } },
  { file: 'design/parity/fleet-app.png', alt: { en: 'The vehicle tracker, with its route picker and live map', zh: '車輛追蹤工具，有路線選擇器同即時地圖' } },
  { file: 'interface/captures/navigation-rail-1440-light.png', alt: { en: 'The desktop navigation rail in the light theme', zh: '桌面版側邊導覽列，淺色主題' } },
  { file: 'interface/captures/mobile-navigation-390-light.png', alt: { en: 'The phone bottom navigation bar', zh: '手機底部導覽列' } },
  { file: 'interface/captures/command-palette-1440-light.png', alt: { en: 'The command palette, jumping straight to a setting', zh: '指令面板，直接跳去某個設定' } },
  { file: 'design/parity/settings-app.png', alt: { en: 'Settings, with independent search for every section', zh: '設定頁面，每部分都有獨立搜尋' } },
];

/** The exact features this generator must ship. Checked at the end of every
 * build, in memory or on disk, so a change that silently drops one of them
 * fails the build rather than shipping a smaller site than the last one. */
const REQUIRED_FEATURES = [
  { id: 'landing-page', test: (pages) => pages.has('index.html') },
  { id: 'docs-index', test: (pages) => pages.has('docs/index.html') },
  { id: 'article-pages', test: (pages) => [...pages.keys()].some((p) => p.startsWith('docs/') && p !== 'docs/index.html') },
  { id: 'search-plain-text', test: (pages) => pages.get('docs/index.html')?.includes('doc-search-input') },
  { id: 'search-regex-option', test: (pages) => pages.get('docs/index.html')?.includes('doc-search-regex') },
  { id: 'language-modes', test: (pages) => pages.get('index.html')?.includes('doc-language-select') && pages.get('index.html')?.includes('lang-zh') },
  { id: 'theme-toggle', test: (pages) => pages.get('index.html')?.includes('doc-theme-toggle') },
  { id: 'material-design-tokens', test: (_pages, assets) => assets.has('assets/material-theme.css') },
  { id: 'vendored-fonts', test: () => existsSync(path.join(root, 'public', 'fonts', 'space-grotesk', 'space-grotesk.css')) },
  { id: 'responsive-viewport', test: (pages) => pages.get('index.html')?.includes('name="viewport"') },
  { id: 'accessible-skip-link', test: (pages) => pages.get('index.html')?.includes('skip-link') },
  { id: 'version-and-build-date', test: (pages) => pages.get('index.html')?.includes('doc-build-version') && pages.get('index.html')?.includes('doc-build-date') },
  { id: 'social-preview-image', test: (pages) => pages.get('index.html')?.includes('og:image') && pages.get('index.html')?.includes('https://') },
];

function gitCommit() {
  if (process.env.SOURCE_COMMIT) return process.env.SOURCE_COMMIT;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: root }).trim();
  } catch {
    return null;
  }
}

function commitDate(commit) {
  if (!commit) return null;
  try {
    return execFileSync('git', ['show', '-s', '--format=%cI', commit], { encoding: 'utf8', cwd: root }).trim();
  } catch {
    return null;
  }
}

function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  return pkg.version;
}

function landingBody({ version, commit, builtAt, articles, siteBase }) {
  const gallery = GALLERY.map(
    (item) => `<figure class="landing-gallery__item"><img src="${escapeHtml(`${siteBase}assets/gallery/${path.basename(item.file)}`)}" alt="${escapeHtml(item.alt.en)}" loading="lazy" width="1440" height="900" /><figcaption><span class="lang-en">${escapeHtml(item.alt.en)}</span><span class="lang-zh">${escapeHtml(item.alt.zh)}</span></figcaption></figure>`,
  ).join('\n');

  const features = [
    { en: 'Cross-agency journey planning with walking connections', zh: '跨機構行程規劃，包括步行接駁' },
    { en: 'Official TTC subway and light rail alerts, with receipt freshness shown separately', zh: 'TTC 地鐵同輕鐵嘅官方公告，接收時間獨立顯示' },
    { en: 'Live vehicle tracking for TTC, GO, UP, MiWay, Burlington and HSR', zh: 'TTC、GO、UP、MiWay、Burlington 同 HSR 嘅即時車輛追蹤' },
    { en: 'English, Cantonese and bilingual presentation, light and dark appearance', zh: '英文、廣東話同雙語顯示，淺色同深色主題' },
    { en: 'Saved trips, disruption history and exports, all in your browser', zh: '已儲存行程、擾亂歷史同匯出，全部喺你部瀏覽器入面' },
  ].map((feature) => `<li><span class="lang-en">${escapeHtml(feature.en)}</span><span class="lang-zh">${escapeHtml(feature.zh)}</span></li>`).join('\n');

  const categories = [...new Set(articles.map((article) => article.category))].sort();
  const categoryLinks = categories
    .map((category) => {
      const count = articles.filter((article) => article.category === category).length;
      return `<li><a href="${escapeHtml(`${siteBase}docs/index.html#${category}`)}">${escapeHtml(categoryLabel(category, 'bilingual'))} <span class="landing-category__count">${count}</span></a></li>`;
    })
    .join('\n');

  return `
<section class="landing-hero">
  <p class="eyebrow"><span class="lang-en">${escapeHtml(chrome('tagline', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('tagline', 'zh'))}</span></p>
  <h1><span class="lang-en">${escapeHtml(chrome('homeHeroHeading', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('homeHeroHeading', 'zh'))}</span></h1>
  <p class="landing-hero__body"><span class="lang-en">${escapeHtml(chrome('homeHeroBody', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('homeHeroBody', 'zh'))}</span></p>
  <div class="landing-hero__actions">
    <a class="button button--filled" href="https://toronto-transit.org"><span class="lang-en">${escapeHtml(chrome('openPlanner', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('openPlanner', 'zh'))}</span></a>
    <a class="button button--outlined" href="${escapeHtml(`${siteBase}docs/index.html`)}"><span class="lang-en">${escapeHtml(chrome('navDocs', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('navDocs', 'zh'))}</span></a>
  </div>
  <p class="landing-hero__provenance">
    <span class="lang-en">${escapeHtml(chrome('versionLabel', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('versionLabel', 'zh'))}</span>
    <code id="doc-build-version">v${escapeHtml(version)}</code>
    ${commit ? `· <span class="lang-en">${escapeHtml(chrome('commitLabel', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('commitLabel', 'zh'))}</span> <code><a href="${escapeHtml(`https://github.com/Ding-Ding-Projects/gtha-transit/commit/${commit}`)}" target="_blank" rel="noopener noreferrer">${escapeHtml(commit.slice(0, 7))}</a></code>` : ''}
    ${builtAt ? `· <span class="lang-en">${escapeHtml(chrome('updatedLabel', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('updatedLabel', 'zh'))}</span> <time id="doc-build-date" datetime="${escapeHtml(builtAt)}">${escapeHtml(builtAt)}</time>` : '<span id="doc-build-date" hidden></span>'}
  </p>
</section>
<section class="landing-gallery" aria-label="Screenshots">
  <h2><span class="lang-en">${escapeHtml(chrome('homeGalleryHeading', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('homeGalleryHeading', 'zh'))}</span></h2>
  <p><span class="lang-en">${escapeHtml(chrome('homeGalleryBody', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('homeGalleryBody', 'zh'))}</span></p>
  <div class="landing-gallery__grid">
${gallery}
  </div>
</section>
<section class="landing-features">
  <h2><span class="lang-en">${escapeHtml(chrome('homeFeaturesHeading', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('homeFeaturesHeading', 'zh'))}</span></h2>
  <ul class="landing-features__list">
${features}
  </ul>
</section>
<section class="landing-docs">
  <h2><span class="lang-en">${escapeHtml(chrome('homeDocsHeading', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('homeDocsHeading', 'zh'))}</span></h2>
  <p><span class="lang-en">${escapeHtml(chrome('homeDocsBody', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('homeDocsBody', 'zh'))}</span> (<span id="doc-article-count">${articles.length}</span> <span class="lang-en">${escapeHtml(chrome('articlesCount', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('articlesCount', 'zh'))}</span>)</p>
  <ul class="landing-category-list">
${categoryLinks}
  </ul>
</section>
`;
}

function docsHubBody(articles, siteBase) {
  const grouped = new Map();
  for (const article of articles) {
    if (!grouped.has(article.category)) grouped.set(article.category, []);
    grouped.get(article.category).push(article);
  }
  const sections = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, rows]) => {
      const items = rows
        .map((row) => `<li><a href="${escapeHtml(`${siteBase}${articleUrl(row.path)}`)}">${escapeHtml(row.title)}</a> <small>${escapeHtml(row.path)}</small></li>`)
        .join('\n');
      return `<section class="doc-index__group" id="${escapeHtml(category)}"><h3>${escapeHtml(categoryLabel(category, 'bilingual'))}</h3><ul>\n${items}\n</ul></section>`;
    })
    .join('\n');

  return `
<h1><span class="lang-en">${escapeHtml(chrome('navDocs', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('navDocs', 'zh'))}</span></h1>
<p><span class="lang-en">${escapeHtml(chrome('homeDocsBody', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('homeDocsBody', 'zh'))}</span></p>
<div class="doc-search">
  <label class="doc-search__field">
    <span class="sr-only"><span class="lang-en">${escapeHtml(chrome('searchLabel', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('searchLabel', 'zh'))}</span></span>
    <span class="material-symbols-outlined" aria-hidden="true">search</span>
    <input id="doc-search-input" type="search" placeholder="${escapeHtml(chrome('searchPlaceholder', 'en'))}" autocomplete="off" />
  </label>
  <label class="doc-search__regex">
    <input id="doc-search-regex" type="checkbox" />
    <span class="lang-en">${escapeHtml(chrome('regexToggle', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('regexToggle', 'zh'))}</span>
  </label>
  <p id="doc-search-error" role="alert" hidden><span class="lang-en">${escapeHtml(chrome('regexError', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('regexError', 'zh'))}</span></p>
  <p id="doc-search-empty" hidden><span class="lang-en">${escapeHtml(chrome('noResults', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('noResults', 'zh'))}</span></p>
  <ul id="doc-search-results" class="doc-search__results" hidden></ul>
</div>
<div id="doc-static-list" class="doc-index">
${sections}
</div>
`;
}

function build() {
  const version = readPackageVersion();
  const commit = gitCommit();
  const builtAt = commitDate(commit);
  const articles = buildIndex().sort((a, b) => a.path.localeCompare(b.path));
  const known = new Set(articles.map((article) => article.path));
  const searchIndexJson = JSON.stringify(buildSearchIndex(articles, SITE_BASE));

  /** @type {Map<string, string>} rendered page path -> HTML */
  const pages = new Map();

  pages.set(
    'index.html',
    pageShell({
      siteBase: SITE_BASE,
      origin: SITE_ORIGIN,
      path: 'index.html',
      title: `${SITE_COPY.siteName.en} – ${chrome('homeHeroHeading', 'en')}`,
      description: SITE_COPY.homeHeroBody.en,
      bodyHtml: landingBody({ version, commit, builtAt, articles, siteBase: SITE_BASE }),
      searchIndexJson,
      ogImagePath: 'assets/social-preview.png',
    }),
  );

  pages.set(
    'docs/index.html',
    pageShell({
      siteBase: SITE_BASE,
      origin: SITE_ORIGIN,
      path: 'docs/index.html',
      title: `${chrome('navDocs', 'en')} – ${SITE_COPY.siteName.en}`,
      description: chrome('homeDocsBody', 'en'),
      bodyHtml: docsHubBody(articles, SITE_BASE),
      searchIndexJson,
      ogImagePath: 'assets/social-preview.png',
    }),
  );

  for (const article of articles) {
    if (article.path === 'README.md') continue; // superseded by the generated docs hub above
    const url = articleUrl(article.path);
    const source = readFileSync(path.join(root, 'docs', article.path), 'utf8');
    const bodyHtml = renderArticleBody(source, article.path, known, SITE_BASE);
    const crumbCategory = categoryLabel(article.category, 'bilingual');
    pages.set(
      url,
      pageShell({
        siteBase: SITE_BASE,
        origin: SITE_ORIGIN,
        path: url,
        title: `${article.title} – ${SITE_COPY.siteName.en}`,
        description: `${article.title} (${article.category}) – GTHA Transit documentation.`,
        bodyHtml: `<nav class="doc-breadcrumb" aria-label="Breadcrumb"><a href="${escapeHtml(`${SITE_BASE}docs/index.html`)}">${escapeHtml(chrome('navDocs', 'en'))}</a> <span aria-hidden="true">/</span> <span>${escapeHtml(crumbCategory)}</span></nav>
<article class="doc-article">
<h1>${escapeHtml(article.title)}</h1>
<p class="doc-article__source"><code>docs/${escapeHtml(article.path)}</code> · <a href="https://github.com/Ding-Ding-Projects/gtha-transit/blob/main/docs/${escapeHtml(article.path)}" target="_blank" rel="noopener noreferrer">${escapeHtml(chrome('viewArticleOnGitHub', 'en'))}</a></p>
<p class="doc-article__note"><span class="lang-en">${escapeHtml(chrome('articleSourceNote', 'en'))}</span><span class="lang-zh">${escapeHtml(chrome('articleSourceNote', 'zh'))}</span></p>
${bodyHtml}
</article>`,
      }),
    );
  }

  const assets = new Map();
  assets.set('assets/material-theme.css', readFileSync(path.join(root, 'app', 'material-theme.css'), 'utf8'));
  assets.set('assets/site.css', SITE_CSS);

  const inventory = REQUIRED_FEATURES.filter((feature) => !feature.test(pages, assets));
  if (inventory.length > 0) {
    throw new Error(
      `scripts/site/build-site.mjs: the generated site is missing required feature(s): ${inventory.map((f) => f.id).join(', ')}`,
    );
  }

  return { pages, assets, version, commit, builtAt, articles };
}

const SITE_CSS = readFileSync(path.join(here, 'site.css'), 'utf8');

function writeSite({ pages, assets, articles }) {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  for (const [relativePath, html] of pages) {
    const target = path.join(OUT_DIR, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, html);
  }

  for (const [relativePath, content] of assets) {
    const target = path.join(OUT_DIR, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  cpSync(path.join(root, 'public', 'fonts'), path.join(OUT_DIR, 'assets', 'fonts'), { recursive: true });
  cpSync(path.join(root, 'public', 'favicon.svg'), path.join(OUT_DIR, 'assets', 'favicon.svg'));

  const socialPreviewSource = path.join(root, 'public', 'social-preview.png');
  if (!existsSync(socialPreviewSource)) {
    throw new Error(
      'scripts/site/build-site.mjs: public/social-preview.png is missing. Run `node scripts/site/build-social-preview.mjs` first.',
    );
  }
  mkdirSync(path.join(OUT_DIR, 'assets'), { recursive: true });
  cpSync(socialPreviewSource, path.join(OUT_DIR, 'assets', 'social-preview.png'));

  mkdirSync(path.join(OUT_DIR, 'assets', 'gallery'), { recursive: true });
  for (const item of GALLERY) {
    cpSync(path.join(root, 'docs', item.file), path.join(OUT_DIR, 'assets', 'gallery', path.basename(item.file)));
  }

  const manifest = {
    schemaVersion: 1,
    generatedBy: 'scripts/site/build-site.mjs',
    pages: pages.size,
    articles: articles.length,
    base: SITE_BASE,
    origin: SITE_ORIGIN,
  };
  writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function totalBytes(pages, assets) {
  let bytes = 0;
  for (const html of pages.values()) bytes += Buffer.byteLength(html);
  for (const content of assets.values()) bytes += Buffer.byteLength(content);
  return bytes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = build();
  const generatedBytes = totalBytes(result.pages, result.assets);
  console.log(
    `scripts/site/build-site.mjs: ${result.pages.size} pages from ${result.articles.length} articles, ` +
      `${generatedBytes} bytes of generated HTML/CSS (fonts and captures not counted)` +
      `${CHECK_ONLY ? ' (--check, not writing)' : ` → ${path.relative(root, OUT_DIR)}`}.`,
  );
  console.log(`  base ${SITE_BASE}, origin ${SITE_ORIGIN}, version ${result.version}, commit ${result.commit ?? 'unknown'}.`);
  if (!CHECK_ONLY) writeSite(result);
}

export { build, docsHubBody, gitCommit, GALLERY, landingBody, REQUIRED_FEATURES };
