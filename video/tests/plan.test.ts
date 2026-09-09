/*
  The plan is where an automatic video either makes sense or becomes a slideshow. These
  fixtures are a small web app as the scout and the tour would describe it; the
  assertions are the promises: claims bind to moments that changed the interface, a
  trailer needs two of them, every number is a fact, a patch survives regeneration.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FactSheet } from "@panoma/video-core";
import { detectLang, enrichFacts, isName, planBriefs, slotsOf, missingMarks, parseBrief } from "@panoma/video-director";
import type { ProjectProfile } from "@panoma/video-scout";
import type { TourScript } from "@panoma/video-tour";
import { promoCandidates } from "../packages/director/src/promo.ts";

const profile: ProjectProfile = {
  root: "/tmp/acme",
  id: "acme-deadbeef",
  name: "acme",
  version: "1.4.0",
  kind: "web-app",
  framework: { id: "next", name: "Next.js", source: "package.json#dependencies.next" },
  commands: [{ purpose: "start", command: "pnpm run dev", source: "package.json#scripts.dev" }],
  routes: [{ path: "/", dynamic: false, source: "app/page.tsx" }],
  docs: ["README.md"],
  git: { head: "abc1234", commits: 31, days: 30, subjects: ["feat: add project memory", "fix: catalog no longer loses projects", "feat(ui): dark mode"], lastTag: "v1.4.0", tags: [{ name: "v1.4.0", date: "2026-08-30" }] },
  logoFiles: [],
  facts: { project: "acme", extractedAt: "2026-09-01T00:00:00Z", facts: [], notFacts: [] },
};

const facts: FactSheet = {
  project: "acme",
  extractedAt: "2026-09-01T00:00:00Z",
  head: "abc1234",
  facts: [
    { id: "pkg.name", kind: "text", value: "acme", source: "package.json#name" },
    { id: "pkg.version", kind: "version", value: "1.4.0", source: "package.json#version" },
    { id: "readme.tagline", kind: "text", value: "The local catalog of your projects", source: "README.md:3" },
    { id: "readme.section.installation", kind: "feature", value: "Installation", source: "README.md:10" },
    { id: "cmd.install", kind: "command", value: "npx acme up ~", source: "README.md:14" },
    { id: "changelog.version", kind: "version", value: "1.4.0", source: "CHANGELOG.md:5" },
    { id: "changelog.added.1", kind: "feature", value: "Project memory that updates itself", source: "CHANGELOG.md:7" },
    { id: "changelog.fixed.1", kind: "text", value: "The catalog no longer loses projects", source: "CHANGELOG.md:9" },
    { id: "git.commits.30d", kind: "number", value: "31", source: "git:log:--since=30 days" },
    { id: "git.lastTag", kind: "version", value: "v1.4.0", source: "git:tag:v1.4.0" },
    { id: "route.root", kind: "route", value: "/", source: "app/page.tsx" },
    { id: "url", kind: "url", value: "https://acme.example", source: "package.json#homepage" },
  ],
  notFacts: [{ value: "Windows support is coming next month", source: "docs/roadmap.md:3", why: "roadmap item" }],
};

const tour: TourScript = {
  name: "acme-deadbeef",
  url: "http://127.0.0.1:5173/",
  createdAt: "2026-09-01T00:00:00Z",
  steps: [{ goto: "http://127.0.0.1:5173/" }, { mark: "hero" }, { mark: "features" }, { scrollTo: "text=Features" }, { mark: "get-started" }, { clickOn: 'role=link[name="Get started"s]' }, { mark: "memory" }, { clickOn: 'role=button[name="Open project memory"s]' }],
  marks: [
    { name: "hero", label: "acme", kind: "hero" },
    { name: "features", label: "Features", kind: "section" },
    { name: "get-started", label: "Get started", kind: "cta", target: { x: 800, y: 500, w: 160, h: 48 } },
    { name: "memory", label: "Open project memory", kind: "flow", target: { x: 300, y: 400, w: 200, h: 40 } },
  ],
  candidates: [
    { selector: 'role=link[name="Get started"s]', description: "Get started", method: "click", box: { x: 800, y: 500, w: 160, h: 48 }, score: 90, reasons: ["verb", "above the fold"] },
    { selector: 'role=button[name="Open project memory"s]', description: "Open project memory", method: "click", box: { x: 300, y: 400, w: 200, h: 40 }, score: 60, reasons: ["verb"] },
  ],
  snapshot: "- main:\n  - heading \"acme\"",
  flow: { title: "acme", steps: [] },
  pages: [],
  edges: [],
};

test("languages are detected on prose facts and the fix count is derived with a source", () => {
  const rich = enrichFacts(facts, profile);
  assert.equal(rich.facts.find((f) => f.id === "readme.tagline")?.lang, "en");
  assert.equal(rich.facts.find((f) => f.id === "cmd.install")?.lang, undefined);
  const fixes = rich.facts.find((f) => f.id === "derived.fixes");
  assert.equal(fixes?.value, "1");
  assert.match(fixes?.source ?? "", /CHANGELOG/);
  assert.equal(detectLang("Tu disco, catalogado en local para tus agentes"), "es");
});

test("a web app with two bound proofs earns a trailer and a tutorial; every line is fact-clean", () => {
  const plan = planBriefs({ profile, facts, tour, langs: ["en", "es"] });
  assert.deepEqual(plan.make.map((g) => g.goal).sort(), ["changelog", "spotlight", "trailer", "tutorial"]);
  const trailer = plan.briefs.find((b) => b.goal === "trailer")!;
  assert.ok(trailer, "trailer written");
  assert.equal(trailer.brief.recipe, "ReleaseTrailer");
  const marked = trailer.brief.lines.filter((l) => l.mark).map((l) => l.mark);
  /* The section scroll proves nothing for a web app: only the CTA and the flow are cards. */
  assert.deepEqual(new Set(marked), new Set(["get-started", "memory"]));
  assert.ok(trailer.brief.lines.some((l) => l.id === "ticker" && /derived\.fixes/.test(l.text.en)));
  assert.ok(trailer.brief.lines.some((l) => l.id === "status"));
  assert.deepEqual(trailer.claims, [], JSON.stringify(trailer.claims));
  const spotlight = plan.briefs.find((b) => b.goal === "spotlight")!;
  assert.ok(spotlight, "spotlight written");
  assert.equal(spotlight.brief.recipe, "FeatureSpotlight");
  assert.deepEqual(new Set(spotlight.brief.lines.filter((l) => l.mark).map((l) => l.mark)), new Set(["get-started", "memory"]));
  assert.ok(!spotlight.brief.lines.some((l) => l.id === "ticker" || l.id === "status"), "release furniture stays out of a product film");
  assert.deepEqual(spotlight.claims, [], JSON.stringify(spotlight.claims));
  const tutorial = plan.briefs.find((b) => b.goal === "tutorial")!;
  assert.deepEqual(tutorial.claims, []);
  /* The English tagline opens the English cut; the Spanish cut opens on the plain sentence. */
  assert.match(tutorial.brief.hooks[0].text.en, /readme\.tagline/);
  assert.match(tutorial.brief.hooks[0].text.es, /Esto es/);
  assert.ok(tutorial.brief.lines.every((l) => (l.text.en.split(/\s+/).length <= 12)));
  /* The button's own name is a fact of the interface, quoted by id. */
  assert.ok(tutorial.brief.lines.some((l) => l.mark === "get-started" && /\{\{fact:ui\.get-started\}\}/.test(l.text.en)));
  assert.equal(plan.facts.facts.find((f) => f.id === "ui.get-started")?.value, "Get started");
  for (const b of plan.briefs) parseBrief(b.brief);
});

