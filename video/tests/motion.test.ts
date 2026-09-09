/*
  The motion library promises four things a viewer feels and nobody measures by
  eye: the cursor is there before the click, chips group like typing, idle is
  only ever both quiet and frozen, and neighbouring zooms pan. Each is cheap to
  assert on a synthetic log and expensive to notice in a render.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { FORMATS } from "@panoma/video-core";
import type { CastSession } from "@panoma/video-render/timing";
import {
  chainZooms,
  cursorAtFrame,
  cursorAtMs,
  cursorFrameCount,
  cursorPath,
  idleSegments,
  keystrokeChips,
  keystrokeLayout,
  MOTION_PRESETS,
  shakeFilter,
  sourceAt,
  speedMap,
  timelineAt,
  timelineLength,
} from "@panoma/video-render/motion";

const FPS = 30;
const viewport = { width: 1920, height: 1080 };

/* A glide from (200,200) to (900,600) over 450 ms, then the click 50 ms after arrival. */
const glide: CastSession = {
  viewport,
  durationMs: 3000,
  events: [
    { t: 0, kind: "move", x: 200, y: 200 },
    { t: 1000, kind: "move", x: 200, y: 200 },
    { t: 1450, kind: "move", x: 900, y: 600 },
    { t: 1500, kind: "click", x: 900, y: 600 },
  ],
};
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

test("the cursor is on the click point before the click, not chasing it", () => {
  const path = cursorPath(glide, FPS);
  const click = { x: 900, y: 600 };
  const travel = dist({ x: 200, y: 200 }, click);
  /* 100 ms before the click the recorded glide is still 22% short; the spring is not. */
  const raw = { x: 200 + (900 - 200) * (400 / 450), y: 200 + (600 - 200) * (400 / 450) };
  const spring = cursorAtMs(path, glide, FPS, 1400);
  assert.ok(dist(spring, click) < dist(raw, click), `spring ${dist(spring, click).toFixed(1)}px behind, raw ${dist(raw, click).toFixed(1)}px`);
  assert.ok(dist(spring, click) < travel * 0.08, `still ${dist(spring, click).toFixed(1)}px away 100 ms before the click`);
  /*
    The look-ahead opens at 1000 ms and the phase lead (149 ms for Mellow) reaches the
    glide just before that; at 800 ms neither has and the cursor is exactly at rest, and
    at 850 ms the frame lerp carries under a pixel of the lead's first nudge.
  */
  assert.equal(dist(cursorAtMs(path, glide, FPS, 800), { x: 200, y: 200 }), 0);
  assert.ok(dist(cursorAtMs(path, glide, FPS, 850), { x: 200, y: 200 }) < 1);
  assert.ok(dist(cursorAtMs(path, glide, FPS, 1200), { x: 200, y: 200 }) > travel * 0.3);
});

test("the path is deterministic, one point per conformed frame, and never leaves the viewport", () => {
  const corner: CastSession = {
    viewport,
    durationMs: 2000,
    fps: 25,
    readyMs: 200,
    events: [
      { t: 0, kind: "move", x: 960, y: 540 },
      { t: 300, kind: "move", x: 960, y: 540 },
      { t: 600, kind: "move", x: 1919, y: 1079 },
      { t: 650, kind: "click", x: 1919, y: 1079 },
      { t: 900, kind: "move", x: 1919, y: 1079 },
      { t: 1100, kind: "move", x: 0, y: 0 },
      { t: 1150, kind: "click", x: 0, y: 0 },
    ],
  };
  const a = cursorPath(corner, FPS);
  const b = cursorPath(corner, FPS);
  assert.deepEqual(a, b);
  assert.equal(a.length, cursorFrameCount(corner, FPS));
  /* (2000 - 200) ms at 25 fps conformed to 30 is 45 frames, plus the last one. */
  assert.equal(a.length, 46);
  for (const p of a) {
    assert.ok(p.x >= 0 && p.x <= 1920 && p.y >= 0 && p.y <= 1080, `off the viewport: ${p.x},${p.y}`);
  }
  assert.deepEqual(cursorAtFrame(a, -5), a[0]);
  assert.deepEqual(cursorAtFrame(a, 999), a[a.length - 1]);
});

test("the motion is smooth: the second difference stays bounded even across a snap to a click", () => {
  const path = cursorPath(glide, FPS);
  let worst = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const ax = path[i + 1].x - 2 * path[i].x + path[i - 1].x;
    const ay = path[i + 1].y - 2 * path[i].y + path[i - 1].y;
    worst = Math.max(worst, Math.hypot(ax, ay));
  }
  /* A raw teleport across this glide would be a 806 px kink; a spring stays under a tenth of the width. */
  assert.ok(worst < viewport.width * 0.1, `second difference ${worst.toFixed(1)}px per frame²`);
  assert.ok(worst > 0, "it moved");
});

