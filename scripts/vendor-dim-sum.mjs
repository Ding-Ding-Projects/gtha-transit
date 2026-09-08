/**
 * Bring a small set of dim sum photos in from the public catalog, downscaled.
 *
 * The photos are not this project's to keep. They live in the public
 * Ding-Ding-Projects/dim-sum-photos catalog, and consumer repositories are
 * forbidden from vendoring copies of them, so everything this writes lands in a
 * gitignored directory and is fetched again rather than committed.
 *
 * They are also not servable as published. Each one is a native-lossless PNG of
 * about 2.4 MB, which is a fine archival image and an absurd thing to put in
 * front of somebody opening a transit planner. They are re-encoded to 480px WebP
 * at around 24 KB, and the article says so, because a downscale is a loss and a
 * loss that is not stated is a claim about fidelity this does not have.
 *
 * Not part of `npm run build`. The build must work with the network unplugged,
 * and a build step that reaches somebody else's server is a build that fails on
 * an aeroplane. Run this when the photos are wanted; the surprise reports itself
 * unavailable until they are there, which is honest rather than broken.
 *
 * Usage: node scripts/vendor-dim-sum.mjs [--count 24] [--json]
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const OUT = path.join(root, 'public', 'dim-sum');

const REPO = 'Ding-Ding-Projects/dim-sum-photos';
const CATALOG = `https://raw.githubusercontent.com/${REPO}/main/catalog/index.json`;
const RELEASES = `https://api.github.com/repos/${REPO}/releases?per_page=100`;
const AGENT = 'gtha-transit dim sum vendoring (https://toronto-transit.org)';
const TIMEOUT = 60_000;

/** The served size. Big enough to look like a photograph, small enough to be free. */
const WIDTH = 480;
const QUALITY = 70;

const argument = (flag, fallback) => {
  const at = process.argv.indexOf(flag);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const COUNT = Math.max(1, Math.min(60, Number(argument('--count', '24'))));
const asJson = process.argv.includes('--json');

const say = (message) => { if (!asJson) console.log(message); };

/**
 * Give up without breaking anything.
 *
 * Whatever was vendored before is left exactly as it is: a refresh that fails
 * must not take the working set with it.
 */
function giveUp(reason) {
  const kept = existsSync(path.join(OUT, 'manifest.json'));
  const result = { ok: false, reason, previousSetRetained: kept };
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else {
    console.error(`dim sum photos not vendored: ${reason}`);
    console.error(kept ? 'The previously vendored set is untouched.' : 'Nothing is vendored, so the surprise stays unavailable.');
  }
  process.exit(1);
}

async function readJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) }).catch(() => null);
  if (!response?.ok) return null;
  return response.json().catch(() => null);
}

/** The tags that carry catalog photos, discovered rather than assumed. */
async function catalogTags() {
  const releases = await readJson(RELEASES);
  if (!Array.isArray(releases)) return null;
  return releases.map((release) => release?.tag_name).filter((tag) => typeof tag === 'string' && tag.startsWith('catalog-v1'));
}

async function main() {
  const catalog = await readJson(CATALOG);
  const dishes = catalog?.dishes;
  if (!Array.isArray(dishes) || !dishes.length) giveUp('the public catalog could not be read, or carried no dishes');

  const tags = await catalogTags();
  if (!tags?.length) giveUp('no catalog photo releases could be listed');
  say(`catalog: ${dishes.length} dishes, photos across ${tags.length} releases`);

  /*
   * Walk the catalog in its published order and take the first dishes that carry
   * everything a surprise needs: both names, a file, and alt text. Deterministic,
   * so a second run vendors the same set rather than churning the directory.
   */
  const wanted = [];
  for (const dish of dishes) {
    if (wanted.length >= COUNT) break;
    const en = dish?.name?.en;
    const zhHant = dish?.name?.zhHant;
    const file = String(dish?.image?.path ?? '').split('/').pop();
    const alt = dish?.image?.alt?.en;
    if (!en || !zhHant || !file || !alt) continue;
    wanted.push({ id: dish.id, slug: dish.slug, en, zhHant, file, alt });
  }
  if (!wanted.length) giveUp('no dish in the catalog carried both names, a photo and alt text');

  mkdirSync(OUT, { recursive: true });
  const entries = [];
  for (const dish of wanted) {
    let bytes = null;
    let from = null;
    for (const tag of tags) {
      const url = `https://github.com/${REPO}/releases/download/${tag}/${encodeURIComponent(dish.file)}`;
      const response = await fetch(url, { headers: { 'user-agent': AGENT }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) }).catch(() => null);
      if (!response?.ok) continue;
      bytes = Buffer.from(await response.arrayBuffer());
      from = { tag, url };
      break;
    }
    if (!bytes) { say(`  skipped ${dish.slug}: no published photo`); continue; }

    // Decode before trusting it. A 200 that is not an image is a file that would
    // render as a broken picture in front of somebody, which is worse than none.
    let resized;
    try {
      const source = sharp(bytes);
      const meta = await source.metadata();
      if (!meta.width || !meta.height) throw new Error('no dimensions');
      resized = await source.resize(WIDTH, WIDTH, { fit: 'cover' }).webp({ quality: QUALITY }).toBuffer();
    } catch (error) {
      say(`  skipped ${dish.slug}: ${error.message}`);
      continue;
    }

    const name = `${dish.slug}.webp`;
    writeFileSync(path.join(OUT, name), resized);
    entries.push({
      id: dish.id,
      slug: dish.slug,
      en: dish.en,
      zhHant: dish.zhHant,
      alt: dish.alt,
      file: name,
      bytes: resized.length,
      sha256: createHash('sha256').update(resized).digest('hex'),
      source: from.url,
    });
    say(`  ${dish.slug}: ${(resized.length / 1024).toFixed(0)} KB`);
  }

  if (!entries.length) giveUp('no photo could be fetched and decoded');

  // Anything from an earlier, larger run that is not in this set goes, so the
  // directory is the manifest rather than an accumulation of both.
  const keep = new Set([...entries.map((entry) => entry.file), 'manifest.json']);
  for (const existing of readdirSync(OUT)) {
    if (!keep.has(existing)) rmSync(path.join(OUT, existing), { force: true });
  }

  const manifest = {
    schemaVersion: 1,
    source: {
      repository: `https://github.com/${REPO}`,
      catalog: CATALOG,
      retrievedAt: new Date().toISOString(),
      tags,
    },
    /* Said here as well as in the article: these are not the published images. */
    transform: { width: WIDTH, height: WIDTH, format: 'webp', quality: QUALITY, note: 'Downscaled and re-encoded from the published native-lossless PNG.' },
    dishes: entries,
  };
  writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  if (asJson) console.log(JSON.stringify({ ok: true, dishes: entries.length, bytes: total }, null, 2));
  else console.log(`\n${entries.length} dishes vendored, ${(total / 1024).toFixed(0)} KB in total, into public/dim-sum/ (never committed).`);
}

await main();
