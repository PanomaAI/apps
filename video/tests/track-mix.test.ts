import "@panoma/video-engine/register";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Brief } from "@panoma/video-core";

/*
  The seam between the score stage and the mix, read from the outside: a brief with a
  brought track and its pulse, built into compositions, mounts the track at the gain the
  measured loudness asks for, fades it, and hands the recipes a pulse at the brief's level.
*/
const dir = mkdtempSync(join(tmpdir(), "panoma-video-track-mix-"));
const wav = join(dir, "own.wav");
writeFileSync(wav, Buffer.alloc(44));
const pulseFile = join(dir, "own.pulse.json");
writeFileSync(pulseFile, JSON.stringify({ fps: 30, lufs: -12.9, bpm: 120, energy: [0.5], low: [0.5], beats: [{ frame: 0, strength: 1, down: true }] }));

const brief = (music: Brief["music"]): Brief => ({
  id: "facts",
  recipe: "KineticQuote",
  langs: ["en"],
  bpm: 120,
  fps: 30,
  hooks: [{ id: "h", text: { en: "Hello" } }],
  lines: [{ id: "l1", text: { en: "One line" } }],
  ...(music ? { music } : {}),
});

test("a brought track sits where the bed sat, corrected by its loudness, and fades over the last bar", async () => {
  const { buildCompositions } = await import("@panoma/video-render/compositions");
  const dirs = { assets: dir, sessions: dir, generated: dir, sfx: dir };
  const { compositions } = buildCompositions([brief({ file: wav, pulse: pulseFile, dance: "full" })], dirs);
  const clip = compositions[0]!.audio.find((a) => a.path === wav)!;
  /* The bed's 0.9 alone, times 10^((-18 - -12.9) / 20). */
  assert.equal(clip.volume, Math.round(0.9 * Math.pow(10, (-18 + 12.9) / 20) * 1000) / 1000);
  assert.deepEqual(clip.fade, { in: 15 / 30, out: 60 / 30 });
  /* Without a pulse the file keeps the gain it always had, and nothing fades. */
  const plain = buildCompositions([brief({ file: wav })], dirs).compositions[0]!.audio.find((a) => a.path === wav)!;
  assert.equal(plain.volume, 0.9);
  assert.equal(plain.fade, undefined);
  /* And no bed is mounted beside a track. */
  assert.ok(compositions[0]!.audio.every((a) => !a.path.endsWith(".bed.wav")));
});

test("an imported track leaves the product still unless the brief explicitly requests dance", async () => {
  const { buildCompositions } = await import("@panoma/video-render/compositions");
  const { renderFrameHtml } = await import("@panoma/video-engine");
  const motionPulse = join(dir, "motion.pulse.json");
  writeFileSync(motionPulse, JSON.stringify({ fps: 30, energy: Array(600).fill(0.5), low: Array(600).fill(0.5), beats: Array.from({ length: 40 }, (_, i) => ({ frame: i * 15, strength: 1, down: i % 4 === 0 })) }));
  writeFileSync(join(dir, "motion.desktop.webm"), "");
  writeFileSync(join(dir, "motion.desktop.session.json"), JSON.stringify({
    name: "motion", take: "desktop", video: "motion.desktop.webm", url: "https://example.test", fps: 25, videoRatio: 2,
    viewport: { width: 1920, height: 1080 }, durationMs: 8000, readyMs: 0,
    marks: [{ name: "open", t: 0 }, { name: "result", t: 4000 }],
    events: [{ kind: "click", t: 800, x: 900, y: 400 }],
  }));
  const dirs = { assets: dir, sessions: dir, generated: dir, sfx: dir };
  const html = (dance?: "off" | "light" | "full") => {
    const tutorial: Brief = {
      ...brief({ file: wav, pulse: motionPulse, ...(dance ? { dance } : {}) }),
      recipe: "Tutorial", session: "motion",
      lines: [{ id: "open", mark: "open", text: { en: "Open the project." } }, { id: "result", mark: "result", text: { en: "Read the result." } }],
    };
    const comp = buildCompositions([tutorial], dirs).compositions.find((c) => c.format.id === "h")!;
    assert.ok(comp);
    return renderFrameHtml(comp.element(), { frame: 60, fps: comp.fps, durationInFrames: comp.durationInFrames, format: comp.format });
  };
  assert.equal(html(), html("off"), "music alone must never add camera pulses");
  assert.notEqual(html("light"), html("off"), "explicit musical motion remains available");
  assert.equal(html("full"), html("light"), "a tutorial keeps musical motion restrained for reading");
});
