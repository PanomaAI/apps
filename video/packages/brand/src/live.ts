/*
  The brand as the page renders it. Source declares intent; the browser shows what a
  viewer sees, and the two disagree often enough to need both: a `--primary` the page
  never paints, a webfont that failed to load and fell back to Times, a dark scheme the
  README does not mention. This pass opens the URL in Chromium and measures — head
  metadata by the specs that define it (theme-color with both media variants, the
  manifest, mask-icon and its colour, apple-touch-icon, rel=icon), an area-weighted
  colour census and a text-length-weighted font census from one
  `DOMSnapshot.captureSnapshot`, the fonts that actually rendered from
  `CSS.getPlatformFontsForNode`, and the colour scheme by rendering twice under
  `emulateMedia` and comparing what the body paints.

  Everything that runs inside the page is a self-contained function: Playwright ships
  it by source, so it may not close over this module. The pure heuristics it needs
  (`isHomeHref`, `thirdPartyBrandFromAlt`, `isLogoSized`) are shipped the same way,
  rehydrated with `new Function` from their own source — dembrandt's trick, which keeps
  one copy of each rule and lets tests call it directly.
*/
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";
import { redact } from "@panoma/video-core";
import { censusFromSnapshot, markTokens, SNAPSHOT_STYLES, topFamily, type DomSnapshot, type FontCensus } from "./census.ts";
import { normalizeHex } from "./color.ts";
import { isDark, luminance } from "./contrast.ts";
import { fontCategory, firstFamily, googleFamilies, pickFont } from "./fonts.ts";
import { collectHead, collectLogoCandidates, heuristicsSource, type HeadFacts } from "./live-page.ts";
import { declaredSize, isLogoSized, logoKind, pickLogo, siteDomainOf, type LogoCandidate } from "./logo-score.ts";
import { pngSize, svgSize } from "./repo.ts";
import { selectRoles } from "./roles.ts";
import { colorTokens } from "./tokens.ts";
import type { BrandLogo, BrandProfile, FontPick } from "./types.ts";

/**
 * A headless Chromium for callers that run several passes (the director, a test): one
 * launch shared across `brandFromPage` calls instead of one per page. The caller closes it.
 */
export function launchBrowser(): Promise<Browser> {
  return chromium.launch();
}

export type LivePageContext = { url: string; snapshot: string };

export type LiveOptions = {
  browser?: Browser;
  /** Where the chosen logo's bytes are written (`logo.svg` / `.png` / `.ico`). */
  outDir?: string;
  viewport?: { width: number; height: number };
  timeoutMs?: number;
  /** Read-only context from the page already opened for brand extraction; no second visit. */
  onPageContext?: (context: LivePageContext) => void | Promise<void>;
};

/* 1280×800: a laptop viewport, wide enough that desktop headers lay out as designed. */
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

type Manifest = { theme_color?: string; background_color?: string; name?: string; short_name?: string; icons?: { src: string; sizes?: string; purpose?: string }[] };

async function fetchManifest(context: BrowserContext, url: string): Promise<Manifest | null> {
  try {
    const res = await context.request.get(url, { timeout: 10_000 });
    if (!res.ok()) return null;
    return (await res.json()) as Manifest;
  } catch {
    return null;
  }
}

/** Body background after a colour-scheme emulation, read the way dembrandt does: first opaque ancestor, else white. */
async function bodyBackground(page: Page): Promise<string> {
  const raw = await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    let node: Element | null = document.body ?? document.documentElement;
    for (let hop = 0; hop < 5 && node; hop++) {
      const bg = getComputedStyle(node).backgroundColor;
      const m = bg.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+))?\)/);
      if (m && (m[1] === undefined || parseFloat(m[1]) >= 0.9)) return bg;
      node = node.parentElement;
    }
    return "rgb(255, 255, 255)";
  });
  return normalizeHex(raw) ?? "#ffffff";
}

