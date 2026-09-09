/*
  A storyboard is the one artefact in this repository that describes a film panoma video
  has not shot, and four things about it have to be true whatever anybody writes in it.

  It may not ask a model to INVENT the product — a dreamt screenshot is a fabricated
  screenshot, and a tool that will make one is a tool whose other footage nobody can trust.
  Its panels have to be pictures, because a panel is what a video model is conditioned on
  and a board with no pictures can only ever buy b-roll. Its two clocks must stay apart:
  what the edit gets and what the model is sold are different numbers and collapsing them
  lets a vendor's duration grid set a film's rhythm. And it has to say what a shot will
  COST before it is bought, on a provider that may not even make the shape the film is cut
  in.
*/
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  NEVER_GENERATED,
  billedSeconds,
  boardText,
  capabilityOf,
  commissioned,
  gridFor,
  nearestSeconds,
  negativeOf,
  priceOf,
  promptOf,
  refuseGenerated,
  secondsOf,
  unhonoured,
  type Bible,
  type Board,
  type Panel,
  type Shot,
} from "@panoma/video-gen";
import { moveBetween, HOLD, BUY_SECONDS } from "@panoma/video-director";

const bible: Bible = {
  energy: "kinetic",
  photography: "Shot on 35mm, soft daylight",
  palette: ["#101010", "#b0800f"],
  mood: "Calm and considered",
  never: ["people", "faces"],
};

const panel = (id: string, at: Panel["at"], withStill = true): Panel => ({
  id,
  at,
  screen: { x: 0.5, y: 0.5, facing: "camera" },
  ...(withStill ? { still: { file: `/tmp/${id}.png`, sha256: `sha-${id}`, made: { by: "capture" as const, take: "t", mark: "m", t: 0 } } } : {}),
});

/** A shot conditioned on two real frames of the recording: the mode a product film lives in. */
const move = (over: Partial<Shot> = {}): Shot => ({
  n: 2,
  origin: "generated",
  role: "beat",
  duration: 90,
  framing: "medium",
  angle: "eye",
  move: "push-in",
  subject: "Open panoma",
  out: "cut",
  note: "the camera moves between two real frames",
  panels: [panel("2A", "first"), panel("2B", "last")],
  gen: { mode: "interpolate", motion: "a slow, steady push straight in", seconds: 8, inPoint: 150 },
  ...over,
});

/** A shot conditioned on nothing: the one place a model could invent an interface. */
const dreamt = (over: Partial<Shot> = {}): Shot => ({
  n: 1,
  origin: "generated",
  role: "transition",
  duration: 48,
  framing: "macro",
  angle: "eye",
  move: "crash-zoom",
  subject: "a mechanical keycap at macro distance, dust in the light around it",
  action: "the cap slams down and the whole frame shudders",
  out: "cut",
  note: "the click, as a physical thing",
  panels: [panel("1A", "first", false)],
  gen: { mode: "text", motion: "a crash zoom straight in", seconds: 4, inPoint: 0 },
  ...over,
});

const boardOf = (shots: Shot[]): Board => ({
  id: "b",
  project: "p",
  premise: "why",
  mode: "shooting",
  format: "h",
  fps: 30,
  bible,
  shots,
});

describe("what a board may ask a model for", () => {
  test("a shot conditioned on nothing may not describe software", () => {
    const why = refuseGenerated(dreamt({ subject: "a laptop showing the app's dashboard" }));
    assert.match(String(why), /may not|draw software/i);
  });

  test("a shot conditioned on a real frame may name the product, because it is a photograph of it", () => {
    /*
      This is the rule that was too wide and had to be narrowed. Refusing every shot that
      touched the product refused interpolation itself — the one technique that gives a
      product film movement on the product — and left b-roll as the only thing a board
      could buy. That is exactly how this repository ended up commissioning molten metal.
    */
    assert.equal(refuseGenerated(move({ subject: "the panoma project catalog" })), null);
  });

  test("but its PROMPT may still not describe the interface, because that is what makes a model redraw one", () => {
    const why = refuseGenerated(move({ gen: { mode: "interpolate", motion: "push in on the sidebar", seconds: 8, inPoint: 0 } }));
    assert.match(String(why), /CAMERA and nothing else/);
  });

  test("a captured shot and a card are never refused: nothing is being asked of anyone", () => {
    assert.equal(refuseGenerated(move({ origin: "captured" })), null);
    assert.equal(refuseGenerated(move({ origin: "card" })), null);
  });
});

describe("how a shot becomes a request", () => {
  test("a conditioned prompt is camera language and carries no description of the frame", () => {
    const p = promptOf(move(), bible);
    assert.match(p, /camera pushes slowly in/i);
    assert.match(p, /Begin exactly on the first image and end exactly on the last image/);
    /*
      The conditioning image IS the content. A sentence describing that content is a second
      source of truth arguing with a photograph, and the model settles the argument by
      drawing — so none of the board's own scene language may reach a conditioned prompt.
    */
    assert.doesNotMatch(p, /Open panoma|35mm|palette|Colour/i);
  });

  test("an unconditioned prompt carries everything, because there is nothing else to go on", () => {
    const p = promptOf(dreamt(), bible);
    assert.match(p, /keycap/);
    assert.match(p, /35mm/);
    assert.match(p, /Colour palette/);
  });

  test("no negative prompt anywhere names type", () => {
    /*
      A negative prompt saying "no text" is still a prompt saying "text", which is the
      documented way to make one of these models draw some. This list carried "text on
      screen", "readable text" and "subtitles" for a year. Words stay out of generated
      frames by never asking for a frame with words in it.
    */
    for (const shot of [move(), dreamt()]) {
      assert.doesNotMatch(negativeOf(shot, bible), /\btext\b|subtitle|caption|letter|word/i);
    }
    assert.ok(!NEVER_GENERATED.some((w) => /text|subtitle|caption/i.test(w)), "the never-list itself may not name type");
  });

  test("a conditioned shot is never told to avoid an interface it is being shown", () => {
    assert.doesNotMatch(negativeOf(move(), bible), /interface|dashboard|screenshot|browser/i);
    assert.match(negativeOf(dreamt(), bible), /user interface/);
  });
});

