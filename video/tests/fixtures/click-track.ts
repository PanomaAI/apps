/*
  A track nobody wrote, for the beat tests: kicks every beat at BPM, the bar's first kick
  louder, a hat between them, a noise floor, and the first beat OFFSET seconds in — so
  every number an analysis returns can be checked against how the file was made.

  With `intro`, everything before that first kick is a pad instead of silence: a soft
  two-voice chord breathing at the beat period. It is what an intro really is — material
  in tempo, with no drum in it — and it is the case the head cut has to survive, because
  a beat tracker chains beats straight through it.
*/
export const SR = 44100;

export function clickTrack(opts: { bpm: number; seconds: number; offset: number; seed?: number; intro?: boolean }): Buffer {
  const { bpm, seconds, offset } = opts;
  const period = 60 / bpm;
  const n = SR * seconds;
  const x = new Float32Array(n);
  let seed = opts.seed ?? 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  for (let i = 0; i < n; i++) x[i] = rnd() * 0.02;
  if (opts.intro) {
    /* A pad at a tenth of a kick: loud enough to hold the tracker's attention, far too quiet to be a hit. */
    for (let i = 0; i < Math.min(n, Math.round(offset * SR)); i++) {
      const t = i / SR;
      const swell = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period);
      x[i] = (x[i] ?? 0) + 0.1 * swell * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277.18 * t)) * 0.5;
    }
  }
  for (let b = 0; offset + b * period < seconds; b++) {
    const t0 = Math.round((offset + b * period) * SR);
    const gain = b % 4 === 0 ? 1.0 : 0.55;
    for (let i = 0; i < SR * 0.12 && t0 + i < n; i++) {
      const t = i / SR;
      const f = 50 + 70 * Math.exp(-t / 0.03);
      x[t0 + i] = (x[t0 + i] ?? 0) + gain * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.08);
    }
    const h0 = Math.round((offset + (b + 0.5) * period) * SR);
    for (let i = 0; i < SR * 0.02 && h0 + i < n; i++) x[h0 + i] = (x[h0 + i] ?? 0) + 0.15 * rnd() * Math.exp(-i / (SR * 0.006));
  }
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i]! * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
