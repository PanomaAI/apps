import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EDITORIAL_SFX, SFX, ensureSfx, renderEditorialSound, type EditorialSound } from "@panoma/video-audio";
import { makeGrid } from "@panoma/video-core";
import { promoAssemblyParts, type CastSession, type PromoPlan, type PromoTitleSection } from "@panoma/video-render/timing";
import { promoSoundCues } from "@panoma/video-render/sound";
import { promoRowArrivalFrames } from "../apps/render/src/recipes/presentation.ts";

const names = Object.keys(EDITORIAL_SFX) as EditorialSound[];
const session: CastSession = { viewport: { width: 1440, height: 900 }, durationMs: 6000, fps: 25, marks: [], events: [{ kind: "click", t: 2700, x: 400, y: 300 }] };
const plan: PromoPlan = { durationInFrames: 650, sections: [
  { kind: "hook", id: "first", text: "A whole sentence on the poster", from: 0, to: 60 },
  { kind: "benefit", id: "second", text: "Keep every original word in its own place", from: 60, to: 180 },
  { kind: "proof", id: "proof", mark: "real", from: 180, to: 250, sourceFrom: 2, sourceTo: 4.5, playRate: 1.2, holdFrom: 243, resultFrom: 215, resultSource: 3.4, presses: [{ frame: 198, x: 400, y: 300 }] },
  { kind: "terminal", id: "source", text: "npx panoma-video ./project", from: 250, typingFrom: 256, typingTo: 280, to: 340 },
  { kind: "recap", id: "recap", text: "Shown in the product", from: 340, to: 520, rows: [{ id: "a", text: "One demonstrated benefit", from: 340 }, { id: "b", text: "Another demonstrated benefit", from: 400 }] },
  { kind: "end", id: "end", text: "Acme Studio\nhttps://example.test", from: 520, to: 650 },
] };

test("Grid typesetting sounds use the exact shared group and landing frames, leaving the poster and real actions intact", () => {
  for (const beatFrames of [13, 15, 20]) {
    const grid = makeGrid({ fps: 30, bpm: 1800 / beatFrames });
    const cues = promoSoundCues(session, plan, 30, "grid", beatFrames);
    const editorial = cues.filter((cue) => names.includes(cue.kind as EditorialSound));
    assert.ok(editorial.length > 0);
    assert.ok(!editorial.some((cue) => cue.from < 60), "the already assembled first-frame poster earns no imaginary assembly sound");
    for (const section of plan.sections.filter((section): section is PromoTitleSection => section.kind === "benefit" || section.kind === "end")) {
      const text = section.kind === "end" ? section.text.split("\n")[0] : section.text;
      const parts = promoAssemblyParts(text, section.from, section.to, grid);
      const own = editorial.filter((cue) => cue.from >= section.from && cue.from < section.to);
      assert.deepEqual(own.filter((cue) => cue.kind === "assemble").map((cue) => cue.from), parts.map((part) => part.from), "each displaced phrase group supplies its sound onset");
      assert.deepEqual(own.filter((cue) => cue.kind === "settle").map((cue) => cue.from), [Math.max(...parts.map((part) => part.settledAt))], "one landing closes the whole assembly");
      assert.ok(parts.length <= 3, "sound density is bounded by the visual phrase grouping");
    }
    const recap = plan.sections.find((section) => section.kind === "recap")!;
    const list = cues.filter((cue) => cue.from >= recap.from && cue.from < recap.to);
    assert.deepEqual(list.filter((cue) => cue.kind === "paper").map((cue) => cue.from), recap.rows.map((row) => row.from));
    assert.deepEqual(list.filter((cue) => cue.kind === "settle").map((cue) => cue.from), recap.rows.map((row) => row.from + promoRowArrivalFrames(30, "grid") - 1));
    assert.ok(!list.some((cue) => cue.kind === "click"), "a stacked card does not double its placement with a generic recap click");
    for (const cue of editorial) {
      assert.equal(cue.sourceTimeMs, undefined, "authored paper never impersonates a recorded interaction");
      assert.ok(Number.isInteger(cue.from) && Number.isInteger(cue.durationInFrames));
      const section = plan.sections.find((section) => cue.from >= section.from && cue.from < section.to)!;
      assert.ok(cue.from + cue.durationInFrames <= section.to, "a gesture tail cannot spill onto the following scene");
    }
    const normal = promoSoundCues(session, plan, 30);
    assert.deepEqual(cues.filter((cue) => cue.sourceTimeMs !== undefined || cue.kind === "key"), normal.filter((cue) => cue.sourceTimeMs !== undefined || cue.kind === "key"), "the real click clock and source typing stay unchanged");
    for (const theme of ["flat", "vibrant", "block"] as const) assert.deepEqual(promoSoundCues(session, plan, 30, theme, beatFrames), normal, "other themes gain no Grid foley");
  }
});

