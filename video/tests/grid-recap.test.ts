import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { test } from "node:test";
import "@panoma/video-engine/register";
import { FORMATS, stage, type Format } from "@panoma/video-core";
import { promoGridGround, promoThemeTokens } from "../apps/render/src/recipes/editorial.ts";
import { promoRowState } from "../apps/render/src/recipes/presentation.ts";

const renderRequire = createRequire(new URL("../apps/render/package.json", import.meta.url));
const engineRequire = createRequire(new URL("../packages/engine/package.json", import.meta.url));
const texts = ["Encuentra tus proyectos locales", "Conserva el contexto de cada proyecto", "Revisa el trabajo que falta respaldar"];
const title = "Tu trabajo, a mano";
const longCopy = ["Encuentra y organiza los proyectos locales que necesitas para continuar tu trabajo", "Conserva el contexto\ny vuelve a cada proyecto con sus archivos y notas a mano", "Revisa el trabajo que todavía falta respaldar antes de continuar con el siguiente proyecto"];

async function fixture() {
  const { chromium } = engineRequire("playwright");
  const { startAssetServer, renderFrameHtml } = await import("@panoma/video-engine");
  const { createElement } = renderRequire("react");
  const { GridRecap } = await import("../apps/render/src/lib/GridRecap.tsx");
  const server = await startAssetServer({ assets: tmpdir() });
  const browser = await chromium.launch({ headless: true });
  const pageFor = async (format: Format) => {
    const page = await browser.newPage({ viewport: { width: format.width, height: format.height } });
    await page.goto(`${server.origin}/__shell__?w=${format.width}&h=${format.height}`);
    await page.evaluate(async () => { await document.fonts.load('680 60px "Geist"'); await document.fonts.load('560 40px "Geist"'); await document.fonts.ready; });
    return page;
  };
  const htmlFor = (format: Format, light: boolean, current: number, progress: number, checked = 0, active = true, copy = texts, heading = title, cascade?: { frame: number; hop: number }) => {
    const colors = light ? { paper: "#f4f5f1", ink: "#1c2429", muted: "#566064" } : { paper: "#10151b", ink: "#f3f5ef", muted: "#a8b1b9" };
    const design = promoThemeTokens("grid", colors, colors.ink);
    const arrivals = copy.map((_, index) => ({ from: index * (cascade?.hop ?? 0) }));
    const rows = copy.map((text, index) => ({ id: `row-${index}`, text, ...(cascade ? promoRowState(arrivals, index, cascade.frame, 30, "grid") : { visible: index <= current, progress: index < current ? 1 : index === current ? progress : 0, checked, active: index === current && active }) }));
    const element = createElement("div", { style: { position: "absolute", inset: 0, background: promoGridGround(colors).paper } }, createElement(GridRecap, { format, title: heading, rows, colors, design }));
    return renderFrameHtml(element, { frame: 0, fps: 30, format, durationInFrames: 180 });
  };
  return { pageFor, htmlFor, close: async () => { await browser.close(); await server.close(); } };
}

