/*
  The direction: the product's own film, expressed as numbers.

  `brandTheme` answers "what colours may a recipe use", and it answers it all at once:
  one `low` confidence among primary, background or text and every surface falls back to
  the engine's own palette (index.ts:106-118). That cliff is why two products whose measured
  background is HIGH confidence still shared a black stage and a gold accent. A direction
  trusts PER SWATCH, and it carries more than colour — the rhythm, the furniture, the bed
  and the film's own scheme — because those are the other places where every product's
  film came out the same.

  Three rules this module is built on:

  - **The stage is the product's ground, moved just far enough that the product reads on
    it.** Setting the stage to the page's exact background is the naive reading of "the
    same colour as the app's theme", and it deletes the edge of the recording: the window
    chrome sits 5% off the stage and its ring 12%, so both vanish, and the take has no
    border. So the stage is offset away from the page until the two clear
    `STAGE_SEPARATION`, and `why` records the offset that was needed.
  - **A direction may change motion, furniture and sound. It may never change a colour.**
    Colours always come from the product; the named rows below carry no hex at all.
  - **Arithmetic proposes, judgement disposes.** The derivation consults no model, so
    `--brain=none` gets the same film. The inputs are `brand.json`, the profile's kind and
    the shape of the tour. A brain may then hand `deriveDirection` a `DirectionChoice` —
    the row, the bed's style and key, the tempo — and every
    field of it is one of the closed candidates below; the colours are computed before the
    choice is read and are not in it, so the rule above holds with a brain as without.

  This file is a PURE subpath of @panoma/video-brand (`@panoma/video-brand/direction`): it imports only
  colour arithmetic, the font table and the types, never `live.ts` and never playwright,
  because `apps/render` consumes it per frame. The package index drags Chromium in.
*/
import { LIGHT_PALETTE as HOUSE } from "@panoma/video-core/theme";
import { mix, oklabChroma, toHex, hexToRgb } from "./color.ts";
import { bestOn, contrastRatio, isDark } from "./contrast.ts";
import { stackFor } from "./fonts.ts";
import type { BrandProfile, Swatch } from "./types.ts";

/** Part of every cache key that depends on the look. Bump when a rule below changes. */
export const DIRECTION_VERSION = 2;

/**
 * The least contrast between the stage and the page drawn on it. Ours, not a standard:
 * it is the smallest separation at which ProductWindow's chrome bar (5% off the stage)
 * and its inset ring (12%) are still visible in the frames measured on this disk.
 */
export const STAGE_SEPARATION = 1.25;

/** How far the stage may travel from the product's own ground before it stops being it. */
export const STAGE_MAX_SHIFT = 0.14;

export type Signal = "chromatic" | "mono";
export type DirectionName = "editorial" | "kinetic" | "plain";

/** A colour with the reason it has that value — the same discipline as a `Swatch`. */
export type Surface = { hex: string; from: "measured" | "derived" | "default"; why: string };

/*
  The same four names as `BedStyle` in @panoma/video-audio. Declared here rather than imported so
  this module stays free of that package; the assignment in `compositions.tsx` typechecks
  structurally, so a drift between the two unions fails the build there.
*/
export type BedStyleName = "calm" | "pulse" | "dark" | "bright";

export type ShotEnterName = "cut" | "flash" | "whip";

/**
 * Optional musical motion. The default is `off`: the camera follows the action, while
 * cuts still land on beats. A caller may explicitly request `light` or `full` in a brief;
 * neither a product's row nor a brain may opt the viewer into it.
 */
export type Dance = "off" | "light" | "full";

export const DANCES = ["off", "light", "full"] as const;

/**
 * What a brain may decide about a direction, and nothing else. Every field is one of
 * the closed sets this module exports; a caller clamps before it calls, and a field left
 * out keeps the arithmetic value. There is no colour here on purpose.
 */
export type DirectionChoice = {
  name?: DirectionName;
  style?: BedStyleName;
  key?: KeyName;
  bpm?: Tempo;
  /** Kept for callers constructing a direction; the brain boundary permits only `off`. */
  dance?: Dance;
};

