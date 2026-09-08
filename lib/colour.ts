/**
 * Colour conversion, parsing and formatting, in one place.
 *
 * This exists because there were about to be two copies. The Material theme
 * generator in scripts/design/build-material-theme.mjs already solved tones in
 * OKLCH, measured contrast and checked gamut, at build time; the colour picker
 * needs the same arithmetic at run time in the browser. Two implementations of
 * a colour space agree until one of them is corrected, and then they disagree
 * silently: the generated theme and the picker showing you that theme would
 * describe the same colour differently, and nothing would fail.
 *
 * So the generator imports this too, and there is one set of numbers.
 *
 * Every conversion is exact where the space allows it and documents where it
 * does not. CMYK in particular is a naive device conversion with no profile
 * behind it, which is fine for reading a value off a design and wrong for print,
 * and says so rather than implying a fidelity it does not have.
 */

export type Rgb = { r: number; g: number; b: number; a: number };

/** The formats the translator can read and write. */
export const COLOUR_FORMATS = ['hex', 'hex8', 'rgb', 'rgba', 'hsl', 'hsla', 'hsv', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'cmyk'] as const;
export type ColourFormat = (typeof COLOUR_FORMATS)[number];

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const round = (value: number, places = 0) => {
  const factor = 10 ** places;
  // A negative zero prints as "-0", which reads as a different number.
  return (Math.round(value * factor) / factor) + 0;
};

/* ------------------------------------------------------------- named colours -- */

/**
 * The CSS named colours.
 *
 * Kept as a map rather than resolved through a canvas, so this works in Node,
 * in a worker and during a build, and so the same name resolves to the same
 * bytes everywhere rather than to whatever a browser happens to think.
 */
export const NAMED_COLOURS: Readonly<Record<string, string>> = Object.freeze({
  aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4', azure: '#f0ffff',
  beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000', blanchedalmond: '#ffebcd', blue: '#0000ff',
  blueviolet: '#8a2be2', brown: '#a52a2a', burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00',
  chocolate: '#d2691e', coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
  cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b', darkgray: '#a9a9a9',
  darkgreen: '#006400', darkgrey: '#a9a9a9', darkkhaki: '#bdb76b', darkmagenta: '#8b008b', darkolivegreen: '#556b2f',
  darkorange: '#ff8c00', darkorchid: '#9932cc', darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b', darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f', darkturquoise: '#00ced1',
  darkviolet: '#9400d3', deeppink: '#ff1493', deepskyblue: '#00bfff', dimgray: '#696969', dimgrey: '#696969',
  dodgerblue: '#1e90ff', firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22', fuchsia: '#ff00ff',
  gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', gold: '#ffd700', goldenrod: '#daa520', gray: '#808080',
  green: '#008000', greenyellow: '#adff2f', grey: '#808080', honeydew: '#f0fff0', hotpink: '#ff69b4',
  indianred: '#cd5c5c', indigo: '#4b0082', ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa',
  lavenderblush: '#fff0f5', lawngreen: '#7cfc00', lemonchiffon: '#fffacd', lightblue: '#add8e6', lightcoral: '#f08080',
  lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3', lightgreen: '#90ee90',
  lightgrey: '#d3d3d3', lightpink: '#ffb6c1', lightsalmon: '#ffa07a', lightseagreen: '#20b2aa', lightskyblue: '#87cefa',
  lightslategray: '#778899', lightslategrey: '#778899', lightsteelblue: '#b0c4de', lightyellow: '#ffffe0',
  lime: '#00ff00', limegreen: '#32cd32', linen: '#faf0e6', magenta: '#ff00ff', maroon: '#800000',
  mediumaquamarine: '#66cdaa', mediumblue: '#0000cd', mediumorchid: '#ba55d3', mediumpurple: '#9370db',
  mediumseagreen: '#3cb371', mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585', midnightblue: '#191970', mintcream: '#f5fffa', mistyrose: '#ffe4e1', moccasin: '#ffe4b5',
  navajowhite: '#ffdead', navy: '#000080', oldlace: '#fdf5e6', olive: '#808000', olivedrab: '#6b8e23',
  orange: '#ffa500', orangered: '#ff4500', orchid: '#da70d6', palegoldenrod: '#eee8aa', palegreen: '#98fb98',
  paleturquoise: '#afeeee', palevioletred: '#db7093', papayawhip: '#ffefd5', peachpuff: '#ffdab9', peru: '#cd853f',
  pink: '#ffc0cb', plum: '#dda0dd', powderblue: '#b0e0e6', purple: '#800080', rebeccapurple: '#663399',
  red: '#ff0000', rosybrown: '#bc8f8f', royalblue: '#4169e1', saddlebrown: '#8b4513', salmon: '#fa8072',
  sandybrown: '#f4a460', seagreen: '#2e8b57', seashell: '#fff5ee', sienna: '#a0522d', silver: '#c0c0c0',
  skyblue: '#87ceeb', slateblue: '#6a5acd', slategray: '#708090', slategrey: '#708090', snow: '#fffafa',
  springgreen: '#00ff7f', steelblue: '#4682b4', tan: '#d2b48c', teal: '#008080', thistle: '#d8bfd8',
  tomato: '#ff6347', turquoise: '#40e0d0', violet: '#ee82ee', wheat: '#f5deb3', white: '#ffffff',
  whitesmoke: '#f5f5f5', yellow: '#ffff00', yellowgreen: '#9acd32',
});

