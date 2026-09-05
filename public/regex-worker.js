/*
 * A deliberately small, standalone worker. RegExp execution stays here so the
 * caller can terminate this whole realm when a hostile pattern takes too long.
 */
const LIMITS = Object.freeze({
  maxFlags: 8,
  maxPatternLength: 512,
  maxSamples: 10000,
  maxSampleLength: 512,
  maxTotalSampleLength: 1024 * 1024,
  maxCases: 24,
  maxCaseLength: 2048,
  maxReplacementLength: 512,
  maxCaptureLength: 96,
  maxPreviewLength: 768,
  maxDetails: 48,
  maxMatchesPerSample: 12,
});

const ALLOWED_FLAGS = 'dgimsuvy';
const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());

function postResult(payload) {
  self.postMessage({ type: 'result', ...payload });
}

function error(requestId, generation, code) {
  postResult({ requestId, generation, error: code });
}

function truncate(value, limit) {
  if (value.length <= limit) return { value, truncated: false };
  return { value: `${value.slice(0, Math.max(0, limit - 1))}…`, truncated: true };
}

function validateFlags(flags) {
  if (typeof flags !== 'string' || flags.length > LIMITS.maxFlags) return false;
  const used = new Set();
  for (const flag of flags) {
    if (!ALLOWED_FLAGS.includes(flag) || used.has(flag)) return false;
    used.add(flag);
  }
  return !(used.has('u') && used.has('v'));
}

function validateSamples(samples) {
  if (!Array.isArray(samples) || samples.length > LIMITS.maxSamples) return false;
  let total = 0;
  for (const sample of samples) {
    if (typeof sample !== 'string' || sample.length > LIMITS.maxSampleLength) return false;
    total += sample.length;
    if (total > LIMITS.maxTotalSampleLength) return false;
  }
  return true;
}

function validateCases(cases) {
  if (!Array.isArray(cases) || cases.length > LIMITS.maxCases) return false;
  return cases.every(
    (item) =>
      item &&
      typeof item.id === 'string' &&
      typeof item.text === 'string' &&
      item.text.length <= LIMITS.maxCaseLength &&
      typeof item.expected === 'boolean',
  );
}

function advanceIndex(text, index, unicode) {
  if (!unicode || index >= text.length) return Math.min(text.length, index + 1);
  const first = text.charCodeAt(index);
  const second = text.charCodeAt(index + 1);
  const isHigh = first >= 0xd800 && first <= 0xdbff;
  const isLow = second >= 0xdc00 && second <= 0xdfff;
  return Math.min(text.length, index + (isHigh && isLow ? 2 : 1));
}

function captureValues(match) {
  const captures = [];
  let truncated = false;
  for (let index = 1; index < match.length; index += 1) {
    const value = match[index];
    if (value === undefined) {
      captures.push({ name: `$${index}`, value: null });
      continue;
    }
    const shortened = truncate(String(value), LIMITS.maxCaptureLength);
    truncated ||= shortened.truncated;
    captures.push({ name: `$${index}`, value: shortened.value });
  }
  if (match.groups) {
    for (const [name, value] of Object.entries(match.groups)) {
      if (value === undefined) {
        captures.push({ name, value: null });
        continue;
      }
      const shortened = truncate(String(value), LIMITS.maxCaptureLength);
      truncated ||= shortened.truncated;
      captures.push({ name, value: shortened.value });
    }
  }
  return { captures, truncated };
}

