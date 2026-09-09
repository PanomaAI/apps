/*
  Photosensitivity. There is no free, maintained analyser to call: ffmpeg's
  `photosensitivity` filter is a mitigator whose "badness" follows no guideline (its
  own history says so), Trace's PEAT forbids commercial use, EA's IRIS is a C++/vcpkg
  build for a rule that fits in a page. So the rule is implemented here, on a 32×18
  grey grid streamed out of ffmpeg, and the report copies the *shape* broadcasters
  expect from HardingFPA (a per-second trace, a warning band, an extended-run warning)
  without copying a line of anything non-free.

  The rule, ITU-R BT.1702-3 (11/2023) Guideline 1 and Annex 2, which is also Ofcom's
  guidance and WCAG 2.3.1 in different units
  (https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1702-3-202311-I!!PDF-E.pdf,
  https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html):

  - a flash is a pair of opposing luminance changes of ≥ 20 cd/m² where the darker
    image is below 160 cd/m²;
  - a sequence fails when more than three flashes occur in any one-second period over
    more than 25% of the screen;
  - flashes whose leading edges are ≥ 9 frames apart (Ofcom, at 25 fps) or ≥ 334 ms
    apart (ITU, 60 Hz) are acceptable regardless of brightness or area;
  - a compliant flashing run longer than 5 s "might constitute a risk" (warn);
  - and, from EA IRIS (BSD-3-Clause, https://github.com/electronicarts/IRIS), the
    warning tier: 2–3 flashes a second sustained over 5 consecutive seconds.

  Units: Annex 2 assumes SDR peak white of 200 cd/m², so a grey value is linearised
  with the sRGB curve to relative luminance and multiplied by 200. A 20 cd/m² step is
  then a 0.10 change in relative luminance — WCAG's own threshold — so one detector
  serves both standards.
*/
import type { ReviewCheck } from "./types.ts";
import { NO_FIX, reportFix } from "./types.ts";
import type { Probe } from "./probe.ts";
import { ffmpegBlocks } from "./exec.ts";

export const GRID = { columns: 32, rows: 18 } as const;
export const CELLS = GRID.columns * GRID.rows;
/** BT.1702-3 Annex 2: SDR peak white. */
export const SDR_PEAK_NITS = 200;
/** BT.1702-3 Guideline 1: the harmful luminance step, and the ceiling for its darker side. */
export const FLASH_STEP_NITS = 20;
export const DARK_SIDE_MAX_NITS = 160;
/** More than this many flashes in any 1 s window, over more than this share of cells, fails. */
export const MAX_FLASHES_PER_SECOND = 3;
export const AREA_LIMIT = 0.25;
/** Ofcom: leading edges ≥ 9 frames apart at 25 fps; ITU: ≥ 334 ms at 60 Hz. */
export const EXEMPT_GAP_FRAMES_LOW_FPS = 9;
export const EXEMPT_GAP_SECONDS = 0.334;
export const LOW_FPS_MAX = 25;
/** IRIS warning tier and BT.1702's "longer than 5 s" note. */
export const SUSTAINED_SECONDS = 5;
export const WARN_FLASHES_LOW = 2;

export type FlashTrace = { second: number; areaFlashing: number; flashes: number };

export type FlashAnalysis = {
  checks: ReviewCheck[];
  trace: FlashTrace[];
  frames: number;
};

const ITU = "ITU-R BT.1702-3 Guideline 1 / WCAG 2.3.1, https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1702-3-202311-I!!PDF-E.pdf";
const IRIS = "EA IRIS warning tier (BSD-3-Clause), https://github.com/electronicarts/IRIS; BT.1702-3 §5 s note";

/** Grey code → cd/m²: sRGB linearisation (IEC 61966-2-1) scaled to SDR peak white. */
export const NITS: Float64Array = (() => {
  const lut = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    const linear = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    lut[i] = linear * SDR_PEAK_NITS;
  }
  return lut;
})();

/** Frames between leading edges below which two flashes count as successive. */
export function exemptGapFrames(fps: number): number {
  return fps <= LOW_FPS_MAX ? EXEMPT_GAP_FRAMES_LOW_FPS : Math.ceil(EXEMPT_GAP_SECONDS * fps - 1e-9);
}

/**
  Per-cell transition tracker. A transition fires when the luminance has moved
  ≥ FLASH_STEP_NITS away from the last extreme in the direction opposite to the last
  transition (or in any direction for the first), with the darker of the two below
  DARK_SIDE_MAX_NITS. Extremes extend while the picture keeps moving the same way, so
  a slow ramp is one change measured between its ends, as the standard intends.
*/
export class CellTracker {
  extreme: number;
  direction: -1 | 0 | 1 = 0;
  /** Frame indices of transitions, in order; even indices are flash leading edges. */
  transitions: number[] = [];

