/*
  Which encoder writes the file.

  ffmpeg itself is never bundled — libx264 makes that binary GPL, so it is invoked as a
  subprocess off PATH, and `packages/review/src/exec.ts` holds that boundary. This
  module decides which of the encoders the binary offers actually runs.

  The rule: where the operating system ships an H.264 and an AAC encoder of its own,
  and where somebody has measured that it is fit to use, use it. That is macOS today —
  VideoToolbox and AudioToolbox. There are two reasons, and the measured one comes
  first: on a real 19 s 1080x1920 deliverable, h264_videotoolbox held 4.87 Mbps against
  libx264's 4.95 and spent 1.7 s of CPU against 11.4. The same file for a sixth of the
  work, on the machine the render is already waiting on.

  The second reason is that AVC and AAC are patented separately from whoever wrote the
  source code, and a codec the machine came with was licensed by whoever sold the
  machine. Calling it ships no encoder of ours. `docs/codecs.md` records what that does
  and does not settle.

  The fallback is libx264 and ffmpeg's native AAC, which is what every path here used
  until 7-Sep-2026: on Linux, which ships no encoder of its own; on an ffmpeg built
  without them; on macOS before 13, where VideoToolbox cannot be told to hold a bitrate
  at all — and on Windows, which is the interesting one and is written up below.

  None of it is silent. ffmpeg stamps the encoder's name into the file's own stream
  metadata, `chosen` says which one ran, and `tests/codec.test.ts` encodes a card and
  reads it back. `measure.ts` beside this file is how a new candidate earns its place.
*/
import { execFileSync } from "node:child_process";
import { platform, release } from "node:os";

/**
  The binaries, by name off PATH, with the same overrides the review package has always
  taken. They live here now because this module has to run one of them to find out what
  it can do, and two spellings of "which ffmpeg" is one too many.
*/
export const FFMPEG = process.env.PANOMA_VIDEO_FFMPEG ?? "ffmpeg";
export const FFPROBE = process.env.PANOMA_VIDEO_FFPROBE ?? "ffprobe";

/** An encoder decision, ready to hand to ffmpeg and to explain to a person. */
export type Choice = {
  /** The ffmpeg encoder name, as `ffmpeg -encoders` prints it and as the file records it. */
  name: string;
  /** True when the operating system supplies this encoder rather than ffmpeg's own build. */
  system: boolean;
  /** The arguments, encoder and rate control together. */
  args: string[];
  /** One line for a report: which one ran, and why that one. */
  why: string;
};

let available: Set<string> | undefined;

/*
  " V....D libx264              libx264 H.264 / AVC ..."  — type letter, five flags, name.
  The legend at the top of the listing has the same shape with "=" where the name goes.
*/
const ENCODER_LINE = /^\s[VAS][.A-Z]{5}\s+(\S+)/;

