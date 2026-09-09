/*
  The animation math, from scratch. Three tools cover everything a recipe needs:
  interpolate for driving values from time, cubicBezier for shaped easings, spring for
  motion with weight. All are pure functions of their inputs — the whole engine rests
  on frames being reproducible, so nothing here reads a clock or keeps state.
*/

export type Extrapolate = "extend" | "clamp" | "identity";

export type InterpolateOptions = {
  easing?: (t: number) => number;
  extrapolateLeft?: Extrapolate;
  extrapolateRight?: Extrapolate;
};

/**
 * Map `input` across piecewise-linear ranges, like a lookup table with math between
 * the entries. Ranges must be monotonically increasing and at least two long.
 */
export function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  options: InterpolateOptions = {},
): number {
  if (inputRange.length < 2 || inputRange.length !== outputRange.length) {
    throw new Error(
      `interpolate needs matching ranges of at least two entries; got ${inputRange.length} and ${outputRange.length}.`,
    );
  }
  for (let i = 1; i < inputRange.length; i++) {
    if (!(inputRange[i] > inputRange[i - 1])) {
      throw new Error(`inputRange must strictly increase; entry ${i} (${inputRange[i]}) does not.`);
    }
  }

  const first = inputRange[0];
  const last = inputRange[inputRange.length - 1];

  if (input < first) {
    const mode = options.extrapolateLeft ?? "extend";
    if (mode === "identity") return input;
    if (mode === "clamp") return outputRange[0];
  }
  if (input > last) {
    const mode = options.extrapolateRight ?? "extend";
    if (mode === "identity") return input;
    if (mode === "clamp") return outputRange[outputRange.length - 1];
  }

  /* Find the segment; extrapolation beyond the ends extends the outermost segment. */
  let seg = 0;
  while (seg < inputRange.length - 2 && input >= inputRange[seg + 1]) seg++;

  const x0 = inputRange[seg];
  const x1 = inputRange[seg + 1];
  const y0 = outputRange[seg];
  const y1 = outputRange[seg + 1];

  let t = (input - x0) / (x1 - x0);
  if (options.easing) t = options.easing(Math.min(1, Math.max(0, t)));
  return y0 + (y1 - y0) * t;
}

/**
 * A CSS-compatible cubic bezier easing: (0,0) .. (x1,y1) (x2,y2) .. (1,1).
 * Newton-Raphson on the x polynomial, bisection as the safety net — the same
 * strategy browsers use, so `cubicBezier(0.25, 0.1, 0.25, 1)` matches CSS `ease`.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  /* Horner form of the bezier polynomial and its derivative. */
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const axx = 1 - cx - bx;
  const sampleX = (t: number) => ((axx * t + bx) * t + cx) * t;
  const sampleDX = (t: number) => (3 * axx * t + 2 * bx) * t + cx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ayy = 1 - cy - by;
  const sampleY = (t: number) => ((ayy * t + by) * t + cy) * t;

  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) return sampleY(t);
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    while (hi - lo > 1e-6) {
      if (sampleX(t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

export const easing = {
  linear: (t: number) => t,
  in: cubicBezier(0.42, 0, 1, 1),
  out: cubicBezier(0, 0, 0.58, 1),
  inOut: cubicBezier(0.42, 0, 0.58, 1),
  /** The house cut: fast attack, long settle — for things that land on a beat. */
  slam: cubicBezier(0.16, 1, 0.3, 1),
} as const;

export type SpringConfig = { damping?: number; mass?: number; stiffness?: number };

/*
  The closed-form damped harmonic oscillator, 0 -> 1. Underdamped springs oscillate
  (zeta < 1), critically damped and overdamped ones settle without crossing. Solving
  the ODE analytically instead of stepping it keeps every frame exact regardless of
  fps — a numeric integrator drifts differently at 24 and 30 and that difference is
  visible on a hard cut.
*/
function springPosition(tSec: number, c: SpringConfig): number {
  const damping = c.damping ?? 10;
  const mass = c.mass ?? 1;
  const stiffness = c.stiffness ?? 100;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * tSec) * (Math.cos(wd * tSec) + ((zeta * w0) / wd) * Math.sin(wd * tSec));
  }
  if (zeta === 1) {
    return 1 - Math.exp(-w0 * tSec) * (1 + w0 * tSec);
  }
  const wo = w0 * Math.sqrt(zeta * zeta - 1);
  const r1 = -zeta * w0 + wo;
  const r2 = -zeta * w0 - wo;
  const c2 = r1 / (r1 - r2);
  const c1 = 1 - c2;
  return 1 - c1 * Math.exp(r1 * tSec) - c2 * Math.exp(r2 * tSec);
}

/** Seconds until the spring stays within 0.5% of its target. Cached per config. */
const settleCache = new Map<string, number>();
function settleTime(c: SpringConfig): number {
  const key = `${c.damping ?? 10}/${c.mass ?? 1}/${c.stiffness ?? 100}`;
  const hit = settleCache.get(key);
  if (hit !== undefined) return hit;
  let t = 0;
  let calm = 0;
  while (t < 30) {
    t += 1 / 120;
    if (Math.abs(1 - springPosition(t, c)) < 0.005) {
      calm += 1;
      if (calm >= 12) break; /* a tenth of a second inside the band, not one lucky crossing */
    } else {
      calm = 0;
    }
  }
  settleCache.set(key, t);
  return t;
}

export function spring(opts: {
  frame: number;
  fps: number;
  config?: SpringConfig;
  /** Compress or stretch the natural settle so the motion fits exactly here. */
  durationInFrames?: number;
  from?: number;
  to?: number;
}): number {
  const config = opts.config ?? {};
  let tSec = Math.max(0, opts.frame) / opts.fps;
  if (opts.durationInFrames !== undefined) {
    tSec *= settleTime(config) / (opts.durationInFrames / opts.fps);
  }
  const p = springPosition(tSec, config);
  const from = opts.from ?? 0;
  const to = opts.to ?? 1;
  return from + (to - from) * p;
}
