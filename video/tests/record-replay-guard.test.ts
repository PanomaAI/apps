import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

const run = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("CLI replay refuses saved scene revisions before resolving a source, probing an override or replacing evidence", { timeout: 30000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), "panoma-video-replay-guard-"));
  const id = "replay-guard-fixture";
  const project = join(home, "projects", id);
  let requests = 0;
  const server = createServer((_request, response) => { requests++; response.setHeader("content-type", "text/html"); response.end("<main><h1>Must not film</h1></main>"); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await Promise.all(["tours", "sessions", "promo-revisions"].map(path => mkdir(join(project, path), { recursive: true })));
    const files: Record<string, string> = {
      "profile.json": JSON.stringify({ root: join(home, "source-that-must-not-be-resolved") }),
      "brand.json": JSON.stringify({ name: "Saved product", scheme: { default: "light" } }),
      "facts.json": JSON.stringify({ facts: [{ id: "saved", value: "Original evidence" }] }),
      [`tours/${id}.json`]: JSON.stringify({ url, steps: [{ goto: url }, { mark: "hero" }], denySelectors: ["#private"] }),
      "promo-revisions/story.json": JSON.stringify({ revision: 3, scenes: [{ id: "approved" }] }),
      [`sessions/${id}.key`]: "original-record-key",
      [`sessions/${id}.desktop.webm`]: "original-recorded-bytes",
      [`sessions/${id}.desktop.session.json`]: JSON.stringify({ name: id, video: `${id}.desktop.webm`, marks: [] }),
    };
    await Promise.all(Object.entries(files).map(([path, text]) => writeFile(join(project, path), text)));
    for (const extra of [[], [`--url=${url}`], [`--url=${url}`, "--new-story"]]) {
      await assert.rejects(run(process.execPath, [join(root, "apps/cli/src/panoma-video.ts"), "record", id, `--project=${id}`, ...extra], {
        cwd: root, env: { ...process.env, PANOMA_VIDEO_HOME: home, PANOMA_VIDEO_BRAIN: "none" }, timeout: 10000,
      }), error => {
        const failure = error as Error & { stderr?: string };
        assert.match(failure.stderr ?? failure.message, /saved scene revisions.*panoma-video auto.*--new-story/i);
        return true;
      });
      assert.equal(requests, 0, "even an explicit URL is not probed before the refusal");
      for (const [path, text] of Object.entries(files)) assert.equal(await readFile(join(project, path), "utf8"), text, path);
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
});
