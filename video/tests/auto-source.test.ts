/* The deployed instance changes in memory; the project's git tree never moves. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { auto } from "../packages/director/src/auto.ts";
import { scoutProject, worktreeDigest } from "@panoma/video-scout";
import { studioWorkspace } from "../packages/director/src/studio.ts";
import { openWorkspace } from "../packages/director/src/workspace.ts";

const exec = promisify(execFile);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("saved evidence refuses all camera runs before starting the product, probing its URL or replacing workspace metadata", async t => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-local-source-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "product"), home = join(dir, "outputs");
  await mkdir(root);
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "local-camera", scripts: { dev: "node server.js" } }));
  await writeFile(join(root, "server.js"), "throw new Error('this application must not start');");
  const profile = await scoutProject(root);
  const ws = await openWorkspace(root, { home, id: profile.id });
  await mkdir(join(ws.dir, "promo-revisions"));
  const files = [ws.paths.profile, ws.paths.facts, ws.paths.brand, join(ws.dir, "promo-revisions", "saved.json")];
  for (const file of files) await writeFile(file, "saved evidence bytes\n");
  for (const url of [undefined, "http://127.0.0.1:9/"]) for (const force of [false, true]) {
    const progress: string[] = [];
    await assert.rejects(auto({ root, home, url, force, goal: "promo", until: "study", brain: "none", voice: "none", onProgress: stage => progress.push(stage) }), /saved scene revisions.*camera.*--no-camera.*--new-story/i);
    assert.deepEqual(progress, ["scout"], "neither the brain, server nor URL probe starts before this refusal, even when force was requested");
    for (const file of files) assert.equal(await readFile(file, "utf8"), "saved evidence bytes\n");
  }
});

test("auto caches an unchanged served instance, protects saved evidence, and recaptures a deployment without a git change", { timeout: 180_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-auto-source-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "product"), home = join(dir, "outputs");
  await mkdir(root);
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "served-catalog", type: "module", homepage: "https://catalog.example/", dependencies: { vite: "1.0.0" } }));
  await writeFile(join(root, "README.md"), "# Served Catalog\n\nA catalog for your projects.\n");
  const git = (...args: string[]) => exec("git", ["-C", root, "-c", "user.email=t@panoma-video.test", "-c", "user.name=panoma-video", ...args]);
  await git("init", "-q"); await git("add", "-A"); await git("commit", "-q", "-m", "the unchanged local checkout");
  const tree = await worktreeDigest(root);
  let version = "Catalog";
  const server = createServer((_, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><html><head><title>Served Catalog</title><meta name="application-name" content="Served Catalog Studio"><style>body{font:24px sans-serif;background:white;color:black;padding:40px}button{padding:20px}</style></head><body><main><h1>${version}</h1><p>Your projects together.</p><button onclick="this.hidden=true;document.querySelector('#result').hidden=false">Open catalog</button><section id="result" hidden><h2>Project memory</h2><p>Saved project details.</p><button onclick="this.hidden=true;document.querySelector('#notes').hidden=false">Open saved notes</button><section id="notes" hidden><h2>Saved notes</h2><p>The project instructions stay with this catalog entry.</p></section></section></main></body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const run = (newStory = false) => auto({ root, home, url, goal: "promo", until: "study", brain: "none", voice: "none", newStory });
  const first = await run();
  assert.equal(first.stages.tour.status, "done", first.stages.tour.summary);
  assert.equal(first.stages.record.status, "done", first.stages.record.summary);
  const sourceFile = first.files.captureSource!;
  const source = JSON.parse(await readFile(sourceFile, "utf8"));
  const tourBefore = await readFile(first.files.tour!);
  const sessions = join(first.project.dir, "sessions");
  const recordKey = await readFile(join(sessions, `${first.project.id}.key`), "utf8");
  const desktop = join(sessions, `${first.project.id}.desktop.webm`);
  const takeHash = hash(await readFile(desktop));
  const second = await run();
  assert.equal(second.stages.tour.status, "cached", second.stages.tour.summary);
  assert.equal(second.stages.record.status, "cached", second.stages.record.summary);
  assert.equal(JSON.parse(await readFile(sourceFile, "utf8")).key, source.key);
  assert.equal(hash(await readFile(desktop)), takeHash);

  const planned = await auto({ root, home, url, goal: "promo", until: "plan", brain: "none", voice: "none", camera: false, langs: ["en"] });
  assert.equal(planned.briefs.length, 1, JSON.stringify(planned.skipped));
  const studio = await studioWorkspace(first.project.id, home, { prepareAudio: false });
  const beforeEdit = await studio.document(planned.briefs[0].id);
  const edited = await studio.revise(beforeEdit.briefId, { expectedRevision: beforeEdit.revision, edits: [{ kind: "theme", value: "grid" }] }, "none");
  const savedFiles = [first.files.profile, first.files.facts, first.files.brand, sourceFile];
  const savedBytes = await Promise.all(savedFiles.map(file => readFile(file)));
  const revisionFile = join(first.project.dir, "promo-revisions", `${edited.briefId}.json`);
  const revisionBytes = await readFile(revisionFile);
  await assert.rejects(auto({ root, home, goal: "promo", until: "study", brain: "none", voice: "none" }), /saved scene revisions.*camera.*--no-camera.*--new-story/i);
  for (const [index, file] of savedFiles.entries()) assert.deepEqual(await readFile(file), savedBytes[index], `a refused local camera preserves ${file}`);
  assert.equal(hash(await readFile(desktop)), takeHash);
  assert.deepEqual(await readFile(revisionFile), revisionBytes);

  // Even a legacy journal that cannot be interpreted must not be overwritten by
  // a recording update. Its exact bytes and its footage remain recoverable.
  await mkdir(join(first.project.dir, "promo-revisions"), { recursive: true });
  const journal = join(first.project.dir, "promo-revisions", "approved-story.json");
  await writeFile(journal, "the user's saved journal\n");
  version = "Project archive";
  await assert.rejects(run(), /saved scene revisions.*camera.*--no-camera.*--new-story/i);
  assert.deepEqual(await readFile(first.files.tour!), tourBefore);
  assert.equal(hash(await readFile(desktop)), takeHash);
  assert.equal(await readFile(journal, "utf8"), "the user's saved journal\n");
  for (const [index, file] of savedFiles.entries()) assert.deepEqual(await readFile(file), savedBytes[index], `a refused source refresh preserves ${file}`);
  assert.deepEqual(await readFile(revisionFile), revisionBytes);
  const reopened = await studioWorkspace(first.project.id, home, { prepareAudio: false });
  assert.equal((await reopened.document(edited.briefId)).revision, edited.revision, "the protected story remains editable, including the fact witness for its measured brand");
  const changed = await run(true);
  assert.equal(changed.stages.tour.status, "done", changed.stages.tour.summary);
  assert.equal(changed.stages.record.status, "done", changed.stages.record.summary);
  assert.match(changed.stages.record.summary, /served document or linked asset bytes changed/);
  assert.notEqual(JSON.parse(await readFile(sourceFile, "utf8")).key, source.key);
  assert.notEqual(await readFile(join(sessions, `${first.project.id}.key`), "utf8"), recordKey);
  assert.notEqual(hash(await readFile(desktop)), takeHash);
  assert.equal(await worktreeDigest(root), tree, "no project file or git state changed during the three camera runs");
  assert.equal(await readFile(journal, "utf8"), "the user's saved journal\n", "only planning a valid replacement may archive a story; a study does not");
});
