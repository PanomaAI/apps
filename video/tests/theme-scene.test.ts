import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { test } from "node:test";
import "@panoma/video-engine/register";
import { FORMATS, stage, type Brief, type EditorialTheme, type Format } from "@panoma/video-core";
import { DEFAULT_DIRECTION, type Direction } from "@panoma/video-brand/direction";
import { castFrame, promoTitleSettledFrame, type CastShot, type PromoPlan, type PromoProof, type PromoTitleSection, type TakeWithAssets } from "@panoma/video-render/timing";
import { promoPanelLayout } from "../apps/render/src/recipes/presentation.ts";

const renderRequire = createRequire(new URL("../apps/render/package.json", import.meta.url));
const engineRequire = createRequire(new URL("../packages/engine/package.json", import.meta.url));
const brief: Brief = { id: "theme", recipe: "ProductPromo", bpm: 120, fps: 30, langs: ["es"], hooks: [{ id: "hook", mode: "type", text: { es: "Cada proyecto tiene su lugar" } }], lines: [] };
const camera: CastShot[] = [{ from: 0, to: 1080, start: { fx: 0.5, fy: 0.5, scale: 1.18 }, end: { fx: 0.5, fy: 0.5, scale: 1.18 }, ease: "out", enter: "cut", tilt: { rx: 0, ry: 0 }, reason: "same source camera under either editorial theme" }];

function directionFor(light: boolean, colorful = false): Direction {
  const paper = colorful ? light ? "#ffff00" : "#241285" : light ? "#f4f5f1" : "#10151b";
  const ink = colorful ? light ? "#003cff" : "#eaff00" : light ? "#1c2429" : "#f3f5ef";
  const surface = (hex: string) => ({ hex, from: "measured" as const, why: "fixture brand" });
  return { ...DEFAULT_DIRECTION, scheme: light ? "light" : "dark", page: paper, stage: surface(paper), ink: surface(ink), muted: surface(light ? "#566064" : "#a8b1b9"), accent: surface(light ? "#1c2429" : "#b3e75d"), plate: surface(light ? "#e8ebe5" : "#1c2429"), inverted: { stage: ink, ink: paper, muted: light ? "#a8b1b9" : "#566064" } };
}

function sourceFor(format: Format): TakeWithAssets {
  return { viewport: { width: format.width, height: format.height }, isMobile: format.width < format.height, durationMs: 8000, fps: 25, videoRatio: 2, events: [], marks: [] };
}

function planFor(format: Format): PromoPlan {
  const viewport = sourceFor(format).viewport;
  const proof = (from: number, treatment: "full" | "focus" | "split"): PromoProof => ({ kind: "proof", id: treatment, mark: treatment, from, to: from + 120, sourceFrom: 0, sourceTo: 4.8, resultSource: 0.8, playRate: 1.2, holdFrom: from + 120, resultFrom: from + 20, treatment, presses: [], ...(treatment === "split" ? { text: "Tus proyectos se mueven contigo" } : {}), ...(treatment === "focus" ? { focusBox: { x: viewport.width * 0.3, y: viewport.height * 0.3, width: viewport.width * 0.4, height: viewport.height * 0.4 } } : {}) });
  return { durationInFrames: 1080, sections: [
    { kind: "hook", id: "hook", text: brief.hooks[0].text.es, from: 0, to: 45 },
    { kind: "benefit", id: "benefit", text: "Todo tu trabajo, a mano", from: 45, to: 90 },
    proof(90, "full"), proof(210, "focus"), proof(330, "split"),
    { kind: "recap", id: "recap", text: "Tu trabajo, a mano", from: 450, to: 630, rows: [{ id: "one", text: "Encuentra tus proyectos locales", from: 450 }, { id: "two", text: "Conserva el contexto de cada proyecto", from: 495 }, { id: "three", text: "Revisa el trabajo que falta respaldar", from: 540 }] },
    { kind: "terminal", id: "terminal", text: "npx panoma scan ~/Desktop", source: "Terminal", from: 630, typingFrom: 645, typingTo: 705, to: 780 },
    { kind: "code", id: "code", text: 'const project = "local";\nawait open(project);', source: "Code", from: 780, typingFrom: 795, typingTo: 870, to: 960 },
    { kind: "end", id: "end", text: "Panoma\nhttps://panoma.ai", from: 960, to: 1080 },
  ] };
}

