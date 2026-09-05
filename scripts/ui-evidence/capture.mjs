import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const MAX_PNG = 32 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
class EvidenceError extends Error {}
const requireThat = (condition, code) => { if (!condition) throw new EvidenceError(code); };
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const boundedText = value => typeof value === 'string' && value.length > 0 && value.length <= 512;

function ownedPath(root, name) {
  requireThat(typeof name === 'string' && !isAbsolute(name), 'relative-path-required');
  const base = realpathSync(root);
  const path = resolve(base, name);
  const parent = realpathSync(dirname(path));
  for (const item of [path, parent]) {
    const part = relative(base, item);
    requireThat(!part.startsWith('..') && !isAbsolute(part), 'path-outside-run-root');
  }
  requireThat(path !== base, 'file-path-required');
  return path;
}

function readOwned(root, entry) {
  const path = ownedPath(root, entry.path);
  requireThat(realpathSync(path) === path, 'linked-evidence-path');
  const bytes = readFileSync(path);
  requireThat(hash(bytes) === entry.sha256, 'evidence-hash-mismatch');
  return bytes;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Validate bounded, non-interlaced 8-bit browser PNGs, including decoded rows. */
export function inspectPng(bytes) {
  requireThat(Buffer.isBuffer(bytes) && bytes.length <= MAX_PNG && bytes.length >= 45, 'png-size');
  requireThat(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'png-signature');
  let offset = 8, width, height, channels, ended = false, dataEnded = false;
  const compressed = [];
  while (offset < bytes.length) {
    requireThat(offset + 12 <= bytes.length, 'png-truncated');
    const length = bytes.readUInt32BE(offset);
    requireThat(length <= MAX_PNG && offset + 12 + length <= bytes.length, 'png-chunk-size');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    requireThat(crc32(bytes.subarray(offset + 4, offset + 8 + length)) === bytes.readUInt32BE(offset + 8 + length), 'png-crc');
    if (offset === 8) {
      requireThat(type === 'IHDR' && length === 13, 'png-header');
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[data[9]];
      requireThat(width > 0 && height > 0 && width * height <= 16_000_000, 'png-dimensions');
      requireThat(data[8] === 8 && channels && data[10] === 0 && data[11] === 0 && data[12] === 0, 'png-unsupported-format');
    } else if (type === 'IDAT') {
      requireThat(!dataEnded, 'png-data-order'); compressed.push(data);
    } else if (type === 'IEND') {
      requireThat(length === 0 && compressed.length > 0, 'png-end');
      ended = true; offset += 12; break;
    } else {
      requireThat(type !== 'IHDR' && !['acTL', 'fcTL', 'fdAT'].includes(type), 'png-unexpected-chunk');
      requireThat(type === 'PLTE' || (type.charCodeAt(0) & 32) !== 0, 'png-unknown-critical-chunk');
      if (compressed.length) dataEnded = true;
    }
    offset += length + 12;
  }
  requireThat(ended && offset === bytes.length, 'png-incomplete-or-trailing');
  const rowSize = width * channels + 1;
  const decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: rowSize * height });
  requireThat(decoded.length === rowSize * height, 'png-decoded-size');
  for (let row = 0; row < height; row++) requireThat(decoded[row * rowSize] <= 4, 'png-row-filter');
  return { width, height, sha256: hash(bytes), bytes: bytes.length };
}

function validateUrls(plan) {
  for (const value of [plan.expectedUrl, plan.endpoint]) {
    requireThat(typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\u0000-\u0020\u007f]/.test(value), 'url-shape');
  }
  let expected, endpoint;
  try { expected = new URL(plan.expectedUrl); endpoint = new URL(plan.endpoint); }
  catch { throw new EvidenceError('url-invalid'); }
  requireThat(['http:', 'https:'].includes(expected.protocol) && !expected.username && !expected.password, 'expected-url');
  // No query or fragment is needed for current public capture routes. Refuse all
  // such material before invoking another process or constructing any record.
  requireThat(!expected.search && !expected.hash && !plan.expectedUrl.includes('?') && !plan.expectedUrl.includes('#'), 'expected-url-query-or-fragment');
  requireThat(endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1' && endpoint.port && endpoint.pathname === '/json/list' && !endpoint.search && !endpoint.hash && !endpoint.username && !endpoint.password && !plan.endpoint.includes('?') && !plan.endpoint.includes('#'), 'target-endpoint');
  return { expected, endpoint };
}

