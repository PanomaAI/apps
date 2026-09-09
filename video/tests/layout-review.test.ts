import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import "@panoma/video-engine/register";
import { FORMATS, type Brief, type RenderPlan } from "@panoma/video-core";
import type { CompositionDef } from "@panoma/video-engine";
import { promoLayoutSamples, reviewPromoLayout } from "../packages/director/src/layout-review.ts";

const require = createRequire(new URL("../packages/engine/package.json", import.meta.url));
const { createElement } = require("react");
function plan(): RenderPlan {
  return { recipe: "ProductPromo", fps: 30, durationInFrames: 150, beats: { beatFrames: 15, barFrames: 60, start: 0 }, cuts: [], holds: [], fades: [],
    cards: [{ id: "title", from: 0, to: 60, readFrom: 12 }, { id: "recap", from: 60, to: 150 }],
    texts: [{ id: "one", kind: "recap", from: 60, to: 150, readFrom: 70 }, { id: "two", kind: "recap", from: 68, to: 150, readFrom: 78 }] };
}

test("layout sampling uses declared settled groups and never measures an incoming recap card", () => {
  const samples = promoLayoutSamples(plan());
  assert.deepEqual(samples.map((sample) => sample.frame), [12, 35, 59, 78, 113, 149]);
  assert.deepEqual(samples.find((sample) => sample.frame === 78)?.scenes, ["recap", "one", "two"]);
  for (const readFrom of [NaN, -1, 60, 12.5]) {
    const invalid = plan(); invalid.cards[0].readFrom = readFrom;
    assert.throws(() => promoLayoutSamples(invalid), /whole-frame spans/);
  }
});

test("actual Chromium findings name their scenes, frames and fixer, while ignored product chrome stays exempt", async () => {
  const timeline = plan();
  timeline.cards = [{ id: "broken-title", from: 0, to: 150, readFrom: 20 }]; timeline.texts = [];
  const comp: CompositionDef = { id: "broken--v", format: FORMATS.v, fps: 30, durationInFrames: 150, audio: [], element: () => createElement("div", {},
    createElement("div", { "data-name": "clipped-title", style: { position: "absolute", top: 300, left: 100, width: 90, height: 40, overflow: "hidden", font: "24px Geist", whiteSpace: "nowrap" } }, "A title too wide for its container"),
    createElement("div", { "data-name": "unsafe-caption", style: { position: "absolute", top: 1850, left: 100, font: "24px Geist" } }, "Covered by platform controls"),
    createElement("div", { "data-name": "collapsed-copy", style: { position: "absolute", top: 400, left: 100, fontSize: 0 } }, "Missing line box"),
    createElement("div", { "data-lint": "ignore", style: { position: "absolute", top: 0, left: -200, overflow: "hidden", width: 30 } }, "Recorded chrome outside Stage")) };
  const checks = await reviewPromoLayout({ comp, plan: timeline, assetsDir: tmpdir() });
  for (const kind of ["overflow", "outside", "collapsed"]) {
    const check = checks.find((entry) => entry.id === `layout.${kind}`)!;
    assert.equal(check.status, "fail", JSON.stringify(checks));
    assert.equal(check.fix?.by, "engine");
    assert.deepEqual(check.at?.map((at) => at.frame), [20, 84, 149]);
    assert.match(JSON.stringify(check.details), /broken-title/);
    assert.doesNotMatch(JSON.stringify(check.details), /Recorded chrome/);
  }
});

test("layout audit cannot silently pass missing reading spans or a different composition clock", async () => {
  const comp: CompositionDef = { id: "missing", format: FORMATS.v, fps: 30, durationInFrames: 150, audio: [], element: () => null };
  const empty = plan(); empty.cards = []; empty.texts = [];
  assert.equal((await reviewPromoLayout({ comp, plan: empty, assetsDir: tmpdir() }))[0].status, "fail");
  assert.equal((await reviewPromoLayout({ comp, assetsDir: tmpdir() }))[0].status, "fail");
  assert.match((await reviewPromoLayout({ comp: { ...comp, fps: 25 }, plan: plan(), assetsDir: tmpdir() }))[0].summary, /different clocks/);
  assert.deepEqual(await reviewPromoLayout({ comp, plan: { ...plan(), recipe: "Tutorial" }, assetsDir: tmpdir() }), []);
});

