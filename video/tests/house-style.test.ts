/*
  panoma video's house style, kept out of other people's films.

  Until 2026-09-03 the palette of `apps/render/src/lib/theme.ts` reached every recipe and
  every shared component through eleven imports, so a product with a HIGH-confidence lime
  on near-black was filmed on the house #0a0a0a with the house #d2bd7f, and five contact sheets
  from three products read as one film. This test renders real frames — through the same
  `renderFrameHtml` the rasterizer paints — and fails when the house colours appear in a
  frame that belongs to somebody else.

  It also asserts the other half, which is the half that usually breaks later: with no
  direction, the repository's own briefs render Panoma's central light theme.
*/
import assert from "node:assert/strict";
import ts from "typescript";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import "@panoma/video-engine/register";
import { defaultColors, type BrandProfile } from "@panoma/video-brand";
import { DEFAULT_DIRECTION, deriveDirection } from "@panoma/video-brand/direction";
import { contrastRatio } from "@panoma/video-brand/contrast";
import { FORMATS, type Brief } from "@panoma/video-core";
import type { SessionLog } from "@panoma/video-capture";
import { LIGHT_PALETTE, PANOMA_LIGHT } from "@panoma/video-core/theme";

/** The house palette, written out: none of these may appear in another product's frame. */
const HOUSE = [PANOMA_LIGHT.paper, PANOMA_LIGHT.accent, PANOMA_LIGHT.muted, "#d2bd7f", "rgba(210,189,127", "rgba(0, 0, 0, 0.66)", "rgba(0, 0, 0, 0.78)"];

const brand: BrandProfile = {
  source: { extractedAt: "2026-09-03T00:00:00.000Z" },
  name: "Universend",
  colors: {
    ...defaultColors(),
    primary: { hex: "#dbff64", confidence: "high", origin: "census" },
    accent: { hex: "#dbff64", confidence: "medium", origin: "primary" },
    background: { hex: "#02030a", confidence: "high", origin: "body" },
    surface: { hex: "#161615", confidence: "medium", origin: "derived" },
    text: { hex: "#f4f2ea", confidence: "high", origin: "css-token:--ink" },
    muted: { hex: "#7b8296", confidence: "high", origin: "css-token:--muted" },
    onPrimary: { hex: "#000000", confidence: "high", origin: "wcag" },
  },
  tokens: {},
  scheme: { supports: ["dark"], default: "dark" },
  type: { heading: { category: "sans", family: "Geist" }, body: { category: "sans", family: "Geist" }, mono: { category: "mono", family: "Geist Mono" } },
  tone: { register: "neutral", metrics: {} },
};

const light: BrandProfile = {
  ...brand,
  name: "Panoma",
  scheme: { supports: ["light"], default: "light" },
  colors: {
    ...defaultColors(),
    primary: { hex: "#0a0a0a", confidence: "high", origin: "cta" },
    background: { hex: "#fafafa", confidence: "high", origin: "body" },
    surface: { hex: "#f3f3f3", confidence: "high", origin: "census" },
    text: { hex: "#000000", confidence: "high", origin: "body" },
    muted: { hex: "#5c5c5c", confidence: "high", origin: "census" },
    onPrimary: { hex: "#ffffff", confidence: "high", origin: "wcag" },
  },
};

/** One brief per recipe that needs no recorded take. */
const briefs: Brief[] = [
  {
    id: "quote", recipe: "KineticQuote", langs: ["en"], bpm: 120, fps: 30,
    hooks: [{ id: "hook", mode: "type", text: { en: "Every project on one page" } }],
    lines: [{ id: "l1", mode: "type", text: { en: "Find the one from March" } }, { id: "l2", mode: "type", text: { en: "In one second" } }],
  },
  {
    id: "terminal", recipe: "TerminalRun", langs: ["en"], bpm: 120, fps: 30,
    hooks: [{ id: "hook", mode: "type", text: { en: "One command" } }],
    lines: [{ id: "l1", mode: "type", text: { en: "npx universend" } }, { id: "l2", mode: "type", text: { en: "Indexing 47 projects" } }, { id: "l3", mode: "type", text: { en: "Ready" } }],
  },
  {
    id: "loop", recipe: "Loop", langs: ["en"], bpm: 120, fps: 30,
    hooks: [{ id: "hook", mode: "type", text: { en: "Forty-seven projects" } }],
    lines: [{ id: "l1", mode: "type", text: { en: "All of them, indexed" } }],
  },
];

