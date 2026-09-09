/*
  Where the brain's answers meet the plan, and where they are made safe to use.

  The brain package asks and validates shapes; this file decides what panoma video does with
  the answers, and it is the one place a model's words are audited before a frame
  sees them. The rule is the same one an agent's patch already obeys: a brief line is
  refused when it carries a digit no fact vouches for, a fact id that does not exist,
  a roadmap item quoted as shipped, or a fact in the wrong language. Here, refusal is
  per line and per language — the template keeps its own sentence for that one line,
  the brain's other lines stand, and every refusal is reported by id so a person can
  see what the model tried to say.

  What the brain writes is kept beside the brief as `<id>.brain.json` — the words it
  wrote for the piece, then the fixes a review sent it back for, applied in that order
  and always UNDER an agent's `.patch.json`: a person's (or an outer agent's) edit
  outranks the pipeline's own judgement.
*/
import { join } from "node:path";
import {
  TRAILER_CLAIM_MAX_WORDS,
  applyPatch,
  auditClaims,
  expandFacts,
  hasDestinationClaim,
  redact,
  unknownPatchIds,
  type Brief,
  type BriefPatch,
  type Claim,
  type Copy,
  type FactSheet,
  type Line,
  type ReviewCheck,
} from "@panoma/video-core";
import { brollQuestion, fixQuestion, kitQuestion, lessonQuestion, openBrain, rerankQuestion, slateQuestion, thesisQuestion, writeQuestion, type Brain, type BrainChoice, type BriefView, type FactRow, type MomentView, type Thesis } from "@panoma/video-brain";
import type { BrandProfile, LivePageContext } from "@panoma/video-brand";
import { readText, type ProjectProfile } from "@panoma/video-scout";
import { isDestructive, isExternal, type Chooser, type Rerank, type Router, type RouteStep, type TourScript } from "@panoma/video-tour";
import { refuseGenerated, type Framing, type Move } from "@panoma/video-gen";
import type { Plan } from "./plan.ts";
import { readJson, writeJson, type Workspace } from "./workspace.ts";

/** `brain.json` in the workspace: which brain, and what it decided the product is. */
export type BrainFile = { driver: string; model: string; how: string; at: string; thesis: Thesis };

/** `<brief>.brain.json`: the words the brain wrote for a brief, then the fixes the review sent it back for. */
export type BrainPatchFile = { write?: BriefPatch; fixes: BriefPatch[] };

export type Refusal = { brief: string; line: string; lang: string; token: string; why: Claim["why"] | "unknown-id" | "too-long" | "missing-language" | "wordless-recipe" };

export async function openBrainFor(ws: Workspace, choice: BrainChoice | undefined, signal?: AbortSignal): Promise<{ brain: Brain | null; why: string }> {
  return openBrain({ choice, cacheDir: ws.paths.cache, logFile: ws.paths.brainLog, scratchDir: ws.paths.cache, signal });
}

export function factRows(facts: FactSheet): FactRow[] {
  return facts.facts.map((f) => ({ id: f.id, kind: f.kind, value: f.value, source: f.source, ...(f.lang ? { lang: f.lang } : {}) }));
}

export function viewOf(brief: Brief, goal: string): BriefView {
  return {
    id: brief.id,
    recipe: brief.recipe,
    goal,
    langs: [...brief.langs],
    hooks: brief.hooks.map((h) => ({ id: h.id, text: h.text })),
    lines: brief.lines.map((l) => ({ id: l.id, ...(l.mark ? { mark: l.mark } : {}), text: l.text, ...(l.label ? { label: l.label } : {}), ...(l.result ? { result: l.result } : {}) })),
  };
}

export function momentsView(tour?: TourScript): MomentView[] {
  /*
    A lesson writes one plain sentence per step into the tour's own candidate record —
    the route's reason for that step — and this is where it reaches the writing. Without
    it the words are written from a label and an outcome alone, which is how a sentence
    that is grammatical and false gets onto a screen.
  */
  const why = new Map<string, string>();
  for (const candidate of tour?.candidates ?? []) {
    const mark = candidate.reasons.map((r) => /(?:pressed|shown) as mark "([^"]+)"/.exec(r)).find(Boolean)?.[1];
    const reason = candidate.reasons.find((r) => /^(brain|words): /.test(r))?.replace(/^(brain|words): /, "");
    if (mark && reason) why.set(mark, reason);
  }
  return (tour?.marks ?? []).map((m) => ({
    id: m.name,
    kind: m.kind,
    label: m.label,
    ...(m.outcome ? { outcome: m.outcome } : {}),
    ...(why.has(m.name) ? { why: why.get(m.name)! } : {}),
  }));
}

