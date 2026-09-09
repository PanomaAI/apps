/*
  The live half of @panoma/video-brand against a fixture site served from this process: a
  static page with theme-color in both media variants, a color-scheme meta, a manifest,
  an inline header SVG logo with an aria-label, a hero with three CTA buttons in the
  brand colour, a Google Fonts link for a serif heading, a customer wall, and body
  copy. Chromium is real; the network is 127.0.0.1 (the Google Fonts stylesheet may or
  may not load, and nothing below depends on it). The second page swaps the chromatic
  theme-color for a white one so the primary must come from the CTAs instead.

  The last test is the product promise: the same page yields a byte-identical profile
  twice, once `extractedAt` is stripped.
*/
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { brandFromPage, brandFromRepo, brandTheme, extractBrand, launchBrowser, mergeBrand, type BrandProfile, type LivePageContext } from "@panoma/video-brand";
import { PANOMA_LIGHT } from "@panoma/video-core/theme";

const SITE = fileURLToPath(new URL("./fixtures/brand/site/", import.meta.url));
const REPO = fileURLToPath(new URL("./fixtures/brand/repo", import.meta.url));
const TYPES: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".json": "application/manifest+json", ".svg": "image/svg+xml" };

let server: Server;
let base = "";
let browser: Awaited<ReturnType<typeof launchBrowser>>;
let outDir = "";
const visits = new Map<string, number>();

before(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    visits.set(path, (visits.get(path) ?? 0) + 1);
    if (path === "/context.html") {
      res.setHeader("content-type", "text/html");
      res.end(`<!doctype html><html><head><meta name="application-name" content="Ledgerly Games"></head><body><h1>TapeLab</h1><button onclick="fetch('/clicked')">Choose scenario</button><p>sk_test_abcdefghijklmnopqrstuv</p><p aria-hidden="true">hidden context must stay hidden</p><p>${"Market context ".repeat(700)}</p></body></html>`);
      return;
    }
    if (path === "/identity.html") {
      res.setHeader("content-type", "text/html");
      res.end('<!doctype html><html><head><meta name="application-name" content="Ledgerly Games"><title>TapeLab</title></head><body><h1>TapeLab</h1></body></html>');
      return;
    }
    const file = join(SITE, path === "/" ? "index.html" : path);
    if (!existsSync(file)) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
    res.end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  browser = await launchBrowser();
  outDir = mkdtempSync(join(tmpdir(), "panoma-video-brand-"));
});

after(async () => {
  await browser.close();
  server.close();
  rmSync(outDir, { recursive: true, force: true });
});

const strip = (p: Partial<BrandProfile>): Partial<BrandProfile> => ({ ...p, source: { ...p.source, extractedAt: "" } });

test("live thesis context comes from the already-open page once, redacted and bounded without clicking", async () => {
  const contexts: LivePageContext[] = [];
  const before = visits.get("/context.html") ?? 0;
  const live = await brandFromPage(`${base}/context.html`, { browser, onPageContext: (context) => { contexts.push(context); } });
  assert.equal(live.name, "Ledgerly Games");
  assert.equal(visits.get("/context.html"), before + 1, "the observation needs no second navigation");
  assert.equal(visits.get("/clicked"), undefined);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].url, `${base}/context.html`);
  assert.ok(contexts[0].snapshot.length <= 6000);
  assert.match(contexts[0].snapshot, /heading "TapeLab"/);
  assert.match(contexts[0].snapshot, /button "Choose scenario"/);
  assert.doesNotMatch(contexts[0].snapshot, /abcdefghijklmnopqrstuv|hidden context must stay hidden/);
  assert.match(contexts[0].snapshot, /•{4}/);
});

test("live product identity keeps its metadata witness above a mode title or starter package", async () => {
  const live = await brandFromPage(`${base}/identity.html`, { browser });
  assert.equal(live.name, "Ledgerly Games");
  assert.deepEqual(live.nameEvidence, { value: "Ledgerly Games", source: 'live-page:meta[name="application-name"]' });
  const merged = mergeBrand({ name: "site-creator-vinext-starter" }, live);
  assert.equal(merged.name, "Ledgerly Games");
  assert.deepEqual(merged.nameEvidence, live.nameEvidence);
  assert.equal(mergeBrand(merged, { name: "Another product" }).nameEvidence, undefined, "a different name cannot inherit the old witness");
});

