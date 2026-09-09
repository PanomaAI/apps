/*
  A music bed generated from the beat grid: the cut is on the music by construction,
  and nobody's rights are involved.

  The generated bed (Eleven Music) is plan-gated — a credit line on the free plan,
  commercial rights from a per-plan table, and YouTube lists AI music among the things
  that need the "altered or synthetic" disclosure
  (https://elevenlabs.io/eleven-music-model-specific-terms). A library track is a
  licence to audit and a Content ID claim waiting to happen. A bed synthesised here
  has no author but this file, and its kick lands on `grid.beat(n)` because both are
  computed from the same tempo (the reference video in grid.ts was NOT cut to its music).

  The output is a stereo 16-bit WAV, byte-identical across runs for the same options:
  every random choice comes from a seeded PRNG and there is no clock anywhere. The peak
  is left at -6 dBFS; `panoma-video master` runs loudnorm on the finished mix. Read top to
  bottom: primitives, four voices, a four-bar loop rendered once and tiled, then
  accents, fades and normalisation over the whole piece.
*/
import { Buffer } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";

export type BedStyle = "calm" | "pulse" | "dark" | "bright";

export type BedOptions = {
  bpm: number;
  seconds: number;
  style: BedStyle;
  /** Seeds every random choice. Same seed, same bytes. Default 1. */
  seed?: number;
  /** Default 48000, the rate the whole engine mixes at. */
  sampleRate?: number;
  /** "A minor", "C", "F# major", "Bbm". Default "A minor". */
  key?: string;
  /** Seconds where a card lands: a soft noise swell into a pitched hit at each. */
  accents?: number[];
  /*
    Hats per beat. Pass `grid.beatFrames / grid.tickFrames` so the hat coincides with
    the visual accents the grid allows (3 at 120 BPM / 30 fps, 2 at 24 fps). Default 2.
  */
  ticksPerBeat?: number;
};

/* ---------- the four styles: density and brightness, nothing else changes ---------- */

type StyleSpec = {
  /** Scale degrees (0-based) of the four bars. */
  progression: readonly number[];
  kick: number;
  /** Where the kick's pitch drop starts, in Hz; it always lands at 50. */
  kickTop: number;
  hat: number;
  /** "tick": every tick; "offbeat": the ticks between beats only. */
  hats: "tick" | "offbeat";
  /** Low-pass on the hat noise; the darker the style, the lower. */
  hatLp: number;
  bass: number;
  bassWave: "tri" | "saw";
  /** A bass note on the last tick of the bar, leading into the next downbeat. */
  bassPickup: boolean;
  pad: number;
  padCutoff: number;
  /** Beats the pad takes to reach full level after a chord change. */
  padAttackBeats: number;
  /** An extra pad pair an octave up (bright) — width without volume. */
  padOctave: boolean;
  /*
    Saw share of each pad voice, 0-1. A triangle's harmonics fall at 12 dB/octave, so
    a cutoff moved from 1 to 4.5 kHz changes almost nothing; a saw (6 dB/octave)
    gives the filter something to shape, and is what "bright" sounds like.
  */
  padSaw: number;
};

/*
  I–vi–IV–V is the "50s progression"; i–VI–III–VII is its minor-key cousin that most
  dark electronic music sits on (Am F C G). Both are built from scale degrees below so
  the chord qualities follow the key's mode automatically.
*/
const POP: readonly number[] = [0, 5, 3, 4];
const DARK: readonly number[] = [0, 5, 2, 6];

const STYLES: Record<BedStyle, StyleSpec> = {
  calm: { progression: POP, kick: 0.8, kickTop: 110, hat: 0.3, hats: "offbeat", hatLp: 9000, bass: 0.38, bassWave: "tri", bassPickup: false, pad: 0.42, padCutoff: 1400, padAttackBeats: 1.0, padOctave: false, padSaw: 0 },
  pulse: { progression: POP, kick: 1.0, kickTop: 120, hat: 0.6, hats: "tick", hatLp: 12000, bass: 0.5, bassWave: "tri", bassPickup: true, pad: 0.32, padCutoff: 2600, padAttackBeats: 0.5, padOctave: false, padSaw: 0.15 },
  dark: { progression: DARK, kick: 1.0, kickTop: 100, hat: 0.4, hats: "tick", hatLp: 7000, bass: 0.55, bassWave: "saw", bassPickup: false, pad: 0.36, padCutoff: 1000, padAttackBeats: 0.7, padOctave: false, padSaw: 0.3 },
  bright: { progression: POP, kick: 0.9, kickTop: 120, hat: 0.7, hats: "tick", hatLp: 16000, bass: 0.45, bassWave: "tri", bassPickup: true, pad: 0.30, padCutoff: 4500, padAttackBeats: 0.4, padOctave: true, padSaw: 0.4 },
};

