import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { analyseTrack, downbeatOf, envelopeAt, gridTempo, ENVELOPE_HZ } from "@panoma/video-audio";
import { clickTrack } from "./fixtures/click-track.ts";

/*
  A track nobody wrote: kicks every beat at 128 BPM, the bar's first kick louder, a
  hat between them, a noise floor, and the first beat 350 ms in. Every number the
  analysis returns can be checked against how the file was made.
*/
const BPM = 128;
const SECONDS = 30;
const OFFSET = 0.35;
const PERIOD = 60 / BPM;

const track = () => clickTrack({ bpm: BPM, seconds: SECONDS, offset: OFFSET });

const spreadOf = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
const meanOf = (xs: number[]) => xs.reduce((p, q) => p + q, 0) / xs.length;
const sdOf = (xs: number[]) => Math.sqrt(meanOf(xs.map((v) => (v - meanOf(xs)) ** 2)));

test("the analysis finds the tempo, every beat, the downbeat and the loudness of a known track", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-beat-"));
  try {
    const wav = join(dir, "click.wav");
    writeFileSync(wav, track());
    const a = await analyseTrack(wav);
    assert.ok(Math.abs(a.seconds - SECONDS) < 0.05, `duration ${a.seconds}`);
    assert.ok(Math.abs(a.bpm - BPM) < 0.3, `tempo ${a.bpm}`);
    const expected = Math.ceil((SECONDS - OFFSET) / PERIOD);
    assert.ok(Math.abs(a.beats.length - expected) <= 1, `${a.beats.length} beats for ${expected}`);
    /* Each beat within a frame at 30 fps of where the kick was written. */
    for (const s of a.beats) {
      const k = Math.round((s - OFFSET) / PERIOD);
      assert.ok(Math.abs(s - (OFFSET + k * PERIOD)) * 1000 < 25, `beat at ${s} is off`);
    }
    /* The louder kick every four beats is the downbeat, and the first beat is one. */
    assert.equal(a.downbeat, 0);
    /* Strength is relative: the strongest beat is 1, and the bar's first kicks are the strong ones. */
    assert.equal(a.strength.reduce((p, q) => Math.max(p, q), 0), 1);
    const firsts = a.strength.filter((_, i) => i % 4 === 0);
    const others = a.strength.filter((_, i) => i % 4 !== 0);
    assert.ok(meanOf(firsts) > meanOf(others), `downbeats ${meanOf(firsts)} vs others ${meanOf(others)}`);
    /* The envelopes are 0-1, at the documented rate, and the low band rises on a kick. */
    assert.equal(a.energy.length, a.low.length);
    assert.ok(Math.abs(a.energy.length / a.envelopeHz - SECONDS) < 0.1);
    assert.ok(a.energy.every((v) => v >= 0 && v <= 1));
    const onKick = envelopeAt(a, { head: 0, ratio: 1 }, OFFSET + 0.03).low;
    const between = envelopeAt(a, { head: 0, ratio: 1 }, OFFSET + PERIOD * 0.4).low;
    assert.ok(onKick > between * 1.5, `low ${onKick} on the kick vs ${between} between`);
    /* Same file, same numbers. */
    const again = await analyseTrack(wav);
    assert.deepEqual(again, a);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/*
  The three non-downbeat kicks of every bar are the same 12 ms of sine, written at the
  same gain: whatever the strength of a beat means, they must all get the same number.
  Sampled at one 11.6 ms frame of the onset envelope they did not — the flux peaks a
  frame either side of where the beat was quantised, and the 48 identical kicks of this
  track read 0.469 to 0.942 (spread 0.473, sd 0.1423), so the 2% punch varied at random
  from kick to kick. Read as the peak of the low band over the beat's frame ±2 they read
  0.522 to 0.550 (spread 0.028, sd 0.0088), and the quiet kick comes out at 0.549 of the
  loud one where the fixture wrote 0.55.
*/
test("kicks written identically get identical strengths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-beat-"));
  try {
    const wav = join(dir, "click.wav");
    writeFileSync(wav, track());
    const a = await analyseTrack(wav);
    assert.equal(a.downbeat, 0);
    const quiet = a.strength.filter((_, i) => i % 4 !== 0);
    const loud = a.strength.filter((_, i) => i % 4 === 0);
    assert.ok(spreadOf(quiet) < 0.06, `${quiet.length} identical kicks spread ${spreadOf(quiet).toFixed(3)}`);
    assert.ok(sdOf(quiet) < 0.02, `identical kicks sd ${sdOf(quiet).toFixed(4)}`);
    assert.ok(spreadOf(loud) < 0.06, `bar-first kicks spread ${spreadOf(loud).toFixed(3)}`);
    /* And the number means the gain that was written: 0.55 of a full kick, ±0.03. */
    assert.ok(Math.abs(meanOf(quiet) / meanOf(loud) - 0.55) < 0.03, `quiet/loud ${meanOf(quiet) / meanOf(loud)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/*
  A DJ mix, an album side, a long ambient piece. `Math.max(1e-9, ...Array.from(low))`
  spread one argument per envelope frame, and V8 takes 124,330 of them on Node 26.7
  before it throws "Maximum call stack size exceeded" — 24.1 minutes at 86.13 frames a
  second. auto.ts catches the throw and plays the procedural bed, so the owner's track
  went silently missing above about 24 minutes.

  This runs downbeatOf on the arrays a 25-minute track produces rather than on a
  25-minute track: the file would be 132 MB of WAV and 130,000 windowed FFTs, minutes of
  test for a limit that is V8's argument count and nothing else.
*/
test("a track past the old argument limit is still analysed", () => {
  const frames = 130_000;
  assert.ok(frames > 124_330, "the fixture must cross the limit it is testing");
  const onset = new Float64Array(frames);
  const low = new Float64Array(frames);
  const beats: number[] = [];
  const period = Math.round(0.5 * ENVELOPE_HZ);
  /* A frame is stamped at the centre of its 1024-sample window, two hops in, and the analysis reads beats back that way. */
  const CENTRE = 2;
  for (let i = 0, f = 0; f < frames - period; i++, f += period) {
    beats.push((f + CENTRE) / ENVELOPE_HZ);
    onset[f] = i % 4 === 1 ? 1 : 0.3;
    low[f] = i % 4 === 1 ? 1 : 0.2;
  }
  assert.ok(beats.length > 2500, `${beats.length} beats`);
  assert.equal(downbeatOf(beats, onset, low), 1);
});

/*
  The same failure, kept out by reading the source: an array handed to a call as its
  arguments throws above 124,330 of them, and nothing in the analysis or the score stage
  may do it again — every one of their arrays has a frame or a beat per element.
  `[...arr]`, `{ ...obj }` and a spread of a parenthesised conditional into an object are
  safe; a call is not. What this looks for is a `...` of a name that closes a parenthesis
  with no bracket or brace between.
*/
test("no array is spread into a call in the analysis or the score stage", () => {
  for (const file of ["packages/audio/src/beat.ts", "packages/director/src/music.ts"]) {
    const code = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const spread = code.match(/\.\.\.(?!\()[^;{}\]\n]*\)/);
    assert.ok(!spread, `${file} spreads into a call: ${spread?.[0]}`);
  }
});

test("a real tempo is conformed to the nearest integer frames per beat, and the stretch is small", () => {
  assert.deepEqual(gridTempo(120, 30), { bpm: 120, beatFrames: 15, ratio: 1 });
  const t = gridTempo(140, 30);
  assert.equal(t.beatFrames, 13);
  assert.ok(Math.abs(t.bpm - 138.4615) < 0.001);
  assert.ok(Math.abs(t.ratio - 0.989) < 0.001);
  /* The stretch is bounded by half a frame per beat: at most 4.2% — half a frame of twelve — up to 150 BPM at 30 fps. */
  for (let bpm = 90; bpm <= 160; bpm += 0.01) {
    const g = gridTempo(bpm, 30);
    assert.ok(Math.abs(g.ratio - 1) <= 0.5 / g.beatFrames + 1e-9, `${bpm} BPM stretches by ${g.ratio}`);
    if (bpm <= 150) assert.ok(Math.abs(g.ratio - 1) <= 0.042, `${bpm} BPM stretches by ${g.ratio}`);
  }
});

test("envelopeAt reads the original file through the head cut and the stretch", () => {
  const a = { seconds: 2, bpm: 120, beats: [], strength: [], downbeat: 0, energy: [0, 0.25, 0.5, 0.75, 1], low: [1, 0.75, 0.5, 0.25, 0], envelopeHz: 1 };
  assert.deepEqual(envelopeAt(a, { head: 0, ratio: 1 }, 2), { energy: 0.5, low: 0.5 });
  /* One second of head: video second 1 is file second 2. */
  assert.deepEqual(envelopeAt(a, { head: 1, ratio: 1 }, 1), { energy: 0.5, low: 0.5 });
  /* Played at twice the speed, video second 1 is file second 2. */
  assert.deepEqual(envelopeAt(a, { head: 0, ratio: 2 }, 1), { energy: 0.5, low: 0.5 });
  /* Past the end, the last value holds. */
  assert.deepEqual(envelopeAt(a, { head: 0, ratio: 1 }, 99), { energy: 1, low: 0 });
});