/** The README's text, when the profile lists one; read through the scout's reader, which refuses an env file. */
function readmeOf(profile: ProjectProfile): string | undefined {
  const doc = profile.docs.find((d) => /(^|\/)readme(\.md|\.markdown|\.rst|\.txt)?$/i.test(d));
  return doc ? readText(join(profile.root, doc)) : undefined;
}

export async function thesisFor(brain: Brain, input: { profile: ProjectProfile; facts: FactSheet; brand?: BrandProfile; langs: string[]; tour?: TourScript; page?: LivePageContext }) {
  const { profile } = input;
  return brain.ask(
    thesisQuestion({
      name: input.brand?.nameEvidence && input.brand.nameEvidence.value === input.brand.name ? input.brand.name : profile.name,
      kind: profile.kind,
      framework: profile.framework?.name,
      version: profile.version,
      langs: input.langs,
      facts: factRows(input.facts),
      readme: readmeOf(profile),
      routes: profile.routes.map((r) => r.path),
      gitSubjects: profile.git?.subjects ?? [],
      ...(input.page || input.tour ? { observed: redact([
        ...(input.page ? ["Live interface before exploration; visible context, not evidence that any action completed.",
          `Page: ${redact(input.page.url).text.slice(0, 500)}`, redact(input.page.snapshot).text.slice(0, 6000)] : []),
        ...(input.tour ? [redact(input.tour.snapshot).text.slice(0, 6000),
          ...input.tour.marks.slice(0, 20).map(mark => JSON.stringify({ label: mark.label, kind: mark.kind, outcome: mark.outcome }))] : []),
      ].join("\n")).text.slice(0, 10000) } : {}),
      ...(input.brand ? { brand: { primary: input.brand.colors.primary.hex, scheme: input.brand.scheme.default, tone: input.brand.tone?.register } } : {}),
    }),
  );
}

/** The walker's re-ranker: the thesis is the standing brief, the page is the question. */
export function rerankFor(brain: Brain, thesis: Thesis): Rerank {
  return async (input) => {
    const answer = await brain.ask(rerankQuestion({ thesis, page: input.page, candidates: input.candidates, room: input.room }));
    return { order: answer.value.order, why: answer.value.why };
  };
}

/**
 * A brain as the router of a lesson.
 *
 * The answer is a plan, not an action: `writeLesson` performs it in a browser and drops
 * every step the product refuses, so a hallucinated control name costs one step and
 * never a wrong instruction on tape. What is enforced HERE, before that, is the one rule
 * a prompt must not be the only guard for: a press on the destructive or external lists
 * is dropped, whatever the answer says. The executor checks the same lists again on the
 * control it actually resolved to, which is not the same string when a row has been
 * substituted — and it refuses any press the reading never saw. A model asked not to
 * press something and a tool that cannot press it are different promises, and this is
 * three of the second kind rather than one of the first.
 */
export function routerFor(brain: Brain, most: number): Router {
  return async (input) => {
    const answer = await brain.ask(lessonQuestion({ goal: input.goal, atlas: input.atlas, most }));
    const steps: RouteStep[] = [];
    for (const step of answer.value.steps) {
      const kind = step.kind === "show" ? "show" : "press";
      if (kind === "press") {
        const refused = isDestructive(step.control) ?? isExternal(step.control);
        if (refused) continue;
      }
      steps.push({ path: step.path, control: step.control, kind, why: step.why });
    }
    return { steps, on: answer.value.on.split("#")[0] || undefined, by: "brain", why: answer.value.why };
  };
}

/**
 * A brain choosing which of a product's screens gets the one video.
 *
 * The list it is handed is arithmetic's (`slateOf`), and what comes back is a name per
 * row and one index. The index is CLAMPED rather than trusted — a pick outside the list
 * is a model answering about a product it imagined — and the angle is taken only from the
 * closed set the shape allows. Everything else in the answer is prose for the record.
 */
