/*
  What makes an automatic video make sense: every claim is bound to a moment where
  the product visibly DID something.

  A README's headings are "Installation", "Usage", "Contributing"; a landing page's
  are its own marketing; a web app's h2s are "Recent projects" and "Settings". None
  is a claim in the genre's sense — a verb phrase the next shot demonstrates — and a
  scroll to a heading shows the product saying something, not doing it. Left to a
  simple rule ("claim cards from headings, proof from section marks") the automatic
  path produces a slideshow of headings, which is exactly the failure the owner
  named. The tools that solve this today hand the choice to a model; panoma video does it
  with arithmetic, so it works with no model and gives the same answer twice.

  A MOMENT is a mark the tour left: hero, section, call to action, flow. Its score
  is how much the interface changed when it happened (a scroll changes nothing),
  what the tour thought of it (above the fold, a verb, big), how hot its route is in
  git, how much of the README's own words it carries, and whether both takes have
  it. A CLAIM is a sentence someone wrote about the product, ranked by where it came
  from — the running interface first, a tagged changelog next, commit subjects last.
  A claim earns a card only when bound to a moment with a real state change whose
  name or route shares its words; a prose claim from a low-trust source needs a
  tier-one proof. Unbound claims are dropped, never shown. A moment with no claim
  keeps its own accessible name as a label. Section scrolls are admissible proof
  only for a static site, and that piece is called a site tour, not a trailer.
*/
import { TRAILER_CLAIM_MAX_WORDS } from "./story-constants.ts";

export type MomentKind = "hero" | "section" | "cta" | "flow";

export type Moment = {
  /** The mark's name. */
  readonly id: string;
  readonly kind: MomentKind;
  /** The accessible name or heading text the tour recorded. */
  readonly name: string;
  readonly route?: string;
  /** 0..1 — how much the roles+names tree changed after the action. A scroll is 0. */
  readonly stateDelta: number;
  /** 0..1 — the tour's own ranking of the candidate. */
  readonly candidateScore: number;
  readonly inAllTakes: boolean;
  readonly box?: { x: number; y: number; w: number; h: number };
};

/*
  Trust tiers of a claim's source, best first. Tier one is the interface itself: an
  accessible name or visible text at a mark. A tagged CHANGELOG section is a human
  writing down what shipped. package.json and README prose describe intent. Commit
  subjects are notes to colleagues. Landing-page copy is marketing.
*/
export type ClaimTier = 1 | 2 | 3 | 4 | 5 | 6;

export type ClaimSource = {
  readonly text: string;
  readonly source: string;
  readonly tier: ClaimTier;
  readonly lang?: string;
  /** The fact this claim quotes, when it is one; the brief references it by id. */
  readonly factId?: string;
};

export type BoundPair = {
  readonly claim: ClaimSource;
  readonly moment: Moment;
  readonly score: number;
  readonly reasons: readonly string[];
};

export type StoryContext = {
  /** Commits in the range touching each route's source file, by route. */
  readonly gitHeat?: Readonly<Record<string, number>>;
  /** Words of the README title, tagline and headings, already tokenised. */
  readonly readmeWords?: ReadonlySet<string>;
  /** A static site has no state to change; its sections are what it has to show. */
  readonly staticSite?: boolean;
};

const STOP = new Set(
  (
    "a an the and or of to in on for with your you it is are be this that from by as at we our its into " +
    "un una el la los las y o de del al en para con tu tus es son este esta esto que se lo su sus por como"
  ).split(" "),
);

/** Lowercase word tokens without stopwords or punctuation. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[`"'“”‘’(),.:;!?/\\[\]{}<>|]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

function overlap(a: string[], b: Iterable<string>): number {
  const set = new Set(b);
  return a.filter((w) => set.has(w)).length;
}

/**
 * A claim's card text: the sentence stripped of its commit prefixes and its "add
 * support for" throat-clearing, capitalised, and only if it fits five words. A
 * claim that does not fit is not truncated — a cut-off claim says something the
 * author did not — it simply earns no card.
 */
export function claimCard(text: string): string | null {
  let t = text.trim();
  t = t.replace(/^(feat|fix|chore|docs|refactor|perf|style|test|build|ci)(\([^)]*\))?!?:\s*/i, "");
  t = t.replace(/^[-*•]\s*/, "");
  /* Throat-clearing comes in layers ("add support for …"); strip until nothing changes. */
  for (let previous = ""; previous !== t; ) {
    previous = t;
    t = t.replace(/^(add(ed|s|ing)?|support(s|ed)? for|introduc(e|es|ed|ing)|implement(s|ed|ing)?|new|now)\s+/i, "");
  }
  t = t.replace(/\s*[.!]+$/, "");
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > TRAILER_CLAIM_MAX_WORDS) return null;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * How much a moment deserves the screen, 0..1-ish. The weights are a house rule
 * written down rather than a measurement: a real state change is worth the most
 * because it is the only thing that separates proof from a scroll.
 */
