import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { test } from "node:test";
import "@panoma/video-engine/register";
import { FORMATS, stage, type Brief, type Format } from "@panoma/video-core";
import { contrastRatio } from "@panoma/video-brand/contrast";
import { cameraAt, cameraTransform, castFrame, type CastShot, type PromoPlan, type PromoProof, type TakeWithAssets } from "@panoma/video-render/timing";
import { promoPanelLayout, promoRowState, promoTypedCount } from "../apps/render/src/recipes/presentation.ts";

const renderRequire = createRequire(new URL("../apps/render/package.json", import.meta.url));
const engineRequire = createRequire(new URL("../packages/engine/package.json", import.meta.url));
const brief: Brief = { id: "effects", recipe: "ProductPromo", bpm: 120, fps: 30, langs: ["es"], hooks: [{ id: "hook", mode: "type", text: { es: "Cada proyecto tiene su lugar" } }], lines: [] };
const take: TakeWithAssets = { viewport: { width: 1600, height: 900 }, durationMs: 6000, fps: 25, videoRatio: 2, events: [], marks: [] };
const proof: PromoProof = { kind: "proof", id: "focus", mark: "focus", from: 0, to: 90, sourceFrom: 0, sourceTo: 3.6, resultSource: 0.8, playRate: 1.2, holdFrom: 90, resultFrom: 20, resultBox: { x: 580, y: 240, width: 520, height: 350 }, focusBox: { x: 580, y: 240, width: 520, height: 350 }, treatment: "focus", presses: [] };
const shots: CastShot[] = [
  { from: 0, to: 32, start: { fx: 0.5, fy: 0.5, scale: 1 }, end: { fx: 0.6, fy: 0.47, scale: 1.3 }, ease: "out", enter: "cut", tilt: { rx: 0, ry: 0 }, reason: "reframe result" },
  { from: 32, to: 90, start: { fx: 0.6, fy: 0.47, scale: 1.3 }, end: { fx: 0.6, fy: 0.47, scale: 1.3 }, ease: "out", enter: "cut", tilt: { rx: 0, ry: 0 }, reason: "hold result" },
];

async function browserFixture() {
  const { chromium } = engineRequire("playwright");
  const { startAssetServer } = await import("@panoma/video-engine");
  const server = await startAssetServer({ assets: tmpdir() });
  const browser = await chromium.launch({ headless: true });
  const pageFor = async (format: Format) => {
    const page = await browser.newPage({ viewport: { width: format.width, height: format.height } });
    await page.goto(`${server.origin}/__shell__?w=${format.width}&h=${format.height}`);
    await page.evaluate(async () => { await document.fonts.load('600 100px "Geist"'); await document.fonts.load('450 40px "Geist Mono"'); await document.fonts.ready; });
    return page;
  };
  return { pageFor, close: async () => { await browser.close(); await server.close(); } };
}

async function htmlFor(plan: PromoPlan, frame: number, format: Format, here = take, camera = shots) {
  const { createElement } = renderRequire("react");
  const { ProductPromo } = await import("../apps/render/src/recipes/ProductPromo.tsx");
  const { renderFrameHtml } = await import("@panoma/video-engine");
  return renderFrameHtml(createElement(ProductPromo, { brief, hook: brief.hooks[0], lang: "es", format, session: { ...here, video: "effects.webm", name: "effects", take: "desktop", url: "", recordedAt: "2026-09-05" }, plan, shots: camera }), { frame, fps: 30, format, durationInFrames: plan.durationInFrames });
}

const inside = (rect: { left: number; right: number; top: number; bottom: number }, safe: ReturnType<typeof stage>) => rect.left >= safe.x - 0.1 && rect.right <= safe.x + safe.width + 0.1 && rect.top >= safe.y - 0.1 && rect.bottom <= safe.y + safe.height + 0.1;

