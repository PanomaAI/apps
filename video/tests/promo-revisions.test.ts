import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { Brain } from "@panoma/video-brain";
import type { SessionLog } from "@panoma/video-capture";
import type { FactSheet } from "@panoma/video-core";
import { openWorkspace } from "../packages/director/src/workspace.ts";
import { planPromo, type PromoForInput } from "../packages/director/src/promo.ts";
import { applySavedPromoRevision, archivePromoRevisions, readPromoRevision, revisePromo, type PromoEdit, type PromoRevisionContext } from "../packages/director/src/promo-revisions.ts";

async function fixture(t: TestContext, brandOnly = false) {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-promo-revision-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "product");
  await mkdir(root);
  const ws = await openWorkspace(root, { home: join(dir, "panoma-video"), id: "revision-fixture" });
  const facts: FactSheet = { project: "Acme", extractedAt: "2026-09-05T00:00:00Z", notFacts: [], facts: [
    { id: "pkg.name", kind: "text", value: "Acme", source: "package.json#name" },
    ...(!brandOnly ? [{ id: "url", kind: "url" as const, value: "https://acme.example", source: "package.json#homepage" }] : []),
  ] };
  const input: PromoForInput = {
    profile: { root, id: ws.id, name: "Acme", kind: "web-app", commands: [], routes: [], docs: [], logoFiles: [], facts },
    facts, langs: ["en", "es"],
    tour: { name: ws.id, url: "http://127.0.0.1:5173/", createdAt: facts.extractedAt, snapshot: "", candidates: [],
      steps: [{ goto: "http://127.0.0.1:5173/" }, { mark: "notes" }, { clickOn: "text=Notes" }, { mark: "context" }, { clickOn: "text=Context" }],
      marks: [{ name: "notes", kind: "cta", label: "Notes", outcome: { heading: "Project notes", route: "/notes" } },
        { name: "context", kind: "flow", label: "Context", outcome: { heading: "Saved context", route: "/context" } }],
      flow: { title: "Acme", steps: [] }, pages: [], edges: [],
    },
    takes: [],
  };
  const take = (name: string): SessionLog => ({
    name: ws.id, take: name, isMobile: name === "mobile", recordedAt: facts.extractedAt,
    url: input.tour!.url, video: `${ws.id}.${name}.webm`, viewport: { width: 960, height: 540 },
    durationMs: 8000, readyMs: 500, fps: 25,
    marks: [{ name: "notes", t: 1000 }, { name: "context", t: 4500 }],
    events: [{ kind: "click", role: "product", t: 1400, x: 100, y: 100 }, { kind: "click", role: "product", t: 4800, x: 100, y: 100 }],
    macros: ["notes", "context"].map((mark, i) => ({ id: mark, mark, file: `macro/${name}-${mark}.png`, t: i ? 4500 : 1000, url: input.tour!.url,
      viewport: { width: 960, height: 540 }, box: { x: 70, y: 80, width: 200, height: 80 }, pixelRatio: 4,
      resultHeading: { text: i ? "Saved context" : "Project notes", box: { x: 90, y: 110, width: 250, height: 32 }, visibleShare: 1, centerVisible: true },
      change: { box: { x: 80, y: 100, width: 600, height: 250 }, share: i ? 0.2 : 0.3, boxShare: 0.7 },
    })),
  });
  input.takes = [take("desktop"), take("mobile")];
  await mkdir(join(ws.paths.sessions, "macro"));
  for (const take of input.takes) {
    await writeFile(join(ws.paths.sessions, take.video), "recorded video fixture");
    for (const macro of take.macros!) await writeFile(join(ws.paths.sessions, macro.file), "captured macro fixture");
  }
  const result = planPromo(input);
  assert.ok(result.brief);
  const brief = { ...result.brief, hooks: result.brief.hooks.map((hook) => ({ ...hook, text: structuredClone(result.brief!.lines.find((line) => line.mark)!.text) })) };
  const context: PromoRevisionContext = { brief, input, sourceKey: "recording:fixture-capture" };
  const path = join(ws.dir, "promo-revisions", `${context.brief.id}.json`);
  const initial = await readPromoRevision(ws, context);
  return { dir, ws, context, initial, path };
}

