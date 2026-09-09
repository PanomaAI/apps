/*
  The agent's path, end to end, on a real (tiny) product: a Node server fixture with a
  README, a CHANGELOG and one page. panoma_video_scout reads it, panoma_video_record starts it, walks
  it and shoots two takes, panoma_video_plan writes the briefs, panoma_video_render renders one cut and
  reviews it. Every result is checked for the shape an agent depends on — a summary
  that ends in the next step, structured content without base64, images only as
  blocks — in a throwaway PANOMA_VIDEO_HOME.
*/
/* Scenes are .tsx; the hook that compiles them must exist before the director imports them. */
import "@panoma/video-engine/register";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { assertNoBase64, connectInMemory } from "@panoma/video-mcp";

/*
  A ceiling for the one test that drives the whole pipeline, and it is a ceiling rather
  than a budget: reaching it means something is wrong, not that the machine is small.

  It was ten minutes, and ten minutes is this laptop's number. The test records a product
  in a browser, plans a cut, renders every frame through Chromium and masters it with
  ffmpeg; here that takes about 208 seconds. On a Windows CI runner — four cores, no GPU,
  Chromium rasterising in software — it passed 604 seconds still working and was cut off
  by the clock, with `fail 0` and `cancelled 1`: nothing was wrong with it except that it
  had not finished.

  Both numbers move together on purpose. The test's own budget and the MCP client's
  per-call timeout were the same ten minutes, so raising only one would have turned a
  cancellation into a failure that blamed the tool.
*/
const SLOWEST_TOOL_MS = 1_800_000;

const run = promisify(execFile);
const SOURCE = fileURLToPath(new URL("./fixtures/product", import.meta.url));
/*
  The fixture is copied out of this checkout and given a repository of its own. Two
  reasons, both learned the hard way: the pipeline fingerprints the working tree it
  finds, so a fixture living here would be keyed on this repository's own uncommitted work and
  any save during the two minutes of this test — including another session's — would
  break the cache assertion below; and a directory with no repository is deliberately
  never reused, so a product without one could not demonstrate a cache hit at all.
*/
let FIXTURE = "";
let product = "";
let home = "";
let session: Awaited<ReturnType<typeof connectInMemory>>;
/*
  A key in the environment is the automatic path's consent to spend on narration, and
  this suite runs on whatever machine happens to have one. So it is removed for the
  duration: a test that bills someone is a test people learn to skip.
*/
let key: string | undefined;
/* And a brain: this machine may have the claude CLI on PATH, and an end-to-end test must not spend anyone's plan or wait on a model. */
let brainChoice: string | undefined;

