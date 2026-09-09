import assert from "node:assert/strict";
import { test } from "node:test";
import type { Brief, FactSheet, RenderPlan } from "@panoma/video-core";
import type { SessionLog } from "@panoma/video-capture";
import { promoChecks } from "../packages/director/src/promo-checks.ts";

const facts: FactSheet = { project: "catalog", extractedAt: "2026-09-05", facts: [
  { id: "name", kind: "text", value: "Catalog", source: "package.json" },
  { id: "url", kind: "url", value: "https://catalog.test", source: "README.md" },
  { id: "ui.open.result", kind: "feature", value: "Project context", source: "interface:#open" },
], notFacts: [] };
const brief: Brief = { id: "catalog-promo", recipe: "ProductPromo", langs: ["en"], bpm: 120, job: "sell",
  hooks: [{ id: "hook", mode: "type", text: { en: "Find your project context." } }],
  lines: [{ id: "benefit", mark: "open", mode: "type", text: { en: "{{fact:ui.open.result}}" } },
    { id: "brand", mode: "type", text: { en: "{{fact:name}}" } }, { id: "end", mode: "type", text: { en: "{{fact:url}}" } }],
  promo: { opening: "promise", pace: "crisp", evidence: { hook: { mark: "open", facts: ["ui.open.result"] }, benefit: { mark: "open", facts: ["ui.open.result"] } } } };
const take: SessionLog = { name: "catalog", take: "desktop", recordedAt: "2026-09-05", isMobile: false, fps: 25,
  url: "https://catalog.test", viewport: { width: 1280, height: 720 }, video: "desktop.webm", durationMs: 5000, readyMs: 500,
  marks: [{ name: "open", t: 1000 }], events: [{ kind: "click", t: 1500, x: 300, y: 200, role: "product" }],
  macros: [{ id: "open", mark: "open", t: 1000, file: "open.png", url: "https://catalog.test", viewport: { width: 1280, height: 720 }, box: { x: 200, y: 150, width: 200, height: 100 }, pixelRatio: 2,
    change: { share: 0.2, boxShare: 0.3, box: { x: 200, y: 150, width: 600, height: 400 } } }] };
const plan: RenderPlan = { recipe: "ProductPromo", lang: "en", fps: 30, durationInFrames: 285,
  beats: { beatFrames: 15, barFrames: 60, start: 0 }, cuts: [], holds: [], fades: [],
  cards: [{ from: 0, to: 45, text: "hook" }, { from: 180, to: 225, text: "benefit" }, { from: 225, to: 285, text: "end" }],
  uses: [{ id: "benefit", mark: "open", from: 45, to: 180, actionFrame: 70, resultFrame: 120, evidence: ["ui.open.result"] }] };
const menu = [{ id: "open", facts: facts.facts.filter((fact) => fact.id === "ui.open.result") }];
const check = (overrides: Partial<Parameters<typeof promoChecks>[0]> = {}) => promoChecks({ brief, facts, takes: [take], plan, promoCandidates: menu, ...overrides });

test("a short sales film passes on its own evidence, without the release trailer's fixed furniture", () => {
  assert.deepEqual(check().filter((c) => c.status !== "pass"), []);
});

