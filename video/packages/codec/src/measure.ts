/*
  What each encoder on this machine actually does, measured rather than assumed.

  This file exists because of a specific mistake. `h264_mf` was written into the table on
  the strength of reading about it, and the reasoning that made it feel safe — an ffmpeg
  without the encoder falls back on its own — covered the wrong failure. Media Foundation
  was there; the arguments were wrong. `-profile:v high` is a name, and that option on
  that encoder wants a number, so every encode failed instantly and the Windows suite sat
  for eighty-six minutes waiting for a file that could not be written.

  So: nothing goes into the table in `index.ts` that has not been through here on the
  system it claims to serve. It runs the candidates side by side on a card of the kind
  this engine actually delivers and prints what each one did — whether it ran at all, how
  long it took, whether it held the rate, and whether the stream is the shape the platform
  tables ask for.

      node packages/codec/src/measure.ts

  It is a hand-run instrument, not part of the library: nothing imports it, and it is the
  only file here that prints.
*/
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aacArgs, encoders, FFMPEG, FFPROBE, h264Args } from "./index.ts";

/* The piece that decides: flat ground, hard-edged block, six seconds — past the ramp. */
const SIZE = "1080x1920";
const SECONDS = 6;
const FPS = 30;
const RATE = 5_000_000;
const AUDIO_RATE = 256_000;

type Variant = { label: string; args: string[] };

/*
  Candidates, and for the ones this project does not ship yet, the spellings worth
  trying. `h264_mf`'s profile is an integer — 66 baseline, 77 main, 100 high — which is
  the whole reason this file is here.
*/
function videoVariants(name: string): Variant[] {
  if (name === "h264_mf") {
    return [
      { label: "h264_mf  as shipped (profile:v high)", args: h264Args(name, RATE) },
      { label: "h264_mf  profile:v 100", args: ["-c:v", name, "-profile:v", "100", "-b:v", String(RATE), "-rate_control", "cbr"] },
      { label: "h264_mf  no profile", args: ["-c:v", name, "-b:v", String(RATE), "-rate_control", "cbr"] },
      { label: "h264_mf  no rate_control", args: ["-c:v", name, "-b:v", String(RATE)] },
    ];
  }
  return [{ label: `${name}  as shipped`, args: h264Args(name, RATE) }];
}

function run(args: string[]): void {
  execFileSync(FFMPEG, ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", ...args], {
    stdio: ["ignore", "ignore", "pipe"],
    encoding: "utf8",
  });
}

function probe(file: string, stream: "v" | "a", entries: string): string {
  return execFileSync(
    FFPROBE,
    ["-v", "error", "-select_streams", `${stream}:0`, "-show_entries", `stream=${entries}`, "-of", "compact=p=0:nk=1", file],
    { encoding: "utf8" },
  ).trim();
}

function first(error: unknown): string {
  const text = error instanceof Error ? ((error as { stderr?: string }).stderr ?? error.message) : String(error);
  return text.split("\n").filter((l) => l.trim().length > 0).slice(-1)[0]?.slice(0, 96) ?? "failed";
}

function main(): void {
  const have = encoders();
  const dir = mkdtempSync(join(tmpdir(), "panoma-video-measure-"));
  const source = `color=c=0x0b0b0f:s=${SIZE}:r=${FPS}`;
  const box = "drawbox=x=60:y=520:w=600:h=240:color=0xf5f7fa:t=fill";

  try {
    console.log(`\n${FFMPEG} on ${process.platform}, ${have.size} encoders. A ${SECONDS} s ${SIZE} card at ${RATE / 1_000_000} Mbps.\n`);
    console.log(`${"variant".padEnd(38)} ${"took".padStart(7)} ${"kbps".padStart(7)}  profile / pix_fmt`);

    for (const name of ["libx264", "h264_videotoolbox", "h264_mf"]) {
      if (!have.has(name)) {
        console.log(`${name.padEnd(38)}       —        —  not in this ffmpeg`);
        continue;
      }
      for (const variant of videoVariants(name)) {
        const out = join(dir, "v.mp4");
        const began = process.hrtime.bigint();
        try {
          run(["-f", "lavfi", "-i", source, "-vf", box, "-t", String(SECONDS), ...variant.args, "-pix_fmt", "yuv420p", "-an", out]);
          const took = Number(process.hrtime.bigint() - began) / 1e9;
          const kbps = Math.round((statSync(out).size * 8) / SECONDS / 1000);
          console.log(`${variant.label.padEnd(38)} ${took.toFixed(1).padStart(6)}s ${String(kbps).padStart(7)}  ${probe(out, "v", "profile,pix_fmt")}`);
        } catch (error) {
          console.log(`${variant.label.padEnd(38)}  FAILED           ${first(error)}`);
        }
      }
    }

    console.log("");
    for (const name of ["aac", "aac_at", "aac_mf"]) {
      if (!have.has(name)) {
        console.log(`${name.padEnd(38)}       —        —  not in this ffmpeg`);
        continue;
      }
      const out = join(dir, "a.m4a");
      const began = process.hrtime.bigint();
      try {
        run(["-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${SECONDS}`, ...aacArgs(name, AUDIO_RATE), "-ar", "48000", "-ac", "2", out]);
        const took = Number(process.hrtime.bigint() - began) / 1e9;
        console.log(`${name.padEnd(38)} ${took.toFixed(1).padStart(6)}s ${String(Math.round((statSync(out).size * 8) / SECONDS / 1000)).padStart(7)}  ${probe(out, "a", "codec_name,profile,sample_rate,bit_rate")}`);
      } catch (error) {
        console.log(`${name.padEnd(38)}  FAILED           ${first(error)}`);
      }
    }
    console.log("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
