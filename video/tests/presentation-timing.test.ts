import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FORMATS, auditClaims, expandBrief, makeGrid, stage, type Brief, type FactSheet } from "@panoma/video-core";
import { parseBrief } from "@panoma/video-director";
import { cameraAt, promoPlan, promoShots, promoSourceAt, type PromoProof, type PromoTypedSection, type TakeWithAssets } from "@panoma/video-render/timing";
import { promoSoundCues } from "@panoma/video-render/sound";
import { promoFocusOpacity, promoPanelLayout, promoRowState, promoTypedCount } from "../apps/render/src/recipes/presentation.ts";
import { BriefSchema as McpBriefSchema } from "../packages/mcp/src/schemas.ts";
import { factSheet, type ProjectProfile } from "@panoma/video-scout";
import { promoInsertCandidates } from "../packages/director/src/promo.ts";
import { promoChecks } from "../packages/director/src/promo-checks.ts";

const fps = 30;
const facts: FactSheet = {
  project: "Acme", extractedAt: "2026-09-05T00:00:00Z", notFacts: [], facts: [
    { id: "cmd.catalog", kind: "command", value: "acme catalog --name='café 😀'", source: "README.md:12" },
    { id: "code.readme.2", kind: "code", value: "const café = catalog.find('😀');\n\n  café.open();", source: "README.md:16" },
  ],
};
const raw: Brief = {
  id: "presentation", recipe: "ProductPromo", job: "sell", langs: ["es"], bpm: 1800 / 13, fps, session: "presentation",
  hooks: [{ id: "hook", mode: "type", text: { es: "Retoma tu proyecto" } }],
  lines: [
    { id: "catalog", mark: "catalog", mode: "type", text: { es: "Tus proyectos y sus notas, en el catálogo" } },
    { id: "context", mark: "context", mode: "type", text: { es: "El contexto acompaña al proyecto" } },
    { id: "command", mode: "type", text: { es: "{{fact:cmd.catalog}}" } },
    { id: "example", mode: "type", text: { es: "{{fact:code.readme.2}}" } },
    { id: "brand", mode: "type", text: { es: "Acme" } },
    { id: "end", mode: "type", text: { es: "acme.example" } },
  ],
  promo: {
    opening: "result", pace: "crisp", evidence: {
      hook: { mark: "catalog", facts: ["ui.catalog"] }, catalog: { mark: "catalog", facts: ["ui.catalog"] }, context: { mark: "context", facts: ["ui.context"] },
    },
    treatments: { catalog: "split", context: "focus" }, recap: true,
    inserts: [{ kind: "terminal", line: "command", after: "catalog" }, { kind: "code", line: "example", after: "context" }],
  },
};
const brief = expandBrief(raw, facts);
const source: TakeWithAssets = {
  viewport: { width: 1440, height: 900 }, videoRatio: 2, readyMs: 500, durationMs: 15000, fps: 25,
  marks: [{ name: "catalog", t: 1000 }, { name: "omitted", t: 6500 }, { name: "context", t: 8000 }],
  events: [
    { kind: "click", t: 600, x: 100, y: 100, role: "chrome" },
    { kind: "scroll", t: 1150, y: 700, durationMs: 1000 },
    { kind: "click", t: 2300, x: 300, y: 300 },
    { kind: "click", t: 3400, x: 500, y: 350 },
    { kind: "key", t: 3900, text: "café" },
    { kind: "click", t: 7000, x: 50, y: 50 },
    { kind: "click", t: 8600, x: 850, y: 300 },
    { kind: "scroll", t: 9500, y: 420, durationMs: 800 },
  ],
  macros: [
    { mark: "catalog", file: "catalog.png", pixelRatio: 4, box: { x: 260, y: 280, width: 100, height: 50 },
      change: { box: { x: 0, y: 0, width: 1440, height: 900 }, share: 0.4, boxShare: 1 }, resultAtMs: 4000 },
    { mark: "context", file: "context.png", pixelRatio: 4, box: { x: 800, y: 270, width: 120, height: 60 },
      change: { box: { x: 450, y: 190, width: 640, height: 430 }, share: 0.15, boxShare: 0.22 }, resultAtMs: 10600 },
  ],
};
const planFor = (take = source, value = brief) => promoPlan(take, value, value.hooks[0], "es");
const proofsOf = (plan: ReturnType<typeof promoPlan>): PromoProof[] => plan.sections.filter((section) => section.kind === "proof");
const count = (text: string) => [...text].length;

