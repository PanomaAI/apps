import assert from "node:assert/strict";
import { test } from "node:test";
import { draftBriefs, type RepoStats } from "@panoma/video-core";

const stats: RepoStats = {
  name: "panoma",
  commits: 47,
  days: 30,
  subjects: ["fix: the catalog no longer loses projects", "feat: memory notes", "fix caption drift"],
  lastTag: "v0.1.7",
};

test("drafts carry real numbers, and sentences end on them", () => {
  const drafts = draftBriefs(stats);
  assert.equal(drafts.length, 3);
  const pace = drafts[0].hooks[0].text.en;
  assert.ok(pace.includes("47"));
  /* The nine-times bug: no inflected word glued after a digit — numbers close their sentence. */
  for (const d of drafts)
    for (const h of d.hooks)
      for (const text of Object.values(h.text)) {
        assert.ok(!/\d+ (commits?|days?|días?|arreglos?)\b(?!:)/.test(text) || /\d+[.!]?$/.test(text.trim()),
          `hook risks the n=1 bug: "${text}"`);
      }
});

test("the fixes draft exists only when fixes exist", () => {
  assert.ok(draftBriefs(stats).some((d) => d.id === "panoma-fixes"));
  const calm = draftBriefs({ ...stats, subjects: ["feat: something"] });
  assert.ok(!calm.some((d) => d.id === "panoma-fixes"));
});

test("the release draft follows the tag", () => {
  assert.ok(draftBriefs(stats).some((d) => d.id === "panoma-release"));
  assert.ok(!draftBriefs({ ...stats, lastTag: undefined }).some((d) => d.id === "panoma-release"));
});

test("every draft names a real recipe and both languages", () => {
  for (const d of draftBriefs(stats)) {
    assert.ok(["KineticQuote", "ScreenDemo", "TerminalRun", "Loop"].includes(d.recipe));
    assert.deepEqual(d.langs, ["en", "es"]);
  }
});
