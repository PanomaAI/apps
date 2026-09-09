/*
  Whether the video makes SENSE, checked from the plan rather than from pixels.

  A heading slideshow with a clean mix and no black frames passes every signal-level
  check and ships as "verified". These checks read what the piece intends — the
  brief, the render plan, the tour, the takes — and fail when the intent is the
  wrong shape: fewer than two proofs, an opening that is a card instead of motion,
  a brand that arrives late, an end card without an address, a sentence with a
  number nobody vouched for, a mark a take does not have. Each one names who fixes
  it, so an agent reading the report never loops blindly. They run in the plan (so
  panoma_video_plan can refuse) and again in the review (so the file carries them).
*/
import { JOBS, auditClaims, type Brief, type FactSheet, type RenderPlan, type ReviewCheck } from "@panoma/video-core";
import { isCalibratedVideoClock, type SessionLog } from "@panoma/video-capture";
import type { TourScript } from "@panoma/video-tour";
import { missingMarks } from "./plan.ts";
import { promoChecks } from "./promo-checks.ts";
import type { PromoCandidate } from "./promo.ts";

/*
  The measured furniture of the genre (apps/render/src/recipes/timing.ts, TRAILER, with
  its sources): the name inside the first five seconds, the address in the last six,
  the picture moving before anything is written over it.
*/
const BRAND_BY_S = 5;
const CTA_LAST_S = 6;
const OPEN_MOTION_S = 1;
const PROOF_MIN_S = 6;
const STALL_SHARE = 0.55;
/*
  Netflix's Timed Text Style Guide: 20 characters a second for adult material, 17 for
  material a viewer is decoding rather than skimming — a tutorial, where the reader is
  looking at an unfamiliar interface at the same time. Measured per spoken phrase and
  per language (apps/render/src/recipes/timing.ts, captionPhrases): Spanish says the
  same thing in 15-25% more characters, so an English cut that passes and a Spanish
  one that does not is a matrix's default outcome.
*/
export const CPS_WARN = 17;
export const CPS_MAX = 20;

/** A spoken phrase as the captions show it, with its sustained reading rate. */
export type CaptionPhrase = { text: string; chars: number; seconds: number; cps: number };

const fix = (by: ReviewCheck["fix"] extends infer F ? (F extends { by: infer B } ? B : never) : never, hint: string, tool?: string): NonNullable<ReviewCheck["fix"]> => ({ by, hint, ...(tool ? { tool } : {}) });

