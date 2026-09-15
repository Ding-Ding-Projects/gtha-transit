import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildIndex } from '../scripts/docs-bundle.mjs';
import {
  articleUrl,
  buildSearchIndex,
  CONTROLS_SCRIPT,
  escapeHtml,
  pageShell,
  PREFERENCES_SCRIPT,
  renderArticleBody,
  SEARCH_SCRIPT,
} from '../scripts/site/render.mjs';
import { docsHubBody, GALLERY, landingBody, REQUIRED_FEATURES } from '../scripts/site/build-site.mjs';

const SITE_BASE = '/gtha-transit/';
const ORIGIN = 'https://ding-ding-projects.github.io';

test('escapeHtml neutralises every HTML-significant character', () => {
  assert.equal(escapeHtml(`<script>alert("x" & 'y')</script>`), '&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;');
  assert.equal(escapeHtml(123), '123');
});

test('articleUrl turns a README into its folder index, and anything else into a matching .html file', () => {
  assert.equal(articleUrl('README.md'), 'docs/index.html');
  assert.equal(articleUrl('planning/README.md'), 'docs/planning/index.html');
  assert.equal(articleUrl('planning/vehicle-preferences.md'), 'docs/planning/vehicle-preferences.html');
  assert.equal(articleUrl('interface/about.md'), 'docs/interface/about.html');
});

test('every real article under docs/ renders without throwing, and never emits raw markup from its own text', () => {
  const articles = buildIndex();
  const known = new Set(articles.map((article) => article.path));
  assert.ok(articles.length > 0, 'docs/ should contain at least one article');
  for (const article of articles) {
    const source = readFileSync(new URL(`../docs/${article.path}`, import.meta.url), 'utf8');
    const html = renderArticleBody(source, article.path, known, SITE_BASE);
    assert.equal(typeof html, 'string');
    // A raw, un-escaped opening tag that did not come from this renderer's own
    // small vocabulary of elements would mean some article text leaked
    // through unescaped. Collect the renderer's own tag names once and
    // confirm every "<letters" in the output is one of them.
    const allowedTags = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'pre', 'code', 'blockquote', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'a', 'strong', 'em', 'span']);
    for (const match of html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)/g)) {
      assert.ok(allowedTags.has(match[1]), `${article.path}: unexpected tag <${match[1]}> in rendered output`);
    }
  }
});

test('markup inside an article body is escaped, never passed through as HTML', () => {
  const html = renderArticleBody('# Title\n\n<script>alert(1)</script> and <img src=x onerror=y>.', 'interface/x.md', new Set(['interface/x.md']));
  assert.ok(!html.includes('<script>'), 'a literal <script> tag must never appear in rendered output');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=y&gt;'));
});

test('a link to a known sibling article is rewritten to its site URL, with the deployment base and any anchor kept', () => {
  const known = new Set(['planning/README.md', 'planning/vehicle-preferences.md']);
  const html = renderArticleBody('# Title\n\nSee [preferences](vehicle-preferences.md#electric).', 'planning/README.md', known, SITE_BASE);
  assert.ok(html.includes(`href="${SITE_BASE}docs/planning/vehicle-preferences.html#electric"`), html);
});

test('a link to an unbundled file goes to GitHub instead, and a non-http(s) scheme is refused rather than linked', () => {
  const known = new Set(['planning/README.md']);
  const html = renderArticleBody('# Title\n\n[missing](missing.md) and [file it](file:///etc/passwd).', 'planning/README.md', known, SITE_BASE);
  assert.ok(html.includes('https://github.com/Ding-Ding-Projects/gtha-transit/blob/main/docs/planning/missing.md'), html);
  assert.ok(!html.includes('file:///'), 'a refused scheme must never reach an href');
  assert.ok(html.includes('file it'), 'the refused link’s text still renders');
  assert.ok(!/<a[^>]*>file it<\/a>/.test(html), 'a refused link must render as plain text, never as an anchor');
});

test('an external http(s) link opens in a new tab without leaking window.opener', () => {
  const html = renderArticleBody('# Title\n\n[TTC](https://www.ttc.ca).', 'status/x.md', new Set(['status/x.md']));
  assert.ok(html.includes('target="_blank" rel="noopener noreferrer"'));
});

test('a repeated top-level heading that only restates the article title is dropped once, not every time', () => {
  const withTitle = renderArticleBody('# Repeated\n\nBody one.\n\n# Repeated\n\nBody two.', 'a.md', new Set(['a.md']));
  assert.equal((withTitle.match(/Repeated/g) || []).length, 1, 'only the second, non-leading heading should survive');
});

test('the search index carries every article once, with a site-base-prefixed absolute path', () => {
  const articles = buildIndex();
  const index = buildSearchIndex(articles, SITE_BASE);
  assert.equal(index.length, articles.length);
  for (const row of index) {
    assert.ok(row.url.startsWith(SITE_BASE), row.url);
    assert.ok(row.url.endsWith('.html'), row.url);
  }
  const readme = index.find((row) => row.path === 'README.md');
  assert.equal(readme.url, `${SITE_BASE}docs/index.html`);
});

test('the search script defaults to plain text and only treats the query as a pattern behind its own toggle', () => {
  assert.ok(SEARCH_SCRIPT.includes("regexToggle.checked"));
  assert.ok(SEARCH_SCRIPT.includes('toLocaleLowerCase'), 'the non-regex branch must exist as the default path');
  assert.ok(SEARCH_SCRIPT.includes('try {') && SEARCH_SCRIPT.includes('catch'), 'an invalid pattern must be caught, not thrown to the page');
});

test('the preferences and controls scripts never read a value that was not validated against the known set', () => {
  assert.ok(PREFERENCES_SCRIPT.includes("['en', 'zh', 'bilingual'].includes"));
  assert.ok(CONTROLS_SCRIPT.includes('doc-theme-toggle'));
});