async function fixture() {
  const { chromium } = engineRequire("playwright");
  const { startAssetServer, renderFrameHtml } = await import("@panoma/video-engine");
  const { createElement } = renderRequire("react");
  const { ProductPromo } = await import("../apps/render/src/recipes/ProductPromo.tsx");
  const { ThemeProvider } = await import("../apps/render/src/lib/theme-context.tsx");
  const server = await startAssetServer({ assets: tmpdir() });
  const browser = await chromium.launch({ headless: true });
  const pageFor = async (format: Format) => {
    const page = await browser.newPage({ viewport: { width: format.width, height: format.height } });
    await page.goto(`${server.origin}/__shell__?w=${format.width}&h=${format.height}`);
    await page.evaluate(async () => { await document.fonts.load('850 100px "Geist"'); await document.fonts.load('450 40px "Geist Mono"'); await document.fonts.load('780 100px "Anybody"'); await document.fonts.ready; });
    return page;
  };
  const htmlFor = (format: Format, frame: number, theme: EditorialTheme | undefined, light: boolean, colorful = false) => {
    const plan = planFor(format);
    const here = { ...brief, promo: { opening: "promise" as const, pace: "measured" as const, evidence: {}, ...(theme ? { theme } : {}) } };
    const element = createElement(ThemeProvider, { direction: directionFor(light, colorful) }, createElement(ProductPromo, { brief: here, hook: here.hooks[0], lang: "es", format, session: { ...sourceFor(format), video: "theme.webm", name: "theme", take: "main", url: "", recordedAt: "2026-09-05" }, plan, shots: camera }));
    return renderFrameHtml(element, { frame, fps: 30, format, durationInFrames: plan.durationInFrames });
  };
  return { pageFor, htmlFor, close: async () => { await browser.close(); await server.close(); } };
}

