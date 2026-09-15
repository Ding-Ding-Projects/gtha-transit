#!/usr/bin/env node
/**
 * Rewrites every plain `- ` bullet in CHANGELOG.md into the dated, categorised
 * shape `lib/changelog.ts` reads: `- YYYY-MM-DD · category · text`.
 *
 * Which commit an entry is dated and categorised from:
 *
 *  - the last commit the entry itself cites, when it cites one this checkout
 *    can resolve;
 *  - otherwise a commit whose subject starts with the entry's opening words;
 *  - otherwise the commit that added the entry to CHANGELOG.md, found with
 *    `git log -S` on the entry's opening words. Many early entries cite nothing,
 *    and the day they were written down is a real, checkable fact about them,
 *    where "unknown" would throw that fact away.
 *
 * The date is that commit's committer date (`%cs`), never today's date. An entry
 * neither route resolves keeps its text and gets `unknown-date · unknown`.
 *
 * The category comes from the files that commit touched:
 *
 *  - a merge is read through its first-parent diff. `git show --name-only` lists
 *    nothing for a merge, which is how the first version of this script filed
 *    whole integration merges as whatever the fallback happened to be;
 *  - CHANGELOG.md is ignored, since nearly every commit adds its own line;
 *  - each remaining file is matched to the first rule below it satisfies, and
 *    the category with the most files wins, ties going to the earlier rule;
 *  - prose (the `docs` rule: handoff, roadmap, plan and ordinary docs) only
 *    counts when the commit touched nothing else, because most code commits also
 *    update the handoff and would otherwise all read as documentation.
 *
 * ---------------------------------------------------------------- mapping --
 *  1. release        .github/, scripts/release-*, scripts/package-release.mjs,
 *                     scripts/dim-sum-code-name.mjs
 *  2. evidence        scripts/ui-evidence/, docs/captures/, docs/interface/ledger/,
 *                     docs/interface/captures/
 *  3. design          design/, docs/design/, scripts/design/
 *  4. race            race/, docs/race/, components/race-*
 *  5. vehicles        vehicles/, docs/vehicles/
 *  6. status          status/, realtime/, docs/status/, docs/realtime/
 *  7. data            data/, docs/data/, scripts/data/
 *  8. deployment      server/, maps/, Dockerfile, compose.yml/.yaml,
 *                     scripts/deploy*, build.bat, download-dependencies.bat,
 *                     docs/deployment/, backend/compose.yaml,
 *                     backend/*.sh
 *  9. planning        backend/, shared/, docs/planning/
 * 10. accessibility   docs/accessibility/, lib/narrator.ts,
 *                     components/narrator-settings.tsx
 * 11. docs            everything else under docs/, plus README.md, AGENTS.md,
 *                     ROADMAP.md, HANDOFF.md, PLAN.md
 * 12. interface       app/, components/, lib/, hooks/, history/, public/, tests/
 * 13. release         the fallback for anything left: root tooling and config
 *
 * This table is a judgement call, documented so it can be checked rather than
 * trusted. docs/interface/changelog.md restates it for a reader of the app.
 *
 * Usage: node scripts/changelog-backfill.mjs [--check]
 *   --check  reports what would change and exits 1 if any bullet is unshaped,
 *            without writing.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANGELOG_CATEGORIES } from '../lib/changelog.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const changelogPath = path.join(root, 'CHANGELOG.md');

export const RULES = [
  ['release', [/^\.github\//, /^scripts\/release-/, /^scripts\/package-release\.mjs$/, /^scripts\/dim-sum-code-name\.mjs$/]],
  ['evidence', [/^scripts\/ui-evidence\//, /^docs\/captures\//, /^docs\/interface\/ledger\//, /^docs\/interface\/captures\//]],
  ['design', [/^design\//, /^docs\/design\//, /^scripts\/design\//]],
  ['race', [/^race\//, /^docs\/race\//, /^components\/race-/]],
  ['vehicles', [/^vehicles\//, /^docs\/vehicles\//]],
  ['status', [/^status\//, /^realtime\//, /^docs\/status\//, /^docs\/realtime\//]],
  ['data', [/^data\//, /^docs\/data\//, /^scripts\/data\//]],
  ['deployment', [/^server\//, /^maps\//, /^Dockerfile$/, /^compose\.ya?ml$/, /^scripts\/deploy/, /^build\.bat$/, /^download-dependencies\.bat$/, /^docs\/deployment\//, /^backend\/compose\.ya?ml$/, /^backend\/[^/]+\.sh$/]],
  ['planning', [/^backend\//, /^shared\//, /^docs\/planning\//]],
  ['accessibility', [/^docs\/accessibility\//, /^lib\/narrator\.ts$/, /^components\/narrator-settings\.tsx$/]],
  ['docs', [/^docs\//, /^README\.md$/, /^AGENTS\.md$/, /^ROADMAP\.md$/, /^HANDOFF\.md$/, /^PLAN\.md$/]],
  ['interface', [/^app\//, /^components\//, /^lib\//, /^hooks\//, /^history\//, /^public\//, /^tests\//]],
];
export const FALLBACK_CATEGORY = 'release';

for (const [category] of RULES) {
  if (!CHANGELOG_CATEGORIES.includes(category)) {
    throw new Error(`scripts/changelog-backfill.mjs: rule category "${category}" is not in CHANGELOG_CATEGORIES`);
  }
}

function ruleFor(file) {
  for (let index = 0; index < RULES.length; index += 1) {
    if (RULES[index][1].some((pattern) => pattern.test(file))) return index;
  }
  return -1;
}

/** The category for a set of touched paths; see the header for the counting rule. */
export function categoryFromPaths(paths) {
  const counts = new Map();
  let prose = 0;
  let fallback = 0;
  for (const file of paths) {
    if (file === 'CHANGELOG.md') continue;
    const index = ruleFor(file);
    if (index === -1) { fallback += 1; continue; }
    if (RULES[index][0] === 'docs') { prose += 1; continue; }
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  if (counts.size) {
    const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    return RULES[best[0]][0];
  }
  if (fallback) return FALLBACK_CATEGORY;
  if (prose) return 'docs';
  return FALLBACK_CATEGORY;
}

const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function touchedFiles(sha) {
  const parents = git(['rev-list', '--parents', '-n', '1', sha]).trim().split(/\s+/);
  const listing = parents.length > 2
    ? git(['diff', '--name-only', `${sha}^1`, sha])
    : git(['show', '--name-only', '--format=', sha]);
  return listing.split(/\r?\n/).filter(Boolean);
}

function resolveCommit(sha) {
  try {
    const date = git(['show', '-s', '--format=%cs', sha]).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    return { date, category: categoryFromPaths(touchedFiles(sha)) };
  } catch {
    return null;
  }
}

/**
 * The commit this entry describes, when its subject starts with the entry's own
 * opening words. Entries are often written as the commit subject, and that commit
 * says what actually changed, where the commit that added the line to this file
 * was frequently a bookkeeping commit touching only the changelog and the handoff.
 */
function commitWithSubject(body) {
  const opening = body.split(/[.:;(]/)[0].trim().slice(0, 60);
  if (opening.length < 20) return null;
  try {
    const found = git(['log', '--reverse', '--format=%H%x09%s', '-F', `--grep=${opening}`]).split(/\r?\n/).filter(Boolean);
    const hit = found.map((row) => row.split('\t')).find(([, subject]) => subject && subject.startsWith(opening));
    return hit ? hit[0] : null;
  } catch {
    return null;
  }
}

/** The oldest commit whose change to CHANGELOG.md added this text. */
function commitThatAdded(body) {
  const needle = body.slice(0, 80);
  try {
    const found = git(['log', '--reverse', '--format=%H', '-S', needle, '--', 'CHANGELOG.md']).split(/\r?\n/).filter(Boolean);
    return found[0] ?? null;
  } catch {
    return null;
  }
}

const LINK_RE = /\[([0-9a-f]{7,40})\]\(https:\/\/github\.com\/[^)\s]+\/commit\/([0-9a-f]{7,40})\)/g;
/** Already backfilled, in either shape: left exactly as it stands so a second run is a no-op. */
export const ALREADY_SHAPED_RE = /^-\s+(\d{4}-\d{2}-\d{2}|unknown-date)\s*·\s*[a-z][a-z-]*\s*·\s/;

function backfill(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r\n|\n/);
  const tally = { cited: 0, subject: 0, added: 0, unknown: 0, alreadyShaped: 0, categories: {} };
  const rewritten = lines.map((line) => {
    if (!line.startsWith('- ')) return line;
    if (ALREADY_SHAPED_RE.test(line)) { tally.alreadyShaped += 1; return line; }
    const body = line.slice(2);
    const matches = [...body.matchAll(LINK_RE)];
    const cited = matches.length ? resolveCommit(matches[matches.length - 1][2]) : null;
    let resolved = cited;
    if (cited) tally.cited += 1;
    if (!resolved) {
      const described = commitWithSubject(body);
      resolved = described ? resolveCommit(described) : null;
      if (resolved) tally.subject += 1;
    }
    if (!resolved) {
      const adder = commitThatAdded(body);
      resolved = adder ? resolveCommit(adder) : null;
      if (resolved) tally.added += 1;
    }
    if (!resolved) {
      tally.unknown += 1;
      tally.categories.unknown = (tally.categories.unknown ?? 0) + 1;
      return `- unknown-date · unknown · ${body}`;
    }
    tally.categories[resolved.category] = (tally.categories[resolved.category] ?? 0) + 1;
    return `- ${resolved.date} · ${resolved.category} · ${body}`;
  });
  return { text: rewritten.join(eol), changed: tally.cited + tally.subject + tally.added + tally.unknown, tally };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const original = readFileSync(changelogPath, 'utf8');
  const result = backfill(original);
  const { tally } = result;
  console.log(`scripts/changelog-backfill.mjs: ${tally.cited} dated from a cited commit, ${tally.subject} from a commit with the same subject, ${tally.added} from the commit that added them, ${tally.unknown} unknown, ${tally.alreadyShaped} already shaped.`);
  console.log('By category:', JSON.stringify(tally.categories));
  if (check) process.exit(result.changed ? 1 : 0);
  writeFileSync(changelogPath, result.text);
}
