/* The installed tarball, with no source TS and no shared browser cache, is the release gate. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, mkdir, rm, cp, readdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";
const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
test("a clean npm installation probes requirements and renders a reviewed real cut", { skip: process.env.PANOMA_VIDEO_PACKAGE_TEST !== "1", timeout: 1_200_000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), "panoma-video-package-"));
  try {
    const stage = join(temp, "stage"), install = join(temp, "install"), home = join(temp, "home");
    await Promise.all([stage, home].map(path => mkdir(path)));
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    for (const file of [...pkg.files, "package.json", "README.md"]) await cp(join(root, file), join(stage, file), { recursive: true });
    // The clean room packs the exact public manifest; npm ignores its development dependencies.
    await run(process.execPath, [join(root, "scripts/check-package.mjs")], { cwd: root });
    const candidates = [process.env.npm_execpath?.endsWith("npm-cli.js") ? process.env.npm_execpath : "", join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"), join(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js")];
    let npmPath = "";
    for (const file of candidates.filter(Boolean)) if (await access(file!).then(() => true, () => false)) { npmPath = file!; break; }
    assert.ok(npmPath, "npm-cli.js is installed beside Node");
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: home, USERPROFILE: home, PANOMA_VIDEO_HOME: join(home, "video"), PLAYWRIGHT_BROWSERS_PATH: join(temp, "browsers"), PANOMA_VIDEO_BRAIN: "none", PANOMA_APP_JOB: "package-test", PANOMA_VIDEO_MAX_BRAIN_CALLS: "0", npm_config_cache: join(temp, "npm-cache"), npm_config_registry: "https://registry.npmjs.org" };
    const options = { env, maxBuffer: 8 * 1024 * 1024, timeout: 600_000 };
    const packed = await run(process.execPath, [npmPath, "pack", "--json", "--ignore-scripts"], { ...options, cwd: stage });
    const [{ filename, size }] = JSON.parse(packed.stdout);
    assert.ok(size < 30 * 1024 * 1024, `Compressed tarball bytes: ${size}`);
    const tarball = join(stage, filename);
    await run(process.execPath, [npmPath, "install", "--prefix", install, "--ignore-scripts", "--no-audit", "--no-fund", tarball], options);
    const installed = join(install, "node_modules", "@panoma", "video");
    const installedPkg = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
    // The host schema is optional for independent video clones and mandatory in the integration gate.
    if (process.env.PANOMA_APPS_SCHEMA) {
      const { validateManifest } = await import(pathToFileURL(resolve(process.env.PANOMA_APPS_SCHEMA)).href);
      assert.equal(validateManifest(installedPkg).id, "panoma-video");
    }
    assert.deepEqual(installedPkg.panoma, pkg.panoma);
    assert.ok(!(await readdir(installed)).some(name => ["briefs", "media", "tests", ".env", "packages", "apps"].includes(name)));
    const cli = join(installed, "dist", "panoma-video.js");
    const doctor = async () => JSON.parse((await run(process.execPath, [cli, "doctor", "--json"], options)).stdout);
    assert.equal((await doctor()).browser.present, false);
    await run(process.execPath, [join(install, "node_modules", "playwright", "cli.js"), "install", "chromium"], options);
    const ready = await doctor();
    assert.equal(ready.browser.present, true);
    assert.equal(ready.ffmpeg.present, true);
    const [{ Client }, { StdioClientTransport }] = await Promise.all([import("@modelcontextprotocol/sdk/client/index.js"), import("@modelcontextprotocol/sdk/client/stdio.js")]);
    const client = new Client({ name: "package-test", version: "1" });
    const childEnv = Object.fromEntries(Object.entries(env).filter((row): row is [string, string] => typeof row[1] === "string"));
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(installed, "dist/mcp.js")], cwd: temp, env: childEnv, stderr: "pipe" });
    try {
      await client.connect(transport);
      type Guide = { version: string; requirements: typeof ready; spend: { calls: number; provider: string } };
      /*
        The handshake before every job asks the cheap question, which never starts a browser: it can
        say the browser is there and cannot say which one, because only launching it tells a missing
        library from a missing binary. `doctor` is always deep. Comparing one against the other is
        comparing two different questions, so each is asked for what it promises.
       */
      const quick = (await client.callTool({ name: "panoma_video_guide", arguments: {} })).structuredContent as Guide;
      assert.equal(quick.version, installedPkg.panoma.app.protocol);
      assert.deepEqual(quick.spend, { calls: 0, provider: "none" });
      assert.equal(quick.requirements.browser.present, true);
      assert.equal(quick.requirements.browser.name, "chromium");
      assert.equal(quick.requirements.browser.approxMB, ready.browser.approxMB);
      assert.equal(quick.requirements.browser.version, undefined);
      assert.deepEqual(quick.requirements.ffmpeg, ready.ffmpeg);
      assert.equal(quick.requirements.home, ready.home);
      // Asked the same question, the two surfaces have to give the host the same answer.
      const deep = (await client.callTool({ name: "panoma_video_guide", arguments: { probe: "deep" } })).structuredContent as Guide;
      assert.deepEqual(deep.requirements, ready);
      const list = await client.listTools();
      assert.ok(list.tools.find(tool => tool.name === "panoma_video_auto")?.inputSchema.properties?.workspace_id);
    } finally { await client.close(); }

    const fixture = join(temp, "fixture");
    await cp(join(root, "tests", "fixtures", "scout", "library"), fixture, { recursive: true });
    await run(process.execPath, [cli, "auto", fixture, "--goal=facts", "--langs=en", "--format=h", "--until=preview", "--brain=none", "--voice=none"], options);
    const workspaces = await readdir(join(home, "video", "projects"));
    assert.equal(workspaces.length, 1);
    const report = JSON.parse(await readFile(join(home, "video", "projects", workspaces[0], "auto.json"), "utf8"));
    assert.ok(report.renders.length > 0, JSON.stringify(report.stages));
    for (const render of report.renders) {
      assert.notEqual(render.review.status, "fail");
      const reviewed = JSON.parse((await run(process.execPath, [cli, "review", render.file, "--json", "--silent"], options)).stdout);
      assert.notEqual(reviewed.status, "fail");
    }
    if (process.env.PANOMA_VIDEO_KEEP_PACKAGE) await cp(tarball, resolve(process.env.PANOMA_VIDEO_KEEP_PACKAGE));
    console.log(`Installed package rendered successfully. Compressed tarball bytes: ${size}`);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
