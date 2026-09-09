import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { test } from "node:test";
import "@panoma/video-engine/register";
import { FORMATS, stage, type EditorialTheme } from "@panoma/video-core";
import { contrastRatio } from "@panoma/video-brand/contrast";
import { EDITORIAL_COLORS } from "@panoma/video-core/theme";
import { DEFAULT_DIRECTION, mix } from "@panoma/video-brand/direction";
import { promoGridGround, promoThemeTokens } from "../apps/render/src/recipes/editorial.ts";
import { promoPanelLayout } from "../apps/render/src/recipes/presentation.ts";

const renderRequire = createRequire(new URL("../apps/render/package.json", import.meta.url));
const engineRequire = createRequire(new URL("../packages/engine/package.json", import.meta.url));
const palettes = [
  { paper: "#14171f", ink: "#f1f2f3", muted: "#a6adb7" },
  { paper: "#fafafa", ink: "#101219", muted: "#676a70" },
];
const colorfulPalettes = [
  { paper: "#241285", ink: "#eaff00", muted: "#ff38d9" },
  { paper: "#ffff00", ink: "#003cff", muted: "#db006c" },
];
const isNeutral = (color: string) => /^#([a-f\d]{2})\1\1$/i.test(color);

test("editorial tokens keep Flat compatible and select one readable accent for Vibrant", () => {
  for (const colors of palettes) {
    const flat = promoThemeTokens("flat", colors, "#6d49dd");
    assert.deepEqual(promoThemeTokens(undefined, colors, "#6d49dd"), flat);
    assert.equal(flat.surface, mix(colors.paper, colors.ink, 0.025));
    assert.equal(flat.header, mix(colors.paper, colors.ink, 0.047));
    assert.equal(flat.rule, mix(colors.paper, colors.ink, 0.19));
    for (const accent of ["#6d49dd", "#dbff64", "#111827", "#fafafa", "#0a0a0a"]) {
      const theme = promoThemeTokens("vibrant", colors, accent);
      const neutral = ["#111827", "#fafafa", "#0a0a0a"].includes(accent);
      assert.equal(theme.accentOrigin, neutral ? "editorial" : "brand");
      assert.equal(theme.accent, neutral ? EDITORIAL_COLORS.vibrantAccent : accent);
      assert.equal(theme.header, theme.accent, "one chosen accent also owns the terminal and code header");
      assert.ok(contrastRatio(theme.headerInk, theme.header) >= 4.5);
      assert.ok(contrastRatio(theme.onAccent, theme.accent) >= 4.5);
      for (const ink of [theme.textInk, theme.mutedInk]) for (const surface of [theme.surface, theme.activeSurface]) assert.ok(contrastRatio(ink, surface) >= 4.5);
      assert.ok(theme.corner < flat.corner, "Vibrant has squared block geometry");
      const block = promoThemeTokens("block", colors, accent);
      assert.equal(block.accentOrigin, neutral ? "editorial" : "brand");
      assert.equal(block.accent, neutral ? EDITORIAL_COLORS.blockAccent : accent);
      assert.ok(block.depth > 0 && theme.depth === 0 && flat.depth === 0, "only Block earns a hard offset base");
      const grid = promoThemeTokens("grid", colors, accent);
      assert.equal(grid.accentOrigin, "editorial");
      assert.equal(grid.accent, promoGridGround(colors).ink);
      assert.equal(grid.depth, 0, "Grid does not borrow a Block offset base");
      assert.ok(contrastRatio(grid.onAccent, grid.accent) >= 4.5);
      for (const ink of [grid.textInk, grid.mutedInk]) for (const surface of [grid.surface, grid.activeSurface]) assert.ok(contrastRatio(ink, surface) >= 4.5);
      assert.ok(block.corner > flat.corner && block.border > theme.border, "Block is rounder and outlined, not a Vibrant recolor");
      assert.ok(contrastRatio(block.onSecondary, block.secondary) >= 4.5);
      for (const ink of [block.textInk, block.mutedInk]) for (const surface of [block.surface, block.activeSurface]) assert.ok(contrastRatio(ink, surface) >= 4.5);
    }
  }
  assert.throws(() => promoThemeTokens("flat+vibrant" as EditorialTheme, palettes[0], "#fafafa"), /Unknown editorial theme/);
});

