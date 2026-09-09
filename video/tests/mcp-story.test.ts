import "@panoma/video-engine/register";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test, type TestContext } from "node:test";
import { assertNoBase64, connectInMemory, type ToolResult } from "@panoma/video-mcp";
import { scoutProject } from "@panoma/video-scout";
import type { SessionLog } from "@panoma/video-capture";
import type { ReviewReport } from "@panoma/video-core";
import { openWorkspace, writeJson, inputHash } from "../packages/director/src/workspace.ts";
import { planPromo, type PromoForInput } from "../packages/director/src/promo.ts";
import { studioWorkspace } from "../packages/director/src/studio.ts";
import { auto } from "../packages/director/src/auto.ts";
import { story, revise } from "../packages/mcp/src/tools/story.ts";

/*
  The temporary directory is canonicalised before anything is built in it, the way
  `workspace-boundary.test.ts` does, and that is not cosmetic.

  This fixture builds the workspace the way the CLI builds one: `scoutProject` is handed the
  path as given, and the project id is a hash of the path it canonicalises. The tools are
  handed the same path and canonicalise it themselves — with a different function.
  `fs.realpathSync`, which scout uses, walks symlinks in JavaScript and keeps the caller's
  spelling of every component that is not one; `fsPromises.realpath`, which the MCP's
  `resolveProject` and `openWorkspace` use, is libuv's, and answers with the name the
  filesystem holds. They differ wherever one directory has more than one true spelling: on
  Windows `%TEMP%` is an 8.3 alias (C:\Users\RUNNER~1\… for "runneradmin"), so the fixture
  and the tools hashed two ids for one directory and every test here failed with "This project
  has no plan yet". A different case does the same trick on a case-insensitive disk, which is
  how it was reproduced away from Windows.

  Starting from the canonical path means this file tests the story round-trip rather than that
  divergence. The divergence itself is a real defect a person meets — a workspace written by
  `panoma-video auto` under an aliased path is invisible to the MCP server, which resolves the
  same path natively — and its fix is in `packages/scout/src/profile.ts`, which should
  canonicalise with `realpathSync.native` like every other door.
*/
async function fixture(t: TestContext, options: { scoutedFacts?: boolean } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "panoma-video-mcp-story-")));
  const root = join(dir, "product");
  const home = join(dir, "panoma-video");
  await mkdir(root);
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "acme-story", homepage: "https://acme.example" }));
  const profile = await scoutProject(root);
  const ws = await openWorkspace(root, { home, id: profile.id });
  const facts = options.scoutedFacts ? profile.facts : { project: profile.name, extractedAt: "2026-09-05T00:00:00Z", notFacts: [], facts: [
    { id: "pkg.name", kind: "text" as const, value: profile.name, source: "package.json#name token=EXAMPLE_NOT_A_REAL_CREDENTIAL" },
    { id: "url", kind: "url" as const, value: "https://acme.example", source: "package.json#homepage" },
  ] };
  const input: PromoForInput = { profile: { ...profile, kind: "web-app", facts }, facts, langs: ["en", "es"], takes: [],
    tour: { name: ws.id, url: "http://127.0.0.1:5173/", createdAt: facts.extractedAt, snapshot: "", candidates: [],
      steps: [{ goto: "http://127.0.0.1:5173/" }, { mark: "notes" }, { clickOn: "text=Notes" }, { mark: "context" }, { clickOn: "text=Context" }],
      marks: [{ name: "notes", kind: "cta", label: "Notes", outcome: { heading: "Project notes", route: "/notes" } },
        { name: "context", kind: "flow", label: "Context", outcome: { heading: "Saved context", route: "/context" } }],
      flow: { title: "Acme", steps: [] }, pages: [], edges: [],
    },
  };
  input.takes = ["desktop", "mobile"].map((take): SessionLog => {
    const viewport = take === "mobile" ? { width: 540, height: 960 } : { width: 960, height: 540 };
    return { name: ws.id, take, isMobile: take === "mobile", recordedAt: facts.extractedAt, url: input.tour!.url,
      video: `${ws.id}.${take}.webm`, viewport, videoRatio: 2, durationMs: 8000, readyMs: 500, fps: 25,
      marks: [{ name: "notes", t: 1000 }, { name: "context", t: 4500 }],
      events: [{ kind: "click", role: "product", t: 1400, x: 100, y: 100 }, { kind: "click", role: "product", t: 4800, x: 100, y: 100 }],
      macros: ["notes", "context"].map((mark, i) => ({ id: mark, mark, file: `${take}-${mark}.png`, t: i ? 4500 : 1000, url: input.tour!.url,
        viewport, box: { x: 70, y: 80, width: 200, height: 80 }, pixelRatio: 4, resultAtMs: i ? 5300 : 2000,
        resultHeading: { text: i ? "Saved context" : "Project notes", box: { x: 90, y: 110, width: 250, height: 32 }, visibleShare: 1, centerVisible: true },
        change: { box: { x: 70, y: 100, width: 400, height: 250 }, share: i ? 0.2 : 0.3, boxShare: 0.7 },
      })),
    };
  });
  for (const take of input.takes) {
    await writeFile(join(ws.paths.sessions, take.video), "capture fixture bytes");
    for (const macro of take.macros!) await writeFile(join(ws.paths.sessions, macro.file), "macro fixture bytes");
    await writeJson(join(ws.paths.sessions, `${take.name}.${take.take}.session.json`), take);
  }
  const planned = planPromo(input);
  assert.ok(planned.brief);
  await writeJson(ws.paths.profile, input.profile);
  await writeJson(ws.paths.facts, planned.facts);
  await writeJson(join(ws.paths.tours, `${ws.id}.json`), input.tour);
  await writeJson(join(ws.paths.briefs, `${planned.brief.id}.json`), { ...planned.brief, origin: "template", goal: "promo" });
  await writeJson(join(ws.dir, "promo.json"), planned.decision);
  const previousHome = process.env.PANOMA_VIDEO_HOME, previousBrain = process.env.PANOMA_VIDEO_BRAIN;
  process.env.PANOMA_VIDEO_HOME = home;
  process.env.PANOMA_VIDEO_BRAIN = "none";
  t.after(async () => {
    if (previousHome === undefined) delete process.env.PANOMA_VIDEO_HOME; else process.env.PANOMA_VIDEO_HOME = previousHome;
    if (previousBrain === undefined) delete process.env.PANOMA_VIDEO_BRAIN; else process.env.PANOMA_VIDEO_BRAIN = previousBrain;
    await rm(dir, { recursive: true, force: true });
  });
  return { ws, root, brief: planned.brief };
}