type Result = { content: { type: string; text?: string; data?: string; mimeType?: string; uri?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

const call = async (name: string, args: Record<string, unknown>): Promise<Result> => {
  const r = (await session.client.callTool({ name, arguments: args }, undefined, { timeout: SLOWEST_TOOL_MS })) as Result;
  assertNoBase64(r.structuredContent);
  const text = r.content.find((c) => c.type === "text")?.text ?? "";
  assert.ok(text.length > 0, `${name} returned no text summary`);
  return r;
};

before(async () => {
  key = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  brainChoice = process.env.PANOMA_VIDEO_BRAIN;
  process.env.PANOMA_VIDEO_BRAIN = "none";
  home = await mkdtemp(join(tmpdir(), "panoma-video-home-"));
  process.env.PANOMA_VIDEO_HOME = home;
  product = await mkdtemp(join(tmpdir(), "panoma-video-product-"));
  FIXTURE = join(product, "product");
  await cp(SOURCE, FIXTURE, { recursive: true });
  const git = (...args: string[]) => run("git", ["-C", FIXTURE, "-c", "user.email=t@panoma-video.test", "-c", "user.name=panoma-video", ...args]);
  await git("init", "-q");
  await git("add", "-A");
  await git("commit", "-q", "-m", "the fixture, committed so the tree has a revision");
  session = await connectInMemory();
});

after(async () => {
  if (key !== undefined) process.env.ELEVENLABS_API_KEY = key;
  if (brainChoice === undefined) delete process.env.PANOMA_VIDEO_BRAIN;
  else process.env.PANOMA_VIDEO_BRAIN = brainChoice;
  await session.close();
  /*
    Windows does not let a file be unlinked while any handle to it is open, and POSIX
    does — which is why this line was written without retries and passed everywhere but
    there. The rendered mp4 is the one that bites: ffmpeg has just been killed or has
    just finished writing it, and between that instant and this one the file can still be
    held, by the dying process or by whatever scans a newly written media file on that
    machine. `force` covers a file that is gone, not one that is busy. `maxRetries` is
    exactly what Node added for this: it retries EBUSY, EMFILE, ENFILE, ENOTEMPTY and
    EPERM with a linear backoff, and it is ignored unless `recursive` is set.
  */
  const disposable = { recursive: true, force: true, maxRetries: 20, retryDelay: 100 };
  await rm(home, disposable);
  await rm(product, disposable);
});

test("panoma_video_scout: the fact sheet, with ids and sources, and no secret", async () => {
  const r = await call("panoma_video_scout", { project_path: FIXTURE });
  const s = r.structuredContent as { project_id: string; kind: string; facts: { id: string; value: string; source: string }[]; files: { facts: string } };
  assert.equal(r.isError, undefined);
  assert.match(s.project_id, /^acme-catalog-[0-9a-f]{8}$/);
  assert.ok(s.facts.some((f) => f.id === "pkg.name"));
  assert.ok(s.facts.every((f) => f.source.length > 0));
  assert.ok(existsSync(s.files.facts));
  const text = r.content[0].text!;
  assert.ok(text.includes("untrusted"), "project text is marked as untrusted");
  assert.ok(text.includes("Next:"), "the summary ends in the next step");
});

test("panoma_video_record then panoma_video_plan then panoma_video_render: takes, briefs, one reviewed cut with its sheet", { timeout: SLOWEST_TOOL_MS }, async () => {
  const rec = await call("panoma_video_record", { project_path: FIXTURE });
  const rs = rec.structuredContent as { stages: Record<string, { status: string; summary: string }>; takes: { take: string; marks: string[] }[]; tour?: { marks: { name: string; kind: string }[] } };
  assert.equal(rs.stages.serve.status, "done", rs.stages.serve.summary);
  assert.equal(rs.stages.tour.status, "done", rs.stages.tour.summary);
  assert.equal(rs.stages.record.status, "done", rs.stages.record.summary);
  assert.equal(rs.takes.length, 2);
  assert.deepEqual(rs.takes[0].marks, rs.takes[1].marks, "both takes carry the same marks");

  /*
    The second call is the promise the tool description makes. The dev server takes a
    different free port on each of these two calls, so this passes only while the keys
    ignore it: before the fix the same call re-walked the site and re-shot both takes,
    two minutes of work whose only cause was the socket the operating system handed out.
  */
  const twice = await call("panoma_video_record", { project_path: FIXTURE });
  const ts = twice.structuredContent as { stages: Record<string, { status: string; summary: string }>; takes: { take: string }[] };
  assert.equal(ts.stages.tour.status, "cached", ts.stages.tour.summary);
  assert.equal(ts.stages.record.status, "cached", ts.stages.record.summary);
  assert.equal(ts.takes.length, 2, "the cached pair is still two takes");

  const plan = await call("panoma_video_plan", { project_path: FIXTURE, langs: ["en"] });
  const ps = plan.structuredContent as { briefs: { id: string; recipe: string; claims: number; lines: { id: string; text: Record<string, string> }[] }[]; skipped: { goal: string; why: string }[] };
  assert.ok(ps.briefs.length >= 1, `no brief planned: ${JSON.stringify(ps.skipped)}`);
  for (const b of ps.briefs) assert.equal(b.claims, 0, `brief ${b.id} has unbacked claims`);
  for (const b of ps.briefs) for (const l of b.lines) assert.ok(!/\d/.test(l.text.en.replace(/\{\{fact:[^}]+\}\}/g, "")), `literal digit in ${b.id}/${l.id}`);

  const brief = ps.briefs[0];
  const render = await call("panoma_video_render", { project_path: FIXTURE, brief_id: brief.id, lang: "en", format: "h" });
  const rr = render.structuredContent as { render_id: string; file: string; seconds: number; review: { status: string; failing: { id: string; fix?: { by: string } }[] }; sheet?: string; provenance: string };
  assert.equal(render.isError, undefined, render.content[0].text ?? "");
  assert.equal(rr.render_id, `${brief.id}--${brief.recipe === "ReleaseTrailer" ? "kicker" : "hook"}--en--h`);
  assert.ok(existsSync(rr.file), "the mp4 exists");
  assert.ok(rr.seconds > 5, `too short: ${rr.seconds}`);
  assert.ok(existsSync(rr.provenance));
  for (const c of rr.review.failing) assert.ok(c.fix?.by, `failing check ${c.id} names nobody to fix it`);
  const img = render.content.find((c) => c.type === "image");
  assert.ok(img, "a contact sheet came back as an image block");
  assert.ok((img!.data ?? "").length < 80 * 1024 * 1.4, "the image is under the budget");
  assert.ok(render.content.some((c) => c.type === "resource_link" && (c.uri ?? "").endsWith(".mp4")), "the mp4 is a resource link");

  const again = await call("panoma_video_render", { project_path: FIXTURE, brief_id: brief.id, lang: "en", format: "h" });
  assert.equal((again.structuredContent as { file: string }).file, rr.file, "a second call is the same file, not a second render");

  const review = await call("panoma_video_review", { project_path: FIXTURE, render_id: rr.render_id });
  assert.ok(review.content.some((c) => c.type === "image"));
  const frame = await call("panoma_video_frame", { project_path: FIXTURE, render_id: rr.render_id, seconds: 3 });
  assert.ok(frame.content.some((c) => c.type === "image" && c.mimeType === "image/jpeg"));
});
