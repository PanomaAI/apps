/*
  The framing contract. This file exists because of a real regression: a desktop
  take fitted into a 9:16 canvas rendered at 25% of the pixels — "un cuadro pequeño
  en el centro que casi no se ve" — while the horizontal cut wasted more than half
  its frame on empty margin. The thresholds below are the promise that replaced it.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { FORMATS } from "@panoma/video-core";
import { castFill, castFrame, castPlan, zoomTransform, type CastSession } from "@panoma/video-render/timing";

const DESKTOP = { width: 1920, height: 1080 };
const MOBILE = { width: 720, height: 1280 };

test("vertical plays the mobile take and fills the frame", () => {
  const frame = castFrame(FORMATS.v, MOBILE, { isMobile: true });
  const fill = castFill(FORMATS.v, frame);
  assert.ok(fill > 0.75, `vertical fill regressed to ${(fill * 100).toFixed(0)}%`);
  assert.equal(frame.chrome, "device");
});

test("horizontal plays the desktop take and fills the frame", () => {
  const frame = castFrame(FORMATS.h, DESKTOP);
  const fill = castFill(FORMATS.h, frame);
  assert.ok(fill > 0.68, `horizontal fill regressed to ${(fill * 100).toFixed(0)}%`);
  assert.equal(frame.chrome, "browser");
});

test("a matched take beats a mismatched one in its own canvas", () => {
  const matched = castFill(FORMATS.v, castFrame(FORMATS.v, MOBILE, { isMobile: true }));
  const mismatched = castFill(FORMATS.v, castFrame(FORMATS.v, DESKTOP));
  assert.ok(matched > mismatched * 2, "the mobile take must be worth recording");
});

test("the window never leaves the canvas, in any format", () => {
  for (const format of Object.values(FORMATS)) {
    for (const [source, isMobile] of [
      [MOBILE, true],
      [DESKTOP, false],
    ] as const) {
      const f = castFrame(format, source, { isMobile });
      assert.ok(f.x >= 0, `${format.id} overflows left`);
      assert.ok(f.y >= 0, `${format.id} overflows top`);
      assert.ok(f.x + f.width <= format.width + 0.5, `${format.id} overflows right`);
      assert.ok(f.y + f.height <= format.height + 0.5, `${format.id} overflows bottom`);
      assert.ok(f.content.width > 0 && f.content.height > 0);
    }
  }
});

test("the content keeps the source aspect — no stretching, ever", () => {
  for (const format of Object.values(FORMATS)) {
    const f = castFrame(format, MOBILE, { isMobile: true });
    const ratio = f.content.width / f.content.height;
    assert.ok(Math.abs(ratio - MOBILE.width / MOBILE.height) < 1e-6, `${format.id} stretches the recording`);
  }
});

test("the zoom brings the focus toward the centre, and never past the edge", () => {
  const brief = {
    id: "z",
    recipe: "ScreenCast",
    langs: ["en"],
    bpm: 120,
    fps: 30,
    hooks: [{ id: "h", text: { en: "x" } }],
    lines: [],
  } as const;
  const source = { width: 720, height: 1280 };
  const session: CastSession = {
    viewport: source,
    durationMs: 8000,
    /* A click near the bottom edge — the case that exposed the pinned-origin bug. */
    events: [{ t: 2000, kind: "click", x: 546, y: 1232 }],
  };

  const plan = castPlan(session, brief);
  const held = Math.floor((plan.zooms[0].from + plan.zooms[0].to) / 2);
  const t = zoomTransform(plan, brief, held, source);

  assert.ok(t.scale > 1, "the hold should be zoomed");
  assert.ok(t.dy < 0, "a focus below centre must be pulled up");
  const limit = (t.scale - 1) / 2;
  assert.ok(Math.abs(t.dx) <= limit + 1e-9 && Math.abs(t.dy) <= limit + 1e-9, "the content must still cover the box");

  /* Where the focus lands, in fractions of the box: closer to centre than it began. */
  const landed = 0.5 + ((1232 / 1280 - 0.5) * t.scale + t.dy);
  assert.ok(Math.abs(landed - 0.5) < Math.abs(1232 / 1280 - 0.5), "the focus must move toward the centre");
  assert.ok(landed <= 1 && landed >= 0, "the focus must stay on screen");

  /* Outside a zoom, the transform is the identity. */
  const flat = zoomTransform(plan, brief, 0, source);
  assert.deepEqual(flat, { scale: 1, dx: 0, dy: 0 });
});

test("the plan skips the recording's blank head", () => {
  const brief = {
    id: "r",
    recipe: "ScreenCast",
    langs: ["en"],
    bpm: 120,
    fps: 30,
    hooks: [{ id: "h", text: { en: "x" } }],
    lines: [],
  } as const;
  const source = { width: 720, height: 1280 };
  const session: CastSession = {
    viewport: source,
    durationMs: 10_000,
    readyMs: 2000,
    events: [
      /* A click during the load — before the product painted — must not become a zoom. */
      { t: 900, kind: "click", x: 100, y: 100 },
      { t: 5000, kind: "click", x: 360, y: 640 },
    ],
  };

  const plan = castPlan(session, brief);
  /* 8 seconds of usable take, not 10. */
  assert.equal(plan.videoFrames, 240);
  assert.equal(plan.zooms.length, 1, "only the click after the load should zoom");
  /* The surviving click is 3s after ready, so 90 frames past the video start. */
  assert.ok(plan.zooms[0].from <= plan.videoStart + 90 && plan.zooms[0].from >= plan.videoStart);
});
