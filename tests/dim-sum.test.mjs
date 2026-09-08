import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DIM_SUM_CHANCE,
  DIM_SUM_DIRECTORY,
  DIM_SUM_MANIFEST,
  DIM_SUM_MS,
  chooseDish,
  dishImage,
  dishName,
  drawsSurprise,
  momentIsRight,
  parseManifest,
} from '../lib/dim-sum.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = (...parts) => readFileSync(path.join(root, ...parts), 'utf8');

const dish = (overrides = {}) => ({
  id: 'hk-dish-0001', slug: 'classic-har-gow', en: 'Classic Har Gow', zhHant: '蝦餃',
  alt: 'Warm tea-house photograph of Classic Har Gow', file: 'classic-har-gow.webp',
  bytes: 20686, sha256: 'a'.repeat(64), ...overrides,
});
const manifest = (dishes) => ({ schemaVersion: 1, dishes });

test('the chance is one in ten, exactly, and never more often than stated', () => {
  assert.equal(DIM_SUM_CHANCE, 0.1);
  assert.equal(drawsSurprise(0), true, 'the very bottom of the range draws');
  assert.equal(drawsSurprise(0.0999999), true);
  assert.equal(drawsSurprise(0.1), false, 'and the boundary itself does not, or it would be more than a tenth');
  assert.equal(drawsSurprise(0.5), false);
  assert.equal(drawsSurprise(0.999), false);
});

test('a value that is not a number draws nothing', () => {
  for (const junk of [Number.NaN, -0.5, 1, 2, undefined, null, 'yes']) {
    assert.equal(drawsSurprise(junk), false, `${String(junk)} must not draw`);
  }
});

test('a dish is chosen from the vendored set, and every one of them is reachable', () => {
  const dishes = [dish({ slug: 'a' }), dish({ slug: 'b' }), dish({ slug: 'c' }), dish({ slug: 'd' })];
  assert.equal(chooseDish(manifest(dishes), 0).slug, 'a');
  assert.equal(chooseDish(manifest(dishes), 0.26).slug, 'b');
  assert.equal(chooseDish(manifest(dishes), 0.51).slug, 'c');
  assert.equal(chooseDish(manifest(dishes), 0.99).slug, 'd', 'the last dish is not unreachable');
});

test('nothing vendored is nothing shown, rather than a placeholder', () => {
  // A dish with a missing picture is not a smaller surprise, it is a broken one.
  assert.equal(chooseDish(null, 0.5), null);
  assert.equal(chooseDish(manifest([]), 0.5), null);
  assert.equal(chooseDish(manifest(null), 0.5), null);
  assert.equal(chooseDish(manifest([dish()]), Number.NaN), null);
  assert.equal(chooseDish(manifest([dish()]), 1), null);
});

test('the dish name is its own, in both languages', () => {
  assert.equal(dishName(dish()), 'Classic Har Gow · 蝦餃');
  const source = readFileSync(path.join(root, 'components', 'dim-sum.tsx'), 'utf8');
  assert.match(source, /it is a name, not copy/, 'the name is never put through the playfulness levels');
  assert.match(source, /lang="zh-Hant"/, 'and the Chinese half is marked as such for a screen reader');
});

test('a manifest is read only when every dish carries what a surprise needs', () => {
  const good = parseManifest(manifest([dish()]));
  assert.equal(good.dishes.length, 1);

  // A picture with no alt text is a delight that skips the people using a screen
  // reader, which is the opposite of the point.
  assert.equal(parseManifest(manifest([dish({ alt: '' })])), null);
  assert.equal(parseManifest(manifest([dish({ en: '' })])), null);
  assert.equal(parseManifest(manifest([dish({ zhHant: '' })])), null, 'both names, or it is not this dish');
  assert.equal(parseManifest(manifest([dish({ file: '' })])), null);
});

test('a file name that is a path is refused, because it could leave the directory', () => {
  assert.equal(parseManifest(manifest([dish({ file: '../../etc/passwd' })])), null);
  assert.equal(parseManifest(manifest([dish({ file: 'nested/photo.webp' })])), null);
  assert.equal(parseManifest(manifest([dish({ file: 'a\\b.webp' })])), null);
});

test('an unreadable manifest leaves the surprise unavailable rather than half loaded', () => {
  for (const junk of [null, undefined, 'text', 42, [], {}, { schemaVersion: 2, dishes: [dish()] }, { schemaVersion: 1, dishes: 'nope' }]) {
    assert.equal(parseManifest(junk), null, `${JSON.stringify(junk)} must not produce a manifest`);
  }
});

test('a readable manifest keeps only the dishes that are usable', () => {
  const mixed = parseManifest(manifest([dish({ slug: 'good' }), dish({ slug: 'bad', alt: '' }), dish({ slug: 'also-good' })]));
  assert.deepEqual(mixed.dishes.map((item) => item.slug), ['good', 'also-good']);
});

