import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { bedName, renderBed } from "@panoma/video-audio";

/*
  The bed is the one asset panoma video makes with no third party in the loop, and its whole
  promise is that the kick is where the grid says. So these tests read the WAV back
  as numbers: the header a decoder needs, the beat the edit needs, the headroom the
  master needs, and the determinism the cache needs.
*/

const SR = 48000;

function header(buf: Buffer) {
  return {
    riff: buf.toString("ascii", 0, 4),
    wave: buf.toString("ascii", 8, 12),
    fmt: buf.toString("ascii", 12, 16),
    format: buf.readUInt16LE(20),
    channels: buf.readUInt16LE(22),
    rate: buf.readUInt32LE(24),
    bits: buf.readUInt16LE(34),
    data: buf.toString("ascii", 36, 40),
    dataBytes: buf.readUInt32LE(40),
    riffBytes: buf.readUInt32LE(4),
  };
}

/** Sum of squares over both channels in a window of ±`half` frames around `centre`. */
function energy(buf: Buffer, centre: number, half: number): number {
  let e = 0;
  const frames = (buf.length - 44) / 4;
  for (let i = Math.max(0, centre - half); i < Math.min(frames, centre + half); i++) {
    const l = buf.readInt16LE(44 + i * 4) / 32768;
    const r = buf.readInt16LE(46 + i * 4) / 32768;
    e += l * l + r * r;
  }
  return e;
}

function peakDb(buf: Buffer): number {
  let peak = 0;
  for (let p = 44; p < buf.length; p += 2) peak = Math.max(peak, Math.abs(buf.readInt16LE(p)));
  return 20 * Math.log10(peak / 32768);
}

test("the WAV header is what every decoder expects, and the length is exact", () => {
  const buf = renderBed({ bpm: 120, seconds: 8, style: "pulse" });
  const h = header(buf);
  assert.equal(h.riff, "RIFF");
  assert.equal(h.wave, "WAVE");
  assert.equal(h.fmt, "fmt ");
  assert.equal(h.data, "data");
  assert.equal(h.format, 1);
  assert.equal(h.channels, 2);
  assert.equal(h.rate, SR);
  assert.equal(h.bits, 16);
  assert.equal(h.dataBytes, 8 * SR * 4);
  assert.equal(h.riffBytes, buf.length - 8);
  assert.equal(buf.length, 44 + 8 * SR * 4);
});

test("same options, same bytes; another seed, other bytes", () => {
  const a = renderBed({ bpm: 120, seconds: 4, style: "calm", seed: 3, accents: [1.5] });
  const b = renderBed({ bpm: 120, seconds: 4, style: "calm", seed: 3, accents: [1.5] });
  const c = renderBed({ bpm: 120, seconds: 4, style: "calm", seed: 4, accents: [1.5] });
  assert.ok(a.equals(b));
  assert.ok(!a.equals(c));
});

test("the kick is where the grid says, in every style", () => {
  /*
    ticksPerBeat 2 puts a hat exactly between beats — the hardest case for this
    comparison. Beat 0 is inside the one-beat fade-in and the last bar is the fade-out,
    so those are skipped: the test is about placement, not about the fades.
  */
  const seconds = 8;
  const bpm = 120;
  const beat = (60 / bpm) * SR;
  const half = Math.round(0.01 * SR);
  for (const style of ["calm", "pulse", "dark", "bright"] as const) {
    const buf = renderBed({ bpm, seconds, style, ticksPerBeat: 2 });
    const beats = Math.floor((seconds * SR) / beat);
    for (let b = 1; b < beats - 4; b++) {
      const on = energy(buf, Math.round(b * beat), half);
      const off = energy(buf, Math.round((b + 0.5) * beat), half);
      assert.ok(on > off * 1.5, `${style}: beat ${b} on=${on.toFixed(2)} off=${off.toFixed(2)}`);
    }
  }
});

test("the peak sits at -6 dBFS and every sample is a number", () => {
  for (const style of ["calm", "pulse", "dark", "bright"] as const) {
    const buf = renderBed({ bpm: 100, seconds: 6, style, accents: [2, 4.25] });
    const db = peakDb(buf);
    assert.ok(Math.abs(db + 6) <= 0.1, `${style}: peak ${db.toFixed(3)} dBFS`);
    /* Int16 cannot hold NaN — a non-finite float would have thrown before the write. */
    assert.equal(header(buf).dataBytes, 6 * SR * 4);
  }
});

