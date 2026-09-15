/**
 * App-logo customization: the bundled marks, and the bounded rules a local
 * upload must satisfy before it is allowed to replace one.
 *
 * This file is deliberately DOM-free so it can be unit tested directly and
 * shared between the browser decoder (`logo-upload.ts`), the brand mark
 * component and the runtime favicon swap. Every bundled preset is trusted,
 * hand-authored stroke data drawn on the same rounded tile `BrandMark` has
 * always used; nothing here ever accepts markup from a file the visitor
 * picked. An uploaded image is re-rasterised through a canvas by the DOM
 * layer and stored as opaque PNG bytes -- this module only says whether an
 * upload is allowed to start, and whether the bytes that came back are small
 * enough to keep.
 */

export type LogoPreset = {
  id: string;
  label: { en: string; zh: string };
  /** Stroke paths drawn in the on-primary colour, on the rounded primary tile. */
  strokes: readonly string[];
  /** Small filled dots layered above the strokes. */
  dots: readonly [number, number][];
};

export const SHIPPED_LOGO_ID = 'shipped';
export const CUSTOM_LOGO_ID = 'custom';

export const LOGO_PRESETS: readonly LogoPreset[] = Object.freeze([
  {
    id: SHIPPED_LOGO_ID,
    label: { en: 'Transit tile (shipped)', zh: '交通圖標（原有）' },
    strokes: ['M19 44V21h26v23M19 30h26M26 21v9M38 21v9M24 44l-5 8m21-8 5 8'],
    dots: [[25, 38], [39, 38]],
  },
  {
    id: 'compass',
    label: { en: 'Compass', zh: '指南針' },
    strokes: ['M32 12a20 20 0 1 0 0.01 0z', 'M32 20l7 12-7 12-7-12z'],
    dots: [],
  },
  {
    id: 'signal',
    label: { en: 'Signal bars', zh: '訊號棒' },
    strokes: ['M18 46V34M28 46V24M38 46V16M48 46V28'],
    dots: [],
  },
  {
    id: 'loop',
    label: { en: 'Route loop', zh: '循環路線' },
    strokes: ['M18 26a16 16 0 0 1 28-10', 'M46 38a16 16 0 0 1-28 10', 'M42 10l4 6-6 2', 'M22 54l-4-6 6-2'],
    dots: [],
  },
]);

export function logoPreset(id: string): LogoPreset | null {
  return LOGO_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function isKnownLogoId(id: string): boolean {
  return id === CUSTOM_LOGO_ID || logoPreset(id) !== null;
}

/**
 * Renders a bundled preset as a standalone SVG data URL, for the favicon link
 * swap. The rail's own `BrandMark` renders the same stroke data inline so it
 * can follow the live theme tokens; a `<link rel="icon">` cannot read a CSS
 * custom property, so this bakes in one fixed pair of colours per theme --
 * the same trade-off `public/favicon.svg` already accepts for the shipped mark.
 */
export function presetFaviconDataUrl(preset: LogoPreset, dark: boolean): string {
  const primary = dark ? '#f2b74f' : '#8a5a12';
  const onPrimary = dark ? '#241a05' : '#fff7ea';
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const strokes = preset.strokes.map((d) => `<path d="${escape(d)}" fill="none" stroke="${onPrimary}" stroke-width="5" stroke-linecap="round"/>`).join('');
  const dots = preset.dots.map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="2.5" fill="${onPrimary}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="20" fill="${primary}"/>${strokes}${dots}</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

/* ------------------------------------------------------------------------ *
 * Local custom uploads.
 *
 * The upload is never inserted as markup, whatever its original type: the DOM
 * layer always decodes it through an `<img>` element and re-encodes it by
 * drawing onto a canvas, so an SVG upload is rasterised rather than trusted,
 * exactly like a PNG or JPEG upload would be. This module only carries the
 * pure bounds every candidate must satisfy, so they can be asserted without a
 * browser.
 * ------------------------------------------------------------------------ */

/** The only source types the picker will read. Anything else is refused before it is touched. */
export const LOGO_ALLOWED_TYPES: readonly string[] = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

/** The original file, before decoding. Generous, because the result is downscaled regardless. */
export const MAX_LOGO_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Guards against a decompression-bomb source image; the result is downscaled well below this. */
export const MAX_LOGO_SOURCE_DIMENSION = 4096;

/** The square canvas every accepted upload is re-rasterised onto. */
export const LOGO_CANVAS_SIZE = 256;

/** The bound on the re-encoded PNG data URL actually kept in storage. */
export const MAX_LOGO_STORED_BYTES = 200 * 1024;

export type LogoUploadFailure = 'type' | 'too-large' | 'dimensions' | 'decode' | 'stored-too-large';
export type LogoUploadResult = { ok: true; dataUrl: string } | { ok: false; reason: LogoUploadFailure };

/** The file-level checks: type allow-list, then a byte cap on the original upload. */
export function validateLogoFile(file: { type: string; size: number }): LogoUploadFailure | null {
  if (!LOGO_ALLOWED_TYPES.includes(file.type)) return 'type';
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_LOGO_UPLOAD_BYTES) return 'too-large';
  return null;
}

/** The decoded source image's own pixel dimensions, before it is scaled down. */
export function validateLogoDimensions(width: number, height: number): LogoUploadFailure | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 'decode';
  if (width > MAX_LOGO_SOURCE_DIMENSION || height > MAX_LOGO_SOURCE_DIMENSION) return 'dimensions';
  return null;
}

/** Where and how large to draw the source image onto the fixed square canvas, preserving its aspect ratio. */
export function computeLogoDrawRect(width: number, height: number, canvas: number = LOGO_CANVAS_SIZE): { drawWidth: number; drawHeight: number; x: number; y: number } {
  if (!(width > 0) || !(height > 0)) return { drawWidth: canvas, drawHeight: canvas, x: 0, y: 0 };
  const scale = Math.min(canvas / width, canvas / height);
  const drawWidth = Math.max(1, Math.round(width * scale));
  const drawHeight = Math.max(1, Math.round(height * scale));
  return { drawWidth, drawHeight, x: Math.round((canvas - drawWidth) / 2), y: Math.round((canvas - drawHeight) / 2) };
}

/** The last check, applied to the re-encoded PNG data URL rather than the original upload. */
export function validateStoredLogo(dataUrl: string): LogoUploadFailure | null {
  return new TextEncoder().encode(dataUrl).byteLength > MAX_LOGO_STORED_BYTES ? 'stored-too-large' : null;
}

export function logoUploadMessage(reason: LogoUploadFailure, t: (en: string, zh: string) => string): string {
  switch (reason) {
    case 'type': return t('Choose a PNG, JPEG, WebP or SVG image.', '請選擇 PNG、JPEG、WebP 或 SVG 圖片。');
    case 'too-large': return t('The file is empty or larger than 5 MB.', '檔案空白或超過 5 MB。');
    case 'dimensions': return t('The image is larger than 4096 by 4096 pixels.', '圖片大於 4096 x 4096 像素。');
    case 'decode': return t('This image could not be read. The previous mark was retained.', '未能讀取此圖片，會保留先前嘅圖標。');
    case 'stored-too-large': return t('The converted image is still too large to store. Try a simpler image.', '轉換後嘅圖片仍然太大，請試用較簡單嘅圖片。');
    default: return t('This image could not be used.', '未能使用此圖片。');
  }
}