/** The family Chromium actually drew the most glyphs of for one node, or undefined. */
async function renderedFamily(cdp: CDPSession, rootNodeId: number, selector: string): Promise<string | undefined> {
  try {
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: rootNodeId, selector });
    if (!nodeId) return undefined;
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    return [...fonts].sort((a, b) => b.glyphCount - a.glyphCount)[0]?.familyName || undefined;
  } catch {
    return undefined;
  }
}

function fontSource(family: string | undefined, head: HeadFacts): string {
  if (!family) return "system";
  const wanted = family.toLowerCase();
  if (head.googleFontLinks.some((href) => googleFamilies(href).some((f) => f.toLowerCase() === wanted))) return "google";
  if (head.fontFaces.some((f) => f.family.toLowerCase() === wanted)) return "self-hosted";
  return "system";
}

function pickFor(role: "heading" | "body" | "mono", computed: string | undefined, rendered: string | undefined, head: HeadFacts): FontPick {
  const stack = rendered ? `${rendered}, ${computed ?? ""}` : (computed ?? "");
  const pick = pickFont(stack, role, fontSource(computed ?? rendered, head));
  /* The category comes from everything known; the recorded name is what rendered. */
  pick.category = fontCategory(stack, role);
  if (computed) pick.detected = firstFamily(computed);
  return pick;
}

/** Head icons as logo candidates, in dembrandt's source order after the page's own marks. */
function headCandidates(head: HeadFacts, manifest: Manifest | null, base: string): LogoCandidate[] {
  const out: LogoCandidate[] = [];
  const abs = (href: string): string | null => {
    try {
      return new URL(href, base).href;
    } catch {
      return null;
    }
  };
  const blank = (source: LogoCandidate["source"], url: string, sizes?: string, purpose?: string): LogoCandidate => ({
    source, context: "head", url, alt: "", className: "", id: "", ariaLabel: "", linkHref: "",
    rect: { top: 0, left: 0, width: declaredSize(sizes), height: declaredSize(sizes) },
    natural: { width: declaredSize(sizes), height: declaredSize(sizes) }, background: null, colors: [],
    ...(sizes ? { sizes } : {}), ...(purpose ? { purpose } : {}),
  });
  for (const icon of manifest?.icons ?? []) {
    const url = icon.src && abs(icon.src);
    if (url) out.push(blank("manifest", url, icon.sizes, icon.purpose));
  }
  if (head.maskIcon?.href) {
    const url = abs(head.maskIcon.href);
    if (url) out.push(blank("mask-icon", url));
  }
  for (const icon of head.appleTouchIcons) {
    const url = abs(icon.href);
    if (url) out.push(blank("apple-touch-icon", url, icon.sizes));
  }
  for (const icon of head.icons) {
    const url = abs(icon.href);
    if (url) out.push(blank("icon", url, icon.sizes));
  }
  return out;
}

