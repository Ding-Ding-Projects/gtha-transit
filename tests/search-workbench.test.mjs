import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {
  SEARCH_LIMITS,
  describeRegexTokens,
  escapeRegexLiteral,
  hasKnownRegexFlags,
  parseRegexSnippets,
  plainTextMatches,
  staticRegexRiskNotes,
  validateSearchInput,
} from '../lib/search-workbench.ts';

const workerSource = await readFile(new URL('../public/regex-worker.js', import.meta.url), 'utf8');

function runWorker(request) {
  const replies = [];
  let tick = 0;
  const self = {
    onmessage: null,
    postMessage(payload) {
      replies.push(JSON.parse(JSON.stringify(payload)));
    },
  };
  vm.runInNewContext(workerSource, {
    self,
    performance: { now: () => ++tick },
  });
  self.onmessage({ data: request });
  assert.equal(replies.length, 1, 'the worker returns one bounded response');
  return replies[0];
}

function request(overrides = {}) {
  return {
    type: 'evaluate',
    requestId: 41,
    generation: 7,
    pattern: '^(?<agency>TTC|GO)\\s+(?<route>\\d+)$',
    flags: 'u',
    samples: ['TTC 36', 'GO 65', 'MiWay 1'],
    replacement: '$<route>',
    cases: [
      { id: 'expected-match', text: 'TTC 36', expected: true },
      { id: 'expected-miss', text: 'MiWay 1', expected: false },
    ],
    ...overrides,
  };
}

test('plain matching is case-folded, aligned, and leaves an empty query inclusive', () => {
  assert.deepEqual(plainTextMatches(['TTC 36', 'GO 65', 'MiWay 1'], 'go'), [false, true, false]);
  assert.deepEqual(plainTextMatches(['TTC 36', 'GO 65'], ''), [true, true]);
  assert.equal(escapeRegexLiteral('Line (1)+?'), 'Line \\(1\\)\\+\\?');
});

test('flag and bounded-input validators reject unsafe input before a worker receives it', () => {
  assert.equal(hasKnownRegexFlags('gim'), true);
  assert.equal(hasKnownRegexFlags('ii'), false);
  assert.equal(hasKnownRegexFlags('uv'), false);
  assert.equal(hasKnownRegexFlags('z'), false);
  const state = { query: '', pattern: '^R', flags: 'i', mode: 'regex' };
  assert.equal(validateSearchInput(Array.from({ length: 10_000 }, () => 'Route 1'), state), null);
  assert.equal(validateSearchInput(Array.from({ length: 10_001 }, () => 'Route 1'), state), 'too-many-samples');
  assert.equal(validateSearchInput(['x'.repeat(SEARCH_LIMITS.maxSampleLength + 1)], state), 'sample-too-long');
});

test('token annotation and static risk notes describe syntax without executing a pattern', () => {
  const tokens = describeRegexTokens('^(?<route>\\d+|X){2,5}$');
  assert.deepEqual(tokens.map((token) => token.kind), [
    'anchor',
    'group',
    'escaped-literal',
    'quantifier',
    'alternation',
    'literal',
    'group-end',
    'quantifier',
    'anchor',
  ]);
  assert.ok(staticRegexRiskNotes('(a+)+').includes('nested-repeat'));
  assert.equal(staticRegexRiskNotes('(?<route>R)+').includes('nested-repeat'), false);
});

test('snippet imports are bounded, exact, and reject unexpected fields', () => {
  const snippets = parseRegexSnippets('[{"name":"TTC","pattern":"^TTC","flags":"i","replacement":""}]');
  assert.deepEqual(snippets, [{ name: 'TTC', pattern: '^TTC', flags: 'i', replacement: '' }]);
  assert.throws(
    () => parseRegexSnippets('[{"name":"TTC","pattern":"^TTC","flags":"i","replacement":"","extra":true}]'),
    /invalid-snippet-shape/,
  );
  assert.throws(
    () => parseRegexSnippets('[{"name":"TTC","pattern":"^TTC","flags":"z","replacement":""}]'),
    /invalid-snippet-shape/,
  );
});

test('worker evaluates JavaScript regexes, returns bounded captures, replacement previews, and expected cases', () => {
  const reply = runWorker(request());
  assert.equal(reply.error, null);
  assert.equal(reply.requestId, 41);
  assert.equal(reply.generation, 7);
  assert.deepEqual(reply.matches, [true, true, false]);
  assert.equal(reply.details[0].sampleIndex, 0);
  assert.equal(reply.details[0].start, 0);
  assert.equal(reply.details[0].end, 6);
  assert.deepEqual(reply.details[0].captures, [
    { name: '$1', value: 'TTC' },
    { name: '$2', value: '36' },
    { name: 'agency', value: 'TTC' },
    { name: 'route', value: '36' },
  ]);
  assert.deepEqual(reply.replacementPreview, { sampleIndex: 0, value: '36', truncated: false });
  assert.deepEqual(reply.cases.map((item) => item.passed), [true, true]);
});

test('worker uses fresh state for global matching and safely advances zero-width matches', () => {
  const globalReply = runWorker(request({ pattern: 'a', flags: 'g', samples: ['a', 'a'], replacement: 'b', cases: [] }));
  assert.deepEqual(globalReply.matches, [true, true]);
  const zeroWidth = runWorker(request({ pattern: '(?=a)', flags: 'g', samples: ['aaa'], replacement: 'x', cases: [] }));
  assert.equal(zeroWidth.error, null);
  assert.equal(zeroWidth.matches[0], true);
  assert.ok(zeroWidth.details.length > 0);
  assert.ok(zeroWidth.details.length <= 12);
  const finalPosition = runWorker(request({ pattern: '$', flags: 'g', samples: ['route'], replacement: 'x', cases: [] }));
  assert.equal(finalPosition.error, null);
  assert.equal(finalPosition.details.length, 1);
  assert.deepEqual(finalPosition.details[0], {
    sampleIndex: 0,
    start: 5,
    end: 5,
    text: '',
    captures: [],
    truncated: false,
  });
});

test('worker rejects syntax and flag errors rather than falling back to a different matching mode', () => {
  assert.equal(runWorker(request({ pattern: '(', flags: '', cases: [] })).error, 'invalid-pattern');
  assert.equal(runWorker(request({ pattern: 'a', flags: 'ii', cases: [] })).error, 'invalid-flags');
  assert.equal(runWorker(request({ pattern: 'a', flags: 'z', cases: [] })).error, 'invalid-flags');
});

test('worker covers the full 10,000-row route-picker envelope and refuses oversized payloads', () => {
  const labels = Array.from({ length: 10_000 }, (_, index) => `R${index}`);
  const reply = runWorker(request({ pattern: '^R', flags: '', samples: labels, cases: [] }));
  assert.equal(reply.error, null);
  assert.equal(reply.matches.length, 10_000);
  assert.equal(reply.matches.every(Boolean), true);
  const oversized = runWorker(request({ pattern: '^R', flags: '', samples: Array.from({ length: 10_001 }, () => 'R'), cases: [] }));
  assert.equal(oversized.error, 'invalid-samples');
});

test('worker reports expected-case differences instead of hiding them', () => {
  const reply = runWorker(request({
    pattern: '^TTC',
    flags: '',
    samples: ['TTC 36'],
    cases: [{ id: 'wrong-expectation', text: 'TTC 36', expected: false }],
  }));
  assert.equal(reply.error, null);
  assert.deepEqual(reply.cases, [
    { id: 'wrong-expectation', text: 'TTC 36', expected: false, actual: true, passed: false },
  ]);
});
