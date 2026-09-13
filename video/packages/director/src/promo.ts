/*
  A promotion earns its words from a recorded result. The brain chooses who should
  care, which supported benefit to emphasize and which demonstrations make it clear.
  It cannot choose a nonexistent proof, borrow another proof's facts, or edit a clock.
  Reference and footage checks are deterministic; relevance of a paraphrased benefit
  remains a model judgment, recorded as such rather than called a factual guarantee.
*/
import { auditClaims, expandFacts, factIds, FORMATS, JOBS, isDisplayableSource, isProductDestination, tokens, type Brief, type EditorialTheme, type Fact, type FactSheet, type FormatId, type Line, type PromoClose } from "@panoma/video-core";
import { PromoShape, promoQuestion, type Brain, type Promo, type PromoInput, type Thesis } from "@panoma/video-brain";
import { TAKE_DESKTOP, TAKE_MOBILE, type SessionLog } from "@panoma/video-capture";
import { promoSplitResultScale } from "@panoma/video-render/timing";
import type { ProjectProfile } from "@panoma/video-scout";
import { isChrome, isDestructive, isExternal, type TourScript } from "@panoma/video-tour";
import { detectLang, enrichFacts, isName, slotsOf } from "./plan.ts";
import { hasCaptureTakes, selectedTakes } from "./capture-formats.ts";

export const PROMO_VERSION = 15;
export type PromoThemeRequest = "auto" | "normal" | EditorialTheme;
export type PromoThemeDecision = { id: EditorialTheme; by: "default" | "user" | "brain" | "arithmetic"; why: string };

export const PROMO_THEMES = [
  { id: "flat", name: "Normal / Flat", purpose: "Restrained type, clear surfaces and quiet details for dense, technical or measured explanations.", motion: "A stable opening poster, gentle whole-title settling and quiet list reveals leave room to read." },
  { id: "vibrant", name: "Vibrant", purpose: "Strong color fields and decisive graphic accents for an expressive product and a concise selling argument.", motion: "Titles rise once as their accent sweeps across the baseline; compact panels and quick list arrivals then hold still." },
  { id: "block", name: "Block-based", purpose: "Confident rounded panels, bold outlines and crisp offset bases for a graphic product campaign.", motion: "Titles stamp into place; the closing button compresses once, and each source panel or recap row docks before reading." },
  { id: "grid", name: "Grid / Assembly", purpose: "Monochrome ink and paper, a fine static lattice across the whole film, exact phrase groups and layered editorial cards create a precise, tactile presentation. Added graphics stay neutral even for a colorful brand.", motion: "The first poster is already readable; later titles assemble decisively with dry sonic accents, then hold. Added paper cards flex, dock and stack without covering their copy; the recorded app keeps its real colors and never bends." },
] as const;

/** Validate public requests without turning omission into automatic consent. */
export function parsePromoTheme(value: unknown): "auto" | EditorialTheme | undefined {
  if (value === undefined) return undefined;
  if (value === "normal") return "flat";
  if (value === "auto" || value === "flat" || value === "vibrant" || value === "block" || value === "grid") return value;
  throw new Error("theme must be normal, flat, vibrant, block, grid or auto; one theme applies to the entire promotion.");
}

/** Only a saved explicit user selection survives omission. Auto is opt-in per run. */
export function retainedPromoTheme(requested: PromoThemeRequest | undefined, saved: unknown): "auto" | EditorialTheme | undefined {
  const parsed = parsePromoTheme(requested);
  if (requested !== undefined) return parsed;
  if (saved && typeof saved === "object" && "theme" in saved) {
    const theme = saved.theme;
    if (theme && typeof theme === "object" && "by" in theme && theme.by === "user" && "id" in theme && (theme.id === "flat" || theme.id === "vibrant" || theme.id === "block" || theme.id === "grid")) return theme.id;
  }
  return undefined;
}

/** Conservative material-based proposal. Music never chooses or changes a theme. */
export function proposePromoTheme(input: Pick<PromoForInput, "profile" | "thesis" | "direction">, pace: Promo["pace"]): PromoThemeDecision {
  const tone = input.thesis?.tone;
  const expressive = tone === "playful" || (input.direction?.signal === "chromatic" && input.direction?.name === "kinetic" && tone !== "technical" && tone !== "formal");
  if (input.profile.kind === "web-app" && pace === "crisp" && expressive) {
    return { id: "vibrant", by: "arithmetic", why: "A concise demonstration and an expressive product register support strong editorial blocks; the recorded interface keeps its own appearance." };
  }
  return { id: "flat", by: "arithmetic", why: pace === "measured" ? "The measured explanation needs quiet surfaces and a clear reading hierarchy." : "No clear combination of concise proof and expressive product context justifies a stronger graphic treatment." };
}

