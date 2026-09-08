/**
 * Publish the README capture matrix from the interaction ledger.
 *
 * The pictures a README shows are the ones most people judge the project by, so
 * they have to be the real built interface at a known commit. They already exist:
 * the ledger photographs every click. This copies the chosen ones out and proves
 * each copy is byte for byte the file the ledger hashed.
 *
 * It selects by the name the ledger recorded, never by a pattern. A shots
 * directory can hold captures from more than one run, and a glob then returns
 * whichever sorted first: doing this by hand published `031-settings.open` from a
 * forty-step run while the current run had written `047-settings.open`, so the
 * image offered as the dark interface was a light one from hours earlier. The
 * recorder now clears stale captures and a guard refuses a mixed directory, and
 * this selects by name and verifies the hash, because one of those three alone is
 * a thing that stops being true.
 *
 * A step that did not pass is not published. A picture of a control that did not
 * work is worse than no picture.
 *
 * Usage: node scripts/ui-evidence/publish-captures.mjs [--check]
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const LEDGER = path.join(root, 'docs', 'interface', 'ledger');
const CAPTURES = path.join(root, 'docs', 'captures');
const CHECK = process.argv.includes('--check');

/**
 * The matrix, hand-written.
 *
 * Every destination, both themes on the surface the design is most about, the
 * phone layout and its More dialog, and the three surfaces this project added most
 * recently. A list derived from whatever the ledger happened to contain would
 * quietly shrink the day a step was renamed.
 */
export const MATRIX = [
  ['1440-dark-1x', 'plan.open', 'plan-dark', 'The journey composer at desktop width in the dark theme, with the map behind it'],
  ['1440-light-1x', 'plan.open', 'plan-light', 'The same composer in the light theme, amber on warm paper'],
  ['1440-dark-1x', 'status.open', 'live-dark', 'Live network status: GO cancellations and every TTC line with its facility notices'],
  ['1440-dark-1x', 'vehicles.open', 'vehicles-dark', 'The vehicle tracker with its route picker, search workbench and live map'],
  ['1440-dark-1x', 'divisions.open', 'divisions-dark', 'Out of division: classification filters with live counts and the allocation source named'],
  ['1440-dark-1x', 'saved.open', 'saved-dark', 'Saved trips'],
  ['1440-dark-1x', 'history.open', 'history-dark', 'The service record, with its date presets'],
  ['1440-dark-1x', 'coverage.open', 'coverage-dark', 'Regional realtime coverage, agency by agency'],
  ['1440-dark-1x', 'settings.open', 'settings-dark', 'Settings: tabbed sections, each with its own search, and the colour theme choice'],
  ['1440-dark-1x', 'race.open', 'race-dark', 'The race workspace before a room is created'],
  ['390-dark-1x', 'plan.open', 'plan-phone-dark', 'The composer at 390 pixels, with the bottom navigation bar'],
  ['390-light-1x', 'nav.more.open', 'more-phone-light', 'The More dialog on a phone, listing the destinations the bar cannot hold'],
  ['1440-dark-1x', 'plan.garage.details', 'garage-detail-dark', 'A garage expanded to the routes it operates and what is running on them now'],
  ['1440-dark-1x', 'race.join', 'speed-run-dark', 'The speed run checklist: 110 stations across five lines, photo proof required'],
  ['1440-dark-1x', 'divisions.route.colour', 'division-verdict-dark', 'A vehicle out of division, with its route in the operator colour on the map'],
];

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

function run() {
  mkdirSync(CAPTURES, { recursive: true });
  const published = [];
  const problems = [];

  for (const [tuple, step, name, alt] of MATRIX) {
    const ledgerFile = path.join(LEDGER, tuple + '.json');
    if (!existsSync(ledgerFile)) { problems.push(`${tuple} has no ledger`); continue; }
    const ledger = JSON.parse(readFileSync(ledgerFile, 'utf8'));
    const row = ledger.rows.find((entry) => entry.step === step);
    if (!row) { problems.push(`${tuple} has no row for ${step}`); continue; }
    if (row.outcome !== 'pass') { problems.push(`${step} in ${tuple} did not pass (${row.outcome})`); continue; }

    const source = path.join(LEDGER, ...row.screenshot.split('/'));
    if (!existsSync(source)) { problems.push(`${row.screenshot} is not on disk`); continue; }
    if (sha256(source) !== row.screenshotSha256) {
      problems.push(`${row.screenshot} is not the file its ledger hash names`);
      continue;
    }

    const target = path.join(CAPTURES, `${name}-${ledger.sourceCommit.slice(0, 7)}.png`);
    if (CHECK) {
      if (!existsSync(target)) problems.push(`${path.basename(target)} has not been published`);
      else if (sha256(target) !== row.screenshotSha256) problems.push(`${path.basename(target)} is stale`);
    } else {
      copyFileSync(source, target);
    }
    published.push({ name, file: path.posix.join('docs/captures', path.basename(target)), alt, step, tuple });
  }

  for (const problem of problems) console.error('  ' + problem);
  console.log(`${published.length} of ${MATRIX.length} captures ${CHECK ? 'checked' : 'published'}`);
  return { published, problems };
}

if (process.argv[1] && process.argv[1].endsWith('publish-captures.mjs')) {
  const { problems } = run();
  process.exit(problems.length ? 1 : 0);
}

export { run };
