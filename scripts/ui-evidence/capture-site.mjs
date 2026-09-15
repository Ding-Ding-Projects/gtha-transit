/**
 * Photograph the published documentation site at desktop and phone widths.
 *
 * Like the other evidence scripts it never opens a browser: it is handed the
 * debugging list endpoint of an isolated browser that exposes exactly one page,
 * and refuses to run otherwise. It navigates that page to each published URL,
 * waits for the document to finish loading, and writes one PNG per page, width
 * and theme, plus a JSON record naming the URL, the commit the page itself
 * reports, the viewport and each image's SHA-256.
 *
 * Usage:
 *   node scripts/ui-evidence/capture-site.mjs \
 *     --endpoint http://127.0.0.1:PORT/json/list \
 *     [--site https://ding-ding-projects.github.io/gtha-transit/] [--out docs/interface/captures/site]
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';

const argument = (name, fallback = null) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
};

const ENDPOINT = argument('--endpoint');
const SITE = argument('--site', 'https://ding-ding-projects.github.io/gtha-transit/');
const OUT = argument('--out', 'docs/interface/captures/site');
if (!ENDPOINT) { console.error('--endpoint is required'); process.exit(2); }

const PAGES = [
  { id: 'landing', path: '' },
  { id: 'docs', path: 'docs/' },
];
const TUPLES = [
  { width: 1440, height: 1000, mobile: false, theme: 'light' },
  { width: 390, height: 844, mobile: true, theme: 'dark' },
];

const targets = await (await fetch(ENDPOINT)).json();
const pages = targets.filter((entry) => entry && entry.type === 'page');
if (targets.length !== 1 || pages.length !== 1) { console.error(`expected exactly one page target, found ${targets.length}`); process.exit(1); }

const socket = new WebSocket(pages[0].webSocketDebuggerUrl, { suppressOrigin: true });
await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
let id = 0;
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
  id += 1;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.value;

mkdirSync(OUT, { recursive: true });
const records = [];
for (const tuple of TUPLES) {
  await send('Emulation.setDeviceMetricsOverride', { width: tuple.width, height: tuple.height, deviceScaleFactor: 1, mobile: tuple.mobile });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: tuple.theme }] });
  for (const page of PAGES) {
    const url = new URL(page.path, SITE).href;
    await send('Page.navigate', { url });
    let ready = false;
    for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
      await pause(250);
      ready = (await evaluate('document.readyState')) === 'complete' && (await evaluate('location.href')) === url;
    }
    if (!ready) { console.error(`${url} did not finish loading`); process.exit(1); }
    await pause(600);
    const overflow = await evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    const commit = await evaluate("(document.body.innerText.match(/\\b[0-9a-f]{7,40}\\b/) || [null])[0]");
    const shot = Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
    const file = `${page.id}-${tuple.width}-${tuple.theme}.png`;
    writeFileSync(path.join(OUT, file), shot);
    records.push({ page: page.id, url, width: tuple.width, height: tuple.height, theme: tuple.theme, horizontalOverflowPx: overflow, reportedCommit: commit, file, sha256: createHash('sha256').update(shot).digest('hex') });
    console.log(`${file}: overflow ${overflow}px, page reports ${commit}`);
  }
}
await send('Page.navigate', { url: 'about:blank' });
writeFileSync(path.join(OUT, 'captures.json'), `${JSON.stringify({ schemaVersion: 1, site: SITE, capturedAt: new Date().toISOString(), records }, null, 2)}\n`);
socket.close();
