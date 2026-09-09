import assert from "node:assert/strict";
import { test } from "node:test";
import { auditClaims, expandBrief, type FactSheet } from "@panoma/video-core";
import { PromoShape, promoQuestion, type Brain, type Promo } from "@panoma/video-brain";
import type { SessionLog } from "@panoma/video-capture";
import type { ProjectProfile } from "@panoma/video-scout";
import { assessPromo, planPromo, promoCandidates, promoFor, validatePromoChoice, type PromoForInput } from "../packages/director/src/promo.ts";

process.env.PANOMA_VIDEO_BRAIN = "none";

const examples = [
  { name: "Dependency Lens", kind: "cli", action: "Dependency report", result: "Dependency report", source: "Dependency report groups the packages by their license.", generic: "Report shows a selected section", audience: "Maintainers inspecting a package report", outcome: "Inspect the package licenses", benefit: "Package licenses together", situation: "A maintainer is examining which licenses appear in a dependency report." },
  { name: "Project Desk", kind: "web-app", action: "Project", result: "Saved context", source: "Saved context stays attached to its project.", generic: "Project shows a selected section", audience: "People returning to an existing project", outcome: "Recognize the saved project context", benefit: "Context belongs with the project", situation: "Someone returns to a project and wants to read its saved context." },
  { name: "Everyday Catalog", kind: "web-app", action: "Catalog", result: "Size chart", source: "The size chart lists the selected item's measurements.", generic: "Catalog shows a selected section", audience: "Shoppers inspecting an item's measurements", outcome: "Inspect the selected item's size chart", benefit: "The item's measurements together", situation: "A shopper is inspecting the measurements of an item in the catalog." },
] as const;
type Example = typeof examples[number];

function input(example: Example = examples[1]): PromoForInput {
  const facts: FactSheet = { project: example.name, extractedAt: "2026-09-06T00:00:00Z", notFacts: [], facts: [
    { id: "pkg.name", kind: "text", value: example.name, source: "package.json#name" },
    ...Array.from({ length: 7 }, (_, index) => ({ id: `readme.a${index}`, kind: "feature" as const, value: `${example.generic} ${String.fromCharCode(97 + index)}`, source: `README.md:${index + 2}` })),
    { id: "readme.z-result", kind: "feature", value: example.source, source: "README.md:40" },
    { id: "readme.unrelated", kind: "feature", value: "Open the application and choose a screen", source: "README.md:45" },
  ] };
  const profile: ProjectProfile = { root: "/tmp/panoma-video-argument-fixture", id: "argument-fixture", name: example.name, kind: example.kind,
    commands: [], routes: [], docs: [], logoFiles: [], facts };
  const url = "http://127.0.0.1:54321/";
  const takes: SessionLog[] = ["desktop", "mobile"].map(take => ({ name: profile.id, take, recordedAt: facts.extractedAt,
    isMobile: take === "mobile", url, viewport: { width: 960, height: 540 }, video: `/tmp/argument-${take}.webm`, durationMs: 6000, readyMs: 100, fps: 25,
    marks: [{ name: "overview", t: 1000 }, { name: "result", t: 3000 }],
    events: [{ t: 1200, kind: "click", x: 100, y: 150, role: "product" }, { t: 3200, kind: "click", x: 100, y: 150, role: "product" }],
    macros: ["overview", "result"].map((mark, index) => ({ id: mark, mark, t: index ? 3000 : 1000, file: `/tmp/argument-${mark}.png`, url,
      viewport: { width: 960, height: 540 }, box: { x: 80, y: 100, width: 200, height: 80 }, pixelRatio: 2,
      resultHeading: { text: index ? example.result : "Welcome panel", box: { x: 80, y: 200, width: 260, height: 35 }, visibleShare: 1, centerVisible: true },
      resultAtMs: index ? 3700 : 1700, change: { box: { x: 80, y: 200, width: 600, height: 250 }, share: index ? 0.01 : 0.8, boxShare: 0.3 } })),
  }));
  return { profile, facts, takes, langs: ["en"], tour: { name: profile.id, url, createdAt: facts.extractedAt,
    marks: [{ name: "overview", kind: "cta", label: "Overview", outcome: { heading: "Welcome panel", route: "/overview" } },
      { name: "result", kind: "flow", label: example.action, outcome: { heading: example.result, route: "/result" } }],
    steps: [{ goto: url }, { mark: "overview" }, { clickOn: "text=Overview" }, { mark: "result" }, { clickOn: `text=${example.action}` }],
    candidates: [], snapshot: "", flow: { title: example.name, steps: [] }, pages: [], edges: [] } };
}