type Story = { revision: string; number: number; brief_id: string; settings: { theme: string }; scenes: { id: string; text: Record<string, string>; expanded_text: Record<string, string> }[]; history: { revision: string }[]; next: { tool: string }; sources_untrusted: boolean };

test("MCP story → precise revision → reload → restore uses the Studio audit, redacts sources and creates no read-only media", async (t) => {
  const { root, ws, brief } = await fixture(t);
  const session = await connectInMemory();
  t.after(() => session.close());
  await session.client.listTools();
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await session.client.callTool({ name, arguments: { project_path: root, ...args } }) as ToolResult;
    assertNoBase64(result.structuredContent);
    assert.match(result.content[0].type === "text" ? result.content[0].text : "", /Next:/);
    return result;
  };
  const files = await readdir(ws.dir, { recursive: true });
  const initial = await call("panoma_video_story", {});
  assert.equal(initial.isError, undefined, JSON.stringify(initial.content));
  assert.deepEqual(await readdir(ws.dir, { recursive: true }), files, "reading does not synthesize beds, sound effects or a revision journal");
  assert.match(initial.content[0].type === "text" ? initial.content[0].text : "", /untrusted/);
  assert.doesNotMatch(JSON.stringify(initial), /EXAMPLE_NOT_A_REAL_CREDENTIAL/);
  const before = initial.structuredContent as unknown as Story;
  assert.equal(before.sources_untrusted, true);
  assert.equal(before.brief_id, brief.id);
  assert.equal(before.number, 0);
  const changed = await call("panoma_video_revise", { brief_id: brief.id, expectedRevision: before.revision, brain: "none", edits: [
    { kind: "text", sceneId: "benefit-1", lang: "es", text: "Las notas acompañan al proyecto." }, { kind: "theme", value: "block" },
  ] });
  assert.equal(changed.isError, undefined, JSON.stringify(changed.content));
  const after = changed.structuredContent as unknown as Story;
  assert.equal(after.number, 1);
  assert.equal(after.settings.theme, "block");
  assert.equal(after.next.tool, "panoma_video_render");
  assert.equal(after.scenes.find(scene => scene.id === "benefit-1")!.text.en, before.scenes.find(scene => scene.id === "benefit-1")!.text.en);
  assert.equal(after.scenes.find(scene => scene.id === "benefit-1")!.expanded_text.es, "Las notas acompañan al proyecto.");
  const reloaded = await call("panoma_video_story", { brief_id: brief.id });
  assert.equal((reloaded.structuredContent as unknown as Story).revision, after.revision);
  const stale = await call("panoma_video_revise", { brief_id: brief.id, expectedRevision: before.revision, edits: [{ kind: "theme", value: "grid" }] });
  assert.equal(stale.isError, true);
  assert.match(JSON.stringify(stale.content), /Revision changed/);
  const bad = await call("panoma_video_revise", { brief_id: brief.id, expectedRevision: after.revision, edits: [{ kind: "text", sceneId: "benefit-1", lang: "es", text: "Ahorra 20 minutos." }] });
  assert.equal(bad.isError, true);
  assert.match(JSON.stringify(bad.content), /literal-number|unsupported/);
  const brain = await call("panoma_video_revise", { brief_id: brief.id, expectedRevision: after.revision, instruction: "Make the opening concise.", brain: "none" });
  assert.equal(brain.isError, true);
  assert.match(JSON.stringify(brain.content), /enabled brain/);
  const restored = await call("panoma_video_revise", { brief_id: brief.id, expectedRevision: after.revision, restoreRevision: before.revision, brain: "none" });
  assert.equal(restored.isError, undefined, JSON.stringify(restored.content));
  assert.equal((restored.structuredContent as unknown as Story).number, 2);
  assert.equal((restored.structuredContent as unknown as Story).history[1].revision, after.revision);
  assert.deepEqual(await readdir(root), ["package.json"]);
});