  constructor(first: number) {
    this.extreme = first;
  }

  push(frame: number, nits: number): void {
    const delta = nits - this.extreme;
    if (this.direction !== 0 && Math.sign(delta) === this.direction) {
      this.extreme = nits;
      return;
    }
    if (Math.abs(delta) >= FLASH_STEP_NITS && Math.min(nits, this.extreme) < DARK_SIDE_MAX_NITS) {
      this.transitions.push(frame);
      this.direction = delta > 0 ? 1 : -1;
      this.extreme = nits;
    } else if (this.direction === 0 && Math.abs(delta) >= FLASH_STEP_NITS) {
      /* Both sides bright (≥ 160 cd/m²): not a flash in SDR, but a new baseline. */
      this.extreme = nits;
    }
  }

  /** Frame indices of flash leading edges (the first transition of each opposing pair). */
  leadingEdges(): number[] {
    const edges: number[] = [];
    for (let i = 0; i + 1 < this.transitions.length; i += 2) edges.push(this.transitions[i]);
    return edges;
  }
}

/**
  Count flashes per cell in the 1 s window starting at `start` (frames, half-open),
  honouring the exemption: a run of flashes whose consecutive leading edges are all
  ≥ `gap` frames apart is acceptable and counts as none.
*/
export function flashesInWindow(edges: readonly number[], start: number, windowFrames: number, gap: number): number {
  let count = 0;
  let previous: number | undefined;
  let allSpaced = true;
  for (const e of edges) {
    if (e < start) continue;
    if (e >= start + windowFrames) break;
    if (previous !== undefined && e - previous < gap) allSpaced = false;
    previous = e;
    count++;
  }
  return count > 1 && allSpaced ? 0 : count;
}

