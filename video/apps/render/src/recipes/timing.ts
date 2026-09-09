/*
  Every recipe's clock, in one plain-TS file with no JSX and no React: the same
  numbers drive the scene, the voice-line offsets in the compositions, and the tests.
  A duration that lives inside a component can only be tested by rendering; a
  duration that lives here is arithmetic.
*/
import { FORMATS, makeGrid, stage, type Brief, type EditorialTheme, type Format, type Grid, type Line } from "@panoma/video-core";
/*
  motion.ts imports this file's types and `castSpeed`; this file imports its zoom pairing.
  Both are functions called at render time and neither module touches the other at load,
  which is the one shape of cycle ESM resolves without a stale binding.
*/
import { chainZooms } from "./motion.ts";
import { promoPanelLayout, promoRowArrivalFrames } from "./presentation.ts";

export function gridOf(brief: Brief): Grid {
  return makeGrid({ bpm: brief.bpm, fps: brief.fps ?? 30 });
}

/* ---------- ProductPromo: a promise, real use, and its visible payoff ---------- */

export type PromoProof = {
  kind: "proof";
  id: string;
  mark: string;
  from: number;
  to: number;
  /** Seconds on the recorded take. The footage between these ends is continuous. */
  sourceFrom: number;
  sourceTo: number;
  playRate: number;
  holdFrom: number;
  resultFrom: number;
  resultSource: number;
  resultBox?: CastBox;
  /** A measured, bounded result region; never a guessed rectangle. */
  focusBox?: CastBox;
  treatment?: "full" | "focus" | "split";
  text?: string;
  presses: { frame: number; x: number; y: number }[];
};

/*
  The four other members carry names now, and that is not decoration. They were anonymous
  object literals inside the union, so nothing outside this file could say what a filtered
  list of sections held: `sections.filter(s => s.kind === "code")` is a `PromoSection[]` to
  the compiler however obvious the kind is to the reader, and thirty-three places in the
  tests reached for `.text` on it and got away with it only because the tests were never
  typechecked. A name is what lets a caller write the type predicate instead.
*/

/** Recorded footage shown before the proof it belongs to, at its own play rate. */
export type PromoPreviewSection = { kind: "preview"; from: number; to: number; mark: string; sourceFrom: number; sourceTo: number; playRate: number; resultBox?: CastBox };

/** The closing summary: one line per row, each arriving on its own frame. */
export type PromoRecapSection = { kind: "recap"; id: string; text: string; rows: { id: string; text: string; from: number }[]; from: number; to: number };

/** Text that types itself on screen — a command, or a fragment of source. */
export type PromoTypedSection = { kind: "terminal" | "code"; id: string; text: string; from: number; to: number; typingFrom?: number; typingTo: number; source?: string };

/** A card that states something: the promise, the benefit it buys, the closing line. */
export type PromoTitleSection = { kind: "hook" | "benefit" | "end"; id: string; text: string; from: number; to: number };

export type PromoSection = PromoProof | PromoPreviewSection | PromoRecapSection | PromoTypedSection | PromoTitleSection;

export type PromoPlan = { sections: PromoSection[]; durationInFrames: number };

export type PromoTitleRole = "hook" | "benefit" | "end";

/** A theme has a finite motion vocabulary, not an independently random effect per title. */
export function promoTitleEnterFrames(theme: EditorialTheme | undefined, role: PromoTitleRole, fps: number, beatFrames = 15): number {
  if (theme === "grid") return assemblyClock(fps, beatFrames).duration;
  return Math.max(1, Math.round(fps * (theme === "block" ? 0.36 : theme === "vibrant" ? 0.30 : 0.20)));
}

/** Reduce the number of arrivals at slow tempos instead of delaying the reading hold. */
function assemblyClock(fps: number, beatFrames: number) {
  const grid = makeGrid({ fps, bpm: fps * 60 / beatFrames });
  const move = Math.max(1, Math.round(fps * 0.22));
  const slots = Math.max(0, Math.min(2, Math.floor((Math.floor(fps * 0.50) - move) / grid.tickFrames)));
  return { move, slots, tick: grid.tickFrames, duration: move + slots * grid.tickFrames };
}

/** Exact phrase fragments share one clock with their authored sound. No scrambled replacement glyphs. */
export function promoAssemblyParts(text: string, from: number, to: number, grid: Grid): { text: string; from: number; settledAt: number }[] {
  const words = text.match(/\s*\S+\s*/gu) ?? [text];
  const clock = assemblyClock(grid.fps, grid.beatFrames);
  const count = Math.min(words.length, clock.slots + 1);
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor(index * words.length / count);
    const end = Math.floor((index + 1) * words.length / count);
    const arrival = from === 0 ? 0 : Math.min(to - 1, from + index * clock.tick);
    return { text: words.slice(start, end).join(""), from: arrival, settledAt: from === 0 ? 0 : Math.min(to - 1, arrival + clock.move) };
  });
}

/** A displaced group converges once. The quoted words have stable layout slots throughout. */
export function promoAssemblyMotion(part: { from: number; settledAt: number }, index: number, frame: number) {
  const progress = part.settledAt === part.from ? 1 : Math.max(0, Math.min(1, (frame - part.from) / (part.settledAt - part.from)));
  const remaining = (1 - progress) ** 4;
  /* A long, fast approach reads as intentional assembly. Scale reserves the room
     that displaced words need, then the exact final typography locks in place. */
  return { progress, x: (index % 2 ? 0.084 : -0.078) * remaining, y: (index % 2 ? -0.066 : 0.076) * remaining,
    rotate: (index % 2 ? 11 : -10) * remaining, scale: 1 - 0.20 * remaining,
    opacity: 0.42 + 0.58 * Math.min(1, progress * 4) };
}

/** A recap recalls outcomes already shown. Assemble the deck quickly, then read it together. */
export function promoRecapStepFrames(grid: Grid): number {
  return grid.tickFrames * Math.max(1, Math.round(grid.fps * 0.24 / grid.tickFrames));
}

/** The first card is also the feed poster. Later cards reserve motion before reading. */
export function promoTitleSettledFrame(theme: EditorialTheme | undefined, role: PromoTitleRole, from: number, to: number, fps: number, beatFrames = 15): number {
  return from === 0 ? from : from + Math.max(0, Math.min(promoTitleEnterFrames(theme, role, fps, beatFrames), to - from - 1));
}

/** Canvas-relative travel, bounded scale, and a single mechanical press. No running clock or loops. */
export function promoTitleMotion(theme: EditorialTheme | undefined, role: PromoTitleRole, from: number, to: number, frame: number, fps: number, beatFrames = 15) {
  const settleFrame = promoTitleSettledFrame(theme, role, from, to, fps, beatFrames);
  const progress = settleFrame === from ? 1 : Math.max(0, Math.min(1, (frame - from) / (settleFrame - from)));
  const eased = 1 - (1 - progress) ** 3;
  const stamp = theme === "block";
  const sweep = theme === "vibrant";
  /* Compress and release along the plate's diagonal. The same value moves its text,
     so the letters never float above a face that has already docked. */
  const press = stamp ? Math.sin(Math.PI * progress) ** 2 * 0.72 : 0;
  return {
    style: theme === "grid" ? "assembly" as const : stamp ? "stamp" as const : sweep ? "sweep" as const : "settle" as const,
    progress, settleFrame, press,
    translateY: (1 - eased) * (theme === "grid" ? 0 : stamp ? -0.014 : sweep ? 0.018 : 0.006),
    scale: 1 - (1 - eased) * (stamp ? 0.025 : 0),
    accentProgress: eased,
  };
}

const promoText = (line: Line | undefined, lang: string) => line?.text[lang] ?? Object.values(line?.text ?? {})[0] ?? "";

/** Hidden screen-reader focus is not a photographed result. Require four visible CSS pixels on both axes. */
function promoVisibleBox(box: CastBox | undefined, viewport: CastSession["viewport"]): CastBox | undefined {
  if (!box) return undefined;
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  const width = Math.min(viewport.width, box.x + box.width) - x;
  const height = Math.min(viewport.height, box.y + box.height) - y;
  return width >= 4 && height >= 4 ? { x, y, width, height } : undefined;
}

function promoResultBox(session: TakeWithAssets, mark: string): CastBox | undefined {
  const macro = session.macros?.find((entry) => entry.mark === mark);
  return promoVisibleBox(macro?.focus, session.viewport) ?? promoVisibleBox(macro?.change?.box, session.viewport);
}

const PROMO_RESULT_ZOOM = 1.7;

/** Shared by the camera and automatic presentation selection; no estimated zoom. */
function promoFraming(session: TakeWithAssets, win: CastFrame, box: CastBox | undefined, want: number): Framing {
  const whole = session.viewport.width * (session.videoRatio && session.videoRatio > 0 ? session.videoRatio : 1) / win.content.width;
  const wide = { fx: 0.5, fy: 0.5, scale: Math.min(1, whole) };
  if (!box || whole <= 1) return wide;
  const scale = Math.min(whole, fitScaleToBox(box, session.viewport, want));
  return scale <= 1 ? wide : { fx: (box.x + box.width / 2) / session.viewport.width, fy: (box.y + box.height / 2) / session.viewport.height, scale };
}

/** Output pixels per source CSS pixel once a split proof reaches its measured result. */
export function promoSplitResultScale(session: TakeWithAssets, mark: string, format: Format): number {
  const win = promoPanelLayout(format, session.viewport, session).product;
  return win.content.width / session.viewport.width * promoFraming(session, win, promoResultBox(session, mark), PROMO_RESULT_ZOOM).scale;
}

export function promoPlan(session: TakeWithAssets, brief: Brief, hook: Line, lang: string): PromoPlan {
  const grid = gridOf(brief);
  const fps = grid.fps;
  const beat = (frames: number) => Math.max(grid.beatFrames, Math.ceil(frames / grid.beatFrames) * grid.beatFrames);
  const measured = brief.promo?.pace === "measured";
  const rate = castSpeed(session, fps);
  const marks = [...(session.marks ?? session.events.filter((e): e is Extract<CastEvent, { kind: "mark" }> => e.kind === "mark"))].sort((a, b) => a.t - b.t);
  const events = [...session.events].sort((a, b) => a.t - b.t);
  const sections: PromoSection[] = [];
  let at = 0;

  const card = (kind: "hook" | "benefit" | "end", id: string, text: string) => {
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const seconds = Math.max(kind === "end" ? 1.8 : 0.9, words / (measured ? 3.5 : 4) + 0.3, [...text].length / 22);
    const entrance = at === 0 ? 0 : promoTitleEnterFrames(brief.promo?.theme, kind, fps, grid.beatFrames);
    const frames = beat(seconds * fps + entrance);
    /* A long opening is a copy problem, not permission to rush a paragraph. */
    if (kind === "hook" && frames > fps * 3) throw new Error(`ProductPromo hook "${id}" needs shorter copy to show the product within three seconds.`);
    sections.push({ kind, id, text, from: at, to: at + frames });
    at += frames;
  };

  const proofs = brief.lines.filter((line) => line.mark && line.id !== "brand" && line.id !== "end").map((line): PromoProof => {
    const mark = brief.promo?.evidence[line.id]?.mark ?? line.mark!;
    const index = marks.findIndex((m) => m.name === mark);
    if (index < 0) throw new Error(`ProductPromo benefit "${line.id}" names missing mark "${mark}".`);
    const startMs = marks[index].t;
    const endMs = marks[index + 1]?.t ?? session.durationMs;
    const actions = events.filter((e) => e.t >= startMs && e.t < endMs && (e.kind === "click" || e.kind === "key" || e.kind === "scroll") && e.role !== "chrome");
    const clicks = actions.filter((e): e is Extract<CastEvent, { kind: "click" }> => e.kind === "click");
    const first = clicks[0];
    if (!first) throw new Error(`ProductPromo benefit "${line.id}" has no recorded product press at "${mark}".`);
    let sourceFromMs = Math.max(session.readyMs ?? 0, startMs, first.t - 550);
    const actionEnd = (event: CastEvent) => {
      if (event.kind !== "scroll") return event.t;
      /* Old logs have no duration: keep the rest of the segment rather than cut a gesture on a guess. */
      return Math.min(endMs, event.durationMs === undefined ? endMs : event.t + event.durationMs);
    };
    for (const action of actions) if (action.kind === "scroll" && action.t < sourceFromMs && actionEnd(action) > sourceFromMs) sourceFromMs = action.t;
    const lastActionMs = Math.max(first.t, ...actions.map(actionEnd));
    const macro = session.macros?.find((m) => m.mark === mark);
    const ready = macro?.resultAtMs;
    /* This is recorded latency. A legacy take only vouches for the state near its next mark. */
    const observedMs = ready !== undefined && ready >= first.t && ready < endMs ? ready : Math.max(first.t, endMs - 150);
    const resultMs = Math.min(endMs - 1000 / (session.fps ?? fps), Math.max(observedMs, lastActionMs));
    const treatment = brief.promo?.treatments?.[line.id] ?? "full";
    const reading = (measured ? 1.35 : 1.0) + (treatment === "focus" ? 0.8 : 0);
    const sourceToMs = Math.min(endMs, Math.max(lastActionMs, resultMs + reading * rate * 1000));
    const localResult = Math.max(0, Math.round(((resultMs - sourceFromMs) / 1000 / rate) * fps));
    const movingFrames = Math.max(1, Math.ceil(((sourceToMs - sourceFromMs) / 1000 / rate) * fps));
    const length = beat(Math.max(movingFrames, localResult + reading * fps));
    const resultBox = promoResultBox(session, mark);
    const changed = macro?.change?.box;
    const focusBox = changed && [changed.x, changed.y, changed.width, changed.height].every(Number.isFinite) &&
      changed.x >= 0 && changed.y >= 0 && changed.x + changed.width <= session.viewport.width && changed.y + changed.height <= session.viewport.height &&
      changed.width >= 16 && changed.height >= 16 && changed.width <= session.viewport.width * 0.9 && changed.height <= session.viewport.height * 0.9 &&
      changed.width * changed.height <= session.viewport.width * session.viewport.height * 0.72 ? changed : undefined;
    if (treatment === "focus" && !focusBox) throw new Error(`ProductPromo focus at "${mark}" needs a measured, bounded visible result.`);
    const text = promoText(line, lang);
    const splitReading = treatment === "split" ? ([...text].length / 22 + 0.4) * fps : 0;
    return {
      kind: "proof", id: line.id, mark, from: 0, to: beat(Math.max(length, splitReading)), treatment, text,
      sourceFrom: sourceFromMs / 1000, sourceTo: sourceToMs / 1000, playRate: rate,
      holdFrom: movingFrames, resultFrom: localResult, resultSource: resultMs / 1000,
      ...(resultBox ? { resultBox } : {}),
      ...(focusBox ? { focusBox } : {}),
      presses: clicks.filter((click) => click.t >= sourceFromMs && click.t < sourceToMs).map((click) => ({ frame: Math.round(((click.t - sourceFromMs) / 1000 / rate) * fps), x: click.x, y: click.y })),
    };
  });
  if (proofs.length < 1 || proofs.length > 3) throw new Error(`ProductPromo needs one to three recorded benefits; "${brief.id}" has ${proofs.length}.`);

  if (brief.promo?.opening === "result") {
    const first = proofs[0];
    const length = beat(fps);
    sections.push({ kind: "preview", from: at, to: at + length, mark: first.mark, sourceFrom: first.resultSource, sourceTo: Math.min(first.sourceTo, first.resultSource + length / fps * rate), playRate: rate, ...(first.resultBox ? { resultBox: first.resultBox } : {}) });
    at += length;
  }
  const hookText = promoText(hook, lang);
  card("hook", hook.id, hookText);
  for (const [index, proof] of proofs.entries()) {
    sections.push({ ...proof, from: at, to: at + proof.to, holdFrom: at + proof.holdFrom, resultFrom: at + proof.resultFrom, presses: proof.presses.map((p) => ({ ...p, frame: at + p.frame })) });
    at += proof.to;
    const text = promoText(brief.lines.find((line) => line.id === proof.id), lang);
    const normalized = (value: string) => value.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, " ").trim();
    if (proof.treatment !== "split" && (index !== 0 || normalized(text) !== normalized(hookText))) card("benefit", proof.id, text);
    for (const insert of brief.promo?.inserts?.filter((insert) => insert.after === proof.id) ?? []) {
      const line = brief.lines.find((line) => line.id === insert.line && !line.mark);
      if (!line) throw new Error(`ProductPromo insert "${insert.line}" needs a source text line.`);
      const text = promoText(line, lang);
      if (!text.trim() || text.includes("{{fact:")) throw new Error(`ProductPromo insert "${insert.line}" needs its expanded source text.`);
      if ([...text].length > 400 || text.split("\n").length > 8 || text.split("\n").some((row) => [...row].length > 70)) {
        throw new Error(`ProductPromo insert "${insert.line}" is too long for a readable source excerpt.`);
      }
      /* The panel and caret arrive before the first keystroke. Source reading time
         is still separate, and both insert boundaries remain on whole beats. */
      const lead = Math.max(1, Math.round(fps * 0.2));
      const typing = beat(lead + Math.max(fps * 0.8, [...text].length / (insert.kind === "code" ? 48 : 28) * fps));
      const reading = beat(Math.max(1.5, [...text].length / 22) * fps);
      sections.push({ kind: insert.kind, id: insert.line, text, from: at, to: at + typing + reading, typingFrom: at + lead, typingTo: at + typing,
        source: insert.kind === "terminal" ? "Terminal" : lang === "es" ? "Código" : "Code" });
      at += typing + reading;
    }
  }
  if (brief.promo?.recap && proofs.length >= 2) {
    const start = at;
    const rows = proofs.map((proof, index) => {
      const text = promoText(brief.lines.find((line) => line.id === proof.id), lang);
      if (brief.promo?.theme === "grid") return { id: proof.id, text, from: start + index * promoRecapStepFrames(grid) };
      const row = { id: proof.id, text, from: at };
      at += beat(Math.max(1.1, [...text].length / 22 + 0.3) * fps);
      return row;
    });
    if (brief.promo?.theme === "grid") {
      const reading = Math.max(1.2, ...rows.map((row) => [...row.text].length / 22)) * fps;
      at = start + beat(rows.at(-1)!.from - start + promoRowArrivalFrames(fps, "grid") + reading);
    }
    sections.push({ kind: "recap", id: "recap", text: lang === "es" ? "En esta app" : "In this app", rows, from: start, to: at });
  }
  const brand = promoText(brief.lines.find((line) => line.id === "brand"), lang);
  const destination = promoText(brief.lines.find((line) => line.id === "end"), lang);
  if (brief.promo?.close && (!brand.trim() || (brief.promo.close.kind === "brand" ? Boolean(destination) : !destination.trim()))) {
    throw new Error("ProductPromo closing lines do not match its sourced closing decision.");
  }
  const close = [brand, destination].filter(Boolean).join("\n");
  card("end", "end", close);
  return { sections, durationInFrames: at };
}

export function promoSectionAt(plan: PromoPlan, frame: number): PromoSection {
  return plan.sections.find((s) => frame >= s.from && frame < s.to) ?? plan.sections[plan.sections.length - 1];
}

export function promoSourceAt(plan: PromoPlan, session: CastSession, frame: number, fps: number): number {
  const section = promoSectionAt(plan, frame);
  if (section.kind !== "proof" && section.kind !== "preview") return (session.readyMs ?? 0) / 1000;
  const last = Math.max(section.sourceFrom, section.sourceTo - 1 / (session.fps ?? fps));
  return Math.min(last, section.sourceFrom + Math.max(0, frame - section.from) / fps * section.playRate);
}

/** A move needs a new subject. Between the real control and measured answer, the camera holds. */
export function promoShots(session: TakeWithAssets, brief: Brief, plan: PromoPlan, format: Format = FORMATS.h): CastShot[] {
  const fps = gridOf(brief).fps;
  const arrive = Math.max(1, Math.floor(fps * 0.42));
  const shots: CastShot[] = [];
  const shot = (from: number, to: number, start: Framing, end: Framing, reason: string) => {
    if (to > from) shots.push({ from, to, start, end, ease: "out", enter: "cut", tilt: { rx: 0, ry: 0 }, reason });
  };
  for (const section of plan.sections) {
    const win = section.kind === "proof" && section.treatment === "split"
      ? promoPanelLayout(format, session.viewport, session).product : castFrame(format, session.viewport, session);
    const whole = session.viewport.width * (session.videoRatio && session.videoRatio > 0 ? session.videoRatio : 1) / win.content.width;
    const wide: Framing = { fx: 0.5, fy: 0.5, scale: Math.min(1, whole) };
    const framing = (box: CastBox | undefined, want: number): Framing => promoFraming(session, win, box, want);
    if (section.kind === "preview") {
      const result = framing(section.resultBox, PROMO_RESULT_ZOOM);
      shot(section.from, section.to, result, result, "preview the recorded result without replaying its press");
      continue;
    }
    if (section.kind !== "proof") {
      shot(section.from, section.to, wide, wide, `${section.kind} card`);
      continue;
    }
    const macro = session.macros?.find((m) => m.mark === section.mark);
    const first = section.presses[0];
    const control = promoVisibleBox(macro?.target ?? macro?.box, session.viewport);
    const pressed = control ? framing(control, 1.8) : first ? { fx: first.x / session.viewport.width, fy: first.y / session.viewport.height, scale: Math.min(1.5, whole) } : wide;
    const result = framing(section.treatment === "focus" ? section.focusBox : section.resultBox, section.treatment === "focus" ? 2.15 : PROMO_RESULT_ZOOM);
    const press = first?.frame ?? section.from;
    const enterTo = Math.min(press, section.from + arrive);
    /* A press-captured control may follow a scroll. Keep that scroll wide, then arrive at its actual target. */
    const enterFrom = Math.max(section.from, press - arrive);
    shot(section.from, enterFrom, wide, wide, "context before the control");
    shot(enterFrom, Math.max(enterTo, press), wide, pressed, "arrive on the recorded control");
    const release = Math.max(press, section.resultFrom);
    shot(press, release, pressed, pressed, "hold while the action completes");
    const rest = Math.min(section.to, release + arrive);
    shot(release, rest, pressed, result, "reframe the measured result");
    shot(rest, section.to, result, result, "read the visible payoff");
  }
  return shots;
}

