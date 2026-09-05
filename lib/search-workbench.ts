'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The controlled state shared by each independent search field.  A field keeps
 * its own object, so a route filter cannot inherit an agency filter's pattern.
 */
export type SearchState = {
  query: string;
  pattern: string;
  flags: string;
  mode: 'text' | 'regex';
};

export type RegexTokenKind =
  | 'anchor'
  | 'alternation'
  | 'character-class'
  | 'escaped-literal'
  | 'group'
  | 'group-end'
  | 'literal'
  | 'quantifier'
  | 'wildcard';

export type RegexToken = {
  raw: string;
  kind: RegexTokenKind;
};

export type RegexCapability = {
  syntax: string;
  support: 'supported' | 'runtime-dependent' | 'unavailable';
  reason: string;
};

export type RegexSnippet = {
  name: string;
  pattern: string;
  flags: string;
  replacement: string;
};

export type RegexCase = {
  id: string;
  text: string;
  expected: boolean;
};

export type RegexCaseResult = RegexCase & {
  actual: boolean;
  passed: boolean;
};

export type RegexMatchDetail = {
  sampleIndex: number;
  start: number;
  end: number;
  text: string;
  captures: Array<{ name: string; value: string | null }>;
  truncated: boolean;
};

export type RegexReplacementPreview = {
  sampleIndex: number;
  value: string;
  truncated: boolean;
};

export type SearchMatchResult = {
  matches: boolean[];
  busy: boolean;
  error: string | null;
};

type RegexEvaluation = SearchMatchResult & {
  details: RegexMatchDetail[];
  warnings: string[];
  cases: RegexCaseResult[];
  replacementPreview: RegexReplacementPreview | null;
};

type WorkerRequest = {
  type: 'evaluate';
  requestId: number;
  generation: number;
  pattern: string;
  flags: string;
  samples: string[];
  replacement: string;
  cases: RegexCase[];
};

type WorkerResponse =
  | {
      type: 'result';
      requestId: number;
      generation: number;
      matches: boolean[];
      details: RegexMatchDetail[];
      warnings: string[];
      cases: RegexCaseResult[];
      replacementPreview: RegexReplacementPreview | null;
      elapsedMs: number;
      error: null;
    }
  | {
      type: 'result';
      requestId: number;
      generation: number;
      matches?: never;
      details?: never;
      warnings?: never;
      cases?: never;
      replacementPreview?: never;
      elapsedMs?: number;
      error: string;
    };

export const SEARCH_LIMITS = Object.freeze({
  maxFlags: 8,
  maxPatternLength: 512,
  maxQueryLength: 512,
  // Route pickers may present 50 pages of 200 concise route labels. The whole
  // array is evaluated, while the detailed inspection view has its own cap.
  maxSamples: 10_000,
  maxSampleLength: 512,
  maxTotalSampleLength: 1024 * 1024,
  maxCases: 24,
  maxCaseLength: 2048,
  maxReplacementLength: 512,
  maxSnippetCount: 20,
  maxSnippetNameLength: 64,
  maxSnippetPayloadLength: 12 * 1024,
  workerTimeoutMs: 150,
});

