/*
  PNGs go straight down a pipe into ffmpeg — no frames directory, no cleanup, no disk
  spike (1200 frames of 9:16 PNG would be gigabytes). Audio clips are mixed in the
  same invocation through a generated filtergraph: each clip is delayed to its frame,
  trimmed, gained, then summed without normalization (amix's default would duck the
  music every time a voice line enters — the mix balance is authored, not automatic).
*/
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { aac, FFMPEG, h264 } from "@panoma/video-codec";

/*
  The rate this material needs, and it is a property of the material rather than of any
  encoder: these frames are flat cards carrying text, and an encoder left to judge for
  itself makes them tiny — after which the platform's own second encode has too little
  edge information left to keep the interface type legible. Which encoder holds the rate,
  and with which arguments, is `@panoma/video-codec`'s decision.
*/
const VIDEO_BITRATE = 5_000_000;
const AUDIO_BITRATE = 256_000;

export type AudioClip = {
  /** Absolute path of the audio file. */
  path: string;
  /** Frame at which it starts. */
  from: number;
  volume?: number;
  /** Stop this clip before the next picture or action. Absent means the piece's end. */
  durationInFrames?: number;
  /*
    Seconds of fade, in at the clip's own start and out ending at the clip's end. A
    brought track is cut at the composition's duration, and a track cut is a click; the
    procedural bed fades itself and needs neither.
  */
  fade?: { in?: number; out?: number };
};

export type Encoder = {
  /** Write one PNG frame; resolves when the pipe accepts more (backpressure). */
  write: (png: Buffer) => Promise<void>;
  /** Close stdin and wait for ffmpeg to finish the file. */
  finish: () => Promise<void>;
  /** Kill ffmpeg on the failure path — never leave an orphan encoding half a file. */
  abort: () => Promise<void>;
};

export function startEncoder(opts: {
  out: string;
  fps: number;
  durationInFrames: number;
  audio: AudioClip[];
  /*
    Container tags. The one that matters is the disclosure: a file with a synthetic
    voice or a generated bed says so in its own metadata, machine-readably, which is
    what the EU AI Act's Article 50 asks of anything that makes synthetic media and
    what YouTube's upload form asks a person. Written here so no deliverable can
    leave the encoder without it.
  */
  metadata?: Record<string, string>;
}): Encoder {
  const seconds = opts.durationInFrames / opts.fps;
  const args = [
    "-y",
    "-v", "error",
    "-f", "image2pipe",
    "-framerate", String(opts.fps),
    "-i", "pipe:0",
  ];

  for (const clip of opts.audio) args.push("-i", clip.path);

  if (opts.audio.length > 0) {
    const chains = opts.audio.map((clip, i) => {
      const delayMs = Math.round((clip.from / opts.fps) * 1000);
      const clipSeconds = Math.min(seconds - clip.from / opts.fps, (clip.durationInFrames ?? opts.durationInFrames) / opts.fps);
      const fades = [
        ...(clip.fade?.in ? [`afade=t=in:st=0:d=${Math.min(clipSeconds, clip.fade.in).toFixed(3)}`] : []),
        ...(clip.fade?.out ? [`afade=t=out:st=${Math.max(0, clipSeconds - clip.fade.out).toFixed(3)}:d=${Math.min(clipSeconds, clip.fade.out).toFixed(3)}`] : []),
      ];
      return `[${i + 1}:a]atrim=duration=${clipSeconds.toFixed(6)},asetpts=PTS-STARTPTS,volume=${clip.volume ?? 1}${fades.map((f) => `,${f}`).join("")},adelay=${delayMs}:all=1[a${i}]`;
    });
    const inputs = opts.audio.map((_, i) => `[a${i}]`).join("");
    chains.push(`${inputs}amix=inputs=${opts.audio.length}:duration=longest:normalize=0,apad[aout]`);
    args.push("-filter_complex", chains.join(";"), "-map", "0:v", "-map", "[aout]");
    args.push(...aac(AUDIO_BITRATE).args, "-ar", "48000");
  } else {
    args.push("-an");
  }

  for (const [key, value] of Object.entries(opts.metadata ?? {})) args.push("-metadata", `${key}=${value}`);

  /*
    ffmpeg 9 tags colour from the frames the encoder is handed, not from the output
    options alone: without setparams the stream said "unknown" for primaries and
    transfer and every platform table warned about it. High profile, the rate and the
    arguments that hold it come from the codec module, because which encoder runs
    depends on what the operating system ships — see its header.
  */
  args.push(
    "-t", seconds.toFixed(4),
    "-vf", "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709",
    ...h264(VIDEO_BITRATE).args,
    "-pix_fmt", "yuv420p",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-movflags", "+faststart",
    opts.out,
  );

  const proc: ChildProcess = spawn(FFMPEG, args, { stdio: ["pipe", "inherit", "inherit"] });
  const stdin = proc.stdin;
  if (!stdin) throw new Error("ffmpeg spawned without stdin");

  const exit = new Promise<void>((resolve, reject) => {
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
    proc.on("error", reject);
  });
  /*
    Somebody always observes the exit: if ffmpeg dies before finish() is called,
    an unobserved rejection would kill the whole process instead of surfacing as
    this render's error.
  */
  exit.catch(() => undefined);

  return {
    async write(png) {
      if (!stdin.write(png)) await once(stdin, "drain");
    },
    async finish() {
      stdin.end();
      await exit;
    },
    async abort() {
      stdin.destroy();
      proc.kill("SIGKILL");
      await exit.catch(() => undefined);
    },
  };
}
