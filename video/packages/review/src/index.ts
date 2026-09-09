/*
  @panoma/video-review — the gate a rendered file must pass, measured on the final mp4.

  Evidence before delivery: every render returns a report, and a failing report blocks
  `launch`. The measurements are taken from the encoded file with ffmpeg and ffprobe,
  never from the renderer's own idea of what it produced, because every failure this
  package catches is one the renderer could not see from the inside: a black beat, a
  stalled screenshot pipe, a cut that did not land, a true peak born in the AAC encode,
  a strobe that a beat grid produced by construction.

  `reviewVideo` composes the six measurements; each lives in its own file and can be
  called alone (the planner runs `densityChecks` before a frame exists; the MCP server
  calls `frameAt` on its own).
*/
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { Hold, ReviewCheck, ReviewReport } from "./types.ts";
import { overall } from "./types.ts";
import { probe } from "./probe.ts";
import { analyseVideo } from "./video.ts";
import { analyseAudio } from "./audio.ts";
import { analyseFlash } from "./flash.ts";
import { conformance } from "./conformance.ts";

export type { ReviewCheck, ReviewFix, ReviewReport, ReviewStatus, Hold } from "./types.ts";
export { overall, NO_FIX, reportFix } from "./types.ts";
export { probe, moovBeforeMdat, parseRate } from "./probe.ts";
export type { Probe } from "./probe.ts";
export { analyseVideo, densityChecks, cutChecks, duplicateRuns, uncovered } from "./video.ts";
export type { VideoOptions, VideoAnalysis, Run } from "./video.ts";
export { analyseAudio, parseSilences } from "./audio.ts";
export type { AudioOptions, AudioAnalysis } from "./audio.ts";
export { analyseFlash, judge, CellTracker, flashesInWindow, exemptGapFrames, NITS, GRID, CELLS } from "./flash.ts";
export type { FlashAnalysis, FlashTrace } from "./flash.ts";
export { conformance, conformTo, youtubeBitrate, CONFORMANCE, TARGETS } from "./conformance.ts";
export type { Conformance, Target } from "./conformance.ts";
export { contactSheet, frameAt, selectExpression, SHEET_MAX_BYTES, SHEET_WIDTH } from "./sheet.ts";
export type { SheetOptions, Picture } from "./sheet.ts";
export { reportText } from "./report.ts";
export type { Detail } from "./report.ts";
export { FFMPEG, FFPROBE, hasFilter } from "./exec.ts";

export type ReviewOptions = {
  /** Platforms the cut is published to: youtube, shorts, tiktok, reels, x, linkedin. */
  targets?: string[];
  /** Seconds where the grid placed a cut; each must be visible in the file. */
  plannedCuts?: number[];
  /** Spans where a still picture is intentional (a tutorial hold, a fade). */
  declaredHolds?: Hold[];
  /** The recipe name; tutorials and screen demos get a slower shot-length floor. */
  recipe?: string;
  /** The cut is meant to have no sound. */
  expectSilent?: boolean;
};

/** Measure a rendered file and return the report; throws only when the file cannot be read at all. */
export async function reviewVideo(path: string, opts: ReviewOptions = {}): Promise<ReviewReport> {
  const file = resolve(path);
  if (!existsSync(file)) throw new Error(`${file}: no such file`);
  const p = await probe(file);
  if (!p.video) throw new Error(`${file}: no video stream to review`);

  /* Three decodes run side by side; each is a separate ffmpeg process and the
     machine has the cores. */
  const [video, audio, flash] = await Promise.all([
    analyseVideo(p, { plannedCuts: opts.plannedCuts, declaredHolds: opts.declaredHolds, recipe: opts.recipe }),
    analyseAudio(p, { expectSilent: opts.expectSilent }),
    analyseFlash(p),
  ]);

  const checks: ReviewCheck[] = [...video.checks, ...audio.checks, ...flash.checks, ...conformance(p, opts.targets ?? [])];
  return {
    file,
    renderedAt: statSync(file).mtime.toISOString(),
    status: overall(checks),
    measured: {
      seconds: p.seconds,
      width: p.video.width,
      height: p.video.height,
      fps: p.video.fps,
      lufs: audio.lufs,
      truePeak: audio.truePeak,
      lra: audio.lra,
      maxShortTerm: audio.maxShortTerm,
      cuts: video.cuts.length,
      encoder: p.video.encoder,
    },
    checks,
  };
}
export { driftOf, driftCheck, FAITHFUL_DB } from "./drift.ts";
export type { Drift, Window } from "./drift.ts";
export { groundOf, crushGround, GROUND_FLOOR, GROUND_TOLERANCE } from "./element.ts";
export type { GroundReport } from "./element.ts";