test("cancelled MCP reads and edits stop before creating a revision", async (t) => {
  const { root, ws, brief } = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  const result = await story({ project_path: root }, { signal: controller.signal });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /Cancelled/);
  const edit = await revise({ project_path: root, brief_id: brief.id, expectedRevision: "unused", edits: [{ kind: "theme", value: "grid" }], brain: "none" }, { signal: controller.signal });
  assert.equal(edit.isError, true);
  await assert.rejects(readFile(join(ws.dir, "promo-revisions", `${brief.id}.json`)), { code: "ENOENT" });
});

test("MCP planning retains approved footage and refuses legacy patches before writing them", async (t) => {
  const { root, ws, brief } = await fixture(t, { scoutedFacts: true });
  // Establish exactly the real planner's fact sheet before any approved revision.
  await auto({ root, goal: "promo", until: "plan", camera: false, brain: "none", voice: "none" });
  const session = await connectInMemory();
  t.after(() => session.close());
  const call = (name: string, args: Record<string, unknown>) => session.client.callTool({ name, arguments: { project_path: root, ...args } }) as Promise<ToolResult>;
  const initial = await call("panoma_video_story", { brief_id: brief.id });
  assert.equal(initial.isError, undefined, JSON.stringify(initial.content));
  const revised = await call("panoma_video_revise", { brief_id: brief.id, expectedRevision: initial.structuredContent!.revision,
    edits: [{ kind: "text", sceneId: "benefit-1", lang: "es", text: "Las notas acompañan al proyecto." }], brain: "none" });
  assert.equal(revised.isError, undefined, JSON.stringify(revised.content));
  const journalFile = join(ws.dir, "promo-revisions", `${brief.id}.json`);
  const journal = await readFile(journalFile);
  const takeFile = join(ws.paths.sessions, `${ws.id}.desktop.webm`), take = await readFile(takeFile);
  const patchFile = join(ws.paths.briefs, `${brief.id}.patch.json`);
  const files = await readdir(ws.dir, { recursive: true });
  const rejected = await call("panoma_video_plan", { goal: "promo", brief_id: brief.id, brief_patch: { lines: { "benefit-1": { text: { es: "Texto reemplazado." } } } }, brain: "none" });
  assert.equal(rejected.isError, true);
  assert.match(JSON.stringify(rejected.content), /panoma_video_revise/);
  assert.deepEqual(await readdir(ws.dir, { recursive: true }), files, "a refused patch creates no files");
  await assert.rejects(readFile(patchFile), { code: "ENOENT" });
  // A pre-existing patch is equally protected from replacement by this path.
  await writeFile(patchFile, "{}\n");
  const again = await call("panoma_video_plan", { goal: "promo", brief_id: brief.id, brief_patch: { drop: ["benefit-1"] }, brain: "none" });
  assert.equal(again.isError, true);
  assert.equal(await readFile(patchFile, "utf8"), "{}\n");
  const planned = await call("panoma_video_plan", { goal: "promo", brain: "none" });
  assert.equal(planned.isError, undefined, JSON.stringify(planned.content));
  assert.ok((planned.structuredContent!.briefs as { id: string }[]).some((entry) => entry.id === brief.id));
  assert.deepEqual(await readFile(journalFile), journal);
  assert.deepEqual(await readFile(takeFile), take, "planning does not recapture the saved evidence");
  const reloaded = await call("panoma_video_story", { brief_id: brief.id });
  assert.equal(reloaded.structuredContent!.revision, revised.structuredContent!.revision);
  assert.ok(JSON.stringify(planned.structuredContent).includes("Las notas acompañan al proyecto."));
  const replacement = await call("panoma_video_plan", { goal: "promo", new_story: true, brief_id: brief.id, brief_patch: {}, brain: "none" });
  assert.equal(replacement.isError, undefined, JSON.stringify(replacement.content));
  await assert.rejects(readFile(journalFile), { code: "ENOENT" });
  const archive = join(ws.dir, "promo-revisions", "archive"), entries = await readdir(archive);
  assert.equal(entries.length, 1);
  assert.deepEqual(await readFile(join(archive, entries[0], "history.json")), journal, "explicit replacement preserves the original approved journal");
});

