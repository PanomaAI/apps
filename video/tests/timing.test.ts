import assert from "node:assert/strict";
import { test } from "node:test";
import type { Brief } from "@panoma/video-core";
import {
  cursorArc,
  fitKey,
  frameBox,
  keyFraming,
  keyRect,
  loopDuration,
  mixKey,
  pageAlpha,
  seamFlash,
  SPOTLIGHT,
  sweepAngle,
  terminalDuration,
  terminalParts,
  terminalRowFrame,
  terminalSummaryFrame,
  spotlightLayout,
  spotlightPlan,
  unitCamera,
} from "@panoma/video-render/timing";

const terminal: Brief = {
  id: "t",
  recipe: "TerminalRun",
  langs: ["en"],
  bpm: 120,
  fps: 30,
  hooks: [{ id: "h", text: { en: "hook" } }],
  lines: [
    { id: "cmd", text: { en: "run" } },
    { id: "o1", text: { en: "a" } },
    { id: "o2", text: { en: "b" } },
    { id: "o3", text: { en: "c" } },
    { id: "sum", text: { en: "done: 3" } },
  ],
};

test("terminal splits command / output / summary and refuses less", () => {
  const parts = terminalParts(terminal);
  assert.equal(parts.command.id, "cmd");
  assert.deepEqual(parts.output.map((l) => l.id), ["o1", "o2", "o3"]);
  assert.equal(parts.summary.id, "sum");
  assert.throws(() => terminalParts({ ...terminal, lines: terminal.lines.slice(0, 2) }), /needs command/);
});

test("terminal timeline: rows on half bars, summary after the last row, whole-bar total", () => {
  /* 120 BPM at 30 fps: bar = 60 frames. Type 1 bar, 3 rows over 2 half-bars -> ceil = 2 bars, summary +2. */
  assert.equal(terminalRowFrame(terminal, 0), 60);
  assert.equal(terminalRowFrame(terminal, 1), 90);
  assert.equal(terminalRowFrame(terminal, 2), 120);
  assert.equal(terminalSummaryFrame(terminal), 180);
  assert.equal(terminalDuration(terminal), 300);
  for (let i = 0; i < 3; i++) assert.ok(terminalRowFrame(terminal, i) < terminalSummaryFrame(terminal));
});

test("the loop is seamless by construction", () => {
  const total = loopDuration({ ...terminal, recipe: "Loop" });
  assert.equal(total, 240);
  assert.equal(sweepAngle(0, total) % 360, 0);
  assert.equal(sweepAngle(total, total) % 360, 0);
  /* The flash peaks exactly at the seam and dies within a few frames. */
  assert.equal(seamFlash(0, total), 1);
  assert.ok(seamFlash(3, total) === 0);
  assert.ok(seamFlash(total - 1, total) > 0.5);
  assert.equal(seamFlash(total / 2, total), 0);
});

const H = { id: "h", width: 1920, height: 1080, safe: { top: 60, bottom: 120, left: 90, right: 90 }, targets: [] } as const;
const V = { id: "v", width: 1080, height: 1920, safe: { top: 220, bottom: 420, left: 90, right: 120 }, targets: [] } as const;

const spotlightBrief: Brief = {
  ...terminal,
  recipe: "FeatureSpotlight",
  lines: [
    { id: "one", mark: "open", text: { en: "Open projects" } },
    { id: "two", mark: "share", text: { en: "Share context" }, result: { en: "Your catalog" } },
    { id: "end", text: { en: "example.test" } },
  ],
};

