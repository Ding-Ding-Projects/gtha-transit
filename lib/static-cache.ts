/**
 * How long a static file may be reused without asking again.
 *
 * The rule is: cache everything that can be cached, and be honest about the rest.
 * What decides it is one question — does the URL change when the bytes do?
 *
 * - **A content-addressed name** — the build's own hashed assets, and the font
 *   files whose names Google derives from their contents — can never mean two
 *   different things, so it is kept for a year and never revalidated.
 * - **A stable name over changing bytes** cannot claim that. The dim sum photos
 *   keep their dish slug across a re-vendor, so they get a day: a launch almost
 *   never pays for them, and a re-vendored picture appears within a day.
 * - **Anything that must be right the moment it changes** — the document, the
 *   version stamp, the photo manifest, and the one icon font whose name is fixed
 *   while this repository genuinely does change its glyph subset — revalidates.
 *   That is cheap rather than free, because of the validator below.
 *
 * This lives here rather than inside the server because the server starts
 * listening when it is imported, so a rule that stayed there could only ever be
 * checked by grepping the source — and a caching rule nobody has run is exactly
 * how the previous one came to match nothing at all.
 */

/** Files whose name is the family rather than their contents, so they can be rewritten in place. */
const REWRITTEN_IN_PLACE = ['/material-symbols-outlined.woff2'];

export const IMMUTABLE = 'public,max-age=31536000,immutable';
export const REVALIDATE = 'no-cache';
export const DOCUMENT = 'public,no-cache,no-transform';
/** A day. Long enough that a launch almost never pays; short enough to correct. */
export const PHOTO = 'public,max-age=86400';

export function cachePolicy(pathname: string, extension: string): string {
  if (extension === '.html') return DOCUMENT;
  if (pathname.startsWith('/_next/')) return IMMUTABLE;
  /*
   * Every vendored font is named by its own content except the icon subset,
   * which is named for the family and is rewritten whenever the set of glyphs the
   * interface asks for changes. Freezing that one for a year would leave somebody
   * looking at the wrong icons until they cleared their browser.
   */
  if (pathname.startsWith('/fonts/')) {
    return REWRITTEN_IN_PLACE.some((name) => pathname.endsWith(name)) ? REVALIDATE : IMMUTABLE;
  }
  /* The photos keep their dish slug across a re-vendor; the manifest decides
     which of them exist at all, so it has to be right immediately. */
  if (pathname.startsWith('/dim-sum/')) return extension === '.json' ? REVALIDATE : PHOTO;
  return REVALIDATE;
}

/**
 * A validator, so revalidating costs a header exchange rather than the file.
 *
 * Everything on `no-cache` above was previously sent in full on every single
 * load, because there was nothing for a browser to ask about: `no-cache` means
 * "check before using", and with no validator the check *is* the download.
 *
 * Size and modification time are what a static file server can know without
 * reading the bytes, and they change together whenever the file does. Weak,
 * because that pair identifies a version rather than proving the octets.
 */
export const validatorFor = (info: { size: number; mtimeMs: number }): string =>
  `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
