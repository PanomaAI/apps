/*
  From what the scout read and the tour found, to briefs a render can take.

  This is the step where an automatic video either makes sense or becomes a slideshow,
  and the whole decision is arithmetic in @panoma/video-core (story.ts): a claim earns a card
  only when bound to a moment that changed the interface, section scrolls prove
  nothing unless the project is a static site, a project earns a trailer only when
  two pairs bind, and every skipped piece says what would unlock it. The words then
  come from templates that carry no digits — every number is a `{{fact:id}}` the
  audit checks — and a person or a model can improve any sentence afterwards through
  a patch that survives regeneration.

  Two facts are DERIVED here rather than read: the count of fixes in the newest
  changelog section (or of fix-shaped commit subjects), and the language of every
  prose fact, detected from stopwords. Derived facts carry a source that says how.
*/
import {
  applyPatch,
  auditClaims,
  bindClaims,
  planCampaign,
  resolveGoals,
  unclaimedProofs,
  type BoundPair,
  type Brief,
  type BriefPatch,
  type Claim,
  type ClaimSource,
  type Fact,
  type FactSheet,
  type FormatId,
  type GoalDecision,
  type Moment,
  type PlannedJob,
  type Press,
  type SkippedJob,
} from "@panoma/video-core";
import { JOB_OF } from "@panoma/video-core";
import type { SessionLog } from "@panoma/video-capture";
import type { ProjectProfile } from "@panoma/video-scout";
import type { TourScript } from "@panoma/video-tour";
import { factsBrief, spotlightBrief, trailerBrief, tutorialBrief, TUTORIAL_MIN_STEPS, type Lang, type Slots } from "./templates.ts";
import { sanitizePatch } from "./brain.ts";
import { planPromo } from "./promo.ts";
import { selectedTakes } from "./capture-formats.ts";

export type PlanInput = {
  profile: ProjectProfile;
  facts: FactSheet;
  tour?: TourScript;
  /** The takes on disk, to check that every mark exists in all of them. */
  takes?: SessionLog[];
  /** Explicit production canvases; proof is required only in their matching takes. */
  formats?: readonly FormatId[];
  langs: Lang[];
  voice?: string;
  /*
    A brought track, scored for the grid (music.ts): the conformed file, its pulse and how
    much the picture may move to it. Absent means the procedural bed.
  */
  music?: Brief["music"];
  /** Patches by brief id, re-applied after generation. */
  patches?: Record<string, BriefPatch>;
  /*
    What the brain wrote, by brief id, in order: its words for the piece, then the
    fixes a review sent it back for. Applied before an agent's patch, so a person's
    edit always outranks the pipeline's own judgement.
  */
  brainPatches?: Record<string, readonly BriefPatch[]>;
  /*
    The product's own look. The planner reads exactly one thing from it — the tempo, which
    decides the grid every cut lands on and the bed the piece is scored with. Colour never
    passes through here: it reaches the frame through the theme context, and a brief that
    carried hexes would put them in the render key twice.
  */
  direction?: { sound: { bpm: number } };
};

export type PlannedBrief = {
  brief: Brief;
  /** "brain" when a model's words were applied over the template's. */
  origin: "template" | "brain";
  goal: GoalDecision["goal"];
  /** Claims the audit found and the plan could not remove — the brief is still written, flagged. */
  claims: Claim[];
};

export type Plan = {
  briefs: PlannedBrief[];
  pairs: BoundPair[];
  make: GoalDecision[];
  skip: GoalDecision[];
  /** Who each piece is for, which canvases it is published in, and what would unlock the jobs this product has not earned. */
  campaign: { make: PlannedJob[]; skip: SkippedJob[] };
  /** The sheet with the derived facts appended; the render expands against this one. */
  facts: FactSheet;
};

/* ---------- Language of a prose fact ---------- */

const EN = new Set("the and of to in for with your you is are on a an it this that from by as at we our".split(" "));
const ES = new Set("el la los las de del y en para con tu tus es son un una este esta que se lo su por como al".split(" "));

/** "en", "es", or undefined when the text is too short or too mixed to say. */
export function detectLang(text: string): "en" | "es" | undefined {
  const words = text.toLowerCase().split(/[^a-záéíóúñü]+/).filter(Boolean);
  if (words.length < 3) return undefined;
  let en = 0;
  let es = 0;
  for (const w of words) {
    if (EN.has(w)) en++;
    if (ES.has(w)) es++;
  }
  if (en === 0 && es === 0) return undefined;
  if (en >= es * 2) return "en";
  if (es >= en * 2) return "es";
  return undefined;
}

