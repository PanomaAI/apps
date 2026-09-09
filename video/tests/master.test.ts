/*
  The master lands a file on -14 LUFS under -1 dBTP whether or not the limiter has to
  work. The case that matters is the one loudnorm's linear mode silently refuses: a
  procedural bed at -6 dBFS peak needs more gain than its peak allows, so the limiter
  engages and takes some loudness with it; the dry-run correction gives it back.
  Measured on the mp4, never the wav, because the AAC encode is where overs are born.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { writeBed, master, MASTER_TARGET } from "@panoma/video-audio";

const run = promisify(execFile);

async function measured(path: string): Promise<{ i: number; tp: number }> {
  const { stderr } = await run("ffmpeg", ["-v", "info", "-i", path, "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"], { maxBuffer: 16 * 1024 * 1024 });
  const json = JSON.parse(stderr.slice(stderr.lastIndexOf("{"), stderr.lastIndexOf("}") + 1)) as { input_i: string; input_tp: string };
  return { i: Number.parseFloat(json.input_i), tp: Number.parseFloat(json.input_tp) };
}

test("a procedural bed masters to -14 LUFS under -1 dBTP with the gain applied linearly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-master-"));
  try {
    const wav = join(dir, "bed.wav");
    writeBed({ bpm: 120, seconds: 6, style: "pulse", accents: [1, 3] }, wav);
    const mp4 = join(dir, "bed.mp4");
    await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:r=30:d=6", "-i", wav, "-c:v", "libx264", "-c:a", "aac", "-b:a", "192k", "-shortest", mp4]);
    const before = await measured(mp4);
    assert.ok(before.i < -17, `the bed starts quiet (${before.i.toFixed(1)} LUFS), which is the case the linear mode refuses`);
    await master(mp4);
    const after = await measured(mp4);
    assert.ok(Math.abs(after.i - MASTER_TARGET.I) <= 1, `integrated ${after.i.toFixed(1)} LUFS lands within 1 LU of ${MASTER_TARGET.I}`);
    assert.ok(after.tp <= MASTER_TARGET.TP, `true peak ${after.tp.toFixed(2)} dBTP stays under ${MASTER_TARGET.TP}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
