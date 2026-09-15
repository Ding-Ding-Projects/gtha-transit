#!/usr/bin/env node
/**
 * Publishes CHANGELOG.md as public/changelog.json for the in-app changelog viewer.
 *
 * Runs in `prebuild`, right after scripts/build-provenance.mjs, so the served
 * file and the build stamp come from the same commit. Every sha the changelog
 * cites is checked against this checkout's own object database with
 * `git cat-file -e <sha>^{commit}` before anything is written: a changelog that
 * links to a commit that does not exist here is worse than one that links to
 * nothing, because it looks trustworthy and is not.
 *
 * A source archive built with no `.git` directory (see
 * scripts/build-provenance.mjs's own SOURCE_COMMIT fallback) cannot run that
 * check at all, so it does not pretend to: with `SOURCE_COMMIT` set and no
 * `.git`, this records `{ validated: 'before-archive' }` instead of a real
 * verification and moves on. Neither path invents a result -- a checkout with
 * no `.git` and no `SOURCE_COMMIT` has nothing honest to write, so it fails.
 *
 * `--check` reads and validates only. It never writes public/changelog.json,
 * which is what lets a scratch copy with a deliberately broken sha be checked
 * without touching the real build output.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChangelog } from '../lib/changelog.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const check = process.argv.includes('--check');

function everySha(entries) {
  const shas = new Set();
  for (const entry of entries) for (const link of entry.links) {
    const match = /\/commit\/([0-9a-f]{7,40})$/.exec(link);
    if (match) shas.add(match[1]);
  }
  return [...shas];
}

function verifyAgainstGit(shas) {
  const dead = [];
  for (const sha of shas) {
    try {
      execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
      dead.push(sha);
    }
  }
  return dead;
}

const changelogText = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const parsed = parseChangelog(changelogText);
const shas = everySha(parsed.entries);
const hasGit = existsSync(path.join(root, '.git'));

let validated;
if (hasGit) {
  const dead = verifyAgainstGit(shas);
  if (dead.length) {
    console.error(`scripts/changelog-json.mjs: ${dead.length} commit sha(s) cited in CHANGELOG.md do not exist in this checkout: ${dead.join(', ')}`);
    process.exit(1);
  }
  validated = 'git';
} else if (process.env.SOURCE_COMMIT) {
  // A source archive built without `.git`: scripts/build-provenance.mjs already
  // trusts SOURCE_COMMIT for the same reason. There is no object database here
  // to check shas against, so this records that plainly rather than skipping
  // the field or claiming a verification that did not happen.
  validated = 'before-archive';
} else {
  console.error('scripts/changelog-json.mjs: no .git directory and no SOURCE_COMMIT environment variable -- cannot verify or honestly skip verifying the cited commits.');
  process.exit(1);
}

console.log(`scripts/changelog-json.mjs: ${parsed.entries.length} entries, ${shas.length} distinct commit(s), validated: ${validated}${check ? ' (--check, not writing)' : ''}.`);

if (check) process.exit(0);

const output = {
  schemaVersion: 1,
  version: parsed.version,
  unreleased: parsed.unreleased,
  generatedAt: new Date().toISOString(),
  validated,
  entries: parsed.entries,
};
mkdirSync(path.join(root, 'public'), { recursive: true });
writeFileSync(path.join(root, 'public', 'changelog.json'), JSON.stringify(output, null, 2) + '\n');
