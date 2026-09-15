import { CUSTOM_LOGO_ID, SHIPPED_LOGO_ID, logoPreset } from '../lib/appearance/logo';

/**
 * The brand mark, drawn inline so it follows the theme.
 *
 * The same shipped mark also ships as public/logo.svg and public/favicon.svg,
 * which a browser tab and a link preview need as files. Those carry fixed
 * colours, because nothing outside the page can read a custom property. In
 * the rail we are inside the page, so the tile takes the accent role and
 * moves with it: the design's accent is a darker amber by day and a brighter
 * one by night, and a fixed file can only ever be right for one of them.
 *
 * `logoId` selects one of the bundled presets in `lib/appearance/logo.ts`, or
 * `'custom'` for a locally uploaded mark, in which case `customDataUrl` is
 * rendered as an image instead -- a raster upload cannot carry a CSS custom
 * property, so it does not follow the theme the way a bundled preset does.
 * An unrecognised or missing `logoId` falls back to the shipped tile.
 *
 * Decorative: the link that wraps it carries the accessible name.
 */
export function BrandMark({ size = 36, logoId = SHIPPED_LOGO_ID, customDataUrl = null }: { size?: number; logoId?: string; customDataUrl?: string | null }) {
  if (logoId === CUSTOM_LOGO_ID && customDataUrl) {
    return (
      <img
        src={customDataUrl}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        className="brand-mark brand-mark-custom"
        style={{ borderRadius: Math.round(size * 0.3125) }}
      />
    );
  }
  const preset = logoPreset(logoId) ?? logoPreset(SHIPPED_LOGO_ID)!;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      className="brand-mark"
    >
      <rect width="64" height="64" rx="20" fill="var(--md-sys-color-primary)" />
      {preset.strokes.map((d, index) => (
        <path key={index} d={d} fill="none" stroke="var(--md-sys-color-on-primary)" strokeWidth="5" strokeLinecap="round" />
      ))}
      {preset.dots.map(([cx, cy], index) => (
        <circle key={index} cx={cx} cy={cy} r="2.5" fill="var(--md-sys-color-on-primary)" />
      ))}
    </svg>
  );
}
