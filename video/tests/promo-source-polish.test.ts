import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { test } from "node:test";
import "@panoma/video-engine/register";
import { FORMATS, stage } from "@panoma/video-core";
import { contrastRatio } from "@panoma/video-brand/contrast";

const renderRequire = createRequire(new URL("../apps/render/package.json", import.meta.url));
const engineRequire = createRequire(new URL("../packages/engine/package.json", import.meta.url));

test("source panels preserve Unicode and stable character positions across reveal, inside all safe formats", async () => {
  const { createElement } = renderRequire("react");
  const { chromium } = engineRequire("playwright");
  const { PromoSource } = await import("../apps/render/src/lib/PromoSource.tsx");
  const { renderFrameHtml, startAssetServer } = await import("@panoma/video-engine");
  const server = await startAssetServer({ assets: tmpdir() });
  const browser = await chromium.launch({ headless: true });
  const texts = {
    terminal: "pnpm panoma-video promo ./catálogo-local --langs=es --no-camera",
    code: '/* A source excerpt,\n   with its original line breaks. */\nconst project = {\n  name: "Catálogo 🧭",\n  path: "./proyectos/ejemplos/una-ruta-que-debe-conservarse",\n  local: true,\n};\nexport default project;',
  };
  try {
    for (const format of Object.values(FORMATS)) for (const kind of ["terminal", "code"] as const) {
      const page = await browser.newPage({ viewport: { width: format.width, height: format.height } });
      await page.goto(`${server.origin}/__shell__?w=${format.width}&h=${format.height}`);
      await page.evaluate(async () => { await document.fonts.load('600 48px "Geist Mono"'); await document.fonts.load('450 48px "Geist Mono"'); await document.fonts.load('500 28px "Geist"'); await document.fonts.ready; });
      const text = texts[kind];
      let positions: unknown;
      for (const count of [0, 1, 45, [...text].length]) {
        const html = renderFrameHtml(createElement(PromoSource, { format, kind, text, source: kind === "terminal" ? "Terminal" : "Configuración del proyecto", visibleCount: count, caret: count < [...text].length, colors: { paper: "#14171f", ink: "#f1f2f3", muted: "#a6adb7" } }), { frame: count, fps: 30, format, durationInFrames: 300 });
        await page.evaluate((html: string) => { document.body.innerHTML = html; }, html);
        const read = await page.evaluate(() => {
          const rect = (node: Element) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
          const chars = [...document.querySelectorAll<HTMLElement>("[data-source-char]")];
          return {
            text: chars.map((char) => char.firstChild!.textContent).join(""),
            visible: chars.filter((char) => char.dataset.revealed === "true").map((char) => char.firstChild!.textContent).join(""),
            positions: chars.map((char) => rect(char)),
            panel: rect(document.querySelector("[data-source-panel]")!),
            gutter: [...document.querySelectorAll("[data-source-line-number]")].map((n) => n.textContent),
            active: [...document.querySelectorAll<HTMLElement>('[data-source-line-active="true"]')].map((line) => Number(line.dataset.sourceLine)),
            codeFont: Number.parseFloat(getComputedStyle(document.querySelector("[data-source-text]")!).fontSize),
            tokens: [...document.querySelectorAll<HTMLElement>("[data-source-token]")].map((token) => ({ text: token.dataset.sourceToken, rows: [...new Set([...token.querySelectorAll("[data-source-char]")].map((char) => char.getBoundingClientRect().top))] })),
          };
        });
        assert.equal(read.text, text, "line-number furniture cannot enter or alter the verbatim source");
        assert.equal(read.visible, [...text].slice(0, count).join(""));
        if (positions) assert.deepEqual(read.positions, positions, "arriving chrome and advancing type keep a fixed character grid");
        else positions = read.positions;
        const safe = stage(format);
        assert.ok(read.panel.left >= safe.x && read.panel.right <= safe.x + safe.width && read.panel.top >= safe.y && read.panel.bottom <= safe.y + safe.height, `${format.id}/${kind}: panel fits safe stage`);
        for (const rect of read.positions) assert.ok(rect.left >= read.panel.left && rect.right <= read.panel.right + 0.1 && rect.top >= read.panel.top && rect.bottom <= read.panel.bottom + 0.1, `${format.id}/${kind}: source never overflows its own frame`);
        if (kind === "terminal") {
          assert.deepEqual(read.gutter, []);
          assert.ok(read.codeFont >= 40, "ordinary commands remain large enough for a phone preview");
          for (const token of read.tokens) assert.equal(token.rows.length, 1, `${format.id}: ${token.text} remains a whole shell token`);
        } else {
          assert.deepEqual(read.gutter, text.split("\n").map((_, i) => String(i + 1)));
          assert.ok(read.active.length === (count < [...text].length ? 1 : 0), "only the currently typed source line receives the transient highlight");
        }
      }
      await page.close();
    }
  } finally { await browser.close(); await server.close(); }
});