async function framesOf(profile: BrandProfile | null, flows: number): Promise<{ id: string; html: string }[]> {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-house-"));
  await writeFile(join(dir, "empty"), "");
  const { buildCompositions } = await import("@panoma/video-render/compositions");
  const { renderFrameHtml } = await import("@panoma/video-engine");
  const direction = profile ? deriveDirection(profile, { flows }) : undefined;
  const matrix = buildCompositions(briefs, { assets: dir, sessions: dir, generated: dir, sfx: dir, ...(direction ? { direction } : {}) });
  const out: { id: string; html: string }[] = [];
  for (const comp of matrix.compositions.filter((c) => c.id.endsWith("--en--h"))) {
    for (const frame of [1, Math.floor(comp.durationInFrames / 2), comp.durationInFrames - 2]) {
      out.push({ id: `${comp.id}@${frame}`, html: renderFrameHtml(comp.element(), { frame, fps: comp.fps, durationInFrames: comp.durationInFrames, format: comp.format }) });
    }
  }
  return out;
}

test("a product's film carries none of the house colours", async () => {
  for (const { id, html } of await framesOf(brand, 2)) {
    for (const house of HOUSE) {
      assert.ok(!html.includes(house), `${id} painted the house ${house}`);
    }
  }
});

test("the authored terminal uses the product's surface, ink and accent", async () => {
  const terminal = (await framesOf(brand, 2)).filter((f) => f.id.startsWith("terminal--")).map((f) => f.html).join("");
  const d = deriveDirection(brand, { flows: 2 });
  for (const role of [d.stage, d.plate, d.ink, d.muted, d.accent]) {
    assert.ok(terminal.includes(role.hex), `the terminal never uses the product's ${role.hex}`);
  }
  assert.ok(!terminal.includes("#0a0a0a") && !terminal.includes("#161616"), "the terminal retains the former fixed dark surfaces");
});

test("the product's own ground, ink and accent are what the frame is painted with", async () => {
  const frames = await framesOf(brand, 2);
  const all = frames.map((f) => f.html).join("");
  const d = deriveDirection(brand, { flows: 2 });
  assert.ok(all.includes(d.stage.hex), `the stage ${d.stage.hex} never appears`);
  assert.ok(all.includes("#dbff64") || all.includes("rgba(219, 255, 100"), "the product's accent never appears");
  assert.ok(all.includes("#f4f2ea") || all.includes("rgba(244, 242, 234"), "the product's ink never appears");
});

test("a light product is filmed light, and the scrim behind its type is its own ground", async () => {
  const d = deriveDirection(light, { flows: 0 });
  assert.equal(d.scheme, "light");
  const all = (await framesOf(light, 0)).map((f) => f.html).join("");
  assert.ok(all.includes(d.stage.hex), "the light stage never appears");
  /* The plate under type over footage was rgba(0,0,0,0.66) for everyone: black on white. */
  assert.ok(!all.includes("rgba(0, 0, 0, 0.66)"), "a light film still plates its words in black");
});

test("with no product measured, the repository's own briefs keep the house theme", async () => {
  const all = (await framesOf(null, 0)).map((f) => f.html).join("");
  assert.ok(all.includes(LIGHT_PALETTE.paper), "the light house paper is gone from the repository's own film");
  assert.ok(all.includes(LIGHT_PALETTE.accent), "the Panoma accent is gone from the repository's own film");
  const terminal = (await framesOf(null, 0)).filter((f) => f.id.startsWith("terminal--")).map((f) => f.html).join("");
  assert.ok(terminal.includes(`background:${LIGHT_PALETTE.card}`), "the terminal chrome does not use the light surface");
  assert.ok(terminal.includes(`color:${LIGHT_PALETTE.ink}`), "the terminal does not use light-theme ink");
  assert.ok(!all.includes("#d2bd7f") && !all.includes("#161616"), "a former dark-house color remains");
});

test("two products with different grounds do not render the same frame", async () => {
  const dark = (await framesOf(brand, 2)).map((f) => f.html).join("");
  const pale = (await framesOf(light, 0)).map((f) => f.html).join("");
  assert.notEqual(dark, pale);
});

test("status glyphs stay readable on both house light and measured dark surfaces", async () => {
  const { paletteOf } = await import("../apps/render/src/lib/theme-context.tsx");
  assert.equal(paletteOf(DEFAULT_DIRECTION).good, PANOMA_LIGHT.success);
  for (const direction of [DEFAULT_DIRECTION, deriveDirection(brand, { flows: 2 })]) {
    assert.ok(contrastRatio(paletteOf(direction).good, direction.stage.hex) >= 4.5);
  }
});

