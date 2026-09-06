import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';

/**
 * The canonical target verifier the capture helper spawns.
 *
 * It answers one question and writes down the answer: is the debugging endpoint
 * showing exactly one page, and is that page the one we mean to photograph? A
 * second page, an unexpected URL, a target that is not a page, or a socket that
 * does not belong to this endpoint all mean the answer is no, and no receipt is
 * written at all.
 *
 * Page-created iframes are not page targets and are not counted. Nothing here
 * relaxes that for research: this verifier serves capture evidence only.
 */

const MAX_BODY = 512 * 1024;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

class VerifyError extends Error {}
const requireThat = (condition, code) => { if (!condition) throw new VerifyError(code); };

function readArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    requireThat(typeof key === 'string' && key.startsWith('--'), 'argument-shape');
    const value = argv[index + 1];
    requireThat(typeof value === 'string' && value.length > 0 && value.length <= 1024, 'argument-value');
    args.set(key.slice(2), value);
  }
  return args;
}

/** Write only inside the run root, and never through a link out of it. */
function ownedPath(root, name) {
  requireThat(typeof name === 'string' && name.length > 0, 'output-required');
  const base = realpathSync(root);
  const path = isAbsolute(name) ? resolve(name) : resolve(base, name);
  const parent = realpathSync(dirname(path));
  for (const item of [path, parent]) {
    const part = relative(base, item);
    requireThat(!part.startsWith('..') && !isAbsolute(part), 'path-outside-run-root');
  }
  requireThat(path !== base, 'file-path-required');
  return path;
}

function validEndpoint(value) {
  const endpoint = new URL(value);
  requireThat(
    endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1' && endpoint.port
    && endpoint.pathname === '/json/list' && !endpoint.search && !endpoint.hash
    && !endpoint.username && !endpoint.password,
    'endpoint-shape',
  );
  return endpoint;
}

async function listTargets(endpoint) {
  const response = await fetch(endpoint.href, {
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  requireThat(response.ok, 'endpoint-unavailable');
  const text = await response.text();
  requireThat(text.length <= MAX_BODY, 'endpoint-body-bound');
  const parsed = JSON.parse(text);
  requireThat(Array.isArray(parsed), 'endpoint-shape');
  return parsed;
}

export function selectPage(targets, expected, endpoint) {
  const pages = targets.filter((target) => target && target.type === 'page');
  requireThat(pages.length === 1, 'target-count');
  const page = pages[0];
  requireThat(typeof page.url === 'string' && new URL(page.url).href === expected.href, 'target-url');
  const socket = new URL(String(page.webSocketDebuggerUrl ?? ''));
  requireThat(
    socket.protocol === 'ws:' && socket.hostname === endpoint.hostname && socket.port === endpoint.port
    && socket.pathname.startsWith('/devtools/page/') && !socket.username && !socket.password
    && !socket.search && !socket.hash,
    'target-socket',
  );
  return { page, socket };
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const runRoot = args.get('run-root');
  requireThat(typeof runRoot === 'string', 'run-root-required');
  const endpoint = validEndpoint(args.get('endpoint'));
  const expected = new URL(args.get('expected-url'));
  requireThat(expected.protocol === 'https:' || expected.hostname === '127.0.0.1', 'expected-url-shape');
  const phase = args.get('phase');
  requireThat(phase === 'capture', 'phase');

  const executable = realpathSync(args.get('edge-executable'));
  const declaredSha = args.get('edge-sha256');
  requireThat(/^[a-f0-9]{64}$/.test(declaredSha), 'edge-sha256-shape');
  // The browser that produced the capture is the browser the plan named.
  requireThat(hash(readFileSync(executable)) === declaredSha, 'edge-sha256-mismatch');
  const pid = Number(args.get('launch-pid'));
  requireThat(Number.isSafeInteger(pid) && pid > 0, 'launch-pid');

  const { page, socket } = selectPage(await listTargets(endpoint), expected, endpoint);
  const receipt = {
    version: 1,
    valid: true,
    phase,
    verifiedAt: new Date().toISOString(),
    targetCount: 1,
    type: 'page',
    expectedUrl: expected.href,
    targetUrl: new URL(page.url).href,
    endpoint: endpoint.href,
    webSocketDebuggerUrl: socket.href,
    launch: {
      pid,
      edgeExecutable: executable,
      edgeSha256: declaredSha,
      edgeVersion: args.get('edge-version'),
    },
  };
  writeFileSync(ownedPath(runRoot, args.get('output')), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop() ?? '')) {
  try {
    await main();
    process.exitCode = 0;
  } catch (error) {
    // No receipt is written on refusal, and the reason never carries a path or URL.
    console.error(error instanceof VerifyError ? error.message : 'target-verification-failed');
    process.exitCode = 1;
  }
}
