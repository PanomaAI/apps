/*
  A small CSS colour parser, written here rather than depended on. The repo pass reads
  design tokens out of stylesheets with no browser to resolve them, and those tokens
  arrive in every notation a framework ever chose: shadcn v3 stores a bare
  `222.2 47.4% 11.2%` (the hsl() is added at the use site), shadcn v4 and Tailwind v4
  write oklch(), older themes write hsl()/rgb(), manifests write hex. Everything here
  is normalised to one grammar — lowercase #rrggbb plus an alpha — so the role
  selection compares identities and never strings. Culori would do this in one call;
  it would also be a dependency for four conversions, and this package's rule is that
  images go through Chromium and colours through this file.

  Out of scope, on purpose: lab()/lch() (D50, a Bradford adaptation nobody's tokens
  need) and CSS Color 4 gamut mapping — an out-of-gamut oklch() is clamped per channel,
  which differs from the spec's chroma reduction by a hair on colours no brand token
  uses. Both are recorded in docs/brand.md as limits.
*/

export type Rgb = { r: number; g: number; b: number; a: number };

/* CSS named colours, per CSS Color Level 4 §6.1 (https://www.w3.org/TR/css-color-4/#named-colors). */
const NAMED_COLORS: Record<string, string> = Object.fromEntries(
  (
    "aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 " +
    "black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 " +
    "chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff " +
    "darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 " +
    "darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 " +
    "darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f " +
    "darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 " +
    "dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc " +
    "ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 " +
    "honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa " +
    "lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff " +
    "lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 " +
    "lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 " +
    "lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 " +
    "mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 " +
    "mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 " +
    "midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 " +
    "oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa " +
    "palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f " +
    "pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f " +
    "royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee " +
    "sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa " +
    "springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 " +
    "violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32"
  )
    .split(" ")
    .map((pair) => pair.split(":") as [string, string]),
);

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const byte = (v: number): number => Math.round(clamp01(v) * 255);

/** "50%" → 0.5 of `scale`; "12" → 12; anything else → NaN. */
function num(token: string, percentScale = 1): number {
  const t = token.trim();
  if (t === "none") return 0;
  if (t.endsWith("%")) return (parseFloat(t) / 100) * percentScale;
  return parseFloat(t);
}

/** Hue in degrees from a CSS angle token (deg, grad, rad, turn, or unitless). */
function angle(token: string): number {
  const t = token.trim().toLowerCase();
  const v = parseFloat(t);
  if (!Number.isFinite(v)) return NaN;
  if (t.endsWith("grad")) return v * 0.9;
  if (t.endsWith("rad")) return (v * 180) / Math.PI;
  if (t.endsWith("turn")) return v * 360;
  return v;
}

/** Split "a, b, c / d" or "a b c / d" into components and an optional alpha. */
function parts(body: string, expected = 3): { comps: string[]; alpha: number } {
  let alpha = 1;
  let main = body;
  const slash = body.indexOf("/");
  if (slash >= 0) {
    alpha = num(body.slice(slash + 1));
    main = body.slice(0, slash);
  }
  const comps = main.split(/[\s,]+/).filter(Boolean);
  /* Legacy rgba(r, g, b, a): one more component than the space expects is the alpha. */
  if (slash < 0 && comps.length === expected + 1) alpha = num(comps.pop() as string);
  return { comps, alpha: Number.isFinite(alpha) ? clamp01(alpha) : 1 };
}

/* HSL → sRGB, CSS Color 4 §7.1 reference algorithm. */
export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = (((h % 360) + 360) % 360) / 30;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + hue) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: byte(f(0)), g: byte(f(8)), b: byte(f(4)) };
}

/*
  OKLab → sRGB. Matrices from Björn Ottosson, "A perceptual color space for image
  processing" (https://bottosson.github.io/posts/oklab/), published as public-domain
  reference code. Channels are clamped after the transfer function: see the file
  comment on gamut mapping.
*/
export function oklabToRgb(L: number, a: number, b: number): { r: number; g: number; b: number } {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const lin = {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
  /* sRGB transfer function, IEC 61966-2-1. */
  const gamma = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055);
  return { r: byte(gamma(lin.r)), g: byte(gamma(lin.g)), b: byte(gamma(lin.b)) };
}

