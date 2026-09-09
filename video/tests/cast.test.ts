import assert from "node:assert/strict";
import { test } from "node:test";
import type { Brief } from "@panoma/video-core";
import { castPlan, cursorAt, zoomAt, type CastSession } from "@panoma/video-render/timing";

const brief: Brief = {
  id: "cast",
  recipe: "ScreenCast",
  langs: ["en"],
  bpm: 120,
  fps: 30,
  hooks: [{ id: "h", text: { en: "x" } }],
  lines: [],
};

const session: CastSession = {
  viewport: { width: 1920, height: 1200 },
  durationMs: 9000,
  events: [
    { t: 0, kind: "move", x: 960, y: 600 },
    { t: 1000, kind: "move", x: 400, y: 300 },
    { t: 2500, kind: "click", x: 400, y: 300 },
    { t: 6800, kind: "click", x: 1200, y: 800 },
  ],
};

test("the cast rounds to whole bars and starts after one intro bar", () => {
  const plan = castPlan(session, brief);
  assert.equal(plan.videoStart, 60);
  assert.equal(plan.durationInFrames % 60, 0);
  assert.ok(plan.durationInFrames >= plan.videoStart + plan.videoFrames + 60);
});

test("every zoom attacks on a beat boundary", () => {
  const plan = castPlan(session, brief);
  assert.equal(plan.zooms.length, 2);
  for (const z of plan.zooms) {
    assert.equal(z.from % 15, 0, `attack off the grid: ${z.from}`);
    assert.ok(z.to > z.from);
    assert.ok(z.to <= plan.durationInFrames);
  }
});

test("truly crowded clicks: the newcomer is skipped and the first focus keeps the frame", () => {
  const crowded: CastSession = {
    ...session,
    events: [
      { t: 2500, kind: "click", x: 400, y: 300 },
      { t: 2900, kind: "click", x: 800, y: 500 },
    ],
  };
  const plan = castPlan(crowded, brief);
  assert.equal(plan.zooms.length, 1);
  assert.equal(plan.zooms[0].cx, 400);
  assert.equal(plan.zooms[0].cy, 300);
});

test("nearby clicks: the previous zoom releases a beat early and the new focus gets its segment", () => {
  /* 1.8s apart — the real panoma-tour spacing that exposed the dropped-focus bug. */
  const nearby: CastSession = {
    ...session,
    events: [
      { t: 2500, kind: "click", x: 400, y: 300 },
      { t: 4300, kind: "click", x: 1200, y: 100 },
    ],
  };
  const plan = castPlan(nearby, brief);
  assert.equal(plan.zooms.length, 2);
  assert.equal(plan.zooms[1].cx, 1200);
  assert.equal(plan.zooms[1].cy, 100);
  assert.ok(plan.zooms[1].from >= plan.zooms[0].to + 15, "a beat of air between release and attack");
  assert.ok(plan.zooms[0].to >= plan.zooms[0].from + 30, "the truncated zoom still breathes");
});

test("zoomAt is 1 outside a segment, full mid-hold, and eased at the edges", () => {
  const plan = castPlan(session, brief);
  const z = plan.zooms[0];
  assert.equal(zoomAt(plan, brief, z.from - 1).scale, 1);
  const mid = zoomAt(plan, brief, Math.floor((z.from + z.to) / 2));
  assert.ok(Math.abs(mid.scale - z.scale) < 1e-9);
  const early = zoomAt(plan, brief, z.from + 3);
  assert.ok(early.scale > 1 && early.scale < z.scale);
});

test("the cursor rests before its first intent, eases between, and holds at the end", () => {
  assert.deepEqual(cursorAt(session, -100), { x: 960, y: 600 });
  const mid = cursorAt(session, 500);
  assert.ok(mid.x < 960 && mid.x > 400);
  assert.deepEqual(cursorAt(session, 99999), { x: 1200, y: 800 });
  /* An empty log parks the cursor at center rather than at (0,0). */
  const empty = cursorAt({ ...session, events: [] }, 0);
  assert.deepEqual(empty, { x: 960, y: 600 });
});