const PROSE = new Set(["text", "quote", "feature"]);

/*
  Is this string a NAME, or is it prose the page happened to put in a heading?

  The tutorial quotes the interface: "Click Get started", "Then Project memory". That
  works because a control is called something short. A landing page is not built that
  way — its h2s are whole sentences ("The most advanced memory for your projects.
  Panoma has it.") and its buttons wrap paragraphs — and quoting one produces a
  narrator reading marketing copy with "Then" in front of it, at four seconds a
  caption. That is the slideshow this whole layer exists to refuse, arriving through
  a side door.

  So a mark earns a quotable fact only when what it is called could be said out loud
  as the name of a thing: at most six words, no second sentence inside it, no line
  break. Anything else is prose, the fact is never minted, and the sentence that
  needed it is not written — the tutorial says less rather than reading an
  advertisement aloud.
*/
const NAME_MAX_WORDS = 6;

/** Accessibility hints describe how to operate a control; they are not its spoken name. */
const instructionName = (text: string) => /\b(?:double[- ]click|right[- ]click|double[- ]tap|doble clic|clic derecho|(?:press|pulsa)\s+(?:enter|return|space|escape|intro|espacio)|(?:click|tap|press|pulsa|haz clic)\s+(?:to|para))\b/i.test(text);

export function isName(text: string): boolean {
  const t = text.trim();
  if (!t || /[\n\r]/.test(t) || instructionName(t)) return false;
  if (t.split(/\s+/).length > NAME_MAX_WORDS) return false;
  /* A stop, a question or an exclamation with anything after it is a sentence, not a name. */
  return !/[.!?…]\s+\S/.test(t) && !/[?!…]$/.test(t);
}