export const ECMASCRIPT_REGEX_CAPABILITIES: readonly RegexCapability[] = [
  {
    syntax: 'Literals, escaped characters, and Unicode code points',
    support: 'supported',
    reason: 'Supported by the JavaScript RegExp engine used by this workbench.',
  },
  {
    syntax: 'Character classes and negated classes',
    support: 'supported',
    reason: 'Use brackets such as [A-Z] or [^0-9].',
  },
  {
    syntax: 'Anchors and boundaries',
    support: 'supported',
    reason: 'Use ^, $, and \\b with the JavaScript engine.',
  },
  {
    syntax: 'Named and numbered capture groups',
    support: 'supported',
    reason: 'Use (?<name>...) or (...) and inspect bounded captures below.',
  },
  {
    syntax: 'Alternation and greedy or lazy quantifiers',
    support: 'supported',
    reason: 'Use |, *, +, ?, {min,max}, and a trailing ? for lazy matching.',
  },
  {
    syntax: 'Lookahead and lookbehind',
    support: 'supported',
    reason: 'Modern JavaScript supports positive and negative lookaround.',
  },
  {
    syntax: 'Unicode Sets with the v flag',
    support: 'runtime-dependent',
    reason: 'Availability depends on the browser JavaScript engine. The worker reports a syntax error when unavailable.',
  },
  {
    syntax: 'Atomic groups (?>...)',
    support: 'unavailable',
    reason: 'ECMAScript RegExp does not implement atomic groups.',
  },
  {
    syntax: 'Possessive quantifiers such as *+ or ++',
    support: 'unavailable',
    reason: 'ECMAScript RegExp does not implement possessive quantifiers.',
  },
  {
    syntax: 'Conditionals and subroutines',
    support: 'unavailable',
    reason: 'ECMAScript RegExp does not implement conditional branches or subroutine calls.',
  },
  {
    syntax: 'Portable backtracking step trace',
    support: 'unavailable',
    reason: 'JavaScript does not expose a portable RegExp step trace, so this workbench does not claim to provide one.',
  },
];

const ESCAPABLE_LITERAL = '\\\\^$.*+?()[]{}|';
const ALLOWED_FLAGS = 'dgimsuvy';
const EMPTY_CASES: readonly RegexCase[] = [];

export function emptySearchState(): SearchState {
  return { query: '', pattern: '', flags: 'i', mode: 'text' };
}

export function escapeRegexLiteral(value: string): string {
  let escaped = '';
  for (const char of value) {
    escaped += ESCAPABLE_LITERAL.includes(char) ? `\\${char}` : char;
  }
  return escaped;
}

export function plainTextMatches(samples: readonly string[], query: string): boolean[] {
  const needle = query.toLocaleLowerCase();
  return samples.map((sample) =>
    needle.length === 0 ? true : String(sample).toLocaleLowerCase().includes(needle),
  );
}

export function hasKnownRegexFlags(flags: string): boolean {
  if (flags.length > SEARCH_LIMITS.maxFlags) return false;
  const used = new Set<string>();
  for (const flag of flags) {
    if (!ALLOWED_FLAGS.includes(flag) || used.has(flag)) return false;
    used.add(flag);
  }
  return !(used.has('u') && used.has('v'));
}

export function describeRegexTokens(pattern: string): RegexToken[] {
  const tokens: RegexToken[] = [];
  let index = 0;

  const takeClass = () => {
    const start = index;
    index += 1;
    let escaped = false;
    while (index < pattern.length) {
      const current = pattern[index++];
      if (!escaped && current === ']') break;
      escaped = !escaped && current === '\\';
      if (current !== '\\') escaped = false;
    }
    tokens.push({ raw: pattern.slice(start, index), kind: 'character-class' });
  };

  const takeQuantifier = () => {
    const start = index;
    index += 1;
    let sawClose = false;
    while (index < pattern.length) {
      const current = pattern[index++];
      if (current === '}') {
        sawClose = true;
        break;
      }
      if (!(current === ',' || (current >= '0' && current <= '9'))) break;
    }
    tokens.push({
      raw: pattern.slice(start, index),
      kind: sawClose ? 'quantifier' : 'literal',
    });
  };

  while (index < pattern.length) {
    const current = pattern[index];
    if (current === '\\') {
      tokens.push({ raw: pattern.slice(index, index + 2), kind: 'escaped-literal' });
      index += Math.min(2, pattern.length - index);
      continue;
    }
    if (current === '[') {
      takeClass();
      continue;
    }
    if (current === '(') {
      let raw = '(';
      let nextIndex = index + 1;
      if (pattern[index + 1] === '?') {
        if (pattern[index + 2] === '<') {
          if (pattern[index + 3] === '=' || pattern[index + 3] === '!') {
            raw = pattern.slice(index, index + 4);
            nextIndex = index + 4;
          } else {
            const closing = pattern.indexOf('>', index + 3);
            raw = closing >= 0 ? pattern.slice(index, closing + 1) : '(?<name>';
            nextIndex = closing >= 0 ? closing + 1 : index + 3;
          }
        } else if (pattern[index + 2] === ':' || pattern[index + 2] === '=' || pattern[index + 2] === '!') {
          raw = pattern.slice(index, index + 3);
          nextIndex = index + 3;
        }
      }
      tokens.push({ raw, kind: 'group' });
      index = nextIndex;
      continue;
    }
    if (current === ')') {
      tokens.push({ raw: current, kind: 'group-end' });
      index += 1;
      continue;
    }
    if (current === '^' || current === '$') {
      tokens.push({ raw: current, kind: 'anchor' });
      index += 1;
      continue;
    }
    if (current === '|') {
      tokens.push({ raw: current, kind: 'alternation' });
      index += 1;
      continue;
    }
    if (current === '*' || current === '+' || current === '?') {
      const lazy = pattern[index + 1] === '?' ? '?' : '';
      tokens.push({ raw: current + lazy, kind: 'quantifier' });
      index += 1 + lazy.length;
      continue;
    }
    if (current === '{') {
      takeQuantifier();
      continue;
    }
    if (current === '.') {
      tokens.push({ raw: current, kind: 'wildcard' });
      index += 1;
      continue;
    }
    tokens.push({ raw: current, kind: 'literal' });
    index += 1;
  }
  return tokens;
}