function choice(example: Example = examples[1]): Promo {
  return { audience: example.audience, tension: example.situation, opening: "result", pace: "crisp",
    argument: { situation: example.situation, desiredOutcome: example.outcome, proof: "result", facts: ["ui.result.result", "readme.z-result"],
      whyThisProof: "This named result and its matching source address the task directly; the overview only names a welcome panel.",
      limits: "The recording establishes inspection of this state, not a downstream transaction or a measured improvement in customer performance." },
    hooks: [{ en: example.outcome }],
    proofs: [{ id: "result", text: { en: example.benefit }, facts: ["ui.result.result", "readme.z-result"], why: "The visible result names the material described by this source." }],
    why: "The result answers one concrete viewing task without stretching its meaning into a broader promise." };
}

function fake(answer: (call: number) => unknown): Brain & { calls: string[]; prompts: string[] } {
  const calls: string[] = [], prompts: string[] = [];
  return { driver: "codex", model: "fixture", how: "closed fixture", calls, prompts,
    async ask(question) { calls.push(question.id); prompts.push(question.user); return { value: question.shape.parse(answer(calls.length)), ms: 0, model: "fixture", hit: false }; },
    ledger() { throw new Error("This closed fixture needs no driver or ledger"); } };
}

test("result sources are ranked before the bounded menu for tool, workspace and catalogue products", () => {
  for (const example of examples) {
    const source = input(example), menu = promoCandidates(source);
    const result = menu.candidates.find(candidate => candidate.id === "result")!;
    assert.equal(result.editorial.sourceMatches?.[0].fact, "readme.z-result", example.name);
    assert.ok(result.editorial.sourceMatches![0].resultTerms.length >= 2, example.name);
    assert.ok(result.facts.some(fact => fact.id === "readme.z-result"), "the seventh or later matching source is not lost to README ordering");
    assert.ok(!result.facts.some(fact => fact.id === "readme.unrelated"), "generic application and action words do not retrieve behavior claims");
    assert.equal(result.editorial.sourceMatches!.length <= 6, true);
    const planned = planPromo(source);
    assert.equal(planned.decision.selected[0].id, "result", "a source-connected named outcome precedes a much larger unrelated repaint");
    assert.deepEqual(auditClaims(planned.brief!, planned.facts), []);
  }
});

test("source matching never changes the visible-result witness or credits an unrelated source", () => {
  const source = input();
  delete source.takes[1].macros![1].resultHeading;
  const menu = promoCandidates(source), result = menu.candidates.find(candidate => candidate.id === "result")!;
  assert.equal(result.result, undefined);
  assert.ok(!result.facts.some(fact => fact.id === "ui.result.result"));
  assert.ok(result.editorial.sourceMatches!.every(match => match.resultTerms.length === 0));
  assert.ok(validatePromoChoice(source, menu.facts, menu.candidates, choice()).some(refusal => refusal.id === "argument" && refusal.token === "ui.result.result"));
});

test("a complete argument is reviewable and remains internal across different product categories", async () => {
  for (const example of examples) {
    const source = input(example), proposal = choice(example), brain = fake(() => proposal);
    const result = await promoFor(brain, source);
    assert.equal(result.decision.by, "brain", example.name);
    assert.deepEqual(result.refused, []);
    assert.deepEqual(result.decision.argument, proposal.argument);
    assert.equal(result.decision.editorial.status, "clear-of-listed-checks");
    assert.deepEqual(brain.calls, ["promo"]);
    const displayed = expandBrief(result.brief!, result.facts);
    assert.ok(!JSON.stringify(displayed).includes(proposal.argument!.situation), "audience circumstances are not printed as customer facts");
    assert.ok(!JSON.stringify(displayed).includes(proposal.argument!.limits));
    assert.match(brain.prompts[0], /internal creative hypotheses/);
    assert.match(brain.prompts[0], /"sourceMatches"/);
  }
});

