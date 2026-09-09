/*
  A brief is the unit of content: one idea, written once, rendered many times.

  The brief does not know about frames, formats or voices — it states the message.
  A recipe turns (brief, format, grid) into a timeline; the asset pipeline turns the
  brief's lines into audio and pictures. Variants exist because virality is a search
  problem: you don't publish the hook you like, you publish three and let the feed vote.
*/

import type { JobName } from "./campaign.ts";

/** One editorial system for added graphics throughout a film; never product pixels. */
export type EditorialTheme = "flat" | "vibrant" | "block" | "grid";

/** The planner records exactly which sourced identity or destination closes a film. */
export type PromoClose =
  | { readonly kind: "destination"; readonly fact: string; readonly source: string }
  | { readonly kind: "brand"; readonly fact: string; readonly source: string; readonly reason: "no-public-destination" };

/** Creative choices over recorded proof; all frame arithmetic stays in the recipe. */
export type PromoDirection = {
  /** Omitted preserves the original URL close of stored briefs and revisions. */
  readonly close?: PromoClose;
  /** Shared by every hook, language and format. Omitted means the legacy flat system. */
  readonly theme?: EditorialTheme;
  readonly opening: "promise" | "result";
  readonly pace: "crisp" | "measured";
  /** The observed action and source facts supporting each hook or benefit line. */
  readonly evidence: Readonly<Record<string, { readonly mark: string; readonly facts: readonly string[] }>>;
  /** Choose the presentation of each benefit's actual demonstration. */
  readonly treatments?: Readonly<Record<string, "full" | "focus" | "split">>;
  /** Revisit the demonstrated benefits as a progressive list before the close. */
  readonly recap?: boolean;
  /** Source-only text inserts; `after` names the demonstrated benefit, never a time. */
  readonly inserts?: readonly { readonly kind: "terminal" | "code"; readonly line: string; readonly after: string }[];
};

export type Line = {
  readonly id: string;
  /** On-screen and/or spoken text, per language. */
  readonly text: Record<string, string>;
  /** Whether this line is voiced, shown as type, or both. */
  readonly mode?: "voice" | "type" | "both";
  /*
    Tutorial only: the named moment in the recorded session this line narrates.

    A line with a mark is a STEP; a line without one is the closing card. That is
    the whole grammar — the brief never states a step count, an order or a
    duration, because all three are consequences of the marks and of how long the
    sentence takes to say.
  */
  readonly mark?: string;
  /** Tutorial only: the short imperative shown on the step chip ("Copy the command"). */
  readonly label?: Record<string, string>;
  /*
    What the interface showed once this line's step landed — its own heading, quoted
    by fact id. A tutorial says it inside the sentence; a spotlight writes it beside
    the after-state, as the name of what the click produced. Audited like the text.
  */
  readonly result?: Record<string, string>;
};

export type Brief = {
  readonly id: string;
  /** The recipe that stages it, by name (see apps/render/src/recipes). */
  readonly recipe: string;
  /** Languages to produce. First one is the reference for timing. */
  readonly langs: readonly string[];
  /** Alternative opening hooks — each becomes its own render. */
  readonly hooks: readonly Line[];
  /** The body, shared across hooks. */
  readonly lines: readonly Line[];
  /** Beats per minute for this piece (validated by the grid). */
  readonly bpm: number;
  /** Frames per second; 30 is the platform-native default for short-form. */
  readonly fps?: number;
  /*
    Where the music comes from: an ElevenLabs prompt (plan-gated — see
    packages/audio/src/bed.ts for why), a ready track, or the procedural bed's style
    and key. With none of the three, the procedural bed plays in style "calm".
  */
  readonly music?: {
    prompt?: string;
    file?: string;
    style?: "calm" | "pulse" | "dark" | "bright";
    key?: string;
    /*
      A track someone brought, after `scoreTrack` (packages/director/src/music.ts): the
      file is the conformed one — cut to its first downbeat and stretched to the grid — and
      `pulse` names the per-frame pulse the picture moves with (apps/render/src/recipes/pulse.ts).
      `dance` is how much it moves: "full" for a wordless piece, "light" under narration,
      "off" for a picture that must hold still. Absent means "off" — the film before music
      could move it.
    */
    pulse?: string;
    dance?: "off" | "light" | "full";
  };
  /** ElevenLabs voice id when lines are voiced. */
  readonly voice?: string;
  /*
    How fast that voice reads, 0.7 to 1.2. Left alone for anything a viewer only
    listens to; a tutorial sets it below 1, because its captions are read by someone
    who is also trying to follow along in their own window.
  */
  readonly voiceSpeed?: number;
  /** Product capture set this brief uses (media/shots/<name>). */
  readonly shots?: string;
  /** Recorded session this brief plays (media/source/sessions/<name>). */
  readonly session?: string;
  /** Recipe-specific knobs (a counter target, a rotation count) — never timing. */
  readonly params?: Record<string, string | number | boolean>;
  /** A social sales film: one supported idea, expressed through real product actions. */
  readonly promo?: PromoDirection;
  /*
    Who this piece is for. The brief still does not name a canvas — it names a JOB, and
    the job's own row says which canvases it is published in (`campaign.ts`). Absent
    means all three, which is what every brief written before jobs existed meant.
  */
  readonly job?: JobName;
  /** Extra hashtags for the post kit, without the #. */
  readonly tags?: readonly string[];
  /** The project (workspace id) whose facts this brief quotes; absent for the repository's own briefs. */
  readonly project?: string;
};

export function renderMatrix(brief: Brief, formats: readonly string[]) {
  const out: { hook: string; lang: string; format: string; id: string }[] = [];
  for (const hook of brief.hooks)
    for (const lang of brief.langs)
      for (const format of formats)
        out.push({ hook: hook.id, lang, format, id: `${brief.id}--${hook.id}--${lang}--${format}` });
  return out;
}
