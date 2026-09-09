import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, copyFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { parseVehicleFeed, combineVehicleSnapshots } from "../vehicles/index.mjs";
import { encodeFeed } from "../backend/ttc-trip-matcher.mjs";
import { liveLegStatusWithOtp, MAX_LIVE_REFRESH_MS } from "../backend/otp-client.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

// Materialize the actual Dockerfile COPY instructions into a temporary root,
// then launch its flattened /app/server.mjs with the same data paths.
async function imageRuntime(context, otpUrl, { missing = null } = {}) {
  const staging = await mkdtemp(path.join(os.tmpdir(), "gtha-backend-image-"));
  let child;
  context.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    await rm(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });
  const dockerfile = await readFile(path.join(root, "backend/Dockerfile"), "utf8");
  for (const line of dockerfile.split(/\r?\n/).filter((line) => line.startsWith("COPY "))) {
    const parts = line.split(/\s+/).slice(1); const destination = parts.pop();
    for (const source of parts) {
      const sources = source.endsWith("/*.mjs") ? (await readdir(path.join(root, path.dirname(source)))).filter((name) => name.endsWith(".mjs")).map((name) => `${path.dirname(source)}/${name}`) : [source];
      for (const entry of sources) {
        const base = destination.startsWith("/") ? staging : path.join(staging, "app");
        const target = path.join(base, destination.replace(/^\//, ""), ...(destination.endsWith("/") ? [path.basename(entry)] : []));
        await mkdir(path.dirname(target), { recursive: true }); await copyFile(path.join(root, entry), target);
      }
    }
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(staging, "app/otp/router-config.json"))), JSON.parse(await readFile(path.join(root, "backend/otp/router-config.json"))));
  assert.deepEqual(JSON.parse(await readFile(path.join(staging, "data/feeds.json"))), JSON.parse(await readFile(path.join(root, "data/feeds.json"))));
  if (missing) { assert.ok(["app/otp/router-config.json", "data/feeds.json"].includes(missing)); await rm(path.join(staging, missing)); }
  child = spawn(process.execPath, [path.join(staging, "app/server.mjs")], { cwd: path.join(staging, "app"), env: { ...process.env, PORT: "0", HOST: "127.0.0.1", OTP_URL: otpUrl, SOURCE_COMMIT: "a".repeat(40) }, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stderr.on("data", (chunk) => { output += chunk; }); child.stdout.on("data", (chunk) => { output += chunk; });
  // The server log reports its actual selected port, avoiding a reserve/release race.
  for (let attempt = 0; attempt < 100; attempt++) {
    const match = output.match(/routing backend listening on port (\d+)/);
    if (match && Number(match[1])) return `http://127.0.0.1:${match[1]}`;
    if (child.exitCode !== null) {
      if (missing) { assert.notEqual(child.exitCode, 0); assert.match(output, /ENOENT/); assert.ok(output.includes(path.basename(missing))); return null; }
      assert.fail(`Image runtime exited: ${output}`);
    }
    await delay(20);
  }
  assert.fail(`Image runtime did not start: ${output}`);
}

async function otpFixture(context, responder) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body); requests.push(input);
    const data = await responder(input);
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ data }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => { server.closeAllConnections(); server.close(); });
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

function assertPublicCoverage(payload) {
  assert.equal(payload.feeds.go.state, "applied"); assert.equal(payload.feeds.yrt.state, "applied");
  assert.ok(["shadow", "published-unjoinable"].includes(payload.feeds["ttc-next"].state));
  assert.notEqual(payload.feeds.ttc.state, "applied");
  assert.ok(Number.isFinite(Date.parse(payload.checkedAt)));
  for (const entry of Object.values(payload.feeds)) for (const key of Object.keys(entry)) assert.ok(["state", "frequency", "reason"].includes(key), key);
  assert.doesNotMatch(JSON.stringify(payload), /https?:|\/internal\/|8788|api:|otp:/);
}