function collectMatches(pattern, flags, sample, sampleIndex, details, compiled) {
  const global = flags.includes('g') || flags.includes('y');
  const regex = global ? new RegExp(pattern, flags) : compiled;
  const unicode = flags.includes('u') || flags.includes('v');
  let matched = false;
  let count = 0;
  let match = regex.exec(sample);
  while (match && count < LIMITS.maxMatchesPerSample) {
    matched = true;
    if (details.length < LIMITS.maxDetails) {
      const text = truncate(String(match[0]), LIMITS.maxCaptureLength);
      const groupValues = captureValues(match);
      const start = typeof match.index === 'number' ? match.index : 0;
      details.push({
        sampleIndex,
        start,
        end: start + String(match[0]).length,
        text: text.value,
        captures: groupValues.captures,
        truncated: text.truncated || groupValues.truncated,
      });
    }
    count += 1;
    if (!global) break;
    const prior = regex.lastIndex;
    if (String(match[0]).length === 0) {
      const next = advanceIndex(sample, prior, unicode);
      // At end-of-string there is no later position to inspect. Stopping here
      // retains the final empty match without duplicating it until a cap wins.
      if (next <= prior) break;
      regex.lastIndex = next;
    }
    match = regex.exec(sample);
  }
  return matched;
}

function staticRiskNotes(pattern) {
  const notes = [];
  if (pattern.length > 160) notes.push('long-pattern');
  if (pattern.includes('.*.*') || pattern.includes('.+.+')) notes.push('repeated-wildcard');
  const stack = [];
  let escaped = false;
  let inClass = false;
  let closedGroup = null;
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
      closedGroup = stack.pop() || null;
      continue;
    }
    const quantifier = current === '*' || current === '+' || current === '?' || current === '{';
    if (quantifier) {
      if (closedGroup && closedGroup.hasInnerQuantifier) notes.push('nested-repeat');
      if (stack.length) stack[stack.length - 1].hasInnerQuantifier = true;
      closedGroup = null;
      continue;
    }
    closedGroup = null;
  }
  return [...new Set(notes)];
}

function replacementPreview(pattern, flags, samples, replacement) {
  for (let index = 0; index < samples.length; index += 1) {
    const input = samples[index];
    const matcher = new RegExp(pattern, flags);
    if (!matcher.test(input)) continue;
    const output = input.replace(new RegExp(pattern, flags), replacement);
    const shortened = truncate(output, LIMITS.maxPreviewLength);
    return { sampleIndex: index, value: shortened.value, truncated: shortened.truncated };
  }
  return null;
}

self.onmessage = (event) => {
  const request = event && event.data ? event.data : {};
  const requestId = typeof request.requestId === 'number' ? request.requestId : -1;
  const generation = typeof request.generation === 'number' ? request.generation : -1;
  if (request.type !== 'evaluate') return error(requestId, generation, 'invalid-request');
  if (typeof request.pattern !== 'string' || request.pattern.length > LIMITS.maxPatternLength) {
    return error(requestId, generation, 'pattern-too-long');
  }
  if (!validateFlags(request.flags)) return error(requestId, generation, 'invalid-flags');
  if (!validateSamples(request.samples)) return error(requestId, generation, 'invalid-samples');
  if (typeof request.replacement !== 'string' || request.replacement.length > LIMITS.maxReplacementLength) {
    return error(requestId, generation, 'replacement-too-long');
  }
  if (!validateCases(request.cases)) return error(requestId, generation, 'invalid-cases');

  const startedAt = now();
  let validation;
  try {
    validation = new RegExp(request.pattern, request.flags);
  } catch {
    return error(requestId, generation, 'invalid-pattern');
  }
  // Keep this construction above so a bad pattern fails before the per-sample work.
  void validation;

  try {
    const details = [];
    const matches = request.samples.map((sample, sampleIndex) =>
      collectMatches(request.pattern, request.flags, sample, sampleIndex, details, validation),
    );
    const cases = request.cases.map((item) => {
      const actual = new RegExp(request.pattern, request.flags).test(item.text);
      return { ...item, actual, passed: actual === item.expected };
    });
    postResult({
      requestId,
      generation,
      error: null,
      matches,
      details,
      warnings: staticRiskNotes(request.pattern),
      cases,
      replacementPreview: replacementPreview(
        request.pattern,
        request.flags,
        request.samples,
        request.replacement,
      ),
      elapsedMs: Math.max(0, now() - startedAt),
    });
  } catch {
    error(requestId, generation, 'worker-failed');
  }
};
