/*
  Composing a storyboard out of a recording that already exists.

  The panels are not drawn and they are not dreamt: they are the product's own frames.
  `packages/capture` already writes a lossless full viewport at every mark of a take —
  `SessionLog.frames`, a PNG per mark at the page's own device pixel ratio — and those
  files ARE the board. Twelve marks is twelve panels, which is also, by coincidence worth
  noticing, the number of panels a thirty-second commercial is boarded at.

  That changes what generation is for, and it is the whole argument of this file.

  A shot on this board is one continuous camera move between two marks. Panel `3A` is the
  frame at the first mark, panel `3B` is the frame at the second, and both of them are
  photographs of a real interface at a real instant. Handed to a video model as `image` and
  `lastFrame`, they are the two ends of an interpolation: the model is not asked what the
  product looks like — it is shown, twice — it is asked only to move the camera from one
  true frame to the other. Whatever it invents in between has to arrive exactly where the
  recording actually went.

  That is the honest version of "give the product action", and the honesty is bounded
  rather than absolute. Between those two true frames the model REDRAWS the interface, and
  a redrawn interface is a guess: small type is where every one of these models is measured
  worst, and the guess gets worse the further a frame sits from something real. Three
  decisions in this file are that risk, handled:

  - The two ends are real, so the error is zero at both and largest in the middle.
  - We buy eight seconds because the API sells nothing shorter once a picture is attached,
    and we CUT about three — end-aligned, so the shot lands on the true frame and the next
    cut is a match cut onto the recording itself.
  - The prompt says nothing about what is in frame. Only the camera. A sentence describing
    content is a second source of truth arguing with the photograph, and the model settles
    that argument by redrawing.

  What is NOT here any more: the plate. A generated room behind a pasted screenshot is two
  layers with two light sources and two cameras, and it reads as a sticker on wallpaper no
  matter how good the room is. It was the wrong answer to the right question.
*/
import type { Brief, Line } from "@panoma/video-core";
import type { Direction } from "@panoma/video-brand/direction";
import type { SessionLog, FrameAsset, MacroAsset } from "@panoma/video-capture";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Bible, Board, Frames, Move, Panel, Shot, Still } from "@panoma/video-gen";
import { refuseGenerated } from "@panoma/video-gen";

const textOf = (line: Line, lang: string) => line.text[lang] ?? line.text[Object.keys(line.text)[0]] ?? "";

/*
  How long each kind of shot is held, in seconds, before it becomes frames.

  From the measured commercial baseline rather than from taste: the average shot in a
  thirty-second spot is a little over two seconds, and the same studies find recall and
  persuasion DROP as the shot count climbs — so this is deliberately not as fast as it
  could be. A product beat is held long enough to read a claim and no longer.
*/
export const HOLD = { card: 2, beat: 3.5, move: 3, atmosphere: 2 } as const;

/** A move is bought at this many seconds because the API sells nothing shorter with a picture attached. */
export const BUY_SECONDS = 8;

/**
 * The style block every generated prompt repeats, taken from the film's own direction.
 *
 * The palette is the only thing that makes a bought shot and a recorded one belong to the
 * same film, and these models have no memory between calls — so it is a value carried on
 * the board rather than a sentence somebody remembers to paste.
 */
export function bibleOf(direction: Direction, tone?: string, energy: Bible["energy"] = "calm"): Bible {
  const dark = direction.scheme === "dark";
  const kinetic = energy === "kinetic";
  return {
    energy,
    photography: kinetic
      ? `Shot on 35mm anamorphic at a high frame rate, wide open, ${dark ? "hard raking light in the dark, deep shadow" : "hard directional daylight, bright falloff"}, heavy motion blur on anything that moves, real grain`
      : dark
        ? "Shot on 35mm, shallow depth of field, low-key light from one side, gentle film grain, unhurried"
        : "Shot on 35mm, shallow depth of field, soft daylight from a large window, gentle film grain, unhurried",
    palette: [direction.stage.hex, direction.accent.hex, direction.ink.hex],
    mood: kinetic
      ? tone === "playful" ? "Fast, physical, a little reckless" : "Fast, physical, precise"
      : tone === "technical" ? "Quiet, precise, unsentimental" : "Calm and considered",
    /*
      Nouns, never instructions, and nothing here names type. A negative prompt that says
      "no text" is still a prompt that says "text", which is the documented way to make one
      of these models draw some. Words stay out of generated frames by never asking for a
      frame with words in it; every line in this film is set by panoma video's own type engine.
    */
    never: ["people", "faces", "hands", "lens flare", "stock-footage gloss"],
  };
}

export type BoardInput = {
  id: string;
  project: string;
  brief: Brief;
  lang: string;
  format: "h" | "v" | "s";
  direction: Direction;
  /** The take whose frames are the panels. Without one there is no board, only a wish. */
  take: SessionLog;
  /** Where that take's files live, so a panel can point at a picture that exists. */
  takeDir: string;
  premise: string;
  tone?: string;
  mode?: Board["mode"];
  /*
    How many product beats are bought as camera moves rather than played from the
    recording. Every one of them is eight seconds of billing and an interface the model
    redraws in the middle, so it is a number somebody chooses, and the rest of the board
    plays the recording exactly as it happened.
  */
  moves?: number;
  energy?: Bible["energy"];
};

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex").slice(0, 16);