function themeFor(input: PromoForInput, choice: Promo, by: PromoDecision["by"]): PromoThemeDecision {
  const requested = parsePromoTheme(input.theme);
  if (requested === undefined) return { id: "flat", by: "default", why: "Normal / Flat is the default. No expressive theme or automatic theme selection was requested." };
  if (requested !== "auto") return { id: requested, by: "user", why: "The caller explicitly selected this single theme for the entire promotion and every variant." };
  if (by === "brain" && choice.theme) return { id: choice.theme, by: "brain", why: choice.themeWhy ?? choice.why.slice(0, 300) };
  return proposePromoTheme(input, choice.pace);
}
export type PromoForInput = {
  profile: ProjectProfile;
  facts: FactSheet;
  tour?: TourScript;
  takes: readonly SessionLog[];
  formats?: readonly FormatId[];
  langs: readonly ("en" | "es")[];
  /** Optional user editorial request; selection guidance, never a source fact. */
  creative?: string;
  /** Omitted is Normal / Flat. Only explicit auto lets the brain select an expressive theme. */
  theme?: PromoThemeRequest;
  thesis?: Thesis;
  music?: Brief["music"];
  direction?: { sound: { bpm: number }; name?: "editorial" | "kinetic" | "plain"; signal?: "chromatic" | "mono" };
  /** A saved choice is revalidated; ignored with no brain, which stays deterministic. */
  cached?: unknown;
};
export type PromoCandidate = {
  id: string;
  label: string;
  result?: string;
  facts: Fact[];
  takes: string[];
  change: number;
  /** Effects are offered only when their physical prerequisites exist in every take. */
  treatments: ("full" | "focus" | "split")[];
  /** Automatic selection avoids extra miniaturization; this does not certify text legibility. */
  split?: { allowed: boolean; reason: string; scales: { take: string; format: string; cssScale: number }[] };
  /** Observed page context guides interpretation; its incidental counts are not quotable facts. */
  context: { before?: string; after?: string; source: string };
  /** Evidence specificity is an editorial retrieval aid, never a business-value score. */
  editorial: {
    kind: "named-result" | "presentation" | "setup" | "visible-change";
    reasons: string[];
    resultState?: string;
    /** Exact lexical retrieval terms, not verification of the source's entire claim. */
    sourceMatches?: { fact: string; resultTerms: string[]; actionTerms: string[]; contextTerms: string[] }[];
  };
  observation: {
    beforeRoute?: string;
    afterRoute?: string;
    headingChanged: boolean;
    routeChanged: boolean;
    takes: { take: string; pressAtMs: number; endAtMs: number; settledAtMs?: number; actionKinds: string[]; change: number }[];
  };
};
export type PromoRefusal = { id: string; why: string; lang?: string; token?: string };
export type PromoEditorialIssue = {
  code: "generic-hook" | "generic-benefit" | "generic-audience" | "missing-argument" | "observation-only-benefit" | "source-only-argument" | "repeated-benefit" | "repeated-hook" | "repeated-result" | "presentation-lead" | "setup-lead" | "unspecified-result";
  id: string;
  lang?: string;
  why: string;
  suggestion: string;
  /** Only exact copy patterns, never inferred product meaning, can request repair. */
  repairable: boolean;
};
export type PromoEditorialAssessment = {
  status: "needs-review" | "clear-of-listed-checks";
  scope: string;
  issues: PromoEditorialIssue[];
  ranking: { id: string; kind: PromoCandidate["editorial"]["kind"]; selected: boolean; reasons: string[] }[];
};
export type PromoDecision = {
  version: number;
  by: "arithmetic" | "brain";
  audience: string;
  tension: string;
  /** Internal hypotheses and source reasoning, never customer research or new facts. */
  argument?: Promo["argument"];
  opening: Promo["opening"];
  pace: Promo["pace"];
  theme: PromoThemeDecision;
  close?: PromoClose;
  /** Geometry decisions for new automatic plans; explicit revisions keep their treatment menu. */
  presentation?: { id: string; split: NonNullable<PromoCandidate["split"]> }[];
  selected: { id: string; facts: string[]; treatment?: "full" | "focus" | "split"; why: string }[];
  why: string;
  validation: string;
  editorial: PromoEditorialAssessment;
  choice: Promo;
  /** The refused first decision remains visible even when the one correction succeeds. */
  repair?: { accepted: boolean; refused: PromoRefusal[] };
};
export type PromoResult = { brief?: Brief; facts: FactSheet; decision: PromoDecision; refused: PromoRefusal[]; why?: string };