/* ---------- KineticQuote: hook 2 bars, one bar per line ---------- */

export function quoteDuration(brief: Brief): number {
  return gridOf(brief).bar(2 + brief.lines.length);
}

export function quoteLineStarts(brief: Brief): Record<string, number> {
  const grid = gridOf(brief);
  return Object.fromEntries(brief.lines.map((line, i) => [line.id, grid.bar(2 + i)]));
}

/* ---------- ScreenDemo: hook 2 bars, two bars per line ---------- */

export function screenDuration(brief: Brief): number {
  return gridOf(brief).bar(2 + brief.lines.length * 2);
}

export function screenLineStarts(brief: Brief): Record<string, number> {
  const grid = gridOf(brief);
  return Object.fromEntries(brief.lines.map((line, i) => [line.id, grid.bar(2 + i * 2)]));
}

/* ---------- TerminalRun: type 1 bar, outputs every half bar, summary 2 bars ---------- */

/** lines[0] is the command, the last line is the summary, the rest is output. */
export function terminalParts(brief: Brief) {
  if (brief.lines.length < 3) {
    throw new Error(`TerminalRun needs command + output + summary; "${brief.id}" has ${brief.lines.length} lines.`);
  }
  return {
    command: brief.lines[0],
    output: brief.lines.slice(1, -1),
    summary: brief.lines[brief.lines.length - 1],
  };
}

export function terminalDuration(brief: Brief): number {
  const grid = gridOf(brief);
  const { output } = terminalParts(brief);
  return grid.bar(1 + Math.ceil(output.length / 2) + 2);
}

/** Frame at which output row `i` appears: every half bar, after the typed command. */
export function terminalRowFrame(brief: Brief, i: number): number {
  const grid = gridOf(brief);
  return grid.bar(1) + i * (grid.barFrames / 2);
}

export function terminalSummaryFrame(brief: Brief): number {
  const grid = gridOf(brief);
  const { output } = terminalParts(brief);
  return grid.bar(1 + Math.ceil(output.length / 2));
}

/* ---------- ReleaseTrailer: the measured grammar of the genre ---------- */

/*
  Every number here was measured on the reference material rather than chosen: the
  Linear "Introducing X" announcements (16-55 s, median about 30, no speech, zero hard
  cuts), Cursor 2.0 (65 s), Framer Agents (36 s), Raycast's teaser (39 s) and Notion's
  changelog roundup. The unit that all of them share is a CLAIM CARD of at most five
  words held for two to three seconds, followed by six to twelve seconds of the
  product PROVING it, repeated three or four times between fixed furniture: product
  in motion first, the name inside the first five seconds (Google's ABCD playbook,
  Ipsos-backed), a status line and the wordmark last. Duration = 5 + 10N + 4 + 6.
*/
export const TRAILER = {
  /** Footage in motion, no type, no logo: the first second is never a card. */
  openSeconds: 1,
  /** "{product} {version}", at most three words. Brand inside the first five seconds. */
  kickerSeconds: 2,
  /** The release headline, at most six words, typed; skipped when no fact fits. */
  themeSeconds: 2,
  claimSeconds: 2.5,
  claimMaxWords: 5,
  proofMinSeconds: 6,
  proofMaxSeconds: 12,
  pairsMin: 2,
  pairsMax: 4,
  /** "Fixes and improvements: 41" — the sentence closes on its number. */
  tickerSeconds: 4,
  statusSeconds: 1.5,
  wordmarkSeconds: 3.5,
  capSeconds: 60,
  /** Trailer voice, when there is one, is sparse: 110-150 wpm measured; 170 is a tutorial rate. */
  wpm: 120,
  /** Product trailers cut 0-1.3 times per 10 s; film montages about 7. Never both in one piece. */
  maxHardCutsPer10s: 1.3,
} as const;

export type TrailerSection =
  | { kind: "open"; from: number; to: number }
  | { kind: "kicker"; from: number; to: number }
  | { kind: "theme"; from: number; to: number; id: string }
  | { kind: "claim"; from: number; to: number; id: string; mark: string; index: number }
  | {
      kind: "proof";
      from: number;
      to: number;
      id: string;
      mark: string;
      index: number;
      sourceFrom: number;
      sourceTo: number;
      playRate: number;
      holdFrom: number;
      fx: number;
      fy: number;
      /*
        Every product press of the proof, on the TIMELINE. The ripple used to be aged on the
        recording's clock — `(ms - c.t) / 450` — which the proof's conform rate compresses and
        its hold past `sourceTo` freezes solid, exactly as it did in the tutorial before
        `TutorialStep.presses`. Clamped inside the section, so a press the footage reaches on
        its last frame still lands in it.
      */
      presses: { frame: number; x: number; y: number }[];
    }
  | { kind: "ticker"; from: number; to: number; id: string }
  | { kind: "status"; from: number; to: number; id: string }
  | { kind: "end"; from: number; to: number; id?: string };

export type TrailerPlan = {
  durationInFrames: number;
  sections: TrailerSection[];
  /** Seconds into the take the piece opens on (the hero mark, or the first painted frame). */
  openSource: number;
  rate: number;
  /** The timeline's rate, so the shot list can turn the press tail into frames without the brief. */
  fps: number;
};

/**
 * The grammar of a trailer brief. The hook is the kicker. A line WITH a mark is a
 * claim card followed by the proof at that mark; a line without one is furniture,
 * chosen by id: "theme" before the pairs, then "ticker", "status", "end" after them.
 * Anything else without a mark is ignored with a warning rather than guessed at.
 */
export function trailerParts(brief: Brief): { pairs: Line[]; theme?: Line; ticker?: Line; status?: Line; end?: Line } {
  const pairs = brief.lines.filter((l) => l.mark);
  const furniture = brief.lines.filter((l) => !l.mark);
  const pick = (id: string) => furniture.find((l) => l.id === id);
  if (pairs.length === 0) {
    throw new Error(`ReleaseTrailer "${brief.id}" has no claim cards: a claim is a line with a \`mark\` naming the moment that proves it.`);
  }
  return { pairs, theme: pick("theme"), ticker: pick("ticker"), status: pick("status"), end: pick("end") };
}

/**
 * The trailer's clock. Everything is whole beats; the pairs are whole beats each;
 * the total rounds up to whole bars. The claim card sits OVER the footage, dimmed
 * and frozen on its mark, and the footage jump between two proofs happens under the
 * card — which is how the piece has no hard cut of footage while the picture moves
 * from one moment to the next, the way the reference trailers do it.
 */
export function trailerPlan(session: CastSession, brief: Brief, lang: string): TrailerPlan {
  const grid = gridOf(brief);
  const fps = grid.fps;
  const beat = grid.beatFrames;
  const bar = grid.barFrames;
  const rate = castSpeed(session, fps);
  const { pairs, theme, ticker, status, end } = trailerParts(brief);
  const marks = session.marks ?? [];
  const beats = (seconds: number) => Math.max(beat, Math.ceil((seconds * fps) / beat) * beat);
  const markAt = (name: string) => {
    const found = marks.find((m) => m.name === name);
    if (!found) throw new Error(`Line narrates mark "${name}", which the take does not have. Marks: ${marks.map((m) => m.name).join(", ")}.`);
    return found.t;
  };
  const hero = marks.find((m) => m.name === "hero")?.t ?? session.readyMs ?? 0;

  const sections: TrailerSection[] = [];
  let at = 0;
  const push = (s: TrailerSection) => {
    sections.push(s);
    at = s.to;
  };
  push({ kind: "open", from: 0, to: beats(TRAILER.openSeconds) });
  push({ kind: "kicker", from: at, to: at + beats(TRAILER.kickerSeconds) });
  if (theme && theme.text[lang]) push({ kind: "theme", from: at, to: at + beats(TRAILER.themeSeconds), id: theme.id });

  pairs.slice(0, TRAILER.pairsMax).forEach((line, index) => {
    const fromMs = Math.max(markAt(line.mark!), session.readyMs ?? 0);
    const next = pairs[index + 1];
    const nextMs = next ? markAt(next.mark!) : session.durationMs;
    const available = Math.max(0, (nextMs - fromMs) / 1000) / rate; /* timeline seconds the segment lasts at the conform rate */
    const proofSeconds = Math.min(TRAILER.proofMaxSeconds, Math.max(TRAILER.proofMinSeconds, available));
    const proofFrames = beats(proofSeconds);
    const playFrames = Math.min(proofFrames, Math.round(((nextMs - fromMs) / 1000 / rate) * fps));
    const point = firstActionPoint(session, fromMs, nextMs);
    push({ kind: "claim", from: at, to: at + beats(TRAILER.claimSeconds), id: line.id, mark: line.mark!, index: index + 1 });
    const sourceToMs = Math.min(nextMs, fromMs + (proofFrames / fps) * rate * 1000);
    /* Chrome earns nothing here either: a consent click is not a press the proof shows. */
    const presses = session.events
      .filter((e): e is Extract<CastEvent, { kind: "click" }> => e.kind === "click" && e.role !== "chrome" && e.t >= fromMs && e.t < sourceToMs)
      .map((e) => ({ frame: Math.min(at + proofFrames - 1, at + Math.round(((e.t - fromMs) / 1000 / rate) * fps)), x: e.x, y: e.y }));
    push({
      kind: "proof",
      from: at,
      to: at + proofFrames,
      id: line.id,
      mark: line.mark!,
      index: index + 1,
      sourceFrom: fromMs / 1000,
      sourceTo: sourceToMs / 1000,
      playRate: rate,
      holdFrom: at + playFrames,
      fx: point.fx,
      fy: point.fy,
      presses,
    });
  });

  if (ticker && ticker.text[lang]) push({ kind: "ticker", from: at, to: at + beats(TRAILER.tickerSeconds), id: ticker.id });
  if (status && status.text[lang]) push({ kind: "status", from: at, to: at + beats(TRAILER.statusSeconds), id: status.id });
  const endTo = Math.ceil((at + beats(TRAILER.wordmarkSeconds)) / bar) * bar;
  push({ kind: "end", from: at, to: endTo, ...(end ? { id: end.id } : {}) });

  return { durationInFrames: endTo, sections, openSource: hero / 1000, rate, fps };
}

/** Where the product acted first inside a segment, in source fractions; the centre if it only scrolled. */
function firstActionPoint(session: CastSession, fromMs: number, toMs: number): { fx: number; fy: number } {
  const w = session.viewport.width;
  const h = session.viewport.height;
  for (const e of session.events) {
    if (e.t < fromMs || e.t >= toMs) continue;
    if (e.kind === "click" && e.role !== "chrome") return { fx: e.x / w, fy: e.y / h };
  }
  return { fx: 0.5, fy: 0.45 };
}

export function trailerSectionAt(plan: TrailerPlan, frame: number): TrailerSection {
  return plan.sections.find((s) => frame >= s.from && frame < s.to) ?? plan.sections[plan.sections.length - 1];
}

/**
 * Which second of the take a frame shows. The open plays from the hero; a card
 * freezes on its proof's first frame; a proof plays at the conform rate and holds
 * when its footage runs out; the furniture holds the last proof's last frame.
 */
export function trailerSourceAt(plan: TrailerPlan, session: CastSession, frame: number, fps: number): number {
  const end = Math.max(0, session.durationMs / 1000 - 1 / fps);
  const clamp = (t: number) => Math.min(Math.max(0, t), end);
  const section = trailerSectionAt(plan, frame);
  const proofs = plan.sections.filter((s): s is Extract<TrailerSection, { kind: "proof" }> => s.kind === "proof");
  if (section.kind === "open" || section.kind === "kicker" || section.kind === "theme") {
    return clamp(plan.openSource + ((frame - 0) / fps) * plan.rate);
  }
  if (section.kind === "claim") {
    const proof = proofs.find((p) => p.index === section.index)!;
    return clamp(proof.sourceFrom);
  }
  if (section.kind === "proof") {
    if (frame >= section.holdFrom) return clamp(section.sourceTo);
    return clamp(Math.min(section.sourceFrom + ((frame - section.from) / fps) * section.playRate, section.sourceTo));
  }
  const last = proofs[proofs.length - 1];
  return clamp(last ? last.sourceTo : plan.openSource);
}

/*
  The proof's push, shaped like the tutorial's: it straddles the press — most of the move
  before it, half a second after — and then HOLDS, drifting a per cent so the encoder never
  reads the hold as a stalled frame. It used to be one ease across the whole section, and on
  a twelve-second proof that is a creep nobody reads as a camera.
*/
const TRAILER_PUSH_TAIL_S = 0.5;
/* A hold that is not quite still: the tutorial's number, for the tutorial's reason (its DRIFT). */
const TRAILER_DRIFT = 1.012;

/**
 * One gentle shot per section — the open drifts, the furniture settles — and two for a proof
 * with a press in it: the push to the press, and the hold after it.
 *
 * Every framing is capped at `videoWhole`, the scale at which the recording is drawn 1:1 in
 * this format, when the caller says which format and take are being drawn. That replaces the
 * per-format fudge the recipe used to apply by hand (half the push on a phone, fifteen per
 * cent more on a vertical cut): a phone take arrives already magnified and its ceiling comes
 * out below 1, so the camera declines to zoom rather than being told to halve. Without a
 * format — the arithmetic tests, which pin a direction's push depths — nothing is capped.
 */
export function trailerShots(plan: TrailerPlan, motion: ShotMotion = CAST_MOTION, format?: Format, session?: CastSession): CastShot[] {
  const whole = format && session ? videoWhole(format, session.viewport, { isMobile: session.isMobile, ...(session.videoRatio ? { videoRatio: session.videoRatio } : {}) }) : Infinity;
  const wide = (fx: number, fy: number, scale: number): Framing => ({ fx, fy, scale: Math.min(scale, whole) });
  const [least, most] = softened(motion);
  const fps = plan.fps;
  return plan.sections.flatMap((s, index): CastShot[] => {
    const base = { from: s.from, to: s.to, enter: "cut" as ShotEnter, tilt: { rx: 0, ry: 0 } };
    switch (s.kind) {
      /*
        The open and the cards under footage are drifts, not arrivals: a few per cent across
        the section that the viewer is not meant to see land. The spring is for a move that
        arrives somewhere; a drift that stopped at two thirds would read as the camera
        settling on nothing, so these keep the symmetric ease.
      */
      case "open":
        return [{ ...base, start: wide(0.5, 0.4, 1.06), end: wide(0.5, 0.42, 1.1), ease: "inOut", reason: "open on motion" }];
      case "kicker":
      case "theme":
        return [{ ...base, start: wide(0.5, 0.42, 1.1), end: wide(0.5, 0.44, 1.14), ease: "inOut", reason: s.kind }];
      case "claim":
        return [{ ...base, start: wide(0.5, 0.45, 1.08), end: wide(0.5, 0.45, 1.1), ease: "inOut", reason: `claim ${s.index}` }];
      case "proof": {
        const edge = Math.max(Math.abs(s.fx - 0.5), Math.abs(s.fy - 0.5)) * 2;
        const depth = lerp(most, least, Math.min(1, Math.max(0, (edge - 0.45) / 0.45)));
        const landed = wide(s.fx, s.fy, depth);
        /* The push is six per cent of wherever the cap lets it land, so a capped proof still moves. */
        const start = wide(s.fx, s.fy, landed.scale * 0.94);
        const press = s.presses[0];
        const arrive = press ? Math.min(s.to, Math.max(s.from + Math.round(fps * 0.42), press.frame + Math.round(fps * TRAILER_PUSH_TAIL_S))) : s.to;
        const push: CastShot = { ...base, to: arrive, enter: enterFor(motion, index), start, end: landed, ease: "spring", reason: `proof ${s.index}: ${s.mark}` };
        if (arrive >= s.to) return [push];
        /* The drift goes past the cap by a per cent, as the tutorial's held shots do: under the eye, over the duplicate detector. */
        const hold: CastShot = { ...base, from: arrive, start: landed, end: { ...landed, scale: landed.scale * TRAILER_DRIFT }, ease: "linear", reason: `proof ${s.index}: ${s.mark} (held)` };
        return [push, hold];
      }
      default:
        return [{ ...base, start: wide(0.5, 0.5, 1.06), end: wide(0.5, 0.5, 1.02), ease: "spring", reason: s.kind }];
    }
  });
}

/* ---------- FeatureSpotlight: the interface, used, at macro scale ---------- */

/*
  The unit of the piece is a USE, and the whole piece is one camera over the
  product's own pixels. Every sprite — the 2x frame of the page, the 8x clip of a
  control, the 5x clip of the menu it opened — is pinned to its CSS box of the
  viewport, and one framing says where that plane lands on the canvas. Pushing in
  past twice the page's pixels dissolves the page into the dark stage and leaves the
  control alone on a lit plate; pulling out brings the page back. The reference
  films (Diffusion Studio's and Scenivia's launch pieces) do exactly this: one real
  element huge on a dark stage, the pointer on it before the click, the result
  unfolding where it happened, and the name of the thing landing once the picture
  has stopped. Three bars per use, cut on beats, accents on ticks; between uses the
  camera travels to the next control instead of cutting to a card.

  Everything below is arithmetic over the take. The plan decides frames, forms and
  camera keys; `unitCamera` says where the window is on any frame; the scene only
  draws. A test can check every number here without a browser, including the one
  invariant the look depends on: the camera never draws a file past its own pixels.
*/

export type CastBox = { x: number; y: number; width: number; height: number };

export type CastElement = {
  mark: string;
  file: string;
  t: number;
  box: CastBox;
  target?: CastBox;
  name?: string;
  kind?: string;
};

/** A mark's control rendered by the page at several pixels per CSS pixel (@panoma/video-capture, MacroAsset). */
export type CastMacro = {
  mark: string;
  file: string;
  box: CastBox;
  target?: CastBox;
  pixelRatio: number;
  /** When it was photographed: at its mark, or the instant before the press when the mark could not see it. Absent means "mark". */
  at?: "mark" | "press";
  change?: { box: CastBox; share: number; boxShare: number };
  after?: { file: string; box: CastBox; pixelRatio: number };
  afterControl?: { file: string; pixelRatio: number };
  focus?: CastBox;
  /** The camera pass observed a visible result settle, before the reading dwell. */
  resultAtMs?: number;
};

/** A lossless full viewport at a mark (@panoma/video-capture, FrameAsset). */
export type CastStill = { mark: string; file: string; pixelRatio: number; url?: string };

/*
  A take with everything the capture wrote beside its video.

  Named for what it is rather than for the first recipe that wanted it. Every field is
  optional, so this is source-compatible with a bare `CastSession` in both directions: an
  older take, or a hand-built session in a test, still satisfies it.
*/
export type TakeWithAssets = CastSession & {
  elements?: CastElement[];
  macros?: CastMacro[];
  frames?: CastStill[];
  last?: CastStill;
};

/** The spotlight's own name for it, kept so that recipe and its tests are untouched. */
export type SpotlightSession = TakeWithAssets;