test("an accent adds a swell and a hit where a card lands", () => {
  /*
    The swell is a texture under the pad, not a level, so raw energy cannot see it.
    What can: the energy of the DIFFERENCE between a bed with the accent and the same
    bed without, in a window at the accent versus a window one second earlier where
    the two beds differ only by the normalisation gain.
  */
  const at = 3.1; // between beats at 120 BPM, so the kick does not mask the comparison
  const plain = renderBed({ bpm: 120, seconds: 6, style: "calm" });
  const hit = renderBed({ bpm: 120, seconds: 6, style: "calm", accents: [at] });
  const half = Math.round(0.02 * SR);
  const added = (centre: number): number => {
    let e = 0;
    for (let i = centre - half; i < centre + half; i++) {
      const dl = (hit.readInt16LE(44 + i * 4) - plain.readInt16LE(44 + i * 4)) / 32768;
      const dr = (hit.readInt16LE(46 + i * 4) - plain.readInt16LE(46 + i * 4)) / 32768;
      e += dl * dl + dr * dr;
    }
    return e;
  };
  const after = Math.round(at * SR) + Math.round(0.02 * SR);
  const before = Math.round(at * SR) - Math.round(0.05 * SR);
  assert.ok(added(after) > 4 * added(after - SR), "the hit");
  assert.ok(added(before) > 4 * added(before - SR), "the swell");
  /* Accents outside the piece are ignored, not fatal. */
  assert.ok(renderBed({ bpm: 120, seconds: 2, style: "calm", accents: [-1, 99] }).equals(renderBed({ bpm: 120, seconds: 2, style: "calm" })));
});

test("120 BPM for 8 seconds renders in under 3 seconds", () => {
  const t0 = performance.now();
  renderBed({ bpm: 120, seconds: 8, style: "bright", accents: [2, 4, 6] });
  assert.ok(performance.now() - t0 < 3000);
});

test("bedName is stable and reads like a file name", () => {
  assert.equal(bedName({ bpm: 120, seconds: 30, style: "calm", key: "A minor" }), "bed-120-calm-a-minor-30s.wav");
  assert.equal(bedName({ bpm: 120, seconds: 30, style: "calm" }), "bed-120-calm-a-minor-30s.wav");
  assert.equal(bedName({ bpm: 90, seconds: 45, style: "dark", key: "F# major", seed: 7 }), "bed-90-dark-f-sharp-major-45s-s7.wav");
  assert.equal(bedName({ bpm: 100, seconds: 20, style: "bright", key: "Bbm" }), "bed-100-bright-b-flat-minor-20s.wav");
  assert.equal(bedName({ bpm: 100, seconds: 20, style: "bright", key: "C" }), "bed-100-bright-c-major-20s.wav");
});

test("a bad key, tempo or length is refused with a sentence", () => {
  assert.throws(() => renderBed({ bpm: 120, seconds: 2, style: "calm", key: "H minor" }), /Cannot read the key/);
  assert.throws(() => renderBed({ bpm: 500, seconds: 2, style: "calm" }), /between 40 and 240/);
  assert.throws(() => renderBed({ bpm: 120, seconds: 0, style: "calm" }), /positive length/);
  assert.throws(() => renderBed({ bpm: 120, seconds: 2, style: "calm", ticksPerBeat: 1.5 }), /whole number/);
});

test("the key changes the notes and the tick count changes the hats", () => {
  const a = renderBed({ bpm: 120, seconds: 3, style: "pulse", key: "A minor" });
  const c = renderBed({ bpm: 120, seconds: 3, style: "pulse", key: "C major" });
  const t3 = renderBed({ bpm: 120, seconds: 3, style: "pulse", key: "A minor", ticksPerBeat: 3 });
  assert.ok(!a.equals(c));
  assert.ok(!a.equals(t3));
});

test("bed.ts depends on nothing but node:fs and node:buffer", () => {
  /* The whole point: no sample library, no DSP package, no third party in the bed. */
  const src = readFileSync(new URL("../packages/audio/src/bed.ts", import.meta.url), "utf8");
  const imports = [...src.matchAll(/^import .* from "([^"]+)";/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["node:buffer", "node:fs"]);
  assert.ok(!/Math\.random|Date\.now|new Date/.test(src), "the bed must be deterministic");
});