export function momentScore(m: Moment, ctx: StoryContext = {}): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (m.stateDelta > 0) {
    score += 0.45 * Math.min(1, m.stateDelta * 2);
    reasons.push(`state changed (${(m.stateDelta * 100).toFixed(0)}%)`);
  }
  score += 0.25 * Math.min(1, Math.max(0, m.candidateScore));
  if (m.candidateScore > 0) reasons.push(`tour ranked it ${(m.candidateScore * 100).toFixed(0)}`);
  const heat = m.route && ctx.gitHeat ? (ctx.gitHeat[m.route] ?? 0) : 0;
  if (heat > 0) {
    score += 0.15 * Math.min(1, heat / 5);
    reasons.push(`route touched by commits: ${heat}`);
  }
  if (ctx.readmeWords) {
    const shared = overlap(tokens(m.name), ctx.readmeWords);
    if (shared > 0) {
      score += 0.1 * Math.min(1, shared / 2);
      reasons.push(`README words shared: ${shared}`);
    }
  }
  if (m.inAllTakes) {
    score += 0.05;
  } else {
    reasons.push("missing in one take");
  }
  return { score: Math.round(score * 1000) / 1000, reasons };
}

/** Whether a moment may prove anything at all. */
export function isProof(m: Moment, ctx: StoryContext = {}): boolean {
  if (m.kind === "cta" || m.kind === "flow") return m.stateDelta > 0;
  if (m.kind === "section" || m.kind === "hero") return ctx.staticSite === true;
  return false;
}

/**
 * Bind claims to moments. Greedy by pair score; each moment proves at most one
 * claim; each claim is shown at most once. Prose from tiers four to six binds only
 * to a tier-one proof, which every moment with a state change is by construction.
 */