/*
  The clock. Open and kicker take a bar each; then every feature is a CARD of one
  bar and a USE of two, and the close takes two: three features are 26 seconds at
  100/30, the same length the film had when the card was written over the picture
  instead of before it.

  One thing on screen at a time is the rule the whole clock now serves. The card is
  the claim alone on the stage; the use is the product alone, with nothing written
  over it. Until 2026-09-03 a use was three bars and the claim was typed across its
  last one — the name of the feature, the interface's own answer on a chip, and the
  control being pressed, all in the same frame — and the camera then travelled to the
  next control so the piece never cut. That is what a viewer reads as busy: the eye
  is asked to be in two places while neither has finished.

  So a use is now its own shot, and it ends. In beats from its first frame: the
  pointer is at rest on the control by beat 2, the push runs through beat 3, the
  press lands on beat 4, the result on the next downbeat, the camera comes to rest on
  beat 6 and holds — drifting, never frozen — until the cut into the next card.
*/
export const SPOTLIGHT = {
  openBars: 1,
  kickerBars: 1,
  cardBars: 1,
  unitBars: 2,
  endBars: 2,
  maxFeatures: 3,
  arriveBeats: 2,
  pressBeat: 3,
  resultBeat: 4,
  restBeat: 6,
  /** The control's height as a share of the canvas's short side when framed, and when pressed. */
  framedShare: 0.26,
  pressedShare: 0.4,
  /** The page's own pixels are 2x: past this the page dissolves and only clips are drawn. */
  pageCap: 2,
  /**
   * And the scale at which it is drawn whole. Any key whose content IS the page —
   * a use with no clip, a result that navigated or revealed — is capped here, never
   * at `pageCap`, where the page's own opacity is zero: capping there put a claim
   * over an empty plate for four beats, which four readers found independently.
   */
  pageWhole: 1.5,
  /** The least a result may be shown at: 16 px interface type at 1.3x is 21 px on a 1080 canvas, which reads. */
  legibleScale: 1.3,
  /**
   * The least the press may be closer than the framing. A control small enough that
   * both scales hit its file's ratio was framed and pressed at the same 8x, and the
   * camera stood still from the arrival to the press — a second and a half the
   * review reads as repeated frames, because it is.
   */
  pushLeast: 1.18,
  /** The slow drift of a held frame, so a hold is never a freeze: a rate, over the beats a rest normally lasts. */
  driftShare: 0.015,
  /**
   * The most a rest can drift at that rate. Every cap leaves this much room, or the
   * drift is what puts a file past its own pixels; clamping it instead stood the
   * picture still for 77 frames, which is what the review found.
   */
  driftMost: 0.025,
  /**
   * How far back the camera is when a control arrives, and closes over the arrival
   * beats. A drift alone is motion the picture does not read, and a whole second of
   * it came back from the review as duplicate frames twice, at 4.5% as well. A tenth
   * is a push-in anyone can see, which is what the reference films do while an element
   * settles. The camera arrives; it does not wait.
   */
  arriveShare: 0.1,
} as const;

/**
 * A camera key: which CSS box of the viewport is the window, how many canvas pixels
 * each of its CSS pixels gets, and where its centre sits on the canvas. The window
 * IS the plate the scene draws; the framing for every sprite follows from it.
 */
export type CameraKey = { window: CastBox; k: number; cx: number; cy: number };

export type SpotlightUnit = {
  kind: "unit";
  from: number;
  to: number;
  id: string;
  mark: string;
  index: number;
  /** How far back the camera is when this control arrives; a feed cut opens on the arrival, so it pushes further. */
  arrive?: number;
  /** The pointer sets off a tick in. */
  pointerFrom: number;
  /** Beat 3: the push begins. */
  pushFrom: number;
  /** Beat 4: the press lands. */
  press: number;
  /** The next downbeat: the result shows. */
  result: number;
  /*
    The first frame of the pull-out on which the menu's clip may be drawn: its
    ratio is lower than the control's, so it waits until the camera has come down
    to its own pixels. Until then the control's clip covers the region. Equal to
    `result` for every other form, and when the press was never past the menu's ratio.
  */
  unfoldFrom: number;
  /** The camera is at rest on cause and effect, and holds there until the cut. */
  rest: number;
  /**
   * The frame the page starts to come in on: the first the camera is under its own
   * pixels. The result's window opens no faster than that, and no faster than a beat
   * either — the plate was empty for five frames before the page arrived, and the
   * page then dissolved in six, which the review counted as a cut.
   */
  pageFrom: number;
  /*
    How the result is shown. "menu": a component grew in place and the capture
    rendered it — it unfolds from the control's own box. "navigate": the page
    changed route — the next frame is the after-state and the camera lands on the
    heading it produced beside the control. "reveal": the page changed in place —
    the next frame is the after-state, the before is shown beside it. "none":
    nothing measurable changed, or the take has nothing after this mark.
  */
  form: "menu" | "reveal" | "navigate" | "none";
  macro?: CastMacro;
  before?: CastStill;
  after?: CastStill;
  /** Where the press lands, in viewport fractions: the take's click, or the control's centre. */
  fx: number;
  fy: number;
  /** True when the take clicked between this mark and the next; otherwise the pointer only points. */
  clicked: boolean;
  camera: { framed: CameraKey; pressed: CameraKey; result: CameraKey };
};

/** The claim, alone on the stage, before the use it names. Nothing of the product is on it. */
export type SpotlightCard = { kind: "card"; from: number; to: number; id: string; index: number; mark: string };

export type SpotlightSection =
  | { kind: "open"; from: number; to: number; still?: CastStill; camera: { from: CameraKey; to: CameraKey } }
  | { kind: "kicker"; from: number; to: number; still?: CastStill; camera: CameraKey }
  | SpotlightCard
  | SpotlightUnit
  | { kind: "end"; from: number; to: number; id?: string };

export type SpotlightPlan = {
  durationInFrames: number;
  sections: SpotlightSection[];
  /** Marks whose control the take did not render at macro scale: their use is shown from the page at its own pixels. */
  degraded: string[];
};

/** A rectangle as shares of the canvas (or of the stage, where the recipe says so). */
export type SpotlightArea = { x: number; y: number; width: number; height: number };

export type SpotlightLayout = {
  /** Where an isolated control is framed: shares of the canvas. */
  macro: SpotlightArea;
  /** The result plate: shares of the canvas. */
  plate: SpotlightArea;
};

/*
  There is no claim column and no label line here any more, and that is why the plate
  is the whole stage in every shape.

  A wide canvas used to keep its picture in the right-hand 46% because the claim was
  set in a column beside it, and a tall one gave the bottom 30% to the same words. The
  claim has its own card now, so a use is the product and nothing else — and a product
  filmed in half a frame is a product a viewer has to lean toward.
*/

/** Layout tokens chosen from the canvas's shape, so the recipe never branches on a format id. */
export function spotlightLayout(format: Format): SpotlightLayout {
  const portrait = format.height / format.width > 1.25;
  const square = !portrait && format.width / format.height < 1.25;
  if (portrait) {
    return {
      macro: { x: 5, y: 8, width: 90, height: 84 },
      plate: { x: 6, y: 6, width: 88, height: 88 },
    };
  }
  if (square) {
    return {
      macro: { x: 6, y: 6, width: 88, height: 88 },
      plate: { x: 6, y: 6, width: 88, height: 88 },
    };
  }
  return {
    macro: { x: 10, y: 8, width: 80, height: 84 },
    plate: { x: 8, y: 6, width: 84, height: 88 },
  };
}

export function areaOf(area: SpotlightArea, size: { width: number; height: number }): CastBox {
  return { x: (size.width * area.x) / 100, y: (size.height * area.y) / 100, width: (size.width * area.width) / 100, height: (size.height * area.height) / 100 };
}

const centre = (b: CastBox) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

export function unionBox(a: CastBox, b: CastBox): CastBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

export function padBox(b: CastBox, share: number, within: { width: number; height: number }): CastBox {
  const px = b.width * share;
  const py = b.height * share;
  const x = Math.max(0, b.x - px);
  const y = Math.max(0, b.y - py);
  return { x, y, width: Math.min(within.width, b.x + b.width + px) - x, height: Math.min(within.height, b.y + b.height + py) - y };
}

/**
 * The key that shows `window` as large as `area` allows, never past `cap` canvas
 * pixels per CSS pixel: a clip rendered at 8x may fill the canvas, a 2x frame may
 * not be stretched past 2x, and a control is never taller than the share asked for.
 */
export function fitKey(window: CastBox, area: CastBox, cap: number): CameraKey {
  const k = Math.min(area.width / window.width, area.height / window.height, cap);
  const c = centre(area);
  return { window, k, cx: c.x, cy: c.y };
}

/** The plate on the canvas: the window at its scale, about its centre. */
export function keyRect(key: CameraKey): CastBox {
  const width = key.window.width * key.k;
  const height = key.window.height * key.k;
  return { x: key.cx - width / 2, y: key.cy - height / 2, width, height };
}

/*
  A framing places the viewport's CSS plane on the canvas: canvas = anchor + (css −
  centre) × k. Every plane of a use — the page, the control, its after-state, the
  pointer, the ring — is drawn through the same framing, so they can never disagree
  about where a pixel of the product is while the camera moves.
*/
export type PlaneFraming = { k: number; cx: number; cy: number; ax: number; ay: number };

export function keyFraming(key: CameraKey): PlaneFraming {
  const c = centre(key.window);
  return { k: key.k, cx: c.x, cy: c.y, ax: key.cx, ay: key.cy };
}

export function frameBox(f: PlaneFraming, box: CastBox): CastBox {
  return { x: f.ax + (box.x - f.cx) * f.k, y: f.ay + (box.y - f.cy) * f.k, width: box.width * f.k, height: box.height * f.k };
}

export function framePoint(f: PlaneFraming, x: number, y: number): { x: number; y: number } {
  return { x: f.ax + (x - f.cx) * f.k, y: f.ay + (y - f.cy) * f.k };
}

/**
 * Between two keys. The scale travels geometrically, so a zoom reads evenly from
 * one end to the other; the plate travels on the canvas between the two plates,
 * so it is never larger than either; and the view's centre travels on the page
 * between the two windows' centres. The window's size follows from the plate and
 * the scale — never interpolated on its own, which once put a 2300 px plate on a
 * 1920 px canvas halfway between a result and the next control, with the control
 * off the canvas to the left.
 */
export function mixKey(a: CameraKey, b: CameraKey, t: number): CameraKey {
  const u = Math.min(1, Math.max(0, t));
  const k = a.k * Math.pow(b.k / a.k, u);
  const ra = keyRect(a);
  const rb = keyRect(b);
  const width = lerp(ra.width, rb.width, u) / k;
  const height = lerp(ra.height, rb.height, u) / k;
  const ca = centre(a.window);
  const cb = centre(b.window);
  const wx = lerp(ca.x, cb.x, u);
  const wy = lerp(ca.y, cb.y, u);
  return { window: { x: wx - width / 2, y: wy - height / 2, width, height }, k, cx: lerp(a.cx, b.cx, u), cy: lerp(a.cy, b.cy, u) };
}

/** A key scaled about its centre: the drift of a held frame. */
export function driftKey(key: CameraKey, amount: number): CameraKey {
  return { ...key, k: key.k * (1 + amount) };
}

/**
 * How much of the page is drawn at this scale: whole at `pageWhole` and below, gone
 * at its own pixels, a ramp between — long enough that a pull-out from 8x to the
 * page takes a dozen frames to bring it in, which is a dissolve and not a cut.
 */
export function pageAlpha(k: number, cap = SPOTLIGHT.pageCap): number {
  const whole = cap * (SPOTLIGHT.pageWhole / SPOTLIGHT.pageCap);
  return Math.min(1, Math.max(0, (cap - k) / (cap - whole)));
}

/** A box grown to an aspect, about its centre, kept inside the viewport: the plate is always full, never a strip. */
export function withAspect(box: CastBox, aspect: number, within: { width: number; height: number }): CastBox {
  let width = box.width;
  let height = box.height;
  if (width / height < aspect) width = height * aspect;
  else height = width / aspect;
  width = Math.min(width, within.width);
  height = Math.min(height, within.height);
  const x = Math.min(Math.max(0, box.x + box.width / 2 - width / 2), within.width - width);
  const y = Math.min(Math.max(0, box.y + box.height / 2 - height / 2), within.height - height);
  return { x, y, width, height };
}

/**
 * How much of a result has arrived on a frame: the page's own ramp, and never faster
 * than a beat. The scale alone said "arrived" six frames after it said "nothing",
 * and the window that follows it travelled off the control while the page was still
 * invisible — an empty plate, then a page, which is a cut in everything but name.
 */
export function pageArrival(unit: SpotlightUnit, k: number, frame: number, beatFrames: number): number {
  const byTime = Math.min(1, Math.max(0, (frame - unit.pageFrom + 1) / beatFrames));
  return Math.min(pageAlpha(k), byTime);
}

/** How far a menu has unfolded on a frame: from its control's own box outward, over two beats, once the camera is down to its pixels. */
export function unfoldProgress(unit: SpotlightUnit, frame: number, beatFrames: number): number {
  if (unit.form !== "menu" || frame < unit.unfoldFrom) return 0;
  const t = Math.min(1, (frame - unit.unfoldFrom) / (beatFrames * 2));
  /* Slow at both ends: a cubic ease-out opens a third of the menu in two frames, which scdet reads as a cut. */
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** A pointer's travel: a shallow arc from `from` to `to` at `u` (0..1, already eased). A straight line reads as a machine. */
export function cursorArc(from: { x: number; y: number }, to: { x: number; y: number }, u: number, bend = 0.18): { x: number; y: number } {
  const mx = (from.x + to.x) / 2 - (to.y - from.y) * bend;
  const my = (from.y + to.y) / 2 + (to.x - from.x) * bend;
  const a = 1 - u;
  return { x: a * a * from.x + 2 * a * u * mx + u * u * to.x, y: a * a * from.y + 2 * a * u * my + u * u * to.y };
}

const easeInOut = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
};
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

export function spotlightPlan(session: SpotlightSession, brief: Brief, format: Format): SpotlightPlan {
  const grid = gridOf(brief);
  const beat = grid.beatFrames;
  const bar = grid.barFrames;
  const layout = spotlightLayout(format);
  const canvas = { width: format.width, height: format.height };
  const short = Math.min(format.width, format.height);
  /*
    The cut this piece is. `full` is the 20-to-26-second film: establish, name, three
    uses, close. `stop` is the same footage cut for a feed — one control, no
    establishing shot, and the name at the end rather than the front, because a viewer
    scrolling past has to be shown the change before they are told whose it is. It is a
    `params` knob and not a recipe: same brief grammar, same facts, same camera.
  */
  const cut = brief.params?.cut === "stop" ? "stop" : "full";
  const features = cut === "stop" ? 1 : SPOTLIGHT.maxFeatures;
  /*
    Two numbers a feed cut does not share with the film.

    The close is one bar, not two: measured on the first cut the engine made, four of its
    twelve sheet cells were the wordmark — a third of a thirteen-second piece spent on a
    card that has one word to land.

    And the arrival pushes nearly three times as far. In the full film the arrival is a
    settle between two controls and the camera has just travelled; here it IS the
    opening, and at the film's 10% the review measured 1.57 s of near-identical frames
    from frame 0 — a feed cut whose first second does not move is a feed cut nobody sees.
  */
  const endBars = cut === "stop" ? 1 : SPOTLIGHT.endBars;
  const cardFrames = bar * SPOTLIGHT.cardBars;
  const arriveShare = cut === "stop" ? 0.28 : SPOTLIGHT.arriveShare;
  /*
    And the control is drawn twice as large.

    The film's 26% is a share of the canvas's short side, sized so three controls in
    sequence read as one product being used. A feed cut has one control and one job, and
    at 26% of a 1080-wide vertical canvas universend's mute button came out 281 px tall
    inside a 1920-tall frame — a lit dot in an empty room, which is what the first cut
    measured here actually looked like. A phone at arm's length needs the change to be
    the picture.
  */
  const framedShare = cut === "stop" ? 0.55 : SPOTLIGHT.framedShare;
  const pressedShare = cut === "stop" ? 0.78 : SPOTLIGHT.pressedShare;
  const pairs = brief.lines.filter((line) => line.mark).slice(0, features);
  if (pairs.length === 0) throw new Error(`FeatureSpotlight "${brief.id}" needs at least one line with a mark.`);
  const marks = session.marks ?? [];
  const macros = session.macros ?? [];
  const frames = session.frames ?? [];
  const vw = session.viewport.width;
  const vh = session.viewport.height;
  const viewport: CastBox = { x: 0, y: 0, width: vw, height: vh };
  /* The cap for any key whose content is the page: the drift rides on top of it, and it must still land inside the scale where the page is drawn whole. */
  const driftRoom = 1 + SPOTLIGHT.driftMost;
  const pageKeyCap = SPOTLIGHT.pageWhole / driftRoom;
  const macroArea = areaOf(layout.macro, canvas);
  const plateArea = areaOf(layout.plate, canvas);
  const pressArea: CastBox = { x: short * 0.02, y: short * 0.02, width: format.width - short * 0.04, height: format.height - short * 0.04 };
  const degraded: string[] = [];

  /* One use per claim, its material and its forms, before any frame is placed. */
  const uses = pairs.map((line, index) => {
    const mark = marks.find((m) => m.name === line.mark);
    if (!mark) throw new Error(`Line narrates mark "${line.mark}", which the take does not have.`);
    const next = marks[marks.indexOf(mark) + 1];
    /*
      A macro photographed at the press (`at: "press"`) sits in the coordinates of the
      SCROLLED page, and the only still this recipe has of the mark is the one taken before
      the scroll; pinning the clip to it would draw the control where it was not. Until a
      still is taken at the press too, such a mark is shown as it was before the press
      capture existed: the page, without a press.
    */
    const macro = macros.find((m) => m.mark === line.mark && m.at !== "press");
    const before = frames.find((f) => f.mark === line.mark);
    const after = next ? frames.find((f) => f.mark === next.name) : session.last;
    /* The first product click between this mark and the next is the press; chrome earns nothing here either. */
    const click = session.events.find(
      (e): e is Extract<CastEvent, { kind: "click" }> => e.kind === "click" && e.role !== "chrome" && e.t >= mark.t && (!next || e.t < next.t),
    );
    const control = macro?.target ?? macro?.box;
    const fx = click ? click.x / vw : control ? (control.x + control.width / 2) / vw : 0.5;
    const fy = click ? click.y / vh : control ? (control.y + control.height / 2) / vh : 0.5;
    const routeChanged = Boolean(before?.url && after?.url && before.url !== after.url);
    const form: SpotlightUnit["form"] = macro?.after ? "menu" : macro?.change && after ? (routeChanged ? "navigate" : "reveal") : "none";
    if (!macro) degraded.push(line.mark!);
    return { line, index: index + 1, macro, before, after, fx, fy, clicked: click !== undefined, form };
  });

  /* The camera keys of a use: framed on its control, pushed in for the press, at rest on its result. */
  const keysOf = (use: (typeof uses)[number]): SpotlightUnit["camera"] => {
    const macro = use.macro;
    if (!macro) {
      /* No clip: the page itself, at its own pixels, around the press. The plan says so. */
      const window: CastBox = { x: use.fx * vw - macroArea.width / 4, y: use.fy * vh - macroArea.height / 4, width: macroArea.width / 2, height: macroArea.height / 2 };
      const box = padBox(window, 0, session.viewport);
      const framed = fitKey(box, macroArea, pageKeyCap / SPOTLIGHT.pushLeast);
      const pressed = fitKey(box, macroArea, pageKeyCap);
      return { framed, pressed, result: fitKey(framed.window, plateArea, pageKeyCap) };
    }
    const control = macro.target ?? macro.box;
    const pressed = fitKey(macro.box, pressArea, Math.min(macro.pixelRatio, (pressedShare * short) / control.height));
    /* Framed far enough back that the press is a move, whatever the ratio allows. */
    const framed = fitKey(macro.box, macroArea, Math.min(macro.pixelRatio, (framedShare * short) / control.height, pressed.k / SPOTLIGHT.pushLeast));
    const aspect = plateArea.width / plateArea.height;
    let result: CameraKey;
    if (use.form === "menu" && macro.after) result = fitKey(macro.after.box, plateArea, macro.after.pixelRatio / driftRoom);
    else if (use.form === "navigate") {
      /*
        The control and the heading its click produced, together — unless they are far
        enough apart that holding both means showing the page at half its own size.
        A sidebar item and a heading across the page made a window of 15x the plate:
        the pull-out to it read as a cut, and the type nobody could read anyway. Then
        it is the heading, with room around it, which is what the claim names.
      */
      const both = padBox(macro.focus ? unionBox(macro.box, macro.focus) : (macro.change?.box ?? macro.box), 0.04, session.viewport);
      const fits = Math.min(plateArea.width / both.width, plateArea.height / both.height);
      /* The fallback's room is a line of its own height, not a share of its width: padding a 700 px heading by 30% of itself makes a window wider than the plate. */
      const alone = macro.focus ?? macro.box;
      const pad = alone.height * 0.6;
      const rx = Math.max(0, alone.x - pad);
      const ry = Math.max(0, alone.y - pad);
      const room: CastBox = { x: rx, y: ry, width: Math.min(vw, alone.x + alone.width + pad) - rx, height: Math.min(vh, alone.y + alone.height + pad) - ry };
      const window = fits >= SPOTLIGHT.legibleScale ? both : room;
      result = fitKey(withAspect(window, aspect, session.viewport), plateArea, pageKeyCap);
    }
    else if (use.form === "reveal" && macro.change) {
      /*
        A change that took half the page would rest at a scale nobody can read.
        The window is the changed region's top-left corner at a legible scale — the
        column heads and the first rows of a list, not the whole list as texture —
        and the whole region only when it fits legibly.
      */
      const whole = padBox(macro.change.box, 0.03, session.viewport);
      const legible = Math.min(pageKeyCap, Math.max(SPOTLIGHT.legibleScale, Math.min(plateArea.width / whole.width, plateArea.height / whole.height)));
      const part: CastBox = { x: whole.x, y: whole.y, width: Math.min(whole.width, plateArea.width / legible), height: Math.min(whole.height, plateArea.height / legible) };
      result = fitKey(withAspect(part, aspect, session.viewport), plateArea, pageKeyCap);
    } else result = fitKey(macro.box, plateArea, framed.k / driftRoom);
    return { framed, pressed, result };
  };

  let at = 0;
  const sections: SpotlightSection[] = [];
  const push = (section: SpotlightSection) => {
    sections.push(section);
    at = section.to;
  };

  /* The open: the page the first use starts on, at cover, pushing slowly toward the first press. */
  const first = uses[0];
  const cover = Math.max(format.width / vw, format.height / vh);
  const openFrom: CameraKey = { window: viewport, k: cover, cx: format.width / 2, cy: format.height / 2 };
  const k1 = cover * 1.08;
  /* Toward the press, but never so far that the page stops covering the canvas: past its slack the frame grows bare bands with a hard page edge. */
  const slackX = Math.max(0, (vw * k1 - format.width) / 2);
  const slackY = Math.max(0, (vh * k1 - format.height) / 2);
  const shift = (offset: number, slack: number) => Math.max(-slack, Math.min(slack, -offset * k1 * 0.3));
  const openTo: CameraKey = { window: viewport, k: k1, cx: format.width / 2 + shift(first.fx * vw - vw / 2, slackX), cy: format.height / 2 + shift(first.fy * vh - vh / 2, slackY) };
  /* A stop cut has no establishing shot and no kicker: the first frame is already the control. */
  if (cut === "full") {
    push({ kind: "open", from: at, to: at + bar * SPOTLIGHT.openBars, ...(first.before ? { still: first.before } : {}), camera: { from: openFrom, to: openTo } });
    push({ kind: "kicker", from: at, to: at + bar * SPOTLIGHT.kickerBars, ...(first.before ? { still: first.before } : {}), camera: openTo });
  }

  const cameras = uses.map(keysOf);
  uses.forEach((use, i) => {
    /*
      The claim, alone, and then the product, alone — except in a feed cut, where the
      order is the other way round for the same reason the name is: someone scrolling
      past has to be shown the change before they are told anything about it, and
      `story.open-on-motion` says so by name when a card opens the piece.
    */
    const card = { kind: "card" as const, id: use.line.id, index: use.index, mark: use.line.mark! };
    if (cut !== "stop") push({ ...card, from: at, to: at + cardFrames });
    const from = at;
    const unit: SpotlightUnit = {
      kind: "unit",
      from,
      to: from + bar * SPOTLIGHT.unitBars,
      ...(arriveShare === SPOTLIGHT.arriveShare ? {} : { arrive: arriveShare }),
      id: use.line.id,
      mark: use.line.mark!,
      index: use.index,
      pointerFrom: from + grid.tickFrames,
      pushFrom: from + beat * SPOTLIGHT.pressBeat - beat,
      press: from + beat * SPOTLIGHT.pressBeat,
      result: from + beat * SPOTLIGHT.resultBeat,
      unfoldFrom: from + beat * SPOTLIGHT.resultBeat,
      rest: from + beat * SPOTLIGHT.restBeat,
      pageFrom: from + bar * SPOTLIGHT.unitBars,
      form: use.form,
      ...(use.macro ? { macro: use.macro } : {}),
      ...(use.before ? { before: use.before } : {}),
      ...(use.after ? { after: use.after } : {}),
      fx: use.fx,
      fy: use.fy,
      clicked: use.clicked,
      camera: cameras[i],
    };
    /* When the page comes in, if it does: the search reads only the scale, which no ramp of this depends on. */
    for (let f = unit.from; f < unit.to; f++) {
      if (pageAlpha(unitCamera(unit, f, beat).key.k) > 0) {
        unit.pageFrom = f;
        break;
      }
    }
    /* Already there at the first frame — a use with no clip of its own — so nothing has to arrive. */
    if (unit.pageFrom === unit.from) unit.pageFrom = unit.from - beat;
    /* The menu's clip waits for the camera to come down to its pixels: the first such frame of the pull-out. */
    if (use.form === "menu" && use.macro?.after) {
      const ratio = use.macro.after.pixelRatio;
      for (let f = unit.result; f <= unit.rest; f++) {
        if (unitCamera(unit, f, beat).key.k <= ratio + 1e-9) {
          unit.unfoldFrom = f;
          break;
        }
      }
    }
    push(unit);
    if (cut === "stop") push({ ...card, from: at, to: at + cardFrames });
  });
  const end = brief.lines.find((line) => line.id === "end");
  push({ kind: "end", from: at, to: at + bar * endBars, ...(end ? { id: end.id } : {}) });
  return { durationInFrames: at, sections, degraded };
}

