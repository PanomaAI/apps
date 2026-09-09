/*
  The picture, measured on the encoded file in one ffmpeg pass. Four filters ride the
  same decode and every one of them exists because of a failure the renderer cannot
  see from the inside:

  - blackdetect: a black run is a rasterizer that returned nothing for a beat, or a
    fade that was meant to be two frames and became twelve.
  - freezedetect: a frozen run is a stalled screenshot pipe — unless the caller
    declared it (a tutorial holds the picture while the narrator finishes; that hold is
    a decision and is passed in as one).
  - scdet: the cut list the grid planned is compared with the cuts the *file* has. A
    planned cut that scdet cannot see did not land; a cut scdet sees that nobody
    planned is a glitch frame.
  - signalstats YDIF: the mean absolute luma difference to the previous frame, the
    cleanest duplicate-frame signal ffmpeg has (QCTools uses it for the same job).

  Thresholds follow the ffmpeg filter documentation (https://ffmpeg.org/ffmpeg-filters.html)
  as chosen in the QA research: black ≥ 0.1 s at pixel threshold 0.10, frozen ≥ 1 s at
  -60 dB noise, scene score ≥ 10 (the documented useful range is 8-14).
*/
import type { Hold, ReviewCheck } from "./types.ts";
import { NO_FIX, reportFix } from "./types.ts";
import type { Probe } from "./probe.ts";
import { ffmpegFrames } from "./exec.ts";

export type VideoOptions = {
  /** Seconds where the grid placed a cut; each must exist in the file (±1 frame). */
  plannedCuts?: number[];
  /** Spans where a still picture is intentional. */
  declaredHolds?: Hold[];
  /** The recipe name, when known; tutorials and screen demos get a slower ASL floor. */
  recipe?: string;
};

export type Run = { from: number; to: number };

export type VideoAnalysis = {
  checks: ReviewCheck[];
  /** Seconds where scdet scored ≥ SCENE_SCORE. */
  cuts: number[];
  blackRuns: Run[];
  freezes: Run[];
  duplicates: Run[];
  firstFrameYavg?: number;
};

/* Filter thresholds; the sources are in the header comment. */
export const BLACK_MIN_SECONDS = 0.1;
export const BLACK_PIXEL_THRESHOLD = 0.1;
export const FREEZE_NOISE_DB = -60;
export const FREEZE_MIN_SECONDS = 1;
export const SCENE_SCORE = 10;
/* YDIF is the mean |ΔY| over the plane in 8-bit code values; below 0.5 the frame is a
   repeat to the eye (QA research, finding 11 — signalstats documentation). */
export const DUPLICATE_YDIF = 0.5;
export const DUPLICATE_MIN_SECONDS = 1;
/* blackdetect's "black pixel": luma below luma_min + pix_th × luma_range, which for
   limited-range 8-bit video is 16 + 0.10 × 219 ≈ 38. Applied to the first frame's mean. */
/*
  Why the picture checks warn and never fail (decision of 2026-09-01): a dark
  interface on a dark backdrop is 98% "black" to blackdetect's luma threshold and
  is the most common product there is; a page that does not move under a slow camera
  is "frozen" to freezedetect; the first frame of a piece whose window arrives over
  a beat is dark by design. All three are real signals worth reading, and none is
  proof of a defect. "Fail" is reserved for what needs no interpretation — a planned
  hard cut the file does not show, conformance, true peak.
*/
export const FIRST_FRAME_BLACK_YAVG = 16 + BLACK_PIXEL_THRESHOLD * 219;
/* Cut density is a house heuristic on Cutting, DeLong & Nothelfer 2010 (shot lengths
   in 150 films; social clips run 1-2 s a shot): more than 5 cuts in any 5 s window is
   an ASL under a second. A tutorial or screen demo asks the viewer to read, so its
   floor is 2 s. https://jordandelong.com/pubs/2010/AttentionEvolution.pdf */