export function storyChecks(input: {
  /** The brief as written — placeholders intact — so the audit sees what was typed. */
  brief: Brief;
  facts: FactSheet;
  plan?: RenderPlan;
  tour?: TourScript;
  takes?: SessionLog[];
  /** Recomputed from the current takes, never copied from a patched brief's claims. */
  promoCandidates?: readonly Pick<PromoCandidate, "id" | "facts">[];
  staticSite?: boolean;
  /** The phrases this language's voice produced, when the piece is voiced; absent for a type-only piece. */
  captions?: CaptionPhrase[];
}): ReviewCheck[] {
  const { brief, plan } = input;
  const out: ReviewCheck[] = [];
  const fps = plan?.fps ?? brief.fps ?? 30;
  const sec = (f: number) => f / fps;

  /* Every number a fact, every fact in its language, no placeholder left behind. */
  const claims = auditClaims(brief, input.facts);
  out.push(
    claims.length === 0
      ? { id: "story.claims", status: "pass", summary: "Every number, command and quote traces to a fact.", fix: fix("none", "") }
      : {
          id: "story.claims",
          status: "fail",
          summary: `No fact behind these: ` + claims.slice(0, 3).map((c) => `${c.line} (${c.lang}) "${c.token}" ${c.why}`).join("; ") + `. Claims to fix: ${claims.length}`,
          details: claims,
          fix: fix("plan", "Rewrite the named lines through brief_patch: reference a {{fact:id}} from the sheet, or remove the number.", "panoma_video_plan"),
        },
  );

  /* A mark every take has, or the piece narrates one thing in 16:9 and another in 9:16. */
  if (input.takes && input.takes.length > 0) {
    const missing = missingMarks(brief, input.takes);
    out.push(
      missing.length === 0
        ? { id: "story.marks", status: "pass", summary: "Every narrated mark exists in every take.", fix: fix("none", "") }
        : {
            id: "story.marks",
            status: "fail",
            summary: missing.map((m) => `take ${m.take} lacks marks: ${m.marks.join(", ")}`).join("; "),
            details: missing,
            fix: fix("record", "Re-record the takes so every mark exists in both, or drop the lines that narrate a missing mark.", "panoma_video_record"),
          },
    );
  }

  /* A logged press only identifies a video frame when both share the encoder's
     measured origin. Legacy wall-clock logs can pass every structural proof check
     while their edit starts after the real action. Stills do not seek this clock. */
  if (brief.session && ["ProductPromo", "Tutorial", "ReleaseTrailer", "ScreenCast"].includes(brief.recipe)) {
    const recordings = (input.takes ?? []).filter(take => take.name === brief.session && take.video);
    if (recordings.length) {
      const uncalibrated = recordings.filter(take => !isCalibratedVideoClock(take.videoClock)).map(take => take.take);
      out.push(uncalibrated.length
        ? { id: "recording.clock", status: "warn", summary: `Video/event synchronization is unverified for takes: ${uncalibrated.join(", ")}. The logged action may not match its encoded frame.`,
            details: { takes: uncalibrated }, fix: fix("record", "Re-record with the current recorder so event times share the video's first presented frame.", "panoma_video_record") }
        : { id: "recording.clock", status: "pass", summary: "Recording event times use the measured first video-frame origin; this does not replace inspection of the encoded action.", fix: fix("none", "") });
    }
  }

  /* A proof is a moment where the interface changed; a scroll to a heading is not, unless the project is a static site. */
  if (input.tour) {
    const kinds = new Map(input.tour.marks.map((m) => [m.name, m.kind]));
    const weak = brief.lines.filter((l) => l.mark && !input.staticSite && kinds.get(l.mark) !== "cta" && kinds.get(l.mark) !== "flow" && brief.recipe === "ReleaseTrailer");
    out.push(
      weak.length === 0
        ? { id: "story.proof", status: "pass", summary: "Every claim is proved by a moment that changed the interface.", fix: fix("none", "") }
        : {
            id: "story.proof",
            status: "warn",
            summary: `Proved by a scroll, not by an action: ` + weak.map((l) => `${l.id} (${l.mark})`).join(", ") + `. Claims like that: ${weak.length}`,
            fix: fix("tour", "The walker found no call to action to click here; a reachable button or link on this page would make the proof real.", "panoma_video_record"),
          },
    );
  }

  /*
    What this piece is FOR. A job's objective decides which of the genre's rules apply:
    an announce piece opens on the name, a reach piece opens on the change and closes on
    the name. Absent a job — every brief written before jobs existed — the announce rules
    apply, which is what they always did.
  */
  const reach = brief.job !== undefined && JOBS[brief.job].objective === "reach";

  /* The genre's furniture is measured on every piece that sells: a trailer and a product film alike. */
  if (brief.recipe === "ReleaseTrailer" || brief.recipe === "FeatureSpotlight") {
    if (brief.recipe === "ReleaseTrailer") {
      const pairs = brief.lines.filter((l) => l.mark).length;
      out.push(
        pairs >= 2 && pairs <= 4
          ? { id: "story.pairs", status: "pass", summary: `Claim and proof pairs: ${pairs}.`, fix: fix("none", "") }
          : { id: "story.pairs", status: "fail", summary: `A trailer needs two to four claim→proof pairs; this one has ${pairs}.`, threshold: "2..4", source: "docs/genre (Linear, Cursor, Framer: 3-4 pairs)", fix: fix("plan", pairs < 2 ? "Bind more claims: a CHANGELOG Added entry or a feat: commit whose words match a clickable moment." : "Drop the weakest pairs; the cap is four.", "panoma_video_plan") },
      );
    }
    if (plan) {
      const firstCard = plan.cards.map((c) => c.from).sort((a, b) => a - b)[0];
      out.push(
        firstCard === undefined || sec(firstCard) >= OPEN_MOTION_S
          ? { id: "story.open-on-motion", status: "pass", summary: "The first second is footage in motion, with nothing written over it.", fix: fix("none", "") }
          : { id: "story.open-on-motion", status: "warn", summary: `A card starts at ${sec(firstCard).toFixed(1)} s; the reference trailers open on the product moving.`, threshold: `>= ${OPEN_MOTION_S} s`, fix: fix("engine", "The recipe's own clock placed a card early; report it.") },
      );
      const kicker = plan.cards.find((c) => c.text === "kicker");
      const closing = plan.cards.find((c) => c.text === "end");
      /*
        A feed cut is judged by its own rule.

        "The brand inside five seconds" is an ANNOUNCE rule, and it is a good one: a
        viewer who came to watch a trailer should know whose product it is. A cut whose
        objective is REACH is built the other way round on purpose — the change first,
        the name after — so applying the announce rule to it warns about the one decision
        that piece was designed around, and a warning that fires by design teaches a
        reader to ignore the whole report.
      */
      if (reach) {
        const named = [kicker, closing].filter((c) => c !== undefined).sort((a, b) => a.from - b.from)[0];
        out.push(
          named
            ? { id: "story.brand-shown", status: "pass", summary: `A feed cut shows the change first; the name lands at ${sec(named.from).toFixed(1)} s of ${sec(plan.durationInFrames).toFixed(1)} s.`, fix: fix("none", "") }
            : { id: "story.brand-shown", status: "warn", summary: "The product's name is nowhere in the cut; a viewer cannot act on a change they cannot attribute.", threshold: "the name, once", fix: fix("plan", "Keep the end card: it is the only place a feed cut names the product.", "panoma_video_plan") },
        );
      } else {
        out.push(
          kicker && sec(kicker.from) <= BRAND_BY_S
            ? { id: "story.brand-by-5s", status: "pass", summary: `The product's name is on screen at ${sec(kicker.from).toFixed(1)} s.`, fix: fix("none", "") }
            : { id: "story.brand-by-5s", status: "warn", summary: "The product's name does not appear inside the first five seconds.", threshold: `<= ${BRAND_BY_S} s`, source: "Google ABCD playbook (brand in the first 5 s)", fix: fix("plan", "Keep the kicker; the hook is the product's name and version.", "panoma_video_plan") },
        );
      }
      const end = brief.lines.find((l) => l.id === "end");
      const endCard = plan.cards.find((c) => c.text === "end");
      /*
        Same reason, the other end of the piece: a reach cut closes on the NAME, and an
        address typed into a phone from a feed is not what that piece is for. What it
        must not do is end on the footage with nothing said.
      */
      if (reach) {
        out.push(
          endCard && sec(plan.durationInFrames - endCard.from) <= CTA_LAST_S + 2
            ? { id: "story.close", status: "pass", summary: "The cut closes on the product's name.", fix: fix("none", "") }
            : { id: "story.close", status: "warn", summary: "The cut ends on footage: a feed cut that never names the product cannot be acted on.", threshold: `a card in the last ${CTA_LAST_S} s`, fix: fix("plan", "Keep the end card.", "panoma_video_plan") },
        );
      } else {
        out.push(
          end && endCard && sec(plan.durationInFrames - endCard.from) <= CTA_LAST_S + 2
            ? { id: "story.cta-last", status: "pass", summary: "The address or install command closes the piece.", fix: fix("none", "") }
            : { id: "story.cta-last", status: "warn", summary: "No address or install command in the last seconds.", threshold: `last ${CTA_LAST_S} s`, source: "Google ABCD playbook (a written call to action in the last 5 s)", fix: fix("plan", "Add a url or cmd.install fact; the template writes the end card from it.", "panoma_video_plan") },
        );
      }
      /* A trailer's proofs are footage, and footage can run out; a spotlight's uses are stills on a clock and cannot. */
      if (brief.recipe === "ReleaseTrailer") {
        const proofs = plan.holds.filter((h) => /^proof \d+ ran out/.test(h.why));
        const short = plan.cuts.length > 0 ? plan.cuts.map((c, i, all) => (i + 1 < all.length ? sec(all[i + 1].frame - c.frame) : Infinity)).filter((s) => s < PROOF_MIN_S) : [];
        if (short.length > 0 || proofs.length > 0) {
          out.push({ id: "story.proof-length", status: "warn", summary: `Proofs that ran out of footage before their minimum (the picture holds under the camera): ${proofs.length}`, threshold: `>= ${PROOF_MIN_S} s of footage per proof`, fix: fix("record", "Let the tour pause longer after each click, or give the mark more footage.", "panoma_video_record") });
        }
      }
    }
  }

  /* Reading speed on the words that were actually said, so a caption nobody can follow is a line the plan can shorten. */
  if (input.captions && input.captions.length > 0) {
    const over = input.captions.filter((p) => p.cps > CPS_WARN);
    const worst = over.reduce<CaptionPhrase | undefined>((a, b) => (a && a.cps > b.cps ? a : b), undefined);
    const tooFast = worst !== undefined && (worst.cps > CPS_MAX || over.length > input.captions.length / 3);
    out.push(
      tooFast
        ? {
            id: "story.captions",
            status: "warn",
            summary: `Spoken phrases that read faster than ${CPS_WARN} characters a second (worst ${worst.cps.toFixed(1)}: "${worst.text}"); phrases over the limit: ${over.length} of ${input.captions.length}`,
            threshold: `≤ ${CPS_MAX} characters a second per phrase, and no more than a third over ${CPS_WARN}`,
            source: "Netflix Timed Text Style Guide (20 adult / 17 children's)",
            details: over,
            fix: fix("plan", "Say less in the named phrase: rewrite the line through brief_patch with fewer characters, or split it across two marks.", "panoma_video_plan"),
          }
        : { id: "story.captions", status: "pass", summary: `Every spoken phrase reads under ${CPS_MAX} characters a second.`, fix: fix("none", "") },
    );
  }

  if (brief.recipe === "Tutorial" && plan) {
    /*
      A stall is footage that ran out, not stillness that was chosen.

      This used to be inferred from the declared holds and the cuts around them, and both
      halves of that inference broke: a tutorial now DECLARES the settle after every press
      — the still a viewer reads the result in, which is the design — and a titled step has
      two cuts inside it, so the span the share was measured against was a fragment. It
      reported every intended hold as a defect. The recipe measures the real thing when it
      lays the piece out (`holdFrom` against the picture's own length); the old derivation
      is kept only for a plan written before this field existed.
    */
    const stalls = (
      plan.stalls
        ? plan.stalls.map((s) => ({ why: `step "${s.mark}" ran out of footage for ${Math.round(s.share * 100)}% of its picture`, share: s.share }))
        : plan.holds.map((h) => {
            const step = plan.cuts.find((c, i, all) => c.frame <= h.from && (i + 1 >= all.length || all[i + 1].frame > h.from));
            const next = step ? plan.cuts[plan.cuts.indexOf(step) + 1] : undefined;
            const span = step && next ? next.frame - step.frame : 0;
            return { why: h.why, share: span > 0 ? (h.to - h.from) / span : 0 };
          })
    ).filter((s) => s.share > STALL_SHARE);
    out.push(
      stalls.length === 0
        ? { id: "story.stalls", status: "pass", summary: "No step holds a frozen picture for most of its length.", fix: fix("none", "") }
        : { id: "story.stalls", status: "warn", summary: `Steps that hold a frozen picture for most of their span: ` + stalls.map((s) => s.why).join("; ") + `. Count: ${stalls.length}`, threshold: `<= ${STALL_SHARE * 100}% of a step`, fix: fix("record", "Shoot more between those marks, or say less.", "panoma_video_record") },
    );
    const closing = brief.lines.some((l) => !l.mark);
    out.push(
      closing
        ? { id: "story.cta-last", status: "pass", summary: "A closing card ends the tutorial.", fix: fix("none", "") }
        : { id: "story.cta-last", status: "warn", summary: "No closing card: the tutorial ends on its last step.", fix: fix("plan", "Add an unmarked line with the docs URL or the install command.", "panoma_video_plan") },
    );
  }

  if (brief.recipe === "ProductPromo") out.push(...promoChecks(input));
  return out;
}