export function bindClaims(claims: readonly ClaimSource[], moments: readonly Moment[], ctx: StoryContext = {}): BoundPair[] {
  const proofs = moments.filter((m) => isProof(m, ctx));
  const candidates: BoundPair[] = [];
  for (const claim of claims) {
    const card = claimCard(claim.text);
    if (!card) continue;
    const words = tokens(claim.text);
    for (const moment of proofs) {
      const shared = overlap(words, tokens(moment.name)) + (moment.route ? overlap(words, tokens(moment.route.replace(/[-/_]/g, " "))) : 0);
      /* The interface's own words never need overlap: they ARE the moment. */
      if (shared === 0 && claim.tier !== 1) continue;
      const base = momentScore(moment, ctx);
      const score = base.score + 0.2 * Math.min(1, shared / 2) + (7 - claim.tier) * 0.02;
      candidates.push({
        claim: { ...claim, text: card },
        moment,
        score: Math.round(score * 1000) / 1000,
        reasons: [...base.reasons, shared > 0 ? `claim words shared: ${shared}` : "interface's own words", `source tier ${claim.tier}`],
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const usedMoments = new Set<string>();
  const usedClaims = new Set<string>();
  const out: BoundPair[] = [];
  for (const c of candidates) {
    if (usedMoments.has(c.moment.id) || usedClaims.has(c.claim.text)) continue;
    usedMoments.add(c.moment.id);
    usedClaims.add(c.claim.text);
    out.push(c);
  }
  return out;
}

/** Moments strong enough to stand alone, labelled with their own name, when no claim binds to them. */
/*
  A site tour shows a page's own headings as its cards, verbatim: they are the site's
  words, not a paraphrase, and a landing page writes headings in sentences. Twelve
  words is where a card stops being a card; longer headings earn no label.
*/
const SITE_HEADING_MAX_WORDS = 12;

export function unclaimedProofs(moments: readonly Moment[], bound: readonly BoundPair[], ctx: StoryContext = {}): BoundPair[] {
  const used = new Set(bound.map((b) => b.moment.id));
  return moments
    .filter((m) => isProof(m, ctx) && !used.has(m.id))
    .map((m): BoundPair | null => {
      const heading = m.kind === "section" || m.kind === "hero";
      const words = m.name.trim().split(/\s+/).filter(Boolean).length;
      const card = heading ? (words > 0 && words <= SITE_HEADING_MAX_WORDS ? m.name.trim().replace(/\s*[.!]+$/, "") : null) : claimCard(m.name);
      const base = momentScore(m, ctx);
      return card ? { claim: { text: card, source: `interface:${m.id}`, tier: 1 }, moment: m, score: base.score, reasons: [...base.reasons, "labelled with its own name"] } : null;
    })
    .filter((p): p is BoundPair => p !== null)
    .sort((a, b) => b.score - a.score);
}

export type Goal = "promo" | "trailer" | "spotlight" | "tutorial" | "sitetour" | "changelog" | "facts";

export type GoalDecision = { goal: Goal; why: string; pairs?: number };

/**
 * Which pieces a project earns, from what the scout and the tour found. Every
 * skipped goal says the one thing that would unlock it, so `auto.json` can print
 * it and a person knows what to add to the repository.
 */
export function resolveGoals(input: {
  kind: "web-app" | "static-site" | "cli" | "library" | "mobile" | "unknown";
  boundPairs: number;
  flows: number;
  hasInstallCommand: boolean;
  hasReachableTag: boolean;
  changelogHeroItems: number;
  featCommits: number;
  sectionMarks: number;
}): { make: GoalDecision[]; skip: GoalDecision[] } {
  const make: GoalDecision[] = [];
  const skip: GoalDecision[] = [];
  const web = input.kind === "web-app" || input.kind === "static-site";

  /* A trailer proves claims with actions; a static site has none, so its sections make a site tour instead. */
  if (input.kind === "web-app" && input.boundPairs >= 2) make.push({ goal: "trailer", why: `claim→proof pairs bound: ${input.boundPairs}`, pairs: Math.min(4, input.boundPairs) });
  else if (input.kind === "web-app") {
    skip.push({ goal: "trailer", why: "fewer than two claims bind to a moment that changes the interface; add a CHANGELOG entry or a CTA the tour can click" });
    /* What a page with sections and no proof still has: its sections, shown as what they are. */
    if (input.sectionMarks >= 2) make.push({ goal: "sitetour", why: `no trailer, but sections to show: ${input.sectionMarks}` });
  }

  if (input.kind === "web-app" && input.flows > 0) make.push({ goal: "spotlight", why: `flows with a state change: ${input.flows}` });

  /*
    What earns a tutorial.

    It used to be one thing: an install command in a README code fence. That gate is
    about the project's paperwork, not about whether there is anything to teach, and
    it produced the wrong answer in both directions — a documented CLI wrapper with a
    dead interface got a tutorial, and a real application whose README never says
    `npm i` got none, which is most applications. What a tutorial actually needs is a
    TASK: a control the viewer can be shown using, whose use changes the interface.
    The tour already knows — it refuses to mark a click that changed nothing — so the
    count of those controls is the gate, and an install command still earns one on its
    own, because "how do I get this at all" is the one instruction no footage can show.
  */
  if (web && input.flows > 0) make.push({ goal: "tutorial", why: `controls whose use changes the interface: ${input.flows}` });
  else if (web && input.hasInstallCommand) make.push({ goal: "tutorial", why: "an install command is documented in the README" });
  else if (web) skip.push({ goal: "tutorial", why: "the tour found no control whose use changes the interface, and the README documents no install command: a tutorial teaches a task, and this page has none to teach" });

  if (input.kind === "static-site" && input.sectionMarks >= 2) make.push({ goal: "sitetour", why: `sections to show: ${input.sectionMarks}`, pairs: Math.min(4, Math.max(2, input.boundPairs)) });
  else if (input.kind === "static-site") skip.push({ goal: "sitetour", why: "fewer than two sections with a heading the walker could scroll to" });

  if (input.changelogHeroItems > 0 || input.featCommits >= 3) {
    make.push({ goal: "changelog", why: input.changelogHeroItems > 0 ? `changelog items in the newest tagged section: ${input.changelogHeroItems}` : `feat commits since the last tag: ${input.featCommits}` });
  } else {
    skip.push({ goal: "changelog", why: "no tagged CHANGELOG section and fewer than three feat: commits" });
  }

  if (input.kind === "cli" || input.kind === "library") {
    make.push({ goal: "facts", why: `${input.kind}: a card piece from the facts and a terminal run of the documented commands` });
    if (input.hasInstallCommand) make.push({ goal: "tutorial", why: "install and first command from the README, as a terminal run" });
  }
  if (input.kind === "mobile" || input.kind === "unknown") {
    make.push({ goal: "facts", why: `${input.kind}: no camera path yet, a card piece from the facts` });
  }
  /* No tag means no status line and a kicker without a version — a note, only when nothing else says trailer. */
  if (!input.hasReachableTag && !make.some((g) => g.goal === "trailer") && !skip.some((g) => g.goal === "trailer")) {
    skip.push({ goal: "trailer", why: 'no reachable tag: the status line "Available now" requires one, and the trailer opens on the version' });
  }
  return { make, skip };
}
