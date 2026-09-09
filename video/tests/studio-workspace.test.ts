import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import "@panoma/video-engine/register";
import type { SessionLog } from "@panoma/video-capture";
import type { FactSheet } from "@panoma/video-core";
import { LIGHT_PALETTE } from "@panoma/video-core/theme";
import { DEFAULT_DIRECTION, type Direction } from "@panoma/video-brand/direction";
import { planPromo, type PromoForInput } from "../packages/director/src/promo.ts";
import { studioWorkspace } from "../packages/director/src/studio.ts";
import { openWorkspace, writeJson } from "../packages/director/src/workspace.ts";
import { normalizeCreationRequest } from "../packages/director/src/creation-settings.ts";

/** A real on-disk workspace; only media bytes are inert because these checks compile frames. */
async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-studio-workspace-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "product");
  const home = join(dir, "panoma-video");
  await mkdir(root);
  const ws = await openWorkspace(root, { home, id: "studio-fixture" });
  const facts: FactSheet = { project: "Acme", extractedAt: "2026-09-05T00:00:00Z", notFacts: [], facts: [
    { id: "pkg.name", kind: "text", value: "Acme", source: "package.json#name" },
    { id: "url", kind: "url", value: "https://acme.example", source: "package.json#homepage" },
  ] };
  const input: PromoForInput = {
    profile: { root, id: ws.id, name: "Acme", kind: "web-app", commands: [], routes: [], docs: [], logoFiles: [], facts },
    facts, langs: ["en", "es"], takes: [],
    tour: { name: ws.id, url: "http://127.0.0.1:5173/", createdAt: facts.extractedAt, snapshot: "", candidates: [],
      steps: [{ goto: "http://127.0.0.1:5173/" }, { mark: "notes" }, { clickOn: "text=Notes" }, { mark: "context" }, { clickOn: "text=Context" }],
      marks: [{ name: "notes", kind: "cta", label: "Notes", outcome: { heading: "Project notes", route: "/notes" } },
        { name: "context", kind: "flow", label: "Context", outcome: { heading: "Saved context", route: "/context" } }],
      flow: { title: "Acme", steps: [] }, pages: [], edges: [],
    },
  };
  const take = (name: string): SessionLog => {
    const viewport = name === "mobile" ? { width: 540, height: 960 } : { width: 960, height: 540 };
    return {
      name: ws.id, take: name, isMobile: name === "mobile", recordedAt: facts.extractedAt,
      url: input.tour!.url, video: `${ws.id}.${name}.webm`, viewport, videoRatio: 2,
      durationMs: 8000, readyMs: 500, fps: 25,
      marks: [{ name: "notes", t: 1000 }, { name: "context", t: 4500 }],
      events: [{ kind: "click", role: "product", t: 1400, x: 100, y: 100 }, { kind: "click", role: "product", t: 4800, x: 100, y: 100 }],
      macros: ["notes", "context"].map((mark, i) => ({ id: mark, mark, file: `macro/${name}-${mark}.png`, t: i ? 4500 : 1000, url: input.tour!.url,
        viewport, box: { x: 70, y: 80, width: 200, height: 80 }, pixelRatio: 4, resultAtMs: i ? 5300 : 2000,
        resultHeading: { text: i ? "Saved context" : "Project notes", box: { x: 90, y: 110, width: 250, height: 32 }, visibleShare: 1, centerVisible: true },
        change: { box: { x: 70, y: 100, width: 400, height: 250 }, share: i ? 0.2 : 0.3, boxShare: 0.7 },
      })),
    };
  };
  input.takes = [take("desktop"), take("mobile")];
  await mkdir(join(ws.paths.sessions, "macro"));
  for (const take of input.takes) {
    await writeFile(join(ws.paths.sessions, take.video), "recorded video fixture");
    for (const macro of take.macros!) await writeFile(join(ws.paths.sessions, macro.file), "captured macro fixture");
    await writeJson(join(ws.paths.sessions, `${take.name}.${take.take}.session.json`), take);
  }
  const planned = planPromo(input);
  assert.ok(planned.brief);
  const brief = { ...planned.brief, hooks: planned.brief.hooks.map(hook => ({ ...hook,
    text: structuredClone(planned.brief!.lines.find(line => line.mark)!.text),
  })) };
  await writeJson(ws.paths.profile, input.profile);
  await writeJson(ws.paths.facts, planned.facts);
  await writeJson(join(ws.paths.tours, `${ws.id}.json`), input.tour);
  await writeJson(join(ws.paths.briefs, `${brief.id}.json`), { ...brief, origin: "template", goal: "promo" });
  await writeJson(join(ws.dir, "promo.json"), planned.decision);
  return { root, home, ws, brief, input };
}