export function chooserFor(brain: Brain, thesis?: Thesis): Chooser {
  return async (input) => {
    const answer = await brain.ask(
      slateQuestion({
        atlas: input.atlas,
        slate: input.slate.map((c, i) => ({
          i,
          path: c.path,
          ...(c.heading ? { heading: c.heading } : {}),
          doors: [...c.doors],
          score: c.score,
          angle: c.angle,
          why: [...c.why],
          ...(c.evidence ? { evidence: c.evidence } : {}),
        })),
        ...(thesis ? { thesis: { what: thesis.what, audience: thesis.audience, tone: thesis.tone } } : {}),
      }),
    );
    const pick = Math.max(0, Math.min(input.slate.length - 1, answer.value.pick));
    const named = answer.value.rows.find((r) => r.i === pick);
    const worth = answer.value.rows.map((r) => `${r.i}: ${r.task} (${r.audience}) — worth ${r.worth}/10`).join(" · ");
    return {
      pick,
      task: named?.task ?? input.slate[pick].heading ?? input.slate[pick].path,
      angle: answer.value.angle,
      why: `${answer.value.why} · what it saw on the slate — ${worth}`,
    };
  };
}

/**
 * The two shots of a film that are not about the product.
 *
 * The answer is checked the way every other answer here is checked — not by trusting the
 * rules in the prompt, but by running the board's own refusal over it (`refuseGenerated`,
 * in @panoma/video-gen) before a request is built. A shot that names an interface is dropped and
 * the film opens on its card instead, which is a worse film and an honest one.
 */
export async function brollFor(
  brain: Brain,
  input: {
    premise: string;
    thesis?: Thesis;
    look: { photography: string; mood: string; palette: string[]; avoid: string[]; energy: string };
    seconds: number;
    between: { n: number; after: string; before: string }[];
    stage: string;
  },
): Promise<{ open: Idea | null; transitions: Idea[]; close: Idea | null; why: string; refused: string[] }> {
  const answer = await brain.ask(
    brollQuestion({
      premise: input.premise,
      ...(input.thesis ? { thesis: { what: input.thesis.what, audience: input.thesis.audience, tone: input.thesis.tone } } : {}),
      look: input.look,
      seconds: input.seconds,
      between: input.between,
      stage: input.stage,
    }),
  );
  const refused: string[] = [];
  /*
    Every idea is read by the board's own refusal before it can become a request. These
    shots are conditioned on NOTHING — no frame of the recording is behind them — so they
    are the one place on a board where a model could invent an interface, and they are read
    strictly for it.
  */
  const keep = (idea: Idea, which: string): Idea | null => {
    const why = refuseGenerated({
      n: 0,
      origin: "generated",
      role: "transition",
      duration: 0,
      framing: idea.framing,
      angle: "eye",
      move: idea.movement,
      subject: idea.subject,
      action: idea.action,
      out: "cut",
      note: "",
      panels: [{ id: "0A", at: "first", screen: { x: 0.5, y: 0.5, facing: "camera" } }],
      gen: { mode: "text", motion: idea.action, seconds: input.seconds, inPoint: 0 },
    });
    if (why) refused.push(`${which}: ${why}`);
    return why ? null : idea;
  };
  return {
    open: keep(answer.value.open, "the opening shot"),
    transitions: answer.value.transitions.map((t, i) => keep(t, `transition ${i + 1}`)).filter((t): t is Idea => t !== null),
    close: keep(answer.value.close, "the closing shot"),
    why: answer.value.why,
    refused,
  };
}

/** One shot as the brain describes it: what is in frame, what happens, and what the camera does. */
export type Idea = { subject: string; action: string; movement: Move; framing: Framing };

/* ---------- making a model's words safe ---------- */

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const WORDLESS = new Set(["ReleaseTrailer", "FeatureSpotlight"]);
const LABEL_MAX_WORDS = 3;

const claimKey = (c: Claim) => `${c.line}|${c.lang}|${c.field ?? "text"}|${c.token}|${c.why}`;