test("Grid's flexible deck keeps every sourced word safe and uncovered throughout arrivals", async () => {
  const f = await fixture();
  try {
    for (const format of Object.values(FORMATS)) {
      const page = await f.pageFor(format);
      for (const light of [false, true]) for (const copy of [texts.slice(0, 2), texts, longCopy]) {
        for (let current = 0; current < copy.length; current++) for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
          const heading = copy === longCopy ? "El contexto y las herramientas que necesitas para continuar con cada uno de tus proyectos" : title;
          await page.evaluate((html: string) => { document.body.innerHTML = html; }, f.htmlFor(format, light, current, progress, 0, true, copy, heading));
          const measured = await page.evaluate(() => {
            const words: { text: string; left: number; right: number; top: number; bottom: number; covered: boolean }[] = [];
            for (const element of document.querySelectorAll<HTMLElement>("[data-recap-copy], [data-recap-title]")) {
              const row = element.closest<HTMLElement>("[data-grid-card]");
              if (row?.dataset.rowVisible === "false") continue;
              const text = element.firstChild!;
              for (const match of text.textContent!.matchAll(/\S+/g)) {
                const range = document.createRange(); range.setStart(text, match.index!); range.setEnd(text, match.index! + match[0].length);
                for (const rect of range.getClientRects()) if (rect.width && rect.height) {
                  const painted = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
                  const covered = painted !== element && !element.contains(painted);
                  words.push({ text: match[0], left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, covered });
                }
              }
            }
            const edges = [...document.querySelectorAll<SVGGraphicsElement>('[data-row-visible="true"] [data-grid-surface] path')].flatMap((path) => {
              const bounds = path.getBBox();
              const matrix = path.getScreenCTM()!;
              return [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y], [bounds.x, bounds.y + bounds.height], [bounds.x + bounds.width, bounds.y + bounds.height]].map(([x, y]) => { const point = new DOMPoint(x, y).matrixTransform(matrix); return { x: point.x, y: point.y }; });
            });
            return { theme: document.querySelector<HTMLElement>("[data-grid-recap]")!.dataset.editorialTheme, copies: [...document.querySelectorAll<HTMLElement>('[data-row-visible="true"] [data-recap-copy]')].map((element) => element.textContent), words, edges };
          });
          assert.equal(measured.theme, "grid");
          assert.deepEqual(measured.copies, copy.slice(0, current + 1), "the deck preserves exact source copy");
          const safe = stage(format);
          for (const word of measured.words) {
            assert.ok(word.left >= safe.x - 0.1 && word.right <= safe.x + safe.width + 0.1 && word.top >= safe.y - 0.1 && word.bottom <= safe.y + safe.height + 0.1, `${format.id} row ${current} at ${progress}: ${word.text} must stay inside Stage: ${JSON.stringify(word)}`);
            assert.equal(word.covered, false, `${format.id} row ${current} at ${progress}: no arriving paper may cover ${word.text}`);
          }
          for (const edge of measured.edges) assert.ok(edge.x >= safe.x && edge.x <= safe.x + safe.width && edge.y >= safe.y && edge.y <= safe.y + safe.height, `${format.id} row ${current} at ${progress}: the flexing paper stays inside Stage: ${JSON.stringify(edge)}`);
        }
      }
      for (const light of [false, true]) for (const progress of [0.5, 1]) {
        await page.evaluate((html: string) => { document.body.innerHTML = html; }, f.htmlFor(format, light, 2, progress));
        await page.screenshot({ path: `/tmp/panoma-video-grid-recap-${format.id}-${light ? "light" : "dark"}-${progress}.png` });
      }
      await page.close();
    }
  } finally { await f.close(); }
});

test("Grid bends only its paper edge and all visible motion ends with the row entrance", async () => {
  const f = await fixture();
  try {
    for (const format of Object.values(FORMATS)) {
      const page = await f.pageFor(format);
      const states = [];
      for (const progress of [0, 0.5, 1]) {
        await page.evaluate((html: string) => { document.body.innerHTML = html; }, f.htmlFor(format, true, 2, progress));
        states.push(await page.evaluate(() => {
          const cards = [...document.querySelectorAll<HTMLElement>("[data-grid-card]")];
          return cards.map((row) => {
            const copy = row.querySelector<HTMLElement>("[data-grid-copy-plane]")!;
            const style = getComputedStyle(copy);
            return { surface: row.querySelector("[data-grid-surface] path")!.getAttribute("d"), bend: row.dataset.gridBend, transform: row.style.transform, copy: copy.textContent, copyStyle: copy.getAttribute("style"), textTransform: style.transform, margin: row.querySelector("[data-grid-margin]")!.outerHTML, fold: row.querySelector("[data-grid-fold]")!.outerHTML, plies: row.querySelectorAll("[data-grid-ply]").length };
          });
        }));
      }
      assert.deepEqual(states[0].slice(0, 2), states[1].slice(0, 2), "completed cards remain still when another arrives");
      assert.deepEqual(states[1].slice(0, 2), states[2].slice(0, 2));
      assert.notEqual(states[1][2].surface, states[2][2].surface, "the arriving edge visibly bows then becomes flat");
      assert.ok(Math.abs(Number(states[1][2].bend)) >= 100, "the paper edge whips visibly through the larger entrance");
      assert.equal(states[2][2].bend, "0.000");
      assert.equal(states[2][2].transform, "translate(0px, 0px) rotate(0deg)");
      const arrival = states[0][2].transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) rotate\(([-\d.]+)deg\)/)!;
      assert.ok(Math.abs(Number(arrival[1])) >= 50 && Number(arrival[2]) >= 110 && Math.abs(Number(arrival[3])) >= 5, "the decisive travel and turn remain materially stronger than the earlier small settle");
      assert.equal(states[2][2].plies, 2, "two monochrome paper edges provide thickness without a shadow");
      for (const state of states) { assert.equal(state[2].copyStyle, states[0][2].copyStyle); assert.equal(state[2].textTransform, "none"); assert.equal(state[2].copy, texts[2]); }
      const atRest = await page.screenshot();
      await page.evaluate((html: string) => { document.body.innerHTML = html; }, f.htmlFor(format, true, 2, 1, 1, false));
      assert.deepEqual(await page.screenshot(), atRest, "the generic later checked/active state cannot animate a settled Grid card");
      await page.close();
    }
  } finally { await f.close(); }
});

