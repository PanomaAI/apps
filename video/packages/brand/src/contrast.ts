/*
  WCAG 2.x contrast, and nothing else. APCA is the better model and it is not free:
  apca-w3 ships under a "Limited W3 License" (personal or beta use only, commercial use
  by signed agreement, constants may not be modified), and tests/licenses.test.ts would
  rightly refuse it. The WCAG 2 formula is a public W3C specification and fits in a
  screen, so it is the gate for captions over footage and for choosing the ink that
  sits on the brand colour.

  Formulae from WCAG 2.1, "relative luminance" and "contrast ratio" definitions
  (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance,
  https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio). Thresholds from SC 1.4.3.
*/
import { hexToRgb } from "./color.ts";

/** WCAG 2.1 relative luminance of an opaque hex, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const c = hexToRgb(hex);
  if (!c) return 0;
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** (L1 + 0.05) / (L2 + 0.05), lighter over darker: 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/*
  SC 1.4.3: 4.5:1 for text, 3:1 for "large" text — 18pt, or 14pt bold. CSS maps 1pt to
  1.333px (CSS Values 4, absolute lengths), so the cut-offs are 24px and 18.66px bold.
*/
export const LARGE_TEXT_PX = 24;
export const LARGE_BOLD_TEXT_PX = 18.66;

export function requiredRatio(px: number, bold = false): number {
  return px >= LARGE_TEXT_PX || (bold && px >= LARGE_BOLD_TEXT_PX) ? 3 : 4.5;
}

export function passes(fg: string, bg: string, px: number, bold = false): boolean {
  return contrastRatio(fg, bg) >= requiredRatio(px, bold);
}

/** The better of white and black on a colour, by contrast ratio; white wins a tie. */
export function bestOn(hex: string): "#ffffff" | "#000000" {
  return contrastRatio(hex, "#ffffff") >= contrastRatio(hex, "#000000") ? "#ffffff" : "#000000";
}

/*
  The luminance at which white and black contrast equally against a background:
  (1.05 / (L + 0.05)) = ((L + 0.05) / 0.05) → L ≈ 0.179. Below it a surface is "dark"
  for every decision this package makes (a reversed logo, a dark default scheme).
*/
export const DARK_LUMINANCE = 0.179;

export function isDark(hex: string): boolean {
  return luminance(hex) <= DARK_LUMINANCE;
}
