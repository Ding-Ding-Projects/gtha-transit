import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { capture, inspectPng, validateRecord } from '../scripts/ui-evidence/capture.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function crc32(bytes) {
  let n = 0xffffffff;
  for (const b of bytes) { n ^= b; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); }
  return (n ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); result.write(name, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, result.length - 4)), result.length - 4); return result;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 20, 50, 90, 255]))), chunk('IEND', Buffer.alloc(0))]);

async function fixture(t, changeTarget = () => {}, data = png) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'capture-contract-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const executable = join(root, 'fixture-browser'); writeFileSync(executable, 'fixture only');
  const plan = { version: 1, route: 'cheap-lowlevel-headless', runRoot: root, record: 'capture.json', png: 'raw.png', targetReceipt: 'target.json',
    expectedUrl: 'https://example.test/', endpoint: 'http://127.0.0.1:9222/json/list', sourceCommit: 'a'.repeat(40), buildSha256: 'b'.repeat(64),
    viewport: { width: 1, height: 1, scale: 1 }, theme: 'light', language: 'en', state: 'fixture-only',
    launch: { pid: 1234, edgeExecutable: executable, edgeSha256: digest('fixture only'), edgeVersion: 'fixture' },
    resources: ['process', 'port', 'profile', 'desktop'].map(kind => ({ kind, id: `${kind}-fixture` })) };
  let called = 0, insideStart, insideEnd;
  const record = await capture(plan, {
    verifyTarget() {
      const target = { version: 1, valid: true, phase: 'capture', verifiedAt: new Date().toISOString(), targetCount: 1, type: 'page',
        expectedUrl: plan.expectedUrl, targetUrl: plan.expectedUrl, endpoint: plan.endpoint, webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/fixture', launch: plan.launch };
      changeTarget(target); writeFileSync(join(root, 'target.json'), JSON.stringify(target));
    },
    async connect() { return {
      async call(method, params) {
        called++; insideStart = Date.now();
        assert.equal(method, 'Page.captureScreenshot'); assert.deepEqual(params, { format: 'png', captureBeyondViewport: false });
        await new Promise(resolve => setTimeout(resolve, 4)); insideEnd = Date.now(); return { data: data.toString('base64') };
      }, close() {}
    }; }
  });
  const evidence = Buffer.from('Synthetic cleanup observation, not real UI evidence.');
  writeFileSync(join(root, 'cleanup-observation.txt'), evidence);
  const cleanup = { version: 1, resources: plan.resources.map(r => ({ ...r, status: 'absent', observedAt: new Date().toISOString(), evidence: { path: 'cleanup-observation.txt', sha256: digest(evidence) } })) };
  // Synthetic validator input is intentionally separate from the recorded test-injected capture.
  const syntheticRecord = { ...structuredClone(record), transport: 'cdp' };
  return { root, plan, record, syntheticRecord, cleanup, called, insideStart, insideEnd };
}

test('captures retain exact bytes and actual request timestamps while remaining incomplete', async t => {
  const f = await fixture(t);
  assert.equal(f.called, 1); assert.equal(f.record.status, 'incomplete');
  assert.ok(Date.parse(f.record.capture.startedAt) <= f.insideStart);
  assert.ok(Date.parse(f.record.capture.completedAt) >= f.insideEnd);
  assert.deepEqual(readFileSync(join(f.root, 'raw.png')), png);
  assert.equal(f.record.capture.sha256, digest(png));
  assert.equal(validateRecord(f.record, f.root, f.cleanup).reason, 'capture-not-runtime');
});

test('valid synthetic record checks consistency without claiming UI verification', async t => {
  const f = await fixture(t);
  assert.deepEqual(validateRecord(f.syntheticRecord, f.root, f.cleanup), { validated: true, scope: 'capture-record-consistency-only', uiVerified: false });
});

for (const field of ['startedAt', 'completedAt']) test(`negative regression: missing ${field} is red, restored record is green`, async t => {
  const f = await fixture(t); const original = f.syntheticRecord.capture[field]; delete f.syntheticRecord.capture[field];
  assert.equal(Object.hasOwn(f.syntheticRecord.capture, field), false);
  assert.equal(validateRecord(f.syntheticRecord, f.root, f.cleanup).reason, 'capture-timestamps');
  f.syntheticRecord.capture[field] = original; assert.equal(validateRecord(f.syntheticRecord, f.root, f.cleanup).validated, true);
});

for (const kind of ['process', 'port', 'profile', 'desktop']) test(`negative regression: retained ${kind} is red, restored observation is green`, async t => {
  const f = await fixture(t), item = f.cleanup.resources.find(r => r.kind === kind);
  item.status = 'retained'; assert.equal(validateRecord(f.syntheticRecord, f.root, f.cleanup).validated, false);
  item.status = 'absent'; assert.equal(validateRecord(f.syntheticRecord, f.root, f.cleanup).validated, true);
});

