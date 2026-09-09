import assert from "node:assert/strict";
import { test } from "node:test";
import { cubicBezier, easing, interpolate, spring } from "@panoma/video-engine/math";

test("interpolate maps, clamps, and extends", () => {
  assert.equal(interpolate(5, [0, 10], [0, 100]), 50);
  assert.equal(interpolate(-5, [0, 10], [0, 100], { extrapolateLeft: "clamp" }), 0);
  assert.equal(interpolate(15, [0, 10], [0, 100]), 150);
  assert.equal(interpolate(15, [0, 10], [0, 100], { extrapolateRight: "clamp" }), 100);
});

test("interpolate walks multi-segment ranges", () => {
  const ranges = { input: [0, 10, 20], output: [0, 100, 0] } as const;
  assert.equal(interpolate(5, ranges.input, ranges.output), 50);
  assert.equal(interpolate(15, ranges.input, ranges.output), 50);
  assert.equal(interpolate(20, ranges.input, ranges.output), 0);
});

test("interpolate rejects malformed ranges", () => {
  assert.throws(() => interpolate(1, [0], [0]));
  assert.throws(() => interpolate(1, [0, 10, 5], [0, 1, 2]), /strictly increase/);
});

test("cubicBezier hits its endpoints and stays in order", () => {
  const ease = cubicBezier(0.25, 0.1, 0.25, 1);
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  /* CSS `ease` reaches ~0.8 at halfway — a linear curve would read 0.5. */
  assert.ok(ease(0.5) > 0.7 && ease(0.5) < 0.9);
  let prev = -1;
  for (let t = 0; t <= 1.001; t += 0.01) {
    const y = ease(t);
    assert.ok(y >= prev - 1e-9, `not monotone at t=${t}`);
    prev = y;
  }
});

test("spring starts at rest and settles at the target", () => {
  assert.equal(spring({ frame: 0, fps: 30 }), 0);
  const settled = spring({ frame: 300, fps: 30 });
  assert.ok(Math.abs(settled - 1) < 0.01, `settled at ${settled}`);
});

test("a duration-scaled spring lands inside its window", () => {
  const config = { damping: 16, mass: 0.6 };
  const atEnd = spring({ frame: 10, fps: 30, config, durationInFrames: 10 });
  assert.ok(Math.abs(atEnd - 1) < 0.01, `at window end: ${atEnd}`);
});

test("the house easings are callable and bounded", () => {
  for (const fn of Object.values(easing)) {
    assert.equal(Math.round(fn(0) * 1000), 0);
    assert.equal(Math.round(fn(1) * 1000), 1000);
  }
});