export function spotlightSectionAt(plan: SpotlightPlan, frame: number): SpotlightSection {
  return plan.sections.find((section) => frame >= section.from && frame < section.to) ?? plan.sections[plan.sections.length - 1];
}

export type UnitStage = "arrive" | "push" | "press" | "reveal" | "rest";

/**
 * Where the camera is on any frame of a use, and what the frame is doing. A held
 * key drifts in scale so it is never a freeze; the shot ends on that drift and the
 * piece cuts to the next card.
 *
 * The window is the plate, and it is only ever as wide as what fills it. On the
 * pull-out the scale comes down first while the window stays on the control; the
 * window widens toward the result only as the page comes in under it (the same ramp
 * `pageAlpha` draws by), or, for a menu, exactly as far as the menu has unfolded.
 * A window that widens before its content did is an empty plate on a dark stage.
 */
export function unitCamera(unit: SpotlightUnit, frame: number, beatFrames: number): { key: CameraKey; stage: UnitStage; t: number } {
  const { framed, pressed, result } = unit.camera;
  const local = frame - unit.from;
  /* A rate, not a total: the same creep per frame however long the rest lasts, which is what keeps the last use's tail from being 77 identical frames. Every cap leaves room for `driftMost`. */
  const drifted = (f: number) => driftKey(result, (SPOTLIGHT.driftShare * (f - unit.rest)) / Math.max(1, unit.to - unit.rest));
  if (frame < unit.pushFrom) {
    const t = local / Math.max(1, unit.pushFrom - unit.from);
    return { key: driftKey(framed, lerp(-(unit.arrive ?? SPOTLIGHT.arriveShare), SPOTLIGHT.driftShare, easeOut(t))), stage: "arrive", t };
  }
  if (frame < unit.press) {
    const t = (frame - unit.pushFrom) / Math.max(1, unit.press - unit.pushFrom);
    return { key: mixKey(driftKey(framed, SPOTLIGHT.driftShare), pressed, easeInOut(t)), stage: "push", t };
  }
  if (frame < unit.result) return { key: pressed, stage: "press", t: (frame - unit.press) / Math.max(1, unit.result - unit.press) };
  if (frame < unit.rest) {
    const t = (frame - unit.result) / Math.max(1, unit.rest - unit.result);
    /* Flat at both ends on purpose: leaving the press at speed instead reads to the review's scene detector as a cut on the very frame the result lands. */
    const key = mixKey(pressed, result, easeInOut(t));
    const spread =
      unit.form === "menu"
        ? unfoldProgress(unit, frame, beatFrames)
        : pressed.k <= result.k + 1e-9
          ? 1
          : pageArrival(unit, key.k, frame, beatFrames);
    const w = (p: CastBox, q: CastBox): CastBox => ({ x: lerp(p.x, q.x, spread), y: lerp(p.y, q.y, spread), width: lerp(p.width, q.width, spread), height: lerp(p.height, q.height, spread) });
    /*
      The spread says how much of the result has arrived; the mix says how large the
      plate may be. The window is the smaller of the two, on the spread's centre — a
      window wider than the mix's is a plate wider than the canvas, which is how a
      1935 px picture reached a 1920 px frame.
    */
    const want = w(pressed.window, result.window);
    const window: CastBox = {
      width: Math.min(want.width, key.window.width),
      height: Math.min(want.height, key.window.height),
      x: 0,
      y: 0,
    };
    window.x = want.x + want.width / 2 - window.width / 2;
    window.y = want.y + want.height / 2 - window.height / 2;
    return { key: { ...key, window }, stage: "reveal", t };
  }
  const t = (frame - unit.rest) / Math.max(1, unit.to - unit.rest);
  return { key: drifted(frame), stage: "rest", t: Math.min(1, t) };
}

/* ---------- Loop: fixed 4 bars, engineered to be seamless ---------- */

export const LOOP_BARS = 4;
export const LOOP_ROTATIONS = 2;

export function loopDuration(brief: Brief): number {
  return gridOf(brief).bar(LOOP_BARS);
}

/**
 * Sweep angle in degrees. Whole rotations across the exact duration make
 * frame N congruent with frame 0 — the seam exists only in the counter,
 * and the flash covers it.
 */
export function sweepAngle(frame: number, total: number): number {
  return (360 * LOOP_ROTATIONS * frame) / total;
}

/** The seam flash: bright at both edges so the loop point reads as a beat, not a cut. */
export function seamFlash(frame: number, total: number): number {
  const edge = Math.min(frame, total - frame);
  return Math.max(0, 1 - edge / 3);
}

/** Frame worth freezing for a thumbnail: late enough to show the payoff. */
export function heroFrame(brief: Brief, durationInFrames: number): number {
  return Math.min(durationInFrames - 1, Math.round(durationInFrames * 0.68));
}

/* ---------- ScreenCast: a recorded session, beautified on the grid ---------- */

export type CastEvent =
  | { t: number; kind: "move"; x: number; y: number }
  | { t: number; kind: "click"; x: number; y: number; role?: "product" | "chrome" }
  | { t: number; kind: "key"; text: string; role?: "product" | "chrome" }
  | { t: number; kind: "scroll"; y: number; durationMs?: number; role?: "product" | "chrome" }
  | { t: number; kind: "mark"; name: string };

export type CastSession = {
  viewport: { width: number; height: number };
  durationMs: number;
  events: CastEvent[];
  isMobile?: boolean;
  /** Dead head at the top of the recording, before the product had painted. */
  readyMs?: number;
  /** The take's own frame rate. Absent means "assume it matches the timeline". */
  fps?: number;
  /** Video pixels per CSS pixel of the viewport. Absent on takes recorded at the CSS size, which are 1x. */
  videoRatio?: number;

  /** Named instants the recording script left behind, for a tutorial to pin to. */
  marks?: { name: string; t: number }[];
};

/*
  Conforming the take to the timeline.

  Playwright records at 25 fps and does not expose the setting. A 30 fps timeline
  seeking into 25 fps footage lands on the same source frame twice every sixth
  frame, so five of every thirty frames are a freeze — motion that is perfectly
  smooth in the recording still judders on screen, and a slow scroll is exactly
  where a viewer feels it.

  The fix is the one film has used since television existed: conform the footage
  frame for frame rather than resample it in time. Consuming 1.2 source seconds
  per timeline second gives every rendered frame its own distinct source frame and
  repeats nothing — the same trade as the PAL speed-up, and for a product demo a
  fifth faster is a tighter cut, not a defect.

  Never below 1: footage recorded FASTER than the timeline is simply sampled down,
  which is a decision about which frames to drop and not something to do by
  accident by playing the whole demo in slow motion.
*/
export function castSpeed(session: CastSession, fps: number): number {
  const source = session.fps ?? fps;
  if (!Number.isFinite(source) || source <= 0) return 1;
  return Math.max(1, fps / source);
}

/** Where a moment recorded at session time `t` lands on the timeline. */
export function eventFrame(session: CastSession, plan: CastPlan, fps: number, t: number): number {
  const ready = session.readyMs ?? 0;
  return plan.videoStart + Math.round((((t - ready) / 1000) * fps) / castSpeed(session, fps));
}

/*
  Where the product sits on the canvas.

  The bug this replaces: a desktop take fitted into a 9:16 canvas is a stamp in the
  middle of an empty frame — measured at 25% of the pixels, with three quarters of
  the canvas doing nothing. Two decisions fix it together, and neither works alone:
  the mobile TAKE gives portrait material (see @panoma/video-capture), and this function
  spends the whole stage on it instead of reserving flow space for type.

  Hook and caption are overlays living in the platform's safe margins — the strip
  the platform UI covers anyway — so the window is free to fill everything else.
*/
export type CastFrame = {
  /** Outer window, canvas coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Inner surface where the recording paints. */
  content: { x: number; y: number; width: number; height: number };
  /** How the window is dressed. */
  chrome: "device" | "browser";
  /** Browser bar height, or bezel thickness for a device. */
  chromeSize: number;
  radius: number;
};

export function castFrame(
  format: Format,
  source: { width: number; height: number },
  opts: { isMobile?: boolean } = {},
): CastFrame {
  /*
    The window is measured against the CANVAS, not the safe stage. The safe stage
    exists so type is never covered; the product is not type. Hook and caption are
    overlays that live inside those margins, on a scrim, so the recording is free
    to use everything — which is the whole difference between a demo that fills a
    phone screen and a postage stamp floating in black.
  */
  const unit = Math.min(format.width, format.height) / 100;
  const aspect = source.width / source.height;
  const device = opts.isMobile ?? false;

  const marginX = unit * 3;
  const marginY = unit * 2.5;
  /* Wide formats keep a band so the caption never sits on the product. */
  const captionBand = format.id === "v" ? 0 : unit * 6;

  const availW = format.width - marginX * 2;
  const availH = format.height - marginY * 2 - captionBand;

  const chromeSize = device ? unit * 1.4 : unit * 3.6;
  /* A device bezel wraps all four sides; a browser bar only steals height. */
  const padW = device ? chromeSize * 2 : 0;
  const padH = device ? chromeSize * 2 : chromeSize;

  const contentH = Math.min((availW - padW) / aspect, availH - padH);
  const contentW = contentH * aspect;

  const width = contentW + padW;
  const height = contentH + padH;

  return {
    x: (format.width - width) / 2,
    y: marginY + (availH - height) / 2,
    width,
    height,
    content: {
      x: device ? chromeSize : 0,
      y: chromeSize,
      width: contentW,
      height: contentH,
    },
    chrome: device ? "device" : "browser",
    chromeSize,
    radius: device ? unit * 5 : unit * 1.4,
  };
}

/** Share of the canvas the product occupies — the number the framing bug was. */
export function castFill(format: Format, frame: CastFrame): number {
  return (frame.content.width * frame.content.height) / (format.width * format.height);
}

export type ZoomSegment = {
  /** Frames, composition-relative. */
  from: number;
  to: number;
  /** Zoom focus in viewport coordinates. */
  cx: number;
  cy: number;
  scale: number;
};

export type CastPlan = {
  durationInFrames: number;
  /** Frame at which the recording starts playing (after the intro bar). */
  videoStart: number;
  videoFrames: number;
  zooms: ZoomSegment[];
};

/**
 * The choreography: one intro bar, the session at natural speed, one outro bar,
 * total rounded up to whole bars. Every zoom-in ATTACKS ON A BEAT — the click
 * lands mid-hold — which is the difference between an effect and an edit.
 */
export function castPlan(session: CastSession, brief: Brief, zoomScale = 1.75): CastPlan {
  const grid = gridOf(brief);
  const fps = grid.fps;
  const videoStart = grid.barFrames;
  const ready = session.readyMs ?? 0;
  /* Conformed, so the take occupies more timeline than it does wall clock. */
  const videoFrames = Math.ceil((((session.durationMs - ready) / 1000) * fps) / castSpeed(session, fps));
  const rawTotal = videoStart + videoFrames + grid.barFrames;
  const durationInFrames = Math.ceil(rawTotal / grid.barFrames) * grid.barFrames;

  const zooms: ZoomSegment[] = [];
  const speed = castSpeed(session, fps);
  for (const e of session.events) {
    if (e.kind !== "click") continue;
    const clickFrame = videoStart + Math.round((((e.t - ready) / 1000) * fps) / speed);
    if (clickFrame < videoStart) continue; /* happened before the product painted */
    /* Attack on the last beat boundary at least half a beat before the click. */
    const attack = Math.floor((clickFrame - grid.beatFrames / 2) / grid.beatFrames) * grid.beatFrames;
    const release = attack + grid.barFrames + grid.beatFrames;
    const last = zooms[zooms.length - 1];
    if (last && attack < last.to + grid.beatFrames) {
      /*
        Clicks crowd. Holding the OLD focus while the new click lands off-crop is
        the one dishonest option — the viewer would watch an empty region. Either
        the previous zoom releases a beat early and the new focus gets its own
        segment, or (when even that would leave the previous zoom shorter than
        two beats) the newcomer is skipped and the first focus keeps the frame.
      */
      const truncated = attack - grid.beatFrames;
      if (truncated < last.from + grid.beatFrames * 2) continue;
      last.to = truncated;
    }
    zooms.push({
      from: Math.max(videoStart, attack),
      to: Math.min(release, durationInFrames - grid.beatFrames),
      cx: e.x,
      cy: e.y,
      scale: zoomScale,
    });
  }
  return { durationInFrames, videoStart, videoFrames, zooms };
}

/** Zoom state at a frame: scale plus focus, eased in over a beat at both edges. */
export function zoomAt(
  plan: CastPlan,
  brief: Brief,
  frame: number,
): { scale: number; cx: number; cy: number } {
  const grid = gridOf(brief);
  for (const z of plan.zooms) {
    if (frame < z.from || frame > z.to) continue;
    const attack = Math.min(1, (frame - z.from) / grid.beatFrames);
    const release = Math.min(1, (z.to - frame) / grid.beatFrames);
    const amount = Math.min(attack, release);
    /* Smoothstep: no velocity jump at either end of the ramp. */
    const eased = amount * amount * (3 - 2 * amount);
    return { scale: 1 + (z.scale - 1) * eased, cx: z.cx, cy: z.cy };
  }
  return { scale: 1, cx: 0, cy: 0 };
}

/**
 * The transform that puts the focus on screen.
 *
 * `transform-origin: <click>` was the intuitive choice and the wrong one: a CSS
 * transform leaves the origin point stationary, so the zoom magnified AROUND the
 * click and left it exactly where it already was — which, for clicks recorded near
 * the bottom edge (a cookie banner, a submit button), means magnifying towards a
 * corner the platform's own UI covers. Scaling about the centre and then translating
 * the focus towards it is what "zoom in on that" actually means.
 *
 * Returned in fractions of the content box, so the caller writes
 * `translate(dx*100%, dy*100%) scale(s)` with a centred origin. The clamp keeps the
 * scaled content covering the box: past (s-1)/2 the edge would pull inside and
 * expose background.
 */
export function zoomTransform(
  plan: CastPlan,
  brief: Brief,
  frame: number,
  source: { width: number; height: number },
  depth = 1,
): { scale: number; dx: number; dy: number } {
  const at = zoomAt(plan, brief, frame);
  const scale = 1 + (at.scale - 1) * depth;
  if (scale <= 1) return { scale: 1, dx: 0, dy: 0 };
  const limit = (scale - 1) / 2;
  const pull = (fraction: number) => {
    const want = -(fraction - 0.5) * scale;
    return Math.max(-limit, Math.min(limit, want));
  };
  return {
    scale,
    dx: pull(at.cx / source.width),
    dy: pull(at.cy / source.height),
  };
}

/**
 * Where a point of the recording ends up on screen, once the camera has moved.
 *
 * A callout must not grow while the camera pushes in — a ring that scales with the
 * picture stops being an annotation and becomes part of it — so callouts are drawn
 * on the content box AFTER the transform, at constant size, and this is how they
 * find the pixel they are pointing at. Both arguments and the result are fractions
 * of the box, matching the contract of cameraTransform.
 */
export function projectPoint(
  camera: { scale: number; dx: number; dy: number },
  fx: number,
  fy: number,
): { x: number; y: number } {
  return { x: (fx - 0.5) * camera.scale + 0.5 + camera.dx, y: (fy - 0.5) * camera.scale + 0.5 + camera.dy };
}

/** Cursor position at a session millisecond: eased glides between logged intents. */
export function cursorAt(session: CastSession, ms: number): { x: number; y: number } {
  const points = session.events.filter((e): e is CastEvent & { kind: "move" | "click" } =>
    e.kind === "move" || e.kind === "click",
  );
  if (points.length === 0) {
    return { x: session.viewport.width / 2, y: session.viewport.height / 2 };
  }
  if (ms <= points[0].t) return { x: points[0].x, y: points[0].y };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (ms <= b.t) {
      if (a.x === b.x && a.y === b.y) return { x: a.x, y: a.y };
      const t = b.t === a.t ? 1 : (ms - a.t) / (b.t - a.t);
      const eased = t * t * (3 - 2 * t);
      return { x: a.x + (b.x - a.x) * eased, y: a.y + (b.y - a.y) * eased };
    }
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y };
}

/* ---------- The camera: one continuous take, edited into shots ---------- */