test("presentation treatments preserve complete real actions and their conformed picture and sound clock", () => {
  const plan = planFor();
  const proofs = proofsOf(plan);
  assert.deepEqual(proofs.map((proof) => proof.treatment), ["split", "focus"]);
  assert.equal(proofs[0].sourceFrom, 1.15, "the first press retains its overlapping approach scroll");
  assert.ok(proofs[0].sourceTo > 3.9, "later clicks and typing survive the selected first click");
  assert.ok(proofs[1].sourceTo >= 10.6, "the second proof keeps its complete later scroll and observed result");
  const recorded = promoSoundCues(source, plan, fps).filter((cue) => cue.sourceTimeMs !== undefined);
  assert.deepEqual(recorded.map((cue) => cue.sourceTimeMs), [1150, 2300, 3400, 3900, 8600, 9500]);
  assert.deepEqual(recorded.filter((cue) => cue.kind === "click").map((cue) => cue.from), proofs.flatMap((proof) => proof.presses.map((press) => press.frame)));
  for (const proof of proofs) {
    assert.equal(proof.playRate, 1.2, "a 25 fps take advances frame-for-frame at 30 fps");
    for (let frame = proof.from; frame < proof.holdFrom - 2; frame++) {
      assert.ok(Math.abs(promoSourceAt(plan, source, frame + 1, fps) - promoSourceAt(plan, source, frame, fps) - 1 / 25) < 1e-8);
    }
  }
  for (const cue of recorded) {
    const proof = proofs.find((proof) => cue.from >= proof.from && cue.from < proof.to)!;
    assert.ok(proof);
    assert.ok(cue.from + cue.durationInFrames <= proof.holdFrom, "a recorded interaction ends before any prolonged presentation hold");
    assert.ok(Math.abs(promoSourceAt(plan, source, cue.from, fps) * 1000 - cue.sourceTimeMs!) <= 40 + 1e-6);
  }
  assert.ok(recorded.some((cue) => cue.from % 13 !== 0), "actions are never quantized onto the edit grid");
  for (const section of plan.sections) {
    assert.equal(section.from % 13, 0);
    assert.equal(section.to % 13, 0);
  }
});

test("focus waits for the true result and the camera, then stays fully focused for a readable interval", () => {
  for (const pace of ["crisp", "measured"] as const) for (const format of Object.values(FORMATS)) {
    const current = { ...brief, promo: { ...brief.promo!, pace } };
    const plan = planFor(source, current);
    const proof = proofsOf(plan)[1];
    const shots = promoShots(source, current, plan, format);
    assert.deepEqual(proof.focusBox, source.macros![1].change!.box);
    const moving = shots.filter((shot) => shot.from >= proof.from && shot.to <= proof.to && JSON.stringify(shot.start) !== JSON.stringify(shot.end));
    const settled = Math.max(proof.resultFrom, ...moving.map((shot) => shot.to));
    let fullyFocused = 0;
    let previous = 0;
    for (let frame = proof.from; frame < proof.to; frame++) {
      const opacity = promoFocusOpacity(proof, shots, frame, fps);
      assert.ok(opacity >= previous && opacity >= 0 && opacity <= 1);
      if (frame <= settled) assert.equal(opacity, 0, "neither camera motion nor pending results receive a focus mask");
      if (opacity === 1) fullyFocused++;
      previous = opacity;
    }
    assert.ok(fullyFocused >= Math.ceil(0.6 * fps), `${format.id}/${pace}: ${fullyFocused} fully focused frames`);
    assert.ok(moving.every((shot) => shot.to - shot.from <= Math.floor(fps * 0.42)));
    const rest = shots.find((shot) => shot.to === proof.to)!;
    assert.deepEqual(rest.start, rest.end, "the highlighted answer holds still");
    assert.equal(promoFocusOpacity(proofsOf(plan)[0], shots, proof.to - 1, fps), 0, "a split scene does not inherit a mask");
  }
});

