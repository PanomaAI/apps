/*
  Beat analysis of a real track, with no dependency.

  The procedural bed (bed.ts) is on the grid by construction. A track someone brings —
  their own music, a licensed piece — is not, and "cut to the music" needs to know where
  the music actually is. This module reads the file and answers: the tempo, every beat,
  which beats start the bars, how hard each one hits, and how loud the piece is from
  moment to moment, so the picture can move with it.

  The method is the textbook one and every step is measurable:
    1. ffmpeg decodes to mono float at 22,050 Hz.
    2. A short-window STFT (46 ms, hopped every 11.6 ms) feeds a 40-band log-spaced
       filterbank; the positive change of each band's log energy, summed, is the
       spectral flux — where something started (Bello et al., "A tutorial on onset
       detection in music signals", 2005).
    3. The flux minus its local mean, half-wave rectified, is the onset envelope.
    4. The tempo is the envelope's autocorrelation peak under a log-Gaussian prior
       centred where people tap, 120 BPM, one octave wide (Ellis, "Beat tracking by
       dynamic programming", J. New Music Research 2007).
    5. The beats are the path through the envelope that maximises onset strength while
       keeping the interval near the period — Ellis's dynamic programme, tightness 400.
    6. The tempo is then refined as the slope of a line through the beats, which is
       finer than any single frame.
    7. The downbeat is the beat phase (of four) where the low band and the onsets land
       most — a heuristic that is right for four-on-the-floor and unsure elsewhere.
    8. How hard each beat hit is the peak of the low band over its frame ±2, not one
       frame of the onset envelope: see `peakAround`.
    9. Two envelopes with a VU needle's ballistics — fast attack, slow release —
       for the whole band and for the band below 200 Hz, where the kick lives.

  Measured on a synthesised click track at 128 BPM (tests/beat.test.ts): tempo exact,
  every beat within 18 ms of the truth, which is under a frame at 30 fps, and 48 kicks
  written at one gain read within 0.028 of each other.

  Nothing here spreads an array into a call. Every array has an element per frame, and
  V8 throws above 124,330 arguments — 24.1 minutes of music, which a mix or an album side
  passes without being unusual.
*/
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export const ANALYSIS_RATE = 22050;
const WINDOW = 1024;
const HOP = 256;
/** Frames per second of every envelope below. */
export const ENVELOPE_HZ = ANALYSIS_RATE / HOP;
/** A frame is stamped at the centre of its window, in frames. */
const CENTRE = WINDOW / HOP / 2;

export type TrackAnalysis = {
  seconds: number;
  bpm: number;
  /** Seconds where the beats fall, in order. */
  beats: number[];
  /** Onset strength at each beat, 0-1 (relative to the strongest beat). */
  strength: number[];
  /** Which beat (0-3) the bars start on: beats[downbeat + 4k] are downbeats. */
  downbeat: number;
  /** Loudness envelope, 0-1, sampled at `envelopeHz`. */
  energy: number[];
  /** The low band (< 200 Hz) alone, 0-1, same sampling: where the kick is. */
  low: number[];
  envelopeHz: number;
};

export async function decodeMono(path: string): Promise<Float32Array> {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", path, "-ac", "1", "-ar", String(ANALYSIS_RATE), "-f", "f32le", "-"], { encoding: "buffer", maxBuffer: 512 * 1024 * 1024 });
  const buf = stdout as unknown as Buffer;
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

/* ---------- FFT, radix-2, in place ---------- */

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]!; re[i] = re[j]!; re[j] = t;
      t = im[i]!; im[i] = im[j]!; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr; im[b] = im[a]! - ti;
        re[a] = re[a]! + tr; im[a] = im[a]! + ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/* ---------- a log-spaced filterbank, 40 bands from 30 Hz to 10 kHz ---------- */

