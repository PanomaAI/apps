/*
  The clips the review tests measure, generated with ffmpeg's lavfi sources at test
  time: no binary lives in the repository. Every clip is 320x180 at 24 fps and at
  most 5 s so the whole suite stays under a few seconds of encoding. Each one is a
  named failure the gate must catch, plus one clean clip it must let through.
*/
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const FFMPEG = process.env.PANOMA_VIDEO_FFMPEG ?? "ffmpeg";
const SIZE = "size=320x180:rate=24";
const H264 = ["-c:v", "libx264", "-pix_fmt", "yuv420p"];
/* The colour tags every platform table asks for; the clean clip carries them. With
   ffmpeg 9 the output options alone left primaries and transfer "unknown" in the
   stream; libx264 writes what the frames carry, so setparams stamps the frames too. */
const BT709 = ["-vf", "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"];
const AAC = ["-c:a", "aac", "-b:a", "192k", "-ac", "2"];

function ffmpeg(args: string[]): void {
  execFileSync(FFMPEG, ["-y", "-hide_banner", "-nostdin", "-loglevel", "error", ...args], { stdio: ["ignore", "ignore", "pipe"] });
}

const lavfi = (graph: string) => ["-f", "lavfi", "-i", graph];
const concat = (n: number) => ["-filter_complex", `${Array.from({ length: n }, (_, i) => `[${i}:v]`).join("")}concat=n=${n}:v=1:a=0[v]`, "-map", "[v]"];

export type Clips = Record<
  "clean" | "noFaststart" | "black" | "frozen" | "strobe" | "exempt" | "silent" | "hot" | "cuts" | "gap" | "lead",
  string
>;

/** Write every clip into `dir` and return their absolute paths. */
export function makeClips(dir: string): Clips {
  const at = (name: string) => join(dir, `${name}.mp4`);
  const clips: Clips = {
    clean: at("clean"),
    noFaststart: at("no-faststart"),
    black: at("black"),
    frozen: at("frozen"),
    strobe: at("strobe"),
    exempt: at("exempt"),
    silent: at("silent"),
    hot: join(dir, "hot.mov"),
    cuts: at("cuts"),
    gap: at("gap"),
    lead: at("lead"),
  };

  /* A sine at the source's default level measures -21.8 LUFS; +8 dB lands it at the
     -14 the master step targets, with a true peak around -8 dBTP. */
  ffmpeg([...lavfi(`testsrc2=${SIZE}:duration=4`), ...lavfi("sine=frequency=440:sample_rate=48000:duration=4"), "-af", "volume=8dB", ...H264, ...BT709, ...AAC, "-movflags", "+faststart", clips.clean]);
  ffmpeg([...lavfi(`testsrc2=${SIZE}:duration=1`), ...H264, clips.noFaststart]);
  ffmpeg([...lavfi(`testsrc2=${SIZE}:duration=1.5`), ...lavfi(`color=black:${SIZE}:duration=1`), ...lavfi(`testsrc2=${SIZE}:duration=1.5`), ...concat(3), ...H264, clips.black]);
  ffmpeg([...lavfi(`testsrc2=${SIZE}:duration=1`), ...lavfi(`color=gray:${SIZE}:duration=2`), ...lavfi(`testsrc2=${SIZE}:duration=1`), ...concat(3), ...H264, clips.frozen]);
  /* geq over N: white and black alternate every frame (12 flashes a second), or every
     twelve frames (one flash a second, leading edges 24 frames apart — exempt). */
  ffmpeg([...lavfi(`color=black:${SIZE}:duration=2,geq=lum='if(mod(N\\,2)\\,235\\,16)':cb=128:cr=128`), ...H264, clips.strobe]);
  ffmpeg([...lavfi(`color=black:${SIZE}:duration=2,geq=lum='if(mod(floor(N/12)\\,2)\\,235\\,16)':cb=128:cr=128`), ...H264, clips.exempt]);
  ffmpeg([...lavfi(`testsrc2=${SIZE}:duration=2`), ...H264, clips.silent]);
  /* +20 dB on a sine, forced through 16-bit: the conversion clips the wave flat and
     the inter-sample peaks of the result sit above full scale. PCM in a .mov, because
     ffmpeg's own AAC encoder quietly attenuates a signal that would clip — the one
     fixture that must stay hot cannot go through it. */
  ffmpeg([...lavfi(`testsrc2=${SIZE}:duration=3`), ...lavfi("sine=frequency=440:sample_rate=48000:duration=3"), "-af", "volume=20dB,aformat=sample_fmts=s16", ...H264, "-c:a", "pcm_s16le", clips.hot]);
  ffmpeg([...lavfi(`color=red:${SIZE}:duration=1`), ...lavfi(`color=blue:${SIZE}:duration=1`), ...lavfi(`color=green:${SIZE}:duration=1`), ...lavfi(`color=yellow:${SIZE}:duration=1`), ...concat(4), ...H264, clips.cuts]);
  ffmpeg([...lavfi(`testsrc2=${SIZE}:duration=4`), ...lavfi("sine=frequency=440:sample_rate=48000:duration=4"), "-af", "volume=8dB,volume=enable='between(t\\,1.5\\,3)':volume=0", ...H264, ...AAC, clips.gap]);
  ffmpeg([...lavfi(`testsrc2=${SIZE}:duration=3`), ...lavfi("sine=frequency=440:sample_rate=48000:duration=3"), "-af", "volume=8dB,volume=enable='lt(t\\,0.8)':volume=0", ...H264, ...AAC, clips.lead]);
  return clips;
}
