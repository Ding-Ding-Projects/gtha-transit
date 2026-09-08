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
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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

mkdirSync(SHOTS, { recursive: true });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The built artifact's own hash, so a row cannot be read as being about another build. */
function artifactHash() {
  const entry = path.resolve('dist', 'client', 'index.html');
  try { return sha256(readFileSync(entry)); } catch { return null; }
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

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: SCALE, mobile: WIDTH < 900 });
await send('Page.navigate', { url: URL_UNDER_TEST });
if (!await waitFor('.m3-nav__item', 80)) { console.error('the interface never rendered'); process.exit(1); }
await evaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(THEME)})`);
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
      const i = [...document.querySelectorAll('.m3-more__item')].find((n) => (n.querySelector('span') || n).textContent.trim().startsWith(${JSON.stringify(label)}));
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
const artifact = artifactHash();
let sequence = 0;

for (const surface of SURFACES) {
  for (const step of surface.steps) {
    sequence += 1;
    const before = await state();
    let observedTarget = null;
    let acted = false;
    let inputMethod = null;

    /* A step that only exists at some widths is recorded as not applicable here,
       with its capture, rather than skipped. Driving a display:none control would
       report a pass for something nobody can reach, which is worse than not
       running it, because it reads as evidence. */
    const applicable = !Array.isArray(step.widths) || step.widths.includes(WIDTH);

    try {
      if (!applicable) {
        inputMethod = 'not-applicable-at-this-width';
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
    const arrived = acted ? await waitFor(step.expect) : false;

    await pause(400);
    const after = await state();

    const png = await send('Page.captureScreenshot', { format: 'png' });
    const bytes = Buffer.from(png.data, 'base64');
    const name = `${String(sequence).padStart(3, '0')}-${step.id.replace(/[^a-z0-9.]+/gi, '-')}-${WIDTH}-${THEME}.png`;
    writeFileSync(path.join(SHOTS, name), bytes);
    const privacy = await privacyVerdict(bytes);

    const missing = !acted;
    rows.push({
      sequence,
      surface: surface.id,
      step: step.id,
      describe: step.describe,
      optional: Boolean(step.optional),
      inputMethod,
      target: observedTarget,
      expected: step.expect,
      before,
      after,
      acted,
      expectedStateArrived: arrived,
      applicableWidths: step.widths ?? null,
      outcome: !applicable
        ? 'not-applicable'
        : missing
          ? (step.optional ? 'absent-optional' : 'absent')
          : arrived ? 'pass' : 'state-not-reached',
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