const BANDS = 40;
function filterbank(): { lo: number; hi: number }[] {
  const binHz = ANALYSIS_RATE / WINDOW;
  const edges: number[] = [];
  for (let b = 0; b <= BANDS; b++) edges.push(30 * Math.pow(10000 / 30, b / BANDS));
  return edges.slice(0, -1).map((f, i) => ({ lo: Math.max(1, Math.floor(f / binHz)), hi: Math.max(Math.floor(f / binHz) + 1, Math.floor(edges[i + 1]! / binHz)) }));
}

type Frames = { flux: Float64Array; energy: Float64Array; low: Float64Array; count: number };

function analyseFrames(x: Float32Array): Frames {
  const count = Math.max(1, Math.floor((x.length - WINDOW) / HOP) + 1);
  const bands = filterbank();
  const window = new Float64Array(WINDOW);
  for (let i = 0; i < WINDOW; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WINDOW);
  const re = new Float64Array(WINDOW), im = new Float64Array(WINDOW);
  const flux = new Float64Array(count), energy = new Float64Array(count), low = new Float64Array(count);
  let prev = new Float64Array(BANDS);
  const lowHi = Math.floor(200 / (ANALYSIS_RATE / WINDOW));
  for (let f = 0; f < count; f++) {
    const at = f * HOP;
    let rms = 0;
    for (let i = 0; i < WINDOW; i++) {
      const s = x[at + i] ?? 0;
      re[i] = s * window[i]!; im[i] = 0; rms += s * s;
    }
    energy[f] = Math.sqrt(rms / WINDOW);
    fft(re, im);
    const mag = new Float64Array(WINDOW / 2);
    for (let k = 0; k < WINDOW / 2; k++) mag[k] = Math.sqrt(re[k]! * re[k]! + im[k]! * im[k]!);
    let lowSum = 0;
    for (let k = 1; k <= lowHi; k++) lowSum += mag[k]! * mag[k]!;
    low[f] = Math.sqrt(lowSum);
    const cur = new Float64Array(BANDS);
    let sum = 0;
    for (let b = 0; b < BANDS; b++) {
      let e = 0;
      for (let k = bands[b]!.lo; k < bands[b]!.hi; k++) e += mag[k]!;
      /* Log compression: a change reads the same loud or quiet. */
      cur[b] = Math.log1p(1000 * e);
      const d = cur[b]! - prev[b]!;
      if (d > 0) sum += d;
    }
    flux[f] = f === 0 ? 0 : sum;
    prev = cur;
  }
  return { flux, energy, low, count };
}

/** Local mean removed and half-wave rectified: what remains is where something started. */
function onsetEnvelope(flux: Float64Array): Float64Array {
  const n = flux.length;
  const half = Math.round(0.1 * ENVELOPE_HZ);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) { s += flux[j]!; c++; }
    out[i] = Math.max(0, flux[i]! - s / c);
  }
  /* Normalise to unit peak-ish (99th percentile), so the DP's tightness means the same on every track. */
  /* A typed copy, sorted numerically without a comparator: one megabyte at 24 minutes where a boxed array is several. */
  const sorted = out.slice().sort();
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || 1;
  for (let i = 0; i < n; i++) out[i] = Math.min(1.5, out[i]! / p99);
  return out;
}

/*
  Tempo: the autocorrelation of the onset envelope over 40-240 BPM, weighted by a
  log-Gaussian prior centred where people tap (Ellis 2007 used 120 BPM, one octave wide).
*/
export function tempoOf(onset: Float64Array): number {
  const n = onset.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += onset[i]!;
  mean /= n;
  const minLag = Math.round((60 / 240) * ENVELOPE_HZ), maxLag = Math.round((60 / 40) * ENVELOPE_HZ);
  let best = -Infinity, bestLag = Math.round((60 / 120) * ENVELOPE_HZ);
  const acf = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += (onset[i]! - mean) * (onset[i - lag]! - mean);
    acf[lag] = s / (n - lag);
  }
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * ENVELOPE_HZ) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 1.0, 2));
    /* Add the two-beat and four-beat lags: a real pulse repeats at its bar as well. */
    const two = lag * 2 <= maxLag ? acf[lag * 2]! : 0;
    const score = (acf[lag]! + 0.5 * two) * prior;
    if (score > best) { best = score; bestLag = lag; }
  }
  return (60 * ENVELOPE_HZ) / bestLag;
}

