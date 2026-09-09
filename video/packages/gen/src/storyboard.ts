/*
  The storyboard: panels, in order, each with a picture.

  This file was rewritten once, and the reason is worth keeping. The first version was a
  list of shots described in prose — size, movement, a sentence about what was in frame —
  and it was called a storyboard because it was ordered and had durations. It was a SHOT
  LIST. A shot list is a table you take to a shoot; a storyboard is a sequence of drawings
  with a notation layer around them, and the drawing is not decoration. It is the thing
  the board is FOR: you look at it, and you can see the film.

  That distinction stopped being academic the moment these films started being generated.
  Every video model on the market takes an image as the frame a clip opens on, and the
  better ones take a second image as the frame it ends on. So the panel — the drawing —
  is literally the API payload. A board without pictures has nothing to send, which is why
  the version of this file that had no pictures could only ever commission b-roll: a
  sentence is all it had.

  Three consequences shape everything below.

  ONE: a shot owns one or two panels, not one. The convention is ninety years old and is
  drawn as `3A` and `3B` — the start framing and the end framing of ONE continuous move,
  numbered that way to say "this is one shot, not two setups". `3A` is `image`, `3B` is
  `lastFrame`. The drawing convention and the request body turn out to be the same shape,
  which is not a coincidence: both are answering "where does this begin and where does it
  end".

  TWO: a panel's duration is in FRAMES. A board that stores 2.5 seconds is a board that
  cannot be conformed against a cut; every board in the craft counts frames, and so does
  this one.

  THREE: there are two clocks, and collapsing them was the other structural error. What
  the EDIT gets and what the MODEL is asked for are different numbers and always will be:
  the measured average shot in a commercial is a little over two seconds, and no model on
  the market will make a clip that short — Veo makes four, six or eight, and eight is
  forced the moment a first frame is attached. So a shot carries `duration` (frames, what
  the cut uses) and, separately, `gen.seconds` and `gen.inPoint` (what was bought, and
  where the cut enters it). We always generate long and cut short. Letting the model's
  grid set the film's rhythm is how a tool ends up with a four-second hold on a click.
*/

/** Frames at the board's fps. Never a float second — a board is frame-accurate or it is a mood. */
export type Frames = number;

/** Shot size, the oldest vocabulary in the craft and the one every prompt guide answers to. */
export type Framing = "wide" | "full" | "medium" | "close" | "macro" | "insert";

export type Angle = "eye" | "high" | "low" | "top-down" | "dutch";

/*
  What the camera does.

  Named the way the published prompt guides name them, because these models were trained
  on film vocabulary and answer to it: "whip pan" moves the camera and "fast pan" mostly
  does not. The order is roughly gentlest first; anything below `orbit` is a move a
  compositor cannot fake, which is the only honest reason to buy a shot.
*/
export type Move =
  | "static"
  | "push-in"
  | "pull-out"
  | "pan"
  | "tilt"
  | "dolly"
  | "handheld"
  | "orbit"
  | "crane"
  | "whip-pan"
  | "crash-zoom"
  | "snap-zoom-out"
  | "speed-ramp"
  | "roll"
  | "flythrough";

/** How this shot leaves. A board that does not say is a board that discovers it in the edit. */
export type Out = "cut" | "match-cut" | "dissolve" | "whip" | "to-black";

/*
  Where a shot's pixels come from, and it is the spine of the whole design.

  - `captured` is the product's own recording, played by the engine's renderer. Free, and true.
  - `card` is type on the film's own stage, set by panoma video's own type engine. Free, and true.
  - `generated` is a clip bought from a model.

  A generated shot is further split by what it was CONDITIONED on, which is `GenPlan.mode`
  below, and that is where the real argument lives.
*/
export type Origin = "captured" | "card" | "generated";

/** What this shot is for in the cut, which is not the same question as what is in it. */
export type Role = "open" | "beat" | "transition" | "impact" | "close";

