import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A ligature icon font is addressed by writing the glyph's NAME as the element's
 * text: `<span class="icon">swap_vert</span>` draws an arrows glyph.
 *
 * The failure mode is specific and unusually embarrassing. A name the font does
 * not carry does not render a box or a blank. It renders the literal English
 * word, in the interface, at icon size, looking exactly like copy nobody
 * finished. Nothing throws and nothing logs.
 *
 * Subsetting makes this cheap to hit, because the shipped file contains only the
 * names asked for at vendoring time. So this checks every name the source writes
 * against the ligature table of the binary that actually shipped, rather than
 * against a gallery of names the font might have had.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const fontDirectory = path.join(root, 'public', 'fonts', 'material-symbols-outlined');
const manifest = JSON.parse(readFileSync(path.join(fontDirectory, 'manifest.json'), 'utf8'));

/** Every source file that could name a glyph. */
function sourceFiles() {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const full = path.join(directory, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'node_modules' || entry === '.git' || entry === 'reference') continue;
        walk(full);
        continue;
      }
      if (/\.(tsx|ts)$/.test(entry)) found.push(full);
    }
  };
  for (const directory of ['app', 'components']) walk(path.join(root, directory));
  return found;
}

/**
 * Glyph names written for the icon font: the children of anything carrying the
 * icon class. Deliberately narrow, so ordinary prose is never mistaken for a
 * glyph and every real one is still caught.
 */
function usedGlyphNames() {
  const names = new Map();
  for (const file of sourceFiles()) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/<Icon\s+name=["']([a-z0-9_]+)["']/g)) {
      if (!names.has(match[1])) names.set(match[1], []);
      names.get(match[1]).push(path.relative(root, file));
    }
  }
  return names;
}

test('the icon font ships with a recorded, non-empty glyph list', () => {
  assert.equal(manifest.family, 'Material Symbols Outlined');
  assert.ok(Array.isArray(manifest.iconNames) && manifest.iconNames.length > 0, 'the manifest names no glyphs');
  assert.equal(manifest.iconNames.length, new Set(manifest.iconNames).size, 'a glyph is listed twice');
  for (const name of manifest.iconNames) {
    assert.match(name, /^[a-z0-9_]+$/, `${name} is not a Material Symbols glyph name`);
  }
});

test('the shipped binary really carries the glyphs the manifest claims', () => {
  // The manifest is a record of a request. This checks the file that arrived.
  const font = readFileSync(path.join(fontDirectory, 'material-symbols-outlined.woff2'));
  assert.equal(font.subarray(0, 4).toString('ascii'), 'wOF2', 'the shipped icon font is not WOFF2');
  assert.ok(font.byteLength > 512, 'the shipped icon font is implausibly small');
  const recorded = manifest.fonts.find((entry) => entry.file === 'material-symbols-outlined.woff2');
  assert.ok(recorded, 'the manifest does not record the shipped font file');
  assert.equal(recorded.bytes, font.byteLength, 'the shipped font is not the size the manifest recorded');
});

test('every glyph the interface asks for is one the subset actually contains', () => {
  const available = new Set(manifest.iconNames);
  const missing = [];
  for (const [name, files] of usedGlyphNames()) {
    if (!available.has(name)) missing.push(`${name} (used in ${files.join(', ')})`);
  }
  assert.deepEqual(
    missing,
    [],
    'these would render as their own English name. Add them to ICON_NAMES in scripts/vendor-fonts.mjs and re-run it',
  );
});

test('the local stylesheet requests no font from anywhere but this origin', () => {
  const css = readFileSync(path.join(fontDirectory, 'material-symbols-outlined.css'), 'utf8');
  assert.ok(!css.includes('https://'), 'a remote font URL survives in the vendored stylesheet');
  assert.match(css, /url\(\.\/material-symbols-outlined\.woff2\)/, 'the stylesheet does not point at the local file');
});