/* ---------- the key: a root and a mode, parsed from "A minor" and friends ---------- */

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

function parseKey(key: string): { root: number; scale: number[]; slug: string } {
  const m = /^\s*([A-Ga-g])\s*([#b♯♭]?)\s*(minor|major|min|maj|m|M)?\s*$/.exec(key);
  if (!m) throw new Error(`Cannot read the key "${key}". Write it like "A minor", "C", "F# major" or "Bbm".`);
  const letter = m[1]!.toUpperCase();
  const acc = m[2] ?? "";
  const modeWord = m[3] ?? "";
  const minor = modeWord === "m" || modeWord.toLowerCase().startsWith("min");
  const pc = (PITCH[letter]! + (acc === "#" || acc === "♯" ? 1 : acc ? -1 : 0) + 12) % 12;
  const slug = `${letter.toLowerCase()}${acc === "#" || acc === "♯" ? "-sharp" : acc ? "-flat" : ""}-${minor ? "minor" : "major"}`;
  return { root: pc, scale: minor ? MINOR : MAJOR, slug };
}

/** A440 (ISO 16): MIDI note 69 is 440 Hz. */
const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
/** The pad root sits in G3-F#4 (196-370 Hz), a register a triangle fills without mud. */
const padRootOf = (pitchClass: number): number => 55 + ((pitchClass - 7 + 12) % 12);

/** A triad stacked in thirds on scale degree `d`, as semitones above the key root. */
function triad(scale: number[], d: number): number[] {
  return [0, 2, 4].map((step) => {
    const i = d + step;
    return scale[i % 7]! + 12 * Math.floor(i / 7);
  });
}

/* ---------- the primitives ---------- */

/*
  mulberry32, by Tommy Ettinger, public domain
  (https://gist.github.com/tommyettinger/46a874533244883189143505d203312c). 32-bit
  state, good enough for noise and for jitter, and the same sequence on every engine.
*/
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/*
  One-pole filters, the gentlest slope there is (6 dB/octave), applied twice where a
  voice needs more. Coefficient from J. O. Smith, "Introduction to Digital Filters",
  first-order lowpass: a = 1 - e^(-2π fc / fs). A highpass is the input minus its lowpass.

  `loop` runs the filter over the buffer twice and keeps the second pass: a filter
  over a LOOP starts from a silent state, so its opening milliseconds would not match
  its closing ones and the seam would be audible every time the loop came round.
*/
function lowpass(x: Float64Array, fc: number, sr: number, passes = 1, loop = false): void {
  const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
  for (let p = 0; p < passes; p++) {
    let y = 0;
    for (let round = 0; round < (loop ? 2 : 1); round++) {
      for (let i = 0; i < x.length; i++) x[i] = y += a * (x[i]! - y);
    }
  }
}
function highpass(x: Float64Array, fc: number, sr: number, passes = 1): void {
  const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
  for (let p = 0; p < passes; p++) {
    let y = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i]!;
      y += a * (v - y);
      x[i] = v - y;
    }
  }
}

/** Triangle from a phase in [0,1): -1 at 0, +1 at 0.5. */
const tri = (p: number): number => 4 * Math.abs(p - Math.floor(p) - 0.5) - 1;
const saw = (p: number): number => 2 * (p - Math.floor(p)) - 1;

/** A trapezoid envelope over `n` samples: linear attack, hold, linear release. */
function envelope(n: number, attack: number, release: number): Float64Array {
  const e = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const up = attack > 0 ? Math.min(1, i / attack) : 1;
    const down = release > 0 ? Math.min(1, (n - 1 - i) / release) : 1;
    e[i] = Math.min(up, down);
  }
  return e;
}

type Stereo = { l: Float64Array; r: Float64Array };
const stereo = (n: number): Stereo => ({ l: new Float64Array(n), r: new Float64Array(n) });

/*
  Add a mono segment into a bus at `at`, with a constant-power pan in [-1, 1]. `wrap`
  is the loop's length: a tail that runs past the end of the loop lands at its start,
  which is where it will be heard once the loop is tiled.
*/
function mix(bus: Stereo, seg: Float64Array, at: number, gain: number, pan = 0, wrap = 0): void {
  const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  const n = bus.l.length;
  for (let i = 0; i < seg.length; i++) {
    let j = at + i;
    if (wrap) j %= wrap;
    else if (j < 0 || j >= n) continue;
    bus.l[j]! += seg[i]! * gl;
    bus.r[j]! += seg[i]! * gr;
  }
}

