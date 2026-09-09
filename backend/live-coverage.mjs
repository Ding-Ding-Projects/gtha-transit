import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createMatcherStatsCache } from "./ttc-stats-proxy.mjs";

/**
 * Whether a static feed's live trip updates actually change what a rider is
 * told, independently of whether `realtime/registry.json` calls the feed's
 * protobuf endpoint public.
 *
 * `realtime/registry.json` answers "is there a live feed at all". This
 * answers the different, narrower question OTP's own router configuration
 * decides: is that feed's identity trusted enough to apply to routing. A
 * feed can be genuinely public and still be `published-unjoinable`, because
 * its trip and stop identifiers do not match the loaded static timetable
 * (see `docs/vehicles/trip-identifiers.md`); `shadow` is the same feed once
 * a separate identity-matching service is wired in to join it a different,
 * verified way.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const routerConfig = JSON.parse(readFileSync(path.join(here, "otp", "router-config.json"), "utf8"));
const staticFeeds = JSON.parse(readFileSync(path.join(here, "..", "data", "feeds.json"), "utf8"));

const TTC_UNJOINABLE_REASON = "The TTC publishes trip updates whose trip and stop identifiers do not join the loaded timetable; see docs/vehicles/trip-identifiers.md";
const BURLINGTON_UNJOINABLE_REASON = "Burlington's trip identifiers do not join the loaded timetable (0 of 103 matched)";
const PUBLISHED_UNJOINABLE_REASONS = { ttc: TTC_UNJOINABLE_REASON, "ttc-next": TTC_UNJOINABLE_REASON, burlington: BURLINGTON_UNJOINABLE_REASON };
const SHADOW_CANDIDATE_FEED_IDS = new Set(["ttc", "ttc-next"]);

function appliedFeeds() {
  const applied = new Map();
  for (const updater of routerConfig.updaters ?? []) {
    if (updater.type === "stop-time-updater" && updater.feedId) applied.set(updater.feedId, { state: "applied", frequency: updater.frequency });
  }
  return applied;
}

function buildFeeds() {
  const applied = appliedFeeds();
  const feeds = {};
  for (const agency of staticFeeds.agencies ?? []) {
    const feedId = agency.id;
    if (applied.has(feedId)) { feeds[feedId] = applied.get(feedId); continue; }
    if (Object.hasOwn(PUBLISHED_UNJOINABLE_REASONS, feedId)) {
      const reason = PUBLISHED_UNJOINABLE_REASONS[feedId];
      feeds[feedId] = { state: "published-unjoinable", reason };
      continue;
    }
    feeds[feedId] = { state: "none" };
  }
  return feeds;
}

export const LIVE_COVERAGE = { feeds: buildFeeds() };

const matcherCache = createMatcherStatsCache({ origin: process.env.TTC_MATCHER_URL });

export function coverageWithMatcher(stats, now = Date.now()) {
  const feeds = Object.fromEntries(Object.entries(LIVE_COVERAGE.feeds).map(([id, value]) => [id, { ...value }]));
  if (stats.state === "shadow" && SHADOW_CANDIDATE_FEED_IDS.has(stats.feed) && feeds[stats.feed]?.state !== "applied") feeds[stats.feed].state = "shadow";
  return { feeds, checkedAt: new Date(now).toISOString(), ttcMatcher: stats };
}

export function liveCoverage() { void matcherCache.refresh(); return coverageWithMatcher(matcherCache.read()); }

export async function refreshLiveCoverage() { const stats = await matcherCache.refresh(); return coverageWithMatcher(stats); }

export function isApplied(feedId) { return LIVE_COVERAGE.feeds[feedId]?.state === "applied"; }
