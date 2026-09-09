import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import { z } from "zod";
import { renderMatrix, type EditorialTheme, type FactSheet } from "@panoma/video-core";
import { PromoShape, type Brain, type Promo, type Thesis } from "@panoma/video-brain";
import type { SessionLog } from "@panoma/video-capture";
import { auto, parseBrief, parsePromoTheme, retainedPromoTheme, planPromo, promoFor, proposePromoTheme, type PromoForInput } from "@panoma/video-director";
import type { TourScript } from "@panoma/video-tour";
import { BriefSchema as McpBriefSchema } from "../packages/mcp/src/schemas.ts";
import { autoInput, planInput, renderInput } from "../packages/mcp/src/tools/project.ts";

const facts: FactSheet = { project: "Acme", extractedAt: "2026-09-05T00:00:00Z", notFacts: [], facts: [
  { id: "pkg.name", kind: "text", value: "Acme", source: "package.json#name" },
  { id: "url", kind: "url", value: "https://acme.example", source: "package.json#homepage" },
  { id: "readme.notes", kind: "feature", value: "Projects contain their saved notes", source: "README.md:12" },
] };
function source(): PromoForInput {
  const tour: TourScript = { name: "acme", url: "http://127.0.0.1:5173/", createdAt: facts.extractedAt,
    steps: [{ goto: "http://127.0.0.1:5173/" }, { mark: "notes" }, { clickOn: "text=Notes" }],
    marks: [{ name: "notes", kind: "flow", label: "Notes", outcome: { heading: "Saved notes", route: "/notes" } }],
    candidates: [], snapshot: "", flow: { title: "Acme", steps: [] }, pages: [], edges: [] };
  const take: SessionLog = { name: "acme", take: "desktop", recordedAt: facts.extractedAt, isMobile: false,
    url: tour.url, viewport: { width: 960, height: 540 }, video: "/tmp/acme-theme-fixture.webm", durationMs: 4500, readyMs: 500, fps: 25,
    marks: [{ name: "notes", t: 1000 }], events: [{ t: 1400, kind: "click", x: 100, y: 100, role: "product" }],
    macros: [{ id: "notes", mark: "notes", t: 1000, file: "/tmp/acme-theme-notes.png", url: tour.url,
      viewport: { width: 960, height: 540 }, box: { x: 80, y: 90, width: 100, height: 40 }, pixelRatio: 4,
      resultHeading: { text: "Saved notes", box: { x: 90, y: 110, width: 250, height: 32 }, visibleShare: 1, centerVisible: true },
      change: { box: { x: 80, y: 90, width: 400, height: 250 }, share: 0.2, boxShare: 0.8 } }] };
  return { profile: { root: "/tmp/acme-theme-test", id: "acme-deadbeef", name: "Acme", kind: "web-app", commands: [], routes: [], docs: [], logoFiles: [], facts },
    facts: structuredClone(facts), tour, takes: [take], langs: ["en", "es"] };
}
function choice(theme?: EditorialTheme): Promo {
  return { audience: "People returning to a project", tension: "Notes belong beside their work", opening: "promise", pace: "crisp",
    hooks: [{ en: "Your notes stay with your project", es: "Tus notas acompañan al proyecto" }, { en: "Keep project notes together", es: "Reúne las notas del proyecto" }],
    proofs: [{ id: "notes", text: { en: "Notes belong with the project", es: "Las notas acompañan al proyecto" }, facts: ["readme.notes", "ui.notes.result"], why: "The recorded project opens its saved notes." }],
    why: "The notes panel shows the documented relationship to the project.", ...(theme ? { theme, themeWhy: "The concise message benefits from a consistent graphic register." } : {}) };
}
function brain(answer: Promo): Brain & { asked: string[] } {
  const asked: string[] = [];
  return { driver: "claude", model: "closed-fixture", how: "closed fixture", asked,
    async ask(question) { asked.push(question.user); return { value: question.shape.parse(answer), hit: false, ms: 0, model: "closed-fixture" }; },
    ledger() { throw new Error("No driver can be discovered by this fixture"); } };
}
const playful: Thesis = { what: { en: "A place for project notes" }, angle: { en: "Bring notes together" }, audience: "Project owners", interfaceLang: "en", verbs: [], show: { first: "Notes", flows: [], avoid: [] }, tone: "playful", why: "A playful product register" };

