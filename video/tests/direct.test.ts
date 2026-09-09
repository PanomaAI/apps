/*
  The brain directing the film: the ninth question, and what the director does with its
  answer. Nothing here reaches a model — every brain is a scripted driver — because what
  is under test is the boundary: the candidates the question lists, the clamp on an
  answer outside them, the record that is written, and the one promise that matters
  most: without a brain, or with one that fails, the direction is the arithmetic
  direction, deep-equal to what `directionOf` returns today.
*/
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultColors, type BrandProfile } from "@panoma/video-brand";
import { KEYS, ROWS, TEMPOS } from "@panoma/video-brand/direction";
import { directQuestion, openBrain, type Ask, type Driver } from "@panoma/video-brain";
import { clampChoice, directionFor, directionOf, openWorkspace, type DirectionFile } from "@panoma/video-director";
import type { TourScript } from "@panoma/video-tour";

/** A driver that answers from a script and keeps what it was asked. */
function fake(answers: unknown[] | ((ask: Ask) => unknown)): Driver & { asked: Ask[] } {
  const asked: Ask[] = [];
  let i = 0;
  return {
    name: "claude",
    asked,
    async available() {
      return { ok: true, model: "fake-model", how: "fake claude" };
    },
    async complete(ask) {
      asked.push(ask);
      const json = typeof answers === "function" ? answers(ask) : answers[Math.min(i++, answers.length - 1)];
      return { json, model: "fake-model" };
    },
  };
}

/* universend, as its brand.json reads: dark, chromatic, a product that does something. */
const universend: BrandProfile = {
  source: { extractedAt: "2026-09-03T00:00:00.000Z" },
  name: "Universend",
  colors: {
    ...defaultColors(),
    primary: { hex: "#dbff64", confidence: "high", origin: "census" },
    accent: { hex: "#dbff64", confidence: "medium", origin: "primary" },
    background: { hex: "#02030a", confidence: "high", origin: "body" },
    surface: { hex: "#161615", confidence: "medium", origin: "derived" },
    text: { hex: "#f4f2ea", confidence: "high", origin: "css-token:--ink" },
    muted: { hex: "#7b8296", confidence: "high", origin: "css-token:--muted" },
    onPrimary: { hex: "#000000", confidence: "high", origin: "wcag" },
  },
  tokens: {},
  scheme: { supports: ["dark"], default: "dark" },
  type: { heading: { category: "sans", family: "Geist" }, body: { category: "sans", family: "Geist" }, mono: { category: "mono", family: "Geist Mono" } },
  tone: { register: "neutral", metrics: {} },
};

const mark = (kind: "hero" | "cta") => ({ name: kind, label: kind, kind }) as never;
const tour = { marks: [mark("hero"), mark("cta"), mark("cta")] } as unknown as TourScript;

const thesis = {
  what: { en: "A messaging app for teams." },
  angle: { en: "one inbox for every channel" },
  audience: "small teams",
  interfaceLang: "en",
  verbs: ["send", "open"],
  show: { first: "Inbox", flows: ["Notifications"], avoid: ["Delete"] },
  tone: "plain" as const,
  why: "It is what the README leads with.",
};

/** A workspace in a temporary home, and a brain over the given driver, torn down together. */
async function setUp(driver: Driver | null) {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-direct-"));
  /* The home cannot be the filmed project, and cannot be inside it: `openWorkspace` refuses that. */
  const home = join(dir, "outputs"), root = join(dir, "product");
  await mkdir(root, { recursive: true });
  const ws = await openWorkspace(root, { home });
  const brain = driver ? (await openBrain({ choice: "auto", cacheDir: ws.paths.cache, scratchDir: ws.paths.cache, drivers: [driver] })).brain : null;
  return { home, ws, brain, done: () => rm(dir, { recursive: true, force: true }) };
}