test("a promo keeps one editorial theme across every section, with a complete poster and safe title arrivals", async () => {
  const f = await fixture();
  try {
    for (const format of Object.values(FORMATS)) {
      const page = await f.pageFor(format);
      for (const light of [false, true]) for (const theme of ["flat", "vibrant", "block", "grid"] as const) {
        for (const frame of [0, 45, 48, 60, 135, 255, 375, 451, 580, 660, 735, 825, 900, 960, 965, 975]) {
          await page.evaluate((html: string) => { document.body.innerHTML = html; }, f.htmlFor(format, frame, theme, light));
          const measured = await page.evaluate(() => {
            const container = document.querySelector<HTMLElement>("[data-promo-theme]")!;
            const words: { text: string; left: number; right: number; top: number; bottom: number }[] = [];
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
            let node: Node | null;
            while ((node = walker.nextNode())) {
              const parent = node.parentElement!;
              const style = getComputedStyle(parent);
              let hidden = style.visibility === "hidden";
              for (let current: Element | null = parent; current; current = current.parentElement) hidden ||= getComputedStyle(current).opacity === "0";
              if (hidden) continue;
              for (const match of node.textContent!.matchAll(/\S+/g)) {
                const range = document.createRange(); range.setStart(node, match.index!); range.setEnd(node, match.index! + match[0].length);
                for (const rect of range.getClientRects()) if (rect.width && rect.height) words.push({ text: match[0], left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
              }
            }
            return { theme: container.dataset.promoTheme, grid: container.querySelectorAll("[data-film-grid]").length, pieces: [...container.querySelectorAll<HTMLElement>("[data-editorial-theme]")].map((el) => el.dataset.editorialTheme), text: container.textContent, words };
          });
          assert.equal(measured.theme, theme);
          assert.equal(measured.grid, theme === "grid" ? 1 : 0, "only the explicit Grid film may carry the optical lattice");
          assert.ok(measured.pieces.every((id: string) => id === theme), "all added elements inherit the film's one theme");
          const safe = stage(format);
          for (const rect of measured.words) assert.ok(rect.left >= safe.x - 0.1 && rect.right <= safe.x + safe.width + 0.1 && rect.top >= safe.y - 0.1 && rect.bottom <= safe.y + safe.height + 0.1, `${format.id} ${theme} @${frame}: ${rect.text} must stay inside Stage: ${JSON.stringify(rect)}`);
          if (frame === 0 || frame === 45 || frame === 960) {
            const expected = planFor(format).sections.find((section): section is PromoTitleSection => section.from === frame && (section.kind === "hook" || section.kind === "benefit" || section.kind === "end"))!;
            assert.equal(measured.text, expected.text!.replace("\n", ""), "title animation reserves all of the exact copy from the first frame");
            if (frame === 0) assert.equal(measured.words.map((word: typeof measured.words[number]) => word.text).join(" "), expected.text, "the opening poster is fully visible before playback begins");
            if (theme === "grid") assert.equal(measured.words.map((word: typeof measured.words[number]) => word.text).join(" "), expected.text!.replace("\n", " "), "every exact phrase fragment remains visible while the Grid title assembles");
          }
          if (frame === 375) {
            const source = sourceFor(format);
            const product = promoPanelLayout(format, source.viewport, { isMobile: source.isMobile, videoRatio: source.videoRatio }).product;
            assert.ok(measured.words.every((rect: typeof measured.words[number]) => rect.right <= product.x || rect.left >= product.x + product.width || rect.bottom <= product.y || rect.top >= product.y + product.height), "the theme's copy never crosses the recorded product panel");
          }
          if (theme === "block" && light && [0, 375, 580].includes(frame) && format.id !== "s") await page.screenshot({ path: `/tmp/panoma-video-theme-block-qa-${format.id}-${frame}.png` });
        }
      }
      await page.close();
    }
  } finally { await f.close(); }
});

test("changing the editorial theme preserves the decoded product, camera and visible source pixels", async () => {
  const f = await fixture();
  try {
    for (const format of Object.values(FORMATS)) {
      const page = await f.pageFor(format);
      for (const light of [false, true]) for (const frame of [135, 255, 375]) {
        let baseline: unknown;
        let baselineComposite: Buffer | undefined;
        let baselineInterior: Buffer | undefined;
        for (const theme of ["flat", "vibrant", "block", "grid"] as const) {
          await page.evaluate((html: string) => { document.body.innerHTML = html; }, f.htmlFor(format, frame, theme, light));
          const recorded = await page.evaluate(() => {
            const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-video]")!;
            canvas.width = 8; canvas.height = 8;
            const ctx = canvas.getContext("2d")!; ctx.fillStyle = "rgb(32, 170, 220)"; ctx.fillRect(0, 0, 8, 8);
            const bounds = canvas.getBoundingClientRect();
            const ancestors = []; let current: HTMLElement | null = canvas;
            while (current) { const style = getComputedStyle(current); ancestors.push({ filter: style.filter, opacity: style.opacity, blend: style.mixBlendMode }); current = current.parentElement; }
            return { src: canvas.dataset.video, seek: canvas.dataset.seek, transform: canvas.parentElement!.style.transform, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, ancestors, count: document.querySelectorAll("canvas[data-video]").length, pixel: [...ctx.getImageData(4, 4, 1, 1).data] };
          });
          const overlayCount = await page.locator("[data-film-grid]").count();
          assert.equal(overlayCount, theme === "grid" ? 1 : 0);
          if (theme === "grid") await page.locator("[data-film-grid]").evaluate((node: Element) => node.remove());
          const source = sourceFor(format);
          const win = frame === 375 ? promoPanelLayout(format, source.viewport, { isMobile: source.isMobile, videoRatio: source.videoRatio }).product : castFrame(format, source.viewport, { isMobile: source.isMobile });
          const x = Math.max(0, Math.ceil(win.x + win.content.x + 2));
          const y = Math.max(0, Math.ceil(win.y + win.content.y + 2));
          const right = Math.min(format.width, Math.floor(win.x + win.content.x + win.content.width - 2));
          const bottom = Math.min(format.height, Math.floor(win.y + win.content.y + win.content.height - 2));
          const composite = await page.screenshot({ clip: { x, y, width: right - x, height: bottom - y } });
          /* Rounded corners expose the newly neutral Grid stage. Only that known outer
             envelope is excluded; the recorded interior and focus remain byte-identical. */
          const inset = Math.ceil(win.radius + 2);
          const interior = { x: x + inset, y: y + inset, width: right - x - inset * 2, height: bottom - y - inset * 2 };
          if (theme === "flat") {
            baselineComposite = composite;
            baselineInterior = await page.screenshot({ clip: interior });
          } else if (theme === "grid") {
            assert.ok((await page.screenshot({ clip: interior })).equals(baselineInterior!), `${format.id} ${theme} @${frame}: removing the authorized lattice preserves the complete recorded interior beyond the rounded corner envelope`);
          } else assert.ok(composite.equals(baselineComposite!), `${format.id} ${theme} @${frame}: the whole product composition remains exactly unchanged`);
          const png = await page.screenshot();
          const visiblePixel = await page.evaluate(async ({ png, point }: { png: string; point: { x: number; y: number } }) => {
            const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode();
            const canvas = document.createElement("canvas"); canvas.width = img.width; canvas.height = img.height;
            const ctx = canvas.getContext("2d")!; ctx.drawImage(img, 0, 0);
            return [...ctx.getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data];
          }, { png: png.toString("base64"), point: { x: recorded.bounds.x + recorded.bounds.width * 0.44, y: recorded.bounds.y + recorded.bounds.height * 0.44 } });
          assert.equal(recorded.count, 1);
          assert.deepEqual(visiblePixel, [32, 170, 220, 255], `${format.id} ${theme} @${frame}: the composited frame preserves every source channel under the selected theme`);
          if (theme === "flat") baseline = recorded;
          else assert.deepEqual(recorded, baseline, "the theme cannot change the source, clock, camera, geometry or inherited visual filter");
        }
      }
      await page.close();
    }
  } finally { await f.close(); }
});

test("legacy promotional briefs render exactly the explicitly selected Flat theme", async () => {
  const f = await fixture();
  try {
    for (const format of Object.values(FORMATS)) for (const frame of [0, 375, 580, 735, 900, 960]) for (const light of [false, true]) {
      assert.equal(f.htmlFor(format, frame, undefined, light), f.htmlFor(format, frame, "flat", light), `${format.id} @${frame}: absent theme preserves Flat output`);
    }
  } finally { await f.close(); }
});

test("Grid stages and added graphics remain monochrome for a colorful product identity", async () => {
  const f = await fixture();
  const channels = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  const neutral = (color: string) => { const rgb = channels(color); return rgb[0] === rgb[1] && rgb[1] === rgb[2]; };
  try {
    for (const format of Object.values(FORMATS)) {
      const page = await f.pageFor(format);
      for (const light of [false, true]) {
        for (const frame of [0, 45, 135, 255, 375, 580, 735, 900, 960]) {
          await page.evaluate((html: string) => { document.body.innerHTML = html; }, f.htmlFor(format, frame, "grid", light, true));
          const read = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>("[data-promo-theme]")!;
            const colors = new Set<string>();
            /* ProductWindow is intentionally unchanged; only the authored elements and
               film lattice opt into this editorial palette. */
            const graphics = [...root.querySelectorAll("[data-editorial-theme], [data-film-grid]")];
            for (const graphic of graphics) for (const node of [graphic, ...graphic.querySelectorAll("*")]) {
              const style = getComputedStyle(node);
              for (const value of [style.color, style.backgroundColor, style.fill, style.stroke]) if (/^rgb/.test(value) && value !== "rgba(0, 0, 0, 0)") colors.add(value);
              for (const value of style.boxShadow.match(/rgba?\([^)]+\)/g) ?? []) colors.add(value);
            }
            return { ground: getComputedStyle(root.parentElement!).backgroundColor, colors: [...colors] };
          });
          assert.ok(neutral(read.ground), `${format.id} @${frame}: Grid stage must be neutral even for a saturated brand`);
          for (const color of read.colors) assert.ok(neutral(color), `${format.id} @${frame}: added Grid graphics introduced a chromatic color: ${color}`);
        }
        await page.evaluate((html: string) => { document.body.innerHTML = html; }, f.htmlFor(format, 135, "flat", light, true));
        const original = await page.evaluate(() => getComputedStyle(document.querySelector("[data-promo-theme]")!.parentElement!).backgroundColor);
        assert.ok(!neutral(original), "Normal keeps the actual selected direction's colored stage");
      }
      await page.close();
    }
  } finally { await f.close(); }
});

