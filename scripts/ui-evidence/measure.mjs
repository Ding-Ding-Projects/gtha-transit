/**
 * Measure the running interface, because a stylesheet cannot tell you which rule won.
 *
 * Two rules can set the same property on the same element, and which one applies
 * is decided by specificity and order rather than by whichever file you happen to
 * have open. Reading the source answers a different question from the one being
 * asked. This asks the page.
 *
 * It reports three things:
 *
 *   sideways    whether the document scrolls horizontally, which is the single
 *               most common phone defect and is invisible in a screenshot taken
 *               at exactly the right width
 *   clipped     elements whose content is wider or taller than the box drawn for
 *               it, which is text cut off rather than wrapped
 *   covered     elements a fixed bar sits on top of, which a full-page capture
 *               cannot show because a sticky element renders at its stuck
 *               position and looks like a defect that is not there
 *
 * Plus the geometry and winning computed values for any selector asked about, so
 * "which rule won" has an answer that is not a guess.
 *
 * Usage:
 *   node scripts/ui-evidence/measure.mjs --endpoint http://127.0.0.1:PORT/json/list \
 *     --url http://127.0.0.1:PORT/ [--width 390] [--height 844] [--scale 1]
 *     [--theme dark] [--selectors ".a,.b"] [--props "display,font-family"]
 *     [--out report.json]
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
const WIDTH = Number(argument('--width', '390'));
const HEIGHT = Number(argument('--height', '844'));
const SCALE = Number(argument('--scale', '1'));
const THEME = argument('--theme', null);
const SELECTORS = (argument('--selectors', '') || '').split(',').map((one) => one.trim()).filter(Boolean);
const PROPS = (argument('--props', 'display,position,font-family,background-color,color') || '')
  .split(',').map((one) => one.trim()).filter(Boolean);
const OUT = argument('--out', null);

if (!ENDPOINT || !URL_UNDER_TEST) {
  console.error('--endpoint and --url are required');
  process.exit(2);
}

const targets = await (await fetch(ENDPOINT)).json();
if (targets.length !== 1 || targets[0].type !== 'page') {
  console.error(`not isolated: ${targets.length} targets`);
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
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: WIDTH < 900 });
await send('Page.navigate', { url: URL_UNDER_TEST });
await pause(2500);
if (THEME) {
  await evaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(THEME)})`);
  await pause(600);
}

const report = await evaluate(`(() => {
  const props = ${JSON.stringify(PROPS)};
  const selectors = ${JSON.stringify(SELECTORS)};
  const round = (value) => Math.round(value * 100) / 100;
  const describe = (node) => {
    const rect = node.getBoundingClientRect();
    const computed = getComputedStyle(node);
    const winning = {};
    for (const prop of props) winning[prop] = computed.getPropertyValue(prop).trim().slice(0, 80);
    return {
      tag: node.tagName.toLowerCase(),
      classes: (node.className && node.className.baseVal !== undefined ? node.className.baseVal : node.className || '').toString().slice(0, 80),
      text: (node.textContent || '').trim().slice(0, 40),
      rect: { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) },
      scroll: { width: node.scrollWidth, height: node.scrollHeight },
      client: { width: node.clientWidth, height: node.clientHeight },
      winning,
    };
  };

  // Sideways scroll: the body must never be wider than the viewport.
  const sideways = {
    documentScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    scrolls: document.documentElement.scrollWidth > window.innerWidth + 1,
  };

  // Content wider or taller than the box drawn for it, with overflow hidden, is
  // text cut off rather than wrapped. sr-only boxes are 1px on purpose.
  const clipped = [];
  for (const node of document.querySelectorAll('body *')) {
    const computed = getComputedStyle(node);
    if (computed.display === 'none' || computed.visibility === 'hidden') continue;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) continue;
    const hiddenX = computed.overflowX === 'hidden' || computed.overflowX === 'clip';
    const hiddenY = computed.overflowY === 'hidden' || computed.overflowY === 'clip';
    const overX = hiddenX && node.scrollWidth > node.clientWidth + 1;
    const overY = hiddenY && node.scrollHeight > node.clientHeight + 1;
    if (overX || overY) clipped.push({ ...describe(node), overX, overY });
    if (clipped.length >= 40) break;
  }

  /* Content scrolling UNDER a fixed bar is what a fixed bar is for, so counting
     every overlap reported fourteen defects that were the header working. The
     question worth asking is whether content is unreachable: hidden behind the
     top bar when scrolled to the top, or behind the bottom bar when scrolled to
     the end. Those are the two positions where scrolling further cannot help.
     A skip link fixed at top:-100px is not a bar and is excluded by its rect. */
  const covered = [];
  const bars = () => [...document.querySelectorAll('body *')].filter((node) => {
    const computed = getComputedStyle(node);
    if (computed.position !== 'fixed' || computed.visibility === 'hidden' || computed.display === 'none') return false;
    const rect = node.getBoundingClientRect();
    return rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight
      && rect.width >= window.innerWidth * 0.5;
  });
  const contentNodes = () => [...document.querySelectorAll('main *')].filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.height > 1 && rect.width > 1 && node.textContent && node.textContent.trim();
  });
  const checkEdge = (edge) => {
    for (const bar of bars()) {
      const barRect = bar.getBoundingClientRect();
      const isTop = barRect.top <= 2;
      const isBottom = barRect.bottom >= window.innerHeight - 2;
      if (edge === 'top' && !isTop) continue;
      if (edge === 'bottom' && !isBottom) continue;
      const nodes = contentNodes();
      const outermost = edge === 'top' ? nodes[0] : nodes[nodes.length - 1];
      if (!outermost || bar.contains(outermost) || outermost.contains(bar)) continue;
      const rect = outermost.getBoundingClientRect();
      const overlap = Math.min(rect.bottom, barRect.bottom) - Math.max(rect.top, barRect.top);
      if (overlap > 2) {
        covered.push({ edge, bar: (bar.className || '').toString().slice(0, 40), overlapPx: Math.round(overlap), ...describe(outermost) });
      }
    }
  };
  window.scrollTo(0, 0);
  checkEdge('top');
  window.scrollTo(0, document.documentElement.scrollHeight);
  checkEdge('bottom');
  window.scrollTo(0, 0);

  const asked = {};
  for (const selector of selectors) {
    const nodes = [...document.querySelectorAll(selector)];
    asked[selector] = nodes.length ? nodes.slice(0, 6).map(describe) : null;
  }

  return { sideways, clipped, covered, asked };
})()`);

await send('Emulation.clearDeviceMetricsOverride');
socket.close();

const result = {
  version: 1,
  url: URL_UNDER_TEST,
  viewport: { width: WIDTH, height: HEIGHT },
  displayScale: SCALE,
  theme: THEME,
  ...report,
};
if (OUT) writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);

console.log(`${WIDTH}x${HEIGHT} @${SCALE}x${THEME ? ' ' + THEME : ''}`);
console.log(`  sideways scroll: ${report.sideways.scrolls ? `YES (${report.sideways.documentScrollWidth}px in ${report.sideways.viewportWidth}px)` : 'no'}`);
console.log(`  clipped elements: ${report.clipped.length}`);
for (const entry of report.clipped.slice(0, 8)) {
  console.log(`    ${entry.tag}.${entry.classes.split(' ')[0]}  ${entry.scroll.width}x${entry.scroll.height} in ${entry.client.width}x${entry.client.height}  "${entry.text}"`);
}
console.log(`  content unreachable behind a bar: ${report.covered.length}`);
for (const entry of report.covered.slice(0, 6)) {
  console.log(`    at the ${entry.edge}, ${entry.overlapPx}px under .${entry.bar.split(' ')[0]}  "${entry.text}"`);
}
for (const [selector, nodes] of Object.entries(report.asked)) {
  if (!nodes) { console.log(`  ${selector}: NOT PRESENT`); continue; }
  for (const node of nodes) {
    console.log(`  ${selector}: ${node.rect.width}x${node.rect.height} at ${node.rect.x},${node.rect.y}  ${Object.entries(node.winning).map(([k, v]) => k + '=' + v).join('  ')}`);
  }
}

process.exitCode = report.sideways.scrolls || report.clipped.length || report.covered.length ? 1 : 0;
