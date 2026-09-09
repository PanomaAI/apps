/*
  The recording supplies the action clock. Music supplies the edit clock.

  A click belongs to the frame the pointer presses, including a conformed take or
  retimed lesson. A card, hold or omitted source range cannot earn an interaction.
  Keystroke logs currently describe one aggregate input, so they earn one key onset,
  never an invented typing rhythm. Old scroll logs earn only a short onset brush;
  new logs carry the measured duration and the brush follows their visible motion.
*/
import { EDITORIAL_SFX, type EditorialSound, type InteractionSound } from "@panoma/video-audio";
import { makeGrid, type EditorialTheme } from "@panoma/video-core";
import { castSpeed, promoAssemblyParts, type CastPlan, type CastSession, type PromoPlan, type SpotlightPlan, type TrailerPlan, type TutorialPlan } from "./timing.ts";
import { promoRowArrivalFrames, promoTypedCount } from "./presentation.ts";

export type SoundCue = {
  kind: InteractionSound | EditorialSound;
  from: number;
  durationInFrames: number;
  volume: number;
  /** Absent for authored typesetting or a staged spotlight press; both have their own visual plan. */
  sourceTimeMs?: number;
};

type VisibleSource = {
  from: number;
  to: number;
  sourceFrom: number;
  sourceTo: number;
  playRate: number;
};

