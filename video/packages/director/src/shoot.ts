/*
  Buying the shots a board asks for — once each, and never silently.

  Two things make this different from every other stage in panoma video. It spends money
  per SECOND of output rather than per call, so a run that quietly picked a duration
  would be a run that quietly picked a bill; and its yield is well below one. The public
  accounts of the large generated campaigns are unambiguous about that second point —
  hundreds of generations for a handful of usable clips — so a shot is not "generated",
  it is ATTEMPTED, and every attempt is written onto the board whether it was kept or
  not. A board is a ledger of what was tried, which is also the only way a second run
  knows what not to repeat.

  Content-addressed on everything that changes the picture: the two conditioning frames by
  their hashes, the prompt, the negative, the duration, the aspect, the provider and the
  model. Re-running an unchanged board sends nothing and costs nothing — which is not an
  optimisation, it is what makes a board something a person can iterate on. Change one
  shot's move and that shot costs; change a word in a card and nothing does.
*/
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const run = async (bin: string, args: string[]) => ({ stdout: (await promisify(execFile)(bin, args)).stdout });
import type { Aspect, Board, Generator, ImageInput, Shot, Take } from "@panoma/video-gen";
import { commissioned, negativeOf, promptOf } from "@panoma/video-gen";
import { driftOf, driftCheck } from "@panoma/video-review";

/*
  The cap, in seconds of billing.

  The doctrine for a paid stage in this repository is a key and a cap, never a key alone.
  Past it the stage declines and says by how much, rather than sending most of a board and
  discovering the rest of the bill afterwards. Twenty-four seconds is three bought moves at
  the eight the API forces once a frame is attached.
*/
export const BOARD_SECONDS_CAP = 24;

export type ShootResult = {
  status: "done" | "cached" | "skipped" | "failed";
  summary: string;
  /** Per shot number, the clip that was kept. */
  kept: Record<number, string>;
  takes: Take[];
  charged: number;
  /** What the measurement said about each bought clip, in words a person reads. */
  measured: string[];
};

/*
  The clip's own frame rate, which is not the film's.

  Veo returns 24 fps whatever the board is cut at, and the drift measurement counts FRAMES —
  so reading this wrong moves every window by a fifth and silently picks the wrong part of
  the clip.
*/
async function fpsOf(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=r_frame_rate", "-of", "default=nw=1:nk=1", file,
  ]).catch(() => ({ stdout: "24/1" }));
  const [a, b] = stdout.trim().split("/").map(Number);
  return b ? a / b : a || 24;
}

const digest = (parts: readonly string[]) => createHash("sha256").update(parts.join(" ")).digest("hex").slice(0, 16);

const load = async (file: string): Promise<ImageInput> => ({ bytes: await readFile(file), mimeType: "image/png" });

/**
 * Commission every generated shot on a board.
 *
 * The conditioning frames come off the shot's own panels — `A` is the frame the clip opens
 * on, `B` the frame it must end on — so what is sent is exactly what the board showed. A
 * board whose panels have no pictures cannot be shot, and says so rather than falling back
 * to a text prompt that would invent an interface.
 */
