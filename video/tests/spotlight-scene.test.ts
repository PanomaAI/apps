/*
  What the spotlight puts on screen, read from the HTML of real frames: only words the
  brief wrote, the interface answered with, or the brand carries. A recipe that drew
  "PRODUCT / INTERFACE" or a numeral of its own once passed every other check, because
  no other check reads the frame. This one does, through the same renderFrameHtml the
  rasterizer paints.
*/
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import "@panoma/video-engine/register";
import type { Brief } from "@panoma/video-core";

const brief: Brief = {
  id: "s",
  recipe: "FeatureSpotlight",
  langs: ["en"],
  bpm: 120,
  fps: 30,
  session: "s",
  hooks: [{ id: "kicker", mode: "type", text: { en: "Acme v1.2.0" } }],
  lines: [
    { id: "claim-1", mark: "open", mode: "type", text: { en: "More places to open it" } },
    { id: "claim-2", mark: "share", mode: "type", text: { en: "Bridge" }, result: { en: "Power on, step by step" } },
    { id: "end", mode: "type", text: { en: "https://acme.example" } },
  ],
};

const session = {
  name: "s",
  take: "desktop",
  recordedAt: "2026-09-02T00:00:00Z",
  isMobile: false,
  fps: 25,
  url: "http://x/",
  viewport: { width: 1920, height: 1080 },
  video: "s.desktop.webm",
  durationMs: 10_000,
  readyMs: 1000,
  marks: [{ name: "open", t: 2000 }, { name: "share", t: 5000 }],
  frames: [
    { id: "s.desktop.open", mark: "open", t: 2000, file: "frames/open.png", url: "http://x/", viewport: { width: 1920, height: 1080 }, pixelRatio: 2 },
    { id: "s.desktop.share", mark: "share", t: 5000, file: "frames/share.png", url: "http://x/", viewport: { width: 1920, height: 1080 }, pixelRatio: 2 },
  ],
  last: { id: "s.desktop.__last", mark: "__last", t: 9800, file: "frames/last.png", url: "http://x/bridge", viewport: { width: 1920, height: 1080 }, pixelRatio: 2 },
  macros: [
    { id: "s.desktop.open", mark: "open", t: 2000, file: "macro/open.png", url: "http://x/", viewport: { width: 1920, height: 1080 }, box: { x: 1453, y: 236, width: 197, height: 61 }, target: { x: 1607, y: 250, width: 30, height: 34 }, pixelRatio: 8, change: { box: { x: 1392, y: 290, width: 246, height: 404 }, share: 0.006, boxShare: 0.048 }, after: { file: "macro/open.after.png", box: { x: 1392, y: 236, width: 258, height: 458 }, pixelRatio: 5 }, afterControl: { file: "macro/open.control.png", pixelRatio: 8 } },
    { id: "s.desktop.share", mark: "share", t: 5000, file: "macro/share.png", url: "http://x/", viewport: { width: 1920, height: 1080 }, box: { x: 0, y: 116, width: 241, height: 120 }, target: { x: 16, y: 153, width: 195, height: 46 }, pixelRatio: 8, change: { box: { x: 32, y: 108, width: 1616, height: 940 }, share: 0.034, boxShare: 0.73 }, focus: { x: 280, y: 96, width: 700, height: 44 }, afterControl: { file: "macro/share.control.png", pixelRatio: 8 } },
  ],
  events: [
    { t: 2400, kind: "click", x: 1622, y: 267, role: "product" },
    { t: 5200, kind: "click", x: 100, y: 176, role: "product" },
  ],
};

/** Text nodes of a frame, as the words the type components split them into. */
function textsOf(html: string): string[] {
  const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'");
  return [...html.replace(/<style[\s\S]*?<\/style>/g, "").matchAll(/>([^<>]+)</g)].map((m) => decode(m[1]).trim()).filter(Boolean);
}

