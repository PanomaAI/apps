/*
  The one promise `workspace.ts` opens with: nothing is ever written inside the project
  being filmed. It was prose until now — the only code that checked it was the request
  validator the deleted browser Studio called, so `PANOMA_VIDEO_HOME=./out` put takes, voice
  files and renders straight into someone's repository. The check now lives in
  `openWorkspace`, which is the single door every workspace comes through, and these are
  the cases that door has to get right.
*/
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { openWorkspace } from "../packages/director/src/workspace.ts";

/** A real temporary disk, resolved: on macOS `/tmp` is a symlink and every comparison here is about real paths. */
async function disk(t: TestContext, name: string) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), `panoma-video-${name}-`)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("an output directory inside the filmed project is refused before anything is created", async t => {
  const dir = await disk(t, "boundary-inside");
  const root = join(dir, "product");
  await mkdir(root);
  await assert.rejects(openWorkspace(root, { home: join(root, "out") }), error => {
    assert.match((error as Error).message, /inside the project being filmed/);
    assert.match((error as Error).message, /PANOMA_VIDEO_HOME/, "the refusal says how to fix it");
    return true;
  });
  assert.deepEqual(await readdir(root, { recursive: true }), [], "the refusal wrote nothing in the project");
});

test("the project directory itself is refused as an output directory", async t => {
  const dir = await disk(t, "boundary-same");
  const root = join(dir, "product");
  await mkdir(root);
  await assert.rejects(openWorkspace(root, { home: root }), /inside the project being filmed/);
  assert.deepEqual(await readdir(root, { recursive: true }), []);
});

/*
  The prefix-versus-boundary bug: `/tmp/app-out` starts with every character of
  `/tmp/app` and is a different directory beside it, not a directory within it. A check
  written with `startsWith` on the two paths refuses this, and refusing it would make the
  obvious place to put the output the one place a user cannot.
*/
test("a sibling whose name merely starts with the project's name is a different directory", async t => {
  const dir = await disk(t, "boundary-prefix");
  const root = join(dir, "app"), home = join(dir, "app-out");
  await mkdir(root);
  await mkdir(home);
  const ws = await openWorkspace(root, { home });
  assert.equal(ws.root, root);
  assert.ok(ws.dir.startsWith(join(home, "projects")), "the workspace was opened under the sibling");
  assert.deepEqual(await readdir(root, { recursive: true }), [], "the project beside it stays untouched");
});

/*
  On a first run the output directory does not exist. `realpath` refuses to answer about
  a directory that is not there, so the check walks up to the nearest ancestor that does
  exist — and it must do that by looking, never by creating the missing tail to find out.
*/
test("an output directory that does not exist yet is placed by its nearest existing ancestor", async t => {
  const dir = await disk(t, "boundary-absent");
  const root = join(dir, "product");
  await mkdir(root);
  const home = join(dir, "outputs", "deep", "still-missing");
  const ws = await openWorkspace(root, { home });
  assert.ok(ws.dir.startsWith(join(home, "projects")));
  assert.deepEqual(await readdir(join(home, "projects")), [ws.id]);
  assert.deepEqual(await readdir(root, { recursive: true }), []);
});

test("a symlink is not a way into the filmed project", async t => {
  const dir = await disk(t, "boundary-symlink");
  const root = join(dir, "product");
  await mkdir(root);
  await symlink(root, join(dir, "shortcut"));
  await assert.rejects(openWorkspace(root, { home: join(dir, "shortcut", "out") }), /inside the project being filmed/);

  /* The home can look clean while the directory that is actually created does not: the check asks both. */
  const home = join(dir, "outputs");
  await mkdir(home);
  await symlink(root, join(home, "projects"));
  await assert.rejects(openWorkspace(root, { home }), /inside the project being filmed/);
  assert.deepEqual(await readdir(root, { recursive: true }), [], "neither refusal wrote in the project");
});

test("an output directory beside the filmed project opens, and leaves the project as it found it", async t => {
  const dir = await disk(t, "boundary-normal");
  const root = join(dir, "product"), home = join(dir, "outputs");
  await mkdir(root);
  await writeFile(join(root, "package.json"), '{ "name": "product" }\n');
  const ws = await openWorkspace(root, { home, id: "product-fixture" });
  assert.equal(ws.id, "product-fixture");
  assert.equal(ws.root, root);
  assert.equal(ws.dir, join(home, "projects", "product-fixture"));
  assert.equal(ws.paths.cache, join(home, "cache"));
  for (const path of [ws.paths.tours, ws.paths.sessions, ws.paths.briefs, ws.paths.generated, ws.paths.sfx, ws.paths.music, ws.paths.renders, ws.paths.kits, ws.paths.cache]) {
    assert.deepEqual(await readdir(path), [], `${path} was not created`);
  }
  assert.deepEqual(await readdir(root, { recursive: true }), ["package.json"], "opening a workspace writes nothing in the project");
});
