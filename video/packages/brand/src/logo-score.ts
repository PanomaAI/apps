/*
  Which mark on the page is the product's own logo. Every site has a dozen images that
  could be it — a customer wall, a partner strip, a social glyph, the hero illustration
  — and the one that is the brand is rarely the largest or the first. dembrandt scored
  this over a labelled set and its table is what runs here, ported faithfully so the
  numbers can be checked against theirs: header +50, the site's own name in the file
  or alt or class +40, "logo" in the class or id +30, an SVG whose aria-label says home
  or logo +40, wrapped in a link to the home page +30, top-left +10/+10, below the fold
  −50, an image larger than 800×500 −80 (that is an illustration), a long alt −40 (that
  is content). Icons declared in the head (manifest, mask-icon, apple-touch-icon,
  rel=icon) enter with fixed scores below any real header mark, so they win only when
  the page paints no logo at all.

  This file is pure and DOM-free: the live pass collects facts about each candidate
  inside the page and scores them here, where a test can check the table with a plain
  object. Ported from dembrandt lib/extractors/logo.ts and logo-heuristics.ts —
  Copyright (c) 2025 thevangelist, MIT License.
*/
import type { BrandLogo } from "./types.ts";

export type LogoContext = "header" | "footer" | "hero" | "body" | "head";
export type LogoSource = "img" | "svg" | "css-background" | "manifest" | "mask-icon" | "apple-touch-icon" | "icon";

export type LogoCandidate = {
  source: LogoSource;
  context: LogoContext;
  /** Absolute URL for a fetched asset; absent for an inline SVG, which carries `markup`. */
  url?: string;
  markup?: string;
  alt: string;
  className: string;
  id: string;
  ariaLabel: string;
  /** href of the closest <a>, raw. */
  linkHref: string;
  /** Painted box in document coordinates. */
  rect: { top: number; left: number; width: number; height: number };
  /** Intrinsic size (naturalWidth or viewBox), 0 when unknown. */
  natural: { width: number; height: number };
  /** Opaque background behind the mark, #rrggbb, or null when none was found. */
  background: string | null;
  /** Fill/stroke colours found inside an SVG. */
  colors: string[];
  /** Head icons only: the declared sizes attribute and manifest purpose. */
  sizes?: string;
  purpose?: string;
  /** Host of the image URL, for the cross-domain penalty. */
  srcHost?: string;
};

/*
  Does this href point at the site's own home page? Such a link is the strongest signal
  that the mark inside it is the site's own logo, wherever on the page it sits. Matches
  "/", the origin, and a localised root like /en or /en-us.
*/
export function isHomeHref(href: unknown, origin: unknown): boolean {
  if (typeof href !== "string") return false;
  let h = href.trim().toLowerCase();
  if (!h) return false;
  if (h === "/" || h === "./") return true;
  const o = (typeof origin === "string" ? origin : "").trim().toLowerCase().replace(/\/+$/, "");
  if (o && (h === o || h.startsWith(o + "/"))) h = h.slice(o.length) || "/";
  if (h === "/" || h === "./") return true;
  return /^\/[a-z]{2}([-_][a-z]{2})?\/?$/.test(h);
}

/*
  If an image's alt names a brand that is NOT this site, return that squashed brand
  name; otherwise null. Catches customer, integration and testimonial logos.
*/
export function thirdPartyBrandFromAlt(altText: unknown, siteDomain: unknown): string | null {
  if (typeof altText !== "string") return null;
  const brand = altText
    .replace(/\b(logos?|logotypes?|logomarks?|brandmarks?|wordmarks?|icons?|brands?|marks?)\b/gi, " ")
    .replace(/\.(svg|png|webp|avif|jpe?g|gif)\b/gi, " ")
    .replace(/\b(on[-_]?white|on[-_]?black|white|black|dark|light|colou?r|mono|full|small|large|[0-9]+x|2x|3x|v?[0-9]{1,4})\b/gi, " ")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
  if (brand.length < 2) return null;
  const site = (typeof siteDomain === "string" ? siteDomain : "").toLowerCase();
  if (!site) return null;
  if (brand === site || brand.includes(site) || site.includes(brand)) return null;
  return brand;
}

/*
  Is this mark big enough to be a logo rather than a UI icon? dembrandt's measured
  floor: no confirmed logo in the labelled set has a longer edge below 24px, while
  header search / menu / social glyphs are 16–20px squares.
*/
export const MIN_LOGO_LONG_EDGE = 24;

/* The default is the literal, not the constant above: this function is serialised into
   the page by its source, where module scope does not exist. */
export function isLogoSized(width: unknown, height: unknown, minLongEdge = 24): boolean {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return false;
  return Math.max(w, h) >= minLongEdge;
}

/** Fixed entry scores for head-declared icons, in dembrandt's source order. */
const HEAD_SCORES: Record<string, number> = {
  manifest: 25,
  "mask-icon": 20,
  "apple-touch-icon": 15,
  icon: 10,
};