/* ---------- the voices ---------- */

/*
  Kick: a sine whose pitch falls from `top` to 50 Hz with a time constant of 35 ms and
  whose level decays over ~110 ms — the analogue bass-drum recipe in Gordon Reid's
  "Synth Secrets" part 34 (Sound On Sound, 2002), where the pitch envelope is the
  whole instrument. A tanh stage rounds the first cycles so the transient reads as a
  thump and not as a test tone.
*/
function kick(sr: number, top: number): Float64Array {
  const n = Math.round(0.4 * sr);
  const out = new Float64Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 50 + (top - 50) * Math.exp(-t / 0.035);
    phase += f / sr;
    const amp = Math.exp(-t / 0.11) * Math.min(1, t / 0.002);
    out[i] = Math.tanh(1.6 * Math.sin(2 * Math.PI * phase)) / Math.tanh(1.6) * amp;
  }
  return out;
}

/*
  Hat: white noise with an exponential decay, highpassed twice at 5.5 kHz — a closed
  hat carries almost nothing below 5 kHz (Reid, "Synth Secrets" part 36, on cymbals as
  filtered noise) — and lowpassed at the style's ceiling. A downbeat hat rings a
  little longer (30 ms vs 18 ms), which is what "velocity" means on a hi-hat.
*/
function hat(sr: number, random: () => number, tau: number, lp: number): Float64Array {
  const n = Math.round(0.09 * sr);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = (random() * 2 - 1) * Math.exp(-i / sr / tau);
  highpass(out, 5500, sr, 2);
  lowpass(out, lp, sr);
  return out;
}

/* Bass: one oscillator, 5 ms attack, a decay toward 55% so the note breathes, a
   60 ms release. The one-pole at 700 Hz on the bus takes the saw's edge off. */
function bassNote(sr: number, freq: number, seconds: number, wave: "tri" | "saw"): Float64Array {
  const n = Math.round(seconds * sr);
  const out = new Float64Array(n);
  const env = envelope(n, Math.round(0.005 * sr), Math.round(0.06 * sr));
  const osc = wave === "saw" ? saw : tri;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = osc((t * freq) % 1) * env[i]! * (0.55 + 0.45 * Math.exp(-t / 0.35));
  }
  return out;
}

/*
  Pad voice: a triangle detuned by a few cents from its partner. The pair is spread
  by about the just-noticeable difference of pitch (5-6 cents, Zwicker & Fastl,
  "Psychoacoustics", ch. 7): enough to beat slowly and read as width, not enough to
  read as out of tune. The release overlaps the next chord by a whole beat.
*/
function padVoice(sr: number, freq: number, hold: number, attack: number, release: number, phase0: number, sawMix: number): Float64Array {
  const n = Math.round((hold + release) * sr);
  const out = new Float64Array(n);
  const env = envelope(n, Math.round(attack * sr), Math.round(release * sr));
  for (let i = 0; i < n; i++) {
    const p = phase0 + (i / sr) * freq;
    out[i] = ((1 - sawMix) * tri(p) + sawMix * saw(p)) * env[i]!;
  }
  return out;
}

/* ---------- the loop: four bars, rendered once ---------- */