export function staticRegexRiskNotes(pattern: string): string[] {
  const notes: string[] = [];
  if (pattern.length > 160) notes.push('long-pattern');
  if (pattern.includes('.*.*') || pattern.includes('.+.+')) notes.push('repeated-wildcard');

  const stack: Array<{ hasInnerQuantifier: boolean }> = [];
  let escaped = false;
  let inClass = false;
  let closedGroup: { hasInnerQuantifier: boolean } | null = null;
  let groupPrefixQuestion = -1;
  for (let index = 0; index < pattern.length; index += 1) {
    const current = pattern[index];
    if (index === groupPrefixQuestion) continue;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (current === '\\') {
      escaped = true;
      continue;
    }
    if (current === '[') {
      inClass = true;
      continue;
    }
    if (current === ']' && inClass) {
      inClass = false;
      continue;
    }
    if (inClass) continue;
    if (current === '(') {
      stack.push({ hasInnerQuantifier: false });
      closedGroup = null;
      groupPrefixQuestion = pattern[index + 1] === '?' ? index + 1 : -1;
      continue;
    }
    if (current === ')') {
      closedGroup = stack.pop() ?? null;
      continue;
    }
    const isQuantifier = current === '*' || current === '+' || current === '?' || current === '{';
    if (isQuantifier) {
      if (closedGroup?.hasInnerQuantifier) notes.push('nested-repeat');
      if (stack.length > 0) stack[stack.length - 1].hasInnerQuantifier = true;
      closedGroup = null;
      continue;
    }
    closedGroup = null;
  }
  return [...new Set(notes)];
}

export function validateSearchInput(
  samples: readonly string[],
  state: SearchState,
  replacement = '',
  cases: readonly RegexCase[] = [],
): string | null {
  if (state.query.length > SEARCH_LIMITS.maxQueryLength) return 'query-too-long';
  if (state.pattern.length > SEARCH_LIMITS.maxPatternLength) return 'pattern-too-long';
  if (!hasKnownRegexFlags(state.flags)) return 'invalid-flags';
  if (replacement.length > SEARCH_LIMITS.maxReplacementLength) return 'replacement-too-long';
  if (samples.length > SEARCH_LIMITS.maxSamples) return 'too-many-samples';
  let total = 0;
  for (const sample of samples) {
    if (typeof sample !== 'string') return 'invalid-sample';
    if (sample.length > SEARCH_LIMITS.maxSampleLength) return 'sample-too-long';
    total += sample.length;
    if (total > SEARCH_LIMITS.maxTotalSampleLength) return 'samples-too-large';
  }
  if (cases.length > SEARCH_LIMITS.maxCases) return 'too-many-cases';
  for (const item of cases) {
    if (!item || typeof item.text !== 'string' || item.text.length > SEARCH_LIMITS.maxCaseLength) {
      return 'case-too-long';
    }
  }
  return null;
}