function validatePlan(plan) {
  requireThat(plan?.version === 1 && plan.route === 'cheap-lowlevel-headless', 'plan-route');
  validateUrls(plan);
  requireThat(/^[a-f0-9]{40}$/.test(plan.sourceCommit) && /^[a-f0-9]{64}$/.test(plan.buildSha256), 'source-binding');
  const viewport = plan.viewport;
  requireThat(Number.isSafeInteger(viewport?.width) && viewport.width > 0 && Number.isSafeInteger(viewport.height) && viewport.height > 0 && [1, 1.25, 1.5, 2].includes(viewport.scale), 'viewport');
  requireThat(['light', 'dark'].includes(plan.theme) && ['en', 'zh-HK', 'bilingual'].includes(plan.language) && boundedText(plan.state), 'state-tuple');
  requireThat(Number.isSafeInteger(plan.launch?.pid) && plan.launch.pid > 0, 'launch-pid');
  requireThat(Array.isArray(plan.resources) && plan.resources.length >= 4 && plan.resources.length <= 32, 'resource-inventory');
  requireThat(new Set(plan.resources.map(r => r.id)).size === plan.resources.length, 'resource-duplicate');
  for (const item of plan.resources) requireThat(['process', 'port', 'profile', 'desktop', 'server'].includes(item.kind) && boundedText(item.id), 'resource-shape');
  for (const kind of ['process', 'port', 'profile', 'desktop']) requireThat(plan.resources.some(r => r.kind === kind), 'resource-missing');
}

function targetMatches(receipt, plan, now) {
  requireThat(receipt?.version === 1 && receipt.valid === true && receipt.phase === 'capture' && receipt.targetCount === 1 && receipt.type === 'page', 'target-receipt');
  requireThat(timestamp(receipt.verifiedAt) && now - Date.parse(receipt.verifiedAt) >= 0 && now - Date.parse(receipt.verifiedAt) <= 30000, 'target-receipt-stale');
  const { expected, endpoint } = validateUrls(plan);
  const socket = new URL(receipt.webSocketDebuggerUrl);
  requireThat(receipt.expectedUrl === expected.href && receipt.targetUrl === expected.href && receipt.endpoint === endpoint.href, 'target-url-mismatch');
  requireThat(endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1' && endpoint.port && endpoint.pathname === '/json/list' && !endpoint.search && !endpoint.hash && !endpoint.username && !endpoint.password, 'target-endpoint');
  requireThat(socket.protocol === 'ws:' && socket.hostname === endpoint.hostname && socket.port === endpoint.port && socket.pathname.startsWith('/devtools/page/') && !socket.username && !socket.password && !socket.search && !socket.hash, 'target-socket');
  requireThat(receipt.launch?.pid === plan.launch.pid && receipt.launch.edgeSha256 === plan.launch.edgeSha256 && receipt.launch.edgeVersion === plan.launch.edgeVersion && receipt.launch.edgeExecutable === realpathSync(plan.launch.edgeExecutable), 'target-launch-mismatch');
}

function canonicalVerifier(plan) {
  const args = [plan.verifierPath, '--endpoint', plan.endpoint, '--expected-url', plan.expectedUrl, '--run-root', plan.runRoot,
    '--edge-executable', plan.launch.edgeExecutable, '--edge-sha256', plan.launch.edgeSha256, '--edge-version', plan.launch.edgeVersion,
    '--launch-pid', String(plan.launch.pid), '--phase', 'capture', '--output', ownedPath(plan.runRoot, plan.targetReceipt)];
  const result = spawnSync(process.execPath, args, { timeout: 35000, maxBuffer: 1024 * 1024, windowsHide: true });
  requireThat(!result.error && result.status === 0, 'canonical-target-verification-failed');
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolveOpen, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('cdp-open-timeout')); }, 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolveOpen(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('cdp-open-failed')); }, { once: true });
  });
  let sequence = 0;
  return {
    call(method, params) {
      const id = ++sequence;
      return new Promise((resolveCall, reject) => {
        const finish = (error, value) => { clearTimeout(timer); socket.removeEventListener('message', message); socket.removeEventListener('close', closed); error ? reject(error) : resolveCall(value); };
        const closed = () => finish(new Error('cdp-closed'));
        const timer = setTimeout(() => finish(new Error('cdp-call-timeout')), 15000);
        const message = event => {
          if (typeof event.data !== 'string' || event.data.length > MAX_PNG * 1.4) return finish(new Error('cdp-response-bound'));
          let value; try { value = JSON.parse(event.data); } catch { return finish(new Error('cdp-invalid-json')); }
          if (value.id === id) finish(value.error ? new Error('cdp-command-failed') : null, value.result);
        };
        socket.addEventListener('message', message); socket.addEventListener('close', closed, { once: true });
        try { socket.send(JSON.stringify({ id, method, params })); } catch { finish(new Error('cdp-send-failed')); }
      });
    },
    close() { socket.close(); }
  };
}

