import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRange } from "@panoma/video-engine/server";

test("byte ranges: the forms Chromium actually sends for video", () => {
  assert.deepEqual(parseRange("bytes=0-", 100), { start: 0, end: 99 });
  assert.deepEqual(parseRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseRange("bytes=90-200", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=-30", 100), { start: 70, end: 99 });
});

test("byte ranges: refusals", () => {
  assert.equal(parseRange(undefined, 100), null);
  assert.equal(parseRange("bytes=-", 100), null);
  assert.equal(parseRange("bytes=100-", 100), null);
  assert.equal(parseRange("bytes=20-10", 100), null);
  assert.equal(parseRange("frames=0-1", 100), null);
  assert.equal(parseRange("bytes=-0", 100), null);
});