/*
  A still on disk: the panel's picture.

  Always full resolution and never a preview. When a still is the frame another shot
  continues from, every compression artefact in it is conditioning the next clip, and a
  preview-sized join is how a sequence drifts in colour for a reason nobody can find.
*/
export type Still = {
  /** Path relative to the board's own directory. */
  file: string;
  /** The bytes, so an approved panel can be proved to be the one that was approved. */
  sha256: string;
  /** Where the picture came from. A `capture` still is the product's own pixels, untouched. */
  made:
    | { by: "capture"; take: string; mark: string; t: number }
    | { by: "render"; recipe: string }
    | { by: "image-model"; provider: string; model: string; prompt: string };
};

/*
  One panel: the drawing, and where the eye is meant to be in it.

  `screen` is stored because it is what makes a continuity check possible at all. Screen
  direction, the 180-degree line and eyeline are decisions a board either makes or fails
  to make, and they are only checkable between adjacent panels if position and facing are
  data rather than something a reader infers from a picture.
*/
export type Panel = {
  /** "3A" | "3B" — the shot's number and which end of the move this is. */
  id: string;
  at: "first" | "last";
  /** Where the subject sits, normalised 0..1, and which way it faces. */
  screen: { x: number; y: number; facing: "left" | "right" | "camera" | "away" };
  still?: Still;
};

/*
  How a generated shot is conditioned, and the whole risk of the film is in this field.

  - `interpolate` hands the model TWO real frames of the product — the frame at one mark
    and the frame at the next — and asks only for the move between them. Both ends of the
    clip are true. It is the strongest constraint a video model accepts, and it is the
    mode a product film should be in whenever it can: whatever the model invents, it has
    to arrive exactly where the recording actually went.
  - `animate` hands it ONE real frame and lets it move away from it. Everything after the
    first frame is the model's. Bounded only by how little of it we use.
  - `text` hands it nothing. It is for atmosphere — the shot between two pieces of screen
    recording that gives the film physical weight — and it may never depict the product.

  The honest caveat, recorded here because it is a property of the medium and not of this
  code: in `interpolate` and `animate` the model REDRAWS the interface for every frame it
  invents. It is conditioned on the truth at the ends and it is guessing in the middle.
  That is why `inPoint` exists, why transitions are short, and why the two ends of an
  interpolation are real: drift is a function of distance from a true frame, so a cut that
  lives near one is a cut that stays honest.
*/
export type GenMode = "interpolate" | "animate" | "text";

export type GenPlan = {
  mode: GenMode;
  /*
    What the camera is asked to do, and NOTHING about what is in frame.

    This is the one piece of prompt craft that is load-bearing rather than stylistic. Every
    guide for image-conditioned generation says the same thing and says it bluntly: delete
    any sentence describing what is already visible in the source image. The picture is the
    content; the prompt is the move. A prompt that also describes the content is a prompt
    arguing with its own conditioning image, and the model resolves that argument by
    redrawing. So for `interpolate` and `animate` this is camera language only.
  */
  motion: string;
  /** Seconds actually bought, snapped to the model's grid. Not the same number as `duration`. */
  seconds: number;
  /** Frames into the bought clip where the cut enters. Drift grows with distance from a true frame. */
  inPoint: Frames;
};

/** One attempt at a shot, kept or not. Yield on these models is well below one. */
export type Take = {
  /** The shot this was an attempt at. */
  n: number;
  id: string;
  file: string;
  provider: string;
  model: string;
  seconds: number;
  cost: number;
  /** Everything the request asked for that the provider does not do. Never silent. */
  ignored: string[];
  verdict: "kept" | "rejected" | "blocked";
  why?: string;
};

