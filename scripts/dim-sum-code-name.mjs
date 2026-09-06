/**
 * Pick this release's dim sum code name, and the published photo that goes with it.
 *
 * Every build carries a code name beside its version. It is a label, never a
 * replacement: the version number stays the thing a person and a machine identify
 * a build by.
 *
 * Two rules decide everything here. The dish comes from the public catalog at
 * `Ding-Ding-Projects/dim-sum-photos` and is never invented, and it is used once
 * per project — a repeated code name makes two different builds indistinguishable
 * in conversation, which is the one job a code name has.
 *
 * Nothing is written into this repository. The photo is downloaded to a path the
 * caller names so the release can attach it, and the catalog is never copied in
 * as a second authority.
 *
 * Usage:
 *   node scripts/dim-sum-code-name.mjs [--photo <path>] [--repo owner/name] [--json]
 *
 * Exit codes: 0 chose a dish, 3 no dish could be resolved. A release must never
 * be blocked by this, so a caller treats 3 as "ship without a code name" and says
 * so rather than failing the build.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CATALOG = 'https://raw.githubusercontent.com/Ding-Ding-Projects/dim-sum-photos/main/catalog/index.json';
const PHOTO_REPO = 'Ding-Ding-Projects/dim-sum-photos';
const MAX_CANDIDATES = 40;
const TIMEOUT_MS = 60_000;

const argument = (flag, fallback = null) => {
  const at = process.argv.indexOf(flag);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const asJson = process.argv.includes('--json');
const photoPath = argument('--photo');
const repo = argument('--repo', process.env.GITHUB_REPOSITORY || 'Ding-Ding-Projects/gtha-transit');

const fail = (reason) => {
  if (asJson) console.log(JSON.stringify({ chosen: null, reason }));
  else console.error(reason);
  process.exit(3);
};

/** Every code name this project has already used, read from its own releases. */
function usedNames() {
  const result = spawnSync('gh', ['release', 'list', '--repo', repo, '--limit', '400', '--json', 'tagName'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const tags = JSON.parse(result.stdout).map((entry) => entry.tagName);
  const used = new Set();
  // Read the bodies in one call each; the marker line is fixed so it parses exactly.
  for (const tag of tags) {
    const body = spawnSync('gh', ['release', 'view', tag, '--repo', repo, '--json', 'body', '--jq', '.body'], { encoding: 'utf8' });
    if (body.status !== 0) continue;
    const match = /^Code name:\s*(.+?)\s*$/m.exec(body.stdout);
    if (match) used.add(match[1].trim());
  }
  return used;
}

/** The published photo assets, by dish image filename. */
function publishedPhotos() {
  const releases = spawnSync('gh', ['release', 'list', '--repo', PHOTO_REPO, '--limit', '200', '--json', 'tagName'], { encoding: 'utf8' });
  if (releases.status !== 0) return null;
  const tags = JSON.parse(releases.stdout).map((entry) => entry.tagName).filter((tag) => tag.startsWith('catalog-v1'));
  const byFile = new Map();
  for (const tag of tags) {
    const view = spawnSync('gh', ['release', 'view', tag, '--repo', PHOTO_REPO, '--json', 'assets', '--jq', '.assets[].name'], { encoding: 'utf8' });
    if (view.status !== 0) continue;
    for (const name of view.stdout.split('\n').map((line) => line.trim()).filter(Boolean)) {
      if (!byFile.has(name)) byFile.set(name, tag);
    }
  }
  return byFile;
}

const catalogResponse = await fetch(CATALOG, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null);
if (!catalogResponse?.ok) fail('The public dim sum catalog could not be read.');
const catalog = await catalogResponse.json().catch(() => null);
const dishes = catalog?.dishes;
if (!Array.isArray(dishes) || !dishes.length) fail('The public catalog carried no dishes.');

const used = usedNames();
if (used === null) fail('This project\'s own releases could not be read, so a repeat cannot be ruled out.');
const photos = publishedPhotos();
if (photos === null || !photos.size) fail('No published catalog photo assets could be listed.');

const codeNameOf = (dish) => `${dish?.name?.en ?? ''} · ${dish?.name?.zhHant ?? ''}`.trim();

// Walk the catalog in its published order and take the first dish that has never
// been used here and whose photo is actually published.
let chosen = null;
let considered = 0;
for (const dish of dishes) {
  considered += 1;
  const name = codeNameOf(dish);
  if (!name || name === '·' || used.has(name)) continue;
  const file = String(dish?.image?.path ?? '').split('/').pop();
  if (!file) continue;
  const tag = photos.get(file);
  if (!tag) continue;
  chosen = { id: dish.id, slug: dish.slug, name, en: dish.name.en, zhHant: dish.name.zhHant, file, tag, alt: dish?.image?.alt?.en ?? name };
  break;
}
if (!chosen) fail(`No unused dish with a published photo was found after ${considered} candidates.`);

chosen.photoUrl = `https://github.com/${PHOTO_REPO}/releases/download/${chosen.tag}/${encodeURIComponent(chosen.file)}`;

if (photoPath) {
  const image = await fetch(chosen.photoUrl, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' }).catch(() => null);
  if (!image?.ok) fail('The chosen photo could not be downloaded.');
  const bytes = Buffer.from(await image.arrayBuffer());
  // A PNG and nothing else: the catalog publishes PNG, and a file that does not
  // decode as one must not be attached to a release as a photo.
  const png = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!png) fail('The downloaded photo is not a PNG.');
  writeFileSync(photoPath, bytes);
  chosen.photoPath = photoPath;
  chosen.photoBytes = bytes.length;
}

if (asJson) {
  console.log(JSON.stringify(chosen, null, 2));
} else {
  console.log(`Code name: ${chosen.name}`);
  console.log(`Photo: ${chosen.photoUrl}`);
  console.log(`Alt: ${chosen.alt}`);
  if (chosen.photoPath) console.log(`Saved: ${chosen.photoPath} (${chosen.photoBytes} bytes)`);
}