test("strength 0 is the recorded path, and a preset changes the answer", () => {
  const raw = cursorPath(glide, FPS, { strength: 0 });
  assert.ok(dist(cursorAtMs(raw, glide, FPS, 1225), { x: 550, y: 400 }) < 1, "midway through the glide");
  const slow = cursorPath(glide, FPS, { preset: "slow" });
  const fast = cursorPath(glide, FPS, { preset: "fast" });
  assert.notDeepEqual(slow, fast);
});

test("a long gap between two places is a hidden span: the cursor holds, then restarts at rest", () => {
  const hidden: CastSession = {
    viewport,
    durationMs: 6000,
    events: [
      { t: 0, kind: "move", x: 100, y: 100 },
      { t: 5000, kind: "move", x: 1800, y: 900 },
      { t: 5100, kind: "move", x: 1800, y: 900 },
    ],
  };
  const path = cursorPath(hidden, FPS);
  assert.ok(dist(cursorAtMs(path, hidden, FPS, 2500), { x: 100, y: 100 }) < 1, "held at the departure");
  assert.ok(dist(cursorAtMs(path, hidden, FPS, 5000), { x: 1800, y: 900 }) < 1, "at rest on the far side");
});

test("the shake filter drops micro-reversals within 100 ms and keeps real ones", () => {
  const jitter = [
    { t: 0, x: 0.5, y: 0.5 },
    { t: 30, x: 0.505, y: 0.5 },
    { t: 60, x: 0.5, y: 0.5 },
    { t: 90, x: 0.505, y: 0.5 },
    { t: 120, x: 0.5, y: 0.5 },
  ];
  const kept = shakeFilter(jitter);
  assert.ok(kept.length < jitter.length, `nothing dropped of ${jitter.length}`);
  assert.deepEqual(kept[0], jitter[0]);
  assert.deepEqual(kept[kept.length - 1], jitter[jitter.length - 1]);
  const real = [
    { t: 0, x: 0.2, y: 0.5 },
    { t: 30, x: 0.4, y: 0.5 },
    { t: 60, x: 0.2, y: 0.5 },
  ];
  assert.deepEqual(shakeFilter(real), real);
  const slow = [
    { t: 0, x: 0.5, y: 0.5 },
    { t: 200, x: 0.505, y: 0.5 },
    { t: 400, x: 0.5, y: 0.5 },
  ];
  assert.deepEqual(shakeFilter(slow), slow, "a reversal slower than the window is not shake");
});

test("keystrokes group into one growing chip and a named key stays its own", () => {
  const typed: CastSession = {
    viewport,
    durationMs: 3000,
    events: [
      { t: 0, kind: "key", text: "h" },
      { t: 80, kind: "key", text: "e" },
      { t: 160, kind: "key", text: "l" },
      { t: 240, kind: "key", text: "l" },
      { t: 320, kind: "key", text: "o" },
      { t: 700, kind: "key", text: "Enter" },
    ],
  };
  const at = (ms: number) => keystrokeChips(typed, ms).map((c) => c.text);
  assert.deepEqual(at(100), ["he"]);
  assert.deepEqual(at(800), ["hello", "⏎"]);
  /* "hello" lingers 800 ms past its last key, then fades 150 ms; Enter is still up. */
  assert.deepEqual(at(1119), ["hello", "⏎"]);
  assert.deepEqual(at(1271), ["⏎"]);
  assert.deepEqual(at(2000), []);
  const chips = keystrokeChips(typed, 10);
  assert.equal(chips[0].fade < 1, true, "fading in");
  assert.ok(chips[0].bounce < 0 && chips[0].bounce >= -MOTION_PRESETS.keys.bouncePx);
  assert.equal(keystrokeChips(typed, 500)[0].fade, 1);
});

test("a typed burst spreads its characters at the recorder's delay, and a shortcut gets glyphs", () => {
  const burst: CastSession = {
    viewport,
    durationMs: 3000,
    events: [
      { t: 0, kind: "key", text: "hello" },
      { t: 1500, kind: "key", text: "Meta+k" },
      { t: 1600, kind: "key", text: "Shift+Enter" },
    ],
  };
  const at = (ms: number) => keystrokeChips(burst, ms).map((c) => c.text);
  assert.deepEqual(at(100), ["he"]);
  assert.deepEqual(at(300), ["hello"]);
  assert.deepEqual(at(1650), ["⌘K", "⇧⏎"]);
  assert.equal(keystrokeChips(burst, 1650, { maxChips: 1 }).length, 1);
});

test("the chip row lays out from the caption size with Cap's proportions", () => {
  const cap = 72;
  const l = keystrokeLayout(FORMATS.h, cap);
  assert.equal(l.x, 960);
  assert.equal(l.y, 1080 * 0.85);
  assert.equal(l.fontSize, cap * MOTION_PRESETS.keys.fontFactor);
  assert.equal(l.padding, l.fontSize * 0.45);
  assert.equal(l.radius, l.fontSize * 0.5);
  assert.equal(l.gap, 15);
  const boxed = keystrokeLayout(FORMATS.v, cap, { box: { width: 900, height: 540 }, position: "above-captions" });
  assert.equal(boxed.x, 450);
  assert.equal(boxed.y, 540 * 0.75);
  assert.equal(boxed.gap, 7.5);
});