/** The sheet with languages on prose facts, the interface's own names, and the derived counts appended. */
export function enrichFacts(sheet: FactSheet, profile: ProjectProfile, tour?: TourScript): FactSheet {
  /* A generated sheet from an older run may already contain a now-unquotable label.
     The tour remains the verbatim evidence; only its use as a spoken name is refused. */
  const facts: Fact[] = sheet.facts.filter((f) => !f.id.startsWith("ui.") || !instructionName(f.value))
    .map((f) => (PROSE.has(f.kind) && !f.lang ? { ...f, lang: detectLang(f.value) } : f));
  /*
    Tier one: what the interface calls its own things. A tutorial that says "Click
    Get started" quotes the button, and the button is a fact the take can show. Every
    kind of mark earns one — a section's heading is as much the product's own word as
    a button's label, and a narrated step that can name the section it scrolled to
    stops being "next" and starts being instruction.

    These carry no language. They are the interface's own strings, and a tutorial
    quotes a control by the letters on it: "Pulsa Get started" is right in Spanish
    precisely because the button does not say "Empezar". Attaching a detected
    language here would make every such sentence a wrong-language claim, which is why
    they are appended after the pass above rather than run through it.
  */
  const ui = (id: string, value: string, source: string) => {
    /* A trailing stop belongs to the page's sentence, not to the name; kept, it doubles inside one of ours. */
    const clean = value.trim().replace(/[.!]+$/, "").trim();
    /*
      And never a digit. Measured on this project's own application, whose interface
      counts what it found: "Unbacked 57 pending", "Uncommitted changes 22", "Project
      catalog 32 projects". Those are true of the disk the walk happened to see, and a
      tutorial saying "Click Unbacked 57 pending" states a measurement as an
      instruction — wrong for every viewer, and wrong for this one tomorrow. It is the
      same rule the plan already applies to a commit subject with a digit in it, and
      the same reason: nobody vouched for the number. The instruction survives without
      the name; the number does not survive at all.
    */
    if (!/\d/.test(clean) && isName(clean) && !facts.some((f) => f.id === id)) {
      facts.push({ id, kind: "feature", value: clean, source });
    }
  };
  for (const mark of tour?.marks ?? []) {
    const where = `interface:${tour!.url}#${mark.name}`;
    if (mark.label) ui(`ui.${mark.name}`, mark.label, where);
    /*
      And what the interface answered. The walker only marks a click that changed the
      page, so this heading is the observed consequence of the step — the half of a
      tutorial sentence that every automatic tool has to invent.

      It is refused when it carries a digit. A heading like "3 projects found" is what
      that page said on the day of the walk, and a tutorial narrating it states a
      measurement as an instruction — the same reason a commit subject with a digit
      earns no card below. The instruction survives without it; the number does not.
    */
    if (mark.outcome?.heading) ui(`ui.${mark.name}.result`, mark.outcome.heading, `${where} (the heading the page showed after this step)`);
    if (mark.outcome?.route) ui(`ui.${mark.name}.route`, mark.outcome.route, `${where} (the route this step landed on)`);
  }
  const fixedItems = facts.filter((f) => f.id.startsWith("changelog.fixed.")).length;
  const fixSubjects = (profile.git?.subjects ?? []).filter((s) => /\bfix|\barregl|\bcorrig|\bbug/i.test(s)).length;
  if (fixedItems > 0) {
    facts.push({ id: "derived.fixes", kind: "number", value: String(fixedItems), source: "CHANGELOG.md (count of Fixed bullets in the newest section)" });
  } else if (fixSubjects > 0 && profile.git) {
    facts.push({ id: "derived.fixes", kind: "number", value: String(fixSubjects), source: `git:log:--since=${profile.git.days} days (subjects that say fix)` });
  }
  const featSubjects = (profile.git?.subjects ?? []).filter((s) => /^feat(\(|:|!)/i.test(s)).length;
  if (featSubjects > 0) {
    facts.push({ id: "derived.feats", kind: "number", value: String(featSubjects), source: `git:log:--since=${profile.git?.days ?? 30} days (feat: subjects)` });
  }
  /* A project with no package name and no README title is still called something: the scout's name, so the kicker never references a fact that is not on the sheet. */
  if (!facts.some((f) => f.id === "pkg.name" || f.id === "readme.title")) {
    facts.push({ id: "derived.name", kind: "text", value: profile.name, source: "scout (the project's name, from its manifest or its folder)" });
  }
  return { ...sheet, facts };
}

/* ---------- Slots the templates may reference ---------- */

export function slotsOf(sheet: FactSheet): Slots {
  const has = (id: string) => sheet.facts.find((f) => f.id === id)?.id;
  const value = (id: string) => sheet.facts.find((f) => f.id === id)?.value;
  const tagline = has("readme.tagline");
  const words = (value("readme.tagline") ?? "").split(/\s+/).filter(Boolean).length;
  const headline = has("changelog.added.1") && (value("changelog.added.1") ?? "").split(/\s+/).length <= 6 ? "changelog.added.1" : undefined;
  const lang = (id: string | undefined) => (id ? sheet.facts.find((f) => f.id === id)?.lang : undefined);
  return {
    /* A README title is the public product name; a manifest name may be scoped or
       carry repository furniture such as "-monorepo". But only when the title is a
       name: an H1 that reads "Welcome to the Acme docs" is a sentence, and it went
       into the kicker, the end card and the brand check, all of which passed. */
    name: (() => {
      const title = value("readme.title");
      const first = title && isName(title) ? has("readme.title") : undefined;
      /*
        A name a person wrote in brand.patch.json outranks both, because the two
        automatic sources are an H1 and an address: panoma's site had no README title and
        its films opened on the card "@panoma/site 0.1.0". It is still a FACT with a
        source — the patch file — so nothing is invented and the audit is unchanged.
      */
      return has("brand.name") ?? first ?? has("pkg.name") ?? has("readme.title") ?? has("derived.name") ?? "pkg.name";
    })(),
    version: has("git.lastTag") ?? has("changelog.version") ?? has("pkg.version"),
    tagline: tagline && words <= 12 ? tagline : undefined,
    taglineLang: lang(tagline),
    headlineLang: lang(headline),
    install: has("cmd.install"),
    url: has("url"),
    fixes: has("derived.fixes"),
    commits: sheet.facts.find((f) => /^git\.commits\.\d+d$/.test(f.id))?.id,
    headline,
  };
}

/* ---------- Moments and claims ---------- */

/** The tour's marks as moments the story layer can score. */
export function momentsOf(tour: TourScript, takes: SessionLog[] = []): Moment[] {
  const best = Math.max(1, ...tour.candidates.map((c) => c.score));
  const markSets = takes.map((t) => new Set((t.marks ?? []).map((m) => m.name)));
  return tour.marks.map((m) => {
    const candidate = tour.candidates.find((c) => c.description === m.label || c.selector.includes(m.label));
    /* A cta or flow mark exists only because the walker saw the state hash change. */
    const stateDelta = m.kind === "cta" || m.kind === "flow" ? 0.6 : 0;
    return {
      id: m.name,
      kind: m.kind,
      name: m.label,
      stateDelta,
      candidateScore: candidate ? candidate.score / best : 0,
      inAllTakes: markSets.length === 0 || markSets.every((s) => s.has(m.name)),
      ...(m.target ? { box: m.target } : {}),
    };
  });
}

/** Everything written about the product that could become a card, ranked by where it came from. */
export function rankedClaims(sheet: FactSheet, profile: ProjectProfile): ClaimSource[] {
  const out: ClaimSource[] = [];
  for (const f of sheet.facts) {
    if (f.id.startsWith("changelog.added.") || f.id.startsWith("changelog.changed.")) out.push({ text: f.value, source: f.source, tier: 2, lang: f.lang, factId: f.id });
    else if (f.id === "pkg.description") out.push({ text: f.value, source: f.source, tier: 3, lang: f.lang, factId: f.id });
    else if (f.id.startsWith("readme.section.")) out.push({ text: f.value, source: f.source, tier: 4, lang: f.lang, factId: f.id });
  }
  /* A commit subject has no fact behind it, so one that carries a digit ("v2 endpoints") is a number nobody vouched for: it earns no card. */
  for (const s of profile.git?.subjects ?? []) {
    if (/^feat(\(|:|!)/i.test(s) && !/\d/.test(s)) out.push({ text: s, source: "git:log", tier: 5, lang: detectLang(s) });
  }
  return out;
}

/* ---------- The plan ---------- */

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function planBriefs(input: PlanInput): Plan {
  if (input.formats) input = { ...input, takes: selectedTakes(input.takes ?? [], input.formats) };
  // Rebuild generated observations before any recipe quotes them. A saved sheet
  // must not keep a previous heading under a mark that now describes another page.
  const fresh = input.tour ? { ...input.facts, facts: input.facts.facts.filter(fact => !/^(?:ui|observed)\./.test(fact.id)) } : input.facts;
  let facts = enrichFacts(fresh, input.profile, input.tour);
  const slots = slotsOf(facts);
  const moments = input.tour ? momentsOf(input.tour, input.takes) : [];
  /*
    A marketing page served by a framework is still a page: when the walker found no
    moment that changed the interface, its sections are what there is to show, and
    the piece is a site tour — labelled as such, never sold as a trailer.
  */
  const staticSite = input.profile.kind === "static-site" || (moments.length > 0 && moments.every((m) => m.stateDelta === 0));
  const claims = rankedClaims(facts, input.profile);
  const readmeWords = new Set<string>(
    facts.facts
      .filter((f) => f.id === "readme.title" || f.id === "readme.tagline" || f.id.startsWith("readme.section."))
      .flatMap((f) => f.value.toLowerCase().split(/\W+/).filter((w) => w.length > 3)),
  );
  /* Strict pairs prove with actions and make a trailer; loose pairs admit sections and make a site tour. */
  const pairsIn = (site: boolean) => {
    const ctx = { staticSite: site, readmeWords };
    const bound = bindClaims(claims, moments, ctx);
    return [...bound, ...unclaimedProofs(moments, bound, ctx)];
  };
  const strict = pairsIn(false);
  const loose = pairsIn(true);
  const pairs = staticSite ? loose : strict;

  const hasReachableTag = Boolean(input.profile.git?.lastTag);
  const { make, skip } = resolveGoals({
    kind: staticSite && input.profile.kind === "web-app" ? "static-site" : input.profile.kind,
    boundPairs: strict.length,
    flows: moments.filter((m) => (m.kind === "cta" || m.kind === "flow") && m.stateDelta > 0).length,
    hasInstallCommand: Boolean(slots.install),
    hasReachableTag,
    changelogHeroItems: facts.facts.filter((f) => f.id.startsWith("changelog.added.")).length,
    featCommits: Number(facts.facts.find((f) => f.id === "derived.feats")?.value ?? 0),
    sectionMarks: moments.filter((m) => m.kind === "section").length,
  });

  const project = input.profile.id;
  const session = input.tour?.name ?? project;
  const briefs: PlannedBrief[] = [];
  const base = slug(input.profile.name) || "project";

  const finish = (brief: Brief, goal: GoalDecision["goal"]) => {
    const fromBrain = input.brainPatches?.[brief.id] ?? [];
    /* A cached answer is audited against today's facts too. A control's old accessibility
       hint must not return through a patch after the template stopped quoting it. */
    const thought = fromBrain.reduce((b, p) => applyPatch(b, sanitizePatch(b, p, facts).patch), brief);
    const patched = applyPatch(thought, input.patches?.[brief.id]);
    briefs.push({ brief: patched, origin: fromBrain.length > 0 ? "brain" : "template", goal, claims: auditClaims(patched, facts) });
  };

  /*
    What the capture caught of every press: whether it holds the control's own
    after-state, and how much of the viewport the press changed. This is the material a
    feed cut is built from, and it is read from the take rather than guessed — a press
    that changed 0.4% of a page is a cut with nothing in it.
  */
  const presses: Press[] = (input.takes ?? []).flatMap((take) =>
    (take.macros ?? []).map((macro) => ({
      mark: macro.mark,
      afterControl: Boolean(macro.afterControl),
      changeShare: macro.change?.share ?? 0,
    })),
  );

  for (const decision of make) {
    if ((decision.goal === "trailer" || decision.goal === "sitetour") && input.tour) {
      /* The best pairs by score, then shown in the order the product does them: a story runs forward. */
      const order = new Map(input.tour.marks.map((m, i) => [m.name, i]));
      const top = (decision.goal === "trailer" ? strict : loose)
        .slice(0, decision.goal === "trailer" ? Math.min(4, Math.max(2, decision.pairs ?? 3)) : 4)
        .sort((a, b) => (order.get(a.moment.id) ?? 0) - (order.get(b.moment.id) ?? 0));
      if (top.length < 2) continue;
      finish(
        trailerBrief({ id: `${base}-${decision.goal}`, slots, pairs: top, langs: input.langs, session, project, statusAllowed: hasReachableTag, music: input.music , bpm: input.direction?.sound.bpm }),
        decision.goal,
      );
    } else if (decision.goal === "spotlight" && input.tour) {
      const order = new Map(input.tour.marks.map((m, i) => [m.name, i]));
      const top = strict
        .filter((pair) => pair.moment.kind === "cta" || pair.moment.kind === "flow")
        .slice(0, 3)
        .sort((a, b) => (order.get(a.moment.id) ?? 0) - (order.get(b.moment.id) ?? 0));
      if (top.length === 0) {
        skip.push({
          goal: "spotlight",
          why: "the controls whose use changes the interface have names too long to card; a control named in five words or fewer would make one",
        });
        continue;
      }
      /* The heading each click produced, when the walker saw one and it passed the name gate above. */
      const results = Object.fromEntries(
        top
          .map((pair) => [pair.moment.id, facts.facts.find((f) => f.id === `ui.${pair.moment.id}.result`)?.id] as const)
          .filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
      );
      finish(
        spotlightBrief({ id: `${base}-spotlight`, slots, pairs: top, langs: input.langs, session, project, music: input.music, results , bpm: input.direction?.sound.bpm }),
        "spotlight",
      );
    } else if (decision.goal === "tutorial" && input.tour) {
      const fact = (id: string) => facts.facts.find((f) => f.id === id);
      const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9áéíóúñü ]+/g, "").trim();
      const marks = input.tour.marks.map((m) => {
        const name = fact(`ui.${m.name}`);
        const result = fact(`ui.${m.name}.result`);
        return {
          id: m.name,
          kind: m.kind,
          name: name?.id,
          nameWords: name ? name.value.split(/\s+/).filter(Boolean).length : undefined,
          ...(instructionName(m.label) && (m.kind === "cta" || m.kind === "flow")
            ? { instruction: /^(?:open|abre|abrir)\b/i.test(m.label.trim()) ? "open" as const : "click" as const }
            : {}),
          /*
            A navigation link is usually named after the page it leads to, so quoting
            both halves gives "Open Pricing and you land on Pricing" — a sentence that
            spends four seconds saying nothing. When they are the same thing, only one
            of them is said.
          */
          result: result && name && plain(result.value) === plain(name.value) ? undefined : result?.id,
        };
      });
      const about = (input.tour as { goal?: string } | undefined)?.goal;
      const tutorial = tutorialBrief({ id: `${base}-start`, slots, marks, langs: input.langs, session, project, voice: input.voice, music: input.music, bpm: input.direction?.sound.bpm, ...(about ? { about } : {}) });
      /*
        A control that changes the interface earns the goal; sentences the interface
        can actually be quoted saying earn the piece. A landing page whose headings
        are all prose passes the first test and fails the second, and what it gets is
        the site tour it already had — plus a line saying why, because a goal that
        appears in `make` and produces nothing is the kind of silence that reads as a
        bug.
      */
      const narrated = tutorial.lines.filter((l) => l.mark).length;
      if (narrated < TUTORIAL_MIN_STEPS) {
        skip.push({ goal: "tutorial", why: `the interface's own names are prose, not labels, so there are too few steps to teach with — open it, do the thing, see what happened is the shortest tutorial there is; steps this page earned: ${narrated}` });
        continue;
      }
      finish(tutorial, "tutorial");
    } else if (decision.goal === "facts") {
      finish(factsBrief({ id: `${base}-facts`, slots, langs: input.langs, project, music: input.music , bpm: input.direction?.sound.bpm }), "facts");
    }
    /* Changelog remains booked: see docs/roadmap.md. */
  }

  /*
    Who the pieces are for. The goals above answer "what is there to show"; this answers
    "who is this shown to, and where does it go" — and narrows the canvases, so a
    vertical-only cut stops rendering a 1920x1080 nobody would post.
  */
  const promo = planPromo({ ...input, facts, takes: input.takes ?? [] });
  // A promo's narrower proof menu cannot remove observations referenced by the
  // tutorials already planned above. Promo still validates against its own menu.
  facts = { ...promo.facts, facts: [...new Map([...facts.facts, ...promo.facts.facts].map(fact => [fact.id, fact])).values()] };
  if (promo.brief) {
    finish(promo.brief, "promo");
    make.push({ goal: "promo", why: "a recorded action demonstrates a supported product benefit" });
  } else {
    skip.push({ goal: "promo", why: promo.why ?? "no measured product result is available in every take" });
  }
  const campaign = planCampaign({ goals: briefs.map((b) => b.goal), presses });
  for (const [i, planned] of briefs.entries()) {
    const job = JOB_OF[planned.goal];
    if (job) briefs[i] = { ...planned, brief: { ...planned.brief, job } };
  }

  /*
    The one job with a brief of its own: the same spotlight footage, one control, cut
    for a feed. It is a `params` variant and never a new recipe — and it takes its own
    id, because the id is the directory name under `generated/` and `renders/`, the name
    of its `.brain.json` and `.patch.json`, and the prefix of every composition in it.
  */
  if (campaign.make.some((j) => j.job === "stop")) {
    const spotlight = briefs.find((b) => b.goal === "spotlight");
    const lead = spotlight?.brief.lines.find((line) => line.mark);
    if (spotlight && lead) {
      finish(
        {
          ...spotlight.brief,
          id: `${base}-stop`,
          job: "stop",
          lines: [lead, ...spotlight.brief.lines.filter((line) => line.id === "end")],
          params: { ...spotlight.brief.params, cut: "stop" },
          tags: [...(spotlight.brief.tags ?? []), "short"],
        },
        "spotlight",
      );
      /* `finish` stamps the goal's job; this piece's job is its own. */
      const stop = briefs[briefs.length - 1];
      briefs[briefs.length - 1] = { ...stop, brief: { ...stop.brief, job: "stop" } };
    }
  }

  return { briefs, pairs, make, skip, facts, campaign };
}

/** Marks a brief narrates that a take does not have — refused before recording is even considered. */
export function missingMarks(brief: Brief, takes: readonly SessionLog[]): { take: string; marks: string[] }[] {
  const wanted = brief.lines.filter((l) => l.mark).map((l) => l.mark!);
  return takes
    .map((t) => ({ take: t.take, marks: wanted.filter((m) => !(t.marks ?? []).some((x) => x.name === m)) }))
    .filter((r) => r.marks.length > 0);
}