test("opening a saved house direction uses the current light palette while retaining the edit and source record", async t => {
  const { home, ws, input } = await fixture(t);
  const saved: Direction = {
    ...structuredClone(DEFAULT_DIRECTION),
    scheme: "dark", signal: "chromatic", name: "plain", seed: 718,
    stage: { hex: "#0a0a0a", from: "default", why: "the previous house paper" },
    ink: { hex: "#fafafa", from: "default", why: "the previous house ink" },
    accent: { hex: "#d2bd7f", from: "default", why: "the previous house accent" },
    sound: { style: "pulse", key: "D minor", bpm: 100 },
  };
  await writeJson(ws.paths.direction, { direction: saved });
  const stored = await readFile(ws.paths.direction, "utf8");
  const studio = await studioWorkspace(ws.id, home, { prepareAudio: false });
  const current = studio.dirs.direction!;
  assert.equal(current.scheme, "light");
  assert.equal(current.stage.hex, LIGHT_PALETTE.paper);
  assert.equal(current.ink.hex, LIGHT_PALETTE.ink);
  assert.equal(current.accent.hex, LIGHT_PALETTE.accent);
  for (const key of ["name", "seed", "motion", "sound", "furniture", "fonts"] as const) assert.deepEqual(current[key], saved[key]);
  assert.deepEqual(studio.takes, input.takes);
  assert.equal(studio.matrix.compositions.length, 4);
  assert.equal(await readFile(ws.paths.direction, "utf8"), stored, "opening a preview must not rewrite the saved decision");
});

test("Studio applies a saved scene revision to every real format matrix while preserving other copy and recording clocks", async t => {
  const { root, home, ws, brief, input } = await fixture(t);
  const studio = await studioWorkspace(ws.id, home);
  assert.equal(studio.matrix.compositions.length, 4);
  assert.equal(studio.matrix.mismatched.size, 0);
  const initial = await studio.document(brief.id);
  const revised = await studio.revise(brief.id, { expectedRevision: initial.revision,
    edits: [{ kind: "text", sceneId: "benefit-1", lang: "es", text: "Las notas acompañan al proyecto." }],
  }, "none");
  const expected = structuredClone(brief);
  expected.lines.find(line => line.id === "benefit-1")!.text.es = "Las notas acompañan al proyecto.";
  assert.deepEqual(revised.brief, expected);
  const reloaded = await studioWorkspace(ws.id, home);
  assert.deepEqual(reloaded.raw[0], expected);
  assert.deepEqual(reloaded.takes, input.takes);
  assert.notEqual(reloaded.fingerprint, studio.fingerprint);
  assert.equal((await reloaded.document(brief.id)).revision, revised.revision);
  const { renderFrameHtml } = await import("@panoma/video-engine");
  for (const comp of reloaded.matrix.compositions) {
    const before = studio.matrix.plans.get(comp.id)!;
    const after = reloaded.matrix.plans.get(comp.id)!;
    assert.deepEqual(after.uses?.map(use => use.mark), before.uses?.map(use => use.mark));
    const card = [...after.cards, ...(after.texts ?? [])].find(card => card.id === "benefit-1")!;
    const html = renderFrameHtml(comp.element(), { frame: Math.min(card.to - 1, card.from + 20), fps: comp.fps, format: comp.format, durationInFrames: comp.durationInFrames });
    if (comp.id.includes("--es--")) {
      assert.equal(card.text, "Las notas acompañan al proyecto.");
      assert.match(html, /Las notas acompañan al proyecto/);
    } else {
      assert.deepEqual(after, before);
      assert.doesNotMatch(html, /Las notas acompañan/);
    }
  }
  const journal = JSON.parse(await readFile(join(ws.dir, "promo-revisions", `${brief.id}.json`), "utf8"));
  assert.equal(journal.revisions.at(-1).revision, revised.revision);
  const storedBrief = JSON.parse(await readFile(join(ws.paths.briefs, `${brief.id}.json`), "utf8"));
  assert.equal(storedBrief.lines[0].text.es, brief.lines[0].text.es, "the separate journal, rather than a browser-only draft or overwritten baseline, supplies the edit");
  assert.deepEqual(await readdir(root), [], "opening and editing leave the filmed project untouched");
});

test("Studio refuses an unsupported claim before committing and keeps the prior version renderable", async t => {
  const { home, ws, brief } = await fixture(t);
  const studio = await studioWorkspace(ws.id, home);
  const original = await studio.document(brief.id);
  await assert.rejects(studio.revise(brief.id, { expectedRevision: original.revision,
    edits: [{ kind: "text", sceneId: "benefit-1", lang: "es", text: "Ahorra 20 minutos." }],
  }, "none"), /20|fact|claim|digit|number/);
  const reloaded = await studioWorkspace(ws.id, home);
  assert.equal((await reloaded.document(brief.id)).revision, original.revision);
  assert.deepEqual(reloaded.raw, studio.raw);
  assert.equal(reloaded.matrix.compositions.length, 4);
});