test("a chromatic theme-color is the primary; scheme, logo, tokens and fonts are read from the page", async () => {
  const live = await brandFromPage(`${base}/`, { browser, outDir: join(outDir, "index") });
  assert.equal(live.name, "Acme Widgets");
  assert.deepEqual(live.colors?.primary, { hex: "#2456e6", confidence: "high", origin: "theme-color" });
  assert.deepEqual(live.colors?.background, { hex: "#ffffff", confidence: "high", origin: "css-token:--background" });
  assert.deepEqual(live.colors?.text, { hex: "#111827", confidence: "high", origin: "css-token:--foreground" });
  assert.equal(live.colors?.onPrimary.hex, "#ffffff");
  /* The card fill is the surface: near-neutral, second-largest painted area. */
  assert.equal(live.colors?.surface.hex, "#f3f4f6");
  assert.equal(live.colors?.muted.hex, "#5b6270");
  assert.deepEqual(live.tokens, { "--background": "#ffffff", "--foreground": "#111827" });

  /* color-scheme "light dark" plus a body that repaints under prefers-color-scheme: dark. */
  assert.deepEqual(live.scheme, { supports: ["light", "dark"], default: "light" });

  /* The inline header SVG, home-linked and aria-labelled, beats the customer wall and the head icons. */
  assert.ok(live.logo, "a logo was chosen");
  assert.equal(live.logo.origin, "svg:header");
  assert.equal(live.logo.kind, "wordmark");
  assert.deepEqual([live.logo.width, live.logo.height, live.logo.reversed], [140, 32, false]);
  assert.equal(live.logo.file, join(outDir, "index", "logo.svg"));
  assert.match(readFileSync(live.logo.file, "utf8"), /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(live.logo.score >= 150, `header mark scores ${live.logo.score}`);

  /* Fonts: category from the stack, family always bundled, the product's name recorded. */
  assert.equal(live.type?.heading.family, "Fraunces");
  assert.equal(live.type?.heading.category, "serif");
  assert.equal(live.type?.heading.detected, "Fraunces");
  assert.equal(live.type?.heading.source, "google");
  assert.deepEqual(live.type?.body, { category: "sans", family: "Geist", detected: "Inter", source: "system" });
  assert.deepEqual(live.type?.mono, { category: "mono", family: "Geist Mono", detected: "JetBrains Mono", source: "system" });
});

test("a white theme-color is chrome, not brand: the primary comes from three CTAs with high confidence", async () => {
  const live = await brandFromPage(`${base}/cta.html`, { browser, outDir: join(outDir, "cta") });
  assert.deepEqual(live.colors?.primary, { hex: "#e6402c", confidence: "high", origin: "cta" });
  assert.equal(live.colors?.onPrimary.hex, "#000000");
  /* The browser's default link blue on the unstyled logo link is not the accent. */
  assert.notEqual(live.colors?.accent.hex, "#0000ee");
  assert.equal(live.logo?.origin, "img:header");
  assert.equal(live.logo?.kind, "wordmark");
  assert.equal(live.logo?.file, join(outDir, "cta", "logo.svg"));
});

test("the repository pass reads shadcn oklch tokens, the manifest, the README's logo and its tone", async () => {
  const repo = await brandFromRepo(REPO);
  assert.equal(repo.name, "widgets");
  assert.equal(repo.colors?.primary.origin, "css-token:--primary");
  assert.match(repo.colors?.primary.hex ?? "", /^#[0-9a-f]{6}$/);
  assert.deepEqual(repo.colors?.background, { hex: "#ffffff", confidence: "high", origin: "css-token:--background" });
  assert.equal(repo.colors?.surface.origin, "css-token:--card");
  assert.equal(repo.colors?.onPrimary.origin, "css-token:--primary-foreground");
  assert.equal(repo.tokens?.["--destructive"], "#e7000b");
  assert.deepEqual(repo.scheme, { supports: ["light", "dark"], default: "light" });
  assert.equal(repo.tone?.register, "friendly");
  assert.equal(repo.logo?.origin, "repo:public/logo.svg");
  assert.equal(repo.logo?.kind, "wordmark");
  assert.deepEqual(repo.type?.body, { category: "sans", family: "Geist", detected: "Inter", source: "css-token:--font-sans" });
  assert.equal(repo.type?.mono.detected, "JetBrains Mono");
});

test("extractBrand merges by precedence and brandTheme hands recipes the theme.ts shape", async () => {
  const profile = await extractBrand({ root: REPO, url: `${base}/`, outDir: join(outDir, "merged"), browser });
  /* Both passes declare a primary token-or-theme-color at rank 0; the tie goes to source. */
  assert.equal(profile.colors.primary.origin, "css-token:--primary");
  assert.equal(profile.name, "Acme Widgets");
  assert.equal(profile.tone.register, "friendly");
  assert.equal(profile.source.repoPath, REPO);
  assert.equal(profile.source.url, `${base}/`);
  assert.equal(profile.type.heading.family, "Fraunces");
  /* The live header mark outscores the repository file. */
  assert.equal(profile.logo?.origin, "svg:header");

  const theme = brandTheme(profile);
  assert.deepEqual(Object.keys(theme).sort(), ["accent", "branded", "card", "faint", "fonts", "good", "ink", "inverted", "line", "muted", "paper"]);
  assert.equal(theme.accent, profile.colors.primary.hex);
  assert.equal(theme.paper, "#ffffff");
  assert.equal(theme.good, PANOMA_LIGHT.success);
  assert.deepEqual(theme.branded, { colors: true, accent: true });
  assert.match(theme.fonts.display, /^"Fraunces"/);
  assert.match(theme.fonts.mono, /^"Geist Mono"/);
});

test("the same page yields a byte-identical profile twice", async () => {
  const a = await brandFromPage(`${base}/`, { browser, outDir: join(outDir, "twice") });
  const b = await brandFromPage(`${base}/`, { browser, outDir: join(outDir, "twice") });
  assert.equal(JSON.stringify(strip(a)), JSON.stringify(strip(b)));
  const merged = mergeBrand({}, a);
  assert.equal(merged.colors.primary.hex, "#2456e6");
});
