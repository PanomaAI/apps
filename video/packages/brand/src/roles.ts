/*
  From a census of colours to the seven roles a recipe needs. The census says what the
  page paints and how much; it does not say which of those is the brand, and the
  obvious answers are wrong in known ways: the most-used colour is the page background,
  the most saturated one is a status red, the first `--primary` found is a dark grey
  on a monochrome brand whose real hue lives in its CTA. dembrandt worked this out over
  a labelled set and its selection is what runs here — declared tokens beat CTA
  backgrounds beat the most chromatic recurring colour, a near-neutral primary is
  overridden by a chromatic token or CTA, the accent must sit more than 30° of hue away
  from the primary, and confidence is capped by how often a colour was actually seen.
  Ported from dembrandt lib/extractors/colors.ts — Copyright (c) 2025 thevangelist,
  MIT License — over a pure data shape so the rules are testable without a browser.

  `mergeBrand` then reconciles the repository pass with the live pass, swatch by
  swatch, by the precedence the architecture fixes: css-token / manifest / theme-color
  > CTA > area-weighted census > logo palette > default.
*/
import { LIGHT_PALETTE } from "@panoma/video-core/theme";
import { deltaE, hue, hueDistance, mix, oklabChroma, saturation } from "./color.ts";
import { bestOn, contrastRatio, isDark } from "./contrast.ts";
import { defaultType } from "./fonts.ts";
import { roleToken } from "./tokens.ts";
import { neutralTone } from "./tone.ts";
import type { BrandColors, BrandProfile, Swatch } from "./types.ts";

export type Confidence = Swatch["confidence"];

export type ColorUse = {
  hex: string;
  /** Elements painting it (background or text). */
  count: number;
  /** Painted background area, px², document coordinates. */
  area: number;
  /** Characters of text set in it. */
  chars: number;
  bgCount: number;
  /** Sum of dembrandt context scores over its occurrences. */
  score: number;
  /** Opaque CTA backgrounds in this colour. */
  ctaCount: number;
  isToken: boolean;
  statusCount: number;
  nonStatusCount: number;
  sources: string[];
};

export type Census = { colors: ColorUse[]; totalElements: number };

export type RoleHints = {
  /** Resolved light tokens, colours as hex. */
  tokens?: Record<string, string>;
  /** meta theme-color, light or unschemed variant. */
  themeColor?: string;
  manifestTheme?: string;
  manifestBackground?: string;
  maskIconColor?: string;
  /** Measured on the rendered body. */
  bodyBackground?: string;
  bodyText?: string;
  /** Fill/stroke colours of the chosen logo. */
  logoColors?: string[];
};

/** The shared Panoma light theme is the floor every unmeasured profile stands on. */
export const DEFAULT_HEX = LIGHT_PALETTE;

const low = (hex: string): Swatch => ({ hex, confidence: "low", origin: "default" });

export function defaultColors(): BrandColors {
  return {
    primary: low(DEFAULT_HEX.accent),
    accent: low(DEFAULT_HEX.accent),
    background: low(DEFAULT_HEX.paper),
    surface: low(DEFAULT_HEX.card),
    text: low(DEFAULT_HEX.ink),
    muted: low(DEFAULT_HEX.muted),
    onPrimary: low(DEFAULT_HEX.onAccent),
  };
}

const isHex = (v: string | undefined): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/.test(v);

/*
  A colour seen once is medium at best whatever its score says, and two occurrences
  are the least that can support "high" — dembrandt's MIN_COUNT_FOR_HIGH = 3 and
  MIN_COUNT_FOR_MEDIUM = 2.
*/
export const MIN_COUNT_FOR_HIGH = 3;
export const MIN_COUNT_FOR_MEDIUM = 2;

export function capConfidence(confidence: Confidence, count: number): Confidence {
  if (confidence === "high" && count < MIN_COUNT_FOR_HIGH) return count >= MIN_COUNT_FOR_MEDIUM ? "medium" : "low";
  if (confidence === "medium" && count < MIN_COUNT_FOR_MEDIUM) return "low";
  return confidence;
}

