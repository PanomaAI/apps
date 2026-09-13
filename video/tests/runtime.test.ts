import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { corepackHome, freePort, prepareRuntime, scoutProject, startServer, tcpOpen } from "@panoma/video-scout";

const exists = (path: string) => access(path).then(() => true, () => false);
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-runtime-test-"));
  const source = join(dir, "source"), runtimes = join(dir, "runtimes");
  await mkdir(source);
  await writeFile(join(source, "package.json"), JSON.stringify({ name: "runtime-fixture", scripts: { dev: "node server.js" } }));
  return { dir, source, runtimes, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test("the camera starts in a disposable copy, keeps writes out of source and does not inherit secrets", async () => {
  const f = await fixture();
  const old = process.env.OPENAI_API_KEY, oldNode = process.env.NODE_OPTIONS;
  process.env.OPENAI_API_KEY = "panoma-video-secret-must-not-reach-the-product";
  process.env.NODE_OPTIONS = "--no-warnings";
  try {
    await writeFile(join(f.source, ".env.local"), "A secret that the runtime must not read or copy");
    await writeFile(join(f.source, ".npmrc"), "//registry.example/:_authToken=private");
    await writeFile(join(f.source, ".dev.vars.local"), "CLOUDFLARE_SECRET=private");
    await mkdir(join(f.source, ".wrangler"));
    await writeFile(join(f.source, ".wrangler", "state.sqlite"), "private local app state");
    /* A Next.js `distDir` under another name is build output too, and it can weigh gigabytes. */
    await mkdir(join(f.source, ".next-bundle", "cache"), { recursive: true });
    await writeFile(join(f.source, ".next-bundle", "cache", "0.pack"), "webpack cache the copy must not carry");
    await writeFile(join(f.source, "server.js"), `const fs=require('node:fs'); const path=require('node:path');
      fs.mkdirSync('.next'); fs.writeFileSync('.next/cache', 'written by the framework');
      fs.writeFileSync(path.join(process.env.HOME, 'cache'), 'written in the isolated home');
      require('node:http').createServer((q,r)=>{r.setHeader('content-type','text/html');r.end(JSON.stringify({cwd:process.cwd(),home:process.env.HOME,corepack:process.env.COREPACK_HOME,verify:process.env.pnpm_config_verify_deps_before_run,key:process.env.OPENAI_API_KEY,node:process.env.NODE_OPTIONS,custom:process.env.CAMERA_FIXTURE,env:fs.existsSync('.env.local'),vars:fs.existsSync('.dev.vars.local'),private:fs.existsSync('.npmrc'),state:fs.existsSync('.wrangler'),dist:fs.existsSync('.next-bundle')}))}).listen(process.env.PORT,'127.0.0.1');`);
    const profile = await scoutProject(f.source);
    const server = await startServer(profile, { runtimeBase: f.runtimes, timeoutMs: 10000, env: { CAMERA_FIXTURE: "explicit" } });
    try {
      const result = await (await fetch(server.url)).json() as Record<string, string | boolean>;
      assert.equal(result.key, undefined);
      assert.equal(result.node, undefined);
      assert.equal(result.custom, "explicit");
      assert.equal(result.env, false);
      assert.equal(result.vars, false);
      assert.equal(result.private, false);
      assert.equal(result.state, false);
      assert.equal(result.dist, false, "a Next.js distDir under another name is build output, not source");
      assert.ok(String(result.cwd).startsWith(server.runtimeDir));
      assert.ok(String(result.home).startsWith(server.runtimeDir));
      /*
        The one folder of the real home that does follow: the package managers Corepack already
        fetched. Without it, every project pinning `packageManager` asked Corepack to download
        pnpm into an empty cache with the network off, and the product never started.
       */
      assert.equal(result.corepack, corepackHome(process.env));
      assert.equal(String(result.corepack).startsWith(server.runtimeDir), false);
      // And pnpm is told not to install before running: the copy's store path never matches.
      assert.equal(result.verify, "false");
      assert.equal(await exists(join(f.source, ".next")), false);
      assert.equal(await readFile(join(f.source, ".env.local"), "utf8"), "A secret that the runtime must not read or copy");
    } finally { await server.stop(); }
    assert.equal(await exists(server.runtimeDir), false);
    assert.equal(await tcpOpen(server.port), false);
  } finally {
    if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old;
    if (oldNode === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = oldNode;
    await f.cleanup();
  }
});

test("installed dependency and workspace links resolve only to independent files in the runtime", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.source, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n  - 'packages/*'\n");
    const app = join(f.source, "apps", "web"), dependency = join(f.source, "packages", "local");
    await mkdir(join(app, "node_modules"), { recursive: true });
    await mkdir(dependency, { recursive: true });
    await writeFile(join(app, "package.json"), JSON.stringify({ name: "web", scripts: { dev: "node server.js" } }));
    await writeFile(join(dependency, "index.js"), "original bytes");
    await symlink(dependency, join(app, "node_modules", "local"));
    const profile = await scoutProject(app);
    const runtime = await prepareRuntime(profile, { baseDir: f.runtimes });
    try {
      assert.equal(runtime.sourceRoot, await realpath(f.source));
      const linked = join(runtime.cwd, "node_modules", "local", "index.js");
      assert.ok((await realpath(linked)).startsWith(runtime.root));
      assert.notEqual((await stat(linked)).ino, (await stat(join(dependency, "index.js"))).ino, "never a hard link back to the original dependency");
      await writeFile(linked, "changed in runtime");
      assert.equal(await readFile(join(dependency, "index.js"), "utf8"), "original bytes");
      assert.equal(relative(runtime.root, runtime.cwd), join("apps", "web"));
    } finally { await runtime.cleanup(); }
  } finally { await f.cleanup(); }
});

