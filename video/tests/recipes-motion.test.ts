/*
  The other recipes move like the tutorial, and every recipe can dance to the music.

  On 2026-09-04 the tutorial got four habits the trailer and the cast did not have: the
  pointer is Cap's spring and sits on the click point before the click; the press — pulse,
  ring, the pointer's own give — runs on the TIMELINE, never on the recording's clock; the
  camera is capped at the recording's own pixels (`videoWhole`) instead of fudged per
  format; and every move is the critically damped spring. This file is the promise that
  the trailer and the cast now do the same, plus the one thing the cast does that nobody
  else does: two clicks close together are joined by a pan, and the camera stays in.

  Everything here is arithmetic on synthetic logs, except the last block, which reads the
  recipes as source for the habits a rendered frame cannot prove — a ripple aged in
  milliseconds only shows on the take that retimes it.
*/
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFile } from "node:fs/promises";
import { FORMATS, type Brief } from "@panoma/video-core";
import { cameraAt, cameraTransform, castPlan, castShots, trailerPlan, trailerShots, videoWhole, type CastSession, type CastShot } from "@panoma/video-render/timing";
import { MOTION_PRESETS, danceWithin } from "@panoma/video-render/motion";

const FPS = 30;
const BEAT = 15;
const BAR = 60;

const castBrief: Brief = {
  id: "cam",
  recipe: "ScreenCast",
  langs: ["en"],
  bpm: 120,
  fps: FPS,
  hooks: [{ id: "h", text: { en: "x" } }],
  lines: [],
};

/* Two clicks six seconds apart: strangers, released between. */
const far: CastSession = {
  viewport: { width: 1920, height: 1080 },
  durationMs: 18_000,
  readyMs: 2000,
  events: [
    { t: 4000, kind: "click", x: 400, y: 300 },
    { t: 10_000, kind: "click", x: 1500, y: 800 },
  ],
};
/* Two clicks 1.8 s apart — the real panoma-tour spacing — inside OpenScreen's gap: neighbours, panned between. */
const near: CastSession = { ...far, events: [{ t: 4000, kind: "click", x: 400, y: 300 }, { t: 5800, kind: "click", x: 1200, y: 700 }] };

const frameOf = (s: CastSession, t: number) => BAR + Math.round((((t - (s.readyMs ?? 0)) / 1000) * FPS) / 1);
const continuous = (a: CastShot, b: CastShot) =>
  Math.abs(a.end.fx - b.start.fx) < 1e-9 && Math.abs(a.end.fy - b.start.fy) < 1e-9 && Math.abs(a.end.scale - b.start.scale) < 1e-9;

