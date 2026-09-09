/**
 * Where an anchored panel goes: pure geometry, no DOM.
 *
 * Every popover, listbox and context menu in the appearance system is anchored
 * to some trigger element rather than centred on the screen, and every one of
 * them needs the same four decisions made the same way: which side of the
 * anchor to sit on, what to do when the preferred side has no room, how to stay
 * inside the viewport along the axis that runs across the anchor, and what to
 * do when nothing quite fits. Four callers implementing that separately is four
 * chances for one of them to disagree about which side "top" flips to.
 */

export type Rect = { top: number; left: number; width: number; height: number };
export type Size = { width: number; height: number };
export type AnchoredSide = 'bottom' | 'top' | 'right' | 'left';

export type PlaceAnchoredInput = {
  anchor: Rect;
  panel: Size;
  viewport: Size;
  preferred: AnchoredSide;
  gap: number;
  margin: number;
};

export type PlaceAnchoredResult = {
  top: number;
  left: number;
  side: AnchoredSide;
  /** True when the cross-axis or the final safety clamp moved the panel from its natural position. */
  clampedX: boolean;
  clampedY: boolean;
};

const OPPOSITE: Readonly<Record<AnchoredSide, AnchoredSide>> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/** Keep `value` inside [min, max]. When the range is inverted (the viewport is smaller than the panel plus its margins), settle on the margin edge rather than producing a negative-width range. */
function clampInto(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function primaryFor(side: AnchoredSide, anchor: Rect, panel: Size, gap: number): number {
  switch (side) {
    case 'bottom': return anchor.top + anchor.height + gap;
    case 'top': return anchor.top - panel.height - gap;
    case 'right': return anchor.left + anchor.width + gap;
    case 'left': return anchor.left - panel.width - gap;
  }
}

function fits(side: AnchoredSide, anchor: Rect, panel: Size, viewport: Size, gap: number, margin: number): boolean {
  const value = primaryFor(side, anchor, panel, gap);
  switch (side) {
    case 'bottom': return value + panel.height <= viewport.height - margin;
    case 'top': return value >= margin;
    case 'right': return value + panel.width <= viewport.width - margin;
    case 'left': return value >= margin;
  }
}

/**
 * Place a panel against an anchor.
 *
 * The preferred side is used when it has room. When it does not, this flips to
 * the direct opposite (bottom becomes top, right becomes left) and uses that
 * instead, but only when the opposite side actually has room -- flipping into
 * an equally cramped opposite side would just move the problem. Either way, the
 * cross axis (left for a vertical placement, top for a horizontal one) is then
 * shifted to stay inside the viewport minus the margin, and a final clamp on
 * both axes is the safety net for a viewport too small for the panel at all.
 *
 * Because the cross-axis shift and the final clamp only ever move the panel
 * along the axis that runs across the anchor, not the axis that runs away from
 * it, a side that fits is never clamped back over the anchor it was placed
 * against: the primary-axis coordinate a fitting side computes already clears
 * the anchor by `gap`, and that is the one coordinate neither clamp step above
 * needs to touch.
 */
export function placeAnchored({ anchor, panel, viewport, preferred, gap, margin }: PlaceAnchoredInput): PlaceAnchoredResult {
  const vertical = preferred === 'top' || preferred === 'bottom';
  const opposite = OPPOSITE[preferred];
  const side = fits(preferred, anchor, panel, viewport, gap, margin)
    ? preferred
    : fits(opposite, anchor, panel, viewport, gap, margin)
      ? opposite
      : preferred;

  const primaryValue = primaryFor(side, anchor, panel, gap);
  const naturalTop = vertical ? primaryValue : anchor.top;
  const naturalLeft = vertical ? anchor.left : primaryValue;

  const top = clampInto(naturalTop, margin, viewport.height - margin - panel.height);
  const left = clampInto(naturalLeft, margin, viewport.width - margin - panel.width);

  return { top, left, side, clampedX: left !== naturalLeft, clampedY: top !== naturalTop };
}