test("reordering proofs requires explicit matching hooks and reaches h/v with one selected theme", async t => {
  const { home, ws, brief } = await fixture(t);
  const studio = await studioWorkspace(ws.id, home);
  const original = await studio.document(brief.id);
  await assert.rejects(studio.revise(brief.id, { expectedRevision: original.revision,
    edits: [{ kind: "order", sceneIds: ["benefit-2", "benefit-1"] }],
  }, "none"), /not bound to this proof/);
  const revised = await studio.revise(brief.id, { expectedRevision: original.revision, edits: [
    { kind: "order", sceneIds: ["benefit-2", "benefit-1"] },
    { kind: "text", sceneId: "hook-1", lang: "en", text: "Context accompanies your project." },
    { kind: "text", sceneId: "hook-1", lang: "es", text: "El contexto acompaña al proyecto." },
    { kind: "theme", value: "grid" },
  ] }, "none");
  const reloaded = await studioWorkspace(ws.id, home);
  assert.equal((await reloaded.document(brief.id)).settings.theme, "grid");
  assert.deepEqual(revised.brief.promo!.evidence["hook-1"], revised.brief.promo!.evidence["benefit-2"]);
  for (const comp of reloaded.matrix.compositions) {
    const plan = reloaded.matrix.plans.get(comp.id)!;
    assert.deepEqual(plan.uses!.map(use => use.id), ["benefit-2", "benefit-1"]);
    assert.equal(plan.editorialTheme, "grid");
  }
});

test("Studio cannot approve a revision when a missing mobile take is merely substituted in the matrix", async t => {
  const { home, ws, brief } = await fixture(t);
  await rm(join(ws.paths.sessions, `${ws.id}.mobile.session.json`));
  const studio = await studioWorkspace(ws.id, home);
  assert.equal(studio.matrix.compositions.length, 4);
  assert.equal(studio.matrix.mismatched.size, 2);
  const original = await studio.document(brief.id);
  await assert.rejects(studio.revise(brief.id, { expectedRevision: original.revision,
    edits: [{ kind: "theme", value: "grid" }],
  }, "none"), /horizontal|vertical|mobile|recording|matching/i);
  assert.equal((await studio.document(brief.id)).revision, original.revision);
});

test("the Studio export fingerprint changes with quoted macro pixels even before a revision exists", async t => {
  const { home, ws, input } = await fixture(t);
  const studio = await studioWorkspace(ws.id, home);
  await writeFile(join(ws.paths.sessions, input.takes[0].macros![0].file), "different source control pixels");
  const changed = await studioWorkspace(ws.id, home);
  assert.notEqual(changed.fingerprint, studio.fingerprint);
});

/* The check itself lives in `openWorkspace` and has its own suite; this proves that opening a saved workspace still reaches it. */
test("opening a saved workspace refuses one inside the filmed project before creating any new output", async t => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-studio-boundary-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "product");
  const home = join(root, "panoma-video-output");
  const workspace = join(home, "projects", "inside-product");
  await mkdir(workspace, { recursive: true });
  const facts = { project: "Acme", extractedAt: "2026-09-05T00:00:00Z", facts: [], notFacts: [] };
  await writeJson(join(workspace, "profile.json"), { root, id: "inside-product", name: "Acme", kind: "web-app", commands: [], routes: [], docs: [], logoFiles: [], facts });
  await writeJson(join(workspace, "facts.json"), facts);
  const before = await readdir(root, { recursive: true });
  await assert.rejects(studioWorkspace("inside-product", home), /outside|filmed project|workspace|PANOMA_VIDEO_HOME/i);
  assert.deepEqual(await readdir(root, { recursive: true }), before);
});

test("an old loaded preview cannot export a newer revision under the old pixels", async t => {
  const { home, ws, brief } = await fixture(t);
  const old = await studioWorkspace(ws.id, home);
  const initial = await old.document(brief.id);
  await old.revise(brief.id, { expectedRevision: initial.revision, edits: [{ kind: "theme", value: "grid" }] }, "none");
  let progress = 0;
  await assert.rejects(old.render(old.matrix.compositions[0]!.id, () => { progress++; }), /changed after.*loaded|Refresh the studio/);
  assert.equal(progress, 0, "stale input is rejected before the renderer starts");
  assert.deepEqual(await readdir(ws.paths.renders), [], "no mislabeled output or partial export was written");
});