export function parseRegexSnippets(input: string): RegexSnippet[] {
  if (input.length > SEARCH_LIMITS.maxSnippetPayloadLength) throw new Error('snippet-too-large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error('invalid-snippet-json');
  }
  if (!Array.isArray(parsed) || parsed.length > SEARCH_LIMITS.maxSnippetCount) {
    throw new Error('invalid-snippet-shape');
  }
  const snippets: RegexSnippet[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid-snippet-shape');
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.name !== 'string' ||
      typeof candidate.pattern !== 'string' ||
      typeof candidate.flags !== 'string' ||
      typeof candidate.replacement !== 'string' ||
      candidate.name.length === 0 ||
      candidate.name.length > SEARCH_LIMITS.maxSnippetNameLength ||
      candidate.pattern.length > SEARCH_LIMITS.maxPatternLength ||
      !hasKnownRegexFlags(candidate.flags) ||
      candidate.replacement.length > SEARCH_LIMITS.maxReplacementLength ||
      Object.keys(candidate).some((key) => !['name', 'pattern', 'flags', 'replacement'].includes(key))
    ) {
      throw new Error('invalid-snippet-shape');
    }
    snippets.push({
      name: candidate.name,
      pattern: candidate.pattern,
      flags: candidate.flags,
      replacement: candidate.replacement,
    });
  }
  return snippets;
}

export function serializeRegexSnippets(snippets: readonly RegexSnippet[]): string {
  if (snippets.length > SEARCH_LIMITS.maxSnippetCount) throw new Error('too-many-snippets');
  return JSON.stringify(snippets);
}

function evaluationKey(
  samples: readonly string[],
  samplesVersion: number,
  state: SearchState,
  replacement: string,
  cases: readonly RegexCase[],
): string {
  return [
    samplesVersion,
    state.mode,
    state.query,
    state.pattern,
    state.flags,
    replacement,
    cases.map((item) => `${item.id}\u0000${item.expected}\u0000${item.text}`).join('\u0001'),
  ].join('\u0002');
}

function emptyEvaluation(matches: boolean[], error: string | null = null): RegexEvaluation {
  return {
    matches,
    busy: false,
    error,
    details: [],
    warnings: [],
    cases: [],
    replacementPreview: null,
  };
}

function pendingEvaluation(samples: readonly string[]): RegexEvaluation {
  return {
    ...emptyEvaluation(samples.map(() => false)),
    busy: true,
  };
}

function textEvaluation(samples: readonly string[], state: SearchState, cases: readonly RegexCase[]): RegexEvaluation {
  const matches = plainTextMatches(samples, state.query);
  const caseResults = cases.map((item) => {
    const actual = plainTextMatches([item.text], state.query)[0];
    return { ...item, actual, passed: actual === item.expected };
  });
  return { ...emptyEvaluation(matches), cases: caseResults };
}

function noPatternEvaluation(samples: readonly string[], cases: readonly RegexCase[]): RegexEvaluation {
  const matches = samples.map(() => true);
  return {
    ...emptyEvaluation(matches),
    cases: cases.map((item) => ({ ...item, actual: true, passed: item.expected })),
  };
}

function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate.type === 'result' && typeof candidate.requestId === 'number' && typeof candidate.generation === 'number';
}

