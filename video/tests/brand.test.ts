/*
  The pure half of @panoma/video-brand: the colour parser, the WCAG gate, the token reader, the
  tone thresholds, the font mapping, dembrandt's role selection and logo table. None
  of these need a browser, so a failure here is a failure of a rule, not of a page.
  The live half — Chromium, CDP, the fixture site — lives in brand-live.test.ts.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  bestOn, capConfidence, contrastRatio, defaultBrand, defaultColors, fontCategory, isHomeHref, logoKind, luminance, mergeBrand, normalizeHex,
  parseColor, passes, pickFont, pickLogo, registerOf, resolveVars, roleToken, saturation, scoreLogo, selectRoles, thirdPartyBrandFromAlt,
  tokensFromCss, tokensFromTailwindConfig, toneOf, type BrandProfile, type Census, type ColorUse, type LogoCandidate, brandTheme, googleFamilies,
} from "@panoma/video-brand";
import { LIGHT_PALETTE } from "@panoma/video-core/theme";

const FIXTURES = fileURLToPath(new URL("./fixtures/brand/", import.meta.url));
const readme = (name: string): string => readFileSync(`${FIXTURES}readmes/${name}.md`, "utf8");

test("every colour notation a token arrives in normalises to one hex", () => {
  assert.equal(normalizeHex("#FFF"), "#ffffff");
  assert.equal(normalizeHex("#2456e6cc"), "#2456e6");
  assert.equal(normalizeHex("rgb(36, 86, 230)"), "#2456e6");
  assert.equal(normalizeHex("rgb(36 86 230 / 0.5)"), "#2456e6");
  assert.equal(normalizeHex("hsl(120, 100%, 25%)"), "#008000");
  assert.equal(normalizeHex("hsl(0.5turn 100% 50%)"), "#00ffff");
  /* shadcn v3 stores the components and adds hsl() at the use site. */
  assert.equal(normalizeHex("210 40% 98%"), "#f8fafc");
  assert.equal(normalizeHex("0 0% 100%"), "#ffffff");
  assert.equal(normalizeHex("rebeccapurple"), "#663399");
  assert.equal(normalizeHex("color(srgb 1 0 0)"), "#ff0000");
  /* oklch white and black are exact; a chromatic one lands within a channel of its sRGB value. */
  assert.equal(normalizeHex("oklch(1 0 0)"), "#ffffff");
  assert.equal(normalizeHex("oklch(0% 0 0)"), "#000000");
  const blue = parseColor("oklch(0.55 0.2 264)");
  assert.ok(blue && blue.b > blue.r && blue.b > blue.g, "oklch hue 264 is a blue");
  assert.equal(parseColor("transparent")?.a, 0);
  assert.equal(normalizeHex("var(--x)"), null);
  assert.equal(normalizeHex("lighten(#fff, 10%)"), null);
});

test("WCAG 2 contrast: the spec's numbers, and the large-text rule at 24px / 18.66px bold", () => {
  assert.equal(luminance("#ffffff"), 1);
  assert.equal(luminance("#000000"), 0);
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff") * 100) / 100, 21);
  /* #767676 on white is 4.54:1 — the classic just-passing grey. */
  assert.ok(contrastRatio("#767676", "#ffffff") > 4.5);
  assert.ok(contrastRatio("#8a8a8a", "#ffffff") < 4.5);
  assert.equal(passes("#8a8a8a", "#ffffff", 16), false);
  assert.equal(passes("#8a8a8a", "#ffffff", 24), true);
  assert.equal(passes("#8a8a8a", "#ffffff", 19, true), true);
  assert.equal(passes("#8a8a8a", "#ffffff", 19, false), false);
  assert.equal(bestOn("#2456e6"), "#ffffff");
  assert.equal(bestOn("#d2bd7f"), "#000000");
});