test("repairing a missing interaction sound remounts it immediately even when every music bed already exists", async t => {
  const { home, ws } = await fixture(t);
  const first = await studioWorkspace(ws.id, home);
  const click = join(ws.paths.sfx, "click.wav");
  assert.ok(first.matrix.compositions.every(comp => comp.audio.some(clip => clip.path === click)));
  await rm(click);
  const repaired = await studioWorkspace(ws.id, home);
  assert.ok(repaired.matrix.compositions.every(comp => comp.audio.some(clip => clip.path === click)), "the returned matrix must include the sound that this load repaired");
  assert.ok((await readFile(click)).length > 44);
  const next = await studioWorkspace(ws.id, home);
  assert.equal(next.fingerprint, repaired.fingerprint, "audio repair must not make the next load reject this preview as stale");
});

test("a configured production compiles only its selected brief and formats and preserves that scope after revisions", async t => {
  const { root, home, ws, brief } = await fixture(t);
  await writeJson(join(ws.paths.briefs, "unselected.json"), { id: "unselected", recipe: "UnavailableRecipe" });
  await writeJson(join(ws.dir, "creation.json"), { version: 1, createdAt: "2026-09-06T00:00:00Z",
    settings: normalizeCreationRequest({ root, langs: ["es", "en"], formats: ["v"], voice: "none" }),
    selection: { briefIds: [brief.id], recipe: "ProductPromo", why: "Requested promotion", formats: ["v"], langs: ["es", "en"], voice: "none" },
  });
  const studio = await studioWorkspace(ws.id, home);
  assert.deepEqual(studio.raw.map(brief => brief.id), [brief.id], "an unselected unavailable recipe cannot break the requested video");
  assert.equal(studio.matrix.compositions.length, 2);
  assert.ok(studio.matrix.compositions.every(comp => comp.id.endsWith("--v")));
  const doc = await studio.document(brief.id);
  assert.equal(doc.argumentScope, "original-plan");
  await studio.revise(brief.id, { expectedRevision: doc.revision, edits: [{ kind: "theme", value: "block" }, { kind: "pace", value: "measured" }, { kind: "recap", value: true }] }, "none");
  const next = await studioWorkspace(ws.id, home);
  assert.equal((await next.document(brief.id)).settings.theme, "block");
  assert.equal((await next.document(brief.id)).settings.pace, "measured");
  assert.equal((await next.document(brief.id)).settings.recap, true);
  assert.deepEqual(next.matrix.compositions.map(comp => comp.id), studio.matrix.compositions.map(comp => comp.id));
  await assert.rejects(next.render(`${brief.id}--hook-1--es--h`, () => {}), /Unknown composition/);
});

test("a configured production cannot reopen as silent when its selected narration is absent", async t => {
  const { root, home, ws, brief } = await fixture(t);
  await writeJson(join(ws.paths.briefs, `${brief.id}.json`), { ...brief, recipe: "Tutorial", voice: "missing-voice-assets", promo: undefined });
  await writeJson(join(ws.dir, "creation.json"), { version: 1, createdAt: "2026-09-06T00:00:00Z",
    settings: normalizeCreationRequest({ root, purpose: "tutorial", voice: "on", langs: ["es", "en"] }),
    selection: { briefIds: [brief.id], recipe: "Tutorial", why: "Requested tutorial", formats: ["v"], langs: ["es", "en"], voice: "on" },
  });
  await assert.rejects(studioWorkspace(ws.id, home), /narration is not mounted/);
});

test("the original argument informs limited assessment only while the leading proof and its facts still match", async t => {
  const { home, ws, brief } = await fixture(t);
  const decision = JSON.parse(await readFile(join(ws.dir, "promo.json"), "utf8"));
  const first = decision.selected[0];
  const argument = { situation: "A maker reviewing notes for a project", desiredOutcome: "See the selected project's notes", proof: first.id, facts: first.facts,
    whyThisProof: "The selected action reveals the project's notes.", limits: "This recording does not establish collaboration or note editing." };
  await writeJson(join(ws.dir, "promo.json"), { ...decision, argument });
  const studio = await studioWorkspace(ws.id, home);
  const document = await studio.document(brief.id);
  assert.equal(document.editorial.issues.some(issue => issue.code === "missing-argument"), false);
  await studio.revise(brief.id, { expectedRevision: document.revision, edits: [
    { kind: "order", sceneIds: ["benefit-2", "benefit-1"] },
    { kind: "text", sceneId: "hook-1", lang: "en", text: "Context accompanies your project." },
    { kind: "text", sceneId: "hook-1", lang: "es", text: "El contexto acompaña al proyecto." },
  ] }, "none");
  const changed = await (await studioWorkspace(ws.id, home)).document(brief.id);
  assert.equal(changed.editorial.issues.some(issue => issue.code === "missing-argument"), true);
  assert.deepEqual(changed.originalArgument, argument, "the original remains available with its original-plan scope, without validating the new lead");
});