test('pageShell serves no CDN or remote font URL anywhere in the document', () => {
  const html = pageShell({
    siteBase: SITE_BASE,
    origin: ORIGIN,
    path: 'index.html',
    title: 'Test',
    description: 'Test page',
    bodyHtml: '<p>Body</p>',
    searchIndexJson: '[]',
    ogImagePath: 'assets/social-preview.png',
  });
  assert.ok(!/https:\/\/fonts\.googleapis\.com/.test(html), 'no Google Fonts CSS URL');
  assert.ok(!/https:\/\/fonts\.gstatic\.com/.test(html), 'no Google Fonts binary URL');
  assert.ok(!/cdn\./i.test(html), 'no CDN host referenced');
  assert.ok(html.includes('assets/fonts/space-grotesk/space-grotesk.css'));
  assert.ok(html.includes('assets/material-theme.css'));
});

test('pageShell emits an absolute https og:image with matching width, height and alt, plus summary_large_image', () => {
  const html = pageShell({
    siteBase: SITE_BASE,
    origin: ORIGIN,
    path: 'docs/index.html',
    title: 'Docs',
    description: 'Docs',
    bodyHtml: '<p>Body</p>',
    ogImagePath: 'assets/social-preview.png',
  });
  const match = /<meta property="og:image" content="([^"]+)" \/>/.exec(html);
  assert.ok(match, 'og:image tag must be present');
  const url = new URL(match[1]);
  assert.equal(url.protocol, 'https:');
  assert.equal(match[1], 'https://ding-ding-projects.github.io/gtha-transit/assets/social-preview.png');
  assert.ok(html.includes('<meta property="og:image:width" content="1200" />'));
  assert.ok(html.includes('<meta property="og:image:height" content="630" />'));
  assert.ok(html.includes('<meta property="og:image:alt" content='));
  assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image" />'));
  assert.ok(html.includes('<meta property="og:url" content="https://ding-ding-projects.github.io/gtha-transit/docs/index.html" />'));
});

test('pageShell carries both a plain-text search field and its regular-expression option when given an index', () => {
  const html = pageShell({
    siteBase: SITE_BASE,
    origin: ORIGIN,
    path: 'docs/index.html',
    title: 'Docs',
    description: 'Docs',
    bodyHtml: '<input id="doc-search-input" /><input id="doc-search-regex" type="checkbox" />',
    searchIndexJson: '[{"title":"x"}]',
    ogImagePath: 'assets/social-preview.png',
  });
  assert.ok(html.includes('id="search-index"'));
  assert.ok(html.includes(SEARCH_SCRIPT));
});

test('a search index payload containing "</script" cannot terminate the embedding script tag early', () => {
  const html = pageShell({
    siteBase: SITE_BASE,
    origin: ORIGIN,
    path: 'docs/index.html',
    title: 'Docs',
    description: 'Docs',
    bodyHtml: '<p>Body</p>',
    searchIndexJson: '[{"title":"</script><script>alert(1)</script>"}]',
    ogImagePath: 'assets/social-preview.png',
  });
  assert.ok(!html.includes('</script><script>alert(1)'), html);
});

test('pageShell provides a responsive viewport meta tag and a skip link', () => {
  const html = pageShell({
    siteBase: SITE_BASE,
    origin: ORIGIN,
    path: 'index.html',
    title: 'Test',
    description: 'Test',
    bodyHtml: '<p>x</p>',
    ogImagePath: 'assets/social-preview.png',
  });
  assert.ok(html.includes('name="viewport" content="width=device-width, initial-scale=1"'));
  assert.ok(html.includes('class="skip-link"'));
  assert.ok(html.includes('lang="en"'));
});

test('the landing page names every gallery image as a real, already-committed capture', () => {
  for (const item of GALLERY) {
    assert.ok(
      item.file.startsWith('interface/captures/') || item.file.startsWith('design/parity/'),
      `${item.file} must come from the sanctioned capture directories`,
    );
    assert.doesNotThrow(() => readFileSync(new URL(`../docs/${item.file}`, import.meta.url)));
    assert.ok(item.alt.en && item.alt.zh, `${item.file} needs alt text in both languages`);
  }
});

test('the landing body links to the real application origin and states version, commit and update time', () => {
  const html = landingBody({
    version: '1.2.3',
    commit: 'a'.repeat(40),
    builtAt: '2026-01-01T00:00:00Z',
    articles: buildIndex(),
    siteBase: SITE_BASE,
  });
  assert.ok(html.includes('https://toronto-transit.org'));
  assert.ok(html.includes('v1.2.3'));
  assert.ok(html.includes('aaaaaaa'));
  assert.ok(html.includes('2026-01-01T00:00:00Z'));
});

test('the docs hub groups every article under its category and never drops one', () => {
  const articles = buildIndex();
  const html = docsHubBody(articles, SITE_BASE);
  for (const article of articles) {
    if (article.path === 'README.md') continue;
    assert.ok(html.includes(`${SITE_BASE}${articleUrl(article.path)}`), `${article.path} missing from the docs hub`);
  }
});

test('the required-feature inventory is non-empty and covers the lane’s explicit deliverables', () => {
  const ids = REQUIRED_FEATURES.map((feature) => feature.id);
  for (const required of [
    'landing-page',
    'docs-index',
    'search-plain-text',
    'search-regex-option',
    'language-modes',
    'theme-toggle',
    'material-design-tokens',
    'vendored-fonts',
    'responsive-viewport',
    'accessible-skip-link',
    'version-and-build-date',
    'social-preview-image',
  ]) {
    assert.ok(ids.includes(required), `the feature inventory is missing ${required}`);
  }
});