test("shadcn v4 globals.css: @theme aliases resolve through var(), light and dark stay apart", () => {
  const css = readFileSync(`${FIXTURES}repo/app/globals.css`, "utf8");
  const sets = tokensFromCss(css);
  assert.equal(sets.light["--background"], "#ffffff");
  assert.equal(sets.light["--color-background"], "#ffffff");
  assert.match(sets.light["--primary"], /^#[0-9a-f]{6}$/);
  assert.equal(sets.light["--color-primary"], sets.light["--primary"]);
  assert.equal(sets.light["--font-sans"], `"Inter", ui-sans-serif, system-ui, sans-serif`);
  assert.notEqual(sets.dark["--background"], sets.light["--background"]);
  /* The dark block inherits what it does not override, and @theme aliases re-resolve under it. */
  assert.equal(sets.dark["--muted"], sets.light["--muted"]);
  assert.equal(sets.dark["--color-background"], sets.dark["--background"]);
  assert.equal(roleToken(sets.light, "background")?.name, "--background");
});

test("shadcn v3 hsl components, a data-theme dark block and a media block all classify", () => {
  const css = `
    @layer base {
      :root { --background: 0 0% 100%; --primary: 222.2 47.4% 11.2%; --ring: hsl(var(--primary)); color-scheme: light dark; }
      [data-theme="dark"] { --background: 222.2 84% 4.9%; }
      @media (prefers-color-scheme: dark) { :root { --primary: 210 40% 98%; } }
    }`;
  const sets = tokensFromCss(css);
  assert.equal(sets.light["--background"], "#ffffff");
  assert.equal(sets.light["--ring"], sets.light["--primary"]);
  assert.equal(sets.dark["--background"], "#020817");
  assert.equal(sets.dark["--primary"], "#f8fafc");
  assert.equal(sets.rootColorScheme, "light dark");
  assert.equal(resolveVars("var(--a, #fff)", {}), "#fff");
});

test("tailwind.config colours become --color-* tokens, DEFAULT and 500 are the representative", () => {
  const tokens = tokensFromTailwindConfig(`
    module.exports = { theme: { extend: {
      colors: { brand: { DEFAULT: '#2456e6', 500: '#2456e6', 600: '#1d46c0' }, ink: '#111827', surface: 'hsl(210 20% 98%)' },
      fontFamily: { sans: ['Inter', 'system-ui'], mono: ['"JetBrains Mono"', 'monospace'] },
    } } };`);
  assert.equal(tokens["--color-brand"], "#2456e6");
  assert.equal(tokens["--color-ink"], "#111827");
  assert.equal(tokens["--color-surface"], "#f9fafb");
  assert.equal(tokens["--font-sans"], "Inter, system-ui");
  assert.equal(roleToken(tokens, "primary")?.value, "#2456e6");
});

test("tone: the four fixture READMEs land on four registers, deterministically", () => {
  const playful = toneOf(readme("playful"));
  const technical = toneOf(readme("technical"));
  const formal = toneOf(readme("formal"));
  const friendly = toneOf(readme("friendly"));
  assert.equal(playful.register, "playful");
  assert.equal(technical.register, "technical");
  assert.equal(formal.register, "formal");
  assert.equal(friendly.register, "friendly");
  assert.ok(playful.metrics.emojiRate > 0.02);
  assert.ok(technical.metrics.codeFenceShare > 0.25 && technical.metrics.flesch < 45);
  assert.ok(formal.metrics.passiveRate > 0.2 && formal.metrics.secondPersonRate < 0.1);
  assert.ok(friendly.metrics.secondPersonRate > 0.3);
  assert.deepEqual(toneOf(readme("friendly")), friendly);
  assert.equal(registerOf({ ...friendly.metrics, secondPersonRate: 0.1 } as never), "neutral");
});

test("fonts: category from the name, then the generic; every pick is a bundled face", () => {
  assert.equal(fontCategory(`"JetBrains Mono", monospace`), "mono");
  assert.equal(fontCategory(`"Playfair Display", serif`, "heading"), "display");
  assert.equal(pickFont(`"Playfair Display", serif`, "heading").family, "Fraunces");
  assert.equal(fontCategory(`"Source Sans 3", sans-serif`), "sans");
  assert.equal(fontCategory(`Bebas Neue, sans-serif`, "heading"), "display");
  assert.equal(fontCategory(`Bebas Neue, sans-serif`, "body"), "sans");
  assert.equal(fontCategory(`Charter, serif`), "serif");
  assert.equal(fontCategory(`Whatever, monospace`), "mono");
  assert.deepEqual(pickFont(`"Inter", system-ui, sans-serif`, "body", "google"), { category: "sans", family: "Geist", detected: "Inter", source: "google" });
  assert.equal(pickFont(`Fraunces, serif`, "heading").family, "Fraunces");
  assert.equal(pickFont(`"Abril Fatface", serif`, "heading").family, "Fraunces");
  assert.equal(pickFont(`Bebas Neue, sans-serif`, "heading").family, "Anybody");
  assert.equal(pickFont(`Menlo, monospace`, "mono").family, "Geist Mono");
  assert.equal(pickFont(`system-ui, sans-serif`, "body").detected, undefined);
  assert.deepEqual(googleFamilies("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;700&family=Space+Grotesk&display=swap"), ["Fraunces", "Space Grotesk"]);
});

const use = (hex: string, over: Partial<ColorUse> = {}): ColorUse => ({
  hex, count: 3, area: 0, chars: 0, bgCount: 0, score: 3, ctaCount: 0, isToken: false, statusCount: 0, nonStatusCount: 3, sources: [], ...over,
});

test("roles: a token beats a CTA beats the census; a neutral --primary is overridden by a chromatic CTA", () => {
  const census: Census = {
    totalElements: 200,
    colors: [
      use("#ffffff", { count: 120, area: 1_000_000, bgCount: 120, score: 120 }),
      use("#111827", { count: 90, chars: 4000, score: 90 }),
      use("#e6402c", { count: 3, bgCount: 3, ctaCount: 3, score: 75 }),
      use("#5b6270", { count: 6, chars: 300, score: 6 }),
      use("#f3f4f6", { count: 4, area: 200_000, bgCount: 4, score: 8 }),
      use("#dc2626", { count: 5, score: 5, statusCount: 5, nonStatusCount: 0 }),
    ],
  };
  const fromCta = selectRoles(census, { bodyBackground: "#ffffff", bodyText: "#111827" });
  assert.deepEqual(fromCta.primary, { hex: "#e6402c", confidence: "high", origin: "cta" });
  assert.equal(fromCta.background.origin, "body");
  assert.equal(fromCta.text.hex, "#111827");
  assert.equal(fromCta.surface.hex, "#f3f4f6");
  assert.equal(fromCta.muted.hex, "#5b6270");
  /* WCAG says black on that orange (6.0:1) beats white (3.5:1). */
  assert.equal(fromCta.onPrimary.hex, "#000000");
  /* The status red never becomes the accent, and neither does the browser's default link blue. */
  assert.notEqual(fromCta.accent.hex, "#dc2626");
  const withLinks = selectRoles({ ...census, colors: [...census.colors, use("#0000ee", { count: 4, chars: 80, score: 12 })] }, {});
  assert.notEqual(withLinks.accent.hex, "#0000ee");

  const fromToken = selectRoles(census, { tokens: { "--primary": "#2456e6", "--background": "#fafafa" } });
  assert.deepEqual(fromToken.primary, { hex: "#2456e6", confidence: "high", origin: "css-token:--primary" });
  assert.equal(fromToken.background.origin, "css-token:--background");

  const neutral = selectRoles(census, { tokens: { "--primary": "#111827" } });
  assert.equal(neutral.primary.hex, "#e6402c");
  assert.match(neutral.primary.origin, /^cta \(neutral css-token:--primary overridden\)/);

  const declared = selectRoles(null, { themeColor: "#2456e6" });
  assert.deepEqual(declared.primary, { hex: "#2456e6", confidence: "high", origin: "theme-color" });
  const chrome = selectRoles(null, { themeColor: "#ffffff" });
  assert.equal(chrome.primary.confidence, "low");
  assert.equal(chrome.background.origin, "theme-color");
});

test("confidence is capped by usage: one sighting is never high", () => {
  assert.equal(capConfidence("high", 1), "low");
  assert.equal(capConfidence("high", 2), "medium");
  assert.equal(capConfidence("high", 3), "high");
  assert.equal(capConfidence("medium", 1), "low");
  const single = selectRoles({ totalElements: 50, colors: [use("#e6402c", { count: 1, bgCount: 1, ctaCount: 1, score: 25 })] }, {});
  assert.equal(single.primary.confidence, "low");
});

const mark = (over: Partial<LogoCandidate>): LogoCandidate => ({
  source: "img", context: "header", alt: "", className: "", id: "", ariaLabel: "", linkHref: "",
  rect: { top: 20, left: 40, width: 140, height: 32 }, natural: { width: 140, height: 32 }, background: null, colors: [], ...over,
});

test("logo: dembrandt's table picks the header home-linked mark over a footer image and a customer wall", () => {
  const header = mark({ source: "svg", ariaLabel: "Acme home", linkHref: "/", className: "logo" });
  const footer = mark({ context: "footer", url: "https://acme.com/img/logo.png", rect: { top: 2400, left: 40, width: 120, height: 30 } });
  const wall = mark({ context: "body", url: "https://acme.com/img/sanofi-logo.png", alt: "Sanofi logo", rect: { top: 900, left: 300, width: 120, height: 40 } });
  const hero = mark({ context: "hero", url: "https://acme.com/img/hero.png", rect: { top: 300, left: 0, width: 1200, height: 700 }, natural: { width: 2400, height: 1400 } });
  const icon = mark({ source: "manifest", context: "head", url: "https://acme.com/icon.svg", sizes: "512x512" });
  assert.equal(scoreLogo(header, "acme", "acme.com"), 50 + 30 + 40 + 30 + 10 + 10 + 15);
  assert.ok(scoreLogo(footer, "acme", "acme.com") < scoreLogo(header, "acme", "acme.com"));
  assert.ok(scoreLogo(hero, "acme", "acme.com") < 0);
  assert.equal(scoreLogo(icon, "acme", "acme.com"), 25 + 10 + 5);
  assert.equal(pickLogo([footer, wall, hero, header, icon], "acme", "acme.com")?.candidate, header);
  assert.equal(pickLogo([icon, hero], "acme", "acme.com")?.candidate, icon);
  assert.equal(thirdPartyBrandFromAlt("Sanofi logo", "acme"), "sanofi");
  assert.equal(thirdPartyBrandFromAlt("Acme Widgets logo", "acme"), null);
  assert.equal(isHomeHref("/en-us/", "https://acme.com"), true);
  assert.equal(isHomeHref("https://acme.com/pricing", "https://acme.com"), false);
  assert.equal(logoKind(header), "wordmark");
  assert.equal(logoKind(mark({ rect: { top: 0, left: 0, width: 40, height: 40 } })), "logomark");
  assert.equal(logoKind(icon), "icon");
});

test("merge: precedence by origin, ties to the repository; a low primary keeps the engine's theme", () => {
  const repo: Partial<BrandProfile> = {
    name: "widgets",
    colors: { ...defaultColors(), primary: { hex: "#2456e6", confidence: "high", origin: "css-token:--primary" } },
    tokens: { "--primary": "#2456e6" },
    tone: { register: "friendly", metrics: {} },
    type: { heading: { category: "sans", family: "Geist" }, body: { category: "sans", family: "Geist" }, mono: { category: "mono", family: "Geist Mono" } },
  };
  const live: Partial<BrandProfile> = {
    name: "Acme Widgets",
    colors: { ...defaultColors(), primary: { hex: "#e6402c", confidence: "high", origin: "cta" }, background: { hex: "#ffffff", confidence: "high", origin: "body" }, text: { hex: "#111827", confidence: "high", origin: "body" } },
    scheme: { supports: ["light", "dark"], default: "light" },
    type: { heading: { category: "serif", family: "Fraunces", detected: "Fraunces" }, body: { category: "sans", family: "Geist", detected: "Inter" }, mono: { category: "mono", family: "Geist Mono" } },
  };
  const merged = mergeBrand(repo, live);
  assert.equal(merged.colors.primary.hex, "#2456e6");
  assert.equal(merged.colors.background.origin, "body");
  assert.equal(merged.name, "Acme Widgets");
  assert.equal(merged.tone.register, "friendly");
  assert.equal(merged.type.heading.family, "Fraunces");
  assert.deepEqual(merged.scheme, { supports: ["light", "dark"], default: "light" });

  const theme = brandTheme(merged);
  assert.equal(theme.accent, "#2456e6");
  assert.equal(theme.paper, "#ffffff");
  assert.equal(theme.ink, "#111827");
  assert.equal(theme.good, LIGHT_PALETTE.good);
  const darkTheme = brandTheme({ ...merged, colors: {
    ...merged.colors,
    background: { hex: "#02030a", confidence: "high", origin: "body" },
    text: { hex: "#f4f2ea", confidence: "high", origin: "body" },
  } });
  assert.equal(darkTheme.good, darkTheme.ink, "status text uses readable ink when the house green cannot read on a measured dark product");
  assert.ok(contrastRatio(darkTheme.good, darkTheme.paper) >= 4.5);
  assert.match(theme.fonts.display, /^"Fraunces"/);
  assert.deepEqual(theme.branded, { colors: true, accent: true });

  const defaults = defaultColors();
  const empty = mergeBrand({}, {});
  assert.deepEqual(empty.colors, defaults, "each missing role uses its own house colour");
  assert.deepEqual(defaultBrand().scheme, { supports: ["light"], default: "light" });
  assert.equal(defaults.onPrimary.hex, LIGHT_PALETTE.onAccent);
  const untrusted = brandTheme(empty);
  for (const role of ["paper", "card", "ink", "muted", "faint", "line", "accent", "good", "inverted"] as const) {
    assert.deepEqual(untrusted[role], LIGHT_PALETTE[role], `${role} uses the central Panoma light palette`);
  }
  assert.deepEqual(untrusted.branded, { colors: false, accent: false });
  const unknown = selectRoles(null, {});
  for (const role of Object.keys(defaults) as (keyof typeof defaults)[]) {
    assert.equal(unknown[role].hex, defaults[role].hex);
    assert.equal(unknown[role].confidence, "low", "an absent product colour is never promoted to measured ink");
  }
  assert.equal(saturation("#0a0a0a"), 0);
});
