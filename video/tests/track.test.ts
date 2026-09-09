import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { pulseOf, scoreTrack, TRACK_VERSION } from "@panoma/video-director";
import { makeGrid } from "@panoma/video-core";
import { clickTrack } from "./fixtures/click-track.ts";

const run = promisify(execFile);

/*
  A track at 140 BPM — the tempo of the piece this was built against — does not fit 30 fps:
  1800 / 140 is 12.86 frames a beat. The score stage must put it on 13 (138.46 BPM),
  which is a stretch of 1.1%, and after that beat n of the file must sit at frame 13n.
*/
const BPM = 140;
const OFFSET = 0.6;

async function rmsAround(path: string, seconds: number, half = 0.02): Promise<number> {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-ss", Math.max(0, seconds - half).toFixed(4), "-t", (half * 2).toFixed(4), "-i", path, "-ac", "1", "-f", "f32le", "-"], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  const buf = stdout as unknown as Buffer;
  const x = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  let e = 0;
  for (const v of x) e += v * v;
  return Math.sqrt(e / Math.max(1, x.length));
}

test("a brought track is analysed, cut to its first downbeat, stretched to the grid, and given a pulse in composition time", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-track-"));
  try {
    const src = join(dir, "own.wav");
    writeFileSync(src, clickTrack({ bpm: BPM, seconds: 24, offset: OFFSET }));
    const music = join(dir, "music");
    await mkdir(music, { recursive: true });
    const ws = { paths: { music } };

    const t = await scoreTrack(ws, src, 30);
    assert.equal(t.version, TRACK_VERSION);
    assert.equal(t.beatFrames, 13);
    assert.ok(Math.abs(t.bpm - 1800 / 13) < 1e-9);
    assert.ok(Math.abs(t.measured - BPM) < 0.3, `measured ${t.measured}`);
    assert.ok(Math.abs(t.ratio - 1800 / 13 / BPM) < 0.005, `ratio ${t.ratio}`);
    assert.ok(Math.abs(t.head - OFFSET) < 0.03, `head ${t.head}`);
    assert.ok(existsSync(t.file) && existsSync(t.pulse));
    /* The grid accepts the conformed tempo as it is written. */
    assert.equal(makeGrid({ bpm: t.bpm, fps: 30 }).beatFrames, 13);

    /* Beat n of the conformed file sits at n × 13 frames: a kick is there, and not a quarter beat later. */
    const period = 13 / 30;
    for (const n of [0, 4, 9, 20]) {
      const on = await rmsAround(t.file, n * period + 0.03);
      const off = await rmsAround(t.file, n * period + period * 0.4);
      assert.ok(on > off * 2, `beat ${n}: ${on} on the kick vs ${off} between`);
    }

    /* The pulse: one value per frame, beats on the grid, the first a downbeat, the loudness beside it. */
    const pulse = JSON.parse(readFileSync(t.pulse, "utf8")) as { fps: number; lufs?: number; energy: number[]; low: number[]; beats: { frame: number; strength: number; down: boolean }[] };
    assert.equal(pulse.fps, 30);
    assert.ok(Math.abs(pulse.energy.length / 30 - t.seconds) < 0.1);
    assert.equal(pulse.energy.length, pulse.low.length);
    assert.ok(pulse.beats.length > 40);
    assert.ok(pulse.beats.every((b, i) => b.frame === i * 13 && b.down === (i % 4 === 0)));
    assert.equal(Math.max(...pulse.beats.map((b) => b.strength)), 1);
    assert.ok(typeof pulse.lufs === "number" && pulse.lufs < 0);
    /* The low band rises on the kick frames. */
    const onKick = pulse.low[13 * 4] ?? 0;
    const between = pulse.low[13 * 4 + 5] ?? 0;
    assert.ok(onKick > between, `low ${onKick} on the kick vs ${between} after`);

    /* Second time, from disk: the same record, no new analysis. */
    const again = await scoreTrack(ws, src, 30);
    assert.deepEqual(again, t);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/*
  An intro is where the head cut used to land. The tracker chains beats through a pad at
  the exact period, so `beats[downbeat]` — always one of the first four beats — is inside
  it, and the film opened on the intro while the documentation promised the first
  downbeat. This fixture puts two bars of pad in front of the first kick, so the first
  downbeat is known by construction: 3.75 s, eight beats at 128 BPM.
*/
test("the head cut lands on the first downbeat that hits, not inside a quiet intro", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-intro-"));
  try {
    const bpm = 128;
    const firstKick = Math.round((8 * 60 * 1000) / bpm) / 1000;
    const src = join(dir, "intro.wav");
    writeFileSync(src, clickTrack({ bpm, seconds: 24, offset: firstKick, intro: true }));
    const music = join(dir, "music");
    await mkdir(music, { recursive: true });

    const t = await scoreTrack({ paths: { music } }, src, 30);
    assert.ok(Math.abs(t.head - firstKick) < 0.03, `head ${t.head} for a first kick at ${firstKick}`);
    /* A kick is at frame 0 of the conformed file, and the pad it was cut from is not there. */
    assert.ok((await rmsAround(t.file, 0.03)) > (await rmsAround(t.file, (13 / 30) * 0.4)) * 2, "no kick at the head of the conformed file");
    const pulse = JSON.parse(readFileSync(t.pulse, "utf8")) as { beats: { frame: number; strength: number; down: boolean }[] };
    assert.equal(pulse.beats[0]?.frame, 0);
    assert.equal(pulse.beats[0]?.down, true);
    /* The strengths belong to the beats that were kept: the first is a bar-first kick, not the pad's 0.002. */
    assert.ok((pulse.beats[0]?.strength ?? 0) > 0.5, `first beat strength ${pulse.beats[0]?.strength}`);
    assert.ok(pulse.beats.every((b) => b.strength > 0.1), "a pad beat survived into the pulse");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the pulse resolves the head cut and the stretch, so the render never sees them", () => {
  const analysis = {
    seconds: 4,
    bpm: 120,
    beats: [0.5, 1, 1.5, 2, 2.5, 3, 3.5],
    strength: [0.2, 1, 0.5, 0.5, 0.9, 0.5, 0.5],
    downbeat: 1,
    energy: Array.from({ length: 400 }, (_, i) => i / 399),
    low: Array.from({ length: 400 }, (_, i) => (i % 100 === 0 ? 1 : 0)),
    envelopeHz: 100,
  };
  /* Head 1 s (the first downbeat), untouched tempo: 15 frames a beat at 30 fps. */
  const p = pulseOf(analysis, { head: 1, ratio: 1, beatFrames: 15, fps: 30, seconds: 3 });
  assert.equal(p.energy.length, 90);
  /* Frame 0 is file second 1: energy 100/399. */
  assert.ok(Math.abs((p.energy[0] ?? 0) - 100 / 399) < 1e-9);
  assert.deepEqual(p.beats.slice(0, 3), [
    { frame: 0, strength: 1, down: true },
    { frame: 15, strength: 0.5, down: false },
    { frame: 30, strength: 0.5, down: false },
  ]);
  /* Sped up ×2: frame 30 (1 s of video) is file second 1 + 2 = 3. */
  const fast = pulseOf(analysis, { head: 1, ratio: 2, beatFrames: 15, fps: 30, seconds: 1.5 });
  assert.ok(Math.abs((fast.energy[30] ?? 0) - 300 / 399) < 1e-9);
});

/*
  A track shorter than the piece. The envelopes were read with the index clamped to the
  last frame, so two seconds of music under a four-second piece left the stage lights
  breathing at the track's last loudness over two seconds of silence. Past the end of the
  audio there is no loudness: the pulse is 0, and the beats stop where the beats stop.
*/
test("past the end of the track the pulse is silence, not the last value held", () => {
  const analysis = {
    seconds: 2,
    bpm: 120,
    beats: [0, 0.5, 1, 1.5],
    strength: [1, 0.5, 0.5, 0.5],
    downbeat: 0,
    /* One frame per composition frame at 30 fps, so a frame of the pulse is a frame of this. */
    energy: Array.from({ length: 60 }, () => 1),
    low: Array.from({ length: 60 }, () => 0.8),
    envelopeHz: 30,
  };
  const p = pulseOf(analysis, { head: 0, ratio: 1, beatFrames: 15, fps: 30, seconds: 4 });
  assert.equal(p.energy.length, 120);
  assert.ok(p.energy.slice(0, 60).every((v) => v === 1), "the track's own seconds keep their loudness");
  assert.ok(p.energy.slice(60).every((v) => v === 0), "the lights go out with the music");
  assert.ok(p.low.slice(60).every((v) => v === 0));
  assert.equal(p.beats.length, 4, "no beat is invented past the last one measured");
});