test("focus refuses missing, clipped, tiny, nonfinite and almost full-page regions", () => {
  for (const box of [undefined, { x: -1, y: 100, width: 300, height: 200 }, { x: 1300, y: 100, width: 300, height: 200 },
    { x: 100, y: 100, width: 15, height: 200 }, { x: 100, y: Number.NaN, width: 300, height: 200 },
    { x: 0, y: 0, width: 1400, height: 880 }]) {
    const take = structuredClone(source);
    if (box) take.macros![1].change!.box = box;
    else delete take.macros![1].change;
    assert.throws(() => planFor(take), /measured, bounded visible result/);
  }
});

test("split keeps one explanation, enough reading time, disjoint safe panels and actual recording pixels", () => {
  const plan = planFor();
  const proof = proofsOf(plan)[0];
  assert.ok(!plan.sections.some((section) => section.kind === "benefit" && section.id === proof.id), "the same explanation is not repeated as a card");
  assert.ok(count(proof.text!) / ((proof.to - proof.from) / fps) <= 24);
  for (const format of Object.values(FORMATS)) for (const videoRatio of [0.5, 1, 2]) for (const isMobile of [false, true]) {
    const take = { ...source, videoRatio, isMobile };
    const layout = promoPanelLayout(format, take.viewport, take);
    const safe = stage(format);
    for (const rect of [layout.text, layout.product]) {
      assert.ok(rect.width > 0 && rect.height > 0);
      assert.ok(rect.x >= safe.x - 1e-7 && rect.y >= safe.y - 1e-7);
      assert.ok(rect.x + rect.width <= safe.x + safe.width + 1e-7 && rect.y + rect.height <= safe.y + safe.height + 1e-7);
    }
    if (layout.axis === "columns") assert.ok(layout.text.x + layout.text.width < layout.product.x);
    else assert.ok(layout.text.y + layout.text.height < layout.product.y);
    const shots = promoShots(take, brief, plan, format);
    for (let frame = proof.from; frame < proof.to; frame++) {
      const camera = cameraAt(shots, frame, 13);
      assert.ok(layout.product.content.width * camera.framing.scale <= take.viewport.width * videoRatio + 1e-7, `${format.id}/${videoRatio}: no horizontal upscale`);
      assert.ok(layout.product.content.height * camera.framing.scale <= take.viewport.height * videoRatio + 1e-7, `${format.id}/${videoRatio}: no vertical upscale`);
    }
  }
  const phone = promoPanelLayout(FORMATS.v, { width: 720, height: 1280 }, { isMobile: true, videoRatio: 2 });
  assert.ok(phone.product.width > stage(FORMATS.v).width * 0.7, "compact stacked copy leaves the real mobile take more than seventy percent of the safe width");
});

test("recap presents complete phrases on beats, advances one active row and preserves earlier rows", () => {
  const plan = planFor();
  const recap = plan.sections.find((section) => section.kind === "recap")!;
  assert.equal(recap.kind, "recap");
  if (recap.kind !== "recap") return;
  assert.deepEqual(recap.rows.map((row) => row.text), proofsOf(plan).map((proof) => proof.text));
  for (const [index, row] of recap.rows.entries()) {
    assert.equal(row.from % makeGrid({ fps, bpm: brief.bpm }).beatFrames, 0);
    const next = recap.rows[index + 1]?.from ?? recap.to;
    assert.ok(count(row.text) / ((next - row.from) / fps) <= 24, "each full phrase can be read before the next arrival");
    assert.equal(promoRowState(recap.rows, index, row.from - 1, fps).visible, false);
    assert.equal(promoRowState(recap.rows, index, row.from, fps).active, true);
    assert.equal(promoRowState(recap.rows, index, next - 1, fps).progress, 1);
    if (index) {
      const previous = promoRowState(recap.rows, index - 1, row.from, fps);
      assert.deepEqual(previous, { visible: true, active: false, progress: 1, checked: 0 });
      assert.ok(promoRowState(recap.rows, index - 1, row.from + 3, fps).checked > 0, "the check draws after the row settles");
      assert.equal(promoRowState(recap.rows, index - 1, row.from + 7, fps).checked, 1);
    }
  }
});

