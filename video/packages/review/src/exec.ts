/*
  One door to ffmpeg and ffprobe. Every measurement in this package is a filter that
  writes `lavfi.*` tags on frames, printed by the `metadata`/`ametadata` filters to
  stdout as:

      frame:36   pts:18432   pts_time:1.5
      lavfi.black_start=1.5
      lavfi.scd.score=40.027

  Parsing that stream incrementally is what keeps a ten-minute 1080p file from
  buffering twenty megabytes of signalstats lines in one string.

  The binaries are the system ones, invoked as separate processes, and that is a
  COPYRIGHT boundary and only that: ffmpeg built with libx264 is GPL-2.0-or-later, and a
  subprocess is the licence-clean way to use it from AGPL code. The page that says so
  (https://ffmpeg.org/legal.html) is about linking, and this sentence used to be read as
  settling more than it does. It settles nothing about the patents on the formats
  themselves, which are a separate system with separate holders and no bearing on who
  wrote the code. `packages/codec` is where that question is answered and
  `docs/codecs.md` is where it is written down.

  The names come from there too, so that one module decides what "ffmpeg" means;
  `PANOMA_VIDEO_FFMPEG` / `PANOMA_VIDEO_FFPROBE` still override them for a machine whose
  binaries are not on PATH.
*/
import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { FFMPEG, FFPROBE } from "@panoma/video-codec";

export { FFMPEG, FFPROBE };

/* stderr of an analysis pass is a few kilobytes; ffprobe JSON for a long file is
   under a megabyte. 64 MB is a ceiling nothing here approaches. */
const MAX_BUFFER = 64 * 1024 * 1024;

export type Ran = { stdout: string; stderr: string };

/** Run a binary to completion and return both streams; throws on a non-zero exit. */
export function run(bin: string, args: string[]): Promise<Ran> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: MAX_BUFFER, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        const tail = (stderr ?? "").trim().split("\n").slice(-6).join("\n");
        reject(new Error(`${bin} ${args.slice(0, 4).join(" ")}… failed: ${error.message}\n${tail}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/** One frame's tags as printed by the metadata filter. */
export type TaggedFrame = { frame: number; ptsTime: number; tags: Record<string, string> };

const FRAME_LINE = /^frame:(\d+)\s+pts:(?:-?\d+|N\/A)\s+pts_time:(\S+)/;

/**
  Run an ffmpeg analysis pass whose filtergraph ends in `metadata=mode=print:file=-`
  (or `ametadata=…`), calling `onFrame` once per tagged frame as the lines arrive.
  Resolves with stderr, where the filters that print summaries (ebur128, silencedetect,
  astats) leave their reports.
*/
export function ffmpegFrames(args: string[], onFrame: (f: TaggedFrame) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ["-hide_banner", "-nostdin", "-nostats", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    let current: TaggedFrame | undefined;
    const lines = createInterface({ input: proc.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      const head = FRAME_LINE.exec(line);
      if (head) {
        if (current) onFrame(current);
        current = { frame: Number(head[1]), ptsTime: Number(head[2]), tags: {} };
        return;
      }
      const eq = line.indexOf("=");
      if (current && eq > 0) current.tags[line.slice(0, eq)] = line.slice(eq + 1);
    });
    proc.on("error", (error) => reject(new Error(`${FFMPEG} could not start: ${error.message}`)));
    proc.on("close", (code) => {
      /* The line reader may still hold the last frame: flush it on 'close', which
         fires after stdout has ended. */
      lines.close();
      if (current) onFrame(current);
      if (code !== 0) {
        const tail = stderr.trim().split("\n").slice(-6).join("\n");
        reject(new Error(`${FFMPEG} exited ${code}\n${tail}`));
        return;
      }
      resolve(stderr);
    });
  });
}

/**
  Stream raw bytes out of ffmpeg (`-f rawvideo -`), handing `onChunk` every complete
  block of `blockBytes`. Used by the flash detector, whose 32x18 grey frames are 576
  bytes each and arrive faster than any parser needs.
*/
export function ffmpegBlocks(args: string[], blockBytes: number, onBlock: (block: Buffer) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ["-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    let pending: Buffer = Buffer.alloc(0);
    proc.stdout.on("data", (chunk: Buffer) => {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      let offset = 0;
      while (pending.length - offset >= blockBytes) {
        onBlock(pending.subarray(offset, offset + blockBytes));
        offset += blockBytes;
      }
      pending = offset === 0 ? pending : pending.subarray(offset);
    });
    proc.on("error", (error) => reject(new Error(`${FFMPEG} could not start: ${error.message}`)));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${FFMPEG} exited ${code}\n${stderr.trim().split("\n").slice(-6).join("\n")}`));
        return;
      }
      resolve();
    });
  });
}

let filterList: Promise<Set<string>> | undefined;

/** Does this ffmpeg build ship a filter? (`drawtext` needs freetype and is often absent.) */
export function hasFilter(name: string): Promise<boolean> {
  filterList ??= run(FFMPEG, ["-hide_banner", "-filters"]).then(({ stdout }) => {
    const names = new Set<string>();
    for (const line of stdout.split("\n")) {
      /* " .S. blackdetect      V->V  Detect …" — flags, name, io, description. */
      const m = /^\s*[A-Z.]+\s+(\S+)\s+\S+->\S+/.exec(line);
      if (m) names.add(m[1]);
    }
    return names;
  });
  return filterList.then((set) => set.has(name));
}