type Mutable = {
  hooks?: Record<string, { text?: Record<string, string>; label?: Record<string, string> }>;
  lines?: Record<string, { text?: Record<string, string>; label?: Record<string, string> }>;
  drop?: string[];
  add?: { id: string; text: Record<string, string>; label?: Record<string, string> }[];
  addHooks?: { id: string; text: Record<string, string>; label?: Record<string, string> }[];
};

/** Remove one language of one field of one line from a patch, wherever the patch carries it. */
function strip(patch: Mutable, line: string, lang: string, field: "text" | "label"): void {
  for (const group of [patch.hooks, patch.lines]) {
    const entry = group?.[line];
    if (entry?.[field]) {
      delete entry[field]![lang];
      if (Object.keys(entry[field]!).length === 0) delete entry[field];
      if (!entry.text && !entry.label) delete group![line];
    }
  }
  for (const key of ["add", "addHooks"] as const) {
    const list = patch[key];
    if (!list) continue;
    const i = list.findIndex((l) => l.id === line);
    if (i < 0) continue;
    const entry = list[i];
    if (field === "label" && entry.label) {
      delete entry.label[lang];
      if (Object.keys(entry.label).length === 0) delete entry.label;
    } else {
      /* A line the brain added has no template to fall back on: one bad language track costs the whole line. */
      list.splice(i, 1);
    }
  }
}

/**
 * A model's patch, reduced to what the audit accepts: every claim the patch
 * introduces is removed from it, language by language, until the patched brief is as
 * clean as the template was; ids the brief does not have are dropped; a card that
 * would not fit its recipe loses that language; an added hook that does not carry
 * every language of the brief is not added. What was refused is returned by id.
 */
export function sanitizePatch(brief: Brief, patch: BriefPatch, facts: FactSheet): { patch: BriefPatch; refused: Refusal[] } {
  const refused: Refusal[] = [];
  const current = JSON.parse(JSON.stringify(patch)) as Mutable;
  const baseline = new Set(auditClaims(brief, facts).map(claimKey));

  /* Ids first: a patch that names a line the brief does not have is a patch about another brief. */
  for (const id of unknownPatchIds(brief, current as BriefPatch)) {
    const [group, name] = id.split(".") as ["hooks" | "lines" | "drop", string];
    if (group === "drop") current.drop = (current.drop ?? []).filter((d) => d !== name);
    else delete current[group]?.[name];
    refused.push({ brief: brief.id, line: name, lang: "*", token: id, why: "unknown-id" });
  }
  /* A wordless piece has one opening, the kicker; a spoken one may try three. */
  if (WORDLESS.has(brief.recipe) && current.addHooks?.length) {
    for (const h of current.addHooks) refused.push({ brief: brief.id, line: h.id, lang: "*", token: h.id, why: "wordless-recipe" });
    delete current.addHooks;
  }
  /* An added hook renders in every language of the brief, so it must speak all of them. */
  current.addHooks = (current.addHooks ?? []).filter((h) => {
    const missing = brief.langs.filter((l) => !h.text[l]?.trim());
    if (missing.length === 0) return true;
    refused.push({ brief: brief.id, line: h.id, lang: missing.join(","), token: h.id, why: "missing-language" });
    return false;
  });
  if (current.addHooks.length === 0) delete current.addHooks;

  for (let round = 0; round < 12; round++) {
    const patched = applyPatch(brief, current as BriefPatch);
    const claims = auditClaims(patched, facts).filter((c) => !baseline.has(claimKey(c)));
    /* Cards that would not fit the recipe: measured on the expanded words, which is what lands on screen. */
    const long: Claim[] = [];
    if (WORDLESS.has(brief.recipe)) {
      for (const line of patched.lines.filter((l) => l.mark)) {
        for (const [lang, text] of Object.entries(line.text)) {
          if (words(expandFacts(text, facts)) > TRAILER_CLAIM_MAX_WORDS) long.push({ line: line.id, lang, token: text, why: "literal-number" });
        }
        for (const [lang, text] of Object.entries(line.label ?? {})) {
          if (words(expandFacts(text, facts)) > LABEL_MAX_WORDS) long.push({ line: line.id, lang, token: text, why: "literal-number", field: "label" });
        }
      }
    }
    const offending = [...claims, ...long.filter((l) => !baseline.has(claimKey(l)))];
    /* Only what the patch itself introduced can be stripped from it; the rest was the template's already. */
    const stripped = offending.filter((c) => touches(current, c.line, c.lang, c.field === "label" ? "label" : "text"));
    if (stripped.length === 0) break;
    for (const c of stripped) {
      strip(current, c.line, c.lang, c.field === "label" ? "label" : "text");
      refused.push({ brief: brief.id, line: c.line, lang: c.lang, token: c.token, why: long.includes(c) ? "too-long" : c.why });
    }
  }
  /* A result chip is never the brain's to write; the interface's own heading is. */
  for (const group of [current.hooks, current.lines]) for (const entry of Object.values(group ?? {})) delete (entry as { result?: unknown }).result;
  return { patch: current as BriefPatch, refused };
}

