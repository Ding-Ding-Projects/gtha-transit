import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createMatcherStatsCache, createStatsProxy, sanitizeMatcherStats, unavailableStats, STATS_LIMITS } from "../backend/ttc-stats-proxy.mjs";
import { coverageWithMatcher } from "../backend/live-coverage.mjs";

const NOW = Date.parse("2026-09-09T16:00:00Z");
const fixture = () => ({ feed: "ttc-next", lastPollAt: new Date(NOW - 10000).toISOString(), lastPoll: { total: 291, unique: 1, ambiguous: 31, none: 0, contradicted: 2, unverified: 237, sequenceMisaligned: 20, coverageUnverified: 230 }, rolling24h: { total: 873, unique: 3, ambiguous: 93, none: 0, contradicted: 6, unverified: 711, sequenceMisaligned: 60, coverageUnverified: 690, polls: 3 }, coverage: { built: 2, failed: 0, cachedEntries: 6, cachedStops: 12000 }, provenance: { sourceCommit: "a".repeat(40), startedAt: new Date(NOW - 180000).toISOString() }, gate: { passes: true, privateUrl: "http://private.invalid/feed" }, privateUrl: "http://private.invalid/feed", error: "private raw error" });
const response = (value) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

async function listen(context, server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}

test("sanitized summaries preserve every truthful count and only bounded public provenance", () => {
  const safe = sanitizeMatcherStats(fixture(), NOW);
  assert.equal(safe.state, "shadow"); assert.equal(safe.lastPoll.total, 291); assert.equal(safe.lastPoll.unverified, 237);
  assert.equal(safe.rolling24h.total, 873); assert.equal(safe.rolling24h.polls, 3);
  assert.equal(safe.provenance.sourceCommit, "a".repeat(40));
  assert.equal(safe.provenance.observationWindow, "since-restart-up-to-24h"); assert.equal(safe.routingApplied, false);
  assert.equal(Object.hasOwn(safe, "gate"), false); assert.doesNotMatch(JSON.stringify(safe), /private|https?:|error/);
  assert.equal(sanitizeMatcherStats(safe, NOW).state, "shadow", "the bridge output can be validated again by the API");
});

test("malformed or inconsistent summaries fail closed without replacing the last valid result", () => {
  for (const change of [
    (raw) => { raw.lastPoll.unique = -1; },
    (raw) => { raw.lastPoll.unique = 1.5; },
    (raw) => { raw.lastPoll.total = 292; },
    (raw) => { raw.lastPoll.coverageUnverified = 238; },
    (raw) => { raw.rolling24h.total = 1e12; },
    (raw) => { raw.rolling24h.polls = "3"; },
    (raw) => { raw.rolling24h.polls = 0; },
    (raw) => { raw.rolling24h.polls = 1; },
    (raw) => { raw.lastPollAt = "http://private.invalid"; },
    (raw) => { raw.lastPollAt = new Date(NOW + 31000).toISOString(); },
    (raw) => { raw.provenance.sourceCommit = "private"; },
    (raw) => { raw.provenance.startedAt = new Date(NOW + 60000).toISOString(); },
    (raw) => { raw.coverage.cachedStops = 75001; },
    (raw) => { raw.coverage.failed = 1; },
    (raw) => { raw.feed = "private"; },
  ]) { const raw = fixture(); change(raw); assert.equal(sanitizeMatcherStats(raw, NOW), null); }
  assert.equal(sanitizeMatcherStats([], NOW), null); assert.equal(sanitizeMatcherStats(null, NOW), null);
});

test("stale and never-observed states cannot be promoted to shadow by configuration", async () => {
  const absent = createMatcherStatsCache({ origin: undefined, now: () => NOW });
  assert.equal((await absent.refresh()).state, "unavailable"); assert.equal(absent.read().configured, false);
  const configured = createMatcherStatsCache({ origin: "http://bridge.invalid", now: () => NOW, fetchImpl: async () => { throw new Error("http://private.invalid"); } });
  const waiting = coverageWithMatcher(configured.read(), NOW);
  assert.equal(waiting.feeds["ttc-next"].state, "published-unjoinable"); assert.equal(waiting.ttcMatcher.state, "unavailable");
  assert.equal((await configured.refresh()).state, "unavailable");
  const old = fixture(); old.lastPollAt = new Date(NOW - 120001).toISOString();
  const stale = sanitizeMatcherStats(old, NOW); assert.equal(stale.state, "stale");
  assert.equal(coverageWithMatcher(stale, NOW).feeds["ttc-next"].state, "published-unjoinable");
  const fresh = coverageWithMatcher(sanitizeMatcherStats(fixture(), NOW), NOW);
  assert.equal(fresh.feeds["ttc-next"].state, "shadow"); assert.equal(fresh.feeds.ttc.state, "published-unjoinable");
  assert.notEqual(fresh.feeds["ttc-next"].state, "applied");
  const never = { ...unavailableStats(NOW), feed: "ttc-next" }; assert.equal(sanitizeMatcherStats(never, NOW).state, "unavailable");
});