export const DENSITY_WINDOW_SECONDS = 5;
export const DENSITY_MAX_CUTS_PER_WINDOW = 5;
export const READING_RECIPES = ["tutorial", "screendemo", "screencast"];
export const READING_MIN_ASL = 2;

const FFMPEG_DOCS = "https://ffmpeg.org/ffmpeg-filters.html";
const DENSITY_SOURCE = "house rule after Cutting, DeLong & Nothelfer 2010, https://jordandelong.com/pubs/2010/AttentionEvolution.pdf";

const fmt = (s: number) => `${s.toFixed(2)} s`;

function at(seconds: number[], fps: number) {
  return seconds.map((s) => ({ seconds: Number(s.toFixed(3)), frame: Math.round(s * fps) }));
}

/** Seconds of `run` that no declared hold covers. */
export function uncovered(run: Run, holds: readonly Hold[]): number {
  let covered = 0;
  for (const h of holds) {
    const lo = Math.max(run.from, Math.min(h.from, h.to));
    const hi = Math.min(run.to, Math.max(h.from, h.to));
    if (hi > lo) covered += hi - lo;
  }
  return Math.max(0, run.to - run.from - covered);
}

/** Frames with YDIF below the duplicate threshold, grouped into runs of seconds. */
export function duplicateRuns(frames: { t: number; ydif: number }[], fps: number): Run[] {
  const runs: Run[] = [];
  let start: number | undefined;
  for (let i = 0; i < frames.length; i++) {
    const dup = frames[i].ydif < DUPLICATE_YDIF;
    if (dup && start === undefined) start = frames[i].t;
    if (!dup && start !== undefined) {
      runs.push({ from: start, to: frames[i].t });
      start = undefined;
    }
  }
  if (start !== undefined && frames.length) runs.push({ from: start, to: frames[frames.length - 1].t + 1 / fps });
  return runs.filter((r) => r.to - r.from > DUPLICATE_MIN_SECONDS);
}

/** Cut-density findings on a cut list; exported so the planner can run it before rendering. */
export function densityChecks(cuts: readonly number[], seconds: number, fps: number, recipe?: string): ReviewCheck[] {
  const sorted = [...cuts].sort((a, b) => a - b);
  const checks: ReviewCheck[] = [];
  let worst: { from: number; count: number } | undefined;
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] < sorted[i] + DENSITY_WINDOW_SECONDS) j++;
    const count = j - i + 1;
    if (!worst || count > worst.count) worst = { from: sorted[i], count };
  }
  const dense = worst !== undefined && worst.count > DENSITY_MAX_CUTS_PER_WINDOW ? worst : undefined;
  checks.push({
    id: "video.density",
    status: dense ? "warn" : "pass",
    summary: dense
      ? `under a second a shot — merge beats or slow the grid; cuts inside the ${DENSITY_WINDOW_SECONDS} s window starting at ${fmt(dense.from)}: ${dense.count}`
      : `cuts in the busiest ${DENSITY_WINDOW_SECONDS} s window (limit ${DENSITY_MAX_CUTS_PER_WINDOW}): ${worst?.count ?? 0}`,
    threshold: `≤ ${DENSITY_MAX_CUTS_PER_WINDOW} cuts in any ${DENSITY_WINDOW_SECONDS} s window`,
    source: DENSITY_SOURCE,
    ...(dense ? { at: at([dense.from], fps) } : {}),
    fix: dense
      ? {
          by: "plan",
          hint: `merge beats or slow the grid until no ${DENSITY_WINDOW_SECONDS} s window holds more than ${DENSITY_MAX_CUTS_PER_WINDOW} cuts; the worst window starts at ${fmt(dense.from)}`,
          args: { from: dense.from, windowSeconds: DENSITY_WINDOW_SECONDS, cuts: dense.count, maxCuts: DENSITY_MAX_CUTS_PER_WINDOW },
        }
      : NO_FIX,
  });
  if (recipe && READING_RECIPES.includes(recipe.toLowerCase())) {
    const asl = seconds / (sorted.length + 1);
    const fast = asl < READING_MIN_ASL;
    checks.push({
      id: "video.asl",
      status: fast ? "warn" : "pass",
      summary: fast
        ? `${recipe} averages ${asl.toFixed(1)} s a shot; a viewer following instructions needs ${READING_MIN_ASL} s or more`
        : `${recipe} averages ${asl.toFixed(1)} s a shot`,
      threshold: `average shot length ≥ ${READING_MIN_ASL} s for ${READING_RECIPES.join("/")}`,
      source: DENSITY_SOURCE,
      fix: fast
        ? {
            by: "plan",
            hint: `merge steps or slow the grid until ${recipe} averages ${READING_MIN_ASL} s a shot`,
            args: { averageShotSeconds: Number(asl.toFixed(2)), minSeconds: READING_MIN_ASL },
          }
        : NO_FIX,
    });
  }
  return checks;
}

