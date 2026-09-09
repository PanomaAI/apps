import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { recordSession } from "@panoma/video-capture";

test("a failed calibrated recording preserves a completed take and removes only its temporary output", { timeout: 20000 }, async () => {
  const outDir = await mkdtemp(join(tmpdir(), "panoma-video-camera-retry-"));
  const previous = Buffer.from("previous completed recording");
  const file = join(outDir, "retry.desktop.webm");
  await writeFile(file, previous);
  try {
    await assert.rejects(recordSession({ name: "retry", take: { id: "desktop", viewport: { width: 320, height: 180 } },
      outDir, captureElements: false, captureFrames: false, captureMacros: false,
      steps: [{ clickOn: "#missing-required-control" }],
    }), /failed.*(matched nothing|Timeout)/s);
    assert.deepEqual(await readFile(file), previous);
    assert.deepEqual(await readdir(outDir), ["retry.desktop.webm"], "no temporary take or successful session log survives");
  } finally { await rm(outDir, { recursive: true, force: true }); }
});
