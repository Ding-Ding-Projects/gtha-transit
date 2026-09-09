import assert from 'node:assert/strict';
import test from 'node:test';
import { placeAnchored } from '../lib/appearance/placement.ts';

const viewport = { width: 1000, height: 800 };
const panel = { width: 200, height: 120 };
const gap = 8, margin = 16;

/** True when two axis-aligned rectangles overlap at all. */
function overlaps(a, b) {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}

test('a preferred side with room is used exactly, offset by the gap', () => {
  const anchor = { top: 300, left: 400, width: 80, height: 30 };
  const result = placeAnchored({ anchor, panel, viewport, preferred: 'bottom', gap, margin });
  assert.equal(result.side, 'bottom');
  assert.equal(result.top, anchor.top + anchor.height + gap);
  assert.equal(result.left, anchor.left);
  assert.equal(result.clampedX, false);
  assert.equal(result.clampedY, false);
});

test('each of the four preferred sides places the panel on the correct edge of the anchor', () => {
  const anchor = { top: 300, left: 400, width: 80, height: 30 };
  const bottom = placeAnchored({ anchor, panel, viewport, preferred: 'bottom', gap, margin });
  assert.equal(bottom.top, anchor.top + anchor.height + gap);
  const top = placeAnchored({ anchor, panel, viewport, preferred: 'top', gap, margin });
  assert.equal(top.side, 'top');
  assert.equal(top.top, anchor.top - panel.height - gap);
  const right = placeAnchored({ anchor, panel, viewport, preferred: 'right', gap, margin });
  assert.equal(right.side, 'right');
  assert.equal(right.left, anchor.left + anchor.width + gap);
  const left = placeAnchored({ anchor, panel, viewport, preferred: 'left', gap, margin });
  assert.equal(left.side, 'left');
  assert.equal(left.left, anchor.left - panel.width - gap);
});

test('flips to the opposite side when the preferred side has no room, and only when the opposite actually fits', () => {
  // Anchor pinned to the bottom edge: "bottom" has no room, so this flips to "top".
  const anchorAtFloor = { top: viewport.height - 20, left: 400, width: 80, height: 20 };
  const flipped = placeAnchored({ anchor: anchorAtFloor, panel, viewport, preferred: 'bottom', gap, margin });
  assert.equal(flipped.side, 'top');
  assert.equal(flipped.top, anchorAtFloor.top - panel.height - gap);

  // Anchor pinned to the top edge: "top" has no room, so this flips to "bottom".
  const anchorAtCeiling = { top: 0, left: 400, width: 80, height: 20 };
  const flippedDown = placeAnchored({ anchor: anchorAtCeiling, panel, viewport, preferred: 'top', gap, margin });
  assert.equal(flippedDown.side, 'bottom');

  // Anchor centred in a viewport too short for the panel on either side: neither
  // fits, so this stays on the originally preferred side rather than flipping
  // into an opposite that is exactly as cramped.
  const tinyViewport = { width: 1000, height: 140 };
  const centred = { top: 40, left: 400, width: 80, height: 20 };
  const stuck = placeAnchored({ anchor: centred, panel, viewport: tinyViewport, preferred: 'bottom', gap, margin });
  assert.equal(stuck.side, 'bottom');
});

test('shifts along the cross axis to stay inside the viewport minus the margin, without moving the primary axis', () => {
  // Anchor near the right edge: a "bottom" placement's left would run off-screen.
  const anchorNearRightEdge = { top: 300, left: viewport.width - 40, width: 30, height: 30 };
  const result = placeAnchored({ anchor: anchorNearRightEdge, panel, viewport, preferred: 'bottom', gap, margin });
  assert.equal(result.side, 'bottom');
  assert.equal(result.top, anchorNearRightEdge.top + anchorNearRightEdge.height + gap, 'the primary axis is untouched by the cross-axis shift');
  assert.ok(result.left + panel.width <= viewport.width - margin, 'the panel stays inside the right margin');
  assert.equal(result.clampedX, true);
  assert.equal(result.clampedY, false);

  // Anchor near the left edge: an unshifted left would run negative.
  const anchorNearLeftEdge = { top: 300, left: -10, width: 30, height: 30 };
  const shiftedRight = placeAnchored({ anchor: anchorNearLeftEdge, panel, viewport, preferred: 'bottom', gap, margin });
  assert.ok(shiftedRight.left >= margin);
  assert.equal(shiftedRight.clampedX, true);
});

test('a final clamp is the safety net when the panel cannot possibly fit inside the viewport', () => {
  // The panel is wider than the whole viewport, so no side can fit it: this is
  // the one regime where the "never covers the anchor" guarantee does not
  // apply, and the clamp's job is only to keep the numbers finite and sane.
  const tinyViewport = { width: 150, height: 100 };
  const anchor = { top: 40, left: 40, width: 20, height: 20 };
  const result = placeAnchored({ anchor, panel, viewport: tinyViewport, preferred: 'right', gap, margin });
  assert.equal(result.side, 'right', 'stays on the originally preferred side rather than flipping into an equally impossible opposite');
  assert.equal(result.left, margin, 'settles on the margin edge rather than a negative-width range');
  assert.equal(result.top, margin);
  assert.ok(Number.isFinite(result.top) && Number.isFinite(result.left));
});

test('never covers the anchor when a side fits, across a grid of anchor positions and all four preferred sides', () => {
  const sides = ['bottom', 'top', 'right', 'left'];
  for (const preferred of sides) {
    for (let top = 0; top <= viewport.height - 40; top += 80) {
      for (let left = 0; left <= viewport.width - 40; left += 100) {
        const anchor = { top, left, width: 40, height: 24 };
        const result = placeAnchored({ anchor, panel, viewport, preferred, gap, margin });
        const placed = { top: result.top, left: result.left, width: panel.width, height: panel.height };
        assert.equal(overlaps(anchor, placed), false, `preferred=${preferred} anchor=${JSON.stringify(anchor)} placed at side=${result.side} top=${result.top} left=${result.left}`);
      }
    }
  }
});

test('the panel never renders outside the viewport for a reasonably sized anchor and panel', () => {
  const anchor = { top: 10, left: 10, width: 40, height: 24 };
  for (const preferred of ['bottom', 'top', 'right', 'left']) {
    const result = placeAnchored({ anchor, panel, viewport, preferred, gap, margin });
    assert.ok(result.top >= 0 && result.top + panel.height <= viewport.height);
    assert.ok(result.left >= 0 && result.left + panel.width <= viewport.width);
  }
});
