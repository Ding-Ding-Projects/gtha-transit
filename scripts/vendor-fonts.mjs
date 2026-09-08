#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_DIRECTORY = resolve(SCRIPT_DIRECTORY, '..');
const FONTS_DIRECTORY = resolve(REPOSITORY_DIRECTORY, 'public', 'fonts');

/**
 * The icon glyphs this interface actually draws.
 *
 * A ligature icon font is addressed by writing the glyph's NAME as the element's
 * text, so a name the font does not carry does not fall back to a box: it renders
 * the literal English word, in the middle of the interface, looking like copy
 * somebody forgot to finish. Subsetting makes that cheap to get wrong, because
 * only the names listed here exist in the shipped file at all.
 *
 * tests/icon-glyphs.test.mjs therefore checks every name the source writes
 * against the ligature table of the binary that actually shipped.
 */
const ICON_NAMES = [
  'add', 'alt_route', 'arrow_back', 'arrow_forward', 'bookmark', 'calendar_month',
  'check_circle',
  'chevron_right', 'close', 'dark_mode', 'directions_bus', 'directions_walk',
  'expand_less', 'expand_more', 'flag', 'garage', 'history', 'layers', 'light_mode',
  'map', 'more_horiz', 'my_location', 'place', 'public', 'refresh', 'remove',
  'schedule', 'search', 'sensors', 'settings', 'swap_vert', 'translate', 'tune',
  'volume_up', 'warning',
];

/**
 * Every family this project ships, with the shape each one is expected to have.
 *
 * The counts are hand-written and asserted rather than derived from whatever
 * arrives. Deriving them would make the check grade its own homework: a family
 * that silently lost half its subsets would still pass, because the expectation
 * would have moved with it.
 */
const FAMILIES = [
  {
    slug: 'space-grotesk',
    family: 'Space Grotesk',
    role: 'interface text',
    cssUrl: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap',
    licenseUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/spacegrotesk/OFL.txt',
    licenseFile: 'OFL.txt',
    licenseMarker: 'SIL OPEN FONT LICENSE Version 1.1',
    weights: ['400', '500', '600', '700'],
    display: 'swap',
    expectedFaces: 12,
    expectedFiles: 3,
    facesPerFile: 4,
    // Pinned from the shipped binary, which reports exactly this. Declaring an
    // axis a font does not have makes the browser synthesize the weight instead.
    variableAxis: { tag: 'wght', minimum: 300, default: 300, maximum: 700 },
  },
  {
    slug: 'ibm-plex-mono',
    family: 'IBM Plex Mono',
    role: 'times, durations and codes',
    cssUrl: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap',
    licenseUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/OFL.txt',
    licenseFile: 'OFL.txt',
    licenseMarker: 'SIL OPEN FONT LICENSE Version 1.1',
    weights: ['400', '500', '600'],
    display: 'swap',
    expectedFaces: 15,
    expectedFiles: 15,
    facesPerFile: 1,
    variableAxis: null,
  },
  {
    slug: 'material-symbols-outlined',
    family: 'Material Symbols Outlined',
    role: 'icons',
    icons: ICON_NAMES,
    cssUrl:
      'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,300,0,0' +
      `&icon_names=${ICON_NAMES.join(',')}&display=block`,
    licenseUrl: 'https://raw.githubusercontent.com/google/material-design-icons/master/LICENSE',
    licenseFile: 'LICENSE',
    licenseMarker: 'Apache License',
    weights: ['300'],
    display: 'block',
    expectedFaces: 1,
    expectedFiles: 1,
    facesPerFile: 1,
    // The subset endpoint serves /l/font rather than a .woff2 path, and one
    // subsetted face carries every requested glyph, so there is no unicode-range.
    subsetEndpoint: true,
    requiresUnicodeRange: false,
    fontFileName: 'material-symbols-outlined.woff2',
    variableAxis: null,
  },
];

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.4191.62';

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_CSS_BYTES = 64 * 1024;
const MAX_FONT_BYTES = 256 * 1024;
const MAX_LICENSE_BYTES = 32 * 1024;

