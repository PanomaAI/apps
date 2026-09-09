import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import "@panoma/video-engine/register";
import { FORMATS, stage, type Brief } from "@panoma/video-core";
import { cameraAt, castFrame, promoPlan, promoShots, promoSourceAt, type PromoProof, type TakeWithAssets } from "@panoma/video-render/timing";
import { cursorAtMs, cursorPathOf } from "@panoma/video-render/motion";

const brief: Brief = {
  id: "promo", recipe: "ProductPromo", job: "sell", langs: ["en"], bpm: 120, fps: 30, session: "promo",
  hooks: [{ id: "promise", mode: "type", text: { en: "Pick up where you stopped" } }],
  lines: [
    { id: "resume", mark: "resume", mode: "type", text: { en: "Your project, ready again" } },
    { id: "bridge", mark: "bridge", mode: "type", text: { en: "Your notes travel with you" } },
    { id: "brand", mode: "type", text: { en: "Acme" } },
    { id: "end", mode: "type", text: { en: "Bring your next project" } },
  ],
  promo: { opening: "promise", pace: "crisp", evidence: { resume: { mark: "resume", facts: ["ui.resume"] }, bridge: { mark: "bridge", facts: ["ui.bridge"] } } },
};

const session: TakeWithAssets = {
  viewport: { width: 1920, height: 1080 }, durationMs: 19000, readyMs: 1000, fps: 25, videoRatio: 2,
  marks: [{ name: "resume", t: 2000 }, { name: "unselected", t: 8000 }, { name: "bridge", t: 10000 }],
  events: [
    { kind: "click", t: 2200, x: 155, y: 170, role: "chrome" },
    { kind: "move", t: 2300, x: 410, y: 350 },
    { kind: "click", t: 2570, x: 420, y: 360 },
    { kind: "click", t: 8500, x: 960, y: 700 },
    { kind: "scroll", t: 10200, y: 600, durationMs: 1500 },
    { kind: "move", t: 11700, x: 800, y: 420 },
    { kind: "click", t: 11800, x: 800, y: 420 },
    { kind: "scroll", t: 13900, y: 800, durationMs: 700 },
  ],
  macros: [
    { mark: "resume", file: "resume.png", pixelRatio: 8, box: { x: 390, y: 330, width: 90, height: 60 }, target: { x: 400, y: 340, width: 50, height: 40 }, focus: { x: 420, y: 360, width: 1, height: 2 }, change: { box: { x: 20, y: 30, width: 1880, height: 1020 }, share: 0.4, boxShare: 0.92 }, resultAtMs: 3400 },
    { mark: "bridge", file: "bridge.png", pixelRatio: 8, at: "press", box: { x: 740, y: 380, width: 140, height: 90 }, change: { box: { x: 450, y: 220, width: 1020, height: 560 }, share: 0.13, boxShare: 0.28 }, resultAtMs: 14900 },
  ],
};

const phone: TakeWithAssets = (() => {
  const sx = 390 / session.viewport.width;
  const sy = 844 / session.viewport.height;
  const box = (value: { x: number; y: number; width: number; height: number }) => ({ x: value.x * sx, y: value.y * sy, width: value.width * sx, height: value.height * sy });
  return {
    ...session, isMobile: true, viewport: { width: 390, height: 844 },
    events: session.events.map((e) => e.kind === "click" || e.kind === "move" ? { ...e, x: e.x * sx, y: e.y * sy } : e),
    macros: session.macros!.map((m) => ({ ...m, box: box(m.box), ...(m.target ? { target: box(m.target) } : {}), ...(m.focus ? { focus: box(m.focus) } : {}), ...(m.change ? { change: { ...m.change, box: box(m.change.box) } } : {}) })),
  };
})();

const proofsOf = (plan: ReturnType<typeof promoPlan>): PromoProof[] => plan.sections.filter((s) => s.kind === "proof");