test("brand-only review requires the sourced identity and the actual rendered closing card", () => {
  const localFacts: FactSheet = { ...facts, facts: facts.facts.filter((fact) => fact.id !== "url").map((fact) => fact.id === "name" ? { ...fact, id: "pkg.name" } : fact) };
  const close = { kind: "brand" as const, fact: "pkg.name", source: "package.json", reason: "no-public-destination" as const };
  const local: Brief = { ...brief, lines: brief.lines.filter((line) => line.id !== "end").map((line) => line.id === "brand" ? { ...line, text: { en: "{{fact:pkg.name}}" } } : line), promo: { ...brief.promo!, close } };
  const rendered: RenderPlan = { ...plan, promoClose: close, cards: [...plan.cards.slice(0, -1), { id: "end", from: 225, to: 285, text: "Catalog" }] };
  const result = check({ brief: local, facts: localFacts, plan: rendered });
  assert.deepEqual(result.filter((entry) => entry.status !== "pass"), []);
  assert.match(result.find((entry) => entry.id === "promo.destination")!.summary, /no public destination/);
  assert.equal(check({ brief: { ...local, lines: [...local.lines, brief.lines.at(-1)!] }, facts: localFacts, plan: undefined }).find((entry) => entry.id === "promo.destination")?.status, "fail");
  assert.equal(check({ brief: local, facts: localFacts, plan: { ...rendered, cards: plan.cards } }).find((entry) => entry.id === "promo.rendered-close")?.status, "fail");
  assert.equal(check({ brief: local, facts: localFacts, plan: { ...rendered, promoClose: undefined } }).find((entry) => entry.id === "promo.rendered-close")?.status, "fail");
  assert.equal(check({ brief: local, facts: localFacts, plan: { ...rendered, cards: [...rendered.cards.slice(0, -1), { ...rendered.cards.at(-1)!, from: 284 }] } }).find((entry) => entry.id === "promo.readable-cards")?.status, "fail", "brand-only cards must still pass the reading-speed check despite having no end source line");
  assert.equal(check({ brief: { ...local, promo: { ...local.promo!, close: { ...close, source: "invented" } } }, facts: localFacts, plan: undefined }).find((entry) => entry.id === "promo.destination")?.status, "fail");
});
test("an attractive render cannot pass when its click was chrome or the second take has no result", () => {
  const chrome = { ...take, events: [{ ...take.events[0], role: "chrome" }] } as SessionLog;
  assert.equal(check({ takes: [chrome] }).find((c) => c.id === "promo.recorded-result")?.status, "fail");
  assert.equal(check({ takes: [take, { ...take, take: "mobile", macros: [] }] }).find((c) => c.id === "promo.recorded-result")?.status, "fail");
});
test("a cropped-away result and a detached claim are both actionable failures", () => {
  const cropped = { ...plan, uses: [{ ...plan.uses![0], resultFrame: 179 }] };
  assert.equal(check({ plan: cropped }).find((c) => c.id === "promo.cause-and-result")?.fix?.by, "engine");
  const detached = { ...brief, promo: { ...brief.promo!, evidence: { ...brief.promo!.evidence, hook: { mark: "other", facts: ["ui.open.result"] } } } };
  assert.equal(check({ brief: detached }).find((c) => c.id === "promo.evidence")?.status, "fail");
});
test("a delayed opening and an unreadable payoff do not hide behind a clean encode", () => {
  assert.equal(check({ plan: { ...plan, cards: [{ from: 0, to: 120, text: "hook" }] } }).find((c) => c.id === "promo.early-value")?.status, "fail");
  assert.equal(check({ plan: { ...plan, cards: [{ from: 0, to: 1, text: "hook" }] } }).find((c) => c.id === "promo.readable-cards")?.status, "fail");
  assert.equal(check({ plan: { ...plan, cards: [{ from: 225, to: 240, id: "end", text: "Catalog\nhttps://catalog.test" }] } }).find((c) => c.id === "promo.readable-cards")?.status, "fail", "the actual brand and URL count, not the source line id");
});

test("a patch cannot borrow another source's credibility for a recorded click", () => {
  const unrelated = { ...brief, hooks: [{ ...brief.hooks[0], text: { en: "{{fact:name}}" } }], promo: { ...brief.promo!, evidence: { ...brief.promo!.evidence, hook: { mark: "open", facts: ["name"] } } } };
  assert.equal(check({ brief: unrelated }).find((c) => c.id === "promo.evidence")?.status, "fail");
  assert.equal(check({ promoCandidates: undefined }).find((c) => c.id === "promo.evidence")?.status, "fail", "a missing proof menu cannot vouch for a claim");
});

test("focus depends on the measured result in every take and a recap cannot fabricate a second benefit", () => {
  const focused: Brief = { ...brief, promo: { ...brief.promo!, treatments: { benefit: "focus" } } };
  const focusedPlan: RenderPlan = { ...plan, uses: plan.uses!.map((use) => ({ ...use, treatment: "focus" })) };
  assert.deepEqual(check({ brief: focused, plan: focusedPlan }).filter((c) => c.status !== "pass"), []);
  const outOfFrame = structuredClone(take);
  outOfFrame.macros![0].change!.box.x = 1000;
  assert.equal(check({ brief: focused, takes: [take, outOfFrame] }).find((c) => c.id === "promo.treatments")?.status, "fail");
  assert.equal(check({ brief: { ...brief, promo: { ...brief.promo!, recap: true } } }).find((c) => c.id === "promo.treatments")?.status, "fail");
  assert.equal(check({ brief: focused }).find((c) => c.id === "promo.rendered-treatments")?.status, "fail", "a plan cannot silently discard the chosen focus");
});

