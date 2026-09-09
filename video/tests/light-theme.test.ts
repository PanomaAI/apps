import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PANOMA_LIGHT } from "@panoma/video-core/theme";
import { contrastRatio, mergeBrand } from "@panoma/video-brand";
import { DEFAULT_DIRECTION, deriveDirection } from "@panoma/video-brand/direction";
import { contactSheet, openWorkspace, paletteSvg, writeStudy } from "@panoma/video-director";
import { shellHtml } from "../packages/engine/src/document.ts";
import type { Board } from "@panoma/video-gen";

const require = createRequire(new URL("../packages/engine/package.json", import.meta.url));

test("the shell and report styles cannot introduce their own colour literals", async () => {
  for (const file of ["packages/engine/src/document.ts", "packages/director/src/sheet.ts", "packages/director/src/study.ts"]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const styles = [...source.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("\n");
    assert.ok(styles.length > 0, `${file}: no style block was checked`);
    assert.doesNotMatch(styles, /#[\da-f]{3,8}\b|(?:rgb|hsl)a?\(\s*[\d.]/i, `${file}: use the shared theme variables`);
  }
});

test("Panoma's text and semantic status inks remain readable on its light surfaces", () => {
  for (const surface of [PANOMA_LIGHT.paper, PANOMA_LIGHT.surface, PANOMA_LIGHT.wash, PANOMA_LIGHT.selected]) {
    for (const ink of [PANOMA_LIGHT.ink, PANOMA_LIGHT.muted, PANOMA_LIGHT.accent, PANOMA_LIGHT.success, PANOMA_LIGHT.warning, PANOMA_LIGHT.danger]) {
      assert.ok(contrastRatio(ink, surface) >= 4.5, `${ink} must be readable on ${surface}`);
    }
  }
  for (const [ink, surface] of [
    [PANOMA_LIGHT.surface, PANOMA_LIGHT.accent],
    [PANOMA_LIGHT.success, PANOMA_LIGHT.successSoft],
    [PANOMA_LIGHT.warning, PANOMA_LIGHT.warningSoft],
    [PANOMA_LIGHT.danger, PANOMA_LIGHT.dangerSoft],
  ]) assert.ok(contrastRatio(ink!, surface!) >= 4.5);
  for (const text of paletteSvg(DEFAULT_DIRECTION, "Panoma Video").matchAll(/<text[^>]*fill="([^"]+)"/g)) {
    assert.ok(contrastRatio(text[1], DEFAULT_DIRECTION.stage.hex) >= 4.5, "palette provenance and ratios must use readable ink");
  }
});

test("the shell and reports stay light under a dark OS preference and a dark filmed brand", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-light-theme-"));
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const project = join(dir, "product");
    await mkdir(project);
    const ws = await openWorkspace(project, { home: join(dir, "video") });
    const brand = mergeBrand({}, {});
    brand.name = "A dark product";
    brand.colors.background = { hex: "#121426", confidence: "high", origin: "body" };
    brand.colors.text = { hex: "#f1f5ff", confidence: "high", origin: "body" };
    brand.colors.primary = { hex: "#aaccff", confidence: "high", origin: "cta" };
    const direction = deriveDirection(brand);
    assert.equal(direction.scheme, "dark");
    await writeStudy({ ws, profile: { name: brand.name, kind: "web-app" }, brand, direction, takes: [] });
    const board: Board = {
      id: "light-theme", project: brand.name, premise: "Review the recorded material", mode: "shooting", format: "h", fps: 30,
      bible: { energy: "calm", photography: "Recorded product", palette: [direction.stage.hex, direction.accent.hex], mood: "Clear", never: [] },
      shots: [{ n: 1, origin: "card", role: "beat", duration: 60, framing: "wide", angle: "eye", move: "static", subject: "Title", out: "cut", note: "Read the title", text: { en: "The product's own story" }, panels: [{ id: "1A", at: "first", screen: { x: 0.5, y: 0.5, facing: "camera" } }] }],
    };
    const sheet = join(dir, "sheet.html");
    await contactSheet(board, { html: sheet });
    const page = await browser.newPage({ colorScheme: "dark" });
    for (const html of [shellHtml(1280, 720), await readFile(sheet, "utf8"), await readFile(join(ws.dir, "study/book.html"), "utf8")]) {
      await page.setContent(html);
      const styles = await page.evaluate(() => ({
        background: getComputedStyle(document.body).backgroundColor,
        ink: getComputedStyle(document.body).color,
        scheme: getComputedStyle(document.documentElement).colorScheme,
        paper: getComputedStyle(document.documentElement).getPropertyValue("--color-paper").trim(),
        muted: getComputedStyle(document.documentElement).getPropertyValue("--color-muted").trim(),
      }));
      assert.deepEqual(styles, { background: "rgb(252, 252, 253)", ink: "rgb(14, 15, 17)", scheme: "light", paper: PANOMA_LIGHT.paper, muted: PANOMA_LIGHT.muted });
      const declared = new Set([...html.matchAll(/(--color-[\w-]+)\s*:/g)].map((match) => match[1]));
      for (const match of html.matchAll(/var\((--color-[\w-]+)\)/g)) assert.ok(declared.has(match[1]), `missing theme variable ${match[1]}`);
    }
    const palette = await readFile(join(ws.dir, "study/palette.svg"), "utf8");
    assert.ok(palette.includes(direction.stage.hex) && palette.includes(direction.accent.hex), "the report's light chrome must not recolor the filmed brand's evidence");
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
});