/*
  A recording is footage, not a film. Left alone it is one static window for
  eighteen seconds, which is the honest description of "boring": nothing changes
  frame to frame except what the product happens to be doing. A camera fixes that
  without lying — it decides where to look and when to move, and every decision
  lands on the musical grid.

  Framings are expressed against the SOURCE in fractions, so the same shot list
  survives every canvas: a punch-in to the button at (0.76, 0.42) means the same
  thing whether the window is 1640px wide or 578.
*/
export type Framing = {
  /** Focus point in source fractions, 0..1. */
  fx: number;
  fy: number;
  /** 1 = the whole recording; 1.8 = punched in. */
  scale: number;
};

export type ShotEnter = "cut" | "flash" | "whip";

/**
 * How a product's own direction moves the camera.
 *
 * Two applications with the same material used to cut identically: the push depths and
 * the transitions were literals in this file, so the only thing that differed between
 * two films was which pixels were inside the frame. A direction carries a push RANGE
 * (how far the camera closes on the action, gently at an edge and hardest at the
 * centre), the transitions it allows, and the product's own seed.
 *
 * Absent, every number below is what it was before this existed — which is what keeps
 * the repository's own briefs, and every test that pins a scale, unchanged.
 */
export type ShotMotion = {
  push: readonly [number, number];
  enters: readonly ShotEnter[];
  /** From the product's NAME, so two products with identical material still choose differently. */
  seed: number;
};

/** The cast's own range and transitions, from before a direction existed. */
const CAST_MOTION: ShotMotion = { push: [1.32, 1.68], enters: ["flash", "whip"], seed: 0 };

/**
 * A trailer's proof pushes less than a cast's punch, and always did: its claim card sits
 * OVER the footage, and type over a hard push reads as noise. The direction's travel past
 * 1 is taken at this share — the ratio the two literals had before either was derived
 * (0.42 of 0.68, 0.18 of 0.32).
 */
const TRAILER_PUSH_SHARE = 0.6;

const softened = (motion: ShotMotion): readonly [number, number] => [
  1 + (motion.push[0] - 1) * TRAILER_PUSH_SHARE,
  1 + (motion.push[1] - 1) * TRAILER_PUSH_SHARE,
];

/**
 * Which transition a shot arrives on. The first punch takes the direction's hardest
 * enter; the rest cycle, offset by the product's seed, so two products whose material
 * puts a click in the same place still do not cut the same way. A direction with one
 * enter — what an unmeasured product gets — cuts every time, which is the honest edit
 * for a film with nothing to be confident about.
 */
function enterFor(motion: ShotMotion, index: number): ShotEnter {
  const list = motion.enters.length > 0 ? motion.enters : (["cut"] as const);
  return list[(index + (index === 0 ? 0 : motion.seed)) % list.length];
}

/**
 * And what a shot that is not a punch arrives on: the direction's softest enter, which
 * is the last of its list. A scroll and a hand-over are movement, not impact — the
 * default's is the whip it always was, and a direction with nothing to be confident
 * about arrives on a cut here too.
 */
function softEnter(motion: ShotMotion): ShotEnter {
  return motion.enters[motion.enters.length - 1] ?? "cut";
}

export type CastShot = {
  from: number;
  to: number;
  start: Framing;
  end: Framing;
  ease: keyof typeof easings;
  enter: ShotEnter;
  /** The window's pose for this shot, in degrees — depth, rationed. */
  tilt: { rx: number; ry: number };
  /** Why this shot exists; it ends up in the studio and in error messages. */
  reason: string;
};

/*
  How far a critically damped spring has travelled, as a share of its move, `u` natural
  time units in: the step response of the oscillator with damping ratio 1, which is the
  fastest arrival that never crosses its target. `SPRING_SETTLED` is the `u` at which it is
  within half a per cent — the same band the engine's `spring` settles to — so a move given
  T seconds is at rest when its T seconds are up.
*/
const springStep = (u: number) => 1 - (1 + u) * Math.exp(-u);
const SPRING_SETTLED = 7.64;

const easings = {
  linear: (t: number) => t,
  /* Slow settle: the camera arrives and keeps breathing. */
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  /*
    There was a `slam` here — `1 - (1 - t)^6`, an almost-instant arrival for the punch. It
    was fast because it had to be: the punch was one shot across its whole hold, so the ease
    was normalised over up to two bars and only a sextic got the camera in before the click.
    The punch is its own shot now, the spring over the time the move actually takes.
  */
  /*
    A camera with mass. The cubic `inOut` above is symmetric — as long leaving as landing —
    and a symmetric move is what a viewer reads as a tween. A body on a spring departs from
    rest, gets most of its distance done early (96% by two thirds of the way, which is where
    the press falls in a push) and spends the rest of its time landing. That is the shape
    every tool this recipe is measured against animates its zoom with, and it is arithmetic
    rather than a taste: the critically damped step response, normalised to arrive exactly
    at the end of the shot.
  */
  spring: (t: number) => springStep(SPRING_SETTLED * t) / springStep(SPRING_SETTLED),
} as const;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The shot list, derived from what actually happened in the session.
 *
 * The rhythm is a rule, not a taste: establish wide, punch on the action, pull
 * back to breathe, close wide. Clicks are the action — they are the only moments
 * the viewer is promised something — so they get the punches, and the drift
 * between them always travels toward the next one, which is what makes the cut
 * feel intentional instead of random.
 */
/*
  The grammar, in four rules that came out of pitting four aesthetic directions
  against each other. Three of them were proposed independently by directions that
  disagreed about everything else, which is the strongest evidence a rule can have.

  1. CHROME EARNS NOTHING. A consent banner is not a product moment. Before this,
     the desktop take spent its hardest push magnifying a Reject button for two
     seconds — the single defect every direction reported.
  2. A CLICK TIGHTENS, A SCROLL OPENS. A click is a point, so the camera closes on
     it; a scroll is the product showing more of itself, so the camera opens. That
     inversion is what separates an edit from a zoom effect.
  3. THE CUT LANDS BEFORE ITS CAUSE. A punch arrives on the beat BEFORE the click,
     so the edit reads as the reason the product moved rather than a reaction to it.
     A scroll cuts to the nearest beat, landing inside the movement.
  4. THE CAMERA MAY NEVER LOOK AWAY FROM THE ACTION. Enforced afterwards, not
     hoped for: any shot holding a crop while a real event happens outside its
     visible band is split at the beat before that event.
*/

type Moment = {
  frame: number;
  fx: number;
  fy: number;
  kind: "click" | "scroll";
};

/** The band of the source a framing can actually show, in fractions. */
export function visibleBand(framing: Framing): { lo: number; hi: number; loX: number; hiX: number } {
  const t = cameraTransform({ framing, tilt: { rx: 0, ry: 0 }, entering: 1, enter: "cut", shot: 0 });
  const span = (d: number) => ({ lo: (-0.5 - d) / t.scale + 0.5, hi: (0.5 - d) / t.scale + 0.5 });
  const y = span(t.dy);
  const x = span(t.dx);
  return { lo: y.lo, hi: y.hi, loX: x.lo, hiX: x.hi };
}

function momentsOf(session: CastSession, plan: CastPlan, fps: number, end: number, beat: number): Moment[] {
  const speed = castSpeed(session, fps);
  const ready = session.readyMs ?? 0;
  const at = (t: number) => plan.videoStart + Math.round((((t - ready) / 1000) * fps) / speed);
  const out: Moment[] = [];
  let last = { x: session.viewport.width / 2, y: session.viewport.height / 2 };

  for (const e of session.events) {
    if (e.kind === "move") last = { x: e.x, y: e.y };
    if (e.kind === "click") {
      if (e.role === "chrome") continue;
      out.push({ frame: at(e.t), fx: e.x / session.viewport.width, fy: e.y / session.viewport.height, kind: "click" });
      last = { x: e.x, y: e.y };
    }
    if (e.kind === "scroll" && e.role !== "chrome") {
      out.push({
        frame: at(e.t),
        fx: last.x / session.viewport.width,
        fy: 0.5,
        kind: "scroll",
      });
    }
  }
  return out
    .filter((m) => m.frame >= plan.videoStart && m.frame < end - beat)
    .sort((a, b) => a.frame - b.frame);
}

/*
  And a fifth rule, from 2026-09-04, TWO NEAR CLICKS ARE ONE MOVE. OpenScreen's pairing
  (motion.ts, `chainZooms`): when the next click falls inside the gap after a punch's
  natural hold, the camera PANS to it and stays in, instead of releasing to the wide shot
  and punching again — a zoom-out-and-back-in between two clicks two seconds apart is the
  single most recognisable tell of an automatic edit. Only the first attack is snapped to
  the grid; the pan keeps its own length and lands no later than the click it is for, so
  the next punch is entered already in and only settles.
*/

/*
  The push's tail past the click, the tutorial's: the click lands about two thirds of the
  way through the move, which says the press was expected. Before this the punch was one
  `slam` across its whole hold — up to two bars — so the arrival was normalised to the
  hold's length and a long hold was a slow creep with a hard cut at its head. The move is
  its own shot now, the spring over the time it actually takes, and the hold is another.
*/
const CAST_PUSH_TAIL_S = 0.5;
/* A hold that is not quite still — the tutorial's DRIFT, kept for the encoder's duplicate detector. */
const CAST_DRIFT = 1.012;
/* A pan delivers the camera this close to the next punch's depth; the settle after it is the rest. */
const PAN_SHORT = 0.97;

export function castShots(session: CastSession, brief: Brief, plan: CastPlan, motion: ShotMotion = CAST_MOTION, format?: Format): CastShot[] {
  const grid = gridOf(brief);
  const bar = grid.barFrames;
  const beat = grid.beatFrames;
  const fps = grid.fps;
  const end = plan.durationInFrames;
  const moments = momentsOf(session, plan, fps, end, beat);

  /*
    The ceiling: the recording's own pixels at the size this format draws them (`videoWhole`),
    which replaces the per-format fudge the recipe applied by hand. A 1x take on a horizontal
    cut caps at 1.17 and a phone take below 1, where the camera declines to zoom; a take at
    the device pixels holds twice that and is never reached by the punch. Without a format —
    the arithmetic tests, which pin a direction's push depths — nothing is capped.
  */
  const whole = format ? videoWhole(format, session.viewport, { isMobile: session.isMobile, ...(session.videoRatio ? { videoRatio: session.videoRatio } : {}) }) : Infinity;
  const capped = (scale: number) => Math.min(scale, whole);

  const shots: CastShot[] = [];
  const wide = (fx: number, fy: number, scale = 1.04): Framing => ({ fx, fy, scale: capped(scale) });
  /* Rule 3: a punch arrives before its cause; a scroll lands inside the movement. */
  const snapBefore = (frame: number) => Math.floor((frame - beat / 2) / bar) * bar;
  const snapNearest = (frame: number) => Math.round(frame / bar) * bar;
  const floorBeat = (frame: number) => Math.floor(frame / beat) * beat;
  const ceilBeat = (frame: number) => Math.ceil(frame / beat) * beat;
  const tail = Math.round(fps * CAST_PUSH_TAIL_S);
  const depthOf = (m: Moment) => {
    /*
      How hard depends on where it is. A focus near an edge can never travel to the centre
      — the clamp that keeps the recording covering the frame pins it — so pushing hard
      there buys no prominence and spends the frame on whatever surrounds the edge.
    */
    const edge = Math.max(Math.abs(m.fx - 0.5), Math.abs(m.fy - 0.5)) * 2;
    return capped(lerp(motion.push[1], motion.push[0], Math.min(1, Math.max(0, (edge - 0.45) / 0.45))));
  };
  /* Rule 5's pairing, with OpenScreen's numbers: the link after moment i is a pan when the two are near. */
  const links = chainZooms(moments, fps);
  const panAfter = (i: number): number => {
    const link = links[2 * i + 1];
    return link && link.kind === "pan" ? link.to - link.from : 0;
  };

  const first = moments[0];
  const openTo = first ? { fx: first.fx, fy: first.fy } : { fx: 0.5, fy: 0.42 };
  const openEnd = first ? Math.max(bar, snapBefore(first.frame)) : end;
  shots.push({
    from: 0,
    to: Math.min(openEnd, end),
    start: wide(0.5, 0.38, 1.0),
    end: wide(lerp(0.5, openTo.fx, 0.45), lerp(0.38, openTo.fy, 0.45), 1.08),
    /* A drift the viewer is not meant to see land, so not the spring: that would settle two thirds in on nothing. */
    ease: "inOut",
    enter: "cut",
    tilt: { rx: 0, ry: 0 },
    reason: "establish",
  });

  /* Where a pan left the camera, already in on the coming click; null when it released. */
  let pannedTo: number | null = null;
  moments.forEach((moment, i) => {
    const previous = shots[shots.length - 1];
    const chained = pannedTo !== null && moment.kind === "click";
    const attack = chained ? (pannedTo as number) : Math.max(previous.to, moment.kind === "click" ? snapBefore(moment.frame) : snapNearest(moment.frame));
    pannedTo = null;
    if (attack >= end - beat) return;
    if (attack > previous.to) previous.to = attack;

    /*
      A chain leaves the bar grid at its first pan — that is what a chain is for — and this
      is where it hands it back. `attack` is off-grid for a panned-in punch, so `attack + bar`
      was too and nothing snapped it: the hold ended on an arbitrary frame and the next
      moment's attack inherited it. Measured 2026-09-05 on a five-moment session, the whip
      into the closing scroll cut at 421, neither a bar nor a beat (421 % 15 = 1); over 600
      random sessions, 292 cuts landed off the bar and 12 off the beat, against 7 and 0 with
      this. The bar the frame falls in, or the next one when that one is already behind the
      punch's own arrival — waiting for the bar costs nothing measurable: the same sweep
      punches after the click 203 times out of 1760, where the unsnapped code did 222.
    */
    const backToGrid = (frame: number) => {
      const onBar = Math.floor(frame / bar) * bar;
      return onBar > attack + beat ? onBar : onBar + bar;
    };
    const reach = (frame: number) => (chained ? backToGrid(frame) : frame);
    const next = moments[i + 1];
    const until = next
      ? Math.min(Math.max(reach(attack + bar), snapBefore(next.frame)), end)
      : Math.max(reach(attack + bar), end - bar * 2);

    if (moment.kind === "click") {
      /* Rule 2a: a click is a point. Close on it, hold through the action. */
      const depth = depthOf(moment);
      /* A punch entered by a pan starts off the grid; every frame it hands on is back on it. */
      const hold = Math.min(reach(attack + bar * 2), until, end);
      const to = Math.max(reach(attack + beat * 2), hold);
      /* The move: to half a second past the click, or a beat's settle when the pan already delivered the camera. */
      const arriveWant = chained ? attack + beat : Math.max(attack + beat, moment.frame + tail);
      /*
        Rule 5. The pan starts on a beat and keeps the length OpenScreen gave it, landing
        no later than the next click; the punch keeps its whole arrival, tail included —
        the pan is why the hold need not stop at the grid the next punch would have cut on.
        A click so close that there is no room for both is the cast's crowd case, and it
        falls through to what it always did: the newcomer's punch waits for the grid.
      */
      const panLen = next && next.kind === "click" ? panAfter(i) : 0;
      const panStart = next && panLen > 0 ? floorBeat(Math.min(Math.max(to, arriveWant), next.frame - panLen)) : -1;
      const panned = next && panLen > 0 && panStart >= arriveWant;
      const arrive = panned ? arriveWant : Math.min(to, arriveWant);
      const framing = { fx: moment.fx, fy: moment.fy };
      shots.push({
        from: attack,
        to: arrive,
        start: { ...framing, scale: chained ? depth * PAN_SHORT : lerp(1, depth, 0.72) },
        end: { ...framing, scale: depth },
        ease: "spring",
        enter: chained ? "cut" : enterFor(motion, i),
        tilt: { rx: 0, ry: 0 },
        reason: chained ? `punch on click ${i + 1} (panned in)` : `punch on click ${i + 1}`,
      });
      const held = (until_: number): CastShot => ({
        from: arrive,
        to: until_,
        start: { ...framing, scale: depth },
        /* Past the cap by a per cent, as the tutorial's held shots go: under the eye, over the duplicate detector. */
        end: { ...framing, scale: depth * CAST_DRIFT },
        ease: "linear",
        enter: "cut",
        tilt: { rx: 0, ry: 0 },
        reason: `hold on click ${i + 1}`,
      });

      if (panned && next) {
        if (panStart > arrive) shots.push(held(panStart));
        shots.push({
          from: panStart,
          to: panStart + panLen,
          start: { ...framing, scale: panStart > arrive ? depth * CAST_DRIFT : depth },
          end: { fx: next.fx, fy: next.fy, scale: depthOf(next) * PAN_SHORT },
          ease: "spring",
          enter: "cut",
          tilt: { rx: 0, ry: 0 },
          reason: `pan to click ${i + 2}`,
        });
        pannedTo = panStart + panLen;
        return;
      }
      if (to > arrive) shots.push(held(to));
    } else {
      /* Rule 2b: a scroll is the product showing more of itself. Open. */
      shots.push({
        from: attack,
        to: Math.max(attack + beat * 2, Math.min(until, end)),
        start: wide(moment.fx, 0.5, 1.16),
        end: wide(0.5, 0.5, 1.0),
        ease: "spring",
        enter: softEnter(motion),
        tilt: { rx: 0, ry: 0 },
        reason: `open on scroll ${i + 1}`,
      });
    }

    const shot = shots[shots.length - 1];
    if (until > shot.to + beat) {
      const aim = next ?? { fx: 0.5, fy: 0.5 };
      shots.push({
        from: shot.to,
        to: until,
        start: wide(lerp(moment.fx, 0.5, 0.5), lerp(moment.fy, 0.5, 0.5), 1.12),
        end: wide(lerp(aim.fx, 0.5, 0.4), lerp(aim.fy, 0.5, 0.4), 1.02),
        ease: "spring",
        enter: softEnter(motion),
        tilt: { rx: 0, ry: 0 },
        reason: next ? `travel to moment ${i + 2}` : "release",
      });
    }
  });

  const last = shots[shots.length - 1];
  if (last.to < end) {
    shots.push({
      from: last.to,
      to: end,
      start: wide(0.5, 0.5, 1.06),
      end: wide(0.5, 0.5, 1.0),
      ease: "spring",
      enter: "cut",
      tilt: { rx: 0, ry: 0 },
      reason: "close",
    });
  }

  return enforceVisibility(shots, moments, beat, bar);
}

/**
 * Rule 4, applied rather than trusted: if a shot holds a crop while a real moment
 * happens outside what that crop shows, the shot is cut at the beat before, and
 * the remainder opens wide enough to contain what the viewer was promised.
 */
function enforceVisibility(shots: CastShot[], moments: Moment[], beat: number, bar: number): CastShot[] {
  const out: CastShot[] = [];
  const same = (a: Framing, b: Framing) => Math.abs(a.fx - b.fx) < 1e-9 && Math.abs(a.fy - b.fy) < 1e-9 && Math.abs(a.scale - b.scale) < 1e-9;
  /*
    What the shot before ended on when this pass received it, and what it ends on now. The
    punch has been two shots since 2026-09-04 — the push and the hold — and opening only the
    push put the hold straight back on the crop that could not see the click: a jump cut
    nobody declared, on the punch's own off-grid seam, onto the framing this rule forbids.
    A shot that continued the one before continues the opened one, with the move it had.
  */
  let previous: { was: Framing; now: Framing } | null = null;
  for (const original of shots) {
    let shot = original;
    if (previous && !same(previous.was, previous.now) && same(previous.was, original.start)) {
      const from = previous.now;
      shot = {
        ...original,
        start: from,
        end: {
          fx: from.fx + (original.end.fx - original.start.fx),
          fy: from.fy + (original.end.fy - original.start.fy),
          scale: from.scale * (original.end.scale / original.start.scale),
        },
        reason: `${original.reason} (opened: continues an opened shot)`,
      };
    }
    const band = visibleBand(shot.end);
    const blind = moments.find(
      (m) =>
        m.frame > shot.from + beat &&
        m.frame < shot.to &&
        (m.fy < band.lo || m.fy > band.hi || m.fx < band.loX || m.fx > band.hiX),
    );
    if (!blind) {
      out.push(shot);
      previous = { was: original.end, now: shot.end };
      continue;
    }
    const split = Math.max(shot.from + beat * 2, Math.floor((blind.frame - beat) / beat) * beat);
    if (split <= shot.from + beat || split >= shot.to - beat) {
      /* No room to split honestly: open this shot instead of lying in it. */
      const opened = { fx: 0.5, fy: 0.5, scale: 1.02 };
      out.push({ ...shot, end: opened, reason: `${shot.reason} (opened: action off-crop)` });
      previous = { was: original.end, now: opened };
      continue;
    }
    const opened = { fx: blind.fx, fy: blind.fy, scale: 1.02 };
    out.push({ ...shot, to: split });
    out.push({
      ...shot,
      from: split,
      to: shot.to,
      start: { fx: blind.fx, fy: blind.fy, scale: 1.1 },
      end: opened,
      ease: "spring",
      enter: "whip",
      reason: `open for off-crop action`,
    });
    previous = { was: original.end, now: opened };
  }
  void bar;
  return out;
}

export type CameraState = {
  framing: Framing;
  tilt: { rx: number; ry: number };
  /** 0..1 across the first beat of a shot, for the transition to ride. */
  entering: number;
  enter: ShotEnter;
  shot: number;
};