test("focus waits for the measured result and camera, leaving the exact current footage visible through its hole", async () => {
  const fixture = await browserFixture();
  try {
    const format = FORMATS.h;
    const page = await fixture.pageFor(format);
    const plan = { sections: [proof], durationInFrames: 90 };
    for (const frame of [0, 20, 31, 32]) assert.doesNotMatch(await htmlFor(plan, frame, format), /data-promo-focus/, `no premature mask at ${frame}`);
    const html = await htmlFor(plan, 45, format);
    await page.evaluate((html: string) => { document.body.innerHTML = html; }, html);
    const projection = await page.evaluate(() => {
      const mask = document.querySelector<SVGElement>("[data-promo-focus]")!;
      const [x, y, width, height] = mask.dataset.focusBox!.split(",").map(Number);
      const bounds = mask.getBoundingClientRect();
      return { x, y, width, height, left: bounds.left, top: bounds.top, canvases: document.querySelectorAll("canvas[data-video]").length, images: document.querySelectorAll("img").length };
    });
    assert.equal(projection.canvases, 1, "the spotlight reuses the decoded source, without a duplicate video or cropped image");
    assert.equal(projection.images, 0);
    const win = castFrame(format, take.viewport);
    const zoom = cameraTransform(cameraAt(shots, 45, 15));
    const expectedCenter = win.content.width * (0.5 + zoom.dx + ((proof.focusBox!.x + proof.focusBox!.width / 2) / take.viewport.width - 0.5) * zoom.scale);
    assert.ok(Math.abs(projection.x + projection.width / 2 - expectedCenter) < 0.01, "hole follows the same transformed source pixels as the camera");
    const projectedComponentWidth = proof.focusBox!.width / take.viewport.width * win.content.width * zoom.scale;
    assert.ok(projection.width - projectedComponentWidth <= 4 * win.content.width / take.viewport.width * zoom.scale + 0.01,
      "the aperture exposes at most two source pixels beside the measured component, not neighboring labels");
    for (const value of ["rgb(32, 170, 220)", "rgb(220, 90, 40)"]) {
      await page.evaluate((value: string) => {
        const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-video]")!;
        canvas.width = 1600; canvas.height = 900;
        const ctx = canvas.getContext("2d")!; ctx.fillStyle = value; ctx.fillRect(0, 0, canvas.width, canvas.height);
      }, value);
      const png = await page.screenshot();
      const pixels = await page.evaluate(async ({ png, points }: { png: string; points: number[][] }) => {
        const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode();
        const canvas = document.createElement("canvas"); canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext("2d")!; ctx.drawImage(img, 0, 0);
        return points.map(([x, y]) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3));
      }, { png: png.toString("base64"), points: [[projection.left + projection.x + projection.width / 2, projection.top + projection.y + projection.height / 2], [projection.left + 10, projection.top + 10]] });
      const source = value.match(/\d+/g)!.map(Number);
      assert.deepEqual(pixels[0], source, "the hole preserves every source RGB channel and changes when the video changes");
      assert.ok(pixels[1].reduce((a: number, b: number) => a + b, 0) < source.reduce((a, b) => a + b, 0) * 0.5, "only the surrounding picture is dimmed");
    }
    await page.close();
  } finally { await fixture.close(); }
});