export async function shootBoard(
  board: Board,
  generator: Generator,
  dir: string,
  opts: { cap?: number; onProgress?: (message: string, done: number, total: number) => void } = {},
): Promise<ShootResult> {
  const wanted = commissioned(board);
  if (wanted.length === 0) {
    return { status: "skipped", summary: "this board commissions nothing: every shot is the recording or a card", kept: {}, takes: [], charged: 0, measured: [] };
  }

  const aspect: Aspect = board.format === "v" ? "9:16" : board.format === "s" ? "1:1" : "16:9";
  const asked = wanted.reduce((n, s) => n + (s.gen?.seconds ?? 0), 0);
  const cap = opts.cap ?? BOARD_SECONDS_CAP;
  if (asked > cap) {
    return {
      status: "skipped",
      summary: `this board bills ${asked}s and the cap is ${cap}s; raise it deliberately with --cap, or budget fewer moves`,
      kept: {},
      takes: [],
      charged: 0,
      measured: [],
    };
  }

  await mkdir(dir, { recursive: true });
  const kept: Record<number, string> = {};
  const takes: Take[] = [];
  const measured: string[] = [];
  let charged = 0;
  let cached = 0;

  for (const [i, shot] of wanted.entries()) {
    const gen = shot.gen!;
    const prompt = promptOf(shot, board.bible);
    const negative = negativeOf(shot, board.bible);
    const first = shot.panels.find((p) => p.at === "first")?.still;
    const last = shot.panels.find((p) => p.at === "last")?.still;
    if (gen.mode !== "text" && !first) {
      takes.push({
        n: shot.n,
        id: `${shot.n}`,
        file: "",
        provider: generator.provider,
        model: generator.model,
        seconds: 0,
        cost: 0,
        ignored: [],
        verdict: "rejected",
        why: "the panel has no picture, and a conditioned shot is its picture",
      });
      continue;
    }

    /* The frames are part of the key: the same words over different frames is a different shot. */
    const key = digest([generator.provider, generator.model, prompt, negative, String(gen.seconds), aspect, first?.sha256 ?? "", last?.sha256 ?? ""]);
    const file = join(dir, `shot-${String(shot.n).padStart(2, "0")}-${key}.mp4`);
    if (existsSync(file)) {
      kept[shot.n] = file;
      takes.push({ n: shot.n, id: key, file, provider: generator.provider, model: generator.model, seconds: gen.seconds, cost: 0, ignored: [], verdict: "kept" });
      await conform(shot, file, first!.file, last?.file, board.fps, measured);
      cached++;
      continue;
    }

    opts.onProgress?.(`shot ${shot.n}: ${shot.subject} — ${gen.motion}`, i, wanted.length);
    /*
      A provider that will not sell does not take the run down with it. The first real
      generation this repository attempted came back 429 — a true answer about somebody's
      account — thrown out of an adapter, which killed a command that had already written a
      board worth keeping. What can be bought is kept, what cannot is named, and the film is
      assembled from whatever exists.
    */
    try {
      const clip = await generator.make({
        prompt,
        seconds: gen.seconds,
        aspect,
        ...(generator.can.negative ? { negative } : {}),
        ...(first && gen.mode !== "text" ? { first: await load(first.file) } : {}),
        ...(last && gen.mode === "interpolate" && generator.can.lastFrame ? { last: await load(last.file) } : {}),
      });
      await writeFile(file, clip.bytes);
      charged += clip.cost;
      kept[shot.n] = file;
      takes.push({ n: shot.n, id: key, file, provider: clip.provider, model: clip.model, seconds: clip.seconds, cost: clip.cost, ignored: clip.ignored, verdict: "kept" });
      await conform(shot, file, first!.file, last?.file, board.fps, measured);
    } catch (e) {
      /* Collapsed rather than truncated: these errors arrive as pretty-printed JSON, and
         cutting at the first newline turned every one of them into "400 {". */
      const why = (e as Error).message.replace(/\s+/g, " ").trim().slice(0, 300);
      /* A safety refusal is a normal outcome that costs nothing, and it is not a crash. */
      const blocked = /safety|refused it|nothing came back/i.test(why);
      takes.push({
        n: shot.n,
        id: key,
        file: "",
        provider: generator.provider,
        model: generator.model,
        seconds: 0,
        cost: 0,
        ignored: [],
        verdict: blocked ? "blocked" : "rejected",
        why,
      });
      if (!blocked && /credit|quota|api key|401|403|429/i.test(why)) {
        return { status: "failed", summary: `shot ${shot.n} could not be bought from ${generator.provider}: ${why}`, kept, takes, charged, measured };
      }
    }
  }

  const ignored = takes.flatMap((t) => t.ignored);
  const lost = takes.filter((t) => t.verdict !== "kept");
  const got = Object.keys(kept).length;
  return {
    status: got === 0 ? "failed" : cached === got ? "cached" : "done",
    summary:
      `${got}/${wanted.length} shots · ${cached} from disk · $${charged.toFixed(2)} committed` +
      (lost.length > 0 ? ` · ${lost.length} not kept` : "") +
      (ignored.length > 0 ? ` · things this model could not do: ${ignored.length}` : ""),
    kept,
    takes,
    charged,
    measured,
  };
}

/*
  Cut the shot to what the clip can actually carry.

  The board wrote an in-point and a hold before anything was bought, which is a guess about
  a model's behaviour — and the first measurement this repository made overturned the guess
  it was written to confirm. So the numbers on the board are provisional until a clip
  exists, and then they come from the file: the longest run of frames that is still the
  product, wherever in the clip that run happens to be.

  A shot whose honest window is shorter than its hold is SHORTENED rather than failed. The
  alternative is holding a frame the model drew for the difference, and a shorter cut is
  always the better of those two.
*/
async function conform(shot: Shot, clip: string, first: string, last: string | undefined, boardFps: number, out: string[]): Promise<void> {
  const gen = shot.gen;
  if (!gen) return;
  /*
    Two frame rates, and mixing them is a silent quarter-length error.

    The clip's own rate is whatever the model returned — Veo hands back 24 fps whatever the
    board is cut at — and the drift measurement counts frames in THAT clock. Everything
    written back onto the shot is in the BOARD's clock, because that is what the cut runs on.
    Seconds are the only currency the two share, so the conversion happens here, once.
  */
  const clipFps = await fpsOf(clip);
  const drift = await driftOf(clip, { first, ...(last ? { last } : {}) }, { seconds: gen.seconds, fps: clipFps }).catch(() => null);
  if (!drift) return;
  const wanted = shot.duration / boardFps;
  const verdict = driftCheck(drift, wanted);
  out.push(`shot ${shot.n}: ${verdict.say}`);
  gen.inPoint = Math.round(drift.best.from * boardFps);
  if (!verdict.ok) shot.duration = Math.max(1, Math.round(drift.best.seconds * boardFps));
}