test("every word on a spotlight's screen comes from the brief, the interface's answer or the brand", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-spotlight-"));
  try {
    await writeFile(join(dir, "s.desktop.session.json"), JSON.stringify(session));
    await writeFile(join(dir, "s.desktop.webm"), "");
    const { buildCompositions } = await import("@panoma/video-render/compositions");
    const { renderFrameHtml } = await import("@panoma/video-engine");
    const { spotlightPlan } = await import("@panoma/video-render/timing");
    const { FORMATS } = await import("@panoma/video-core");
    const matrix = buildCompositions([brief], { assets: dir, sessions: dir, generated: dir, sfx: dir });
    const comp = matrix.compositions.find((c) => c.id === "s--kicker--en--h");
    assert.ok(comp, "the horizontal cut is built");
    const plan = spotlightPlan(session as never, brief, FORMATS.h);
    const units = plan.sections.filter((s): s is Extract<typeof s, { kind: "unit" }> => s.kind === "unit");
    const cards = plan.sections.filter((s): s is Extract<typeof s, { kind: "card" }> => s.kind === "card");
    const kicker = plan.sections.find((s) => s.kind === "kicker")!;
    const end = plan.sections.find((s) => s.kind === "end")!;

    const allowed = new Set<string>();
    const address = "https://acme.example";
    for (const s of ["Acme v1.2.0", "More places to open it", "Bridge", "Power on, step by step", address]) {
      allowed.add(s);
      for (const w of s.split(/\s+/)) allowed.add(w);
    }
    const fine = (t: string) => allowed.has(t) || address.startsWith(t) || t === "_";

    const frames = [
      10,
      kicker.from + 30,
      ...cards.map((c) => c.from + 30),
      ...units.flatMap((u) => [u.from + 10, u.press, u.result + 20, u.rest + 12, u.to - 2]),
      end.from + 40,
    ];
    const element = comp.element();
    const seen = new Map<number, string[]>();
    for (const frame of frames) {
      const html = renderFrameHtml(element, { frame, fps: 30, durationInFrames: comp.durationInFrames, format: FORMATS.h });
      const texts = textsOf(html);
      seen.set(frame, texts);
      for (const t of texts) assert.ok(fine(t), `frame ${frame} shows "${t}", which nobody wrote`);
    }
    /* And what must be there, is: the name under the kicker, each claim on its own card, the answer under the claim it belongs to, the address at the end. */
    assert.ok(seen.get(kicker.from + 30)!.includes("Acme") && seen.get(kicker.from + 30)!.includes("v1.2.0"), "the kicker names the product");
    assert.ok(seen.get(cards[0].from + 30)!.includes("More") && seen.get(cards[0].from + 30)!.includes("places"), "the first claim is its own card");
    assert.ok(seen.get(cards[1].from + 30)!.includes("Bridge") && seen.get(cards[1].from + 30)!.includes("Power on, step by step"), "the second claim and the interface's answer");
    assert.ok(seen.get(end.from + 40)!.some((t) => t === address), "the address closes the piece");
    /*
      ONE THING ON SCREEN AT A TIME, asserted where it is easiest to lose: not a word is
      written over a use. The claim used to be typed across the last bar of the shot it
      named, with the interface's answer on a chip beside it, so the frame carried a
      control being pressed and two lines of type about it at once.
    */
    for (const u of units) {
      for (const frame of [u.from + 10, u.press, u.result + 20, u.rest + 12, u.to - 2]) {
        assert.deepEqual(seen.get(frame), [], `frame ${frame} writes over use ${u.index}`);
      }
    }
    /* And the claim reaches every format: a card is the whole stage, so there is no layout left to drop it out of. */
    for (const format of [FORMATS.h, FORMATS.v, FORMATS.s]) {
      const here = spotlightPlan(session as never, brief, format);
      const second = here.sections.filter((x): x is Extract<typeof x, { kind: "card" }> => x.kind === "card")[1];
      const html = renderFrameHtml(element, { frame: second.from + 30, fps: 30, durationInFrames: comp.durationInFrames, format });
      const texts = textsOf(html);
      assert.ok(texts.includes("Bridge"), `${format.id} shows the claim`);
      assert.ok(texts.includes("Power on, step by step"), `${format.id} shows the interface's answer`);
    }
    assert.deepEqual(matrix.plans.get(comp.id)?.cards.map((c) => c.text), ["kicker", "claim", "claim", "end"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
