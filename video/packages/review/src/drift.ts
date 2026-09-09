/*
  How much of a bought clip is still the product.

  A video model conditioned on a real frame reproduces it, and then it stops. Every frame
  after the first is redrawn from scratch — the model is generating, not transforming —
  and on an interface the redraw is legible as damage: labels come back as convincing
  gibberish, panel edges migrate, counts change. Conditioning it on a LAST frame as well
  buys the other end back, so the clip is true at both ends and invented in the middle.

  How wide those true ends are is not a matter of opinion, and this file is the measurement
  rather than the guess. Measured on the first board this repository shot — a push on a
  project catalog, Veo 3.1 Fast, eight seconds, conditioned on two real frames one second
  apart in the recording:

      t = 0.00 – 1.00 s     32 dB      the conditioning frame, held
      t = 1.33 – 7.30 s     14 – 17 dB  an interface that does not exist
      t = 7.65 – 8.00 s     32 dB      the last frame, snapped back to

  So the honest head is about a second and the honest tail about a third of one, and the
  return is abrupt rather than gradual: there is no gentle slope to cut on. That single
  measurement overturned the design it was made to check, which had end-aligned every shot
  on the assumption that landing on truth mattered most. The head is three times longer.
  It is now chosen by this function on every clip, per clip, because the width depends on
  the model, the duration, the move and how far apart the two real frames are — and a
  constant chosen once would be a constant that is wrong for the next board.

  PSNR rather than SSIM because the failure is not structural: the layout survives and the
  GLYPHS do not, which is a per-pixel error inside otherwise correct boxes. It is also the
  metric the published fidelity work on these models reports, so the numbers here can be
  read against theirs.
*/
import { FFMPEG, run } from "./exec.ts";

/*
  Above this, a frame is the product. Below it, a frame is a drawing of the product.

  Not tuned to taste: on the measurement above the two states are 32 dB and ≤ 21 dB with
  nothing in between, so any floor in that gap classifies identically. Twenty-eight sits in
  the gap with room on both sides, and the published work on identity-preserving generation
  puts "plausible reconstruction" at 20–22 dB, which is the wrong side of it by a margin.
*/
export const FAITHFUL_DB = 28;

/** A run of frames that are still the product, in seconds into the clip. */
export type Window = { from: number; to: number; seconds: number };

export type Drift = {
  /** Every frame's PSNR against whichever conditioning frame it is nearer to. */
  db: number[];
  fps: number;
  /** The longest run at or above the floor that touches the start of the clip. */
  head: Window;
  /** The longest run at or above the floor that touches the end of it. */
  tail: Window;
  /** The wider of the two: what the edit should actually use. */
  best: Window & { end: "head" | "tail" };
  /** The worst frame in the clip, which is the one worth looking at when a shot is rejected. */
  worst: { at: number; db: number };
};

/*
  One ffmpeg pass per reference, because psnr takes exactly one.

  The still is looped and bounded to the clip's own duration; an unbounded `-loop 1` never
  ends and the pass hangs with no output, which is how this was first written.
*/
async function psnrAgainst(clip: string, still: string, seconds: number): Promise<number[]> {
  const { stdout } = await run(FFMPEG, [
    "-hide_banner", "-nostdin", "-nostats", "-loglevel", "error",
    "-i", clip,
    "-loop", "1", "-t", String(seconds), "-i", still,
    /*
      `scale2ref` rather than a fixed size: the still is a full viewport at the page's own
      device pixel ratio and the clip is whatever the model returned, and the two are never
      the same shape. Hard-coding 1280x720 quietly compared a vertical clip against a
      landscape reference, which reads as drift everywhere and is really a squash.
    */
    "-filter_complex",
    "[1:v][0:v]scale2ref[ref][cli];[ref]format=yuv420p[r];[cli]format=yuv420p[c];[c][r]psnr=stats_file=-",
    "-f", "null", "-",
  ]);
  const db: number[] = [];
  for (const line of stdout.split("\n")) {
    const m = /n:(\d+).*?psnr_avg:(inf|[\d.]+)/.exec(line);
    if (m) db.push(m[2] === "inf" ? 99 : Number(m[2]));
  }
  return db;
}

const runFrom = (db: number[], floor: number, from: "start" | "end"): { a: number; b: number } => {
  if (db.length === 0) return { a: 0, b: 0 };
  if (from === "start") {
    let i = 0;
    while (i < db.length && db[i] >= floor) i++;
    return { a: 0, b: i };
  }
  let i = db.length;
  while (i > 0 && db[i - 1] >= floor) i--;
  return { a: i, b: db.length };
};

/**
 * Measure a bought clip against the frames it was conditioned on.
 *
 * `last` is optional: a clip conditioned on one frame has a head and no tail, and the
 * function says so with a zero-length tail rather than by pretending the end is true.
 */
export async function driftOf(
  clip: string,
  frames: { first: string; last?: string },
  opts: { seconds: number; fps: number; floor?: number },
): Promise<Drift> {
  const floor = opts.floor ?? FAITHFUL_DB;
  const head = await psnrAgainst(clip, frames.first, opts.seconds);
  const tail = frames.last ? await psnrAgainst(clip, frames.last, opts.seconds) : head.map(() => 0);
  /* Each frame is judged against the end it is nearer to; in between, both are wrong anyway. */
  const db = head.map((v, i) => Math.max(v, tail[i] ?? 0));

  const h = runFrom(head, floor, "start");
  const t = frames.last ? runFrom(tail, floor, "end") : { a: db.length, b: db.length };
  const secs = (n: number) => n / opts.fps;
  const headWin = { from: secs(h.a), to: secs(h.b), seconds: secs(h.b - h.a) };
  const tailWin = { from: secs(t.a), to: secs(t.b), seconds: secs(t.b - t.a) };
  const best = headWin.seconds >= tailWin.seconds ? { ...headWin, end: "head" as const } : { ...tailWin, end: "tail" as const };
  let worst = { at: 0, db: Number.POSITIVE_INFINITY };
  for (const [i, v] of db.entries()) if (v < worst.db) worst = { at: secs(i), db: v };
  return { db, fps: opts.fps, head: headWin, tail: tailWin, best, worst };
}

/**
 * Whether a bought shot can carry the time the board gave it.
 *
 * The check a person actually wants, phrased as this repository phrases the others: not
 * "is it good" but "is what you cut still the thing you filmed". A shot whose honest
 * window is shorter than its hold is a shot that will show an interface the product does
 * not have, for the difference.
 */
export function driftCheck(drift: Drift, wanted: number): { ok: boolean; say: string } {
  const w = drift.best;
  const ok = w.seconds >= wanted;
  return {
    ok,
    say: ok
      ? `${w.seconds.toFixed(2)}s of this clip is the product (from its ${w.end}), and the cut takes ${wanted.toFixed(2)}s`
      : `only ${w.seconds.toFixed(2)}s of this clip is still the product (from its ${w.end}); the cut wants ${wanted.toFixed(2)}s, and the rest is an interface the model drew — worst frame at ${drift.worst.at.toFixed(2)}s, ${drift.worst.db.toFixed(1)} dB`,
  };
}
