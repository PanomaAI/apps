/*
  Every brief becomes a matrix of compositions: hooks x languages x formats. This
  list IS the production plan — `panoma-video list` prints it, `panoma-video render` files it, and an
  id that fails validation never existed. Ids read
  brief--hook--lang--format, e.g. `name-ten--count--en--v`.

  Two kinds of brief arrive here. The repository's own, typed in briefs/index.ts and
  read from media/; and the ones the director writes as JSON into a project's
  workspace under PANOMA_VIDEO_HOME, with its own takes, voice and music. The matrix is
  therefore a FACTORY over (briefs, dirs), and the module-level constants below are
  simply the factory applied to the repository — every existing caller keeps its
  import, and the automatic path calls the factory on a workspace.

  Scenes evaluate in Node, so this module may read disk: when `panoma-video assets` has
  generated voice for a brief, the mp3s become audio clips at their line's frame and
  the word timestamps replace the evenly-spaced caption fallback. No bundler would
  allow that; owning the renderer is what makes it a one-liner.

  Every composition also carries a RenderPlan — where its cuts are and of what kind,
  which spans hold on purpose, which are type — so the review can subtract what was
  intended before judging what was measured.
*/
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMATS, JOBS, makeGrid, type Brief, type Chapter, type Format, type FormatId, type Grid, type Line, type RenderPlan } from "@panoma/video-core";
import { manifestVouches, VOICE_MANIFEST, type VoiceManifest } from "@panoma/video-core/cache";
import { LIGHT_PALETTE } from "@panoma/video-core/theme";
import type { BedOptions } from "@panoma/video-audio";
import type { AudioClip, CompositionDef } from "@panoma/video-engine";
import { briefs as repoBriefs } from "@panoma/video-briefs";
import { promoRowArrivalFrames } from "./recipes/presentation.ts";
import type { Word } from "./lib/captions.tsx";
import { display, editorial, mono, wide } from "./lib/fonts.ts";
import { TAKE_DESKTOP, TAKE_MOBILE, type SessionLog } from "@panoma/video-capture";
import { deriveDirection, DEFAULT_DIRECTION, type Direction } from "@panoma/video-brand/direction";
import { ThemeProvider } from "./lib/theme-context.tsx";
import { KineticQuote } from "./recipes/KineticQuote.tsx";
import { bedPulse, loadPulse, pulseFor, type Pulse } from "./recipes/pulse.ts";
import { castSoundCues, promoSoundCues, spotlightSoundCues, trailerSoundCues, tutorialSoundCues, type SoundCue } from "./recipes/sound.ts";
import { Tutorial } from "./recipes/Tutorial.tsx";
import { ScreenCast } from "./recipes/ScreenCast.tsx";
import { ReleaseTrailer } from "./recipes/ReleaseTrailer.tsx";
import { ProductPromo } from "./recipes/ProductPromo.tsx";
import { FeatureSpotlight, type SpotlightBrand } from "./recipes/FeatureSpotlight.tsx";
import { ScreenDemo } from "./recipes/ScreenDemo.tsx";
import { TerminalRun } from "./recipes/TerminalRun.tsx";
import { Loop } from "./recipes/Loop.tsx";
import { Storyboard } from "./recipes/Storyboard.tsx";
import type { Board } from "@panoma/video-gen";
import type { CastPlan, CastShot, PromoPlan, SpotlightPlan, SpotlightSection, TrailerPlan, TrailerSection, TutorialPlan } from "./recipes/timing.ts";
import {
  boardPlan,
  castPlan,
  castShots,
  gridOf,
  promoPlan,
  promoShots,
  promoTitleSettledFrame,
  loopDuration,
  quoteDuration,
  quoteLineStarts,
  screenDuration,
  screenLineStarts,
  terminalDuration,
  terminalRowFrame,
  terminalSummaryFrame,
  trailerPlan,
  trailerShots,
  spotlightPlan,
  tutorialChapters,
  tutorialPlan,
  tutorialShots,
  captionCards,
  captionPhrases,
  tutorialOrphans,
  tutorialStalls,
  type ShotMotion,
} from "./recipes/timing.ts";

/** Where a matrix reads its material from. */
export type Dirs = {
  /** Static assets a scene may reference through `asset()` (images, music files). */
  assets: string;
  /** Recorded sessions: `<name>.<take>.webm` + `.session.json`. */
  sessions: string;
  /** Generated voice: `<brief>/<line>-<lang>.mp3` + `.words.json`. */
  generated: string;
  /** Synthesised action foley and optional edit effects. */
  sfx: string;
  /*
    An element to punctuate a press with, already crushed and measured, relative to `assets`.

    Optional, and it is a library rather than a per-film purchase: an element refers to no
    product, so one bought for any film is the same element for every film after it. A film
    without one is the film this repository has always made.
  */
  burst?: { file: string; blend: "screen" | "multiply" };
  /** Extracted identity for recipes that make the product, rather than the engine, the art direction. */
  brand?: SpotlightBrand;
  /*
    The look of THIS product's film: the stage, the ink, the accent, the rhythm and the
    furniture, derived by @panoma/video-brand/direction. Absent for the repository's own briefs,
    which keep the engine's own direction — that is what `DEFAULT_DIRECTION` is.
  */
  direction?: Direction;
};

export type Matrix = {
  compositions: CompositionDef[];
  /** Composition ids built on a substituted take — `panoma-video launch` refuses these. */
  mismatched: Set<string>;
  /** Chapter lists, by composition id. Only tutorials have them. */
  chapters: Map<string, Chapter[]>;
  /** What each composition intends, for the review. */
  plans: Map<string, RenderPlan>;
  /** The procedural bed each composition plays when its brief brings no music: what to render, and where. */
  beds: Map<string, Bed>;
  /** The spoken words of each voiced composition, in composition seconds — for subtitles. */
  words: Map<string, Word[]>;
};

export type Bed = { opts: BedOptions; path: string };

export const REPO_DIRS: Dirs = {
  assets: fileURLToPath(new URL("../public/", import.meta.url)),
  sessions: fileURLToPath(new URL("../../../media/source/sessions/", import.meta.url)),
  generated: fileURLToPath(new URL("../../../media/source/generated/", import.meta.url)),
  sfx: fileURLToPath(new URL("../../../media/source/sfx/", import.meta.url)),
};

/**
 * The take that fits the canvas: portrait formats get the mobile recording (the
 * product's own responsive layout), wide formats the desktop one.
 *
 * A fallback still happens — a half-recorded session should preview rather than
 * vanish — but it is never silent. Substituting a mobile take into a wide canvas
 * puts a phone bezel on a 16:9 frame at 23% fill, which is worse than the framing
 * this whole design exists to delete, so `matched` travels with the session and
 * `panoma-video launch` refuses to ship a set built on one.
 *
 * This module loads at the top of every CLI command; a missing take must cost that
 * brief its rows in the matrix, never take `panoma-video list` down with it.
 */
export type TakeChoice = { session: SessionLog; matched: boolean };