test("Grid furniture is monochrome even for a saturated identity, while Normal retains its original palette", () => {
  for (const colors of [...palettes, ...colorfulPalettes]) {
    const ground = promoGridGround(colors);
    assert.ok(Object.values(ground).every(isNeutral));
    assert.ok(contrastRatio(ground.ink, ground.paper) >= 4.5);
    const expected = promoThemeTokens("grid", colors, "#ff0000");
    for (const accent of ["#00ff00", "#0000ff", "#f3cc55", "#a9dbcf", "#151515"]) {
      const tokens = promoThemeTokens("grid", colors, accent);
      assert.deepEqual(tokens, expected, "a brand accent cannot recolor Grid's added graphics");
      for (const [name, value] of Object.entries(tokens)) if (typeof value === "string" && value.startsWith("#")) assert.ok(isNeutral(value), `${name} must be ink, paper or neutral gray`);
      assert.notEqual(tokens.face, tokens.accent, "the face is paper, not a solid accent field");
      for (const ink of [tokens.textInk, tokens.mutedInk]) for (const surface of [tokens.surface, tokens.activeSurface]) assert.ok(contrastRatio(ink, surface) >= 4.5);
    }
    const normal = promoThemeTokens(undefined, colors, "#ff0099");
    assert.deepEqual(normal, promoThemeTokens("flat", colors, "#ff0099"));
    assert.equal(normal.accent, "#ff0099");
    assert.equal(normal.surface, mix(colors.paper, colors.ink, 0.025));
    assert.equal(normal.header, mix(colors.paper, colors.ink, 0.047));
    assert.equal(normal.rule, mix(colors.paper, colors.ink, 0.19));
  }
});