describe("chained zooms in the cast", () => {
  test("two clicks under OpenScreen's gap are joined by a pan, and the camera stays in", () => {
    const plan = castPlan(near, castBrief);
    const shots = castShots(near, castBrief, plan);
    const pan = shots.find((s) => s.reason.startsWith("pan to click 2"));
    assert.ok(pan, `no pan: ${shots.map((s) => s.reason).join(" | ")}`);
    const first = shots.findIndex((s) => s.reason.startsWith("punch on click 1"));
    const second = shots.findIndex((s) => s.reason.startsWith("punch on click 2"));
    assert.ok(first >= 0 && second > first);
    /* Nothing between the two punches releases or travels: no zoom-out-and-back-in. */
    for (const s of shots.slice(first + 1, second)) assert.ok(/^(hold|pan)/.test(s.reason), `the camera let go between the clicks: ${s.reason}`);
    /* The pan is continuous at both ends — a move, not a cut — and the next punch is entered already in. */
    assert.ok(continuous(shots[shots.indexOf(pan) - 1], pan), "the pan does not start where the hold ended");
    assert.ok(continuous(pan, shots[second]), "the punch does not start where the pan landed");
    assert.equal(shots[second].enter, "cut");
    assert.ok(shots[second].reason.endsWith("(panned in)"));
    /* Its attack is on a beat, its length is OpenScreen's, and it has landed by the click it is for. */
    assert.equal(pan.from % BEAT, 0, `pan attacks off the grid at ${pan.from}`);
    assert.equal(pan.to - pan.from, Math.round((MOTION_PRESETS.zoom.panMs / 1000) * FPS));
    assert.ok(pan.to <= frameOf(near, 5800), `the pan lands at ${pan.to}, after the click at ${frameOf(near, 5800)}`);
    assert.equal(pan.ease, "spring");
    /* And from the first click to the second the camera never opens past the shallower punch. */
    const depths = [shots[first].end.scale, shots[second].end.scale];
    let least = Infinity;
    for (let f = frameOf(near, 4000); f <= frameOf(near, 5800); f++) least = Math.min(least, cameraTransform(cameraAt(shots, f, BEAT)).scale);
    assert.ok(least >= Math.min(...depths) * 0.97 - 1e-9, `the camera dipped to ${least.toFixed(3)} between the clicks`);
  });

  test("two clicks past the gap still release between them", () => {
    const plan = castPlan(far, castBrief);
    const shots = castShots(far, castBrief, plan);
    assert.ok(!shots.some((s) => s.reason.startsWith("pan")), "strangers were panned between");
    assert.ok(shots.some((s) => s.reason.startsWith("travel to moment 2")), "the release between two far clicks is gone");
  });

  test("a click too close for a pan is the crowd case, and the edit is what it was", () => {
    const busy: CastSession = {
      viewport: { width: 1920, height: 1080 },
      durationMs: 20_000,
      readyMs: 1000,
      events: Array.from({ length: 12 }, (_, i) => ({ t: 1500 + i * 700, kind: "click" as const, x: 200 + i * 100, y: 300 + (i % 3) * 150 })),
    };
    const shots = castShots(busy, castBrief, castPlan(busy, castBrief));
    assert.ok(!shots.some((s) => s.reason.startsWith("pan")), "a pan of a second was fitted between clicks 700 ms apart");
  });

  /*
    A chain leaves the bar grid at its first pan — that is what makes it a chain — and it
    used to leave the camera there. `until` for a panned-in punch was `attack + bar` off an
    off-grid attack and was never snapped, so the hold ended on an arbitrary frame and the
    next moment's attack inherited it. Measured 2026-09-05 on this session: the whip into
    the closing scroll cut at 421, which is neither a bar nor a beat (421 % 15 = 1); over
    600 random sessions, 292 cuts landed off the bar and 12 off the beat.
  */
  const chain: CastSession = {
    viewport: { width: 1920, height: 1080 },
    durationMs: 18_000,
    readyMs: 2000,
    events: [
      { t: 3724, kind: "scroll", y: 400 },
      { t: 5113, kind: "click", x: 400, y: 300 },
      { t: 8751, kind: "click", x: 900, y: 500 },
      { t: 11_645, kind: "click", x: 1200, y: 700 },
      { t: 12_186, kind: "click", x: 1300, y: 750 },
      { t: 13_825, kind: "scroll", y: 600 },
    ],
  };

  test("a chain hands the grid back, so the cut after a panned-in punch lands on it", () => {
    for (const format of [undefined, FORMATS.h]) {
      const shots = castShots(chain, castBrief, castPlan(chain, castBrief), undefined, format);
      assert.ok(shots.some((s) => s.reason.endsWith("(panned in)")), `nothing chained here: ${shots.map((s) => s.reason).join(" | ")}`);
      for (let i = 1; i < shots.length; i++) {
        /* A seam with the same framing on both sides is a move, not a cut, and owes the grid nothing. */
        if (continuous(shots[i - 1], shots[i])) continue;
        assert.equal(shots[i].from % BAR, 0, `cut off the grid at ${shots[i].from} (${shots[i].reason})`);
      }
    }
  });
});

describe("the cast's punch is the tutorial's push", () => {
  test("the spring runs to half a second past the click, then the hold drifts", () => {
    const plan = castPlan(far, castBrief);
    const shots = castShots(far, castBrief, plan);
    const punch = shots.find((s) => s.reason === "punch on click 1")!;
    const hold = shots.find((s) => s.reason === "hold on click 1")!;
    assert.equal(punch.ease, "spring");
    assert.equal(punch.to, frameOf(far, 4000) + Math.round(FPS * 0.5));
    assert.ok(punch.start.scale < punch.end.scale);
    assert.ok(continuous(punch, hold), "the hold does not start where the push landed");
    assert.equal(hold.ease, "linear");
    assert.ok(Math.abs(hold.end.scale - punch.end.scale * 1.012) < 1e-9, "a hold that is a perfect freeze is what the encoder calls a stall");
    /* The seam between them is not a cut, so it need not be on the bar; the hold's END is a cut and is. */
    assert.equal(hold.to % BAR, 0);
  });

  test("every ease is the spring, except the establishing drift and the linear hold", () => {
    for (const s of castShots(near, castBrief, castPlan(near, castBrief))) {
      if (s.reason === "establish") assert.equal(s.ease, "inOut");
      else if (s.reason.startsWith("hold")) assert.equal(s.ease, "linear");
      else assert.equal(s.ease, "spring", `${s.reason} moves with ${s.ease}`);
    }
  });
});

