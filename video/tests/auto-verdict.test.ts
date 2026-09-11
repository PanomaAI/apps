/*
  The one sentence a person reads when a production plans nothing. The app plans every kind of
  video and sets each aside with a reason, and the sentence used to list them in the order they
  were tried — so whoever asked for a promo found their reason third. The one asked for leads.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { nothingPlanned } from "@panoma/video-director";

const skipped = [
  { goal: "changelog", why: "no tagged CHANGELOG section" },
  { goal: "trailer", why: "no reachable tag" },
  { goal: "tutorial", why: "too few steps" },
  { goal: "promo", why: "A promotion needs a real product click." },
];

test("the kind that was asked for leads the sentence", () => {
  const said = nothingPlanned(skipped, (goal) => goal === "promo");
  assert.match(said, /^no brief could be planned: promo — A promotion needs a real product click\.; changelog — /);
  assert.equal(said.split("; ").length, 4, "nothing set aside is dropped");
});

test("a run for every kind keeps the order they were tried in", () => {
  const said = nothingPlanned(skipped, () => true);
  assert.equal(said, `no brief could be planned: ${skipped.map((s) => `${s.goal} — ${s.why}`).join("; ")}`);
});

test("a tutorial is also the facts, under that other name", () => {
  const wanted = (goal: string) => goal === "tutorial" || goal === "facts";
  const said = nothingPlanned([...skipped, { goal: "facts", why: "no facts" }], wanted);
  assert.match(said, /^no brief could be planned: tutorial — too few steps; facts — no facts; changelog — /);
});
