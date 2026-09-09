import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import "@panoma/video-engine/register";
import type { SessionLog } from "@panoma/video-capture";
import { defaultBrand } from "@panoma/video-brand";
import { scoutProject } from "@panoma/video-scout";
import { auto } from "../packages/director/src/auto.ts";
import { TRACK_VERSION, type ScoredTrack } from "../packages/director/src/music.ts";
import { studioWorkspace } from "../packages/director/src/studio.ts";
import { openWorkspace, writeJson } from "../packages/director/src/workspace.ts";

/** Actual auto/scout/Studio wiring over a copied fixture and inert recorded bytes.
    No product is started and no model, capture, encoder or provider is called. */
async function fixture(t: TestContext, options: { langs?: ("en" | "es")[]; music?: boolean; measuredBrand?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-auto-promo-revisions-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const priorBrain = process.env.PANOMA_VIDEO_BRAIN;
  process.env.PANOMA_VIDEO_BRAIN = "none";
  t.after(() => { if (priorBrain === undefined) delete process.env.PANOMA_VIDEO_BRAIN; else process.env.PANOMA_VIDEO_BRAIN = priorBrain; });
  const root = join(dir, "product"), home = join(dir, "outputs");
  await cp(fileURLToPath(new URL("./fixtures/product", import.meta.url)), root, { recursive: true });
  const profile = await scoutProject(root);
  const ws = await openWorkspace(root, { home, id: profile.id });
  if (options.measuredBrand) await writeJson(ws.paths.brand, { ...defaultBrand(), name: "Acme Studio",
    nameEvidence: { value: "Acme Studio", source: 'live-page:meta[name="application-name"]' },
    source: { url: "http://127.0.0.1:5173/", extractedAt: "2026-09-05T00:00:00Z" },
    colors: { ...defaultBrand().colors, primary: { hex: "#2371ab", confidence: "high", origin: "cta" } } });
  const url = "http://127.0.0.1:5173/";
  const tour = { name: ws.id, url, createdAt: "2026-09-05T00:00:00Z", snapshot: "", candidates: [],
    steps: [{ goto: url }, { mark: "catalog" }, { clickOn: "text=Get started" }, { mark: "memory" }, { clickOn: "text=Open catalog" }],
    marks: [{ name: "catalog", kind: "cta", label: "Get started", outcome: { heading: "Your catalog", route: "/start" } },
      { name: "memory", kind: "flow", label: "Open catalog", outcome: { heading: "Project memory", route: "/start" } }],
    pages: [], edges: [], flow: { title: "Acme", steps: [] } };
  await writeJson(join(ws.paths.tours, `${ws.id}.json`), tour);
  await mkdir(join(ws.paths.sessions, "macro"));
  for (const name of ["desktop", "mobile"]) {
    const viewport = name === "mobile" ? { width: 540, height: 960 } : { width: 960, height: 540 };
    const take: SessionLog = { name: ws.id, take: name, isMobile: name === "mobile", recordedAt: tour.createdAt, url,
      video: `${ws.id}.${name}.webm`, viewport, videoRatio: 2, durationMs: 8000, readyMs: 500, fps: 25,
      marks: [{ name: "catalog", t: 1000 }, { name: "memory", t: 4500 }],
      events: [{ kind: "click", role: "product", t: 1400, x: 100, y: 100 }, { kind: "click", role: "product", t: 4800, x: 100, y: 100 }],
      macros: ["catalog", "memory"].map((mark, index) => ({ id: mark, mark, file: `macro/${name}-${mark}.png`, t: index ? 4500 : 1000, url, viewport,
        box: { x: 70, y: 80, width: 200, height: 80 }, pixelRatio: 4, resultAtMs: index ? 5300 : 2000,
        resultHeading: { text: index ? "Project memory" : "Your catalog", box: { x: 90, y: 110, width: 250, height: 32 }, visibleShare: 1, centerVisible: true },
        change: { box: { x: 70, y: 100, width: 400, height: 250 }, share: index ? 0.2 : 0.3, boxShare: 0.7 } })),
    };
    await writeFile(join(ws.paths.sessions, take.video), "recorded video fixture");
    for (const macro of take.macros!) await writeFile(join(ws.paths.sessions, macro.file), "captured macro fixture");
    await writeJson(join(ws.paths.sessions, `${ws.id}.${name}.session.json`), take);
  }
  /* Scoring is cached fixture material: the auto path must compare the conformed
     file, rather than mistaking the original user's filename for a new song. */
  const music: string[] = [];
  if (options.music) for (const name of ["original", "replacement"]) {
    const bytes = `recorded ${name} music fixture`;
    const source = join(dir, `${name}.wav`), file = join(ws.paths.music, `${name}.conformed.wav`), pulse = join(ws.paths.music, `${name}.pulse.json`);
    await writeFile(source, bytes);
    await writeFile(file, "conformed music fixture");
    await writeJson(pulse, { fps: 30, bpm: 120, energy: [0], low: [0], beats: [] });
    const track: ScoredTrack = { version: TRACK_VERSION, source, file, pulse, fps: 30, bpm: 120, beatFrames: 15, measured: 120, ratio: 1, head: 0, seconds: 60 };
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    await writeJson(join(ws.paths.music, `${name}.${hash}.30fps.track.json`), track);
    music.push(source);
  }
  const run = (overrides: Partial<Parameters<typeof auto>[0]> = {}) => auto({ root, home, projectId: ws.id, goal: "promo", until: "plan", camera: false, brain: "none", voice: "none", langs: options.langs ?? ["en", "es"], ...(music[0] ? { music: music[0] } : {}), ...overrides });
  const first = await run();
  assert.equal(first.briefs.length, 1, JSON.stringify(first.skipped));
  const briefFile = first.briefs[0].file;
  const studio = await studioWorkspace(ws.id, home, { prepareAudio: false });
  const initial = await studio.document(first.briefs[0].id);
  const edited = await studio.revise(first.briefs[0].id, { expectedRevision: initial.revision, edits: [
    { kind: "text", sceneId: "benefit-1", lang: "es", text: "Tus proyectos viven en un catálogo." },
    { kind: "theme", value: "grid" },
  ] }, "none");
  const journalFile = join(ws.dir, "promo-revisions", `${initial.briefId}.json`);
  return { root, home, ws, run, briefFile, journalFile, initial, edited, music };
}

test("offline planning retains measured brand identity and colors with their fact witness", async t => {
  const { ws, run } = await fixture(t, { measuredBrand: true });
  const before = JSON.parse(await readFile(ws.paths.brand, "utf8"));
  assert.equal(before.name, "Acme Studio");
  assert.equal(before.colors.primary.hex, "#2371ab");
  const report = await run();
  assert.equal(report.stages.brand.status, "cached");
  assert.deepEqual(JSON.parse(await readFile(ws.paths.brand, "utf8")), before);
  const facts = JSON.parse(await readFile(ws.paths.facts, "utf8"));
  assert.deepEqual(facts.facts.find((fact: { id: string }) => fact.id === "brand.name"), {
    id: "brand.name", kind: "text", value: "Acme Studio", source: 'brand.json#nameEvidence (live-page:meta[name="application-name"])',
  });
});

test("auto retains an edited story across repeated planning without replacing its copy or journal", async t => {
  const { root, home, ws, run, briefFile, journalFile, edited } = await fixture(t);
  const journal = await readFile(journalFile);
  const productBefore = await readFile(join(root, "package.json"));
  for (let attempt = 0; attempt < 2; attempt++) {
    const report = await run();
    assert.equal(report.briefs.length, 1);
    const { goal, origin, ...saved } = JSON.parse(await readFile(briefFile, "utf8"));
    assert.deepEqual(saved, edited.brief);
    assert.deepEqual(await readFile(journalFile), journal);
    const studio = await studioWorkspace(ws.id, home, { prepareAudio: false });
    assert.equal((await studio.document(edited.briefId)).revision, edited.revision);
    assert.equal(studio.matrix.compositions.length, 4);
    assert.ok([...studio.matrix.plans.values()].every(plan => plan.editorialTheme === "grid"));
  }
  assert.deepEqual(await readFile(join(root, "package.json")), productBefore);
});

test("auto retains a Spanish-only story when languages are omitted", async t => {
  const { home, ws, run, briefFile, journalFile, edited } = await fixture(t, { langs: ["es"] });
  const journal = await readFile(journalFile);
  for (const langs of [undefined, ["es"] as const]) {
    const report = await run({ langs: langs ? [...langs] : undefined });
    assert.equal(report.briefs.length, 1);
    const { goal, origin, ...saved } = JSON.parse(await readFile(briefFile, "utf8"));
    assert.deepEqual(saved, edited.brief);
    assert.deepEqual(await readFile(journalFile), journal);
    const studio = await studioWorkspace(ws.id, home, { prepareAudio: false });
    assert.equal((await studio.document(edited.briefId)).revision, edited.revision);
    assert.equal(studio.matrix.compositions.length, 2);
    assert.ok(studio.matrix.compositions.every(comp => comp.id.includes("--es--")));
  }
});

test("saved global settings accept equivalent requests and refuse changed language, dance or music without replacing history", async t => {
  const { ws, run, briefFile, journalFile, edited, music } = await fixture(t, { music: true });
  await run({ langs: ["es", "en"], dance: "off", music: music[0] });
  await run({ langs: undefined, dance: undefined, music: undefined });
  const { goal, origin, ...saved } = JSON.parse(await readFile(briefFile, "utf8"));
  assert.deepEqual(saved, edited.brief);
  const brief = await readFile(briefFile), journal = await readFile(journalFile);
  for (const settings of [{ langs: ["es"] as ("en" | "es")[] }, { dance: "full" as const }, { music: music[1] }, { music: join(ws.dir, "missing.wav") }]) {
    await assert.rejects(run(settings), /saved scene revisions.*different.*--new-story.*archiving/i);
    assert.deepEqual(await readFile(briefFile), brief);
    assert.deepEqual(await readFile(journalFile), journal);
    assert.ok(!(await readdir(join(ws.dir, "promo-revisions"))).includes("archive"));
  }
});

test("lost footage cannot erase a saved story when fresh promo eligibility disappears", async t => {
  const { ws, run, briefFile, journalFile } = await fixture(t);
  const brief = await readFile(briefFile), journal = await readFile(journalFile);
  await rm(join(ws.paths.sessions, `${ws.id}.mobile.webm`));
  await assert.rejects(run(), /matching project|record|evidence|promotion|material|source/i);
  assert.deepEqual(await readFile(briefFile), brief);
  assert.deepEqual(await readFile(journalFile), journal);
  await assert.rejects(run({ newStory: true }), /replacement story.*unavailable/i);
  assert.deepEqual(await readFile(briefFile), brief);
  assert.deepEqual(await readFile(journalFile), journal);
  assert.ok(!(await readdir(join(ws.dir, "promo-revisions"))).includes("archive"));
});

test("explicit new-story recovery validates the replacement and preserves the old journal intact", async t => {
  const { home, ws, run, briefFile, journalFile, initial } = await fixture(t);
  const journal = await readFile(journalFile);
  const changed = JSON.parse(await readFile(join(ws.paths.tours, `${ws.id}.json`), "utf8"));
  changed.marks[0].outcome.heading = "Local project catalog";
  await writeJson(join(ws.paths.tours, `${ws.id}.json`), changed);
  for (const name of ["desktop", "mobile"]) {
    const file = join(ws.paths.sessions, `${ws.id}.${name}.session.json`);
    const take: SessionLog = JSON.parse(await readFile(file, "utf8"));
    take.macros!.find(macro => macro.mark === "catalog")!.resultHeading!.text = "Local project catalog";
    await writeJson(file, take);
  }
  await assert.rejects(run(), /evidence changed|facts.*changed|recorded evidence|Replan/i);
  const report = await run({ newStory: true });
  assert.equal(report.briefs.length, 1);
  assert.equal(await readFile(journalFile).catch(() => null), null);
  const archive = join(ws.dir, "promo-revisions", "archive");
  const entries = await readdir(archive);
  assert.equal(entries.length, 1);
  assert.deepEqual(await readFile(join(archive, entries[0], "history.json")), journal);
  const studio = await studioWorkspace(ws.id, home, { prepareAudio: false });
  const replacement = await studio.document(initial.briefId);
  assert.equal(replacement.number, 0);
  assert.equal(replacement.settings.theme, "flat");
  assert.ok(replacement.scenes.some(scene => Object.values(scene.expandedText).includes("Local project catalog")));
  assert.equal(studio.matrix.compositions.length, 4);
  assert.equal(JSON.parse(await readFile(briefFile, "utf8")).promo.theme, "flat");
});

test("a replacement rejected by shared variant validation cannot archive the approved story", async t => {
  const { ws, run, briefFile, journalFile, initial } = await fixture(t);
  const brief = await readFile(briefFile), journal = await readFile(journalFile);
  for (const text of [{ es: "Ahorra 20 minutos." }, { en: "Find projects faster." }]) {
    await writeJson(join(ws.paths.briefs, `${initial.briefId}.patch.json`), { lines: { "benefit-1": { text } } });
    await assert.rejects(run({ newStory: true }), /20|claim|unbacked|fact|digit|number|performance|unsupported/i);
    assert.deepEqual(await readFile(briefFile), brief);
    assert.deepEqual(await readFile(journalFile), journal);
    assert.ok(!(await readdir(join(ws.dir, "promo-revisions"))).includes("archive"));
  }
});

test("a renamed product preserves its old story until explicit replacement archives the actual saved id", async t => {
  const { root, home, ws, run, briefFile, journalFile, initial } = await fixture(t);
  const brief = await readFile(briefFile), journal = await readFile(journalFile);
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  await writeJson(join(root, "package.json"), { ...pkg, name: "renamed-acme" });
  await assert.rejects(run(), /matching project|evidence changed|recorded evidence|Replan/i);
  assert.deepEqual(await readFile(briefFile), brief);
  assert.deepEqual(await readFile(journalFile), journal);
  const report = await run({ newStory: true });
  assert.equal(report.briefs.length, 1);
  assert.notEqual(report.briefs[0].id, initial.briefId);
  const archive = join(ws.dir, "promo-revisions", "archive");
  const entries = await readdir(archive);
  assert.equal(entries.length, 1);
  assert.ok(entries[0].startsWith(initial.briefId));
  assert.deepEqual(await readFile(join(archive, entries[0], "history.json")), journal);
  assert.equal(await readFile(journalFile).catch(() => null), null);
  const studio = await studioWorkspace(ws.id, home, { prepareAudio: false });
  assert.equal((await studio.document(report.briefs[0].id)).number, 0);
});