/** The name for an exact colour, when one of the CSS names is exactly it. */
export function nameFor(rgb: Rgb): string | null {
  if (rgb.a !== 1) return null;
  const hex = formatHex(rgb);
  for (const [name, value] of Object.entries(NAMED_COLOURS)) if (value === hex) return name;
  return null;
}

/* ------------------------------------------------------------------- sRGB -- */

export const toLinear = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
export const toGamma = (channel: number) => (channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055);

/** Is this triple inside the sRGB cube, within the tolerance a round trip needs? */
export const inGamut = ([r, g, b]: readonly number[]) => [r, g, b].every((channel) => channel >= -0.0001 && channel <= 1.0001);

export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((channel) => toLinear(channel / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast, which is a ratio between 1 and 21 and ignores alpha. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const light = Math.max(relativeLuminance(a), relativeLuminance(b));
  const dark = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (light + 0.05) / (dark + 0.05);
}

/** What a contrast ratio is good for, at the WCAG thresholds. */
export function contrastVerdict(ratio: number): { normal: 'AAA' | 'AA' | 'fail'; large: 'AAA' | 'AA' | 'fail' } {
  return {
    normal: ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : 'fail',
    large: ratio >= 4.5 ? 'AAA' : ratio >= 3 ? 'AA' : 'fail',
  };
}

/* --------------------------------------------------------------- OKLab/LCH -- */

/**
 * OKLab from a gamma-encoded sRGB triple in 0..1.
 *
 * This is the shared core: `rgbToOklab` below takes the 0..255 shape the picker
 * uses, and scripts/design/build-material-theme.mjs takes the 0..1 shape a theme
 * generator uses. Both call this, so there is one matrix rather than two that
 * agree until one is corrected.
 */
export function tripleToOklab([red, green, blue]: readonly number[]): [number, number, number] {
  const [r, g, b] = [red, green, blue].map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export const rgbToOklab = (rgb: Rgb): [number, number, number] => tripleToOklab([rgb.r / 255, rgb.g / 255, rgb.b / 255]);

/**
 * OKLab back to a gamma-encoded sRGB triple in 0..1, unclamped so the caller can
 * test gamut before deciding what to do about it.
 *
 * Gamma-encoded, not linear: `toGamma` is applied on the way out. This was called
 * `oklabToLinearRgb`, which is the opposite of what it returns, and a name that
 * describes the wrong colour space is worse than no name at all.
 */
export function oklabToRgbTriple([lightness, aStar, bStar]: readonly number[]): [number, number, number] {
  const l = (lightness + 0.3963377774 * aStar + 0.2158037573 * bStar) ** 3;
  const m = (lightness - 0.1055613458 * aStar - 0.0638541728 * bStar) ** 3;
  const s = (lightness - 0.0894841775 * aStar - 1.291485548 * bStar) ** 3;
  return [
    toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export const oklabToOklch = ([lightness, aStar, bStar]: readonly [number, number, number]): [number, number, number] => [
  lightness,
  Math.hypot(aStar, bStar),
  ((Math.atan2(bStar, aStar) * 180) / Math.PI + 360) % 360,
];

export const oklchToOklab = ([lightness, chroma, hue]: readonly [number, number, number]): [number, number, number] => [
  lightness,
  chroma * Math.cos((hue * Math.PI) / 180),
  chroma * Math.sin((hue * Math.PI) / 180),
];

/* -------------------------------------------------------------- CIE Lab/LCH -- */

/*
 * The D65 white point, matching the sRGB-to-XYZ matrix below it.
 *
 * These were D50 chromaticity coordinates (0.3457, 0.3585) paired with a D65
 * matrix, and the mismatch is invisible until you look for it: every conversion
 * still returned plausible numbers, and neutral grey came back with a chroma of
 * 11.7 where it must be 0. A colour space with the wrong illuminant is wrong
 * everywhere by a little, which is exactly the kind of error nobody notices.
 */
const D65 = [0.3127 / 0.3290, 1, (1 - 0.3127 - 0.3290) / 0.3290];
const cieF = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

export function rgbToLab(rgb: Rgb): [number, number, number] {
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((channel) => toLinear(channel / 255));
  const xyz = [
    0.4123907993 * r + 0.3575843394 * g + 0.1804807884 * b,
    0.2126390059 * r + 0.7151686788 * g + 0.0721923154 * b,
    0.0193308187 * r + 0.1191947798 * g + 0.9505321522 * b,
  ].map((value, index) => cieF(value / D65[index]));
  return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])];
}

export const labToLch = ([lightness, aStar, bStar]: readonly [number, number, number]): [number, number, number] => [
  lightness,
  Math.hypot(aStar, bStar),
  ((Math.atan2(bStar, aStar) * 180) / Math.PI + 360) % 360,
];

/* ---------------------------------------------------------------- HSL/HSV/HWB -- */

export function rgbToHsl(rgb: Rgb): [number, number, number] {
  const [r, g, b] = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), span = max - min;
  const lightness = (max + min) / 2;
  if (span === 0) return [0, 0, lightness * 100];
  const saturation = span / (1 - Math.abs(2 * lightness - 1));
  const hue = max === r ? ((g - b) / span + (g < b ? 6 : 0)) : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return [hue * 60, clamp(saturation) * 100, lightness * 100];
}

