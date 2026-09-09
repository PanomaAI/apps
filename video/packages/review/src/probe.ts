/*
  What the file *is*, before anything about what it shows: one ffprobe call turned into
  numbers every other check reads (fps, duration, size, codec, colour tags) plus one
  thing ffprobe will not tell you — whether the `moov` atom precedes `mdat`. A player
  streaming an mp4 whose index sits at the end downloads the whole file before the
  first frame; YouTube's upload guide asks for the index at the front
  (https://support.google.com/youtube/answer/1722171). The encoder writes
  `-movflags +faststart` for that reason, and this probe is the proof it did.
*/
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { FFPROBE, run } from "./exec.ts";

export type Probe = {
  file: string;
  bytes: number;
  seconds: number;
  /** Overall container bitrate, bits per second. */
  bitrate: number;
  container: string;
  /** `true` when `moov` precedes `mdat`; `undefined` for non-ISO containers (webm, mkv). */
  faststart: boolean | undefined;
  video?: {
    codec: string;
    profile?: string;
    level?: number;
    width: number;
    height: number;
    fps: number;
    frames?: number;
    pixFmt?: string;
    hasBFrames: number;
    fieldOrder?: string;
    bitrate?: number;
    /**
      What ffmpeg wrote into the stream's own metadata, e.g. "Lavc63.1.101 libx264".
      Which encoder ran is a choice made per machine (see `@panoma/video-codec`), so the
      only trustworthy record of it is the one inside the file.
    */
    encoder?: string;
    colour: { primaries?: string; transfer?: string; space?: string; range?: string };
  };
  audio?: {
    codec: string;
    profile?: string;
    sampleRate: number;
    channels: number;
    bitrate?: number;
  };
};

type Stream = Record<string, unknown> & { codec_type?: string; tags?: Record<string, string> };

function num(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "N/A") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "unknown" ? value : undefined;
}

/** "24/1" → 24, "30000/1001" → 29.97; ffprobe prints "0/0" for streams with no rate. */
export function parseRate(rate: unknown): number | undefined {
  if (typeof rate !== "string") return undefined;
  const [n, d] = rate.split("/").map(Number);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0 || n === 0) return undefined;
  return n / d;
}

/**
  Walk the top-level ISO BMFF boxes from the head of the file and report whether the
  index (`moov`) comes before the media data (`mdat`). Box header: 4-byte big-endian
  size, 4-byte type; size 1 means a 64-bit `largesize` follows, size 0 means "to the
  end of the file" (ISO/IEC 14496-12 §4.2). A file that starts with anything other than
  a plausible box is not ISO BMFF and returns `undefined`.
*/
export function moovBeforeMdat(file: string): boolean | undefined {
  const fd = openSync(file, "r");
  try {
    const size = statSync(file).size;
    let offset = 0;
    const header = Buffer.alloc(16);
    /* A sane top level has a handful of boxes: ftyp, free, moov, mdat, maybe udta. */
    for (let i = 0; i < 64 && offset + 8 <= size; i++) {
      const got = readSync(fd, header, 0, 16, offset);
      if (got < 8) return undefined;
      let boxSize = header.readUInt32BE(0);
      const type = header.toString("latin1", 4, 8);
      if (!/^[\w ]{4}$/.test(type)) return undefined;
      if (boxSize === 1) {
        if (got < 16) return undefined;
        boxSize = Number(header.readBigUInt64BE(8));
      } else if (boxSize === 0) {
        boxSize = size - offset;
      }
      if (type === "moov") return true;
      if (type === "mdat") return false;
      if (boxSize < 8) return undefined;
      offset += boxSize;
    }
    return undefined;
  } finally {
    closeSync(fd);
  }
}

/** ffprobe the file: streams, format, and the atom order read from the bytes. */
export async function probe(path: string): Promise<Probe> {
  const file = resolve(path);
  const { stdout } = await run(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]);
  const json = JSON.parse(stdout) as { streams?: Stream[]; format?: Record<string, unknown> };
  const format = json.format ?? {};
  const streams = json.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");

  const seconds = num(format.duration) ?? num(v?.duration) ?? num(a?.duration) ?? 0;
  const bytes = num(format.size) ?? statSync(file).size;
  const container = str(format.format_name) ?? "unknown";
  const isIso = /\b(mov|mp4|m4a|3gp|3g2|mj2)\b/.test(container);

  const out: Probe = {
    file,
    bytes,
    seconds,
    bitrate: num(format.bit_rate) ?? (seconds > 0 ? Math.round((bytes * 8) / seconds) : 0),
    container,
    faststart: isIso ? moovBeforeMdat(file) : undefined,
  };

  if (v) {
    const fps = parseRate(v.r_frame_rate) ?? parseRate(v.avg_frame_rate);
    if (!fps) throw new Error(`${file}: the video stream has no frame rate`);
    out.video = {
      codec: str(v.codec_name) ?? "unknown",
      profile: str(v.profile),
      level: num(v.level),
      width: num(v.width) ?? 0,
      height: num(v.height) ?? 0,
      fps,
      frames: num(v.nb_frames),
      pixFmt: str(v.pix_fmt),
      hasBFrames: num(v.has_b_frames) ?? 0,
      fieldOrder: str(v.field_order),
      bitrate: num(v.bit_rate),
      encoder: str(v.tags?.encoder),
      colour: {
        primaries: str(v.color_primaries),
        transfer: str(v.color_transfer),
        space: str(v.color_space),
        range: str(v.color_range),
      },
    };
  }
  if (a) {
    out.audio = {
      codec: str(a.codec_name) ?? "unknown",
      profile: str(a.profile),
      sampleRate: num(a.sample_rate) ?? 0,
      channels: num(a.channels) ?? 0,
      bitrate: num(a.bit_rate),
    };
  }
  return out;
}
