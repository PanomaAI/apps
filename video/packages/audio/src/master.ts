/*
  Loudness normalization to what every platform normalizes to: -14 LUFS, -1 dBTP.
  What comes out of the renderer measures around -23 LUFS — the sum of three cautious
  levels is one quiet video, and a quiet video next to the previous one in the feed
  reads as broken, not gentle. The video stream is copied untouched: re-encoding
  frames to adjust audio is quality thrown away for nothing.

  The gain is applied BY HAND, not by loudnorm's second pass. loudnorm honours
  `linear=true` only when the measured true peak plus the gain stays under the target
  ceiling; otherwise it silently switches to its dynamic mode, which compresses the
  programme to reach the target. A procedural bed peaks at -6 dBFS and sits near
  -20 LUFS, so its +6 dB of gain always predicts a peak above -1 dBTP, and every
  automatic master used to take the dynamic path while the header here promised a
  linear one. So loudnorm is used for what it is good at — the measurement — and the
  gain is one `volume` filter followed by a limiter that holds the ceiling. A dry run
  measures what the limiter took, and the gain is corrected once, so the file lands on
  -14 whether or not the limiter worked.
*/
import { execFile } from "node:child_process";
import { rename } from "node:fs/promises";
import { promisify } from "node:util";
import { aac, FFMPEG } from "@panoma/video-codec";

const run = promisify(execFile);
export const TARGET = { I: -14, TP: -1.0, LRA: 11 };
/** What the master re-encodes at; which AAC encoder does it is the codec module's call. */
const AAC_BITRATE = 256_000;
/*
  A sample-peak limiter sits under an oversampled true peak by a few tenths (ITU-R
  BS.1770-4 measures at 4x), so the ceiling is -1.6 dBFS to land under -1.0 dBTP
  (AES TD1004 asks for -1.0 dBTP).
*/
export const CEILING_DBFS = -1.6;
/*
  ...but the gap between a sample peak and a true one is a property of the MATERIAL, not
  a constant. universend's narrated tutorial overshot -1.6 dBFS by 0.9 dB and failed the
  gate at -0.7 dBTP. So the overshoot is measured on the file and the ceiling lowered by
  exactly that much, plus this, which is the resolution loudnorm reports at.
*/
const TP_MARGIN_DB = 0.1;
/* And a floor, because a ceiling this low is a mix problem the gain cannot fix. */
const CEILING_FLOOR_DBFS = -6;
/* The correction after the dry run is bounded: a limiter that ate more than this is a mix problem, not a gain problem. */
const MAX_CORRECTION_DB = 3;
/* The encoded true peak is chased down in steps of at least this, and this many times. */
const MIN_PEAK_STEP_DB = 0.5;
const MAX_PEAK_PASSES = 4;

async function ffmpeg(args: string[]): Promise<string> {
  const { stderr, stdout } = await run(FFMPEG, args, { maxBuffer: 32 * 1024 * 1024 });
  return `${stderr ?? ""}${stdout ?? ""}`;
}

export async function loudness(path: string): Promise<string | undefined> {
  const out = await ffmpeg(["-v", "info", "-i", path, "-af", "ebur128=framelog=quiet", "-f", "null", "-"]);
  return /I:\s+(-?\d+\.\d+) LUFS/.exec(out)?.[1];
}

/** Integrated loudness and true peak of the file after `chain`, from loudnorm's own measurement. */
async function measure(path: string, chain: string): Promise<{ i: number; tp: number }> {
  const out = await ffmpeg([
    "-v", "info", "-i", path,
    "-af", `${chain}loudnorm=I=${TARGET.I}:TP=${TARGET.TP}:LRA=${TARGET.LRA}:print_format=json`,
    "-f", "null", "-",
  ]);
  const json = JSON.parse(out.slice(out.lastIndexOf("{"), out.lastIndexOf("}") + 1)) as { input_i: string; input_tp: string };
  return { i: Number.parseFloat(json.input_i), tp: Number.parseFloat(json.input_tp) };
}

/** The filter chain a master applies: one gain, then the ceiling. Exported for the test that measures it. */
export function masterChain(gainDb: number, ceilingDbfs: number = CEILING_DBFS): string {
  return `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${Math.pow(10, ceilingDbfs / 20).toFixed(4)}:attack=5:release=60:level=false`;
}

