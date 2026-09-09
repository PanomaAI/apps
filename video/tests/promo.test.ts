import assert from "node:assert/strict";
import { test } from "node:test";
import { auditClaims, expandBrief, FORMATS, type FactSheet } from "@panoma/video-core";
import { promoQuestion, type Brain, type Promo } from "@panoma/video-brain";
import type { SessionEvent, SessionLog } from "@panoma/video-capture";
import { parseBrief, planPromo, promoCandidates, promoFor, kitFor, type PromoForInput } from "@panoma/video-director";
import type { ProjectProfile } from "@panoma/video-scout";
import type { TourScript } from "@panoma/video-tour";
import { assessPromo, promoFocusAvailable, promoInsertCandidates, validatePromoChoice } from "../packages/director/src/promo.ts";
import { promoPlan, promoShots, promoSplitResultScale } from "@panoma/video-render/timing";
import { promoPanelLayout } from "../apps/render/src/recipes/presentation.ts";

const facts: FactSheet = {
  project: "Acme", extractedAt: "2026-09-05T00:00:00Z", notFacts: [],
  facts: [
    { id: "pkg.name", kind: "text", value: "Acme", source: "package.json#name" },
    { id: "url", kind: "url", value: "https://acme.example", source: "package.json#homepage" },
    { id: "readme.projects", kind: "feature", value: "Project notes stay with the project", source: "README.md:12", lang: "en" },
    { id: "readme.memories", kind: "feature", value: "Project memory contains its saved context", source: "README.md:14", lang: "en" },
  ],
};
const profile: ProjectProfile = {
  root: "/tmp/acme", id: "acme-deadbeef", name: "Acme", kind: "web-app",
  commands: [], routes: [], docs: [], logoFiles: [], facts,
};
const tour: TourScript = {
  name: profile.id, url: "http://127.0.0.1:5173/", createdAt: facts.extractedAt,
  steps: [{ goto: "http://127.0.0.1:5173/" }, { mark: "project" }, { clickOn: "text=Project" }, { mark: "memory" }, { clickOn: "text=Memory" }],
  marks: [
    { name: "project", kind: "cta", label: "Open this project's page — or double-click the project", outcome: { heading: "Project notes", route: "/project" } },
    { name: "memory", kind: "flow", label: "Memory", outcome: { heading: "Saved context", route: "/memory" } },
  ],
  candidates: [], snapshot: "", flow: { title: "Acme", steps: [] }, pages: [], edges: [],
};
function take(name: string): SessionLog {
  return {
    name: tour.name, take: name, recordedAt: facts.extractedAt, isMobile: name === "mobile",
    url: tour.url, viewport: { width: 960, height: 540 }, video: `/tmp/${name}.webm`, durationMs: 7000, readyMs: 500, fps: 25,
    marks: [{ name: "project", t: 1000 }, { name: "memory", t: 4000 }],
    events: [{ t: 1400, kind: "click", x: 100, y: 120, role: "product" }, { t: 4400, kind: "click", x: 120, y: 130, role: "product" }],
    macros: ["project", "memory"].map((mark, i) => ({
      id: mark, mark, t: i ? 4000 : 1000, file: `/tmp/${mark}.png`, url: tour.url,
      viewport: { width: 960, height: 540 }, box: { x: 80, y: 100, width: 200, height: 80 }, pixelRatio: 4,
      resultHeading: { text: i ? "Saved context" : "Project notes", box: { x: 90, y: 200, width: 250, height: 32 }, visibleShare: 1, centerVisible: true },
      change: { box: { x: 0, y: 0, width: 900, height: 500 }, share: i ? 0.2 : 0.6, boxShare: 0.8 },
    })),
  };
}
const input = (): PromoForInput => ({ profile, facts: structuredClone(facts), tour: structuredClone(tour), takes: [take("desktop"), take("mobile")], langs: ["en", "es"] });
function namedOutcome(source: PromoForInput, index: number, heading: string): void {
  source.tour!.marks[index].outcome!.heading = heading;
  for (const take of source.takes) take.macros![index].resultHeading!.text = heading;
}
const choice = (): Promo => ({
  audience: "People working across projects",
  tension: "Project context gets separated from its work.",
  opening: "promise", pace: "measured",
  hooks: [{ en: "Your project keeps its context.", es: "Tu proyecto conserva su contexto." }],
  proofs: [
    { id: "memory", text: { en: "Context stays with the project.", es: "El contexto acompaña al proyecto." }, facts: ["ui.memory.result", "readme.memories"], why: "The recorded memory panel reveals saved context, and the sourced feature describes its relationship to the project." },
    { id: "project", text: { en: "Notes belong with the work.", es: "Las notas acompañan al trabajo." }, facts: ["ui.project.result", "readme.projects"], why: "The project opens on its notes, supported by the matching source fact." },
  ],
  why: "Lead with the relationship that matters to someone returning to a project, then show two independent examples.",
});
/** A closed fake: no test can discover or invoke a driver on the machine. */
function fake(answer: object | ((call: number) => unknown)): Brain & { calls: string[]; asked: string[] } {
  const calls: string[] = [];
  const asked: string[] = [];
  return {
    driver: "claude", model: "fake", how: "scripted fixture", calls, asked,
    async ask(question) {
      calls.push(question.id);
      asked.push(question.user);
      const value = typeof answer === "function" ? answer(calls.length) : answer;
      return { value: question.shape.parse(value), hit: false, ms: 0, model: "fake" };
    },
    ledger() { throw new Error("This fixture does not need a ledger"); },
  };
}

/** Real capture proportions with a broad catalog result and a small view toggle. */
function splitInput(): PromoForInput {
  const source = input();
  for (const take of source.takes) {
    take.viewport = take.isMobile ? { width: 720, height: 1280 } : { width: 1920, height: 1080 };
    take.videoRatio = 2;
    for (const macro of take.macros!) {
      macro.viewport = take.viewport;
      macro.target = { x: take.viewport.width - 70, y: 180, width: 28, height: 26 };
      macro.change!.box = take.isMobile ? { x: 28, y: 182, width: 676, height: 1032 } : { x: 426, y: 160, width: 1222, height: 908 };
    }
  }
  return source;
}

