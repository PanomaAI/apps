import "@panoma/video-engine/register";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import type { Brief } from "@panoma/video-core";
import { ensureSfx, renderInteractionSound } from "@panoma/video-audio";
import { castPlan, castSpeed, trailerPlan, tutorialPlan, tutorialSourceAt, type CastSession, type PromoPlan, type PromoProof, type SpotlightPlan, type SpotlightUnit } from "@panoma/video-render/timing";
import { castSoundCues, promoSoundCues, spotlightSoundCues, trailerSoundCues, tutorialSoundCues } from "@panoma/video-render/sound";

const hook = { id: "h", text: { en: "Open the right project." } };
const brief: Brief = {
  id: "sound-test", recipe: "Tutorial", langs: ["en"], bpm: 1800 / 13, fps: 30, session: "s", hooks: [hook],
  lines: [
    { id: "one", mark: "open", label: { en: "Open" }, text: { en: "Open the project and inspect the result." } },
    { id: "two", mark: "read", label: { en: "Read" }, text: { en: "Scroll through the project and type its name." } },
  ],
};
const session: CastSession = {
  viewport: { width: 1440, height: 900 }, durationMs: 16000, fps: 25, readyMs: 2000,
  marks: [{ name: "open", t: 3000 }, { name: "read", t: 10000 }],
  events: [
    { kind: "click", t: 1000, x: 100, y: 100 },
    { kind: "click", t: 3240, x: 110, y: 100, role: "chrome" },
    { kind: "click", t: 3721, x: 400, y: 250 },
    { kind: "scroll", t: 8100, y: 0, durationMs: 800 },
    { kind: "scroll", t: 10111, y: 630, durationMs: 960 },
    { kind: "key", t: 11477, text: "Acme" },
    { kind: "key", t: 12500, text: "secret", role: "chrome" },
    { kind: "scroll", t: 13000, y: 600, role: "chrome" },
    { kind: "click", t: 15999, x: 700, y: 500 },
  ],
};

test("tutorial foley follows its retimed picture and press frames, never the beat or the card", () => {
  const plan = tutorialPlan(session, brief, hook, "en");
  const cues = tutorialSoundCues(session, plan, 30);
  assert.deepEqual(cues.map((cue) => cue.kind), ["click", "scroll", "key", "click"]);
  assert.deepEqual(cues.filter((cue) => cue.kind === "click").map((cue) => cue.from), plan.steps.flatMap((step) => step.presses.map((press) => press.frame)));
  assert.ok(cues.some((cue) => cue.from % 13 !== 0), "observed actions are allowed between beats");
  for (const cue of cues) {
    const step = plan.steps.find((step) => cue.from >= step.cardTo && cue.from < step.to)!;
    assert.ok(step, "every sound begins with the product visible");
    assert.ok(cue.from + cue.durationInFrames <= step.to, "no tail crosses onto the next card");
    const source = tutorialSourceAt(plan, session, cue.from, 30);
    assert.ok(Math.abs(source * 1000 - cue.sourceTimeMs!) <= step.playRate * 1000 / 30 + 1, "sound and encoded picture refer to the same source frame");
  }
  const scroll = cues.find((cue) => cue.kind === "scroll")!;
  assert.equal(scroll.durationInFrames, Math.ceil(0.960 / plan.steps[1].playRate * 30));
  const last = cues[cues.length - 1];
  const trimmed = { ...plan, steps: plan.steps.map((step, i) => i === plan.steps.length - 1 ? { ...step, to: last.from + 1 } : step) };
  assert.equal(tutorialSoundCues(session, trimmed, 30).at(-1)!.durationInFrames, 1, "a last-frame action cannot spill onto the end card");
});

