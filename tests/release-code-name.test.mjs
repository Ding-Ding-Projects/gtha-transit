import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every release carries a dim sum code name beside its version.
 *
 * It is a label and never a replacement: the version number stays the thing a
 * person and a machine identify a build by. And it must never block a release,
 * so when no unused dish with a published photo can be resolved, the notes carry
 * the version alone and the workflow says so rather than failing.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const notesScript = path.join(root, 'scripts', 'release-notes.mjs');
const workflow = readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');

/** Run the notes builder in its own directory, with or without a chosen dish. */
function buildNotes(dish) {
  const workspace = mkdtempSync(path.join(tmpdir(), 'notes-'));
  const started = path.join(workspace, 'workflow-started');
  writeFileSync(started, '2026-09-06T20:00:00Z\n');
  mkdirSync(path.join(workspace, 'dist'));
  writeFileSync(path.join(workspace, 'dist', 'line-counts.md'), '| Category | Total lines |\n|---|---:|\n| Source | 1 |\n');
  if (dish) writeFileSync(path.join(workspace, 'dist', 'dim-sum.json'), JSON.stringify(dish));
  // The builder reads an absolute /tmp path in CI; point it at this workspace.
  const source = readFileSync(notesScript, 'utf8').replace("'/tmp/workflow-started'", JSON.stringify(started));
  const script = path.join(workspace, 'release-notes.mjs');
  writeFileSync(script, source);
  execFileSync(process.execPath, [script], {
    cwd: workspace,
    env: { ...process.env, TAG: 'v0.1.0-test.1', GITHUB_SHA: 'a'.repeat(40) },
  });
  const notes = readFileSync(path.join(workspace, 'dist', 'release-notes.md'), 'utf8');
  rmSync(workspace, { recursive: true, force: true });
  return notes;
}

const DISH = {
  id: 'hk-dish-0001',
  name: 'Classic Har Gow · 蝦餃',
  file: 'hk-dish-0001-classic-har-gow.png',
  alt: 'Warm tea-house photograph of Classic Har Gow',
  photoUrl: 'https://github.com/Ding-Ding-Projects/dim-sum-photos/releases/download/catalog-v1/hk-dish-0001-classic-har-gow.png',
};

test('a resolved dish becomes a code name beside the version, with its photo link', () => {
  const notes = buildNotes(DISH);
  assert.match(notes, /^Code name: Classic Har Gow · 蝦餃$/m);
  assert.ok(notes.includes(DISH.photoUrl), 'the published photo URL must appear');
  assert.ok(notes.includes(DISH.alt), 'the alt text reaches the reader too');
  assert.ok(notes.includes(DISH.file), 'the attached asset is named');
  // The version is still the identity, and the code name never replaces it.
  assert.match(notes, /^# GTHA Transit v0\.1\.0-test\.1$/m);
  assert.ok(notes.indexOf('# GTHA Transit') < notes.indexOf('Code name:'), 'the version comes first');
});

test('no resolved dish ships the version alone rather than failing', () => {
  const notes = buildNotes(null);
  assert.ok(!notes.includes('Code name:'), 'no code name is invented');
  assert.match(notes, /^# GTHA Transit v0\.1\.0-test\.1$/m);
  assert.ok(notes.includes('| Category | Total lines |'), 'the rest of the notes are unaffected');
});

test('a half-formed record is not treated as a dish', () => {
  assert.ok(!buildNotes({ name: 'No photo published' }).includes('Code name:'));
  assert.ok(!buildNotes({ photoUrl: 'https://example.invalid/x.png' }).includes('Code name:'));
});

test('the workflow attaches the photo and never fails the release over a code name', () => {
  assert.match(workflow, /node scripts\/dim-sum-code-name\.mjs --json --photo dist\/dim-sum\.png/);
  // The picker runs inside an if, so its non-zero exit cannot fail the step.
  assert.match(workflow, /if node scripts\/dim-sum-code-name\.mjs/);
  assert.match(workflow, /::warning::No unused dim sum code name/);
  // The chosen photo joins the release assets under its catalog filename.
  assert.match(workflow, /ASSETS="\$ASSETS dist\/\$PHOTO_FILE"/);
  assert.match(workflow, /gh release create "\$TAG" \$ASSETS/);
});
