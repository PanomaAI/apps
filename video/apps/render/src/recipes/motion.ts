/*
  The motion library: plain arithmetic behind a cursor that looks intentional,
  keystroke chips that read like typing, idle footage that hurries, and zooms
  that pan between neighbours instead of bouncing out and back in.

  Why it exists: `cursorAt` in timing.ts eases between logged intents, which is
  honest and looks like a tween — the cursor chases every click and arrives with
  it, never before it, and a viewer reads that as "the machine did this". The
  tools people recognise as expensive (Cap, Screen Studio, OpenScreen) all do the
  same four things and publish the numbers; this file ports them, with the
  numbers and where each comes from, as pure functions of the session log so a
  frame is reproducible and a test can check the arrival.

  Everything here is deterministic: no clock, no random, no state between calls.
  Nothing imports React; the recipes draw what these functions return.

  Ported code and its licences:
  - Cap, crates/rendering/src/spring_mass_damper.rs and cursor_interpolation.rs,
    crates/rendering/src/layers/keyboard.rs — Copyright (c) Cap Software, Inc.,
    AGPL-3.0 (https://github.com/CapSoftware/Cap/blob/main/LICENSE).
  - OpenScreen, src/lib/zoomMath/zoomRegionUtils.ts, constants.ts and
    src/lib/cursor/cursorPathSmoothing.ts — Copyright (c) 2025 Siddharth Vaddem
    and the OpenScreen contributors, MIT (https://github.com/getopenscreen/openscreen).
  - auto-editor's chunk + margin model — Unlicense (public domain).
*/
import type { Format } from "@panoma/video-core";
import { castSpeed, type CastEvent, type CastSession } from "./timing.ts";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export type SpringProfile = { tension: number; mass: number; friction: number };
export type CursorPreset = "slow" | "smooth" | "mellow" | "fast";

/** Every constant in this file, named, with its source beside it. */
export const MOTION_PRESETS = {
  cursor: {
    /* Cap crates/project/src/configuration.rs, CursorAnimationStyle::preset(). Mellow is Cap's default. */
    slow: { tension: 200, mass: 2.25, friction: 40 },
    smooth: { tension: 80, mass: 2.5, friction: 28 },
    mellow: { tension: 470, mass: 3, friction: 70 },
    fast: { tension: 380, mass: 1, friction: 30 },
    /* ClickSpringConfig::default(): the stiffer profile applied just before a click. */
    snappy: { tension: 530, mass: 1, friction: 40 },
    /* DRAG_SPRING in cursor_interpolation.rs: while the primary button is held. */
    drag: { tension: 1000, mass: 1, friction: 40 },
    /* cursor_interpolation.rs constants: SIMULATION_STEP_MS, CLICK_LOOKAHEAD_TARGET_MS,
       CLICK_SPRING_WINDOW_MS, SHAKE_THRESHOLD_UV, SHAKE_DETECTION_WINDOW_MS,
       SPRING_SETTLE_EXTRA_MS, LEAD_SMOOTHING (a ~130 ms one-pole at the 60 Hz step). */
    stepMs: 1000 / 60,
    clickLookaheadMs: 500,
    clickSnappyMs: 175,
    shakeThreshold: 0.015,
    shakeWindowMs: 100,
    settleExtraMs: 300,
    leadSmoothing: 0.12,
    /*
      Ours. OpenScreen splits the path where the cursor was hidden so the spring never
      glides across a gap it never saw. The engine's log has no "hidden", so the same thing
      is inferred: two points at different places more than this far apart cannot be
      one glide (the recorder's default glide is 450 ms), so the path holds and the
      spring restarts at rest on the far side.
    */
    hiddenGapMs: 2000,
  },
  keys: {
    /* Cap KeyboardSettings::default(): grouping_threshold_ms 500, linger_duration 0.8, fade_duration 0.15. */
    groupingMs: 500,
    lingerMs: 800,
    fadeMs: 150,
    /* layers/keyboard.rs: BOUNCE_OFFSET_PIXELS 6, MIN_OVERLAY_GAP 15, padding font*0.45,
       corner radius font*0.5, y_factor per position, all at a 1080 px reference height. */
    bouncePx: 6,
    captionGapPx: 15,
    paddingFactor: 0.45,
    radiusFactor: 0.5,
    yFactor: { "top-left": 0.08, "above-captions": 0.75, "bottom-center": 0.85 },
    referenceHeight: 1080,
    /* Ours: the chip font as a share of the caption size, the proportion Tutorial.tsx already draws. */
    fontFactor: 0.55,
    /* The recorder's default per-character delay for `type` (packages/capture/src/session.ts).
       The log carries one event per burst, so its characters are spread at that rate. */
    charDelayMs: 55,
    maxChips: 6,
  },
  idle: {
    /* auto-editor's default `--margin 0.2sec`: the kept side is dilated by this on both ends. */
    marginMs: 200,
    /* Ours: no input for this long is a wait; a glide is 450 ms and a click follows it directly. */
    inputGapMs: 700,
    /* Ours: ffmpeg signalstats YDIF is the mean |luma delta| to the previous frame on 0..255
       (ffmpeg-filters, signalstats). Half a level averaged over the frame is a blinking caret
       or encoder noise, not a page doing something. */
    ydifThreshold: 0.5,
    /* Ours: shorter than this is a breath between actions, not a wait worth hurrying. */
    minMs: 1200,
  },
  zoom: {
    /* OpenScreen zoomRegionUtils.ts: CHAINED_ZOOM_PAN_GAP_MS, CONNECTED_ZOOM_PAN_DURATION_MS,
       ZOOM_IN_OVERLAP_MS; constants.ts: TRANSITION_WINDOW_MS and its zoom-in window ×1.5. */
    gapMs: 1500,
    panMs: 1000,
    overlapMs: 500,
    transitionMs: 1015.05,
    zoomInMs: 1015.05 * 1.5,
    /* Ours: how long a focus is held after its moment. The cast holds a bar and a beat (2.5 s at 120). */
    holdMs: 2000,
  },
} as const;