const EXT_BY_TYPE: Record<string, string> = { "image/svg+xml": "svg", "image/png": "png", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico", "image/jpeg": "jpg", "image/webp": "webp" };

/** Fetch (or serialise) the chosen mark, write it under outDir when given, and describe it. */
async function saveLogo(context: BrowserContext, chosen: { candidate: LogoCandidate; score: number }, outDir: string | undefined, pageBackground: string): Promise<BrandLogo | undefined> {
  const { candidate, score } = chosen;
  let bytes: Buffer | null = null;
  let ext = "svg";
  if (candidate.markup) {
    bytes = Buffer.from(candidate.markup, "utf8");
  } else if (candidate.url) {
    try {
      const res = await context.request.get(candidate.url, { timeout: 10_000 });
      if (!res.ok()) return undefined;
      bytes = await res.body();
      const type = (res.headers()["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      ext = EXT_BY_TYPE[type] ?? (candidate.url.split(/[?#]/)[0].match(/\.(svg|png|ico|jpe?g|webp)$/i)?.[1]?.toLowerCase() ?? "bin");
    } catch {
      return undefined;
    }
  }
  if (!bytes) return undefined;

  let { width, height } = candidate.natural.width > 0 ? candidate.natural : candidate.rect;
  if (ext === "svg" && !(width > 0)) {
    ({ width, height } = svgSize(bytes.toString("utf8")));
  } else if (ext === "png") {
    const s = pngSize(bytes);
    if (s.width > 0) ({ width, height } = s);
  } else if (ext === "ico" && bytes.length >= 8 && !(width > 0)) {
    /* ICONDIRENTRY: width and height bytes at offsets 6 and 7; 0 means 256. */
    width = bytes[6] || 256;
    height = bytes[7] || 256;
  }

  let file: string;
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    file = join(outDir, `logo.${ext}`);
    writeFileSync(file, bytes);
  } else {
    file = candidate.url ?? `data:image/svg+xml;utf8,${encodeURIComponent(candidate.markup ?? "")}`;
  }
  const background = candidate.background ?? pageBackground;
  return {
    file,
    kind: logoKind(candidate),
    width: Math.round(width || 0),
    height: Math.round(height || 0),
    reversed: isDark(background),
    origin: `${candidate.source}:${candidate.context}`,
    score,
  };
}

export async function brandFromPage(url: string, opts: LiveOptions = {}): Promise<Partial<BrandProfile>> {
  const browser = opts.browser ?? (await chromium.launch());
  const own = !opts.browser;
  const context = await browser.newContext({ viewport: opts.viewport ?? DEFAULT_VIEWPORT, colorScheme: "light" });
  const page = await context.newPage();
  const timeout = opts.timeoutMs ?? 30_000;
  try {
    try {
      await page.goto(url, { waitUntil: "load", timeout });
    } catch {
      /* A stalled third-party request must not sink the pass: read whatever loaded. */
    }
    await Promise.race([page.evaluate(() => document.fonts.ready.then(() => undefined)), new Promise((r) => setTimeout(r, 3000))]);

    const head = await page.evaluate(collectHead);
    const base = page.url();
    if (opts.onPageContext) {
      const snapshot = await page.locator("body").ariaSnapshot({ timeout: Math.min(timeout, 5000) }).catch(() => "");
      // Redact before truncating so a secret crossing the limit cannot leave a prefix.
      await opts.onPageContext({ url: redact(base).text, snapshot: redact(snapshot).text.slice(0, 6000) });
    }
    const pageHost = new URL(base).hostname;
    const siteDomain = siteDomainOf(pageHost);
    const manifest = head.manifestHref ? await fetchManifest(context, new URL(head.manifestHref, base).href) : null;

    /* One CDP call for the colour and font census. */
    const cdp = await context.newCDPSession(page);
    const snapshot = (await cdp.send("DOMSnapshot.captureSnapshot", {
      computedStyles: [...SNAPSHOT_STYLES],
      includeDOMRects: true,
      includeBlendedBackgroundColors: true,
    })) as unknown as DomSnapshot;
    const measured = censusFromSnapshot(snapshot);

    /* Tokens the page resolved on :root, normalised here. */
    const tokens: Record<string, string> = {};
    for (const [name, value] of Object.entries(head.rootVars)) {
      const hex = normalizeHex(value);
      tokens[name] = hex ?? value;
    }
    markTokens(measured.census, tokens);

    /* The fonts that actually rendered, for the h1 and the longest paragraph. */
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
    const renderedH1 = await renderedFamily(cdp, root.nodeId, "h1");
    const renderedP = await renderedFamily(cdp, root.nodeId, "[data-panoma-video-longest]");
    const fonts: FontCensus = measured.fonts;
    const headingComputed = fonts.h1 ?? topFamily(fonts.headings) ?? topFamily(fonts.body);
    const bodyComputed = head.bodyFamily && (fonts.body[head.bodyFamily] ?? 0) > 0 ? head.bodyFamily : (topFamily(fonts.body) ?? head.bodyFamily);
    const monoComputed = topFamily(fonts.mono);
    const type: BrandProfile["type"] = {
      heading: pickFor("heading", headingComputed, renderedH1, head),
      body: pickFor("body", bodyComputed, renderedP, head),
      mono: monoComputed ? pickFor("mono", monoComputed, undefined, head) : pickFont(undefined, "mono"),
    };

    /* Scheme: what the light and dark renders paint, plus what the page declares. */
    const defaultBg = measured.body.background;
    await page.emulateMedia({ colorScheme: "dark" });
    const darkBg = await bodyBackground(page);
    await page.emulateMedia({ colorScheme: "light" });
    const lightBg = await bodyBackground(page);
    const declaredScheme = (head.colorScheme ?? "").toLowerCase();
    const themeLight = head.themeColors.find((t) => !/dark/i.test(t.media ?? ""));
    const themeDark = head.themeColors.find((t) => /dark/i.test(t.media ?? ""));
    const differs = Math.abs(luminance(darkBg) - luminance(lightBg)) > 0.1;
    const supports: ("light" | "dark")[] = [];
    if (declaredScheme.includes("light") || differs || !isDark(lightBg)) supports.push("light");
    if (declaredScheme.includes("dark") || differs || themeDark !== undefined || isDark(lightBg)) supports.push("dark");
    const scheme: BrandProfile["scheme"] = { supports, default: isDark(defaultBg) ? "dark" : "light" };
    if (!scheme.supports.includes(scheme.default)) scheme.supports.push(scheme.default);

    /* Logo: the page's own marks scored by dembrandt's table, then the head icons. */
    const pageCandidates = (await page.evaluate(collectLogoCandidates, { siteDomain, heuristics: heuristicsSource() })) as LogoCandidate[];
    const candidates = [...pageCandidates.filter((c) => isLogoSized(c.rect.width, c.rect.height)), ...headCandidates(head, manifest, base)];
    const chosen = pickLogo(candidates, siteDomain, pageHost);
    const logo = chosen ? await saveLogo(context, chosen, opts.outDir, defaultBg) : undefined;

    const colors = selectRoles(measured.census, {
      tokens,
      ...(normalizeHex(themeLight?.content) ? { themeColor: normalizeHex(themeLight?.content) as string } : {}),
      ...(normalizeHex(manifest?.theme_color) ? { manifestTheme: normalizeHex(manifest?.theme_color) as string } : {}),
      ...(normalizeHex(manifest?.background_color) ? { manifestBackground: normalizeHex(manifest?.background_color) as string } : {}),
      ...(normalizeHex(head.maskIcon?.color) ? { maskIconColor: normalizeHex(head.maskIcon?.color) as string } : {}),
      bodyBackground: defaultBg,
      ...(measured.body.text ? { bodyText: measured.body.text } : {}),
      ...(chosen?.candidate.colors.length ? { logoColors: chosen.candidate.colors } : {}),
    });

    const named = [
      [head.ogSiteName, 'meta[property="og:site_name"]'],
      [manifest?.name, "manifest#name"], [manifest?.short_name, "manifest#short_name"],
      [head.appName, 'meta[name="application-name"]'], [head.titleName, "title (name before separator)"],
    ].find(([value]) => typeof value === "string" && value.trim().length > 0);
    const name = named?.[0]?.trim() || siteDomain;
    const profile: Partial<BrandProfile> = {
      source: { url, extractedAt: new Date().toISOString() },
      name,
      ...(named ? { nameEvidence: { value: name, source: `live-page:${named[1]}` } } : {}),
      colors,
      tokens: colorTokens(tokens),
      scheme,
      type,
    };
    if (logo) profile.logo = logo;
    return profile;
  } finally {
    await context.close();
    if (own) await browser.close();
  }
}
