/**
 * Measure the fonts in the running artifact, because the config cannot answer this.
 *
 * A `@font-face` family one character away from what the markup asks for produces
 * total fallback: every element keeps its correct styles, nothing throws, nothing
 * logs, and the whole interface is merely slightly wrong everywhere. Reading the
 * stylesheet does not reveal it, because the stylesheet is fine.
 *
 * So this asks the page four things it can only answer while running:
 *
 *   loaded      every family and weight the interface uses actually resolved
 *   resolved    the computed family on <body> is the one we vendored
 *   ligature    an icon glyph rendered as ONE glyph rather than as its own name
 *   local       no font, stylesheet or script came from another origin
 *
 * The ligature check is the interesting one. A subsetted ligature font renders an
 * unknown name as the literal English word, so "swap_vert" nine characters wide
 * and "swap_vert" one glyph wide are the difference between a working icon and
 * text nobody meant to ship. Width tells them apart; nothing else does.
 *
 * Usage:
 *   node scripts/ui-evidence/font-check.mjs --endpoint http://127.0.0.1:PORT/json/list \
 *     --url http://127.0.0.1:PORT/ [--out <file.json>]
 *
 * It never launches a browser. The isolated headless browser is launched by the
 * approved route and its debugging endpoint passed in.
 */

import { writeFileSync } from 'node:fs';
import { WebSocket } from 'ws';

const argument = (flag, fallback = null) => {
  const at = process.argv.indexOf(flag);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};

const ENDPOINT = argument('--endpoint');
const URL_UNDER_TEST = argument('--url');
const OUT = argument('--out');
if (!ENDPOINT || !URL_UNDER_TEST) {
  console.error('--endpoint and --url are required');
  process.exit(2);
}

/** Every family and weight the interface actually asks for. */
const EXPECTED = [
  { family: 'Space Grotesk', weights: [400, 500, 600, 700] },
  { family: 'IBM Plex Mono', weights: [400, 500, 600] },
  { family: 'Material Symbols Outlined', weights: [300] },
];

const targets = await (await fetch(ENDPOINT)).json();
if (targets.length !== 1 || targets[0].type !== 'page') {
  console.error(`not isolated: ${targets.length} targets`);
  process.exit(1);
}
if (new URL(targets[0].url).href !== new URL(URL_UNDER_TEST).href) {
  console.error(`the single target is ${targets[0].url}, expected ${URL_UNDER_TEST}`);
  process.exit(1);
}

const socket = new WebSocket(targets[0].webSocketDebuggerUrl, { suppressOrigin: true });
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
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 30000);
});
/* awaitPromise is deliberately not used: on this Node it can hang indefinitely
   even for a synchronous expression. Everything below is synchronous and polled. */
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await send('Runtime.enable');
await send('Page.enable');

/* A font nobody has used yet is not downloaded, so document.fonts.check reports
   it absent whether it exists or not. That is the browser being sensible and it
   is also indistinguishable from a broken @font-face, so ask for each face
   explicitly first. The returned promises are deliberately dropped: awaitPromise
   can hang on this Node, and check() answers the same question synchronously
   once the load lands. */
await evaluate(`(() => {
  const wanted = ${JSON.stringify(EXPECTED)};
  for (const entry of wanted) {
    for (const weight of entry.weights) {
      try { document.fonts.load(weight + " 16px '" + entry.family + "'"); } catch { /* reported below */ }
    }
  }
  return true;
})()`);

let status = 'unloaded';
for (let attempt = 0; attempt < 60 && status !== 'loaded'; attempt += 1) {
  status = await evaluate('document.fonts.status');
  if (status !== 'loaded') await pause(250);
}

// Then wait for the faces themselves, since status can settle before every one lands.
for (let attempt = 0; attempt < 60; attempt += 1) {
  const outstanding = await evaluate(`(() => {
    const wanted = ${JSON.stringify(EXPECTED)};
    let missing = 0;
    for (const entry of wanted) {
      for (const weight of entry.weights) {
        if (!document.fonts.check(weight + " 16px '" + entry.family + "'")) missing += 1;
      }
    }
    return missing;
  })()`);
  if (outstanding === 0) break;
  await pause(250);
}

const loaded = await evaluate(`(() => {
  const wanted = ${JSON.stringify(EXPECTED)};
  const results = [];
  for (const entry of wanted) {
    for (const weight of entry.weights) {
      results.push({
        family: entry.family,
        weight,
        available: document.fonts.check(weight + " 16px '" + entry.family + "'"),
      });
    }
  }
  return results;
})()`);

const resolved = await evaluate(`getComputedStyle(document.body).fontFamily`);

/* One glyph or nine characters. Measured, because it cannot be read. */
const ligature = await evaluate(`(() => {
  const make = (className) => {
    const node = document.createElement('span');
    if (className) node.className = className;
    node.textContent = 'swap_vert';
    node.style.position = 'absolute';
    node.style.visibility = 'hidden';
    node.style.whiteSpace = 'pre';
    document.body.appendChild(node);
    const width = node.getBoundingClientRect().width;
    node.remove();
    return width;
  };
  const asIcon = make('m3-icon');
  const asText = make(null);
  return { asIcon, asText, ratio: asText ? asIcon / asText : null };
})()`);

const requests = await evaluate(`(() => {
  const origin = location.origin;
  return performance.getEntriesByType('resource')
    .filter((entry) => !entry.name.startsWith(origin))
    .map((entry) => entry.name.slice(0, 160));
})()`);

socket.close();

const failures = [];
if (status !== 'loaded') failures.push(`document.fonts.status is ${status}`);
for (const entry of loaded) {
  if (!entry.available) failures.push(`${entry.family} ${entry.weight} did not load`);
}
if (!/Space Grotesk/.test(resolved)) failures.push(`body resolves to ${resolved}`);
// A single glyph is far narrower than the nine characters of its own name.
if (!(ligature.ratio !== null && ligature.ratio < 0.5)) {
  failures.push(`icon ligature did not apply: glyph ${ligature.asIcon}px vs text ${ligature.asText}px`);
}
for (const remote of requests) failures.push(`request left this origin: ${remote}`);

const report = {
  version: 1,
  url: URL_UNDER_TEST,
  fontsStatus: status,
  bodyFontFamily: resolved,
  families: loaded,
  ligature,
  offOriginRequests: requests,
  failures,
};
if (OUT) writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

console.log(`fonts status: ${status}`);
for (const entry of loaded) console.log(`  ${entry.available ? 'yes' : 'NO '}  ${entry.family} ${entry.weight}`);
console.log(`body resolves to: ${resolved}`);
console.log(`icon glyph ${ligature.asIcon}px vs the same text ${ligature.asText}px (ratio ${ligature.ratio?.toFixed(3)})`);
console.log(`requests off this origin: ${requests.length}`);
for (const failure of failures) console.log(`  FAIL  ${failure}`);
process.exitCode = failures.length ? 1 : 0;