function useRegexEvaluation(
  samples: readonly string[],
  state: SearchState,
  replacement = '',
  cases: readonly RegexCase[] = EMPTY_CASES,
): RegexEvaluation {
  const sampleIdentity = useRef({ samples, version: 0 });
  if (sampleIdentity.current.samples !== samples) {
    sampleIdentity.current = { samples, version: sampleIdentity.current.version + 1 };
  }
  const samplesVersion = sampleIdentity.current.version;
  const key = evaluationKey(samples, samplesVersion, state, replacement, cases);
  const initial = state.mode === 'text'
    ? textEvaluation(samples, state, cases)
    : state.pattern.length === 0
      ? noPatternEvaluation(samples, cases)
      : pendingEvaluation(samples);
  const [evaluation, setEvaluation] = useState<RegexEvaluation & { key: string }>(() => ({ ...initial, key }));
  const generation = useRef(0);
  const requestId = useRef(0);

  useEffect(() => {
    const currentGeneration = generation.current + 1;
    generation.current = currentGeneration;
    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;

    if (state.mode === 'text') {
      setEvaluation({ ...textEvaluation(samples, state, cases), key });
      return;
    }
    if (state.pattern.length === 0) {
      setEvaluation({ ...noPatternEvaluation(samples, cases), key });
      return;
    }
    const inputError = validateSearchInput(samples, state, replacement, cases);
    if (inputError) {
      setEvaluation({ ...emptyEvaluation(samples.map(() => false), inputError), key });
      return;
    }
    setEvaluation({ ...pendingEvaluation(samples), key });
    if (typeof Worker === 'undefined') {
      setEvaluation({ ...emptyEvaluation(samples.map(() => false), 'worker-unavailable'), key });
      return;
    }

    let settled = false;
    let worker: Worker;
    try {
      worker = new Worker('/regex-worker.js', { type: 'module' });
    } catch {
      setEvaluation({ ...emptyEvaluation(samples.map(() => false), 'worker-unavailable'), key });
      return;
    }
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      setEvaluation({ ...emptyEvaluation(samples.map(() => false), 'regex-timeout'), key });
    }, SEARCH_LIMITS.workerTimeoutMs);

    const finish = () => {
      window.clearTimeout(timeout);
      worker.terminate();
    };
    worker.onerror = () => {
      if (settled) return;
      settled = true;
      finish();
      setEvaluation({ ...emptyEvaluation(samples.map(() => false), 'worker-failed'), key });
    };
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const response = event.data;
      if (
        settled ||
        !isWorkerResponse(response) ||
        response.generation !== currentGeneration ||
        response.requestId !== currentRequestId
      ) {
        return;
      }
      settled = true;
      finish();
      if (response.error) {
        setEvaluation({ ...emptyEvaluation(samples.map(() => false), response.error), key });
        return;
      }
      if (!Array.isArray(response.matches) || response.matches.length !== samples.length) {
        setEvaluation({ ...emptyEvaluation(samples.map(() => false), 'worker-invalid-response'), key });
        return;
      }
      setEvaluation({
        key,
        matches: response.matches,
        busy: false,
        error: null,
        details: Array.isArray(response.details) ? response.details : [],
        warnings: Array.isArray(response.warnings) ? response.warnings : [],
        cases: Array.isArray(response.cases) ? response.cases : [],
        replacementPreview: response.replacementPreview ?? null,
      });
    };
    const request: WorkerRequest = {
      type: 'evaluate',
      requestId: currentRequestId,
      generation: currentGeneration,
      pattern: state.pattern,
      flags: state.flags,
      samples: [...samples],
      replacement,
      cases: cases.map((item) => ({ ...item })),
    };
    worker.postMessage(request);
    return () => {
      if (!settled) worker.terminate();
      window.clearTimeout(timeout);
    };
  }, [samples, samplesVersion, state.mode, state.query, state.pattern, state.flags, replacement, cases, key]);

  if (evaluation.key !== key) return initial;
  return evaluation;
}

/**
 * Bounded matching for a caller-owned list. Text searches stay local. Regex
 * searches are evaluated only inside a killable Worker and never reuse results
 * from an earlier query or generation.
 */
export function useSearchMatches(samples: string[], state: SearchState): SearchMatchResult {
  const evaluation = useRegexEvaluation(samples, state, '', EMPTY_CASES);
  return {
    matches: evaluation.matches,
    busy: evaluation.busy,
    error: evaluation.error,
  };
}

export function useRegexWorkbenchEvaluation(
  samples: readonly string[],
  state: SearchState,
  replacement: string,
  cases: readonly RegexCase[],
): RegexEvaluation {
  return useRegexEvaluation(samples, state, replacement, cases);
}
