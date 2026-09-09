/*
  Who each film is for.

  The goals answer "what is there to show"; a job answers "who is this shown to, and
  where does it go". The assertions below are the ones that matter when a campaign goes
  wrong quietly: a job whose material is missing must be SKIPPED WITH ITS UNLOCK rather
  than absent, a canonical brief id must never change (it is the directory name of every
  file that piece owns), and a number that came from the field's folklore rather than
  from this disk must say so.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { JOBS, JOB_OF, STOP_CHANGE_LEAST, planCampaign, type Goal, type Press } from "@panoma/video-core";

const pressed: Press[] = [
  { mark: "cta", afterControl: true, changeShare: 0.122 },
  { mark: "quiet", afterControl: true, changeShare: 0.04 },
];

test("every goal a project earns is carried by a job, and the job names its canvases", () => {
  const goals: Goal[] = ["promo", "trailer", "spotlight", "tutorial"];
  const { make } = planCampaign({ goals, presses: pressed });
  assert.deepEqual(make.filter((j) => j.goal).map((j) => `${j.goal}:${j.job}`), ["promo:sell", "trailer:announce", "spotlight:prove", "tutorial:teach"]);
  assert.deepEqual(JOBS.sell.formats, ["v", "h"]);
  /* A proof film is never square: there is no square feed that rewards a 24-second demo. */
  assert.deepEqual(JOBS.prove.formats, ["h", "v"]);
  assert.deepEqual(JOBS.stop.formats, ["v"]);
});

test("the feed cut is offered from the strongest press, and named with what it changed", () => {
  const { make } = planCampaign({ goals: ["spotlight"], presses: pressed });
  const stop = make.find((j) => j.job === "stop");
  assert.ok(stop, "a press that changes 12% of the viewport earns no stop cut");
  assert.ok(stop.why.includes("cta") && stop.why.includes("12.2%"), `the reason does not name the press: ${stop.why}`);
  assert.equal(stop.goal, undefined, "the stop cut has a brief of its own, not a goal's");
});

test("a press too small to read is refused by its own number, not silently dropped", () => {
  const { make, skip } = planCampaign({ goals: ["spotlight"], presses: [{ mark: "cta", afterControl: true, changeShare: STOP_CHANGE_LEAST / 2 }] });
  assert.ok(!make.some((j) => j.job === "stop"));
  const why = skip.find((s) => s.job === "stop")!.unlock;
  assert.ok(why.includes("2%"), `the unlock does not say how much a press must change: ${why}`);
});

test("a press the capture never caught at macro scale unlocks nothing", () => {
  const { make } = planCampaign({ goals: ["spotlight"], presses: [{ mark: "cta", afterControl: false, changeShare: 0.4 }] });
  assert.ok(!make.some((j) => j.job === "stop"), "a stop cut was offered with no after-state of the control to cut to");
});

test("with no spotlight there is no feed cut, and the unlock says which piece it is cut from", () => {
  const { make, skip } = planCampaign({ goals: ["sitetour"], presses: pressed });
  assert.ok(!make.some((j) => j.job === "stop"));
  assert.match(skip.find((s) => s.job === "stop")!.unlock, /spotlight/);
});

test("every job this product has not earned names what would unlock it", () => {
  const { make, skip } = planCampaign({ goals: ["trailer", "spotlight", "tutorial"], presses: pressed });
  const covered = new Set([...make.map((j) => j.job), ...skip.map((j) => j.job)]);
  for (const name of Object.keys(JOBS)) assert.ok(covered.has(name as never), `the job "${name}" is neither made nor refused`);
  for (const entry of skip) assert.ok(entry.unlock.length > 30, `"${entry.job}" is refused without saying what would unlock it`);
});

test("a number the field's folklore supplied says hypothesis, and one this disk measured says measured", () => {
  assert.equal(JOBS.stop.evidence, "hypothesis");
  assert.equal(JOBS.loop.evidence, "hypothesis");
  assert.equal(JOBS.prove.evidence, "measured");
  /* And a job carrying a length must carry the evidence for that length. */
  for (const job of Object.values(JOBS)) {
    if (job.seconds) assert.ok(job.evidence, `${job.name} states a length with no evidence tag`);
  }
});

test("every goal maps to a job: a piece with no audience would render and be posted nowhere", () => {
  const goals: Goal[] = ["promo", "trailer", "spotlight", "tutorial", "sitetour", "changelog", "facts"];
  for (const goal of goals) assert.ok(JOB_OF[goal], `the goal "${goal}" serves no job`);
});
