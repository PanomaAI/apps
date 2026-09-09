import assert from "node:assert/strict";
import { test } from "node:test";
import { createVideoClock, isCalibratedVideoClock } from "../packages/capture/src/clock.ts";

const epoch = 1_800_000_000_000;

test("video zero is the first presentation timestamp, including a delayed encoder start", async () => {
  const clock = createVideoClock(epoch);
  clock.observeFrame(epoch + 1272.25);
  await clock.ready();
  assert.deepEqual(clock.metadata(), { source: "screencast", version: 1, originMs: epoch + 1272.25, offsetMs: -1272.25 });
  assert.equal(clock.time(13924), 12651.75);
  assert.equal(clock.time(14324) - clock.time(13924), 400, "an interval is preserved by the origin correction");
  clock.observeFrame(epoch + 6000);
  assert.equal(clock.time(13924), 12651.75, "later frame delivery cannot slide the origin");
  assert.equal(clock.time(0), 0, "an instant before the first picture can only refer to video zero");
  assert.equal(isCalibratedVideoClock(JSON.parse(JSON.stringify(clock.metadata()))), true);
});

test("a frame presented before the pass clock retains its recorded head", async () => {
  const clock = createVideoClock(epoch);
  clock.observeFrame(epoch - 160);
  await clock.ready();
  assert.equal(clock.time(800), 960);
  assert.equal(clock.metadata().offsetMs, 160);
});

test("missing and invalid frame timestamps fail instead of inventing an origin", async () => {
  const missing = createVideoClock(epoch);
  await assert.rejects(missing.ready(20), /No browser frame timestamp within 20ms/);
  assert.throws(() => missing.time(1000), /uncalibrated/);
  for (const timestamp of [0, -1, NaN, Infinity]) {
    const invalid = createVideoClock(epoch);
    invalid.observeFrame(timestamp);
    await assert.rejects(invalid.ready(), /Invalid browser frame timestamp/);
    assert.throws(() => invalid.metadata(), /Invalid browser frame timestamp/);
  }
  const invalidLater = createVideoClock(epoch);
  invalidLater.observeFrame(epoch);
  invalidLater.observeFrame(NaN);
  assert.throws(() => invalidLater.metadata(), /Invalid browser frame timestamp/);
});

test("clock evidence requires the known source, version and finite measured origin", () => {
  const valid = { source: "screencast", version: 1, originMs: epoch, offsetMs: -20 };
  for (const value of [undefined, null, {}, [], { ...valid, source: "page-created" }, { ...valid, version: 2 },
    { ...valid, originMs: 0 }, { ...valid, originMs: NaN }, { ...valid, offsetMs: Infinity }]) {
    assert.equal(isCalibratedVideoClock(value), false);
  }
});
