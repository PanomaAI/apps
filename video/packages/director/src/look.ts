/*
  The one place a `Direction` is made, so the two callers that build a matrix cannot
  disagree about what a product's film looks like.

  That failure has already happened once with the brand: `panoma-video auto` and
  `panoma-video render --project` each assembled the theme themselves, one of them forgot,
  and a product's film was rendered in the engine's own gold over the branded file of the
  same name (the comment at apps/cli/src/panoma-video.ts:71 is the scar). `renderBrand`
  fixed it for the spotlight; `directionOf` is the same fix for everything else.

  The shape it reads from the tour is deliberately small — how many marks there are and
  how many of them actually changed the interface — because that is the difference a
  viewer can see between two products with the same palette: one is a page that shows
  itself, the other is a product doing something.

  `directionFor` is the same derivation with a brain in front of it. Arithmetic proposes
  (`directionOf`), the brain is asked ONE question about the proposal, and its answer is
  clamped to the candidate sets before `deriveDirection` applies it — so the colours never
  move, an answer outside the sets falls back to the proposal field by field, and a brain
  that does not answer at all leaves the arithmetic direction exactly as it was.
*/
import { KEYS, ROWS, TEMPOS, deriveDirection, type BedStyleName, type Dance, type Direction, type DirectionChoice, type DirectionName, type KeyName, type Tempo } from "@panoma/video-brand/direction";
import type { BrandProfile } from "@panoma/video-brand";
import type { TourScript } from "@panoma/video-tour";
import { directQuestion, type Brain, type Thesis } from "@panoma/video-brain";
import { writeJson, type Workspace } from "./workspace.ts";

/**
 * A mark counts as a flow when its use changed the interface. A section scroll never
 * does — the walker refuses a click that changes nothing, and a scroll to a heading
 * proves the page has a heading (packages/core/src/story.ts).
 *
 * The kind is the whole test, and it used to also require an OUTCOME: a heading or a
 * route the walker could name. Those are two different questions. "Did the interface
 * change" is what the walker already answered by keeping the mark at all; "could the
 * change be given a name" is about the product's copy. universend's two controls mute a
 * sound and open notifications — both change the interface, neither produces a heading —
 * so it counted zero flows and was filmed as a page that shows itself rather than a
 * product that does something. A product must not change its camera because its buttons
 * are named badly, and `resolveGoals` has always counted the same marks by state change
 * alone (story.ts): this now agrees with it.
 */
export function flowsOf(tour: TourScript | null | undefined): number {
  if (!tour) return 0;
  return tour.marks.filter((m) => m.kind === "cta" || m.kind === "flow").length;
}

export function directionOf(brand: BrandProfile, tour?: TourScript | null): Direction {
  return deriveDirection(brand, { marks: tour?.marks.length ?? 0, flows: flowsOf(tour) });
}

/** The creative choices and the fixed musical-motion policy, as the record keeps them. */
export type DirectionPick = { name: DirectionName; style: BedStyleName; key: string; bpm: number; dance: Dance };

/** `direction.json`: the direction the film was made with, and how it was arrived at. */
export type DirectionFile = {
  direction: Direction;
  by: Direction["by"];
  /** The brain's reason, or the arithmetic's. Prose for a person; never read by a frame. */
  why: string;
  proposed: DirectionPick;
  chosen: DirectionPick;
  /** Fields the answer put outside the candidates, and what they fell back to. */
  clamped: string[];
};

const pickOf = (d: Direction): DirectionPick => ({ name: d.name, style: d.sound.style, key: d.sound.key, bpm: d.sound.bpm, dance: d.dance });

/*
  What each candidate means, in the words the question hands the brain. The styles are
  docs/music.md's own table — the fourth column is the difference a listener hears — and
  the rows are the comments on `ROWS`. Kept here rather than beside the constants so the
  pure subpath of @panoma/video-brand carries no prose.
*/
const NAME_MEANS: Record<DirectionName, string> = {
  editorial: "a product that shows itself: the camera moves little, the cuts are cuts, rules not glows",
  kinetic: "a product that does something: the camera pushes, the edit flashes, the accent lights it",
  plain: "nothing measured, or nothing to prove: no glow, no whip, a bare window, plate captions",
};
const STYLE_MEANS: Record<BedStyleName, string> = {
  calm: "I–vi–IV–V, hats on the off-ticks only, a one-beat pad attack: under a voice, the default",
  pulse: "I–vi–IV–V, a hat on every tick, bass pickups: a trailer without words",
  dark: "i–VI–III–VII in a minor key, hats capped at 7 kHz, a saw in the bass: a perspective-dark product film",
  bright: "I–vi–IV–V, the loudest hats, an octave pair in the pad: a floating-light one",
};

const inSet = <T extends string | number>(set: readonly T[], v: unknown): v is T => (set as readonly unknown[]).includes(v);

/**
 * Clamp an answer to the candidates, field by field: what is in the set is taken, what is
 * not falls back to the proposal and is named. A model that writes "jazz" for a style has
 * not chosen a style, and the film must not guess what it meant.
 */
