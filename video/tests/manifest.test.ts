import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { SERVER_VERSION, GUIDE_VERSION, BROWSER_APPROX_MB } from "@panoma/video-mcp";
const root = new URL("../", import.meta.url);
test("the published app declares one compiled CLI and a matching MCP protocol", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(pkg.name, "@panoma/video");
  assert.equal(pkg.version, "0.9.4");
  assert.equal(pkg.private, undefined);
  // A scoped package publishes restricted by default, and the org's plan carries no private packages.
  assert.equal(pkg.publishConfig.access, "public");
  // AGPL-3.0-only conveys object code here; this field is the only pointer to the source.
  assert.match(pkg.repository.url, /^git\+https:\/\/github\.com\//);
  assert.equal(pkg.panoma.app.protocol, SERVER_VERSION);
  assert.equal(SERVER_VERSION, GUIDE_VERSION);
  assert.equal(SERVER_VERSION, "1");
  assert.equal(pkg.bin["panoma-video"], "dist/panoma-video.js");
  assert.equal(pkg.panoma.app.entry.mcp, "dist/mcp.js");
  for (const file of ["LICENSE", "NOTICE.md", "THIRD-PARTY-NOTICES.md", "npm-shrinkwrap.json", "docs/codecs.md"]) assert.ok(pkg.files.includes(file));
  // The size the host discloses before the download is the same one the probe reports afterwards.
  const browser = (pkg.panoma.app.requirements as { kind: string; approxMB?: number }[])
    .find((item) => item.kind === "playwright-browser");
  assert.equal(browser?.approxMB, BROWSER_APPROX_MB);
  assert.ok(!("typescript" in pkg.dependencies));
  assert.ok(Object.values(pkg.dependencies).every(version => !String(version).startsWith("workspace:")));
});
test("the CLI never implicitly loads repository environment files", async () => {
  const source = await readFile(new URL("apps/cli/src/panoma-video.ts", root), "utf8");
  assert.ok(!source.includes("loadEnvFile"));
});
