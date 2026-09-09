/*
  Pictures for the reader who cannot play the file. A contact sheet is how an agent —
  or a person on a phone — sees a render before it ships: one JPEG, the frames the
  plan cares about (every cut, every mark), tiled by ffmpeg. `frameAt` is the same
  idea for one instant when a check names a second.

  Sizes follow the MCP image budget in the architecture: ≤ 1280 px wide and about
  80 KB, because the picture rides inside a tool result that a model reads. JPEG
  quality steps down until the file fits; a sheet of flat UI compresses far below
  the limit, a sheet of busy footage needs the last rung.

  Timestamps are burned onto the tiles only when the ffmpeg build has `drawtext`
  (it needs freetype; the Homebrew build here does not have it). The frames' seconds
  are returned either way, so a caller can caption them in text.
*/
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { FFMPEG, hasFilter, run } from "./exec.ts";

export type SheetOptions = {
  seconds: number[];
  columns?: number;
  width?: number;
  out: string;
  /** Byte budget; the default is the MCP image budget. */
  maxBytes?: number;
};

export type Picture = { file: string; bytes: number; width: number; seconds: number[] };

export const SHEET_MAX_BYTES = 80 * 1024;
export const SHEET_WIDTH = 1280;
/* mjpeg's q:v scale (2 best … 31 worst); 5 is visibly clean, 12 still legible for UI. */
const QUALITY_LADDER = [5, 7, 9, 12, 16];

/** A select() expression that keeps the first frame at or after each second. */
export function selectExpression(seconds: readonly number[]): string {
  return seconds
    .map((s) => (s <= 0 ? "eq(n\\,0)" : `(lt(prev_t\\,${s.toFixed(4)})*gte(t\\,${s.toFixed(4)}))`))
    .join("+");
}

async function label(): Promise<string> {
  /* %{pts:hms} prints the frame's own time, so each tile carries its own stamp. */
  return (await hasFilter("drawtext")) ? ",drawtext=text='%{pts\\:hms}':fontcolor=white:fontsize=h/18:box=1:boxcolor=black@0.5:x=8:y=8" : "";
}

async function encode(args: string[], out: string, maxBytes: number): Promise<number> {
  let bytes = Infinity;
  for (const q of QUALITY_LADDER) {
    await run(FFMPEG, ["-y", "-hide_banner", "-nostdin", "-loglevel", "error", ...args, "-frames:v", "1", "-q:v", String(q), out]);
    bytes = statSync(out).size;
    if (bytes <= maxBytes) break;
  }
  return bytes;
}

/** Tile the frames at the given seconds into one JPEG; the last row is padded. */
export async function contactSheet(file: string, opts: SheetOptions): Promise<Picture> {
  const seconds = [...opts.seconds].sort((a, b) => a - b);
  if (!seconds.length) throw new Error("contactSheet needs at least one second to show");
  const columns = opts.columns ?? 4;
  const width = opts.width ?? SHEET_WIDTH;
  const rows = Math.ceil(seconds.length / columns);
  const out = resolve(opts.out);
  const stamp = await label();
  const graph = `select='${selectExpression(seconds)}'${stamp},tile=${columns}x${rows},scale=${width}:-2`;
  let bytes: number;
  try {
    bytes = await encode(["-i", resolve(file), "-an", "-sn", "-vf", graph], out, opts.maxBytes ?? SHEET_MAX_BYTES);
  } catch (error) {
    /* drawtext without a usable font fails at runtime; the sheet matters more than the stamps. */
    if (!stamp) throw error;
    const bare = `select='${selectExpression(seconds)}',tile=${columns}x${rows},scale=${width}:-2`;
    bytes = await encode(["-i", resolve(file), "-an", "-sn", "-vf", bare], out, opts.maxBytes ?? SHEET_MAX_BYTES);
  }
  return { file: out, bytes, width, seconds };
}

/** One frame as a JPEG, seeking to the instant (input seek: fast, keyframe-accurate then decoded to the exact frame). */
export async function frameAt(file: string, seconds: number, opts: { out: string; width?: number; maxBytes?: number }): Promise<Picture> {
  const out = resolve(opts.out);
  const width = opts.width ?? SHEET_WIDTH;
  const bytes = await encode(["-ss", Math.max(0, seconds).toFixed(3), "-i", resolve(file), "-an", "-sn", "-vf", `scale=${width}:-2`], out, opts.maxBytes ?? SHEET_MAX_BYTES);
  return { file: out, bytes, width, seconds: [seconds] };
}
