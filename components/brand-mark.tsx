/**
 * The brand mark, drawn inline so it follows the theme.
 *
 * The same mark also ships as public/logo.svg and public/favicon.svg, which a
 * browser tab and a link preview need as files. Those carry fixed colours,
 * because nothing outside the page can read a custom property. In the rail we
 * are inside the page, so the tile takes the accent role and moves with it: the
 * design's accent is a darker amber by day and a brighter one by night, and a
 * fixed file can only ever be right for one of them.
 *
 * Decorative: the link that wraps it carries the accessible name.
 */
export function BrandMark({ size = 36 }: { size?: number }) {
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
      <path
        d="M19 44V21h26v23M19 30h26M26 21v9M38 21v9M24 44l-5 8m21-8 5 8"
        fill="none"
        stroke="var(--md-sys-color-on-primary)"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="25" cy="38" r="2.5" fill="var(--md-sys-color-on-primary)" />
      <circle cx="39" cy="38" r="2.5" fill="var(--md-sys-color-on-primary)" />
    </svg>
  );
}
