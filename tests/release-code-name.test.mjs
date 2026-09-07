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
function buildNotes(dish, image) {
  const workspace = mkdtempSync(path.join(tmpdir(), 'notes-'));
  const started = path.join(workspace, 'workflow-started');
  writeFileSync(started, '2026-09-06T20:00:00Z\n');
  mkdirSync(path.join(workspace, 'dist'));
  writeFileSync(path.join(workspace, 'dist', 'line-counts.md'), '| Category | Total lines |\n|---|---:|\n| Source | 1 |\n');
  if (dish) writeFileSync(path.join(workspace, 'dist', 'dim-sum.json'), JSON.stringify(dish));
  if (image) writeFileSync(path.join(workspace, 'dist', 'image.json'), JSON.stringify(image));
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

/**
 * The container image.
 *
 * The workflow builds it from the same commit the release is cut from, so a host
 * deploys by pulling rather than by rebuilding a source tarball. The digest goes
 * into the notes because a tag can be moved later and a digest cannot.
 *
 * Only the web service is published. The routing API needs generated stop, route
 * and pattern indexes that this repository carries as placeholders, so a runner
 * cannot build a working one, and claiming otherwise would ship an image that
 * starts and answers nothing.
 */

const IMAGE = {
  image: 'ghcr.io/ding-ding-projects/gtha-transit-web',
  tag: 'v0.1.0-test.1',
  digest: 'ghcr.io/ding-ding-projects/gtha-transit-web@sha256:' + 'a'.repeat(64),
};

test('a published image reaches the notes with its digest and a pull command', () => {
  const notes = buildNotes(null, IMAGE);
  assert.match(notes, /^## Container image$/m);
  assert.ok(notes.includes(`docker pull ${IMAGE.image}:${IMAGE.tag}`), 'the pull command names image and tag');
  // Labelled as a digest, not merely present: a reader has to know that this
  // string is the one thing about the image that cannot be moved later.
  assert.ok(notes.includes('Digest: `' + IMAGE.digest + '`'), 'the digest must be labelled as one');
  assert.match(notes, /routing API needs generated stop, route and pattern indexes/);
});

test('no image built means no image section invented', () => {
  const notes = buildNotes(null, null);
  assert.ok(!notes.includes('## Container image'), 'nothing is claimed about an image that was not built');
  assert.match(notes, /^# GTHA Transit v0\.1\.0-test\.1$/m);
});

test('a half-written image record is not treated as a published image', () => {
  assert.ok(!buildNotes(null, { image: IMAGE.image }).includes('## Container image'));
  assert.ok(!buildNotes(null, { digest: IMAGE.digest }).includes('## Container image'));
});

test('the image is built for both architectures, and the manifest is proved', () => {
  // The runner is amd64 and the deploy host is arm64. A single-architecture image
  // pulls without complaint and then crash-loops, which is a worse failure than
  // publishing none - so the build covers both and the published manifest is
  // checked rather than assumed.
  assert.match(workflow, /--platform linux\/amd64,linux\/arm64/);
  assert.match(workflow, /docker\/setup-qemu-action@v3/);
  assert.match(workflow, /docker\/setup-buildx-action@v3/);
  assert.match(workflow, /buildx imagetools inspect/);
  assert.match(workflow, /grep -q 'linux\/amd64' dist\/platforms\.txt/);
  assert.match(workflow, /grep -q 'linux\/arm64' dist\/platforms\.txt/);
  // The digest comes from the build's own metadata, not from a local image that
  // a multi-platform build never leaves behind.
  assert.match(workflow, /--metadata-file dist\/buildx\.json/);
  assert.match(workflow, /containerimage\.digest/);
  assert.ok(!/docker inspect --format '\{\{index \.RepoDigests/.test(workflow), 'a multi-platform build leaves no local image to inspect');
});

test('the workflow builds the image before the release, and pushes by digest-bearing tags', () => {
  assert.ok(
    workflow.indexOf('Build and publish the web container image') < workflow.indexOf('Publish unique release'),
    'the image must be built first so its digest can go into the notes',
  );
  assert.match(workflow, /packages: write/);
  assert.match(workflow, /ghcr\.io\/\$OWNER\/gtha-transit-web/);
  assert.match(workflow, /docker buildx build .*--build-arg SOURCE_COMMIT="\$GITHUB_SHA"/);
  assert.match(workflow, /--push \./);
  assert.match(workflow, /containerimage\.digest/);
  // The credential goes in on stdin, never in an argument.
  assert.match(workflow, /printf '%s' "\$GH_TOKEN" \| docker login ghcr\.io/);
  assert.ok(!/--password [^-]/.test(workflow), 'a credential must never be a command argument');
});

test('the routing API image is not claimed to be buildable by the runner', () => {
  assert.ok(!/gtha-transit-api/.test(workflow), 'the workflow must not publish an API image it cannot build');
});
