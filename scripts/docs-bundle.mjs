#!/usr/bin/env node
/**
 * Publishes the project's own documentation for the in-app docs browser.
 *
 * Runs in `prebuild`. It copies every Markdown article under docs/ into
 * public/docs/ and writes public/docs/index.json listing them by category, so
 * the About destination can read the same articles offline, from the planner's
 * own origin, with no request to GitHub.
 *
 * What is left out, and why:
 *  - docs/captures/, docs/interface/captures/ and docs/interface/ledger/ hold
 *    evidence images and receipts, not articles;
 *  - docs/design/parity/ is generated comparison evidence.
 * Everything else under docs/ that ends in .md is published. A new article is
 * therefore in the browser the next time the site is built, without anyone
 * remembering to register it.
 *
 * Each index row carries the article's SHA-256, so the browser can say which
 * bytes it is showing, and its first `# ` heading as the title. An article with
 * no heading is titled by its file name rather than dropped.
 *
 * Usage: node scripts/docs-bundle.mjs [--check]
 *   --check  builds the index in memory and reports it without writing.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const docsRoot = path.join(root, 'docs');
const outRoot = path.join(root, 'public', 'docs');

export const EXCLUDED_PREFIXES = ['captures/', 'interface/captures/', 'interface/ledger/', 'design/parity/'];
/** Articles are bounded so one runaway file cannot bloat every client that opens the browser. */
export const MAX_ARTICLE_BYTES = 256 * 1024;

function walk(directory, relative = '') {
  const found = [];
  for (const name of readdirSync(directory).sort()) {
    const full = path.join(directory, name);
    const rel = relative ? `${relative}/${name}` : name;
    if (statSync(full).isDirectory()) {
      if (EXCLUDED_PREFIXES.some((prefix) => `${rel}/`.startsWith(prefix))) continue;
      found.push(...walk(full, rel));
    } else if (name.endsWith('.md')) {
      found.push(rel);
    }
  }
  return found;
}

export function titleOf(markdown, fallback) {
  const heading = /^#\s+(.+?)\s*#*\s*$/m.exec(markdown);
  return heading ? heading[1].replace(/[`*_]/g, '').trim() : fallback;
}

export function buildIndex() {
  const articles = [];
  for (const rel of walk(docsRoot)) {
    const bytes = readFileSync(path.join(docsRoot, rel));
    if (bytes.length > MAX_ARTICLE_BYTES) {
      throw new Error(`scripts/docs-bundle.mjs: docs/${rel} is ${bytes.length} bytes, over the ${MAX_ARTICLE_BYTES} byte article limit`);
    }
    const text = bytes.toString('utf8');
    const slash = rel.indexOf('/');
    articles.push({
      path: rel,
      category: slash === -1 ? 'overview' : rel.slice(0, slash),
      title: titleOf(text, path.basename(rel, '.md')),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  return articles;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const articles = buildIndex();
  const categories = [...new Set(articles.map((article) => article.category))];
  console.log(`scripts/docs-bundle.mjs: ${articles.length} articles in ${categories.length} categories${check ? ' (--check, not writing)' : ''}.`);
  if (!check) {
    rmSync(outRoot, { recursive: true, force: true });
    for (const article of articles) {
      const target = path.join(outRoot, article.path);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, readFileSync(path.join(docsRoot, article.path)));
    }
    writeFileSync(path.join(outRoot, 'index.json'), JSON.stringify({ schemaVersion: 1, articles }, null, 2) + '\n');
  }
}