test("a tutorial says what the step DOES, in the interface's own words, with the page as the source", () => {
  /*
    The walker refuses to mark a click that changed nothing, so the heading the page
    showed afterwards is an observation, not a guess. This is the half of a tutorial
    sentence every other tool has to invent.
  */
  const seen: TourScript = {
    ...tour,
    marks: tour.marks.map((m) =>
      m.name === "get-started" ? { ...m, outcome: { heading: "Your catalog", route: "/start" } } : m,
    ),
  };
  const savedFacts: FactSheet = { ...facts, facts: [...facts.facts,
    { id: "ui.get-started.result", kind: "feature", value: "An older heading", source: "interface:old#step" },
    { id: "ui.removed.result", kind: "feature", value: "A removed result", source: "interface:old#removed" },
  ] };
  const plan = planBriefs({ profile, facts: savedFacts, tour: seen, langs: ["en", "es"] });
  const tutorial = plan.briefs.find((b) => b.goal === "tutorial")!;
  assert.deepEqual(tutorial.claims, [], JSON.stringify(tutorial.claims));

  const outcome = plan.facts.facts.find((f) => f.id === "ui.get-started.result")!;
  assert.equal(outcome.value, "Your catalog");
  assert.equal(plan.facts.facts.find(fact => fact.id === "ui.removed.result"), undefined,
    "merging a promo's observations must not revive removed tour facts");
  assert.match(outcome.source, /^interface:/, "the page it was read from is the source");
  /* No language on an interface string: a Spanish tutorial still says the letters on the button. */
  assert.equal(outcome.lang, undefined);
  const promo = promoCandidates({ profile, facts: plan.facts, tour: seen, takes: [], langs: ["en", "es"] });
  assert.equal(promo.facts.facts.find(fact => fact.id === outcome.id), undefined,
    "the shared sheet preserves the tutorial observation without granting a promo an unwitnessed result");

  const click = tutorial.brief.lines.find((l) => l.mark === "get-started")!;
  assert.match(click.text.en, /\{\{fact:ui\.get-started\}\}.*\{\{fact:ui\.get-started\.result\}\}/);
  assert.match(click.text.es, /^Pulsa \{\{fact:ui\.get-started\}\} y se abre/);
  /* The chip carries the control's own name when it is short enough to be a chip. */
  assert.equal(click.label?.en, "{{fact:ui.get-started}}");

  /* A step with no observed outcome says less rather than guessing one. */
  const blind = plan.briefs.find((b) => b.goal === "tutorial")!.brief.lines.find((l) => l.mark === "memory")!;
  assert.doesNotMatch(blind.text.en, /\.result/);

  /* The spotlight carries the same observation beside its claim, by fact id, and only where one was made. */
  const spotlight = plan.briefs.find((b) => b.goal === "spotlight")!;
  assert.deepEqual(spotlight.claims, [], JSON.stringify(spotlight.claims));
  assert.equal(spotlight.brief.lines.find((l) => l.mark === "get-started")?.result?.en, "{{fact:ui.get-started.result}}");
  assert.equal(spotlight.brief.lines.find((l) => l.mark === "memory")?.result, undefined);
  for (const b of plan.briefs) parseBrief(b.brief);

  /* A section is context: it earns a step only while the piece is short of actions. */
  assert.ok(tutorial.brief.lines.some((l) => l.mark === "features" && /\{\{fact:ui\.features\}\}/.test(l.text.en)));
  const busy: TourScript = {
    ...seen,
    marks: [...seen.marks, { name: "cta-2", label: "Import", kind: "cta" as const }, { name: "cta-3", label: "Export", kind: "cta" as const }, { name: "cta-4", label: "Share", kind: "cta" as const }],
  };
  const full = planBriefs({ profile, facts, tour: busy, langs: ["en"] }).briefs.find((b) => b.goal === "tutorial")!;
  assert.ok(!full.brief.lines.some((l) => l.mark === "features"), "with five actions the sections stand down");
});