describe("the two clocks", () => {
  test("a board bills for what it buys and runs for what it cuts", () => {
    const board = boardOf([move(), move({ n: 3 }), { ...move({ n: 4 }), origin: "captured", gen: undefined }]);
    /* Three seconds used per bought shot, eight seconds sold. Collapsing these loses the film. */
    assert.equal(billedSeconds(board), 16);
    assert.equal(commissioned(board).length, 2);
    assert.equal(secondsOf(board), 9);
  });

  test("attaching a frame narrows the duration grid, and the price follows it", () => {
    const veo = capabilityOf("veo");
    assert.deepEqual([...veo.seconds], [4, 6, 8]);
    assert.deepEqual([...veo.conditionedSeconds], [8]);
    const bytes = { bytes: Buffer.from("x"), mimeType: "image/png" };
    assert.deepEqual([...gridFor({ prompt: "", seconds: 4, aspect: "16:9" }, veo)], [4, 6, 8]);
    assert.deepEqual([...gridFor({ prompt: "", seconds: 4, aspect: "16:9", first: bytes }, veo)], [8]);
    /* Four seconds of board is four seconds unconditioned and eight the moment a frame is attached. */
    assert.equal(priceOf([4], veo).seconds, 4);
    assert.equal(priceOf([4], veo, { conditioned: true }).seconds, 8);
  });

  test("a model that cannot end on a frame is named, not quietly accepted", () => {
    const omni = capabilityOf("omni");
    const said = unhonoured(
      { prompt: "", seconds: 8, aspect: "16:9", first: { bytes: Buffer.from(""), mimeType: "image/png" }, last: { bytes: Buffer.from(""), mimeType: "image/png" } },
      omni,
    );
    assert.ok(said.some((s) => /only its opening is true/.test(s)), said.join(" | "));
  });

  test("a duration ties upward, because a short shot leaves a hole and a long one is trimmed", () => {
    assert.equal(nearestSeconds(5, [4, 6, 8]), 6);
    assert.equal(nearestSeconds(4.4, [4, 6, 8]), 4);
  });
});

describe("the panels", () => {
  test("a bought shot has two of them, and both are real frames", () => {
    const shot = move();
    assert.equal(shot.panels.length, 2);
    assert.deepEqual(shot.panels.map((p) => p.at), ["first", "last"]);
    for (const p of shot.panels) assert.equal(p.still?.made.by, "capture");
  });

  test("the camera move is arithmetic over where the product's own control was", () => {
    /* A control that stayed put gets a push; one that crossed the frame gets a whip. */
    assert.equal(moveBetween({ x: 0.5, y: 0.5, facing: "camera" }, { x: 0.52, y: 0.5, facing: "camera" }), "push-in");
    assert.equal(moveBetween({ x: 0.1, y: 0.5, facing: "right" }, { x: 0.9, y: 0.5, facing: "left" }), "whip-pan");
    assert.equal(moveBetween({ x: 0.2, y: 0.5, facing: "right" }, { x: 0.5, y: 0.52, facing: "left" }), "dolly");
    assert.equal(moveBetween({ x: 0.5, y: 0.2, facing: "camera" }, { x: 0.5, y: 0.8, facing: "camera" }), "tilt");
  });

  test("the board reads as a board, with both clocks on it", () => {
    const text = boardText(boardOf([move()]));
    assert.match(text, /panels: 2A → 2B/);
    assert.match(text, /interpolate: buys 8s/);
    assert.match(text, /camera: a slow, steady push straight in/);
  });
});

describe("the guarantees, read as source", () => {
  test("a bought shot is cut from the clip's head, and the board never decides that alone", async () => {
    /*
      The measured decision, and it reversed the one written before anything was shot. End-
      aligning looked right — a shot landing on the real frame is a match cut onto a
      photograph — and the first measurement said the honest head runs about a second and the
      honest tail about a third of one. So the board starts at zero and, more importantly,
      treats that as provisional: `shootBoard` measures the clip that arrives and rewrites
      both the in-point and the hold from the file.
    */
    const board = await readFile(new URL("../packages/director/src/board.ts", import.meta.url), "utf8");
    assert.match(board, /inPoint: 0,/);
    assert.doesNotMatch(board, /inPoint: sec\(BUY_SECONDS - HOLD\.move\)/, "end-aligning was measured and reversed");
    const shoot = await readFile(new URL("../packages/director/src/shoot.ts", import.meta.url), "utf8");
    assert.match(shoot, /gen\.inPoint = Math\.round\(drift\.best\.from \* boardFps\)/);
    assert.ok(BUY_SECONDS > HOLD.move, "a shot must be bought longer than it is cut");
  });

  test("nothing in the board asks a video model for a plate to sit the product on", async () => {
    /*
      The reversed decision. A generated room behind a pasted screenshot is two layers with
      two light sources and two cameras, and it reads as a sticker on wallpaper however good
      the room is. It was built, shipped, and rejected on sight.
    */
    for (const f of ["../packages/gen/src/storyboard.ts", "../packages/director/src/board.ts", "../apps/render/src/recipes/Storyboard.tsx"]) {
      const src = await readFile(new URL(f, import.meta.url), "utf8");
      assert.doesNotMatch(src, /^\s*plate[?]?:/m, `${f} still has a plate field`);
    }
  });
});
