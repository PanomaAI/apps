/*
  The look of the film reaching the frame.

  Until this file existed, `apps/render/src/lib/theme.ts` was the palette of every
  recipe and every shared component — eleven importers of one module constant — so every
  product's film was shot on the engine's own paper and its own gold, and the one exception
  (FeatureSpotlight, which takes a brand prop) proved it by looking different.

  A composition now provides its `Direction` at the root and every component reads it
  from context. Three reasons this is a context and not a prop:

  - A scene is re-rendered per frame by `renderFrameHtml`, so a provider costs one object
    per frame and no state (`packages/engine/src/context.tsx`).
  - Threading a theme through ProductWindow, KineticTitle, KineticCaptions and Backdrop
    as props would touch every call site in every recipe, which is the change most likely
    to be got subtly wrong in one of them and never noticed.
  - The default is the engine's light direction, so the repository's own briefs use
    Panoma's central palette — proved by `tests/house-style.test.ts`.

  `useColor()` returns the SHAPE of the old `color` constant on purpose: the migration of
  a component is one import and one line inside it, and a reviewer can see that nothing
  else moved.
*/
import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_DIRECTION, alphaOf, type Direction } from "@panoma/video-brand/direction";
import { contrastRatio } from "@panoma/video-brand/contrast";
import { PANOMA_LIGHT } from "@panoma/video-core/theme";

/** The palette in the shape every recipe already writes: `color.paper`, `color.ink`, … */
export type Palette = {
  paper: string;
  card: string;
  ink: string;
  muted: string;
  faint: string;
  line: string;
  accent: string;
  /** House success when readable; the film's ink preserves status glyph contrast otherwise. */
  good: string;
  inverted: { paper: string; ink: string; muted: string };
};

export const GOOD = PANOMA_LIGHT.success;

const Ctx = createContext<Direction>(DEFAULT_DIRECTION);

export const ThemeProvider: React.FC<{ direction?: Direction; children: ReactNode }> = ({ direction, children }) => (
  <Ctx.Provider value={direction ?? DEFAULT_DIRECTION}>{children}</Ctx.Provider>
);

/** The whole direction: rhythm, furniture, sound and the reasons behind every colour. */
export function useDirection(): Direction {
  return useContext(Ctx);
}

export function paletteOf(d: Direction): Palette {
  return {
    paper: d.stage.hex,
    card: d.plate.hex,
    ink: d.ink.hex,
    muted: d.muted.hex,
    faint: d.faint.hex,
    line: d.line.hex,
    accent: d.accent.hex,
    good: contrastRatio(GOOD, d.stage.hex) >= 4.5 ? GOOD : d.ink.hex,
    inverted: { paper: d.inverted.stage, ink: d.inverted.ink, muted: d.inverted.muted },
  };
}

export function useColor(): Palette {
  return paletteOf(useContext(Ctx));
}

/**
 * The ink at an alpha. It was `rgba(250, 250, 250, a)` — the engine's ink, written out — in
 * every caller, which painted a white overlay on a light product.
 */
export function useInkAlpha(): (alpha: number) => string {
  const ink = useContext(Ctx).ink.hex;
  return (alpha: number) => alphaOf(ink, alpha);
}

/**
 * The scrim behind type over footage: the product's own stage at an alpha, never black.
 * Contrast and occlusion are two different problems; this one is contrast.
 */
export function useScrim(): (alpha?: number) => string {
  const { scrim } = useContext(Ctx);
  return (alpha?: number) => alphaOf(scrim.hex, alpha ?? scrim.alpha);
}

/**
 * The film's two extremes, which are not black and white.
 *
 * A veil is a POP — a flash on a cut, the sheen on a sweep, the ring around a pressed
 * control — or a GROUND: the stage itself at an alpha, for the edge drawn AROUND
 * something inked, which has to go the other way from the ink. Every one of them was
 * written as `rgba(0,0,0,…)` or `rgba(255,255,255,…)`, which is correct on the engine's
 * near-black stage and wrong on a light product's: a black gradient over `#e1e1e1`
 * reads as dirt, and a white flash on it is a frame nobody sees. So a pop reaches
 * whatever contrasts the stage — white on a dark film, the product's own ink on a
 * light one, which is what `inverted.stage` already is.
 *
 * There was a third, `shadow`: the film's deep end, for the darkness an object casts,
 * a vignette, the gradient under a caption. It is gone, and so is every one of those.
 * Nothing in a film this engine makes casts a shadow — no glow around a plate, no halo behind a
 * letter, no vignette closing on the frame — and the surest way to keep it that way is
 * for there to be no colour to draw one in. tests/house-style.test.ts is the other half.
 */
export function veilOf(d: Direction): { pop: (alpha: number) => string; ground: (alpha: number) => string } {
  return {
    pop: (alpha: number) => alphaOf(d.inverted.stage, alpha),
    ground: (alpha: number) => alphaOf(d.stage.hex, alpha),
  };
}

export function useVeil(): ReturnType<typeof veilOf> {
  return veilOf(useContext(Ctx));
}