/** dembrandt's confidence from context score, before the usage cap. */
export function baseConfidence(use: ColorUse): Confidence {
  if (use.isToken) return use.score > 5 ? "high" : "medium";
  return use.score > 20 ? "high" : use.score > 5 ? "medium" : "low";
}

function confidenceOf(use: ColorUse): Confidence {
  return capConfidence(baseConfidence(use), use.count);
}

/** HSV-style saturation used by the structural filter: (max − min) / max. */
function hsvSaturation(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  return max > 0 ? (max - Math.min(r, g, b)) / max : 0;
}

/* Layout fill and incidental decoration, dembrandt's `isStructuralColor`. */
function isStructural(use: ColorUse, totalElements: number): boolean {
  if (use.isToken) return false;
  const usagePercent = (use.count / Math.max(1, totalElements)) * 100;
  const sat = hsvSaturation(use.hex);
  if (usagePercent > 40 && use.score < use.count * 1.2 && sat <= 0.2) return true;
  if (use.bgCount === 0 && use.score < use.count * 1.5 && sat > 0.3) return true;
  return false;
}

/**
 * The curated palette: frequency threshold max(3, 1% of elements), status-only colours
 * out unless declared or recurring as a CTA, structural fills out, then a ΔE < 15
 * merge that keeps the declared token (or the most used) as the representative.
 */
export function paletteOf(census: Census): ColorUse[] {
  const threshold = Math.max(3, Math.floor(census.totalElements * 0.01));
  const kept = census.colors
    .filter((use) => {
      const isCtaPrimary = use.ctaCount >= 2;
      if (!use.isToken && !isCtaPrimary && use.statusCount > 0 && use.nonStatusCount === 0) return false;
      const highScore = use.isToken || use.score >= 10 || (use.count > 0 && use.score / use.count >= 3);
      if (!highScore && use.count < threshold) return false;
      return !isStructural(use, census.totalElements);
    })
    .sort((a, b) => b.count - a.count);

  const merged = new Set<number>();
  const out: ColorUse[] = [];
  kept.forEach((use, index) => {
    if (merged.has(index)) return;
    const similar = [use];
    for (let i = index + 1; i < kept.length; i++) {
      if (merged.has(i)) continue;
      if (deltaE(use.hex, kept[i].hex) < 15) {
        similar.push(kept[i]);
        merged.add(i);
      }
    }
    similar.sort((a, b) => Number(b.isToken) - Number(a.isToken) || b.count - a.count);
    out.push(similar[0]);
  });
  return out;
}

/*
  dembrandt tests chroma in HSL, where a dark navy such as Tailwind's gray-900 #111827
  reads as 39% saturated although nobody would call it a colour — the very "dark text
  out-scores the brand hue" mis-pick its own comment describes. OKLab chroma settles it:
  Tailwind's slate/gray 900s sit at 0.032–0.040 and gray-500 at 0.023, while the
  quietest brand hues (a muted gold, a teal #0f766e) are 0.084–0.086. 0.05 is
  the gap between them.
*/
export const NEAR_NEUTRAL_CHROMA = 0.05;
const chromatic = (hex: string): boolean => saturation(hex) > 0.25 && oklabChroma(hex) >= NEAR_NEUTRAL_CHROMA;
const nearNeutral = (hex: string): boolean => saturation(hex) < 0.12 || oklabChroma(hex) < NEAR_NEUTRAL_CHROMA;

/* The browser's own link colours (HTML spec, "LinkText" / "VisitedText" in Chromium):
   an unstyled <a> paints them on every page, and they are nobody's brand. */
const UA_LINK_COLORS = new Set(["#0000ee", "#551a8b"]);
const isBrandCandidate = (u: ColorUse): boolean => u.isToken || !UA_LINK_COLORS.has(u.hex);

/* Body text is structurally low-intent (a <p> carries no class), so an ink's confidence
   comes from how often it is set, not from what its container is called. */
const inkSwatch = (use: ColorUse, origin: string): Swatch => ({ hex: use.hex, confidence: capConfidence(use.score > 5 ? "high" : "medium", use.count), origin });