test("the faster overlapping cascade stays readable and settled cards fit their own content", async () => {
  const f = await fixture();
  const copy = ["Contexto", "Encuentra tus proyectos locales y conserva los archivos y notas que necesitas para continuar", "Tu trabajo, a mano"];
  try {
    for (const format of Object.values(FORMATS)) {
      const page = await f.pageFor(format);
      for (const hop of [5, 8]) for (let frame = 0; frame <= 30; frame++) {
        await page.evaluate((html: string) => { document.body.innerHTML = html; }, f.htmlFor(format, true, 2, 1, 0, true, copy, title, { frame, hop }));
        const words = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-row-visible="true"] [data-recap-copy]')].flatMap((element) => {
          const node = element.firstChild!;
          return [...node.textContent!.matchAll(/\S+/g)].flatMap((match) => {
            const range = document.createRange(); range.setStart(node, match.index!); range.setEnd(node, match.index! + match[0].length);
            return [...range.getClientRects()].map((rect) => ({ text: match[0], x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, uncovered: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === element }));
          });
        }));
        const safe = stage(format);
        for (const word of words) {
          assert.ok(word.x >= safe.x && word.y >= safe.y && word.right <= safe.x + safe.width && word.bottom <= safe.y + safe.height, `${format.id}, hop ${hop}, frame ${frame}: ${word.text} is safe during simultaneous entrances`);
          assert.ok(word.uncovered, `${format.id}, hop ${hop}, frame ${frame}: the faster cascade cannot cover ${word.text}`);
        }
      }
      const settled = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-grid-card]")].map((row) => {
        const text = row.querySelector<HTMLElement>("[data-recap-copy]")!;
        const surface = row.querySelector<SVGElement>("[data-grid-face]")!;
        return { height: row.getBoundingClientRect().height, textHeight: text.getBoundingClientRect().height, fontSize: parseFloat(getComputedStyle(text).fontSize), fill: getComputedStyle(surface).fill, ink: getComputedStyle(text).color, checks: row.querySelectorAll("[data-recap-check], [data-grid-check]").length };
      }));
      assert.ok(settled[1].height > settled[0].height * 1.5, "a short benefit no longer inherits the longest card's empty body");
      assert.ok(Math.abs((settled[0].height - settled[0].textHeight) - (settled[1].height - settled[1].textHeight)) <= 1, "each card reserves only the same small decorative margin around its own text");
      for (const row of settled) {
        assert.ok(row.textHeight / row.height >= 0.3, `${format.id}: short cards keep useful text density`);
        assert.ok(row.fontSize >= 32, `${format.id}: compact packing preserves a readable font`);
        assert.equal(row.checks, 0, "the paper deck is editorial copy, without a fabricated status indicator");
        for (const color of [row.fill, row.ink]) { const channels = color.match(/[\d.]+/g)!.map(Number); assert.equal(channels[0], channels[1]); assert.equal(channels[1], channels[2]); }
      }
      await page.close();
    }
  } finally { await f.close(); }
});