test("promo follows the recorded action and ready time, with beat cuts and frame-accurate presses", () => {
  const plan = promoPlan(session, brief, brief.hooks[0], "en");
  const [first, second] = proofsOf(plan);
  assert.ok(first.from <= 90, "the opening gives way to product within three seconds");
  assert.equal(first.sourceFrom, 2.02, "only the idle head before the first product click is trimmed");
  assert.equal(first.sourceTo, 4.6, "the take supplies one conformed second after its measured ready time");
  assert.equal(first.resultSource, 3.4);
  assert.deepEqual(first.resultBox, session.macros![0].change!.box, "hidden focus cannot replace the measured wide result");
  assert.equal(second.sourceFrom, 10.2, "a pre-press scroll crossing the trim stays complete");
  assert.ok(second.sourceTo >= 14.6, "a later post-press gesture is never cut off");
  assert.ok(second.to - second.from > first.to - first.from, "a longer transaction has a longer proof");
  assert.equal(first.presses.length, 1, "chrome and unselected segments earn no press");
  assert.equal(first.presses[0].frame, first.from + Math.round((2.57 - first.sourceFrom) / 1.2 * 30));
  assert.notEqual(first.presses[0].frame % 15, 0, "the actual click is not bent onto a music beat");
  for (const s of plan.sections) {
    assert.equal(s.from % 15, 0);
    assert.equal(s.to % 15, 0);
  }
  for (const proof of [first, second]) {
    for (let frame = proof.from; frame < proof.holdFrom - 2; frame++) {
      assert.ok(Math.abs(promoSourceAt(plan, session, frame + 1, 30) - promoSourceAt(plan, session, frame, 30) - 1 / 25) < 1e-8, `frame ${frame} advances exactly one recorded frame`);
    }
    const pointer = cursorAtMs(cursorPathOf(session, 30), session, 30, promoSourceAt(plan, session, proof.presses[0].frame, 30) * 1000);
    assert.ok(Math.hypot(pointer.x - proof.presses[0].x, pointer.y - proof.presses[0].y) < 2, "the pointer reaches the same true press as picture and sound");
  }
});

test("legacy logs preserve their unknown wait, while recorded results trim only idle tails", () => {
  const legacy = { ...session, macros: session.macros!.map(({ resultAtMs: _, ...m }) => m) };
  const old = proofsOf(promoPlan(legacy, brief, brief.hooks[0], "en"));
  const current = proofsOf(promoPlan(session, brief, brief.hooks[0], "en"));
  assert.equal(old[0].resultSource, 7.85, "physical next mark bounds the source, not the next selected benefit");
  assert.equal(old[1].resultSource, 18.85);
  assert.ok(old[0].to - old[0].from > current[0].to - current[0].from);
  const delayed = { ...session, events: [...session.events, { kind: "click" as const, t: 6000, x: 900, y: 500 }] };
  const proof = proofsOf(promoPlan(delayed, brief, brief.hooks[0], "en"))[0];
  assert.equal(proof.presses.length, 2);
  assert.ok(proof.sourceTo > 6, "a late real action survives a stale earlier result measurement");
});

