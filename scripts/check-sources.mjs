/**
 * Check that every source this project cites is still reachable.
 *
 * The fleet facts are transcribed from published rosters, and each one carries
 * the URL it came from. A citation nobody can open is worse than none: it looks
 * like provenance and answers nothing, and the reader who follows it learns only
 * that we did not check.
 *
 * Deliberately not part of `npm test`. It makes real network requests to other
 * people's servers, so a test suite that ran it would fail on an aeroplane, fail
 * in CI, and teach everyone to ignore it. Run it when the citations change, and
 * before a release that claims them.
 *
 * **Rate limiting looks exactly like a dead link, and that is the trap this file
 * exists to avoid.** A burst of requests to Wikimedia returns 429, and some of
 * those arrive as 404. Checking the same URLs one at a time with a pause showed
 * every one of them alive. So: one request at a time, a real delay between them,
 * and anything that fails is retried after a longer wait before it is called
 * broken. Slower, and it does not manufacture defects.
 *
 * Usage: node scripts/check-sources.mjs [--json] [--delay 3000]
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const argument = (flag, fallback) => {
  const at = process.argv.indexOf(flag);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const DELAY = Number(argument('--delay', '3000'));
const asJson = process.argv.includes('--json');

/* Google Fonts serves older formats to anything that does not look like a
   browser, and several wikis answer differently too. */
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

/** Files that carry citations. Hand-written: a new one has to be added here. */
const SOURCES = ['vehicles/fleet-registry.mjs', 'vehicles/regional-fleet.mjs', 'vehicles/index.mjs', 'vehicles/divisions.mjs'];

/**
 * Reasons a non-200 is expected rather than a defect. Each one is argued, so an
 * exemption cannot quietly become a way of hiding a real break.
 */
const EXPECTED = [
  { match: /api\.openmetrolinx\.com/, why: 'needs the Metrolinx key, which is never in the repository' },
  { match: /\$\{/, why: 'a template, not a URL: the real ones are built at run time' },
];

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function citedUrls() {
  const found = new Map();
  for (const file of SOURCES) {
    let text;
    try { text = readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    /* Read the whole quoted string, not "https:// up to the first bracket". A
       Wikimedia file page legitimately contains parentheses, and stopping at one
       produced a truncated URL that 404s, which reads as a dead citation for a
       page that is perfectly alive. The extractor was the defect, not the source. */
    for (const match of text.matchAll(/['"`](https:\/\/[^'"`]+)['"`]/g)) {
      const url = match[1];
      if (!found.has(url)) found.set(url, []);
      found.get(url).push(file);
    }
  }
  return found;
}

async function reach(url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': BROWSER, accept: '*/*' },
      signal: AbortSignal.timeout(25_000),
    });
    return { status: response.status, ok: response.ok };
  } catch (cause) {
    return { status: 0, ok: false, error: String(cause).slice(0, 120) };
  }
}

const results = [];
for (const [url, files] of citedUrls()) {
  const expected = EXPECTED.find((entry) => entry.match.test(url));
  if (expected) {
    results.push({ url, files, status: null, verdict: 'expected', why: expected.why });
    continue;
  }
  await pause(DELAY);
  let attempt = await reach(url);
  // A 429 or a 5xx is the server asking for room, not a broken citation.
  if (!attempt.ok) {
    await pause(DELAY * 4);
    attempt = await reach(url);
  }
  results.push({
    url,
    files,
    status: attempt.status,
    verdict: attempt.ok ? 'reachable' : 'unreachable',
    ...(attempt.error ? { error: attempt.error } : {}),
  });
}

const broken = results.filter((entry) => entry.verdict === 'unreachable');
if (asJson) {
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
} else {
  for (const entry of results) {
    const mark = entry.verdict === 'reachable' ? 'ok  ' : entry.verdict === 'expected' ? 'skip' : 'DEAD';
    console.log(`${mark} ${String(entry.status ?? '').padStart(3)} ${entry.url.slice(0, 96)}`);
    if (entry.verdict === 'expected') console.log(`          ${entry.why}`);
    if (entry.verdict === 'unreachable') console.log(`          cited in ${entry.files.join(', ')}`);
  }
  console.log(`\n${results.length} cited sources, ${broken.length} unreachable after a retry`);
}
process.exitCode = broken.length ? 1 : 0;