test("split copy remains whole, stable and separate from a moving source in every format", async () => {
  const fixture = await browserFixture();
  const text = "Tus proyectos se mueven contigo";
  try {
    for (const format of Object.values(FORMATS)) {
      const page = await fixture.pageFor(format);
      const source = format.width < format.height ? { ...take, isMobile: true, viewport: { width: 390, height: 844 } } : take;
      const panel = promoPanelLayout(format, source.viewport, { isMobile: source.isMobile, videoRatio: source.videoRatio });
      const split = { ...proof, treatment: "split" as const, text };
      const plan = { sections: [split], durationInFrames: 90 };
      let firstRects: unknown;
      let firstTransform = "";
      for (const frame of [2, 18, 45]) {
        await page.evaluate((html: string) => { document.body.innerHTML = html; }, await htmlFor(plan, frame, format, source));
        const rendered = await page.evaluate(() => {
          const box = document.querySelector<HTMLElement>("[data-promo-side-text]")!;
          const node = box.firstElementChild!.firstChild!;
          const content = node.textContent!;
          const words = [...content.matchAll(/\S+/g)].map((match) => {
            const range = document.createRange(); range.setStart(node, match.index!); range.setEnd(node, match.index! + match[0].length);
            return [...range.getClientRects()].map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
          });
          const canvas = document.querySelector<HTMLElement>("canvas[data-video]")!;
          return { words, transform: canvas.parentElement!.style.transform, videoSeek: canvas.dataset.seek };
        });
        assert.ok(rendered.words.every((word: unknown[]) => word.length === 1), "a word cannot be split across lines");
        for (const rect of rendered.words.flat()) {
          assert.ok(inside(rect, stage(format)), `${format.id}: caption clears platform overlays`);
          const product = panel.product;
          assert.ok(rect.right <= product.x || rect.left >= product.x + product.width || rect.bottom <= product.y || rect.top >= product.y + product.height, "type never overlaps the moving product panel");
        }
        if (frame === 2) { firstRects = rendered.words; firstTransform = rendered.transform; }
        else assert.deepEqual(rendered.words, firstRects, "the copy does not drift, grow or reflow while the camera moves");
        if (frame === 18) assert.notEqual(rendered.transform, firstTransform, "the camera can move independently beside the stable explanation");
        assert.ok(panel.product.content.width * 1.3 <= source.viewport.width * source.videoRatio! + 0.1, "the source is not drawn past its own pixels");
      }
      await page.close();
    }
  } finally { await fixture.close(); }
});

test("recap rows arrive independently without moving the settled rows or splitting their words", async () => {
  const fixture = await browserFixture();
  const rows = [{ id: "one", text: "Encuentra tus proyectos locales", from: 0 }, { id: "two", text: "Conserva el contexto de cada proyecto", from: 45 }, { id: "three", text: "Revisa el trabajo que falta respaldar", from: 90 }];
  const plan: PromoPlan = { sections: [{ kind: "recap", id: "recap", text: "Tu trabajo, a mano", rows, from: 0, to: 150 }], durationInFrames: 150 };
  try {
    for (const format of Object.values(FORMATS)) {
      const page = await fixture.pageFor(format);
      let settled: unknown;
      for (const frame of [20, 65, 120]) {
        await page.evaluate((html: string) => { document.body.innerHTML = html; }, await htmlFor(plan, frame, format));
        const rendered = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-promo-row]")].map((row) => {
          const text = row.querySelector("div")!;
          const node = text.firstChild!;
          const words = [...node.textContent!.matchAll(/\S+/g)].map((match) => {
            const range = document.createRange(); range.setStart(node, match.index!); range.setEnd(node, match.index! + match[0].length);
            return [...range.getClientRects()].map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
          });
          return { visible: getComputedStyle(row).opacity !== "0", active: row.dataset.rowActive === "true", words };
        }));
        assert.deepEqual(rendered.map((row: { visible: boolean }) => row.visible), rows.map((_, i) => promoRowState(rows, i, frame, 30).visible));
        assert.equal(rendered.filter((row: { active: boolean }) => row.active).length, frame === 120 ? 0 : 1, "the final read settles every row's indicator");
        for (const row of rendered.filter((row: { visible: boolean }) => row.visible)) for (const word of row.words) { assert.equal(word.length, 1); assert.ok(inside(word[0], stage(format))); }
        if (frame === 20) settled = rendered[0].words;
        else assert.deepEqual(rendered[0].words, settled, "settling the first row changes its indicator, never its layout");
      }
      await page.close();
    }
  } finally { await fixture.close(); }
});

