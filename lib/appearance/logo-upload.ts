'use client';
/**
 * The browser half of app-logo customization: decodes a picked file through
 * an `<img>` element and re-encodes it by drawing onto a canvas.
 *
 * This is the safe display conversion the picker relies on. Whatever the
 * source type -- PNG, JPEG, WebP, or SVG -- the browser decodes it as a
 * bitmap and this file only ever reads back canvas pixels; an SVG's markup
 * is never inserted into the page, never parsed as trusted content, and
 * never reaches `dangerouslySetInnerHTML`. A same-origin `blob:` URL keeps
 * the canvas untainted, so the export below is always readable.
 */
import { LOGO_CANVAS_SIZE, computeLogoDrawRect, validateLogoDimensions, validateLogoFile, validateStoredLogo, type LogoUploadResult } from './logo';

export async function decodeLogoUpload(file: File): Promise<LogoUploadResult> {
  const fileError = validateLogoFile(file);
  if (fileError) return { ok: false, reason: fileError };

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement | null>((resolve) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => resolve(null);
      element.src = url;
    });
    if (!image) return { ok: false, reason: 'decode' };

    const dimensionError = validateLogoDimensions(image.naturalWidth, image.naturalHeight);
    if (dimensionError) return { ok: false, reason: dimensionError };

    const canvas = document.createElement('canvas');
    canvas.width = LOGO_CANVAS_SIZE;
    canvas.height = LOGO_CANVAS_SIZE;
    const context = canvas.getContext('2d');
    if (!context) return { ok: false, reason: 'decode' };

    const rect = computeLogoDrawRect(image.naturalWidth, image.naturalHeight);
    context.clearRect(0, 0, LOGO_CANVAS_SIZE, LOGO_CANVAS_SIZE);
    context.drawImage(image, rect.x, rect.y, rect.drawWidth, rect.drawHeight);

    let dataUrl: string;
    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch {
      return { ok: false, reason: 'decode' };
    }

    const storedError = validateStoredLogo(dataUrl);
    if (storedError) return { ok: false, reason: storedError };
    return { ok: true, dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}