test("terminal and code reveal their exact source, count Unicode correctly, and hold the complete text", () => {
  const plan = planFor();
  const inserts = plan.sections.filter((section): section is PromoTypedSection => section.kind === "terminal" || section.kind === "code");
  assert.deepEqual(inserts.map((section) => section.text), facts.facts.map((fact) => fact.value));
  for (const section of inserts) {
    assert.equal(section.typingFrom! - section.from, 6, "the complete panel and empty caret arrive before typing");
    assert.equal(promoTypedCount(section.text, section.typingFrom!, section.typingTo, section.typingFrom!), 0);
    assert.ok(count(section.text) / ((section.to - section.typingTo) / fps) <= 24, "reading time starts after all source text is visible");
    assert.equal(promoTypedCount(section.text, section.typingFrom ?? section.from, section.typingTo, section.from), 0);
    assert.equal(promoTypedCount(section.text, section.typingFrom ?? section.from, section.typingTo, section.typingTo), count(section.text));
    assert.equal(promoTypedCount(section.text, section.typingFrom ?? section.from, section.typingTo, section.to - 1), count(section.text));
    for (let frame = section.from; frame <= section.typingTo; frame++) {
      const visible = [...section.text].slice(0, promoTypedCount(section.text, section.typingFrom ?? section.from, section.typingTo, frame)).join("");
      assert.ok(visible.isWellFormed(), "an emoji must never appear as a broken surrogate");
      assert.ok(section.text.startsWith(visible), "typing is a prefix of the quoted example, not invented output");
    }
    assert.equal(section.typingTo % 13, 0);
  }
  assert.equal(promoTypedCount("A😀é", 0, 3, 2), 2);
  assert.throws(() => planFor(source, raw), /expanded source text/, "a raw fact token must never appear in the rendered terminal");
});

test("editorial keys coincide with visible non-whitespace reveals and cannot pretend to be captured input", () => {
  const plan = planFor();
  const cues = promoSoundCues(source, plan, fps);
  const editorial = cues.filter((cue) => cue.sourceTimeMs === undefined);
  assert.ok(editorial.some((cue) => cue.kind === "key"));
  for (const cue of editorial.filter((cue) => cue.kind === "key")) {
    const section = plan.sections.find((section) => (section.kind === "terminal" || section.kind === "code") && cue.from > section.from && cue.from <= section.typingTo);
    assert.ok(section && (section.kind === "terminal" || section.kind === "code"), "only a source insert's visible typing earns a key onset");
    if (!section || (section.kind !== "terminal" && section.kind !== "code")) continue;
    assert.ok(cue.from > section.typingFrom!, "there is no keystroke during the empty-command lead");
    const before = promoTypedCount(section.text, section.typingFrom ?? section.from, section.typingTo, cue.from - 1);
    const now = promoTypedCount(section.text, section.typingFrom ?? section.from, section.typingTo, cue.from);
    assert.ok([...section.text].slice(before, now).join("").trim());
    assert.ok(cue.from + cue.durationInFrames <= section.to);
  }
  const recap = plan.sections.find((section) => section.kind === "recap")!;
  assert.equal(recap.kind, "recap");
  if (recap.kind === "recap") assert.deepEqual(editorial.filter((cue) => cue.kind === "click").map((cue) => cue.from), recap.rows.map((row) => row.from));
  const preview = plan.sections[0];
  assert.equal(preview.kind, "preview");
  assert.ok(!cues.some((cue) => cue.from >= preview.from && cue.from < preview.to), "the result teaser still fabricates no action");
});

