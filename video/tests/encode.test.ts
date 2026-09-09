/*
  The delivered file, not the encoder's arguments. The case that decides the setting
  is a flat, still piece — a title card on a plain ground, which is most of a launch
  film's running time: a quality-targeted encode spends almost nothing on it, and the
  platform's own second encode is then left with too little to keep interface type
  legible. So the stream is constant-rate, and what is measured here is that a clip
  which compresses to nothing still leaves with its bits, correctly tagged.

  Six seconds of it, and the length is load-bearing. Rate control converges: it takes
  a few seconds of pictures before the stream sits on the number it was asked for, and
  every encoder walks up to it at its own pace. Measured here on this very card at
  5 Mbps — libx264 1,097 kbps short of it at a second and a half, 244 short at four
  seconds, 46 short at twenty; VideoToolbox 1,661 short, then 622, then 123. This test
  ran for a second and a half for as long as libx264 was the only encoder that could
  run it, which put it inside the ramp of the thing it was measuring and left it 145
  kbps from failing on the encoder it was written for. A deliverable out of this engine
  is twenty to forty-five seconds. Six is far enough up the curve to be that piece and
  short enough to stay a test.
*/
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { startEncoder } from "@panoma/video-engine/encoder";

const run = promisify(execFile);

async function probe(path: string): Promise<Record<string, string>> {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=pix_fmt,profile,color_primaries,color_transfer,color_space,avg_frame_rate,nb_frames",
    "-show_entries", "format=bit_rate,duration",
    "-of", "json",
    path,
  ]);
  const parsed = JSON.parse(stdout) as { streams: Record<string, string>[]; format: Record<string, string> };
  return { ...parsed.streams[0], ...parsed.format };
}

test("a flat, still piece leaves at the stream's own rate, tagged for the platforms", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-encode-"));
  try {
    /* A card: one light block on a dark ground, and not a pixel of it moves for a second and a half. */
    const card = join(dir, "card.png");
    await run("ffmpeg", [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "color=c=0x0b0b0f:s=720x1280",
      "-vf", "drawbox=x=60:y=520:w=600:h=240:color=0xf5f7fa:t=fill",
      "-frames:v", "1",
      card,
    ]);
    const png = await readFile(card);

    const out = join(dir, "card.mp4");
    const encoder = startEncoder({ out, fps: 30, durationInFrames: 180, audio: [], metadata: { comment: "panoma video test" } });
    for (let i = 0; i < 180; i++) await encoder.write(png);
    await encoder.finish();

    const v = await probe(out);
    const kbps = Number(v.bit_rate) / 1000;
    /*
      The floor is the whole point: at a quality target this clip measures in the
      tens of kbps. The ceiling is the same number from the other side — a constant
      rate that overshoots is not constant.
    */
    assert.ok(kbps > 4200 && kbps < 6400, `a still card is delivered at ${Math.round(kbps)} kbps`);
    assert.equal(v.pix_fmt, "yuv420p", "the pixel format every platform decodes");
    assert.equal(v.profile, "High");
    assert.equal(v.color_primaries, "bt709", "primaries are stated, never left unknown");
    assert.equal(v.color_transfer, "bt709");
    assert.equal(v.color_space, "bt709");
    assert.equal(v.avg_frame_rate, "30/1", "constant frame rate, as the stream declares");
    assert.equal(Number(v.nb_frames), 180, "every frame written is a frame delivered");
    assert.ok(Math.abs(Number(v.duration) - 6) < 0.05, `and the file lasts what it was asked for: ${v.duration} s`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a clip with a fade leaves quietly, and one without leaves as it came", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-encode-fade-"));
  try {
    const card = join(dir, "card.png");
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x0b0b0f:s=320x240", "-frames:v", "1", card]);
    const png = await readFile(card);
    /* Two seconds of a steady tone: any change in level is the fade's. */
    const tone = join(dir, "tone.wav");
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-ac", "2", tone]);

    const rmsAt = async (file: string, at: number): Promise<number> => {
      const { stdout } = await run("ffmpeg", ["-v", "error", "-ss", at.toFixed(3), "-t", "0.05", "-i", file, "-ac", "1", "-f", "f32le", "-"], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
      const buf = stdout as unknown as Buffer;
      const x = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
      let e = 0;
      for (const v of x) e += v * v;
      return Math.sqrt(e / Math.max(1, x.length));
    };

    const faded = join(dir, "faded.mp4");
    const a = startEncoder({ out: faded, fps: 30, durationInFrames: 45, audio: [{ path: tone, from: 0, volume: 0.5, fade: { in: 0.05, out: 0.5 } }] });
    for (let i = 0; i < 45; i++) await a.write(png);
    await a.finish();
    const plain = join(dir, "plain.mp4");
    const b = startEncoder({ out: plain, fps: 30, durationInFrames: 45, audio: [{ path: tone, from: 0, volume: 0.5 }] });
    for (let i = 0; i < 45; i++) await b.write(png);
    await b.finish();

    /* Mid-piece both are the tone at half gain; the faded one is well under it in its last tenth of a second and at its first. */
    const mid = await rmsAt(faded, 0.7);
    assert.ok(Math.abs(mid - (await rmsAt(plain, 0.7))) < mid * 0.1, "the fade leaves the middle alone");
    assert.ok((await rmsAt(faded, 1.42)) < mid * 0.35, "the last tenth of a second is faded");
    assert.ok((await rmsAt(plain, 1.42)) > mid * 0.8, "without a fade the tone is cut off at full level");
    assert.ok((await rmsAt(faded, 0.0)) < mid * 0.8, "the first fifty milliseconds ramp in");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an action clip stops at its own picture boundary, with its fade before its delay", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-encode-action-"));
  try {
    const card = join(dir, "card.png");
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x0b0b0f:s=320x240", "-frames:v", "1", card]);
    const png = await readFile(card);
    const tone = join(dir, "tone.wav");
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=2", tone]);
    const out = join(dir, "action.mp4");
    const encoder = startEncoder({ out, fps: 30, durationInFrames: 30, audio: [{ path: tone, from: 6, durationInFrames: 12, volume: 0.6, fade: { in: 0.04, out: 0.15 } }] });
    for (let i = 0; i < 30; i++) await encoder.write(png);
    await encoder.finish();
    const { stdout } = await run("ffmpeg", ["-v", "error", "-i", out, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { encoding: "buffer", maxBuffer: 1024 * 1024 });
    const pcm = stdout as unknown as Buffer;
    const rms = (from: number, to: number) => {
      let energy = 0;
      let count = 0;
      for (let i = Math.round(from * 48000); i < Math.round(to * 48000); i++) {
        const value = pcm.readFloatLE(i * 4);
        energy += value * value; count++;
      }
      return Math.sqrt(energy / count);
    };
    const middle = rms(0.29, 0.38);
    assert.ok(middle > 0.03, "the gesture is audible at its scheduled time");
    assert.ok(rms(0.02, 0.15) < middle * 0.01, "silence before the delayed action");
    assert.ok(rms(0.54, 0.58) < middle * 0.4, "the release precedes the action's own end");
    assert.ok(rms(0.69, 0.90) < middle * 0.01, "the rest of the original file does not leak onto the next shot");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