for (const [name, mutate] of [
  ['second target', target => { target.targetCount = 2; }],
  ['wrong page', target => { target.targetUrl = 'https://example.test/other'; }],
  ['wrong process', target => { target.launch = { ...target.launch, pid: 999 }; }],
  ['stale receipt', target => { target.verifiedAt = '2020-01-01T00:00:00.000Z'; }],
  ['wrong socket', target => { target.webSocketDebuggerUrl = 'ws://127.0.0.1:9223/devtools/page/fixture'; }]
]) test(`preflight rejects ${name} before capture`, async t => {
  const f = await fixture(t, mutate); assert.equal(f.called, 0); assert.ok(f.record.failure); assert.equal(f.record.capture.startedAt, undefined);
});

test('malformed PNG cannot produce a complete record', async t => {
  const f = await fixture(t, () => {}, Buffer.from('not a PNG'));
  assert.equal(f.called, 1); assert.equal(f.record.failure, 'png-size'); assert.ok(f.record.capture.completedAt);
});

test('negative regression: PNG corruption is red, restored bytes are green', async t => {
  const f = await fixture(t), modified = Buffer.from(png); modified[40] ^= 1;
  writeFileSync(join(f.root, 'raw.png'), modified); assert.equal(validateRecord(f.syntheticRecord, f.root, f.cleanup).validated, false);
  writeFileSync(join(f.root, 'raw.png'), png); assert.equal(validateRecord(f.syntheticRecord, f.root, f.cleanup).validated, true);
  assert.throws(() => inspectPng(modified), /png-crc/);
});

test('cleanup must be complete, observed after capture, and retain hashed evidence', async t => {
  const f = await fixture(t);
  assert.equal(validateRecord(f.syntheticRecord, f.root, undefined).validated, false);
  f.cleanup.resources[0].observedAt = '2020-01-01T00:00:00.000Z'; assert.equal(validateRecord(f.syntheticRecord, f.root, f.cleanup).validated, false);
  f.cleanup.resources[0].observedAt = new Date().toISOString();
  writeFileSync(join(f.root, 'cleanup-observation.txt'), 'changed'); assert.equal(validateRecord(f.syntheticRecord, f.root, f.cleanup).validated, false);
});

test('missing source, incomplete resource inventory and reversed times fail closed', async t => {
  const f = await fixture(t);
  for (const mutate of [r => { delete r.buildSha256; }, r => { r.resources.pop(); }, r => { r.capture.completedAt = '2020-01-01T00:00:00.000Z'; }]) {
    const candidate = structuredClone(f.syntheticRecord); mutate(candidate); assert.equal(validateRecord(candidate, f.root, f.cleanup).validated, false);
  }
});

test('evidence paths cannot escape the run root', async t => {
  const f = await fixture(t); f.syntheticRecord.capture.path = '../outside.png';
  assert.equal(validateRecord(f.syntheticRecord, f.root, f.cleanup).reason, 'path-outside-run-root');
});

for (const [name, field, value] of [
  ['embedded page credentials', 'expectedUrl', 'https://visitor:neutralfixturemarker@example.test/'],
  ['sensitive page query', 'expectedUrl', 'https://example.test/?token=neutralfixturemarker'],
  ['encoded sensitive query', 'expectedUrl', 'https://example.test/?%74oken=neutralfixturemarker'],
  ['unreviewed page query', 'expectedUrl', 'https://example.test/?q=neutralfixturemarker'],
  ['page fragment', 'expectedUrl', 'https://example.test/#neutralfixturemarker'],
  ['non-HTTP page', 'expectedUrl', 'file:///neutralfixturemarker'],
  ['embedded endpoint credentials', 'endpoint', 'http://visitor:neutralfixturemarker@127.0.0.1:9222/json/list'],
  ['endpoint query', 'endpoint', 'http://127.0.0.1:9222/json/list?token=neutralfixturemarker'],
  ['non-loopback endpoint', 'endpoint', 'http://neutralfixturemarker.test:9222/json/list'],
  ['oversized page URL', 'expectedUrl', 'https://example.test/' + 'neutralfixturemarker'.repeat(300)]
]) test(`invalid plan never persists ${name}`, async t => {
  const f = await fixture(t), before = readdirSync(f.root).sort();
  const plan = { ...f.plan, [field]: value, record: 'rejected.json', targetReceipt: 'rejected-target.json', png: 'rejected.png' };
  let verifierCalled = false;
  await assert.rejects(capture(plan, { verifyTarget() { verifierCalled = true; throw new Error('test-verifier-rejected'); } }), error => {
    assert.equal(error.message.includes('neutralfixturemarker'), false); return true;
  });
  assert.equal(verifierCalled, false);
  assert.deepEqual(readdirSync(f.root).sort(), before);
  for (const file of readdirSync(f.root)) assert.equal(readFileSync(join(f.root, file)).includes(Buffer.from('neutralfixturemarker')), false);
});

test('external rejection text never becomes a persisted failure code', async t => {
  const f = await fixture(t);
  const plan = { ...f.plan, record: 'rejected.json' };
  const result = await capture(plan, { verifyTarget() { throw new Error('neutralfixturemarker'); } });
  assert.equal(result.failure, 'capture-operation-failed');
  assert.equal(readFileSync(join(f.root, plan.record)).includes(Buffer.from('neutralfixturemarker')), false);
});