/** Compare the cuts the grid planned with the cuts scdet found in the file. */
export function cutChecks(found: readonly number[], planned: readonly number[] | undefined, fps: number, scores: Map<number, number>): ReviewCheck[] {
  const tolerance = 1 / fps + 1e-3;
  if (!planned) {
    return [
      {
        id: "video.cuts",
        status: "pass",
        summary: `no plan was given to compare against; cuts scdet found: ${found.length}`,
        threshold: `scene score ≥ ${SCENE_SCORE}`,
        source: FFMPEG_DOCS,
        details: { found },
        fix: NO_FIX,
      },
    ];
  }
  const missing = planned.filter((p) => !found.some((f) => Math.abs(f - p) <= tolerance));
  const unplanned = found.filter((f) => !planned.some((p) => Math.abs(f - p) <= tolerance));
  const nearest = (p: number) => {
    let best = 0;
    for (const [t, s] of scores) if (Math.abs(t - p) <= tolerance && s > best) best = s;
    return best;
  };
  const checks: ReviewCheck[] = [
    {
      id: "video.cuts.planned",
      /* A jump under a dimmed card scores under scdet's threshold; a plan and a measurement disagreeing is a warning, not a defect a viewer sees. */
      status: missing.length ? "warn" : "pass",
      summary: missing.length
        ? `planned cuts not visible in the file — the scenes on both sides look the same or the cut moved (best scores ${missing.map((p) => `${fmt(p)}: ${nearest(p).toFixed(1)}`).join(", ")}): ${missing.length}`
        : `every planned cut lands within a frame of its beat, ${planned.length} in all`,
      threshold: `scdet score ≥ ${SCENE_SCORE} within ±1 frame of each planned cut`,
      source: FFMPEG_DOCS,
      ...(missing.length ? { at: at(missing, fps) } : {}),
      fix: missing.length
        ? reportFix("video.cuts.planned", `the renderer did not draw a visible cut where the plan has one (${missing.map(fmt).join(", ")})`, { missing })
        : NO_FIX,
    },
    {
      id: "video.cuts.unplanned",
      status: unplanned.length ? "warn" : "pass",
      summary: unplanned.length
        ? `scene changes nobody planned — a glitch frame, a heavy transition, or a beat missing from the plan (${unplanned.map(fmt).join(", ")}): ${unplanned.length}`
        : "no scene change outside the plan",
      threshold: `no scdet score ≥ ${SCENE_SCORE} away from a planned cut`,
      source: FFMPEG_DOCS,
      ...(unplanned.length ? { at: at(unplanned, fps) } : {}),
      fix: unplanned.length
        ? reportFix("video.cuts.unplanned", `a glitch frame or a transition scdet reads as a cut (${unplanned.map(fmt).join(", ")})`, { unplanned })
        : NO_FIX,
    },
  ];
  return checks;
}