const ref = (id: string) => `{{fact:${id}}}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "product";
const finiteBox = (box: { x: number; y: number; width: number; height: number }) =>
  [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0;
const sameOrigin = (a: string, b: string) => {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
};
const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
/* Only a lexical retrieval aid: a match offers a source for the model to assess,
   never establishes that the observed action entails the source's whole sentence. */
const RETRIEVAL_ACTIONS = new Set("app apps application applications product products producto productos page pages página páginas screen screens pantalla pantallas open show view click select choose go use using see start abrir abre mostrar muestra ver clic seleccionar selecciona elegir elige usar usa inicio".split(" "));
const vocabularyOf = (text: string) => [...new Set(tokens(text.replace(/[^\p{L}\p{N}]+/gu, " "))
  .filter(token => /\p{L}/u.test(token) && !RETRIEVAL_ACTIONS.has(token))
  .map(token => token.length > 4 && /[^s]s$/.test(token) ? token.slice(0, -1) : token))];

/** Retrieve before bounding: an early generic README line cannot crowd out the result's source. */
function relatedSources(facts: readonly Fact[], names: { action: string; result?: string; context?: string }) {
  const resultWords = vocabularyOf(names.result ?? ""), actionWords = vocabularyOf(names.action), contextWords = vocabularyOf(names.context ?? "");
  return facts.filter(fact => fact.source.trim() && !fact.id.startsWith("ui.") && !fact.id.startsWith("observed.") &&
    ["feature", "text"].includes(fact.kind) && !/^(?:readme\.title$|readme\.section\.)/.test(fact.id) &&
    /^(?:readme\.|pkg\.description$|changelog\.(?:added|changed)\.)/.test(fact.id))
    .map(fact => {
      const words = new Set(vocabularyOf(fact.value));
      return { fact, match: { fact: fact.id, resultTerms: resultWords.filter(word => words.has(word)),
        actionTerms: actionWords.filter(word => words.has(word)), contextTerms: contextWords.filter(word => words.has(word)) } };
    })
    .filter(entry => entry.match.resultTerms.length + entry.match.actionTerms.length + entry.match.contextTerms.length > 0)
    .sort((a, b) => b.match.resultTerms.length - a.match.resultTerms.length || b.match.actionTerms.length - a.match.actionTerms.length ||
      b.match.contextTerms.length - a.match.contextTerms.length || a.fact.id.localeCompare(b.fact.id))
    .slice(0, 6);
}

/** The named outcome needs a real heading on the result frame in every served take. */
function headingWitness(take: SessionLog, mark: string, heading: string): boolean {
  const macro = take.macros?.find(entry => entry.mark === mark);
  const witness = macro?.resultHeading;
  const box = witness?.box, view = macro?.viewport;
  return Boolean(witness && witness.text === heading && witness.centerVisible === true && Number.isFinite(witness.visibleShare) && witness.visibleShare >= 0.9 && witness.visibleShare <= 1 &&
    box && view && finiteBox(box) && box.width > 1 && box.height > 1 &&
    Number.isFinite(view.width) && Number.isFinite(view.height) && view.width > 0 && view.height > 0 &&
    box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width && box.y + box.height <= view.height);
}

/** A focus mask may only isolate a visible measured result, never a guessed crop. */
export function promoFocusAvailable(takes: readonly SessionLog[], mark: string): boolean {
  return takes.length > 0 && takes.every((take) => {
    const macro = take.macros?.find((entry) => entry.mark === mark);
    const box = macro?.change?.box;
    const view = macro?.viewport;
    return Boolean(box && view && finiteBox(box) && Number.isFinite(view.width) && Number.isFinite(view.height) &&
      view.width > 0 && view.height > 0 && box.x >= 0 && box.y >= 0 &&
      box.x + box.width <= view.width && box.y + box.height <= view.height &&
      box.width >= 16 && box.height >= 16 && box.width <= view.width * 0.9 && box.height <= view.height * 0.9 &&
      box.width * box.height <= view.width * view.height * 0.72);
  });
}

/** Exact, small source excerpts are editorial material, never fabricated execution. */
export function promoInsertCandidates(facts: FactSheet, langs: readonly string[]): NonNullable<PromoInput["inserts"]> {
  return facts.facts.flatMap((fact) => {
    if (fact.kind !== "command" && fact.kind !== "code") return [];
    const rows = fact.value.split("\n");
    if (!fact.source.trim() || !fact.value.trim() || !isDisplayableSource(fact.value) || [...fact.value].length > 400 || rows.length > 8 ||
        rows.some((row) => [...row].length > 70) || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(fact.value) ||
        (fact.lang && langs.some((lang) => lang !== fact.lang))) return [];
    return [{ kind: fact.kind === "command" ? "terminal" as const : "code" as const, fact }];
  });
}

/** Explicit empty or unsettled screens do not demonstrate a completed product benefit. */
function unavailableResult(heading: string): string | undefined {
  const value = heading.trim().replace(/[.!…]+$/, "").trim();
  if (/^(?:no\s+.+\s+(?:yet|found|available)|no (?:data|results|proposals|runs|items|projects)|nothing (?:here|to (?:show|display))|(?:aún|todavía) no hay\b.*|no hay .+ (?:aún|todavía)|sin (?:datos|resultados|propuestas|elementos)(?: todavía| aún)?)$/iu.test(value)) return "an empty result is not evidence of a completed capability";
  if (/^(?:loading(?:\s+(?:data|results|projects))?|cargando(?:\s+(?:datos|resultados|proyectos))?|please wait|espera un momento|connecting|conectando)$/iu.test(value)) return "a loading state is not a completed result";
  if (/^(?:something went wrong|an error occurred|ha ocurrido un error|algo salió mal|error(?::.*)?|failed to\b.*|no se pudo\b.*)$/iu.test(value)) return "an error state is not a completed result";
  return undefined;
}

/** A page title cannot supply the missing object of an "open it" control. */
function ambiguousReferent(label: string): boolean {
  const text = label.normalize("NFD").replace(/\p{M}/gu, "");
  return /\b(?:it|lo|esto|eso|aquello)\b/iu.test(text) ||
    /\b(?:this|that|these|those)(?=\s*(?:$|[.!?…,:;—-])|\s+(?:in|on|with|from|to|for|again|here|there|now)\b)/iu.test(text) ||
    /\b(?:abrir|abre|mostrar|muestra|usar|usa|editar|edita|cambiar|cambia|mover|mueve|guardar|guarda|hacer|haz|ver|llevar|lleva|anadir|anade)(?:lo|la|los|las)\b/iu.test(text);
}

const normalizeCopy = (text: string) => text.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, " ").trim();
/* Narrow names for presenting choices, not a semantic classifier. A resulting
   named destination can override the control's preparatory wording. */
const PRESENTATION = /^(?:(?:open|show|abrir|mostrar)\s+)?(?:menu|menú|formas de abrir)$|^(?:.+\s+)?(?:options|opciones|choices|settings|preferences|ajustes|preferencias)$|^(?:list|grid|table|board|vista de lista|vista de cuadrícula|vista de tabla|lista|cuadrícula)\s*(?:view)?$|^(?:choose|select|elige|elegir|selecciona|seleccionar)\s+(?:a |an |el |la )?(?:format|view|layout|destination|formato|vista|diseño|destino)$/iu;
const SETUP = /^(?:getting started|setup|set up|configuration|configuración|onboarding|primeros pasos|configurar|configuración inicial)$|\b(?:step by step|paso a paso)[.!…]*$/iu;

function evidenceKind(label: string, result: string | undefined, namedResult: boolean): PromoCandidate["editorial"] {
  if (SETUP.test(result ?? "")) return { kind: "setup", reasons: ["The observed heading explicitly describes setup or step-by-step preparation. The screen does not establish that setup completed; prefer a usable recorded result when one exists."] };
  if (PRESENTATION.test(result ?? "") || (PRESENTATION.test(label) && (!namedResult || !result || normalizeCopy(result) === normalizeCopy(label)))) {
    return { kind: "presentation", reasons: ["The observed names describe a menu, configuration choice or view. This can demonstrate presentation, but does not establish completion of the action offered there."] };
  }
  if (namedResult && result) return { kind: "named-result", reasons: ["The recorded action has a named observed destination or changed heading. Its usefulness must still be judged from the action and supporting sources."] };
  return { kind: "visible-change", reasons: ["A product click changed pixels, but the available context does not name a distinct resulting state. Keep the claim narrow or capture a clearer outcome."] };
}

/** Specific observed results lead; a large menu repaint cannot outrank them. */
export function rankPromoCandidates(candidates: readonly PromoCandidate[]): PromoCandidate[] {
  const priority = { "named-result": 0, presentation: 1, setup: 2, "visible-change": 3 };
  // Presence is a tie-breaker, not a reward for a verbose heading or a longer README.
  const sourceResult = (candidate: PromoCandidate) => Number(candidate.editorial.sourceMatches?.some(match => match.resultTerms.length > 0) ?? false);
  return [...candidates].sort((a, b) => priority[a.editorial.kind] - priority[b.editorial.kind] || sourceResult(b) - sourceResult(a) || b.change - a.change || a.id.localeCompare(b.id));
}

/** Build the closed proof menu from actual clicks and measured after-images in every take. */
export function promoCandidates(input: PromoForInput, options: { automatic?: boolean } = {}): { candidates: PromoCandidate[]; facts: FactSheet; refused: PromoRefusal[] } {
  if (input.formats) input = { ...input, takes: selectedTakes(input.takes, input.formats) };
  /* Rebuild generated observations from this tour, including cached sheets. A stale
     interface name must not survive a changed recording under the same mark id. */
  const fresh = input.tour ? { ...input.facts, facts: input.facts.facts.filter((fact) => !/^(?:ui|observed)\./.test(fact.id)) } : input.facts;
  const read = enrichFacts(fresh, input.profile, input.tour);
  const enriched = { ...read, facts: [...new Map(read.facts.map((fact) => [fact.id, fact])).values()] };
  const witnessed = new Set(input.tour?.marks.filter(mark => mark.outcome?.heading && input.takes.length > 0 && input.takes.every(take => headingWitness(take, mark.name, mark.outcome!.heading!))).map(mark => mark.name));
  const facts = enriched.facts.filter(fact => !/^ui\..+\.result$/.test(fact.id) || witnessed.has(fact.id.slice(3, -7)));
  const refused: PromoRefusal[] = [];
  const candidates: PromoCandidate[] = [];
  if (!input.tour || input.takes.length === 0) return { candidates, facts: { ...enriched, facts }, refused };
  if (input.formats && !JOBS.sell.formats.some(format => input.formats!.includes(format))) {
    refused.push({ id: "formats", why: `A promotion is published as ${JOBS.sell.formats.join(" or ")}; the selected formats (${input.formats.join(", ")}) have neither.` });
    return { candidates, facts: { ...enriched, facts }, refused };
  }
  if (input.formats && !hasCaptureTakes(input.takes, input.formats)) {
    refused.push({ id: "takes", why: "A matching recording is required for every selected production format." });
    return { candidates, facts: { ...enriched, facts }, refused };
  }
  for (const mark of input.tour.marks) {
    if (mark.kind !== "cta" && mark.kind !== "flow") continue;
    const edge = input.tour.edges?.find((edge) => edge.mark === mark.name);
    const beforePage = input.tour.pages?.find((page) => page.id === edge?.from);
    const afterPage = input.tour.pages?.find((page) => page.id === edge?.to);
    const before = beforePage?.heading;
    // A graph title names the document, possibly from below the fold. Only the
    // settled, visible outcome can name what this recorded action actually showed.
    const after = witnessed.has(mark.name) ? mark.outcome?.heading : undefined;
    if (mark.outcome?.heading && !after) refused.push({ id: mark.name,
      why: `The named outcome is not visibly measured in every take (${input.takes.filter(take => !headingWitness(take, mark.name, mark.outcome!.heading!)).map(take => take.take).join(", ")}); its result fact is withheld. Recapture the visible result before citing it.` });
    const routeChanged = beforePage?.path && (mark.outcome?.route ?? afterPage?.path) && beforePage.path !== (mark.outcome?.route ?? afterPage?.path);
    const headingChanged = before?.trim() && after?.trim() && before.trim() !== after.trim();
    const ownOutcome = Boolean(after?.trim());
    if (mark.kind === "cta" && ambiguousReferent(mark.label) && !ownOutcome && !routeChanged && !headingChanged) {
      refused.push({ id: mark.name, why: "the control's object is ambiguous; record its target context or a distinct result before using it as independent proof" });
      continue;
    }
    const unavailable = after ? unavailableResult(after) : undefined;
    if (unavailable) {
      refused.push({ id: mark.name, why: unavailable });
      continue;
    }
    const unsafe = isChrome(mark.label) ?? isDestructive(mark.label) ?? isExternal(mark.label);
    if (unsafe) {
      refused.push({ id: mark.name, why: `control is outside promotional proof: ${unsafe}` });
      continue;
    }
    const changes: number[] = [];
    const observations: PromoCandidate["observation"]["takes"] = [];
    for (const take of input.takes) {
      const start = take.marks.find((m) => m.name === mark.name)?.t;
      const end = start === undefined ? 0 : Math.min(take.durationMs, ...take.marks.filter((m) => m.t > start).map((m) => m.t));
      const clicks = start === undefined ? [] : take.events.filter((event) => event.kind === "click" && event.role !== "chrome" && event.t >= start && event.t < end);
      const macro = take.macros?.find((m) => m.mark === mark.name);
      const changed = macro?.change;
      if (start === undefined || clicks.length === 0 || !macro || !sameOrigin(macro.url, input.tour.url) || !changed ||
          !Number.isFinite(changed.share) || changed.share <= 0 || changed.share > 1 || !finiteBox(changed.box)) {
        refused.push({ id: mark.name, why: `${take.take}: needs a recorded product click and a measured visible result` });
        break;
      }
      changes.push(changed.share);
      const pressAtMs = Math.min(...clicks.map((click) => click.t));
      const settledAtMs = macro.resultAtMs;
      observations.push({ take: take.take, pressAtMs, endAtMs: end,
        ...(settledAtMs !== undefined && Number.isFinite(settledAtMs) && settledAtMs >= pressAtMs && settledAtMs < end ? { settledAtMs } : {}),
        actionKinds: [...new Set(take.events.filter((event) => event.t >= start! && event.t < end && ["click", "key", "scroll"].includes(event.kind) && (!("role" in event) || event.role !== "chrome")).map((event) => event.kind))], change: changed.share });
    }
    if (changes.length !== input.takes.length) continue;
    const measured = facts.filter((fact) => fact.id === `ui.${mark.name}` || fact.id === `ui.${mark.name}.result`);
    const related = relatedSources(facts, { action: [mark.label, mark.outcome?.route ?? ""].join(" "), result: after, context: before });
    /* The smallest honest fallback, with the measurement that vouches for it. It never
       guesses what the control does from a long accessibility instruction. */
    const observed = input.langs.map((lang): Fact => ({
      id: `observed.${mark.name}.${lang}`,
      kind: "feature", lang,
      value: lang === "es" ? "Cambio visible" : "Visible change",
      source: `recording:${input.takes.map((take) => take.take).join(",")}#${mark.name} (product click followed by measured changed pixels)`,
    }));
    for (const fact of observed) if (!facts.some((f) => f.id === fact.id)) facts.push(fact);
    const editorial = evidenceKind(mark.label, after, Boolean(ownOutcome || headingChanged || routeChanged));
    const scales = JOBS.sell.formats.filter(format => !input.formats || input.formats.includes(format)).map((format) => {
      const preferred = format === "v" ? TAKE_MOBILE : TAKE_DESKTOP;
      const take = input.takes.find((entry) => entry.take === preferred);
      return { take: preferred, format, cssScale: take ? promoSplitResultScale(take, mark.name, FORMATS[format]) : 0 };
    });
    const below = scales.filter((entry) => !Number.isFinite(entry.cssScale) || entry.cssScale < 1 - 1e-6);
    const split = { allowed: below.length === 0, scales, reason: below.length
      ? `Split would shrink the measured result below its recorded CSS size (${below.map((entry) => `${entry.take}/${entry.format}: ${entry.cssScale.toFixed(3)} output pixels per CSS pixel`).join(", ")}). Use full for automatic selection; an explicit user revision may still choose split.`
      : "The settled split result preserves at least one output pixel per source CSS pixel in every served format. This limits additional miniaturization; it does not guarantee text legibility." };
    candidates.push({ id: mark.name, label: mark.label, ...(after ? { result: after } : {}),
      facts: [...new Map([...measured, ...related.map(entry => entry.fact), ...observed].map((fact) => [fact.id, fact])).values()],
      takes: input.takes.map((take) => take.take), change: Math.min(...changes),
      treatments: ["full", ...(promoFocusAvailable(input.takes, mark.name) ? ["focus" as const] : []), ...(!options.automatic || split.allowed ? ["split" as const] : [])], split,
      editorial: { ...editorial, sourceMatches: related.map(entry => entry.match),
        reasons: [...editorial.reasons, related.some(entry => entry.match.resultTerms.length > 0)
          ? "A sourced excerpt shares terms with the visibly measured result. It is offered before area-based ties; relevance and entailment still need editorial judgment."
          : "No source excerpt shares a meaningful term with the visibly measured result. This is a lexical retrieval limit, not evidence that every possible benefit is unsupported."],
        ...(edge?.to ? { resultState: edge.to } : {}) },
      observation: { ...(beforePage?.path ? { beforeRoute: beforePage.path } : {}),
        ...(mark.outcome?.route ?? afterPage?.path ? { afterRoute: mark.outcome?.route ?? afterPage?.path } : {}),
        headingChanged: Boolean(headingChanged), routeChanged: Boolean(routeChanged), takes: observations },
      context: { ...(before ? { before } : {}), ...(after ? { after } : {}),
        source: `tour:${input.tour.name}#${mark.name} (before names the source document; after is a heading witnessed in every recorded take; counts are context, not claims)` } });
  }
  return { candidates, facts: { ...enriched, facts }, refused };
}