export function selectRoles(census: Census | null, hints: RoleHints): BrandColors {
  const tokens = hints.tokens ?? {};
  const palette = census ? paletteOf(census).filter(isBrandCandidate) : [];
  /* Surfaces and inks come from the raw census: the ΔE merge that keeps two brand
     colours apart also folds an off-white card into the white page behind it. */
  const fills = (census?.colors ?? []).filter((u) => u.bgCount > 0 && u.area > 0 && saturation(u.hex) <= 0.2).sort((a, b) => b.area - a.area);
  const inks = (census?.colors ?? []).filter((u) => u.chars > 0 && isBrandCandidate(u)).sort((a, b) => b.chars - a.chars);
  const swatchOf = (use: ColorUse, origin: string): Swatch => ({ hex: use.hex, confidence: confidenceOf(use), origin });

  /* ---- primary ---- */
  let primary: Swatch | null = null;
  const primaryToken = roleToken(tokens, "primary");
  if (primaryToken && isHex(primaryToken.value)) {
    primary = { hex: primaryToken.value, confidence: "high", origin: `css-token:${primaryToken.name}` };
  }
  const declared: [string | undefined, string, Confidence][] = [
    [hints.themeColor, "theme-color", "high"],
    [hints.manifestTheme, "manifest", "high"],
    [hints.maskIconColor, "mask-icon", "medium"],
  ];
  if (!primary) {
    for (const [hex, origin, confidence] of declared) {
      /* A neutral theme-color is the page chrome, not the brand; it informs the background instead. */
      if (isHex(hex) && chromatic(hex)) {
        primary = { hex, confidence, origin };
        break;
      }
    }
  }
  if (!primary) {
    /* Require two CTA occurrences so a single "Sign up" button does not dominate. */
    const cta = palette.filter((u) => u.ctaCount >= 2).sort((a, b) => b.score - a.score)[0];
    if (cta) primary = swatchOf(cta, "cta");
  }
  if (!primary) {
    const best = palette
      .filter((u) => confidenceOf(u) !== "low" && saturation(u.hex) > 0.15)
      .sort((a, b) => b.count + (b.isToken ? 20 : 0) - (a.count + (a.isToken ? 20 : 0)) || saturation(b.hex) - saturation(a.hex))[0];
    if (best) primary = swatchOf(best, "census");
  }
  if (!primary && hints.logoColors?.length) {
    const fromLogo = hints.logoColors.filter(chromatic).sort((a, b) => saturation(b) - saturation(a))[0];
    if (fromLogo) primary = { hex: fromLogo, confidence: "medium", origin: "logo" };
  }
  if (!primary) primary = low(DEFAULT_HEX.accent);

  /* Near-neutral primaries are the dominant mis-pick: a dark text colour out-scores the
     real hue. Only the strongest signals may override — a declared colour or a CTA. */
  if (nearNeutral(primary.hex)) {
    const declaredChromatic = declared.find(([hex]) => isHex(hex) && chromatic(hex));
    const fromCensus = palette
      .filter((u) => chromatic(u.hex) && (u.isToken || u.ctaCount >= 1))
      .sort(
        (a, b) =>
          b.count + (b.isToken ? 20 : 0) + (b.ctaCount ? 20 : 0) - (a.count + (a.isToken ? 20 : 0) + (a.ctaCount ? 20 : 0)) ||
          saturation(b.hex) - saturation(a.hex),
      )[0];
    if (declaredChromatic) {
      primary = { hex: declaredChromatic[0] as string, confidence: declaredChromatic[2], origin: `${declaredChromatic[1]} (neutral ${primary.origin} overridden)` };
    } else if (fromCensus) {
      primary = { ...swatchOf(fromCensus, fromCensus.ctaCount ? "cta" : "census"), origin: `${fromCensus.ctaCount ? "cta" : "census"} (neutral ${primary.origin} overridden)` };
    }
  }

  /* ---- accent: the most saturated colour on a clearly different hue ---- */
  const primaryHue = hue(primary.hex);
  const farFromPrimary = (hex: string): boolean => hex !== primary.hex && (primaryHue < 0 || hueDistance(hue(hex), primaryHue) > 30);
  let accent: Swatch | null = null;
  const accentUse = palette
    .filter((u) => confidenceOf(u) !== "low" && chromatic(u.hex) && farFromPrimary(u.hex))
    .sort((a, b) => saturation(b.hex) - saturation(a.hex))[0];
  if (accentUse) accent = swatchOf(accentUse, "census");
  if (!accent) {
    const accentToken = roleToken(tokens, "accent");
    if (accentToken && isHex(accentToken.value) && chromatic(accentToken.value) && farFromPrimary(accentToken.value)) {
      accent = { hex: accentToken.value, confidence: "high", origin: `css-token:${accentToken.name}` };
    }
  }
  if (!accent && hints.logoColors?.length) {
    const fromLogo = hints.logoColors.filter((h) => chromatic(h) && farFromPrimary(h)).sort((a, b) => saturation(b) - saturation(a))[0];
    if (fromLogo) accent = { hex: fromLogo, confidence: "medium", origin: "logo" };
  }
  if (!accent) accent = { hex: primary.hex, confidence: primary.confidence === "low" ? "low" : "medium", origin: "primary" };

  /* ---- background ---- */
  let background: Swatch | null = null;
  const bgToken = roleToken(tokens, "background");
  if (bgToken && isHex(bgToken.value)) background = { hex: bgToken.value, confidence: "high", origin: `css-token:${bgToken.name}` };
  if (!background && isHex(hints.manifestBackground)) background = { hex: hints.manifestBackground, confidence: "high", origin: "manifest" };
  if (!background && isHex(hints.bodyBackground)) background = { hex: hints.bodyBackground, confidence: "high", origin: "body" };
  if (!background && isHex(hints.themeColor) && !chromatic(hints.themeColor)) background = { hex: hints.themeColor, confidence: "medium", origin: "theme-color" };
  if (!background && fills[0]) background = swatchOf(fills[0], "census");
  if (!background) background = low(DEFAULT_HEX.paper);

  /* ---- text ---- */
  let text: Swatch | null = null;
  const textToken = roleToken(tokens, "text");
  if (textToken && isHex(textToken.value)) text = { hex: textToken.value, confidence: "high", origin: `css-token:${textToken.name}` };
  if (!text && isHex(hints.bodyText) && contrastRatio(hints.bodyText, background.hex) >= 3) text = { hex: hints.bodyText, confidence: "high", origin: "body" };
  if (!text) {
    const ink = inks.find((u) => contrastRatio(u.hex, background.hex) >= 4.5);
    if (ink) text = inkSwatch(ink, "census");
  }
  if (!text) text = background.confidence === "low"
    ? low(DEFAULT_HEX.ink)
    : { hex: bestOn(background.hex), confidence: "medium", origin: "derived" };

  /* ---- surface: a second neutral fill, on the same side of dark as the background ---- */
  let surface: Swatch | null = null;
  const surfaceToken = roleToken(tokens, "surface");
  if (surfaceToken && isHex(surfaceToken.value)) surface = { hex: surfaceToken.value, confidence: "high", origin: `css-token:${surfaceToken.name}` };
  if (!surface) {
    const fill = fills.find((u) => deltaE(u.hex, background.hex) > 2 && isDark(u.hex) === isDark(background.hex));
    if (fill) surface = swatchOf(fill, "census");
  }
  if (!surface) surface = background.confidence === "low" && text.confidence === "low"
    ? low(DEFAULT_HEX.card)
    : { hex: mix(background.hex, text.hex, 0.05), confidence: "medium", origin: "derived" };

  /* ---- muted: a quieter ink that still reads (3:1 to 7:1 against the background) ---- */
  let muted: Swatch | null = null;
  const mutedToken = roleToken(tokens, "muted");
  if (mutedToken && isHex(mutedToken.value) && contrastRatio(mutedToken.value, background.hex) >= 3) {
    muted = { hex: mutedToken.value, confidence: "high", origin: `css-token:${mutedToken.name}` };
  }
  if (!muted) {
    const quiet = inks.find((u) => {
      const ratio = contrastRatio(u.hex, background.hex);
      return u.hex !== text.hex && ratio >= 3 && ratio <= 7;
    });
    if (quiet) muted = inkSwatch(quiet, "census");
  }
  if (!muted) muted = background.confidence === "low" && text.confidence === "low"
    ? low(DEFAULT_HEX.muted)
    : { hex: mix(text.hex, background.hex, 0.35), confidence: "medium", origin: "derived" };

  /* ---- onPrimary ---- */
  let onPrimary: Swatch | null = null;
  const onToken = roleToken(tokens, "onPrimary");
  if (onToken && isHex(onToken.value)) onPrimary = { hex: onToken.value, confidence: "high", origin: `css-token:${onToken.name}` };
  if (!onPrimary) onPrimary = primary.confidence === "low"
    ? low(DEFAULT_HEX.onAccent)
    : { hex: bestOn(primary.hex), confidence: "high", origin: "wcag" };

  return { primary, accent, background, surface, text, muted, onPrimary };
}