test("promo supports one to three benefits, selected order, duplicate omission and a silent result opening", () => {
  const one = { ...brief, lines: brief.lines.filter((l) => l.id !== "bridge") };
  assert.equal(proofsOf(promoPlan(session, one, one.hooks[0], "en")).length, 1);
  const reordered = { ...brief, lines: [brief.lines[1], brief.lines[0], ...brief.lines.slice(2)] };
  assert.deepEqual(proofsOf(promoPlan(session, reordered, brief.hooks[0], "en")).map((p) => p.mark), ["bridge", "resume"]);
  const three = { ...brief, lines: [...brief.lines.slice(0, 2), { id: "extra", mark: "unselected", mode: "type" as const, text: { en: "One more real result" } }, ...brief.lines.slice(2)] };
  assert.equal(proofsOf(promoPlan(session, three, brief.hooks[0], "en")).length, 3);
  const measured = { ...brief, promo: { ...brief.promo!, pace: "measured" as const } };
  assert.ok(promoPlan(session, measured, brief.hooks[0], "en").durationInFrames > promoPlan(session, brief, brief.hooks[0], "en").durationInFrames, "pace changes reading time rather than accelerating interactions");
  const duplicate = { ...one, hooks: [{ ...one.hooks[0], text: { en: "Your project, ready again!" } }] };
  assert.equal(promoPlan(session, duplicate, duplicate.hooks[0], "en").sections.filter((s) => s.kind === "benefit").length, 0);
  const result = { ...brief, promo: { ...brief.promo!, opening: "result" as const } };
  const plan = promoPlan(session, result, result.hooks[0], "en");
  assert.equal(plan.sections[0].kind, "preview");
  assert.equal(plan.sections[1].kind, "hook");
  const preview = plan.sections[0];
  assert.equal(preview.to, 30);
  if (preview.kind === "preview") assert.equal(preview.sourceFrom, 3.4);
  const longHook = { ...brief.hooks[0], text: { en: "This opening needs far too many words to fit into a short readable promise" } };
  assert.throws(() => promoPlan(session, brief, longHook, "en"), /shorter copy/);
});

test("promo cameras arrive in at most 420 ms, hold without pumping, and never exceed source density", () => {
  const plan = promoPlan(session, brief, brief.hooks[0], "en");
  for (const format of Object.values(FORMATS)) {
    for (const source of [session, phone]) for (const videoRatio of [0.5, 1, 2]) {
      const take = { ...source, videoRatio };
      const here = promoPlan(take, brief, brief.hooks[0], "en");
      const shots = promoShots(take, brief, here, format);
      for (const shot of shots) if (JSON.stringify(shot.start) !== JSON.stringify(shot.end)) assert.ok(shot.to - shot.from <= Math.floor(30 * 0.42));
      const win = castFrame(format, take.viewport, { isMobile: take.isMobile });
      for (let frame = 0; frame < plan.durationInFrames; frame++) {
        const camera = cameraAt(shots, frame, 15);
        assert.ok(win.content.width * camera.framing.scale <= take.viewport.width * videoRatio + 1e-7, `${format.id}/${videoRatio}: density at ${frame}`);
      }
      for (const proof of proofsOf(here)) {
        const inside = shots.filter((s) => s.from >= proof.from && s.to <= proof.to);
        for (let i = 1; i < inside.length; i++) {
          assert.equal(inside[i - 1].to, inside[i].from);
          assert.deepEqual(inside[i - 1].end, inside[i].start, "each arrival starts at the previous camera position");
        }
        const rest = inside.at(-1)!;
        assert.deepEqual(rest.start, rest.end, "reading does not pump with the bed");
      }
      assert.equal(cameraAt(shots, proofsOf(here)[0].to - 1, 15).framing.scale, Math.min(1, take.viewport.width * videoRatio / win.content.width), "the wide page result releases the obsolete click crop");
    }
  }
});

const textsOf = (html: string) => [...html.replace(/<style[\s\S]*?<\/style>/g, "").matchAll(/>([^<>]+)</g)].map((m) => m[1].trim()).filter(Boolean);

