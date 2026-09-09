import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { connectInMemory, resetRequirementsProbe } from "@panoma/video-mcp";
const run = promisify(execFile);

const cli = fileURLToPath(new URL("../apps/cli/src/panoma-video.ts", import.meta.url));
type Requirements = {
  browser: { present: boolean; path?: string; version?: string };
  ffmpeg: { present: boolean; version?: string };
  home: string;
};
async function guide(probe?: "quick" | "deep"): Promise<{ requirements: Requirements; version: string }> {
  const connection = await connectInMemory();
  try {
    const result = await connection.client.callTool({
      name: "panoma_video_guide",
      arguments: probe ? { probe } : {},
    });
    return result.structuredContent as { requirements: Requirements; version: string };
  } finally { await connection.close(); }
}

/*
  The deep probe is the one that starts the browser, and it is what `doctor` runs: the two have to
  agree down to the version, because the host shows one and a person checks the other.
*/
test("a deep guide and doctor JSON return the same local requirements, without provider calls", async () => {
  const deep = await guide("deep");
  const { stdout } = await run(process.execPath, [cli, "doctor", "--json"]);
  assert.deepEqual(deep.requirements, JSON.parse(stdout));
  assert.equal(deep.version, "1");
});

/*
  The handshake the host makes before every job asks the cheap question instead, because starting
  a browser costs a second of each one. It answers the same fields and reports the same presence
  for a browser that is installed; what it does not do is claim a version it never asked for.
*/
test("the default guide answers without starting a browser", async () => {
  // A deep answer already measured in this process would answer the cheap question too.
  resetRequirementsProbe();
  const [quick, { stdout }] = await Promise.all([
    guide(),
    run(process.execPath, [cli, "doctor", "--json"]),
  ]);
  const deep = JSON.parse(stdout) as Requirements;
  assert.deepEqual(quick.requirements.ffmpeg, deep.ffmpeg);
  assert.equal(quick.requirements.home, deep.home);
  assert.equal(quick.requirements.browser.path, deep.browser.path);
  assert.equal(quick.requirements.browser.present, deep.browser.present);
  assert.equal(quick.requirements.browser.version, undefined);
});