test("inverse tutorial and spotlight cards keep readable text, counters and rules", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-card-colors-"));
  const engineRequire = createRequire(new URL("../packages/engine/package.json", import.meta.url));
  const { chromium } = engineRequire("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const session: SessionLog = {
      name: "cards", take: "desktop", recordedAt: "2026-09-07T00:00:00Z", isMobile: false,
      url: "http://fixture/", viewport: { width: 1920, height: 1080 }, video: "cards.desktop.webm",
      durationMs: 12_000, readyMs: 1000, fps: 25,
      marks: [{ name: "open", t: 2000 }, { name: "save", t: 6000 }],
      events: [{ kind: "click", t: 2400, x: 600, y: 300 }, { kind: "click", t: 6400, x: 600, y: 300 }],
    };
    const base: Brief = {
      id: "card-tutorial", recipe: "Tutorial", session: "cards", langs: ["en"], bpm: 120, fps: 30,
      params: { progress: true }, hooks: [{ id: "hook", mode: "type", text: { en: "Your workspace" } }],
      lines: [
        { id: "open", mark: "open", mode: "type", text: { en: "Open your workspace" }, label: { en: "Open" } },
        { id: "save", mark: "save", mode: "type", text: { en: "Save your work" }, label: { en: "Save" } },
        { id: "end", mode: "type", text: { en: "Ready" } },
      ],
    };
    const spotlight: Brief = { ...base, id: "card-spotlight", recipe: "FeatureSpotlight" };
    await writeFile(join(dir, "cards.desktop.session.json"), JSON.stringify(session));
    await writeFile(join(dir, session.video), "");
    const { buildCompositions } = await import("@panoma/video-render/compositions");
    const { renderFrameHtml } = await import("@panoma/video-engine");
    const { tutorialPlan, spotlightPlan } = await import("@panoma/video-render/timing");
    const matrix = buildCompositions([base, spotlight], { assets: dir, sessions: dir, generated: dir, sfx: dir }, { formats: ["h"] });
    const tutorial = tutorialPlan(session, base, base.hooks[0], "en");
    const spotlightCards = spotlightPlan(session, spotlight, FORMATS.h).sections.filter((section) => section.kind === "card" || section.kind === "end");
    const samples = [
      { id: base.id, frame: tutorial.steps[1].from + 20 },
      ...spotlightCards.map((section) => ({ id: spotlight.id, frame: section.from + 35 })),
    ];
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const hex = (value: string): string => `#${value.match(/\d+/g)!.slice(0, 3).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
    for (const sample of samples) {
      const comp = matrix.compositions.find((entry) => entry.id.startsWith(`${sample.id}--`))!;
      assert.ok(comp);
      const html = renderFrameHtml(comp.element(), { frame: sample.frame, fps: comp.fps, durationInFrames: comp.durationInFrames, format: comp.format });
      await page.setContent(`<style>html,body{margin:0;height:100%}</style>${html}`);
      const rendered = await page.evaluate(() => {
        const stage = document.body.querySelector("div")!;
        const text: { text: string; color: string }[] = [];
        const rules: string[] = [];
        for (const element of document.body.querySelectorAll<HTMLElement>("*")) {
          const style = getComputedStyle(element);
          const bounds = element.getBoundingClientRect();
          let hidden = false;
          for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
            const parentStyle = getComputedStyle(ancestor);
            if (parentStyle.opacity === "0" || parentStyle.visibility === "hidden" || parentStyle.display === "none") hidden = true;
          }
          if (hidden || bounds.width === 0 || bounds.height === 0) continue;
          for (const child of element.childNodes) if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) text.push({ text: child.textContent, color: style.color });
          if (element.style.background && bounds.height >= 3 && bounds.height < 10 && bounds.width > 10 && /^rgb\(/.test(style.backgroundColor)) rules.push(style.backgroundColor);
        }
        return { ground: getComputedStyle(stage).backgroundColor, text, rules };
      });
      assert.equal(hex(rendered.ground), LIGHT_PALETTE.inverted.paper);
      assert.ok(rendered.text.length > 0 && rendered.rules.length > 0, "the inverse frame includes copy and its rule");
      for (const item of rendered.text) assert.ok(contrastRatio(hex(item.color), hex(rendered.ground)) >= 4.5, `${sample.id}: ${item.text} has insufficient contrast`);
      for (const rule of rendered.rules) assert.ok(contrastRatio(hex(rule), hex(rendered.ground)) >= 3, `${sample.id}: the card rule vanishes on its ground`);
    }
  } finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
});

/*
  Every authored colour, including physical materials and explicit editorial accents,
  lives in the central theme vocabulary. Inspect string/template AST nodes so comments
  can document history without hiding real literals, including shorthand hex and RGB.
*/
test("render source takes every colour from a theme role or a named material", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const root = new URL("../apps/render/src/", import.meta.url);
  const found: string[] = [];
  const scan = async (dir: URL, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const key = `${prefix}${entry.name}`;
      const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      if (entry.isDirectory()) { await scan(url, `${key}/`); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const source = ts.createSourceFile(key, await readFile(url, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
          const literals = node.text.match(/#[0-9a-fA-F]{3,8}\b|(?:rgb|hsl)a?\(\s*[+-]?\d|^(?:black|white)$/g) ?? [];
          for (const literal of literals) found.push(`${key}: ${literal}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  };
  await scan(root, "");
  assert.deepEqual(found, [], `colour literals belong in @panoma/video-core/theme:\n  ${found.join("\n  ")}`);
});