function splitFriendlyInput(): PromoForInput {
  const source = input();
  const mobile = source.takes[1];
  mobile.viewport = { width: 540, height: 960 };
  for (const macro of mobile.macros!) {
    macro.viewport = mobile.viewport;
    macro.change!.box = { x: 0, y: 0, width: 500, height: 900 };
  }
  return source;
}

test("automatic split avoids shrinking a broad result while manual and saved choices remain available", () => {
  const source = splitInput();
  const automatic = promoCandidates(source, { automatic: true });
  assert.ok(automatic.candidates.every((candidate) => !candidate.treatments.includes("split")));
  const scale = automatic.candidates[0].split!;
  assert.equal(scale.allowed, false);
  assert.deepEqual(scale.scales.map((entry) => entry.format).sort(), ["h", "v"]);
  assert.ok(scale.scales.every((entry) => entry.cssScale < 1));
  assert.match(scale.reason, /below its recorded CSS size/);
  const manual = promoCandidates(source);
  assert.ok(manual.candidates.every((candidate) => candidate.treatments.includes("split")));
  const selected = choice();
  selected.proofs[0].treatment = "split";
  assert.equal(validatePromoChoice(source, manual.facts, manual.candidates, selected).length, 0);
  const fallback = planPromo(source);
  assert.equal(fallback.brief?.promo?.treatments?.["benefit-1"], "full");
  assert.equal(fallback.decision.presentation?.[0].split.allowed, false);
  // More encoded pixels never turn a reduced CSS layout into a larger result.
  for (const take of source.takes) take.videoRatio = 4;
  assert.deepEqual(promoCandidates(source, { automatic: true }).candidates[0].split, scale);
});

test("split eligibility shares settled camera geometry and requires both served formats", () => {
  const source = splitInput();
  const desktop = source.takes[0];
  desktop.viewport = { width: 1280, height: 720 };
  for (const macro of desktop.macros!) {
    macro.viewport = desktop.viewport;
    macro.change!.box = { x: 480, y: 260, width: 320, height: 200 };
  }
  let candidate = promoCandidates(source, { automatic: true }).candidates[0];
  assert.ok(candidate.split!.scales.find((entry) => entry.format === "h")!.cssScale >= 1);
  assert.ok(!candidate.treatments.includes("split"), "mobile's broad result still blocks automatic split");
  for (const macro of source.takes[1].macros!) macro.change!.box = { x: 240, y: 400, width: 240, height: 300 };
  candidate = promoCandidates(source, { automatic: true }).candidates[0];
  assert.ok(candidate.treatments.includes("split"), "contained results retain CSS size in both formats");
  const result = planPromo(source);
  const planned = expandBrief(result.brief!, result.facts);
  const split = Object.fromEntries(planned.lines.filter((line) => line.mark).map((line) => [line.id, "split"] as const));
  const brief = { ...planned, promo: { ...planned.promo!, treatments: { ...planned.promo!.treatments, ...split } } };
  for (const take of source.takes) {
    const format = FORMATS[take.isMobile ? "v" : "h"];
    const plan = promoPlan(take, brief, brief.hooks[0], "en");
    const proof = plan.sections.find((section) => section.kind === "proof")!;
    assert.equal(proof.kind, "proof");
    const settled = promoShots(take, brief, plan, format).find((shot) => shot.to === proof.to && shot.reason === "read the visible payoff")!;
    const content = promoPanelLayout(format, take.viewport, take).product.content;
    assert.equal(promoSplitResultScale(take, proof.mark, format), content.width / take.viewport.width * settled.end.scale);
  }
});

test("the fresh brain menu omits unsafe split and an out-of-menu answer is refused", async () => {
  const source = splitInput();
  const selected = choice();
  selected.proofs[0].treatment = "split";
  const brain = fake(selected);
  const result = await promoFor(brain, source);
  assert.equal(brain.calls.length, 2);
  assert.match(brain.asked[0], /"treatments":\["full"\]/);
  assert.doesNotMatch(brain.asked[0], /"treatments":\[[^\]]*"split"/);
  assert.match(brain.asked[0], /below its recorded CSS size/);
  assert.ok(result.refused.some((entry) => entry.token === "split"));
  assert.equal(result.decision.by, "arithmetic");
  assert.equal(result.brief?.promo?.treatments?.["benefit-1"], "full");
});

test("promo offers a long instruction-shaped control only as an observed action, never as quoted copy", () => {
  const menu = promoCandidates(input());
  assert.deepEqual(menu.candidates.map((candidate) => candidate.id), ["project", "memory"]);
  const first = menu.candidates[0];
  assert.deepEqual(first.takes, ["desktop", "mobile"]);
  assert.ok(first.facts.some((fact) => fact.id === "ui.project.result"));
  assert.ok(first.facts.some((fact) => fact.id === "readme.projects"));
  assert.ok(!first.facts.some((fact) => fact.id === "ui.project"));
  const result = planPromo(input());
  assert.ok(result.brief);
  assert.doesNotMatch(JSON.stringify(expandBrief(result.brief, result.facts)), /double-click/);
});

test("a promo requires a product press and measured result in every take, not a scroll or consent action", () => {
  for (const change of ["missing mark", "missing click", "chrome", "missing measurement", "zero change", "invalid box", "external macro"] as const) {
    const source = input();
    const mobile = source.takes[1];
    if (change === "missing mark") mobile.marks = mobile.marks.filter((mark) => mark.name !== "project");
    if (change === "missing click") mobile.events = mobile.events.filter((event) => event.t !== 1400);
    if (change === "chrome") mobile.events = mobile.events.map((event, index): SessionEvent => index === 0 && event.kind === "click" ? { ...event, role: "chrome" } : event);
    if (change === "missing measurement") delete mobile.macros![0].change;
    if (change === "zero change") mobile.macros![0].change!.share = 0;
    if (change === "invalid box") mobile.macros![0].change!.box.width = Number.NaN;
    if (change === "external macro") mobile.macros![0].url = "https://elsewhere.example";
    const menu = promoCandidates(source);
    assert.ok(!menu.candidates.some((candidate) => candidate.id === "project"), change);
    assert.ok(menu.refused.some((refusal) => refusal.id === "project" && /mobile/.test(refusal.why)), change);
  }
  const section = input();
  section.tour!.marks[0].kind = "section";
  assert.ok(!promoCandidates(section).candidates.some((candidate) => candidate.id === "project"));
  const unsafe = input();
  unsafe.tour!.marks[0].label = "Delete project";
  assert.ok(!promoCandidates(unsafe).candidates.some((candidate) => candidate.id === "project"));
});