/* ---------- The spring: Cap's closed-form damped oscillator ---------- */

/*
  Port of solve_spring_1d in Cap's spring_mass_damper.rs (AGPL-3.0). Analytic rather
  than stepped, so the state after dt is exact whatever dt is; the three regimes are
  under-, over- and critically damped with a 0.01 band around critical. The
  overdamped "roots coincide" branch of the original cannot be reached with zeta > 1.01
  and is left out.
*/
function solveSpring1d(disp: number, vel: number, t: number, omega0: number, zeta: number): [number, number] {
  const EPS = 0.01;
  if (zeta < 1 - EPS) {
    const wd = omega0 * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * omega0 * t);
    const cos = Math.cos(wd * t);
    const sin = Math.sin(wd * t);
    const a = disp;
    const b = (vel + disp * zeta * omega0) / Math.max(wd, 1e-4);
    return [decay * (a * cos + b * sin), decay * ((b * wd - a * zeta * omega0) * cos - (a * wd + b * zeta * omega0) * sin)];
  }
  if (zeta > 1 + EPS) {
    const root = Math.sqrt(zeta * zeta - 1);
    const s1 = -omega0 * (zeta - root);
    const s2 = -omega0 * (zeta + root);
    const c1 = (vel - disp * s2) / (s1 - s2);
    const c2 = disp - c1;
    const e1 = Math.exp(s1 * t);
    const e2 = Math.exp(s2 * t);
    return [c1 * e1 + c2 * e2, c1 * s1 * e1 + c2 * s2 * e2];
  }
  const decay = Math.exp(-omega0 * t);
  const b = vel + disp * omega0;
  return [decay * (disp + b * t), decay * (b - omega0 * (disp + b * t))];
}

type SpringState = { x: number; y: number; vx: number; vy: number };