function fallback(input: PromoForInput, candidates: PromoCandidate[]): Promo {
  const states = new Set<string>();
  const selected = rankPromoCandidates(candidates).filter((candidate) => {
    const state = candidate.editorial.resultState;
    if (state && states.has(state)) return false;
    if (state) states.add(state);
    return true;
  }).slice(0, 3);
  const proofs = selected.map((candidate, index) => {
    const used = new Set<string>();
    const text = Object.fromEntries(input.langs.map((lang) => {
      const readable = (fact: Fact) => (!fact.lang || fact.lang === lang) && isName(fact.value) && [...fact.value].length <= 55;
      const named = candidate.facts.find((fact) => fact.id === `ui.${candidate.id}.result` && readable(fact)) ??
        candidate.facts.find((fact) => fact.id === `ui.${candidate.id}` && readable(fact));
      const chosen = named ?? candidate.facts.find((fact) => fact.id === `observed.${candidate.id}.${lang}`)!;
      used.add(chosen.id);
      return [lang, ref(chosen.id)];
    }));
    const treatment = candidate.treatments.includes("focus") ? "focus" as const : index === 0 && candidate.treatments.includes("split") ? "split" as const : "full" as const;
    return { id: candidate.id, text, facts: [...used], treatment, why: "The named state is recorded after a product click in every take; no wider benefit is inferred. Its measured geometry determines whether the result can be isolated." };
  });
  return {
    audience: "People considering this product",
    tension: "The viewer needs to see what using the product actually changes.",
    opening: "result", pace: selected.some((candidate) => candidate.observation.takes.some((take) => take.settledAtMs !== undefined ? take.settledAtMs - take.pressAtMs > 1200 : take.change > 0.35)) ? "measured" : "crisp",
    hooks: [Object.fromEntries(input.langs.map((lang) => [lang, lang === "es" ? "Mira lo que cambia." : "See what changes."]))],
    proofs,
    recap: proofs.length >= 2,
    why: "Named observed results lead before presentation controls, explicit setup screens and unspecified changes. Repeated recorded destinations are omitted. No model supplied a supported audience benefit, so the copy describes only observed capability.",
  };
}