describe("the cast never draws past the recording's own pixels", () => {
  test("with a format every framing is capped at videoWhole, and the per-format fudge is nowhere", () => {
    const plan = castPlan(far, castBrief);
    const whole = videoWhole(FORMATS.h, far.viewport);
    assert.ok(whole < 1.2, `a 1x take on a horizontal cut is 1:1 at ${whole}`);
    for (const s of castShots(far, castBrief, plan, undefined, FORMATS.h)) {
      /* A hold drifts a per cent past the cap on purpose: under the eye, over the duplicate detector. */
      const room = s.reason.startsWith("hold") ? whole * 1.012 : whole;
      assert.ok(s.start.scale <= room + 1e-9 && s.end.scale <= room + 1e-9, `${s.reason} draws ${Math.max(s.start.scale, s.end.scale)} past ${whole}`);
    }
    /* Without a format nothing is capped: that is how the tests above can pin a direction's depths. */
    assert.ok(castShots(far, castBrief, plan).some((s) => s.end.scale > whole));
    /* A take at the device pixels holds twice as much, and the punch is never reached by the cap. */
    const two = { ...far, videoRatio: 2 };
    const punch = castShots(two, castBrief, castPlan(two, castBrief), undefined, FORMATS.h).find((s) => s.reason === "punch on click 1")!;
    assert.ok(punch.end.scale > 1.5, `the punch was capped at ${punch.end.scale} on a 2x take`);
  });

  test("a phone take arrives already magnified and the camera declines to zoom", () => {
    const phone: CastSession = { ...far, viewport: { width: 390, height: 844 }, isMobile: true, events: [{ t: 4000, kind: "click", x: 200, y: 400 }] };
    const plan = castPlan(phone, castBrief);
    const shots = castShots(phone, castBrief, plan, undefined, FORMATS.v);
    for (let f = 0; f < plan.durationInFrames; f += 5) assert.equal(cameraTransform(cameraAt(shots, f, BEAT)).scale, 1, `frame ${f} zooms a phone take`);
  });
});

/* ---------- the trailer ---------- */

const trailerBrief: Brief = {
  id: "t",
  recipe: "ReleaseTrailer",
  langs: ["en"],
  bpm: 120,
  fps: FPS,
  hooks: [{ id: "k", text: { en: "Acme v1.2" } }],
  lines: [
    { id: "c1", mark: "open", text: { en: "Open it" } },
    { id: "c2", mark: "share", text: { en: "Share it" } },
  ],
};
/* A 25 fps take, so the conform rate is 1.2 and a press mapped on the recording's clock would be a fifth late. */
const take: CastSession = {
  viewport: { width: 1920, height: 1080 },
  durationMs: 20_000,
  readyMs: 1000,
  fps: 25,
  marks: [
    { name: "hero", t: 1500 },
    { name: "open", t: 3000 },
    { name: "share", t: 9000 },
  ],
  events: [
    { t: 3200, kind: "click", x: 10, y: 10, role: "chrome" },
    { t: 3800, kind: "click", x: 1600, y: 260, role: "product" },
    { t: 5000, kind: "click", x: 900, y: 500 },
    { t: 9600, kind: "click", x: 100, y: 170, role: "product" },
  ],
};
type Proof = Extract<ReturnType<typeof trailerPlan>["sections"][number], { kind: "proof" }>;
const proofsOf = (plan: ReturnType<typeof trailerPlan>) => plan.sections.filter((s): s is Proof => s.kind === "proof");