test("a landing page's headings are prose, and prose is never quoted as a control's name", () => {
  /*
    Measured on this project's own site: its h2s are whole sentences and one of its
    buttons wraps a paragraph. Quoting those gives a narrator reading advertising
    copy with "Then" in front of it — the slideshow this layer exists to refuse,
    arriving through a side door.
  */
  assert.equal(isName("Get started"), true);
  assert.equal(isName("Every project on one page"), true);
  assert.equal(isName("Play"), true);
  assert.equal(isName("The .md"), true, "a short interface name is still quoted verbatim");
  assert.equal(isName("Open project memory"), true, "an ordinary action label remains a name");
  assert.equal(isName("Open totem’s page — or double-click"), false, "gesture instructions are not a name");
  assert.equal(isName("Press Enter to open"), false, "keyboard hints are not a name");
  assert.equal(isName("What's the front door to your projects?"), false, "a question is not a control");
  assert.equal(isName("The most advanced memory for your projects. Panoma has it."), false, "two sentences");
  assert.equal(isName("Your disk today Forty folders, and their names stopped meaning anything"), false, "prose");
  assert.equal(isName("Open\ncatalog"), false);
  assert.equal(isName("  "), false);

  /*
    And a count in a label is not a name either. Measured on this project's own
    application, whose navigation counts what it found: those numbers are true of the
    disk the walk saw, on the day it saw it.
  */
  const counted: TourScript = {
    ...tour,
    marks: [
      { name: "hero", label: "Project catalog 32 projects", kind: "hero" },
      { name: "unbacked", label: "Unbacked 57 pending", kind: "flow", target: { x: 1, y: 1, w: 9, h: 9 } },
      { name: "get-started", label: "Get started", kind: "cta", target: { x: 8, y: 5, w: 16, h: 4 } },
    ],
  };
  const counts = planBriefs({ profile, facts, tour: counted, langs: ["en"] });
  assert.equal(counts.facts.facts.find((f) => f.id === "ui.hero"), undefined);
  assert.equal(counts.facts.facts.find((f) => f.id === "ui.unbacked"), undefined);
  assert.equal(counts.facts.facts.find((f) => f.id === "ui.get-started")?.value, "Get started");
  const tut = counts.briefs.find((b) => b.goal === "tutorial");
  if (tut) {
    const said = tut.brief.lines.map((l) => l.text.en).join(" ");
    assert.doesNotMatch(said, /\d/, "no digit reaches a narrated sentence through an interface string");
  }

  const prose: TourScript = {
    ...tour,
    marks: [
      { name: "hero", label: "Close your laptop and walk away. Panoma is already awake.", kind: "hero" },
      { name: "front-door", label: "What's the front door to your projects?", kind: "section" },
      { name: "cta", label: "Play", kind: "cta", target: { x: 8, y: 5, w: 16, h: 4 } },
    ],
  };
  const plan = planBriefs({ profile, facts, tour: prose, langs: ["en"] });
  assert.equal(plan.facts.facts.find((f) => f.id === "ui.front-door"), undefined, "a sentence is never minted as a name");
  assert.equal(plan.facts.facts.find((f) => f.id === "ui.cta")?.value, "Play", "a real control still is");

  /* Two steps is not a tutorial, and the skip says what the page actually earned. */
  assert.ok(!plan.briefs.some((b) => b.goal === "tutorial"));
  const why = plan.skip.find((g) => g.goal === "tutorial")!.why;
  assert.match(why, /prose, not labels/);
  assert.match(why, /steps this page earned: 2$/, "the count closes the sentence");
});