/**
  The encoder names this ffmpeg was built with, read once per process.

  Synchronously, which is the unusual choice and the deliberate one: the answer has to
  be settled before ffmpeg's argv exists, and making it asynchronous would turn
  `startEncoder` and its four callers async to save a single 30 ms subprocess at the
  front of a render measured in minutes. It never runs between frames.

  An ffmpeg that is missing or will not start is not this function's failure to report:
  it returns nothing, every choice below falls back, and the spawn that follows fails
  with the message it already had.
*/
export function encoders(): Set<string> {
  if (available) return available;
  const found = new Set<string>();
  try {
    const out = execFileSync(FFMPEG, ["-hide_banner", "-encoders"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const line of out.split("\n")) {
      const name = ENCODER_LINE.exec(line)?.[1];
      if (name && name !== "=") found.add(name);
    }
  } catch {
    /* Deliberately empty: see above. */
  }
  available = found;
  return found;
}

/*
  VideoToolbox holds a bitrate only through `constant_bit_rate`, which arrived in macOS
  13 — Darwin 22. Below that it reads -b:v as a suggestion, and a flat card comes out at
  a fortieth of what was asked for, so the fallback keeps the floor instead.
*/
const DARWIN_CONSTANT_BIT_RATE = 22;

/*
  Windows ships Media Foundation, and its two halves got opposite answers.

  `h264_mf` is not used, and it took two goes to learn why. It went into this table on
  the strength of reading about it; every encode then failed outright, because
  `-profile:v high` is a name and that option wants a number there, and the Windows half
  of CI — normally 27 to 30 minutes — passed 86 still waiting on a file that could not be
  written. The obvious repair was `-profile:v 100`, and `measure.ts` on a real Windows
  runner is what saved us from it:

      h264_mf  as shipped (profile:v high)    FAILED   Invalid argument
      h264_mf  profile:v 100                    2.2s      58 kbps   High
      h264_mf  no profile                       2.3s      58 kbps   Constrained Baseline
      h264_mf  no rate_control                  1.9s      58 kbps   Constrained Baseline

  Asked for 5 Mbps on a flat card it writes 58 kbps, and `-rate_control cbr` does not
  move it. The repair would have stopped the error and started producing silently unusable
  video, which is the worse of the two failures. Media Foundation cannot hold a rate on
  this material, so Windows keeps libx264 — where the same card measured 4,839 kbps.

  `aac_mf` is a different encoder with a different answer: 256.0 kbps for a 256k request
  against ffmpeg's own 239.9, at 48 kHz AAC-LC, faster. Measured on the system it serves,
  which is the only thing that earns a place here.
*/
function systemH264(): string | undefined {
  if (platform() !== "darwin") return undefined;
  const darwin = Number.parseInt(release().split(".")[0] ?? "", 10);
  return darwin >= DARWIN_CONSTANT_BIT_RATE ? "h264_videotoolbox" : undefined;
}

function systemAac(): string | undefined {
  if (platform() === "darwin") return "aac_at";
  if (platform() === "win32") return "aac_mf";
  return undefined;
}

/** The system encoder if this ffmpeg has it, otherwise nothing. */
function pick(wanted: string | undefined): string | undefined {
  return wanted && encoders().has(wanted) ? wanted : undefined;
}

const SHIPPED_BY: Record<string, string> = {
  h264_videotoolbox: "VideoToolbox, the H.264 encoder macOS ships",
  h264_mf: "Media Foundation, the H.264 encoder Windows ships",
  aac_at: "AudioToolbox, the AAC encoder macOS ships",
  aac_mf: "Media Foundation, the AAC encoder Windows ships",
};

/*
  Why this one ran. A fallback has three quite different causes and they call for
  different reactions: a Linux machine is working as designed, an ffmpeg built without
  the encoder its own system ships is a build worth replacing, and a system whose
  encoder was tried and turned down is neither.

  That third case is the one this had wrong. Windows ships `h264_mf`, so a Windows
  report saying the system ships no encoder of its own was telling its reader something
  untrue about their own machine — and `declined` is how a deliberate refusal says so.
*/
function why(name: string, wanted: string | undefined, declined?: string): string {
  return (
    SHIPPED_BY[name] ??
    declined ??
    (wanted
      ? `${name}: this ffmpeg was built without ${wanted}, which this system ships`
      : `${name}: this system ships no encoder of its own for this format`)
  );
}

/** What this system has for pictures and why it is not being used. See `systemH264`. */
function declinedH264(): string | undefined {
  if (platform() === "win32") return "libx264: Windows ships h264_mf, and it writes 58 kbps where 5 Mbps is asked for";
  if (platform() === "darwin") return "libx264: VideoToolbox before macOS 13 cannot be told to hold a bitrate";
  return undefined;
}

/**
  Video for a deliverable: H.264 High, 4:2:0, holding `bitsPerSecond`.

  Holding it, not aiming near it, and that is why the arguments differ per encoder.
  What this renders is mostly flat cards carrying text, and every rate control left to
  its own judgement encodes those into almost nothing — then the platform's own second
  encode has too little edge information left to keep an interface legible. Each line
  below is the setting measured to make that encoder hold the rate on such a card:

  - `libx264` — the rate four ways plus `nal-hrd=cbr`, which is what this project
    always used.
  - `h264_videotoolbox` — `-constant_bit_rate`, and pointedly **without** `-maxrate`
    and `-bufsize`: with a maximum set as well, the same flat card came out at 33 kbps
    instead of 4.4 Mbps. That combination looks careful and is the trap.
  - `h264_mf` — `-rate_control cbr`. Unmeasured on a Windows machine by anyone here;
    `tests/codec.test.ts` is what measures it, on the Windows runner.
*/
export function h264Args(name: string, bitsPerSecond: number): string[] {
  const rate = String(bitsPerSecond);
  if (name === "h264_videotoolbox") return ["-c:v", name, "-profile:v", "high", "-b:v", rate, "-constant_bit_rate", "1"];
  if (name === "h264_mf") return ["-c:v", name, "-profile:v", "high", "-b:v", rate, "-rate_control", "cbr"];
  return [
    "-c:v", "libx264",
    "-preset", "medium",
    "-profile:v", "high",
    "-b:v", rate,
    "-minrate", rate,
    "-maxrate", rate,
    "-bufsize", String(bitsPerSecond * 2),
    "-x264-params", "nal-hrd=cbr:force-cfr=1",
  ];
}

export function h264(bitsPerSecond: number): Choice {
  const wanted = systemH264();
  const name = pick(wanted) ?? "libx264";
  return {
    name,
    system: name !== "libx264",
    args: h264Args(name, bitsPerSecond),
    why: why(name, wanted, declinedH264()),
  };
}

/**
  Video for an intermediate — an element crushed once and read by every render after.
  Near-transparent, size second, and no rate to hold because nothing downstream cares.

  Only the two settings that were measured against each other are here. On a 4 s 720p
  element, `-crf 16` scored 0.9977 SSIM in 5.4 MB and VideoToolbox at `-q:v 90` scored
  0.9987 in 13.2 MB: better, for a file written once. Media Foundation's quality mode
  has been measured by nobody, so Windows keeps CRF until it has been.
*/
export function h264Intermediate(): Choice {
  const name = platform() === "darwin" ? pick(systemH264()) : undefined;
  if (name === "h264_videotoolbox") {
    return { name, system: true, args: ["-c:v", name, "-q:v", "90"], why: why(name, name) };
  }
  return {
    name: "libx264",
    system: false,
    args: ["-c:v", "libx264", "-crf", "16"],
    why: "libx264 at CRF: no system encoder here has a quality mode anyone has measured",
  };
}

/** Audio: AAC-LC at `bitsPerSecond`, from the system's encoder where there is one. */
export function aacArgs(name: string, bitsPerSecond: number): string[] {
  return ["-c:a", name, "-b:a", String(bitsPerSecond)];
}

export function aac(bitsPerSecond: number): Choice {
  const wanted = systemAac();
  const name = pick(wanted) ?? "aac";
  return { name, system: name !== "aac", args: aacArgs(name, bitsPerSecond), why: why(name, wanted) };
}

/** Both choices in one line, for a log or a report. */
export function chosen(): string {
  const v = pick(systemH264()) ?? "libx264";
  const a = pick(systemAac()) ?? "aac";
  return `video ${v} (${why(v, systemH264(), declinedH264())}), audio ${a} (${why(a, systemAac())})`;
}
