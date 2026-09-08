/**
 * Record a walkthrough of the real built application.
 *
 * Stills prove a surface exists. Only a recording proves the thing moves: that a
 * control responds, that a surface advances, that a slow read reports progress
 * rather than hanging. Half the defects worth catching are invisible in a still.
 *
 * **It never records the screen.** Recording a monitor captures whatever the person
 * at the machine was actually doing, which is their private data and none of this
 * project's business. This records only the page: frames come from the debugging
 * protocol's own screencast of the renderer, on an off-screen desktop, so the
 * visible desktop is never part of it. The recording tool available on this host
 * captures a monitor, which is exactly why it is not used.
 *
 * The encoding is done by the browser. There is no video encoder on this machine and
 * adding one as a dependency to write a short walkthrough is a poor trade, so the
 * frames are fed into a canvas and recorded through MediaRecorder, which is already
 * there and already correct.
 *
 * Usage:
 *   node scripts/ui-evidence/record-walkthrough.mjs \
 *     --endpoint http://127.0.0.1:PORT/json/list --url https://example.org/ \
 *     --commit <40 hex> --out docs/captures/walkthrough.webm
 */

import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
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
const URL_UNDER_TEST = argument('--url');
const COMMIT = argument('--commit');
const OUT = path.resolve(root, argument('--out', 'docs/captures/walkthrough.webm'));
const THEME = argument('--theme', 'dark');
const WIDTH = Number(argument('--width', '1280'));
const HEIGHT = Number(argument('--height', '800'));

for (const [name, value] of [['--endpoint', ENDPOINT], ['--url', URL_UNDER_TEST], ['--commit', COMMIT]]) {
  if (!value) { console.error(name + ' is required'); process.exit(2); }
}
if (!/^[0-9a-f]{40}$/.test(COMMIT)) { console.error('--commit must be a full sha'); process.exit(2); }

/* A recording that has to live in Git is a recording somebody has to download, so
   it is bounded rather than as long as it happens to run. Dropping frame rate loses
   smoothness; dropping the walkthrough loses the point, so the frame rate goes
   first and the ceiling is stated in the report. */
const FPS = 5;
const MAX_FRAMES = 420;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const targets = await (await fetch(ENDPOINT)).json();
const pages = targets.filter((entry) => entry && entry.type === 'page');
if (pages.length !== 1) { console.error('target-count ' + pages.length); process.exit(1); }

const socket = new WebSocket(pages[0].webSocketDebuggerUrl, { suppressOrigin: true });
await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });

let messageId = 0;
const pending = new Map();
const frames = [];
let capturing = false;

socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.method === 'Page.screencastFrame') {
    if (capturing && frames.length < MAX_FRAMES) frames.push(message.params.data);
    socket.send(JSON.stringify({ id: ++messageId, method: 'Page.screencastFrameAck', params: { sessionId: message.params.sessionId } }));
    return;
  }
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
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false });
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
await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL_UNDER_TEST });
if (!await waitFor('!!document.querySelector(".m3-nav__item")')) {
  console.error('the interface never rendered'); process.exit(1);
}
await evaluate('(() => { try { window.localStorage.clear(); } catch {} try { window.sessionStorage.clear(); } catch {} return true; })()');
await send('Page.navigate', { url: URL_UNDER_TEST });
if (!await waitFor('!!document.querySelector(".m3-nav__item")')) {
  console.error('the interface never came back'); process.exit(1);
}
for (let attempt = 0; attempt < 3; attempt += 1) {
  if (await evaluate('document.documentElement.getAttribute("data-theme")') === THEME) break;
  await evaluate('(() => { const n = document.querySelector(".m3-nav__theme"); if (!n) return false; n.click(); return true; })()');
  await pause(600);
}
await pause(1200);

/** Click a navigation destination by its label, exactly as the ledger does. */
const go = (label) => evaluate('(() => {'
  + ' const want = ' + JSON.stringify(label) + ';'
  + ' const hit = [...document.querySelectorAll(".m3-nav__item")].find((n) => {'
  + '   const l = n.querySelector(".m3-nav__label, .m3-more__label"); return l && l.textContent.trim() === want; });'
  + ' if (!hit) return false; hit.click(); return true; })()');
const clickText = (text) => evaluate('(() => {'
  + ' const n = [...document.querySelectorAll("button, a[href], summary")]'
  + '   .find((x) => (x.textContent || "").trim().includes(' + JSON.stringify(text) + '));'
  + ' if (!n) return false; n.click(); return true; })()');
const type = (selector, value) => evaluate('(() => {'
  + ' const n = document.querySelector(' + JSON.stringify(selector) + '); if (!n) return false;'
  + ' n.focus();'
  + ' Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(n, ' + JSON.stringify(value) + ');'
  + ' n.dispatchEvent(new Event("input", { bubbles: true })); return true; })()');

/* The route a person actually takes, rather than a highlight reel: arrive, plan a
   real journey, look at what the network is doing, find a vehicle, ask about a
   garage, and change the appearance. Empty states and honest failures are part of
   it, because they are what most people meet first. */