test("a short terminal has deliberate proportions and source colors contrast against both surfaces", async () => {
  const { createElement } = renderRequire("react");
  const { chromium } = engineRequire("playwright");
  const { PromoSource } = await import("../apps/render/src/lib/PromoSource.tsx");
  const { renderFrameHtml, startAssetServer } = await import("@panoma/video-engine");
  const server = await startAssetServer({ assets: tmpdir() });
  const browser = await chromium.launch({ headless: true });
  try {
    const format = FORMATS.h;
    const page = await browser.newPage({ viewport: { width: format.width, height: format.height } });
    await page.goto(`${server.origin}/__shell__?w=${format.width}&h=${format.height}`);
    await page.evaluate(async () => { await document.fonts.load('450 70px "Geist Mono"'); await document.fonts.ready; });
    const colorsList = [{ paper: "#14171f", ink: "#f1f2f3", muted: "#a6adb7" }, { paper: "#fafafa", ink: "#101219", muted: "#676a70" }];
    for (const colors of colorsList) for (const kind of ["terminal", "code"] as const) {
      const text = kind === "terminal" ? "npx panoma-video" : 'const project = "local"; // original source';
      const html = renderFrameHtml(createElement(PromoSource, { format, kind, text, visibleCount: 20, caret: true, colors, caretOpacity: 0.6 }), { frame: 30, fps: 30, format, durationInFrames: 150 });
      await page.evaluate((html: string) => { document.body.innerHTML = html; }, html);
      const read = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>("[data-source-panel]")!;
        const body = document.querySelector<HTMLElement>("[data-source-text]")!;
        const active = document.querySelector<HTMLElement>('[data-source-line-active="true"]');
        return { width: panel.getBoundingClientRect().width, font: parseFloat(getComputedStyle(body).fontSize), surface: getComputedStyle(panel).backgroundColor, active: active ? getComputedStyle(active).backgroundColor : getComputedStyle(panel).backgroundColor, inks: [...new Set([...document.querySelectorAll<HTMLElement>("[data-source-char]")].map((c) => getComputedStyle(c).color))], label: document.querySelector("[data-source-label]")!.textContent };
      });
      const hex = (rgb: string) => `#${rgb.match(/\d+/g)!.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
      for (const ink of read.inks) for (const ground of [read.surface, read.active]) assert.ok(contrastRatio(hex(ink), hex(ground)) >= 4.5, "source, comments and syntax stay readable on the active line as well as the card");
      assert.equal(read.label, kind === "terminal" ? "Terminal" : "Code", "generic chrome never guesses a filename or execution status");
      if (kind === "terminal") { assert.ok(read.width < stage(format).width * 0.8, "a short command does not stretch into an empty widescreen window"); assert.ok(read.font >= 68, "the command, rather than empty furniture, owns the frame"); }
    }
    await page.close();
  } finally { await browser.close(); await server.close(); }
});

test("code wraps reserve each original line before the next line, including the largest allowed excerpt", async () => {
  const { createElement } = renderRequire("react");
  const { chromium } = engineRequire("playwright");
  const { PromoSource } = await import("../apps/render/src/lib/PromoSource.tsx");
  const { renderFrameHtml, startAssetServer } = await import("@panoma/video-engine");
  const server = await startAssetServer({ assets: tmpdir() });
  const browser = await chromium.launch({ headless: true });
  const phrase = "expressionOne expressionTwo expressionTri";
  const excerpts = [
    `const category = {\n  // ${phrase}\n  // ${phrase}\n};`,
    Array.from({ length: 8 }, (_, i) => `// ${phrase}${" ".repeat(i === 7 ? 12 : 13)}`).join("\n").slice(0, 400),
    ["// " + "a".repeat(67), "// " + "Á".repeat(67), "// " + "界".repeat(67), `// ${phrase}`].join("\n"),
  ];
  assert.equal(excerpts[1].length, 400, "exercise the full permitted source budget");
  assert.ok(excerpts.every((text) => text.length <= 400 && text.split("\n").length <= 8 && text.split("\n").every((line) => line.length <= 70)));
  try {
    for (const format of Object.values(FORMATS)) {
      const page = await browser.newPage({ viewport: { width: format.width, height: format.height } });
      await page.goto(`${server.origin}/__shell__?w=${format.width}&h=${format.height}`);
      await page.evaluate(async () => { await document.fonts.load('600 48px "Geist Mono"'); await document.fonts.load('450 48px "Geist Mono"'); await document.fonts.ready; });
      for (const text of excerpts) {
        let first: unknown;
        for (const count of [0, [...text].length]) {
          const html = renderFrameHtml(createElement(PromoSource, { format, kind: "code", text, visibleCount: count, caret: count === 0, colors: { paper: "#14171f", ink: "#f1f2f3", muted: "#a6adb7" } }), { frame: count, fps: 30, format, durationInFrames: 450 });
          await page.evaluate((html: string) => { document.body.innerHTML = html; }, html);
          const read = await page.evaluate(() => {
            const rect = (node: Element) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
            return { panel: rect(document.querySelector("[data-source-panel]")!), text: [...document.querySelectorAll("[data-source-char]")].map((c) => c.firstChild!.textContent).join(""), rows: [...document.querySelectorAll("[data-source-line]")].map((line) => ({ rect: rect(line), glyphs: [...line.querySelectorAll("[data-source-char]")].filter((char) => /\S/.test(char.firstChild!.textContent!)).map(rect) })) };
          });
          assert.equal(read.text, text);
          if (first) assert.deepEqual(read.rows, first, "wrapping reserves its full height before any character arrives");
          else first = read.rows;
          const safe = stage(format);
          assert.ok(read.panel.top >= safe.y && read.panel.bottom <= safe.y + safe.height, `${format.id}: the complete allowed excerpt fits the safe stage`);
          for (const [i, row] of read.rows.entries()) {
            for (const glyph of row.glyphs) assert.ok(glyph.top >= row.rect.top - 0.1 && glyph.bottom <= row.rect.bottom + 0.1 && glyph.left >= row.rect.left - 0.1 && glyph.right <= row.rect.right + 0.1, `${format.id}: a wrapped glyph on original line ${i + 1} must remain inside that line's reserved row`);
            if (i) assert.ok(row.rect.top >= read.rows[i - 1].rect.bottom - 0.1, `${format.id}: original source lines cannot overlap`);
          }
        }
      }
      await page.close();
    }
  } finally { await browser.close(); await server.close(); }
});