export async function master(path: string): Promise<void> {
  const first = await measure(path, "");
  /* Digital silence measures -inf: there is nothing to normalise, and the review's audio.silence says so. */
  if (!Number.isFinite(first.i)) return;
  let gain = TARGET.I - first.i;
  /* What the limiter leaves: when it works, the programme lands under the target, and one correction brings it back. */
  const dry = await measure(path, `${masterChain(gain)},`);
  if (Number.isFinite(dry.i)) gain += Math.max(-MAX_CORRECTION_DB, Math.min(MAX_CORRECTION_DB, TARGET.I - dry.i));

  /*
    The gain is settled; now the ceiling. It holds a SAMPLE peak and the platform measures
    a TRUE one, so what is left is the intersample overshoot — measured here on the file
    with its final gain, and given back to the ceiling. One pass, because lowering the
    ceiling can only lower the true peak.
  */
  let ceiling = CEILING_DBFS;
  const peak = await measure(path, `${masterChain(gain, ceiling)},`);
  if (Number.isFinite(peak.tp) && peak.tp > TARGET.TP) {
    ceiling = Math.max(CEILING_FLOOR_DBFS, ceiling - (peak.tp - TARGET.TP) - TP_MARGIN_DB);
  }

  /*
    The AAC encoder's ceiling is 96 kHz, and that is what every master carried until
    the review's audio row said so; 48 kHz is what the platforms ask for and what the
    engine mixes at. The remux also has to ask for faststart again — a copied stream
    keeps its bytes, not the container layout the encoder wrote.
  */
  const tmp = path.replace(/\.mp4$/, ".mastering.mp4");
  /*
    Every encode reads the ORIGINAL and writes the temporary file; the rename happens once,
    at the end. Encoding from `path` after `path` had already been replaced applied the
    whole gain a second time — a piece measured at -14.1 LUFS came back at -9.4, which is
    the loudest bug this file could have and it looked like a true-peak fix.
  */
  const encode = (at: number) =>
    ffmpeg(["-y", "-v", "error", "-i", path, "-af", masterChain(gain, at), "-c:v", "copy", ...aac(AAC_BITRATE).args, "-ar", "48000", "-movflags", "+faststart", tmp]);
  await encode(ceiling);

  /*
    And then measured again, on the file that was actually written.

    Every measurement in the chain above is of the FILTERED PCM, and what ships is AAC. A
    lossy codec reconstructs a waveform that is close to the original and not identical to
    it, and the difference shows up first at the peaks: measured here, a master the limiter
    had held at exactly -1.0 dBTP came back from the encoder at -0.9 and failed the gate
    the whole chain exists to pass. Predicting that overshoot from the ceiling is guesswork;
    measuring it is one pass, and it only ever needs one, because lowering a limiter can
    only lower a peak. Beyond the floor there is nothing left to give, and the review says
    so instead of this silently giving up loudness.
  */
  /*
    ...and it turned out to need more than one. A brought track is dense programme where
    a bed is not, and the AAC overshoot grew as the limiter worked harder: a spotlight
    cut mastered to -1.6 dBFS came back at -0.8 dBTP, the one correction of 0.3 dB landed
    it at -0.9, and the gate failed on a file the master had already given up on. So the
    ceiling is lowered by what was measured, never by less than half a decibel, until
    the encoded file is under the target or the floor is reached — four passes at most,
    which at half a decibel each is the whole distance from the ceiling to the floor.
  */
  for (let pass = 0; pass < MAX_PEAK_PASSES; pass++) {
    const encoded = await measure(tmp, "");
    /* Diagnostics on stderr only (stdout is the MCP transport): PANOMA_VIDEO_MASTER_DEBUG=1 panoma-video master <file>. */
    if (process.env.PANOMA_VIDEO_MASTER_DEBUG) console.error(`[master] ${path}: gain ${gain.toFixed(2)} dB · ceiling ${ceiling.toFixed(2)} dBFS · encoded ${encoded.i} LUFS ${encoded.tp} dBTP`);
    if (!Number.isFinite(encoded.tp) || encoded.tp <= TARGET.TP || ceiling <= CEILING_FLOOR_DBFS) break;
    ceiling = Math.max(CEILING_FLOOR_DBFS, ceiling - Math.max(MIN_PEAK_STEP_DB, encoded.tp - TARGET.TP + TP_MARGIN_DB));
    await encode(ceiling);
  }
  await rename(tmp, path);
}