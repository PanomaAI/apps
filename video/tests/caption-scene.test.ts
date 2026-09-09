import "@panoma/video-engine/register";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { FORMATS, type Brief } from "@panoma/video-core";
import type { SessionLog } from "@panoma/video-capture";
import { tutorialPlan, tutorialShots } from "@panoma/video-render/timing";

const { createElement } = createRequire(new URL("../apps/render/package.json", import.meta.url))("react");

const words = [
  { text: "Open", start: 0, end: 0.5 },
  { text: "the", start: 0.5, end: 1 },
  { text: "project.", start: 1, end: 1.5 },
];

const textsOf = (html: string) => [...html.replace(/<style[\s\S]*?<\/style>/g, "").matchAll(/>([^<>]+)</g)].map((match) => match[1].trim()).filter(Boolean);

test("a caption has identical layout at every word's arrival and holds between them", async () => {
  const { KineticCaptions } = await import("../apps/render/src/lib/captions.tsx");
  const { renderFrameHtml } = await import("@panoma/video-engine");
  const element = createElement(KineticCaptions, { words, size: 72 });
  const frames = [0, 2, 14, 15, 17, 29, 30, 32, 44];
  const html = frames.map((frame) => renderFrameHtml(element, { frame, fps: 30, durationInFrames: 60, format: FORMATS.h }));
  const layout = (frame: string) => frame.replace(/\b(?:color|opacity):[^;\"]+;?/g, "");
  for (const frame of html) {
    assert.deepEqual(textsOf(frame), words.map((word) => word.text), "the entire caption is present from its first frame");
    assert.ok(!frame.includes("transform:"), "no word scales or moves when it is spoken");
    assert.equal(layout(frame), layout(html[0]), "only highlight properties change");
  }
  assert.notEqual(html[0], html[3], "the highlight still follows the second spoken word");
  assert.notEqual(html[3], html[6], "the highlight still follows the third spoken word");
});

test("tutorial titles, hook and close own their frame; captions accompany only the product", async () => {
  const { Tutorial } = await import("../apps/render/src/recipes/Tutorial.tsx");
  const { renderFrameHtml } = await import("@panoma/video-engine");
  const hook = { id: "h", text: { en: "Find your project" } };
  const brief: Brief = {
    id: "caption-scene", recipe: "Tutorial", session: "s", langs: ["en"], bpm: 120, fps: 30, hooks: [hook],
    lines: [
      { id: "open", mark: "open", label: { en: "Project" }, text: { en: "Open the project." } },
      { id: "read", mark: "read", label: { en: "Bridge" }, text: { en: "Read the bridge output." } },
      { id: "end", text: { en: "Keep exploring" } },
    ],
  };
  const session: SessionLog = {
    name: "s", take: "desktop", recordedAt: "2026-09-05T00:00:00Z", url: "", video: "s.desktop.webm",
    viewport: { width: 1440, height: 900 }, durationMs: 18000, readyMs: 1000, fps: 25, isMobile: false,
    marks: [{ name: "open", t: 2000 }, { name: "read", t: 9000 }],
    events: [{ kind: "click", t: 2400, x: 700, y: 400 }, { kind: "click", t: 9600, x: 800, y: 400 }],
  };
  const plan = tutorialPlan(session, brief, hook, "en");
  const shots = tutorialShots(session, brief, plan, FORMATS.h);
  const second = plan.steps[1];
  const voice = [
    { text: "VOICE-HOOK", start: 0, end: plan.hookFrames / 30 },
    { text: "VOICE-STEP", start: second.from / 30, end: second.to / 30 },
    { text: "VOICE-END", start: plan.outroFrom / 30, end: plan.durationInFrames / 30 },
  ];
  const originalVoice = JSON.stringify(voice);
  for (const voiced of [undefined, { words: voice }]) {
    const element = createElement(Tutorial, { brief, hook, lang: "en", format: FORMATS.h, session, plan, shots, voiced });
    const textAt = (frame: number) => textsOf(renderFrameHtml(element, { frame, fps: 30, durationInFrames: plan.durationInFrames, format: FORMATS.h }));
    for (const frame of [second.from, second.from + 15, second.cardTo - 1]) {
      assert.deepEqual(textAt(frame), ["Bridge"], `title frame ${frame} contains only its step name`);
    }
    assert.deepEqual(textAt(plan.hookFrames - 1), ["Find", "your", "project"], "the hook has no duplicate narration");
    assert.deepEqual(textAt(plan.durationInFrames - 1), ["Keep", "exploring"], "the closing card has no duplicate narration");
    const product = textAt(second.cardTo);
    assert.ok(!product.includes("Bridge"), "the title leaves as the product arrives");
    assert.ok(product.includes(voiced ? "VOICE-STEP" : "Read the bridge output."), "caption returns on the product's first frame");
  }
  assert.equal(JSON.stringify(voice), originalVoice, "display gating does not alter narration or subtitle timestamps");
});