/** One step of Cap's SpringMassDamperSimulation::run, with its rest thresholds. */
function runSpring(s: SpringState, p: SpringProfile, tx: number, ty: number, dtMs: number): void {
  const t = dtMs / 1000;
  const mass = Math.max(0.001, p.mass);
  const omega0 = Math.sqrt(p.tension / mass);
  const zeta = p.friction / (2 * Math.sqrt(p.tension * mass));
  const [dx, vx] = solveSpring1d(s.x - tx, s.vx, t, omega0, zeta);
  const [dy, vy] = solveSpring1d(s.y - ty, s.vy, t, omega0, zeta);
  s.x = tx + dx;
  s.y = ty + dy;
  s.vx = vx;
  s.vy = vy;
  if (Math.hypot(dx, dy) < 1e-5 && Math.hypot(vx, vy) < 1e-4) {
    s.x = tx;
    s.y = ty;
    s.vx = 0;
    s.vy = 0;
  }
}

/** A spring chasing a moving target trails it by friction/tension seconds, whatever the mass. */
const lagMs = (p: SpringProfile) => (p.tension > 0 ? (p.friction / p.tension) * 1000 : 0);

/* ---------- The cursor path ---------- */

export type CursorPoint = { x: number; y: number };
export type CursorPathOptions = {
  preset?: CursorPreset;
  /** 0 = the recorded path, 1 = the full spring. Blended linearly in between. */
  strength?: number;
  /** Spans with the primary button held, if a log ever carries them: the drag profile applies. */
  drags?: { fromMs: number; toMs: number }[];
};

/** A logged position in viewport fractions (Cap's "UV"), which is what the shake threshold is measured in. */
export type Pt = { t: number; x: number; y: number };

/*
  Port of filter_cursor_shake (cursor_interpolation.rs): a point that reverses
  direction against its neighbours, with both hops under 1.5 % of the viewport
  and all three within 100 ms, is a hand tremor and is dropped. Cap also decimates
  to 60 Hz afterwards; the engine's log is glide endpoints, far sparser than that.
*/
export function shakeFilter(moves: Pt[]): Pt[] {
  const P = MOTION_PRESETS.cursor;
  if (moves.length < 3) return moves;
  const out: Pt[] = [moves[0]];
  for (let i = 1; i < moves.length - 1; i++) {
    const prev = out[out.length - 1];
    const curr = moves[i];
    const next = moves[i + 1];
    if (next.t - prev.t <= P.shakeWindowMs) {
      const ax = curr.x - prev.x;
      const ay = curr.y - prev.y;
      const bx = next.x - curr.x;
      const by = next.y - curr.y;
      const reversal = ax * bx + ay * by < 0;
      const small = Math.hypot(ax, ay) < P.shakeThreshold && Math.hypot(bx, by) < P.shakeThreshold;
      if (reversal && small) continue;
    }
    out.push(curr);
  }
  out.push(moves[moves.length - 1]);
  return out;
}

/** The recorded path at `ms`: linear between points (a glide logs its two ends), clamped at both ends. */
function positionAt(points: Pt[], ms: number): CursorPoint {
  if (ms <= points[0].t) return points[0];
  const last = points[points.length - 1];
  if (ms >= last.t) return last;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= ms) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const u = b.t > a.t ? (ms - a.t) / (b.t - a.t) : 1;
  return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) };
}