/** Where the camera is at a frame, and how far into its arrival. */
export function cameraAt(shots: CastShot[], frame: number, beatFrames: number): CameraState {
  let index = 0;
  for (let i = 0; i < shots.length; i++) if (frame >= shots[i].from) index = i;
  const shot = shots[index];
  const span = Math.max(1, shot.to - shot.from);
  const t = easings[shot.ease](Math.min(1, Math.max(0, (frame - shot.from) / span)));
  const half = Math.max(1, Math.round(beatFrames / 2));
  return {
    framing: {
      fx: lerp(shot.start.fx, shot.end.fx, t),
      fy: lerp(shot.start.fy, shot.end.fy, t),
      scale: lerp(shot.start.scale, shot.end.scale, t),
    },
    tilt: shot.tilt,
    entering: Math.min(1, Math.max(0, (frame - shot.from) / half)),
    enter: shot.enter,
    shot: index,
  };
}

/**
 * The camera as a CSS transform of the content box: scale about the centre, then
 * translate the focus toward it, clamped so the scaled recording still covers the
 * frame. Same contract as zoomTransform — fractions of the box.
 */
export function cameraTransform(state: CameraState): { scale: number; dx: number; dy: number } {
  const scale = state.framing.scale;
  if (scale <= 1) return { scale: 1, dx: 0, dy: 0 };
  const limit = (scale - 1) / 2;
  const pull = (f: number) => Math.max(-limit, Math.min(limit, -(f - 0.5) * scale));
  return { scale, dx: pull(state.framing.fx), dy: pull(state.framing.fy) };
}

/* ---------- Captions: the cards, and how fast they have to be read ---------- */

export type CaptionCard = {
  words: { text: string; start: number; end: number }[];
  /** Seconds: when the card appears, when its last word is spoken, when it leaves. */
  start: number;
  spoken: number;
  shownUntil: number;
  chars: number;
  /** Characters a second the reader has to keep up with, over the time it is up. */
  cps: number;
};

/*
  A caption is read a CARD at a time, and a card stays up until the next one arrives.

  Three things follow from that, and the first version of this got all three wrong.

  MEASURE THE CARD, NOT THE WORD. The only published limit — Netflix's 20 characters
  a second, 17 for material the viewer is decoding rather than skimming — is defined
  on the block of text on screen. Measuring single words reports every ordinary
  sentence as too fast: "installed" takes a quarter of a second to say, which is
  thirty-six characters a second and completely normal.

  MEASURE THE TIME IT IS UP. A card is readable for as long as it is on screen, which
  includes the breath after its last word — so the card holds until the next one
  starts instead of blinking out between phrases.

  NEVER STRADDLE TWO SENTENCES. A tutorial's word track is every step's narration
  concatenated, so a fixed group of three words eventually shows the tail of one step
  beside the head of the next. Two tells catch it: the gap between them, which is the
  same tell a natural pause gives, and the full stop, which is free and exact. Breaking
  on punctuation also buys reading time — a card that ends where the speaker pauses is
  on screen for that pause as well.
*/
export function captionCards(
  words: { text: string; start: number; end: number }[],
  opts: { maxChars?: number; maxSeconds?: number; gapBreak?: number; tail?: number } = {},
): CaptionCard[] {
  /*
    Two lines of roughly sixteen characters, which is what a 9:16 stage holds at
    caption size once the word gaps are counted. The PORTRAIT budget is the one every
    format uses: a card that fits 9:16 fits 16:9, and using each format's own budget
    would give the same tutorial different card boundaries in different aspect ratios
    — the same sentence breaking in two places, which is worse than a short card.
  */
  const maxChars = opts.maxChars ?? 32;
  const maxSeconds = opts.maxSeconds ?? 7;
  const gapBreak = opts.gapBreak ?? 0.5;
  const tail = opts.tail ?? 0.8;

  const groups: (typeof words)[] = [];
  let group: typeof words = [];
  for (let i = 0; i < words.length; i++) {
    group.push(words[i]);
    const next = words[i + 1];
    if (!next) break;
    const chars = group.reduce((n, w) => n + w.text.length, 0) + group.length - 1;
    const breaks =
      /[.!?:;]$/.test(words[i].text) ||
      next.start - words[i].end > gapBreak ||
      chars + 1 + next.text.length > maxChars ||
      next.end - group[0].start > maxSeconds;
    if (breaks) {
      groups.push(group);
      group = [];
    }
  }
  if (group.length > 0) groups.push(group);

  return groups.map((g, i) => {
    const start = g[0].start;
    const spoken = g[g.length - 1].end;
    const shownUntil = groups[i + 1] ? groups[i + 1][0].start : spoken + tail;
    const chars = g.reduce((n, w) => n + w.text.length, 0) + g.length - 1;
    return { words: g, start, spoken, shownUntil, chars, cps: shownUntil > start ? chars / (shownUntil - start) : Infinity };
  });
}

/**
 * Cards grouped back into the phrases a reader actually reads.
 *
 * The reading-speed limit asks one question — can the viewer keep up — and a card in
 * the middle of a sentence does not have to be read on its own. "What is the front
 * door to your" is thirty characters in 1.2 seconds, which is twenty-five characters
 * a second and looks like a failure; nobody reads it as a unit, because the next card
 * arrives with no pause and continues the sentence. What binds a continuous reader is
 * the SUSTAINED rate across the phrase, and that is the speaking rate.
 *
 * So cards are split for layout (a full stop, a line's worth of characters) and
 * measured by phrase — a run of cards with no real pause between them. A card
 * followed by silence is a phrase of one, and is measured on its own, which is the
 * case the per-card reading really does describe.
 */
export function captionPhrases(cards: CaptionCard[], gapBreak = 0.5): { chars: number; seconds: number; cps: number; text: string }[] {
  const out: { chars: number; seconds: number; cps: number; text: string }[] = [];
  let run: CaptionCard[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const chars = run.reduce((n, c) => n + c.chars, 0) + run.length - 1;
    const seconds = run[run.length - 1].shownUntil - run[0].start;
    out.push({
      chars,
      seconds,
      cps: seconds > 0 ? chars / seconds : Infinity,
      text: run.flatMap((c) => c.words.map((w) => w.text)).join(" "),
    });
    run = [];
  };
  for (const card of cards) {
    const previous = run[run.length - 1];
    if (previous && card.start - previous.spoken > gapBreak) flush();
    run.push(card);
  }
  flush();
  return out;
}

/*
  There used to be a `cardLead` here: how long a card waits before its first word
  lands, and the arithmetic that stopped a long claim from finishing after the card
  was gone. It existed because type cut in on the frame the PICTURE had finished
  moving — the product was behind every card, receded and dimmed.

  Nothing is behind a card any more, so there is nothing to wait for, and the wait
  rendered as what it now was: a black frame with nothing on it for half a beat at
  the top of every card in the piece. A card's line lands on the frame of the cut.
*/

/* ---------- Tutorial: the narration owns the clock ---------- */

/*
  A tutorial inverts what every other recipe here assumes.

  In KineticQuote the grid owns the clock and the words fit the bars. In ScreenCast
  the recording owns it and the camera quantises to the grid. In a tutorial the
  NARRATION owns it: a step lasts as long as it takes to say, because someone
  following instructions cannot be hurried by a bar line, and footage that runs
  ahead of the sentence explaining it teaches nothing.

  That inversion has one hard consequence and it is the whole design. Speech cannot
  be retimed — stretching a voice is audible immediately — so the FOOTAGE is retimed
  to meet it, per step, between the named marks the recording script left in the
  take. Which is only possible because the recording is a script and not a
  performance: `{ mark: "copy" }` is the anchor a sentence is pinned to, and
  re-recording the product after a redesign moves the anchor with it. Every tool in
  this field asks a human to talk and click at the same time, and then to do it again
  when either changes.

  Two rules keep the retiming honest:

  1. FOOTAGE NEVER PLAYS SLOWER THAN THE CONFORM RATE. Slowing a 25 fps take below
     `castSpeed` starts repeating source frames, which is exactly the judder that
     cost a day to find. When a sentence is longer than the footage it describes,
     the picture reaches the end of its segment and HOLDS while the camera keeps
     moving — the still frame is a decision, not a stutter.
  2. THE PICTURE IS NEVER CUT OFF MID-ACTION. When a sentence is shorter than the
     footage it describes, the step is extended until the footage fits at no more
     than `TUTORIAL_MAX_RUSH` times the conform rate. The viewer waits for the
     narrator; the narrator never waits for the edit.
*/

/*
  Words a minute, and why it is not the number the craft blogs give.

  Every vendor guide to screencasting says 130-150 wpm, "a calm explainer". The only
  primary measurement in the field says the opposite: Guo, Kim & Rubin (L@S 2014,
  6.9 million viewing sessions) found engagement rising with speaking rate up to
  roughly twice, with 145-165 sitting in a measured dip — and the 160 wpm convention
  everyone repeats traces back to a 1967 recommendation for LIVE lectures, where the
  listener cannot rewind. A tutorial viewer can. The ceiling is not comfort but
  captions: 20 characters a second is Netflix's fail line, which at about six
  characters a word is a little over 200 wpm.
*/
export const SPEAK_WPM = 170;
/** Breath at the end of a spoken line, before the next one starts. */
export const SPEAK_TAIL = 0.35;
/*
  The most a step may hurry its footage — over still water only.

  A short sentence over a long segment has to compress the picture or the tutorial
  stops being short. But the segments worth compressing are the ones where nothing
  happens: a page settling, a cursor travelling. Rushing a segment that CONTAINS the
  click is rushing the one thing the viewer came to copy, and someone following along
  cannot rewind an edit that already went past. So the cap applies to still water and
  every step with an action in it plays at exactly the conform rate.
*/
export const TUTORIAL_MAX_RUSH = 2.5;

/*
  The title card that opens a step, in beats.

  Guo, Kim & Rubin (L@S 2014, 6.9 million sessions) measured that tutorials are
  re-watched and scrubbed rather than played through, and their recommendation is
  literal: "visual signposts on tutorial videos, such as big blocks of text to signify
  transitions". A card at a step boundary is that signpost, and it is also the only way
  to obey the other rule this recipe follows — one thing on screen — while still saying
  what a step is: a chip laid over the product says the same thing with the product
  underneath it, which is two.

  Three beats is 1.5 s at 120 bpm. The floor is Netflix's 833 ms for a readable
  fragment; the ceiling is the slow lead-in Wistia measures as the commonest cause of
  early drop-off, and a signpost that outstays two seconds is one. Beats rather than
  seconds because every other cut in the piece is on the grid and this one is a cut.
*/
export const TUTORIAL_CARD_BEATS = 3;

/**
 * How long a line takes to say, before any voice exists.
 *
 * The estimate is what makes a plan work with no API key and no network:
 * the piece is laid out from text alone, and the real durations replace it once
 * `panoma-video assets` has run. The two differ, so the same tutorial is a few seconds
 * longer or shorter once it is voiced — that is expected, and it is why the plan
 * takes durations as an argument instead of measuring them itself.
 */
export function speakSeconds(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return words === 0 ? 0 : words / (SPEAK_WPM / 60) + SPEAK_TAIL;
}

/** A line with a mark is a step; a line without one is the closing card. */
export function tutorialParts(brief: Brief): { steps: Line[]; outro: Line[] } {
  const steps = brief.lines.filter((l) => l.mark);
  const outro = brief.lines.filter((l) => !l.mark);
  if (steps.length === 0) {
    throw new Error(
      `Tutorial "${brief.id}" has no steps. A step is a line with a \`mark\` naming a moment ` +
        `in session "${brief.session}"; a line without one is the closing card.`,
    );
  }
  return { steps, outro };
}

export type TutorialStep = {
  /** The brief line this step narrates. */
  id: string;
  mark: string;
  /** 1-based, for the step chip. */
  index: number;
  /** Composition frames. */
  from: number;
  to: number;
  /*
    Where the step's title card ends and the product comes back.

    Equal to `from` on the first step, which has none: the cold open is already a card,
    and two cards with no picture between them is the lead-in this recipe exists to
    avoid. The narration starts on the card and runs on over the picture — the sentence
    is not interrupted by the cut, which is what makes the cut feel like the piece
    moving rather than the piece stopping.
  */
  cardTo: number;
  /** Where the footage stops advancing and only the camera keeps moving. */
  holdFrom: number;
  /*
    The frame this step's own press lands on.

    The FIRST product click of the segment, which is the one `fx`/`fy` were taken from —
    deliberately not `settleFrom`, which is a beat past the segment's LAST action. On a step
    that clicks and then scrolls, those are three seconds apart, and everything aimed at the
    press was aiming at the scroll: the camera pushed after the thing had already happened,
    and the press effect fired eighty-nine frames late.

    Equal to `cardTo` on a step that never presses anything.
  */
  pressAt: number;
  /*
    Every product press in the segment, on the TIMELINE, with where it landed in the
    recording's own CSS pixels.

    The press effects used to run on the recording's clock — a ripple was `(ms - click.t) /
    450` — and a tutorial does not play the recording at its own speed: it runs at `playRate`
    and then freezes at `sourceTo` while the narrator finishes. So the 450 ms compressed to a
    handful of frames, or fell inside the frozen stretch and never advanced at all. The burst
    was moved to `pressAt` for that reason; the ripple and the cursor's own press were not,
    until this list existed. `pressAt` is the first of these, when there is one.
  */
  presses: { frame: number; x: number; y: number }[];
  /*
    The last frame on which the pixels under a viewport coordinate are still the pressed
    page's: the step's end, or the first scroll after the press. What a ring and a lifted
    plane both live by.
  */
  stableTo: number;

  /*
    Where what the press PRODUCED can be read, and the box it occupies in the recording's
    own CSS pixels.

    Absent whenever the take carried no macro for this mark, or nothing measurable changed,
    or what changed is too large to show at a legible size. Then the camera has nothing to
    move to and holds on the cause, which is the film this recipe made before there was a
    result move at all: a floor, not a failure.
  */
  result?: { from: number; box: CastBox };
  /*
    Where the step's last action has landed and the picture is meant to be still.

    A tutorial's whole payoff is the moment after the press: Apple's rule that text must
    stay on screen for a measured minimum applies to a changed interface too. Netflix's timed-text
    standard puts a subtitle's floor at 20 frames — five sixths of a second — and Brysbaert's
    meta-analysis of 190 studies puts adult silent reading at 238 words a minute. Guo's
    finding that tutorial pauses cluster at the state changes is viewers correcting an
    edit that cut too early. So the stillness is INTENDED, and this is where it starts —
    a beat after the last click, scroll or keystroke in the step's own segment, which is
    long enough for whatever that action animated to finish. Declared as a hold in the
    render plan, so the review knows a still picture here was decided rather than dropped.
  */
  settleFrom: number;
  /** Seconds into the take at `from`, and where the segment ends. */
  sourceFrom: number;
  sourceTo: number;
  /** Source seconds consumed per timeline second. Never below the conform rate. */
  playRate: number;
  /** What the step is about, in source fractions, and what kind of moment it is. */
  fx: number;
  fy: number;
  kind: "click" | "scroll" | "still";
  /** True when the product does something here — the segment that may not be hurried. */
  hasAction: boolean;
  /*
    The last frame a callout still points at the right pixel.

    A ring is anchored to a VIEWPORT coordinate, and the page underneath it scrolls.
    Left to run for the whole step, the ring stays where the button was and the button
    leaves — which is worse than no callout, because it points confidently at nothing.
  */
  calloutTo: number;
  /*
    And the first frame it points at the right pixel. On a step that scrolls to its control
    and then presses it, the control is not under the press point until the scroll is done;
    before that the ring would point at a page sliding past. `cardTo` on every other step.
  */
  calloutFrom: number;
};

export type TutorialPlan = {
  durationInFrames: number;
  /** Whole bars of cold open before the first step: the pain, asked as a question. */
  hookFrames: number;
  steps: TutorialStep[];
  outroFrom: number;
  /** The conform rate this take is played at, at its slowest. */
  rate: number;
};

/** Seconds a line occupies: measured from the voice if it exists, estimated if not. */
function saidFor(line: Line, lang: string, narration: Record<string, number>): number {
  const measured = narration[line.id];
  if (measured !== undefined && Number.isFinite(measured) && measured > 0) return measured;
  return speakSeconds(line.text[lang] ?? line.text[Object.keys(line.text)[0]] ?? "");
}

/**
 * The mark times a tutorial hangs on, checked rather than trusted.
 *
 * Both failures here are authoring mistakes that produce a plausible-looking video:
 * a sentence pinned to a moment that no longer exists, and a script whose steps
 * were reordered in the brief but not in the recording. Neither can be recovered
 * from — the plan would narrate one thing over another — so both stop the render.
 */
function markTimes(session: CastSession, brief: Brief, steps: Line[]): number[] {
  const marks = session.marks ?? [];
  if (marks.length === 0) {
    throw new Error(
      `Session "${brief.session}" carries no marks, so tutorial "${brief.id}" has nothing to pin its ` +
        `narration to. Add \`{ mark: "..." }\` steps to the script and re-record it: panoma-video record ${brief.session}`,
    );
  }
  const times: number[] = [];
  for (const line of steps) {
    const found = marks.find((m) => m.name === line.mark);
    if (!found) {
      throw new Error(
        `Line "${line.id}" narrates mark "${line.mark}", which session "${brief.session}" does not have. ` +
          `Marks in this take: ${marks.map((m) => m.name).join(", ")}.`,
      );
    }
    times.push(found.t);
  }
  for (let i = 1; i < times.length; i++) {
    if (times[i] <= times[i - 1]) {
      throw new Error(
        `Tutorial "${brief.id}" narrates "${steps[i - 1].mark}" before "${steps[i].mark}", but the recording ` +
          `does them the other way round. Steps follow the take's order, never the brief's.`,
      );
    }
  }
  return times;
}

/** Every event that counts as the product doing something a viewer must see. */
function isAction(e: CastEvent): boolean {
  return (e.kind === "click" || e.kind === "scroll" || e.kind === "key") && e.role !== "chrome";
}

/**
 * What a step is pointing at: the product's press after its mark if there is one, else
 * the first thing the product does, plus the moment that answer stops being true.
 */
function stepPoint(
  session: CastSession,
  fromMs: number,
  toMs: number,
): { fx: number; fy: number; kind: TutorialStep["kind"]; stableUntilMs: number; hasAction: boolean } {
  const w = session.viewport.width;
  const h = session.viewport.height;
  const inside = session.events.filter((e) => e.t >= fromMs && e.t < toMs);
  const hasAction = inside.some(isAction);
  /*
    The press, wherever it falls in the segment. The tour writes `mark → scrollTo → clickOn`
    for a control below the fold, so the first thing after the mark is the scroll that
    brings the control into view — and a step read as its first action was a "scroll" step
    with no push, no press framing, no lift and no result. Three of the panoma tutorial's
    five steps were lost that way. The scroll is the approach; the press is the step.
  */
  const press = inside.find((e): e is Extract<CastEvent, { kind: "click" }> => e.kind === "click" && e.role !== "chrome");

  let last = { x: w / 2, y: h / 2 };
  for (const e of session.events) {
    if (e.t >= toMs) break;
    if (e.kind === "move") {
      last = { x: e.x, y: e.y };
      continue;
    }
    if (e.t < fromMs) {
      if (e.kind === "click") last = { x: e.x, y: e.y };
      continue;
    }
    /* Chrome earns nothing here either: a consent banner is not a tutorial step. */
    if (e.kind === "click" && e.role !== "chrome") {
      /* A scroll after the click moves the page out from under any callout; one before it is the approach. */
      const moved = inside.find((o) => o.kind === "scroll" && o.t > e.t);
      return { fx: e.x / w, fy: e.y / h, kind: "click", stableUntilMs: moved?.t ?? toMs, hasAction };
    }
    if (e.kind === "scroll" && e.role !== "chrome" && !press) return { fx: last.x / w, fy: 0.5, kind: "scroll", stableUntilMs: toMs, hasAction };
  }
  return { fx: last.x / w, fy: last.y / h, kind: "still", stableUntilMs: toMs, hasAction };
}

/**
 * Product events that no step narrates.
 *
 * Every click, keystroke and scroll in the take happens inside some step's segment or
 * it happens unexplained — and unexplained action in a tutorial is the exact failure
 * the whole recipe exists to prevent. Reported rather than repaired: the fix is a
 * mark, or a `role: "chrome"`, and both are the author's call.
 */
export function tutorialOrphans(session: CastSession, plan: TutorialPlan): CastEvent[] {
  const first = plan.steps[0].sourceFrom * 1000;
  const last = plan.steps[plan.steps.length - 1].sourceTo * 1000;
  return session.events.filter((e) => isAction(e) && (e.t < first || e.t >= last));
}

