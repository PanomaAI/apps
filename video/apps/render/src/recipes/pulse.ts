/*
  The music's pulse, one number per frame, for a picture that moves with it.

  A track someone brings is analysed once (packages/audio/src/beat.ts) and conformed to
  the grid, and what reaches the render is this: every beat on the TIMELINE with how hard
  it hit, and two loudness envelopes sampled per frame. Nothing here knows about the
  file, the head cut or the stretch — those were resolved when the pulse was written —
  so a recipe reads a frame and gets a number.

  What "dancing" is, and how much of it:

  - On every beat the picture punches in and settles: an impulse that lands on the
    beat's frame and decays with a 100 ms time constant, which at 140 BPM is gone well
    before the next one. The strongest kick of the piece moves the scale by
    `DANCE_SCALE` (2%), a downbeat by half as much again. Two per cent is the range
    where a pulse is felt as a pulse; at five the product looks dropped on a table.
  - Between beats the loudness envelope breathes the stage's lights (Backdrop), not
    the product: the product must hold still to be read, the lights may not.
  - A voiced piece keeps a third of it (`DANCE_UNDER_VOICE`). The words are what a
    tutorial is for, and a picture that pumps under a sentence pulls the eye off it.

  Every function is pure and a pulse of `undefined` is a still picture, so a recipe
  can call these unconditionally and a brief without music renders exactly as before.
*/
import { readFileSync } from "node:fs";

export type PulseBeat = { frame: number; strength: number; down: boolean };

export type Pulse = {
  fps: number;
  /** One value per frame, 0..1: the piece's loudness with a VU needle's ballistics. */
  energy: number[];
  /** The band below 200 Hz alone, 0..1, per frame: where the kick is. */
  low: number[];
  /** Every beat on the timeline, in order, with how hard it hit (0..1 of the strongest) and whether it starts a bar. */
  beats: PulseBeat[];
};

export type PulseAt = {
  /** The impulse of the last beat, 0..1: its strength on its frame, decaying after. */
  beat: number;
  /** The same, for downbeats only. */
  down: number;
  energy: number;
  low: number;
};

export const STILL: PulseAt = { beat: 0, down: 0, energy: 0, low: 0 };

/** Scale a kick at full strength adds to the picture. */
export const DANCE_SCALE = 0.02;
/** How much of a beat is left after this many seconds: e^-1. */
export const BEAT_DECAY_S = 0.1;
/** What a voiced piece keeps of the dance. */
export const DANCE_UNDER_VOICE = 1 / 3;

/** The last beat at or before `frame`, by binary search: this runs once per frame per recipe. */
function lastBeat(beats: PulseBeat[], frame: number): PulseBeat | undefined {
  let lo = 0;
  let hi = beats.length - 1;
  let found: PulseBeat | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = beats[mid]!;
    if (b.frame <= frame) {
      found = b;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export function pulseAt(pulse: Pulse | undefined, frame: number): PulseAt {
  if (!pulse) return STILL;
  /*
    Past the end of the analysed audio there is nothing to breathe with: a track shorter
    than the piece used to hold its last loudness for ever, so the stage kept glowing at
    whatever the music was doing when it ran out. Before the start the first value stands,
    which is where the fade-in is.
  */
  const at = (arr: number[]) => (frame >= arr.length ? 0 : (arr[Math.max(0, frame)] ?? 0));
  const b = lastBeat(pulse.beats, frame);
  if (!b) return { beat: 0, down: 0, energy: at(pulse.energy), low: at(pulse.low) };
  const age = (frame - b.frame) / pulse.fps;
  const beat = b.strength * Math.exp(-age / BEAT_DECAY_S);
  return { beat, down: b.down ? beat : 0, energy: at(pulse.energy), low: at(pulse.low) };
}

/**
 * The camera, punched in by the beat. Only ever larger, so a framing that kept the
 * recording's edge out of the frame still does; `gain` is 1 for a music-led piece and
 * `DANCE_UNDER_VOICE` under narration.
 */
export function dancedZoom<Z extends { scale: number }>(zoom: Z, at: PulseAt, gain = 1): Z {
  const punch = DANCE_SCALE * gain * (at.beat + 0.5 * at.down);
  return punch > 0 ? { ...zoom, scale: zoom.scale * (1 + punch) } : zoom;
}

/** A card or a title, pumped by the beat: the same impulse, on a plain scale factor. */
export function dancedScale(at: PulseAt, gain = 1): number {
  return 1 + DANCE_SCALE * gain * (at.beat + 0.5 * at.down);
}

/*
  The procedural bed's pulse, from the grid it was made from. The bed's kick is on every
  beat by construction (docs/music.md), the downbeat's hat rings longer, and nothing in it
  is louder or quieter from bar to bar — so the pulse is the grid: a beat every
  `beatFrames`, downbeats at full strength and the rest a little under, and a loudness
  that sits where the lights are exactly what they were. A piece asked to dance with no
  track brought dances to this.
*/
export const BED_BEAT_STRENGTH = 0.8;
export function bedPulse(grid: { fps: number; beatFrames: number; start: number }, frames: number): Pulse {
  const beats: PulseBeat[] = [];
  for (let n = 0; grid.start + n * grid.beatFrames < frames; n++) {
    beats.push({ frame: grid.start + n * grid.beatFrames, strength: n % 4 === 0 ? 1 : BED_BEAT_STRENGTH, down: n % 4 === 0 });
  }
  return { fps: grid.fps, energy: [0.5], low: [0.5], beats };
}

const levelled = new WeakMap<Pulse, Pulse>();

/**
 * The pulse at the piece's level. "full" is the pulse as analysed; "light" keeps a third of
 * every beat (the words are what a narrated piece is for); "off" — or no level — is no pulse
 * at all. Baked in here so every recipe dances at gain 1 and knows nothing about levels.
 */
export function pulseFor(pulse: Pulse | undefined, dance: "off" | "light" | "full" | undefined): Pulse | undefined {
  if (!pulse || !dance || dance === "off") return undefined;
  if (dance === "full") return pulse;
  const hit = levelled.get(pulse);
  if (hit) return hit;
  const light: Pulse = { ...pulse, beats: pulse.beats.map((b) => ({ ...b, strength: b.strength * DANCE_UNDER_VOICE })) };
  levelled.set(pulse, light);
  return light;
}

const loaded = new Map<string, Pulse>();

/** The pulse file the conform wrote, read once per path. */
export function loadPulse(path: string): Pulse {
  const hit = loaded.get(path);
  if (hit) return hit;
  const pulse = JSON.parse(readFileSync(path, "utf8")) as Pulse;
  loaded.set(path, pulse);
  return pulse;
}
