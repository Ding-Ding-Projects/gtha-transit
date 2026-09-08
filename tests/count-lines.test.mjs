import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BINARY_EXTENSION, MAX_BUFFER, isExcludedByName, trackedFiles } from '../scripts/count-lines.mjs';

/**
 * The line counter runs in the release workflow, so when it throws the release
 * fails and nothing ships.
 *
 * It threw. The first committed video was not on its extension list, so it read a
 * WebM as UTF-8, and every read used the default one megabyte buffer, so the run
 * died with ENOBUFS and a megabyte of binary in the log. Neither is really about
 * videos: the list was always going to miss the next format, and the buffer was
 * always going to be reached.
 *
 * These run in a fraction of a second. Running the counter itself takes about nine
 * seconds, which is too slow to pay on every test run for a check that can be made
 * exactly instead.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/**
 * Binaries this repository commits without an extension.
 *
 * The counter catches these by looking for a NUL, which is the right mechanism and
 * works. They are still named here so a new one is noticed rather than absorbed:
 * a file the extension rule cannot see is a file whose handling depends entirely
 * on one check nobody is looking at.
 *
 * `.thumbnail` is a WebP the design tool writes beside its export.
 */
const EXTENSIONLESS_BINARIES = new Set(['design/reference/.thumbnail']);

test('nothing the counter reads is past the buffer it reads with', () => {
  // This is the failure that turned a release red: ENOBUFS on the first tracked
  // file over a megabyte, reported as a megabyte of binary in the workflow log.
  for (const file of trackedFiles()) {
    if (isExcludedByName(file)) continue;
    const full = path.join(root, file);
    if (!existsSync(full)) continue;
    const size = statSync(full).size;
    assert.ok(size < MAX_BUFFER, `${file} is ${size} bytes, past the buffer the counter reads with`);
  }
});

test('a binary is either excluded by name or is one we know has no extension', () => {
  for (const file of trackedFiles()) {
    if (isExcludedByName(file)) continue;
    const full = path.join(root, file);
    if (!existsSync(full)) continue;
    const head = readFileSync(full).subarray(0, 8192);
    if (!head.includes(0)) continue;
    assert.ok(EXTENSIONLESS_BINARIES.has(file),
      `${file} is binary, its extension is not excluded, and nobody has said it should be. Add the extension to the counter or name the file here.`);
  }
});

test('the exclusion knows the formats this repository actually commits', () => {
  // Written out rather than derived, so a format that stops being excluded fails
  // here instead of in a release.
  for (const name of [
    'docs/captures/walkthrough.webm', 'a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp',
    'a.ico', 'a.woff', 'a.woff2', 'a.ttf', 'a.zip', 'a.gz', 'a.pbf', 'a.mp4', 'a.pdf',
  ]) {
    assert.ok(BINARY_EXTENSION.test(name), `${name} would be counted as text`);
  }
  for (const name of ['a.ts', 'a.tsx', 'a.mjs', 'a.css', 'a.md', 'a.json', 'a.svg']) {
    assert.ok(!BINARY_EXTENSION.test(name), `${name} would be excluded from the count`);
  }
});

test('every process the counter spawns is given an explicit buffer', () => {
  /* The default is one megabyte and the failure is ENOBUFS, which arrives as a
     megabyte of binary in a workflow log rather than as a sentence. Anchored to the
     call so a commented-out line cannot satisfy it. */
  const source = readFileSync(path.join(root, 'scripts', 'count-lines.mjs'), 'utf8');
  const calls = [...source.matchAll(/^\s*(?:const|let|export const)?[^\n]*execFileSync\(/gm)];
  assert.ok(calls.length >= 2, 'the counter no longer spawns anything, so this checks nothing');
  for (const call of calls) {
    const from = call.index;
    const statement = source.slice(from, source.indexOf(';', from));
    assert.match(statement, /maxBuffer/,
      `a spawn in the counter has no explicit buffer: ${statement.slice(0, 80)}`);
  }
});

test('the counter still produces the table the release embeds', () => {
  // One end-to-end run, because the release publishes this exact output and a
  // counter that imports cleanly can still be broken.
  const output = execFileSync(process.execPath, [path.join(root, 'scripts', 'count-lines.mjs')], {
    encoding: 'utf8', maxBuffer: MAX_BUFFER, cwd: root,
  });
  assert.match(output, /^\| Category \| Total lines \| Nonblank lines \|/m);
  assert.match(output, /^\| Source \| \d+ \| \d+ \|$/m);
  assert.match(output, /^Excluded \d+ lockfile/m);
});
