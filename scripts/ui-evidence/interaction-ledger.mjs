/**
 * Drive the built interface and keep a receipt for every click.
 *
 * The rule this exists to satisfy: after every click, wait through a bounded
 * semantic poll, assert the expected post-click state, run the privacy check, and
 * capture before the next click. A final-state gallery is not that, because it
 * cannot tell a control that worked from one that was never pressed.
 *
 * Each row binds its transition and its image to the exact source commit, the
 * built artifact's own hash, the viewport, the display scale, the theme, the
 * expected and observed state, and a privacy verdict. Without those a screenshot
 * is a picture of something, not evidence about a build.
 *
 * Usage:
 *   node scripts/ui-evidence/interaction-ledger.mjs \
 *     --endpoint http://127.0.0.1:PORT/json/list \
 *     --url https://example \
 *     --commit <sha> \
 *     --out docs/interface/interaction-ledger.json \
 *     --shots <dir> [--width 1440] [--scale 1] [--theme light]
 *
 * It never launches a browser itself. The isolated headless browser is launched
 * by the approved route and its debugging endpoint passed in, so this file cannot
 * quietly become a second, less careful way to open one.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { ALL_STEPS, SURFACES, FORBIDDEN_IN_EVIDENCE } from './interaction-inventory.mjs';

const argument = (flag, fallback = null) => {
  const at = process.argv.indexOf(flag);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};

const ENDPOINT = argument('--endpoint');
const URL_UNDER_TEST = argument('--url');
const COMMIT = argument('--commit');
/* One file per tuple. A single file would mean the last run silently replaced
   the evidence for every other viewport, theme and scale. */
const OUT = argument('--out', null);
const SHOTS = argument('--shots');
const WIDTH = Number(argument('--width', '1440'));
const SCALE = Number(argument('--scale', '1'));
const THEME = argument('--theme', 'light');

for (const [name, value] of [['--endpoint', ENDPOINT], ['--url', URL_UNDER_TEST], ['--commit', COMMIT], ['--shots', SHOTS], ['--out', OUT]]) {
  if (!value) { console.error(`${name} is required`); process.exit(2); }
}
if (!/^[0-9a-f]{40}$/.test(COMMIT)) { console.error('--commit must be a full sha'); process.exit(2); }

/* Empty the shots directory before writing into it.

   Without this a run leaves every capture from every earlier run beside its own,
   and the directory silently holds two runs at once. The ledger names the files it
   wrote, so it stays correct, but anything that reaches for a capture by pattern
   rather than by name gets whichever run sorted first. That happened: a README
   picked `031-settings.open` from a forty-step run while the current one had
   written `047-settings.open`, and the image published as the dark interface was a
   light one from hours earlier. Orphans are removed rather than left, because a
   stale capture that nobody references is indistinguishable from a current one to
   everything except the ledger. */
mkdirSync(SHOTS, { recursive: true });
for (const stale of readdirSync(SHOTS)) {
  if (stale.endsWith('.png')) rmSync(path.join(SHOTS, stale));
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * The hash of the artifact this run is actually photographing.
 *
 * It used to hash the local `dist/client/index.html`, which sounds like the same
 * thing and is not. The run drives a deployed site; the local directory is whatever
 * happened to be built on this machine last. Worse, this build is not reproducible:
 * building the identical source twice produces two different entry documents, so
 * the field could never have matched the deployed artifact even when the source
 * agreed. It read like a binding between the evidence and the build under test and
 * was a binding between the evidence and an unrelated local file.
 *
 * So it hashes the document the run fetched. A row can then be checked against the
 * thing that was really on screen, and a redeployment changes it while an ordinary
 * documentation commit does not.
 */
async function artifactHash() {
  try {
    const response = await fetch(URL_UNDER_TEST, { redirect: 'follow' });
    if (!response.ok) return null;
    return sha256(Buffer.from(await response.arrayBuffer()));
  } catch { return null; }
}

// --------------------------------------------------------------------- target --

const targets = await (await fetch(ENDPOINT)).json();
const pages = targets.filter((entry) => entry && entry.type === 'page');
if (pages.length !== 1) { console.error(`target-count ${pages.length}`); process.exit(1); }

const socket = new WebSocket(pages[0].webSocketDebuggerUrl, { suppressOrigin: true });
await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });

let messageId = 0;
const pending = new Map();
socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++messageId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 40000);
});
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A bounded semantic poll: the state must actually arrive, within a bound. */
async function waitFor(selector, tries = 30) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return true;
    await pause(300);
  }
  return false;
}

/** Console errors are collected so a click that worked visually but threw is caught. */
const consoleErrors = [];
await send('Runtime.enable');
socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(String(message.params?.exceptionDetails?.text || 'exception').slice(0, 200));
  }
});

/**
 * Put the interface into the theme this tuple is for, using the control a person
 * would use.
 *
 * Setting `data-theme` directly does not work and did not work for the whole life
 * of this harness: the application owns that attribute and writes it from its own
 * state on mount, so the assignment was overwritten a moment later. Nothing failed.
 * The tuple went on calling itself dark, the label on every capture said dark, and
 * eighty images were the light interface. A run that records the wrong theme is
 * worse than a run that does not happen, because it is indistinguishable from
 * coverage, so this refuses to continue rather than recording a lie.
 */
async function ensureTheme() {
  const read = () => evaluate(`document.documentElement.getAttribute('data-theme')`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await read() === THEME) return;
    await evaluate(`(() => { const n = document.querySelector('.m3-nav__theme'); if (!n) return false; n.click(); return true; })()`);
    await pause(700);
  }
  if (await read() !== THEME) {
    console.error(`could not reach the ${THEME} theme; refusing to record captures labelled ${THEME}`);
    process.exit(1);
  }
}

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: SCALE, mobile: WIDTH < 900 });
await send('Page.navigate', { url: URL_UNDER_TEST });
if (!await waitFor('.m3-nav__item', 80)) { console.error('the interface never rendered'); process.exit(1); }

/* Start where a person arriving for the first time does.

   Four tuples run back to back in one tab, and sessionStorage survives a
   navigation, so the second tuple inherited the race room the first one had
   created: its captures show another run's team name, and five plan steps
   reported a pass while sitting on the race surface, because a place field
   exists there too. Nothing failed and eight images were of the wrong page. */
await evaluate(`(() => { try { window.localStorage.clear(); } catch {} try { window.sessionStorage.clear(); } catch {} return true; })()`);
await send('Page.navigate', { url: URL_UNDER_TEST });
if (!await waitFor('.m3-nav__item', 80)) { console.error('the interface never came back'); process.exit(1); }
await ensureTheme();
await pause(1800);

// ---------------------------------------------------------------- one step --

const state = () => evaluate(`(() => {
  const active = [...document.querySelectorAll('.m3-nav__item')].find((n) => n.classList.contains('is-active'));
  return {
    destination: active ? active.textContent.trim() : null,
    heading: (document.querySelector('#workspace-heading') || {}).textContent || null,
    theme: document.documentElement.getAttribute('data-theme'),
    focused: document.activeElement ? document.activeElement.tagName.toLowerCase() : null,
  };
})()`);

const describeTarget = (selector) => evaluate(`(() => {
  const n = document.querySelector(${JSON.stringify(selector)});
  if (!n) return null;
  return { tag: n.tagName.toLowerCase(), name: (n.getAttribute('aria-label') || n.textContent || '').trim().slice(0, 60) };
})()`);