export function tutorialPlan(
  session: TakeWithAssets,
  brief: Brief,
  hook: Line,
  lang: string,
  narration: Record<string, number> = {},
): TutorialPlan {
  const grid = gridOf(brief);
  const fps = grid.fps;
  const bar = grid.barFrames;
  const beat = grid.beatFrames;
  const rate = castSpeed(session, fps);
  const { steps: lines, outro } = tutorialParts(brief);
  const times = markTimes(session, brief, lines);
  const takeEnd = session.durationMs;

  const bars = (seconds: number) => Math.max(bar, Math.ceil(((seconds + beat / fps) * fps) / bar) * bar);
  /*
    The cold open is measured in BEATS, not bars.

    It used to round up to a whole bar, on the grounds that it is the only part of a
    tutorial that is pure rhythm — and what that bought was up to a bar of a title card
    with nothing happening on it, at the one place a piece cannot afford it. Wistia
    measures the slow lead-in as the commonest cause of early drop-off, from 13 million
    videos: "earn the first 10 seconds". A beat is still the grid, and it costs at most a
    beat of silence instead of at most a bar.
  */
  const beats = (seconds: number) => Math.max(beat * 2, Math.ceil(((seconds + beat / fps) * fps) / beat) * beat);
  const hookFrames = beats(saidFor(hook, lang, narration));

  const steps: TutorialStep[] = [];
  let at = hookFrames;
  lines.forEach((line, i) => {
    const fromMs = Math.max(times[i], session.readyMs ?? 0);
    const toMs = i + 1 < times.length ? times[i + 1] : takeEnd;
    const seconds = Math.max(0, (toMs - fromMs) / 1000);

    const point = stepPoint(session, fromMs, toMs);
    /* Still water may be hurried; a segment with the action in it may not. */
    const ceiling = point.hasAction ? rate : rate * TUTORIAL_MAX_RUSH;

    /*
      Every step but the first opens on its own title. See TUTORIAL_CARD_BEATS.

      The first has none because the cold open is already a card and two of them with no
      picture between is the lead-in this recipe avoids; a step with no label in this
      language has none because a signpost with nothing written on it is a pause.
    */
    const card = i === 0 || !line.label?.[lang] ? 0 : beat * TUTORIAL_CARD_BEATS;

    /* What the sentence needs, rounded up to a beat so cuts stay on the grid. */
    const spoken = saidFor(line, lang, narration) + beat / fps;
    const said = Math.max(beat * 2, Math.ceil((spoken * fps) / beat) * beat);
    /* What the footage needs at its most hurried, likewise — after the card has lifted. */
    const shown = card + Math.ceil((seconds * fps) / ceiling / beat) * beat;
    const span = Math.max(said, shown);
    const picture = span - card;

    /* Rule 1: at or above the conform rate, always. Rule 2 is `shown` widening the span. */
    const playRate = Math.min(ceiling, Math.max(rate, seconds / (picture / fps) || rate));
    const playFrames = Math.min(picture, Math.round((seconds * fps) / playRate));
    const cardTo = at + card;
    const frameOf = (ms: number) => cardTo + Math.round(((ms / 1000 - fromMs / 1000) / playRate) * fps);
    /* The last thing the product was made to do in this segment; after it, the still is the point. */
    const acted = session.events.filter((e) => isAction(e) && e.t >= fromMs && e.t < toMs).pop();
    const settleFrom = Math.min(at + span, acted ? frameOf(acted.t) + beat : cardTo);
    /*
      And, separately, the FIRST press. `settleFrom` answers "when is the picture allowed to
      stop"; this answers "when does the thing happen", and on a step that clicks and then
      scrolls they are seconds apart. Everything that aims at the press aims here.
    */
    /* Chrome earns nothing here either: a consent click is not the step's press. */
    const presses = session.events
      .filter((e): e is Extract<CastEvent, { kind: "click" }> => e.kind === "click" && e.role !== "chrome" && e.t >= fromMs && e.t < toMs)
      .map((e) => ({ frame: Math.min(at + span - 1, frameOf(e.t)), x: e.x, y: e.y }));
    const pressAt = presses.length > 0 ? presses[0].frame : cardTo;
    /*
      The last frame the pixels under a viewport coordinate are still the pressed page's.
      Past its own footage the picture HOLDS its last frame, so with no scroll after the
      press that frame is the step's end — not `frameOf(toMs)`, which is where the hold
      begins. Measured on the repo's own fixture: 500 against a step ending at 510, on
      every step whose sentence outlasts its footage, which is most of them; and the lift
      reads `stableTo >= to` as "the page stayed put", so it refused the after-state on
      exactly those steps. A scroll BEFORE the press is the approach and moves nothing.
    */
    const stableAt = point.stableUntilMs >= toMs ? at + span : Math.min(at + span, frameOf(point.stableUntilMs));
    /*
      The first frame the ring's coordinate is true. A step that scrolls to its control
      before pressing it has the control arriving under the press point during the scroll,
      and a ring drawn from the step's start would point at the page sliding past. A scroll
      event is its start and its end is not logged, but the pointer's glide to the control
      begins the moment the scroll is done and the glide logs its departure: the first
      `move` after the last scroll before the press. Without one, the press itself.
    */
    const firstPress = session.events.find((e): e is Extract<CastEvent, { kind: "click" }> => e.kind === "click" && e.role !== "chrome" && e.t >= fromMs && e.t < toMs);
    const approach = firstPress ? session.events.filter((e) => e.kind === "scroll" && e.t >= fromMs && e.t < firstPress.t).pop() : undefined;
    const departs = approach && firstPress ? session.events.find((e) => e.kind === "move" && e.t > approach.t && e.t <= firstPress.t) : undefined;
    const calloutFrom = approach && firstPress ? Math.min(at + span, frameOf(departs?.t ?? firstPress.t)) : cardTo;

    /*
      What the press produced, when the take measured it. `focus` is where the heading the
      action created ended up — the capture calls it "the place a camera lands to show cause
      and effect in one frame" — and `change.box` is the bounding box of the pixels that
      differed afterwards. Neither is always present, and the camera works without them.
    */
    const macro = (session.macros ?? []).find((m) => m.mark === line.mark);
    const focus = macro?.focus;
    /*
      Screen-reader headings can have a real box only one or two CSS pixels wide.
      They name the result but are not a visible target. Require four visible CSS
      pixels on both axes: a clipping-artifact guard, not a font-size preference.
      The changed pixels remain the evidence when the named heading cannot be seen.
    */
    const focusVisible = focus &&
      Math.min(session.viewport.width, focus.x + focus.width) - Math.max(0, focus.x) >= 4 &&
      Math.min(session.viewport.height, focus.y + focus.height) - Math.max(0, focus.y) >= 4;
    const changed = focusVisible ? focus : macro?.change?.box;

    steps.push({
      id: line.id,
      mark: line.mark!,
      index: i + 1,
      from: at,
      to: at + span,
      cardTo,
      holdFrom: cardTo + playFrames,
      pressAt,
      presses,
      stableTo: stableAt,
      ...(changed ? { result: { from: Math.min(at + span - 1, pressAt + Math.round(fps * 1.5)), box: changed } } : {}),

      settleFrom,
      sourceFrom: fromMs / 1000,
      sourceTo: toMs / 1000,
      playRate,
      /*
        The ring lives while it still points at the right pixel, and that is not the same
        as while the footage is playing. It used to be capped at `holdFrom` as well, so on
        a step whose sentence is longer than its footage — which is most of them, and all
        the short ones — the ring came up a tick after the card lifted and was gone before
        anyone read it, on exactly the steps that are about pressing something.
      */
      /*
        And a beat after the press it is done, whatever the page did. The ring is drawn at
        the coordinate the control HAD; a press that navigated leaves it pointing at whatever
        the next page put there — the first render of this ringed a project's commit count
        for five seconds because a tile had been where the count now was — and a press that
        did not navigate has the camera moving to the result, which is the pointing from then
        on. The press is the moment the ring's job ends.
      */
      calloutTo: Math.min(at + span, stableAt, ...(point.kind === "click" ? [pressAt + beat] : [])),
      calloutFrom,

      fx: point.fx,
      fy: point.fy,
      kind: point.kind,
      hasAction: point.hasAction,
    });
    at += span;
  });

  const outroFrom = at;
  const outroFrames = bars(outro.reduce((n, l) => n + saidFor(l, lang, narration), 0));
  const durationInFrames = Math.ceil((outroFrom + outroFrames) / bar) * bar;

  return { durationInFrames, hookFrames, steps, outroFrom, rate };
}

/**
 * Steps whose picture stops for most of their length.
 *
 * A hold is a legitimate move — the screen sits still while the narrator explains,
 * and the camera keeps pushing so the frame is never dead — but a step that holds
 * for two thirds of its span is not a decision, it is a script that did not shoot
 * enough footage for the sentence it wrote. There are only two honest fixes and
 * both belong to a person: record more for that mark, or say less. So this reports
 * rather than repairs, and the report names the mark, because the mark is the thing
 * the author has to go and change.
 */
export function tutorialStalls(
  plan: TutorialPlan,
  ratio = 0.55,
): { mark: string; heldFrames: number; spanFrames: number; share: number }[] {
  return plan.steps
    .map((s) => ({
      mark: s.mark,
      heldFrames: s.to - s.holdFrom,
      spanFrames: s.to - s.from,
      share: (s.to - s.holdFrom) / Math.max(1, s.to - s.from),
    }))
    .filter((s) => s.share > ratio);
}

/**
 * Which second of the take a frame shows.
 *
 * Piecewise and continuous: each step ends on the second the next one begins, so
 * the picture never jumps backwards and never skips material the narration has
 * already promised. Before the first step it holds the opening frame — the product
 * is already on screen behind the cold open — and after the last one it holds the
 * final one under the closing card.
 */
export function tutorialSourceAt(plan: TutorialPlan, session: CastSession, frame: number, fps: number): number {
  const end = Math.max(0, session.durationMs / 1000 - 1 / fps);
  const clamp = (t: number) => Math.min(Math.max(0, t), end);
  const first = plan.steps[0];
  const last = plan.steps[plan.steps.length - 1];
  if (frame < first.from) return clamp(first.sourceFrom);
  for (const step of plan.steps) {
    if (frame >= step.to) continue;
    /* Under a title card the picture waits where the step begins: the card is the cut. */
    if (frame < step.cardTo) return clamp(step.sourceFrom);
    if (frame >= step.holdFrom) return clamp(step.sourceTo);
    return clamp(Math.min(step.sourceFrom + ((frame - step.cardTo) / fps) * step.playRate, step.sourceTo));
  }
  return clamp(last.sourceTo);
}

/** The step a frame belongs to, or null during the cold open and the closing card. */
export function tutorialStepAt(plan: TutorialPlan, frame: number): TutorialStep | null {
  return plan.steps.find((s) => frame >= s.from && frame < s.to) ?? null;
}

/*
  How much of the callout is on screen at a frame: up over a beat after `from`, down over
  a beat before `to`, and the two ramps share the span when it is shorter than two beats.

  This used to be an `interpolate` over four keys in the recipe, guarded by "the span is
  longer than two ticks". The guard was not the condition the keys needed — they need the
  span to be longer than two BEATS — and the day the ring learnt to end a beat after the
  press, a press that landed a few frames after the card handed `interpolate` keys that did
  not increase, and the render stopped with "inputRange must strictly increase". A ramp
  that cannot throw is arithmetic, and arithmetic lives here where a test can reach it.
*/
export function calloutRamp(frame: number, from: number, to: number, beatFrames: number): number {
  if (!(to > from + 1)) return 0;
  if (frame <= from || frame >= to) return 0;
  const rise = Math.max(1, Math.min(beatFrames, (to - from) / 2));
  if (frame < from + rise) return (frame - from) / rise;
  if (frame > to - rise) return (to - frame) / rise;
  return 1;
}

/**
 * The camera, one shot per step.
 *
 * The cast's grammar punches on every click because footage of a product doing
 * things is entertainment. A tutorial is instruction: the frame has to stay
 * readable while someone follows it, so the pushes are gentler and there is exactly
 * one per step. What keeps a held frame alive is that the push runs for the WHOLE
 * step — including the seconds after the footage has stopped, which is the only
 * moving thing on screen while the narrator finishes a sentence.
 */
/*
  The scale at which the recording is drawn at exactly its own pixels.

  This is the number the tutorial camera was missing, and it explains a softness nobody had
  named. Until 2026-09-04 every take was recorded at `size: viewport` — a WebM at 1x the CSS
  viewport, while the take's `deviceScaleFactor: 2` reached only the stills and the macro
  clips. So the video was a 1x asset, `castFrame` draws it into a content box smaller than
  the canvas, and past this ratio every further step of camera is an upscale.

  Measured, per format and take, rather than guessed: on a horizontal desktop cut a 1x take
  is 1.171, so the old ceiling of 1.36 was drawing the recording 16% past its own pixels on
  every close-up. On a vertical desktop cut it is 1.891 — the format that needs the most
  magnification was the one being left short of free sharpness. And on a vertical MOBILE cut
  it is 0.731: that take arrives already upscaled by a third, and the honest camera move
  there is none at all, which is what the old per-format `push` fudge was clumsily reaching
  for.

  The capture now records at the device pixels — through a REAL scale factor at launch; the
  emulated one alone hands the recorder a 1x picture padded onto gray, which is what the
  first attempt shipped for an hour — and writes what it got as `videoRatio`, which doubles
  every number above: 2.34 horizontal, 3.78 vertical, 1.46 on a phone. That one measurement
  is most of the difference between a zoom that reads as an effect and one that reads as a
  camera — the old ceiling was not a taste, it was the file. The ratio is READ from the
  take, never assumed, so a take shot before the change is still capped at what it holds.
*/
export function videoWhole(
  format: Format,
  source: { width: number; height: number },
  opts: { isMobile?: boolean; videoRatio?: number } = {},
): number {
  const ratio = opts.videoRatio && opts.videoRatio > 0 ? opts.videoRatio : 1;
  return (source.width * ratio) / castFrame(format, source, opts).content.width;
}

/**
 * The largest scale, at or above 1, that keeps `box` entirely in frame — and the reason a
 * control at the edge is framed wider instead of cropped.
 *
 * `cameraTransform` clamps its pull to ±(scale − 1) / 2, and that clamp is what guarantees
 * the scaled recording still covers the canvas. Working it through: bringing a point `d`
 * from the centre all the way to the middle needs `s >= 1 / (1 - 2d)` — 1.67 at four tenths
 * out, 2.0 at the corner — which no readable depth reaches. Below that the pull saturates
 * and the frame slides toward the edge. A point can only be pushed toward the edge and never
 * off it; a BOX can be cropped, and that is the thing this refuses.
 *
 * So the scale is not solved analytically: it is proposed, then verified against the clamp
 * it will actually be drawn with, and walked down until it holds. Bounded, deterministic,
 * total — and the floor of 1 is always reachable, because at 1 the pull is zero and the box
 * maps to itself.
 */
export function fitScaleToBox(
  box: CastBox,
  viewport: { width: number; height: number },
  want: number,
  margin = 0.06,
): number {
  const fx0 = box.x / viewport.width;
  const fx1 = (box.x + box.width) / viewport.width;
  const fy0 = box.y / viewport.height;
  const fy1 = (box.y + box.height) / viewport.height;
  const cx = (fx0 + fx1) / 2;
  const cy = (fy0 + fy1) / 2;
  const holds = (s: number): boolean => {
    const { scale, dx, dy } = cameraTransform({ framing: { fx: cx, fy: cy, scale: s }, tilt: { rx: 0, ry: 0 }, entering: 1, enter: "cut", shot: 0 });
    const at = (f: number, d: number) => 0.5 + (f - 0.5) * scale + d;
    return (
      at(fx0, dx) >= margin && at(fx1, dx) <= 1 - margin && at(fy0, dy) >= margin && at(fy1, dy) <= 1 - margin
    );
  };
  let s = Math.max(1, want);
  for (let i = 0; i < 40 && s > 1; i++) {
    if (holds(s)) return s;
    s = Math.max(1, s * 0.98);
  }
  return holds(s) ? s : 1;
}