function renderLoop(o: Required<Omit<BedOptions, "accents">>, spec: StyleSpec, random: () => number): Stereo {
  const sr = o.sampleRate;
  const beat = 60 / o.bpm;
  const bar = 4 * beat;
  const tick = beat / o.ticksPerBeat;
  const n = Math.round(4 * bar * sr);
  const drums = stereo(n);
  const bass = stereo(n);
  const pad = stereo(n);
  const { root, scale } = parseKey(o.key);
  const padRoot = padRootOf(root);
  /* The bass an octave below, folded into D2-C#3 (73-139 Hz): above the kick's 50 Hz. */
  const bassRoot = padRoot - 12 - (padRoot - 12 >= 50 ? 12 : 0);

  const kickSeg = kick(sr, spec.kickTop);
  for (let b = 0; b < 16; b++) mix(drums, kickSeg, Math.round(b * beat * sr), spec.kick, 0, n);

  const ticks = 16 * o.ticksPerBeat;
  for (let t = 0; t < ticks; t++) {
    const onBeat = t % o.ticksPerBeat === 0;
    if (spec.hats === "offbeat" && onBeat) continue;
    /* Velocity: the downbeat tick leads, the rest sit back, and ±8% of jitter keeps
       sixteen identical hats from sounding like a metronome. */
    const velocity = (onBeat ? 0.9 : 0.55) * (1 + (random() - 0.5) * 0.16);
    const seg = hat(sr, random, onBeat ? 0.03 : 0.018, spec.hatLp);
    mix(drums, seg, Math.round(t * tick * sr), spec.hat * velocity, 0.15, n);
  }

  const attack = spec.padAttackBeats * beat;
  for (let b = 0; b < 4; b++) {
    const chord = triad(scale, spec.progression[b]!);
    const at = b * bar;
    /* Bass: root on 1, fifth on 3, both an octave under the pad. */
    mix(bass, bassNote(sr, hz(bassRoot + chord[0]!), 1.6 * beat, spec.bassWave), Math.round(at * sr), spec.bass, 0, n);
    mix(bass, bassNote(sr, hz(bassRoot + chord[2]!), 1.6 * beat, spec.bassWave), Math.round((at + 2 * beat) * sr), spec.bass, 0, n);
    if (spec.bassPickup) {
      const next = triad(scale, spec.progression[(b + 1) % 4]!)[0]!;
      mix(bass, bassNote(sr, hz(bassRoot + next), tick, spec.bassWave), Math.round((at + bar - tick) * sr), spec.bass * 0.7, 0, n);
    }
    /* Pad: two detuned voices per chord note, one left and one right. */
    const notes = spec.padOctave ? [...chord, chord[0]! + 12] : chord;
    for (const semis of notes) {
      const f = hz(padRoot + semis);
      const cents = 5 + random() * 2;
      const level = spec.pad / notes.length;
      mix(pad, padVoice(sr, f * 2 ** (-cents / 1200), bar, attack, beat, random(), spec.padSaw), Math.round(at * sr), level, -0.5, n);
      mix(pad, padVoice(sr, f * 2 ** (cents / 1200), bar, attack, beat, random(), spec.padSaw), Math.round(at * sr), level, 0.5, n);
    }
  }
  for (const ch of [pad.l, pad.r]) lowpass(ch, spec.padCutoff, sr, 2, true);
  for (const ch of [bass.l, bass.r]) lowpass(ch, 700, sr, 1, true);

  /*
    Sidechain: the tonal buses drop 4 dB for 80 ms after every kick and recover over
    the next 100 ms. Four decibels is a breath, not a pump — the kick gets its own
    space and nobody hears the pad move. (Chosen by ear; the brief asked for ~4 dB.)
  */
  const duck = new Float64Array(n).fill(1);
  const duckFloor = 10 ** (-4 / 20);
  const hold = Math.round(0.08 * sr);
  const recover = Math.round(0.1 * sr);
  for (let b = 0; b < 16; b++) {
    const at = Math.round(b * beat * sr);
    for (let i = 0; i < hold + recover; i++) {
      const g = i < hold ? duckFloor : duckFloor + (1 - duckFloor) * ((i - hold) / recover);
      const j = (at + i) % n;
      duck[j] = Math.min(duck[j]!, g);
    }
  }
  const out = stereo(n);
  for (let i = 0; i < n; i++) {
    out.l[i] = drums.l[i]! + (bass.l[i]! + pad.l[i]!) * duck[i]!;
    out.r[i] = drums.r[i]! + (bass.r[i]! + pad.r[i]!) * duck[i]!;
  }
  return out;
}

/* ---------- accents: a swell into a soft pitched hit where a card lands ---------- */

function accent(bus: Stereo, at: number, sr: number, padRootHz: number, random: () => number): void {
  /* 450 ms of noise rising as t^2.5 and stopping dead on the accent: the hit takes
     over. Two independent noises, one a side, so the swell is wide and the hit is not. */
  const swellN = Math.round(0.45 * sr);
  for (const pan of [-0.7, 0.7]) {
    const swell = new Float64Array(swellN);
    for (let i = 0; i < swellN; i++) swell[i] = (random() * 2 - 1) * (i / swellN) ** 2.5;
    highpass(swell, 1000, sr, 2);
    lowpass(swell, 6000, sr);
    mix(bus, swell, at - swellN, 0.35, pan);
  }
  /* The hit: the key's root an octave above the pad, three partials, 300 ms decay. */
  const hitN = Math.round(0.8 * sr);
  const hit = new Float64Array(hitN);
  const f = padRootHz * 2;
  for (let i = 0; i < hitN; i++) {
    const t = i / sr;
    const w = 2 * Math.PI * f * t;
    hit[i] = (Math.sin(w) + 0.3 * Math.sin(2 * w) + 0.12 * Math.sin(3 * w)) * Math.exp(-t / 0.3) * Math.min(1, t / 0.003);
  }
  mix(bus, hit, at, 0.4);
}