function sessionFor(brief: Brief, formatId: string, dirs: Dirs): TakeChoice | null {
  const preferred = formatId === "v" ? TAKE_MOBILE : TAKE_DESKTOP;
  const order = formatId === "v" ? [TAKE_MOBILE, TAKE_DESKTOP] : [TAKE_DESKTOP, TAKE_MOBILE];
  for (const take of order) {
    const path = join(dirs.sessions, `${brief.session}.${take}.session.json`);
    if (!existsSync(path)) continue;
    const session = JSON.parse(readFileSync(path, "utf8")) as SessionLog;
    /* A log without its video is a stale log: the take was renamed or the
       recording failed after the json was written. Treat it as absent. */
    if (!existsSync(join(dirs.sessions, session.video))) {
      console.error(
        `[panoma-video] session "${brief.session}" take "${take}": ${session.video} is missing. Re-record: panoma-video record ${brief.session} --take=${take}`,
      );
      continue;
    }
    if (take !== preferred) {
      console.error(
        `[panoma-video] brief "${brief.id}" (${formatId}) is falling back to the "${take}" take because "${preferred}" was not recorded.\n` +
          `        Expect a badly framed cut. Fix it with: panoma-video record ${brief.session} --take=${preferred}`,
      );
    }
    return { session, matched: take === preferred };
  }
  console.error(
    `[panoma-video] brief "${brief.id}" skipped for ${formatId}: no usable take of session "${brief.session}". Run: panoma-video record ${brief.session}`,
  );
  return null;
}

type PieceProps = { brief: Brief; hook: Line; lang: string; format: Format; voiced?: { words: Word[] } };

const RECIPES: Record<
  string,
  {
    Component: React.FC<PieceProps>;
    duration: (b: Brief) => number;
    lineStarts?: (b: Brief) => Record<string, number>;
  }
> = {
  KineticQuote: { Component: KineticQuote, duration: quoteDuration, lineStarts: quoteLineStarts },
  ScreenDemo: { Component: ScreenDemo, duration: screenDuration, lineStarts: screenLineStarts },
  TerminalRun: { Component: TerminalRun, duration: terminalDuration },
  ScreenCast: { Component: ScreenCast as unknown as React.FC<PieceProps>, duration: () => 0 },
  Tutorial: { Component: Tutorial as unknown as React.FC<PieceProps>, duration: () => 0 },
  ReleaseTrailer: { Component: ReleaseTrailer as unknown as React.FC<PieceProps>, duration: () => 0 },
  ProductPromo: { Component: ProductPromo as unknown as React.FC<PieceProps>, duration: () => 0 },
  FeatureSpotlight: { Component: FeatureSpotlight as unknown as React.FC<PieceProps>, duration: () => 0 },
  Loop: { Component: Loop, duration: loopDuration },
};

/** A music file names itself relative to the assets directory, or absolutely. */
function musicPath(file: string, dirs: Dirs): string {
  return isAbsolute(file) ? file : join(dirs.assets, file);
}

/*
  The procedural bed a composition asks for: the brief's tempo and style, the
  composition's length rounded up to a whole second, hats on the grid's ticks, and a
  swell into every card the recipe lands. The path is per composition because the
  accents are — two hooks of one brief share a tempo and not a card list.
*/
function bedFor(brief: Brief, grid: Grid, id: string, durationInFrames: number, dirs: Dirs, accentFrames: number[] = []) {
  const opts: BedOptions = {
    bpm: brief.bpm,
    /* Exactly the piece: the encoder trims at the composition's duration, and a bed rounded up loses its fade-out. */
    seconds: durationInFrames / grid.fps,
    /*
      The brief wins; then the product's own direction; then "calm". Before the direction
      existed, every product on this disk was scored with one eight-second phrase: style
      "calm", key "A minor", seed 1, at 120 BPM. Two films in the same key at the same
      tempo sound like one film however different their pictures are.
    */
    style: brief.music?.style ?? dirs.direction?.sound.style ?? "calm",
    key: brief.music?.key ?? dirs.direction?.sound.key,
    /*
      The grid's own count, not `beatFrames / tickFrames`: a tempo conformed from a track
      can give a PRIME beat (13 frames at 138.46 BPM), whose tick is round(beat/3) and not
      a divisor, so that division is 3.25 — and `renderBed` refuses a fraction.
    */
    ticksPerBeat: grid.ticksPerBeat,
    accents: accentFrames.map((f) => f / grid.fps),
  };
  /*
    The file is named by everything that shaped it, so a composition that changed
    length or accents gets a new bed instead of the stale one; old files are the
    cache's problem, not the mix's. A short hash keeps the name readable.
  */
  let h = 5381;
  for (const ch of JSON.stringify(opts)) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return { opts, path: join(dirs.generated, brief.id, `${id}.${h.toString(16).padStart(8, "0")}.bed.wav`) };
}

/*
  Mounts the bed when the brief brings no music of its own — no file, no prompt. The
  matrix records what the bed should be so `panoma-video assets` can write it, and mounts the
  file only once it exists: a composition never fails for a bed that has not been
  rendered yet, it plays without one.
*/
/*
  How far under the narration a music bed sits.

  Measured on a rendered tutorial: the procedural bed reads about -20 dB mean and a
  generated voice line about -24, so a bed at 0.22 lands only NINE decibels under the
  words. That is enough to see on a meter and not enough to follow an unfamiliar
  interface by ear — the first thing anyone says about a mix like that is "it has no
  voice". Broadcast practice for speech over music is fifteen to twenty; these put the
  bed at about -22 dB and -18 dB of gain, which lands the tutorial near eighteen and
  the shorter pieces near fourteen, where the music is still doing its job.

  A constant is honest here because both levels are: the bed is procedural and
  rendered by this repository, and the voice comes back from one model at one setting.
  A bed with no voice over it is a different question and keeps its own numbers.
*/
export const BED_UNDER_VOICE = 0.08;
export const BED_UNDER_VOICE_SHORT = 0.12;
/** The product's clicks remain foreground while the score supplies atmosphere. */
export const BED_UNDER_ACTION = 0.32;

function bedClips(beds: Map<string, Bed>, brief: Brief, grid: Grid, id: string, durationInFrames: number, dirs: Dirs, volume: number, accentFrames: number[] = []): AudioClip[] {
  if (brief.music?.file || brief.music?.prompt) return [];
  const bed = bedFor(brief, grid, id, durationInFrames, dirs, accentFrames);
  beds.set(id, bed);
  return existsSync(bed.path) ? [{ path: bed.path, from: 0, volume }] : [];
}

/*
  A brought track, seated where the bed would sit.

  The bed measures about -18 LUFS (docs/music.md) and the mix's gains were set for it. A
  track someone brings is whatever it is — a mastered piece sits around -9 to -13 — so its
  gain is the bed's, corrected by the difference the score stage measured: the same
  number of decibels under the voice whichever file it is. A file with no pulse (a brief
  written by hand, before the score stage existed) keeps the gains it always had.

  It fades in over one beat — as the bed does — and out over the last bar, because the
  composition ends where it ends and the track does not. The fade-in was ten milliseconds
  once: the conform cuts the track on a kick, and a full-level kick in the first samples
  of the file came back from the AAC encoder at -0.9 dBTP whatever ceiling the master's
  limiter held (measured on a 7 s cut: the peak sat in the first 100 ms and nowhere else).
  A beat of fade keeps that first kick felt rather than heard, which is what the bed's
  first kick is too.
*/
const BED_LUFS = -18;
function trackClips(brief: Brief, grid: Grid, dirs: Dirs, under: { bed: number; plain: number }): AudioClip[] {
  if (!brief.music?.file) return [];
  const path = musicPath(brief.music.file, dirs);
  const pulse = brief.music.pulse ? pulseFileOf(brief.music.pulse, dirs) : undefined;
  if (!pulse) return [{ path, from: 0, volume: under.plain }];
  const gain = pulse.lufs !== undefined && Number.isFinite(pulse.lufs) ? Math.pow(10, (BED_LUFS - pulse.lufs) / 20) : 1;
  return [{ path, from: 0, volume: Math.round(under.bed * gain * 1000) / 1000, fade: { in: grid.beatFrames / grid.fps, out: grid.barFrames / grid.fps } }];
}