const menu = { x: 1392, y: 290, width: 246, height: 404 };
/* The button and the menu it opened, together, re-rendered at the menu's own ratio. */
const unfolded = { x: 1392, y: 236, width: 258, height: 458 };
/* The heading the navigation produced, measured on the frame after the click. */
const heading = { x: 280, y: 96, width: 700, height: 44 };
const spotlightTake = {
  viewport: { width: 1920, height: 1080 },
  durationMs: 10_000,
  events: [
    { t: 2400, kind: "click" as const, x: 1622, y: 267 },
    { t: 5200, kind: "click" as const, x: 100, y: 176 },
  ],
  marks: [{ name: "open", t: 2000 }, { name: "share", t: 5000 }],
  frames: [
    { mark: "open", file: "frames/open.png", pixelRatio: 2, url: "http://x/" },
    { mark: "share", file: "frames/share.png", pixelRatio: 2, url: "http://x/" },
  ],
  last: { mark: "__last", file: "frames/last.png", pixelRatio: 2, url: "http://x/bridge" },
  macros: [
    /* A menu opened under the button: a local change, rendered again. */
    { mark: "open", file: "macro/open.png", box: { x: 1453, y: 236, width: 197, height: 61 }, target: { x: 1607, y: 250, width: 30, height: 34 }, pixelRatio: 8, change: { box: menu, share: 0.006, boxShare: 0.048 }, after: { file: "macro/open.after.png", box: unfolded, pixelRatio: 5 }, afterControl: { file: "macro/open.control.png", pixelRatio: 8 } },
    /* A navigation: the page changed route, so the next frame is the after-state and the heading it produced is where the camera lands. */
    { mark: "share", file: "macro/share.png", box: { x: 0, y: 116, width: 241, height: 120 }, target: { x: 16, y: 153, width: 195, height: 46 }, pixelRatio: 8, change: { box: { x: 32, y: 108, width: 1616, height: 940 }, share: 0.034, boxShare: 0.73 }, focus: heading },
  ],
};

test("the feature spotlight cuts on bars, uses each control on beats, and reads the form of each result from the capture", () => {
  const plan = spotlightPlan(spotlightTake, spotlightBrief, H);
  /* 120 BPM / 30 fps: bar 60, beat 15, tick 5. Four bars of furniture, and three per feature: a bar of card and two of use. */
  assert.equal(plan.durationInFrames, 600, "ten bars for two features");
  assert.ok(plan.sections.every((section) => section.from % 60 === 0 && section.to % 60 === 0));
  assert.deepEqual(plan.sections.map((s) => s.kind), ["open", "kicker", "card", "unit", "card", "unit", "end"]);
  /* A card is the claim of the use that follows it, and it is on screen alone. */
  assert.deepEqual(plan.sections.filter((s): s is Extract<typeof s, { kind: "card" }> => s.kind === "card").map((s) => s.mark), ["open", "share"]);
  assert.deepEqual(plan.degraded, []);
  const units = plan.sections.filter((section): section is Extract<typeof section, { kind: "unit" }> => section.kind === "unit");
  const [open, share] = units;
  assert.equal(open.from, 180, "the first use starts after the open, the kicker and its own card");
  assert.equal(open.pointerFrom, open.from + 5, "the pointer sets off a tick in");
  assert.equal(open.pushFrom, open.from + 30, "the push starts on beat 3");
  assert.equal(open.press, open.from + 45, "the press lands on beat 4");
  assert.equal(open.result, open.from + 60, "the result shows on the next downbeat");
  assert.ok(open.unfoldFrom > open.result && open.unfoldFrom < open.rest, "a menu clip at 5x waits for the camera to come down from 8x");
  assert.equal(open.rest, open.from + 90, "the camera rests on cause and effect on the second bar's third beat");
  assert.equal(open.to, open.from + 120, "and holds there to the end of the shot");
  assert.equal(open.form, "menu");
  assert.equal(open.after?.file, "frames/share.png", "the next mark's frame is the after-state");
  assert.ok(open.clicked);
  assert.ok(Math.abs(open.fx - 1622 / 1920) < 1e-9 && Math.abs(open.fy - 267 / 1080) < 1e-9, "the press lands where the take clicked");
  assert.equal(share.form, "navigate", "a route change is a navigation");
  assert.equal(share.after?.file, "frames/last.png", "the last mark is judged on the take's last frame");
  /*
    A navigation rests on the heading its click produced — with the control beside it
    when both fit at a size anyone can read, and on the heading alone when they do
    not. Holding a sidebar item and a heading a thousand pixels away meant showing
    the page at half its own size: fifteen times the plate, type nobody reads, and a
    pull-out to it that the review counted as a cut.
  */
  const landing = share.camera.result.window;
  assert.ok(
    landing.x <= heading.x && landing.x + landing.width >= heading.x + heading.width && landing.y <= heading.y,
    `the heading the claim quotes is in the window: ${JSON.stringify(landing)}`,
  );
  /* As large as the stage allows, and the stage is now the whole frame: the claim has its own card, so nothing shares the canvas with the picture. */
  assert.ok(share.camera.result.k > 1.1, `and shown as large as the layout allows: ${share.camera.result.k}`);
  assert.deepEqual(open.camera.result.window, unfolded);
  /* The first use's before frame opens the piece, under a push toward its press. */
  const first = plan.sections[0];
  assert.ok(first.kind === "open" && first.still?.file === "frames/open.png" && first.camera.to.k > first.camera.from.k);
});