const GENERIC_HOOK = /^(?:see what changes|see it in action|meet the future|transform your workflow|work smarter|unlock your potential|mira lo que cambia|mira c[oó]mo funciona|conoce el futuro|transforma tu (?:trabajo|flujo de trabajo)|trabaja de forma inteligente)$/iu;
const GENERIC_BENEFIT = /^(?:visible change|something changes|it works|cambio visible|algo cambia|funciona)$/iu;
const GENERIC_AUDIENCE = /^(?:everyone|everybody|anyone|users|people|potential (?:users|customers)|people (?:considering|interested in) (?:this|the) (?:product|app)|todos|todo el mundo|cualquiera|usuarios|personas|(?:usuarios|clientes) potenciales|personas interesadas en (?:este|el|esta|la) (?:producto|app|aplicación))$/iu;

/** A transparent editorial checklist, not an engagement score or semantic proof. */
export function assessPromo(input: PromoForInput, facts: FactSheet, candidates: readonly PromoCandidate[], choice: Promo): PromoEditorialAssessment {
  const issues: PromoEditorialIssue[] = [];
  const expand = (raw: string) => { try { return normalizeCopy(expandFacts(raw, facts)); } catch { return normalizeCopy(raw); } };
  if (GENERIC_AUDIENCE.test(normalizeCopy(choice.audience))) issues.push({ code: "generic-audience", id: "audience", repairable: true,
    why: "The audience matches an exact generic label without a task or situation.", suggestion: "Identify the supported task or viewing situation as an internal hypothesis; do not invent customer research or a wider promise." });
  if (!choice.argument) issues.push({ code: "missing-argument", id: "argument", repairable: false,
    why: "This decision has no explicit link from an audience situation to its leading demonstration.", suggestion: "For a new story, describe the desired outcome, leading proof, supporting facts and the limits of what this material establishes. Older decisions remain usable." });
  if (choice.argument && !choice.argument.facts.some(id => id === `ui.${choice.argument!.proof}.result` || id.startsWith(`observed.${choice.argument!.proof}.`))) issues.push({ code: "source-only-argument", id: "argument", repairable: false,
    why: "The internal argument cites no named visible result or recorded-change fact, even though its selected demonstration has footage.", suggestion: "Review the link between this source explanation and the visible outcome; source prose alone does not establish that the whole claimed capability was demonstrated." });
  for (const lang of input.langs) {
    const hooks = new Map<string, string>();
    for (const [index, hook] of choice.hooks.entries()) {
      const id = `hook-${index + 1}`;
      const text = expand(hook[lang] ?? "");
      if (GENERIC_HOOK.test(text)) issues.push({ code: "generic-hook", id, lang, repairable: true,
        why: "The opening matches a generic invitation that does not name this product's supported value.", suggestion: "Name the useful observed outcome of the first proof in concise native copy." });
      if (text && hooks.has(text)) issues.push({ code: "repeated-hook", id, lang, repairable: true,
        why: `This opening repeats ${hooks.get(text)} after punctuation and spacing are normalized.`, suggestion: "Keep one version or supply a meaningfully different opening bound to the same first proof." });
      if (text) hooks.set(text, id);
    }
    const benefits = new Map<string, string>();
    for (const proof of choice.proofs) {
      const text = expand(proof.text[lang] ?? "");
      if (GENERIC_BENEFIT.test(text)) issues.push({ code: "generic-benefit", id: proof.id, lang, repairable: true,
        why: "The copy reports only a visible change, without identifying what the viewer can use.", suggestion: "Name the supported result, or capture a more explicit result before making a wider benefit claim." });
      if (text && benefits.has(text)) issues.push({ code: "repeated-benefit", id: proof.id, lang, repairable: true,
        why: `This benefit repeats ${benefits.get(text)} after punctuation and spacing are normalized.`, suggestion: "Keep the stronger proof or describe each distinct supported outcome; do not pad the film with repeated copy." });
      if (text) benefits.set(text, proof.id);
    }
  }
  const first = candidates.find((candidate) => candidate.id === choice.proofs[0]?.id);
  if (first?.editorial.kind === "presentation" && candidates.some((candidate) => candidate.editorial.kind === "named-result")) issues.push({
    code: "presentation-lead", id: first.id, repairable: false,
    why: "The film leads with a presentation or choice control while a named observed result is available. A menu opening does not establish that its offered action completed.",
    suggestion: "Consider leading with the named result, or explain why this presentation control is itself the supported selling point." });
  if (first?.editorial.kind === "setup" && candidates.some((candidate) => candidate.editorial.kind === "named-result")) issues.push({
    code: "setup-lead", id: first.id, repairable: false,
    why: "The film leads with explicitly named setup instructions while a named observed result is available. Showing preparation does not establish completion.",
    suggestion: "Consider showing the usable result first, or explain why the setup experience itself is the supported value for this audience." });
  const states = new Map<string, string>();
  for (const proof of choice.proofs) {
    const candidate = candidates.find((entry) => entry.id === proof.id);
    if (proof.facts.length > 0 && proof.facts.every(id => id.startsWith(`observed.${proof.id}.`))) issues.push({ code: "observation-only-benefit", id: proof.id, repairable: false,
      why: "Every cited fact says only that pixels changed; none names the result or explains its capability.", suggestion: "Keep the benefit narrow and inspect what the footage actually shows, or capture and source the named result before widening the promise." });
    if (candidate?.editorial.kind === "visible-change") issues.push({ code: "unspecified-result", id: proof.id, repairable: false,
      why: "The recording establishes a change but its observed context does not name a distinct result.", suggestion: "Review the clip's actual result before interpreting it as a benefit, or record a clearer destination." });
    const state = candidate?.editorial.resultState;
    if (state && states.has(state)) issues.push({ code: "repeated-result", id: proof.id, repairable: false,
      why: `The tour records the same destination state as ${states.get(state)}. Different clicks do not automatically demonstrate different benefits.`, suggestion: "Keep both only when their distinct supported purposes matter to this audience." });
    if (state) states.set(state, proof.id);
  }
  return { status: issues.length ? "needs-review" : "clear-of-listed-checks",
    scope: "Limited checks of exact copy and audience patterns, explicit argument references, repeated recorded states and observed result specificity. Audience situations and desired outcomes are internal hypotheses. No claim of semantic entailment, professional quality, sales impact or predicted engagement.",
    issues, ranking: rankPromoCandidates(candidates).map((candidate) => ({ id: candidate.id, kind: candidate.editorial.kind,
      selected: choice.proofs.some((proof) => proof.id === candidate.id), reasons: candidate.editorial.reasons })) };
}