test("automatic themes use product register and proof pace conservatively, independently of music", () => {
  const input = source();
  assert.equal(proposePromoTheme(input, "crisp").id, "flat");
  const expressive = { ...input, thesis: playful };
  assert.equal(proposePromoTheme(expressive, "crisp").id, "vibrant");
  assert.equal(proposePromoTheme(expressive, "measured").id, "flat");
  assert.equal(proposePromoTheme({ ...expressive, profile: { ...input.profile, kind: "cli" } }, "crisp").id, "flat");
  const chromatic = { ...input, direction: { sound: { bpm: 120 }, name: "kinetic" as const, signal: "chromatic" as const } };
  assert.equal(proposePromoTheme(chromatic, "crisp").id, "vibrant");
  assert.equal(proposePromoTheme({ ...chromatic, thesis: { ...playful, tone: "technical" } }, "crisp").id, "flat");
  assert.deepEqual(planPromo({ ...expressive, music: { style: "dark", dance: "full" } }).decision.theme, planPromo(expressive).decision.theme);
});

test("Normal is the default even when a fresh or cached brain requests an expressive theme", async () => {
  for (const expressive of ["vibrant", "block", "grid"] as const) {
    const input = { ...source(), thesis: playful, creative: "An energetic graphic launch", music: { style: "bright" as const, dance: "full" as const } };
    const baseline = planPromo(input);
    assert.equal(baseline.brief!.promo!.theme, "flat");
    assert.equal(baseline.decision.theme.by, "default");
    const agent = brain(choice(expressive));
    const fresh = await promoFor(agent, input);
    assert.equal(fresh.brief!.promo!.theme, "flat");
    assert.equal(fresh.decision.theme.by, "default");
    assert.equal(fresh.decision.choice.theme, "flat");
    assert.match(agent.asked[0], /Normal \/ Flat is the default/);
    assert.match(agent.asked[0], /"mode":"default"/);
    assert.doesNotMatch(agent.asked[0], /"id":"(?:block|grid)"/);
    const cached = await promoFor(brain(choice(expressive)), { ...input, cached: choice(expressive) });
    assert.equal(cached.brief!.promo!.theme, "flat");
    assert.equal(cached.decision.theme.by, "default");
  }
});

test("only explicit auto permits expressive brain or arithmetic choices", async () => {
  const input = { ...source(), theme: "auto" as const, thesis: playful };
  const deterministic = await promoFor(null, input);
  assert.equal(deterministic.brief!.promo!.theme, "vibrant");
  assert.equal(deterministic.decision.theme.by, "arithmetic");
  const agent = brain(choice("block"));
  const result = await promoFor(agent, input);
  assert.equal(result.brief!.promo!.theme, "block");
  assert.equal(result.decision.theme.by, "brain");
  assert.match(agent.asked[0], /"mode":"auto"/);
  assert.match(agent.asked[0], /"id":"block"/);
  const next = await promoFor(brain(choice("block")), { ...source(), theme: retainedPromoTheme(undefined, result.decision) });
  assert.equal(next.brief!.promo!.theme, "flat");
  assert.equal(next.decision.theme.by, "default");
  assert.equal(retainedPromoTheme(undefined, deterministic.decision), undefined);
});

test("Grid is opt-in, persists as one user theme, and joins only the explicit automatic menu", async () => {
  const selected = await promoFor(null, { ...source(), theme: "grid" });
  assert.equal(selected.brief!.promo!.theme, "grid");
  assert.equal(selected.decision.theme.by, "user");
  assert.equal(retainedPromoTheme(undefined, selected.decision), "grid");
  const automatic = brain(choice("grid"));
  const result = await promoFor(automatic, { ...source(), theme: "auto" });
  assert.equal(result.brief!.promo!.theme, "grid");
  assert.equal(result.decision.theme.by, "brain");
  assert.equal(result.decision.theme.why, choice("grid").themeWhy);
  assert.match(automatic.asked[0], /"id":"grid"/);
  assert.match(automatic.asked[0], /first poster is already readable/);
  assert.match(automatic.asked[0], /Grid added graphics stay neutral regardless of brand accent/);
  assert.match(automatic.asked[0], /Prefer concise Grid hooks of three to six words/);
  assert.match(automatic.asked[0], /never choose a long code panel merely because the effect is available/);
  assert.match(automatic.asked[0], /Only added cards can bend/);
  assert.match(automatic.asked[0], /recorded product must never be distorted/);
  assert.equal(retainedPromoTheme(undefined, result.decision), undefined);
  assert.equal(renderMatrix(result.brief!, ["h", "v"]).length, 8);
  assert.equal(PromoShape.safeParse({ ...choice(), proofs: choice().proofs.map((proof) => ({ ...proof, theme: "grid" })) }).success, false);
});

