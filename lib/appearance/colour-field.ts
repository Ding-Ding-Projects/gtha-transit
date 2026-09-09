/**
 * The pure geometry behind the colour picker's saturation/value square and hue
 * ring: pixel positions in, an HSV triple out, and back again.
 *
 * Kept free of the DOM so it is directly testable and so the canvas renderer,
 * the pointer-drag handler and the keyboard handler all agree on the same
 * mapping. A square that reads pointer position one way and paints its pixels
 * a different way is a picker that visibly disagrees with where you clicked.
 *
 * Hue is degrees in [0, 360). Saturation and value are percent in [0, 100],
 * matching the shape `lib/colour.ts`'s own `rgbToHsv` already returns, so a
 * caller never has to remember that this file uses a different scale.
 *
 * There is no `hsvToRgb` in `lib/colour.ts` -- only the forward direction. HSV
 * and HSL describe the same cone from two different poles, so rather than add a
 * second, parallel RGB-producing formula here, `hsvToRgb` below converts the
 * three numbers to HSL and then calls `lib/colour.ts`'s own `hslToRgb`. That
 * keeps exactly one function in the whole project that turns a hue into actual
 * sRGB bytes, which is the same reasoning `lib/colour.ts`'s own file header
 * gives for existing at all.
 */

import { hslToRgb, type Rgb } from '../colour.ts';

export type Hsv = { h: number; s: number; v: number };

const clampNumber = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** Wrap hue into [0, 360) and clamp saturation/value into [0, 100]. */
export function clampHsv(hsv: Hsv): Hsv {
  const wrapped = ((hsv.h % 360) + 360) % 360;
  return {
    h: Number.isFinite(wrapped) ? wrapped : 0,
    s: Number.isFinite(hsv.s) ? clampNumber(hsv.s, 0, 100) : 0,
    v: Number.isFinite(hsv.v) ? clampNumber(hsv.v, 0, 100) : 0,
  };
}

/**
 * A pointer position inside the saturation/value square to an HSV triple.
 *
 * The square's own hue is supplied by the caller (it comes from the ring, a
 * separate control) rather than read from anywhere here. `x`/`y` are clamped
 * into the square first, so a drag that runs past the edge under pointer
 * capture still lands on the nearest valid saturation and value rather than
 * producing a value outside [0, 100].
 */
export function fieldToHsv(x: number, y: number, width: number, height: number, hue: number): Hsv {
  const w = width > 0 ? width : 1;
  const h = height > 0 ? height : 1;
  const clampedX = clampNumber(x, 0, w);
  const clampedY = clampNumber(y, 0, h);
  return clampHsv({ h: hue, s: (clampedX / w) * 100, v: 100 - (clampedY / h) * 100 });
}

/** The inverse of `fieldToHsv`: where the selection thumb sits for a given HSV triple. */
export function hsvToField(h: number, s: number, v: number, width: number, height: number): { x: number; y: number } {
  const clamped = clampHsv({ h, s, v });
  return { x: (clamped.s / 100) * width, y: (1 - clamped.v / 100) * height };
}

/**
 * A pointer offset from the hue ring's centre to a hue in degrees.
 *
 * `dx`/`dy` are plain Cartesian offsets in the same pixel space the ring is
 * drawn in (screen coordinates, so positive `dy` is downward). `angleFromHue`
 * below is this function's exact inverse, which the test suite checks by round
 * -tripping every whole-degree hue through both functions.
 */
export function hueFromAngle(dx: number, dy: number): number {
  const degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

/** The angle, in radians, at which a hue's thumb sits on the ring. Inverse of `hueFromAngle`. */
export function angleFromHue(hue: number): number {
  const normalised = ((hue % 360) + 360) % 360;
  return (normalised * Math.PI) / 180;
}

const ARROW_STEP_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * One keyboard step on the saturation/value square: left/right move saturation,
 * up/down move value, one unit per press or ten with Shift held. Any other key
 * is a no-op that still normalises the input, so a caller can pipe every keydown
 * through this without first checking whether the key was one of the four.
 */
export function stepHsv(hsv: Hsv, key: string, shift: boolean): Hsv {
  if (!ARROW_STEP_KEYS.has(key)) return clampHsv(hsv);
  const amount = shift ? 10 : 1;
  const next = { ...hsv };
  if (key === 'ArrowUp') next.v += amount;
  else if (key === 'ArrowDown') next.v -= amount;
  else if (key === 'ArrowLeft') next.s -= amount;
  else next.s += amount;
  return clampHsv(next);
}

/** HSV to HSL, so the actual sRGB bytes can come from `lib/colour.ts`'s own `hslToRgb`. */
function hsvToHsl(h: number, s: number, v: number): [number, number, number] {
  const s1 = s / 100;
  const v1 = v / 100;
  const lightness = v1 * (1 - s1 / 2);
  const saturation = lightness === 0 || lightness === 1 ? 0 : (v1 - lightness) / Math.min(lightness, 1 - lightness);
  return [h, saturation * 100, lightness * 100];
}

/** The sRGB colour for an HSV triple, by way of `lib/colour.ts`'s own `hslToRgb`. */
export function hsvToRgb(h: number, s: number, v: number, alpha = 1): Rgb {
  const clamped = clampHsv({ h, s, v });
  const [hue, saturation, lightness] = hsvToHsl(clamped.h, clamped.s, clamped.v);
  return hslToRgb(hue, saturation, lightness, alpha);
}