const walkthrough = [
  ['arrive on the composer', async () => { await go('Plan'); }, 2200],
  ['type an origin', async () => { await type('.place-field:nth-of-type(1) input', 'Union Station'); }, 2000],
  ['choose it from the published places', async () => { await clickText('Union'); }, 1600],
  ['open the departure chip', async () => { await clickText('Leaving'); }, 1600],
  ['close it again', async () => { await clickText('Leaving'); }, 1200],
  ['open the priority chip', async () => { await clickText('Priority'); }, 1800],
  ['prefer a garage', async () => { await evaluate('(() => { const n = document.querySelector(".garage-picker .garage-choice input"); if (!n) return false; n.click(); return true; })()'); }, 1600],
  ['expand that garage', async () => { await clickText('Show more details'); }, 2400],
  ['collapse it', async () => { await clickText('Hide details'); }, 1200],
  ['see what the network is doing', async () => { await go('Live'); }, 2600],
  ['find a vehicle', async () => { await go('Vehicles'); }, 2600],
  ['ask which garage it lives at', async () => { await go('Out of division'); }, 3000],
  ['filter to one classification', async () => { await evaluate('(() => { const n = document.querySelector(".division-filter-chips .pill:nth-of-type(2)"); if (!n) return false; n.click(); return true; })()'); }, 2200],
  ['read the service record', async () => { await go('History'); }, 2400],
  ['settle in', async () => { await go('Settings'); }, 2400],
  ['change the appearance', async () => { await evaluate('(() => { const n = document.querySelector(".m3-nav__theme"); if (!n) return false; n.click(); return true; })()'); }, 2400],
  ['and back', async () => { await evaluate('(() => { const n = document.querySelector(".m3-nav__theme"); if (!n) return false; n.click(); return true; })()'); }, 1800],
];

await send('Page.startScreencast', { format: 'jpeg', quality: 62, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1 });
capturing = true;

for (const [label, action, settle] of walkthrough) {
  process.stdout.write('  ' + label + ' ... ');
  const before = frames.length;
  try { await action(); } catch (cause) { console.log('failed: ' + String(cause.message || cause).slice(0, 60)); continue; }
  await pause(settle);
  console.log((frames.length - before) + ' frames');
  if (frames.length >= MAX_FRAMES) { console.log('  frame ceiling reached, stopping the walkthrough here'); break; }
}

capturing = false;
await send('Page.stopScreencast');
console.log('  ' + frames.length + ' frames captured');
if (!frames.length) { console.error('nothing was recorded'); process.exit(1); }

// ------------------------------------------------------------------ encode --

await send('Emulation.clearDeviceMetricsOverride');
await send('Page.navigate', { url: 'about:blank' });
await pause(400);

await evaluate('window.__frames = [];');
/* Frames go over in batches. One expression carrying every frame would be a
   multi-megabyte string, and a protocol message that large is a good way to find
   out what the limit is the hard way. */
const BATCH = 8;
for (let at = 0; at < frames.length; at += BATCH) {
  const slice = frames.slice(at, at + BATCH);
  await evaluate('window.__frames.push(...' + JSON.stringify(slice) + '); window.__frames.length');
}
const delivered = await evaluate('window.__frames.length');
if (delivered !== frames.length) {
  console.error('only ' + delivered + ' of ' + frames.length + ' frames arrived in the page');
  process.exit(1);
}

const encoded = await send('Runtime.evaluate', {
  awaitPromise: true,
  returnByValue: true,
  expression: `(async () => {
    const load = (data) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = 'data:image/jpeg;base64,' + data;
    });
    const images = [];
    for (const data of window.__frames) images.push(await load(data));
    const canvas = document.createElement('canvas');
    canvas.width = images[0].naturalWidth;
    canvas.height = images[0].naturalHeight;
    const context = canvas.getContext('2d');
    const stream = canvas.captureStream(${FPS});
    const type = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9' : 'video/webm;codecs=vp8';
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 900000 });
    recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
    const finished = new Promise((res) => { recorder.onstop = res; });
    recorder.start();
    for (const image of images) {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      await new Promise((res) => setTimeout(res, ${Math.round(1000 / FPS)}));
    }
    await new Promise((res) => setTimeout(res, 400));
    recorder.stop();
    await finished;
    const blob = new Blob(chunks, { type: 'video/webm' });
    const buffer = await blob.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return { data: btoa(binary), width: canvas.width, height: canvas.height, frames: images.length, mimeType: type };
  })()`,
});

const result = encoded?.result?.value;
socket.close();
if (!result || !result.data) { console.error('the browser returned no recording'); process.exit(1); }

mkdirSync(path.dirname(OUT), { recursive: true });
const bytes = Buffer.from(result.data, 'base64');
writeFileSync(OUT, bytes);

const size = statSync(OUT).size;
const digest = createHash('sha256').update(bytes).digest('hex');

/* A manifest beside the file, so a guard can check the recording is the one it
   claims to be rather than trusting a filename. A recording of an interface the
   project no longer builds is confidently wrong, and a reader watching it has no
   way to tell which version they are looking at. */
const relative = path.relative(root, OUT).split(path.sep).join('/');
writeFileSync(path.join(path.dirname(OUT), 'walkthrough.json'), JSON.stringify({
  version: 1,
  file: relative,
  sourceCommit: COMMIT,
  recordedAt: new Date().toISOString(),
  sha256: digest,
  bytes: size,
  frames: result.frames,
  width: result.width,
  height: result.height,
  framesPerSecond: FPS,
  mimeType: result.mimeType,
  theme: THEME,
  steps: walkthrough.map((step) => step[0]),
  note: 'Recorded from the renderer through the debugging protocol on an off-screen desktop. The machine screen is never captured.',
}, null, 2) + '\n');

console.log('  ' + relative);
console.log('  ' + result.frames + ' frames at ' + result.width + 'x' + result.height
  + ', ' + result.mimeType + ', ' + Math.round(size / 1024) + ' KiB');
console.log('  sha256 ' + digest);
console.log('  source commit ' + COMMIT);