test("brand-only h/v matrices render a readable identity close across themes without an empty CTA or altered proof clock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-promo-brand-close-"));
  try {
    for (const take of ["desktop", "mobile"]) {
      await writeFile(join(dir, `promo.${take}.session.json`), JSON.stringify({ ...(take === "mobile" ? phone : session), name: "promo", take, recordedAt: "2026-09-05", isMobile: take === "mobile", url: "", video: `promo.${take}.webm` }));
      await writeFile(join(dir, `promo.${take}.webm`), "");
    }
    const { buildCompositions } = await import("@panoma/video-render/compositions");
    const { renderFrameHtml } = await import("@panoma/video-engine");
    const close = { kind: "brand" as const, fact: "pkg.name", source: "package.json#name", reason: "no-public-destination" as const };
    for (const theme of ["flat", "vibrant", "block", "grid"] as const) {
      const here: Brief = { ...brief, lines: brief.lines.filter((line) => line.id !== "end"), promo: { ...brief.promo!, theme, close } };
      const matrix = buildCompositions([here], { sessions: dir, assets: dir, generated: dir, sfx: dir });
      assert.equal(matrix.compositions.length, 2);
      for (const comp of matrix.compositions) {
        const rendered = matrix.plans.get(comp.id)!;
        const end = rendered.cards.find((card) => card.id === "end")!;
        assert.deepEqual(rendered.promoClose, close);
        assert.equal(end.text, "Acme");
        assert.equal(end.to, comp.durationInFrames);
        assert.ok((end.to - (end.readFrom ?? end.from)) / 30 >= 1.8);
        const html = renderFrameHtml(comp.element(), { frame: end.to - 1, fps: 30, format: comp.format, durationInFrames: comp.durationInFrames });
        assert.deepEqual(textsOf(html), ["Acme"]);
        assert.doesNotMatch(html, /data-promo-cta|data-cta-destination|\.webm|https?:\/\//);
      }
      const before = promoPlan(session, { ...brief, promo: { ...brief.promo!, theme } }, brief.hooks[0], "en");
      const after = promoPlan(session, here, here.hooks[0], "en");
      assert.deepEqual(proofsOf(after), proofsOf(before), "removing a destination cannot retime recorded demonstrations");
      assert.throws(() => promoPlan(session, { ...here, lines: brief.lines }, here.hooks[0], "en"), /closing lines/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("animated editorial type is declared for encoded review and split chapters keep their action boundaries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-promo-effects-plan-"));
  try {
    for (const take of ["desktop", "mobile"]) {
      await writeFile(join(dir, `promo.${take}.session.json`), JSON.stringify({ ...(take === "mobile" ? phone : session), name: "promo", take, recordedAt: "2026-09-05", isMobile: take === "mobile", url: "", video: `promo.${take}.webm` }));
      await writeFile(join(dir, `promo.${take}.webm`), "");
    }
    const here: Brief = { ...brief, lines: [...brief.lines, { id: "source", mode: "type", text: { en: "npx acme" } }],
      promo: { ...brief.promo!, treatments: { resume: "split", bridge: "split" }, recap: true, inserts: [{ kind: "terminal", line: "source", after: "bridge" }] } };
    const { buildCompositions } = await import("@panoma/video-render/compositions");
    const matrix = buildCompositions([here], { sessions: dir, assets: dir, generated: dir, sfx: dir });
    for (const plan of matrix.plans.values()) {
      const second = plan.uses![1];
      assert.equal(second.from % plan.beats.beatFrames, 0, "the real source edit remains on a beat");
      assert.ok(plan.marks?.some((mark) => mark.frame === second.from), "a feature change remains a named chapter");
      assert.ok(!plan.cuts.some((cut) => cut.frame === second.from), "the same split composition does not promise a change of ground");
      assert.ok(plan.cards.some((card) => card.id === "source" && card.from < plan.texts!.find((text) => text.id === "source")!.readFrom!), "typing is authored type from its first frame, not black/missing footage");
      const recap = plan.cards.find((card) => card.id === "recap")!;
      assert.ok(plan.texts!.filter((text) => text.kind === "recap").every((text) => text.from >= recap.from && text.to <= recap.to), "the holds between progressive rows belong to the type scene");
      assert.equal(plan.texts?.filter((text) => text.kind === "split").length, 2);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("rendered promo frames isolate whole safe-area cards from live proof, and preview carries no cursor", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-promo-"));
  try {
    for (const take of ["desktop", "mobile"]) {
      await writeFile(join(dir, `promo.${take}.session.json`), JSON.stringify({ ...(take === "mobile" ? phone : session), name: "promo", take, recordedAt: "2026-09-05T00:00:00Z", isMobile: take === "mobile", url: "http://localhost:4000", video: `promo.${take}.webm` }));
      await writeFile(join(dir, `promo.${take}.webm`), "");
    }
    const { buildCompositions } = await import("@panoma/video-render/compositions");
    const { renderFrameHtml } = await import("@panoma/video-engine");
    for (const opening of ["promise", "result"] as const) {
      const current = { ...brief, promo: { ...brief.promo!, opening } };
      const matrix = buildCompositions([current], { sessions: dir, assets: dir, generated: dir, sfx: dir });
      assert.equal(matrix.compositions.length, 2);
      assert.equal(matrix.words.size, 0, "a selling promo has no voice track");
      for (const comp of matrix.compositions) {
        const plan = promoPlan(session, current, current.hooks[0], "en");
        const renderPlan = matrix.plans.get(comp.id)!;
        assert.equal(renderPlan.uses?.length, 2);
        assert.deepEqual(renderPlan.uses?.map((u) => u.evidence), [["ui.resume"], ["ui.bridge"]]);
        assert.ok(renderPlan.cuts.every((cut) => cut.frame % 15 === 0));
        const close = plan.sections.at(-1)!;
        assert.ok(!renderPlan.cuts.some((cut) => cut.frame === close.from), "the payoff and close share a ground, so a text change is not called a picture cut");
        for (const s of plan.sections) {
          for (const frame of [s.from, Math.floor((s.from + s.to) / 2), s.to - 1]) {
            const html = renderFrameHtml(comp.element(), { frame, fps: 30, format: comp.format, durationInFrames: comp.durationInFrames });
            if (s.kind === "proof" || s.kind === "preview") {
              assert.deepEqual(textsOf(html), [], "the product has the frame to itself");
              assert.match(html, /promo\.(desktop|mobile)\.webm/, "proof is live recorded footage");
              if (s.kind === "preview") assert.doesNotMatch(html, /<div[^>]*border-radius:50%/, "a result preview does not fabricate a click or pointer");
            } else {
              assert.deepEqual(textsOf(html), s.kind === "end" ? s.text.split("\n") : [s.text], "every word arrives together at the cut and stays put");
              assert.doesNotMatch(html, /\.webm/, "cards do not hide moving footage underneath them");
              const safe = stage(comp.format);
              assert.ok(html.includes(`left:${safe.x}px`) && html.includes(`width:${safe.width}px`), "the type uses the format's safe stage");
            }
          }
        }
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the closing destination stays complete on one line inside every safe stage", async () => {
  const { createElement } = createRequire(new URL("../apps/render/package.json", import.meta.url))("react");
  const { ProductPromo } = await import("../apps/render/src/recipes/ProductPromo.tsx");
  const { renderFrameHtml, startAssetServer } = await import("@panoma/video-engine");
  const { chromium } = createRequire(new URL("../packages/engine/package.json", import.meta.url))("playwright");
  const server = await startAssetServer({ assets: tmpdir() });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const format of Object.values(FORMATS)) {
      const page = await browser.newPage({ viewport: { width: format.width, height: format.height } });
      await page.goto(`${server.origin}/__shell__?w=${format.width}&h=${format.height}`);
      await page.evaluate(async () => { await document.fonts.load('500 100px "Geist"'); await document.fonts.ready; });
      for (const destination of ["https://panoma.ai", "https://example.com/product/documents"]) {
        const here = { ...brief, lines: brief.lines.map((line) => line.id === "end" ? { ...line, text: { en: destination } } : line) };
        const plan = promoPlan(session, here, here.hooks[0], "en");
        const element = createElement(ProductPromo, { brief: here, hook: here.hooks[0], lang: "en", format, session: session as never, plan, shots: promoShots(session, here, plan, format) });
        const html = renderFrameHtml(element, { frame: plan.sections.at(-1)!.from, fps: 30, durationInFrames: plan.durationInFrames, format });
        await page.evaluate((html: string) => { document.body.innerHTML = html; }, html);
        const rects = await page.evaluate((destination: string) => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) if (node.textContent === destination) {
            const range = document.createRange();
            range.selectNodeContents(node);
            return [...range.getClientRects()].map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
          }
          return [];
        }, destination);
        const safe = stage(format);
        assert.equal(rects.length, 1, `${format.id}: the domain must not strand its suffix on a second line`);
        assert.ok(rects[0].left >= safe.x && rects[0].right <= safe.x + safe.width, `${format.id}: the whole address fits horizontally`);
        assert.ok(rects[0].top >= safe.y && rects[0].bottom <= safe.y + safe.height, `${format.id}: the address clears platform overlays`);
        assert.ok(html.includes(destination), "the source URL is neither shortened nor rewritten");
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
});

test("Spanish promo hooks and benefits keep every word whole and every line inside the stage", async () => {
  const { createElement } = createRequire(new URL("../apps/render/package.json", import.meta.url))("react");
  const { chromium } = createRequire(new URL("../packages/engine/package.json", import.meta.url))("playwright");
  const { ProductPromo } = await import("../apps/render/src/recipes/ProductPromo.tsx");
  const { renderFrameHtml, startAssetServer } = await import("@panoma/video-engine");
  const copy = [
    "Todos tus proyectos, en un solo lugar",
    "El catálogo de todo lo que construiste",
    "Encuentra cada proyecto local en un catálogo.",
    "Muestra proyectos con trabajo sin respaldar.",
  ];
  const server = await startAssetServer({ assets: tmpdir() });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const format of Object.values(FORMATS)) {
      const page = await browser.newPage({ viewport: { width: format.width, height: format.height } });
      await page.goto(`${server.origin}/__shell__?w=${format.width}&h=${format.height}`);
      await page.evaluate(async () => { await document.fonts.load('800 100px "Geist"'); await document.fonts.ready; });
      for (const [index, text] of copy.entries()) {
        const here = { ...brief, hooks: [{ ...brief.hooks[0], text: { en: index < 2 ? text : "See what changes" } }], lines: brief.lines.map((line, i) => i === 0 && index >= 2 ? { ...line, text: { en: text } } : line) };
        const plan = promoPlan(session, here, here.hooks[0], "en");
        const section = plan.sections.find((s) => s.kind === (index < 2 ? "hook" : "benefit"))!;
        const element = createElement(ProductPromo, { brief: here, hook: here.hooks[0], lang: "en", format, session: session as never, plan, shots: promoShots(session, here, plan, format) });
        const html = renderFrameHtml(element, { frame: section.from, fps: 30, durationInFrames: plan.durationInFrames, format });
        await page.evaluate((html: string) => { document.body.innerHTML = html; }, html);
        const words = await page.evaluate((text: string) => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) if (node.textContent === text) {
            return [...text.matchAll(/\S+/g)].map((match) => {
              const range = document.createRange();
              range.setStart(node!, match.index!);
              range.setEnd(node!, match.index! + match[0].length);
              return { text: match[0], rects: [...range.getClientRects()].map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })) };
            });
          }
          return [];
        }, text);
        assert.equal(words.map((word: { text: string }) => word.text).join(" "), text, "the entire authored copy is present");
        const safe = stage(format);
        for (const word of words) {
          assert.equal(word.rects.length, 1, `${format.id}: ${word.text} must not split between lines`);
          const r = word.rects[0];
          assert.ok(r.left >= safe.x && r.right <= safe.x + safe.width && r.top >= safe.y && r.bottom <= safe.y + safe.height, `${format.id}: ${word.text} stays within the safe stage`);
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
});