const FONTTOOLS_PROGRAM = String.raw`import json
import os
import sys
from fontTools import __version__
from fontTools.ttLib import TTFont

files = []
for path in sys.argv[1:]:
    font = TTFont(path, lazy=False)
    axes = []
    if 'fvar' in font:
        for axis in font['fvar'].axes:
            axes.append({
                'tag': axis.axisTag,
                'minimum': float(axis.minValue),
                'default': float(axis.defaultValue),
                'maximum': float(axis.maxValue),
            })
    files.append({
        'file': os.path.basename(path),
        'decoded': True,
        'tables': sorted(font.keys()),
        'axes': axes,
    })

print(json.dumps({'fontToolsVersion': __version__, 'files': files}, sort_keys=True))
`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertCanonicalUrl(url, expectedHost) {
  assert(url.protocol === 'https:', `Expected HTTPS URL, received ${url.href}`);
  assert(url.hostname === expectedHost, `Unexpected host ${url.hostname}`);
  assert(url.port === '', `Unexpected port in ${url.href}`);
  assert(!url.username && !url.password, `Credentials are not allowed in ${url.href}`);
}

async function fetchBuffer(sourceUrl, expectedHost, maxBytes, contentType) {
  const requestedUrl = new URL(sourceUrl);
  assertCanonicalUrl(requestedUrl, expectedHost);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(requestedUrl, {
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'user-agent': BROWSER_USER_AGENT,
      },
    });

    assert(response.ok, `Request failed for ${sourceUrl}: HTTP ${response.status}`);
    assertCanonicalUrl(new URL(response.url), expectedHost);
    assert(
      response.headers.get('content-type')?.toLowerCase().includes(contentType),
      `Unexpected content type for ${sourceUrl}: ${response.headers.get('content-type') ?? 'missing'}`,
    );

    const contentLength = response.headers.get('content-length');
    if (contentLength !== null) {
      const byteLength = Number(contentLength);
      assert(
        Number.isSafeInteger(byteLength) && byteLength >= 0 && byteLength <= maxBytes,
        `Response exceeds the ${maxBytes}-byte limit for ${sourceUrl}`,
      );
    }

    assert(response.body, `Response body is missing for ${sourceUrl}`);
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        totalBytes += value.byteLength;
        assert(
          totalBytes <= maxBytes,
          `Response exceeds the ${maxBytes}-byte limit for ${sourceUrl}`,
        );
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }

    return Buffer.concat(chunks, totalBytes);
  } finally {
    clearTimeout(timeout);
  }
}

function readDeclaration(faceBody, property) {
  const expression = new RegExp(`^\\s*${property}\\s*:\\s*([^;]+);`, 'm');
  const match = faceBody.match(expression);
  assert(match, `Missing ${property} declaration in a Google Fonts face`);
  return match[1].trim();
}

