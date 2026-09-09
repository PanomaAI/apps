/*
  Which thing on the page is the call to action, decided by arithmetic.

  Every demo-tour vendor derives its steps from what a human clicked; panoma video has
  no human, so it ranks what a human would click from signals the snapshot already
  carries: role, landmark, position, size and the words on the element. The shape
  of a candidate is Stagehand's observe() record — {selector, description, method}
  plus the box — so a model can be dropped in later as a re-ranker and never as
  the executor.

  The weights are not measurements; they are an ordering, and the reasons array
  on each candidate is there so a person (or the summary) can see why one thing
  outranked another without re-deriving it.
*/
import { isChrome, isDestructive, isExternal, matchLexicon, verbOf } from "./lexicon.ts";
import { roleSelector, type SnapshotNode } from "./snapshot.ts";
import type { Box, TourCandidate } from "./types.ts";

/*
  WCAG 2.5.5 (AAA) asks for 44x44 CSS px targets; 44*44 = 1936 px². A hero
  button is typically ~150x50 = 7500 px², which is where the size score saturates.
  https://www.w3.org/TR/WCAG22/#target-size-enhanced
*/
const AREA_FULL = 7500;

/*
  Navattic measured 80% of top calls to action above the fold
  (https://docs.navattic.com/help/best-practices.md); "the fold" here is the
  first viewport of the desktop take.
*/
const FIRST_VIEWPORT_BONUS = 1;
const MAIN_BONUS = 1;
const BANNER_BONUS = 0.5;
const HERO_BONUS = 0.5;
const VERB_BONUS = 2;
/** Buttons act, links go somewhere; the tour prefers to show an action. */
const ROLE_WEIGHT: Record<string, number> = { button: 1, link: 0.8 };

export type ScoreContext = {
  viewport: { width: number; height: number };
  /** Origin of the page under tour; links elsewhere are ranked but never clicked. */
  origin: string;
  /** Page URL, so relative hrefs resolve. */
  pageUrl: string;
  /** Document y where the first section heading starts; above it is the hero. */
  heroEnd?: number;
  /*
    Words that invite action in the interface's own language, on top of the English
    lexicon: "iniciar", "lanzar", "enviar". They come from a brain that read the
    product; without one a Spanish button earns no verb bonus, which is the limit
    docs/open-questions.md records. They add to the score and never subtract: the
    destructive list is checked before any verb and is not extended from here.
  */
  verbs?: readonly string[];
};

function resolveHref(href: string | undefined, pageUrl: string): URL | null {
  if (!href) return null;
  try {
    return new URL(href, pageUrl);
  } catch {
    return null;
  }
}

function samePage(target: URL, pageUrl: string): boolean {
  const here = new URL(pageUrl);
  return target.pathname.replace(/\/$/, "") === here.pathname.replace(/\/$/, "") && target.search === here.search;
}

function describe(node: SnapshotNode, target: URL | null): string {
  const where = node.landmark ? ` in ${node.landmark}` : "";
  const to = target ? ` → ${target.origin === "null" ? target.href : target.pathname + target.search + target.hash}` : "";
  return `${node.role} "${node.name}"${where}${to}`;
}

