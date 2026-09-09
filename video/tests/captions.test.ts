import assert from "node:assert/strict";
import { test } from "node:test";
import { wordsFromCharacters } from "@panoma/video-audio";

test("character alignment collapses into words with edge timings", () => {
  const chars = "one  two".split("");
  const starts = chars.map((_, i) => i * 0.1);
  const ends = chars.map((_, i) => i * 0.1 + 0.1);
  const words = wordsFromCharacters({
    characters: chars,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  });
  assert.deepEqual(
    words.map((w) => w.text),
    ["one", "two"],
  );
  assert.equal(words[0].start, 0);
  assert.ok(Math.abs(words[0].end - 0.3) < 1e-9);
  assert.ok(Math.abs(words[1].start - 0.5) < 1e-9);
});

test("trailing word closes at the last character", () => {
  const chars = "hi".split("");
  const words = wordsFromCharacters({
    characters: chars,
    character_start_times_seconds: [0, 0.1],
    character_end_times_seconds: [0.1, 0.2],
  });
  assert.equal(words.length, 1);
  assert.ok(Math.abs(words[0].end - 0.2) < 1e-9);
});