function decision(input: PromoForInput, facts: FactSheet, candidates: PromoCandidate[], choice: Promo, by: PromoDecision["by"]): PromoDecision {
  const theme = themeFor(input, choice, by);
  return { version: PROMO_VERSION, by, audience: choice.audience, tension: choice.tension, opening: choice.opening, pace: choice.pace, theme,
    ...(choice.argument ? { argument: choice.argument } : {}),
    close: promoCloseFor(facts),
    presentation: candidates.filter((candidate) => candidate.split).map((candidate) => ({ id: candidate.id, split: candidate.split! })),
    selected: choice.proofs.map(({ id, facts, treatment, why }) => ({ id, facts, ...(treatment ? { treatment } : {}), why })), why: choice.why, choice: { ...choice, theme: theme.id, themeWhy: theme.why },
    editorial: assessPromo(input, facts, candidates, choice),
    validation: "Footage, fact references, language tracks and restricted claims are checked. Relevance and entailment of paraphrased benefits remain model judgment, not a deterministic factual guarantee." };
}

/** Missing deployment information is not a missing product. Never infer a URL from a brand or repository. */
export function promoCloseFor(facts: FactSheet): PromoClose | undefined {
  const slots = slotsOf(facts);
  const name = facts.facts.find((fact) => fact.id === slots.name && fact.source.trim());
  if (!name) return undefined;
  const destination = [slots.url, slots.docs].map((id) => facts.facts.find((fact) =>
    fact.id === id && fact.kind === "url" && fact.source.trim() && isProductDestination(fact.value))).find(Boolean);
  return destination ? { kind: "destination", fact: destination.id, source: destination.source }
    : { kind: "brand", fact: name.id, source: name.source, reason: "no-public-destination" };
}