/* ---------- the piece ---------- */

/** Render the bed as WAV bytes: stereo, 16-bit, `sampleRate`, peak at -6 dBFS. */
export function renderBed(opts: BedOptions): Buffer {
  const o = {
    bpm: opts.bpm,
    seconds: opts.seconds,
    style: opts.style,
    seed: opts.seed ?? 1,
    sampleRate: opts.sampleRate ?? 48000,
    key: opts.key ?? "A minor",
    ticksPerBeat: opts.ticksPerBeat ?? 2,
  };
  if (!(o.bpm >= 40 && o.bpm <= 240)) throw new Error(`A bed needs a tempo between 40 and 240 BPM, not ${o.bpm}.`);
  if (!(o.seconds > 0 && Number.isFinite(o.seconds))) throw new Error(`A bed needs a positive length in seconds, not ${o.seconds}.`);
  if (!Number.isInteger(o.ticksPerBeat) || o.ticksPerBeat < 1) throw new Error(`ticksPerBeat must be a whole number of 1 or more, not ${o.ticksPerBeat}.`);
  const spec = STYLES[o.style];
  if (!spec) throw new Error(`Unknown bed style "${o.style}". Styles: ${Object.keys(STYLES).join(", ")}.`);
  const random = rng(o.seed);
  const sr = o.sampleRate;

  const loop = renderLoop(o, spec, random);
  const total = Math.round(o.seconds * sr);
  const out = stereo(total);
  for (let i = 0; i < total; i++) {
    const j = i % loop.l.length;
    out.l[i] = loop.l[j]!;
    out.r[i] = loop.r[j]!;
  }

  const padRootHz = hz(padRootOf(parseKey(o.key).root));
  for (const s of opts.accents ?? []) {
    if (Number.isFinite(s) && s >= 0 && s <= o.seconds) accent(out, Math.round(s * sr), sr, padRootHz, random);
  }

  /* In over one beat, out over one bar: the entry is felt on the downbeat after it,
     and the exit is a bar of settling rather than a cut. */
  const beat = 60 / o.bpm;
  const fade = envelope(total, Math.round(beat * sr), Math.round(4 * beat * sr));
  let peak = 0;
  for (let i = 0; i < total; i++) {
    out.l[i]! *= fade[i]!;
    out.r[i]! *= fade[i]!;
    if (!Number.isFinite(out.l[i]!) || !Number.isFinite(out.r[i]!)) throw new Error(`The bed produced a non-finite sample at ${i}.`);
    peak = Math.max(peak, Math.abs(out.l[i]!), Math.abs(out.r[i]!));
  }
  /*
    -6 dBFS of headroom. The master runs loudnorm to -14 LUFS with a -1 dBTP ceiling
    (apps/cli/src/master.ts, EBU R128 / the platform targets); a bed already at full
    scale would only give its limiter work to do.
  */
  const gain = peak > 0 ? 10 ** (-6 / 20) / peak : 0;
  return wav(out, gain, sr);
}

/** RIFF/WAVE, PCM 16-bit interleaved stereo — the 44-byte header everyone reads. */
function wav(bus: Stereo, gain: number, sr: number): Buffer {
  const frames = bus.l.length;
  const data = frames * 4;
  const buf = Buffer.alloc(44 + data);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + data, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22); // channels
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28); // byte rate = block align (4) × rate
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(data, 40);
  let p = 44;
  for (let i = 0; i < frames; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(bus.l[i]! * gain * 32767))), p);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(bus.r[i]! * gain * 32767))), p + 2);
    p += 4;
  }
  return buf;
}

/** Render and write. Creates the directory; returns the bytes written. */
export function writeBed(opts: BedOptions, path: string): number {
  const dir = path.replace(/[\\/][^\\/]*$/, "");
  if (dir && dir !== path) mkdirSync(dir, { recursive: true });
  const bytes = renderBed(opts);
  writeFileSync(path, bytes);
  return bytes.length;
}

/*
  A stable file name for the cache and the assets directory: `bed-120-calm-a-minor-30s.wav`.
  The seed appears only when it is not the default, so the common name stays short.
  Accents and ticksPerBeat are NOT in the name — callers that vary them must cache by
  request hash (packages/core/src/cache.ts), which is what `panoma-video assets` does anyway.
*/
export function bedName(opts: BedOptions): string {
  const { slug } = parseKey(opts.key ?? "A minor");
  const seed = opts.seed ?? 1;
  return `bed-${opts.bpm}-${opts.style}-${slug}-${opts.seconds}s${seed === 1 ? "" : `-s${seed}`}.wav`;
}
