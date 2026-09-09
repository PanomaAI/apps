/*
  What a composition MEANT to do, written down for the review.

  A reviewer that only sees pixels cannot tell a hold from a freeze, a flash-enter from
  a strobe, or a dissolve from a cut it was not told about — and a gate that fails
  correct videos stalls the automatic path this whole design exists for. So every
  recipe declares its plan: where the cuts are and what kind they are, which spans
  hold a frame on purpose, which spans fade to black or white, which spans are cards.
  The review subtracts the declared before it judges the measured, and reserves
  "fail" for what needs no plan at all.
*/

import type { EditorialTheme, PromoClose } from "./brief.ts";

export type PlannedCut = { frame: number; kind: "cut" | "whip" | "flash" | "dissolve" };

export type RenderPlan = {
  recipe: string;
  /** One editorial system for every added piece; legacy promotional plans are Flat. */
  editorialTheme?: EditorialTheme;
  /** Exact sourced closing decision rendered for a newly planned promotion. */
  promoClose?: PromoClose;
  /** The language actually laid out in this composition, when its cards are audited. */
  lang?: string;
  fps: number;
  durationInFrames: number;
  beats: { beatFrames: number; barFrames: number; start: number };
  cuts: PlannedCut[];
  /** Frames where the picture holds still on purpose, with the reason. */
  holds: { from: number; to: number; why: string }[];
  /*
    How much of each step ran out of footage, measured by the recipe that laid it out.

    A tutorial holds on purpose — the settle after a press is the thing a viewer reads —
    and it also holds by accident, when the recording gave a step less picture than its
    sentence needed. Only the recipe can tell those apart: it knows where the footage
    stopped advancing (`holdFrom`) as distinct from where the step decided to be still.
    The story check used to infer it from the declared holds and the cuts around them,
    which stopped being possible the day a step gained a title card and a second cut.
  */
  stalls?: { mark: string; share: number }[];
  fades: { from: number; to: number; into: "black" | "white" }[];
  /** Dedicated type spans. readFrom excludes their finite entrance from the reading hold. */
  cards: { from: number; to: number; readFrom?: number; text?: string; id?: string }[];
  /** Copy outside full cards. readFrom starts once all of its characters have arrived. */
  texts?: { id: string; from: number; to: number; readFrom?: number; text?: string; kind: "split" | "recap" | "terminal" | "code" }[];
  /** Spoken lines, when the piece is voiced. */
  voice?: { id: string; from: number; to: number }[];
  /** The narration's claims, by line id, for the provenance. */
  marks?: { name: string; frame: number }[];
  /** Visible causal demonstrations in a promo, in composition frames. */
  uses?: { id: string; mark: string; from: number; to: number; actionFrame: number; resultFrame: number; evidence: string[]; treatment?: "full" | "focus" | "split" }[];
};

/** Seconds of a frame, for reports that speak in time. */
export function secondsOf(frame: number, fps: number): number {
  return Math.round((frame / fps) * 1000) / 1000;
}