test("source retrieval recognizes plural names without offering unrelated product claims", () => {
  const source = input();
  source.facts = { ...facts, facts: [...facts.facts,
    { id: "pkg.description", kind: "text", value: "The local catalog of your projects", source: "package.json#description" },
    { id: "readme.analytics", kind: "feature", value: "Charts explain revenue", source: "README.md:21" },
  ] };
  const menu = promoCandidates(source);
  assert.ok(menu.candidates[0].facts.some((fact) => fact.id === "pkg.description"));
  assert.ok(!menu.candidates[0].facts.some((fact) => fact.id === "readme.analytics"));
});

test("empty, loading and error headings do not become proofs; a setup heading is not mistaken for loading", () => {
  for (const heading of ["No proposals yet", "No results found", "No data", "Aún no hay propuestas", "Loading…", "Cargando", "Something went wrong"]) {
    const source = input();
    namedOutcome(source, 0, heading);
    const menu = promoCandidates(source);
    assert.ok(!menu.candidates.some((candidate) => candidate.id === "project"), heading);
    assert.ok(menu.refused.some((refusal) => refusal.id === "project"), heading);
  }
  const setup = input();
  namedOutcome(setup, 0, "Power the product on, step by step");
  assert.ok(promoCandidates(setup).candidates.some((candidate) => candidate.id === "project"));
});

test("page context gives an in-place action meaning without turning incidental counts into quotable facts", () => {
  const source = input();
  source.tour!.marks[0] = { name: "project", kind: "cta", label: "List view" };
  source.tour!.pages = [
    { id: "before", path: "/", heading: "Project catalog 31 projects", order: 0 },
    { id: "after", path: "/", heading: "Project catalog 31 projects", order: 1 },
  ];
  source.tour!.edges = [{ from: "before", to: "after", mark: "project", label: "List view", kind: "cta" }];
  source.facts = { ...facts, facts: [...facts.facts,
    { id: "readme.section.proposal-isolation", kind: "feature", value: "Project proposal isolation", source: "README.md:35" },
    { id: "pkg.description", kind: "text", value: "The local catalog of your projects", source: "package.json#description" },
  ] };
  const candidate = promoCandidates(source).candidates[0];
  assert.equal(candidate.context.before, "Project catalog 31 projects");
  assert.equal(candidate.context.after, undefined, "an unwitnessed document title cannot return as result context");
  assert.ok(candidate.facts.some((fact) => fact.id === "pkg.description"));
  assert.ok(!candidate.facts.some((fact) => /31/.test(fact.value)));
  assert.ok(!candidate.facts.some((fact) => fact.id === "readme.section.proposal-isolation"));
});

test("an ambiguous CTA cannot borrow an unchanged page heading as its object", () => {
  for (const label of ["More places to open it", "Use this", "Open that in an editor", "Más formas de abrirlo", "Ábrelo aquí", "Mostrar esto"]) {
    const source = input();
    source.tour!.marks[0] = { name: "project", kind: "cta", label };
    source.tour!.pages = [
      { id: "before", path: "/", heading: "Project catalog", order: 0 },
      { id: "after", path: "/", heading: "Project catalog", order: 1 },
    ];
    source.tour!.edges = [{ from: "before", to: "after", mark: "project", label, kind: "cta" }];
    const menu = promoCandidates(source);
    assert.ok(!menu.candidates.some((candidate) => candidate.id === "project"), label);
    assert.ok(menu.refused.some((refusal) => refusal.id === "project" && /object is ambiguous/.test(refusal.why)), label);
  }
});

test("named small changes and independently observed destinations remain promotional candidates", () => {
  for (const label of ["List view", "Choose format", "Cambiar la vista", "Open this project"]) {
    const source = input();
    source.tour!.marks[0] = { name: "project", kind: "cta", label };
    for (const take of source.takes) take.macros![0].change!.share = 0.001;
    assert.ok(promoCandidates(source).candidates.some((candidate) => candidate.id === "project"), label);
  }
  for (const result of ["own outcome", "new heading", "new route"] as const) {
    const source = input();
    source.tour!.marks[0] = { name: "project", kind: "cta", label: "Open it", ...(result === "own outcome" ? { outcome: { heading: "Project notes" } } : {}) };
    source.tour!.pages = [
      { id: "before", path: "/", heading: "Projects", order: 0 },
      { id: "after", path: result === "new route" ? "/project" : "/", heading: result === "new heading" ? "Project notes" : "Projects", order: 1 },
    ];
    source.tour!.edges = [{ from: "before", to: "after", mark: "project", label: "Open it", kind: "cta" }];
    assert.equal(promoCandidates(source).candidates.some((candidate) => candidate.id === "project"), result !== "new heading", "a graph heading alone is document identity, not a witnessed result");
  }
});

test("named result facts require heading geometry in every take and reject stale saved evidence", () => {
  for (const focus of [undefined, { x: 24, y: 2934, width: 672, height: 1 }, { x: 90, y: 200, width: 250, height: 1 }, { x: -1, y: 200, width: 250, height: 32 }]) {
    const source = input();
    if (focus) source.takes[1].macros![1].resultHeading!.box = focus;
    else delete source.takes[1].macros![1].resultHeading;
    const menu = promoCandidates(source);
    const candidate = menu.candidates.find(candidate => candidate.id === "memory")!;
    assert.equal(candidate.result, undefined);
    assert.ok(!candidate.facts.some(fact => fact.id === "ui.memory.result"));
    assert.ok(!menu.facts.facts.some(fact => fact.id === "ui.memory.result"));
    assert.ok(menu.refused.some(refusal => refusal.id === "memory" && /Recapture the visible result/.test(refusal.why)));
    assert.ok(validatePromoChoice(source, menu.facts, menu.candidates, choice()).length > 0, "an old choice citing that result cannot silently pass");
    assert.equal(source.tour!.marks[1].outcome!.heading, "Saved context", "saved material is never rewritten");
  }
  const empty = input();
  empty.takes = [];
  assert.ok(!promoCandidates(empty).facts.facts.some(fact => /^ui\..+\.result$/.test(fact.id)));
  const legacy = input();
  legacy.takes[1].macros![1].focus = { x: 90, y: 200, width: 250, height: 32 };
  delete legacy.takes[1].macros![1].resultHeading;
  assert.ok(!promoCandidates(legacy).facts.facts.some(fact => fact.id === "ui.memory.result"), "legacy camera geometry cannot prove visibility or exact identity");
  const wrongText = input();
  wrongText.takes[1].macros![1].resultHeading!.text = "Another result";
  assert.ok(!promoCandidates(wrongText).facts.facts.some(fact => fact.id === "ui.memory.result"));
});