/** Narrow transport injection is for contract tests only, never runtime proof. */
export async function capture(plan, adapters = {}) {
  validatePlan(plan);
  const record = { version: 1, status: 'incomplete', route: plan.route, sourceCommit: plan.sourceCommit, buildSha256: plan.buildSha256,
    expectedUrl: plan.expectedUrl, endpoint: plan.endpoint, launch: plan.launch, viewport: plan.viewport, theme: plan.theme, language: plan.language,
    state: plan.state, resources: plan.resources, evidenceKind: 'page-only', transport: Object.keys(adapters).length ? 'test-injected' : 'cdp', capture: { method: 'Page.captureScreenshot' } };
  let client;
  try {
    await (adapters.verifyTarget ?? canonicalVerifier)(plan);
    const targetBytes = readFileSync(ownedPath(plan.runRoot, plan.targetReceipt));
    const target = JSON.parse(targetBytes);
    targetMatches(target, plan, Date.now());
    record.targetReceipt = { path: plan.targetReceipt, sha256: hash(targetBytes) };
    client = await (adapters.connect ?? connect)(target.webSocketDebuggerUrl);
    // This interval encloses the actual request, not a later file observation.
    targetMatches(target, plan, Date.now());
    record.capture.startedAt = new Date().toISOString();
    let result;
    try { result = await client.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); }
    finally { record.capture.completedAt = new Date().toISOString(); }
    requireThat(typeof result?.data === 'string' && result.data.length <= Math.ceil(MAX_PNG / 3) * 4 && /^[A-Za-z0-9+/]+={0,2}$/.test(result.data), 'png-base64');
    const bytes = Buffer.from(result.data, 'base64');
    const info = inspectPng(bytes);
    requireThat(info.width === Math.round(plan.viewport.width * plan.viewport.scale) && info.height === Math.round(plan.viewport.height * plan.viewport.scale), 'capture-viewport-mismatch');
    writeFileSync(ownedPath(plan.runRoot, plan.png), bytes, { flag: 'wx' });
    record.capture = { ...record.capture, ...info, path: plan.png };
    record.capture.retainedRaw = true;
  } catch (error) {
    record.failure = error instanceof EvidenceError ? error.message : 'capture-operation-failed';
  } finally {
    try { client?.close(); } catch { record.failure ??= 'cdp-close-failed'; }
    writeFileSync(ownedPath(plan.runRoot, plan.record), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  }
  return record;
}

/** Validates record consistency only. Observations still require independent review. */
export function validateRecord(record, runRoot, cleanup) {
  try {
    validatePlan(record);
    requireThat(!record.failure && record.transport === 'cdp', 'capture-not-runtime');
    const item = record.capture;
    requireThat(item?.method === 'Page.captureScreenshot' && timestamp(item.startedAt) && timestamp(item.completedAt) && Date.parse(item.completedAt) >= Date.parse(item.startedAt), 'capture-timestamps');
    const target = JSON.parse(readOwned(runRoot, record.targetReceipt));
    targetMatches(target, record, Date.parse(item.startedAt));
    const actual = inspectPng(readOwned(runRoot, item));
    requireThat(item.retainedRaw === true && actual.width === item.width && actual.height === item.height && actual.bytes === item.bytes && item.width === Math.round(record.viewport.width * record.viewport.scale) && item.height === Math.round(record.viewport.height * record.viewport.scale), 'capture-metadata');
    requireThat(cleanup?.version === 1 && Array.isArray(cleanup.resources) && cleanup.resources.length === record.resources.length, 'cleanup-incomplete');
    for (const resource of record.resources) {
      const observations = cleanup.resources.filter(r => r.id === resource.id && r.kind === resource.kind);
      requireThat(observations.length === 1, 'cleanup-resource-missing');
      const observation = observations[0];
      requireThat(observation.status === 'absent' && timestamp(observation.observedAt) && Date.parse(observation.observedAt) >= Date.parse(item.completedAt), 'cleanup-resource-retained-or-unverified');
      requireThat(readOwned(runRoot, observation.evidence).length > 0, 'cleanup-evidence-empty');
    }
    return { validated: true, scope: 'capture-record-consistency-only', uiVerified: false };
  } catch (error) {
    return { validated: false, scope: 'capture-record-consistency-only', uiVerified: false, reason: error instanceof EvidenceError ? error.message : 'invalid-record' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const input = readFileSync(0, 'utf8');
    requireThat(input.length <= 65536, 'input-bound');
    const request = JSON.parse(input);
    if (process.argv[2] === 'capture') {
      const result = await capture(request);
      console.log(JSON.stringify({ recorded: !result.failure, validated: false, reason: result.failure ?? 'cleanup-and-independent-review-pending' }));
      process.exitCode = result.failure ? 1 : 0;
    } else if (process.argv[2] === 'validate') {
      const result = validateRecord(JSON.parse(readFileSync(ownedPath(request.runRoot, request.record))), request.runRoot, JSON.parse(readFileSync(ownedPath(request.runRoot, request.cleanup))));
      console.log(JSON.stringify(result)); process.exitCode = result.validated ? 0 : 1;
    } else throw new Error('command-required-capture-or-validate');
  } catch { console.error('Capture record operation rejected; inspect the private run inputs.'); process.exitCode = 1; }
}