test("trailer sound only quotes the source ranges that its proofs actually show", () => {
  const trailer = { ...brief, recipe: "ReleaseTrailer" as const };
  const take = { ...session, durationMs: 26000, marks: [{ name: "hero", t: 3000 }, { name: "open", t: 3000 }, { name: "read", t: 20000 }] };
  const plan = trailerPlan(take, trailer, "en");
  const cues = trailerSoundCues(take, plan, 30);
  const proofs = plan.sections.filter((section) => section.kind === "proof");
  const open = plan.sections.find((section) => section.kind === "open")!;
  assert.deepEqual(cues.filter((cue) => cue.kind === "click" && cue.from >= open.to).map((cue) => cue.from), proofs.flatMap((proof) => proof.presses.map((press) => press.frame)));
  assert.ok(cues.some((cue) => cue.from < open.to), "the live cold open also sounds its actions");
  assert.ok(cues.every((cue) => cue.from < open.to || proofs.some((proof) => cue.from >= proof.from && cue.from < proof.to)));
  const late = { ...take, events: [...take.events, { kind: "key" as const, t: 18000, text: "omitted" }] };
  assert.ok(!trailerSoundCues(late, plan, 30).some((cue) => cue.sourceTimeMs === 18000), "the unshown tail earns no typing sound");
});

test("a screencast click uses the 25-to-30 conform and legacy scrolls get an onset only", () => {
  const cast = castPlan(session, brief);
  const cues = castSoundCues(session, cast, 30);
  const click = cues.find((cue) => cue.sourceTimeMs === 3721)!;
  assert.equal(click.from, cast.videoStart + Math.round((3.721 - 2) * 30 / castSpeed(session, 30)));
  assert.ok(!cues.some((cue) => cue.sourceTimeMs === 1000 || cue.sourceTimeMs === 3240));
  const legacy = { ...session, events: [{ kind: "scroll" as const, t: 4000, y: 600 }] };
  assert.equal(castSoundCues(legacy, cast, 30)[0].durationInFrames, Math.ceil(0.16 * 30));
});

test("a spotlight sounds its visible staged press only when the take pressed", () => {
  const framed = { window: { x: 0, y: 0, width: 1440, height: 900 }, k: 1.3, cx: 960, cy: 540 };
  /* One staged use: the pointer ticks in, the camera pushes, the press lands, and the revealed page opens on the frame after it. */
  const unit: SpotlightUnit = {
    kind: "unit", from: 0, to: 100, id: "one", mark: "open", index: 0, form: "reveal", fx: 0.5, fy: 0.4, clicked: true,
    pointerFrom: 10, pushFrom: 27, press: 40, result: 53, unfoldFrom: 53, pageFrom: 53, rest: 79,
    camera: { framed, pressed: { ...framed, k: 2 }, result: { ...framed, k: 1.5 } },
  };
  const plan: SpotlightPlan = { durationInFrames: 200, degraded: [], sections: [unit,
    { ...unit, id: "two", index: 1, from: 100, to: 200, pointerFrom: 110, pushFrom: 127, press: 140, result: 153, unfoldFrom: 153, pageFrom: 153, rest: 179, clicked: false }] };
  assert.deepEqual(spotlightSoundCues(plan, 30).map((cue) => cue.from), [40]);
});