/** The larger declared side of a `sizes="180x180"` attribute, 0 when absent or "any". */
export function declaredSize(sizes: string | undefined): number {
  if (!sizes) return 0;
  let best = 0;
  for (const m of sizes.matchAll(/(\d+)x(\d+)/gi)) best = Math.max(best, Number(m[1]), Number(m[2]));
  return best;
}

/** The page's own short name: "www.panoma.ai" → "panoma". */
export function siteDomainOf(hostname: string): string {
  return hostname.replace(/^www\./, "").split(".")[0].toLowerCase();
}

function apexOf(host: string): string {
  return host.split(".").slice(-2).join(".");
}

/** dembrandt's `scoreLogo`, over a collected candidate instead of a live element. */
export function scoreLogo(c: LogoCandidate, siteDomain: string, pageHost: string): number {
  if (c.context === "head") {
    let s = HEAD_SCORES[c.source] ?? 0;
    if (c.url && /\.svg(\?|#|$)/i.test(c.url)) s += 10;
    /* Bigger declared icons carry more of the mark: 512 → +5, 32 → +0. */
    s += Math.min(5, Math.floor(declaredSize(c.sizes) / 100));
    if (c.purpose && /maskable|monochrome/.test(c.purpose) && !/any/.test(c.purpose)) s -= 5;
    return s;
  }

  let score = 0;
  const alt = c.alt.toLowerCase();
  const className = c.className.toLowerCase();
  const id = c.id.toLowerCase();
  const ariaLabel = c.ariaLabel.toLowerCase();

  if (c.context === "header") score += 50;
  if (c.context === "footer") score += 20;
  if (c.context === "hero") score += 15;

  /* Compare against the asset's file name, never the whole URL: every image on a site
     is served from that site, so a customer-wall `Sanofi-Logo.png` must not score as ours. */
  const file = (c.url ?? "").toLowerCase().split(/[?#]/)[0].split("/").pop() ?? "";
  if (siteDomain && (file.includes(siteDomain) || alt.includes(siteDomain) || className.includes(siteDomain))) score += 40;
  if (className.includes("logo") || id.includes("logo")) score += 30;

  if (c.source === "svg" && (ariaLabel.includes("home") || ariaLabel.includes("logo"))) score += 40;

  const href = c.linkHref.toLowerCase();
  if (href && (href === "/" || href === `https://${pageHost}` || href === `https://${pageHost}/` || href === `http://${pageHost}` || href === `http://${pageHost}/`)) {
    score += 30;
  }

  if (c.rect.top < 200) score += 10;
  if (c.rect.left < 400) score += 10;
  if (c.rect.top > 500) score -= 50;

  /* An image hosted on another apex domain is somebody else's asset. */
  if (c.source === "img" && c.srcHost && pageHost) {
    const srcHost = c.srcHost.replace(/^www\./, "");
    const host = pageHost.replace(/^www\./, "");
    if (!srcHost.endsWith(host) && !host.endsWith(srcHost) && apexOf(srcHost) !== apexOf(host)) score -= 60;
  }

  const width = c.source === "img" ? c.natural.width || c.rect.width : c.rect.width;
  const height = c.source === "img" ? c.natural.height || c.rect.height : c.rect.height;
  if (width < 20 || height < 20) score -= 30;
  if (width > 800 || height > 500) score -= 80;
  else if (width > 600 || height > 400) score -= 40;
  if (alt.length > 50) score -= 40;
  if (width > height && width < 400 && width > 40 && height > 10 && height < 120) score += 15;

  return score;
}

/*
  dembrandt's `detectLogoType` by aspect ratio: a wide mark with words in its alt is a
  wordmark, a squarish one a logomark, a wide one without words is read as a wordmark
  too, and everything between is a combination. Head icons are icons.
*/
export function logoKind(c: Pick<LogoCandidate, "source" | "context" | "alt" | "rect" | "natural">): BrandLogo["kind"] {
  if (c.context === "head") return "icon";
  const text = c.alt.toLowerCase().trim();
  const hasText = text.length > 0 && !/^(logo|brand|icon)$/i.test(text);
  const w = c.rect.width || c.natural.width;
  const h = c.rect.height || c.natural.height;
  const ratio = w / (h || 1);
  if (hasText && ratio > 3) return "wordmark";
  if (ratio < 1.5 && ratio > 0.5) return "logomark";
  if (ratio > 2) return "wordmark";
  return "combination";
}

/**
 * The best candidate, with its score, or null. Ties keep document order (the list is
 * stable-sorted), so a page with two equal marks reports the first.
 */
export function pickLogo(candidates: LogoCandidate[], siteDomain: string, pageHost: string): { candidate: LogoCandidate; score: number } | null {
  const scored = candidates
    .filter((c) => c.context === "head" || isLogoSized(c.rect.width, c.rect.height))
    .map((candidate) => ({ candidate, score: scoreLogo(candidate, siteDomain, pageHost) }))
    .sort((a, b) => b.score - a.score);
  return scored[0] ?? null;
}
