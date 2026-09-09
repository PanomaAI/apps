import assert from "node:assert/strict";
import { test } from "node:test";
import { integerBpms, makeGrid } from "@panoma/video-core";

test("the grid refuses tempos with fractional beats", () => {
  assert.throws(() => makeGrid({ bpm: 112, fps: 24 }), /12\.857|frames per beat/);
  assert.throws(() => makeGrid({ bpm: 113, fps: 30 }), /frames per beat/);
});

test("120 BPM is exact at both broadcast rates", () => {
  assert.equal(makeGrid({ bpm: 120, fps: 24 }).beatFrames, 12);
  assert.equal(makeGrid({ bpm: 120, fps: 30 }).beatFrames, 15);
});

test("bars count from the grid start", () => {
  const g = makeGrid({ bpm: 120, fps: 30, start: 127 });
  assert.equal(g.bar(0), 127);
  assert.equal(g.bar(2), 127 + 2 * 60);
  assert.equal(g.beat(3), 127 + 45);
});

test("integerBpms lists exactly the divisors", () => {
  for (const bpm of integerBpms(30)) assert.equal((30 * 60) % bpm, 0);
  assert.ok(integerBpms(24).includes(120));
  assert.ok(!integerBpms(24).includes(112));
});

test("the tick is the largest subdivision that exists in whole frames", () => {
  /* 120 BPM at 30 fps: a beat is 15 frames, so a HALF-beat is 7.5 and does not
     exist. Rounding it to 8 puts every accent built on it off the grid forever. */
  const g = makeGrid({ bpm: 120, fps: 30 });
  assert.equal(g.beatFrames, 15);
  assert.equal(g.tickFrames, 5);
  assert.ok(Number.isInteger(g.beatFrames / g.tickFrames));
  assert.deepEqual(g.subdivisions(), [15, 5, 3, 1]);

  const cinema = makeGrid({ bpm: 120, fps: 24 });
  assert.equal(cinema.beatFrames, 12);
  assert.equal(cinema.tickFrames, 6);
});

test("ticks count from the grid start like everything else", () => {
  const g = makeGrid({ bpm: 120, fps: 30, start: 60 });
  assert.equal(g.tick(0), 60);
  assert.equal(g.tick(3), 75);
  assert.equal(g.tick(3), g.beat(1));
});

test("a tempo conformed from a track is a whole number of frames, whatever the double says", () => {
  /* 1800 / (1800 / 14) is 13.999999999999998 in a double; the beat is 14 frames. */
  for (const n of [11, 12, 13, 14, 17, 19, 23]) {
    const grid = makeGrid({ bpm: 1800 / n, fps: 30 });
    assert.equal(grid.beatFrames, n);
  }
  assert.throws(() => makeGrid({ bpm: 1800 / 13.5, fps: 30 }));
});

test("a prime beat still gets an accent a viewer can see", () => {
  /* The owner's own track conforms to 138.46 BPM: 13 frames a beat at 30 fps, and 13 is
     prime, so the divisor rule alone answered a 1-frame tick — 33 ms, which is not an
     accent but the absence of one. Everything the tick times shrank by 5 to 15 times:
     the word cascade (step = tick * 2) ran a word every 2 frames instead of 10, and the
     bed was handed 13 hats a beat, which is a different instrument. */
  const g = makeGrid({ bpm: 1800 / 13, fps: 30 });
  assert.equal(g.beatFrames, 13);
  assert.equal(g.tickFrames, 4);
  assert.equal(g.ticksPerBeat, 3);
  /* Honest about it: 4 is not a subdivision of 13, because 13 has none. */
  assert.deepEqual(g.subdivisions(), [13, 1]);
  assert.equal(g.tick(3), g.start + 12);
});

test("no tempo the bed accepts gets a tick under three frames", () => {
  /* 40 to 240 BPM (the bed's bounds) is 45 down to 8 frames a beat at 30 fps. The
     divisor rule's own floor in that range is 3 frames (a 9-frame beat, 200 BPM); one
     frame only ever came out of a beat with no divisors at all. */
  for (let beatFrames = 8; beatFrames <= 45; beatFrames++) {
    const g = makeGrid({ bpm: 1800 / beatFrames, fps: 30 });
    assert.equal(g.beatFrames, beatFrames);
    assert.ok(g.tickFrames >= 3, `${beatFrames} frames a beat gave a ${g.tickFrames}-frame tick`);
    assert.ok(g.tickFrames <= beatFrames / 2, `${beatFrames} frames a beat gave a tick over half a beat`);
    /* What the bed divides a beat by: whole, or `renderBed` throws. */
    assert.ok(Number.isInteger(g.ticksPerBeat) && g.ticksPerBeat >= 1);
    if (beatFrames % g.tickFrames === 0) assert.equal(g.ticksPerBeat, beatFrames / g.tickFrames);
  }
});