/** The rule applied to a sequence of grey frames; exported for tests with synthetic frames. */
export function judge(frames: readonly Uint8Array[], fps: number): FlashAnalysis {
  const total = frames.length;
  const windowFrames = Math.max(1, Math.round(fps));
  const gap = exemptGapFrames(fps);
  const trackers: CellTracker[] = [];
  for (let c = 0; c < CELLS; c++) trackers.push(new CellTracker(NITS[frames[0]?.[c] ?? 0]));
  for (let f = 1; f < total; f++) {
    const frame = frames[f];
    for (let c = 0; c < CELLS; c++) trackers[c].push(f, NITS[frame[c]]);
  }
  const edges = trackers.map((t) => t.leadingEdges());

  /* Per window: share of cells over the fail count, in the warning band, and flashing at all. */
  type Window = { start: number; areaFail: number; areaWarn: number; areaAny: number; quorum: number };
  const windows: Window[] = [];
  for (let start = 0; start < total; start++) {
    let fail = 0;
    let warn = 0;
    let any = 0;
    const counts = new Array<number>(CELLS);
    for (let c = 0; c < CELLS; c++) {
      const n = edges[c].length ? flashesInWindow(edges[c], start, windowFrames, gap) : 0;
      counts[c] = n;
      if (n > MAX_FLASHES_PER_SECOND) fail++;
      if (n >= WARN_FLASHES_LOW) warn++;
      if (n >= 1) any++;
    }
    /* The largest flash count that more than AREA_LIMIT of the frame reaches. */
    const sorted = counts.slice().sort((a, b) => b - a);
    const quorum = sorted[Math.floor(CELLS * AREA_LIMIT)] ?? 0;
    windows.push({ start, areaFail: fail / CELLS, areaWarn: warn / CELLS, areaAny: any / CELLS, quorum });
  }

  const failing = windows.filter((w) => w.areaFail > AREA_LIMIT);
  const longestRun = (pick: (w: Window) => boolean) => {
    let best = { start: 0, length: 0 };
    let runStart = -1;
    for (let i = 0; i <= windows.length; i++) {
      const on = i < windows.length && pick(windows[i]);
      if (on && runStart < 0) runStart = i;
      if (!on && runStart >= 0) {
        if (i - runStart > best.length) best = { start: runStart, length: i - runStart };
        runStart = -1;
      }
    }
    return best;
  };
  /* A run of windows is measured by its first window's start; a window is a second
     long, so `length` windows cover length + windowFrames - 1 frames of flashing. */
  const span = (run: { length: number }) => (run.length ? (run.length + windowFrames - 1) / fps : 0);
  const sustained = longestRun((w) => w.areaWarn > AREA_LIMIT && w.areaFail <= AREA_LIMIT);
  const extended = longestRun((w) => w.areaAny > AREA_LIMIT);

  const trace: FlashTrace[] = [];
  for (let s = 0; s * windowFrames < total; s++) {
    const w = windows[s * windowFrames];
    trace.push({ second: s, areaFlashing: Number(w.areaAny.toFixed(3)), flashes: w.quorum });
  }

  const at = (frame: number) => ({ seconds: Number((frame / fps).toFixed(3)), frame });
  const checks: ReviewCheck[] = [];
  const worst = failing.reduce<Window | undefined>((a, w) => (!a || w.areaFail > a.areaFail ? w : a), undefined);
  /*
    Fail only when the failing windows form a run longer than a second and a half. A
    single window over the limit is what a fast scroll across a light-and-dark page
    produces — the letter of the rule, for one second, on a product video that scrolls
    — and it is reported as a warning with its second. A strobe that keeps going is
    the thing the rule exists for, and it fails. Decision of 2026-09-01, after the rule
    stopped panoma's own landing page.
  */
  const failRun = longestRun((w) => w.areaFail > AREA_LIMIT);
  const hard = worst !== undefined && span(failRun) > 1.5;
  checks.push({
    id: "flash.bt1702",
    status: hard ? "fail" : worst ? "warn" : "pass",
    summary: worst
      ? `flashing over ${(worst.areaFail * 100).toFixed(0)}% of the frame from ${(worst.start / fps).toFixed(2)} s, more than the limit of ${MAX_FLASHES_PER_SECOND} a second; space high-contrast cuts further apart (the exempt spacing, in frames: ${gap}) or dim one side of the transition — flashes a second over a quarter of the frame: ${worst.quorum}`
      : "no one-second window flashes more than three times over a quarter of the frame",
    threshold: `≤ ${MAX_FLASHES_PER_SECOND} flashes (≥ ${FLASH_STEP_NITS} cd/m² opposing changes, darker side < ${DARK_SIDE_MAX_NITS} cd/m²) in any 1 s over ≤ ${AREA_LIMIT * 100}% of the frame; leading edges ≥ ${gap} frames apart are exempt`,
    source: ITU,
    ...(failing.length ? { at: failing.slice(0, 8).map((w) => at(w.start)) } : {}),
    details: { trace },
    fix: worst
      ? reportFix("flash.bt1702", `the grid built this strobe by construction, from ${(worst.start / fps).toFixed(2)} s`, { from: worst.start / fps, exemptGapFrames: gap })
      : NO_FIX,
  });

  const sustainedHit = !worst && span(sustained) >= SUSTAINED_SECONDS;
  const extendedHit = !worst && !sustainedHit && span(extended) > SUSTAINED_SECONDS;
  checks.push({
    id: "flash.sustained",
    status: sustainedHit || extendedHit ? "warn" : "pass",
    summary: sustainedHit
      ? `flashing at ${WARN_FLASHES_LOW}-${MAX_FLASHES_PER_SECOND} a second over a quarter of the frame for ${span(sustained).toFixed(1)} s from ${(sustained.start / fps).toFixed(2)} s; compliant, but a risk when sustained — break the pattern`
      : extendedHit
        ? `flashing over a quarter of the frame for ${span(extended).toFixed(1)} s from ${(extended.start / fps).toFixed(2)} s; compliant, and BT.1702 notes runs over ${SUSTAINED_SECONDS} s may still be a risk`
        : "no sustained flashing",
    threshold: `no ${WARN_FLASHES_LOW}-${MAX_FLASHES_PER_SECOND} flashes/s over ${AREA_LIMIT * 100}% for ${SUSTAINED_SECONDS} s; no compliant flashing run > ${SUSTAINED_SECONDS} s`,
    source: IRIS,
    ...(sustainedHit ? { at: [at(sustained.start)] } : extendedHit ? { at: [at(extended.start)] } : {}),
    fix: sustainedHit
      ? reportFix("flash.sustained", `the pattern keeps flashing for ${span(sustained).toFixed(1)} s from ${(sustained.start / fps).toFixed(2)} s`, { from: sustained.start / fps, seconds: span(sustained) })
      : extendedHit
        ? reportFix("flash.sustained", `the pattern keeps flashing for ${span(extended).toFixed(1)} s from ${(extended.start / fps).toFixed(2)} s`, { from: extended.start / fps, seconds: span(extended) })
        : NO_FIX,
  });

  return { checks, trace, frames: total };
}

/** Stream the file through ffmpeg as 32×18 grey frames and apply the rule. */
export async function analyseFlash(probe: Probe): Promise<FlashAnalysis> {
  if (!probe.video) throw new Error(`${probe.file}: no video stream`);
  const frames: Uint8Array[] = [];
  await ffmpegBlocks(
    ["-i", probe.file, "-an", "-sn", "-vf", `scale=${GRID.columns}:${GRID.rows}:flags=area`, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    CELLS,
    (block) => frames.push(Uint8Array.from(block)),
  );
  return judge(frames, probe.video.fps);
}
