#!/usr/bin/env node
/**
 * Rewrites every plain `- ` bullet in CHANGELOG.md into the dated, categorised
 * shape `lib/changelog.ts` reads: `- YYYY-MM-DD · category · text`.
 *
 * The date is the real committer date of the entry's own last-cited commit,
 * read with `git show -s --format=%cs <sha>` -- never guessed, never today's
 * date. An entry that cites no commit, or cites one this checkout cannot
 * resolve, keeps its text untouched and gets `unknown-date · unknown`. Nothing
 * about the cited links themselves is rewritten; this only prepends a date and
 * a category to a line that already exists.
 *
 * The category comes from the same commit's own touched files, read with
 * `git show --name-only --format= <sha>`, against the priority table below.
 * CHANGELOG.md itself is excluded from that file list before matching, because
 * almost every entry-bearing commit also adds its own changelog line, and
 * counting that would make "docs" swallow nearly everything.
 *
 * ---------------------------------------------------------------- mapping --
 * Rules are tried in order; the first one that matches ANY touched file wins
 * the whole commit. Order therefore matters most exactly where a commit
 * touches several of these at once (a merge, a broad pass) -- the earlier
 * category is judged the more specific, more informative one to record.
 *
 *  1. release        .github/, scripts/release-*, scripts/package-release.mjs,
 *                     scripts/dim-sum-code-name.mjs
 *  2. evidence        scripts/ui-evidence/, docs/captures/, docs/interface/ledger/
 *  3. design          design/ (the top-level parity-reference directory),
 *                     docs/design/
 *  4. race            race/, docs/race/
 *  5. vehicles        vehicles/, docs/vehicles/
 *  6. status          status/, realtime/, docs/status/
 *  7. data            data/, docs/data/
 *  8. deployment      server/, maps/, Dockerfile, compose.yml/.yaml,
 *                     scripts/deploy*, build.bat, download-dependencies.bat,
 *                     docs/deployment/
 *  9. planning        backend/ (the OpenTripPlanner service and its journey,
 *                     washroom and required-line logic), shared/, docs/planning/
 * 10. accessibility   docs/accessibility/, lib/narrator.ts,
 *                     components/narrator-settings.tsx
 * 11. docs            everything else under docs/, plus the root-level prose
 *                     files (README.md, AGENTS.md, ROADMAP.md, HANDOFF.md, PLAN.md)
 * 12. interface       app/, components/, lib/, hooks/, history/, public/, tests/
 * 13. release         the fallback for anything left -- root tooling and config
 *                     (package.json, tsconfig.json, build scripts and the like)
 *                     that ships the project without being any of the above
 *
 * This table is a judgement call, documented so it can be checked rather than
 * trusted. docs/interface/changelog.md restates it for a reader of the app.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANGELOG_CATEGORIES } from '../lib/changelog.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const changelogPath = path.join(root, 'CHANGELOG.md');

const RULES = [
  ['release', [/^\.github\//, /^scripts\/release-/, /^scripts\/package-release\.mjs$/, /^scripts\/dim-sum-code-name\.mjs$/]],
  ['evidence', [/^scripts\/ui-evidence\//, /^docs\/captures\//, /^docs\/interface\/ledger\//]],
  ['design', [/^design\//, /^docs\/design\//]],
  ['race', [/^race\//, /^docs\/race\//]],
  ['vehicles', [/^vehicles\//, /^docs\/vehicles\//]],
  ['status', [/^status\//, /^realtime\//, /^docs\/status\//]],
  ['data', [/^data\//, /^docs\/data\//]],
  ['deployment', [/^server\//, /^maps\//, /^Dockerfile$/, /^compose\.ya?ml$/, /^scripts\/deploy/, /^build\.bat$/, /^download-dependencies\.bat$/, /^docs\/deployment\//]],
  ['planning', [/^backend\//, /^shared\//, /^docs\/planning\//]],
  ['accessibility', [/^docs\/accessibility\//, /^lib\/narrator\.ts$/, /^components\/narrator-settings\.tsx$/]],
  ['docs', [/^docs\//, /^README\.md$/, /^AGENTS\.md$/, /^ROADMAP\.md$/, /^HANDOFF\.md$/, /^PLAN\.md$/]],
  ['interface', [/^app\//, /^components\//, /^lib\//, /^hooks\//, /^history\//, /^public\//, /^tests\//]],
];
const FALLBACK_CATEGORY = 'release';

for (const [category] of RULES) {
  if (!CHANGELOG_CATEGORIES.includes(category)) {
    throw new Error(`scripts/changelog-backfill.mjs: rule category "${category}" is not in CHANGELOG_CATEGORIES`);
  }
}

function categoryFromPaths(paths) {
  const relevant = paths.filter((entry) => entry !== 'CHANGELOG.md');
  for (const [category, patterns] of RULES) {
    if (relevant.some((entry) => patterns.some((pattern) => pattern.test(entry)))) return category;
  }
  return FALLBACK_CATEGORY;
}

/** The real committer date and touched-file category for one commit, or null if this checkout cannot resolve it. */
function resolveCommit(sha, { cwd }) {
  try {
    const date = execFileSync('git', ['show', '-s', '--format=%cs', sha], { cwd, encoding: 'utf8' }).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const files = execFileSync('git', ['show', '--name-only', '--format=', sha], { cwd, encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean);
    return { date, category: categoryFromPaths(files) };
  } catch {
    return null;
  }
}

const LINK_RE = /\[([0-9a-f]{7,40})\]\(https:\/\/github\.com\/[^)\s]+\/commit\/([0-9a-f]{7,40})\)/g;
/** Already-backfilled, in either shape: leave it exactly as it stands so a second run is a no-op. */
const ALREADY_SHAPED_RE = /^-\s+(\d{4}-\d{2}-\d{2}|unknown-date)\s*·\s*[a-z][a-z-]*\s*·\s/;

function backfill(text, { cwd }) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r\n|\n/);
  let dated = 0;
  let unknown = 0;
  let alreadyShaped = 0;
  const categories = {};
  const rewritten = lines.map((line) => {
    if (!line.startsWith('- ')) return line;
    if (ALREADY_SHAPED_RE.test(line)) { alreadyShaped += 1; return line; }
    const body = line.slice(2);
    const matches = [...body.matchAll(LINK_RE)];
    const last = matches.length ? matches[matches.length - 1][2] : null;
    const resolved = last ? resolveCommit(last, { cwd }) : null;
    if (resolved) {
      dated += 1;
      categories[resolved.category] = (categories[resolved.category] ?? 0) + 1;
      return `- ${resolved.date} · ${resolved.category} · ${body}`;
    }
    unknown += 1;
    categories.unknown = (categories.unknown ?? 0) + 1;
    return `- unknown-date · unknown · ${body}`;
  });
  return { text: rewritten.join(eol), dated, unknown, alreadyShaped, categories };
}

const original = readFileSync(changelogPath, 'utf8');
const result = backfill(original, { cwd: root });
writeFileSync(changelogPath, result.text);
const total = result.dated + result.unknown + result.alreadyShaped;
console.log(`scripts/changelog-backfill.mjs: ${total} bullets seen -- ${result.dated} dated, ${result.unknown} unknown-date, ${result.alreadyShaped} already backfilled.`);
console.log('By category:', JSON.stringify(result.categories, null, 2));