test("an accessibility instruction keeps its action, and cached brain words fall back to a neutral sentence", () => {
  const instruction = "Open totem’s page — or double-click";
  const observed: TourScript = { ...tour, marks: tour.marks.map((mark) => mark.name === "get-started"
    ? { ...mark, label: instruction, outcome: { heading: "Project overview", route: "/p/totem" } }
    : mark.name === "memory" ? { ...mark, label: "The .md" } : mark) };
  const saved: FactSheet = { ...facts, facts: [...facts.facts,
    { id: "ui.get-started", kind: "feature", value: instruction, source: "interface:recorded#open" },
  ] };
  const plan = planBriefs({ profile, facts: saved, tour: observed, langs: ["en", "es"], brainPatches: {
    "acme-start": [{ lines: {
      "step-get-started": { text: { es: "Pulsa {{fact:ui.get-started}} y entras a {{fact:ui.get-started.result}}." }, label: { es: "Abre el proyecto" } },
      "step-memory": { text: { es: "Pulsa {{fact:ui.memory}}." } },
    } }],
  } });
  const tutorial = plan.briefs.find((entry) => entry.goal === "tutorial")!;
  assert.ok(tutorial, "the instruction-shaped name must not cost the tutorial a required action");
  const opening = tutorial.brief.lines.find((line) => line.mark === "get-started")!;
  assert.equal(opening.text.en, "Open this item.");
  assert.equal(opening.text.es, "Abre este elemento.", "a stale reference falls back on this language's safe template");
  assert.equal(opening.label?.es, "Abre el proyecto", "valid cached wording survives");
  assert.equal(tutorial.brief.lines.find((line) => line.mark === "memory")?.text.es, "Pulsa {{fact:ui.memory}}.");
  assert.equal(plan.facts.facts.find((fact) => fact.id === "ui.memory")?.value, "The .md");
  assert.equal(plan.facts.facts.find((fact) => fact.id === "ui.get-started"), undefined);
  assert.equal(plan.facts.facts.find((fact) => fact.id === "ui.get-started.result")?.value, "Project overview");
  assert.equal(observed.marks.find((mark) => mark.name === "get-started")?.label, instruction, "the recorded evidence stays verbatim");
  assert.deepEqual(tutorial.claims, []);
});

test("without a state-changing moment there is no trailer, and the skip says what would unlock it", () => {
  const thin: TourScript = { ...tour, marks: [...tour.marks.filter((m) => m.kind !== "cta" && m.kind !== "flow"), { name: "memory-section", label: "Project memory", kind: "section" }], candidates: [] };
  const plan = planBriefs({ profile, facts, tour: thin, langs: ["en"] });
  assert.ok(!plan.briefs.some((b) => b.goal === "trailer"), "a page with no state change earns no trailer");
  /* What it earns is a site tour of its sections, labelled as such. */
  assert.ok(plan.briefs.some((b) => b.goal === "sitetour" && b.brief.id.endsWith("-sitetour")));
  const none = planBriefs({ profile, facts, tour: { ...thin, marks: thin.marks.slice(0, 1) }, langs: ["en"] });
  assert.ok(none.skip.some((g) => /trailer|sitetour/.test(g.goal)));
});