test("external, private and dangling links refuse before launch, and cannot leave partial runtimes", async () => {
  const f = await fixture();
  try {
    const profile = await scoutProject(f.source);
    await writeFile(join(f.dir, "external.js"), "external");
    for (const target of [join(f.dir, "external.js"), join(f.source, ".env.local"), join(f.source, "missing.js")]) {
      await symlink(target, join(f.source, "linked.js"));
      await assert.rejects(prepareRuntime(profile, { baseDir: f.runtimes }), /--url/);
      assert.deepEqual(await readdir(f.runtimes), []);
      await rm(join(f.source, "linked.js"));
    }
    await assert.rejects(prepareRuntime(profile, { baseDir: join(f.source, "runtime") }), /outside the product/);
    assert.equal(await exists(join(f.source, "runtime")), false);
    await symlink(f.source, join(f.dir, "alias"));
    await assert.rejects(prepareRuntime(profile, { baseDir: join(f.dir, "alias", "runtime") }), /outside the product/);
    assert.equal(await exists(join(f.source, "runtime")), false);
  } finally { await f.cleanup(); }
});

test("failed and timed-out starts retain diagnostics and clean the disposable checkout", async () => {
  const f = await fixture();
  try {
    const profile = await scoutProject(f.source);
    for (const args of [["-e", "console.log('runtime failed');process.exit(3)"], ["-e", "console.log('runtime idle');setInterval(()=>{},1000)"]]) {
      const changed = { ...profile, start: { ...profile.start!, command: process.execPath, args } };
      await assert.rejects(startServer(changed, { runtimeBase: f.runtimes, timeoutMs: 500 }), /runtime (failed|idle)/);
      assert.deepEqual(await readdir(f.runtimes), []);
    }
    await assert.rejects(startServer({ ...profile, start: { ...profile.start!, command: "panoma-video-command-that-does-not-exist" } }, { runtimeBase: f.runtimes }), /ENOENT/);
    assert.deepEqual(await readdir(f.runtimes), []);
    /*
      A start script that binds a port by name ignores the PORT the camera hands it, and when
      that port is taken the exit says nothing: the message names the port and the three ways
      out. The script here prints what next prints and exits 0, as next did on 12-Sep-2026.
     */
    const busy = { ...profile, start: { ...profile.start!, command: process.execPath, args: ["-e", "console.error('Error: listen EADDRINUSE: address already in use 127.0.0.1:4173');process.exit(0)"] } };
    await assert.rejects(startServer(busy, { runtimeBase: f.runtimes, timeoutMs: 500 }), /binds port 4173 itself[^\n]*honour the PORT[^\n]*--url/);
    assert.deepEqual(await readdir(f.runtimes), []);
  } finally { await f.cleanup(); }
});

test("an exited launcher cannot leave a descendant holding the camera port", { skip: process.platform === "win32", timeout: 10000 }, async () => {
  const f = await fixture();
  const port = await freePort();
  try {
    const profile = await scoutProject(f.source);
    const child = "process.on('SIGTERM',()=>{});setTimeout(()=>require('node:http').createServer((q,r)=>r.end('child')).listen(process.env.PORT,'127.0.0.1'),100)";
    const launcher = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'inherit'}).unref();console.log('launcher exited');process.exit(3)`;
    await assert.rejects(startServer({ ...profile, start: { ...profile.start!, command: process.execPath, args: ["-e", launcher] } }, { port, runtimeBase: f.runtimes, timeoutMs: 1000 }), /launcher exited/);
    assert.equal(await tcpOpen(port), false, "SIGKILL reaches the surviving process group before cleanup");
    assert.deepEqual(await readdir(f.runtimes), []);
  } finally { await f.cleanup(); }
});

test("host jobs keep the camera server in the guardian group and stop it normally", { skip: process.platform === "win32" }, async () => {
  const { execFileSync } = await import("node:child_process");
  const f = await fixture();
  const previous = process.env.PANOMA_APP_JOB;
  const group = (pid: number) => execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).trim();
  try {
    await writeFile(join(f.source, "server.js"), "require('node:http').createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('ready')}).listen(process.env.PORT,'127.0.0.1');");
    process.env.PANOMA_APP_JOB = "guardian-fixture";
    const server = await startServer(await scoutProject(f.source), { runtimeBase: f.runtimes, timeoutMs: 10000 });
    try { assert.equal(group(server.pid), group(process.pid)); }
    finally { await server.stop(); }
    assert.equal(await tcpOpen(server.port), false);
    delete process.env.PANOMA_APP_JOB;
    const standalone = await startServer(await scoutProject(f.source), { runtimeBase: f.runtimes, timeoutMs: 10000 });
    try { assert.equal(group(standalone.pid), String(standalone.pid)); }
    finally { await standalone.stop(); }
  } finally {
    if (previous === undefined) delete process.env.PANOMA_APP_JOB; else process.env.PANOMA_APP_JOB = previous;
    await f.cleanup();
  }
});