test("one chosen theme survives every hook/language/format and records the effective author", async () => {
  const agent = brain(choice("vibrant"));
  const result = await promoFor(agent, { ...source(), theme: "auto" });
  assert.equal(result.decision.theme.id, "vibrant");
  assert.equal(result.decision.theme.by, "brain");
  assert.equal(result.brief?.promo?.theme, "vibrant");
  assert.equal(result.decision.choice.theme, "vibrant");
  assert.equal(renderMatrix(result.brief!, ["h", "v"]).length, 8);
  assert.ok(result.brief!.hooks.every((hook) => !("theme" in hook)));
  assert.ok(result.brief!.lines.every((line) => !("theme" in line)));
  assert.match(agent.asked[0], /Choose ONE editorial theme/);
  assert.match(agent.asked[0], /Source frames retain their original pixels and geometry/);
  assert.match(agent.asked[0], /Never combine themes within a film/);
  assert.match(agent.asked[0], /"proposal":\{"id":"flat"/);
});

test("manual themes override fresh and cached brain decisions, without a new cache call", async () => {
  for (const requested of ["normal", "flat", "vibrant", "block", "grid"] as const) {
    const canonical = requested === "normal" ? "flat" : requested;
    const opposite = canonical === "flat" ? "vibrant" : "flat";
    const fresh = brain(choice(opposite));
    const result = await promoFor(fresh, { ...source(), theme: requested });
    assert.equal(result.brief!.promo!.theme, canonical);
    assert.equal(result.decision.theme.by, "user");
    assert.match(fresh.asked[0], new RegExp(`"requested":"${canonical}"`));
    const cached = brain(choice(opposite));
    const replay = await promoFor(cached, { ...source(), theme: requested, cached: choice(opposite) });
    assert.equal(replay.brief!.promo!.theme, canonical);
    assert.equal(replay.decision.choice.theme, canonical);
    assert.equal(replay.decision.theme.by, "user");
    assert.equal(cached.asked.length, 0);
  }
});

test("saved user themes persist through replanning while explicit auto releases the choice", async () => {
  const initial = await promoFor(null, { ...source(), theme: "vibrant" });
  const kept = retainedPromoTheme(undefined, initial.decision);
  assert.equal(kept, "vibrant");
  const rendered = await promoFor(null, { ...source(), theme: kept });
  assert.equal(rendered.brief!.promo!.theme, "vibrant");
  assert.equal(rendered.decision.theme.by, "user");
  const reset = retainedPromoTheme("auto", rendered.decision);
  assert.equal(reset, "auto");
  const replanned = await promoFor(null, { ...source(), theme: reset });
  assert.equal(replanned.brief!.promo!.theme, "flat");
  assert.equal(replanned.decision.theme.by, "arithmetic");
  assert.equal(retainedPromoTheme(undefined, replanned.decision), undefined);
  assert.equal(retainedPromoTheme("flat", rendered.decision), "flat");
  assert.equal(retainedPromoTheme(undefined, { theme: { by: "brain", id: "vibrant" } }), undefined);
  assert.equal(retainedPromoTheme(undefined, { theme: { by: "user", id: "glass" } }), undefined);
});

test("explicit Block-based persists and the normal alias resets it to canonical flat", async () => {
  const selected = await promoFor(null, { ...source(), theme: "block" });
  assert.equal(selected.decision.theme.by, "user");
  const held = retainedPromoTheme(undefined, selected.decision);
  assert.equal(held, "block");
  const replay = await promoFor(brain(choice("vibrant")), { ...source(), theme: held });
  assert.equal(replay.brief!.promo!.theme, "block");
  const normal = await promoFor(null, { ...source(), theme: retainedPromoTheme("normal", replay.decision) });
  assert.equal(normal.brief!.promo!.theme, "flat");
  assert.equal(normal.decision.theme.by, "user");
  assert.equal(retainedPromoTheme(undefined, normal.decision), "flat");
});

test("legacy answers use the proposal only under explicit auto and legacy briefs stay normal", async () => {
  const legacy = await promoFor(brain(choice()), { ...source(), theme: "auto", thesis: playful, cached: choice() });
  assert.equal(legacy.decision.theme.id, "vibrant");
  assert.equal(legacy.decision.theme.by, "arithmetic");
  const brief = planPromo(source()).brief!;
  const { theme, ...promo } = brief.promo!;
  void theme;
  assert.equal(parseBrief({ ...brief, promo }).promo!.theme, undefined);
  const withoutBrain = await promoFor(null, { ...source(), cached: choice("vibrant") });
  assert.equal(withoutBrain.decision.theme.id, "flat");
  assert.equal(withoutBrain.decision.theme.by, "default");
});

test("every contract refuses unsupported or mixed themes instead of silently dropping them", () => {
  const brief = planPromo(source()).brief!;
  for (const theme of ["flat", "vibrant", "block", "grid"] as const) {
    const selected = { ...brief, promo: { ...brief.promo!, theme } };
    assert.equal(parseBrief(selected).promo!.theme, theme);
    assert.equal(McpBriefSchema.parse(selected).promo!.theme, theme);
  }
  const brandClose = { kind: "brand", fact: "brand.name", source: "brand.patch.json#name", reason: "no-public-destination" } as const;
  const branded = { ...brief, promo: { ...brief.promo!, close: brandClose } };
  assert.deepEqual(McpBriefSchema.parse(branded).promo!.close, parseBrief(branded).promo!.close);
  assert.equal(McpBriefSchema.safeParse({ ...branded, promo: { ...branded.promo, close: { ...brandClose, reason: "guessed" } } }).success, false);
  const malformed = [
    { ...brief, promo: { ...brief.promo, theme: "liquid-glass" } },
    { ...brief, promo: { ...brief.promo, themes: ["flat", "vibrant"] } },
    { ...brief, lines: brief.lines.map((line) => ({ ...line, theme: "flat" })) },
    { ...brief, promo: { ...brief.promo, inserts: [{ kind: "code", line: "code", after: "benefit-1", theme: "vibrant" }] } },
  ];
  for (const value of malformed) {
    assert.throws(() => parseBrief(value));
    assert.equal(McpBriefSchema.safeParse(value).success, false);
  }
  assert.equal(PromoShape.safeParse({ ...choice(), theme: "clay" }).success, false);
  assert.equal(PromoShape.safeParse({ ...choice(), themes: ["flat", "vibrant"] }).success, false);
  assert.equal(PromoShape.safeParse({ ...choice(), proofs: choice().proofs.map((proof) => ({ ...proof, theme: "flat" })) }).success, false);
  for (const shape of [autoInput, planInput, renderInput]) {
    assert.equal(z.object(shape).safeParse({ project_path: "/tmp/app", brief_id: "acme-promo", theme: "vibrant" }).success, true);
    assert.equal(z.object(shape).safeParse({ project_path: "/tmp/app", brief_id: "acme-promo", theme: "block" }).success, true);
    assert.equal(z.object(shape).safeParse({ project_path: "/tmp/app", brief_id: "acme-promo", theme: "grid" }).success, true);
    assert.equal(z.object(shape).safeParse({ project_path: "/tmp/app", brief_id: "acme-promo", theme: "normal" }).success, true);
    assert.equal(z.object(shape).safeParse({ project_path: "/tmp/app", brief_id: "acme-promo", theme: "glass" }).success, false);
  }
});

test("invalid or inapplicable options fail before the pipeline reads the project", async () => {
  for (const value of ["flat,vibrant", "liquid-glass", "", null, ["flat", "vibrant"]]) assert.throws(() => parsePromoTheme(value), /theme must be/);
  assert.equal(parsePromoTheme(undefined), undefined);
  assert.equal(parsePromoTheme("normal"), "flat");
  const stages: string[] = [];
  await assert.rejects(auto({ root: "/missing-theme-test-project", theme: "bad" as never, brain: "none", onProgress: (stage) => stages.push(stage) }), /theme must be/);
  await assert.rejects(auto({ root: "/missing-theme-test-project", goal: "tutorial", theme: "flat", brain: "none", onProgress: (stage) => stages.push(stage) }), /theme applies only/);
  assert.deepEqual(stages, []);
});

test("the CLI refuses malformed or ignored theme flags before scouting", async () => {
  const run = promisify(execFile);
  for (const args of [
    ["promo", "--theme=glass"], ["promo", "--theme=flat=oops"], ["promo", "--theme"],
    ["promo", "--theme=flat", "--theme=vibrant"], ["auto", "--goal=tutorial", "--theme=flat"], ["render", "--theme=vibrant"],
  ]) {
    await assert.rejects(run(process.execPath, ["apps/cli/src/panoma-video.ts", ...args, "--brain=none"], { timeout: 15000, env: { ...process.env, PANOMA_VIDEO_BRAIN: "none" } }), (error: unknown) => {
      const result = error as { stdout: string; stderr: string; code: number };
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /theme/);
      assert.doesNotMatch(result.stdout, /scout:/);
      return true;
    });
  }
});

test("panoma-video themes exposes the style and motion catalog without starting the pipeline", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["apps/cli/src/panoma-video.ts", "themes"], { timeout: 15000, env: { ...process.env, PANOMA_VIDEO_BRAIN: "none" } });
  for (const label of ["Normal / Flat", "Vibrant", "Block-based", "Grid / Assembly", "alias: normal; default", "--theme=auto"]) assert.ok(stdout.includes(label));
  assert.equal((stdout.match(/Motion:/g) ?? []).length, 4);
  assert.match(stdout, /Automatic choices do not enable expressive themes on later planning runs that omit the option/);
  assert.doesNotMatch(stdout, /scout:|render:|brain:/);
});