function touches(patch: Mutable, line: string, lang: string, field: "text" | "label"): boolean {
  const inGroup = (g?: Record<string, { text?: Record<string, string>; label?: Record<string, string> }>) => Boolean(g?.[line]?.[field]?.[lang] !== undefined);
  const inList = (l?: { id: string; text: Record<string, string>; label?: Record<string, string> }[]) => Boolean(l?.some((x) => x.id === line && (field === "text" ? x.text[lang] !== undefined : x.label?.[lang] !== undefined)));
  return inGroup(patch.hooks) || inGroup(patch.lines) || inList(patch.add) || inList(patch.addHooks);
}

/* ---------- write ---------- */

export type WrittenPlan = {
  patches: Record<string, BriefPatch>;
  dropped: { id: string; why: string }[];
  why: Record<string, string>;
  refused: Refusal[];
  hit: boolean;
};

export async function writeFor(brain: Brain, input: { thesis: Thesis; plan: Plan; langs: string[]; tour?: TourScript; about?: string; angle?: string; evidence?: string }): Promise<WrittenPlan> {
  const answer = await brain.ask(
    writeQuestion({
      thesis: input.thesis,
      langs: input.langs,
      facts: factRows(input.plan.facts),
      moments: momentsView(input.tour),
      briefs: input.plan.briefs.map((b) => viewOf(b.brief, b.goal)),
      claimMaxWords: TRAILER_CLAIM_MAX_WORDS,
      ...(input.about ? { about: input.about } : {}),
      ...(input.angle ? { angle: input.angle } : {}),
      ...(input.evidence ? { evidence: input.evidence } : {}),
    }),
  );
  const out: WrittenPlan = { patches: {}, dropped: [], why: {}, refused: [], hit: answer.hit };
  for (const written of answer.value.briefs) {
    const planned = input.plan.briefs.find((b) => b.brief.id === written.id);
    if (!planned) continue;
    const brief = planned.brief;
    out.why[brief.id] = written.why;
    if (!written.keep) {
      out.dropped.push({ id: brief.id, why: written.why });
      continue;
    }
    const [first, ...more] = written.hooks;
    const templateHook = brief.hooks[0];
    const lineIds = new Set(brief.lines.map((l) => l.id));
    const raw: BriefPatch = {
      hooks: first ? { [templateHook.id]: { text: first.text } } : undefined,
      lines: written.lines,
      drop: written.drop,
      addHooks: more.filter((h) => h.id !== templateHook.id && !lineIds.has(h.id)).map((h): Line => ({ id: h.id, text: h.text, ...(templateHook.mode ? { mode: templateHook.mode } : {}) })),
    };
    const { patch, refused } = sanitizePatch(brief, raw, input.plan.facts);
    out.patches[brief.id] = patch;
    out.refused.push(...refused);
  }
  return out;
}

/* ---------- fix ---------- */

/** The checks a rewrite can answer: the words are the problem, and the check says so. */
export function fixableChecks(checks: readonly ReviewCheck[]): ReviewCheck[] {
  return checks.filter((c) => c.fix?.by === "plan" && (c.status === "fail" || (c.status === "warn" && c.id === "story.captions")));
}

