/*
  The studio: what it says a mark can be shown as, and what it draws.

  The material matrix is the part that has to be exactly right — a piece whose material
  is missing must never be planned — so every rule below is asserted against the shapes
  the recorder actually writes, taken from a real session log on this disk.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultColors, type BrandProfile } from "@panoma/video-brand";
import { deriveDirection } from "@panoma/video-brand/direction";
import { materialOf, paletteSvg, wordmarkSvg } from "@panoma/video-director";
import type { SessionLog } from "@panoma/video-capture";
import type { TourScript } from "@panoma/video-tour";
import { wellFormed } from "./map.test.ts";

const brand: BrandProfile = {
  source: { extractedAt: "2026-09-03T00:00:00.000Z" },
  name: "Universend",
  colors: {
    ...defaultColors(),
    primary: { hex: "#dbff64", confidence: "high", origin: "census" },
    background: { hex: "#02030a", confidence: "high", origin: "body" },
    text: { hex: "#f4f2ea", confidence: "high", origin: "css-token:--ink" },
  },
  tokens: {},
  scheme: { supports: ["dark"], default: "dark" },
  type: { heading: { category: "sans", family: "Geist" }, body: { category: "sans", family: "Geist" }, mono: { category: "mono", family: "Geist Mono" } },
  tone: { register: "neutral", metrics: {} },
};

/* universend's desktop take, with the fields that decide a shot. */
const take = {
  name: "u",
  take: "desktop",
  recordedAt: "2026-09-03T00:00:00Z",
  isMobile: false,
  fps: 25,
  url: "http://127.0.0.1:57026/",
  viewport: { width: 1920, height: 1080 },
  video: "u.desktop.webm",
  durationMs: 90_000,
  readyMs: 2600,
  marks: [{ name: "hero", t: 1634 }, { name: "cta", t: 23_397 }, { name: "quiet", t: 60_000 }],
  frames: [
    { id: "u.hero", mark: "hero", t: 1634, file: "frames/hero.png", url: "http://x/", viewport: { width: 1920, height: 1080 }, pixelRatio: 2 },
    { id: "u.cta", mark: "cta", t: 23_397, file: "frames/cta.png", url: "http://x/", viewport: { width: 1920, height: 1080 }, pixelRatio: 2 },
  ],
  elements: [{ id: "u.cta", mark: "cta", t: 23_397, file: "elements/cta.png", url: "http://x/", viewport: { width: 1920, height: 1080 }, box: { x: 0, y: 0, width: 10, height: 10 }, kind: "cta", name: "Mute" }],
  macros: [
    /* The shape universend really has: a control with its after-state and no local clip. */
    { id: "u.cta", mark: "cta", t: 23_397, file: "macro/cta.png", url: "http://x/", viewport: { width: 1920, height: 1080 }, box: { x: 768, y: 954, width: 221, height: 117 }, pixelRatio: 8, afterControl: { file: "macro/cta.control.png", pixelRatio: 8 }, change: { box: { x: 26, y: 40, width: 1894, height: 1016 }, share: 0.122, boxShare: 0.928 } },
    /* And the shape a menu has: something local opened, so it can unfold. */
    { id: "u.quiet", mark: "quiet", t: 60_000, file: "macro/quiet.png", url: "http://x/", viewport: { width: 1920, height: 1080 }, box: { x: 10, y: 10, width: 100, height: 40 }, pixelRatio: 8, after: { file: "macro/quiet.after.png", box: { x: 0, y: 0, width: 400, height: 300 }, pixelRatio: 5 }, change: { box: { x: 0, y: 0, width: 400, height: 300 }, share: 0.04, boxShare: 0.12 } },
  ],
  events: [],
} as unknown as SessionLog;

const tour = {
  name: "u", url: "http://127.0.0.1:57026/", createdAt: "2026-09-03T00:00:00.000Z",
  steps: [], candidates: [], snapshot: "", flow: { title: "u", steps: [] }, pages: [], edges: [],
  marks: [
    { name: "hero", label: "Universend", kind: "hero" as const },
    { name: "cta", label: "Mute", kind: "cta" as const, outcome: { heading: "Silence" } },
    { name: "quiet", label: "Menu", kind: "cta" as const },
  ],
} satisfies TourScript;

test("a shot is offered only where the material for it is on disk", () => {
  const material = materialOf([take], tour);
  const of = (mark: string) => material.find((m) => m.mark === mark)!;

  /* A page shot needs a 2x viewport; the third mark has none. */
  assert.deepEqual(of("hero").shots, ["page"]);
  assert.ok(!of("quiet").shots.includes("page"));
  assert.equal(of("quiet").missing.page, "no 2x viewport was captured at this mark");

  /* A press needs the control AND its after-state — universend has exactly that. */
  assert.ok(of("cta").shots.includes("press"));
  assert.equal(of("hero").missing.press, "no macro clip of the control");

  /* An unfold needs something local that opened. universend's cta changed 93% of the
     viewport, so there is no local clip and the shot is refused with that reason. */
  assert.ok(!of("cta").shots.includes("unfold"));
  assert.equal(of("cta").missing.unfold, "nothing local opened that the capture could clip");
  assert.ok(of("quiet").shots.includes("unfold"));

  /* A reveal needs the interface to have answered. */
  assert.ok(of("cta").shots.includes("reveal"));
  assert.equal(of("quiet").missing.reveal, "the click produced no heading and no route the tour could see");
});

test("what the capture measured travels with the mark, not a recomputation of it", () => {
  const cta = materialOf([take], tour).find((m) => m.mark === "cta")!;
  assert.equal(cta.changeShare, 0.122);
  assert.deepEqual(cta.outcome, { heading: "Silence" });
  assert.deepEqual(cta.takes, ["desktop"]);
  assert.equal(cta.label, "Mute");
});

test("a take with nothing captured offers nothing, and says so per shot", () => {
  const empty = { ...take, frames: [], elements: [], macros: [] } as unknown as SessionLog;
  const material = materialOf([empty], tour);
  assert.equal(material.length, 3);
  for (const m of material) {
    assert.deepEqual(m.shots, []);
    assert.equal(m.missing.page, "no 2x viewport was captured at this mark");
  }
});

test("the palette card and the wordmark parse — a font stack carries quotes", () => {
  const d = deriveDirection(brand, { flows: 1 });
  assert.deepEqual(wellFormed(paletteSvg(d, "Universend")), []);
  assert.deepEqual(wellFormed(wordmarkSvg("Universend", d)), []);
});

test("the palette card says where every colour came from", () => {
  const d = deriveDirection(brand, { flows: 1 });
  const svg = paletteSvg(d, "Universend");
  assert.ok(svg.includes(d.stage.hex) && svg.includes(d.accent.hex));
  /* The reason, not just the value: a card of six hexes teaches nobody anything. */
  assert.ok(svg.includes("the product's own ground"), "the stage's reason is missing");
  assert.ok(svg.includes(`${d.sound.bpm} BPM`), "the bed the film is scored with is missing");
});

test("the drawings are deterministic: the same direction twice is the same file", () => {
  const d = deriveDirection(brand, { flows: 1 });
  assert.equal(paletteSvg(d, "Universend"), paletteSvg(d, "Universend"));
  assert.equal(wordmarkSvg("Universend", d), wordmarkSvg("Universend", d));
});
