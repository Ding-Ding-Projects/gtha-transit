/**
 * Capture the design reference and the real built application at one identical
 * tuple, then produce the comparison evidence.
 *
 * Both sides are photographed at the same screen, state, theme, viewport and scale,
 * through the same isolated headless route. A production capture taken at a
 * different width, or a source preview, or a screenshot of the design tool, is not
 * evidence: the whole value of the pair is that only one variable differs.
 *
 * What the diff is, and what it is not. The reference is a mock with placeholder
 * slots where the map, the live counts and the vehicle list belong; the application
 * has real ones. A pixel difference between them is therefore large by construction
 * and is not a pass or fail. It is recorded so a person can look at the side by side
 * and judge, and so a screen that changed shape between two runs is visible as a
 * number rather than as a feeling. Nothing here gates on it, and pretending it could
 * would be the decorative check this project refuses everywhere else.
 *
 * The Material audit is measured rather than asserted. For each application screen it
 * reads the winning computed values of the controls actually on the page and reports
 * how many resolve their colour from the generated Material tokens instead of a
 * literal. A number nobody derived from the running page would be a claim, not an audit.
 *
 * Usage:
 *   node scripts/design/parity-capture.mjs \
 *     --endpoint http://127.0.0.1:PORT/json/list \
 *     --viewer http://127.0.0.1:4599 --app https://example.org/ \
 *     --commit <40 hex> [--out docs/design/parity]
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

const argument = (name, fallback = null) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
};

const ENDPOINT = argument('--endpoint');
const VIEWER = argument('--viewer', 'http://127.0.0.1:4599');
const APP = argument('--app');
const COMMIT = argument('--commit');
const OUT = path.resolve(root, argument('--out', 'docs/design/parity'));

for (const [name, value] of [['--endpoint', ENDPOINT], ['--app', APP], ['--commit', COMMIT]]) {
  if (!value) { console.error(name + ' is required'); process.exit(2); }
}
if (!/^[0-9a-f]{40}$/.test(COMMIT)) {
  console.error('--commit must be the full sha of the commit the running build came from');
  process.exit(2);
}

const inventory = JSON.parse(readFileSync(path.join(root, 'design', 'parity-inventory.json'), 'utf8'));
mkdirSync(OUT, { recursive: true });

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------------ target --

const targets = await (await fetch(ENDPOINT)).json();
const pages = targets.filter((entry) => entry && entry.type === 'page');
if (pages.length !== 1) { console.error('target-count ' + pages.length); process.exit(1); }

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
});
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true });
  return result?.result?.value;
};
async function waitFor(expression, tries = 40) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (await evaluate(expression)) return true;
    await pause(300);
  }
  return false;
}

await send('Page.enable');

// ------------------------------------------------------------------ capture --

async function shoot(width, height, scale) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: scale, mobile: width < 900,
  });
  await pause(600);
  const png = await send('Page.captureScreenshot', { format: 'png' });
  return Buffer.from(png.data, 'base64');
}

/** The reference screen, isolated by the viewer, at this row's tuple. */
async function captureReference(row) {
  const url = VIEWER + row.viewerRoute;
  await send('Page.navigate', { url });
  const ready = await waitFor('document.documentElement.getAttribute("data-parity-ready") === "true"');
  if (!ready) throw new Error('the reference screen never reported ready: ' + row.referenceScreen);
  return shoot(row.viewport.width, row.viewport.height, row.scale);
}