export async function fixFor(brain: Brain, input: { thesis?: Thesis; brief: Brief; goal: string; facts: FactSheet; checks: readonly ReviewCheck[]; langs: string[] }): Promise<{ patch: BriefPatch; refused: Refusal[]; why: string; hit: boolean }> {
  const answer = await brain.ask(
    fixQuestion({
      thesis: input.thesis,
      langs: input.langs,
      facts: factRows(input.facts),
      brief: viewOf(input.brief, input.goal),
      checks: input.checks.map((c) => ({ id: c.id, status: c.status, summary: c.summary, threshold: c.threshold, hint: c.fix?.hint, details: c.details })),
    }),
  );
  const raw: BriefPatch = { hooks: answer.value.hooks, lines: answer.value.lines, drop: answer.value.drop };
  const { patch, refused } = sanitizePatch(input.brief, raw, input.facts);
  return { patch, refused, why: answer.value.why, hit: answer.hit };
}

/* ---------- kit ---------- */

const NUMBER = /v?\d[\d.,:%]*/g;

/** Every number in a copy is the value of a fact, written exactly, or the copy is not used. */
export function numbersVouched(text: string, facts: FactSheet): boolean {
  const vouchers = facts.facts.map((f) => f.value);
  for (const m of text.matchAll(NUMBER)) {
    /* The stop or the colon after a version belongs to the sentence, not to the number. */
    const token = m[0].replace(/[.,:]+$/, "");
    if (!vouchers.some((v) => v.includes(token))) return false;
  }
  return true;
}

export async function kitFor(brain: Brain, input: { thesis?: Thesis; brief: Brief; hook: Line; lang: string; targets: readonly string[]; facts: FactSheet }): Promise<Copy | null> {
  try {
    const answer = await brain.ask(
      kitQuestion({
        close: input.brief.promo?.close,
        thesis: input.thesis,
        brief: { id: input.brief.id, recipe: input.brief.recipe },
        hook: { id: input.hook.id, text: input.hook.text[input.lang] ?? Object.values(input.hook.text)[0] ?? "" },
        lines: input.brief.lines.map((l) => l.text[input.lang]).filter((t): t is string => Boolean(t)),
        lang: input.lang,
        targets: [...input.targets],
        facts: factRows(input.facts),
      }),
    );
    /*
      A post is final text: a {{fact:id}} the brain left in — the system prompt tells
      it to write facts that way — is expanded here, and an id the sheet does not have
      throws, which is the template's copy. The numbers are then audited on the words
      a person would paste.
    */
    const expanded = (t: string) => expandFacts(t, input.facts);
    const copy = { short: expanded(answer.value.short), x: expanded(answer.value.x), linkedin: expanded(answer.value.linkedin), youtubeTitle: expanded(answer.value.youtubeTitle), youtubeDescription: expanded(answer.value.youtubeDescription), hashtags: answer.value.hashtags };
    const fields = [copy.short, copy.x, copy.linkedin, copy.youtubeTitle, copy.youtubeDescription];
    if (!fields.every((t) => numbersVouched(t, input.facts))) return null;
    /* A kit without the placeholder is a kit someone pastes with a guessed address. */
    if (input.brief.recipe === "ProductPromo" && input.brief.promo?.close?.kind === "brand") {
      if (hasDestinationClaim(copy)) return null;
    } else if (![copy.x, copy.linkedin, copy.youtubeDescription].every((t) => t.includes("{{LINK}}"))) return null;
    return copy;
  } catch {
    return null;
  }
}

/* ---------- the files ---------- */

const brainPatchPath = (ws: Workspace, id: string) => join(ws.paths.briefs, `${id}.brain.json`);

export async function readBrainPatches(ws: Workspace, ids: readonly string[]): Promise<Record<string, BriefPatch[]>> {
  const out: Record<string, BriefPatch[]> = {};
  for (const id of ids) {
    const file = await readJson<BrainPatchFile>(brainPatchPath(ws, id));
    if (!file) continue;
    const list = [...(file.write ? [file.write] : []), ...(file.fixes ?? [])];
    if (list.length > 0) out[id] = list;
  }
  return out;
}

export async function writeBrainPatch(ws: Workspace, id: string, update: (file: BrainPatchFile) => BrainPatchFile): Promise<void> {
  const previous = (await readJson<BrainPatchFile>(brainPatchPath(ws, id))) ?? { fixes: [] };
  await writeJson(brainPatchPath(ws, id), update({ ...previous, fixes: previous.fixes ?? [] }));
}