export type Shot = {
  n: number;
  origin: Origin;
  role: Role;
  /** What the EDIT gets, in frames at the board's fps. */
  duration: Frames;

  /* ---- the notation layer, typed rather than prose ---- */
  framing: Framing;
  angle: Angle;
  move: Move;
  /** What is in frame, in a phrase. For a captured shot this describes the recording, not a request. */
  subject: string;
  action?: string;
  /** The line said over it, per language. A shot with nothing said is a beat. */
  say?: Record<string, string>;
  out: Out;
  /** The margin note: why this shot is in the film. Prose for a person, never parsed. */
  note: string;

  /** One panel, or two: the start and the end framing of one continuous move. */
  panels: [Panel] | [Panel, Panel];
  /** Where the panel pictures come from when the shot is `captured`. */
  source?: { take: string; mark: string; nextMark?: string };
  /** A card's words. */
  text?: Record<string, string>;
  /** How this shot was commissioned, when it was. */
  gen?: GenPlan;
  /** Every attempt, so the board is a ledger and not a wish. */
  takes?: Take[];
};

/*
  The style block, repeated byte-identical in every generated prompt.

  Not an aesthetic choice: these models have no memory between calls, so anything not
  restated in every request is re-invented, and literal string repetition is the
  consistency method the vendors themselves document. It is a frozen value on the board
  rather than a sentence somebody re-types per shot, because a style block that drifts is
  a film that drifts.
*/
export type Bible = {
  energy: "calm" | "kinetic";
  /** One sentence of photography: stock, lens, light, grade. */
  photography: string;
  /** Hex colours the film already uses, so bought and recorded footage are lit by one decision. */
  palette: string[];
  mood: string;
  /*
    Nouns and adjectives only, never sentences, and never phrased as "no x".

    A negative prompt is a list of things to steer away from. Writing an instruction there
    ("no text on screen") is the one documented way to make a model produce the thing:
    naming text at all raises its likelihood, which is why researchers working on
    text-heavy conditioning deliberately keep the word out of their prompts. See
    `negativeOf`, which is where this becomes a rule rather than a warning.
  */
  never: string[];
};

export type Board = {
  id: string;
  project: string;
  premise: string;
  /*
    Two boards, two audiences, and advertising has always made both: a short PITCH board
    to get a yes, and a longer SHOOTING board to make the thing. One artefact trying to be
    both is too vague to shoot and too technical to show.
  */
  mode: "pitch" | "shooting";
  format: "h" | "v" | "s";
  fps: number;
  bible: Bible;
  shots: Shot[];
  /** What panoma video could not decide and a person should: written down rather than guessed. */
  open?: string[];
};

/* ---------------------------------------------------------------- the rules */

/*
  What a shot may never be asked to draw, whatever anybody writes on the board.

  These are nouns, and they are checked against a shot's own words before a request is
  built — a negative prompt is a preference, and the refusal is the rule. Note what is NOT
  here any more: "text", "readable text", "subtitles". Those were on this list for a year
  and they were actively harmful, because a negative prompt naming text is still a prompt
  naming text. Type is kept out of generated frames by never asking for a frame with type
  in it, and by setting every word in this film in panoma video's own type engine.
*/
export const NEVER_GENERATED = [
  "user interface",
  "app interface",
  "software screen",
  "screenshot",
  "dashboard",
  "web page",
  "browser window",
  "menu bar",
  "logo",
  "watermark",
];

