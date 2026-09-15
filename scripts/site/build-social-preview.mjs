#!/usr/bin/env node
/**
 * Builds the project's social preview image: what shows up when a link to
 * this repository or its documentation site is pasted somewhere that reads
 * Open Graph tags.
 *
 * The source is a real, already-committed capture of the built application
 * (docs/design/parity/plan-app.png, the same design-parity evidence the
 * project already keeps), never a mockup or a generated graphic. The method
 * is a plain centre crop to the widely-used 1200x630 Open Graph size,
 * followed by a resize back to exactly that size: at the source's native
 * 1440x900, cropping to a 1200/630 aspect ratio at full width removes 144px
 * total from the top and bottom (72px each) and nothing from the sides, so
 * the composer stays centred rather than being stretched or letterboxed.
 *
 * Usage: node scripts/site/build-social-preview.mjs [--check]
 *   --check  computes the crop and reports it without writing anything.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

export const SOURCE_CAPTURE = 'docs/design/parity/plan-app.png';
export const OUTPUT_PATH = 'public/social-preview.png';
export const TARGET_WIDTH = 1200;
export const TARGET_HEIGHT = 630;

/** The exact crop rectangle, in the source image's own pixels, for a given
 * source size. Pure and unit-tested: the geometry is the part that is easy
 * to get subtly wrong, so it is computed once here rather than inline. */
export function centerCrop(sourceWidth, sourceHeight, targetWidth = TARGET_WIDTH, targetHeight = TARGET_HEIGHT) {
  const targetAspect = targetWidth / targetHeight;
  const sourceAspect = sourceWidth / sourceHeight;
  if (sourceAspect >= targetAspect) {
    // Source is relatively wider than the target: crop the sides, keep the full height.
    const width = Math.round(sourceHeight * targetAspect);
    const left = Math.floor((sourceWidth - width) / 2);
    return { left, top: 0, width, height: sourceHeight };
  }
  // Source is relatively taller than the target: crop the top and bottom, keep the full width.
  const height = Math.round(sourceWidth / targetAspect);
  const top = Math.floor((sourceHeight - height) / 2);
  return { left: 0, top, width: sourceWidth, height };
}

async function build() {
  const sourcePath = path.join(root, SOURCE_CAPTURE);
  const sourceBytes = readFileSync(sourcePath);
  const image = sharp(sourceBytes);
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`scripts/site/build-social-preview.mjs: could not read the dimensions of ${SOURCE_CAPTURE}`);
  }
  const crop = centerCrop(metadata.width, metadata.height);
  const outputBuffer = await sharp(sourceBytes)
    .extract(crop)
    .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: 'fill' })
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer();
  return { crop, sourceMetadata: metadata, outputBuffer };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const { crop, sourceMetadata, outputBuffer } = await build();
  console.log(
    `scripts/site/build-social-preview.mjs: ${SOURCE_CAPTURE} is ${sourceMetadata.width}x${sourceMetadata.height}; ` +
      `cropping to ${crop.width}x${crop.height} at (${crop.left}, ${crop.top}) and resizing to ${TARGET_WIDTH}x${TARGET_HEIGHT}` +
      `${check ? ' (--check, not writing)' : ''}.`,
  );
  if (!check) {
    const outputPath = path.join(root, OUTPUT_PATH);
    writeFileSync(outputPath, outputBuffer);
    console.log(`  wrote ${OUTPUT_PATH} (${outputBuffer.byteLength} bytes).`);
  }
}