export function tutorialShots(session: TakeWithAssets, brief: Brief, plan: TutorialPlan, format: Format = FORMATS.h): CastShot[] {
  const grid = gridOf(brief);
  const fps = grid.fps;
  const shots: CastShot[] = [];
  const wide = (fx: number, fy: number, scale: number): Framing => ({ fx, fy, scale });

  /*
    How long the camera takes to arrive, and why it then stops.

    Nielsen Norman measured the band a viewer reads as deliberate rather than sluggish —
    100 to 400 ms, with 500 ms "a real drag" — and Material publishes the same shape from
    the other side (>400 ms "may feel too slow", ease-out so "the eye has time to focus on
    the element as it comes to rest"). A camera covers more ground than a component, so this
    sits at the top of that band and not above it. The 0.42 is a choice inside a measured
    band, which is a different thing from a number somebody liked.
  */
  const ARRIVE = Math.round(fps * 0.42);
  /*
    How the push straddles the press.

    The only published implementation with checkable numbers begins its lead-in about a
    second before the moment and finishes half a second after it, so the click lands roughly
    two thirds of the way through the move. That shape is the whole point: a camera that
    arrives WITH the press says the press was expected, and a camera that starts moving after
    it says the film was surprised.
  */
  const PUSH_LEAD = Math.round(fps * 1.0);
  const PUSH_TAIL = Math.round(fps * 0.5);
  /* And the release to the result, at two thirds the push's speed. Slower out than in. */
  const RELEASE = Math.round((PUSH_LEAD + PUSH_TAIL) * (2 / 3));
  /*
    A hold that is not quite still.

    This one is not craft and it is worth saying so: every source on reading asks for the
    opposite, and this exists because the encoder's duplicate detector reads a perfectly
    static frame over static footage as a stalled pipe. A tenth of a per cent per second is
    below what anyone can see and above what the gate calls a duplicate.
  */
  const DRIFT = 1.012;
  /*
    Ceilings. A press may go closer than the recording's own pixels because the LIFTED macro
    is what carries the detail there — the product's own control at up to eight times the
    density, drawn on its own plane. Nothing else is allowed past `whole`.
  */
  const LIFT_ROOM = 1.35;
  /*
    Taste ceilings, above the measured one. They were 1.3 and 1.85 when the recording was a
    1x asset and neither could be reached; with a take at the device pixels `whole` is 2.34
    on a horizontal cut, and a press that may go a third past it is a control at a size the
    viewer would have to lean in for on their own screen. 2.6 is where a 26 px icon target
    is drawn about five per cent of the frame's height tall, which is a thing to look at and
    not yet a mockup on a slide.
  */
  const FRAMED_MOST = 1.9;
  const PRESSED_MOST = 2.6;
  /*
    After the result has been read, the camera opens back out — a fifth wider than where it
    rested, never past the step's own framing — and holds there. Two seconds is the reading:
    Netflix floors a subtitle at 20 frames and Brysbaert's meta-analysis puts silent reading
    at 238 wpm, so a short heading is read in one; the second is Guo's — pauses cluster at
    the state changes, and a camera that leaves before the pause is a viewer's rewind. The
    return itself is the rule every screen-recording guide states the same way: the pan
    comes back to a wide view once the detail moment has passed, to keep the viewer's map of
    the interface. A step too short for a beat of the wide framing keeps the close one: the
    first real take held a result for 3.8 s and missed the return by two frames under a
    one-second floor, and a beat is what the grid already calls the least a thing may last.
  */
  const REST = Math.round(fps * 2.0);
  const OPEN = Math.round(fps * 0.9);
  const OPEN_BY = 1.2;
  const WIDE_LEAST = grid.beatFrames;

  /* The least useful close framing of a control; a broad result may need the whole page. */
  const LEGIBLE_LEAST = 1.12;
  /* A press has to be visibly closer than the framing, or the two shots are one still frame. */
  const PUSH_LEAST = 1.18;

  const view = session.viewport;
  const whole = videoWhole(format, view, { isMobile: session.isMobile, ...(session.videoRatio ? { videoRatio: session.videoRatio } : {}) });
  const macros = session.macros ?? [];

  shots.push({
    from: 0,
    to: plan.hookFrames,
    start: wide(0.5, 0.42, 1.0),
    end: wide(0.5, 0.42, Math.min(1.03, whole)),
    ease: "inOut",
    enter: "cut",
    tilt: { rx: 0, ry: 0 },
    reason: "cold open",
  });

  for (const step of plan.steps) {
    const macro = macros.find((m) => m.mark === step.mark);
    /*
      What the camera is looking at, in the recording's own CSS pixels.

      A real control when the take measured one; otherwise a box invented around the point
      the step is about, in VIEWPORT pixels and never canvas pixels — mixing those two units
      is a bug that never fails a test because it stays inside the layout's own numbers, and
      then frames a different amount of page on a 1080 canvas than on a 1920 one.
    */
    const control =
      macro?.target ??
      macro?.box ??
      (() => {
        /*
          No macro, so the size of the thing is unknown and this is a guess — kept small on
          purpose. The first version guessed half the short side and then padded it by ninety
          per cent, which produced a box taller than the viewport: nothing containing it fits
          at any scale, `fitScaleToBox` floored at one, and the camera silently stopped
          zooming at all on exactly the takes that are the common case.
        */
        const side = Math.min(view.width, view.height) * 0.28;
        return padBox({ x: step.fx * view.width - side / 2, y: step.fy * view.height - side / 2, width: side, height: side }, 0, view);
      })();

    /*
      A framing box, padded for room and then capped.

      The padding is a share of the CONTROL, which is right for a button and wrong once it
      makes a window most of the page: past that the camera is not framing anything, and the
      containment solver — which needs a margin on all four sides — cannot satisfy it at any
      scale and falls back to not moving. So the padded box is capped at a share of the
      viewport, about the frame it would occupy, which keeps every framing solvable.
    */
    const room = (share: number): CastBox => {
      const b = padBox(control, share, view);
      const w = Math.min(b.width, view.width * 0.58);
      const h = Math.min(b.height, view.height * 0.58);
      const cx = Math.min(Math.max(w / 2, b.x + b.width / 2), view.width - w / 2);
      const cy = Math.min(Math.max(h / 2, b.y + b.height / 2), view.height - h / 2);
      return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
    };

    const fx = step.kind === "click" ? step.fx : 0.5;
    const fy = step.kind === "click" ? step.fy : step.kind === "scroll" ? 0.5 : 0.42;
    /*
      Three depths, each solved from a box rather than picked from a ramp. The old ramp
      interpolated between 1.36 and 1.12 by how near the edge a control was, which was the
      right instinct — an edge control must be framed wider — with no number behind it.
      `fitScaleToBox` computes the bound instead, against the very clamp the frame is drawn
      with, so "wider" is exactly as wide as it has to be.
    */
    const still = step.kind !== "click";
    /*
      The framing holds the pointer's whole approach, not only its destination.

      A step's pointer sets off from wherever the last one left it, and a framing solved on
      the control alone can start with the pointer outside the frame — so the viewer sees a
      cursor ARRIVE from nowhere, which is the one thing every guide on this says a camera
      may not do: it follows the pointer and never anticipates it. So the box the framing is
      solved on is the control's room widened to the pointer's starting point, when that is
      near enough to be one framing. Past three quarters of the viewport it is not, and the
      pointer enters from the edge, which is what a real camera would show too.
    */
    const withApproach = (box: CastBox): CastBox => {
      /*
        The logged path, not the drawn one: the recipe draws Cap's spring over the same log,
        and at a segment's start both sit on the same logged point, at rest.

        On a step that scrolls to its control before pressing it this is still the right
        point: a pointer is viewport-fixed, so it sits here through the scroll while the
        page moves under it, and sets off from here once the scroll is done. The control's
        box is measured on the scrolled page, in the same viewport coordinates.
      */
      const start = cursorAt(session, step.sourceFrom * 1000);
      const reach = Math.min(view.width, view.height) * 0.04;
      /*
        Kept inside the band the containment solver can satisfy. A pointer resting a few
        pixels from the viewport's edge would drag the union box onto that edge, and a box on
        the edge fits at no scale above one — the framing collapsed to the whole page for a
        pointer nobody was looking at.
      */
      const band = 0.08;
      const sx = Math.min(Math.max(start.x, view.width * band + reach), view.width * (1 - band) - reach);
      const sy = Math.min(Math.max(start.y, view.height * band + reach), view.height * (1 - band) - reach);
      const both = unionBox(box, { x: sx - reach, y: sy - reach, width: reach * 2, height: reach * 2 });
      const fits = both.width <= view.width * 0.75 && both.height <= view.height * 0.75;
      return fits ? padBox(both, 0, view) : box;
    };
    /* The centre of a box, as the fractions the camera looks at. */
    const centreOf = (b: CastBox) => ({ fx: (b.x + b.width / 2) / view.width, fy: (b.y + b.height / 2) / view.height });

    /*
      The resting framing leaves room for its own arrival.

      An approach settles OUT — it starts six per cent closer and eases back, which is the
      shape Material asks for so the eye has time to focus as the frame comes to rest. That
      overshoot has to come out of the sharpness budget rather than sit on top of it: capped
      at `whole` instead, a step whose framing already reached the ceiling had an approach
      that started and ended on the same number, which is not an arrival at all.
    */
    const framedWant = still ? Math.min(whole, step.kind === "scroll" ? 1.06 : 1.02) : Math.min(whole / 1.06, FRAMED_MOST);
    /*
      The framing LOOKS AT the box it was solved on. `fitScaleToBox` proves containment for a
      camera centred on the box; a framing drawn at the click point instead was a proof about
      a different picture, and on a step whose pointer sets off from across the page the
      widened box's far end was still outside the frame. So the resting focus is the box's
      centre, and the push pans from there to the point that is pressed.
    */
    const framedBox = still ? null : withApproach(room(0.9));
    let framed = still || !framedBox ? framedWant : fitScaleToBox(framedBox, view, framedWant);
    /* A framing the widening pushed below legibility keeps the control's own room instead. */
    if (framedBox && framed < LEGIBLE_LEAST) {
      const own = fitScaleToBox(room(0.9), view, framedWant);
      if (own > framed) framed = own;
    }
    const look = framedBox && framed >= LEGIBLE_LEAST ? centreOf(framedBox) : { fx, fy };

    let pressed = still ? framed : fitScaleToBox(room(0.25), view, Math.min(whole * LIFT_ROOM, PRESSED_MOST));
    /*
      And the press may not go past the density the lifted plane can hold. `liftAt` refuses to
      draw a plane past its own captured ratio, which is right for one frame and wrong for a
      shot: for a shot the answer is to stop closer in.
    */
    if (macro) {
      const drawn = castFrame(format, view, { isMobile: session.isMobile }).content.width / view.width;
      pressed = Math.min(pressed, (macro.box.width * macro.pixelRatio) / (drawn * macro.box.width));
    }
    /* Lower the framing rather than raise the press: raising it would breach the cap above. */
    if (pressed / framed < PUSH_LEAST) framed = Math.max(1, pressed / PUSH_LEAST);

    /*
      Where the camera lands after the press: on the result the take measured. A large
      state change needs a broad view, even at scale one; staying close to the old control
      after a navigation points at a place that no longer means the same thing. The file's
      own density remains the ceiling when it is below one.
    */
    let result: { scale: number; fx: number; fy: number } | null = null;
    if (step.result && step.kind === "click") {
      const box = withAspect(padBox(step.result.box, 0.06, view), view.width / view.height, view);
      const want = Math.min(whole, PRESSED_MOST, view.width / box.width, view.height / box.height);
      const scale = Math.min(whole, fitScaleToBox(box, view, want));
      result = { scale, ...(scale <= 1 ? { fx: 0.5, fy: 0.5 } : centreOf(box)) };
    }

    /*
      The boundaries, built as a non-decreasing sequence so a short step collapses instead of
      inverting. `waiting` disappears first, then `settling`, then `approaching` merges into
      the push; the hold always survives, because every boundary is clamped below `step.to`.
    */
    const b1 = step.cardTo;
    // A signpost hides the approach; its cut delivers the camera already in position.
    const titled = step.cardTo > step.from;
    const b2 = titled ? b1 : Math.min(step.to - 1, b1 + ARRIVE);
    const b4 = Math.max(b2, Math.min(step.to - 1, step.pressAt + PUSH_TAIL));
    const b3 = Math.max(b2, Math.min(b4, b4 - (PUSH_LEAD + PUSH_TAIL)));
    const b5 = result ? Math.max(b4, Math.min(step.to - 1, b4 + RELEASE)) : b4;

    const at = (scale: number, f = { fx, fy }) => wide(f.fx, f.fy, scale);
    /*
      A hold drifts, and it drifts DOWN when there is no room above.

      The drift exists for the encoder, not for the eye — a perfectly static frame over
      static footage is what the duplicate detector reads as a stalled pipe. So its
      direction is free, and at the ceiling the only direction left is back. Drifting up
      regardless is how a phone take, whose ceiling is below one because it arrives already
      magnified, ended up zoomed by a camera that had just been told not to.
    */
    const drift = (scale: number) => (scale * DRIFT <= whole ? scale * DRIFT : scale / DRIFT);
    const rest = result ? { fx: result.fx, fy: result.fy } : { fx, fy };
    const restScale = result ? result.scale : pressed;
    // A whole-page result has no room to drift inward without cropping it again.
    const restedScale = result && restScale <= 1 ? restScale : drift(restScale);
    const add = (from: number, to: number, a: Framing, b: Framing, ease: CastShot["ease"], reason: string) => {
      if (to > from) shots.push({ from, to, start: a, end: b, ease, enter: "cut", tilt: { rx: 0, ry: 0 }, reason });
    };

    const approachFrom = titled ? Math.max(step.from, b1 - ARRIVE) : b1;
    const approachTo = titled ? b1 : b2;
    const approach = at(Math.min(whole, framed * 1.06), look);
    add(step.from, approachFrom, approach, approach, "linear", `step ${step.index}: ${step.mark} — under its title`);
    add(approachFrom, approachTo, approach, at(framed, look), "spring", `step ${step.index}: ${step.mark} — approaching`);

    /*
      A step that presses something gets the push; a scroll or a still does not, because
      there is nothing to press and a "push" between two equal framings is a shot that runs
      backwards by exactly the drift.
    */
    if (still) {
      add(b2, step.to, at(framed), at(drift(framed)), "linear", `step ${step.index}: ${step.mark} — held`);
    } else {
      // A collapsed wait has no drift to inherit. Starting at its imaginary end jumped
      // the camera on the very frame the push began, most often on an early click.
      const waitingEnd = b3 > b2 ? drift(framed) : framed;
      add(b2, b3, at(framed, look), at(waitingEnd, look), "linear", `step ${step.index}: ${step.mark} — waiting on the control`);
      add(b3, b4, at(waitingEnd, look), at(pressed), "spring", `step ${step.index}: ${step.mark} — pressing`);
      if (result) add(b4, b5, at(pressed), at(restScale, rest), "spring", `step ${step.index}: ${step.mark} — settling on what it did`);
      /*
        The rest, and then the return. `open` is a fifth wider than the rest and never
        closer than the framing; the camera comes back out to it once the result has had its
        two seconds, and only when a beat of the wide view still fits in the step.
      */
      const open = Math.max(1, Math.min(framed, restScale / OPEN_BY));
      const b6 = b5 + REST;
      const b7 = b6 + OPEN;
      if (restScale / open >= 1.1 && b7 + WIDE_LEAST <= step.to) {
        add(b5, b6, at(restScale, rest), at(restedScale, rest), "linear", `step ${step.index}: ${step.mark} — ${result ? "held on what it did" : "held on the press"}`);
        add(b6, b7, at(restedScale, rest), at(open, rest), "spring", `step ${step.index}: ${step.mark} — opening out`);
        add(b7, step.to, at(open, rest), at(drift(open), rest), "linear", `step ${step.index}: ${step.mark} — held`);
      } else {
        add(b5, step.to, at(restScale, rest), at(restedScale, rest), "linear", `step ${step.index}: ${step.mark} — held`);
      }
    }

  }

  shots.push({
    from: plan.outroFrom,
    to: plan.durationInFrames,
    start: wide(0.5, 0.5, Math.min(1.02, whole)),
    end: wide(0.5, 0.5, 1.0),
    ease: "out",
    enter: "cut",
    tilt: { rx: 0, ry: 0 },
    reason: "close",
  });

  return shots;
}

/**
 * Chapters, for the description box.
 *
 * Emitted for every tutorial and honest about who will show them: YouTube requires
 * a chapter at 0:00, at least three of them, and ten seconds each, so a 30-second
 * vertical cut has timestamps that are useful to a human reader and invisible to
 * the player. The kit says which of the two it is rather than implying the first.
 */
export function tutorialChapters(
  plan: TutorialPlan,
  brief: Brief,
  hook: Line,
  lang: string,
): { seconds: number; label: string; accepted: boolean }[] {
  const fps = gridOf(brief).fps;
  const text = (line: Line) => line.label?.[lang] ?? line.text[lang] ?? line.text[Object.keys(line.text)[0]] ?? "";
  const { outro } = tutorialParts(brief);
  const rows = [
    { seconds: 0, label: text(hook) },
    ...plan.steps.map((s) => ({
      seconds: s.from / fps,
      label: text(brief.lines.find((l) => l.id === s.id)!),
    })),
    ...(outro.length > 0 ? [{ seconds: plan.outroFrom / fps, label: text(outro[0]) }] : []),
  ];
  const long = rows.every((row, i) => (i + 1 < rows.length ? rows[i + 1].seconds - row.seconds >= 10 : true));
  const accepted = rows.length >= 3 && long && plan.durationInFrames / fps >= 30;
  return rows.map((row) => ({ ...row, accepted }));
}

/* ---------- Storyboard: a cut list, some of it commissioned ---------- */

/*
  The board's clock.

  Every other plan in this file derives durations from something — the grid, the take, the
  narration. A board's durations are DECLARED: a shot is four seconds because somebody
  wrote four, and a video model was or will be billed for exactly that. So this plan does
  almost nothing, and the little it does is the part that would otherwise go wrong.

  It rounds each shot to a beat, because every cut in this repository lands on one and a
  board whose shots were 4.0 s against a 0.6 s beat would drift a third of a second by the
  end. And it lets the NARRATION widen a shot it does not fit in: a sentence cut off by
  the next cut is the one failure a film like this cannot recover from, and the extra
  frames are free — a generated clip that is a beat short simply holds its last frame,
  which is what a cutting room does with a short take.
*/
export type BoardShot = {
  n: number;
  from: number;
  to: number;
  /** Where the picture stops advancing, when the material is shorter than the shot. */
  holdFrom: number;
  source: "captured" | "generated" | "card";
  /** Seconds of clip or take this shot has to play. */
  material: number;
  /*
    Seconds into the material where this shot enters.

    The reason there are two clocks at all. A model sells eight seconds and a cut wants
    three, so a bought clip is entered at an offset — end-aligned on an interpolation, so
    the shot LANDS on the real frame it was told to end on and the next cut is a match cut
    onto the recording itself.
  */
  inSeconds: number;
};

export type BoardPlan = { durationInFrames: number; shots: BoardShot[] };

export function boardPlan(
  brief: Brief,
  shots: readonly {
    n: number;
    duration: number;
    origin: "captured" | "generated" | "card";
    gen?: { seconds: number; inPoint: number };
  }[],
  said: Record<number, number> = {},
): BoardPlan {
  const grid = gridOf(brief);
  const fps = grid.fps;
  const beat = grid.beatFrames;
  const out: BoardShot[] = [];
  let at = 0;
  for (const shot of shots) {
    const inSeconds = shot.gen ? shot.gen.inPoint / fps : 0;
    /*
      What is left of the material once the in-point is honoured — and never more than the
      shot's own duration.

      That upper bound is the whole point of measuring drift. A bought clip is eight seconds
      long and only about one of them is still the product; `shootBoard` writes that measured
      second onto `duration`, and without this clamp the plan would happily keep playing into
      second two, which is where the model's invented interface begins. Running out of
      material and holding a true frame is a decision the review gate is told about. Playing
      on into a drawing is not.
    */
    const material = shot.gen
      ? Math.min(Math.max(0, shot.gen.seconds - inSeconds), shot.duration / fps)
      : shot.duration / fps;
    const wanted = Math.max(shot.duration / fps, said[shot.n] ?? 0);
    const span = Math.max(beat * 2, Math.ceil((wanted * fps) / beat) * beat);
    out.push({
      n: shot.n,
      from: at,
      to: at + span,
      holdFrom: at + Math.min(span, Math.round(material * fps)),
      source: shot.origin,
      material,
      inSeconds,
    });
    at += span;
  }
  /* The piece ends on a bar, like every other piece here, so a bed can be generated to it. */
  return { durationInFrames: Math.max(grid.barFrames, Math.ceil(at / grid.barFrames) * grid.barFrames), shots: out };
}

/** The shot a frame belongs to. */
export function boardShotAt(plan: BoardPlan, frame: number): BoardShot | null {
  return plan.shots.find((s) => frame >= s.from && frame < s.to) ?? plan.shots[plan.shots.length - 1] ?? null;
}

/** Which second of a shot's own material a frame shows, holding the last one once it runs out. */
export function boardSourceAt(shot: BoardShot, frame: number, fps: number): number {
  if (shot.material <= 0) return shot.inSeconds;
  const played = Math.min(frame, shot.holdFrom) - shot.from;
  return shot.inSeconds + Math.min(Math.max(0, played / fps), Math.max(0, shot.material - 1 / fps));
}


/* ---------- Depth: the planes of a page that are really in front of it ---------- */

/*
  Which part of the page is lifted at a frame, and how far.

  Everything about a product film's depth has been guessed by everyone else in this
  category, because the only input they have is a flat picture — a monocular depth model
  reads contrast and salience, and on an interface that means it invents depth from a
  border. Panels come back bowed and card edges skew.

  We have never needed to guess. `MacroAsset` is the control the take actually clicked,
  rasterized by the page itself at up to eight device pixels per CSS pixel, with its
  rectangle in the recording's own coordinates — real z-order, measured. So the lift is a
  lookup, and the only judgement in this function is WHEN, not where.

  The when: a plane arrives a tick after its step begins, holds, and is gone a beat before
  the step ends. Both edges are ramps rather than cuts because a plane that pops in has no
  depth — it reads as an image appearing, and the whole cue is that it was always there and
  the camera moved.
*/
export type LiftedPlane = {
  box: CssBoxLike;
  file: string;
  ratio: number;
  depth: number;
};

type CssBoxLike = { x: number; y: number; width: number; height: number };

export type LiftPlan = { planes: LiftedPlane[]; focus: { fx: number; fy: number } };

/** A macro as the capture writes it, structurally, so this file does not depend on that package. */
type MacroLike = { mark: string; file: string; box: CssBoxLike; pixelRatio: number; at?: "mark" | "press"; afterControl?: { file: string; pixelRatio: number } };

export function liftAt(opts: {
  macros: readonly MacroLike[] | undefined;
  mark: string | undefined;
  frame: number;
  /** The step's own span, in frames. */
  from: number;
  to: number;
  /*
    The frame the control is pressed on. The plane is a picture of the control as it looked
    AT its mark, and what the press does to the page decides how long that picture is true:
    a press that navigated leaves nothing under it, so the plane is gone before the press; a
    press the capture could re-render — `afterControl`, the same box on the frame after — is
    swapped for that picture ON the press frame, as one swap, and the plane stays through the
    push and the hold, which is exactly where the camera is closest and the detail matters.
  */
  pressAt?: number;
  /*
    Whether the page under the control's box stayed put after the press. The after-state
    is a crop taken when the NEXT mark was reached, after every scroll in between — on a
    step that presses and then scrolls it is a picture of the scrolled page, and the plane
    is viewport-fixed while the page moves under it. So on such a step there is nothing
    true to swap to, and the plane goes before the press as it always did.
  */
  settled?: boolean;
  beatFrames: number;

  tickFrames: number;
  /** Where the camera is looking, as fractions of the page. */
  focus: { fx: number; fy: number };
  /*
    Canvas pixels the whole page occupies at this frame, camera included.

    The capture documents `pixelRatio` as a ceiling — "a renderer may draw the file
    `box.width × pixelRatio` canvas pixels wide and no wider" — and the point of the lift is
    that it stays SHARPER than the video behind it. Drawing it past its own density inverts
    that: the plane softens first and the depth cue runs backwards. So a lift that does not
    fit is not drawn.
  */
  pageWidthPx: number;
  /** The recording's own width in CSS pixels. */
  viewportWidth: number;
}): LiftPlan | null {
  const macro = opts.mark ? opts.macros?.find((m) => m.mark === opts.mark) : undefined;
  if (!macro || opts.to <= opts.from) return null;
  const press = opts.pressAt ?? opts.to;
  /*
    A control the mark could not see was photographed at the press, on the scrolled page,
    and its box is true only from there: lifted from the step's start it would be a copy of
    the control floating over whatever that box held before the scroll. So its plane's life
    begins at the press — which means the pressed picture is the only one it ever shows, and
    a press-captured control with no after-state lifts nothing.
  */
  const from = macro.at === "press" ? Math.max(opts.from, press) : opts.from;
  const after = opts.settled === false ? undefined : macro.afterControl;
  const to = after ? opts.to : Math.min(opts.to, Math.max(from, press));
  if (to <= from) return null;

  const inFrom = from + opts.tickFrames;
  const inTo = inFrom + opts.beatFrames;
  const outTo = to - opts.beatFrames;

  const outFrom = Math.max(inTo, outTo - opts.beatFrames);
  if (outTo <= inFrom) return null;
  const depth =
    opts.frame < inFrom || opts.frame > outTo
      ? 0
      : opts.frame < inTo
        ? (opts.frame - inFrom) / Math.max(1, inTo - inFrom)
        : opts.frame > outFrom
          ? 1 - (opts.frame - outFrom) / Math.max(1, outTo - outFrom)
          : 1;
  if (depth <= 0.01) return null;

  const drawn = opts.pageWidthPx * (macro.box.width / opts.viewportWidth);
  if (drawn > macro.box.width * macro.pixelRatio) return null;

  const file = after && opts.frame >= press ? after.file : macro.file;
  return {
    planes: [{ box: macro.box, file, ratio: macro.pixelRatio, depth: Math.min(1, Math.max(0, depth)) }],
    focus: opts.focus,
  };
}