export function compilePromoChoice(input: PromoForInput, facts: FactSheet, choice: Promo, by: PromoDecision["by"] = "arithmetic"): Brief | undefined {
  if (choice.proofs.length === 0) return undefined;
  const slots = slotsOf(facts);
  const close = promoCloseFor(facts);
  if (!close) return undefined;
  const lines: Line[] = choice.proofs.map((proof, index) => ({ id: `benefit-${index + 1}`, mark: proof.id, mode: "type", text: proof.text }));
  const inserts = (choice.inserts ?? []).map((insert, index) => {
    const line = `insert-${index + 1}`;
    lines.push({ id: line, mode: "type", text: Object.fromEntries(input.langs.map((lang) => [lang, ref(insert.fact)])) });
    return { kind: insert.kind, line, after: `benefit-${choice.proofs.findIndex((proof) => proof.id === insert.after) + 1}` };
  });
  lines.push({ id: "brand", mode: "type", text: Object.fromEntries(input.langs.map((lang) => [lang, ref(slots.name)])) });
  if (close.kind === "destination") lines.push({ id: "end", mode: "type", text: Object.fromEntries(input.langs.map((lang) => [lang, ref(close.fact)])) });
  return {
    id: `${slug(input.profile.name)}-promo`, recipe: "ProductPromo", job: "sell", langs: [...input.langs],
    hooks: choice.hooks.map((text, index) => ({ id: `hook-${index + 1}`, mode: "type", text })), lines,
    bpm: input.direction?.sound.bpm ?? 120, fps: 30, session: input.tour!.name, project: input.profile.id,
    ...(input.music ? { music: input.music } : {}), tags: ["product", "promo"],
    promo: { opening: choice.opening, pace: choice.pace, theme: themeFor(input, choice, by).id, close,
      ...(choice.proofs.some((proof) => proof.treatment) ? { treatments: Object.fromEntries(choice.proofs.filter((proof) => proof.treatment).map((proof) => [`benefit-${choice.proofs.indexOf(proof) + 1}`, proof.treatment!])) } : {}),
      ...(choice.recap !== undefined ? { recap: choice.recap } : {}),
      ...(inserts.length ? { inserts } : {}),
      evidence: Object.fromEntries([
        ...choice.proofs.map((proof, index) => [`benefit-${index + 1}`, { mark: proof.id, facts: proof.facts }]),
        ...choice.hooks.map((_, index) => [`hook-${index + 1}`, { mark: choice.proofs[0].id, facts: choice.proofs[0].facts }]),
      ]) },
  };
}

/** The complete deterministic path, shared by planning tools and the automatic pipeline. */
export function planPromo(input: PromoForInput): PromoResult {
  parsePromoTheme(input.theme);
  const menu = promoCandidates(input, { automatic: true });
  const choice = fallback(input, menu.candidates);
  const compiled = compilePromoChoice(input, menu.facts, choice);
  const claims = compiled ? auditClaims(compiled, menu.facts) : [];
  const brief = claims.length === 0 ? compiled : undefined;
  const why = menu.candidates.length === 0 ? "A promotion needs a real product click with a measured visible result in every supplied take."
    : claims.length > 0 ? "The sourced identity or destination does not pass the claim audit in every requested language."
    : !brief ? "A promotion needs a sourced product name for its closing card." : undefined;
  const refused = [...menu.refused, ...claims.map((claim) => ({ id: claim.line, lang: claim.lang, token: claim.token, why: claim.why }))];
  return { ...(brief ? { brief } : {}), facts: menu.facts, decision: decision(input, menu.facts, menu.candidates, choice, "arithmetic"), refused, ...(why ? { why } : {}) };
}

/* A performance or universal promise must be quoted from a fact, not introduced as
   persuasive connective prose. This is an explicit limited check, not semantic proof. */
const RESTRICTED = /\b(?:best|fastest|faster|instant(?:ly)?|guarantee(?:d|s)?|always|never|any|unlimited|effortless|secure|private|privacy|security|saves?\s+(?:time|hours?|minutes?|money)|roi|boost\s+(?:sales|revenue)|mejor|mejores|más\s+rápid[oa]|instantáne[oa]|garantiz\w*|siempre|nunca|cualquier(?:a)?|ilimitad\w*|sin esfuerzo|segur[oa]|privad[oa]|privacidad|ahorr\w*\s+(?:tiempo|horas?|minutos?|dinero))\b/iu;
const INSTRUCTION = /\b(?:double[- ]click|right[- ]click|doble clic|clic derecho|press\s+(?:enter|return|space)|pulsa\s+(?:intro|enter|espacio))\b/i;
const TUTORIAL = /^\s*(?:click|open|tap|press|then|next|pulsa|abre|haz clic|luego|después)\b/iu;
const CAUSAL = /\b(?:thanks to|because of|therefore|as a result of|gracias a|debido a|por eso|por lo tanto|como resultado de)\b/iu;