/** The pulse file, once per path, with the loudness the score stage wrote beside it. */
function pulseFileOf(file: string, dirs: Dirs): (Pulse & { lufs?: number }) | undefined {
  const path = musicPath(file, dirs);
  return existsSync(path) ? (loadPulse(path) as Pulse & { lufs?: number }) : undefined;
}

/*
  What the picture dances to: the pulse at the brief's level, or nothing. A piece with
  words on it — a voice, or a tutorial, whose sentences are drawn when nobody speaks —
  never gets more than the light level, whatever the direction chose: the words are what
  it is for.
*/
function danceOf(brief: Brief, grid: Grid, dirs: Dirs, worded: boolean): Pulse | undefined {
  if (!brief.music?.dance || brief.music.dance === "off") return undefined;
  const level = worded && brief.music.dance === "full" ? "light" : brief.music.dance;
  /* A brought track has its measured pulse; the bed's is the grid, for as long as any piece runs. */
  const pulse = brief.music.pulse ? pulseFileOf(brief.music.pulse, dirs) : brief.music.file || brief.music.prompt ? undefined : bedPulse(grid, grid.fps * 60 * 20);
  return pulseFor(pulse, level);
}

/*
  Whose narration is on disk.

  Audio is written one file per line and language, and a file that exists may still be
  the previous run's: a narration that failed, was cancelled or found no key leaves
  everything exactly where it was, and the piece would then play the old sentence under
  the new caption, in sync, with nothing anywhere saying so. The writer states what it
  spoke, after it has spoken all of it (@panoma/video-core/cache), and this is where that
  statement is checked. No manifest, or one that does not match these sentences, means
  no voice — the piece falls back to type, which is the honest outcome.
*/
function vouched(brief: Brief, lang: string, lines: readonly Line[], dirs: Dirs): boolean {
  if (!brief.voice) return false;
  const file = join(dirs.generated, brief.id, VOICE_MANIFEST);
  if (!existsSync(file)) return false;
  let manifest: VoiceManifest | null = null;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8")) as VoiceManifest;
  } catch {
    return false;
  }
  return manifestVouches(
    manifest,
    brief.voice,
    lines.map((l) => ({ key: `${l.id}-${lang}`, text: l.text[lang] ?? "" })),
  );
}

/** Voice assets for one brief+lang, if `panoma-video assets` has produced them all. */
function voicedFor(
  brief: Brief,
  lang: string,
  lineStarts: Record<string, number> | undefined,
  dirs: Dirs,
): { clips: AudioClip[]; words: Word[]; lines: { id: string; from: number; to: number }[] } | undefined {
  if (!brief.voice || !lineStarts) return undefined;
  if (!vouched(brief, lang, brief.lines, dirs)) return undefined;
  const dir = join(dirs.generated, brief.id);
  const clips: AudioClip[] = [];
  const words: Word[] = [];
  const lines: { id: string; from: number; to: number }[] = [];
  const fps = brief.fps ?? 30;
  for (const line of brief.lines) {
    const mp3 = join(dir, `${line.id}-${lang}.mp3`);
    const timing = join(dir, `${line.id}-${lang}.words.json`);
    if (!existsSync(mp3) || !existsSync(timing)) return undefined;
    const from = lineStarts[line.id] ?? 0;
    clips.push({ path: mp3, from, volume: 1 });
    const startSec = from / fps;
    const said = JSON.parse(readFileSync(timing, "utf8")) as Word[];
    for (const w of said) words.push({ text: w.text, start: w.start + startSec, end: w.end + startSec });
    const last = said[said.length - 1];
    lines.push({ id: line.id, from, to: from + Math.round((last?.end ?? 0) * fps) });
  }
  return { clips, words, lines };
}

/**
 * A tutorial's voice, if every line of it has been generated.
 *
 * All or nothing on purpose. A tutorial whose narration is half generated would
 * lay out at two different clocks — measured seconds for the voiced lines,
 * estimated ones for the rest — and the render would be a plausible video with the
 * wrong sentence under half its steps. Missing anything means the whole piece falls
 * back to estimates and shows its sentences as type, which is honest and legible.
 */
function tutorialVoice(
  brief: Brief,
  hook: Line,
  lang: string,
  dirs: Dirs,
): { seconds: Record<string, number>; part: Record<string, { mp3: string; words: Word[] }> } | null {
  if (!brief.voice) return null;
  const spoken = [hook, ...brief.lines].filter((l) => l.mode !== "type");
  if (!vouched(brief, lang, spoken, dirs)) return null;
  const dir = join(dirs.generated, brief.id);
  const seconds: Record<string, number> = {};
  const part: Record<string, { mp3: string; words: Word[] }> = {};
  for (const line of [hook, ...brief.lines]) {
    if (line.mode === "type") continue;
    const mp3 = join(dir, `${line.id}-${lang}.mp3`);
    const timing = join(dir, `${line.id}-${lang}.words.json`);
    if (!existsSync(mp3) || !existsSync(timing)) return null;
    const words = JSON.parse(readFileSync(timing, "utf8")) as Word[];
    seconds[line.id] = words.length > 0 ? words[words.length - 1].end : 0;
    part[line.id] = { mp3, words };
  }
  return { seconds, part };
}

/** The clip ends with its visible gesture; a scroll releases softly before the cut. */
function interactionClips(cues: SoundCue[], dirs: Dirs): AudioClip[] {
  return cues.flatMap((cue) => {
    const path = join(dirs.sfx, `${cue.kind}.wav`);
    return existsSync(path) ? [{ path, from: cue.from, volume: cue.volume, durationInFrames: cue.durationInFrames, ...(cue.kind === "scroll" ? { fade: { out: 0.09 } } : {}) }] : [];
  });
}

/*
  What a tutorial is checked for, once per (brief, language, take) rather than once
  per composition — the matrix multiplies by hook and format, and the same warning
  twelve times is a warning nobody reads.

  None of these repair anything. Each has exactly two fixes and both belong to a
  person: shoot more, or say less.
*/
const reported = new Set<string>();

/*
  Netflix's Timed Text Style Guide: 20 characters a second for adult material, 17 for
  material a viewer is decoding rather than skimming. A tutorial is the second case —
  the reader is looking at an unfamiliar interface at the same time — so 17 warns and
  20 is the line. Measured per CARD and per LANGUAGE: Spanish says the same thing in
  15-25% more characters, so an English cut that passes and a Spanish one that does
  not is a matrix's default outcome, and it is invisible unless the check runs twice.
*/
const CPS_WARN = 17;
const CPS_MAX = 20;
/*
  Where the first step has to have started.

  Zannettou et al. (CHI 2024, a TikTok data donation of 4.1M videos) measured the
  skip curve directly: 24% of views are gone before a fifth of the duration has
  played. A cold open that eats more than that spends the audience on the question
  and never gets to the answer.
*/
const FRONT_LOAD_SECONDS = 6;
/*
  The longest a single step may run. Ragazou & Karasavvidis (2020) tabulate real
  tutorial corpora at 11-23 seconds per step; past twenty a step has stopped being
  one operation and the mark it needs is missing.
*/
const STEP_CEILING_SECONDS = 20;