/** Ranks every button and link, highest first; score 0 means it is never clicked. */
export function scoreCandidates(nodes: SnapshotNode[], ctx: ScoreContext): TourCandidate[] {
  const out: TourCandidate[] = [];
  for (const node of nodes) {
    const weight = ROLE_WEIGHT[node.role];
    if (weight === undefined || !node.box || !node.name.trim()) continue;
    const target = node.role === "link" ? resolveHref(node.url, ctx.pageUrl) : null;
    const reasons: string[] = [];
    const candidate: TourCandidate = {
      selector: roleSelector(node.role, node.name),
      description: describe(node, target),
      method: "click",
      box: node.box,
      score: 0,
      reasons,
    };
    out.push(candidate);

    const destructive = isDestructive(node.name);
    if (destructive) {
      reasons.push(`never clicked: "${destructive}" is on the destructive list`);
      continue;
    }
    const external = isExternal(node.name);
    if (external) {
      reasons.push(`never clicked: "${external}" hands the work to another application, off camera and on someone's machine`);
      continue;
    }
    const chrome = isChrome(node.name);
    if (chrome) {
      reasons.push(`not a call to action: "${chrome}" is chrome`);
      continue;
    }
    if (node.disabled) {
      reasons.push("not clicked: the control is disabled in the current page state");
      continue;
    }
    if (target && !/^https?:$/.test(target.protocol)) {
      reasons.push(`not clicked: ${target.protocol} link`);
      continue;
    }
    if (target && target.origin !== ctx.origin) {
      reasons.push(`not clicked: leaves the origin for ${target.host}`);
      continue;
    }
    if (target && samePage(target, ctx.pageUrl)) {
      reasons.push("not clicked: links to the page it is on");
      continue;
    }
    if (node.landmark !== "main" && node.landmark !== "banner") {
      reasons.push(`not a call to action: outside main and banner (${node.landmark ?? "no landmark"})`);
      continue;
    }

    let score = weight;
    reasons.push(`${node.role}: ${weight}`);
    if (node.landmark === "main") {
      score += MAIN_BONUS;
      reasons.push(`in main: +${MAIN_BONUS}`);
    } else {
      score += BANNER_BONUS;
      reasons.push(`in banner: +${BANNER_BONUS}`);
    }
    if (node.box.y + node.box.h <= ctx.viewport.height) {
      score += FIRST_VIEWPORT_BONUS;
      reasons.push(`in the first viewport: +${FIRST_VIEWPORT_BONUS}`);
    }
    if (ctx.heroEnd !== undefined && node.box.y < ctx.heroEnd) {
      score += HERO_BONUS;
      reasons.push(`in the hero: +${HERO_BONUS}`);
    }
    const area = Math.min(1, (node.box.w * node.box.h) / AREA_FULL);
    score += area;
    reasons.push(`size ${Math.round(node.box.w)}x${Math.round(node.box.h)}: +${area.toFixed(2)}`);
    const verb = verbOf(node.name) ?? (ctx.verbs && ctx.verbs.length > 0 ? matchLexicon(node.name, ctx.verbs) : null);
    if (verb) {
      score += VERB_BONUS;
      reasons.push(`verb "${verb}": +${VERB_BONUS}`);
    }
    candidate.score = Math.round(score * 100) / 100;
  }
  /* Stable: ties keep document order, so the hero's own button wins a tie with a footer's. */
  return out
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.score - a.c.score || a.i - b.i)
    .map(({ c }) => c);
}

/*
  Section anchors: the h1/h2 headings inside main, in document order, minus the
  first one, which names the page rather than a part of it. A heading is a
  destination a scroll can name, which is what keeps the desktop and mobile takes
  on the same content (see the scrollTo comment in capture's session.ts).
*/
export function sectionAnchors(nodes: SnapshotNode[]): SnapshotNode[] {
  const headings = nodes.filter(
    (n) => n.role === "heading" && n.landmark === "main" && (n.level === 1 || n.level === 2) && n.name.trim() && n.box,
  );
  return headings.slice(1);
}

/** The page's own heading: the first h1 anywhere, else the first heading in main. */
export function pageHeading(nodes: SnapshotNode[]): SnapshotNode | undefined {
  return (
    nodes.find((n) => n.role === "heading" && n.level === 1 && n.name.trim()) ??
    nodes.find((n) => n.role === "heading" && n.landmark === "main" && n.name.trim())
  );
}

/*
  `Discover what is on the disk` → `discover-what-is-on-the-disk`. Cut at a word
  boundary past SLUG_MAX characters: a mark name is typed into a brief by hand, and
  a heading can run to a sentence.
*/
const SLUG_MAX = 40;
export function slugify(text: string): string {
  const words = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  let slug = "";
  for (const w of words) {
    if (slug && slug.length + 1 + w.length > SLUG_MAX) break;
    slug = slug ? `${slug}-${w}` : w;
  }
  return slug || "section";
}

/** The selector for a heading node: role, name and level, so two equal titles at different levels differ. */
export const headingSelector = (n: SnapshotNode): string => roleSelector("heading", n.name, n.level);

export function viewportBox(box: Box, scrollY: number): Box {
  return { x: box.x, y: box.y - scrollY, w: box.w, h: box.h };
}