export function validatePromoChoice(input: PromoForInput, facts: FactSheet, candidates: PromoCandidate[], choice: Promo,
  options: { preservedText?: Record<string, Record<string, string>> } = {}): PromoRefusal[] {
  const refused: PromoRefusal[] = [];
  const seen = new Set<string>();
  const checkCopy = (id: string, text: Record<string, string>, allowed: Set<string>, maxWords: number) => {
    for (const lang of input.langs) if (!text[lang]?.trim()) refused.push({ id, lang, why: "missing language" });
    for (const [lang, raw] of Object.entries(text)) {
      const preserved = options.preservedText?.[id]?.[lang] === raw;
      if (!input.langs.includes(lang as "en" | "es")) refused.push({ id, lang, why: "unexpected language track" });
      for (const fact of factIds(raw)) {
        if (!allowed.has(fact)) refused.push({ id, lang, token: fact, why: "fact is not bound to this proof" });
        const source = facts.facts.find((entry) => entry.id === fact);
        if (!preserved && source && ["text", "feature", "quote"].includes(source.kind) && fact !== slotsOf(facts).name) {
          refused.push({ id, lang, token: fact, why: "source prose is evidence, not promotional copy; write a native benefit instead of quoting interface titles" });
        }
      }
      const prose = raw.replace(/\{\{\s*fact:[^}]+\}\}/g, " ");
      const restricted = RESTRICTED.exec(prose) ?? INSTRUCTION.exec(prose) ?? TUTORIAL.exec(raw);
      if (!preserved && restricted) refused.push({ id, lang, token: restricted[0], why: "unsupported performance promise or accessibility instruction" });
      const cause = CAUSAL.exec(prose);
      if (!preserved && cause) refused.push({ id, lang, token: cause[0], why: "causal linkage is not established by independent UI observations" });
      const copyLang = detectLang(prose);
      if (!preserved && copyLang && copyLang !== lang) refused.push({ id, lang, why: "copy is not written in the requested language" });
      try {
        const expanded = expandFacts(raw, facts);
        if (wordCount(expanded) > maxWords) refused.push({ id, lang, why: `more than ${maxWords} words` });
        if ([...expanded].length > 55) refused.push({ id, lang, why: "more than 55 characters" });
      }
      catch { /* auditClaims below names the unknown reference. */ }
    }
  };
  for (const proof of choice.proofs) {
    const candidate = candidates.find((entry) => entry.id === proof.id);
    if (!candidate || seen.has(proof.id)) {
      refused.push({ id: proof.id, why: candidate ? "duplicate proof" : "proof is no longer supported by the recordings" });
      continue;
    }
    seen.add(proof.id);
    const available = new Set(candidate.facts.map((fact) => fact.id));
    if (proof.treatment && !candidate.treatments.includes(proof.treatment)) refused.push({ id: proof.id, token: proof.treatment, why: "the treatment is not supported by measured footage in every take" });
    for (const fact of proof.facts) if (!available.has(fact)) refused.push({ id: proof.id, token: fact, why: "evidence belongs to another proof or is unknown" });
    checkCopy(proof.id, proof.text, new Set(proof.facts), 7);
  }
  const hookFacts = new Set(choice.proofs[0]?.facts ?? []);
  if (choice.argument) {
    const argument = choice.argument;
    const first = choice.proofs[0];
    const available = new Set(candidates.find(candidate => candidate.id === argument.proof)?.facts.map(fact => fact.id) ?? []);
    if (!first || argument.proof !== first.id) refused.push({ id: "argument", token: argument.proof, why: "the internal argument must name the first selected proof" });
    if (new Set(argument.facts).size !== argument.facts.length) refused.push({ id: "argument", why: "duplicate argument evidence" });
    for (const fact of argument.facts) if (!hookFacts.has(fact) || !available.has(fact)) refused.push({ id: "argument", token: fact, why: "argument evidence must be selected for its first proof and available in that proof's current menu" });
  }
  choice.hooks.forEach((text, i) => checkCopy(`hook-${i + 1}`, text, hookFacts, 7));
  if (choice.recap && choice.proofs.length < 2) refused.push({ id: "recap", why: "a progressive recap needs at least two distinct demonstrated benefits" });
  const inserts = promoInsertCandidates(facts, input.langs);
  const shown = new Set<string>();
  for (const insert of choice.inserts ?? []) {
    if (!inserts.some((candidate) => candidate.fact.id === insert.fact && candidate.kind === insert.kind)) {
      refused.push({ id: insert.fact, why: "insert must be an exact short command or code excerpt from the offered source menu" });
    }
    if (!seen.has(insert.after)) refused.push({ id: insert.fact, token: insert.after, why: "insert must follow a selected recorded proof" });
    if (shown.has(insert.fact)) refused.push({ id: insert.fact, why: "duplicate source insert" });
    shown.add(insert.fact);
  }
  const brief = compilePromoChoice(input, facts, choice);
  if (brief) for (const claim of auditClaims(brief, facts)) refused.push({ id: claim.line, lang: claim.lang, token: claim.token, why: claim.why });
  return refused;
}

/** Validate fresh and cached decisions identically, with at most one explicit correction. */
export async function promoFor(brain: Brain | null | undefined, input: PromoForInput): Promise<PromoResult> {
  const baseline = planPromo(input);
  if (!brain || !baseline.brief) return baseline;
  const menu = promoCandidates(input, { automatic: true });
  const requestedTheme = parsePromoTheme(input.theme);
  const questionInput: PromoInput = {
    themes: { mode: requestedTheme === "auto" ? "auto" : requestedTheme === undefined ? "default" : "selected",
      candidates: requestedTheme === "auto" ? PROMO_THEMES : PROMO_THEMES.filter((theme) => theme.id === (requestedTheme ?? "flat")),
      proposal: requestedTheme === "auto" ? proposePromoTheme(input, baseline.decision.pace) : baseline.decision.theme,
      ...(requestedTheme !== "auto" ? { requested: requestedTheme ?? "flat" } : {}) },
    product: menu.facts.facts.find((fact) => fact.id === slotsOf(menu.facts).name)?.value ?? input.profile.name,
    langs: [...input.langs], close: baseline.brief.promo?.close,
    ...(input.creative?.trim() ? { creative: input.creative } : {}),
    ...(input.thesis ? { thesis: { what: input.thesis.what, audience: input.thesis.audience, angle: input.thesis.angle, tone: input.thesis.tone } } : {}),
    candidates: rankPromoCandidates(menu.candidates).map(({ id, label, result, facts, takes, treatments, split, context, editorial, observation }) => ({ id, label, result, facts, takes, treatments, split, context, editorial, observation })),
    inserts: promoInsertCandidates(menu.facts, input.langs),
  };
  const refusals: PromoRefusal[] = [];
  let repair: PromoInput["repair"];
  const declined = () => ({ ...baseline, decision: { ...baseline.decision, ...(repair ? { repair: { accepted: false, refused: repair.refused } } : {}) }, refused: [...baseline.refused, ...refusals] });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = (attempt === 0 ? input.cached : undefined) ?? (await brain.ask(promoQuestion({ ...questionInput, ...(repair ? { repair } : {}) }))).value;
      const parsed = PromoShape.safeParse(raw);
      const refused = parsed.success ? [...validatePromoChoice(input, menu.facts, menu.candidates, parsed.data),
        ...assessPromo(input, menu.facts, menu.candidates, parsed.data).issues.filter((issue) => issue.repairable).map((issue) => ({ id: issue.id, ...(issue.lang ? { lang: issue.lang } : {}), why: `${issue.code}: ${issue.why} ${issue.suggestion}` }))]
        : [{ id: "promo", why: "the promotional decision did not match its contract" }];
      if (parsed.success && refused.length === 0) {
        return { brief: compilePromoChoice(input, menu.facts, parsed.data, "brain"), facts: menu.facts,
          decision: { ...decision(input, menu.facts, menu.candidates, parsed.data, "brain"), ...(repair ? { repair: { accepted: true, refused: repair.refused } } : {}) },
          refused: [...menu.refused, ...refusals] };
      }
      refusals.push(...refused);
      if (attempt === 0) repair = { previous: raw, refused };
    }
    return declined();
  } catch (error) {
    refusals.push({ id: "promo", why: `brain did not answer: ${String(error).split("\n")[0]}` });
    return declined();
  }
}
