/**
 * A Material Symbols glyph.
 *
 * The font is a ligature font, so the glyph is chosen by writing its NAME as the
 * element's text. Two consequences follow, and both are handled here rather than
 * left to each call site to remember:
 *
 * It is always `aria-hidden`. Without that a screen reader announces the literal
 * text content, so a close button reads out as "close close" at best and as
 * "swap_vert" at worst. An icon-only control therefore carries its own label; see
 * the guard in tests/icon-buttons.test.mjs, which refuses one that does not.
 *
 * Ligature substitution is requested explicitly. If it does not apply, every icon
 * in the interface renders as its own English name at icon size, which looks like
 * unfinished copy rather than a font problem and is the single most confusing way
 * this can fail.
 *
 * The shipped font is subset to exactly the names in ICON_NAMES in
 * scripts/vendor-fonts.mjs. A name outside that set renders as the word itself,
 * so tests/icon-glyphs.test.mjs checks every name used here against the manifest
 * of the binary that actually shipped.
 */
export function Icon({
  name,
  size,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={className ? `m3-icon ${className}` : 'm3-icon'}
      aria-hidden="true"
      style={size ? { fontSize: `${size}px` } : undefined}
    >
      {name}
    </span>
  );
}