test("a promo's result preview is silent while the real proof sounds only its shown actions", () => {
  const source = {
    ...session,
    events: [
      { kind: "click" as const, t: 2700, x: 100, y: 100 },
      { kind: "click" as const, t: 3201, x: 400, y: 250 },
      { kind: "click" as const, t: 3204, x: 400, y: 250 },
      { kind: "scroll" as const, t: 4500, y: 650, durationMs: 1500 },
      { kind: "key" as const, t: 4600, text: "Consent", role: "chrome" as const },
      { kind: "key" as const, t: 5800, text: "Omitted" },
    ],
  };
  /* The footage runs to the cut, so `holdFrom` is the cut itself; the two logged presses fall on one frame, which the picture keeps and the sound below does not. */
  const proof: PromoProof = {
    kind: "proof", id: "one", mark: "open", from: 90, to: 150, sourceFrom: 3, sourceTo: 5.4, playRate: 1.2,
    holdFrom: 150, resultFrom: 140, resultSource: 5, presses: [{ frame: 95, x: 400, y: 250 }, { frame: 95, x: 400, y: 250 }],
  };
  const plan: PromoPlan = { durationInFrames: 180, sections: [
    { kind: "preview", from: 0, to: 45, mark: "open", sourceFrom: 3, sourceTo: 4.8, playRate: 1.2 },
    { kind: "hook", id: hook.id, text: hook.text.en, from: 45, to: 90 }, proof,
    { kind: "end", id: "end", text: "Acme", from: 150, to: 180 },
  ] };
  const cues = promoSoundCues(source, plan, 30);
  assert.deepEqual(cues.map((cue) => cue.kind), ["click", "scroll"], "no duplicate click, chrome input or omitted key");
  assert.equal(cues[0].from, 95, "the click follows the conformed source, between beats");
  assert.ok(cues.every((cue) => cue.from >= proof.from && cue.from < proof.to), "the identical source in a preview earns no fake action");
  assert.equal(cues[1].from, 128);
  assert.equal(cues[1].durationInFrames, 22, "a gesture cut short by the proof cannot run onto its closing card");
  const held = { ...plan, sections: plan.sections.map((section) => section === proof ? { ...proof, to: 175, holdFrom: 150 } : section) };
  assert.deepEqual(promoSoundCues(source, held, 30), cues, "a longer result hold cannot extend the sound of a stopped scroll");
});

test("interaction WAVs are dry deterministic PCM, with transient headroom and distinct textures", () => {
  const waves = ["click", "scroll", "key"].map((name) => renderInteractionSound(name as "click" | "scroll" | "key"));
  for (const [index, wav] of waves.entries()) {
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.readUInt32LE(24), 48000);
    assert.equal(wav.readUInt16LE(22), 1);
    let peak = 0;
    for (let at = 44; at < wav.length; at += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(at)) / 32768);
    assert.ok(peak > 0.05 && peak < 0.8, `sound ${index}: peak ${peak}`);
    assert.equal(wav.readInt16LE(44), 0, "no discontinuity at file start");
    assert.ok(wav.equals(renderInteractionSound((["click", "scroll", "key"] as const)[index])));
  }
  assert.ok(!waves[0].equals(waves[2]), "a key sounds distinct from a mouse press");
});

test("old workspaces acquire action assets once and the composition mounts them on the action clock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-action-sound-"));
  try {
    await writeFile(join(dir, "tick.wav"), Buffer.alloc(44));
    assert.equal(await ensureSfx(dir), true, "a legacy tick file cannot hide missing action foley");
    const before = await readFile(join(dir, "click.wav"));
    assert.equal(await ensureSfx(dir), false, "the next render does not regenerate sounds");
    assert.ok(before.equals(await readFile(join(dir, "click.wav"))));
    await writeFile(join(dir, "s.desktop.webm"), Buffer.alloc(1));
    await writeFile(join(dir, "s.desktop.session.json"), JSON.stringify({ ...session, video: "s.desktop.webm", name: "s", take: "desktop" }));
    const { buildCompositions, BED_UNDER_ACTION } = await import("@panoma/video-render/compositions");
    const matrix = buildCompositions([brief], { assets: dir, sessions: dir, generated: dir, sfx: dir });
    const audio = matrix.compositions.find((composition) => composition.format.id === "h")!.audio;
    assert.deepEqual(audio.map((clip) => clip.from), tutorialSoundCues(session, tutorialPlan(session, brief, hook, "en"), 30).map((cue) => cue.from));
    /*
      Compare the file, never the separator. `clip.path` is built with `join` and is
      handed to ffmpeg as an `-i` argument, so on Windows it is a native path with
      backslashes and posix-ifying it would be wrong; a regex anchored on `/` only
      looked like it named the sound. It failed there and passed everywhere else.
    */
    const foley = new Set(["click.wav", "scroll.wav", "key.wav"]);
    assert.ok(audio.every((clip) => foley.has(basename(clip.path))), "no riser, beat tick, or impact hides the product action");
    assert.ok(audio.every((clip) => clip.durationInFrames !== undefined));
    assert.ok(BED_UNDER_ACTION < 0.4, "the unvoiced score leaves action headroom");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
