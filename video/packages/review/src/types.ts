/*
  The shapes every reviewer in this package speaks come from @panoma/video-core, the
  canonical copy shared with the director and the MCP server; every module here
  imports the names from this file, never from a literal, so the package has one
  place that says where they live. What stays local is the caller's own vocabulary:
  a declared hold, and the rule that turns a list of checks into a verdict.
*/
import type { ReviewCheck, ReviewFix } from "@panoma/video-core";

export type { ReviewCheck, ReviewFix, ReviewReport } from "@panoma/video-core";

export type ReviewStatus = ReviewCheck["status"];

/*
  What a check that passed, or that only informs, carries as its fix. Every check
  names a fixer so a reader never has to guess whether the field was forgotten:
  `by: "none"` is a statement, a missing `fix` would be a question.
*/
export const NO_FIX: ReviewFix = { by: "none", hint: "nothing to do" };

/*
  The fix when the limit belongs to the engine or the master — a true peak the
  limiter let through, a cut the renderer did not draw, a strobe the grid built. The
  same render with the same inputs gives the same number, so the hint says so and
  names the check to report, which is the one thing that stops an agent from trying.
*/
export function reportFix(id: string, why: string, args?: Record<string, unknown>): ReviewFix {
  return { by: "engine", hint: `${why}; re-rendering will not change it — report ${id}`, ...(args ? { args } : {}) };
}

/** A span of seconds the caller declares intentional (a held still, a fade). */
export type Hold = { from: number; to: number };

/** The worst status wins: fail > warn > pass; skips do not vote. */
export function overall(checks: readonly ReviewCheck[]): "pass" | "warn" | "fail" {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "pass";
}
