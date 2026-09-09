import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { test } from "node:test";
import "@panoma/video-engine/register";
import { FORMATS, stage, type Format } from "@panoma/video-core";
import { promoPanelLayout } from "../apps/render/src/recipes/presentation.ts";

const renderRequire = createRequire(new URL("../apps/render/package.json", import.meta.url));
const engineRequire = createRequire(new URL("../packages/engine/package.json", import.meta.url));

async function fixture() {
  const { chromium } = engineRequire("playwright");
  const { startAssetServer, renderFrameHtml } = await import("@panoma/video-engine");
  const { createElement } = renderRequire("react");
  const { PromoSideText, PromoRecap } = await import("../apps/render/src/lib/PromoEffects.tsx");
  const server = await startAssetServer({ assets: tmpdir() });
  const browser = await chromium.launch({ headless: true });
  const pageFor = async (format: Format) => {
    const page = await browser.newPage({ viewport: { width: format.width, height: format.height } });
    await page.goto(`${server.origin}/__shell__?w=${format.width}&h=${format.height}`);
    await page.evaluate(async () => { await document.fonts.load('680 100px "Geist"'); await document.fonts.ready; });
    return page;
  };
  const htmlFor = (component: typeof PromoSideText | typeof PromoRecap, props: object, format: Format) => renderFrameHtml(createElement(component, props), { frame: 30, fps: 30, format, durationInFrames: 120 });
  return { PromoSideText, PromoRecap, pageFor, htmlFor, close: async () => { await browser.close(); await server.close(); } };
}

test("split typography groups the actual Spanish benefits into balanced whole-word lines", async () => {
  const f = await fixture();
  const texts = ["Todos tus proyectos locales, en un catálogo", "Descubre el trabajo sin respaldo", "Empieza con un comando documentado"];
  try {
    for (const format of Object.values(FORMATS)) {
      const page = await f.pageFor(format);
      const viewport = { width: 1600, height: 900 };
      const rect = promoPanelLayout(format, viewport, { videoRatio: 2 }).text;
      for (const text of texts) {
        await page.evaluate((html: string) => { document.body.innerHTML = html; }, f.htmlFor(f.PromoSideText, { format, rect, text, ink: "#20242b" }, format));
        const words = await page.evaluate(() => {
          const element = document.querySelector<HTMLElement>("[data-promo-copy]")!;
          const node = element.firstChild!;
          return [...node.textContent!.matchAll(/\S+/g)].map((word) => {
            const range = document.createRange(); range.setStart(node, word.index!); range.setEnd(node, word.index! + word[0].length);
            return [...range.getClientRects()].map((r) => ({ text: word[0], x: r.x, y: r.y, right: r.right, bottom: r.bottom }));
          });
        });
        const byLine = new Map<number, string[]>();
        for (const word of words) {
          assert.equal(word.length, 1, `${format.id}: no split word in ${text}`);
          assert.ok(word[0].x >= rect.x && word[0].right <= rect.x + rect.width + 0.1);
          assert.ok(word[0].y >= rect.y && word[0].bottom <= rect.y + rect.height + 0.1);
          const line = Math.round(word[0].y);
          byLine.set(line, [...(byLine.get(line) ?? []), word[0].text]);
        }
        assert.ok([...byLine.values()].every((line) => line.length >= 2), `${format.id}: balanced lines do not strand one word: ${JSON.stringify([...byLine.values()])}`);
      }
      await page.close();
    }
  } finally { await f.close(); }
});

test("recap hierarchy keeps a compact column, fixed rows and a continuous completion stroke", async () => {
  const f = await fixture();
  const rows = [{ id: "one", text: "Encuentra tus proyectos locales" }, { id: "two", text: "Conserva el contexto de cada proyecto" }, { id: "three", text: "Revisa el trabajo que falta respaldar" }];
  try {
    for (const format of Object.values(FORMATS)) {
      const page = await f.pageFor(format);
      let initialPositions: unknown;
      for (const checked of [0, 0.4, 1]) {
        const colors = { paper: "#ffffff", ink: "#20242b", muted: "#686b70" };
        const props = { format, title: "Tu trabajo, a mano", rows: rows.map((row, i) => ({ ...row, visible: true, active: i === 1, progress: 1, checked: i === 1 ? checked : 1 })), colors };
        await page.evaluate((html: string) => { document.body.innerHTML = html; }, f.htmlFor(f.PromoRecap, props, format));
        const measured = await page.evaluate(() => {
          const group = document.querySelector<HTMLElement>("[data-promo-recap]")!;
          const bounds = group.getBoundingClientRect();
          const title = document.querySelector<HTMLElement>("[data-recap-title]")!;
          const copies = [...document.querySelectorAll<HTMLElement>("[data-recap-copy]")];
          return { bounds: { x: bounds.x, y: bounds.y, width: bounds.width, bottom: bounds.bottom }, titleSize: parseFloat(getComputedStyle(title).fontSize), rowSizes: copies.map((row) => parseFloat(getComputedStyle(row).fontSize)), positions: copies.map((row) => { const r = row.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, weight: getComputedStyle(row).fontWeight }; }), rails: document.querySelectorAll("[data-recap-rail]").length, check: document.querySelectorAll("[data-recap-check]")[1].getAttribute("stroke-dashoffset") };
        });
        const safe = stage(format);
        assert.ok(measured.bounds.width <= Math.min(format.width, format.height) * 1.23, "the reading column cannot stretch across a wide canvas");
        assert.ok(measured.bounds.y >= safe.y && measured.bounds.bottom <= safe.y + safe.height);
        assert.ok(measured.rowSizes.every((size: number) => size > measured.titleSize * 1.2), "the benefit rows lead the quieter recap heading");
        assert.equal(measured.rails, rows.length - 1);
        assert.ok(Math.abs(Number(measured.check) - (1 - checked)) < 0.0001, "the check is drawn by its completion share, not swapped as a glyph");
        if (checked === 0) initialPositions = measured.positions;
        else assert.deepEqual(measured.positions, initialPositions, "completion never shifts the text or changes its weight");
      }
      await page.close();
    }
  } finally { await f.close(); }
});
