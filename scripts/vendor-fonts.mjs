#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_DIRECTORY = resolve(SCRIPT_DIRECTORY, '..');
const OUTPUT_DIRECTORY = resolve(
  REPOSITORY_DIRECTORY,
  'public',
  'fonts',
  'manrope',
);

const CSS_SOURCE_URL =
  'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap';
const LICENSE_SOURCE_URL =
  'https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/OFL.txt';
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.4191.62';

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_CSS_BYTES = 64 * 1024;
const MAX_FONT_BYTES = 256 * 1024;
const MAX_LICENSE_BYTES = 32 * 1024;
const REQUESTED_WEIGHTS = ['400', '500', '600', '700', '800'];

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

function parseFaces(css) {
  const faceBlocks = [...css.matchAll(/@font-face\s*\{([^{}]*)\}/g)];
  assert(faceBlocks.length === 30, `Expected 30 @font-face blocks, found ${faceBlocks.length}`);

  const faces = faceBlocks.map((match) => {
    const body = match[1];
    const sourceMatch = body.match(
      /\bsrc\s*:\s*url\(\s*(['"]?)(https:\/\/fonts\.gstatic\.com\/[^'"\s)]+)\1\s*\)/,
    );
    assert(sourceMatch, 'Each font face must reference an HTTPS fonts.gstatic.com source');

    const sourceUrl = new URL(sourceMatch[2]);
    assertCanonicalUrl(sourceUrl, 'fonts.gstatic.com');
    assert(
      sourceUrl.pathname.endsWith('.woff2'),
      `Expected WOFF2 source, received ${sourceUrl.href}`,
    );

    const fontFamily = readDeclaration(body, 'font-family');
    const fontStyle = readDeclaration(body, 'font-style');
    const fontWeight = readDeclaration(body, 'font-weight');
    const fontDisplay = readDeclaration(body, 'font-display');
    const unicodeRange = readDeclaration(body, 'unicode-range');

    assert(fontFamily === "'Manrope'", `Unexpected font family ${fontFamily}`);
    assert(fontStyle === 'normal', `Unexpected font style ${fontStyle}`);
    assert(REQUESTED_WEIGHTS.includes(fontWeight), `Unexpected font weight ${fontWeight}`);
    assert(fontDisplay === 'swap', `Unexpected font-display ${fontDisplay}`);
    assert(unicodeRange.startsWith('U+'), `Unexpected unicode-range ${unicodeRange}`);

    return {
      fontFamily: 'Manrope',
      fontStyle,
      fontWeight,
      fontDisplay,
      unicodeRange,
      sourceUrl: sourceUrl.href,
    };
  });

  for (const weight of REQUESTED_WEIGHTS) {
    assert(
      faces.filter((face) => face.fontWeight === weight).length === 6,
      `Expected six Unicode subsets for weight ${weight}`,
    );
  }

  const sourceCounts = new Map();
  for (const face of faces) {
    sourceCounts.set(face.sourceUrl, (sourceCounts.get(face.sourceUrl) ?? 0) + 1);
  }

  assert(sourceCounts.size === 6, `Expected six unique WOFF2 files, found ${sourceCounts.size}`);
  for (const [sourceUrl, count] of sourceCounts) {
    assert(count === 5, `Expected ${sourceUrl} to serve five weights, found ${count}`);
  }

  return { faces, sourceCounts };
}

function outputFileName(sourceUrl) {
  const fileName = basename(new URL(sourceUrl).pathname);
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

function inspectWithFontTools(fontPaths) {
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

    for (const file of inspection.files) {
      assert(file.decoded === true, `fontTools did not decode ${file.file}`);
      assert(file.axes.length === 1, `Expected one variable axis in ${file.file}`);
      const [axis] = file.axes;
      assert(axis.tag === 'wght', `Unexpected variable axis ${axis.tag} in ${file.file}`);
      assert(axis.minimum === 200, `Unexpected wght minimum ${axis.minimum} in ${file.file}`);
      assert(axis.default === 200, `Unexpected wght default ${axis.default} in ${file.file}`);
      assert(axis.maximum === 800, `Unexpected wght maximum ${axis.maximum} in ${file.file}`);
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

async function main() {
  const cssBytes = await fetchBuffer(CSS_SOURCE_URL, 'fonts.googleapis.com', MAX_CSS_BYTES, 'text/css');
  const css = new TextDecoder('utf-8', { fatal: true }).decode(cssBytes);
  const { faces, sourceCounts } = parseFaces(css);

  const sourceToFileName = new Map();
  for (const sourceUrl of sourceCounts.keys()) {
    const fileName = outputFileName(sourceUrl);
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
    LICENSE_SOURCE_URL,
    'raw.githubusercontent.com',
    MAX_LICENSE_BYTES,
    'text/plain',
  );
  const license = new TextDecoder('utf-8', { fatal: true }).decode(licenseBytes);
  assert(license.includes('SIL OPEN FONT LICENSE Version 1.1'), 'Unexpected Manrope license text');
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

  for (const [sourceUrl, fileName] of sourceToFileName) {
    await writeIfChanged(resolve(OUTPUT_DIRECTORY, fileName), fontBuffers.get(sourceUrl));
  }

  const inspection = inspectWithFontTools(fontPaths);
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
    family: 'Manrope',
    requestedWeights: REQUESTED_WEIGHTS.map(Number),
    retrievedAt: sourceContentMatches ? existingManifest.retrievedAt : new Date().toISOString(),
    request: {
      cssUrl: CSS_SOURCE_URL,
      userAgent: BROWSER_USER_AGENT,
    },
    sources: {
      css: {
        url: CSS_SOURCE_URL,
        sha256: cssHash,
        bytes: cssBytes.byteLength,
        faceCount: faces.length,
        asset: {
          file: 'manrope.css',
          sha256: sha256(localCssBytes),
          bytes: localCssBytes.byteLength,
        },
      },
      license: {
        url: LICENSE_SOURCE_URL,
        sha256: licenseHash,
        bytes: licenseBytes.byteLength,
        asset: {
          file: 'OFL.txt',
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

  const changed = [];
  if (await writeIfChanged(resolve(OUTPUT_DIRECTORY, 'manrope.css'), localCssBytes)) {
    changed.push('manrope.css');
  }
  if (await writeIfChanged(resolve(OUTPUT_DIRECTORY, 'OFL.txt'), localLicenseBytes)) {
    changed.push('OFL.txt');
  }
  if (await writeIfChanged(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)) {
    changed.push('manifest.json');
  }

  console.log(
    changed.length === 0
      ? 'Manrope assets are already current.'
      : `Updated Manrope assets: ${changed.join(', ')}`,
  );
  console.log(
    `Verified ${faces.length} face declarations, ${fonts.length} unique WOFF2 files, and ${inspection.status} fontTools inspection.`,
  );
}

main().catch((error) => {
  console.error(`Font vendoring failed: ${error.message}`);
  process.exitCode = 1;
});
