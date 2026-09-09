/*
  The checks that read the plan rather than the pixels: a number in a chip is a claim,
  and a caption nobody can read is a line the plan can shorten. Each failing check
  names who fixes it, so the agent reading the report never loops blindly.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Brief, FactSheet } from "@panoma/video-core";
import type { SessionLog } from "@panoma/video-capture";
import { storyChecks, CPS_MAX, CPS_WARN } from "@panoma/video-director";

const sheet: FactSheet = {
  project: "acme",
  extractedAt: "2026-09-01T00:00:00Z",
  facts: [{ id: "pkg.name", kind: "text", value: "acme", source: "package.json#name" }],
  notFacts: [],
};

const tutorial: Brief = {
  id: "acme-start",
  recipe: "Tutorial",
  langs: ["en"],
  bpm: 120,
  fps: 30,
  hooks: [{ id: "hook", text: { en: "This is {{fact:pkg.name}} running." } }],
  lines: [
    { id: "step-hero", mark: "hero", text: { en: "Install it with one command." }, label: { en: "Install" } },
    { id: "cta", text: { en: "{{fact:pkg.name}}" } },
  ],
};

const byId = (checks: ReturnType<typeof storyChecks>, id: string) => checks.find((c) => c.id === id);

test("a digit in a chip fails story.claims with the plan as the fixer", () => {
  const chip: Brief = { ...tutorial, lines: [{ ...tutorial.lines[0], label: { en: "Python 3.12" } }, tutorial.lines[1]] };
  const claims = byId(storyChecks({ brief: chip, facts: sheet }), "story.claims")!;
  assert.equal(claims.status, "fail");
  assert.equal(claims.fix?.by, "plan");
  assert.match(claims.summary, /Claims to fix: 1$/, "the count closes the sentence");
  assert.equal(byId(storyChecks({ brief: tutorial, facts: sheet }), "story.claims")?.status, "pass");
});

test("story.captions warns on a phrase over the reading limit, and only when a voice produced words", () => {
  const none = storyChecks({ brief: tutorial, facts: sheet });
  assert.equal(byId(none, "story.captions"), undefined, "a type-only piece has no captions to read");
  const fine = storyChecks({ brief: tutorial, facts: sheet, captions: [{ text: "Install it with one command.", chars: 28, seconds: 2, cps: 14 }] });
  assert.equal(byId(fine, "story.captions")?.status, "pass");
  const fast = storyChecks({ brief: tutorial, facts: sheet, captions: [{ text: "Install it with one command and open the catalog.", chars: 49, seconds: 2, cps: 24.5 }] });
  const check = byId(fast, "story.captions")!;
  assert.equal(check.status, "warn");
  assert.equal(check.fix?.by, "plan");
  assert.equal(check.fix?.tool, "panoma_video_plan");
  assert.match(check.summary, /phrases over the limit: 1 of 1$/);
  assert.ok(CPS_WARN < CPS_MAX);
  /* A third of the phrases a little over the warning line is the second trigger. */
  const many = storyChecks({ brief: tutorial, facts: sheet, captions: [
    { text: "a", chars: 18, seconds: 1, cps: 18 },
    { text: "b", chars: 18, seconds: 1, cps: 18 },
    { text: "c", chars: 10, seconds: 1, cps: 10 },
  ] });
  assert.equal(byId(many, "story.captions")?.status, "warn");
});

test("structural proof checks never certify a legacy recording's video/event clock", () => {
  const take: SessionLog = { name: "demo", take: "desktop", recordedAt: "2026-09-06", url: "http://fixture.test", isMobile: false,
    viewport: { width: 960, height: 540 }, video: "demo.desktop.webm", durationMs: 5000, readyMs: 500, fps: 25,
    marks: [{ name: "hero", t: 1000 }], events: [{ kind: "click", t: 1200, x: 100, y: 100 }] };
  const brief = { ...tutorial, session: "demo" };
  const checks = (takes: SessionLog[]) => storyChecks({ brief, facts: sheet, takes });
  const legacy = byId(checks([take]), "recording.clock")!;
  assert.equal(legacy.status, "warn");
  assert.equal(legacy.fix?.by, "record");
  assert.match(legacy.summary, /desktop/);
  const measured: SessionLog = { ...take, videoClock: { source: "screencast", version: 1, originMs: 1788678000000, offsetMs: -924 } };
  assert.equal(byId(checks([measured]), "recording.clock")?.status, "pass");
  assert.equal(byId(checks([measured, { ...take, take: "mobile" }]), "recording.clock")?.status, "warn");
  assert.equal(byId(checks([{ ...measured, videoClock: { ...measured.videoClock!, originMs: NaN } }]), "recording.clock")?.status, "warn");
  assert.equal(byId(checks([{ ...measured, videoClock: { ...measured.videoClock!, offsetMs: Infinity } }]), "recording.clock")?.status, "warn");
  assert.equal(byId(checks([{ ...take, name: "unused" }]), "recording.clock"), undefined);
  assert.equal(byId(storyChecks({ brief: { ...brief, recipe: "FeatureSpotlight" }, facts: sheet, takes: [take] }), "recording.clock"), undefined,
    "still-image compositions do not seek video time");
  assert.equal(byId(storyChecks({ brief: { ...brief, recipe: "ScreenDemo" }, facts: sheet, takes: [take] }), "recording.clock"), undefined);
});