test("the question lists every candidate, the proposal, and the doctrine, and asks at low effort", () => {
  const proposed = directionOf(universend, tour);
  const asked = directQuestion({
    thesis: { what: thesis.what, angle: thesis.angle, audience: thesis.audience, tone: thesis.tone, verbs: thesis.verbs },
    measured: { scheme: proposed.scheme, signal: proposed.signal, register: "neutral", kind: "web-app", marks: 3, flows: 2 },
    proposed: { name: proposed.name, style: proposed.sound.style, key: proposed.sound.key, bpm: proposed.sound.bpm, dance: proposed.dance },
    candidates: {
      names: Object.keys(ROWS).map((id) => ({ id, means: `row ${id}` })),
      styles: ["calm", "pulse", "dark", "bright"].map((id) => ({ id, means: `style ${id}` })),
      keys: [...KEYS],
      tempos: [...TEMPOS],
      dances: [{ id: "off", means: "dance off" }],
    },
    music: { given: true, bpm: 128, seconds: 31 },
  });
  assert.equal(asked.id, "direct");
  assert.equal(asked.effort, "low");
  for (const name of Object.keys(ROWS)) assert.match(asked.user, new RegExp(`- ${name}: row ${name}`), `the row ${name} is not offered`);
  for (const style of ["calm", "pulse", "dark", "bright"]) assert.match(asked.user, new RegExp(`- ${style}: style ${style}`), `the style ${style} is not offered`);
  for (const key of KEYS) assert.ok(asked.user.includes(key), `the key ${key} is not offered`);
  for (const bpm of TEMPOS) assert.ok(asked.user.includes(String(bpm)), `the tempo ${bpm} is not offered`);
  assert.match(asked.user, /- off: dance off/);
  assert.doesNotMatch(asked.user, /- (light|full):/);
  assert.match(asked.user, new RegExp(`row ${proposed.name} · style ${proposed.sound.style} · key ${proposed.sound.key} · ${proposed.sound.bpm} BPM · dance ${proposed.dance}`), "the proposal is shown whole");
  /* The doctrine is in the prompt, not only in the arithmetic: the brain may depart from it, and it must know what it departs from. */
  assert.match(asked.user, /no flows.*editorial/);
  assert.match(asked.user, /dark, chromatic.*kinetic/);
  assert.match(asked.user, /90 for calm documentation or a CLI tool, 100 for an app, 120 for something that moves/);
  assert.match(asked.user, /Dance stays off/);
  assert.match(asked.user, /Only an explicit caller option can enable musical motion/);
  assert.match(asked.user, /A track was brought at 128\.0 BPM, 31 seconds long/);
  assert.match(asked.user, /Nothing here is a colour/);
  /* Nothing a brain reads here came from the product's own text, so nothing needs the untrusted wrapper — and no hex is offered. */
  assert.ok(!/#[0-9a-f]{6}/i.test(asked.user), "a colour was offered to the brain");
});

test("an answer outside the candidates falls back to the proposal, field by field, and says so", () => {
  const proposed = directionOf(universend, tour);
  const proposal = { name: proposed.name, style: proposed.sound.style, key: proposed.sound.key, bpm: proposed.sound.bpm, dance: proposed.dance };
  const { choice, clamped } = clampChoice({ row: "editorial", style: "jazz", key: "B major", bpm: 128, dance: "light" }, proposal);
  assert.equal(choice.name, "editorial", "a candidate is taken");
  assert.equal(choice.dance, "off", "only the caller can enable musical motion");
  assert.equal(choice.style, proposal.style, "a style that is not one of the four is the proposal's");
  assert.equal(choice.key, proposal.key);
  assert.equal(choice.bpm, proposal.bpm, "a tempo that is not a whole number of frames is the proposal's");
  assert.equal(clamped.length, 4);
  assert.match(clamped[0]!, /style "jazz" is not one of calm, pulse, dark, bright/);
});

test("without a brain the direction is the arithmetic direction, deep-equal, and the record says so", async () => {
  const { ws, done } = await setUp(null);
  try {
    const decisions: string[] = [];
    const direction = await directionFor({ brain: null, brand: universend, tour, ws, decisions });
    assert.deepEqual(direction, directionOf(universend, tour));
    assert.equal(direction.by, "arithmetic");
    assert.deepEqual(decisions, [], "nothing was decided, so nothing is recorded as a decision");
    const file = JSON.parse(await readFile(ws.paths.direction, "utf8")) as DirectionFile;
    assert.equal(file.by, "arithmetic");
    assert.deepEqual(file.chosen, file.proposed);
    assert.deepEqual(file.direction, direction);
  } finally {
    await done();
  }
});

test("a brain's choice changes the row and the bed, and never a colour or the scheme", async () => {
  const driver = fake([{ row: "editorial", style: "calm", key: "C major", bpm: 90, dance: "off", why: "A docs site: it shows itself, and nobody dances to documentation." }]);
  const { ws, brain, done } = await setUp(driver);
  try {
    const proposed = directionOf(universend, tour);
    assert.equal(proposed.name, "kinetic", "the fixture is a dark chromatic product with flows");
    const decisions: string[] = [];
    const direction = await directionFor({ brain, thesis, brand: universend, tour, kind: "web-app", ws, decisions });
    assert.equal(driver.asked.length, 1, "one question");
    assert.equal(direction.by, "brain");
    assert.equal(direction.name, "editorial");
    assert.deepEqual(direction.sound, { style: "calm", key: "C major", bpm: 90 });
    assert.equal(direction.dance, "off");
    assert.deepEqual(direction.motion.enters.slice().sort(), [...ROWS.editorial.enters].sort(), "the enters are the chosen row's");
    assert.deepEqual(direction.furniture, ROWS.editorial.furniture);
    /* The whole point: judgement may move the rhythm, the furniture and the sound. It may not move a colour. */
    for (const k of ["stage", "page", "plate", "scrim", "ink", "muted", "faint", "line", "accent", "onAccent", "inverted", "fonts", "contrast", "branded", "seed", "scheme", "signal"] as const) {
      assert.deepEqual(direction[k], proposed[k], `the brain moved ${k}`);
    }
    assert.equal(direction.version, proposed.version, "a choice is not a rule change");
    /* The record: the file, and the decisions with the why. */
    const file = JSON.parse(await readFile(ws.paths.direction, "utf8")) as DirectionFile;
    assert.equal(file.by, "brain");
    assert.equal(file.proposed.name, "kinetic");
    assert.equal(file.chosen.name, "editorial");
    assert.match(file.why, /shows itself/);
    assert.deepEqual(file.clamped, []);
    assert.equal(decisions.length, 1);
    assert.match(decisions[0]!, /^direct: name kinetic → editorial.*nobody dances to documentation/);
    /* And the same choice again is the same film: the answer is cached and the derivation is pure. */
    const again = await directionFor({ brain, thesis, brand: universend, tour, kind: "web-app", ws });
    assert.deepEqual(again, direction);
    assert.equal(driver.asked.length, 1, "the second run was answered from the cache");
  } finally {
    await done();
  }
});

test("a brain may direct the film but cannot enable musical motion, even with a supplied track", async () => {
  const driver = fake([{ row: "kinetic", style: "jazz", key: "D minor", bpm: 100, dance: "full", why: "It moves; keep it moving." }]);
  const { ws, brain, done } = await setUp(driver);
  try {
    const proposed = directionOf(universend, tour);
    const decisions: string[] = [];
    const direction = await directionFor({ brain, brand: universend, tour, music: { given: true, bpm: 140, seconds: 30 }, ws, decisions });
    assert.equal(direction.sound.style, proposed.sound.style, "jazz is not a style panoma video can play");
    assert.equal(direction.sound.key, "D minor");
    assert.equal(direction.sound.bpm, 100);
    assert.ok(TEMPOS.includes(direction.sound.bpm as (typeof TEMPOS)[number]), "the tempo stays a legal grid");
    const file = JSON.parse(await readFile(ws.paths.direction, "utf8")) as DirectionFile;
    assert.equal(direction.dance, "off", "a valid legacy full answer is clamped, not obeyed");
    assert.equal(file.chosen.dance, "off");
    assert.equal(file.clamped.length, 2);
    assert.ok(decisions.some((d) => /direct: style "jazz" is not one of/.test(d)), "the clamp is a decision a person can read");
    assert.ok(decisions.some((d) => /dance "full" is not one of off/.test(d)), "the ignored musical motion is recorded");
    assert.doesNotMatch(driver.asked[0]!.user, /- (light|full):/, "the brain is offered no musical mode");
  } finally {
    await done();
  }
});

test("a legacy proposal cannot restore the brain's permission to enable musical motion", () => {
  const proposed = { name: "kinetic" as const, style: "pulse" as const, key: "A minor", bpm: 120, dance: "full" as const };
  const { choice, clamped } = clampChoice({ row: "kinetic", style: "pulse", key: "A minor", bpm: 120, dance: "full" }, proposed);
  assert.equal(choice.dance, "off");
  assert.match(clamped[0]!, /kept "off"/);
});

test("a brain that does not answer leaves the arithmetic direction exactly as it was", async () => {
  /* Two misses of the shape: the brain refuses, and the film is the film it would have been without one. */
  const driver = fake([{ row: 3 }, { nope: true }]);
  const { ws, brain, done } = await setUp(driver);
  try {
    const decisions: string[] = [];
    const direction = await directionFor({ brain, brand: universend, tour, ws, decisions });
    assert.deepEqual(direction, directionOf(universend, tour));
    assert.equal(direction.by, "arithmetic");
    assert.match(decisions[0]!, /^direct: claude did not answer .*; the arithmetic direction stands/);
    const file = JSON.parse(await readFile(ws.paths.direction, "utf8")) as DirectionFile;
    assert.equal(file.by, "arithmetic");
  } finally {
    await done();
  }
});