test("a patch keyed by line id survives regeneration", () => {
  const first = planBriefs({ profile, facts, tour, langs: ["en"] });
  const id = first.briefs.find((b) => b.goal === "tutorial")!.brief.id;
  const again = planBriefs({ profile, facts, tour, langs: ["en"], patches: { [id]: { lines: { cta: { text: { en: "Read the docs at {{fact:url}}." } } } } } });
  const cta = again.briefs.find((b) => b.goal === "tutorial")!.brief.lines.find((l) => l.id === "cta")!;
  assert.equal(cta.text.en, "Read the docs at {{fact:url}}.");
  assert.deepEqual(again.briefs.find((b) => b.goal === "tutorial")!.claims, []);
});

test("a cli earns the facts piece and a marks check names the take that lacks a mark", () => {
  const cli = planBriefs({ profile: { ...profile, kind: "cli", routes: [] }, facts, langs: ["en"] });
  assert.deepEqual(cli.make.map((g) => g.goal), ["changelog", "facts", "tutorial"]);
  assert.ok(cli.briefs.some((b) => b.goal === "facts" && b.brief.recipe === "KineticQuote"));
  const plan = planBriefs({ profile, facts, tour, langs: ["en"] });
  const trailer = plan.briefs.find((b) => b.goal === "trailer")!.brief;
  const takes = [{ take: "desktop", marks: [{ name: "get-started", t: 1 }, { name: "memory", t: 2 }] }, { take: "mobile", marks: [{ name: "get-started", t: 1 }] }];
  assert.deepEqual(missingMarks(trailer, takes as never), [{ take: "mobile", marks: ["memory"] }]);
  assert.equal(slotsOf(enrichFacts(facts, profile)).fixes, "derived.fixes");
});

test("a bound claim that carries a digit is quoted only where its fact can be, and never pasted literally", () => {
  /* A CHANGELOG entry with a version in it, and a commit subject with one: the first has a fact behind it, the second does not. */
  const withDigits: FactSheet = { ...facts, facts: [...facts.facts.filter((f) => f.id !== "changelog.added.1"), { id: "changelog.added.1", kind: "feature", value: "Support for Python 3.12", source: "CHANGELOG.md:7" }] };
  const gitWithDigits: ProjectProfile = { ...profile, git: { ...profile.git!, subjects: ["feat: add v2 endpoints", ...profile.git!.subjects] } };
  const tourWithDigits: TourScript = {
    ...tour,
    marks: [...tour.marks, { name: "python", label: "Python 3.12 support", kind: "cta", target: { x: 10, y: 10, w: 100, h: 20 } }, { name: "v2", label: "v2 endpoints", kind: "flow", target: { x: 10, y: 40, w: 100, h: 20 } }],
  };
  const plan = planBriefs({ profile: gitWithDigits, facts: withDigits, tour: tourWithDigits, langs: ["en", "es"] });
  const trailer = plan.briefs.find((b) => b.goal === "trailer")!;
  assert.ok(trailer, "trailer written");
  /* The audit is clean by construction: the template never writes a digit the sheet cannot vouch for, in a card or in a chip. */
  assert.deepEqual(trailer.claims, [], JSON.stringify(trailer.claims));
  const python = trailer.brief.lines.find((l) => l.mark === "python");
  if (python) {
    assert.match(python.text.en, /\{\{fact:changelog\.added\.1\}\}/);
    assert.equal(python.text.es, undefined, "the Spanish track gets no literal card with a digit in it");
    assert.equal(python.label?.es, undefined, "and no chip either");
  }
  /* A commit subject with a digit has no fact behind it, so it is not a claim at all. */
  assert.ok(!trailer.brief.lines.some((l) => l.mark === "v2"), "the v2 subject earns no card");
  for (const b of plan.briefs) parseBrief(b.brief);
});

test("a project with no package name and no README title still has a name the kicker can reference", () => {
  const nameless: FactSheet = { ...facts, facts: facts.facts.filter((f) => f.id !== "pkg.name") };
  const rich = enrichFacts(nameless, profile);
  assert.equal(rich.facts.find((f) => f.id === "derived.name")?.value, "acme");
  assert.equal(slotsOf(rich).name, "derived.name");
  const plan = planBriefs({ profile, facts: nameless, tour, langs: ["en"] });
  for (const b of plan.briefs) assert.deepEqual(b.claims, [], `${b.brief.id}: ${JSON.stringify(b.claims)}`);
});