/*
  Where the eye is in a panel, from the product's own geometry.

  Not a guess and not a constant: `MacroAsset.box` is the rectangle of the control the take
  actually clicked, in the recorded viewport's own pixels, so the subject's position on
  screen is a measurement. It is stored because it is the only thing that makes a
  continuity check possible at all — screen direction and the line are checkable between
  adjacent panels when position is data and unknowable when it is prose.
*/
function screenOf(macro: MacroAsset | undefined, viewport: { width: number; height: number }): Panel["screen"] {
  if (!macro?.box) return { x: 0.5, y: 0.5, facing: "camera" };
  const x = (macro.box.x + macro.box.width / 2) / viewport.width;
  const y = (macro.box.y + macro.box.height / 2) / viewport.height;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)), facing: x < 0.5 ? "right" : "left" };
}

/**
 * The camera move between two marks, chosen from where the product's own attention went.
 *
 * A move that ignores the two frames it sits between is decoration. This one reads the
 * distance the clicked control travelled across the viewport: a control that stayed put
 * gets a push, one that moved sideways gets a dolly that follows it, one that moved a long
 * way gets a whip. It is arithmetic over a measurement, which means it is the same board
 * every time and a person can argue with the rule rather than with a mood.
 */
export function moveBetween(a: Panel["screen"], b: Panel["screen"]): Move {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx < 0.08 && dy < 0.08) return "push-in";
  if (dx > 0.45) return "whip-pan";
  if (dx > dy) return "dolly";
  return "tilt";
}

/*
  Camera language, and nothing else.

  This is the sentence the model is given for a conditioned shot, and every word of it is
  about the camera. No subject, no setting, no style, no photography — those are in the
  photograph. See `promptOf` in @panoma/video-gen for why: a description of content beside a
  conditioning image is a conflict, and a model resolves a conflict by drawing.
*/
const MOTION: Record<Move, string> = {
  "push-in": "a slow, steady push straight in",
  "pull-out": "a slow, steady pull straight back",
  dolly: "a smooth lateral dolly, the frame sliding across with parallax",
  tilt: "a slow tilt down the frame",
  pan: "a slow pan across the frame",
  "whip-pan": "a fast whip across the frame that settles hard",
  static: "the camera locked off, holding perfectly still",
  handheld: "a small, natural handheld drift",
  orbit: "a slow arc around the frame",
  crane: "a rise up and over",
  "crash-zoom": "a hard zoom straight in",
  "snap-zoom-out": "a hard zoom straight back",
  "speed-ramp": "a ramp from slow into real time",
  roll: "a slow roll around the centre",
  flythrough: "a continuous move through and past the frame",
};

/**
 * The board for one film, from one take.
 *
 * Deterministic: the same brief, take and direction produce the same board, so a person
 * can read it, change one line, and see exactly that line change. Nothing here asks a
 * model anything — the panels are files that already exist and the moves are arithmetic
 * over where the product's own controls were.
 */