/* Beats by dynamic programming (Ellis, "Beat Tracking by Dynamic Programming", 2007). */
export function beatsOf(onset: Float64Array, bpm: number, tightness = 400): number[] {
  const n = onset.length;
  const period = (60 * ENVELOPE_HZ) / bpm;
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period * 0.5), hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = 0, bestPrev = -1;
    for (let p = t - hi; p <= t - lo; p++) {
      if (p < 0) continue;
      const cand = score[p]! - tightness * Math.pow(Math.log((t - p) / period), 2);
      if (cand > best) { best = cand; bestPrev = p; }
    }
    score[t] = onset[t]! + best;
    back[t] = bestPrev;
  }
  /* Start from the best score in the last period, so a quiet tail does not choose the end. */
  let end = n - 1;
  for (let t = Math.max(0, n - Math.round(period)); t < n; t++) if (score[t]! > score[end]!) end = t;
  const beats: number[] = [];
  for (let t = end; t >= 0; t = back[t]!) beats.push((t + CENTRE) / ENVELOPE_HZ);
  return beats.reverse();
}

/*
  The tempo the beats actually keep: a least-squares line through them. Each beat is
  quantised to an envelope frame (11.6 ms), so one interval is coarse and their median
  is too; the slope over a hundred of them is fine to a hundredth of a BPM.
*/
export function refineTempo(beats: number[], fallback: number): number {
  const n = beats.length;
  if (n < 3) return fallback;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += beats[i]!; sxx += i * i; sxy += i * beats[i]!; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return slope > 0 ? 60 / slope : fallback;
}

/** Which of the four beat phases carries the low band and the onsets: that is where the bars start. */
export function downbeatOf(beats: number[], onset: Float64Array, low: Float64Array): number {
  const at = (arr: Float64Array, s: number) => arr[Math.max(0, Math.min(arr.length - 1, Math.round(s * ENVELOPE_HZ - CENTRE)))] ?? 0;
  /* Walked, not spread: V8 takes 124,330 arguments before it throws, and this array has one per frame — 24.1 minutes of music. */
  let lowPeak = 1e-9;
  for (let i = 0; i < low.length; i++) if (low[i]! > lowPeak) lowPeak = low[i]!;
  let best = -Infinity, phase = 0;
  for (let k = 0; k < 4; k++) {
    let s = 0;
    for (let i = k; i < beats.length; i += 4) s += at(onset, beats[i]!) + at(low, beats[i]!) / lowPeak;
    if (s > best) { best = s; phase = k; }
  }
  return phase;
}

/*
  How hard a beat hit: the peak of the low band (< 200 Hz) over the beat's frame ±2.

  One frame of the onset envelope was not it. The beat is quantised to an 11.6 ms frame
  and the log-compressed flux peaks a frame either side of it, so the 48 kicks of the test
  fixture — identical samples at one gain, by construction — read 0.469 to 0.942 (spread
  0.473, sd 0.1423) and the picture's 2% punch varied at random from kick to kick. The
  peak of the low band over ±2 frames reads them 0.522 to 0.550 (spread 0.028, sd 0.0088),
  and the quiet kick comes out at 0.549 of the loud one where the fixture wrote 0.55: the
  number now means how hard the music hit.

  Two frames is ±23.2 ms, under a tenth of a beat even at 240 BPM, and it is the width the
  kick's attack needs; at ±1 the same kicks still spread 0.352.
*/
const STRENGTH_HALF = 2;
function peakAround(x: Float64Array, seconds: number, half: number): number {
  const c = Math.round(seconds * ENVELOPE_HZ - CENTRE);
  let m = 0;
  for (let i = Math.max(0, c - half); i <= Math.min(x.length - 1, c + half); i++) m = Math.max(m, x[i]!);
  return m;
}