function parseFaces(css, family) {
  const faceBlocks = [...css.matchAll(/@font-face\s*\{([^{}]*)\}/g)];
  assert(
    faceBlocks.length === family.expectedFaces,
    `Expected ${family.expectedFaces} @font-face blocks for ${family.family}, found ${faceBlocks.length}`,
  );

  const faces = faceBlocks.map((match) => {
    const body = match[1];
    const sourceMatch = body.match(
      /\bsrc\s*:\s*url\(\s*(['"]?)(https:\/\/fonts\.gstatic\.com\/[^'"\s)]+)\1\s*\)/,
    );
    assert(sourceMatch, 'Each font face must reference an HTTPS fonts.gstatic.com source');

    const sourceUrl = new URL(sourceMatch[2]);
    assertCanonicalUrl(sourceUrl, 'fonts.gstatic.com');
    assert(
      family.subsetEndpoint ? sourceUrl.pathname === '/l/font' : sourceUrl.pathname.endsWith('.woff2'),
      `Unexpected font source path, received ${sourceUrl.href}`,
    );

    const fontFamily = readDeclaration(body, 'font-family');
    const fontStyle = readDeclaration(body, 'font-style');
    const fontWeight = readDeclaration(body, 'font-weight');
    const fontDisplay = readDeclaration(body, 'font-display');
    // A single subsetted face carries every requested glyph, so it declares no range.
    const wantsRange = family.requiresUnicodeRange !== false;
    const unicodeRange = wantsRange ? readDeclaration(body, 'unicode-range') : null;

    assert(fontFamily === `'${family.family}'`, `Unexpected font family ${fontFamily}`);
    assert(fontStyle === 'normal', `Unexpected font style ${fontStyle}`);
    assert(family.weights.includes(fontWeight), `Unexpected font weight ${fontWeight}`);
    assert(fontDisplay === family.display, `Unexpected font-display ${fontDisplay}`);
    if (wantsRange) assert(unicodeRange.startsWith('U+'), `Unexpected unicode-range ${unicodeRange}`);

    return {
      fontFamily: family.family,
      fontStyle,
      fontWeight,
      fontDisplay,
      unicodeRange,
      sourceUrl: sourceUrl.href,
    };
  });

  const subsetsPerWeight = family.expectedFaces / family.weights.length;
  for (const weight of family.weights) {
    assert(
      faces.filter((face) => face.fontWeight === weight).length === subsetsPerWeight,
      `Expected ${subsetsPerWeight} subsets for ${family.family} weight ${weight}`,
    );
  }

  const sourceCounts = new Map();
  for (const face of faces) {
    sourceCounts.set(face.sourceUrl, (sourceCounts.get(face.sourceUrl) ?? 0) + 1);
  }

  assert(
    sourceCounts.size === family.expectedFiles,
    `Expected ${family.expectedFiles} unique WOFF2 files for ${family.family}, found ${sourceCounts.size}`,
  );
  for (const [sourceUrl, count] of sourceCounts) {
    assert(
      count === family.facesPerFile,
      `Expected ${sourceUrl} to serve ${family.facesPerFile} faces, found ${count}`,
    );
  }

  return { faces, sourceCounts };
}

function outputFileName(sourceUrl, family) {
  // The subset endpoint has no filename in its path, so the family names the file.
  const fileName = family.fontFileName ?? basename(new URL(sourceUrl).pathname);
  assert(
    /^[a-zA-Z0-9._-]+\.woff2$/.test(fileName),
    `Unsafe output filename generated from ${sourceUrl}`,
  );
  return fileName;
}

function rewriteCssForLocalFiles(css, sourceToFileName, sourceCounts) {
  let localCss = css;

  for (const [sourceUrl, fileName] of sourceToFileName) {
    const occurrences = localCss.split(sourceUrl).length - 1;
    assert(
      occurrences === sourceCounts.get(sourceUrl),
      `Expected ${sourceUrl} to occur ${sourceCounts.get(sourceUrl)} times, found ${occurrences}`,
    );
    localCss = localCss.replaceAll(sourceUrl, `./${fileName}`);
  }

  assert(!localCss.includes('https://fonts.gstatic.com/'), 'A remote font URL remains in local CSS');
  return localCss;
}

function inspectWithFontTools(fontPaths, family) {
  const commands = [
    { command: 'py', args: ['-3'] },
    { command: 'python', args: [] },
  ];

  for (const candidate of commands) {
    const result = spawnSync(
      candidate.command,
      [...candidate.args, '-c', FONTTOOLS_PROGRAM, ...fontPaths],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 },
    );

    if (result.error?.code === 'ENOENT') {
      continue;
    }

    const stderr = result.stderr?.trim() ?? '';
    if (result.status !== 0 && /ModuleNotFoundError: No module named ['"]fontTools/.test(stderr)) {
      continue;
    }

    assert(
      result.status === 0,
      `fontTools could not decode the downloaded WOFF2 files: ${stderr || result.error?.message || 'unknown error'}`,
    );

    const inspection = JSON.parse(result.stdout);
    assert(inspection.files.length === fontPaths.length, 'fontTools did not inspect every WOFF2 file');

    // Declaring an axis a font does not have makes the browser synthesize the
    // weight instead of failing, so the expectation is pinned from the binary and
    // every mismatch reports what the binary actually says.
    for (const file of inspection.files) {
      assert(file.decoded === true, `fontTools did not decode ${file.file}`);
      const observed =
        file.axes.map((axis) => `${axis.tag} ${axis.minimum}-${axis.maximum} default ${axis.default}`).join(', ') ||
        'no variable axes';
      const expected = family.variableAxis;
      if (!expected) {
        assert(
          file.axes.length === 0,
          `${family.family}: ${file.file} carries ${observed}, but the family declares none. Pin it.`,
        );
        continue;
      }
      assert(
        file.axes.length === 1 &&
          file.axes[0].tag === expected.tag &&
          file.axes[0].minimum === expected.minimum &&
          file.axes[0].default === expected.default &&
          file.axes[0].maximum === expected.maximum,
        `${family.family}: ${file.file} carries ${observed}, family declares ` +
          `${expected.tag} ${expected.minimum}-${expected.maximum} default ${expected.default}`,
      );
    }

    return {
      status: 'verified',
      command: [candidate.command, ...candidate.args].join(' '),
      ...inspection,
    };
  }

  return {
    status: 'unavailable',
    reason:
      'fontTools was not available. The CSS keeps only the fixed weights declared by Google Fonts and does not synthesize a variable axis declaration.',
  };
}

async function readJsonIfPresent(path) {
  try {
    const content = await readFile(path, 'utf8');
    try {
      return JSON.parse(content);
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.warn(`Replacing invalid generated manifest: ${path}`);
        return null;
      }
      throw error;
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeIfChanged(path, content) {
  const next = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  try {
    const previous = await readFile(path);
    if (previous.equals(next)) {
      return false;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, next);
  return true;
}

async function vendorFamily(family) {
  const OUTPUT_DIRECTORY = resolve(FONTS_DIRECTORY, family.slug);
  const cssBytes = await fetchBuffer(family.cssUrl, 'fonts.googleapis.com', MAX_CSS_BYTES, 'text/css');
  const css = new TextDecoder('utf-8', { fatal: true }).decode(cssBytes);
  const { faces, sourceCounts } = parseFaces(css, family);

  const sourceToFileName = new Map();
  for (const sourceUrl of sourceCounts.keys()) {
    const fileName = outputFileName(sourceUrl, family);
    const existingSource = [...sourceToFileName.entries()].find(([, value]) => value === fileName)?.[0];
    assert(
      !existingSource || existingSource === sourceUrl,
      `Two font sources resolve to the same filename ${fileName}`,
    );
    sourceToFileName.set(sourceUrl, fileName);
  }

  const fontBuffers = new Map();
  for (const sourceUrl of sourceToFileName.keys()) {
    const fontBytes = await fetchBuffer(sourceUrl, 'fonts.gstatic.com', MAX_FONT_BYTES, 'font/woff2');
    assert(
      fontBytes.subarray(0, 4).toString('ascii') === 'wOF2',
      `Downloaded font does not have a WOFF2 signature: ${sourceUrl}`,
    );
    fontBuffers.set(sourceUrl, fontBytes);
  }

  const licenseBytes = await fetchBuffer(
    family.licenseUrl,
    'raw.githubusercontent.com',
    MAX_LICENSE_BYTES,
    'text/plain',
  );
  const license = new TextDecoder('utf-8', { fatal: true }).decode(licenseBytes);
  assert(license.includes(family.licenseMarker), `Unexpected ${family.family} license text`);
  const localLicense = license
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n');

  const localCss = rewriteCssForLocalFiles(css, sourceToFileName, sourceCounts);
  const localCssBytes = Buffer.from(localCss, 'utf8');
  const localLicenseBytes = Buffer.from(localLicense, 'utf8');
  const fontPaths = [...sourceToFileName.values()].map((fileName) => resolve(OUTPUT_DIRECTORY, fileName));
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });

  /* Tracked, not just written. Reporting only the css and licence meant a run
     that replaced a font binary and nothing else announced itself as "already
     current", which is the opposite of what happened. */
  const changedFonts = [];
  for (const [sourceUrl, fileName] of sourceToFileName) {
    if (await writeIfChanged(resolve(OUTPUT_DIRECTORY, fileName), fontBuffers.get(sourceUrl))) {
      changedFonts.push(fileName);
    }
  }

  const inspection = inspectWithFontTools(fontPaths, family);
  const manifestPath = resolve(OUTPUT_DIRECTORY, 'manifest.json');
  const existingManifest = await readJsonIfPresent(manifestPath);
  const cssHash = sha256(cssBytes);
  const licenseHash = sha256(licenseBytes);
  const fonts = [...sourceToFileName].map(([sourceUrl, fileName]) => {
    const fontBytes = fontBuffers.get(sourceUrl);
    return {
      file: fileName,
      sourceUrl,
      sha256: sha256(fontBytes),
      bytes: fontBytes.byteLength,
      faceCount: sourceCounts.get(sourceUrl),
    };
  });

  const sourceContentMatches =
    existingManifest?.sources?.css?.sha256 === cssHash &&
    existingManifest?.sources?.license?.sha256 === licenseHash &&
    JSON.stringify(existingManifest?.fonts?.map(({ file, sha256: hash }) => ({ file, sha256: hash }))) ===
      JSON.stringify(fonts.map(({ file, sha256: hash }) => ({ file, sha256: hash })));

  const manifest = {
    schemaVersion: 1,
    family: family.family,
    role: family.role,
    requestedWeights: family.weights.map(Number),
    ...(family.icons ? { iconNames: family.icons } : {}),
    retrievedAt: sourceContentMatches ? existingManifest.retrievedAt : new Date().toISOString(),
    request: {
      cssUrl: family.cssUrl,
      userAgent: BROWSER_USER_AGENT,
    },
    sources: {
      css: {
        url: family.cssUrl,
        sha256: cssHash,
        bytes: cssBytes.byteLength,
        faceCount: faces.length,
        asset: {
          file: `${family.slug}.css`,
          sha256: sha256(localCssBytes),
          bytes: localCssBytes.byteLength,
        },
      },
      license: {
        url: family.licenseUrl,
        sha256: licenseHash,
        bytes: licenseBytes.byteLength,
        asset: {
          file: family.licenseFile,
          sha256: sha256(localLicenseBytes),
          bytes: localLicenseBytes.byteLength,
        },
      },
    },
    fonts,
    faces: faces.map((face) => ({
      ...face,
      file: sourceToFileName.get(face.sourceUrl),
    })),
    inspection,
  };

  const changed = [...changedFonts];
  if (await writeIfChanged(resolve(OUTPUT_DIRECTORY, `${family.slug}.css`), localCssBytes)) {
    changed.push(`${family.slug}.css`);
  }
  if (await writeIfChanged(resolve(OUTPUT_DIRECTORY, family.licenseFile), localLicenseBytes)) {
    changed.push(family.licenseFile);
  }
  if (await writeIfChanged(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)) {
    changed.push('manifest.json');
  }

  console.log(
    changed.length === 0
      ? `${family.family} is already current.`
      : `Updated ${family.family}: ${changed.join(', ')}`,
  );
  console.log(
    `  ${faces.length} face declarations, ${fonts.length} unique WOFF2 files, ` +
      `${fonts.reduce((total, font) => total + font.bytes, 0)} bytes, ${inspection.status} fontTools inspection.`,
  );
}

async function main() {
  for (const family of FAMILIES) await vendorFamily(family);
}

main().catch((error) => {
  console.error(`Font vendoring failed: ${error.message}`);
  process.exitCode = 1;
});