test("Block recap docks only the new row and reserves every plate base and split word within its safe panel", async () => {
  const { createElement } = renderRequire("react");
  const { chromium } = engineRequire("playwright");
  const { PromoRecap, PromoSideText } = await import("../apps/render/src/lib/PromoEffects.tsx");
  const { renderFrameHtml, startAssetServer } = await import("@panoma/video-engine");
  const server = await startAssetServer({ assets: tmpdir() });
  const browser = await chromium.launch({ headless: true });
  const texts = ["Enfoque sobre una zona real", "Texto estable. Producto en movimiento.", "Comandos y código documentados"];
  try {
    for (const format of Object.values(FORMATS)) {
      const page = await browser.newPage({ viewport: { width: format.width, height: format.height } });
      await page.goto(`${server.origin}/__shell__?w=${format.width}&h=${format.height}`);
      await page.evaluate(async () => { await document.fonts.load('760 70px "Geist"'); await document.fonts.load('700 60px "Geist"'); await document.fonts.ready; });
      for (const colors of palettes) {
        let firstRow: unknown;
        let arrivalY = 0;
        for (const progress of [0, 0.5, 1]) {
          const element = createElement(PromoRecap, { format, title: "Recursos de Panoma", rows: texts.map((text, i) => ({ id: `row-${i}`, text, visible: true, active: i === 2, progress: i === 2 ? progress : 1, checked: i === 2 ? 0 : 1 })), colors, theme: "block" });
          const html = renderFrameHtml(element, { frame: 30, fps: 30, format, durationInFrames: 300 });
          await page.evaluate((html: string) => { document.body.innerHTML = html; }, html);
          const read = await page.evaluate(() => {
            const rect = (node: Element) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
            return [...document.querySelectorAll("[data-promo-row]")].map((row) => ({ copy: rect(row.querySelector("[data-recap-copy]")!), base: rect(row.querySelector("[data-block-plate]")!), face: rect(row.querySelector("[data-block-face]")!), text: row.querySelector("[data-recap-copy]")!.textContent }));
          });
          if (firstRow) assert.deepEqual(read[0], firstRow, "a completed row never shifts when the next plate docks");
          else firstRow = read[0];
          if (progress === 0) arrivalY = read[2].copy.top;
          if (progress === 1) assert.ok(read[2].copy.top < arrivalY, "the entering row has an intentional short docking travel");
          const safe = stage(format);
          for (const [i, row] of read.entries()) {
            assert.equal(row.text, texts[i]);
            assert.ok(row.base.left >= safe.x && row.base.right <= safe.x + safe.width && row.base.top >= safe.y && row.base.bottom <= safe.y + safe.height, `${format.id}: the hard base stays within the safe stage`);
            assert.ok(row.copy.left >= row.face.left && row.copy.right <= row.face.right && row.copy.top >= row.face.top && row.copy.bottom <= row.face.bottom, `${format.id}: the moving copy stays within its matching raised face`);
            if (i) assert.ok(row.base.top > read[i - 1].base.bottom, "offset bases cannot touch the next row");
          }
        }
        const rect = promoPanelLayout(format, { width: format.width, height: format.height }, { videoRatio: 2 }).text;
        const element = createElement(PromoSideText, { format, rect, text: texts[1], ink: colors.ink, colors, theme: "block" });
        const html = renderFrameHtml(element, { frame: 30, fps: 30, format, durationInFrames: 300 });
        await page.evaluate((html: string) => { document.body.innerHTML = html; }, html);
        const split = await page.evaluate(() => {
          const r = (node: Element) => { const b = node.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
          return { panel: r(document.querySelector("[data-promo-side-text]")!), plate: r(document.querySelector("[data-block-plate]")!), copy: r(document.querySelector("[data-promo-copy]")!) };
        });
        for (const child of [split.plate, split.copy]) assert.ok(child.left >= split.panel.left && child.right <= split.panel.right && child.top >= split.panel.top && child.bottom <= split.panel.bottom, "neither the offset base nor the words may spill into the recorded-product panel");
      }
      await page.close();
    }
  } finally { await browser.close(); await server.close(); }
});

test("all themes preserve verbatim source and a stable reading grid in every format and polarity", async () => {
  const { createElement } = renderRequire("react");
  const { chromium } = engineRequire("playwright");
  const { PromoSource } = await import("../apps/render/src/lib/PromoSource.tsx");
  const { ThemeProvider } = await import("../apps/render/src/lib/theme-context.tsx");
  const { renderFrameHtml, startAssetServer } = await import("@panoma/video-engine");
  const server = await startAssetServer({ assets: tmpdir() });
  const browser = await chromium.launch({ headless: true });
  const texts = {
    terminal: "pnpm panoma-video promo ./catálogo-local --langs=es --no-camera",
    code: '/* Source stays verbatim,\n   including line breaks. */\nconst project = {\n  name: "Catálogo 🧭",\n  path: "./proyectos/ejemplos/una-ruta-que-debe-conservarse",\n  local: true,\n};\nexport default project;',
  };
  const hex = (rgb: string) => rgb.startsWith("#") ? rgb : `#${rgb.match(/\d+/g)!.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
  try {
    for (const format of Object.values(FORMATS)) {
      const page = await browser.newPage({ viewport: { width: format.width, height: format.height } });
      await page.goto(`${server.origin}/__shell__?w=${format.width}&h=${format.height}`);
      await page.evaluate(async () => {
        await document.fonts.load('600 48px "Geist Mono"');
        await document.fonts.load('450 48px "Geist Mono"');
        await document.fonts.load('650 28px "Geist"');
        await document.fonts.load('500 28px "Geist"');
        await document.fonts.ready;
      });
      for (const colors of palettes) for (const kind of ["terminal", "code"] as const) {
        const text = texts[kind];
        let positions: unknown;
        let flatHeader: string | undefined;
        for (const theme of ["flat", "vibrant", "block", "grid"] as const) for (const count of [0, 36, [...text].length]) {
          const direction = { ...DEFAULT_DIRECTION, accent: { ...DEFAULT_DIRECTION.accent, hex: "#101219" } };
          const element = createElement(ThemeProvider, { direction }, createElement(PromoSource, { format, kind, text, visibleCount: count, caret: count < [...text].length, colors, theme, entrance: count === 0 ? 1 : 0 }));
          const html = renderFrameHtml(element, { frame: count, fps: 30, format, durationInFrames: 450 });
          await page.evaluate((html: string) => { document.body.innerHTML = html; }, html);
          const read = await page.evaluate(() => {
            const rect = (node: Element) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
            const panel = document.querySelector<HTMLElement>("[data-source-panel]")!;
            const header = document.querySelector<HTMLElement>("[data-source-label]")!;
            const chars = [...document.querySelectorAll<HTMLElement>("[data-source-char]")];
            const active = document.querySelector<HTMLElement>('[data-source-line-active="true"]');
            const transparent = (node: Element) => getComputedStyle(node).backgroundColor === "rgba(0, 0, 0, 0)";
            const source = panel.dataset.sourceSurface!;
            const chip = document.querySelector<HTMLElement>("[data-source-label-chip]");
            return {
              theme: panel.dataset.editorialTheme,
              accentOrigin: panel.dataset.themeAccentOrigin,
              text: chars.map((c) => c.firstChild!.textContent).join(""),
              visible: chars.filter((c) => c.dataset.revealed === "true").map((c) => c.firstChild!.textContent).join(""),
              positions: chars.map(rect), panel: rect(panel),
              source,
              active: active ? getComputedStyle(active).backgroundColor : source,
              inks: [...new Set(chars.map((c) => getComputedStyle(c).color))],
              header: { ground: transparent(header) ? source : getComputedStyle(header).backgroundColor, ink: getComputedStyle(header).color, rect: rect(header) },
              chip: chip ? { ground: getComputedStyle(chip).backgroundColor, ink: getComputedStyle(chip).color } : null,
              plates: [...document.querySelectorAll("[data-block-plate]")].map(rect),
              rows: [...document.querySelectorAll("[data-source-line]")].map((line) => ({ rect: rect(line), glyphs: [...line.querySelectorAll("[data-source-char]")].filter((c) => /\S/.test(c.firstChild!.textContent!)).map(rect) })),
              tokens: [...document.querySelectorAll<HTMLElement>("[data-source-token]")].map((token) => ({ text: token.dataset.sourceToken, rows: [...new Set([...token.querySelectorAll("[data-source-char]")].map((c) => c.getBoundingClientRect().top))] })),
              caret: document.querySelectorAll("[data-source-caret]").length,
              pictures: document.querySelectorAll("img, canvas, video").length,
            };
          });
          const context = `${format.id}/${kind}/${theme}`;
          assert.equal(read.theme, theme);
          assert.equal(read.accentOrigin, theme !== "flat" ? "editorial" : "brand");
          assert.equal(read.text, text, `${context}: theme furniture cannot enter the quoted source`);
          assert.equal(read.visible, [...text].slice(0, count).join(""));
          assert.equal(read.pictures, 0, "authored source panels never inject invented screenshots");
          assert.equal(read.caret, count < [...text].length ? 1 : 0);
          if (positions) assert.deepEqual(read.positions, positions, `${context}: neither reveal nor changing the whole-film theme moves the reading grid`);
          else positions = read.positions;
          if (theme === "flat") flatHeader = read.header.ground;
          else if (theme === "grid") assert.ok(isNeutral(hex(read.header.ground)), "Grid's quiet source header stays monochrome even when the original ground has a color cast");
          else assert.notEqual(read.header.ground, flatHeader, "selected themes have a different source surface");
          assert.ok(contrastRatio(hex(read.header.ink), hex(read.header.ground)) >= 4.5, `${context}: chrome copy stays readable`);
          for (const ink of read.inks) for (const ground of [read.source, read.active]) assert.ok(contrastRatio(hex(ink), hex(ground)) >= 4.5, `${context}: source syntax is readable on resting and active rows`);
          const safe = stage(format);
          assert.equal(read.plates.length, theme === "block" ? 1 : 0);
          if (read.chip) assert.ok(contrastRatio(hex(read.chip.ink), hex(read.chip.ground)) >= 4.5, "the Block label chip preserves readable source attribution");
          for (const plate of read.plates) assert.ok(plate.left >= safe.x && plate.right <= safe.x + safe.width && plate.top >= safe.y && plate.bottom <= safe.y + safe.height, "the complete offset base has reserved safe-stage space");
          assert.ok(read.panel.left >= safe.x && read.panel.right <= safe.x + safe.width && read.panel.top >= safe.y && read.panel.bottom <= safe.y + safe.height, `${context}: panel fits the safe stage`);
          for (const [i, row] of read.rows.entries()) {
            if (i) assert.ok(row.rect.top >= read.rows[i - 1].rect.bottom - 0.1, `${context}: source lines cannot overlap`);
            assert.ok(row.rect.top >= read.header.rect.bottom, `${context}: header cannot cover the excerpt`);
            for (const glyph of row.glyphs) assert.ok(glyph.top >= row.rect.top - 0.1 && glyph.bottom <= row.rect.bottom + 0.1 && glyph.left >= row.rect.left - 0.1 && glyph.right <= row.rect.right + 0.1, `${context}: wrapped source belongs within its reserved original line`);
          }
          if (kind === "terminal") for (const token of read.tokens) assert.equal(token.rows.length, 1, `${context}: ${token.text} stays a whole shell token`);
        }
      }
      await page.close();
    }
  } finally { await browser.close(); await server.close(); }
});

test("Grid source, side copy and recap render in neutral paper and ink under a colorful brand", async () => {
  const { createElement } = renderRequire("react");
  const { chromium } = engineRequire("playwright");
  const { PromoSource } = await import("../apps/render/src/lib/PromoSource.tsx");
  const { PromoSideText, PromoRecap } = await import("../apps/render/src/lib/PromoEffects.tsx");
  const { ThemeProvider } = await import("../apps/render/src/lib/theme-context.tsx");
  const { renderFrameHtml, startAssetServer } = await import("@panoma/video-engine");
  const server = await startAssetServer({ assets: tmpdir() });
  const browser = await chromium.launch({ headless: true });
  const format = FORMATS.v;
  const excerpt = 'const mode = "local";\n// Exact documented source';
  const hex = (rgb: string) => `#${rgb.match(/\d+/g)!.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
  try {
    const page = await browser.newPage({ viewport: { width: format.width, height: format.height } });
    await page.goto(`${server.origin}/__shell__?w=${format.width}&h=${format.height}`);
    for (const colors of colorfulPalettes) {
      const rect = promoPanelLayout(format, { width: format.width, height: format.height }, { videoRatio: 2 }).text;
      const scenes = [
        createElement(PromoSource, { format, kind: "code", text: excerpt, visibleCount: [...excerpt].length - 1, caret: true, colors, theme: "grid" }),
        createElement(PromoSource, { format, kind: "terminal", text: "pnpm panoma-video themes", visibleCount: 12, caret: true, colors, theme: "grid" }),
        createElement(PromoSideText, { format, rect, text: "Source stays exact", ink: colors.ink, colors, theme: "grid" }),
        createElement(PromoRecap, { format, title: "Measured outcomes", rows: [{ id: "one", text: "Your actual product", visible: true, active: false, progress: 1, checked: 1 }, { id: "two", text: "Documented source", visible: true, active: true, progress: 1, checked: 0 }], colors, theme: "grid" }),
      ];
      for (const scene of scenes) {
        const direction = { ...DEFAULT_DIRECTION, accent: { ...DEFAULT_DIRECTION.accent, hex: "#ff00a8" } };
        const html = renderFrameHtml(createElement(ThemeProvider, { direction }, scene), { frame: 30, fps: 30, format, durationInFrames: 300 });
        await page.evaluate((html: string) => { document.body.innerHTML = html; }, html);
        const read = await page.evaluate(() => {
          const root = document.querySelector('[data-editorial-theme="grid"]')!;
          const colors = new Set<string>();
          for (const node of [root, ...root.querySelectorAll("*")]) {
            const style = getComputedStyle(node);
            for (const value of [style.color, style.backgroundColor, style.fill, style.stroke]) if (/^rgb/.test(value) && value !== "rgba(0, 0, 0, 0)") colors.add(value);
            for (const value of style.boxShadow.match(/rgba?\([^)]+\)/g) ?? []) colors.add(value);
          }
          const face = root.querySelector<HTMLElement>("[data-promo-side-face]");
          const copy = root.querySelector<HTMLElement>("[data-promo-copy]");
          return { colors: [...colors], face: face ? getComputedStyle(face).backgroundColor : null, ink: copy ? getComputedStyle(copy).color : null };
        });
        for (const color of read.colors) assert.ok(isNeutral(hex(color)), `Grid introduced a chromatic editorial color: ${color}`);
        if (read.face && read.ink) {
          assert.equal(hex(read.face), promoThemeTokens("grid", colors, "#ff00a8").face, "split copy sits on the same refined paper face as source inserts");
          assert.ok(contrastRatio(hex(read.ink), hex(read.face)) >= 4.5);
        }
      }
    }
  } finally { await browser.close(); await server.close(); }
});