function reportTutorial(
  brief: Brief,
  lang: string,
  session: SessionLog,
  plan: TutorialPlan,
  words: Word[],
): void {
  const key = `${brief.id}--${lang}--${session.take}`;
  if (reported.has(key)) return;
  reported.add(key);
  const fps = brief.fps ?? 30;
  const where = `tutorial "${brief.id}" (${lang}, ${session.take} take)`;

  const stalls = tutorialStalls(plan);
  if (stalls.length > 0) {
    console.error(
      `[panoma-video] ${where} freezes the picture for most of ${stalls.length} of its steps:\n` +
        stalls
          .map((s) => `        ${s.mark}: held for ${(s.heldFrames / fps).toFixed(1)}s of ${(s.spanFrames / fps).toFixed(1)}s`)
          .join("\n") +
        `\n        Shoot more between those marks, or say less. The camera keeps moving either way.`,
    );
  }

  const total = plan.durationInFrames / fps;
  const opens = plan.steps[0].from / fps;
  const deadline = Math.min(FRONT_LOAD_SECONDS, total * 0.2);
  if (opens > deadline) {
    console.error(
      `[panoma-video] ${where} does not start doing anything until ${opens.toFixed(1)}s of ${total.toFixed(1)}s. ` +
        `A quarter of a feed audience is gone by ${deadline.toFixed(1)}s. Shorten the hook.`,
    );
  }

  const long = plan.steps.filter((s) => (s.to - s.from) / fps > STEP_CEILING_SECONDS);
  if (long.length > 0) {
    console.error(
      `[panoma-video] ${where} has steps longer than ${STEP_CEILING_SECONDS} seconds: ` +
        long.map((s) => `${s.mark} (${((s.to - s.from) / fps).toFixed(0)}s)`).join(", ") +
        `. That is more than one operation — add a mark and split the sentence.`,
    );
  }

  const orphans = tutorialOrphans(session, plan);
  if (orphans.length > 0) {
    console.error(
      `[panoma-video] ${where} does ${orphans.length} ${orphans.length === 1 ? "thing" : "things"} no step narrates:\n` +
        orphans.map((e) => `        ${(e.t / 1000).toFixed(1)}s ${e.kind}`).join("\n") +
        `\n        Every action belongs to a mark, or is declared role: "chrome".`,
    );
  }

  /*
    Reading speed, per language, on the words this language actually produced. The
    Spanish line says the same thing in 15-25% more characters, so an English cut
    that passes and a Spanish one that does not is the DEFAULT outcome of a matrix —
    and it is invisible unless the check runs per locale.
  */
  const phrases = captionPhrases(captionCards(words));
  const over = phrases.filter((p) => p.cps > CPS_WARN);
  const worst = over.reduce((a, b) => (a && a.cps > b.cps ? a : b), over[0]);
  if (worst && (worst.cps > CPS_MAX || over.length > phrases.length / 3)) {
    console.error(
      `[panoma-video] ${where}: ${over.length} of ${phrases.length} spoken phrases run over ${CPS_WARN} characters a second ` +
        `of caption (worst ${worst.cps.toFixed(1)}: "${worst.text}"). ` +
        `Above ${CPS_MAX} nobody following along in their own window can read them.`,
    );
  }
}

/*
  What a spotlight is checked for, once per (brief, take): a use whose control the
  take did not render at macro scale is shown from the page at its own pixels, which
  is honest and small, and the fix belongs to a person — a take with the control on
  screen, or a claim bound to another moment.
*/
function reportSpotlight(brief: Brief, session: SessionLog, plan: SpotlightPlan): void {
  if (plan.degraded.length === 0) return;
  const key = `spotlight:${brief.id}--${session.take}`;
  if (reported.has(key)) return;
  reported.add(key);
  console.error(
    `[panoma-video] spotlight "${brief.id}" (${session.take} take) has no macro clip for: ${plan.degraded.join(", ")}. ` +
      `Those uses are shown from the page at its own pixels. Re-record so the control is on screen at its mark: panoma-video record ${brief.session}`,
  );
}

/* ---------- A storyboard, which is not a brief ---------- */

/*
  A board is its own artefact and it does not belong in the matrix.

  Everything in `buildCompositions` is a brief crossed with hooks, languages and formats,
  because that is what a campaign is. A storyboard is one film: one language, one format,
  one cut list, and — the part that makes it different in kind — some of its shots are
  files that may not exist yet. So it gets a composition of its own, built on demand, and
  the caller (`panoma-video storyboard`) renders it the same way `panoma-video render` renders anything
  else: same encoder, same master, same review gate.
*/
export function boardComposition(input: {
  board: Board;
  brief: Brief;
  lang: string;
  format: Format;
  dirs: Dirs;
  /** Paths of the clips that exist, by shot number. A shot without one renders as its panel. */
  clips?: Record<number, string>;
  /** Panel pictures, by shot number: the real frames the animatic stands on. */
  panels?: Record<number, string>;
}): { composition: CompositionDef; plan: RenderPlan } {
  const { board, brief, lang, format, dirs } = input;
  const fps = board.fps;
  const grid = gridOf(brief);
  const session = board.shots.some((s) => s.origin === "captured") ? sessionFor(brief, format.id, dirs)?.session : undefined;

  /*
    A captured shot plays from its mark to the next one, so its material is what the
    recording actually holds there — not the three and a half seconds somebody typed. A
    board that asked for more than the take has would hold a frozen frame and call it a
    decision. A bought shot brings its own material and its own in-point.
  */
  const marks = session?.marks ?? [];
  const shots = board.shots.map((shot) => {
    const base = { n: shot.n, duration: shot.duration, origin: shot.origin, ...(shot.gen ? { gen: shot.gen } : {}) };
    if (shot.origin !== "captured" || !shot.source) return base;
    const i = marks.findIndex((m) => m.name === shot.source!.mark);
    const from = i >= 0 ? marks[i].t : 0;
    const to = i >= 0 && i + 1 < marks.length ? marks[i + 1].t : (session?.durationMs ?? from);
    return { ...base, duration: Math.max(Math.round(0.5 * fps), Math.round(((to - from) / 1000) * fps)) };
  });

  const plan = boardPlan(brief, shots);
  const voice = tutorialVoice(brief, brief.hooks[0], lang, dirs);
  const clips: AudioClip[] = [];
  const words: Word[] = [];
  if (voice) {
    /* A line's voice starts on the shot that carries it, which is the shot the board pinned it to. */
    for (const shot of board.shots) {
      const line = shot.say ? brief.lines.find((l) => (l.text[lang] ?? "") === (shot.say![lang] ?? "\u0000")) : undefined;
      const said = line ? voice.part[line.id] : undefined;
      const at = plan.shots.find((p) => p.n === shot.n);
      if (!said || !at) continue;
      clips.push({ path: said.mp3, from: at.from, volume: 1 });
      for (const w of said.words) words.push({ text: w.text, start: w.start + at.from / fps, end: w.end + at.from / fps });
    }
  }

  const id = `${board.id}--${lang}--${format.id}`;
  return {
    composition: {
      id,
      format,
      fps,
      durationInFrames: plan.durationInFrames,
      timeline: { bpm: grid.bpm, beatFrames: grid.beatFrames, tickFrames: grid.tickFrames, start: grid.start },
      audio: clips,
      element: () => (
        <ThemeProvider direction={dirs.direction}>
          <Storyboard
            brief={brief}
            lang={lang}
            format={format}
            board={board}
            plan={plan}
            {...(session ? { session } : {})}
            {...(input.clips ? { clips: input.clips } : {})}
            {...(input.panels ? { panels: input.panels } : {})}
            {...(words.length > 0 ? { voiced: { words } } : {})}
          />
        </ThemeProvider>
      ),
    },
    plan: {
      recipe: "Storyboard",
      fps,
      durationInFrames: plan.durationInFrames,
      beats: beatsOf(brief),
      /* Every shot boundary is a cut: this piece is a cut list and nothing else. */
      cuts: plan.shots.slice(1).map((s) => ({ frame: s.from, kind: "cut" as const })),
      /* A shot whose material runs short holds its last frame, on purpose, like a short take in a cutting room. */
      holds: plan.shots.filter((s) => s.to > s.holdFrom).map((s) => ({ from: s.holdFrom, to: s.to, why: `shot ${s.n} holds its last frame: its material is ${s.material.toFixed(1)}s and the cut gives it longer` })),
      fades: [],
      cards: plan.shots.filter((s) => s.source === "card").map((s) => ({ from: s.from, to: s.to, text: `shot ${s.n}` })),
      marks: plan.shots.map((s) => ({ name: `shot-${s.n}`, frame: s.from })),
    },
  };
}