export type Direction = {
  version: number;
  name: DirectionName;
  /** The FILM's scheme, derived from its stage — not `brand.scheme.default`, which is the product's. */
  scheme: "light" | "dark";
  signal: Signal;
  stage: Surface;
  /** The product's background verbatim: what the recording itself paints. */
  page: string;
  plate: Surface;
  scrim: { hex: string; alpha: number };
  ink: Surface;
  muted: Surface;
  faint: Surface;
  line: Surface;
  accent: Surface;
  onAccent: Surface;
  inverted: { stage: string; ink: string; muted: string };
  fonts: { display: string; body: string; mono: string; detected: { heading?: string; body?: string; mono?: string } };
  motion: { push: [number, number]; drift: number; enters: ShotEnterName[] };
  furniture: { caption: "plate" | "chip"; glow: boolean; rule: boolean; window: "chrome" | "bare" };
  sound: { style: BedStyleName; key: string; bpm: number };
  dance: Dance;
  /** Who decided the row and the bed: the arithmetic below, or a brain through a `DirectionChoice`. */
  by: "arithmetic" | "brain";
  contrast: { pair: string; ratio: number; aa: boolean }[];
  branded: { stage: boolean; accent: boolean; ink: boolean };
  /** Seeded from the product's NAME, never from its path. */
  seed: number;
};

/** What the tour and the profile say about the product, beyond its colours. */
export type Shape = {
  kind?: string;
  /** Marks the walker left. */
  marks?: number;
  /** Marks whose use actually changed the interface. A product with none shows; it does not do. */
  flows?: number;
};

/* ---------- The engine's own ratios, applied to the product's own endpoints ---------- */

const RATIO = { muted: 0.2, faint: 0.33, line: 0.88, plate: 0.06 } as const;

/*
  A beat must be a whole number of frames, so at 30 fps a legal tempo divides 1800.
  These three are the divisors in the range short-form music lives in; `makeGrid` throws
  on anything else, and that error is a feature.
*/
export const TEMPOS = [90, 100, 120] as const;
export type Tempo = (typeof TEMPOS)[number];

export const KEYS = ["A minor", "D minor", "E minor", "C major", "G major", "F major"] as const;
export type KeyName = (typeof KEYS)[number];

/* ---------- the named rows: rhythm and furniture, never colour ---------- */

type Row = {
  push: [number, number];
  drift: number;
  enters: ShotEnterName[];
  furniture: Direction["furniture"];
};

export const ROWS: Record<DirectionName, Row> = {
  /* A product that shows itself: the camera moves little, the cuts are cuts, rules not glows. */
  editorial: { push: [1.24, 1.5], drift: 0.012, enters: ["cut", "whip"], furniture: { caption: "plate", glow: false, rule: true, window: "chrome" } },
  /* A product that does something: the camera pushes, the edit flashes, the accent lights it. */
  kinetic: { push: [1.4, 1.75], drift: 0.018, enters: ["flash", "whip", "cut"], furniture: { caption: "plate", glow: true, rule: false, window: "chrome" } },
  /* What a product panoma video could not measure gets: nothing that needs a colour to be right. */
  plain: { push: [1.28, 1.45], drift: 0.01, enters: ["cut"], furniture: { caption: "plate", glow: false, rule: false, window: "bare" } },
};

/**
 * Every row follows the product's actions by default. Music is accompaniment; a kinetic
 * row earns its motion from what the product does, not from each kick in a track.
 */
export const DANCE_OF_ROW: Record<DirectionName, Dance> = { editorial: "off", kinetic: "off", plain: "off" };

/* ---------- the seed: the product's identity, never its location on a disk ---------- */

