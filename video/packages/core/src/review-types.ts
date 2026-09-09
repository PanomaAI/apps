/*
  The shapes a review speaks: one check per measurement, one report per file. They
  live here, not in @panoma/video-review, because the reader is rarely the reviewer — the
  director decides on them, the MCP server serialises them, a brief patch is written
  against them — and none of those should import ffmpeg to learn a type.

  A check carries its threshold and its source because the reader is usually a model
  looping until the gate opens: "true peak -0.3 dBTP, limit -1.0 dBTP, AES TD1004" is
  something it can act on; "audio too loud" is not.

  `fix` is the other half of that loop. A failing check names WHO fixes it, so an
  agent never re-renders the same file hoping for a different number:

  - `plan`   — the words are the problem: shorten, merge, slow the grid. The fix is a
               brief patch, and `args` carries what the patch needs to say.
  - `record` — the footage is the problem: re-shoot the take, or declare the span a
               hold when the still picture was the intention.
  - `tour`   — the product needs a reachable call to action before any take can show
               one; nothing downstream of the tour can invent it.
  - `engine` — a technical limit of the engine or the master: re-rendering will not
               change it. Stop and report, naming the check.
  - `none`   — informational; there is nothing to do.

  `tool`, when present, is the name of the MCP tool that performs the fix.
*/

export type ReviewFix = {
  by: "plan" | "record" | "tour" | "engine" | "none";
  tool?: string;
  hint: string;
  args?: Record<string, unknown>;
};

export type ReviewCheck = {
  /** "video.black", "audio.truepeak", "flash.bt1702", "platform.reels.duration" … */
  id: string;
  status: "pass" | "warn" | "fail" | "skip";
  /** One sentence a model can act on. */
  summary: string;
  /** The number the check compares against, in words. */
  threshold?: string;
  /** Where the number comes from: a URL, a standard, or "house rule". */
  source?: string;
  /** Where in the file the problem is; `frame` is `round(seconds * fps)`. */
  at?: { seconds: number; frame?: number }[];
  details?: unknown;
  fix?: ReviewFix;
};

export type ReviewReport = {
  file: string;
  /** ISO timestamp — the file's modification time, i.e. when it was rendered. */
  renderedAt: string;
  status: "pass" | "warn" | "fail";
  measured: {
    seconds: number;
    width: number;
    height: number;
    fps: number;
    lufs?: number;
    truePeak?: number;
    lra?: number;
    maxShortTerm?: number;
    cuts?: number;
    /** The encoder that wrote the file, read from its own metadata. */
    encoder?: string;
  };
  checks: ReviewCheck[];
};
