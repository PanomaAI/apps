/*
  What a set of films is FOR, and which of them a product has earned.

  Until this file existed, a project's pieces were chosen by `resolveGoals` — trailer,
  spotlight, tutorial, sitetour, facts — and every one of them rendered into all three
  canvases, in all its languages, for all its hooks. That is why two web applications
  received the same five films in the same order at the same lengths: the goal answers
  "what is there to show", and nothing answered "who is this for, and where does it go".

  A JOB answers the second question. It carries an objective, the canvases it is
  published in, the length its genre runs to, and — this is the part that is not
  decoration — the EVIDENCE behind those numbers. `docs/playbook.md` records that the
  field's duration figures did not survive a search for primary sources, so a job that
  reuses one says `hypothesis` out loud and the report prints it beside the number. A
  plan that quietly borrowed them would be claiming evidence it does not have.

  Nothing here reads a clock, a disk or a model. It is arithmetic over what the tour
  walked and the capture caught, so `--brain=none` produces the same campaign.
*/
import type { FormatId } from "./format.ts";
import type { Goal } from "./story.ts";

export type Objective = "announce" | "convert" | "retain" | "reach";

export type JobName = "sell" | "announce" | "prove" | "teach" | "stop" | "loop" | "still";

/** Where a number came from. `measured` on this disk, `own-rule` from the house, `hypothesis` from the field's folklore. */
export type Evidence = "measured" | "own-rule" | "hypothesis";

export type Job = {
  name: JobName;
  objective: Objective;
  /** The canvases this job is published in. A vertical-only job never renders a 1920x1080 nobody will post. */
  formats: readonly FormatId[];
  /** What the piece opens on, in the words the report prints. */
  opening: string;
  /** The genre's length, in seconds; absent when the piece's own material sets it. */
  seconds?: { min: number; max: number };
  evidence: Evidence;
};

export const JOBS: Record<JobName, Job> = {
  sell: {
    name: "sell",
    objective: "convert",
    formats: ["v", "h"],
    opening: "a supported promise or its visible result, before the explanation",
    evidence: "own-rule",
  },
  announce: {
    name: "announce",
    objective: "announce",
    formats: ["h", "v", "s"],
    opening: "the name, inside five seconds",
    evidence: "measured",
  },
  prove: {
    name: "prove",
    objective: "convert",
    formats: ["h", "v"],
    opening: "the pixels the use changed",
    seconds: { min: 20, max: 26 },
    evidence: "measured",
  },
  teach: {
    name: "teach",
    objective: "retain",
    formats: ["h", "v"],
    opening: "the first step",
    evidence: "own-rule",
  },
  stop: {
    name: "stop",
    objective: "reach",
    formats: ["v"],
    opening: "the control, pressed inside the first bar; then the name",
    seconds: { min: 8, max: 15 },
    evidence: "hypothesis",
  },
  loop: {
    name: "loop",
    objective: "reach",
    formats: ["v", "s"],
    opening: "mid-motion",
    seconds: { min: 4, max: 10 },
    evidence: "hypothesis",
  },
  still: {
    name: "still",
    objective: "convert",
    formats: [],
    opening: "one frame",
    evidence: "own-rule",
  },
};

/** The job each goal already serves. A goal is what there is to show; a job is who it is shown to. */
export const JOB_OF: Record<Goal, JobName> = {
  promo: "sell",
  trailer: "announce",
  sitetour: "announce",
  facts: "announce",
  changelog: "announce",
  spotlight: "prove",
  tutorial: "teach",
};

/** A control the capture caught at macro scale, with what its press changed. */
export type Press = {
  mark: string;
  /** Whether the capture holds the control's own after-state, not just the page's. */
  afterControl: boolean;
  /** Share of the viewport the press changed, as the capture measured it. */
  changeShare: number;
};

/**
 * The least a press must change for a piece to be built out of that change alone. Below
 * it there is a cut with nothing in it: the reference films' shortest form is a state
 * change big enough to read at a glance on a phone.
 */
export const STOP_CHANGE_LEAST = 0.02;

export type PlannedJob = {
  job: JobName;
  /** The goal whose brief carries it; absent for a job with a brief of its own. */
  goal?: Goal;
  formats: readonly FormatId[];
  why: string;
};

export type SkippedJob = { job: JobName; unlock: string };

/**
 * Which jobs this product has earned, and what would unlock each one it has not.
 *
 * `stop` is the only job with a brief of its own, and it is a `params` variant of the
 * spotlight rather than a new recipe: same footage, same facts, one control, cut for a
 * feed. `loop` and `still` are booked — see the unlock each of them names.
 */
export function planCampaign(input: { goals: readonly Goal[]; presses: readonly Press[] }): { make: PlannedJob[]; skip: SkippedJob[] } {
  const make: PlannedJob[] = [];
  const skip: SkippedJob[] = [];
  const seen = new Set<JobName>();

  for (const goal of input.goals) {
    const job = JOB_OF[goal];
    if (!job) continue;
    make.push({ job, goal, formats: JOBS[job].formats, why: `the ${goal} serves it` });
    seen.add(job);
  }

  if (!seen.has("sell")) {
    skip.push({ job: "sell", unlock: "a product action with a visible result in every take, a sourced benefit, and a destination URL" });
  }

  /* The presses a cut could be built from: the control's own after-state, and enough of the page changed to read. */
  const usable = input.presses.filter((p) => p.afterControl && p.changeShare > STOP_CHANGE_LEAST);
  const strongest = [...usable].sort((a, b) => b.changeShare - a.changeShare)[0];

  if (strongest && seen.has("prove")) {
    make.push({
      job: "stop",
      formats: JOBS.stop.formats,
      why: `"${strongest.mark}" changed ${(strongest.changeShare * 100).toFixed(1)}% of the viewport, and the capture holds the control's own after-state`,
    });
  } else if (!seen.has("prove")) {
    skip.push({ job: "stop", unlock: "a control whose press changes the interface: the spotlight it is cut from is what the tour has not found" });
  } else {
    skip.push({ job: "stop", unlock: `a press the capture caught at macro scale that changes more than ${(STOP_CHANGE_LEAST * 100).toFixed(0)}% of the viewport; the strongest here changes less` });
  }

  /*
    Booked, with the reason stated rather than the job quietly missing. A loop is not a
    short film: its first and last frames have to be congruent by construction, and a
    spotlight's camera comes to rest somewhere other than where it started. Trimming one
    to six seconds produces a cut that jumps at the seam — which is the defect the format
    exists to avoid.
  */
  skip.push({ job: "loop", unlock: "a cut whose last frame is congruent with its first: a press ping-ponged back to its before-state, which the capture holds but no recipe yet plays backwards" });
  skip.push({ job: "still", unlock: "a still pipeline: `panoma-video frame` cuts one out of a finished film, but nothing composes one" });

  return { make, skip };
}
