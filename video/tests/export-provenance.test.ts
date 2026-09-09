import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { disclosureText, FORMATS, needsDisclosure, type Brief, type FactSheet } from "@panoma/video-core";
import type { SessionLog } from "@panoma/video-capture";
import type { CompositionDef } from "@panoma/video-engine";
import { exportProvenance } from "../packages/director/src/export-provenance.ts";
import { openWorkspace, writeJson } from "../packages/director/src/workspace.ts";

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-export-provenance-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "product");
  await mkdir(root);
  const ws = await openWorkspace(root, { home: join(dir, "panoma-video") });
  const facts: FactSheet = { project: "Acme", extractedAt: "2026-09-05T00:00:00Z", notFacts: [], facts: [
    { id: "name", kind: "text", value: "Acme", source: "package.json#name" },
    { id: "notes", kind: "text", value: "Project notes", source: "ui:notes" },
    { id: "context", kind: "text", value: "Saved context", source: "ui:context" },
  ] };
  const brief: Brief = { id: "promo", recipe: "ProductPromo", langs: ["en", "es"], bpm: 120, fps: 30, session: "take", voice: "requested-voice",
    hooks: [{ id: "first", text: { en: "{{fact:context}}", es: "{{fact:context}}" } }, { id: "second", text: { en: "{{fact:notes}}", es: "{{fact:notes}}" } }],
    lines: [{ id: "benefit", mark: "notes", text: { en: "Your project keeps its notes", es: "Las notas acompañan al proyecto" } }, { id: "brand", text: { en: "{{fact:name}}", es: "{{fact:name}}" } }],
    promo: { opening: "promise", pace: "crisp", evidence: { second: { mark: "notes", facts: ["notes"] }, benefit: { mark: "notes", facts: ["notes"] } } },
  };
  const takes: SessionLog[] = ["desktop", "mobile"].map(take => ({
    name: "take", take, recordedAt: facts.extractedAt, url: "http://127.0.0.1:1234/", head: "abc123def", isMobile: take === "mobile",
    video: `take.${take}.webm`, viewport: take === "mobile" ? { width: 540, height: 960 } : { width: 960, height: 540 },
    durationMs: 8000, readyMs: 500, fps: 25, marks: [], events: [],
  }));
  const comp: Pick<CompositionDef, "id" | "format" | "audio"> = { id: "promo--second--es--v", format: FORMATS.v, audio: [] };
  return { brief, facts, comp, takes, ws, profile: { git: undefined }, assetsDir: ws.dir, engine: "engine-revision", hasVoice: false,
    bedFile: join(ws.paths.generated, "bed.wav"), reviewFile: join(ws.paths.renders, "film.review.json"), renderedAt: facts.extractedAt };
}

test("provenance binds the selected hook, actual take and paraphrased proof to their source facts", async t => {
  const input = await fixture(t);
  input.takes[1]!.videoClock = { source: "screencast", version: 1, originMs: 1788678000000, offsetMs: -924 };
  input.comp.audio = [{ path: input.bedFile, from: 0 }];
  const result = await exportProvenance(input);
  assert.deepEqual(result.claims.map(claim => claim.line), ["second", "benefit", "brand"]);
  assert.deepEqual(result.claims[1], { line: "benefit", text: "Las notas acompañan al proyecto", facts: ["notes"] });
  assert.equal(result.takes.length, 1);
  assert.equal(result.takes[0]!.take, "mobile");
  assert.equal(result.takes[0]!.head, "abc123def");
  assert.deepEqual(result.takes[0]!.videoClock, input.takes[1]!.videoClock, "the actual mounted take carries its measured encoder origin");
  assert.equal(result.voice, undefined, "a requested voice is not necessarily mounted");
  assert.deepEqual(result.synthetic, { voice: false, music: true, cursor: true, broll: false });
  assert.equal(needsDisclosure(result), true);
  assert.match(disclosureText(result), /procedural music/i);
});

test("missing and muted music assets are not described as audible synthetic music", async t => {
  const input = await fixture(t);
  input.brief = { ...input.brief, music: { prompt: "A requested soundtrack" } };
  input.comp.audio = [{ path: input.bedFile, from: 0, volume: 0 }];
  const result = await exportProvenance(input);
  assert.equal(result.music, undefined);
  assert.equal(result.voice, undefined);
  assert.equal(needsDisclosure(result), false);
  assert.doesNotMatch(disclosureText(result), /music|voice/i);
});

test("a brought soundtrack names the original file and conform, without inventing AI music", async t => {
  const input = await fixture(t);
  const conformed = join(input.ws.paths.music, "track.wav");
  const source = "/music/precision-motion.mp3";
  input.brief = { ...input.brief, music: { file: "music/track.wav" } };
  input.comp.audio = [{ path: conformed, from: 0 }];
  await writeJson(join(input.ws.paths.music, "track.track.json"), { file: conformed, source, measured: 140, ratio: 0.99 });
  const result = await exportProvenance(input);
  assert.equal(result.music?.file, source);
  assert.equal(result.music?.conformed, conformed);
  assert.equal(result.music?.bpm, 140);
  assert.equal(result.music?.stretch, 0.99);
  assert.equal(result.music?.source, "file");
  assert.equal(result.synthetic.music, false);
  assert.equal(needsDisclosure(result), false);
  assert.doesNotMatch(disclosureText(result), /AI-generated|procedural music/);
});

test("synthetic voice needs matching mounted narration as well as validated word timings", async t => {
  const input = await fixture(t);
  input.hasVoice = true;
  input.comp.audio = [{ path: join(input.ws.paths.sfx, "click.wav"), from: 0 }];
  assert.equal((await exportProvenance(input)).synthetic.voice, false);
  input.comp.audio.push({ path: join(input.ws.paths.generated, "promo", "second-es.mp3"), from: 0 });
  const voiced = await exportProvenance(input);
  assert.equal(voiced.synthetic.voice, true);
  assert.equal(voiced.voice?.voiceId, "requested-voice");
  assert.equal(needsDisclosure(voiced), true);
});

test("mounted provider music is marked as generated while unrelated score records are ignored", async t => {
  const input = await fixture(t);
  const track = join(input.assetsDir, "provider.wav");
  input.brief = { ...input.brief, music: { file: track, prompt: "Generated score" } };
  input.comp.audio = [{ path: track, from: 0 }];
  await writeJson(join(input.ws.paths.music, "unrelated.track.json"), { file: "/another-track.wav", source: "/unrelated.mp3", measured: 120, ratio: 1 });
  const result = await exportProvenance(input);
  assert.equal(result.music?.source, "elevenlabs");
  assert.equal(result.music?.file, track);
  assert.equal(result.synthetic.music, true);
  assert.match(disclosureText(result), /AI-generated music/);
});
