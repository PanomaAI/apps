import assert from "node:assert/strict";
import { test } from "node:test";
import { progressFor } from "@panoma/video-mcp";
import { appCallCap } from "@panoma/video-brain";
test("every stage change survives coalescing and progress is strictly increasing", async () => {
  const messages: { progress: number; message?: string }[] = [];
  const progress = progressFor({ _meta: { progressToken: "job" }, sendNotification: async event => { messages.push(event.params); } });
  const stages = ["scout", "brand", "brain", "serve", "tour", "record", "score", "study", "plan", "narrate", "render", "review"];
  for (const stage of stages) progress(0, undefined, `${stage}: ready`);
  progress(10, 100, "review: measured");
  await progress.finish();
  assert.deepEqual(messages.slice(0, stages.length).map(row => row.message?.split(":")[0]), stages);
  assert.ok(messages.every((row, index) => index === 0 || row.progress > messages[index - 1].progress));
  assert.equal(messages.at(-1)?.message, "review: measured");
});
test("calls without a token send no notifications and carry cancellation unchanged", async () => {
  let messages = 0;
  const controller = new AbortController();
  const progress = progressFor({ signal: controller.signal, sendNotification: async () => { messages++; } });
  progress(0, undefined, "scout: ready");
  controller.abort();
  assert.equal(progress.signal?.aborted, true);
  await progress.finish("done");
  assert.equal(messages, 0);
});
test("host brain allowances reject malformed, negative and unlimited values", () => {
  for (const value of ["NaN", "Infinity", "-1", "1.5", "1001"]) assert.throws(() => appCallCap({ PANOMA_VIDEO_MAX_BRAIN_CALLS: value }));
  assert.equal(appCallCap({ PANOMA_VIDEO_MAX_BRAIN_CALLS: "0" }), 0);
  assert.equal(appCallCap({ PANOMA_VIDEO_MAX_BRAIN_CALLS: "20" }), 20);
});

test("an actual MCP auto call forwards stage progress across the transport", async () => {
  const { mkdtemp, cp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { fileURLToPath } = await import("node:url");
  const { connectInMemory } = await import("@panoma/video-mcp");
  const temp = await mkdtemp(join(tmpdir(), "panoma-video-progress-"));
  const saved = process.env.PANOMA_VIDEO_HOME;
  process.env.PANOMA_VIDEO_HOME = join(temp, "home");
  const connection = await connectInMemory();
  try {
    const project = join(temp, "library");
    await cp(fileURLToPath(new URL("fixtures/scout/library", import.meta.url)), project, { recursive: true });
    const events: string[] = [];
    const result = await connection.client.callTool({ name: "panoma_video_auto", arguments: { project_path: project, goal: "facts", until: "plan", brain: "none", voice: "none" } }, undefined,
      { onprogress: row => { if (row.message) events.push(row.message); } });
    assert.equal(result.isError, undefined);
    for (const stage of ["scout", "brand", "plan"]) assert.ok(events.some(message => message.startsWith(`${stage}:`)), `No ${stage} transition reached the client: ${events.join("; ")}`);
  } finally {
    await connection.close();
    if (saved === undefined) delete process.env.PANOMA_VIDEO_HOME; else process.env.PANOMA_VIDEO_HOME = saved;
    await rm(temp, { recursive: true, force: true });
  }
});