test("Grid cards flex only the arriving surface, keep older cards stable and overlap no quoted copy", async () => {
  const { createElement } = renderRequire("react");
  const { chromium } = engineRequire("playwright");
  const { GridRecap } = await import("../apps/render/src/lib/GridRecap.tsx");
  const { renderFrameHtml, startAssetServer } = await import("@panoma/video-engine");
  const server = await startAssetServer({ assets: tmpdir() });
  const browser = await chromium.launch({ headless: true });
  const texts = ["Enfoque sobre una zona real", "Texto estable. Producto en movimiento.", "Comandos y código documentados"];
  try {
    for (const format of Object.values(FORMATS)) {
      const page = await browser.newPage({ viewport: { width: format.width, height: format.height } });
      await page.goto(`${server.origin}/__shell__?w=${format.width}&h=${format.height}`);
      await page.evaluate(async () => { await document.fonts.load('650 70px "Geist"'); await document.fonts.ready; });
      for (const colors of palettes) {
        let older: unknown;
        let bentPath = "";
        for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
          const design = promoThemeTokens("grid", colors, "#151515");
          const element = createElement(GridRecap, { format, title: "Recursos de Panoma", rows: texts.map((text, index) => ({ id: `row-${index}`, text, visible: true, active: index === 2, progress: index === 2 ? progress : 1, checked: index === 2 ? 0 : 1 })), colors, design });
          const html = renderFrameHtml(element, { frame: 30, fps: 30, format, durationInFrames: 300 });
          await page.evaluate((html: string) => { document.body.innerHTML = html; }, html);
          const read = await page.evaluate(() => {
            const rect = (node: Element) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
            return [...document.querySelectorAll<HTMLElement>("[data-grid-card]")].map((row) => ({ html: row.outerHTML, card: rect(row), copy: rect(row.querySelector("[data-recap-copy]")!), text: row.querySelector("[data-recap-copy]")!.textContent,
              bend: Number(row.dataset.gridBend), surface: row.querySelector("[data-grid-surface] path")!.getAttribute("d"), checks: row.querySelectorAll("[data-recap-check]").length, paper: row.querySelectorAll("[data-grid-margin], [data-grid-ply]").length, copyTransform: getComputedStyle(row.querySelector("[data-recap-copy]")!).transform }));
          });
          if (older) assert.deepEqual(read.slice(0, 2), older, "already read cards stay fixed while the new surface flexes");
          else older = read.slice(0, 2);
          if (progress === 0.5) { assert.notEqual(read[2].bend, 0); bentPath = read[2].surface!; }
          if (progress === 1) { assert.equal(read[2].bend, 0); assert.notEqual(read[2].surface, bentPath, "the final card edge returns to a flat shape"); }
          const safe = stage(format);
          for (const [index, row] of read.entries()) {
            assert.equal(row.text, texts[index]);
            assert.equal(row.checks, 0, "paper layers replace status widgets in Grid's editorial recap");
            assert.ok(row.paper > 0, "the card carries deliberate paper detailing");
            assert.equal(row.copyTransform, "none", "the surface bends around text instead of distorting its glyphs");
            assert.ok(row.card.left >= safe.x && row.card.right <= safe.x + safe.width && row.card.top >= safe.y && row.card.bottom <= safe.y + safe.height, `${format.id}: the full docking envelope stays inside Stage`);
            assert.ok(row.copy.left >= row.card.left && row.copy.right <= row.card.right && row.copy.top >= row.card.top && row.copy.bottom <= row.card.bottom, `${format.id}: quoted copy belongs inside its card`);
            if (index) assert.ok(row.card.top >= read[index - 1].copy.bottom, `${format.id}: stacking never covers an earlier quoted phrase`);
          }
        }
      }
      await page.close();
    }
  } finally { await browser.close(); await server.close(); }
});