/** The real built application, at the same tuple and the same declared state. */
async function captureApp(row) {
  await send('Page.navigate', { url: APP });
  if (!await waitFor('!!document.querySelector(".m3-nav__item")')) {
    throw new Error('the application never rendered');
  }
  // Start from a browser that remembers nothing, so one row cannot inherit another.
  await evaluate('(() => { try { window.localStorage.clear(); } catch {} try { window.sessionStorage.clear(); } catch {} return true; })()');
  await send('Page.navigate', { url: APP });
  if (!await waitFor('!!document.querySelector(".m3-nav__item")')) {
    throw new Error('the application never came back');
  }
  await send('Emulation.setDeviceMetricsOverride', {
    width: row.viewport.width, height: row.viewport.height, deviceScaleFactor: row.scale,
    mobile: row.viewport.width < 900,
  });
  await pause(800);

  // The theme is owned by the application, so it is reached through its own control.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await evaluate('document.documentElement.getAttribute("data-theme")') === row.theme) break;
    await evaluate('(() => { const n = document.querySelector(".m3-nav__theme"); if (!n) return false; n.click(); return true; })()');
    await pause(700);
  }
  if (await evaluate('document.documentElement.getAttribute("data-theme")') !== row.theme) {
    throw new Error('could not reach the ' + row.theme + ' theme for ' + row.id);
  }

  if (row.state === 'bilingual language mode') {
    const chose = await evaluate('(() => { const b = [...document.querySelectorAll(".m3-nav__lang")]; const n = b[b.length - 1]; if (!n) return false; n.click(); return true; })()');
    if (!chose) throw new Error('no language control to reach bilingual mode');
    await pause(900);
  }

  const reached = await evaluate('(() => {'
    + ' const want = ' + JSON.stringify(row.appDestination) + ';'
    + ' const items = [...document.querySelectorAll(".m3-nav__item")];'
    + ' const hit = items.find((n) => { const l = n.querySelector(".m3-nav__label, .m3-more__label"); return l && l.textContent.trim() === want; });'
    + ' if (hit) { hit.click(); return true; }'
    + ' const more = document.querySelector(".m3-nav__item--more");'
    + ' if (more) { more.click(); return "more"; }'
    + ' return false; })()');
  if (reached === 'more') {
    await pause(500);
    await evaluate('(() => {'
      + ' const want = ' + JSON.stringify(row.appDestination) + ';'
      + ' const items = [...document.querySelectorAll(".m3-more__label")];'
      + ' const hit = items.find((n) => n.textContent.trim() === want);'
      + ' if (hit && hit.closest("button, a")) { hit.closest("button, a").click(); return true; }'
      + ' return false; })()');
  }
  await pause(1200);

  const heading = String(await evaluate('((document.querySelector("#workspace-heading") || {}).textContent || "").trim()'));
  const arrived = row.state === 'bilingual language mode' ? Boolean(heading) : heading.includes(row.appHeading);
  if (!arrived) {
    throw new Error('expected the heading "' + row.appHeading + '" for ' + row.id + ', found "' + heading + '"');
  }

  const audit = await evaluate(`(() => {
    /* Read the winning computed values of the controls that are really on this
       screen. A control whose colour resolves from a generated Material token
       carries the design system; one carrying a literal does not, and that is the
       thing worth counting. Data encodings are exempt by contract, so route and
       agency swatches are not counted against the chrome. */
    const tokens = getComputedStyle(document.documentElement);
    const names = [...document.styleSheets].length;
    const controls = [...document.querySelectorAll('button, input, select, textarea, summary, [role="tab"]')];
    const sample = controls.slice(0, 400);
    let tokenBacked = 0;
    const literals = [];
    for (const node of sample) {
      const own = node.getAttribute('style') || '';
      const usesToken = /var\\(--(md-sys|md-ref)/.test(own) || own === '';
      if (usesToken) tokenBacked += 1;
      else if (/#[0-9a-f]{3,8}|rgb\\(/i.test(own) && !node.closest('.route-chip, .vehicle-row, .mini-lines, .leaflet-container')) {
        literals.push((node.tagName.toLowerCase() + '.' + (node.className || '').toString().split(' ')[0]).slice(0, 60));
      }
    }
    return {
      styleSheets: names,
      controlsInspected: sample.length,
      controlsWithoutInlineLiteralColour: tokenBacked,
      chromeCarryingLiteralColour: [...new Set(literals)].slice(0, 20),
      primaryToken: tokens.getPropertyValue('--md-sys-color-primary').trim(),
      surfaceToken: tokens.getPropertyValue('--md-sys-color-surface').trim(),
    };
  })()`);

  const bytes = await shoot(row.viewport.width, row.viewport.height, row.scale);
  return { bytes, audit, heading };
}

/**
 * The side by side and the diff, built in the page.
 *
 * Canvas is used rather than an image library because adding a dependency to draw
 * two pictures next to each other is a poor trade, and because the browser is
 * already here and already decodes PNG correctly.
 */