async function goToDestination(label) {
  /* Matched on the label element, not on the item's textContent. Material Symbols
     is a ligature font, so the glyph IS text: a destination's textContent now
     begins with "garage" or "sensors" and every startsWith(label) match silently
     stopped finding anything. The label span is the only part that is the label. */
  const how = await evaluate(`(() => {
    const labelOf = (node) => (node.querySelector('.m3-nav__label') || node).textContent.trim();
    const items = [...document.querySelectorAll('.m3-nav__item')];
    const primary = items.find((n) => labelOf(n).startsWith(${JSON.stringify(label)}) && n.offsetParent !== null);
    if (primary) { primary.click(); return 'rail'; }
    const more = document.querySelector('.m3-nav__item--more');
    if (!more || more.offsetParent === null) return null;
    more.click();
    return 'more';
  })()`);
  if (how === 'more') {
    await pause(600);
    await evaluate(`(() => {
      const i = [...document.querySelectorAll('.m3-more__item')].find((n) => (n.querySelector('.m3-more__label') || n).textContent.trim().startsWith(${JSON.stringify(label)}));
      if (i) i.click();
    })()`);
  }
  return how;
}

/** Nothing in a capture or a row may carry a secret or private wording. */
async function privacyVerdict(imageBytes) {
  const text = await evaluate(`document.body.innerText.slice(0, 20000)`);
  const leaked = FORBIDDEN_IN_EVIDENCE.filter((needle) => text.includes(needle));
  return { pass: leaked.length === 0, leaked };
}

const rows = [];
const artifact = await artifactHash();
let sequence = 0;