test("terminal and code type the exact sourced characters and hold their layout without fabricated output", async () => {
  const fixture = await browserFixture();
  const texts = { terminal: "pnpm panoma-video promo ./mi-proyecto --langs=es", code: 'const project = {\n  name: "Catálogo 🧭",\n  local: true\n};\nexport default project;' };
  try {
    for (const format of Object.values(FORMATS)) for (const kind of ["terminal", "code"] as const) {
      const page = await fixture.pageFor(format);
      const text = texts[kind];
      const section = { kind, id: kind, from: 0, typingTo: 75, to: 135, text, source: kind === "terminal" ? "Comando documentado" : "Ejemplo documentado" };
      const plan: PromoPlan = { sections: [section], durationInFrames: 135 };
      let firstPositions: unknown;
      for (const frame of [0, 30, 75, 120]) {
        await page.evaluate((html: string) => { document.body.innerHTML = html; }, await htmlFor(plan, frame, format));
        const rendered = await page.evaluate(() => {
          const chars = [...document.querySelectorAll<HTMLElement>("[data-source-char]")];
          return { all: chars.map((span) => span.firstChild!.textContent).join(""), visible: chars.filter((span) => span.dataset.revealed === "true").map((span) => span.firstChild!.textContent).join(""), positions: chars.map((span) => { const r = span.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }), carets: document.querySelectorAll("[data-source-caret]").length, canvases: document.querySelectorAll("canvas[data-video]").length, prompt: document.querySelector("[data-terminal-prompt]")?.textContent, chrome: document.querySelectorAll("[data-terminal-chrome]").length, tokenRows: [...document.querySelectorAll<HTMLElement>("[data-source-token]")].map((token) => ({ text: token.dataset.sourceToken, rows: [...new Set([...token.querySelectorAll<HTMLElement>("[data-source-char]")].map((span) => span.getBoundingClientRect().top))] })) };
        });
        assert.equal(rendered.all, text, "every source character, including Unicode, remains exact");
        assert.equal(rendered.visible, [...text].slice(0, promoTypedCount(text, 0, 75, frame)).join(""));
        assert.equal(rendered.canvases, 0, "a source card owns its frame");
        assert.equal(rendered.chrome, kind === "terminal" ? 1 : 0, "terminal chrome is distinct from a repository code excerpt");
        assert.equal(rendered.prompt, kind === "terminal" ? "$" : undefined, "the shell prompt is outside the quoted source text");
        if (kind === "terminal") for (const token of rendered.tokenRows) assert.equal(token.rows.length, 1, `${format.id}: ${token.text} must wrap as one shell token`);
        if (frame === 0) firstPositions = rendered.positions;
        else assert.deepEqual(rendered.positions, firstPositions, "the complete source reserves its layout before typing begins");
        assert.equal(rendered.carets, frame <= 75 ? 1 : 0);
        for (const position of rendered.positions) assert.ok(inside(position, stage(format)), `${format.id}: source text fits the safe stage`);
      }
      await page.close();
    }
  } finally { await fixture.close(); }
});

test("source syntax stays readable when a brand accent matches the card ground", async () => {
  const fixture = await browserFixture();
  try {
    const { createElement } = renderRequire("react");
    const { DEFAULT_DIRECTION } = await import("@panoma/video-brand/direction");
    const { PromoSource } = await import("../apps/render/src/lib/PromoEffects.tsx");
    const { renderFrameHtml } = await import("@panoma/video-engine");
    const page = await fixture.pageFor(FORMATS.v);
    const colors = { paper: DEFAULT_DIRECTION.accent.hex, ink: DEFAULT_DIRECTION.stage.hex, muted: DEFAULT_DIRECTION.stage.hex };
    const text = 'const project = "local"; // a sourced value';
    const html = renderFrameHtml(createElement(PromoSource, { format: FORMATS.v, kind: "code", text, visibleCount: 99, caret: false, colors }), { frame: 90, fps: 30, format: FORMATS.v, durationInFrames: 150 });
    await page.evaluate((html: string) => { document.body.innerHTML = html; }, html);
    const read = await page.evaluate(() => ({ text: [...document.querySelectorAll<HTMLElement>("[data-source-char]")].map((span) => span.firstChild!.textContent).join(""), inks: [...document.querySelectorAll<HTMLElement>("[data-source-char]")].map((span) => getComputedStyle(span).color), paper: getComputedStyle(document.querySelector("[data-source-panel]")!).backgroundColor }));
    const hex = (rgb: string) => `#${rgb.match(/\d+/g)!.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
    assert.equal(read.text, text, "a palette fallback keeps the source exact");
    assert.ok(read.inks.every((ink: string) => contrastRatio(hex(ink), hex(read.paper)) >= 4.5), "an unusable brand accent falls back to readable neutral syntax colors");
    assert.ok(new Set(read.inks).size >= 2, "a neutral string tint retains hierarchy even without a usable brand accent");
    await page.close();
  } finally { await fixture.close(); }
});