describe("what a proof knows about its presses", () => {
  test("every product press is on the timeline, in order, inside the proof, and chrome is not one", () => {
    const plan = trailerPlan(take, trailerBrief, "en");
    const [open, share] = proofsOf(plan);
    assert.equal(open.presses.length, 2, "the consent click at 3200 ms is not a press the proof shows");
    assert.deepEqual(open.presses.map((p) => [p.x, p.y]), [[1600, 260], [900, 500]]);
    for (const p of open.presses) assert.ok(p.frame >= open.from && p.frame < open.to, `press at ${p.frame} outside [${open.from}, ${open.to})`);
    /* Mapped through the conform rate: 800 ms after the mark at 1.2x is 20 frames, not 24. */
    assert.equal(open.presses[0].frame, open.from + Math.round(((3800 - 3000) / 1000 / 1.2) * FPS));
    assert.equal(share.presses.length, 1);
    assert.equal(share.presses[0].frame, share.from + Math.round(((9600 - 9000) / 1000 / 1.2) * FPS));
  });
});

describe("the trailer's camera is the tutorial's", () => {
  test("a proof pushes to its press with the spring and then holds, drifting", () => {
    const plan = trailerPlan(take, trailerBrief, "en");
    const shots = trailerShots(plan);
    const [open] = proofsOf(plan);
    const push = shots.find((s) => s.reason === "proof 1: open")!;
    const held = shots.find((s) => s.reason === "proof 1: open (held)")!;
    assert.equal(push.ease, "spring");
    assert.equal(push.from, open.from);
    assert.equal(push.to, open.presses[0].frame + Math.round(FPS * 0.5), "the push lands half a second past the press");
    assert.ok(continuous(push, held));
    assert.equal(held.to, open.to);
    assert.ok(Math.abs(held.end.scale - push.end.scale * 1.012) < 1e-9);
    /* The shot list still covers every section end to end. */
    assert.equal(shots[0].from, 0);
    assert.equal(shots[shots.length - 1].to, plan.durationInFrames);
    for (let i = 1; i < shots.length; i++) assert.equal(shots[i].from, shots[i - 1].to, `gap before ${shots[i].reason}`);
  });

  test("a proof with no press is one spring across its section", () => {
    const quiet = { ...take, events: take.events.filter((e) => e.t < 9000) };
    const plan = trailerPlan(quiet, trailerBrief, "en");
    const [, share] = proofsOf(plan);
    assert.equal(share.presses.length, 0);
    const shots = trailerShots(plan).filter((s) => s.reason.startsWith("proof 2"));
    assert.equal(shots.length, 1);
    assert.equal(shots[0].ease, "spring");
    assert.equal(shots[0].from, share.from);
    assert.equal(shots[0].to, share.to);
  });

  test("with a format and a take every framing is capped at videoWhole; the fudge is measured now", () => {
    const plan = trailerPlan(take, trailerBrief, "en");
    const whole = videoWhole(FORMATS.h, take.viewport);
    for (const s of trailerShots(plan, undefined, FORMATS.h, take)) {
      const room = s.reason.endsWith("(held)") ? whole * 1.012 : whole;
      assert.ok(s.start.scale <= room + 1e-9 && s.end.scale <= room + 1e-9, `${s.reason} draws ${Math.max(s.start.scale, s.end.scale)} past ${whole}`);
    }
    /* A capped proof still pushes: six per cent of wherever the cap let it land. */
    const push = trailerShots(plan, undefined, FORMATS.h, take).find((s) => s.reason === "proof 1: open")!;
    assert.ok(push.end.scale - push.start.scale > 0.05);
    assert.ok(trailerShots(plan).some((s) => s.end.scale > whole), "without a format nothing is capped");
    /* And a phone take is not zoomed at all. */
    const phone: CastSession = { ...take, viewport: { width: 390, height: 844 }, isMobile: true };
    const shots = trailerShots(trailerPlan(phone, trailerBrief, "en"), undefined, FORMATS.v, phone);
    for (let f = 0; f < plan.durationInFrames; f += 7) assert.equal(cameraTransform(cameraAt(shots, f, BEAT)).scale, 1);
  });
});

/* ---------- the dance, where the file has room ---------- */

describe("a pump the plate can afford", () => {
  test("never draws a clip past its pixels, never shrinks, and is the whole kick when there is room", () => {
    /* At the press the control's clip is at its 8x exactly: no room, no dance. */
    assert.equal(danceWithin(1.03, 8, [8]), 1);
    /* The page at its 2x under a menu clip at 5x: the page is the tight one. */
    assert.equal(danceWithin(1.03, 2, [2, 5]), 1);
    /* At rest on the page at 1.5x the kick fits whole. */
    assert.ok(Math.abs(danceWithin(1.03, 1.5, [2]) - 1.03) < 1e-9);
    /* Nearly at the ratio, the kick is trimmed to what is left. */
    assert.ok(Math.abs(danceWithin(1.03, 1.95, [2]) - 2 / 1.95) < 1e-9);
    /* Nothing drawn: nothing to protect. Under 1 is never returned. */
    assert.equal(danceWithin(1.03, 3, []), 1.03);
    assert.equal(danceWithin(0.9, 1, [2]), 1);
  });
});