export async function boardOf(input: BoardInput): Promise<Board> {
  const { brief, lang, take, takeDir } = input;
  const fps = brief.fps ?? 30;
  const sec = (s: number): Frames => Math.round(s * fps);
  const bible = bibleOf(input.direction, input.tone, input.energy);
  const open: string[] = [];

  const frames = take.frames ?? [];
  if (frames.length === 0) {
    throw new Error(
      `The take ${take.name} has no frames, so there is nothing to board. Re-record it: frames are the panels, and a take made before panoma video captured them cannot be turned into a storyboard after the fact.`,
    );
  }
  const byMark = new Map<string, FrameAsset>(frames.map((f) => [f.mark, f]));
  const macroByMark = new Map<string, MacroAsset>((take.macros ?? []).map((m) => [m.mark, m]));

  const stillOf = async (frame: FrameAsset): Promise<Still> => ({
    file: join(takeDir, frame.file),
    sha256: sha(await readFile(join(takeDir, frame.file))),
    made: { by: "capture", take: take.name, mark: frame.mark, t: frame.t },
  });

  const steps = brief.lines.filter((l) => l.mark && byMark.has(l.mark));
  const missing = brief.lines.filter((l) => l.mark && !byMark.has(l.mark));
  for (const m of missing) open.push(`the brief has a line at mark "${m.mark}" and the take has no frame there, so it is not on the board`);
  const outro = brief.lines.filter((l) => !l.mark);
  const hook = brief.hooks[0];

  const shots: Shot[] = [];
  let n = 1;

  /*
    ONE. The promise, on the film's own stage.

    A card is not a panel with a picture in it — it is type panoma video sets itself,
    and it is first because half the audience of a thirty-second piece is gone by
    fifteen seconds. Whatever the film promises has to be said before the product
    appears.
  */
  shots.push({
    n: n++,
    origin: "card",
    role: "open",
    duration: sec(HOLD.card),
    framing: "full",
    angle: "eye",
    move: "static",
    subject: "the promise, as type",
    text: hook.text,
    out: "cut",
    note: "what the viewer will be able to do, said once, with the frame to itself",
    panels: [{ id: "1A", at: "first", screen: { x: 0.5, y: 0.5, facing: "camera" } }],
  });

  /*
    TWO ONWARDS. One shot per step, and each one is a move between two real frames.

    The `moves` budget decides which of them are BOUGHT as camera moves and which simply
    play the recording. It is spent on the first beats rather than spread across all of
    them, because a film establishes its grammar in its first ten seconds: a viewer who has
    seen the camera move once reads every later hold as a choice.
  */
  let bought = 0;
  const budget = input.moves ?? 0;
  for (const [i, line] of steps.entries()) {
    const frame = byMark.get(line.mark!)!;
    const next = steps[i + 1] ? byMark.get(steps[i + 1].mark!) : take.last;
    const a: Panel = {
      id: `${n}A`,
      at: "first",
      screen: screenOf(macroByMark.get(line.mark!), take.viewport),
      still: await stillOf(frame),
    };
    const b: Panel | undefined = next
      ? { id: `${n}B`, at: "last", screen: screenOf(macroByMark.get(next.mark), take.viewport), still: await stillOf(next) }
      : undefined;
    const move = b ? moveBetween(a.screen, b.screen) : "push-in";
    const label = line.label?.[lang] ?? line.mark!;
    /*
      Bought only when there are two real frames to sit between. A move conditioned on one
      frame is a model inventing where the product went, and the recording already knows.
    */
    const buy = b !== undefined && bought < budget;
    if (buy) bought++;

    shots.push({
      n,
      origin: buy ? "generated" : "captured",
      role: "beat",
      duration: sec(buy ? HOLD.move : HOLD.beat),
      framing: "medium",
      angle: "eye",
      move: buy ? move : "push-in",
      subject: label,
      say: { [lang]: textOf(line, lang) },
      out: "cut",
      note: buy
        ? `the camera moves from the product at "${line.mark}" to the product at "${next!.mark}": both ends are the recording, the move between them is bought`
        : `the recording at ${(frame.t / 1000).toFixed(1)}s, played as it happened`,
      panels: b ? [a, b] : [a],
      source: { take: take.name, mark: line.mark!, ...(next ? { nextMark: next.mark } : {}) },
      ...(buy
        ? {
            gen: {
              mode: "interpolate" as const,
              motion: MOTION[move],
              seconds: BUY_SECONDS,
              /*
                Head-aligned, and this line used to say the opposite.

                The reasoning for end-aligning was good: both ends of an interpolation are
                true, the error is largest in the middle, and taking the tail means the shot
                LANDS on the real frame the recording picks up from — a match cut onto a
                photograph. Then the first board was shot and measured (see
                packages/review/src/drift.ts): the honest head runs about a second and the
                honest tail about a third of one, and the return is abrupt rather than
                gradual. The head is three times longer, so that is where the cut starts.

                It is a provisional value either way. `shootBoard` measures the clip that
                actually arrives and rewrites this from the file, because the width of the
                window depends on the model, the duration, the move and how far apart the
                two real frames are.
              */
              inPoint: 0,
            },
          }
        : {}),
    });
    n++;
  }
  if (budget > bought) open.push(`${budget - bought} camera moves were budgeted and the take has frames for ${bought}: a move needs two marks to sit between`);

  /* AND THE CLOSE: the address, which is the only thing a viewer has to remember. */
  if (outro.length > 0) {
    shots.push({
      n: n++,
      origin: "card",
      role: "close",
      duration: sec(HOLD.card + 1),
      framing: "full",
      angle: "eye",
      move: "static",
      subject: "where to go",
      text: Object.fromEntries(Object.keys(outro[0].text).map((l) => [l, outro.map((o) => o.text[l]).filter(Boolean).join(" ")])),
      out: "to-black",
      note: "the address, composited by panoma video and never generated",
      panels: [{ id: `${n - 1}A`, at: "first", screen: { x: 0.5, y: 0.5, facing: "camera" } }],
    });
  }

  const board: Board = {
    id: input.id,
    project: input.project,
    premise: input.premise,
    mode: input.mode ?? "shooting",
    format: input.format,
    fps,
    bible,
    shots,
    ...(open.length > 0 ? { open } : {}),
  };

  /*
    And the refusal runs on the board rather than at the moment of spending, so a shot that
    asks a model to invent an interface is a mistake somebody reads with the shot number
    beside it, not a request that silently never went.
  */
  const refused = board.shots.map(refuseGenerated).filter((why): why is string => why !== null);
  if (refused.length > 0) throw new Error(`This board asks a model to draw the product:\n${refused.map((r) => `  ${r}`).join("\n")}`);
  return board;
}

/** Everything a panel points at, resolved to absolute paths, for the sheet and the render. */
export const panelFiles = (board: Board): string[] =>
  board.shots.flatMap((s) => s.panels.map((p) => p.still?.file).filter((f): f is string => f !== undefined));

export { dirname };
