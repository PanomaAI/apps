/*
  The server's contract with a client, checked over an in-memory transport: tools list
  in a fixed order with everything a model needs to choose them, the guide answers,
  and no result ever smuggles an image into structuredContent.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNoBase64, connectInMemory, guideText, toolNames, CALL_ORDER, OUTPUT_SHAPES, shaped, McpServer } from "@panoma/video-mcp";

test("tools/list is deterministic and every tool is fully described", async () => {
  const a = await connectInMemory();
  const b = await connectInMemory();
  try {
    const [la, lb] = await Promise.all([a.client.listTools(), b.client.listTools()]);
    assert.deepEqual(la.tools.map((t) => t.name), lb.tools.map((t) => t.name));
    assert.deepEqual(la.tools.map((t) => t.name), toolNames());
    assert.equal(la.tools.length, 11, "the two scene tools join the existing nine tool contract");
    assert.equal(la.tools.find((tool) => tool.name === "panoma_video_story")!.annotations!.readOnlyHint, true);
    assert.equal(la.tools.find((tool) => tool.name === "panoma_video_revise")!.annotations!.idempotentHint, false);
    assert.ok(la.tools.find((tool) => tool.name === "panoma_video_auto")!.inputSchema.properties!.new_story);
    assert.ok(la.tools.find((tool) => tool.name === "panoma_video_plan")!.inputSchema.properties!.new_story);
    assert.equal(la.tools.find((tool) => tool.name === "panoma_video_render")!.inputSchema.properties!.new_story, undefined, "render never resets a saved story");
    for (const tool of la.tools) {
      assert.match(tool.name, /^panoma_video_[a-z_]+$/, `${tool.name} is not namespaced`);
      assert.ok((tool.description ?? "").length >= 120, `${tool.name}: a description a model can choose by is at least three sentences`);
      assert.ok(tool.outputSchema, `${tool.name} declares an outputSchema`);
      assert.ok(tool.annotations, `${tool.name} declares annotations`);
    }
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});

test("panoma_video_guide returns the conventions as text and as structured content", async () => {
  const { client, close } = await connectInMemory();
  try {
    const result = await client.callTool({ name: "panoma_video_guide", arguments: {} });
    const text = (result.content as { type: string; text?: string }[]).find((c) => c.type === "text")?.text ?? "";
    assert.ok(text.includes("{{fact:"), "the placeholder rule is in the guide");
    assert.ok(text.includes("panoma_video_scout"), "the call order is in the guide");
    const structured = result.structuredContent as { version: string; callOrder: string[] };
    assert.equal(typeof structured.version, "string");
    assert.ok(structured.callOrder.length >= 6);
    assert.equal(text, guideText());
  } finally {
    await close();
  }
});

test("a base64 blob in structured content is refused", () => {
  const blob = "iVBORw0KGgo".repeat(600);
  assert.throws(() => assertNoBase64({ sheet: blob }), /base64/);
  assert.doesNotThrow(() => assertNoBase64({ path: "/tmp/x.jpg", n: 3, nested: { ok: "short" } }));
});

/*
  A client re-validates structuredContent with AJV against the JSON schema built from
  each tool's outputSchema, where every object is `additionalProperties: false`. The
  handlers return richer objects than the wire contract (a full ReviewCheck with its
  details, a stage with its next step), and `shaped` projects them down. This registers
  each shape on a throwaway server and calls it through the real client, so the check
  is the validator's, not a copy of it.
*/
test("every tool's result is projected onto its declared shape before the client validates it", async () => {
  const richCheck = { id: "audio.truepeak", status: "fail", summary: "hot", threshold: "≤ -1.0 dBTP", source: "AES", at: [{ seconds: 3.2, frame: 96 }], details: [{ second: 3, areaFlashing: 0.4 }], fix: { by: "engine", hint: "lower the ceiling", tool: "panoma_video_render", args: { project_path: "/p" } } };
  const stage = { status: "failed", summary: "no brief", next: { tool: "panoma_video_plan", args: { project_path: "/p" } } };
  /* `raw` says whether the handler's own object fits the wire contract as it is; a stage's `next` is declared, a check's `details` is not. */
  const payloads: Record<string, { raw: "rejected" | "accepted"; payload: Record<string, unknown> }> = {
    panoma_video_render: { raw: "rejected", payload: { render_id: "a--b--en--h", file: "/r.mp4", seconds: 30, lufs: -14, review: { status: "fail", file: "/r.review.json", failing: [richCheck] }, provenance: "/r.provenance.json", disclose: false } },
    panoma_video_review: { raw: "rejected", payload: { render_id: "a--b--en--h", status: "warn", measured: { seconds: 30, lufs: -14 }, checks: [richCheck] } },
    panoma_video_plan: { raw: "accepted", payload: { project_id: "p", briefs: [], skipped: [], polish: [], stages: { plan: stage } } },
    panoma_video_auto: { raw: "rejected", payload: { project_id: "p", project_dir: "/d", stages: { scout: stage }, briefs: [], skipped: [], renders: [{ id: "a--b--en--h", file: "/r.mp4", seconds: 30, provenance: "/p.json", review: { status: "fail", file: "/r.review.json", failing: [richCheck] }, extra: "not declared" }], polish: [], disclose: [] } },
  };
  for (const [name, { raw, payload }] of Object.entries(payloads)) {
    for (const projected of [false, true]) {
      const server = new McpServer({ name: "probe", version: "0" });
      server.registerTool(name, { description: "probe", inputSchema: {}, outputSchema: OUTPUT_SHAPES[name] }, async () => {
        const raw = { content: [{ type: "text" as const, text: "x" }], structuredContent: payload };
        return projected ? shaped(name, raw) : raw;
      });
      const { client, close } = await connectInMemory(server);
      try {
        /* The client validates results only for tools it has listed — Claude Code lists them first; so does this. */
        await client.listTools();
        const call = client.callTool({ name, arguments: {} });
        if (projected) {
          /* The projection must have happened: a shape the payload does not fit falls through unchanged, and the client then refuses it. */
          assert.notEqual(shaped(name, { content: [], structuredContent: payload }).structuredContent, payload, `${name}: the payload fits the declared shape`);
        }
        if (projected || raw === "accepted") {
          const result = await call;
          assert.equal(result.isError, undefined, `${name}: the ${projected ? "projected" : "declared"} result passes the client's validator`);
          assert.ok(result.structuredContent, `${name}: structured content survives`);
        } else {
          await assert.rejects(call, /output schema/, `${name}: the raw result is rejected, which is why the projection exists`);
        }
      } finally {
        await close();
      }
    }
  }
});

test("the guide and the skill name only tools that exist, and the call order uses project_path", async () => {
  const { readFile } = await import("node:fs/promises");
  const skill = await readFile(new URL("../skills/panoma-video/SKILL.md", import.meta.url), "utf8");
  const known = new Set(toolNames());
  for (const [source, text] of [["guide", guideText()], ["SKILL.md", skill]] as const) {
    const named = new Set([...text.matchAll(/\bpanoma_video_[a-z_]+\b/g)].map((m) => m[0]));
    for (const name of named) assert.ok(known.has(name), `${source} names ${name}, which is not a registered tool`);
  }
  for (const line of CALL_ORDER) {
    assert.doesNotMatch(line, /project_id|\btour\b\)/, `the call order carries an argument no tool takes: ${line}`);
    assert.match(line, /project_path/, `every call in the order starts from project_path: ${line}`);
  }
});