test("cached persuasion cannot restore an ambiguous CTA after the evidence gate changes", async () => {
  const source = input();
  source.tour!.marks[0] = { name: "project", kind: "cta", label: "More ways to open it" };
  const brain = fake(choice());
  const result = await promoFor(brain, { ...source, cached: choice() });
  assert.equal(result.decision.by, "arithmetic");
  assert.equal(brain.calls.length, 1, "one correction is attempted, with the invalid proof still refused");
  assert.deepEqual(result.decision.selected.map((proof) => proof.id), ["memory"]);
  assert.ok(result.refused.some((refusal) => /object is ambiguous/.test(refusal.why)));
});

test("the deterministic plan is stable, sourced, wordless, and shares the same schema as the brain plan", async () => {
  const source = input();
  const before = structuredClone(source);
  const planned = planPromo(source);
  assert.deepEqual(await promoFor(null, { ...source, cached: choice() }), planned);
  assert.deepEqual(source, before, "planning does not mutate source facts, tour or recordings");
  assert.equal(planned.decision.by, "arithmetic");
  assert.deepEqual(planned.brief?.lines.filter((line) => line.mark).map((line) => line.mark), ["project", "memory"]);
  assert.ok(planned.brief);
  parseBrief(planned.brief);
  assert.deepEqual(auditClaims(planned.brief, planned.facts), []);
  assert.ok([...planned.brief.hooks, ...planned.brief.lines].every((line) => line.mode === "type"));
  assert.equal(planned.brief.lines.find((line) => line.id === "brand")?.text.es, "{{fact:pkg.name}}");
  assert.equal(planned.brief.lines.find((line) => line.id === "end")?.text.en, "{{fact:url}}");
});

test("the brain chooses audience, tension, order and pacing, with each hook bound to the first proof", async () => {
  const brain = fake(choice());
  const result = await promoFor(brain, input());
  assert.deepEqual(result.refused, []);
  assert.equal(result.decision.by, "brain");
  assert.deepEqual(brain.calls, ["promo"]);
  assert.equal(result.decision.audience, choice().audience);
  assert.equal(result.decision.tension, choice().tension);
  assert.equal(result.brief?.promo?.opening, "promise");
  assert.equal(result.brief?.promo?.pace, "measured");
  assert.deepEqual(result.brief?.lines.filter((line) => line.mark).map((line) => line.mark), ["memory", "project"]);
  assert.deepEqual(result.brief?.promo?.evidence["hook-1"], { mark: "memory", facts: choice().proofs[0].facts });
  assert.deepEqual(result.brief?.promo?.evidence["benefit-2"], { mark: "project", facts: choice().proofs[1].facts });
  assert.match(result.decision.validation, /remain model judgment/);
});

test("fresh and cached choices pass the same claim, evidence and language checks", async () => {
  const cases: [string, (proposal: Promo) => void, RegExp][] = [
    ["literal quantity", (p) => { p.proofs[0].text.en = "Save 20 minutes."; }, /literal-number|unsupported performance/],
    ["unsupported speed", (p) => { p.proofs[0].text.en = "Find context faster."; }, /unsupported performance/],
    ["unsupported savings", (p) => { p.proofs[0].text.es = "Ahorra tiempo al volver."; }, /unsupported performance/],
    ["superiority", (p) => { p.hooks[0].en = "The best project memory."; }, /unsupported performance/],
    ["universal Spanish", (p) => { p.proofs[0].text.es = "Cualquier proyecto, con su contexto."; }, /unsupported performance/],
    ["universal English", (p) => { p.proofs[0].text.en = "Any project keeps its context."; }, /unsupported performance/],
    ["tutorial", (p) => { p.proofs[0].text.es = "Abre la memoria del proyecto."; }, /accessibility instruction/],
    ["cross-proof evidence", (p) => { p.proofs[0].facts = ["ui.project.result"]; }, /another proof/],
    ["unbound quote", (p) => { p.proofs[0].text.en = "{{fact:ui.project.result}}"; }, /not bound/],
    ["hook from later proof", (p) => { p.hooks[0].en = "{{fact:ui.project.result}}"; }, /not bound/],
    ["foreign fact", (p) => { p.proofs[0].text.es = "{{fact:readme.memories}}"; }, /wrong-language/],
    ["UI title pasted as copy", (p) => { p.proofs[0].text.es = "Mira: {{fact:ui.memory.result}}"; }, /source prose is evidence/],
    ["unobserved cause", (p) => { p.proofs[0].text.es = "Contexto claro gracias a su memoria."; }, /causal linkage/],
    ["wrong-language prose", (p) => { p.proofs[0].text.es = "Your project keeps its context."; }, /requested language/],
    ["missing translation", (p) => { delete p.proofs[0].text.es; }, /missing language/],
    ["unknown proof", (p) => { p.proofs[0].id = "removed"; }, /no longer supported/],
    ["duplicate proof", (p) => { p.proofs[1] = structuredClone(p.proofs[0]); }, /duplicate proof/],
    ["unreadable opening", (p) => { p.hooks[0].en = "Extraordinarily comprehensive contextual understanding for complex interconnected projects"; }, /55 characters|words/],
  ];
  for (const [name, change, reason] of cases) {
    const proposal = choice();
    change(proposal);
    for (const cached of [false, true]) {
      const source = input();
      const brain = fake(proposal);
      const result = await promoFor(brain, { ...source, ...(cached ? { cached: proposal } : {}) });
      assert.equal(result.decision.by, "arithmetic", `${name}, cached=${cached}`);
      assert.deepEqual(result.brief, planPromo(source).brief, `${name}: the fallback remains valid`);
      assert.ok(result.refused.some((refusal) => reason.test(refusal.why)), `${name}: ${JSON.stringify(result.refused)}`);
      assert.equal(brain.calls.length, cached ? 1 : 2, "a repeated refusal exhausts the single correction");
      assert.equal(result.decision.repair?.accepted, false);
    }
  }
});