export function hslToRgb(hue: number, saturation: number, lightness: number, alpha = 1): Rgb {
  const s = clamp(saturation / 100), l = clamp(lightness / 100);
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const h = ((hue % 360) + 360) % 360 / 60;
  const second = chroma * (1 - Math.abs((h % 2) - 1));
  const [r, g, b] = h < 1 ? [chroma, second, 0] : h < 2 ? [second, chroma, 0] : h < 3 ? [0, chroma, second]
    : h < 4 ? [0, second, chroma] : h < 5 ? [second, 0, chroma] : [chroma, 0, second];
  const match = l - chroma / 2;
  return { r: (r + match) * 255, g: (g + match) * 255, b: (b + match) * 255, a: clamp(alpha) };
}

export function rgbToHsv(rgb: Rgb): [number, number, number] {
  const [r, g, b] = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), span = max - min;
  const hue = span === 0 ? 0 : max === r ? ((g - b) / span + (g < b ? 6 : 0)) : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return [hue * 60, max === 0 ? 0 : (span / max) * 100, max * 100];
}

/** HWB, which is HSV said the other way round: how much white and black are mixed in. */
export function rgbToHwb(rgb: Rgb): [number, number, number] {
  const [hue] = rgbToHsv(rgb);
  const [r, g, b] = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  return [hue, Math.min(r, g, b) * 100, (1 - Math.max(r, g, b)) * 100];
}

/* ------------------------------------------------------------------- CMYK -- */

/**
 * Naive device CMYK. There is no colour profile behind this and there cannot be
 * one here, so it is a reading aid rather than a print value, and the picker says
 * so beside it. Presenting it as press-ready would be the dishonest part.
 */
export function rgbToCmyk(rgb: Rgb): [number, number, number, number] {
  const [r, g, b] = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  const key = 1 - Math.max(r, g, b);
  if (key >= 1) return [0, 0, 0, 100];
  return [
    ((1 - r - key) / (1 - key)) * 100,
    ((1 - g - key) / (1 - key)) * 100,
    ((1 - b - key) / (1 - key)) * 100,
    key * 100,
  ];
}