test("dedicated title motion finishes once, while split copy and the poster remain stable", async () => {
  const f = await fixture();
  try {
    for (const format of Object.values(FORMATS)) {
      const page = await f.pageFor(format);
      for (const theme of ["flat", "vibrant", "block", "grid"] as const) {
        let poster: unknown;
        for (const frame of [0, 5, 20, 44]) {
          await page.evaluate((html: string) => { document.body.innerHTML = html; }, f.htmlFor(format, frame, theme, true));
          const state = await page.evaluate(() => {
            const title = document.querySelector<HTMLElement>("[data-promo-title]")!;
            const style = getComputedStyle(title);
            return { html: title.outerHTML, transform: style.transform, opacity: style.opacity };
          });
          assert.equal(state.opacity, "1", "the feed poster is never a half-arrived title");
          if (frame === 0) poster = state;
          else assert.deepEqual(state, poster, "the initial poster stays composed throughout its reading interval");
        }
        for (const section of planFor(format).sections.filter((section): section is PromoTitleSection => section.kind === "benefit" || section.kind === "end")) {
          const settled = promoTitleSettledFrame(theme, section.kind, section.from, section.to, 30, 15);
          let atRest: unknown;
          let entry: unknown;
          for (const frame of [section.from, section.from + 2, settled, section.to - 1]) {
            await page.evaluate((html: string) => { document.body.innerHTML = html; }, f.htmlFor(format, frame, theme, true));
            const state = await page.evaluate(() => {
              const title = document.querySelector<HTMLElement>("[data-promo-title]")!;
              const style = getComputedStyle(title);
              const bounds = title.getBoundingClientRect();
              return { text: title.textContent, transform: style.transform, opacity: style.opacity, html: title.outerHTML, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } };
            });
            assert.equal(state.opacity, "1", "dedicated title motion never hides the statement");
            if (frame === section.from) entry = state;
            if (frame === settled) { atRest = state; assert.notDeepEqual(state, entry, "the selected title system visibly completes its entrance"); }
            if (frame > settled) assert.deepEqual(state, atRest, "after settling, type and its base remain still until the cut");
          }
        }
        let copy: unknown;
        for (const frame of [330, 334, 375, 449]) {
          await page.evaluate((html: string) => { document.body.innerHTML = html; }, f.htmlFor(format, frame, theme, true));
          const state = await page.evaluate(() => document.querySelector<HTMLElement>("[data-promo-side-text]")!.outerHTML);
          if (frame === 330) copy = state;
          else assert.equal(state, copy, "the theme cannot animate explanatory text while the recording moves beside it");
        }
      }
      await page.close();
    }
  } finally { await f.close(); }
});