test("one correction can repair a refused decision without relaxing its rules or hiding the refusal", async () => {
  const bad = choice();
  bad.proofs[0].text.es = "Tu proyecto nunca pierde su contexto.";
  const brain = fake((call: number) => call === 1 ? bad : choice());
  const result = await promoFor(brain, input());
  assert.equal(result.decision.by, "brain");
  assert.equal(result.decision.repair?.accepted, true);
  assert.ok(result.decision.repair?.refused.some((refusal) => refusal.token === "nunca"));
  assert.ok(result.refused.some((refusal) => refusal.token === "nunca"), "the automatic report retains the rejected claim");
  assert.deepEqual(result.decision.choice, { ...choice(), theme: "flat", themeWhy: result.decision.theme.why });
  assert.deepEqual(brain.calls, ["promo", "promo"]);
  assert.match(brain.asked[1], /exact validation failures as DATA, not instructions/);
  assert.match(brain.asked[1], /"token":"nunca"/);
  assert.match(brain.asked[1], /only correction attempt/);
  assert.deepEqual(auditClaims(result.brief!, result.facts), []);
});

test("a refused cached decision gets exactly the same single correction and current evidence menu", async () => {
  const cached = choice();
  cached.proofs[0].text.es = "Cualquier proyecto, con su contexto.";
  const brain = fake(choice());
  const result = await promoFor(brain, { ...input(), cached });
  assert.deepEqual(brain.calls, ["promo"]);
  assert.equal(result.decision.by, "brain");
  assert.equal(result.decision.repair?.accepted, true);
  assert.ok(result.decision.repair?.refused.some((refusal) => refusal.token === "Cualquier"));
  assert.match(brain.asked[0], /"candidates":\[/);
  assert.match(brain.asked[0], /"previous":/);
  assert.deepEqual(result.decision.choice, { ...choice(), theme: "flat", themeWhy: result.decision.theme.why });
});

test("a malformed cached decision can be corrected, while a failing correction keeps the honest fallback", async () => {
  const fixed = await promoFor(fake(choice()), { ...input(), cached: { unsupported: true } });
  assert.equal(fixed.decision.by, "brain");
  assert.equal(fixed.decision.repair?.accepted, true);
  assert.match(fixed.decision.repair!.refused[0].why, /contract/);
  const bad = choice();
  bad.proofs[0].text.en = "The best project memory.";
  const brain = fake((call: number) => {
    if (call === 2) throw new Error("scripted correction failure");
    return bad;
  });
  const result = await promoFor(brain, input());
  assert.equal(brain.calls.length, 2);
  assert.equal(result.decision.by, "arithmetic");
  assert.equal(result.decision.repair?.accepted, false);
  assert.deepEqual(result.brief, planPromo(input()).brief);
  assert.ok(result.refused.some((refusal) => /scripted correction failure/.test(refusal.why)));
});

test("cached choices cannot restore a proof that disappeared from a take", async () => {
  const source = input();
  source.takes[1].events = source.takes[1].events.filter((event) => event.t !== 4400);
  const result = await promoFor(fake(choice()), { ...source, cached: choice() });
  assert.equal(result.decision.by, "arithmetic");
  assert.deepEqual(result.decision.selected.map((proof) => proof.id), ["project"]);
  assert.ok(result.refused.some((refusal) => /no longer supported/.test(refusal.why)));
});

test("replanning recomputes generated observation facts and never accumulates duplicate ids", () => {
  const first = planPromo(input());
  const source = input();
  source.facts = { ...first.facts, facts: [...first.facts.facts, ...first.facts.facts] };
  namedOutcome(source, 0, "Project journal");
  const again = planPromo(source);
  assert.equal(again.facts.facts.find((fact) => fact.id === "ui.project.result")?.value, "Project journal");
  assert.equal(new Set(again.facts.facts.map((fact) => fact.id)).size, again.facts.facts.length);
  for (const candidate of promoCandidates(source).candidates) assert.equal(new Set(candidate.facts.map((fact) => fact.id)).size, candidate.facts.length);
});

test("missing footage refuses while a product without a public URL receives a sourced brand-only close", async () => {
  const noTape = { ...input(), takes: [] };
  assert.equal(planPromo(noTape).brief, undefined);
  assert.match(planPromo(noTape).why!, /real product click/);
  const noDestination = input();
  noDestination.facts = { ...facts, facts: facts.facts.filter((fact) => fact.id !== "url") };
  const brain = fake(choice());
  const result = await promoFor(brain, noDestination);
  assert.ok(result.brief);
  assert.equal(result.why, undefined);
  assert.deepEqual(brain.calls, ["promo"]);
  assert.deepEqual(result.brief.promo?.close, { kind: "brand", fact: "pkg.name", source: "package.json#name", reason: "no-public-destination" });
  assert.deepEqual(result.decision.close, result.brief.promo?.close);
  assert.equal(result.brief.lines.at(-1)?.id, "brand");
  assert.ok(!result.brief.lines.some((line) => line.id === "end"));
  assert.deepEqual(auditClaims(result.brief, result.facts), []);
  parseBrief(result.brief);
});

test("source identity beats starter names and provider setup URLs never become product destinations", () => {
  for (const url of ["https://makersuite.google.com/app/apikey", "https://console.firebase.google.com", "https://resend.com", "http://127.0.0.1:5173", "https://github.com/tu-usuario/menucard.git"]) {
    const source = input();
    source.facts = { ...source.facts, facts: [...source.facts.facts.filter((fact) => fact.id !== "url"),
      { id: "url", kind: "url", value: url, source: "README.md:42" },
      { id: "brand.name", kind: "text", value: "Ledgerly Games", source: "live:meta[name=application-name]" }] };
    const result = planPromo(source);
    assert.ok(result.brief, url);
    assert.deepEqual(result.decision.close, { kind: "brand", fact: "brand.name", source: "live:meta[name=application-name]", reason: "no-public-destination" });
    assert.equal(result.brief.lines.at(-1)!.text.en, "{{fact:brand.name}}");
  }
  const result = planPromo(input());
  assert.deepEqual(result.decision.close, { kind: "destination", fact: "url", source: "package.json#homepage" });
  assert.equal(result.brief!.lines.at(-1)!.text.es, "{{fact:url}}", "a valid source remains verbatim and translated tracks never rewrite its address");
});

test("brand-only model post copy can omit links and a stale link-bearing answer is refused", async () => {
  const source = input();
  source.facts = { ...source.facts, facts: source.facts.facts.filter((fact) => fact.id !== "url") };
  const result = planPromo(source);
  const good = { short: "Acme keeps context with projects.", x: "Context belongs with the project.", linkedin: "Find the context of your project.", youtubeTitle: "Acme project context", youtubeDescription: "Your work and its context. Acme.", hashtags: ["product"] };
  const brain = fake(good);
  const args = { brief: result.brief!, hook: result.brief!.hooks[0], lang: "en", targets: ["x"], facts: result.facts };
  assert.deepEqual(await kitFor(brain, args), good);
  assert.match(brain.asked[0], /Closing policy: brand only/);
  assert.equal(await kitFor(fake({ ...good, x: "Visit https://invented.example" }), args), null);
  assert.equal(await kitFor(fake({ ...good, short: "Link in bio." }), args), null);
});

test("the question separates persuasion from evidence and specifies short declarative copy", () => {
  const menu = promoCandidates(input());
  const question = promoQuestion({ product: profile.name, langs: ["en", "es"], candidates: menu.candidates });
  assert.equal(question.id, "promo");
  assert.match(question.user, /Pixel change proves something changed/);
  assert.match(question.user, /seven words and fifty-five characters/);
  assert.match(question.user, /FIRST proof/);
  assert.match(question.user, /No voiceover/);
  assert.match(question.user, /performance guarantees/);
  assert.match(question.system, /native promotional outcomes/);
  assert.doesNotMatch(question.system, /Never translate, shorten or paraphrase/);
  assert.match(question.user, /incidental counts are NOT quotable facts/);
  assert.match(question.user, /Do not stitch a translated prefix/);
});

test("focus is offered only for an isolated measured result that remains visible in every take", () => {
  const source = input();
  assert.equal(promoFocusAvailable(source.takes, "memory"), false, "a nearly full-page change needs its context");
  for (const take of source.takes) take.macros![1].change!.box = { x: 100, y: 100, width: 320, height: 220 };
  assert.equal(promoFocusAvailable(source.takes, "memory"), true);
  assert.deepEqual(promoCandidates(source).candidates[1].treatments, ["full", "focus", "split"]);
  for (const bad of [
    { x: -5, y: 100, width: 320, height: 220 },
    { x: 800, y: 100, width: 320, height: 220 },
    { x: 100, y: 100, width: 8, height: 220 },
    { x: 0, y: 0, width: 920, height: 500 },
  ]) {
    source.takes[1].macros![1].change!.box = bad;
    assert.equal(promoFocusAvailable(source.takes, "memory"), false, JSON.stringify(bad));
    assert.deepEqual(promoCandidates(source).candidates[1].treatments, ["full", "split"]);
  }
  assert.equal(promoFocusAvailable([], "memory"), false);
});

test("fallback presentation follows measured material and never inserts unrelated source commands", () => {
  const source = input();
  for (const take of source.takes) take.macros![1].change!.box = { x: 100, y: 100, width: 320, height: 220 };
  source.facts = { ...source.facts, facts: [...source.facts.facts,
    { id: "cmd.dev", kind: "command", value: "pnpm dev", source: "package.json#scripts.dev" },
  ] };
  const result = planPromo(source);
  assert.deepEqual(result.brief?.promo?.treatments, { "benefit-1": "full", "benefit-2": "focus" });
  assert.equal(result.brief?.promo?.recap, true);
  assert.equal(result.brief?.promo?.inserts, undefined);
  parseBrief(result.brief!);
});

test("source inserts require short verbatim language-compatible command or code facts", () => {
  const sheet: FactSheet = { ...facts, facts: [
    { id: "cmd", kind: "command", value: "acme context --project=local", source: "README.md:20" },
    { id: "code", kind: "code", value: "const project = catalog.find('acme');\nproject.context();", source: "README.md:40" },
    { id: "prose", kind: "text", value: "Build succeeded", source: "README.md:50" },
    { id: "wide", kind: "code", value: "a".repeat(71), source: "README.md:60" },
    { id: "long", kind: "code", value: "line\n".repeat(9), source: "README.md:70" },
    { id: "total", kind: "code", value: Array.from({ length: 8 }, () => "a".repeat(60)).join("\n"), source: "README.md:80" },
    { id: "escape", kind: "command", value: "acme\u001b[2J", source: "README.md:90" },
    { id: "language", kind: "code", value: "// Saved context", source: "README.md:100", lang: "en" },
    { id: "unsourced", kind: "code", value: "catalog.find()", source: "" },
  ] };
  assert.deepEqual(promoInsertCandidates(sheet, ["en", "es"]).map((entry) => [entry.fact.id, entry.kind]), [["cmd", "terminal"], ["code", "code"]]);
});

test("the brain can compose measured focus, explanation panels, a progressive recap and exact source excerpts", async () => {
  const source = splitFriendlyInput();
  for (const take of source.takes) take.macros![1].change!.box = { x: 100, y: 100, width: 320, height: 220 };
  source.facts = { ...source.facts, facts: [...source.facts.facts,
    { id: "cmd.context", kind: "command", value: "acme context --project=local", source: "README.md:20" },
    { id: "readme.code.1", kind: "code", value: "const project = catalog.find('acme');\nproject.context();", source: "README.md:40" },
  ] };
  const proposal = choice();
  proposal.proofs[0].treatment = "focus";
  proposal.proofs[1].treatment = "split";
  proposal.recap = true;
  proposal.inserts = [{ kind: "terminal", fact: "cmd.context", after: "memory" }, { kind: "code", fact: "readme.code.1", after: "project" }];
  const brain = fake(proposal);
  const result = await promoFor(brain, source);
  assert.deepEqual(result.refused, []);
  assert.equal(result.decision.by, "brain");
  assert.deepEqual(result.brief?.promo?.treatments, { "benefit-1": "focus", "benefit-2": "split" });
  assert.equal(result.brief?.promo?.recap, true);
  assert.deepEqual(result.brief?.promo?.inserts, [{ kind: "terminal", line: "insert-1", after: "benefit-1" }, { kind: "code", line: "insert-2", after: "benefit-2" }]);
  assert.equal(result.brief?.lines.filter((line) => line.mark).length, 2, "source inserts are not product demonstrations");
  assert.deepEqual(result.brief?.lines.find((line) => line.id === "insert-2"), { id: "insert-2", mode: "type", text: { en: "{{fact:readme.code.1}}", es: "{{fact:readme.code.1}}" } });
  assert.match(brain.asked[0], /"treatments":\["full","focus","split"\]/);
  assert.match(brain.asked[0], /"fact":\{"id":"cmd.context"/);
  parseBrief(result.brief!);
  assert.deepEqual(auditClaims(result.brief!, result.facts), []);
});

test("new and cached effect choices cannot invent regions, code, command output or ordering", async () => {
  const source = input();
  source.facts = { ...source.facts, facts: [...source.facts.facts,
    { id: "cmd.context", kind: "command", value: "acme context", source: "README.md:20" },
  ] };
  const cases: [(proposal: Promo) => void, RegExp][] = [
    [(p) => { p.proofs[0].treatment = "focus"; }, /treatment is not supported/],
    [(p) => { p.inserts = [{ kind: "terminal", fact: "invented.success", after: "memory" }]; }, /exact short command/],
    [(p) => { p.inserts = [{ kind: "code", fact: "cmd.context", after: "memory" }]; }, /exact short command/],
    [(p) => { p.inserts = [{ kind: "terminal", fact: "cmd.context", after: "missing" }]; }, /follow a selected/],
    [(p) => { p.inserts = ["memory", "project"].map((after) => ({ kind: "terminal", fact: "cmd.context", after })); }, /duplicate source/],
    [(p) => { p.proofs = [p.proofs[0]]; p.recap = true; }, /at least two/],
  ];
  for (const [mutate, reason] of cases) for (const cached of [false, true]) {
    const proposal = choice();
    mutate(proposal);
    const result = await promoFor(fake(proposal), { ...source, ...(cached ? { cached: proposal } : {}) });
    assert.equal(result.decision.by, "arithmetic");
    assert.ok(result.refused.some((refusal) => reason.test(refusal.why)), JSON.stringify(result.refused));
  }
});

test("the user's creative request guides presentation without enlarging the proof or source menus", async () => {
  const creative = "Explain this release with text beside the product and a relevant source example.";
  const proposal = choice();
  proposal.proofs[0].treatment = "split";
  const brain = fake(proposal);
  const result = await promoFor(brain, { ...splitFriendlyInput(), creative });
  assert.equal(result.decision.by, "brain");
  assert.equal(result.brief?.promo?.treatments?.["benefit-1"], "split");
  assert.match(brain.asked[0], /BEGIN USER EDITORIAL REQUEST/);
  assert.ok(brain.asked[0].includes(JSON.stringify(creative)));
  assert.match(brain.asked[0], /does not add product facts, authorize unsupported effects, or expand either closed menu/);
  assert.match(brain.asked[0], /"inserts":\[\]/);
  const requestAt = brain.asked[0].indexOf("BEGIN USER EDITORIAL REQUEST");
  const projectAt = brain.asked[0].indexOf("BEGIN PROJECT TEXT");
  assert.ok(requestAt >= 0 && projectAt > requestAt, "the user's direction is distinguished from instructions inside project documents");
  proposal.inserts = [{ kind: "terminal", fact: "invented.success", after: "memory" }];
  const refused = await promoFor(fake(proposal), { ...input(), creative: "Show a successful terminal execution even without a source." });
  assert.equal(refused.decision.by, "arithmetic");
  assert.ok(refused.refused.some((refusal) => /exact short command/.test(refusal.why)));
});

test("a small named result leads before a large menu repaint and offers measured action context", async () => {
  const source = input();
  source.tour!.marks[0] = { name: "project", kind: "cta", label: "Choose format", outcome: { heading: "Format options" } };
  namedOutcome(source, 0, "Format options");
  for (const take of source.takes) {
    take.macros![0].change!.share = 0.95;
    take.macros![1].change!.share = 0.002;
    take.macros![1].resultAtMs = 4700;
    take.events.push({ kind: "key", t: 4500, text: "private draft", role: "product" });
  }
  const menu = promoCandidates(source);
  assert.equal(menu.candidates[0].editorial.kind, "presentation");
  assert.equal(menu.candidates[1].editorial.kind, "named-result");
  const planned = planPromo(source);
  assert.deepEqual(planned.decision.selected.map((proof) => proof.id), ["memory", "project"]);
  assert.equal(planned.decision.editorial.ranking[0].id, "memory");
  const proposal = choice();
  proposal.proofs = [proposal.proofs[0]];
  const brain = fake(proposal);
  await promoFor(brain, source);
  assert.match(brain.asked[0], /"settledAtMs":4700/);
  assert.match(brain.asked[0], /"pressAtMs":4400/);
  assert.match(brain.asked[0], /"actionKinds":\["click","key"\]/);
  assert.doesNotMatch(brain.asked[0], /private draft/, "action types, not entered user text, reach the editorial question");
  assert.ok(brain.asked[0].indexOf('"id":"memory"') < brain.asked[0].indexOf('"id":"project"'));
});

test("a completed named destination can outrank its preparatory control wording", () => {
  const source = input();
  source.tour!.marks[0] = { name: "project", kind: "cta", label: "Choose format", outcome: { heading: "Exported document", route: "/document" } };
  namedOutcome(source, 0, "Exported document");
  assert.equal(promoCandidates(source).candidates[0].editorial.kind, "named-result");
  namedOutcome(source, 0, "Settings saved");
  assert.equal(promoCandidates(source).candidates[0].editorial.kind, "named-result", "the name of a completed settings state is not matched as a settings menu");
});

test("an explicit setup screen remains usable material but cannot outrank a named working result by area", () => {
  const source = input();
  for (const heading of ["Power panoma on, step by step", "Getting started", "Primeros pasos", "Configura Acme, paso a paso"]) {
    namedOutcome(source, 0, heading);
    const menu = promoCandidates(source);
    assert.equal(menu.candidates[0].editorial.kind, "setup");
    assert.equal(planPromo(source).decision.selected[0].id, "memory");
    const proposal = choice(); proposal.proofs.reverse();
    assert.ok(assessPromo(source, menu.facts, menu.candidates, proposal).issues.some((issue) => issue.code === "setup-lead" && !issue.repairable));
  }
  namedOutcome(source, 0, "Setup complete");
  assert.equal(promoCandidates(source).candidates[0].editorial.kind, "named-result");
});

test("known result timing informs pace without treating unknown timing as instant", () => {
  const source = input();
  for (const take of source.takes) for (const macro of take.macros!) macro.resultAtMs = macro.mark === "project" ? 1800 : 4700;
  assert.equal(planPromo(source).decision.pace, "crisp", "large area alone does not slow a result with measured direct settling");
  for (const take of source.takes) take.macros![0].resultAtMs = 3200;
  assert.equal(planPromo(source).decision.pace, "measured");
  for (const invalid of [NaN, -1, 6000]) {
    source.takes[0].macros![0].resultAtMs = invalid;
    assert.equal(promoCandidates(source).candidates[0].observation.takes[0].settledAtMs, undefined);
  }
});

test("fallback removes repeated recorded states, while model repetition remains a visible review issue", () => {
  const source = input();
  source.tour!.pages = [{ id: "start", path: "/", heading: "Projects", order: 0 }, { id: "same-result", path: "/notes", heading: "Project notes", order: 1 }];
  source.tour!.edges = ["project", "memory"].map((mark) => ({ from: "start", to: "same-result", mark, label: mark, kind: "cta" }));
  assert.equal(planPromo(source).decision.selected.length, 1);
  const menu = promoCandidates(source);
  const assessment = assessPromo(source, menu.facts, menu.candidates, choice());
  assert.equal(assessment.status, "needs-review");
  assert.ok(assessment.issues.some((issue) => issue.code === "repeated-result" && !issue.repairable));
  source.tour!.edges[1].to = "different-state";
  assert.equal(planPromo(source).decision.selected.length, 2, "equal headings alone never deduplicate independent recorded states");
});

test("generic or repeated model copy gets one bounded correction, including cached choices", async () => {
  for (const defect of ["generic", "benefit", "hook"] as const) for (const cached of [false, true]) {
    const bad = choice();
    if (defect === "generic") bad.hooks[0].es = "Mira lo que cambia.";
    if (defect === "benefit") bad.proofs[1].text.en = "Context stays with the project!";
    if (defect === "hook") bad.hooks.push({ ...bad.hooks[0] });
    const brain = fake((call) => cached || call > 1 ? choice() : bad);
    const result = await promoFor(brain, { ...input(), ...(cached ? { cached: bad } : {}) });
    assert.equal(result.decision.by, "brain");
    assert.equal(brain.calls.length, cached ? 1 : 2);
    assert.equal(result.decision.repair?.accepted, true);
    assert.ok(result.decision.repair?.refused.some((refusal) => /generic-hook|repeated-benefit|repeated-hook/.test(refusal.why)));
    assert.equal(result.decision.editorial.status, "needs-review");
    assert.deepEqual(result.decision.editorial.issues.map(issue => issue.code), ["missing-argument"], "legacy copy remains accepted while its missing explicit argument stays visible");
  }
  const bad = choice();
  bad.proofs[1].text.es = bad.proofs[0].text.es;
  const brain = fake(bad);
  const result = await promoFor(brain, input());
  assert.equal(brain.calls.length, 2);
  assert.equal(result.decision.by, "arithmetic");
  assert.equal(result.decision.editorial.status, "needs-review", "the observation-only fallback is not presented as creatively finished");
});

test("editorial warnings preserve a deliberate presentation lead without pretending it proves completion", async () => {
  const source = input();
  source.tour!.marks[1] = { name: "memory", kind: "flow", label: "Memory options", outcome: { heading: "Memory options" } };
  namedOutcome(source, 1, "Memory options");
  const result = await promoFor(fake(choice()), source);
  assert.equal(result.decision.by, "brain", "a named menu may be relevant; this lexical check cannot judge the full meaning");
  assert.ok(result.decision.editorial.issues.some((issue) => issue.code === "presentation-lead" && !issue.repairable));
  assert.match(result.decision.editorial.scope, /No claim of semantic entailment/);
});

test("revision validation preserves original observation copy without weakening reference checks", () => {
  const source = input();
  const planned = planPromo(source);
  const menu = promoCandidates(source);
  const original = planned.decision.choice;
  const preservedText = Object.fromEntries([...original.proofs.map((proof) => [proof.id, proof.text]), ...original.hooks.map((text, index) => [`hook-${index + 1}`, text])]);
  assert.ok(validatePromoChoice(source, menu.facts, menu.candidates, original).some((refusal) => /source prose/.test(refusal.why)));
  assert.deepEqual(validatePromoChoice(source, menu.facts, menu.candidates, original, { preservedText }), []);
  const changed = structuredClone(original);
  changed.proofs[0].text.en = "Your projects finish instantly.";
  assert.ok(validatePromoChoice(source, menu.facts, menu.candidates, changed, { preservedText }).some((refusal) => /performance/.test(refusal.why)));
  const stale = structuredClone(original);
  stale.proofs[0].facts = ["unknown.fact"];
  assert.ok(validatePromoChoice(source, menu.facts, menu.candidates, stale, { preservedText }).some((refusal) => /unknown|bound/.test(refusal.why)));
});