test("source cards cannot be patched into fabricated commands or successful terminal output", () => {
  const sourceFacts: FactSheet = { ...facts, facts: [...facts.facts,
    { id: "cmd.context", kind: "command", value: "catalog context --project=local", source: "README.md:20" },
  ] };
  const withInsert: Brief = { ...brief, lines: [...brief.lines, { id: "insert", mode: "type", text: { en: "{{fact:cmd.context}}" } }],
    promo: { ...brief.promo!, inserts: [{ kind: "terminal", line: "insert", after: "benefit" }] } };
  const result = (candidate: Brief) => check({ brief: candidate, facts: sourceFacts, plan: undefined }).find((c) => c.id === "promo.source-inserts")?.status;
  assert.equal(result(withInsert), "pass");
  for (const text of ["catalog context --project=local", "{{fact:cmd.context}}\nBuild succeeded", "{{fact:cmd.context}} {{fact:cmd.context}}", "{{fact:ui.open.result}}", "{{fact:missing}}"])
    assert.equal(result({ ...withInsert, lines: withInsert.lines.map((line) => line.id === "insert" ? { ...line, text: { en: text } } : line) }), "fail", text);
  assert.equal(result({ ...withInsert, promo: { ...withInsert.promo!, inserts: [{ kind: "code", line: "insert", after: "benefit" }] } }), "fail");
  assert.equal(result({ ...withInsert, promo: { ...withInsert.promo!, inserts: [{ kind: "terminal", line: "insert", after: "missing" }] } }), "fail");
  assert.equal(result({ ...withInsert, promo: { ...withInsert.promo!, inserts: [] } }), "fail", "unattached source lines cannot escape review");
  assert.equal(check({ brief: withInsert, facts: sourceFacts, plan: undefined }).find((c) => c.id === "promo.one-idea")?.status, "pass", "an insert never counts as a recorded proof");
});

test("a split explanation needs exact copy with a readable window and cannot disappear from the plan", () => {
  const split: Brief = { ...brief, promo: { ...brief.promo!, treatments: { benefit: "split" } } };
  const text: NonNullable<RenderPlan["texts"]>[number] = { id: "benefit", kind: "split", from: 45, to: 180, readFrom: 45, text: "Project context" };
  const splitPlan: RenderPlan = { ...plan, uses: plan.uses!.map((use) => ({ ...use, treatment: "split" })), texts: [text] };
  assert.deepEqual(check({ brief: split, plan: splitPlan }).filter((c) => c.status !== "pass"), []);
  for (const texts of [[], [{ ...text, readFrom: 179 }], [{ ...text, text: "Guaranteed successful build" }], [text, text]])
    assert.equal(check({ brief: split, plan: { ...splitPlan, texts } }).find((c) => c.id === "promo.readable-effects")?.status, "fail");
});

test("typed source inserts keep reading time after the final character lands", () => {
  const sourceFacts: FactSheet = { ...facts, facts: [...facts.facts,
    { id: "code.example", kind: "code", value: "const project = catalog.find('local');", source: "README.md:22" },
  ] };
  const withCode: Brief = { ...brief, lines: [...brief.lines, { id: "code", mode: "type", text: { en: "{{fact:code.example}}" } }],
    promo: { ...brief.promo!, inserts: [{ kind: "code", line: "code", after: "benefit" }] } };
  const text: NonNullable<RenderPlan["texts"]>[number] = { id: "code", kind: "code", from: 180, readFrom: 210, to: 270, text: sourceFacts.facts.at(-1)!.value };
  const rendered: RenderPlan = { ...plan, texts: [text] };
  assert.equal(check({ brief: withCode, facts: sourceFacts, plan: rendered }).find((c) => c.id === "promo.readable-effects")?.status, "pass");
  assert.equal(check({ brief: withCode, facts: sourceFacts, plan: { ...rendered, texts: [{ ...text, readFrom: 269 }] } }).find((c) => c.id === "promo.readable-effects")?.status, "fail");
});

test("Grid review accepts one matching theme and rejects a stale or unsupported theme plan", () => {
  const grid: Brief = { ...brief, promo: { ...brief.promo!, theme: "grid" } };
  const matching: RenderPlan = { ...plan, editorialTheme: "grid" };
  const status = (candidate: Brief, rendered: RenderPlan) => check({ brief: candidate, plan: rendered }).find((entry) => entry.id === "promo.theme");
  assert.equal(status(grid, matching)?.status, "pass");
  assert.equal(status(grid, plan)?.status, "fail");
  assert.equal(status(brief, matching)?.status, "fail");
  assert.equal(status({ ...grid, promo: { ...grid.promo!, theme: "invented" as never } }, { ...matching, editorialTheme: "invented" as never })?.status, "fail");
});
