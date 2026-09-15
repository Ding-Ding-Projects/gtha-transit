import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const deploy = readFileSync(new URL("../scripts/deploy.sh", import.meta.url), "utf8");

// A deploy shell that does not set TTC_MATCHER_URL once wrote it to .env as
// empty. The running API still had the value, so nothing looked wrong until
// compose recreated the API (the boot unit does) and the matcher statistics
// silently disappeared.

test("the deploy never writes the matcher URL straight from an unset shell variable", () => {
  assert.doesNotMatch(deploy, /^TTC_MATCHER_URL=\$\{TTC_MATCHER_URL:-\}$/m);
  assert.doesNotMatch(deploy, /TTC_MATCHER_URL=\$\{TTC_MATCHER_URL:-\} \\$/m);
});

test("an unset matcher URL falls back to the value the running routing API uses", () => {
  assert.match(deploy, /^\s+matcher='\$\{TTC_MATCHER_URL:-\}'$/m);
  assert.match(deploy, /matcher=\\\$\(docker inspect -f '\{\{range \.Config\.Env\}\}\{\{println \.\}\}\{\{end\}\}' gtha-transit-api 2>\/dev\/null \| sed -n 's\/\^TTC_MATCHER_URL=\/\/p'\)/);
});

test("both the compose run and the recorded .env use the resolved value", () => {
  assert.match(deploy, /TTC_MATCHER_URL=\\"\\\$matcher\\" \\$/m);
  assert.match(deploy, /^TTC_MATCHER_URL=\\\$matcher$/m);
});