/** OpenScreen's splitVisibleRuns, inferred: a long gap between two different places is a hidden span. */
function runsOf(points: Pt[]): Pt[][] {
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  for (const p of points) {
    const prev = run[run.length - 1];
    if (prev && p.t - prev.t > MOTION_PRESETS.cursor.hiddenGapMs && (p.x !== prev.x || p.y !== prev.y)) {
      runs.push(run);
      run = [];
    }
    run.push(p);
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

type SimRun = { start: number; xs: Float64Array; ys: Float64Array };

/*
  Port of build_smoothed_timeline (cursor_interpolation.rs), one run at a time.
  The spring's target is sampled `lead` ms ahead so the output sits ON the recorded
  cursor instead of trailing it; within 500 ms of a click the target IS the click
  point, and within 175 ms the snappy profile applies — so the cursor is already
  there when the click lands, which is what a scripted cursor gets wrong by default.
*/
function simulateRun(run: Pt[], clicks: Pt[], base: SpringProfile, drags: { fromMs: number; toMs: number }[]): SimRun {
  const P = MOTION_PRESETS.cursor;
  const start = run[0].t;
  const end = run[run.length - 1].t;
  const steps = Math.ceil((end - start + P.settleExtraMs) / P.stepMs) + 1;
  const xs = new Float64Array(steps);
  const ys = new Float64Array(steps);
  const s: SpringState = { x: run[0].x, y: run[0].y, vx: 0, vy: 0 };
  xs[0] = s.x;
  ys[0] = s.y;
  let lead = lagMs(base);
  let ci = 0;
  for (let i = 1; i < steps; i++) {
    const t = start + i * P.stepMs;
    while (ci < clicks.length && clicks[ci].t <= t) ci++;
    const next = clicks[ci];
    const soon = next !== undefined && next.t - t <= P.clickLookaheadMs;
    const snappy = next !== undefined && next.t - t <= P.clickSnappyMs;
    const dragging = drags.some((d) => t >= d.fromMs && t <= d.toMs);
    const profile = snappy ? P.snappy : dragging ? P.drag : base;
    lead += (lagMs(profile) - lead) * P.leadSmoothing;
    const target = soon ? next : positionAt(run, Math.min(Math.min(t, end) + lead, end));
    runSpring(s, profile, target.x, target.y, P.stepMs);
    xs[i] = s.x;
    ys[i] = s.y;
  }
  return { start, xs, ys };
}

function sampleRuns(runs: SimRun[], ms: number): CursorPoint {
  const step = MOTION_PRESETS.cursor.stepMs;
  let held: CursorPoint = { x: runs[0].xs[0], y: runs[0].ys[0] };
  for (const run of runs) {
    if (ms < run.start) break;
    const n = run.xs.length;
    const f = (ms - run.start) / step;
    if (f >= n - 1) {
      held = { x: run.xs[n - 1], y: run.ys[n - 1] };
      continue;
    }
    const i = Math.floor(f);
    const u = f - i;
    return { x: lerp(run.xs[i], run.xs[i + 1], u), y: lerp(run.ys[i], run.ys[i + 1], u) };
  }
  return held;
}

/** Frames the path has: one per timeline frame of the take, conformed like castPlan.videoFrames, plus the last. */
export function cursorFrameCount(session: CastSession, fps: number): number {
  const ready = session.readyMs ?? 0;
  return Math.max(1, Math.ceil((((session.durationMs - ready) / 1000) * fps) / castSpeed(session, fps))) + 1;
}

/** Session millisecond shown by path element `frame` — the inverse of timing.ts's eventFrame, minus videoStart. */
export function cursorFrameMs(session: CastSession, fps: number, frame: number): number {
  return (session.readyMs ?? 0) + (frame * 1000 * castSpeed(session, fps)) / fps;
}

/**
 * The synthetic cursor, one viewport-pixel point per timeline frame of the take.
 * Never outside the viewport, and the same array for the same inputs, always.
 */
export function cursorPath(session: CastSession, fps: number, opts: CursorPathOptions = {}): CursorPoint[] {
  const P = MOTION_PRESETS.cursor;
  const w = session.viewport.width;
  const h = session.viewport.height;
  const strength = clamp(opts.strength ?? 1, 0, 1);
  const frames = cursorFrameCount(session, fps);
  const uv = (e: { t: number; x: number; y: number }): Pt => ({ t: e.t, x: e.x / w, y: e.y / h });
  const ofKind = <K extends "move" | "click">(kind: K) =>
    session.events.filter((e): e is Extract<CastEvent, { kind: K }> => e.kind === kind).map(uv);
  const moves = shakeFilter(ofKind("move"));
  const clicks = ofKind("click");
  const points = [...moves, ...clicks].sort((a, b) => a.t - b.t);
  if (points.length === 0) return Array.from({ length: frames }, () => ({ x: w / 2, y: h / 2 }));

  const base = P[opts.preset ?? "mellow"];
  const runs = runsOf(points);
  const sims = runs.map((run) => simulateRun(run, clicks, base, opts.drags ?? []));
  /* The raw path holds across a hidden gap too, so the blend never crosses it either. */
  const rawAt = (ms: number): CursorPoint => {
    let held: CursorPoint = runs[0][0];
    for (const run of runs) {
      if (ms < run[0].t) break;
      if (ms <= run[run.length - 1].t) return positionAt(run, ms);
      held = run[run.length - 1];
    }
    return held;
  };

  const out: CursorPoint[] = [];
  for (let k = 0; k < frames; k++) {
    const ms = cursorFrameMs(session, fps, k);
    const raw = rawAt(ms);
    const sim = sampleRuns(sims, ms);
    out.push({ x: clamp(lerp(raw.x, sim.x, strength) * w, 0, w), y: clamp(lerp(raw.y, sim.y, strength) * h, 0, h) });
  }
  return out;
}

/*
  The path, once per take.

  A composition renders every frame from nothing, so nothing a component holds survives to
  the next frame; the take object does — it is the same one for the whole render — and the
  path is a pure function of it and the frame rate. So it is kept beside the take it was
  computed from, and a second frame asking for it costs a lookup.
*/
const pathsOf = new WeakMap<CastSession, Map<string, CursorPoint[]>>();
export function cursorPathOf(session: CastSession, fps: number, opts: CursorPathOptions = {}): CursorPoint[] {
  const key = `${fps}/${opts.preset ?? "mellow"}/${opts.strength ?? 1}/${JSON.stringify(opts.drags ?? [])}`;
  let byKey = pathsOf.get(session);
  if (!byKey) pathsOf.set(session, (byKey = new Map()));
  let path = byKey.get(key);
  if (!path) byKey.set(key, (path = cursorPath(session, fps, opts)));
  return path;
}

/** Path element at a frame, clamped to the path. */
export function cursorAtFrame(path: CursorPoint[], frame: number): CursorPoint {

  return path[clamp(Math.round(frame), 0, path.length - 1)];
}

/** The path at an arbitrary session millisecond — for a retimed recipe that seeks by source time. */
export function cursorAtMs(path: CursorPoint[], session: CastSession, fps: number, ms: number): CursorPoint {
  const f = clamp(((ms - (session.readyMs ?? 0)) * fps) / (1000 * castSpeed(session, fps)), 0, path.length - 1);
  const i = Math.floor(f);
  const a = path[i];
  const b = path[Math.min(i + 1, path.length - 1)];
  return { x: lerp(a.x, b.x, f - i), y: lerp(a.y, b.y, f - i) };
}

/* ---------- Keystroke chips ---------- */

export type KeystrokeChip = {
  text: string;
  /** Session ms the chip was born. */
  born: number;
  /** Milliseconds since `born`. */
  age: number;
  /** 0..1 opacity from Cap's calculate_fade. */
  fade: number;
  /** Vertical offset in px at the 1080 reference height, from Cap's calculate_keyboard_bounce. */
  bounce: number;
  named: boolean;
};
export type KeystrokeOptions = { groupingMs?: number; lingerMs?: number; fadeMs?: number; maxChips?: number; charDelayMs?: number };

/* KeyCastr's conventions, the ones every macOS keystroke visualiser shares. */
const GLYPHS: Record<string, string> = {
  Meta: "⌘", Cmd: "⌘", Command: "⌘", Shift: "⇧", Alt: "⌥", Option: "⌥", Control: "⌃", Ctrl: "⌃",
  Enter: "⏎", Return: "⏎", Escape: "⎋", Esc: "⎋", Tab: "⇥", Backspace: "⌫", Delete: "⌦", Space: "␣",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
};

type Key = { t: number; glyph: string; named: boolean };

/** A `press` name ("Enter", "Meta+k") becomes one named key; a `type` burst becomes one key per character. */
function keysOf(events: CastEvent[], charDelayMs: number): Key[] {
  const keys: Key[] = [];
  for (const e of events) {
    if (e.kind !== "key") continue;
    const parts = e.text.split("+");
    const named = parts.length > 1 || (e.text.length > 1 && /^[A-Z][A-Za-z0-9]*$/.test(e.text));
    if (named) {
      keys.push({ t: e.t, named, glyph: parts.map((p) => GLYPHS[p] ?? (p.length === 1 ? p.toUpperCase() : p)).join("") });
    } else {
      [...e.text].forEach((ch, i) => keys.push({ t: e.t + i * charDelayMs, named: false, glyph: ch === " " ? "␣" : ch }));
    }
  }
  return keys.sort((a, b) => a.t - b.t);
}

/**
 * The chips on screen at `ms`. Characters typed within `groupingMs` of each other
 * grow one chip, revealed key by key (Cap's build_visible_text); a named key is
 * always its own chip. Each lingers 0.8 s past its last key, fading 150 ms at both
 * ends with the 6 px bounce, and only the newest `maxChips` survive.
 */
export function keystrokeChips(session: CastSession, ms: number, opts: KeystrokeOptions = {}): KeystrokeChip[] {
  const K = MOTION_PRESETS.keys;
  const grouping = opts.groupingMs ?? K.groupingMs;
  const linger = opts.lingerMs ?? K.lingerMs;
  const fadeMs = opts.fadeMs ?? K.fadeMs;
  const chips: { born: number; last: number; named: boolean; keys: Key[] }[] = [];
  for (const key of keysOf(session.events, opts.charDelayMs ?? K.charDelayMs)) {
    const cur = chips[chips.length - 1];
    if (cur && !cur.named && !key.named && key.t - cur.last <= grouping) {
      cur.keys.push(key);
      cur.last = key.t;
    } else {
      chips.push({ born: key.t, last: key.t, named: key.named, keys: [key] });
    }
  }
  const out: KeystrokeChip[] = [];
  for (const chip of chips) {
    const end = chip.last + linger;
    if (ms < chip.born || ms >= end + fadeMs) continue;
    const shown = chip.keys.filter((k) => k.t <= ms);
    const text = (shown.length > 0 ? shown : chip.keys.slice(0, 1)).map((k) => k.glyph).join("");
    const fadeIn = clamp((ms - chip.born) / fadeMs, 0, 1);
    const fadeOut = clamp((end - ms) / fadeMs, 0, 1);
    const fade = Math.min(fadeIn, ms <= end ? 1 : clamp(1 - (ms - end) / fadeMs, 0, 1));
    const bounce = fadeIn < 1 ? -((1 - fadeIn) ** 2) * K.bouncePx : fadeOut < 1 ? (1 - fadeOut) ** 2 * K.bouncePx : 0;
    out.push({ text, born: chip.born, age: ms - chip.born, fade, bounce, named: chip.named });
  }
  return out.slice(-(opts.maxChips ?? K.maxChips));
}

export type KeystrokePosition = keyof typeof MOTION_PRESETS.keys.yFactor;

/**
 * Where the chip row goes, in the coordinates of `box` (ProductWindow's content box
 * for the `over` slot; the canvas when absent). `cap` is the caption size in px,
 * so the chips scale with the type they sit near. Pixel constants are Cap's at
 * 1080 and scale with the box height, as keyboard.rs does.
 */
export function keystrokeLayout(
  format: Format,
  cap: number,
  opts: { position?: KeystrokePosition; box?: { width: number; height: number } } = {},
): { x: number; y: number; fontSize: number; padding: number; radius: number; gap: number; bounce: number; position: KeystrokePosition } {
  const K = MOTION_PRESETS.keys;
  const box = opts.box ?? { width: format.width, height: format.height };
  const position = opts.position ?? "bottom-center";
  const fontSize = cap * K.fontFactor;
  const scale = box.height / K.referenceHeight;
  return {
    x: box.width / 2,
    y: box.height * K.yFactor[position],
    fontSize,
    padding: fontSize * K.paddingFactor,
    radius: fontSize * K.radiusFactor,
    gap: K.captionGapPx * scale,
    bounce: K.bouncePx * scale,
    position,
  };
}

/* ---------- Idle footage, and the map that hurries it ---------- */

export type IdleInput = { ydif: number[]; fps: number; events: CastEvent[]; readyMs?: number };
export type IdleOptions = { minMs?: number; ydifThreshold?: number; inputGapMs?: number; marginMs?: number };
export type IdleSegment = { fromMs: number; toMs: number };

/**
 * Stretches of the take where nothing happened: no input near them AND frozen
 * pixels (screenstudio-alt's predicate — either alone lies: a page animates with
 * no input, and a glide changes no pixel because the cursor is not in the video).
 * `ydif` is ffmpeg signalstats' YDIF per source frame. Runs are shrunk by the
 * margin on both sides (auto-editor's model, seen from the silent side) and a
 * click or a mark is never inside one.
 */
export function idleSegments(input: IdleInput, opts: IdleOptions = {}): IdleSegment[] {
  const I = MOTION_PRESETS.idle;
  const minMs = opts.minMs ?? I.minMs;
  const threshold = opts.ydifThreshold ?? I.ydifThreshold;
  const gap = opts.inputGapMs ?? I.inputGapMs;
  const margin = opts.marginMs ?? I.marginMs;
  const frameMs = 1000 / input.fps;
  const ready = input.readyMs ?? 0;

  const busy: { from: number; to: number }[] = [];
  let lastMove: { t: number; x: number; y: number } | null = null;
  for (const e of input.events) {
    if (e.kind === "mark") {
      busy.push({ from: e.t - margin, to: e.t + margin });
      continue;
    }
    /* A typed burst keeps the keyboard busy for as long as its characters take. */
    const tail = e.kind === "key" ? e.text.length * MOTION_PRESETS.keys.charDelayMs : 0;
    busy.push({ from: e.t - gap, to: e.t + tail + gap });
    if (e.kind === "move") {
      /* A glide is busy from its departure to its arrival, however long it took. */
      if (lastMove && (lastMove.x !== e.x || lastMove.y !== e.y)) busy.push({ from: lastMove.t, to: e.t });
      lastMove = e;
    }
  }

  const idle = input.ydif.map((d, i) => {
    const mid = (i + 0.5) * frameMs;
    return i * frameMs >= ready && d < threshold && !busy.some((b) => mid >= b.from && mid <= b.to);
  });

  const out: IdleSegment[] = [];
  let start = -1;
  for (let i = 0; i <= idle.length; i++) {
    if (i < idle.length && idle[i]) {
      if (start < 0) start = i;
      continue;
    }
    if (start >= 0) {
      const fromMs = start * frameMs + margin;
      const toMs = i * frameMs - margin;
      if (toMs - fromMs >= minMs) out.push({ fromMs, toMs });
      start = -1;
    }
  }
  return out;
}

export type SpeedMap = { rate: number; knots: { timelineMs: number; sourceMs: number }[] };

/** Timeline → source: idle segments play at `rate`, everything else at 1. Monotonic and continuous by construction. */
export function speedMap(segments: IdleSegment[], rate: number, durationMs: number): SpeedMap {
  if (!(rate > 0) || !Number.isFinite(rate)) throw new Error(`speedMap needs a positive rate; got ${rate}.`);
  const knots: SpeedMap["knots"] = [{ timelineMs: 0, sourceMs: 0 }];
  let tl = 0;
  let src = 0;
  const sorted = [...segments].sort((a, b) => a.fromMs - b.fromMs);
  for (const seg of sorted) {
    const from = clamp(seg.fromMs, src, durationMs);
    const to = clamp(seg.toMs, from, durationMs);
    if (to <= from) continue;
    tl += from - src;
    knots.push({ timelineMs: tl, sourceMs: from });
    tl += (to - from) / rate;
    knots.push({ timelineMs: tl, sourceMs: to });
    src = to;
  }
  tl += durationMs - src;
  knots.push({ timelineMs: tl, sourceMs: durationMs });
  return { rate, knots };
}

function alongKnots(knots: SpeedMap["knots"], v: number, from: "timelineMs" | "sourceMs"): number {
  const to = from === "timelineMs" ? "sourceMs" : "timelineMs";
  if (v <= knots[0][from]) return knots[0][to];
  for (let i = 1; i < knots.length; i++) {
    if (v <= knots[i][from]) {
      const a = knots[i - 1];
      const b = knots[i];
      const span = b[from] - a[from];
      return span > 0 ? lerp(a[to], b[to], (v - a[from]) / span) : b[to];
    }
  }
  return knots[knots.length - 1][to];
}

/** Source ms shown at a timeline ms. */
export const sourceAt = (map: SpeedMap, timelineMs: number): number => alongKnots(map.knots, timelineMs, "timelineMs");
/** Timeline ms at which a source ms is shown — where a click or a mark lands once idle is hurried. */
export const timelineAt = (map: SpeedMap, sourceMs: number): number => alongKnots(map.knots, sourceMs, "sourceMs");
/** Total timeline ms once idle has been hurried. */
export const timelineLength = (map: SpeedMap): number => map.knots[map.knots.length - 1].timelineMs;

/* ---------- The dance, where the file has room for it ---------- */

/**
 * A pump the picture can afford. `scale` is what the beat asks for (pulse.ts, `dancedScale`),
 * `k` the camera's scale, `ratios` the pixel ratio of every file drawn on this frame. The
 * plate may be pumped only up to the tightest of them, so a kick never draws a clip past its
 * own pixels — at a press the control's clip is at its ratio exactly, and there the dance is
 * nothing, which is honest. Never below 1: the dance only ever punches in.
 */
export function danceWithin(scale: number, k: number, ratios: number[]): number {
  const room = ratios.reduce((r, ratio) => Math.min(r, ratio / k), Infinity);
  return Math.max(1, Math.min(scale, room));
}

/* ---------- Chained zooms: pan between neighbours, release from strangers ---------- */

export type ZoomMoment = { frame: number; fx: number; fy: number; kind: "click" | "scroll" };
export type ZoomLink = {
  kind: "zoom" | "pan" | "release";
  from: number;
  to: number;
  /** Focus in source fractions: the one being held, panned TO, or released FROM. */
  fx: number;
  fy: number;
  /** What kind of moment the focus belongs to, for the integrator to pick a scale. */
  on: ZoomMoment["kind"];
  /** Frames of ease-in at `from`; 0 when the zoom is entered by a pan, already in. */
  attack: number;
};
export type ChainOptions = { gapMs?: number; panMs?: number; overlapMs?: number; holdMs?: number };

/**
 * OpenScreen's rule (getConnectedRegionPairs): two focus regions closer than the
 * gap are joined by a pan of `panMs` and the camera stays in; further apart, the
 * first releases over the transition window and the next attacks on its own, fully
 * in `overlapMs` after its moment. A zoom-out-and-in between two clicks a second
 * apart is the single most recognisable tell of an automatic edit.
 */
export function chainZooms(moments: ZoomMoment[], fps: number, opts: ChainOptions = {}): ZoomLink[] {
  const Z = MOTION_PRESETS.zoom;
  const f = (ms: number) => Math.max(1, Math.round((ms / 1000) * fps));
  const gapF = f(opts.gapMs ?? Z.gapMs);
  const panF = f(opts.panMs ?? Z.panMs);
  const overlapF = f(opts.overlapMs ?? Z.overlapMs);
  const holdF = f(opts.holdMs ?? Z.holdMs);
  /* The ease-in runs for the zoom-in window and is complete `overlap` after the moment. */
  const attackF = f(Z.zoomInMs);
  const releaseF = f(Z.transitionMs);

  const sorted = [...moments].sort((a, b) => a.frame - b.frame);
  const out: ZoomLink[] = [];
  let chainedFrom: number | null = null;
  sorted.forEach((m, i) => {
    const next = sorted[i + 1];
    const from = chainedFrom ?? Math.max(0, m.frame + overlapF - attackF);
    const attack = chainedFrom === null ? m.frame + overlapF - from : 0;
    let to = Math.max(from + 1, m.frame + holdF);
    if (next && next.frame - to <= gapF) {
      to = Math.max(from + 1, Math.min(to, next.frame - panF));
      const panTo = Math.max(to + 1, Math.min(to + panF, next.frame));
      out.push({ kind: "zoom", from, to, fx: m.fx, fy: m.fy, on: m.kind, attack });
      out.push({ kind: "pan", from: to, to: panTo, fx: next.fx, fy: next.fy, on: next.kind, attack: 0 });
      chainedFrom = panTo;
      return;
    }
    out.push({ kind: "zoom", from, to, fx: m.fx, fy: m.fy, on: m.kind, attack });
    out.push({ kind: "release", from: to, to: to + releaseF, fx: m.fx, fy: m.fy, on: m.kind, attack: 0 });
    chainedFrom = null;
  });
  return out;
}