test("flattened backend starts with runtime JSON and HTTP coverage never exports updater URLs", async (context) => {
  const fixture = await otpFixture(context, () => ({ planConnection: { edges: [] } }));
  const base = await imageRuntime(context, fixture.url);
  const coverage = await fetch(`${base}/api/live-coverage`); assert.equal(coverage.status, 200); assertPublicCoverage(await coverage.json());
  const health = await fetch(`${base}/health`); assert.equal((await health.json()).sourceCommit, "a".repeat(40));
  const plan = await fetch(`${base}/api/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: { lat: 43.7, lon: -79.4 }, to: { lat: 43.71, lon: -79.41 }, dateTime: "2026-09-09T12:00:00-04:00" }) });
  assert.equal(plan.status, 200); assertPublicCoverage((await plan.json()).liveCoverage);
  const router = JSON.parse(await readFile(path.join(root, "backend/otp/router-config.json")));
  assert.equal(router.updaters.some((entry) => entry.type === "stop-time-updater" && ["ttc", "ttc-next"].includes(entry.feedId)), false);
});

test("missing router configuration or feed catalog prevents flattened runtime startup", async (context) => {
  for (const missing of ["app/otp/router-config.json", "data/feeds.json"]) assert.equal(await imageRuntime(context, "http://127.0.0.1:1", { missing }), null);
});

test("private upcoming endpoint accepts actual collector output, returns three publisher stops and rejects rider envelopes", async (context) => {
  const now = Date.now(); const seconds = Math.floor(now / 1000);
  const vehicle = combineVehicleSnapshots([parseVehicleFeed(encodeFeed({ header: { timestamp: seconds }, vehiclePositions: [{ id: "fixture", vehicle: { id: "42" }, timestamp: seconds, trip: { tripId: "trip-42" }, position: { latitude: 43.7, longitude: -79.4 }, stopId: "2", currentStatus: 2, currentStopSequence: 2 }] }), { agencyId: "miway", now })]).vehicles[0];
  let wrongTrip = false;
  const fixture = await otpFixture(context, (input) => ({ trip: { gtfsId: wrongTrip ? "yrt:wrong-trip" : input.variables.id, route: { gtfsId: "miway:r" }, stoptimesForDate: Array.from({ length: 6 }, (_, index) => ({ serviceDay: seconds, scheduledArrival: 300 + index * 60, scheduledDeparture: 310 + index * 60, realtime: index === 3, realtimeArrival: 310 + index * 60, realtimeDeparture: 320 + index * 60, realtimeState: index === 3 ? "UPDATED" : "SCHEDULED", stop: { gtfsId: `miway:${index}`, name: `Stop ${index}`, lat: 43.7, lon: -79.4 } })) } }));
  const base = await imageRuntime(context, fixture.url);
  const post = (input) => fetch(`${base}/api/internal/vehicles/upcoming`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const response = await post({ snapshot: vehicle }); assert.equal(response.status, 200);
  const payload = await response.json(); assert.equal(payload.state, "live");
  assert.deepEqual(payload.candidates.map((stop) => stop.id), ["miway:2", "miway:3", "miway:4"]);
  assert.deepEqual(payload.candidates.map((stop) => stop.basis), ["scheduled", "realtime", "scheduled"]);
  assert.equal(fixture.requests[0].variables.id, "miway:trip-42"); assert.match(fixture.requests[0].variables.date, /^\d{8}$/);
  assert.equal(Object.hasOwn(payload.vehicle, "lat"), false); assert.equal(Object.hasOwn(payload.vehicle, "lon"), false);
  for (const stop of payload.candidates) assert.equal(Date.parse(stop.arriveByAt), Date.parse(stop.arrivalAt ?? stop.scheduledArrivalAt) - 120000);
  const before = fixture.requests.length;
  for (const input of [null, {}, { snapshot: vehicle, from: { lat: 1, lon: 2 } }, { snapshot: { ...vehicle, tripId: "yrt:wrong" } }, { snapshot: { ...vehicle, timestamp: new Date(now - 180000).toISOString() } }]) {
    const invalid = await post(input); assert.equal(invalid.status, 400); assert.equal((await invalid.json()).code, "INVALID_COLLECTOR_SNAPSHOT");
  }
  assert.equal(fixture.requests.length, before);
  wrongTrip = true;
  const wrong = await (await post({ snapshot: vehicle })).json(); assert.equal(wrong.state, "unavailable"); assert.deepEqual(wrong.candidates, []);
  const web = await readFile(path.join(root, "server/web.mjs"), "utf8");
  const allowlist = web.match(/const routes = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(allowlist, "public proxy allowlist exists");
  assert.doesNotMatch(allowlist[1], /\/api\/internal\//);
});

test("live refresh HTTP rejects malformed and impossible dates before OTP and keeps the 40-leg bound", async (context) => {
  const fixture = await otpFixture(context, () => ({ leg: null })); const base = await imageRuntime(context, fixture.url);
  for (const body of ["{", "null", "[]", "{}", JSON.stringify({ legs: [null] }), JSON.stringify({ legs: [{ legId: "id", serviceDate: "20260230" }] }), JSON.stringify({ legs: [{ legId: "id", serviceDate: "2026-09-09" }] }), JSON.stringify({ legs: Array.from({ length: 41 }, () => ({ legId: "id" })) })]) {
    const response = await fetch(`${base}/api/journeys/live`, { method: "POST", body });
    assert.equal(response.status, 400, body); assert.equal((await response.json()).code, "INVALID_LIVE_REQUEST");
  }
  assert.equal(fixture.requests.length, 0);
});

test("live refresh holds eight concurrent requests, preserves order and shares its deadline", async (context) => {
  let active = 0; let peak = 0;
  const fixture = await otpFixture(context, async () => { active++; peak = Math.max(peak, active); await delay(10); active--; return { leg: null }; });
  const legs = Array.from({ length: 40 }, (_, index) => ({ legId: `leg-${index}` }));
  const result = await liveLegStatusWithOtp({ otpUrl: fixture.url, timeoutMs: 1000, legs });
  assert.equal(result.legs.length, 40); assert.deepEqual(result.legs.map((leg) => leg.legId), legs.map((leg) => leg.legId));
  assert.equal(peak, 8); assert.equal(fixture.requests.length, 40); assert.equal(MAX_LIVE_REFRESH_MS, 15000);
  const slow = await otpFixture(context, async () => { await delay(100); return { leg: null }; });
  const started = Date.now(); const timed = await liveLegStatusWithOtp({ otpUrl: slow.url, timeoutMs: 25, legs });
  assert.equal(timed.legs.length, 40); assert.ok(timed.legs.every((leg) => leg.error === "unavailable"));
  assert.ok(slow.requests.length <= 8); assert.ok(Date.now() - started < 500);
});
