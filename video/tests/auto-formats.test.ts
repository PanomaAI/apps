import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { auto } from "../packages/director/src/auto.ts";
import { captureTakes, hasCaptureTakes, selectedFormats } from "../packages/director/src/capture-formats.ts";
import { studioWorkspace } from "../packages/director/src/studio.ts";

const exec = promisify(execFile);

test("production canvases require their own capture layouts, including desktop for square", () => {
  assert.deepEqual(captureTakes().map(take => take.id), ["desktop", "mobile"]);
  assert.deepEqual(captureTakes(["h"]).map(take => take.id), ["desktop"]);
  assert.deepEqual(captureTakes(["v"]).map(take => take.id), ["mobile"]);
  assert.deepEqual(captureTakes(["h", "s"]).map(take => take.id), ["desktop"]);
  assert.equal(hasCaptureTakes([], ["h"]), false);
  assert.throws(() => selectedFormats([]), /Select each production format/);
});

test("a horizontal production records only desktop, retries from cache and retains its scope in offline planning and Studio", { timeout: 120_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-formats-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "product"), home = join(dir, "outputs");
  await mkdir(root);
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "catalog", homepage: "https://catalog.example/", dependencies: { vite: "1.0.0" } }));
  await writeFile(join(root, "README.md"), "# Catalog\n\nProject notes stay with the project.\n");
  const git = (...args: string[]) => exec("git", ["-C", root, "-c", "user.email=t@panoma-video.test", "-c", "user.name=panoma-video", ...args]);
  await git("init", "-q"); await git("add", "-A"); await git("commit", "-q", "-m", "fixture");
  const server = createServer((_, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><html><head><title>Catalog</title><style>body{font:24px sans-serif;background:white;color:black;padding:40px}button{padding:20px}@media(max-width:800px){button{display:none}}</style></head><body><main><h1>Catalog</h1><p>Your projects together.</p><button onclick="this.hidden=true;document.querySelector('#notes').hidden=false">Open project notes</button><section id="notes" hidden><h2>Project notes</h2><p>Project notes stay with the project.</p></section></main></body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const options = { root, home, url, goal: "promo" as const, until: "plan" as const, formats: ["h"] as const, brain: "none" as const, voice: "none", langs: ["en"] as ("en" | "es")[] };
  /* Refused before anything is filmed: a canvas the job never publishes, and a preview outside the scope. */
  await assert.rejects(auto({ ...options, formats: ["s"] }), /A promo is published as v or h; s is not one of its shapes/);
  await assert.rejects(auto({ ...options, previewFormat: "v" }), /preview format v is outside this production's scope \(h\)/);
  const first = await auto(options);
  assert.equal(first.stages.record.status, "done", first.stages.record.summary);
  assert.equal(first.stages.plan.status, "done", first.stages.plan.summary);
  assert.deepEqual(first.formats, ["h"]);
  assert.equal(first.briefs.length, 1, JSON.stringify(first.skipped));
  assert.deepEqual(first.briefs[0].formats, ["h"]);
  const tour = JSON.parse(await readFile(first.files.tour!, "utf8"));
  assert.ok(tour.marks.some((mark: { outcome?: { heading?: string } }) => mark.outcome?.heading === "Project notes"), "a desktop result cannot be stripped by an unrequested mobile walk");
  const sessions = join(first.project.dir, "sessions");
  assert.deepEqual((await readdir(sessions)).filter(file => file.endsWith(".session.json")), [`${first.project.id}.desktop.session.json`]);
  const desktopFile = join(sessions, `${first.project.id}.desktop.session.json`);
  const recorded = await readFile(desktopFile, "utf8");
  const retry = await auto(options);
  assert.equal(retry.stages.record.status, "cached", retry.stages.record.summary);
  assert.equal(await readFile(desktopFile, "utf8"), recorded);
  /* A camera run that names no format keeps the saved scope: the next-step tools never name one. */
  const inherited = await auto({ ...options, formats: undefined });
  assert.deepEqual(inherited.formats, ["h"]);
  assert.equal(inherited.stages.tour.status, "cached", inherited.stages.tour.summary);
  assert.equal(inherited.stages.record.status, "cached", inherited.stages.record.summary);
  assert.equal(await readFile(desktopFile, "utf8"), recorded);

  // A stale mobile take from an older attempt must not enter the saved story or its revisions.
  const mobile = { ...JSON.parse(recorded), take: "mobile", events: [], macros: [] };
  await writeFile(join(sessions, `${first.project.id}.mobile.session.json`), JSON.stringify(mobile));
  const offline = await auto({ ...options, formats: undefined, camera: false });
  assert.equal(offline.stages.plan.status, "done", offline.stages.plan.summary);
  assert.deepEqual(offline.formats, ["h"]);
  await assert.rejects(auto({ ...options, formats: ["v"], camera: false }), /outside the saved production scope.*camera enabled/,
    "an offline format switch cannot reuse stale mobile footage left by an earlier production");
  const studio = await studioWorkspace(first.project.id, home, { prepareAudio: false });
  assert.deepEqual(studio.takes.map(take => take.take), ["desktop"]);
  assert.ok(studio.matrix.compositions.length > 0);
  assert.ok(studio.matrix.compositions.every(comp => comp.id.endsWith("--h")), "preview and final exports share a matrix containing only the selected canvas");
  assert.equal(studio.matrix.mismatched.size, 0);
  const document = await studio.document(first.briefs[0].id);
  await studio.revise(document.briefId, { expectedRevision: document.revision, edits: [{ kind: "theme", value: "grid" }] }, "none");
  const revised = await auto({ ...options, formats: undefined, camera: false });
  assert.equal(revised.stages.plan.status, "done", revised.stages.plan.summary);
  assert.deepEqual(revised.formats, ["h"]);
});

test("a vertical production is walked from the desktop and re-walked on the phone, and records only the phone", { timeout: 120_000 }, async t => {
  /*
    The walker finds the navigation in the desktop layout and the re-walk unfolds it on the
    phone; a phone-led walk never opens a collapsed navigation. So the walk is led from the
    desktop whatever the scope, and only the required take is recorded.
  */
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-formats-v-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "product"), home = join(dir, "outputs");
  await mkdir(root);
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "catalog", homepage: "https://catalog.example/", dependencies: { vite: "1.0.0" } }));
  await writeFile(join(root, "README.md"), "# Catalog\n\nInstalled packages are listed.\n");
  const git = (...args: string[]) => exec("git", ["-C", root, "-c", "user.email=t@panoma-video.test", "-c", "user.name=panoma-video", ...args]);
  await git("init", "-q"); await git("add", "-A"); await git("commit", "-q", "-m", "fixture");
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    if (request.url === "/packages") { response.end("<!doctype html><main><h1>Installed packages</h1><p>Your local packages are ready.</p></main>"); return; }
    response.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:24px sans-serif;background:white;color:black;padding:40px}a,button{padding:16px;display:inline-block}#more{display:none}@media(max-width:760px){#links{display:none}#more{display:inline-block}#links.open{display:block}}</style><nav><button id="more" aria-expanded="false" onclick="document.querySelector('#links').classList.toggle('open');this.setAttribute('aria-expanded',String(document.querySelector('#links').classList.contains('open')))">More sections</button><div id="links"><a href="/packages">Packages</a></div></nav><main><h1>Catalog</h1><p>Your projects together.</p></main>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const report = await auto({ root, home, url, goal: "promo", until: "plan", formats: ["v"], brain: "none", voice: "none", langs: ["en"] });
  assert.equal(report.stages.tour.status, "done", report.stages.tour.summary);
  assert.equal(report.stages.record.status, "done", report.stages.record.summary);
  const tour = JSON.parse(await readFile(report.files.tour!, "utf8"));
  assert.ok(tour.marks.some((mark: { kind: string; label: string }) => mark.kind === "flow" && mark.label === "Packages"), "the desktop-led walk found the folded navigation");
  assert.ok(tour.steps.some((step: Record<string, unknown>) => typeof step.clickOn === "string" && step.clickOn.includes("More sections") && step.role === "chrome"), "the phone re-walk unfolded it");
  const sessions = join(report.project.dir, "sessions");
  assert.deepEqual((await readdir(sessions)).filter(file => file.endsWith(".session.json")), [`${report.project.id}.mobile.session.json`], "only the required take is recorded");
  assert.deepEqual(report.formats, ["v"]);
});
