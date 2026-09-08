/**
 * One capture of the running artifact, at a stated viewport, scale and theme.
 *
 * Deliberately small. The interaction ledger drives every control and keeps a
 * receipt per click; this exists for the far more common case of wanting to look
 * at one surface right now, without that being a reason to write another
 * throwaway script that nobody can re-run tomorrow.
 *
 * It refuses to photograph anything unless the debugging endpoint shows exactly
 * one target and that target is the page asked for, because a capture of the
 * wrong page is worse than no capture: it looks like evidence.
 *
 * Usage:
 *   node scripts/ui-evidence/shot.mjs --endpoint http://127.0.0.1:PORT/json/list \
 *     --url http://127.0.0.1:PORT/ --out shot.png [--width 1440] [--height 900]
 *     [--scale 1] [--theme dark] [--full] [--wait 2500]
 */

import { writeFileSync } from 'node:fs';
import { WebSocket } from 'ws';

const argument = (flag, fallback = null) => {
  const at = process.argv.indexOf(flag);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const flag = (name) => process.argv.includes(name);

const ENDPOINT = argument('--endpoint');
const URL_UNDER_TEST = argument('--url');
const OUT = argument('--out');
const WIDTH = Number(argument('--width', '1440'));
const HEIGHT = Number(argument('--height', '900'));
const SCALE = Number(argument('--scale', '1'));
const THEME = argument('--theme', null);
const WAIT = Number(argument('--wait', '2500'));

if (!ENDPOINT || !URL_UNDER_TEST || !OUT) {
  console.error('--endpoint, --url and --out are required');
  process.exit(2);
}

const targets = await (await fetch(ENDPOINT)).json();
if (targets.length !== 1 || targets[0].type !== 'page') {
  console.error(`not isolated: ${targets.length} targets`);
  process.exit(1);
}
if (new URL(targets[0].url).origin !== new URL(URL_UNDER_TEST).origin) {
  console.error(`the single target is ${targets[0].url}`);
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
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 40000);
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: WIDTH < 900,
});
await send('Page.navigate', { url: URL_UNDER_TEST });
await pause(WAIT);
if (THEME) {
  await send('Runtime.evaluate', {
    expression: `document.documentElement.setAttribute('data-theme', ${JSON.stringify(THEME)})`,
  });
  await pause(600);
}

/* A sticky element in a beyond-viewport capture renders at its stuck position, so
   a full-page image can show a bar floating mid-page that is perfectly placed in
   the real viewport. Full is opt-in for that reason. */
const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: flag('--full') });
const bytes = Buffer.from(png.data, 'base64');
writeFileSync(OUT, bytes);
await send('Emulation.clearDeviceMetricsOverride');
socket.close();
console.log(`${OUT}  ${bytes.byteLength} bytes  ${WIDTH}x${HEIGHT} @${SCALE}x${THEME ? ' ' + THEME : ''}`);
