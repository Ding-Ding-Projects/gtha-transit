import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const commit =
  process.env.SOURCE_COMMIT ||
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const provenance = {
  schemaVersion: 1,
  version: pkg.version,
  commit,
  builtAt: new Date().toISOString(),
};
writeFileSync(
  'public/version.json',
  JSON.stringify(provenance, null, 2) + '\n',
);