test("MCP renders a moved checkout's exact saved promotion and resolves its immutable export", { timeout: 240_000 }, async (t) => {
  const { root, ws, brief } = await fixture(t);
  const run = promisify(execFile);
  for (const take of ["desktop", "mobile"]) {
    const size = take === "desktop" ? "1920x1080" : "1080x1920";
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=0xeaeaea:s=${size}:r=25`, "-t", "8", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", join(ws.paths.sessions, `${ws.id}.${take}.webm`)]);
    for (const mark of ["notes", "context"]) await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0xffffff:s=800x320", "-frames:v", "1", "-update", "1", join(ws.paths.sessions, `${take}-${mark}.png`)]);
  }
  const session = await connectInMemory();
  t.after(() => session.close());
  await session.client.listTools();
  const initial = await session.client.callTool({ name: "panoma_video_story", arguments: { project_path: root } }) as ToolResult;
  assert.equal(initial.isError, undefined, JSON.stringify(initial.content));
  const revision = await session.client.callTool({ name: "panoma_video_revise", arguments: { project_path: root, brief_id: brief.id,
    expectedRevision: initial.structuredContent!.revision, edits: [{ kind: "text", sceneId: "benefit-1", lang: "es", text: "Las notas acompañan al proyecto." }], brain: "none" } }) as ToolResult;
  assert.equal(revision.isError, undefined, JSON.stringify(revision.content));
  const moved = `${root}-moved`;
  await rename(root, moved);
  const rendered = await session.client.callTool({ name: "panoma_video_render", arguments: { project_path: moved, workspace_id: ws.id, brief_id: brief.id, lang: "es", format: "h", brain: "none" } }, undefined, { timeout: 180_000 }) as ToolResult;
  assert.equal(rendered.isError, undefined, JSON.stringify(rendered.content));
  assertNoBase64(rendered.structuredContent);
  const value = rendered.structuredContent as { render_id: string; file: string; provenance: string; disclose: boolean; review: { status: string }; sheet: string };
  assert.match(value.render_id, /--r-r1-/);
  assert.ok(value.file.endsWith(`${value.render_id}.mp4`));
  const manifest = JSON.parse(await readFile(value.provenance, "utf8"));
  assert.match(value.provenance, /\.provenance\.json$/);
  assert.equal(manifest.revision, revision.structuredContent!.revision);
  assert.equal(manifest.brief.lines.find((line: { id: string }) => line.id === "benefit-1").text.es, "Las notas acompañan al proyecto.");
  assert.equal(manifest.takes.length, 1);
  assert.equal(manifest.takes[0].take, "desktop");
  const claim = manifest.claims.find((claim: { line: string }) => claim.line === "benefit-1");
  assert.equal(claim.text, "Las notas acompañan al proyecto.");
  assert.deepEqual(claim.facts, manifest.brief.promo.evidence["benefit-1"].facts);
  assert.ok(claim.facts.length > 0, "the rewritten benefit keeps its captured evidence binding");
  assert.equal(manifest.synthetic.music, true);
  assert.equal(value.disclose, true);
  const tags = JSON.parse((await run("ffprobe", ["-v", "error", "-show_entries", "format_tags=comment", "-of", "json", value.file])).stdout);
  assert.match(tags.format.tags.comment, /procedural music/i);
  assert.match(tags.format.tags.comment, /made with panoma video/i);
  assert.equal(rendered.content.filter((block) => block.type === "image").length, 1);
  const base = value.file.replace(/\.mp4$/, "");
  const original = JSON.parse(await readFile(`${base}.review.json`, "utf8")) as ReviewReport;
  const originalLayout = original.checks.filter(check => check.id.startsWith("layout."));
  assert.ok(originalLayout.length > 0);
  const later = await session.client.callTool({ name: "panoma_video_revise", arguments: { project_path: moved, workspace_id: ws.id, brief_id: brief.id,
    expectedRevision: revision.structuredContent!.revision, edits: [{ kind: "theme", value: "block" }], brain: "none" } }) as ToolResult;
  assert.equal(later.isError, undefined, JSON.stringify(later.content));
  assert.notEqual(later.structuredContent!.revision, revision.structuredContent!.revision);
  const checked = await session.client.callTool({ name: "panoma_video_review", arguments: { project_path: moved, workspace_id: ws.id, render_id: value.render_id } }) as ToolResult;
  assert.equal(checked.isError, undefined, JSON.stringify(checked.content));
  const frame = await session.client.callTool({ name: "panoma_video_frame", arguments: { project_path: moved, workspace_id: ws.id, render_id: value.render_id, seconds: 0.5 } }) as ToolResult;
  assert.equal(frame.isError, undefined, JSON.stringify(frame.content));
  assert.equal(frame.content.filter((block) => block.type === "image").length, 1);
  const cli = fileURLToPath(new URL("../apps/cli/src/panoma-video.ts", import.meta.url));
  const reviewed = JSON.parse((await run(process.execPath, [cli, "review", value.file, "--json"], { maxBuffer: 4_000_000 })).stdout) as ReviewReport;
  assert.deepEqual(reviewed.checks.filter(check => check.id.startsWith("layout.")), originalLayout,
    "historical review retains measurements of the exported image, after the current draft changes");
  assert.equal(reviewed.checks.find(check => check.id === "story.claims")?.status, "pass");
  assert.ok(reviewed.checks.some(check => check.id.startsWith("promo.")));
  const context = reviewed.checks.find(check => check.id === "review.original-context");
  assert.equal((context?.details as { revision: string }).revision, revision.structuredContent!.revision);
  assert.notEqual((context?.details as { revision: string }).revision, later.structuredContent!.revision);
  const fullReport = await readFile(`${base}.review.json`, "utf8");
  await assert.rejects(run(process.execPath, [cli, "review", value.file, "--cuts=0", "--json"]), /historical export owns its plannedCuts/);
  assert.equal(await readFile(`${base}.review.json`, "utf8"), fullReport);
  await writeFile(join(ws.paths.sessions, "desktop-notes.png"), "changed original capture");
  await assert.rejects(run(process.execPath, [cli, "review", value.file, "--json"]), /Original review material changed/);
  assert.equal(await readFile(`${base}.review.json`, "utf8"), fullReport, "a failed re-review cannot replace the original full report");
  const unavailable = await session.client.callTool({ name: "panoma_video_review", arguments: { project_path: moved, workspace_id: ws.id, render_id: value.render_id } }) as ToolResult;
  assert.equal(unavailable.isError, true);
  assert.match(JSON.stringify(unavailable.content), /Original review material changed/);
  assert.equal(await readFile(`${base}.review.json`, "utf8"), fullReport);
});


test("a host workspace reopens a moved checkout without changing its recorded revision", async (t) => {
  const { root, ws, brief } = await fixture(t);
  const initial = await story({ project_path: root, workspace_id: ws.id, brief_id: brief.id });
  assert.equal(initial.isError, undefined, JSON.stringify(initial.content));
  const moved = `${root}-moved`;
  await rename(root, moved);
  const reopened = await story({ project_path: moved, workspace_id: ws.id, brief_id: brief.id });
  assert.equal(reopened.isError, undefined, JSON.stringify(reopened.content));
  assert.equal(reopened.structuredContent?.revision, initial.structuredContent?.revision);
  assert.deepEqual(reopened.structuredContent?.scenes, initial.structuredContent?.scenes);
});


test("MCP retains encoded artifacts when a saved promotion fails its review", { timeout: 120_000 }, async (t) => {
  const { root, ws, brief } = await fixture(t);
  const run = promisify(execFile);
  for (const take of ["desktop", "mobile"]) {
    const size = take === "desktop" ? "1920x1080" : "1080x1920";
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=0xeaeaea:s=${size}:r=25`, "-t", "8", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", join(ws.paths.sessions, `${ws.id}.${take}.webm`)]);
    for (const mark of ["notes", "context"]) await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0xffffff:s=800x320", "-frames:v", "1", "-update", "1", join(ws.paths.sessions, `${take}-${mark}.png`)]);
  }
  const studio = await studioWorkspace(ws.id);
  const document = await studio.document(brief.id);
  const comp = studio.matrix.compositions.find(comp => comp.id === `${brief.id}--${document.brief.hooks[0].id}--es--h`)!;
  assert.ok(comp);
  const base = join(ws.paths.renders, `${comp.id}--r-${document.revision}-${studio.fingerprint.slice(0, 8)}`);
  // A cached encoded file still has to pass review. A silent audio stream fails the expected musical bed.
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=white:s=${comp.format.width}x${comp.format.height}:r=${comp.fps}`, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(comp.durationInFrames / comp.fps), "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", `${base}.mp4`]);
  await writeJson(`${base}.export.json`, { key: inputHash(studio.fingerprint, comp.id) });
  const session = await connectInMemory();
  t.after(() => session.close());
  const result = await session.client.callTool({ name: "panoma_video_render", arguments: { project_path: root, workspace_id: ws.id, brief_id: brief.id, lang: "es", format: "h", brain: "none", voice: "none" } }, undefined, { timeout: 100_000 }) as ToolResult;
  assert.equal(result.isError, true, JSON.stringify(result.structuredContent));
  assert.match(JSON.stringify(result.content), /Export needs correction/);
  const data = result.structuredContent as { file: string; render_id: string; review: { status: string; file: string; failing: unknown[] }; outputs: string[] };
  assert.equal(data.file, `${base}.mp4`);
  assert.equal(data.render_id, `${comp.id}--r-${document.revision}-${studio.fingerprint.slice(0, 8)}`);
  assert.equal(data.review.status, "fail");
  assert.ok(data.review.failing.length > 0);
  for (const file of [data.file, data.review.file, ...data.outputs]) assert.ok((await readFile(file)).length > 0);
  assertNoBase64(data);
});