test('the image is served from this origin', () => {
  assert.equal(dishImage(dish()), '/dim-sum/classic-har-gow.webp');
  assert.ok(DIM_SUM_MANIFEST.startsWith('/'), 'a same-origin path, not somebody else server');
  assert.ok(DIM_SUM_DIRECTORY.startsWith('/'));
  const component = readFileSync(path.join(root, 'components', 'dim-sum.tsx'), 'utf8');
  assert.ok(!/https?:\/\//.test(component), 'nothing here reaches a third party at run time');
});

test('there are moments when a surprise would be an interruption', () => {
  assert.equal(momentIsRight({}), true);
  assert.equal(momentIsRight({ firstRun: true }), false);
  assert.equal(momentIsRight({ error: true }), false);
  assert.equal(momentIsRight({ busy: true }), false);
  assert.equal(momentIsRight({ suppressed: true }), false);
});

/* ---------------------------------------------------------------- no opt-out -- */

test('there is no setting for this anywhere, which is what makes it a surprise', () => {
  /*
   * The contract is explicit that it cannot be opted out of. What makes an
   * un-optable surprise polite is everything around it: it costs nothing, gates
   * nothing, and goes away on its own.
   */
  for (const file of [['lib', 'dim-sum.ts'], ['components', 'dim-sum.tsx']]) {
    const text = source(...file);
    assert.ok(!/localStorage|useLocalSetting|setValue\(/.test(text), `${file.join('/')} stores a preference`);
  }
  const catalog = source('lib', 'settings-catalog.ts');
  assert.ok(!/dim.?sum/i.test(catalog), 'and it is not a settings row');
});

test('nine launches in ten cost nothing at all', () => {
  // The draw happens before anything is fetched: no request, no manifest, no image.
  const component = source('components', 'dim-sum.tsx');
  const drawAt = component.indexOf('drawsSurprise(Math.random())');
  const fetchAt = component.indexOf('fetch(DIM_SUM_MANIFEST');
  assert.ok(drawAt > 0 && fetchAt > drawAt, 'the fetch must come after the draw, or every launch pays for it');
  assert.match(component, /if \(!drawsSurprise\(Math\.random\(\)\)\) return;/);
});

test('it is drawn once per launch', () => {
  const component = source('components', 'dim-sum.tsx');
  assert.match(component, /if \(drawn\.current\) return;/);
  assert.match(component, /drawn\.current = true;/);
});

test('it blocks nothing, takes no focus, and is not a dialog', () => {
  const component = source('components', 'dim-sum.tsx');
  assert.match(component, /<aside className="dim-sum"/, 'an aside, not a dialog');
  assert.ok(!/showModal|role="dialog"|role="alert"|aria-live|autoFocus|\.focus\(\)/.test(component),
    'nothing here interrupts or takes focus');
  const css = source('app', 'dim-sum.css');
  assert.ok(!/::backdrop/.test(css), 'no backdrop, because there is nothing to dismiss before continuing');
  assert.match(css, /position: fixed/);
});

test('it dismisses itself, and can be dismissed', () => {
  assert.ok(DIM_SUM_MS >= 5000 && DIM_SUM_MS <= 15000, 'long enough to read, short enough not to linger');
  const component = source('components', 'dim-sum.tsx');
  assert.match(component, /setTimeout\(\(\) => setGone\(true\), DIM_SUM_MS\)/);
  assert.match(component, /className="dim-sum__close"/);
});

test('low stimulation hides it, because an unrequested picture is more, not less', () => {
  assert.match(source('app', 'dim-sum.css'), /\.shell\.adhd-low-stimulation \.dim-sum \{ display: none; \}/);
  assert.match(source('app', 'page.tsx'), /suppressed=\{isOn\(adhd, 'lowStimulation'\) \|\| suppresses\(school, 'dim-sum'\)\}/);
});

test('the shell never surprises somebody mid-task', () => {
  const page = source('app', 'page.tsx');
  assert.match(page, /<DimSum t=\{t\} error=\{Boolean\(error\)\} busy=\{loading\}/);
});

/* ---------------------------------------------------------------- vendoring -- */

test('the photos are fetched and never committed', () => {
  /*
   * Consumer repositories are forbidden from vendoring copies of the public
   * catalog, so everything the script writes lands in an ignored directory.
   */
  const ignore = source('.gitignore');
  assert.match(ignore, /^\/public\/dim-sum\/$/m);
  const script = source('scripts', 'vendor-dim-sum.mjs');
  assert.match(script, /never committed/);
  assert.match(script, /Ding-Ding-Projects\/dim-sum-photos/, 'the public catalog is the only source');
  assert.ok(!/imagegen|generate|create an image/i.test(script), 'no photo is ever generated here');
});

test('the vendoring is not part of the build, so the build works with the network unplugged', () => {
  const build = source('scripts', 'build.mjs');
  assert.ok(!/dim-sum/.test(build));
  const packageJson = JSON.parse(source('package.json'));
  for (const [name, command] of Object.entries(packageJson.scripts)) {
    assert.ok(!/vendor-dim-sum/.test(command), `${name} would make the build reach somebody else server`);
  }
});

test('a failed refresh keeps whatever was vendored before', () => {
  const script = source('scripts', 'vendor-dim-sum.mjs');
  assert.match(script, /previousSetRetained/);
  assert.match(script, /left exactly as it is/);
});

test('the downscale is stated rather than implied away', () => {
  // A loss that is not stated is a claim about fidelity this does not have.
  const script = source('scripts', 'vendor-dim-sum.mjs');
  assert.match(script, /Downscaled and re-encoded from the published native-lossless PNG/);
  assert.match(script, /const WIDTH = 480;/);
});

test('sharp is declared, not borrowed from the tree', () => {
  // It was present as a transitive dependency, which is the shape that works
  // locally and disappears on a clean install somewhere else.
  const packageJson = JSON.parse(source('package.json'));
  const declared = { ...packageJson.dependencies, ...packageJson.devDependencies };
  assert.ok('sharp' in declared, 'the vendoring script imports it directly');
});

test('a photo is served as an image, not as an unnamed blob', () => {
  /*
   * They went out as application/octet-stream until the deployed site was
   * checked. A browser sniffs past that for an <img>, which is why nothing looked
   * wrong, but it is wrong everywhere else -- a save dialog, a fetch, a proxy
   * deciding what to compress -- and the whole point of serving them from this
   * origin was to be the one telling the truth about them.
   */
  const server = source('server', 'web.mjs');
  assert.match(server, /^\s*'\.webp': 'image\/webp',$/m);
});