/* 4 s at 25 fps: frozen everywhere except a burst of motion in frames 10-20. */
const ydif = Array.from({ length: 100 }, (_, i) => (i >= 10 && i <= 20 ? 5 : 0));

test("idle needs BOTH frozen pixels and no input, and respects the margins", () => {
  const still = idleSegments({ ydif, fps: 25, events: [] });
  assert.equal(still.length, 1);
  /* frames 21..99 → 840..4000 ms, shrunk by the 200 ms margin on each side. */
  assert.deepEqual(still[0], { fromMs: 1040, toMs: 3800 });

  const moving = idleSegments({ ydif: ydif.map(() => 5), fps: 25, events: [] });
  assert.equal(moving.length, 0, "moving pixels are never idle");

  const busy = idleSegments({
    ydif,
    fps: 25,
    events: [
      { t: 0, kind: "move", x: 0, y: 0 },
      { t: 4000, kind: "move", x: 500, y: 500 },
    ],
  });
  assert.equal(busy.length, 0, "a glide in progress is never idle, even over frozen pixels");
});

test("an idle segment never overlaps a click or a mark, and the short leftovers are dropped", () => {
  const segments = idleSegments({ ydif, fps: 25, events: [{ t: 3500, kind: "click", x: 1, y: 1 }] });
  assert.equal(segments.length, 1);
  assert.ok(segments[0].toMs <= 3500 - MOTION_PRESETS.idle.inputGapMs, `runs into the click: ${segments[0].toMs}`);
  assert.ok(segments[0].fromMs >= 1040);
  const marked = idleSegments({ ydif, fps: 25, events: [{ t: 2000, kind: "mark", name: "x" }] }, { minMs: 300 });
  assert.equal(marked.length, 2);
  assert.ok(marked[0].toMs < 2000 && marked[1].fromMs > 2000);
  /* readyMs: the blank head is skipped by the cast and is never a segment. */
  const head = idleSegments({ ydif: ydif.map(() => 0), fps: 25, events: [], readyMs: 2000 });
  assert.equal(head.length, 1);
  assert.ok(head[0].fromMs >= 2000);
});

test("the speed map is monotonic, continuous, and invertible", () => {
  const map = speedMap([{ fromMs: 1000, toMs: 2000 }, { fromMs: 3000, toMs: 3500 }], 4, 5000);
  assert.equal(timelineLength(map), 5000 - 750 - 375);
  let last = -1;
  for (let t = 0; t <= timelineLength(map) + 100; t += 1) {
    const s = sourceAt(map, t);
    assert.ok(s >= last, `went backwards at ${t}`);
    assert.ok(s - last <= 4 + 1e-9, `jumped ${s - last} at ${t}`);
    last = s;
  }
  assert.equal(sourceAt(map, 0), 0);
  assert.equal(sourceAt(map, 1000), 1000);
  assert.equal(sourceAt(map, 1250), 2000);
  assert.equal(sourceAt(map, 99_999), 5000);
  for (const s of [0, 500, 1500, 2999, 3200, 4999]) {
    assert.ok(Math.abs(timelineAt(map, sourceAt(map, timelineAt(map, s))) - timelineAt(map, s)) < 1e-9);
  }
  assert.throws(() => speedMap([], 0, 1000));
});

test("chained zooms pan between near moments and release from far ones", () => {
  const near = chainZooms(
    [
      { frame: 60, fx: 0.2, fy: 0.3, kind: "click" },
      { frame: 90, fx: 0.7, fy: 0.6, kind: "click" },
    ],
    FPS,
  );
  assert.deepEqual(near.map((l) => l.kind), ["zoom", "pan", "zoom", "release"]);
  const [first, pan, second] = near;
  assert.equal(pan.from, first.to);
  assert.equal(second.from, pan.to);
  assert.equal(second.attack, 0, "entered by the pan, already in");
  assert.ok(first.attack > 0);
  assert.equal(pan.fx, 0.7);
  assert.ok(pan.to <= 90, "the pan has landed by the next moment");
  for (const l of near) assert.ok(l.to > l.from, `${l.kind} has no duration`);

  const far = chainZooms(
    [
      { frame: 60, fx: 0.2, fy: 0.3, kind: "click" },
      { frame: 400, fx: 0.7, fy: 0.6, kind: "scroll" },
    ],
    FPS,
  );
  assert.deepEqual(far.map((l) => l.kind), ["zoom", "release", "zoom", "release"]);
  assert.ok(far[2].attack > 0 && far[2].from < 400 && far[2].to > 400);
  assert.equal(far[2].on, "scroll");
  assert.equal(far[1].to - far[1].from, Math.round((MOTION_PRESETS.zoom.transitionMs / 1000) * FPS));
});