/** djb2, as a 32-bit unsigned integer. Stable across machines and runs. */
export function hash32(text: string): number {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/** mulberry32 (Tommy Ettinger, public domain): a small, fast, well-distributed PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The seed of one piece. The product's name and the brief's id — NOT the workspace id,
 * which is `<folder>-<8 hex of realpath>`: seeding from that changes the film when the
 * checkout moves, and gives two people filming one repository two different films.
 */
export function pieceSeed(productName: string, briefId: string): number {
  return hash32(`${productName}\0${briefId}\0${DIRECTION_VERSION}`);
}

function pickFrom<T>(next: () => number, items: readonly T[]): T {
  return items[Math.floor(next() * items.length) % items.length]!;
}

/** A deterministic permutation (Fisher-Yates on a seeded stream). */
export function shuffle<T>(next: () => number, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/* ---------- the stage: the product's ground, offset until the product reads on it ---------- */

/**
 * Push `page` away from itself — toward white when it is dark, toward black when it is
 * light — in 1% steps, until the two clear `STAGE_SEPARATION` or the shift reaches
 * `STAGE_MAX_SHIFT`. Returns the hex and the shift that was used.
 */
export function stageFor(page: string): { hex: string; shift: number } {
  const toward = isDark(page) ? "#ffffff" : "#000000";
  let last = page;
  for (let t = 0.01; t <= STAGE_MAX_SHIFT + 1e-9; t += 0.01) {
    last = mix(page, toward, t);
    if (contrastRatio(last, page) >= STAGE_SEPARATION) return { hex: last, shift: Math.round(t * 100) / 100 };
  }
  return { hex: last, shift: STAGE_MAX_SHIFT };
}

/* ---------- the derivation ---------- */

const ok = (s: Swatch | undefined): boolean => s !== undefined && s.confidence !== "low";

function surface(hex: string, from: Surface["from"], why: string): Surface {
  return { hex, from, why };
}

function nameFor(dark: boolean, signal: Signal, branded: boolean, shape: Shape): DirectionName {
  /* Nothing measured: the row that needs no colour to be right. */
  if (!branded) return "plain";
  /*
    A tour that changed nothing is a product showing itself, whatever colour it is: the
    camera has no press to punch into, so pushes and flashes would be decoration. This is
    the one place the direction reads the tour rather than the palette, and it is why two
    products with the same brand can still get different films.
  */
  if ((shape.flows ?? 0) === 0) return "editorial";
  return dark && signal === "chromatic" ? "kinetic" : "editorial";
}

export function deriveDirection(profile: BrandProfile, shape: Shape = {}, choice?: DirectionChoice): Direction {
  const c = profile.colors;
  const seed = hash32(`${profile.name}\0${DIRECTION_VERSION}`);
  const next = rng(seed);

  const pageKnown = ok(c.background);
  const page = pageKnown ? c.background.hex : HOUSE.paper;
  const st = stageFor(page);
  const stage = pageKnown
    ? surface(st.hex, "derived", `the product's own ground ${page}, ${Math.round(st.shift * 100)}% toward ${isDark(page) ? "white" : "black"} so the recording reads on it`)
    : surface(HOUSE.paper, "default", `the background was ${c.background?.confidence ?? "missing"}, so the film keeps panoma video's paper`);
  const dark = isDark(stage.hex);

  const inkMeasured = ok(c.text);
  const inkKnown = inkMeasured && (pageKnown || contrastRatio(c.text.hex, stage.hex) >= 4.5);
  const houseGround = !pageKnown && !inkKnown;
  const ink = inkKnown
    ? surface(c.text.hex, "measured", `the ink the page sets its text in (${c.text.origin})`)
    : pageKnown
      ? surface(bestOn(stage.hex), "derived", "no measured text colour: the better of white and black on the stage")
      : surface(HOUSE.ink, "default", inkMeasured
        ? `the measured ink ${c.text.hex} is below 4.5:1 contrast on the unmeasured ground: Panoma's light theme pair is used for rendering`
        : "no measured ground or text colour: Panoma's light theme ink");

  const chroma = ok(c.primary) ? oklabChroma(c.primary.hex) : 0;
  /* Near-neutral is dembrandt's threshold, restated: a grey brand gets no accent at all. */
  const signal: Signal = ok(c.primary) && chroma >= 0.05 ? "chromatic" : "mono";
  const accent =
    signal === "chromatic"
      ? surface(c.primary.hex, "measured", `the product's primary (${c.primary.origin}), OKLab chroma ${chroma.toFixed(3)}`)
      : houseGround && !ok(c.primary)
        ? surface(HOUSE.accent, "default", "no trusted primary or ground: Panoma's light theme accent")
        : surface(ink.hex, "derived", ok(c.primary) ? `the primary ${c.primary.hex} is near-neutral (chroma ${chroma.toFixed(3)}): a monochrome brand accents in its own ink` : "no trusted primary: a monochrome film rather than a colour nobody chose");

  const onAccent = ok(c.onPrimary)
    ? surface(c.onPrimary.hex, "measured", `the product's own foreground on its primary (${c.onPrimary.origin})`)
    : accent.from === "default"
      ? surface(HOUSE.onAccent, "default", "Panoma's light theme foreground on its accent")
      : surface(bestOn(accent.hex), "derived", "the better of white and black on the accent, by WCAG 2");

  const plate = ok(c.surface)
    ? surface(c.surface.hex, "measured", `the product's own surface (${c.surface.origin})`)
    : houseGround
      ? surface(HOUSE.card, "default", "Panoma's light theme surface")
      : surface(mix(stage.hex, ink.hex, RATIO.plate), "derived", `${RATIO.plate * 100}% of the way from the stage to the ink`);

  const muted = ok(c.muted)
    ? surface(c.muted.hex, "measured", `the product's own muted ink (${c.muted.origin})`)
    : houseGround
      ? surface(HOUSE.muted, "default", "Panoma's light theme muted ink")
      : surface(mix(ink.hex, stage.hex, RATIO.muted), "derived", `${RATIO.muted * 100}% of the way from the ink to the stage`);
  const faint = houseGround
    ? surface(HOUSE.faint, "default", "Panoma's light theme faint ink")
    : surface(mix(ink.hex, stage.hex, RATIO.faint), "derived", `${RATIO.faint * 100}% of the way from the ink to the stage`);
  const line = houseGround
    ? surface(HOUSE.line, "default", "Panoma's light theme rule")
    : surface(mix(ink.hex, stage.hex, RATIO.line), "derived", `${RATIO.line * 100}% of the way from the ink to the stage`);

  const proposedName = nameFor(dark, signal, pageKnown && inkKnown, shape);

  /*
    The seeded picks. Every one of them is a rhythm or a furniture choice inside the row's
    own range: a direction may not move a colour, and a seed may not leave the range the
    clock tests pin. They are drawn from the stream in this order, for the ARITHMETIC row,
    before any choice is read: a brain that changes the row must not move the tempo or the
    key it did not choose, and the proposal a brain was shown must be the one it declines.
  */
  const proposedEnters = ROWS[proposedName].enters.length > 1 ? shuffle(next, ROWS[proposedName].enters) : ROWS[proposedName].enters.slice();
  const proposedBpm = pickFrom(next, TEMPOS);
  const proposedKey = pickFrom(next, KEYS);
  const proposedStyle: BedStyleName = profile.tone.register === "playful" ? (dark ? "pulse" : "bright") : dark ? "dark" : "calm";

  /* The choice, when there is one, replaces rhythm, furniture and sound. Nothing above this line reads it. */
  const name = choice?.name ?? proposedName;
  const row = ROWS[name];
  /* A chosen row is a different set of enters: permuted from a fresh stream of the same seed, so the film stays a function of its inputs. */
  const enters = name === proposedName ? proposedEnters : row.enters.length > 1 ? shuffle(rng(seed), row.enters) : row.enters.slice();
  const push: [number, number] = [row.push[0], row.push[1]];
  const bpm = choice?.bpm ?? proposedBpm;
  const key = choice?.key ?? proposedKey;
  const style = choice?.style ?? proposedStyle;
  const dance = choice?.dance ?? DANCE_OF_ROW[name];

  const pair = (label: string, a: string, b: string) => {
    const ratio = Math.round(contrastRatio(a, b) * 100) / 100;
    return { pair: label, ratio, aa: ratio >= 4.5 };
  };

  return {
    version: DIRECTION_VERSION,
    name,
    scheme: dark ? "dark" : "light",
    signal,
    stage,
    page,
    plate,
    scrim: { hex: stage.hex, alpha: 0.62 },
    ink,
    muted,
    faint,
    line,
    accent,
    onAccent,
    inverted: houseGround
      ? { stage: HOUSE.inverted.paper, ink: HOUSE.inverted.ink, muted: HOUSE.inverted.muted }
      : { stage: ink.hex, ink: stage.hex, muted: mix(stage.hex, ink.hex, isDark(ink.hex) ? 0.2 : 0.25) },
    fonts: {
      display: stackFor(profile.type.heading.family),
      body: stackFor(profile.type.body.family),
      mono: stackFor(profile.type.mono.family),
      detected: {
        ...(profile.type.heading.detected ? { heading: profile.type.heading.detected } : {}),
        ...(profile.type.body.detected ? { body: profile.type.body.detected } : {}),
        ...(profile.type.mono.detected ? { mono: profile.type.mono.detected } : {}),
      },
    },
    motion: { push, drift: row.drift, enters },
    furniture: row.furniture,
    sound: { style, key, bpm },
    dance,
    by: choice ? "brain" : "arithmetic",
    contrast: [
      pair("ink/stage", ink.hex, stage.hex),
      pair("ink/plate", ink.hex, plate.hex),
      pair("accent/stage", accent.hex, stage.hex),
      pair("onAccent/accent", onAccent.hex, accent.hex),
      pair("muted/stage", muted.hex, stage.hex),
      pair("stage/page", stage.hex, page),
    ],
    branded: { stage: pageKnown, accent: signal === "chromatic", ink: inkKnown },
    seed,
  };
}

/**
 * The scheme the FILM is shot in, which is not the scheme the product declares.
 *
 * `brand.scheme.default` is what the page says about itself. What the walker must be told
 * — and what the recorder paints behind the page, and what the record cache is keyed on —
 * is the scheme of the STAGE the film puts that page on, and the stage is derived. They
 * agree on every product measured on this disk, which is exactly why the four call sites
 * had to be changed together: the day they disagree, changing the recorder without the
 * key pins a workspace to takes shot in the wrong scheme, for ever and silently.
 *
 * It reads no shape, because the stage does not: `deriveDirection` decides the scheme
 * from the product's background alone, and the tour only ever chooses the row.
 */
export function filmSchemeOf(profile: BrandProfile): "light" | "dark" {
  return deriveDirection(profile).scheme;
}

/** The repository's own briefs use Panoma's light palette with their existing motion. */
export const DEFAULT_DIRECTION: Direction = {
  version: DIRECTION_VERSION,
  name: "kinetic",
  scheme: "light",
  signal: "mono",
  stage: { hex: HOUSE.paper, from: "default", why: "panoma video's own paper" },
  page: HOUSE.paper,
  plate: { hex: HOUSE.card, from: "default", why: "panoma video's own card" },
  scrim: { hex: HOUSE.paper, alpha: 0.66 },
  ink: { hex: HOUSE.ink, from: "default", why: "panoma video's own ink" },
  muted: { hex: HOUSE.muted, from: "default", why: "panoma video's own muted" },
  faint: { hex: HOUSE.faint, from: "default", why: "panoma video's own faint" },
  line: { hex: HOUSE.line, from: "default", why: "panoma video's own rule" },
  accent: { hex: HOUSE.accent, from: "default", why: "Panoma's light theme accent" },
  onAccent: { hex: HOUSE.onAccent, from: "default", why: "Panoma's light theme foreground on its accent" },
  inverted: { stage: HOUSE.inverted.paper, ink: HOUSE.inverted.ink, muted: HOUSE.inverted.muted },
  fonts: { display: stackFor("Geist"), body: stackFor("Geist"), mono: stackFor("Geist Mono"), detected: {} },
  motion: { push: ROWS.kinetic.push, drift: ROWS.kinetic.drift, enters: ["flash", "whip"] },
  furniture: ROWS.kinetic.furniture,
  sound: { style: "calm", key: "A minor", bpm: 120 },
  dance: "off",
  by: "arithmetic",
  contrast: [],
  branded: { stage: false, accent: false, ink: false },
  seed: 0,
};

/** Refresh saved house colours while retaining the film's authored rhythm and sound. */
export function withHouseTheme(direction: Direction): Direction {
  const roles = ["stage", "plate", "ink", "muted", "faint", "line", "accent", "onAccent"] as const;
  const swatches = roles.map((role) => direction[role]);
  if (Object.values(direction.branded).some(Boolean) || swatches.some((swatch) => swatch.from === "measured")) return direction;
  const house = DEFAULT_DIRECTION;
  if (direction.scheme === house.scheme && direction.signal === house.signal && direction.page === house.page &&
    direction.scrim.hex === house.scrim.hex && roles.every((role) => direction[role].hex === house[role].hex) &&
    direction.inverted.stage === house.inverted.stage && direction.inverted.ink === house.inverted.ink && direction.inverted.muted === house.inverted.muted) return direction;
  return {
    ...direction,
    scheme: house.scheme,
    signal: house.signal,
    stage: house.stage,
    page: house.page,
    plate: house.plate,
    scrim: { ...direction.scrim, hex: house.scrim.hex },
    ink: house.ink,
    muted: house.muted,
    faint: house.faint,
    line: house.line,
    accent: house.accent,
    onAccent: house.onAccent,
    inverted: house.inverted,
    contrast: house.contrast,
  };
}

/** The colour a scene draws its ink at, with an alpha — the direction's `inkAlpha`. */
export function alphaOf(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex) ?? hexToRgb(HOUSE.ink)!;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/** For a caller that only wants the hex of a mix: kept here so recipes never import color.ts. */
export { mix, oklabChroma, toHex };