export function cmykToRgb(c: number, m: number, y: number, k: number, alpha = 1): Rgb {
  const [cyan, magenta, yellow, key] = [c, m, y, k].map((value) => clamp(value / 100));
  return {
    r: 255 * (1 - cyan) * (1 - key),
    g: 255 * (1 - magenta) * (1 - key),
    b: 255 * (1 - yellow) * (1 - key),
    a: clamp(alpha),
  };
}

/* ------------------------------------------------------------------ parsing -- */

const HEX = /^#?([0-9a-f]{3,8})$/i;

/**
 * Read a colour from any of the formats this picker writes, plus a CSS name.
 *
 * Returns null rather than throwing or guessing. A picker that silently turns an
 * unparseable value into black loses whatever the person typed, which is worse
 * than telling them it could not be read.
 */
export function parseColour(input: string): Rgb | null {
  const text = String(input ?? '').trim().toLowerCase();
  if (!text) return null;

  const named = NAMED_COLOURS[text];
  if (named) return parseColour(named);
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const hex = HEX.exec(text);
  if (hex) {
    const digits = hex[1];
    const expand = (value: string) => parseInt(value.length === 1 ? value + value : value, 16);
    if (digits.length === 3 || digits.length === 4) {
      return {
        r: expand(digits[0]), g: expand(digits[1]), b: expand(digits[2]),
        a: digits.length === 4 ? expand(digits[3]) / 255 : 1,
      };
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        r: expand(digits.slice(0, 2)), g: expand(digits.slice(2, 4)), b: expand(digits.slice(4, 6)),
        a: digits.length === 8 ? expand(digits.slice(6, 8)) / 255 : 1,
      };
    }
    return null;
  }

  const call = /^([a-z]+)\(([^)]*)\)$/.exec(text);
  if (!call) return null;
  const [, name, body] = call;
  const parts = body.split(/[\s,/]+/).filter(Boolean);
  const value = (index: number, scale = 1) => {
    const raw = parts[index];
    if (raw === undefined) return NaN;
    const number = Number.parseFloat(raw);
    if (!Number.isFinite(number)) return NaN;
    return raw.endsWith('%') ? (number / 100) * scale : number;
  };
  const alpha = parts.length > (name === 'cmyk' ? 4 : 3) ? clamp(value(name === 'cmyk' ? 4 : 3, 1)) : 1;

  if (name === 'rgb' || name === 'rgba') {
    const [r, g, b] = [value(0, 255), value(1, 255), value(2, 255)];
    return [r, g, b].every(Number.isFinite) ? { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: alpha } : null;
  }
  if (name === 'hsl' || name === 'hsla') {
    const [h, s, l] = [value(0, 360), value(1, 100), value(2, 100)];
    return [h, s, l].every(Number.isFinite) ? hslToRgb(h, s, l, alpha) : null;
  }
  if (name === 'hwb') {
    const [h, w, b] = [value(0, 360), value(1, 100), value(2, 100)];
    if (![h, w, b].every(Number.isFinite)) return null;
    // HWB is defined by mixing: white and black over the pure hue.
    const white = clamp(w / 100), black = clamp(b / 100);
    if (white + black >= 1) { const grey = (white / (white + black)) * 255; return { r: grey, g: grey, b: grey, a: alpha }; }
    const pure = hslToRgb(h, 100, 50, 1);
    return {
      r: (pure.r / 255 * (1 - white - black) + white) * 255,
      g: (pure.g / 255 * (1 - white - black) + white) * 255,
      b: (pure.b / 255 * (1 - white - black) + white) * 255,
      a: alpha,
    };
  }
  if (name === 'oklch' || name === 'oklab') {
    const triple: [number, number, number] = name === 'oklch'
      ? oklchToOklab([value(0, 1), value(1, 0.4), value(2, 360)])
      : [value(0, 1), value(1, 0.4), value(2, 0.4)];
    if (!triple.every(Number.isFinite)) return null;
    const [r, g, b] = oklabToRgbTriple(triple);
    return { r: clamp(r) * 255, g: clamp(g) * 255, b: clamp(b) * 255, a: alpha };
  }
  if (name === 'cmyk') {
    const [c, m, y, k] = [value(0, 100), value(1, 100), value(2, 100), value(3, 100)];
    return [c, m, y, k].every(Number.isFinite) ? cmykToRgb(c, m, y, k, alpha) : null;
  }
  return null;
}

