import { isAbsolute, relative, resolve, sep } from "node:path";
/*
  @panoma/video-brand — the product's own design system, read from its repository and its
  live page, so a video ships in the product's brand instead of the engine's default theme.

  Two passes and a merge: `brandFromRepo` reads what source declares (tokens,
  manifest, logo files, the README's tone), `brandFromPage` measures what Chromium
  renders (head metadata, an area-weighted colour census, the fonts that actually
  drew, the colour scheme, the logo on the page), and `mergeBrand` reconciles them by
  the precedence the architecture fixes. `brandTheme` turns a profile into the exact
  shape of apps/render/src/lib/theme.ts, with one rule that matters more than any
  colour it picks: a primary with `confidence: "low"` keeps the engine's own theme. A video
  rendered in a colour nobody chose is the worst unattended failure this package can
  produce, and the way to never produce it is to refuse to guess.
*/
import type { Browser } from "playwright";
import { mix } from "./color.ts";
import { contrastRatio, isDark } from "./contrast.ts";
import { stackFor } from "./fonts.ts";
import { brandFromPage, type LiveOptions } from "./live.ts";
import { brandFromRepo } from "./repo.ts";
import { DEFAULT_HEX, defaultColors, mergeBrand } from "./roles.ts";
import { defaultType } from "./fonts.ts";
import { neutralTone } from "./tone.ts";
import type { BrandProfile } from "./types.ts";

export type { BrandColors, BrandLogo, BrandProfile, FontPick, Register, Scheme, Swatch } from "./types.ts";
export { brandFromRepo, scoreLogoFile, svgSize, pngSize } from "./repo.ts";
export { brandFromPage, launchBrowser, type LiveOptions, type LivePageContext } from "./live.ts";
export { mergeBrand, selectRoles, paletteOf, capConfidence, baseConfidence, originRank, pickSwatch, defaultColors, DEFAULT_HEX, NEAR_NEUTRAL_CHROMA, type Census, type ColorUse, type RoleHints } from "./roles.ts";
export { censusFromSnapshot, markTokens, topFamily, SNAPSHOT_STYLES, type DomSnapshot, type FontCensus, type SnapshotCensus } from "./census.ts";
export { scoreLogo, pickLogo, logoKind, isHomeHref, thirdPartyBrandFromAlt, isLogoSized, declaredSize, siteDomainOf, MIN_LOGO_LONG_EDGE, type LogoCandidate, type LogoContext, type LogoSource } from "./logo-score.ts";
export { tokensFromCss, tokensFromTailwindConfig, resolveVars, roleToken, colorTokens, blocksOf, ROLE_TOKEN_NAMES, type TokenSets } from "./tokens.ts";
export { toneOf, toneMetrics, registerOf, sentencesOf, syllables, neutralTone, TONE_SAMPLE_WORDS, type ToneMetrics } from "./tone.ts";
export { fontCategory, pickFont, firstFamily, googleFamilies, defaultType, stackFor, BUNDLED, STACKS, type FontCategory, type FontRole } from "./fonts.ts";
export { luminance, contrastRatio, passes, requiredRatio, bestOn, isDark, DARK_LUMINANCE, LARGE_TEXT_PX, LARGE_BOLD_TEXT_PX } from "./contrast.ts";
export { parseColor, normalizeHex, toHex, hexToRgb, hslToRgb, oklchToRgb, oklabToRgb, oklabChroma, saturation, hue, hueDistance, lightness, deltaE, mix, type Rgb } from "./color.ts";

export type ExtractOptions = {
  /** The project's checkout; skipped when absent. */
  root?: string;
  /** Its running page or deployed site; skipped when absent. */
  url?: string;
  /** Where the logo bytes land. Nothing is written inside the project. */
  outDir: string;
  browser?: Browser;
  viewport?: LiveOptions["viewport"];
};

/** Repository pass, then live pass, merged. Either input may be missing; both missing yields the default profile. */
export async function extractBrand(opts: ExtractOptions): Promise<BrandProfile> {
  const repo = opts.root ? await brandFromRepo(opts.root) : {};
  const liveOpts: LiveOptions = { outDir: opts.outDir };
  if (opts.browser) liveOpts.browser = opts.browser;
  if (opts.viewport) liveOpts.viewport = opts.viewport;
  const live = opts.url ? await brandFromPage(opts.url, liveOpts) : {};
  return mergeBrand(repo, live);
}

/** The engine's own profile: the theme every recipe renders with when nothing was extracted. */
export function defaultBrand(): BrandProfile {
  return {
    source: { extractedAt: new Date(0).toISOString() },
    name: "panoma video",
    colors: defaultColors(),
    tokens: {},
    scheme: { supports: ["light"], default: "light" },
    type: defaultType(),
    tone: neutralTone(),
  };
}

