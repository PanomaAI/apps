/*
  Elements: the one thing a video model sells that a product film should buy.

  Three attempts got this wrong before it got interesting, and the shape of the mistake was
  the same every time — the generated picture and the recorded one never shared a frame.
  B-roll of a foundry sat BESIDE the product. A generated room sat BEHIND it, which is two
  layers with two light sources and reads as a sticker on wallpaper. An interpolated push
  sat ON it, redrawing the interface: measured at about one usable second per eight billed,
  and worse than the camera this repository already has.

  The fourth position is the one that works: IN FRONT of the product, in the same frame, at
  the same instant, without touching it.

  A model is asked for matter on a flat ground and nothing else — glass bursting, sparks,
  ink, smoke. That is composited with a blend that makes the ground disappear: `screen`
  drops black and adds light, `multiply` drops white and darkens. Neither replaces a pixel
  of the interface; both leave it entirely readable underneath, which is the whole point.

  THE RULE THAT DECIDES WHICH: the element's ground must be the OPPOSITE of the film's
  stage. Screen-blending a black element over a near-white interface does nothing at all —
  screen of white with anything is white — and it was measured doing exactly nothing on
  panoma before this rule existed. The film already knows its own scheme, so this is
  derived and never chosen.

  | the app is | the element is on | blended | what happens |
  |---|---|---|---|
  | dark | black | screen | the black vanishes, the light adds |
  | light | white | multiply | the white vanishes, the matter darkens |

  And the economics is why this is worth buying where interpolation was not. An element is
  TEXT-to-video, so it escapes the eight seconds a conditioning frame forces — four seconds,
  forty cents. And it is independent of any product: a shattering is a shattering. So the
  library is bought once and every film afterwards costs nothing.
*/

/** The flat field the matter is generated against, and which vanishes when it is composited. */
export type Ground = "black" | "white";

/** How a ground is made to disappear. There is no third option that leaves the page untouched. */
export type Blend = "screen" | "multiply";

export type Element = {
  /** Stable and human: it is the file name, the cache key and what a report calls it. */
  id: string;
  /** The matter itself, as a phrase: "a pane of glass", "a spray of sparks". */
  subject: string;
  /** What it does, and it has to be an event with mass rather than a mood. */
  action: string;
  ground: Ground;
  /** Seconds. Four is the shortest thing that reads as an event and the cheapest Veo sells. */
  seconds: number;
  /** What this is FOR in a cut. Prose for a person reading the library. */
  why: string;
};

/**
 * The ground an element needs for a film, which is the opposite of that film's stage.
 *
 * Derived rather than chosen, because getting it wrong is not a matter of degree: the
 * element is either visible or it is completely absent, and absent is what it was on the
 * first composite attempted here.
 */
export const groundFor = (scheme: "light" | "dark"): Ground => (scheme === "dark" ? "black" : "white");

export const blendFor = (ground: Ground): Blend => (ground === "black" ? "screen" : "multiply");

/*
  Everything that keeps a set out of the frame.

  An element is matter, not a scene. The moment a model puts a floor under it, or a haze
  behind it, the ground stops being flat — and a ground that is not flat does not vanish when
  it is blended: it lifts or muddies the entire interface underneath by however far off it
  is. This is the negative prompt, and `groundOf` in @panoma/video-review is the half that checks.
*/
const SET = ["floor", "wall", "room", "table", "horizon", "studio backdrop", "fog", "haze", "smoke haze", "vignette", "depth of field blur", "bokeh"];

/**
 * How an element becomes a sentence.
 *
 * The ground is stated three ways on purpose — as the background, as what surrounds the
 * subject, and as what is absent. These models treat a single mention of a background as a
 * suggestion and reliably answer it with a dim studio, which is a set. Saying it three
 * times is the difference between a ground that vanishes and one that greys the product.
 */
export function elementPrompt(el: Element): string {
  const field = el.ground === "black" ? "pure black" : "pure white";
  const lit =
    el.ground === "black"
      ? "Hard rim light from the left catches the edges; everything it does not touch falls to absolute black."
      : "Flat bright light from every side; the matter reads as dark shapes and there are no shadows on the field.";
  return [
    `Extreme macro, high speed: ${el.subject} ${el.action}.`,
    `The ${el.subject.replace(/^an? /, "")} is the only thing in frame.`,
    `Isolated on a ${field} background. The field around it is completely flat and uniform ${el.ground}, edge to edge.`,
    lit,
    `No set, no floor, no wall, no horizon, no atmosphere.`,
  ].join(" ");
}

/** What must never appear, as nouns: the set that would stop the ground being flat. */
export const elementNegative = (el: Element): string =>
  [...SET, el.ground === "black" ? "grey background, white background" : "grey background, black background", "people", "hands", "logo"].join(", ");

/*
  The starting library, and the reason there are so few.

  Every one of these is a physical event a screen recording cannot contain and this
  repository's renderer cannot fake: matter moving fast enough to smear, at a distance a
  camera could not hold. Nothing here is atmosphere, because atmosphere is what a model
  gives you when it is asked for energy and given nothing specific, and it is also what the
  rejected b-roll was.

  They are deliberately generic. An element that referred to a product would have to be
  bought again for the next one, and the entire case for this over interpolation is that it
  is bought once.
*/
export const LIBRARY: readonly Omit<Element, "ground">[] = [
  { id: "glass-burst", subject: "a pane of glass", action: "shatters and the fragments burst outward toward camera, tumbling", seconds: 4, why: "the press: something gave way, and it gave way where the pointer was" },
  { id: "spark-spray", subject: "a spray of sparks", action: "erupts sideways in a hard arc and dies out in the air", seconds: 4, why: "a cut with energy in it, six frames of it, over the transition the engine already made" },
  { id: "ink-bloom", subject: "a drop of ink", action: "hits water and blooms outward in slow curling threads", seconds: 4, why: "the close: something spreading, under the address" },
  { id: "dust-burst", subject: "a cloud of fine dust", action: "is punched outward by an impact and hangs, turning", seconds: 4, why: "weight without violence, for a film whose product is calm" },
];

/** Every element's file name, so a library on disk can be listed without opening it. */
export const elementFile = (id: string, ground: Ground): string => `${id}-${ground}.mp4`;