export function clampChoice(answer: { row: string; style: string; key: string; bpm: number; dance: string }, proposed: DirectionPick): { choice: Required<DirectionChoice>; clamped: string[] } {
  const clamped: string[] = [];
  const names = Object.keys(ROWS) as DirectionName[];
  const styles: readonly BedStyleName[] = ["calm", "pulse", "dark", "bright"];
  const take = <T extends string | number>(field: string, set: readonly T[], v: unknown, fallback: T): T => {
    if (inSet(set, v)) return v;
    clamped.push(`${field} ${JSON.stringify(v)} is not one of ${set.join(", ")}; kept ${JSON.stringify(fallback)}`);
    return fallback;
  };
  return {
    choice: {
      name: take("row", names, answer.row, proposed.name),
      style: take("style", styles, answer.style, proposed.style),
      key: take("key", KEYS, answer.key, proposed.key as KeyName),
      bpm: take("bpm", TEMPOS, answer.bpm, proposed.bpm as Tempo),
      /* A legacy or cached answer may still request pumping. Only the caller can enable it. */
      dance: take("dance", ["off"] as const, answer.dance, "off"),
    },
    clamped,
  };
}

export type DirectionForInput = {
  brain?: Brain | null;
  thesis?: Thesis;
  brand: BrandProfile;
  tour?: TourScript | null;
  /** The profile's kind, for the question only; the derivation does not read it. */
  kind?: string;
  /** A brought track, when there is one: the track wins the tempo downstream, so the question is told. */
  music?: { given: boolean; bpm?: number; seconds?: number };
  /** When given, `direction.json` is written here. */
  ws?: Workspace;
  /** When given, the choice and its reason are appended, as `direct: …`. */
  decisions?: string[];
};

/**
 * The direction of this product's film, with a brain's judgement over the arithmetic
 * when there is one.
 *
 * Without a brain — or when the brain declines, times out, or answers a shape that does
 * not fit — the result is `directionOf(brand, tour)`, unchanged: `--brain=none` yields
 * the film it always yielded. With one, the answer is clamped, applied through
 * `deriveDirection` so no colour can move, and recorded with its reason in
 * `direction.json` and in the decisions. The tempo it returns is always one of `TEMPOS`;
 * a brought track overrides `sound.bpm` later. Musical motion requires the caller's
 * explicit `dance` option and is never activated by this question.
 */
export async function directionFor(input: DirectionForInput): Promise<Direction> {
  const proposed = directionOf(input.brand, input.tour);
  const proposal = pickOf(proposed);
  const record = async (file: DirectionFile) => {
    if (input.ws) await writeJson(input.ws.paths.direction, file);
  };
  const stand = async (why: string) => {
    await record({ direction: proposed, by: "arithmetic", why, proposed: proposal, chosen: proposal, clamped: [] });
    return proposed;
  };
  if (!input.brain) return stand("no brain: the arithmetic proposal stands");
  const brain = input.brain;
  try {
    const answer = await brain.ask(
      directQuestion({
        ...(input.thesis ? { thesis: { what: input.thesis.what, angle: input.thesis.angle, audience: input.thesis.audience, tone: input.thesis.tone, verbs: input.thesis.verbs } } : {}),
        measured: {
          scheme: proposed.scheme,
          signal: proposed.signal,
          ...(input.brand.tone?.register ? { register: input.brand.tone.register } : {}),
          ...(input.kind ? { kind: input.kind } : {}),
          marks: input.tour?.marks.length ?? 0,
          flows: flowsOf(input.tour),
        },
        proposed: proposal,
        candidates: {
          names: (Object.keys(ROWS) as DirectionName[]).map((id) => ({ id, means: NAME_MEANS[id] })),
          styles: (Object.keys(STYLE_MEANS) as BedStyleName[]).map((id) => ({ id, means: STYLE_MEANS[id] })),
          keys: [...KEYS],
          tempos: [...TEMPOS],
          dances: [{ id: "off", means: "the camera follows the product's actions; only an explicit caller option can enable musical motion" }],
        },
        music: input.music ?? { given: false },
      }),
    );
    const { choice, clamped } = clampChoice(answer.value, proposal);
    const direction = deriveDirection(input.brand, { marks: input.tour?.marks.length ?? 0, flows: flowsOf(input.tour) }, choice);
    const chosen = pickOf(direction);
    const moved = (Object.keys(chosen) as (keyof DirectionPick)[]).filter((k) => chosen[k] !== proposal[k]);
    const why = answer.value.why.trim();
    input.decisions?.push(`direct: ${moved.length > 0 ? `${moved.map((k) => `${k} ${proposal[k]} → ${chosen[k]}`).join(", ")} — ` : "the proposal stands — "}${why}`);
    for (const c of clamped) input.decisions?.push(`direct: ${c}`);
    await record({ direction, by: "brain", why, proposed: proposal, chosen, clamped });
    return direction;
  } catch (e) {
    /* Declined, timed out, or a shape that did not fit twice: the film is the arithmetic film, and the record says so. */
    const why = `${brain.driver} did not answer (${(e as Error).message.split("\n")[0]}); the arithmetic direction stands`;
    input.decisions?.push(`direct: ${why}`);
    return stand(why);
  }
}
