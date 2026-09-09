/*
  The beat grid: every cut lands on a whole frame, on a beat.

  Lesson carried over from the panoma launch video: at 24 fps only some tempos produce
  integer beat lengths (120 BPM -> exactly 12 frames per beat). The reference video we
  studied (a Product Hunt "video of the year") was NOT cut to its music — 34.1% of its
  cuts fell within ±100 ms of a beat vs 37.3% expected by chance. Cutting on the grid is
  where generated content can beat hand-made content, so the grid is a first-class
  citizen and refuses tempos that would force rounding.
*/

export type Grid = {
  readonly fps: number;
  readonly bpm: number;
  /** Frames in one beat (a quarter note). Always an integer. */
  readonly beatFrames: number;
  /** Frames in one 4/4 bar. */
  readonly barFrames: number;
  /** Frame where beat 0 lands (music entry point; earlier frames are a cold open). */
  readonly start: number;
  /** Frame of bar `n`, counted from the music entry. */
  bar(n: number): number;
  /** Frame of beat `n`, counted from the music entry. */
  beat(n: number): number;
  /*
    The smallest accent that exists.

    A half-beat is the instinctive subdivision and at 120 BPM / 30 fps it is 7.5
    frames — it does not exist, and rounding it to 8 puts every accent built on it
    permanently off the grid. The legal subdivisions are the integer divisors of
    the beat (15 -> 1, 3, 5, 15), so the tick is the largest one at or below half a
    beat: 5 frames here. Accents land on ticks; cuts land on beats.

    A beat of a prime number of frames has no lattice at all and is the one case this
    rule cannot answer; `makeGrid` says what it does there instead.
  */
  readonly tickFrames: number;
  /** Frame of tick `n`. */
  tick(n: number): number;
  /**
   * How many ticks a beat holds: a whole number, always, and what `renderBed` wants —
   * it refuses a fraction, and `beatFrames / tickFrames` is 3.25 on a 13-frame beat.
   * It is that division exactly whenever the tick is a real divisor.
   */
  readonly ticksPerBeat: number;
  /** Every whole-frame subdivision of a beat, largest first. On a prime beat that is the beat and 1, and the tick is neither. */
  subdivisions(): number[];
};

/** Tempos that divide evenly into `fps` frames per beat — the only ones we accept. */
export function integerBpms(fps: number, min = 60, max = 180): number[] {
  const out: number[] = [];
  for (let bpm = min; bpm <= max; bpm++) if ((fps * 60) % bpm === 0) out.push(bpm);
  return out;
}

export function makeGrid(opts: { bpm: number; fps?: number; start?: number }): Grid {
  const fps = opts.fps ?? 24;
  const start = opts.start ?? 0;
  /*
    A tempo conformed from a real track is `fps * 60 / n` for a whole n, and dividing by
    it does not always give n back: 1800 / (1800 / 14) is 13.999999999999998 in a double.
    A millionth of a frame is not a rounding the edit could drift on; it is the same n.
  */
  const exact = Math.round(((fps * 60) / opts.bpm) * 1e6) / 1e6;
  if (!Number.isInteger(exact)) {
    throw new Error(
      `${opts.bpm} BPM at ${fps} fps gives ${exact.toFixed(3)} frames per beat. ` +
        `Every cut would need rounding and the edit drifts off the music. ` +
        `Integer tempos at ${fps} fps: ${integerBpms(fps).join(", ")}.`,
    );
  }
  const beatFrames = exact;
  const barFrames = beatFrames * 4;
  const divisors: number[] = [];
  for (let d = beatFrames; d >= 1; d--) if (beatFrames % d === 0) divisors.push(d);
  const divides = divisors.find((d) => d <= beatFrames / 2) ?? 1;
  /*
    A prime beat has no divisor lattice, so the rule above answers 1 frame — 33 ms at
    30 fps, which is not an accent but the absence of one. It is not a hypothetical: a
    tempo conformed from a real track lands on any whole beat length, and the owner's
    own track conforms to 138.46 BPM, 13 frames a beat. Everything timed by the tick
    shrank by 5 to 15 times — the word cascade stepped a word every 2 frames instead of
    10, and the bed was handed 13 hats a beat, which is a different instrument.

    Three ticks a beat is what the divisor rule itself gives at the tempo every number
    in this repository was tuned at (120 BPM / 30 fps: 15 -> 5), so a beat with no
    divisors gets `round(beatFrames / 3)` — 4 frames on a 13-frame beat, 133 ms, against
    the 167 to 500 ms the divisor rule produced at every integer tempo, and against 33.
    Half a beat (6 or 7 frames) would also be visible; three keeps the proportion the
    cascade, the pointer and the hats were timed against, and keeps the hat density the
    bed already had. The tick is off the lattice because there IS no lattice — it stays
    exact and evenly spaced, `tick(n) = start + n * tickFrames`, it simply no longer
    lands on every beat. Cuts are untouched: they are `beat` and `bar`, which never
    rounded and still do not.
  */
  const tickFrames = divides === 1 && beatFrames >= 5 ? Math.round(beatFrames / 3) : divides;
  return {
    fps,
    bpm: opts.bpm,
    beatFrames,
    barFrames,
    start,
    bar: (n) => start + n * barFrames,
    beat: (n) => start + n * beatFrames,
    tickFrames,
    tick: (n) => start + n * tickFrames,
    ticksPerBeat: Math.max(1, Math.round(beatFrames / tickFrames)),
    subdivisions: () => [...divisors],
  };
}