/*
  Nothing in a film this engine makes casts a shadow.

  The rule arrived on 2026-09-03 from someone watching the films rather than reading
  the code: every piece of type carried a blurred halo of the accent behind it, every
  plate sat on a dark blur, the pointer dropped a shadow, the stage closed in with a
  vignette and the backdrop with another. None of it was decided; each one was added
  where a single frame looked thin, and together they are why the films read as printed
  on rather than shot.

  So: no `textShadow`, no `drop-shadow()`, and a `boxShadow` only when every layer of it
  is `inset` — an inset shadow is a border that does not resize the box it is drawn on,
  which is why the product window and the control plate use one instead of `border`.

  This reads the source rather than a frame because a shadow that only appears on the
  press of the second control is a shadow no rendered frame in a test will ever show.
*/
/*
  A literal NUL byte anywhere in the source makes `grep` call the file BINARY and skip it
  without a word. Three of them were sitting inside template literals used as hash
  separators — `${name}\x00${id}` written as a real zero byte rather than the escape —
  and the cost is not the byte, it is every audit that has ever run over this tree and
  silently missed a file. It has happened three times in this repository and been fixed
  three times; this is the test instead of the fourth.

  `\0` in a template literal is the same character to the runtime, so escaping one
  changes no hash and no rendered frame.
*/
test("no source file contains a literal NUL, because grep goes blind on one", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const root = new URL("../", import.meta.url);
  const found: string[] = [];
  const walk = async (dir: URL, at: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const here = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      if (entry.isDirectory()) {
        await walk(here, `${at}${entry.name}/`);
        continue;
      }
      if (!/\.(ts|tsx|mjs|json|md)$/.test(entry.name)) continue;
      const bytes = await readFile(here);
      const byte = bytes.indexOf(0);
      if (byte >= 0) found.push(`${at}${entry.name} at byte ${byte}`);
    }
  };
  for (const dir of ["apps/", "packages/", "briefs/", "tests/", "docs/"]) await walk(new URL(dir, root), dir);
  assert.deepEqual(found, [], `grep reports these as binary and skips them without saying so:\n  ${found.join("\n  ")}`);
});

test("no recipe draws a shadow", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const root = new URL("../apps/render/src/", import.meta.url);
  const found: string[] = [];
  for (const dir of ["recipes", "lib"]) {
    for (const file of await readdir(new URL(dir, root))) {
      if (!file.endsWith(".tsx") && !file.endsWith(".ts")) continue;
      const source = await readFile(new URL(`${dir}/${file}`, root), "utf8");
      source.split("\n").forEach((line, i) => {
        const where = `${dir}/${file}:${i + 1}`;
        /* Prose about a shadow that is gone is not a shadow. */
        if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;
        if (/textShadow/.test(line)) found.push(`${where}: textShadow`);
        if (/drop-shadow\(/.test(line)) found.push(`${where}: drop-shadow()`);
        if (/boxShadow/.test(line) && !/inset/.test(line)) found.push(`${where}: boxShadow with a layer that is not inset`);
      });
    }
  }
  assert.deepEqual(found, [], `a shadow in a film that draws none — light the thing instead of darkening what is around it:\n  ${found.join("\n  ")}`);
});
