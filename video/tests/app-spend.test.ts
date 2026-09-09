import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { appSpend, openBrain } from "@panoma/video-brain";
import type { Driver } from "../packages/brain/src/driver.ts";

test("a host allowance counts schema retries and spans multiple brain instances", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-app-spend-"));
  const oldJob = process.env.PANOMA_APP_JOB, oldCap = process.env.PANOMA_VIDEO_MAX_BRAIN_CALLS;
  process.env.PANOMA_APP_JOB = `test-${dir}`;
  process.env.PANOMA_VIDEO_MAX_BRAIN_CALLS = "1";
  let calls = 0;
  const driver: Driver = { name: "openai", available: async () => ({ ok: true, model: "fixture", how: "in-memory" }),
    complete: async () => { calls++; return { json: { answer: 123 }, model: "fixture", usage: { input: 4, output: 2 } }; } };
  try {
    const options = { choice: "openai" as const, drivers: [driver], cacheDir: join(dir, "cache"), scratchDir: dir };
    const first = (await openBrain(options)).brain!;
    const question = { id: "fixture", version: 1, system: "test", user: "test", shape: z.object({ answer: z.string() }) };
    await assert.rejects(first.ask(question), /allowance is exhausted/);
    const second = (await openBrain(options)).brain!;
    await assert.rejects(second.ask({ ...question, id: "second" }), /allowance is exhausted/);
    assert.equal(calls, 1);
    assert.deepEqual(appSpend(), { calls: 1, provider: "openai", model: "fixture", usage: { input: 4, output: 2 } });
  } finally {
    if (oldJob === undefined) delete process.env.PANOMA_APP_JOB; else process.env.PANOMA_APP_JOB = oldJob;
    if (oldCap === undefined) delete process.env.PANOMA_VIDEO_MAX_BRAIN_CALLS; else process.env.PANOMA_VIDEO_MAX_BRAIN_CALLS = oldCap;
    await rm(dir, { recursive: true, force: true });
  }
});

test("ElevenLabs shares the host allowance with model attempts before any network request", async () => {
  const { speakWithTimestamps, music, soundEffect, transcribe } = await import("@panoma/video-audio");
  const oldJob = process.env.PANOMA_APP_JOB, oldCap = process.env.PANOMA_VIDEO_MAX_BRAIN_CALLS, oldKey = process.env.ELEVENLABS_API_KEY;
  const oldFetch = globalThis.fetch;
  process.env.PANOMA_APP_JOB = `voice-${Date.now()}`;
  process.env.PANOMA_VIDEO_MAX_BRAIN_CALLS = "1";
  process.env.ELEVENLABS_API_KEY = "fixture-key";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ audio_base64: "", alignment: { characters: [], character_start_times_seconds: [], character_end_times_seconds: [] } }), { status: 200 });
  };
  try {
    await speakWithTimestamps({ text: "Hello", voiceId: "fixture" });
    assert.deepEqual(appSpend(), { calls: 1, provider: "elevenlabs", model: "eleven_multilingual_v2" });
    await assert.rejects(speakWithTimestamps({ text: "Again", voiceId: "fixture" }), /allowance is exhausted/);
    await assert.rejects(music({ prompt: "fixture", lengthMs: 1000 }), /allowance is exhausted/);
    await assert.rejects(soundEffect({ prompt: "fixture" }), /allowance is exhausted/);
    await assert.rejects(transcribe(Buffer.from("fixture")), /allowance is exhausted/);
    const { reserveAppCall } = await import("@panoma/video-brain");
    assert.throws(() => reserveAppCall("openai", "fixture"), /allowance is exhausted/);
    assert.equal(calls, 1, "no voice or model dispatch can exceed the combined allowance");
    process.env.PANOMA_VIDEO_MAX_BRAIN_CALLS = "2";
    reserveAppCall("openai", "fixture");
    assert.equal(appSpend().calls, 2);
    assert.equal(appSpend().provider, "multiple");
  } finally {
    globalThis.fetch = oldFetch;
    if (oldJob === undefined) delete process.env.PANOMA_APP_JOB; else process.env.PANOMA_APP_JOB = oldJob;
    if (oldCap === undefined) delete process.env.PANOMA_VIDEO_MAX_BRAIN_CALLS; else process.env.PANOMA_VIDEO_MAX_BRAIN_CALLS = oldCap;
    if (oldKey === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = oldKey;
  }
});