/* ---------- Render plans: what each recipe intends, for the review ---------- */

function beatsOf(brief: Brief) {
  const grid = gridOf(brief);
  return { beatFrames: grid.beatFrames, barFrames: grid.barFrames, start: grid.start };
}

function tutorialRenderPlan(brief: Brief, plan: TutorialPlan, voice: { id: string; from: number; to: number }[]): RenderPlan {
  const fps = brief.fps ?? 30;
  /* A step that opens on its own title is two cuts: into the card, and out of it into the product. */
  const titled = plan.steps.filter((s) => s.cardTo > s.from);
  return {
    recipe: "Tutorial",
    fps,
    durationInFrames: plan.durationInFrames,
    beats: beatsOf(brief),
    /*
      Every ground change is a cut, and in this piece every one of them is real: the
      cards are the opposite polarity of the shots around them, so a scene detector sees
      what a viewer sees. That was not true when the only cards were at the two ends and
      the step boundaries were a chip sliding over unbroken footage — the review scored
      those at 9.3 against a threshold of 10 and warned, correctly, that a cut had been
      declared where the picture had not changed.
    */
    cuts: [
      plan.hookFrames,
      ...titled.flatMap((s) => [s.from, s.cardTo]),
      plan.outroFrom,
    ]
      .filter((f) => f > 0 && f < plan.durationInFrames)
      .sort((a, b) => a - b)
      .map((frame) => ({ frame, kind: "cut" as const })),
    /*
      What is deliberately still. Three kinds, and each is a decision somebody can read:
      a title card after its line has landed, a step whose footage has run out under a
      narrator still speaking, and the closing card. The camera keeps a tenth of a per
      cent of drift under all of them, which is not a move and is not a freeze either.
    */
    holds: [
      ...titled.map((s) => ({ from: s.from + gridOf(brief).beatFrames * 2, to: s.cardTo, why: `the title of step ${s.index} (${s.mark}) holds while it is read` })),
      /*
        From the moment the step's own action has landed, not from the moment the footage
        runs out. Between those two the picture is still playing and showing a page that
        is not moving, which is the hold this recipe is FOR — the settle a viewer reads
        the result in — and reporting it as an accident is how a report fills with
        warnings nobody reads.
      */
      /*
        And the wait BEFORE the press, which the review was never told about.

        The camera arrives a beat after the card lifts and then stands on the control until
        the press — on the repo's own take that is a hundred still frames the checker was
        reading as an accident. It is the most deliberate stillness in the piece: it is the
        film letting the viewer find the thing before it is touched.
      */
      ...plan.steps.map((s) => ({ from: Math.min(s.pressAt, s.cardTo + gridOf(brief).beatFrames), to: s.pressAt, why: `step ${s.index} (${s.mark}) waits on the control before the press` })),
      ...plan.steps.map((s) => ({ from: Math.min(s.settleFrom, s.holdFrom), to: s.to, why: `step ${s.index} (${s.mark}) holds on what it just did, while the narrator finishes` })),
      { from: plan.outroFrom, to: plan.durationInFrames, why: "the closing card" },
    ].filter((h) => h.to > h.from),
    fades: [],
    /* What the recipe knows and the checker cannot infer: where the picture ran out, per step. */
    stalls: plan.steps.map((s) => ({ mark: s.mark, share: (s.to - s.holdFrom) / Math.max(1, s.to - s.cardTo) })),
    cards: [
      { from: 0, to: plan.hookFrames, text: "cold open" },
      ...titled.map((s) => ({ from: s.from, to: s.cardTo, text: `step ${s.index}` })),
      { from: plan.outroFrom, to: plan.durationInFrames, text: "closing card" },
    ],
    voice,
    marks: plan.steps.map((s) => ({ name: s.mark, frame: s.cardTo })),
  };
}

function castRenderPlan(brief: Brief, plan: CastPlan, shots: CastShot[]): RenderPlan {
  return {
    recipe: "ScreenCast",
    fps: brief.fps ?? 30,
    durationInFrames: plan.durationInFrames,
    beats: beatsOf(brief),
    /*
      A shot boundary is a cut only when the camera jumps. Since the punch became two
      shots (a spring arrival, then a drifting hold) and near clicks are joined by a pan,
      most boundaries are continuous seams: declaring them as cuts had the review look
      for a scene change that was never meant to be there.
    */
    cuts: shots
      .slice(1)
      .filter((s, i) => {
        const p = shots[i]!.end;
        return !(Math.abs(p.fx - s.start.fx) < 1e-9 && Math.abs(p.fy - s.start.fy) < 1e-9 && Math.abs(p.scale - s.start.scale) < 1e-9);
      })
      .map((s) => ({ frame: s.from, kind: s.enter })),
    holds: [],
    fades: [],
    cards: [],
  };
}

function typeRenderPlan(brief: Brief, duration: number, cutFrames: number[], voice?: { id: string; from: number; to: number }[]): RenderPlan {
  return {
    recipe: brief.recipe,
    fps: brief.fps ?? 30,
    durationInFrames: duration,
    beats: beatsOf(brief),
    cuts: cutFrames.filter((f) => f > 0 && f < duration).map((frame) => ({ frame, kind: "cut" as const })),
    holds: [],
    fades: [],
    /* The whole piece is type: motion comes from the words arriving, not from footage. */
    cards: [{ from: 0, to: duration }],
    ...(voice ? { voice } : {}),
  };
}

function planFor(brief: Brief, duration: number, voice?: { id: string; from: number; to: number }[]): RenderPlan {
  const grid = gridOf(brief);
  switch (brief.recipe) {
    case "KineticQuote":
      return typeRenderPlan(brief, duration, brief.lines.map((_, i) => grid.bar(2 + i)), voice);
    case "ScreenDemo":
      return typeRenderPlan(brief, duration, brief.lines.map((_, i) => grid.bar(2 + i * 2)), voice);
    case "TerminalRun": {
      const rows = brief.lines.slice(1, -1).map((_, i) => terminalRowFrame(brief, i));
      return typeRenderPlan(brief, duration, [grid.bar(1), ...rows, terminalSummaryFrame(brief)], voice);
    }
    default:
      return typeRenderPlan(brief, duration, [], voice);
  }
}


/** Which trailer sections the product is on screen for; the rest are cards on the opposite ground (ReleaseTrailer's `LIVE`). */
const isLive = (kind: TrailerSection["kind"]) => kind === "open" || kind === "proof";