/* ---------------------------------------------------------------- formatting -- */

const byte = (channel: number) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, '0');

export const formatHex = (rgb: Rgb) => `#${byte(rgb.r)}${byte(rgb.g)}${byte(rgb.b)}`;
export const formatHex8 = (rgb: Rgb) => `${formatHex(rgb)}${byte(clamp(rgb.a) * 255)}`;

/** One colour written in one format. */
export function formatColour(rgb: Rgb, format: ColourFormat): string {
  const alpha = round(clamp(rgb.a), 3);
  switch (format) {
    case 'hex': return formatHex(rgb);
    case 'hex8': return formatHex8(rgb);
    case 'rgb': return `rgb(${round(rgb.r)} ${round(rgb.g)} ${round(rgb.b)})`;
    case 'rgba': return `rgb(${round(rgb.r)} ${round(rgb.g)} ${round(rgb.b)} / ${alpha})`;
    case 'hsl': { const [h, s, l] = rgbToHsl(rgb); return `hsl(${round(h, 1)} ${round(s, 1)}% ${round(l, 1)}%)`; }
    case 'hsla': { const [h, s, l] = rgbToHsl(rgb); return `hsl(${round(h, 1)} ${round(s, 1)}% ${round(l, 1)}% / ${alpha})`; }
    case 'hsv': { const [h, s, v] = rgbToHsv(rgb); return `hsv(${round(h, 1)} ${round(s, 1)}% ${round(v, 1)}%)`; }
    case 'hwb': { const [h, w, b] = rgbToHwb(rgb); return `hwb(${round(h, 1)} ${round(w, 1)}% ${round(b, 1)}%)`; }
    case 'lab': { const [l, a, b] = rgbToLab(rgb); return `lab(${round(l, 2)}% ${round(a, 2)} ${round(b, 2)})`; }
    case 'lch': { const [l, c, h] = labToLch(rgbToLab(rgb)); return `lch(${round(l, 2)}% ${round(c, 2)} ${round(h, 2)})`; }
    case 'oklab': { const [l, a, b] = rgbToOklab(rgb); return `oklab(${round(l * 100, 2)}% ${round(a, 4)} ${round(b, 4)})`; }
    case 'oklch': { const [l, c, h] = oklabToOklch(rgbToOklab(rgb)); return `oklch(${round(l * 100, 2)}% ${round(c, 4)} ${round(h, 2)})`; }
    case 'cmyk': { const [c, m, y, k] = rgbToCmyk(rgb); return `cmyk(${round(c, 1)}% ${round(m, 1)}% ${round(y, 1)}% ${round(k, 1)}%)`; }
  }
}

/** The same colour in every format, for the translator panel. */
export function translateColour(rgb: Rgb): Record<ColourFormat, string> {
  return Object.fromEntries(COLOUR_FORMATS.map((format) => [format, formatColour(rgb, format)])) as Record<ColourFormat, string>;
}

/* ------------------------------------------------------------- the rainbow -- */

/**
 * The animated rainbow is a sentinel, never a colour string.
 *
 * No colour string can change over time, so a stored value of `rainbow` is a
 * marker the renderer recognises. Keeping it out of anything that formats or
 * mixes colours is the load-bearing part: call sites routinely build a tint by
 * appending alpha to a stored value, and a sentinel there produces `rainbow33`,
 * which is not an error but an ignored declaration, so the surface renders with
 * no background and nothing says why.
 */
export const RAINBOW = 'rainbow';
export const isRainbow = (value: unknown): boolean => value === RAINBOW;

/** Speed as a level rather than a duration, because seconds are a unit nobody has an intuition for. */
export const RAINBOW_LEVELS = [1, 2, 3, 4, 5] as const;
export const RAINBOW_SECONDS: Readonly<Record<number, number>> = Object.freeze({ 1: 24, 2: 12, 3: 6, 4: 3, 5: 1.5 });
export const SHIPPED_RAINBOW_LEVEL = 3;

/** The animation duration for a level, falling back rather than emitting an invalid CSS time. */
export function rainbowDuration(level: unknown): string {
  const seconds = RAINBOW_SECONDS[Number(level)] ?? RAINBOW_SECONDS[SHIPPED_RAINBOW_LEVEL];
  return `${seconds}s`;
}