test("settled ProductPromo titles, source panels, recap and split copy pass in every theme and social format", { timeout: 120000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-layout-"));
  try {
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=white:s=960x540:r=25:d=5", "-c:v", "libvpx", "-deadline", "realtime", "-an", "-y", join(dir, "source.webm")]);
    const { ProductPromo } = await import("../apps/render/src/recipes/ProductPromo.tsx");
    const { promoTitleSettledFrame } = await import("../apps/render/src/recipes/timing.ts");
    const { promoRowArrivalFrames } = await import("../apps/render/src/recipes/presentation.ts");
    for (const format of [FORMATS.h, FORMATS.v]) for (const theme of ["flat", "vibrant", "block", "grid"] as const) {
      const hook = { id: "hook", mode: "type" as const, text: { es: "Tu proyecto conserva su contexto" } };
      const brief: Brief = { id: "layout", recipe: "ProductPromo", bpm: 120, fps: 30, langs: ["es"], hooks: [hook], lines: [], promo: { theme, opening: "promise", pace: "crisp", evidence: {} } };
      const rows = [{ id: "one", text: "Encuentra tus proyectos locales", from: 210 }, { id: "two", text: "Conserva el contexto del proyecto", from: 218 }];
      const sections = [
        { kind: "hook", id: "hook", text: hook.text.es, from: 0, to: 60 },
        { kind: "benefit", id: "benefit", text: "Tus notas acompañan al trabajo", from: 60, to: 120 },
        { kind: "code", id: "source", text: "const project = catalog.find('acme');\nproject.context();", from: 120, to: 210, typingFrom: 125, typingTo: 150 },
        { kind: "recap", id: "recap", text: "Tu trabajo, a mano", rows, from: 210, to: 300 },
        { kind: "proof", id: "split", mark: "split", text: "El contexto acompaña al proyecto", from: 300, to: 390, sourceFrom: 0, sourceTo: 3.6, resultSource: 0.8, playRate: 1.2, holdFrom: 390, resultFrom: 320, presses: [], treatment: "split" },
        { kind: "end", id: "end", text: "acme.example", from: 390, to: 450 },
      ];
      const timeline: RenderPlan = { ...plan(), durationInFrames: 450,
        cards: sections.filter((section) => section.kind !== "proof").map((section) => ({ id: section.id, from: section.from, to: section.to,
          ...(["hook", "benefit", "end"].includes(section.kind) ? { readFrom: promoTitleSettledFrame(theme, section.kind as "hook" | "benefit" | "end", section.from, section.to, 30, 15) } : {}) })),
        texts: [{ id: "source", kind: "code", from: 120, to: 210, readFrom: 150 },
          ...rows.map((row) => ({ id: row.id, kind: "recap" as const, from: row.from, to: 300, readFrom: row.from + promoRowArrivalFrames(30, theme) })),
          { id: "split", kind: "split", from: 300, to: 390, readFrom: 300 }] };
      const comp: CompositionDef = { id: `layout-${theme}--${format.id}`, format, fps: 30, durationInFrames: 450, audio: [], element: () => createElement(ProductPromo, { brief, hook, lang: "es", format,
        session: { name: "fixture", take: "desktop", isMobile: false, url: "", recordedAt: "2026-09-05", video: "source.webm", viewport: { width: 960, height: 540 }, durationMs: 5000, fps: 25, marks: [], events: [] },
        plan: { sections, durationInFrames: 450 }, shots: [{ from: 0, to: 450, start: { fx: 0.5, fy: 0.5, scale: 1.3 }, end: { fx: 0.5, fy: 0.5, scale: 1.3 }, ease: "out", enter: "cut", tilt: { rx: 0, ry: 0 }, reason: "layout fixture" }] }) };
      const checks = await reviewPromoLayout({ comp, plan: timeline, assetsDir: dir, sessionsDir: dir });
      const frames = promoLayoutSamples(timeline).map((sample) => sample.frame);
      assert.equal(frames[0], 0, "the first poster is measured exactly at frame zero");
      assert.equal(frames.at(-1), 449, "the last closing frame is also measured");
      assert.ok(frames.includes(150), "the exact frame when all source characters arrive is measured");
      assert.ok(checks.every((check) => check.status === "pass"), `${comp.id}: ${JSON.stringify(checks.filter((check) => check.status !== "pass"))}`);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