for (const surface of SURFACES) {
  for (const step of surface.steps) {
    sequence += 1;
    const before = await state();

    /* Several selectors are not unique to one surface: a place field exists on
       the composer and on the race start form, so a run that had drifted onto
       the wrong page went on reporting passes for controls it really did find,
       on a surface nobody asked about. A step belongs to its surface. */
    const onSurface = !surface.heading || String(before.heading || '').includes(surface.heading);

    /* Some expectations only mean something relative to the tuple. `html[data-theme]`
       is true of every page in both themes, so the two theme steps asserted nothing
       and would have passed while the toggle did nothing at all. A step may name a
       function instead, and the resolved selector is what gets recorded. */
    const expected = typeof step.expect === 'function' ? step.expect({ theme: THEME, width: WIDTH }) : step.expect;
    let observedTarget = null;
    let acted = false;
    let inputMethod = null;

    /* A step that only exists at some widths is recorded as not applicable here,
       with its capture, rather than skipped. Driving a display:none control would
       report a pass for something nobody can reach, which is worse than not
       running it, because it reads as evidence. */
    const applicable = !Array.isArray(step.widths) || step.widths.includes(WIDTH);

    /* A step with no click, no text match and no destination is an assertion:
       it makes no input at all and only claims that the state the step before it
       produced is really on the page. It is recorded with `acted: false` and an
       input method that says so, because calling it a click would be a false
       report about how the state was reached. What it still has to do is arrive:
       an assertion that cannot find its target fails exactly like any other. */
    const assertion = !step.click && !step.clickText && step.kind !== 'destination';

    try {
      if (!applicable) {
        inputMethod = 'not-applicable-at-this-width';
      } else if (assertion) {
        inputMethod = 'assert:no-input';
      } else if (step.kind === 'destination') {
        inputMethod = 'pointer:navigation';
        observedTarget = { tag: 'button', name: step.label };
        acted = Boolean(await goToDestination(step.label));
      } else if (step.clickText) {
        inputMethod = 'pointer:text-match';
        acted = await evaluate(`(() => {
          const n = [...document.querySelectorAll('button, a[href], summary')].find((x) => (x.textContent || '').trim().includes(${JSON.stringify(step.clickText)}));
          if (!n) return false;
          n.click();
          return true;
        })()`);
        observedTarget = acted ? { tag: 'button', name: step.clickText } : null;
      } else if (step.click) {
        inputMethod = step.type ? 'keyboard:type' : 'pointer:selector';
        observedTarget = await describeTarget(step.click);
        if (observedTarget) {
          if (step.type) {
            acted = await evaluate(`(() => {
              const n = document.querySelector(${JSON.stringify(step.click)});
              if (!n) return false;
              n.focus();
              const proto = n.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
              Object.getOwnPropertyDescriptor(proto, 'value').set.call(n, ${JSON.stringify(step.type)});
              n.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            })()`);
          } else {
            acted = await evaluate(`(() => { const n = document.querySelector(${JSON.stringify(step.click)}); if (!n) return false; n.click(); return true; })()`);
          }
        }
      }
    } catch (cause) {
      acted = false;
      observedTarget = observedTarget || { tag: 'unknown', name: String(cause).slice(0, 60) };
    }

    // A bounded semantic poll, then the assertion. Never a fixed sleep alone.
    let arrived = (acted || assertion) ? await waitFor(expected) : false;
    if (arrived && !onSurface && step.kind !== 'destination') {
      arrived = false;
      observedTarget = { tag: 'surface', name: `expected "${surface.heading}", was on "${before.heading}"`.slice(0, 60) };
    }

    /* A destination step whose expectation is only `main` passes on every page in
       the application, because `main` is always there. Three of them did exactly
       that: they never navigated, the More dialog matcher had silently stopped
       finding anything, and the ledger recorded a pass for each. So a destination
       must also land on the heading its surface declares. */
    if (arrived && step.kind === 'destination' && surface.heading) {
      const heading = await evaluate(`((document.querySelector('#workspace-heading') || {}).textContent || '').trim()`);
      arrived = String(heading).includes(surface.heading);
      if (!arrived) observedTarget = { tag: 'heading', name: `expected "${surface.heading}", found "${heading}"`.slice(0, 60) };
    }

    await pause(400);
    const after = await state();

    const png = await send('Page.captureScreenshot', { format: 'png' });
    const bytes = Buffer.from(png.data, 'base64');
    const name = `${String(sequence).padStart(3, '0')}-${step.id.replace(/[^a-z0-9.]+/gi, '-')}-${WIDTH}-${THEME}.png`;
    writeFileSync(path.join(SHOTS, name), bytes);
    const privacy = await privacyVerdict(bytes);

    const missing = !acted && !assertion;
    rows.push({
      sequence,
      surface: surface.id,
      step: step.id,
      describe: step.describe,
      optional: Boolean(step.optional),
      inputMethod,
      target: observedTarget,
      expected,
      before,
      after,
      acted,
      assertion,
      expectedStateArrived: arrived,
      applicableWidths: step.widths ?? null,
      outcome: !applicable
        ? 'not-applicable'
        : missing
          ? (step.optional ? 'absent-optional' : 'absent')
          /* An optional step depends on live data. When the vehicle it needed was
             not running, the click is absent and that is already tolerated; the
             assertion after it cannot reach its state either, and calling that a
             failure punishes the run for the feed being quiet. */
          : arrived ? 'pass' : (step.optional ? 'absent-optional' : 'state-not-reached'),
      sourceCommit: COMMIT,
      artifactSha256: artifact,
      viewport: { width: WIDTH, height: 900 },
      displayScale: SCALE,
      theme: THEME,
      screenshot: path.posix.join(path.basename(SHOTS), name),
      screenshotSha256: sha256(bytes),
      privacy: privacy.pass ? 'clean' : `leaked:${privacy.leaked.join(',')}`,
    });
  }
}

await send('Emulation.clearDeviceMetricsOverride');
socket.close();

const counts = rows.reduce((totals, row) => ({ ...totals, [row.outcome]: (totals[row.outcome] || 0) + 1 }), {});
const ledger = {
  version: 1,
  generatedAt: new Date().toISOString(),
  url: URL_UNDER_TEST,
  sourceCommit: COMMIT,
  artifactSha256: artifact,
  viewportWidth: WIDTH,
  displayScale: SCALE,
  theme: THEME,
  inventorySteps: ALL_STEPS.length,
  recordedRows: rows.length,
  counts,
  consoleErrors,
  rows,
};
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(ledger, null, 2) + '\n');

const failed = rows.filter((row) => row.outcome === 'absent' || row.outcome === 'state-not-reached' || row.privacy !== 'clean');
console.log(`${rows.length} clicks, one capture each: ${JSON.stringify(counts)}`);
console.log(`console exceptions: ${consoleErrors.length}`);
for (const row of failed) console.log(`  ${row.outcome}  ${row.step}  ${row.describe}`);
process.exitCode = failed.length ? 1 : 0;
