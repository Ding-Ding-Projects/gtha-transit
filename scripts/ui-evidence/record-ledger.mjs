/**
 * Record the interaction ledger at every tuple, from one command.
 *
 * This existed as a sequence of hand-typed invocations, which is the shape that
 * goes wrong quietly: one tuple recorded against a different commit, or a run
 * that skipped a width because the shell history it was copied from had.  The
 * guard already refuses tuples recorded against different commits, so the
 * failure surfaced as a red gate rather than as bad evidence, but a red gate an
 * hour after the run is a poor substitute for not being able to make the mistake.
 *
 * It drives the built artifact through the isolated headless route.  It does not
 * launch the browser: the endpoint is passed in, already proven to expose exactly
 * one page target at the expected URL.  Proving isolation is a separate step on
 * purpose, because a run that both opens the browser and vouches for it is
 * vouching for itself.
 *
 * Usage:
 *   node scripts/ui-evidence/record-ledger.mjs \
 *     --endpoint ws://127.0.0.1:PORT/devtools/page/ID \
 *     --url https://example.org/ --commit <40 hex> [--out docs/interface/ledger]
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const argument = (name, fallback = null) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
};

const ENDPOINT = argument('--endpoint');
const URL_UNDER_TEST = argument('--url');
const COMMIT = argument('--commit');
const OUT = argument('--out', 'docs/interface/ledger');

for (const [name, value] of [['--endpoint', ENDPOINT], ['--url', URL_UNDER_TEST], ['--commit', COMMIT]]) {
  if (!value) { console.error(`${name} is required`); process.exit(2); }
}
if (!/^[0-9a-f]{40}$/.test(COMMIT)) {
  console.error('--commit must be the full sha of the commit the running build came from');
  process.exit(2);
}

/* The four tuples the evidence gate requires: the desktop width and the phone
   width, each in both themes.  Widths are where layout breaks and themes are
   where contrast does, so neither alone is coverage. */
const TUPLES = [
  { width: 1440, theme: 'light', scale: 1 },
  { width: 1440, theme: 'dark', scale: 1 },
  { width: 390, theme: 'light', scale: 1 },
  { width: 390, theme: 'dark', scale: 1 },
];

mkdirSync(OUT, { recursive: true });

const runner = path.join(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), 'interaction-ledger.mjs');
let failed = 0;

for (const tuple of TUPLES) {
  const id = `${tuple.width}-${tuple.theme}-${tuple.scale}x`;
  console.log(`\n=== ${id} ===`);
  const result = spawnSync(process.execPath, [
    runner,
    '--endpoint', ENDPOINT,
    '--url', URL_UNDER_TEST,
    '--commit', COMMIT,
    '--width', String(tuple.width),
    '--theme', tuple.theme,
    '--scale', String(tuple.scale),
    '--shots', path.join(OUT, `shots-${id}`),
    '--out', path.join(OUT, `${id}.json`),
  ], { stdio: 'inherit' });
  /* Report the tuple that failed and keep going.  Stopping at the first one
     means re-running every earlier tuple to see the second, and every re-run is
     another set of captures against a build that may have moved. */
  if (result.status !== 0) { failed += 1; console.error(`  ${id} exited ${result.status}`); }
}

console.log(`\n${TUPLES.length - failed} of ${TUPLES.length} tuples recorded at ${COMMIT.slice(0, 7)}`);
process.exit(failed ? 1 : 0);