test("opening Studio is read-only and exposes exact source and expanded copy with real relative capture paths", async (t) => {
  const { ws, context, initial } = await fixture(t);
  assert.equal(initial.number, 0);
  assert.deepEqual(initial.brief, context.brief);
  assert.ok(initial.scenes.find((scene) => scene.kind === "proof")!.facts.length);
  assert.match(initial.scenes[0].text.en, /\{\{fact:/);
  assert.doesNotMatch(initial.scenes[0].expandedText.en, /\{\{/);
  assert.deepEqual(initial.scenes.filter((scene) => !scene.editable).map((scene) => scene.kind), ["brand", "destination"]);
  assert.ok(!(await readdir(ws.dir)).includes("promo-revisions"));
  assert.deepEqual(await readdir(ws.root), []);
});

test("brand-only revisions preserve the exact close and legacy URL journals remain unchanged", async (t) => {
  const { ws, context, initial } = await fixture(t, true);
  assert.deepEqual(initial.scenes.filter((scene) => !scene.editable).map((scene) => scene.kind), ["brand"]);
  const revised = await revisePromo(ws, context, { expectedRevision: initial.revision,
    edits: [{ kind: "text", sceneId: "benefit-1", lang: "es", text: "Las notas acompañan al proyecto." }] });
  assert.deepEqual(revised.brief.promo?.close, initial.brief.promo?.close);
  assert.deepEqual((await readPromoRevision(ws, context)).brief, revised.brief);
  assert.ok(!revised.brief.lines.some((line) => line.id === "end"));

  const old = await fixture(t);
  const { close: _, ...legacyPromo } = old.context.brief.promo!;
  const legacyContext = { ...old.context, brief: { ...old.context.brief, promo: legacyPromo } };
  const legacy = await readPromoRevision(old.ws, legacyContext);
  const edited = await revisePromo(old.ws, legacyContext, { expectedRevision: legacy.revision,
    edits: [{ kind: "text", sceneId: "benefit-1", lang: "es", text: "Las notas acompañan al proyecto." }] });
  assert.equal(edited.brief.promo?.close, undefined, "reading/editing an existing journal does not migrate or relabel its close");
  assert.deepEqual(edited.brief.lines.at(-1), legacyContext.brief.lines.at(-1));
});

test("one language/scene revision survives reload and leaves all unrelated fields exact", async (t) => {
  const { ws, context, initial } = await fixture(t);
  const before = structuredClone(context.brief);
  const document = await revisePromo(ws, context, { expectedRevision: initial.revision,
    edits: [{ kind: "text", sceneId: "benefit-1", lang: "es", text: "Las notas acompañan al proyecto." }] });
  const expected = structuredClone(before);
  expected.lines.find((line) => line.id === "benefit-1")!.text.es = "Las notas acompañan al proyecto.";
  assert.deepEqual(document.brief, expected);
  assert.deepEqual(context.brief, before);
  assert.deepEqual(document.baseBrief, before);
  assert.deepEqual(await applySavedPromoRevision(ws, context), expected);
  assert.equal((await readPromoRevision(ws, { ...context, brief: expected })).revision, document.revision);
  assert.deepEqual(document.history.at(-1)!.changes, ["text:benefit-1:es"]);
});

test("theme, opening, pace, recap and treatments revise together without changing clocks or recordings", async (t) => {
  const { ws, context, initial } = await fixture(t);
  const takes = structuredClone(context.input.takes);
  const document = await revisePromo(ws, context, { expectedRevision: initial.revision, edits: [
    { kind: "theme", value: "block" }, { kind: "opening", value: "result" }, { kind: "pace", value: "crisp" },
    { kind: "recap", value: true }, { kind: "treatment", sceneId: "benefit-1", value: "focus" },
  ] });
  assert.deepEqual(document.settings, { theme: "block", opening: "result", pace: "crisp", recap: true });
  assert.equal(document.brief.promo!.treatments!["benefit-1"], "focus");
  assert.equal(document.brief.bpm, context.brief.bpm);
  assert.equal(document.brief.fps, context.brief.fps);
  assert.deepEqual(document.brief.lines, context.brief.lines);
  assert.deepEqual(context.input.takes, takes);
  const normal = await revisePromo(ws, context, { expectedRevision: document.revision, edits: [{ kind: "theme", value: "normal" }] });
  assert.equal(normal.settings.theme, "flat");
});

test("proof order cannot smuggle an old hook onto unrelated evidence; an atomic hook edit makes the reorder explicit", async (t) => {
  const { ws, context, initial } = await fixture(t);
  const order: PromoEdit = { kind: "order", sceneIds: ["benefit-2", "benefit-1"] };
  await assert.rejects(revisePromo(ws, context, { expectedRevision: initial.revision, edits: [order] }), /not bound to this proof/);
  const edited = await revisePromo(ws, context, { expectedRevision: initial.revision, edits: [order,
    { kind: "text", sceneId: "hook-1", lang: "en", text: "Context accompanies your project." },
    { kind: "text", sceneId: "hook-1", lang: "es", text: "El contexto acompaña al proyecto." },
  ] });
  assert.deepEqual(edited.brief.lines.filter((line) => line.mark).map((line) => line.id), ["benefit-2", "benefit-1"]);
  assert.deepEqual(edited.brief.promo!.evidence["hook-1"], context.brief.promo!.evidence["benefit-2"]);
  for (const proof of edited.brief.lines.filter((line) => line.mark)) assert.deepEqual(proof, context.brief.lines.find((line) => line.id === proof.id));
});

test("invalid claims, lost languages, unavailable treatments and locked source text are refused without a saved revision", async (t) => {
  const { ws, context, initial, path } = await fixture(t);
  const edits: PromoEdit[][] = [
    [{ kind: "text", sceneId: "benefit-1", lang: "es", text: "Ahorra 20 minutos." }],
    [{ kind: "text", sceneId: "benefit-1", lang: "en", text: "Always secure and effortless." }],
    [{ kind: "text", sceneId: "benefit-1", lang: "en", text: "{{fact:ui.context.result}}" }],
    [{ kind: "text", sceneId: "missing", lang: "es", text: "Las notas acompañan al proyecto." }],
    [{ kind: "text", sceneId: "end", lang: "en", text: "https://invented.example" }],
    [{ kind: "text", sceneId: "brand", lang: "en", text: "Other Product" }],
    [{ kind: "order", sceneIds: ["benefit-1", "benefit-1"] }],
    [{ kind: "pace", value: "crisp" }, { kind: "pace", value: "measured" }],
  ];
  for (const edit of edits) await assert.rejects(revisePromo(ws, context, { expectedRevision: initial.revision, edits: edit }), /./);
  await assert.rejects(readFile(path), { code: "ENOENT" });
  assert.equal((await readPromoRevision(ws, context)).revision, initial.revision);
  const large = structuredClone(context);
  large.input.takes[0].macros![0].change!.box.width = 900;
  large.brief = { ...large.brief, promo: { ...large.brief.promo!, treatments: { ...large.brief.promo!.treatments, "benefit-1": "full" } } };
  const largeInitial = await readPromoRevision(ws, large);
  await assert.rejects(revisePromo(ws, large, { expectedRevision: largeInitial.revision, edits: [{ kind: "treatment", sceneId: "benefit-1", value: "focus" }] }), /not supported|measured/);
});

test("stale expected revisions conflict, and restore appends a version without deleting previous edits", async (t) => {
  const { ws, context, initial } = await fixture(t);
  const first = await revisePromo(ws, context, { expectedRevision: initial.revision, edits: [{ kind: "theme", value: "grid" }] });
  await assert.rejects(revisePromo(ws, context, { expectedRevision: initial.revision, edits: [{ kind: "theme", value: "vibrant" }] }), /Revision changed/);
  const restored = await revisePromo(ws, { ...context, brief: first.brief }, { expectedRevision: first.revision, restoreRevision: initial.revision });
  assert.deepEqual(restored.brief, initial.brief);
  assert.equal(restored.number, 2);
  assert.equal(restored.history[1].revision, first.revision);
  assert.equal(restored.history[2].restoredFrom, initial.revision);
  assert.deepEqual(await applySavedPromoRevision(ws, context), initial.brief);
});

test("all-variant validation failures preserve journal bytes and effective output", async (t) => {
  const { ws, context, initial, path } = await fixture(t);
  const first = await revisePromo(ws, context, { expectedRevision: initial.revision, edits: [{ kind: "theme", value: "grid" }] });
  const bytes = await readFile(path, "utf8");
  let called = false;
  await assert.rejects(revisePromo(ws, context, { expectedRevision: first.revision, edits: [{ kind: "pace", value: "measured" }] }, {
    async validate(brief, facts) { called = true; assert.equal(brief.promo!.pace, "measured"); assert.equal(facts.project, "Acme"); throw new Error("Spanish vertical hook needs more reading time"); },
  }), /Spanish vertical/);
  assert.equal(called, true);
  assert.equal(await readFile(path, "utf8"), bytes);
  assert.deepEqual(await applySavedPromoRevision(ws, context), first.brief);
  assert.ok((await readdir(join(ws.dir, "promo-revisions"))).every((name) => name.endsWith(".json")));
});

test("concurrent writers cannot overwrite a revision being validated", async (t) => {
  const { ws, context, initial } = await fixture(t);
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const first = revisePromo(ws, context, { expectedRevision: initial.revision, edits: [{ kind: "theme", value: "block" }] }, {
    async validate() { enter(); await held; },
  });
  await entered;
  await assert.rejects(revisePromo(ws, context, { expectedRevision: initial.revision, edits: [{ kind: "theme", value: "grid" }] }), /Another revision/);
  release();
  const result = await first;
  assert.equal(result.settings.theme, "block");
  assert.equal((await readPromoRevision(ws, context)).number, 1);
});

test("an interrupted writer with a dead process releases its stale lock without losing history", async (t) => {
  const { ws, context, initial, path } = await fixture(t);
  const first = await revisePromo(ws, context, { expectedRevision: initial.revision, edits: [{ kind: "theme", value: "block" }] });
  await mkdir(`${path}.lock`);
  await writeFile(join(`${path}.lock`, "owner.json"), JSON.stringify({ pid: 2147483647, token: "interrupted-fixture" }));
  const recovered = await revisePromo(ws, context, { expectedRevision: first.revision, edits: [{ kind: "theme", value: "grid" }] });
  assert.equal(recovered.number, 2);
  assert.equal(recovered.history[1].revision, first.revision);
  assert.ok((await readdir(join(ws.dir, "promo-revisions"))).every((name) => name.endsWith(".json")));
});

test("a corrupt journal is reported and never overwritten with a fresh history", async (t) => {
  const { ws, context, initial, path } = await fixture(t);
  await revisePromo(ws, context, { expectedRevision: initial.revision, edits: [{ kind: "theme", value: "block" }] });
  await writeFile(path, "{invalid journal");
  await assert.rejects(revisePromo(ws, context, { expectedRevision: initial.revision, edits: [{ kind: "theme", value: "grid" }] }), /not valid JSON/);
  assert.equal(await readFile(path, "utf8"), "{invalid journal");
});

test("source, facts, take logs, baseline and replaced media cannot silently inherit saved edits", async (t) => {
  const { ws, context, initial } = await fixture(t);
  await revisePromo(ws, context, { expectedRevision: initial.revision, edits: [{ kind: "theme", value: "grid" }] });
  for (const change of ["identity", "facts", "take", "plan"] as const) {
    const changed = structuredClone(context);
    if (change === "identity") changed.sourceKey = "another-project-version";
    if (change === "facts") changed.input.facts = { ...changed.input.facts, facts: changed.input.facts.facts.map((fact) => fact.id === "pkg.name" ? { ...fact, value: "Changed" } : fact) };
    if (change === "take") changed.input.takes[0].recordedAt = "2026-09-06T00:00:00Z";
    if (change === "plan") changed.brief = { ...changed.brief, bpm: 100 };
    await assert.rejects(readPromoRevision(ws, changed), /changed|Replan/);
  }
  await writeFile(join(ws.paths.sessions, context.input.takes[0].video), "different recorded pixels");
  await assert.rejects(applySavedPromoRevision(ws, context), /evidence changed/);
});

test("a take changed during render validation aborts before committing", async (t) => {
  const { ws, context, initial, path } = await fixture(t);
  await assert.rejects(revisePromo(ws, context, { expectedRevision: initial.revision, edits: [{ kind: "theme", value: "block" }] }, {
    async validate() { await writeFile(join(ws.paths.sessions, context.input.takes[1].video), "replacement capture while validation runs"); },
  }), /changed during validation/);
  await assert.rejects(readFile(path), { code: "ENOENT" });
});

test("cancellation during validation leaves the saved revision untouched", async (t) => {
  const { ws, context, initial, path } = await fixture(t);
  const controller = new AbortController();
  await assert.rejects(revisePromo(ws, context, { expectedRevision: initial.revision, edits: [{ kind: "theme", value: "block" }] }, {
    signal: controller.signal, async validate() { controller.abort(); },
  }), /abort/i);
  await assert.rejects(readFile(path), { code: "ENOENT" });
  assert.equal((await readPromoRevision(ws, context)).revision, initial.revision);
});

test("an unedited automatic film retains its previous material contract until a revision exists", async (t) => {
  const { ws, context } = await fixture(t);
  await rm(join(ws.paths.sessions, context.input.takes[0].macros![0].file));
  assert.deepEqual(await applySavedPromoRevision(ws, context), context.brief);
  await assert.rejects(readPromoRevision(ws, context), /missing/);
});

test("explicit new-story recovery archives exact stale history and lets fresh evidence start at its own baseline", async (t) => {
  const { ws, context, initial, path } = await fixture(t);
  const edited = await revisePromo(ws, context, { expectedRevision: initial.revision, edits: [{ kind: "theme", value: "grid" }] });
  const bytes = await readFile(path);
  const changed = { ...context, sourceKey: "recording:new-take" };
  await assert.rejects(readPromoRevision(ws, changed), /evidence changed/);
  const archived = await archivePromoRevisions(ws, context.brief.id, { expectedRevision: edited.revision });
  assert.equal(archived.archived, true);
  assert.equal(archived.revision, edited.revision);
  assert.ok(archived.file!.startsWith(join(await realpath(ws.dir), "promo-revisions", "archive")));
  assert.deepEqual(await readFile(archived.file!), bytes);
  await assert.rejects(readFile(path), { code: "ENOENT" });
  const fresh = await readPromoRevision(ws, changed);
  assert.equal(fresh.number, 0);
  assert.equal(fresh.settings.theme, "flat");
  assert.notEqual(fresh.revision, initial.revision);
  const newer = await revisePromo(ws, changed, { expectedRevision: fresh.revision, edits: [{ kind: "theme", value: "block" }] });
  assert.equal(newer.number, 1);
  assert.deepEqual(await readFile(archived.file!), bytes, "the previous story remains immutable after new revisions");
});

test("new-story archive respects optimistic revision checks, cancellation and active writer locks", async (t) => {
  const { ws, context, initial, path } = await fixture(t);
  const edited = await revisePromo(ws, context, { expectedRevision: initial.revision, edits: [{ kind: "theme", value: "grid" }] });
  const bytes = await readFile(path);
  await assert.rejects(archivePromoRevisions(ws, context.brief.id, { expectedRevision: initial.revision }), /differs from the expected revision/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(archivePromoRevisions(ws, context.brief.id, { signal: controller.signal }), /abort/i);
  await mkdir(`${path}.lock`);
  await writeFile(join(`${path}.lock`, "owner.json"), JSON.stringify({ pid: process.pid, token: "active-writer" }));
  await assert.rejects(archivePromoRevisions(ws, context.brief.id, { expectedRevision: edited.revision }), /Another revision/);
  await rm(`${path}.lock`, { recursive: true });
  assert.deepEqual(await readFile(path), bytes);
});

test("new-story recovery preserves corrupt journals and leaves an absent journal alone", async (t) => {
  const { ws, context, initial, path } = await fixture(t);
  assert.deepEqual(await archivePromoRevisions(ws, context.brief.id), { archived: false });
  await assert.rejects(archivePromoRevisions(ws, context.brief.id, { expectedRevision: initial.revision }), /no longer active/);
  await writeFile(path, "{ interrupted JSON journal");
  const archived = await archivePromoRevisions(ws, context.brief.id);
  assert.equal(archived.invalid, true);
  assert.equal(await readFile(archived.file!, "utf8"), "{ interrupted JSON journal");
  assert.equal((await readPromoRevision(ws, context)).number, 0);
});

test("a new-story archive cannot move history into the filmed project through a symlink", async (t) => {
  const { ws, context, initial, path } = await fixture(t);
  await revisePromo(ws, context, { expectedRevision: initial.revision, edits: [{ kind: "theme", value: "grid" }] });
  const bytes = await readFile(path);
  await symlink(ws.root, join(ws.dir, "promo-revisions", "archive"));
  await assert.rejects(archivePromoRevisions(ws, context.brief.id), /archive must stay inside/);
  assert.deepEqual(await readFile(path), bytes);
  assert.deepEqual(await readdir(ws.root), []);
});

test("natural-language revisions use bounded edits and preserve unrequested scenes; brain absence never silently falls back", async (t) => {
  const { ws, context, initial } = await fixture(t);
  await assert.rejects(revisePromo(ws, context, { expectedRevision: initial.revision, instruction: "Haz más directa la frase de notas en español." }), /enabled brain/);
  const questions: string[] = [];
  const brain: Brain = { driver: "claude", model: "fixture", how: "scripted", ledger() { throw new Error("not used"); }, async ask(question) {
    questions.push(question.user);
    assert.equal(question.id, "promo-revision");
    assert.match(question.system, /Preserve every unrequested scene/);
    return { value: question.shape.parse({ edits: [{ kind: "text", sceneId: "benefit-1", lang: "es", text: "Las notas acompañan al proyecto." }], reason: "Shorten only the requested Spanish benefit." }), hit: false, ms: 0, model: "fixture" };
  } };
  const result = await revisePromo(ws, context, { expectedRevision: initial.revision, instruction: "Haz más directa la frase de notas en español." }, { brain });
  assert.equal(questions.length, 1);
  assert.equal(result.history.at(-1)!.by, "brain");
  assert.equal(result.brief.lines.find((line) => line.id === "benefit-1")!.text.en, context.brief.lines.find((line) => line.id === "benefit-1")!.text.en);
  assert.deepEqual(result.brief.promo, context.brief.promo);
});

test("strict revision contracts refuse ignored fields, unsupported themes and ambiguous operations", async (t) => {
  const { ws, context, initial } = await fixture(t);
  for (const request of [
    { expectedRevision: initial.revision, edits: [{ kind: "theme", value: "glass" }] },
    { expectedRevision: initial.revision, edits: [{ kind: "pace", value: "crisp", speed: 3 }] },
    { expectedRevision: initial.revision, edits: [{ kind: "theme", value: "grid" }], instruction: "Do something" },
    { expectedRevision: initial.revision, edits: [{ kind: "theme", value: "grid" }], facts: [] },
  ]) await assert.rejects(revisePromo(ws, context, request as never), /./);
  assert.equal((await readPromoRevision(ws, context)).number, 0);
});

test("absolute captured paths work only inside the sessions workspace; traversal, symlinks and missing material refuse", async (t) => {
  const { ws, context, dir } = await fixture(t);
  const absolute = structuredClone(context);
  absolute.input.takes[0].video = join(ws.paths.sessions, absolute.input.takes[0].video);
  assert.equal((await readPromoRevision(ws, absolute)).number, 0);
  const outside = join(dir, "outside.webm");
  await writeFile(outside, "external pixels");
  for (const path of [outside, "../../../../outside.webm", "missing.webm"]) {
    const changed = structuredClone(context);
    changed.input.takes[0].video = path;
    await assert.rejects(readPromoRevision(ws, changed), /workspace sessions|missing/);
  }
  await symlink(outside, join(ws.paths.sessions, "linked.webm"));
  const linked = structuredClone(context);
  linked.input.takes[0].video = "linked.webm";
  await assert.rejects(readPromoRevision(ws, linked), /outside the workspace sessions/);
});
