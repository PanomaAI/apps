/* One editorial system dresses the film's added elements, never its recorded product. */
import type { EditorialTheme } from "@panoma/video-core";
import { COLOR_EXTREMES, EDITORIAL_COLORS } from "@panoma/video-core/theme";
import { mix, oklabChroma } from "@panoma/video-brand/direction";
import { bestOn, contrastRatio, isDark } from "@panoma/video-brand/contrast";

type Inks = { paper: string; ink: string; muted: string };

export type PromoThemeTokens = {
  id: EditorialTheme;
  accent: string;
  onAccent: string;
  secondary: string;
  onSecondary: string;
  accentOrigin: "brand" | "editorial";
  face: string;
  outline: string;
  /** Solid offset base as a fraction of the canvas short side; zero outside Block. */
  depth: number;
  surface: string;
  header: string;
  headerInk: string;
  rule: string;
  activeSurface: string;
  textInk: string;
  mutedInk: string;
  /** Radius as a fraction of the canvas short side. */
  corner: number;
  /** Inset border width at a 1080 px short side; scale by canvas short side / 1080. */
  border: number;
};

/** Grid supplies neutral film furniture; this never changes the recorded product's palette. */
export function promoGridGround(colors: Inks): Inks {
  return { ...EDITORIAL_COLORS.grid[isDark(colors.paper) ? "dark" : "light"] };
}

/** The same opaque ink has to survive the resting surface and its transient active row. */
function readable(candidate: string, surfaces: string[]): string {
  if (surfaces.every((surface) => contrastRatio(candidate, surface) >= 4.5)) return candidate;
  return [COLOR_EXTREMES.black, COLOR_EXTREMES.white].sort((a, b) => Math.min(...surfaces.map((surface) => contrastRatio(b, surface))) - Math.min(...surfaces.map((surface) => contrastRatio(a, surface))))[0];
}

/** Pure, whole-film tokens. A legacy brief with no theme retains the Flat composition. */
export function promoThemeTokens(theme: EditorialTheme | undefined, colors: Inks, brandAccent: string): PromoThemeTokens {
  if (theme !== undefined && theme !== "flat" && theme !== "vibrant" && theme !== "block" && theme !== "grid") throw new Error(`Unknown editorial theme: ${String(theme)}`);
  const id = theme ?? "flat";
  if (id === "grid") {
    const neutral = promoGridGround(colors);
    const surface = mix(neutral.paper, neutral.ink, 0.025);
    const activeSurface = mix(surface, neutral.ink, 0.042);
    const textInk = readable(neutral.ink, [surface, activeSurface]);
    const mutedInk = readable(neutral.muted, [surface, activeSurface]);
    const header = mix(neutral.paper, neutral.ink, 0.047);
    return {
      id, accent: textInk, onAccent: neutral.paper, accentOrigin: "editorial",
      secondary: surface, onSecondary: textInk, face: surface, outline: textInk, depth: 0,
      surface, header, headerInk: readable(mutedInk, [header]),
      rule: mix(neutral.paper, neutral.ink, 0.19), activeSurface, textInk, mutedInk,
      corner: 0.018, border: 1.5,
    };
  }
  const block = id === "block";
  const editorial = id !== "flat" && oklabChroma(brandAccent) < 0.05;
  const accent = editorial ? block ? EDITORIAL_COLORS.blockAccent : EDITORIAL_COLORS.vibrantAccent : brandAccent;
  const onAccent = contrastRatio(colors.ink, accent) >= 4.5 ? colors.ink : bestOn(accent);
  const surface = block ? mix(colors.paper, accent, 0.045) : mix(colors.paper, colors.ink, 0.025);
  const activeSurface = mix(surface, block ? accent : colors.ink, block ? 0.065 : 0.042);
  const secondary = block && editorial ? EDITORIAL_COLORS.blockSecondary : mix(surface, accent, 0.2);
  const textInk = readable(colors.ink, [surface, activeSurface]);
  const mutedInk = readable(colors.muted, [surface, activeSurface]);
  const header = id === "vibrant" ? accent : block ? surface : mix(colors.paper, colors.ink, 0.047);
  return {
    id, accent, onAccent, accentOrigin: editorial ? "editorial" : "brand",
    secondary, onSecondary: readable(colors.ink, [secondary]),
    face: surface, outline: textInk, depth: block ? 0.01 : 0,
    surface, header, headerInk: id === "vibrant" ? onAccent : readable(block ? textInk : mutedInk, [header]),
    rule: block ? textInk : mix(colors.paper, colors.ink, id === "vibrant" ? 0.38 : 0.19),
    activeSurface, textInk, mutedInk,
    corner: block ? 0.026 : id === "vibrant" ? 0.012 : 0.02,
    border: block ? 4 : id === "vibrant" ? 2 : 1.5,
  };
}