/** Words in a shot's own description that mean it is asking a model to invent software. */
const DEPICTS_SOFTWARE =
  /\b(screenshot|screen shot|user interface|\bui\b|\bux\b|dashboard|web ?page|website|browser|app screen|the app'?s|button|menu|sidebar|modal|dialog|form field|login|the interface|scrolling through|clicks? on)\b/i;

/**
 * Why a shot may not be generated — or null when it may.
 *
 * The rule is narrower than it used to be, and the narrowing is deliberate. It is no
 * longer "a model may never see the product": a shot conditioned on two real frames of
 * the recording is the whole point of `interpolate`, and refusing it refused the only
 * technique that gives a product film movement on the product itself.
 *
 * What is still refused is a model being asked to INVENT an interface — a shot whose own
 * words describe software with no capture behind them. A model asked for "a laptop showing
 * the dashboard" returns a laptop showing something that looks like a dashboard, and that
 * thing is a lie about a product that exists. So `text` shots are read strictly, and
 * conditioned shots are read for their motion only, because their content is a photograph.
 */
export function refuseGenerated(shot: Shot): string | null {
  if (shot.origin !== "generated" || !shot.gen) return null;
  if (shot.gen.mode !== "text") {
    /* Conditioned on real frames: the picture is the content, so only the MOVE is read. */
    const hit = DEPICTS_SOFTWARE.exec(shot.gen.motion);
    return hit
      ? `shot ${shot.n} is conditioned on a real frame, so its prompt must describe the CAMERA and nothing else — "${hit[0]}" describes the content, which is what makes a model redraw it.`
      : null;
  }
  const hit = DEPICTS_SOFTWARE.exec([shot.subject, shot.action ?? "", shot.gen.motion].join(" "));
  return hit
    ? `shot ${shot.n} asks a model to draw software: "${hit[0]}" appears in its description, and nothing real is conditioning it. Film the product instead (origin: "captured"), or write this shot about the world around it.`
    : null;
}

const list = (items: readonly string[]) => items.join(", ");

const SIZE: Record<Framing, string> = {
  wide: "Wide shot",
  full: "Full shot",
  medium: "Medium shot",
  close: "Close-up",
  macro: "Extreme macro shot",
  insert: "Insert",
};

const MOVE: Record<Move, string> = {
  static: "The camera is locked off and does not move",
  "push-in": "The camera pushes slowly in",
  "pull-out": "The camera pulls slowly back",
  pan: "The camera pans",
  tilt: "The camera tilts",
  dolly: "The camera dollies sideways, parallax across the frame",
  handheld: "Handheld, with a hard natural drift",
  orbit: "The camera orbits around the subject",
  crane: "The camera cranes up and over",
  "whip-pan": "A violent whip pan tears across the frame, motion blur smearing everything, and lands hard",
  "crash-zoom": "A crash zoom slams in",
  "snap-zoom-out": "A snap zoom rips backwards",
  "speed-ramp": "The shot ramps from slow motion into real time and back, the speed change visible",
  roll: "The camera rolls hard around its own axis",
  flythrough: "The camera flies through and past the subject at speed, never stopping",
};

/**
 * How a shot becomes a sentence — and the two kinds are not written the same way.
 *
 * A CONDITIONED shot gets camera language and nothing else. The conditioning image is the
 * content, and every sentence describing that content is a second, conflicting source of
 * truth for a model that will resolve the conflict by redrawing. The published guidance
 * for image-to-video is unusually blunt about this — delete anything already visible in
 * the source image — and it is also the single cheapest thing anyone can do to keep a real
 * interface intact through a generated move. No style block either: the photography is
 * already in the photograph.
 *
 * A TEXT shot gets the full description, because there is nothing else to go on.
 */
export function promptOf(shot: Shot, bible: Bible): string {
  const gen = shot.gen;
  if (!gen) throw new Error(`shot ${shot.n} has no generation plan`);
  if (gen.mode !== "text") {
    const ends =
      gen.mode === "interpolate"
        ? "Begin exactly on the first image and end exactly on the last image. Nothing in the frame changes except the camera: the scene is a photograph and the camera moves over it."
        : "Begin exactly on the given image. Nothing in the frame changes except the camera.";
    return `${MOVE[shot.move]}. ${ends} ${bible.energy === "kinetic" ? "The move is confident and continuous." : "The move is slow and steady."}`;
  }
  return [
    `${SIZE[shot.framing]}: ${shot.subject}.`,
    shot.action ? `${shot.action[0].toUpperCase()}${shot.action.slice(1)}.` : "",
    `${MOVE[shot.move]}.`,
    bible.energy === "kinetic"
      ? "High energy. The motion is the subject: it happens fast, with weight, and it does not settle."
      : "Unhurried. One thing happens, slowly.",
    `${bible.photography}. ${bible.mood}.`,
    `Colour palette: ${list(bible.palette)}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * What must not appear, as nouns.
 *
 * A conditioned shot gets a much shorter list than a dreamt one, and it gets nothing that
 * names an interface. Telling a model "no dashboard" while handing it a photograph of a
 * dashboard is an instruction to change the picture, and it will.
 */
export function negativeOf(shot: Shot, bible: Bible): string {
  const conditioned = shot.gen?.mode !== "text";
  const words = conditioned
    ? ["warping", "morphing", "distortion", "flicker", "camera shake", "people", "hands"]
    : [...NEVER_GENERATED, ...bible.never];
  return list([...new Set(words)]);
}

/* ------------------------------------------------------------- arithmetic */

export const secondsOf = (board: Board): number =>
  board.shots.reduce((n, s) => n + s.duration, 0) / board.fps;

/** Every shot that costs a video call. */
export const commissioned = (board: Board): Shot[] => board.shots.filter((s) => s.origin === "generated" && s.gen);

/** Seconds a board would BILL for, which is not the seconds it runs. We buy long and cut short. */
export const billedSeconds = (board: Board): number =>
  commissioned(board).reduce((n, s) => n + (s.gen?.seconds ?? 0), 0);

const tc = (frames: Frames, fps: number) =>
  `${String(Math.floor(frames / fps)).padStart(2, "0")}:${String(frames % fps).padStart(2, "0")}`;

/** The board as a person reads it in a terminal. The picture version is the contact sheet. */
export function boardText(board: Board): string {
  const rows = board.shots.flatMap((s) => {
    const panels = s.panels.map((p) => `${p.id}${p.still ? "" : " (no picture)"}`).join(" → ");
    const lines = [
      `  ${String(s.n).padStart(2)}. ${s.origin.padEnd(9)} ${tc(s.duration, board.fps)}  ${s.framing.padEnd(6)} ${s.move.padEnd(11)} ${s.subject}`,
      `      panels: ${panels}`,
    ];
    if (s.action) lines.push(`      action: ${s.action}`);
    if (s.source) lines.push(`      the recording at "${s.source.mark}"${s.source.nextMark ? ` → "${s.source.nextMark}"` : ""}`);
    if (s.text) lines.push(`      card: ${Object.values(s.text)[0]}`);
    if (s.say) lines.push(`      said: ${Object.values(s.say)[0]}`);
    if (s.gen)
      lines.push(
        `      ${s.gen.mode}: buys ${s.gen.seconds}s, uses ${tc(s.duration, board.fps)} from frame ${s.gen.inPoint}`,
        `      camera: ${s.gen.motion}`,
      );
    lines.push(`      out on ${s.out} · ${s.note}`);
    return lines;
  });
  return [
    `${board.id} · ${board.project} · ${board.mode} board · ${board.format} · ${secondsOf(board).toFixed(1)}s in ${board.shots.length} ${board.shots.length === 1 ? "shot" : "shots"} at ${board.fps}fps`,
    `  premise: ${board.premise}`,
    `  look: ${board.bible.photography} · ${board.bible.mood} · ${list(board.bible.palette)}`,
    "",
    ...rows,
    "",
    `  to commission: ${commissioned(board).length} ${commissioned(board).length === 1 ? "shot" : "shots"}, ${billedSeconds(board)}s billed for ${(commissioned(board).reduce((n, s) => n + s.duration, 0) / board.fps).toFixed(1)}s used`,
    ...(board.open && board.open.length > 0 ? ["", "  decisions panoma video did not make:", ...board.open.map((o) => `    · ${o}`)] : []),
  ].join("\n");
}