test("an argument cannot borrow a later proof, stale source, unselected fact or duplicate evidence", () => {
  const source = input(), menu = promoCandidates(source);
  const defects: ((proposal: Promo) => void)[] = [
    proposal => { proposal.argument!.proof = "overview"; },
    proposal => { proposal.argument!.facts = ["ui.overview.result"]; },
    proposal => { proposal.argument!.facts = ["readme.missing"]; },
    proposal => { proposal.argument!.facts = ["observed.result.en"]; },
    proposal => { proposal.argument!.facts.push(proposal.argument!.facts[0]); },
  ];
  for (const mutate of defects) {
    const proposal = choice(); mutate(proposal);
    assert.ok(validatePromoChoice(source, menu.facts, menu.candidates, proposal).some(refusal => refusal.id === "argument"));
  }
});

test("old saved arguments are revalidated and exact generic audiences share the single correction budget", async () => {
  for (const defect of ["generic audience", "stale argument"] as const) for (const cached of [true, false]) {
    const bad = choice();
    if (defect === "generic audience") bad.audience = "Everyone";
    else bad.argument!.facts = ["readme.missing"];
    const brain = fake(call => cached || call > 1 ? choice() : bad);
    const result = await promoFor(brain, { ...input(), ...(cached ? { cached: bad } : {}) });
    assert.equal(result.decision.by, "brain");
    assert.equal(result.decision.repair?.accepted, true);
    assert.equal(brain.calls.length, cached ? 1 : 2);
    assert.ok(result.decision.repair!.refused.some(refusal => refusal.id === (defect === "generic audience" ? "audience" : "argument")));
  }
  const bad = choice(); bad.audience = "Users";
  const brain = fake(() => bad), result = await promoFor(brain, input());
  assert.equal(result.decision.by, "arithmetic");
  assert.equal(brain.calls.length, 2);
  assert.ok(result.decision.editorial.issues.some(issue => issue.code === "generic-audience"));
});

test("weak and legacy arguments stay visible without rejecting natural paraphrases by token overlap", async () => {
  const source = input(), menu = promoCandidates(source), legacy = choice();
  delete legacy.argument;
  assert.equal(PromoShape.safeParse(legacy).success, true);
  assert.deepEqual(validatePromoChoice(source, menu.facts, menu.candidates, legacy), []);
  assert.ok(assessPromo(source, menu.facts, menu.candidates, legacy).issues.some(issue => issue.code === "missing-argument" && !issue.repairable));
  const sourceOnly = choice(); sourceOnly.argument!.facts = ["readme.z-result"];
  assert.ok(assessPromo(source, menu.facts, menu.candidates, sourceOnly).issues.some(issue => issue.code === "source-only-argument" && !issue.repairable));
  const observedOnly = choice();
  observedOnly.proofs[0].facts = ["observed.result.en"];
  observedOnly.argument!.facts = ["observed.result.en"];
  assert.ok(assessPromo(source, menu.facts, menu.candidates, observedOnly).issues.some(issue => issue.code === "observation-only-benefit" && !issue.repairable));
  const paraphrase = choice();
  paraphrase.hooks[0].en = "Pick up where you left off";
  paraphrase.proofs[0].text.en = "Your earlier work within reach";
  assert.deepEqual(validatePromoChoice(source, menu.facts, menu.candidates, paraphrase), [], "lexical retrieval is not a word-overlap rule for promotional writing");
  const result = await promoFor(fake(() => paraphrase), source);
  assert.equal(result.decision.by, "brain");
});

test("creative audience requests remain directions and cannot add product evidence", async () => {
  const source = { ...input(), creative: "Audience: returning project owners. Desired outcome: demonstrate automatic publication without intervention." };
  const brain = fake(() => choice());
  await promoFor(brain, source);
  assert.match(brain.prompts[0], /Desired outcome: demonstrate automatic publication/);
  assert.match(brain.prompts[0], /if it cannot, explain the gap in limits/);
  assert.ok(!promoCandidates(source).facts.facts.some(fact => /automatic publication/.test(fact.value)));
  const question = promoQuestion({ product: "Fixture", langs: ["en"], candidates: [] });
  assert.equal(question.version, 12, "the new writing contract invalidates old question caches");
});