function trailerRenderPlan(brief: Brief, plan: TrailerPlan): RenderPlan {
  const cards = plan.sections.filter((s) => s.kind !== "open" && s.kind !== "proof");
  const proofs = plan.sections.filter((s): s is Extract<typeof s, { kind: "proof" }> => s.kind === "proof");
  return {
    recipe: "ReleaseTrailer",
    fps: brief.fps ?? 30,
    durationInFrames: plan.durationInFrames,
    beats: beatsOf(brief),
    /*
      A cut is where the GROUND changes: the product leaves the frame whole for a card
      on the opposite polarity, and comes back whole for the next proof. It used to be a
      dissolve under each claim, because the card played over the picture and the footage
      jumped beneath it.

      Two cards in a row are not a cut and must not be declared as one. The kicker giving
      way to the theme is the same ink on the same ground with different words on it, and
      scdet scores it 0 against a threshold of 10 — which is the honest answer: a viewer
      sees type change, not a picture change. Two proofs in a row would be a cut, and are
      declared, though the clock has not put two together yet.
    */
    cuts: plan.sections
      .filter((s, i) => {
        const before = plan.sections[i - 1];
        return before !== undefined && s.from > 0 && (isLive(before.kind) !== isLive(s.kind) || (s.kind === "proof" && before.kind === "proof"));
      })
      .map((s) => ({ frame: s.from, kind: "cut" as const })),
    holds: [
      ...cards.map((s) => ({ from: s.from, to: s.to, why: `${s.kind} card: type on the stage, the product off screen` })),
      ...proofs.filter((s) => s.to > s.holdFrom).map((s) => ({ from: s.holdFrom, to: s.to, why: `proof ${s.index} ran out of footage` })),
    ],
    fades: [],
    cards: cards.map((s) => ({ from: s.from, to: s.to, text: s.kind })),
    marks: proofs.map((s) => ({ name: s.mark, frame: s.from })),
  };
}

function promoRenderPlan(brief: Brief, plan: PromoPlan, lang: string): RenderPlan {
  const live = (section: PromoPlan["sections"][number]) => section.kind === "proof" || section.kind === "preview";
  const cards = plan.sections.filter((s): s is Extract<PromoPlan["sections"][number], { kind: "hook" | "benefit" | "end" }> => s.kind === "hook" || s.kind === "benefit" || s.kind === "end");
  const proofs = plan.sections.filter((s) => s.kind === "proof");
  const sources = plan.sections.filter((s): s is Extract<PromoPlan["sections"][number], { kind: "terminal" | "code" }> => s.kind === "terminal" || s.kind === "code");
  const recaps = plan.sections.filter((s) => s.kind === "recap");
  return {
    recipe: "ProductPromo",
    editorialTheme: brief.promo?.theme ?? "flat",
    ...(brief.promo?.close ? { promoClose: brief.promo.close } : {}),
    lang,
    fps: brief.fps ?? 30,
    durationInFrames: plan.durationInFrames,
    beats: beatsOf(brief),
    cuts: plan.sections.filter((s, i) => {
      const before = plan.sections[i - 1];
      if (!before) return false;
      /* A split sequence keeps the same composed frame while its explanation and
         demonstrated feature change. That is a chapter boundary, not a picture cut. */
      const samePanels = s.kind === "proof" && before.kind === "proof" && s.treatment === "split" && before.treatment === "split";
      return live(s) !== live(before) || (live(s) && live(before) && !samePanels);
    }).map((s) => ({ frame: s.from, kind: "cut" as const })),
    holds: [
      ...cards.map((s) => ({ from: promoTitleSettledFrame(brief.promo?.theme, s.kind, s.from, s.to, brief.fps ?? 30, gridOf(brief).beatFrames), to: s.to, why: `${s.kind}: read after the title entrance settles` })),
      ...sources.map((s) => ({ from: s.typingTo, to: s.to, why: `read the documented ${s.kind} excerpt` })),
      ...recaps.map((s) => ({ from: s.rows.at(-1)!.from + promoRowArrivalFrames(brief.fps ?? 30, brief.promo?.theme), to: s.to, why: "read the demonstrated benefits together" })),
      ...proofs.map((s) => ({ from: Math.min(s.to, s.resultFrom + Math.floor((brief.fps ?? 30) * 0.42)), to: s.to, why: `read the recorded result at ${s.mark}` })),
      ...plan.sections.filter((s) => s.kind === "preview").map((s) => ({ from: s.from, to: s.to, why: "opening preview of the recorded result" })),
    ].filter((s) => s.to > s.from),
    fades: [],
    cards: [
      ...cards.map((s) => ({ from: s.from, to: s.to, readFrom: promoTitleSettledFrame(brief.promo?.theme, s.kind, s.from, s.to, brief.fps ?? 30, gridOf(brief).beatFrames), text: s.text, id: s.id })),
      /* Full-stage animated type is still a card. Its reading clock is audited
         through texts below, after typing/row arrival, instead of counted twice. */
      ...sources.map((s) => ({ from: s.from, to: s.to, id: s.id })),
      ...recaps.map((s) => ({ from: s.from, to: s.to, id: s.id })),
    ].sort((a, b) => a.from - b.from),
    texts: [
      ...proofs.filter((s) => s.treatment === "split").map((s) => ({ id: s.id, kind: "split" as const, text: s.text, from: s.from, to: s.to, readFrom: s.from })),
      ...sources.map((s) => ({ id: s.id, kind: s.kind, text: s.text, from: s.from, to: s.to, readFrom: s.typingTo })),
      ...recaps.flatMap((s) => s.rows.map((row) => ({ id: row.id, kind: "recap" as const, text: row.text, from: row.from, to: s.to, readFrom: row.from + promoRowArrivalFrames(brief.fps ?? 30, brief.promo?.theme) }))),
    ],
    marks: proofs.map((s) => ({ name: s.mark, frame: s.from })),
    uses: proofs.map((s) => ({ id: s.id, mark: s.mark, from: s.from, to: s.to, actionFrame: s.presses[0]?.frame ?? s.from, resultFrame: s.resultFrom, evidence: [...(brief.promo?.evidence[s.id]?.facts ?? [])], treatment: s.treatment })),
  };
}

/** Which spotlight sections are drawn on the opposite polarity (FeatureSpotlight's `card`). */
const onInverted = (kind: SpotlightSection["kind"]) => kind === "card" || kind === "end";

function spotlightRenderPlan(brief: Brief, plan: SpotlightPlan): RenderPlan {
  const grid = gridOf(brief);
  const units = plan.sections.filter((section): section is Extract<typeof section, { kind: "unit" }> => section.kind === "unit");
  const claimCards = plan.sections.filter((section): section is Extract<typeof section, { kind: "card" }> => section.kind === "card");
  const end = plan.sections.find((section) => section.kind === "end");
  const kicker = plan.sections.find((section) => section.kind === "kicker");
  return {
    recipe: "FeatureSpotlight",
    fps: brief.fps ?? 30,
    durationInFrames: plan.durationInFrames,
    beats: beatsOf(brief),
    /*
      A cut is a one-frame change of picture the scene detector can see, and now every
      one of them is real. The piece alternates a claim card and the product: each
      boundary swaps the whole frame between type on a stage and a control on a plate,
      which is the largest change of picture this recipe can make.

      Until 2026-09-03 there was exactly one — the end card — because the claim was
      typed OVER the use and the camera travelled between controls, so nothing ever
      cut. The plate no longer springs in either: a cut declared as a cut and rendered
      as one is what the scene detector is for. What stays undeclared is what is still
      a dissolve: the control swapping to its pressed state (a chevron inside a large
      plate), a menu unfolding, the page coming in under a pull-out.
    */
    cuts: plan.sections
      .filter((section, i) => {
        const before = plan.sections[i - 1];
        /* The same rule as the trailer's: a cut is where the ground changes. A claim card giving way to the end card is two cards, and scdet is right to score it nothing. */
        return before !== undefined && section.from > 0 && onInverted(before.kind) !== onInverted(section.kind);
      })
      .map((section) => ({ frame: section.from, kind: "cut" as const })),
    holds: [
      ...(kicker ? [{ from: kicker.from + grid.tickFrames, to: kicker.to, why: "the name holds under the kicker" }] : []),
      /*
        A card is type on a stage: the words land on ticks and the rule grows under them
        for two beats, and after that the frame is meant to be still — a claim a viewer
        is reading is not a claim that should be moving.
      */
      ...claimCards.map((c) => ({ from: c.from + grid.beatFrames * 2, to: c.to, why: `the claim for ${c.mark} holds while it is read` })),
      /*
        A use that OPENS on a still under a camera does not move by the reviewer's own
        measure — the mean luma difference across the whole frame — because the thing
        travelling is one control on a stage that is 95% ground. Declared with the reason
        rather than left to warn, which is what the check's own fix asks for.
      */
      ...units.map((u) => ({ from: u.from, to: u.press, why: `the control is a still under the push; nothing plays before the press on ${u.mark}` })),
      ...units.map((u) => ({ from: u.rest, to: u.to, why: `use ${u.index} (${u.mark}) rests on cause and effect` })),
      ...(end ? [{ from: end.from + grid.beatFrames * 2, to: end.to, why: "the end card" }] : []),
    ],
    fades: [],
    cards: [
      ...(kicker ? [{ from: kicker.from, to: kicker.to, text: "kicker" }] : []),
      ...claimCards.map((c) => ({ from: c.from, to: c.to, text: "claim" })),
      ...(end ? [{ from: end.from, to: end.to, text: "end" }] : []),
    ],
    marks: units.map((u) => ({ name: u.mark, frame: u.press })),
  };
}