test("short or blank Grid cards cannot earn sounds without a visible move or carry a tail beyond their cut", () => {
  for (const text of [" ", "One", "One two three four five six"]) for (const span of [1, 2, 3, 6]) {
    const short: PromoPlan = { durationInFrames: 30 + span, sections: [{ kind: "benefit", id: "short", text, from: 30, to: 30 + span }] };
    const cues = promoSoundCues({ ...session, events: [] }, short, 30, "grid", 13);
    if (span === 1 || !text.trim()) assert.deepEqual(cues, []);
    assert.equal(new Set(cues.map((cue) => `${cue.kind}:${cue.from}`)).size, cues.length, "a clamped group cannot double an onset");
    assert.ok(cues.every((cue) => cue.from >= 30 && cue.from + cue.durationInFrames <= 30 + span));
  }
});

test("editorial foley is distinct deterministic PCM with quiet boundaries, headroom and no sample assets", () => {
  const waves = names.map(renderEditorialSound);
  for (const [i, wav] of waves.entries()) {
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.readUInt32LE(24), 48000);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal((wav.length - 44) / 2, Math.round(EDITORIAL_SFX[names[i]].seconds * 48000));
    assert.ok(wav.equals(renderEditorialSound(names[i])));
    let peak = 0, sum = 0;
    const samples: number[] = [];
    for (let at = 44; at < wav.length; at += 2) { const value = wav.readInt16LE(at) / 32768; samples.push(value); peak = Math.max(peak, Math.abs(value)); sum += value; }
    assert.ok(peak > 0.05 && peak < 0.65, `${names[i]} has useful signal and ample headroom`);
    assert.equal(samples[0], 0);
    assert.equal(samples.at(-1), 0, "there is no sample-boundary pop at the tail");
    assert.ok(Math.abs(sum / samples.length) < 0.005, "the texture has negligible DC offset");
    const rms = (values: number[]) => Math.sqrt(values.reduce((n, value) => n + value * value, 0) / values.length);
    assert.ok(rms(samples.slice(-240)) < rms(samples) * 0.2, "the final five milliseconds release smoothly");
  }
  for (let i = 0; i < waves.length; i++) for (let j = i + 1; j < waves.length; j++) assert.ok(!waves[i].equals(waves[j]));
});

test("adding Grid sound assets preserves every existing legacy WAV and is idempotent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-grid-sounds-"));
  try {
    const legacy = [...Object.keys(SFX), "click", "scroll", "key"];
    for (const name of legacy) await writeFile(join(dir, `${name}.wav`), `existing-${name}`);
    assert.equal(await ensureSfx(dir), true);
    for (const name of legacy) assert.equal(await readFile(join(dir, `${name}.wav`), "utf8"), `existing-${name}`);
    for (const name of names) assert.ok((await readFile(join(dir, `${name}.wav`))).equals(renderEditorialSound(name)));
    assert.equal(await ensureSfx(dir), false);
    await rm(join(dir, "paper.wav"));
    assert.equal(await ensureSfx(dir), true, "one missing editorial asset can be repaired on its own");
    assert.equal(await ensureSfx(dir), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
