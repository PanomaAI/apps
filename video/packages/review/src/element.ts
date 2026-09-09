/*
  Whether an element's ground is really flat, and what to do when it is not.

  An element is composited with a blend that makes its background disappear — `screen` drops
  black, `multiply` drops white — and both of those are arithmetic, not intent. Screen adds
  the element's value to the page, so a "black" background sitting at 40 out of 255 does not
  vanish: it lifts the entire interface underneath by sixteen per cent, evenly, which looks
  exactly like a badly exported video and nothing like an effect.

  This is not hypothetical. The first element bought here LOOKED black in every frame and
  measured a mean luma of 40 with only 17% of its pixels at true black. It would have washed
  the product grey for the whole beat it was on screen.

  So the pipeline for an element is buy → CRUSH → measure → keep, and the measure is what
  decides. `crush` remaps the ground's own end of the range to the limit, which is a levels
  adjustment and the standard first step for any stock element; on that same clip it moved
  true black from 17% to 83%.
*/
import { h264Intermediate } from "@panoma/video-codec";
import { FFMPEG, ffmpegBlocks, run } from "./exec.ts";

/*
  How far from the ground a pixel may sit and still count as ground.

  Sixteen of 255 is about six per cent, which is under the threshold where a flat lift
  becomes visible against a bright interface and comfortably above the noise a video codec
  leaves in a flat field.
*/
export const GROUND_TOLERANCE = 16;

/*
  The share of the frame that must BE the ground for an element to be usable.

  Two thirds, and it is a floor rather than a target: an element is matter with space around
  it, and one that fills its frame has nothing left to disappear. The measured library sits
  well above this after crushing; the pre-crush clip that started all of this sat at 17%.
*/
export const GROUND_FLOOR = 0.6;

export type GroundReport = {
  /** Share of pixels within tolerance of the ground, per frame, worst first. */
  flat: number;
  /** Mean luma over the clip: what a screen blend would add, or a multiply would keep. */
  mean: number;
  ok: boolean;
  say: string;
};

/**
 * Measure how much of an element is actually its ground.
 *
 * Decoded small and grey: this is a question about a flat field, and a flat field is flat at
 * any resolution. It costs a fraction of a second per clip, which matters because it runs on
 * every element of a library rather than once.
 */
export async function groundOf(file: string, ground: "black" | "white"): Promise<GroundReport> {
  const w = 160;
  const h = 90;
  const n = w * h;
  /*
    Streamed as raw blocks rather than captured as a string. `run` decodes its child's
    stdout as UTF-8, which silently mangles every byte over 0x7F — so a luma of 200 comes
    back as a replacement character and every measurement here would be fiction.
  */
  let worst = 1;
  let total = 0;
  let frames = 0;
  await ffmpegBlocks(
    ["-i", file, "-vf", `scale=${w}:${h},format=gray`, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    n,
    (block) => {
      let onGround = 0;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const v = block[i];
        sum += v;
        if (ground === "black" ? v <= GROUND_TOLERANCE : v >= 255 - GROUND_TOLERANCE) onGround++;
      }
      total += sum / n;
      worst = Math.min(worst, onGround / n);
      frames++;
    },
  ).catch(() => undefined);
  if (frames === 0) return { flat: 0, mean: 0, ok: false, say: `${file} could not be decoded` };
  const mean = total / frames;
  const ok = worst >= GROUND_FLOOR;
  return {
    flat: worst,
    mean,
    ok,
    say: ok
      ? `${(worst * 100).toFixed(0)}% of its busiest frame is ${ground}, so the blend has something to drop`
      : `only ${(worst * 100).toFixed(0)}% of its busiest frame is ${ground} (mean luma ${mean.toFixed(0)}/255); composited it would ${ground === "black" ? "lift" : "muddy"} the whole interface underneath`,
  };
}

/**
 * Crush an element's ground to the limit, and write the version that gets used.
 *
 * A levels adjustment, not a curve: everything at or below the input floor goes to the
 * ground exactly, and everything above it is stretched back over the full range so the
 * matter keeps its brightness. It is the first thing anyone does to a stock element, and
 * skipping it is what makes a composite look like a video pasted on a video.
 */
export async function crushGround(input: string, output: string, ground: "black" | "white", amount = 0.22): Promise<string> {
  const levels =
    ground === "black"
      ? `colorlevels=rimin=${amount}:gimin=${amount}:bimin=${amount}:romin=0:gomin=0:bomin=0`
      : `colorlevels=rimax=${1 - amount}:gimax=${1 - amount}:bimax=${1 - amount}:romax=1:gomax=1:bomax=1`;
  await run(FFMPEG, [
    "-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-y",
    "-i", input,
    "-vf", levels,
    /* Re-encoded rather than filtered at play time: this runs once, and every render after it is free.
       Near-transparent quality rather than a rate, since nothing downstream measures this file. */
    ...h264Intermediate().args, "-pix_fmt", "yuv420p", "-an",
    output,
  ]);
  return output;
}