test("the camera never draws a file past its own pixels, rests where the claim lands, and reflows from layout tokens", () => {
  for (const format of [H, V]) {
    const plan = spotlightPlan(spotlightTake, spotlightBrief, format);
    const short = Math.min(format.width, format.height);
    const units = plan.sections.filter((s): s is Extract<typeof s, { kind: "unit" }> => s.kind === "unit");
    for (const [i, u] of units.entries()) {
      const macro = u.macro!;
      const control = macro.target ?? macro.box;
      for (let frame = u.from; frame < u.to; frame++) {
        const { key, stage } = unitCamera(u, frame, 15);
        /* The control's clip is the sharpest thing shown above the page's own pixels, and it is never enlarged past its ratio. */
        assert.ok(key.k <= macro.pixelRatio + 1e-9, `${format.id} use ${u.index} frame ${frame}: k ${key.k} past ${macro.pixelRatio}x`);
        /* A menu's clip is drawn only from the frame the camera is down to its pixels; the page only below its own. */
        if (u.form === "menu" && frame >= u.unfoldFrom) assert.ok(key.k <= macro.after!.pixelRatio + 1e-9, `${format.id} use ${u.index} frame ${frame}: menu at ${key.k} past ${macro.after!.pixelRatio}x`);
        if (pageAlpha(key.k) > 0) assert.ok(key.k <= 2 + 1e-9);
        if (stage === "rest" && u.form !== "menu") assert.ok(key.k <= 2 + 1e-9, `${format.id} use ${u.index} rests on the page at ${key.k}`);
        /* And when framed, the control is no taller than the share the look asks for, breathing in by its drift aside. */
        if (stage === "arrive") assert.ok(control.height * key.k <= 0.26 * short * 1.015 + 1e-6, `${format.id}: framed control ${control.height * key.k} px`);
        if (stage === "press") assert.ok(control.height * key.k <= 0.4 * short + 1e-6, `${format.id}: pressed control ${control.height * key.k} px`);
        /* The plate is the picture: it never grows past the canvas it is drawn on, on any frame of any stage. */
        const plate = keyRect(key);
        assert.ok(
          plate.width <= format.width + 1 && plate.height <= format.height + 1,
          `${format.id} use ${u.index} frame ${frame}: plate ${Math.round(plate.width)}x${Math.round(plate.height)} on ${format.width}x${format.height}`,
        );
      }
      /* The push pushes, the reveal pulls out, and a held frame drifts instead of freezing — as does a framed one. */
      assert.ok(unitCamera(u, u.press, 15).key.k > unitCamera(u, u.from, 15).key.k);
      assert.ok(unitCamera(u, u.rest, 15).key.k < unitCamera(u, u.press, 15).key.k);
      const held = unitCamera(u, u.rest + 20, 15).key.k / unitCamera(u, u.rest, 15).key.k;
      assert.ok(held > 1 && held < 1.02, `drift ${held}`);
      assert.ok(unitCamera(u, u.pushFrom - 1, 15).key.k > unitCamera(u, u.from, 15).key.k, "the framed control breathes in");
      /* A result that IS the page — a navigation, a reveal — rests at a scale where the page is drawn whole, drift and all. */
      if (u.form === "navigate" || u.form === "reveal") {
        for (let frame = u.rest; frame < u.to; frame++) {
          assert.equal(pageAlpha(unitCamera(u, frame, 15).key.k), 1, `${format.id} use ${u.index} rests on a page at ${pageAlpha(unitCamera(u, frame, 15).key.k)}`);
        }
      }
      /* The claim lands on a frame the camera has stopped on: the key is the result's, exactly, at rest. */
      assert.deepEqual(unitCamera(u, u.rest, 15).key, u.camera.result);
      /* The window is only ever as wide as what fills it: on the control until the page (or the menu) comes in, the result's at rest. */
      assert.deepEqual(unitCamera(u, u.result, 15).key.window, u.camera.pressed.window, "tight on the control at the first frame of the pull-out");
      const opening = unitCamera(u, u.result + 1, 15).key.window;
      assert.ok(opening.width <= u.camera.pressed.window.width * 1.3 + 1e-6, `and still on it a frame later: ${opening.width} against ${u.camera.pressed.window.width}`);
      if (u.form === "menu") assert.deepEqual(unitCamera(u, u.unfoldFrom, 15).key.window, macro.box, "and still on the control the frame the menu starts to unfold");
      /*
        A use ends on its own rest and the piece cuts to the next card. There is no
        travel between controls any more, and so no seam to match: the camera used to
        race the plate onto the next control across the last two beats, which is what
        kept the film from ever cutting.
      */
      assert.ok(unitCamera(u, u.to - 1, 15).key.k >= unitCamera(u, u.rest, 15).key.k, "the shot ends on the drift it rested into");
    }
  }
  /*
    A use whose control was never captured is still a picture: the page carries it,
    which means every frame of it must be at a scale where the page is drawn whole.
    Capping those keys at the page's own pixels — where its opacity is zero — left a
    claim over an empty plate for four beats, and four readers found it separately.
  */
  for (const format of [H, V]) {
    const bare = { ...spotlightTake, macros: [] };
    const one: Brief = { ...spotlightBrief, lines: [spotlightBrief.lines[0], spotlightBrief.lines[2]] };
    const plan = spotlightPlan(bare, one, format);
    assert.deepEqual(plan.degraded, ["open"], "the plan says the mark had no clip");
    const u = plan.sections.find((x): x is Extract<typeof x, { kind: "unit" }> => x.kind === "unit")!;
    assert.equal(u.macro, undefined);
    for (let frame = u.from; frame < u.to; frame++) {
      const { key } = unitCamera(u, frame, 15);
      assert.ok(pageAlpha(key.k) >= 1 - 1e-9, `${format.id} degraded frame ${frame}: the page is at ${pageAlpha(key.k)}`);
    }
  }

  /* A key mixes geometrically in scale and exactly at its ends; the plate is the window at its scale. */
  const a = { window: { x: 0, y: 0, width: 100, height: 50 }, k: 8, cx: 500, cy: 300 };
  const b = { window: { x: 10, y: 10, width: 400, height: 200 }, k: 2, cx: 900, cy: 500 };
  assert.deepEqual(mixKey(a, b, 0), a);
  assert.deepEqual(mixKey(a, b, 1), b);
  assert.ok(Math.abs(mixKey(a, b, 0.5).k - 4) < 1e-9);
  assert.deepEqual(keyRect(a), { x: 100, y: 100, width: 800, height: 400 });
  const f = keyFraming(a);
  assert.deepEqual(frameBox(f, a.window), keyRect(a), "the window's own box lands on the plate");
  /* The page is whole up to the scale a result rests at, gone at its own pixels, with a ramp between long enough to be a dissolve. */
  assert.equal(pageAlpha(0.8), 1);
  assert.equal(pageAlpha(SPOTLIGHT.pageWhole), 1, "a result rests on a page at full strength");
  assert.equal(pageAlpha(SPOTLIGHT.pageCap), 0);
  assert.ok(pageAlpha(1.75) > 0 && pageAlpha(1.75) < 1);
  /* fitKey respects the area and the cap. */
  const fit = fitKey({ x: 0, y: 0, width: 197, height: 61 }, { x: 0, y: 0, width: 1344, height: 900 }, 8);
  assert.ok(Math.abs(fit.k - 1344 / 197) < 1e-9);
  assert.equal(fitKey({ x: 0, y: 0, width: 197, height: 61 }, { x: 0, y: 0, width: 1344, height: 900 }, 2).k, 2);
  /* The pointer's arc starts and ends where it is told and bows on the way. */
  const p = { x: 0, y: 0 };
  const q = { x: 100, y: 0 };
  assert.deepEqual(cursorArc(p, q, 0), p);
  assert.deepEqual(cursorArc(p, q, 1), q);
  assert.ok(cursorArc(p, q, 0.5).y > 5, "not a straight line");
  /*
    Layout tokens, not format ids — and in every shape the plate is now the whole stage.
    The wide canvas used to keep its picture in the right-hand 46% because the claim was
    set in a column beside it; the claim has its own card, so a use is the product and
    nothing else, at whatever size the frame allows.
  */
  for (const format of [H, V]) {
    const plate = spotlightLayout(format).plate;
    assert.ok(plate.width >= 80 && plate.height >= 80, `${format.id}: the plate is the stage, not a column of it`);
  }
});
