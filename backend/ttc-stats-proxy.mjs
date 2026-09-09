import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STATS_LIMITS = Object.freeze({ bytes: 32 * 1024, deadlineMs: 2000, refreshMs: 15000, staleMs: 120000 });
const COUNTERS = ["unique", "ambiguous", "none", "contradicted", "unverified", "sequenceMisaligned"];
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value, max = 100_000_000) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const timestamp = (value) => typeof value === "string" && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const iso = (now) => new Date(now).toISOString();
const emptyCounts = () => ({ total: 0, unique: 0, ambiguous: 0, none: 0, contradicted: 0, unverified: 0, sequenceMisaligned: 0, coverageUnverified: 0 });

export function unavailableStats(now = Date.now()) {
  return { state: "unavailable", checkedAt: iso(now), feed: null, lastPollAt: null, lastPoll: emptyCounts(), rolling24h: { ...emptyCounts(), polls: 0 }, coverage: null, provenance: { sourceCommit: null, startedAt: null, observationWindow: "since-restart-up-to-24h" }, routingApplied: false };
}

function counts(value, max) {
  if (!object(value) || !integer(value.total, max) || COUNTERS.some((key) => !integer(value[key], max))) return null;
  if (COUNTERS.reduce((sum, key) => sum + value[key], 0) !== value.total) return null;
  const coverageUnverified = value.coverageUnverified ?? 0;
  if (!integer(coverageUnverified, max) || coverageUnverified > value.unverified) return null;
  return { total: value.total, ...Object.fromEntries(COUNTERS.map((key) => [key, value[key]])), coverageUnverified };
}

/** Whitelist numeric observations and bounded provenance, never copy upstream errors or URLs. */
export function sanitizeMatcherStats(raw, now = Date.now()) {
  if (!object(raw) || !["ttc", "ttc-next"].includes(raw.feed)) return null;
  const lastPoll = counts(raw.lastPoll, 10000); const rolling24h = counts(raw.rolling24h, 100_000_000);
  const polls = raw.rolling24h?.polls;
  if (!lastPoll || !rolling24h || !integer(polls, 100000) || COUNTERS.concat("total", "coverageUnverified").some((key) => rolling24h[key] < lastPoll[key])) return null;
  if (rolling24h.total > polls * 10000 || polls === 1 && COUNTERS.concat("total", "coverageUnverified").some((key) => rolling24h[key] !== lastPoll[key])) return null;
  if (polls === 0 && (lastPoll.total !== 0 || rolling24h.total !== 0 || raw.lastPollAt != null)) return null;
  if (polls > 0 && !timestamp(raw.lastPollAt)) return null;
  const age = polls > 0 ? now - Date.parse(raw.lastPollAt) : Infinity;
  if (age < -30000) return null;
  const sourceCommit = raw.provenance?.sourceCommit ?? null;
  const startedAt = raw.provenance?.startedAt ?? null;
  if (sourceCommit !== null && (typeof sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(sourceCommit))) return null;
  if (startedAt !== null && (!timestamp(startedAt) || Date.parse(startedAt) > now + 30000 || polls > 0 && Date.parse(startedAt) > Date.parse(raw.lastPollAt) + 1000)) return null;
  let coverage = null;
  if (raw.coverage != null) {
    const bounds = { built: 2, failed: 2, cachedEntries: 8, cachedStops: 75000 };
    if (!object(raw.coverage) || Object.entries(bounds).some(([key, max]) => !integer(raw.coverage[key], max))) return null;
    if (raw.coverage.built + raw.coverage.failed > 2) return null;
    coverage = Object.fromEntries(Object.keys(bounds).map((key) => [key, raw.coverage[key]]));
  }
  const state = !polls ? "unavailable" : age > STATS_LIMITS.staleMs || raw.state === "stale" || raw.state === "unavailable" ? "stale" : "shadow";
  return { state, checkedAt: iso(now), feed: raw.feed, lastPollAt: polls ? iso(Date.parse(raw.lastPollAt)) : null, lastPoll, rolling24h: { ...rolling24h, polls }, coverage, provenance: { sourceCommit, startedAt, observationWindow: "since-restart-up-to-24h" }, routingApplied: false };
}

function fixedUrl(origin, pathname, feed) {
  const url = new URL(origin);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Invalid statistics origin");
  url.pathname = pathname;
  if (feed) url.searchParams.set("feed", feed);
  return url;
}

/** Request-driven, single-flight cache. Even a transport ignoring abort has a deadline. */
export function createMatcherStatsCache({ origin, direct = false, feed = "ttc-next", fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let cached = null; let failed = false; let attemptedAt = -Infinity; let pending = null;
  const configured = typeof origin === "string" && origin.length > 0;
  const read = () => {
    const current = cached ? sanitizeMatcherStats(cached, now()) : null;
    return { ...(current ?? unavailableStats(now())), ...(current?.rolling24h.polls > 0 && failed ? { state: "stale" } : {}), configured };
  };
  const refresh = () => {
    if (pending) return pending;
    if (!configured || now() - attemptedAt >= 0 && now() - attemptedAt < STATS_LIMITS.refreshMs) return Promise.resolve(read());
    attemptedAt = now();
    pending = (async () => {
      const controller = new AbortController(); let timer; let reader;
      const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Statistics deadline exceeded")); }, STATS_LIMITS.deadlineMs); });
      try {
        if (!["ttc", "ttc-next"].includes(feed)) throw new Error("Invalid statistics feed");
        const url = fixedUrl(origin, direct ? "/internal/ttc/match-stats" : "/stats", direct ? feed : null);
        const operation = (async () => {
          const response = await fetchImpl(url, { method: "GET", redirect: "error", signal: controller.signal, headers: { accept: "application/json" } });
          if (!response.ok || Number(response.headers.get("content-length")) > STATS_LIMITS.bytes) throw new Error("Statistics response unavailable");
          reader = response.body.getReader(); const chunks = []; let total = 0;
          for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > STATS_LIMITS.bytes) throw new Error("Statistics response exceeds limit"); chunks.push(Buffer.from(value)); }
          return JSON.parse(Buffer.concat(chunks).toString("utf8"));
        })();
        const raw = await Promise.race([operation, deadline]);
        // A bridge with no observation may report a typed unavailable sentinel.
        if (!direct && raw?.state === "unavailable" && raw.feed === null) throw new Error("Statistics unavailable");
        const safe = sanitizeMatcherStats(raw, now()); if (!safe) throw new Error("Invalid statistics summary");
        cached = safe; failed = false;
      } catch { failed = true; }
      finally { clearTimeout(timer); controller.abort(); if (reader) { reader.cancel().catch(() => {}); } }
      return read();
    })().finally(() => { pending = null; });
    return pending;
  };
  return { read, refresh };
}

export function createStatsProxy({ upstream = process.env.TTC_MATCHER_UPSTREAM, feed = process.env.TTC_MATCHER_FEED ?? "ttc-next", ...options } = {}) {
  const cache = createMatcherStatsCache({ ...options, origin: upstream, direct: true, feed });
  const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
  return http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true, service: "ttc-stats-proxy" });
    if (req.method === "GET" && req.url === "/stats") return json(res, 200, await cache.refresh());
    return json(res, 404, { code: "NOT_FOUND" });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createStatsProxy();
  server.listen(Number(process.env.PORT ?? 8791), process.env.HOST ?? "0.0.0.0", () => console.log(`statistics bridge listening on port ${server.address().port}`));
}