function cuesIn(session: CastSession, windows: VisibleSource[], fps: number): SoundCue[] {
  const cues: SoundCue[] = [];
  for (const window of windows) {
    /* A beat-rounded section can hold after its footage ends. Foley ends with the
       visible action, even when the next card is still several frames away. */
    const movingTo = Math.min(window.to, window.from + Math.ceil((window.sourceTo - window.sourceFrom) / window.playRate * fps - 1e-6));
    for (const event of session.events) {
      if (event.kind !== "click" && event.kind !== "key" && event.kind !== "scroll") continue;
      if (event.role === "chrome" || event.t < window.sourceFrom * 1000 || event.t >= window.sourceTo * 1000) continue;
      if ((event.kind === "scroll" && Math.abs(event.y) < 2) || (event.kind === "key" && !event.text.trim())) continue;
      const from = Math.min(window.to - 1, window.from + Math.round(((event.t / 1000 - window.sourceFrom) / window.playRate) * fps));
      if (from < window.from || from >= window.to) continue;
      const seconds = event.kind === "click" ? 0.065 : event.kind === "key" ? 0.04
        : event.durationMs === undefined ? 0.16 : Math.min(1.6, Math.max(0, event.durationMs / 1000 / window.playRate));
      if (seconds <= 0) continue;
      /* A source event in the final fraction of a frame can round onto the first
         held frame. Keep its shared visual onset, with at most one frame of sound. */
      const durationInFrames = Math.min(window.to - from, Math.max(1, movingTo - from), Math.max(1, Math.ceil(seconds * fps)));
      cues.push({ kind: event.kind, from, durationInFrames, volume: event.kind === "click" ? 0.8 : event.kind === "key" ? 0.55 : 0.36, sourceTimeMs: event.t });
    }
  }
  /* Retiming can collapse several logged events into one frame. One onset, not a clipped stack. */
  const seen = new Set<string>();
  return cues.sort((a, b) => a.from - b.from).filter((cue) => {
    const key = `${cue.kind}:${cue.from}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function tutorialSoundCues(session: CastSession, plan: TutorialPlan, fps: number): SoundCue[] {
  return cuesIn(session, plan.steps.map((step) => ({ from: step.cardTo, to: step.to, sourceFrom: step.sourceFrom, sourceTo: step.sourceTo, playRate: step.playRate })), fps);
}

export function trailerSoundCues(session: CastSession, plan: TrailerPlan, fps: number): SoundCue[] {
  const windows = plan.sections.flatMap((section): VisibleSource[] => {
    if (section.kind === "proof") return [section];
    if (section.kind === "open") return [{ from: section.from, to: section.to, sourceFrom: plan.openSource, sourceTo: Math.min(session.durationMs / 1000, plan.openSource + section.to / fps * plan.rate), playRate: plan.rate }];
    return [];
  });
  return cuesIn(session, windows, fps);
}

/** A result preview shows what the viewer will gain; only the following proof performs an action. */
export function promoSoundCues(session: CastSession, plan: PromoPlan, fps: number, theme?: EditorialTheme, beatFrames = 15): SoundCue[] {
  const recorded = cuesIn(session, plan.sections.filter((section): section is Extract<PromoPlan["sections"][number], { kind: "proof" }> => section.kind === "proof"), fps);
  /* These are authored typesetting sounds, timed to visible letters rather than
     attributed to the filmed app. They carry no source recording timestamp. */
  const editorial: SoundCue[] = [];
  const grid = theme === "grid" ? makeGrid({ fps, bpm: fps * 60 / beatFrames }) : undefined;
  const addEditorial = (kind: EditorialSound, from: number, to: number, volume: number) => {
    if (from >= to) return;
    editorial.push({ kind, from, durationInFrames: Math.min(to - from, Math.max(1, Math.ceil(EDITORIAL_SFX[kind].seconds * fps))), volume });
  };
  for (const section of plan.sections) {
    if (grid && (section.kind === "hook" || section.kind === "benefit" || section.kind === "end")) {
      const parts = promoAssemblyParts(section.kind === "end" ? section.text.split("\n")[0] : section.text, section.from, section.to, grid).filter((part) => part.text.trim() && part.settledAt > part.from);
      const onsets = new Set<number>();
      for (const part of parts) {
        if (onsets.has(part.from)) continue;
        onsets.add(part.from);
        addEditorial("assemble", part.from, Math.min(section.to, part.settledAt), 0.36);
      }
      const settledAt = parts.length ? Math.max(...parts.map((part) => part.settledAt)) : undefined;
      if (settledAt !== undefined) addEditorial("settle", settledAt, section.to, 0.32);
    }
    if (section.kind === "recap") {
      for (const row of section.rows) {
        if (grid) {
          const settledAt = row.from + promoRowArrivalFrames(fps, "grid") - 1;
          addEditorial("paper", row.from, Math.min(section.to, settledAt), 0.38);
          addEditorial("settle", settledAt, section.to, 0.26);
        } else editorial.push({ kind: "click", from: row.from, durationInFrames: Math.max(1, Math.ceil(fps * 0.04)), volume: 0.22 });
      }
    }
    if (section.kind !== "terminal" && section.kind !== "code") continue;
    const letters = [...section.text];
    const typingFrom = section.typingFrom ?? section.from;
    let last = section.from - fps;
    for (let frame = typingFrom + 1; frame <= section.typingTo; frame++) {
      const before = promoTypedCount(section.text, typingFrom, section.typingTo, frame - 1);
      const now = promoTypedCount(section.text, typingFrom, section.typingTo, frame);
      if (now > before && letters.slice(before, now).join("").trim() && frame - last >= Math.max(2, Math.round(fps * 0.075))) {
        editorial.push({ kind: "key", from: frame, durationInFrames: Math.max(1, Math.ceil(fps * 0.035)), volume: 0.28 });
        last = frame;
      }
    }
  }
  return [...recorded, ...editorial].sort((a, b) => a.from - b.from);
}

export function castSoundCues(session: CastSession, plan: CastPlan, fps: number): SoundCue[] {
  return cuesIn(session, [{ from: plan.videoStart, to: plan.videoStart + plan.videoFrames, sourceFrom: (session.readyMs ?? 0) / 1000, sourceTo: session.durationMs / 1000, playRate: castSpeed(session, fps) }], fps);
}

export function spotlightSoundCues(plan: SpotlightPlan, fps: number): SoundCue[] {
  return plan.sections.flatMap((section) => section.kind === "unit" && section.clicked ? [{ kind: "click" as const, from: section.press, durationInFrames: Math.min(section.to - section.press, Math.ceil(0.065 * fps)), volume: 0.8 }] : []);
}