/** Fast attack, slow release, 0-1 by the 98th percentile: a VU needle, not a waveform. */
function envelope(x: Float64Array, attackMs: number, releaseMs: number): number[] {
  const a = Math.exp(-1000 / (attackMs * ENVELOPE_HZ)), r = Math.exp(-1000 / (releaseMs * ENVELOPE_HZ));
  const out = new Array<number>(x.length);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    y = v > y ? a * y + (1 - a) * v : r * y + (1 - r) * v;
    out[i] = y;
  }
  const sorted = [...out].sort((p, q) => p - q);
  const top = sorted[Math.floor(sorted.length * 0.98)] || 1;
  return out.map((v) => Math.round(Math.min(1, v / top) * 1000) / 1000);
}

/*
  The engine's grid is integer frames per beat (packages/core/src/grid.ts), and a real
  tempo almost never is. The nearest integer is at most half a frame per beat away,
  which at 30 fps means a stretch of at most 4.2% (half a frame of twelve) up to 150 BPM and
  usually under 1%; ffmpeg's atempo keeps the pitch. `ratio` is that atempo factor:
  above 1 the track plays faster.
*/
export function gridTempo(bpm: number, fps: number): { bpm: number; beatFrames: number; ratio: number } {
  const beatFrames = Math.max(1, Math.round((fps * 60) / bpm));
  const gridBpm = (fps * 60) / beatFrames;
  return { bpm: gridBpm, beatFrames, ratio: gridBpm / bpm };
}

/*
  The track as the mix wants it: the head before the first downbeat cut, the tempo
  stretched to the grid's, 48 kHz stereo WAV, no longer than the piece. After this,
  beat n of the file is at exactly n × 60 / grid.bpm seconds.
*/
export async function conformTrack(src: string, dst: string, opts: { head: number; ratio: number; seconds: number }): Promise<void> {
  const filters = [`atrim=start=${opts.head.toFixed(3)}`, "asetpts=PTS-STARTPTS", `atempo=${opts.ratio.toFixed(5)}`].join(",");
  await run("ffmpeg", ["-y", "-v", "error", "-i", src, "-af", filters, "-t", opts.seconds.toFixed(3), "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", dst]);
}

/** A video second, read back into the original file's envelopes after `conformTrack`. */
export function envelopeAt(a: TrackAnalysis, conform: { head: number; ratio: number }, seconds: number): { energy: number; low: number } {
  const i = Math.round((conform.head + seconds * conform.ratio) * a.envelopeHz);
  const pick = (arr: number[]) => arr[Math.max(0, Math.min(arr.length - 1, i))] ?? 0;
  return { energy: pick(a.energy), low: pick(a.low) };
}

export async function analyseTrack(path: string): Promise<TrackAnalysis> {
  const x = await decodeMono(path);
  const frames = analyseFrames(x);
  const onset = onsetEnvelope(frames.flux);
  const bpm = tempoOf(onset);
  const beats = beatsOf(onset, bpm);
  const fine = refineTempo(beats, bpm);
  const strengthRaw = beats.map((s) => peakAround(frames.low, s, STRENGTH_HALF));
  let top = 1e-9;
  for (const v of strengthRaw) if (v > top) top = v;
  return {
    seconds: x.length / ANALYSIS_RATE,
    bpm: Math.round(fine * 100) / 100,
    beats: beats.map((s) => Math.round(s * 1000) / 1000),
    strength: strengthRaw.map((v) => Math.round((v / top) * 1000) / 1000),
    downbeat: downbeatOf(beats, onset, frames.low),
    energy: envelope(frames.energy, 15, 180),
    low: envelope(frames.low, 8, 120),
    envelopeHz: ENVELOPE_HZ,
  };
}