test("the static Grid lattice changes product channels by at most eighteen levels and leaves the spaces between lines intact", async () => {
  const f = await fixture();
  const source = [0, 128, 255, 255];
  try {
    for (const format of Object.values(FORMATS)) {
      const page = await f.pageFor(format);
      for (const light of [false, true]) {
        await page.evaluate((html: string) => { document.body.innerHTML = html; }, f.htmlFor(format, 135, "grid", light));
        const lattice = await page.evaluate(() => {
          const video = document.querySelector<HTMLCanvasElement>("canvas[data-video]")!;
          video.width = 8; video.height = 8;
          const ctx = video.getContext("2d")!; ctx.fillStyle = "rgb(0, 128, 255)"; ctx.fillRect(0, 0, 8, 8);
          const grid = document.querySelector<SVGSVGElement>("[data-film-grid]")!;
          return { pitch: Number(grid.dataset.gridPitch), product: grid.dataset.gridOverProduct, html: grid.outerHTML, source: [...ctx.getImageData(4, 4, 1, 1).data] };
        });
        assert.deepEqual(lattice.source, source);
        assert.equal(lattice.product, "true");
        const macro = lattice.pitch * 8;
        const clip = { x: Math.round(format.width / 2 / macro) * macro - 2, y: Math.round(format.height / 2 / macro) * macro - 2, width: macro + 4, height: macro + 4 };
        const png = await page.screenshot({ clip });
        const measured = await page.evaluate(async ({ png, source, pitch, offset }: { png: string; source: number[]; pitch: number; offset: { x: number; y: number } }) => {
          const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
          const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
          const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0);
          const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
          let maxDelta = 0; let changed = 0; let untouched = 0; let lines = 0; let intersections = 0; let offGridChanged = 0;
          for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
            const at = (y * image.width + x) * 4;
            const delta = Math.max(...source.map((value, channel) => Math.abs(pixels[at + channel] - value)));
            maxDelta = Math.max(maxDelta, delta);
            const px = (x + offset.x) % pitch; const py = (y + offset.y) % pitch;
            const onX = px <= 1 || px >= pitch - 1; const onY = py <= 1 || py >= pitch - 1;
            if (delta) { changed++; if (onX && onY) intersections++; else if (onX || onY) lines++; else offGridChanged++; }
            else untouched++;
          }
          return { maxDelta, changed, untouched, lines, intersections, offGridChanged };
        }, { png: png.toString("base64"), source, pitch: lattice.pitch, offset: clip });
        assert.ok(measured.maxDelta <= 18, `${format.id}: line intersections must retain the source within the authorized subtle optical treatment: ${JSON.stringify(measured)}`);
        assert.ok(measured.changed > 0 && measured.lines > 0 && measured.intersections > 0, "the fine lattice is present on lines and their intersections");
        assert.ok(measured.untouched > measured.changed, "most product pixels remain completely untouched");
        assert.equal(measured.offGridChanged, 0, "the lattice cannot introduce a full-frame tint or filter");
        await page.evaluate((html: string) => { document.body.innerHTML = html; }, f.htmlFor(format, 150, "grid", light));
        assert.equal(await page.locator("[data-film-grid]").evaluate((node: Element) => node.outerHTML), lattice.html, "the optical treatment has no moving offset or pulse during the proof");
      }
      await page.close();
    }
  } finally { await f.close(); }
});
