/*
  The product supplies the sounds: a press, a scroll, an input. Their dry foley is
  synthesised here and placed by the recording's clock in recipes/sound.ts. Music
  supplies atmosphere; a camera move or title change need not make another noise.
  Grid's explicitly assembled phrases and stacked cards earn their own short,
  original textures from the same visual event plan, never from the music clock.
  The four older edit effects remain available to manually authored pieces.
  Everything is generated locally, with no sample library to redistribute.

  ffmpeg trap, paid for twice already: a comma inside an `aevalsrc` expression is
  a filter-graph separator unless it is escaped, and the parser blames the NEXT
  option, so the error names something innocent.
*/
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const SFX = {
  /* A finger landing: a short, bright transient with no tail. */
  tick: {
    seconds: 0.09,
    expr: "0.42*sin(2*PI*2400*t)*exp(-t*120) + 0.22*sin(2*PI*3600*t)*exp(-t*200)",
    post: "highpass=f=900,alimiter=limit=0.9",
  },
  /* Air moving: a chirp under noise, opening and closing inside a beat. */
  whoosh: {
    seconds: 0.34,
    expr: "0.30*sin(2*PI*(220+2600*t)*t)*sin(PI*t/0.34)",
    post: "highpass=f=300,lowpass=f=6000,aecho=0.7:0.6:22:0.25,alimiter=limit=0.9",
  },
  /* Weight arriving: a pitch-dropping thump that lands on the beat. */
  impact: {
    seconds: 0.5,
    expr: "0.75*sin(2*PI*(58+90*exp(-t*22))*t)*exp(-t*7)",
    post: "lowpass=f=320,alimiter=limit=0.92",
  },
  /* Tension before the close: rising, and it stops rather than resolves. */
  riser: {
    seconds: 1.6,
    expr: "0.26*sin(2*PI*(180+1500*t*t)*t)*min(1,t/1.2)",
    post: "highpass=f=200,lowpass=f=8000,alimiter=limit=0.9",
  },
} as const;

export type InteractionSound = "click" | "scroll" | "key";
export const EDITORIAL_SFX = {
  assemble: { seconds: 0.12 },
  settle: { seconds: 0.07 },
  paper: { seconds: 0.22 },
} as const;
export type EditorialSound = keyof typeof EDITORIAL_SFX;
export type SfxName = keyof typeof SFX | InteractionSound | EditorialSound;

/** Dry, short foley for an observed interaction. No sample library or random clock. */
export function renderInteractionSound(name: InteractionSound): Buffer {
  const rate = 48000;
  const seconds = name === "scroll" ? 1.6 : name === "click" ? 0.065 : 0.04;
  const frames = Math.round(seconds * rate);
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(frames * 2, 40);
  let seed = 0x76a43b21;
  let low = 0;
  let high = 0;
  const filter = (hz: number) => 1 - Math.exp(-2 * Math.PI * hz / rate);
  const lowRate = filter(name === "scroll" ? 1800 : 4900);
  const highRate = filter(name === "scroll" ? 380 : 650);
  for (let i = 0; i < frames; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const noise = ((seed >>> 0) / 0xffffffff) * 2 - 1;
    low += lowRate * (noise - low);
    high += highRate * (low - high);
    const air = low - high;
    const t = i / rate;
    let value: number;
    if (name === "scroll") {
      /* A brush follows a gesture; the caller trims and releases it at the scroll's end. */
      const envelope = Math.min(1, t / 0.035, (seconds - t) / 0.12);
      value = air * envelope * 0.64 * (0.88 + 0.12 * Math.sin(2 * Math.PI * 2.3 * t));
    } else {
      const isClick = name === "click";
      const release = Math.max(0, t - (isClick ? 0.017 : 0.011));
      const attack = Math.min(1, t / 0.0006);
      const body = (air * 1.2 + 0.2 * Math.sin(2 * Math.PI * (isClick ? 1350 : 880) * t)) * Math.exp(-t * (isClick ? 240 : 300));
      const returnTap = t > (isClick ? 0.017 : 0.011) ? air * 0.45 * Math.exp(-release * 370) : 0;
      value = (body + returnTap) * attack * (isClick ? 0.8 : 0.65);
    }
    wav.writeInt16LE(Math.round(Math.max(-0.8, Math.min(0.8, value)) * 32767), 44 + i * 2);
  }
  return wav;
}