/* The precedence the architecture fixes, lower is stronger. */
export function originRank(origin: string): number {
  const head = origin.split(/[:\s(]/)[0];
  switch (head) {
    case "css-token":
    case "manifest":
    case "theme-color":
      return 0;
    case "mask-icon":
    case "wcag":
      return 1;
    case "cta":
      return 2;
    case "body":
    case "census":
      return 3;
    case "logo":
      return 4;
    case "primary":
    case "derived":
      return 5;
    default:
      return 9;
  }
}

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

/** The stronger of two swatches; a tie keeps the first (the repository's). */
export function pickSwatch(a: Swatch | undefined, b: Swatch | undefined): Swatch {
  if (!a) return b ?? low(DEFAULT_HEX.accent);
  if (!b) return a;
  const ra = originRank(a.origin) * 10 + CONFIDENCE_RANK[a.confidence];
  const rb = originRank(b.origin) * 10 + CONFIDENCE_RANK[b.confidence];
  return rb < ra ? b : a;
}

/**
 * Repository pass + live pass → one profile. Per swatch by precedence; tokens with the
 * repository winning (source beats a deployed build); scheme and type from the live
 * pass when it exists (they are measured there); logo by score; tone from the README.
 */
export function mergeBrand(repo: Partial<BrandProfile>, live: Partial<BrandProfile>): BrandProfile {
  const defaults = defaultColors();
  const roles = Object.keys(defaults) as (keyof BrandColors)[];
  const colors = Object.fromEntries(roles.map((role) => [role,
    repo.colors?.[role] || live.colors?.[role]
      ? pickSwatch(repo.colors?.[role], live.colors?.[role])
      : defaults[role],
  ])) as BrandColors;

  const type = defaultType();
  for (const role of ["heading", "body", "mono"] as const) {
    const r = repo.type?.[role];
    const l = live.type?.[role];
    type[role] = l?.detected ? l : r?.detected ? r : (l ?? r ?? type[role]);
  }

  const repoLogo = repo.logo;
  const liveLogo = live.logo;
  const logo = repoLogo && liveLogo ? (liveLogo.score > repoLogo.score ? liveLogo : repoLogo) : (repoLogo ?? liveLogo);

  const profile: BrandProfile = {
    source: {
      ...(live.source?.url ? { url: live.source.url } : {}),
      ...(repo.source?.repoPath ? { repoPath: repo.source.repoPath } : {}),
      extractedAt: live.source?.extractedAt ?? repo.source?.extractedAt ?? new Date().toISOString(),
    },
    name: live.name ?? repo.name ?? "product",
    ...(live.name && live.nameEvidence?.value === live.name ? { nameEvidence: live.nameEvidence }
      : !live.name && repo.name && repo.nameEvidence?.value === repo.name ? { nameEvidence: repo.nameEvidence } : {}),
    colors,
    tokens: { ...(live.tokens ?? {}), ...(repo.tokens ?? {}) },
    scheme: live.scheme ?? repo.scheme ?? { supports: ["light"], default: "light" },
    type,
    tone: repo.tone ?? live.tone ?? neutralTone(),
  };
  if (logo) profile.logo = logo;
  return profile;
}