/** OKLab chroma of a hex, the forward transform of `oklabToRgb`; 0 for greys, ~0.2 for a saturated brand hue. */
export function oklabChroma(hex: string): number {
  const c = hexToRgb(hex);
  if (!c) return 0;
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = lin(c.r);
  const g = lin(c.g);
  const b = lin(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return Math.sqrt(a * a + bb * bb);
}

export function oklchToRgb(L: number, C: number, H: number): { r: number; g: number; b: number } {
  const rad = (H * Math.PI) / 180;
  return oklabToRgb(L, C * Math.cos(rad), C * Math.sin(rad));
}

/** Parse any supported CSS colour to 8-bit sRGB + alpha; null when it is not one. */
export function parseColor(input: string | undefined | null): Rgb | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (!s || s.includes("var(") || s.includes("calc(")) return null;
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  const hex = s.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a] = h.split("").map((c) => parseInt(c + c, 16));
      return { r, g, b, a: h.length === 4 ? a / 255 : 1 };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }

  const named = NAMED_COLORS[s];
  if (named) return parseColor("#" + named);

  const fn = s.match(/^([a-z]+)\((.*)\)$/);
  if (fn) {
    const [, name, body] = fn;
    const { comps, alpha } = parts(body, name === "color" ? 4 : 3);
    if (comps.length < 3) return null;
    switch (name) {
      case "rgb":
      case "rgba": {
        const [r, g, b] = comps.map((c) => (c.endsWith("%") ? num(c, 255) : num(c)));
        if (![r, g, b].every(Number.isFinite)) return null;
        return { r: byte(r / 255), g: byte(g / 255), b: byte(b / 255), a: alpha };
      }
      case "hsl":
      case "hsla": {
        const h = angle(comps[0]);
        const sat = num(comps[1]);
        const light = num(comps[2]);
        if (![h, sat, light].every(Number.isFinite)) return null;
        return { ...hslToRgb(h, clamp01(sat), clamp01(light)), a: alpha };
      }
      case "oklch": {
        const L = comps[0].endsWith("%") ? num(comps[0]) : num(comps[0]);
        /* A chroma percentage is relative to 0.4, CSS Color 4 §9.2. */
        const C = comps[1].endsWith("%") ? num(comps[1], 0.4) : num(comps[1]);
        const H = angle(comps[2]);
        if (![L, C, H].every(Number.isFinite)) return null;
        return { ...oklchToRgb(clamp01(L), Math.max(0, C), H), a: alpha };
      }
      case "oklab": {
        const L = num(comps[0]);
        /* a/b percentages are relative to ±0.4, CSS Color 4 §9.1. */
        const a = comps[1].endsWith("%") ? num(comps[1], 0.4) : num(comps[1]);
        const b = comps[2].endsWith("%") ? num(comps[2], 0.4) : num(comps[2]);
        if (![L, a, b].every(Number.isFinite)) return null;
        return { ...oklabToRgb(clamp01(L), a, b), a: alpha };
      }
      case "color": {
        if (comps[0] !== "srgb" || comps.length < 4) return null;
        const [r, g, b] = comps.slice(1, 4).map((c) => num(c));
        if (![r, g, b].every(Number.isFinite)) return null;
        return { r: byte(r), g: byte(g), b: byte(b), a: alpha };
      }
      default:
        return null;
    }
  }

  /* shadcn v3: `222.2 47.4% 11.2%` — HSL components, the function added at the use site. */
  const bare = s.match(/^(-?[\d.]+(?:deg)?)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (bare) {
    return { ...hslToRgb(angle(bare[1]), clamp01(parseFloat(bare[2]) / 100), clamp01(parseFloat(bare[3]) / 100)), a: 1 };
  }
  return null;
}

export function toHex(c: { r: number; g: number; b: number }): string {
  const h = (v: number): string => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Any supported notation → "#rrggbb", or null. Alpha is dropped; use `parseColor` when it matters. */
export function normalizeHex(input: string | undefined | null): string | null {
  const c = parseColor(input);
  return c ? toHex(c) : null;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const c = parseColor(hex);
  return c ? { r: c.r, g: c.g, b: c.b } : null;
}

/*
  HSL saturation of an opaque hex, with near-black and near-white forced to 0. Ported
  from dembrandt's `chroma()` (lib/extractors/colors.ts, MIT, Copyright (c) 2025
  thevangelist): the 0.08/0.92 lightness cut-off is what keeps a #0a0a0a page
  background from reading as "chromatic" through rounding noise.
*/
export function saturation(hex: string): number {
  const c = hexToRgb(hex);
  if (!c) return 0;
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min || l < 0.08 || l > 0.92) return 0;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

/** HSL hue in degrees [0, 360), or -1 for an achromatic colour. */
export function hue(hex: string): number {
  const c = hexToRgb(hex);
  if (!c) return -1;
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return -1;
  let h: number;
  if (max === r) h = ((((g - b) / d) % 6) + 6) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

export function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/** HSL lightness, 0..1. */
export function lightness(hex: string): number {
  const c = hexToRgb(hex);
  if (!c) return 0;
  return (Math.max(c.r, c.g, c.b) + Math.min(c.r, c.g, c.b)) / 510;
}

/*
  CIE76 ΔE between two hexes, D65. The role selection merges shades closer than 15 —
  dembrandt's threshold, which collapses the anti-aliased and hover variants of one
  brand colour without collapsing two brand colours. sRGB→XYZ matrix and Lab constants
  from the CIE / Bruce Lindbloom's tables (http://www.brucelindbloom.com/).
*/
export function deltaE(hex1: string, hex2: string): number {
  const lab = (hex: string): [number, number, number] | null => {
    const c = hexToRgb(hex);
    if (!c) return null;
    const lin = (v: number): number => {
      v /= 255;
      return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
    };
    const r = lin(c.r);
    const g = lin(c.g);
    const b = lin(c.b);
    const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
    const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
    const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
    const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const a = lab(hex1);
  const b = lab(hex2);
  if (!a || !b) return 999;
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/** Linear blend of two hexes in sRGB: t = 0 → a, t = 1 → b. For derived surfaces and rules. */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a) ?? { r: 0, g: 0, b: 0 };
  const cb = hexToRgb(b) ?? { r: 0, g: 0, b: 0 };
  const k = clamp01(t);
  return toHex({ r: ca.r + (cb.r - ca.r) * k, g: ca.g + (cb.g - ca.g) * k, b: ca.b + (cb.b - ca.b) * k });
}
