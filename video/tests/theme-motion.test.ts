import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import "@panoma/video-engine/register";
import { type Brief, type FactSheet, type RenderPlan } from "@panoma/video-core";
import { promoPlan, promoTitleEnterFrames, promoTitleMotion, promoTitleSettledFrame, type PromoTitleSection, type TakeWithAssets } from "@panoma/video-render/timing";
import { promoChecks } from "../packages/director/src/promo-checks.ts";

test("each title system arrives once and then leaves a stationary reading interval", () => {
  for (const fps of [24, 30, 60]) for (const theme of ["flat", "vibrant", "block"] as const) for (const role of ["hook", "benefit", "end"] as const) {
    const from = fps * 2;
    const to = from + fps * 4;
    const settled = promoTitleSettledFrame(theme, role, from, to, fps);
    assert.ok(Number.isInteger(settled) && settled > from && settled < from + fps * 0.4, `${theme}/${role}: title movement finishes inside four tenths of a second`);
    assert.equal(settled - from, promoTitleEnterFrames(theme, role, fps));
    const rest = promoTitleMotion(theme, role, from, to, settled, fps);
    assert.equal(rest.progress, 1);
    assert.equal(Math.abs(rest.translateY), 0);
    assert.equal(rest.scale, 1);
    assert.equal(rest.settleFrame, settled);
    for (let frame = from; frame < to; frame++) {
      const state = promoTitleMotion(theme, role, from, to, frame, fps);
      for (const value of [state.progress, state.translateY, state.scale, state.accentProgress, state.press]) assert.ok(Number.isFinite(value), "every animated value is finite");
      assert.ok(state.progress >= 0 && state.progress <= 1 && state.accentProgress >= 0 && state.accentProgress <= 1 && state.press >= 0 && state.press <= 1);
      assert.ok(Math.abs(state.translateY) < 0.05 && state.scale >= 0.9 && state.scale <= 1.1, "title entrance remains bounded inside its reserved composition");
      if (frame >= settled) assert.deepEqual(state, rest, "no loop, breathing or renewed press can interrupt reading");
    }
    const poster = promoTitleMotion(theme, role, 0, fps * 2, 0, fps);
    assert.equal(poster.progress, 1);
    assert.equal(Math.abs(poster.translateY), 0);
    assert.equal(poster.scale, 1);
    assert.equal(poster.settleFrame, 0);
    for (const frame of [1, Math.floor(fps / 2), fps * 2 - 1]) assert.deepEqual(promoTitleMotion(theme, role, 0, fps * 2, frame, fps), poster, "the opening poster never arrives after playback starts");
  }
  assert.equal(new Set(["flat", "vibrant", "block"].map((theme) => promoTitleMotion(theme as "flat" | "vibrant" | "block", "benefit", 60, 180, 61, 30).style)).size, 3, "each theme has its own title motion grammar");
});

const brief: Brief = {
  id: "title-motion", recipe: "ProductPromo", job: "sell", langs: ["en"], bpm: 1800 / 13, fps: 30, session: "title-motion",
  hooks: [{ id: "hook", mode: "type", text: { en: "Your next project, ready" } }],
  lines: [
    { id: "open", mark: "open", mode: "type", text: { en: "Keep the project context together" } },
    { id: "brand", mode: "type", text: { en: "Acme" } },
    { id: "end", mode: "type", text: { en: "acme.example" } },
  ],
  promo: { opening: "promise", pace: "crisp", evidence: { hook: { mark: "open", facts: ["ui.open"] }, open: { mark: "open", facts: ["ui.open"] } } },
};
const source: TakeWithAssets = { viewport: { width: 1920, height: 1080 }, durationMs: 7000, fps: 25, videoRatio: 2,
  marks: [{ name: "open", t: 1000 }], events: [{ kind: "click", t: 1400, x: 500, y: 300 }],
  macros: [{ mark: "open", file: "open.png", pixelRatio: 4, box: { x: 400, y: 250, width: 200, height: 80 }, change: { box: { x: 200, y: 150, width: 900, height: 600 }, share: 0.3, boxShare: 0.5 }, resultAtMs: 1800 }],
};

test("rendered card metadata budgets reading after animation and keeps every cut on a whole beat", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-theme-motion-"));
  try {
    for (const take of ["desktop", "mobile"]) {
      await writeFile(join(dir, `title-motion.${take}.session.json`), JSON.stringify({ ...source, name: "title-motion", take, isMobile: take === "mobile", url: "", recordedAt: "2026-09-05", video: `title-motion.${take}.webm` }));
      await writeFile(join(dir, `title-motion.${take}.webm`), "");
    }
    const { buildCompositions } = await import("@panoma/video-render/compositions");
    for (const opening of ["promise", "result"] as const) for (const theme of ["flat", "vibrant", "block"] as const) {
      const here = { ...brief, promo: { ...brief.promo!, opening, theme } };
      const timeline = promoPlan(source, here, here.hooks[0], "en");
      const cards = timeline.sections.filter((section): section is PromoTitleSection => section.kind === "hook" || section.kind === "benefit" || section.kind === "end");
      const matrix = buildCompositions([here], { assets: dir, sessions: dir, generated: dir, sfx: dir });
      assert.ok(matrix.plans.size > 0);
      for (const plan of matrix.plans.values()) {
        for (const section of cards) {
          const card = plan.cards.find((card) => card.id === section.id)!;
          assert.ok(card);
          const settled = promoTitleSettledFrame(theme, section.kind, section.from, section.to, plan.fps);
          assert.equal(card.readFrom, settled, "review reads the same settlement frame as the rendered title");
          assert.ok([...section.text].length / ((card.to - card.readFrom!) / plan.fps) <= 24, "entrance time cannot consume the required reading interval");
          assert.ok(plan.holds.some((hold) => hold.from === settled && hold.to === card.to), "declared stillness begins only when the card actually stops");
        }
        assert.ok(plan.cuts.every((cut) => Number.isInteger(cut.frame) && cut.frame % 13 === 0));
        assert.ok(timeline.sections.every((section) => section.from % 13 === 0 && section.to % 13 === 0));
        const firstProduct = timeline.sections.find((section) => section.kind === "proof" || section.kind === "preview")!;
        assert.ok(firstProduct.from / plan.fps <= 3, "an animated title does not delay the first product beyond the opening target");
      }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the review refuses cards whose arrival leaves too little reading time or invalid timestamps", () => {
  const facts: FactSheet = { project: "acme", extractedAt: "2026-09-05", facts: [], notFacts: [] };
  const text = brief.lines[0].text.en;
  const plan: RenderPlan = { recipe: "ProductPromo", fps: 30, durationInFrames: 300, beats: { beatFrames: 15, barFrames: 60, start: 0 }, cuts: [], holds: [], fades: [], cards: [{ id: "open", text, from: 60, to: 150, readFrom: 70 }] };
  const status = (candidate: RenderPlan) => promoChecks({ brief, facts, plan: candidate }).find((check) => check.id === "promo.readable-cards")!.status;
  assert.equal(status(plan), "pass");
  for (const readFrom of [59, 135, 150, 151, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(status({ ...plan, cards: [{ ...plan.cards[0], readFrom }] }), "fail", `invalid or unreadable settle frame ${readFrom} cannot pass the reading gate`);
  }
});