/** One decode, four filters, the checks. */
export async function analyseVideo(probe: Probe, opts: VideoOptions = {}): Promise<VideoAnalysis> {
  const video = probe.video;
  if (!video) throw new Error(`${probe.file}: no video stream`);
  const { fps } = video;
  const holds = opts.declaredHolds ?? [];

  const blackRuns: Run[] = [];
  const freezes: Run[] = [];
  const ydifs: { t: number; ydif: number }[] = [];
  const scores = new Map<number, number>();
  let openBlack: number | undefined;
  let openFreeze: number | undefined;
  let firstFrameYavg: number | undefined;

  const graph =
    `blackdetect=d=${BLACK_MIN_SECONDS}:pix_th=${BLACK_PIXEL_THRESHOLD},` +
    `freezedetect=n=${FREEZE_NOISE_DB}dB:d=${FREEZE_MIN_SECONDS},` +
    `scdet=t=${SCENE_SCORE},signalstats,metadata=mode=print:file=-`;
  await ffmpegFrames(["-loglevel", "error", "-i", probe.file, "-an", "-sn", "-vf", graph, "-f", "null", "-"], (f) => {
    const t = f.tags;
    if (firstFrameYavg === undefined && t["lavfi.signalstats.YAVG"] !== undefined) firstFrameYavg = Number(t["lavfi.signalstats.YAVG"]);
    if (t["lavfi.black_start"] !== undefined) openBlack = Number(t["lavfi.black_start"]);
    if (t["lavfi.black_end"] !== undefined && openBlack !== undefined) {
      blackRuns.push({ from: openBlack, to: Number(t["lavfi.black_end"]) });
      openBlack = undefined;
    }
    /* freezedetect stamps freeze_start on the frame where the run reaches `d`
       seconds, with the real start as its value; the end comes on the frame after. */
    if (t["lavfi.freezedetect.freeze_start"] !== undefined) openFreeze = Number(t["lavfi.freezedetect.freeze_start"]);
    if (t["lavfi.freezedetect.freeze_end"] !== undefined && openFreeze !== undefined) {
      freezes.push({ from: openFreeze, to: Number(t["lavfi.freezedetect.freeze_end"]) });
      openFreeze = undefined;
    }
    if (t["lavfi.scd.score"] !== undefined) {
      const score = Number(t["lavfi.scd.score"]);
      if (score >= SCENE_SCORE) scores.set(f.ptsTime, score);
    }
    if (t["lavfi.signalstats.YDIF"] !== undefined) ydifs.push({ t: f.ptsTime, ydif: Number(t["lavfi.signalstats.YDIF"]) });
  });
  /* Runs still open at the end of the stream run to the end of the file. */
  if (openBlack !== undefined) blackRuns.push({ from: openBlack, to: probe.seconds });
  if (openFreeze !== undefined) freezes.push({ from: openFreeze, to: probe.seconds });

  const cuts = [...scores.keys()].sort((a, b) => a - b);
  const duplicates = duplicateRuns(ydifs, fps).filter((r) => uncovered(r, holds) > DUPLICATE_MIN_SECONDS);
  const checks: ReviewCheck[] = [];

  const edge = 1 / fps;
  const internalBlack = blackRuns.filter((r) => r.from > edge && r.to < probe.seconds - edge && uncovered(r, holds) > 0);
  const edgeBlack = blackRuns.filter((r) => !internalBlack.includes(r) && uncovered(r, holds) > 0);
  checks.push({
    id: "video.black",
    status: internalBlack.length ? "warn" : edgeBlack.length ? "warn" : "pass",
    summary: internalBlack.length
      ? `black for ${internalBlack.map((r) => `${fmt(r.to - r.from)} at ${fmt(r.from)}`).join(", ")} in the middle of the piece; a scene rendered nothing or a fade overran its beat`
      : edgeBlack.length
        ? `black at the ${edgeBlack.map((r) => (r.from <= edge ? `head (${fmt(r.to - r.from)})` : `tail (${fmt(r.to - r.from)})`)).join(" and ")}; a fade or slate — declare it as a hold if intended`
        : "no black frames",
    threshold: `no run ≥ ${BLACK_MIN_SECONDS} s with ≥ 98% of pixels under luma threshold ${BLACK_PIXEL_THRESHOLD}`,
    source: FFMPEG_DOCS,
    ...(internalBlack.length || edgeBlack.length ? { at: at([...internalBlack, ...edgeBlack].map((r) => r.from), fps) } : {}),
    fix: internalBlack.length
      ? {
          by: "record",
          hint: "re-shoot the take so the picture never goes black, or declare the span as a hold if the black is intended",
          args: { holds: internalBlack },
        }
      : edgeBlack.length
        ? {
            by: "record",
            hint: "declare the fade as a hold if it is intended, or re-shoot without it",
            args: { holds: edgeBlack },
          }
        : NO_FIX,
  });

  /* freezedetect only reports runs of at least FREEZE_MIN_SECONDS, so an undeclared
     one is that long by construction; the frame of slack absorbs pts rounding. */
  const frozen = freezes.filter((r) => uncovered(r, holds) >= FREEZE_MIN_SECONDS - 1 / fps);
  checks.push({
    id: "video.frozen",
    status: frozen.length ? "warn" : "pass",
    summary: frozen.length
      ? `the picture freezes for ${frozen.map((r) => `${fmt(r.to - r.from)} at ${fmt(r.from)}`).join(", ")} outside any declared hold; a stalled capture, or a hold the plan did not declare`
      : freezes.length
        ? `frozen spans, all inside declared holds: ${freezes.length}`
        : "the picture never freezes",
    threshold: `no undeclared run ≥ ${FREEZE_MIN_SECONDS} s below ${FREEZE_NOISE_DB} dB frame difference`,
    source: FFMPEG_DOCS,
    ...(frozen.length ? { at: at(frozen.map((r) => r.from), fps) } : {}),
    fix: frozen.length
      ? {
          by: "record",
          hint: "re-shoot with more footage between the marks, or declare the span as a hold if the still picture is intended",
          args: { holds: frozen },
        }
      : NO_FIX,
  });

  checks.push({
    id: "video.duplicates",
    status: duplicates.length ? "warn" : "pass",
    summary: duplicates.length
      ? `near-identical frames for ${duplicates.map((r) => `${fmt(r.to - r.from)} at ${fmt(r.from)}`).join(", ")} (YDIF < ${DUPLICATE_YDIF}); the source repeats frames or the animation stalled`
      : "no duplicate-frame runs",
    threshold: `no undeclared run > ${DUPLICATE_MIN_SECONDS} s with signalstats YDIF < ${DUPLICATE_YDIF}`,
    source: FFMPEG_DOCS,
    ...(duplicates.length ? { at: at(duplicates.map((r) => r.from), fps) } : {}),
    fix: duplicates.length
      ? {
          by: "record",
          hint: "re-shoot so the source keeps moving, or declare the span as a hold if the still picture is intended",
          args: { holds: duplicates },
        }
      : NO_FIX,
  });

  const firstBlack = firstFrameYavg !== undefined && firstFrameYavg < FIRST_FRAME_BLACK_YAVG;
  checks.push({
    id: "video.firstframe",
    status: firstBlack ? "warn" : "pass",
    summary: firstBlack
      ? `the first frame is black (mean luma ${firstFrameYavg?.toFixed(0)}); feeds show it as the poster, so open on the picture and fade the audio instead`
      : `the first frame shows a picture (mean luma ${firstFrameYavg?.toFixed(0) ?? "?"})`,
    threshold: `first-frame mean luma ≥ ${FIRST_FRAME_BLACK_YAVG.toFixed(0)} (blackdetect's pixel threshold on limited range)`,
    source: FFMPEG_DOCS,
    ...(firstBlack ? { at: at([0], fps) } : {}),
    fix: firstBlack
      ? {
          by: "record",
          hint: "re-shoot or retime so the first frame shows the picture; the poster frame cannot be declared as a hold",
        }
      : NO_FIX,
  });

  checks.push(...cutChecks(cuts, opts.plannedCuts, fps, scores));
  checks.push(...densityChecks(opts.plannedCuts ?? cuts, probe.seconds, fps, opts.recipe));

  return { checks, cuts, blackRuns, freezes, duplicates, firstFrameYavg };
}