/* ---------- the guarantees, read as source ---------- */

describe("the recipes, read as source", () => {
  const code = async (path: string) => {
    const src = await readFile(new URL(path, import.meta.url), "utf8");
    return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  };

  test("no press effect in the trailer or the cast runs on the recording's clock, and the pointer is Cap's spring", async () => {
    for (const file of ["../apps/render/src/recipes/ReleaseTrailer.tsx", "../apps/render/src/recipes/ScreenCast.tsx"]) {
      const src = await code(file);
      assert.doesNotMatch(src, /\/ 450/, `${file}: a ripple aged in the recording's milliseconds freezes with the picture`);
      assert.doesNotMatch(src, /cursorAt\(/, `${file}: the tween is back`);
      assert.doesNotMatch(src, /const push =/, `${file}: the per-format fudge is back beside the measured ceiling`);
      assert.doesNotMatch(src, /format\.id === "v" \? 1\.15/, `${file}: the per-format fudge is back`);
      assert.match(src, /dancedZoom\(cameraTransform\(/, `${file}: the dance must come after the camera transform`);
      /* Only when a pulse exists: an empty pulse would dim the lights of every piece without a track (Backdrop reads `pulse ?`). */
      assert.match(src, /\{\.\.\.\(pulse \? \{ pulse: \{ beat: at\.beat, energy: at\.energy \} \} : \{\}\)\}/, `${file}: the backdrop does not breathe with the music, or does so with no music`);
    }
    assert.match(await code("../apps/render/src/recipes/ReleaseTrailer.tsx"), /cursorAtMs\(cursorPathOf\(/, "a retimed proof seeks the path by the recording's milliseconds");
    assert.match(await code("../apps/render/src/recipes/ReleaseTrailer.tsx"), /section\.presses/, "the trailer's press must be the plan's");
    const cast = await code("../apps/render/src/recipes/ScreenCast.tsx");
    assert.match(cast, /cursorAtFrame\(cursorPathOf\(/, "a linear take indexes the path by frame");
    assert.match(cast, /eventFrame\(session, plan, fps, e\.t\)/, "the cast's presses are on the timeline");
  });

  test("the spotlight's pointer gives by the same curve, its plate dances only where the file has room, and its stage breathes", async () => {
    const stagecraft = await code("../apps/render/src/lib/Stagecraft.tsx");
    assert.doesNotMatch(stagecraft, /pressed\?: boolean/, "the pointer's press is a squash, not a switch");
    assert.match(stagecraft, /press\?: number/);
    assert.match(stagecraft, /1 - 0\.14 \* Math\.min\(1, Math\.max\(0, press\)\)/, "the squash is ProductWindow's seventh");
    const spotlight = await code("../apps/render/src/recipes/FeatureSpotlight.tsx");
    assert.match(spotlight, /danceWithin\(dancedScale\(at\), key\.k, ratios\)/, "the plate's dance must be bounded by the ratios on screen");
    assert.match(spotlight, /pressAge < 2 \? \(pressAge \+ 1\) \/ 2 : Math\.exp\(-\(pressAge - 2\) \/ 3\)/, "the press curve is the tutorial's");
    assert.match(spotlight, /<SpotStage[^>]*\{\.\.\.\(pulse \? \{ pulse: \{ beat: at\.beat, energy: at\.energy \} \} : \{\}\)\}/);
  });

  test("the cast's shot list reads OpenScreen's pairing and the recording's ceiling, and the slam is gone", async () => {
    const src = await readFile(new URL("../apps/render/src/recipes/timing.ts", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("export function castShots("));
    const fn = body.slice(0, body.indexOf("\n/**")).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    assert.match(fn, /chainZooms\(moments, fps\)/);
    assert.match(fn, /videoWhole\(/);
    assert.doesNotMatch(fn, /"slam"/);
    assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, " "), /slam: \(t: number\)/, "the sextic is back in the easing table");
  });
});