/** Original, dry typesetting foley. Only an explicitly animated editorial element earns it. */
export function renderEditorialSound(name: EditorialSound): Buffer {
  const rate = 48000;
  const seconds = EDITORIAL_SFX[name].seconds;
  const frames = Math.round(seconds * rate);
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(frames * 2, 40);
  let seed = name === "assemble" ? 0x2e513bab : name === "settle" ? 0x6c8e9cf5 : 0x45d9f3b;
  let low = 0;
  let high = 0;
  const filter = (hz: number) => 1 - Math.exp(-2 * Math.PI * hz / rate);
  const lowRate = filter(name === "settle" ? 2100 : name === "paper" ? 3600 : 4600);
  const highRate = filter(name === "settle" ? 180 : name === "paper" ? 450 : 700);
  for (let i = 0; i < frames; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const noise = ((seed >>> 0) / 0xffffffff) * 2 - 1;
    low += lowRate * (noise - low);
    high += highRate * (low - high);
    const air = low - high;
    const t = i / rate;
    const remaining = (frames - 1 - i) / rate;
    let value: number;
    if (name === "settle") {
      /* A small landing, with body but no cinematic bass boom or reverberant tail. */
      const envelope = Math.min(1, t / 0.001, remaining / 0.008) * Math.exp(-t * 62);
      value = (air * 0.62 + Math.sin(2 * Math.PI * 260 * t) * 0.19) * envelope;
    } else if (name === "paper") {
      /* One soft slide, gently articulated; it is not a loop tied to the music. */
      const envelope = Math.min(1, t / 0.024, remaining / 0.045) * Math.pow(Math.sin(Math.PI * t / seconds), 0.65);
      value = air * envelope * 0.64 * (0.82 + 0.18 * Math.sin(2 * Math.PI * 19 * t));
    } else {
      /* A short brushed approach leaves the final placement to the separate settle cue. */
      const envelope = Math.min(1, t / 0.007, remaining / 0.028) * Math.exp(-t * 12);
      value = (air * 0.68 + Math.sin(2 * Math.PI * 690 * t) * 0.025) * envelope;
    }
    wav.writeInt16LE(Math.round(Math.max(-0.65, Math.min(0.65, value)) * 32767), 44 + i * 2);
  }
  return wav;
}

async function writeEditorialSfx(dir: string, missingOnly: boolean): Promise<string[]> {
  const written: string[] = [];
  for (const name of Object.keys(EDITORIAL_SFX) as EditorialSound[]) {
    const out = join(dir, `${name}.wav`);
    if (missingOnly && existsSync(out)) continue;
    await writeFile(out, renderEditorialSound(name));
    written.push(out);
  }
  return written;
}

/** Write every effect to `dir`. Deterministic: the same expressions, every time. */
export async function makeSfx(dir: string): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  for (const [name, sfx] of Object.entries(SFX)) {
    const out = join(dir, `${name}.wav`);
    await run("ffmpeg", [
      "-y", "-v", "error",
      "-f", "lavfi",
      /*
        Every comma inside the expression is escaped exactly once, here and nowhere
        else — the source strings stay readable maths. Escaping twice produces
        `No option name near '48000'`, which names the sample rate and means the
        comma.
      */
      "-i", `aevalsrc=${sfx.expr.replace(/,/g, "\\,")}:s=48000:d=${sfx.seconds}`,
      "-af", `${sfx.post},afade=t=out:st=${Math.max(0, sfx.seconds - 0.02)}:d=0.02`,
      "-ac", "1", "-ar", "48000",
      out,
    ]);
    written.push(out);
  }
  for (const name of ["click", "scroll", "key"] as const) {
    const out = join(dir, `${name}.wav`);
    await writeFile(out, renderInteractionSound(name));
    written.push(out);
  }
  written.push(...await writeEditorialSfx(dir, false));
  return written;
}

/** Upgrade an old sound set without rewriting its existing interactions or edit effects. */
export async function ensureSfx(dir: string): Promise<boolean> {
  const names = [...Object.keys(SFX), "click", "scroll", "key"];
  if (names.every((name) => existsSync(join(dir, `${name}.wav`)))) return (await writeEditorialSfx(dir, true)).length > 0;
  await makeSfx(dir);
  return true;
}