function takeNamed(brief: Brief, take: string, dirs: Dirs): SessionLog | undefined {
  const file = join(dirs.sessions, `${brief.session}.${take}.session.json`);
  if (!existsSync(file)) return undefined;
  const session = JSON.parse(readFileSync(file, "utf8")) as SessionLog;
  return existsSync(join(dirs.sessions, session.video)) ? session : undefined;
}

const FALLBACK_SPOTLIGHT: SpotlightBrand = {
  name: "Product",
  theme: {
    ...LIGHT_PALETTE,
    fonts: { display, body: display, mono, editorial, wide },
    branded: { colors: false, accent: false },
  },
};

/**
 * The canvases a brief is published in.
 *
 * Every brief used to render all three, so a vertical-only cut also produced a
 * 1920x1080 nobody would post and a square nobody asked for — three renders, three
 * reviews, three files, for one piece. A brief that names a job renders the canvases
 * that job is published in; a brief without one keeps all three, which is what every
 * brief written before jobs existed meant.
 */
/**
 * How this product's camera moves. Absent — the repository's own briefs — the shot lists
 * keep the numbers they had before a direction existed.
 */
function motionOf(dirs: Dirs): ShotMotion | undefined {
  const d = dirs.direction;
  return d ? { push: d.motion.push, enters: d.motion.enters, seed: d.seed } : undefined;
}

function formatsFor(brief: Brief, selected?: readonly FormatId[]): Format[] {
  const formats = brief.job ? JOBS[brief.job].formats.map((id) => FORMATS[id]) : Object.values(FORMATS);
  return selected ? formats.filter(format => selected.includes(format.id)) : formats;
}

/* ---------- The factory ---------- */

