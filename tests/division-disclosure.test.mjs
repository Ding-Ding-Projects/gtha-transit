import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyOutOfDivision, loadTtcDivisionRegistry, sourceCoverage } from '../vehicles/divisions.mjs';
import { divisionEvidenceCoverage, isUsableDivisionEvidence } from '../vehicles/journey-division-preference.mjs';
import { usableRouteOpportunity } from '../vehicles/journey-route-opportunity-preference.mjs';

/**
 * What this guards is the caveat, deliberately not the freshness of the data.
 *
 * A board period ends every few weeks and the next summary is published when the
 * operator publishes it, so a check that failed because the shipped allocation
 * was out of its period would be red for days at a time over a state the owner
 * has decided is correct: keep showing the last published answer, labelled with
 * the period it covers, until a newer one exists. A check that is routinely red
 * for the intended behaviour is a check everybody learns to ignore.
 *
 * So every date here is supplied by the test. What is asserted is that the
 * planner still answers once a period ends, that it refuses one that has not
 * started, and that each of the four surfaces which can show an out-of-period
 * answer still renders the sentence saying so. Losing that sentence is the real
 * defect, and it is silent: the answer looks exactly as confident as a current
 * one.
 *
 * `scripts/check-ttc-summary.mjs` reports how far past its period the shipped
 * receipt is. That is a number to read, not a gate.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = (...parts) => readFileSync(path.join(root, ...parts), 'utf8');

const vehicle = (timestamp) => ({ id: '7001', label: '7001', fleetNumber: '7001', agencyId: 'ttc', routeId: '29', timestamp, stale: false });

test('an ended period still answers, and says which period it is answering from', async () => {
  const registry = await loadTtcDivisionRegistry();
  const ended = Date.parse(registry.source.validThrough + 'T23:00:00Z') + 30 * 86_400_000;
  const fresh = new Date(ended - 30_000).toISOString();

  assert.equal(sourceCoverage(registry, ended), 'last-published');
  const out = classifyOutOfDivision(vehicle(fresh), '29', registry, { now: ended });
  assert.equal(out.state, 'out-of-division', 'a month past the period, the last published allocation still classifies');
  assert.equal(out.sourceCoverage, 'last-published', 'and the answer carries which period it came from');
  assert.equal(out.source.validThrough, registry.source.validThrough);
});

test('a period that has not started refuses, because that is a claim about the future', async () => {
  const registry = await loadTtcDivisionRegistry();
  const early = Date.parse(registry.source.validFrom + 'T12:00:00Z') - 30 * 86_400_000;
  const out = classifyOutOfDivision(vehicle(new Date(early - 30_000).toISOString()), '29', registry, { now: early });
  assert.equal(out.reason, 'allocation-source-not-yet-in-effect');
  assert.equal(out.sourceCoverage, 'not-yet-in-effect');
});

test('the journey preference agrees with the tracker about an ended period', () => {
  // The two disagreed for three days in September 2026: the tracker answered with
  // its caveat while the journey preference silently stopped boosting anything and
  // hid its badge. Nothing reported the split.
  const evidence = (validThrough) => ({
    state: 'out-of-division', checkedAt: 1_000, validUntil: 10_000,
    source: { validFrom: '2026-09-06', validThrough },
  });
  const now = Date.parse('2026-11-15T17:00:00Z');
  const ended = { ...evidence('2026-10-31'), checkedAt: now - 1_000, validUntil: now + 60_000 };
  assert.equal(isUsableDivisionEvidence(ended, { now }), true, 'an ended period still orders journeys');
  assert.equal(divisionEvidenceCoverage(ended, { now }), 'last-published');

  const future = { ...ended, source: { validFrom: '2027-03-01', validThrough: '2027-04-30' } };
  assert.equal(isUsableDivisionEvidence(future, { now }), false, 'a period that has not started still refuses');
  assert.equal(divisionEvidenceCoverage(future, { now }), 'not-yet-in-effect');

  const opportunity = { state: 'observed', checkedAt: now - 1_000, source: { validFrom: '2026-09-06', validThrough: '2026-10-31' }, observations: [{ id: '7001', fleetNumber: '7001', validUntil: now + 60_000 }] };
  assert.ok(usableRouteOpportunity(opportunity, { now }), 'and so does the route opportunity beside it');
});

/*
 * The four surfaces that can present an out-of-period answer. Hand-written, because
 * a rule that only checks the surfaces it can find passes cleanly on a surface whose
 * caveat was deleted along with the block that rendered it.
 */
const SURFACES = [
  {
    file: ['components', 'garage-picker.tsx'],
    condition: /disclosure\.sourceExpired && disclosure\.validThrough/,
    english: /a newer one is not out/,
    cantonese: /新一份未出/,
  },
  {
    file: ['components', 'vehicle-tracker.tsx'],
    condition: /\{expiredThrough && \(/,
    english: /the next one is not out yet/,
    cantonese: /下一份未出/,
  },
  {
    file: ['components', 'division-verdict.tsx'],
    condition: /division\.sourceCoverage === 'last-published'/,
    english: /which covers a period that has ended/,
    cantonese: /而嗰段時期已經完結/,
  },
  {
    file: ['app', 'page.tsx'],
    condition: /divisionEvidenceCoverage\(leg\.vehicleDivision, \{ now: divisionNow \}\) === 'last-published'/,
    english: /From the last published allocation summary/,
    cantonese: /嚟自最後一份配車摘要/,
  },
];

test('every surface that can answer from an ended period says that it is', () => {
  for (const surface of SURFACES) {
    const text = source(...surface.file);
    const where = surface.file.join('/');
    assert.match(text, surface.condition, `${where} no longer detects an ended period`);
    assert.match(text, surface.english, `${where} lost the English sentence saying the period has ended`);
    assert.match(text, surface.cantonese, `${where} lost the Cantonese sentence saying the period has ended`);
  }
});

test('the caveat names the period rather than saying only that one ended', () => {
  // "This is old" is not actionable. Which dates it describes is.
  assert.match(source('components', 'garage-picker.tsx'), /covering service through \$\{disclosure\.validThrough\}/);
  assert.match(source('components', 'vehicle-tracker.tsx'), /covers service through \$\{expiredThrough\}/);
  assert.match(source('app', 'page.tsx'), /covering service through .*leg\.vehicleDivision\.source\?\.validThrough/s);
});

test('the shipped receipt carries every field the disclosure depends on', async () => {
  const registry = await loadTtcDivisionRegistry();
  for (const field of ['publisher', 'title', 'url', 'publisherPage', 'retrievedAt', 'sha256', 'bytes', 'validFrom', 'validThrough', 'fleetAllocationUpdated']) {
    assert.ok(registry.source[field], `the receipt has no ${field}, so the surfaces cannot cite it`);
  }
  assert.match(registry.source.validFrom, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(registry.source.validThrough, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(registry.source.validFrom < registry.source.validThrough, 'the period runs forwards');
  assert.match(registry.source.sha256, /^[0-9A-F]{64}$/);
  assert.ok(Number.isInteger(registry.source.bytes) && registry.source.bytes > 100_000);
  assert.ok(registry.source.url.startsWith('https://'), 'the citation is fetchable');
});