test("core briefs round-trip richer presentation through director and MCP schemas without dropping source references", () => {
  const json: unknown = JSON.parse(JSON.stringify(raw));
  const directed = parseBrief(json);
  assert.deepEqual(directed, raw);
  assert.deepEqual(McpBriefSchema.parse(json), directed);
  assert.deepEqual(expandBrief(directed, facts), brief);
  assert.deepEqual(auditClaims(directed, facts), []);
  for (const invalid of [
    { ...raw, promo: { ...raw.promo, treatments: { catalog: "invented" } } },
    { ...raw, promo: { ...raw.promo, inserts: [{ kind: "terminal", line: "command", after: "catalog", output: "Succeeded" }] } },
    { ...raw, promo: { ...raw.promo, inserts: Array(3).fill(raw.promo!.inserts![0]) } },
  ]) {
    assert.throws(() => parseBrief(invalid));
    assert.equal(McpBriefSchema.safeParse(invalid).success, false);
  }
});

test("credential-shaped source examples are refused before scouting, selection and promo review", () => {
  /* Generated fixture shapes only: no credential from the machine enters this test. */
  const generated = "ghp_" + "fixture".repeat(4);
  const rejected = [
    `npx acme --auth=${generated}`,
    "npx acme --token=example",
    "npx acme --api-key example",
    'npx acme --config SECRET_TOKEN="short"',
    "npx acme --auth=[redacted]",
    "npx acme --auth=" + "•".repeat(8),
    "npx acme --auth=" + "*".repeat(8),
  ];
  const plain = "npx acme catalog --project=local";
  const examples: FactSheet = { ...facts, facts: [
    { id: "plain", kind: "command", value: plain, source: "README.md:4" },
    ...rejected.flatMap((value, index) => (["command", "code"] as const).map((kind) => ({ id: `fixture.${kind}.${index}`, kind, value, source: `README.md:${index + 6}` }))),
  ] };
  assert.deepEqual(promoInsertCandidates(examples, ["es"]).map((entry) => entry.fact.id), ["plain"]);
  for (const fact of examples.facts) {
    const candidate: Brief = { ...raw,
      lines: [...raw.lines.filter((line) => line.id !== "command" && line.id !== "example"), { id: "source", mode: "type", text: { es: `{{fact:${fact.id}}}` } }],
      promo: { ...raw.promo!, inserts: [{ kind: fact.kind === "code" ? "code" : "terminal", line: "source", after: "catalog" }] },
    };
    const check = promoChecks({ brief: candidate, facts: examples }).find((check) => check.id === "promo.source-inserts");
    assert.equal(check?.status, fact.id === "plain" ? "pass" : "fail", fact.id);
  }
  const dir = mkdtempSync(join(tmpdir(), "panoma-video-source-credentials-"));
  try {
    writeFileSync(join(dir, "README.md"), ["# Acme", "", "## Install", "```sh", plain, ...rejected, "```",
      "## Roadmap", "### Preview API", "```sh", "npx acme-future init", "```", "## Contributing", "### Setup", "```sh", "pnpm add acme-devtools", "```",
      "## Current", "```sh", "npx acme-incomplete init"].join("\n"));
    const profile: Omit<ProjectProfile, "facts"> = { root: dir, id: "acme", name: "Acme", kind: "cli", commands: [], routes: [], docs: [], logoFiles: [] };
    const sheet = factSheet(dir, profile);
    assert.deepEqual(sheet.facts.filter((fact) => fact.kind === "command").map((fact) => ({ id: fact.id, value: fact.value, source: fact.source })),
      [{ id: "cmd.install", value: plain, source: "README.md:5" }]);
    assert.ok(!JSON.stringify(sheet).includes(generated), "the generated credential is absent before facts reach the brain");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test("promo review refuses a plan whose editorial theme differs from its brief", () => {
  const base = { recipe: "ProductPromo", fps, durationInFrames: 90, beats: { beatFrames: 15, barFrames: 60, start: 0 }, cuts: [], holds: [], cards: [], fades: [] };
  for (const [selected, rendered, status] of [
    [undefined, undefined, "pass"], ["flat", "flat", "pass"], ["vibrant", "vibrant", "pass"],
    ["flat", "vibrant", "fail"], ["vibrant", undefined, "fail"],
  ] as const) {
    const check = promoChecks({ brief: { ...raw, promo: { ...raw.promo!, theme: selected } }, facts,
      plan: { ...base, editorialTheme: rendered } }).find((check) => check.id === "promo.theme");
    assert.equal(check?.status, status);
  }
});