export function buildCompositions(briefs: readonly Brief[], dirs: Dirs = REPO_DIRS, options: { formats?: readonly FormatId[] } = {}): Matrix {
  const mismatched = new Set<string>();
  const chapters = new Map<string, Chapter[]>();
  const plans = new Map<string, RenderPlan>();
  const beds = new Map<string, Bed>();
  const wordsOf = new Map<string, Word[]>();

  const compositions: CompositionDef[] = briefs.flatMap((brief) => {
    const recipe = RECIPES[brief.recipe];
    if (!recipe) throw new Error(`Brief "${brief.id}" names unknown recipe "${brief.recipe}".`);
    const { Component } = recipe;
    const grid = makeGrid({ bpm: brief.bpm, fps: brief.fps ?? 30 });
    const timeline = {
      bpm: grid.bpm,
      beatFrames: grid.beatFrames,
      tickFrames: grid.tickFrames,
      start: grid.start,
    };
    return brief.hooks.flatMap((hook) =>
      brief.langs.flatMap((lang) => {
        const voiced = voicedFor(brief, lang, recipe.lineStarts?.(brief), dirs);
        const product = ["Tutorial", "FeatureSpotlight", "ReleaseTrailer", "ProductPromo", "ScreenCast"].includes(brief.recipe);
        const bedVolume = voiced ? BED_UNDER_VOICE_SHORT : product ? BED_UNDER_ACTION : 0.9;
        const music: AudioClip[] = trackClips(brief, grid, dirs, { bed: bedVolume, plain: product ? bedVolume : voiced ? 0.35 : 0.9 });
        const pulse = danceOf(brief, grid, dirs, Boolean(voiced) || brief.recipe === "Tutorial");
        if (brief.recipe === "ProductPromo") {
          return formatsFor(brief, options.formats).flatMap((format): CompositionDef[] => {
            const choice = sessionFor(brief, format.id, dirs);
            if (!choice) return [];
            const { session } = choice;
            const plan = promoPlan(session, brief, hook, lang);
            const shots = promoShots(session, brief, plan, format);
            const id = `${brief.id}--${hook.id}--${lang}--${format.id}`;
            if (!choice.matched) mismatched.add(id);
            plans.set(id, promoRenderPlan(brief, plan, lang));
            return [{
              id, format, fps: grid.fps, durationInFrames: plan.durationInFrames, timeline,
              audio: [
                ...trackClips(brief, grid, dirs, { bed: BED_UNDER_ACTION, plain: BED_UNDER_ACTION }),
                ...bedClips(beds, brief, grid, id, plan.durationInFrames, dirs, BED_UNDER_ACTION),
                ...interactionClips(promoSoundCues(session, plan, grid.fps, brief.promo?.theme, grid.beatFrames), dirs),
              ],
              element: () => <ThemeProvider direction={dirs.direction}><ProductPromo brief={brief} hook={hook} lang={lang} format={format} session={session} plan={plan} shots={shots} /></ThemeProvider>,
            }];
          });
        }
        if (brief.recipe === "Tutorial") {
          return formatsFor(brief, options.formats).flatMap((format): CompositionDef[] => {
            const choice = sessionFor(brief, format.id, dirs);
            if (!choice) return [];
            const { session } = choice;
            const fps = brief.fps ?? 30;
            const voice = tutorialVoice(brief, hook, lang, dirs);
            const plan = tutorialPlan(session, brief, hook, lang, voice?.seconds ?? {});
            /* The format decides the sharpness ceiling: the same take is drawn at a different size in each cut. */
            const shots = tutorialShots(session, brief, plan, format);

            /*
              Where each spoken line lands. The hook opens the piece, every step
              starts with its own, and the closing lines run one after another from
              the moment the last step releases — which is the same arithmetic the
              plan used to decide how long each of those sections is, so the audio
              can never drift from the layout it was measured for.
            */
            const starts: { id: string; from: number }[] = [
              { id: hook.id, from: 0 },
              ...plan.steps.map((s) => ({ id: s.id, from: s.from })),
            ];
            let after = plan.outroFrom;
            for (const line of brief.lines.filter((l) => !l.mark)) {
              starts.push({ id: line.id, from: after });
              after += Math.round((voice?.seconds[line.id] ?? 0) * fps);
            }

            const clips: AudioClip[] = [];
            const words: Word[] = [];
            const spoken: { id: string; from: number; to: number }[] = [];
            if (voice) {
              for (const { id, from } of starts) {
                const said = voice.part[id];
                if (!said) continue;
                clips.push({ path: said.mp3, from, volume: 1 });
                for (const w of said.words) words.push({ text: w.text, start: w.start + from / fps, end: w.end + from / fps });
                spoken.push({ id, from, to: from + Math.round((voice.seconds[id] ?? 0) * fps) });
              }
            }

            reportTutorial(brief, lang, session, plan, words);

            const id = `${brief.id}--${hook.id}--${lang}--${format.id}`;
            if (!choice.matched) mismatched.add(id);
            chapters.set(id, tutorialChapters(plan, brief, hook, lang));
            plans.set(id, tutorialRenderPlan(brief, plan, spoken));
            if (words.length > 0) wordsOf.set(id, words);
            return [
              {
                id,
                format,
                fps,
                durationInFrames: plan.durationInFrames,
                timeline,
                audio: [
                  ...trackClips(brief, grid, dirs, { bed: voice ? BED_UNDER_VOICE : BED_UNDER_ACTION, plain: voice ? BED_UNDER_VOICE : BED_UNDER_ACTION }),
                  ...bedClips(beds, brief, grid, id, plan.durationInFrames, dirs, voice ? BED_UNDER_VOICE : BED_UNDER_ACTION),
                  ...clips,
                  ...interactionClips(tutorialSoundCues(session, plan, fps), dirs),
                ],
                element: () => (
                  <ThemeProvider direction={dirs.direction}><Tutorial
                    brief={brief}
                    hook={hook}
                    lang={lang}
                    format={format}
                    session={session}
                    plan={plan}
                    shots={shots}
                    voiced={voice ? { words } : undefined}
                    {...(dirs.burst ? { burst: dirs.burst } : {})}
                    {...(pulse ? { pulse } : {})}
                  /></ThemeProvider>
                ),
              },
            ];
          });
        }

        if (brief.recipe === "FeatureSpotlight") {
          return formatsFor(brief, options.formats).flatMap((format): CompositionDef[] => {
            const choice = sessionFor(brief, format.id, dirs);
            if (!choice) return [];
            const { session } = choice;
            const plan = spotlightPlan(session, brief, format);
            const id = `${brief.id}--${hook.id}--${lang}--${format.id}`;
            if (!choice.matched) mismatched.add(id);
            plans.set(id, spotlightRenderPlan(brief, plan));
            reportSpotlight(brief, session, plan);
            const hits = interactionClips(spotlightSoundCues(plan, grid.fps), dirs);
            /*
              With no brand file the kicker is the only name in the piece — and it
              carries the version, which an end card must not. Left empty here, the
              recipe's own strip takes the name out of it; filled with the whole
              hook, that strip could never run and every unbranded end card read
              "Acme v1.2.0".
            */
            const fallback = { ...FALLBACK_SPOTLIGHT, name: "" };
            return [{
              id,
              format,
              fps: brief.fps ?? 30,
              durationInFrames: plan.durationInFrames,
              timeline,
              audio: [...music, ...bedClips(beds, brief, grid, id, plan.durationInFrames, dirs, bedVolume), ...hits],
              element: () => (
                <ThemeProvider direction={dirs.direction}><FeatureSpotlight
                  brief={brief}
                  hook={hook}
                  lang={lang}
                  format={format}
                  session={session}
                  desktop={takeNamed(brief, TAKE_DESKTOP, dirs)}
                  mobile={takeNamed(brief, TAKE_MOBILE, dirs)}
                  plan={plan}
                  brand={dirs.brand ?? fallback}
                  {...(pulse ? { pulse } : {})}
                /></ThemeProvider>
              ),
            }];
          });
        }

        if (brief.recipe === "ReleaseTrailer") {
          return formatsFor(brief, options.formats).flatMap((format): CompositionDef[] => {
            const choice = sessionFor(brief, format.id, dirs);
            if (!choice) return [];
            const { session } = choice;
            const plan = trailerPlan(session, brief, lang);
            const shots = trailerShots(plan, motionOf(dirs), format, session);
            const id = `${brief.id}--${hook.id}--${lang}--${format.id}`;
            if (!choice.matched) mismatched.add(id);
            plans.set(id, trailerRenderPlan(brief, plan));
            const hits = interactionClips(trailerSoundCues(session, plan, grid.fps), dirs);
            return [
              {
                id,
                format,
                fps: brief.fps ?? 30,
                durationInFrames: plan.durationInFrames,
                timeline,
                audio: [...music, ...bedClips(beds, brief, grid, id, plan.durationInFrames, dirs, bedVolume), ...hits],
                element: () => (
                  <ThemeProvider direction={dirs.direction}><ReleaseTrailer brief={brief} hook={hook} lang={lang} format={format} session={session} plan={plan} shots={shots} {...(pulse ? { pulse } : {})} /></ThemeProvider>
                ),
              },
            ];
          });
        }

        if (brief.recipe === "ScreenCast") {
          return formatsFor(brief, options.formats).flatMap((format): CompositionDef[] => {
            const choice = sessionFor(brief, format.id, dirs);
            if (!choice) return [];
            const { session } = choice;
            const plan = castPlan(session, brief);
            const shots = castShots(session, brief, plan, motionOf(dirs), format);
            const id = `${brief.id}--${hook.id}--${lang}--${format.id}`;
            if (!choice.matched) mismatched.add(id);
            plans.set(id, castRenderPlan(brief, plan, shots));
            return [
              {
                id,
                format,
                fps: brief.fps ?? 30,
                durationInFrames: plan.durationInFrames,
                timeline,
                audio: [...music, ...bedClips(beds, brief, grid, id, plan.durationInFrames, dirs, bedVolume), ...interactionClips(castSoundCues(session, plan, grid.fps), dirs)],
                element: () => (
                  <ThemeProvider direction={dirs.direction}><ScreenCast
                    brief={brief}
                    hook={hook}
                    lang={lang}
                    format={format}
                    session={session}
                    plan={plan}
                    shots={shots}
                    {...(pulse ? { pulse } : {})}
                  /></ThemeProvider>
                ),
              },
            ];
          });
        }

        const duration = recipe.duration(brief);
        return formatsFor(brief, options.formats).map((format): CompositionDef => {
          const id = `${brief.id}--${hook.id}--${lang}--${format.id}`;
          plans.set(id, planFor(brief, duration, voiced?.lines));
          if (voiced && voiced.words.length > 0) wordsOf.set(id, voiced.words);
          return {
            id,
            format,
            fps: brief.fps ?? 30,
            durationInFrames: duration,
            timeline,
            audio: [...music, ...bedClips(beds, brief, grid, id, duration, dirs, voiced ? BED_UNDER_VOICE_SHORT : 0.9), ...(voiced?.clips ?? [])],
            element: () => (
              <ThemeProvider direction={dirs.direction}><Component brief={brief} hook={hook} lang={lang} format={format} voiced={voiced ? { words: voiced.words } : undefined} /></ThemeProvider>
            ),
          };
        });
      }),
    );
  });

  return { compositions, mismatched, chapters, plans, beds, words: wordsOf };
}

/* ---------- The repository's own matrix, as every existing caller imports it ---------- */

const repo = buildCompositions(repoBriefs, REPO_DIRS);

export const assetsDir = REPO_DIRS.assets;
export const sessionsDir = REPO_DIRS.sessions;
export const compositions = repo.compositions;
export const mismatched = repo.mismatched;
export const chapters = repo.chapters;
export const plans = repo.plans;
export const words = repo.words;
export const beds = repo.beds;