export type BrandTheme = {
  paper: string;
  card: string;
  ink: string;
  muted: string;
  faint: string;
  line: string;
  accent: string;
  good: string;
  inverted: { paper: string; ink: string; muted: string };
  fonts: { display: string; body: string; mono: string; editorial: string; wide: string };
  /** Which swatches were trusted; a recipe can say "set in the engine's theme" when none were. */
  branded: { colors: boolean; accent: boolean };
};

/**
 * The shape of apps/render/src/lib/theme.ts, from a profile. Surfaces and inks come
 * from the brand only when background AND text are trusted; the accent only when the
 * primary is. `good` uses the house status colour where readable, otherwise the ink.
 */
/**
 * The brand as a composition takes it. Two entry points build the same pieces —
 * `panoma-video auto` and `panoma-video render --project` — and each used to assemble
 * these three fields itself; one of them forgot, and rendered the product's film in the
 * engine's own gold, with the version number in the end card's name, over the branded
 * file.
 */
/*
  The same boundary test as `inside` in `@panoma/video-director`'s workspace module, and a
  deliberate second copy: `@panoma/video-brand` must not depend on the director — the
  dependency runs the other way. Three lines, and the alternative is a package boundary
  crossed for a predicate.
*/
const inside = (root: string, child: string) => {
  const p = relative(root, child);
  return !p || (p !== ".." && !p.startsWith(`..${sep}`) && !isAbsolute(p));
};

export function renderBrand(profile: BrandProfile, dir: string): { name: string; theme: BrandTheme; logo?: string } {
  /*
    Two bugs lived on one line here, and both were silent.

    The separator was written by hand — `startsWith(`${dir}/`)`. On Windows the workspace
    is `D:\…\ws` and its logo is `D:\…\ws\brand-logo.svg`, so the prefix never matched,
    `logo` came back undefined, and **every render on Windows dropped the product's mark
    with no error at all**. No test covered it; the first Windows CI run this project ever
    had is what made it findable, and even then only by reading, because nothing fails.

    And a string prefix is not a path boundary: `<ws>-old/logo.svg` beside `<ws>` satisfies
    it on any system, which would have served a file from a directory that is not the
    workspace.

    What comes out is a URL, not a path — `asset()` in the engine builds `/assets/<logo>`
    from it — so the separator has to be converted rather than kept. `relative` answers in
    the platform's spelling and this turns it back into the one a browser understands.
  */
  const file = profile.logo?.file;
  const within = file !== undefined && inside(dir, file) && resolve(dir) !== resolve(file);
  const logo = within ? relative(dir, file!).split(sep).join("/") : undefined;
  return { name: profile.name, theme: brandTheme(profile), ...(logo ? { logo } : {}) };
}

export function brandTheme(profile: BrandProfile): BrandTheme {
  const c = profile.colors;
  const trustAccent = c.primary.confidence !== "low";
  const trustColors = trustAccent && c.background.confidence !== "low" && c.text.confidence !== "low";

  const paper = trustColors ? c.background.hex : DEFAULT_HEX.paper;
  const ink = trustColors ? c.text.hex : DEFAULT_HEX.ink;
  const card = trustColors ? (c.surface.confidence !== "low" ? c.surface.hex : mix(paper, ink, 0.05)) : DEFAULT_HEX.card;
  const muted = trustColors ? (c.muted.confidence !== "low" ? c.muted.hex : mix(ink, paper, 0.2)) : DEFAULT_HEX.muted;
  /* The engine's own ratios: faint sits 33% of the way from ink to paper, a rule 12%. */
  const faint = trustColors ? mix(ink, paper, 0.33) : DEFAULT_HEX.faint;
  const line = trustColors ? mix(ink, paper, 0.88) : DEFAULT_HEX.line;
  const accent = trustAccent ? c.primary.hex : DEFAULT_HEX.accent;
  const invertedPaper = trustColors ? ink : DEFAULT_HEX.inverted.paper;
  const invertedInk = trustColors ? paper : DEFAULT_HEX.inverted.ink;

  return {
    paper,
    card,
    ink,
    muted,
    faint,
    line,
    accent,
    good: contrastRatio(DEFAULT_HEX.good, paper) >= 4.5 ? DEFAULT_HEX.good : ink,
    inverted: {
      paper: invertedPaper,
      ink: invertedInk,
      muted: trustColors ? mix(invertedInk, invertedPaper, isDark(invertedPaper) ? 0.2 : 0.25) : DEFAULT_HEX.inverted.muted,
    },
    fonts: {
      display: stackFor(profile.type.heading.family),
      body: stackFor(profile.type.body.family),
      mono: stackFor(profile.type.mono.family),
      editorial: stackFor("Fraunces"),
      wide: stackFor("Anybody"),
    },
    branded: { colors: trustColors, accent: trustAccent },
  };
}
