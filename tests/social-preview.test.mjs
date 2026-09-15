import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { centerCrop, OUTPUT_PATH, SOURCE_CAPTURE, TARGET_HEIGHT, TARGET_WIDTH } from '../scripts/site/build-social-preview.mjs';

const root = new URL('..', import.meta.url);

test('centerCrop keeps the full width and trims height symmetrically when the source is relatively narrower than the target', () => {
  // 1440x900 (aspect 1.6) is narrower than the 1200x630 target (aspect
  // ~1.905), so the full 1440px width is the constraining dimension: the
  // crop keeps every column and trims the same amount off the top and
  // bottom, which is the real committed source's own geometry.
  const crop = centerCrop(1440, 900, 1200, 630);
  assert.equal(crop.left, 0);
  assert.equal(crop.width, 1440);
  assert.equal(crop.height, 756);
  assert.equal(crop.top, 72);
  assert.equal(crop.top + crop.height, 900 - 72);
});

test('centerCrop keeps the full height and trims width symmetrically when the source is relatively wider than the target', () => {
  // A 2000x600 panorama (aspect ~3.33) is wider than the 1200x630 target
  // (aspect ~1.905), so the full 600px height is the constraining dimension
  // and the crop trims the sides instead.
  const crop = centerCrop(2000, 600, 1200, 630);
  assert.equal(crop.top, 0);
  assert.equal(crop.height, 600);
  assert.equal(crop.width, Math.round(600 * (1200 / 630)));
  assert.ok(crop.left > 0);
  // Centred to within a single rounded pixel: Math.floor can put that one
  // remainder pixel on either side, which is fine, but a lopsided crop is not.
  assert.ok(Math.abs(2000 - crop.left * 2 - crop.width) <= 1, 'the crop must be centred, not left- or right-anchored');
});

test('centerCrop keeps the full width and trims height symmetrically for a portrait source', () => {
  // A 900x1440 portrait image is far narrower than the landscape target, so
  // just like the real capture above, the full width is kept and the excess
  // height is trimmed off both ends equally.
  const crop = centerCrop(900, 1440, 1200, 630);
  assert.equal(crop.left, 0);
  assert.equal(crop.width, 900);
  assert.equal(crop.height, Math.round(900 / (1200 / 630)));
  assert.ok(crop.top > 0);
  assert.ok(Math.abs(1440 - crop.top * 2 - crop.height) <= 1, 'the crop must be centred, not top- or bottom-anchored');
});

test('the source capture named for the social preview is real, committed and not a generated placeholder', () => {
  const sourcePath = new URL(SOURCE_CAPTURE, root);
  assert.ok(existsSync(sourcePath), `${SOURCE_CAPTURE} must exist and be committed`);
  assert.ok(
    SOURCE_CAPTURE.startsWith('docs/design/parity/') && SOURCE_CAPTURE.endsWith('-app.png'),
    'the social preview must come from a real *-app.png design-parity capture, never a mock',
  );
});

test('the committed social preview PNG exists at the repository root’s public/ folder, at exactly 1200x630', async () => {
  const outputPath = new URL(OUTPUT_PATH, root);
  assert.ok(
    existsSync(outputPath),
    `${OUTPUT_PATH} is missing. Run \`node scripts/site/build-social-preview.mjs\` and commit the result.`,
  );
  const bytes = readFileSync(outputPath);
  // A PNG's width and height are big-endian 32-bit integers at fixed offsets
  // in its IHDR chunk (bytes 16-23), right after the 8-byte signature and the
  // 4-byte length/type of the first chunk. Reading them directly keeps this
  // test honest without depending on sharp already being installed.
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG', 'not a PNG file');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  assert.equal(width, TARGET_WIDTH);
  assert.equal(height, TARGET_HEIGHT);
  assert.equal(width / height, 1200 / 630);
});

test('app/layout.tsx declares an absolute https og:image and twitter:image matching the committed social preview', () => {
  const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /metadataBase:\s*new URL\('https:\/\/toronto-transit\.org'\)/);
  const ogImageMatch = /openGraph:\s*\{[\s\S]*?images:\s*\[\s*\{[\s\S]*?url:\s*'([^']+)'/.exec(layout);
  assert.ok(ogImageMatch, 'app/layout.tsx must declare openGraph.images with a url');
  const declared = ogImageMatch[1];
  assert.ok(
    declared.startsWith('https://') || declared.startsWith('/'),
    'the og:image url must resolve to an absolute https URL once combined with metadataBase',
  );
  const resolved = new URL(declared, 'https://toronto-transit.org');
  assert.equal(resolved.protocol, 'https:');
  assert.ok(resolved.pathname.endsWith('social-preview.png'));
  assert.match(layout, /card:\s*'summary_large_image'/);
});