test("cache is single-flight, expires in place and retains stale counts on refresh failure", async () => {
  let now = NOW; let calls = 0; let resolve;
  const hold = new Promise((done) => { resolve = done; });
  const cache = createMatcherStatsCache({ origin: "http://bridge.invalid", now: () => now, fetchImpl: async () => { calls++; await hold; if (calls > 1) throw new Error("private upstream error"); return response(fixture()); } });
  const pending = cache.refresh(); assert.equal(cache.refresh(), pending); resolve(); await pending;
  assert.equal(calls, 1); assert.equal(cache.read().state, "shadow");
  await cache.refresh(); assert.equal(calls, 1);
  now += STATS_LIMITS.refreshMs; await cache.refresh();
  assert.equal(cache.read().state, "stale"); assert.equal(cache.read().rolling24h.total, 873);
  now += STATS_LIMITS.staleMs; assert.equal(cache.read().state, "stale"); assert.doesNotMatch(JSON.stringify(cache.read()), /private|https?:/);
});

test("cache bounds oversized streaming bodies, redirects, invalid origins and malformed JSON", async () => {
  for (const fetchImpl of [
    async () => new Response(" ".repeat(STATS_LIMITS.bytes + 1)),
    async () => new Response("{}", { headers: { "content-length": String(STATS_LIMITS.bytes + 1) } }),
    async () => new Response("{invalid"),
    async () => new Response("", { status: 302, headers: { location: "http://private.invalid" } }),
  ]) {
    const cache = createMatcherStatsCache({ origin: "http://bridge.invalid", now: () => NOW, fetchImpl });
    assert.equal((await cache.refresh()).state, "unavailable");
  }
  for (const origin of ["file:///tmp/a", "http://bridge.invalid/arbitrary", "http://user:password@bridge.invalid", "http://bridge.invalid/?target=x"]) {
    let called = false; const cache = createMatcherStatsCache({ origin, now: () => NOW, fetchImpl: () => { called = true; } });
    assert.equal((await cache.refresh()).state, "unavailable"); assert.equal(called, false);
  }
});

test("the two-second deadline settles a transport that ignores abort", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
  let signal;
  const cache = createMatcherStatsCache({ origin: "http://bridge.invalid", fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
  const pending = cache.refresh(); context.mock.timers.tick(2000);
  const result = await pending; assert.equal(result.state, "unavailable"); assert.equal(signal.aborted, true);
});

test("bridge forwards only its fixed stats request and never proxies a rewritten feed or request headers", async (context) => {
  const requests = [];
  const upstream = await listen(context, http.createServer((req, res) => { requests.push({ url: req.url, headers: req.headers, method: req.method }); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(fixture())); }));
  const proxy = await listen(context, createStatsProxy({ upstream, now: () => NOW }));
  const health = await fetch(`${proxy}/health`); assert.equal(health.status, 200); assert.equal(requests.length, 0);
  for (const [route, method] of [["/internal/ttc/trips", "GET"], ["/stats?feed=ttc", "GET"], ["/stats?url=http://private.invalid", "GET"], ["/stats", "POST"], ["/anything", "GET"]]) {
    assert.equal((await fetch(`${proxy}${route}`, { method })).status, 404);
  }
  assert.equal(requests.length, 0);
  const stats = await fetch(`${proxy}/stats`, { headers: { authorization: "test-value", "x-arbitrary": "do-not-forward" } });
  assert.equal(stats.status, 200); assert.equal(stats.headers.get("cache-control"), "no-store");
  const payload = await stats.json(); assert.equal(payload.lastPoll.total, 291); assert.doesNotMatch(JSON.stringify(payload), /private|https?:|test-value/);
  assert.equal(requests.length, 1); assert.equal(requests[0].url, "/internal/ttc/match-stats?feed=ttc-next");
  assert.equal(requests[0].headers.authorization, undefined); assert.equal(requests[0].headers["x-arbitrary"], undefined);
});

test("real API publishes sanitized bridge observations with truthful shadow and no activation", async (context) => {
  const raw = fixture(); raw.lastPollAt = new Date().toISOString(); raw.provenance.startedAt = new Date(Date.now() - 180000).toISOString();
  const bridge = await listen(context, http.createServer((req, res) => { assert.equal(req.url, "/stats"); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(sanitizeMatcherStats(raw))); }));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../backend/server.mjs", import.meta.url))], { env: { ...process.env, PORT: "0", HOST: "127.0.0.1", TTC_MATCHER_URL: bridge }, stdio: ["ignore", "pipe", "pipe"] });
  context.after(async () => { if (child.exitCode === null && child.signalCode === null) { const done = once(child, "exit"); child.kill(); await done; } });
  let output = ""; child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { output += chunk; });
  let port;
  for (let attempt = 0; attempt < 100; attempt++) { port = output.match(/routing backend listening on port (\d+)/)?.[1]; if (port) break; if (child.exitCode !== null) break; await delay(20); }
  assert.ok(port, output);
  const payload = await (await fetch(`http://127.0.0.1:${port}/api/live-coverage`)).json();
  assert.equal(payload.ttcMatcher.state, "shadow"); assert.equal(payload.ttcMatcher.lastPoll.total, 291); assert.equal(payload.ttcMatcher.rolling24h.polls, 3);
  assert.equal(payload.feeds["ttc-next"].state, "shadow"); assert.notEqual(payload.feeds.ttc.state, "applied");
  assert.equal(payload.ttcMatcher.routingApplied, false); assert.doesNotMatch(JSON.stringify(payload), /127[.]0[.]0[.]1|private|https?:|\/internal\//);
});
