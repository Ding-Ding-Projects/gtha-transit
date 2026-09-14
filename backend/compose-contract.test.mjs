import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const compose = readFileSync(join(here, "compose.yaml"), "utf8");
const script = join(here, "reattach-detached.sh");
const installer = readFileSync(join(here, "install-compose-units.sh"), "utf8");

function serviceBlock(name) {
  const lines = compose.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${name}:`);
  assert.notEqual(start, -1, `compose.yaml has no ${name} service`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line) || /^\S/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).filter((line) => !/^\s*#/.test(line)).join("\n");
}

test("OpenTripPlanner publishes port 8790 for the routing API on the other host", () => {
  const otp = serviceBlock("otp");
  assert.match(otp, /^\s{4}ports: \["\$\{OTP_BIND_ADDRESS:-127\.0\.0\.1\}:8790:8080"\]$/m);
});

test("the statistics bridge publishes 18791 for the routing API and reads the matcher by service name", () => {
  const proxy = serviceBlock("ttc-stats-proxy");
  assert.match(proxy, /^\s{4}ports: \["\$\{TTC_STATS_BIND_ADDRESS:-127\.0\.0\.1\}:18791:8791"\]$/m);
  assert.match(proxy, /TTC_MATCHER_UPSTREAM: "http:\/\/ttc-matcher:8790"/);
});

test("every Node service names its image so a boot never rebuilds from stale host source", () => {
  for (const name of ["metrolinx-proxy", "ttc-matcher", "ttc-stats-proxy"]) {
    assert.match(serviceBlock(name), /^\s{4}image: gtha-transit-backend:\$\{BACKEND_IMAGE_TAG:-local\}$/m, name);
  }
});

test("OpenTripPlanner keeps a restart policy", () => {
  assert.match(serviceBlock("otp"), /^\s{4}restart: unless-stopped$/m);
});

function classify(...state) {
  return execFileSync("sh", [script, "--classify", ...state.map(String)], { encoding: "utf8" }).trim();
}

test("a running container with no network is recreated", () => {
  assert.equal(classify("true", 0, 1, 0), "recreate");
  assert.equal(classify("true", 0, 0, 0), "recreate");
});

test("a running container missing its published ports is recreated", () => {
  assert.equal(classify("true", 1, 1, 0), "recreate");
});

test("an attached container with its ports is left alone", () => {
  assert.equal(classify("true", 1, 1, 1), "ok");
  assert.equal(classify("true", 1, 0, 0), "ok");
});

test("a stopped container is never recreated by the repair pass", () => {
  assert.equal(classify("false", 0, 1, 0), "ok");
});

function classifyManual(...state) {
  return execFileSync("sh", [script, "--classify-manual", ...state.map(String)], { encoding: "utf8" }).trim();
}

test("a hand-started container with no network and no ports is reconnected", () => {
  assert.equal(classifyManual("true", 0, 0), "connect");
});

test("a hand-started container that publishes ports is left for a person, not looped on", () => {
  assert.equal(classifyManual("true", 0, 1), "manual");
});

test("an attached or stopped hand-started container is left alone", () => {
  assert.equal(classifyManual("true", 1, 0), "ok");
  assert.equal(classifyManual("false", 0, 0), "ok");
});

test("the boot unit retries until the stack is healthy and the timer keeps checking", () => {
  assert.match(installer, /^ExecStart=\$LIB\/reattach-detached\.sh --wait \$PROJECT$/m);
  assert.match(installer, /^Restart=on-failure$/m);
  assert.match(installer, /^OnBootSec=2min$/m);
  assert.match(installer, /^OnUnitActiveSec=2min$/m);
  assert.match(installer, /^systemctl enable --now "\$NAME-reattach\.timer"$/m);
});