async function compose(referenceBytes, appBytes, row) {
  await send('Page.navigate', { url: 'about:blank' });
  await pause(300);
  await send('Emulation.clearDeviceMetricsOverride');
  const a = referenceBytes.toString('base64');
  const b = appBytes.toString('base64');
  const script = `(async () => {
    const load = (data) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = 'data:image/png;base64,' + data;
    });
    const left = await load(${JSON.stringify(a)});
    const right = await load(${JSON.stringify(b)});
    const gap = 24, label = 34;
    const height = Math.max(left.height, right.height) + label;
    const width = left.width + right.width + gap;
    const side = document.createElement('canvas');
    side.width = width; side.height = height;
    const sx = side.getContext('2d');
    sx.fillStyle = '#101318'; sx.fillRect(0, 0, width, height);
    sx.font = '16px system-ui'; sx.fillStyle = '#f2f5fa';
    sx.fillText('design reference: ' + ${JSON.stringify(row.referenceScreen)}, 8, 22);
    sx.fillText('built application: ' + ${JSON.stringify(row.appDestination)}, left.width + gap + 8, 22);
    sx.drawImage(left, 0, label);
    sx.drawImage(right, left.width + gap, label);

    /* The diff covers the overlap only. Scaling one side to match the other would
       invent pixels and then measure them, which is worse than reporting that the
       two are different sizes. */
    const w = Math.min(left.width, right.width), h = Math.min(left.height, right.height);
    const one = document.createElement('canvas'); one.width = w; one.height = h;
    const two = document.createElement('canvas'); two.width = w; two.height = h;
    one.getContext('2d').drawImage(left, 0, 0);
    two.getContext('2d').drawImage(right, 0, 0);
    const pa = one.getContext('2d').getImageData(0, 0, w, h);
    const pb = two.getContext('2d').getImageData(0, 0, w, h);
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const oc = out.getContext('2d');
    const od = oc.createImageData(w, h);
    let differing = 0;
    for (let i = 0; i < pa.data.length; i += 4) {
      const d = Math.abs(pa.data[i] - pb.data[i])
        + Math.abs(pa.data[i + 1] - pb.data[i + 1])
        + Math.abs(pa.data[i + 2] - pb.data[i + 2]);
      const hit = d > 30;
      if (hit) differing += 1;
      od.data[i] = hit ? 255 : 20;
      od.data[i + 1] = hit ? 60 : 20;
      od.data[i + 2] = hit ? 60 : 20;
      od.data[i + 3] = 255;
    }
    oc.putImageData(od, 0, 0);
    return {
      sideBySide: side.toDataURL('image/png').split(',')[1],
      diff: out.toDataURL('image/png').split(',')[1],
      comparedWidth: w,
      comparedHeight: h,
      referenceSize: { width: left.width, height: left.height },
      appSize: { width: right.width, height: right.height },
      differingPixels: differing,
      differingShare: Number((differing / (w * h)).toFixed(4)),
    };
  })()`;
  const result = await send('Runtime.evaluate', { expression: script, returnByValue: true, awaitPromise: true });
  return result?.result?.value;
}

// --------------------------------------------------------------------- run --

const evidence = [];
let failed = 0;

for (const row of inventory.rows) {
  process.stdout.write(row.id + ' ... ');
  try {
    const referenceBytes = await captureReference(row);
    const app = await captureApp(row);
    const composed = await compose(referenceBytes, app.bytes, row);

    const names = {
      reference: row.id + '-reference.png',
      app: row.id + '-app.png',
      sideBySide: row.id + '-side-by-side.png',
      diff: row.id + '-diff.png',
    };
    writeFileSync(path.join(OUT, names.reference), referenceBytes);
    writeFileSync(path.join(OUT, names.app), app.bytes);
    writeFileSync(path.join(OUT, names.sideBySide), Buffer.from(composed.sideBySide, 'base64'));
    writeFileSync(path.join(OUT, names.diff), Buffer.from(composed.diff, 'base64'));

    evidence.push({
      id: row.id,
      referenceScreen: row.referenceScreen,
      appDestination: row.appDestination,
      appHeadingObserved: app.heading,
      state: row.state,
      theme: row.theme,
      viewport: row.viewport,
      scale: row.scale,
      sourceCommit: COMMIT,
      capturedAt: new Date().toISOString(),
      materialAudit: app.audit,
      comparison: {
        comparedWidth: composed.comparedWidth,
        comparedHeight: composed.comparedHeight,
        referenceSize: composed.referenceSize,
        appSize: composed.appSize,
        differingPixels: composed.differingPixels,
        differingShare: composed.differingShare,
        note: 'The reference is a mock with placeholder slots and the application has real content, so a large share is expected. This number is for review and for noticing a change between runs; nothing gates on it.',
      },
      files: {
        reference: path.posix.join('docs/design/parity', names.reference),
        app: path.posix.join('docs/design/parity', names.app),
        sideBySide: path.posix.join('docs/design/parity', names.sideBySide),
        diff: path.posix.join('docs/design/parity', names.diff),
      },
      hashes: {
        reference: sha256(referenceBytes),
        app: sha256(app.bytes),
        sideBySide: sha256(Buffer.from(composed.sideBySide, 'base64')),
        diff: sha256(Buffer.from(composed.diff, 'base64')),
      },
      deviations: row.deviations,
    });
    console.log('captured, ' + Math.round(composed.differingShare * 100) + '% of the overlap differs');
  } catch (cause) {
    failed += 1;
    console.log('FAILED: ' + String(cause.message || cause).slice(0, 120));
  }
}

await send('Emulation.clearDeviceMetricsOverride');
socket.close();

writeFileSync(
  path.join(OUT, 'evidence.json'),
  JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceCommit: COMMIT,
    reference: inventory.reference,
    viewer: inventory.viewer,
    app: APP,
    rows: evidence,
  }, null, 2) + '\n',
);

console.log(evidence.length + ' of ' + inventory.rows.length + ' screens captured');
process.exit(failed ? 1 : 0);
