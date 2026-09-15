import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inlineText, parseInline, parseMarkdown, resolveDocLink, REPOSITORY_URL } from '../lib/doc-markdown.ts';
import { buildIndex, EXCLUDED_PREFIXES, titleOf } from '../scripts/docs-bundle.mjs';

test('headings, lists, code, quotes, tables and rules become typed blocks', () => {
  const blocks = parseMarkdown([
    '# Title', '', 'A paragraph with `code` and **bold**.', '', '- one', '- two', '  continued', '',
    '1. first', '2. second', '', '```js', 'const x = 1;', '```', '', '> quoted', '', '| a | b |', '| --- | --- |', '| 1 | 2 |', '', '---',
  ].join('\n'));
  assert.deepEqual(blocks.map((block) => block.kind), ['heading', 'paragraph', 'list', 'list', 'code', 'quote', 'table', 'rule']);
  assert.equal(blocks[2].items.length, 2);
  assert.equal(inlineText(blocks[2].items[1]), 'two continued');
  assert.equal(blocks[3].ordered, true);
  assert.equal(blocks[4].language, 'js');
  assert.equal(blocks[6].rows[0].length, 2);
});

test('markup inside an article stays text, because nothing here produces HTML', () => {
  const blocks = parseMarkdown('<script>alert(1)</script> and <img src=x onerror=y>');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'paragraph');
  assert.deepEqual(blocks[0].text, [{ kind: 'text', text: '<script>alert(1)</script> and <img src=x onerror=y>' }]);
});

test('repeated headings get distinct ids, so an anchor lands on the one it names', () => {
  const ids = parseMarkdown('## Usage\n\n## Usage\n\n## Usage').map((block) => block.id);
  assert.deepEqual(ids, ['usage', 'usage-1', 'usage-2']);
});

test('images are shown as their alt text, since captures are not bundled', () => {
  assert.deepEqual(parseInline('see ![the rail](captures/x.png) here'), [
    { kind: 'text', text: 'see ' }, { kind: 'image', alt: 'the rail' }, { kind: 'text', text: ' here' },
  ]);
});

test('links resolve to an article, an anchor, the repository, or nowhere', () => {
  const known = new Set(['README.md', 'planning/README.md', 'planning/year-matching.md', 'deployment/restarting.md']);
  assert.deepEqual(resolveDocLink('year-matching.md#rules', 'planning/README.md', known), { kind: 'article', path: 'planning/year-matching.md', anchor: 'rules' });
  assert.deepEqual(resolveDocLink('../deployment/restarting.md', 'planning/README.md', known), { kind: 'article', path: 'deployment/restarting.md', anchor: null });
  assert.deepEqual(resolveDocLink('planning', 'README.md', known), { kind: 'article', path: 'planning/README.md', anchor: null });
  assert.deepEqual(resolveDocLink('#usage', 'README.md', known), { kind: 'anchor', anchor: 'usage' });
  assert.deepEqual(resolveDocLink('../../backend/compose.yaml', 'deployment/restarting.md', known), { kind: 'external', href: `${REPOSITORY_URL}/blob/main/backend/compose.yaml` });
  assert.deepEqual(resolveDocLink('captures/a.png', 'planning/README.md', known), { kind: 'external', href: `${REPOSITORY_URL}/blob/main/docs/planning/captures/a.png` });
  assert.deepEqual(resolveDocLink('https://example.org/a', 'README.md', known), { kind: 'external', href: 'https://example.org/a' });
  assert.deepEqual(resolveDocLink('javascript:alert(1)', 'README.md', known), { kind: 'refused' });
  assert.deepEqual(resolveDocLink('data:text/html,x', 'README.md', known), { kind: 'refused' });
});

test('the bundle publishes every article and none of the evidence folders', () => {
  const articles = buildIndex();
  assert.ok(articles.length >= 60, `expected the real docs tree, found ${articles.length}`);
  for (const article of articles) {
    assert.ok(!EXCLUDED_PREFIXES.some((prefix) => article.path.startsWith(prefix)), article.path);
    assert.match(article.sha256, /^[0-9a-f]{64}$/);
    assert.ok(article.title.length > 0);
  }
  const paths = new Set(articles.map((article) => article.path));
  for (const required of ['README.md', 'deployment/restarting.md', 'interface/about.md', 'interface/changelog.md']) {
    assert.ok(paths.has(required), `${required} is missing from the bundle`);
  }
});

test('every article in docs/ parses without throwing, and its title is its heading', () => {
  for (const article of buildIndex()) {
    const text = readFileSync(new URL(`../docs/${article.path}`, import.meta.url), 'utf8');
    assert.doesNotThrow(() => parseMarkdown(text), article.path);
    assert.equal(article.title, titleOf(text, article.path.split('/').pop().replace(/\.md$/, '')));
  }
});
