import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { ReviewReport } from "@panoma/video-core";
import { reviewExportFile, writeReviewReport } from "../packages/director/src/export-review.ts";

async function directory(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-export-review-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("a versioned export never falls back to encoded-only review when its historical snapshot is unavailable", async (t) => {
  const dir = await directory(t);
  const file = join(dir, "promo--hook--en--h--r-r1-abc.mp4");
  const base = file.replace(/\.mp4$/, "");
  const report = '{"checks":[{"id":"story.claims","status":"pass"}]}\n';
  await writeFile(file, "encoded fixture");
  await writeFile(`${base}.review.json`, report);
  await assert.rejects(reviewExportFile(file), /missing its original export metadata/);
  await writeFile(`${base}.export.json`, JSON.stringify({ revision: "r1-abc", compositionId: "promo--hook--en--h" }));
  await assert.rejects(reviewExportFile(file), /no valid original review context/);
  assert.equal(await readFile(`${base}.review.json`, "utf8"), report);
  assert.equal(await readFile(file, "utf8"), "encoded fixture");
});

test("standalone media retain generic review, while malformed export metadata refuses without touching the report", async (t) => {
  const dir = await directory(t);
  const file = join(dir, "standalone.mp4");
  await writeFile(file, "ordinary media");
  assert.equal(await reviewExportFile(file), undefined);
  await writeFile(join(dir, "standalone.export.json"), "null");
  await writeFile(join(dir, "standalone.review.json"), "old full report");
  await assert.rejects(reviewExportFile(file), /export metadata is invalid/);
  assert.equal(await readFile(join(dir, "standalone.review.json"), "utf8"), "old full report");
});

test("atomic review report writing never replaces a media file with an unfamiliar extension", async (t) => {
  const dir = await directory(t);
  const file = join(dir, "capture.mkv");
  await writeFile(file, "original encoded bytes");
  const report: ReviewReport = { file, renderedAt: "2026-09-05T00:00:00Z", status: "pass", checks: [],
    measured: { seconds: 24, width: 1920, height: 1080, fps: 30 } };
  await writeReviewReport(file, report);
  assert.equal(await readFile(file, "utf8"), "original encoded bytes");
  assert.deepEqual(JSON.parse(await readFile(`${file}.review.json`, "utf8")), report);
  assert.deepEqual((await readdir(dir)).sort(), ["capture.mkv", "capture.mkv.review.json"]);
});
