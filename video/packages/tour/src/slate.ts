/*
  What is worth teaching about a product nobody has said anything about.

  `lesson.ts` answers "how do I do X here" when somebody says X. This answers the
  question before it: run the thing on a path and nothing else, and it has to decide
  what tutorial this product deserves. That decision is not a matter of taste and it is
  not a thing to ask a model to improvise — the reading (atlas.ts) already contains
  everything a person would use to make it, and what a person would use is measurable.

  So the arithmetic ranks and the judgement names. Every candidate below is a SCREEN of
  the product scored on five terms, each of which is a number the reading carries, and
  each of which is reported with the value it was computed from. A brain is then handed
  the ranked list and writes what a viewer would call each one — the task, the promise,
  the audience — and may reorder, the way it may reorder a page's controls in a walk. It
  phrases; it never states.

  The terms, and why each is on the list rather than another:

  - PAYOFF. Getting there has to produce something the page did not have before. A screen
    reached by pressing a control whose press changed the heading is a screen with an
    answer on it; one reached by a link that only navigates is a place. Every tutorial
    that works ends on a state change the viewer can see, which is also the moment the
    measured research says viewers pause at (Guo, Kim & Rubin, L@S 2014).
  - FOCUS. A screen that is about one thing teaches one thing. A product's "everything"
    view contains every word its focused views contain, and a video made about it is a
    tour. Measured as how few section headings the screen carries against the busiest
    screen in the reading.
  - REACH. Two to four steps is a video; one is a screenshot and eight is a manual. The
    number comes out of the door chain the reading already recorded.
  - PROCEDURE. How many steps the lesson would actually have — the doors to get there plus
    what there is to show once you arrive. Three to six is a video; two is thin and one is
    a screenshot. NN/g's finding is that people turn to video for the complex, unfamiliar
    and MULTISTEP and read text for the rest, and MacLeod, Bergen & Storey's study of
    developer screencasts (Empirical Software Engineering 22:1478, 2017) derives "show by
    doing" from producers directly. A screen with nothing to do on it is a screenshot.

  What is deliberately NOT a term: the screen's own copywriting. An earlier version scored
  a screen higher for asking a question or stating a figure, on the grounds that the
  product was giving a viewer a reason to care. It is a reason to CLICK — the evidence for
  it (Lai & Farbrot 2014, +150% on question headlines) measures clicks, and the evidence
  for length and completion measures retention, and the two pull against each other. A well
  copywritten screen that teaches nothing would have outranked a plain one that teaches
  something. So the question and the figure are still read, and they choose the ANGLE — how
  the piece opens — and they do not touch the ranking.
  - SAFETY. A screen only reachable by pressing something on the destructive or external
    list is not a candidate at all, at any score.
*/
import type { Atlas, AtlasScreen } from "./atlas.ts";
import { isDestructive, isExternal } from "./lexicon.ts";

/** How a tutorial about this screen would be framed. Chosen from the material, not from taste. */
export type Angle = "how-to" | "objection" | "count" | "speed" | "contrast";

export type Candidate = {
  /*
    The screen the tutorial would be about — by its state hash, not its address.

    Two screens can share an address: a page and a view of it that changed nothing in the
    URL, or one page read twice. Resolving a candidate by path picked whichever came
    first, so the slate could film a screen it had not chosen.
  */
  id: string;
  /** Its address, for a person reading the slate. */
  path: string;
  /** Its own heading, which is the plainest name the product has for it. */
  heading?: string;
  /** The controls to press to get there, in order — the door chain the reading recorded. */
  doors: string[];
  /** 0..10, and what each term contributed. */
  score: number;
  terms: { payoff: number; focus: number; reach: number; procedure: number };
  /** One line per term, in plain words, so a person can see why this outranked that. */
  why: string[];
  /** The framing the material supports; `how-to` when nothing else does. */
  angle: Angle;
  /** The sentence on the screen that earned its stakes, when one did. */
  evidence?: string;
};

/** The most a term may contribute, so the weights are visible rather than buried in the arithmetic. */
const WEIGHT = { payoff: 3, focus: 2, reach: 3, procedure: 2 } as const;

/** Below this a product has no tutorial in it, and saying so is better than making one. */
export const SLATE_FLOOR = 4.5;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/*
  A sentence of the screen's own copy that gives a viewer a reason to care.

  Two shapes count and no others: a question, because a question is the product naming
  the doubt the viewer already has; and a sentence carrying a figure, because a figure is
  a stake with a size. Everything else on a page is description, and a tutorial opened on
  description is a tour.
*/
function stakeIn(text: string): { line: string; kind: "question" | "figure" } | null {
  const parts = text.split(/\s+·\s+|(?<=[.?!])\s+/).map((s) => s.trim()).filter((s) => s.length > 12 && s.length < 140);
  const question = parts.find((s) => s.endsWith("?"));
  if (question) return { line: question, kind: "question" };
  /* A figure, and not a version or a time of day: at least two digits, and words around it. */
  const figure = parts.find((s) => /(?:^|\s)\d{2,}(?:\s|$)/.test(s) && /[a-z]{4,}/i.test(s));
  return figure ? { line: figure, kind: "figure" } : null;
}

function doorsTo(atlas: Atlas, screen: AtlasScreen): { doors: string[]; refused: string | null } {
  const byId = new Map(atlas.screens.map((s) => [s.id, s]));
  const doors: string[] = [];
  let refused: string | null = null;
  for (let at: AtlasScreen | undefined = screen; at?.openedBy && doors.length < 8; at = byId.get(at.openedBy.from)) {
    const name = at.openedBy.name;
    const no = isDestructive(name) ?? isExternal(name);
    if (no) refused = name;
    doors.unshift(name);
  }
  return { doors, refused };
}

/**
 * The product's teachable screens, ranked, with the arithmetic shown.
 *
 * Deterministic and model-free: the same reading always produces the same slate, which
 * is what makes it something to argue with. A brain may reorder it afterwards and its
 * reordering is recorded as such.
 */
export function slateOf(atlas: Atlas): Candidate[] {
  const busiest = Math.max(1, ...atlas.screens.map((s) => s.sections.length));
  const out: Candidate[] = [];

  for (const screen of atlas.screens) {
    const { doors, refused } = doorsTo(atlas, screen);
    /* The screen the reading started on is where a viewer already is; there is no lesson in arriving. */
    if (doors.length === 0) continue;
    if (refused) continue;

    /*
      PAYOFF: reached by a press rather than by typing an address, and the press left the
      product showing something. The reading records the door; a door that is a link to
      another route is a place, and a door that is a control on the screen you were
      standing on is an action.
    */
    const door = screen.openedBy!;
    const opened = atlas.screens.find((s) => s.id === door.from);
    const sameAddress = opened !== undefined && opened.path.split("#")[0] === screen.path.split("#")[0];
    const payoff = sameAddress ? WEIGHT.payoff : WEIGHT.payoff * 0.6;

    /* FOCUS: few sections of its own, against the busiest screen the reading found. */
    const focus = WEIGHT.focus * (1 - Math.min(1, screen.sections.length / busiest));

    /* REACH: two to four doors is a video. One is a screenshot, and past five it is a manual. */
    const reach = doors.length <= 1 ? WEIGHT.reach * 0.4 : doors.length <= 4 ? WEIGHT.reach : Math.max(0, WEIGHT.reach - (doors.length - 4));

    /*
      PROCEDURE: how many steps this lesson would have. The doors are presses; the target's
      own heading and sections are what there is to show once you are there, capped by what
      a lesson may hold. One step is a screenshot; two is thin; three to six is a video.
    */
    const shows = [screen.heading, ...screen.sections].filter(Boolean).length;
    const steps = doors.length + Math.min(shows, 3);
    const procedure = steps <= 1 ? 0 : steps === 2 ? WEIGHT.procedure * 0.5 : steps <= 6 ? WEIGHT.procedure : Math.max(0, WEIGHT.procedure - (steps - 6) * 0.5);

    /* Read for the ANGLE, never for the ranking: see the note at the top of this file. */
    const stake = stakeIn(`${screen.heading ?? ""} · ${screen.text}`);
    const angle: Angle =
      stake?.kind === "question" ? "objection" : stake?.kind === "figure" ? "count" : doors.length <= 2 ? "speed" : "how-to";

    /*
      Two hard gates before the score is even looked at. A scalar floor alone is clearable
      by a screen that is well written and teaches nothing, which is the exact failure the
      copywriting term used to introduce.
    */
    if (payoff <= 0 || steps < 2) continue;

    const score = payoff + focus + reach + procedure;
    out.push({
      id: screen.id,
      path: screen.path,
      ...(screen.heading ? { heading: screen.heading } : {}),
      doors,
      score: Math.round(score * 10) / 10,
      terms: {
        payoff: Math.round(payoff * 10) / 10,
        focus: Math.round(focus * 10) / 10,
        reach: Math.round(reach * 10) / 10,
        procedure: Math.round(procedure * 10) / 10,
      },
      why: [
        sameAddress
          ? `reached by pressing "${door.name}" without leaving the page, so the press itself is the thing to show`
          : `reached by opening ${screen.path}, which is a place rather than an action`,
        `sections of its own: ${screen.sections.length} against ${busiest} on the busiest screen read`,
        `doors to get here: ${doors.length}`,
        `steps the lesson would have: ${steps} (${doors.length} to press, ${Math.min(shows, 3)} to show)`,
        stake
          ? `it opens on the screen's own words, which is what chose the angle: ${JSON.stringify(clip(stake.line, 110))}`
          : "the screen states nothing of its own, so the angle comes from its shape",
      ],
      angle,
      ...(stake ? { evidence: clip(stake.line, 160) } : {}),
    });
  }

  /*
    And then thinned to a menu.

    A project page with ten tabs produces ten candidates that differ only in their stake,
    and a slate of ten views of one screen is not a choice — it is the same video ten
    times. Two per address, best first: enough for a person (or a brain) to see that the
    page has more than one lesson in it, few enough that the rest of the product still
    gets a row.
  */
  const perAddress = new Map<string, number>();
  return out
    .sort((a, b) => b.score - a.score)
    .filter((c) => {
      const base = c.path.split("#")[0].split("?")[0];
      const seen = perAddress.get(base) ?? 0;
      if (seen >= 2) return false;
      perAddress.set(base, seen + 1);
      return true;
    });
}

/** The slate as a person reads it: what it would teach, why that one, and what it scored. */
export function slateText(slate: readonly Candidate[]): string {
  if (slate.length === 0) return "  nothing on this product is reachable by pressing something, so there is no tutorial in it";
  return slate
    .map((c, i) => [`  ${i + 1}. ${c.heading ?? c.path} · ${c.path} · ${c.score}/10 · angle ${c.angle}`, `     press: ${c.doors.join(" → ")}`, ...c.why.map((w) => `     · ${w}`)].join("\n"))
    .join("\n\n");
}

/**
 * The route a candidate already is.
 *
 * There is no second decision to make here and no second call to a model: the doors are
 * what the reading PROVED it could open, in the order it opened them, and the headings on
 * the destination are what the screen has to say for itself. A lesson planned from a
 * request has to guess its way there; a lesson planned from the slate is walking back
 * along a path somebody already walked.
 */
export function routeFromCandidate(
  atlas: Atlas,
  candidate: Candidate,
  most: number,
): { steps: { path: string; control: string; kind: "press" | "show"; why: string }[]; on: string } {
  const byId = new Map(atlas.screens.map((s) => [s.id, s]));
  const target = byId.get(candidate.id);
  const steps: { path: string; control: string; kind: "press" | "show"; why: string }[] = [];

  /* The doors, from where the reading started to the screen the lesson is about. */
  let at: AtlasScreen | undefined = target;
  const chain: { screen: AtlasScreen; door: NonNullable<AtlasScreen["openedBy"]> }[] = [];
  for (; at?.openedBy && chain.length < 8; at = byId.get(at.openedBy.from)) chain.unshift({ screen: at, door: at.openedBy });
  for (const { screen, door } of chain) {
    steps.push({
      path: byId.get(door.from)?.path ?? "/",
      control: door.name,
      kind: "press",
      why: `the way to ${screen.path}, which the reading opened this way`,
    });
  }

  /* And what it says once you are there. */
  for (const heading of [target?.heading, ...(target?.sections ?? [])].filter((h): h is string => Boolean(h))) {
    if (steps.length >= most) break;
    if (steps.some((s) => s.control === heading)) continue;
    steps.push({ path: candidate.path, control: heading, kind: "show", why: `what ${candidate.path} says about it` });
  }

  /* The address without its fragment, and without its query: what `page.url()`'s pathname will read. */
  return { steps: steps.slice(0, most), on: candidate.path.split("#")[0].split("?")[0] };
}

/**
 * Why a reading produced no tutorial, in words somebody can act on.
 *
 * "Nothing scored well enough" is true and useless. A product behind a sign-in, a product
 * with one screen, a product whose every control leads back where it started — these are
 * three different problems with three different answers, and the reading already holds
 * everything needed to tell them apart. A tool that always makes a video makes bad
 * videos; a tool that refuses without saying why makes bug reports.
 */
export function noTutorialBecause(atlas: Atlas, slate: readonly Candidate[]): string {
  const first = atlas.screens[0];
  if (first?.signals.password) {
    return `${atlas.url} is behind a sign-in: the reading got one screen with a password field on it and no way past. Point --url at an instance that is already signed in, or at a staging copy with data in it.`;
  }
  if (atlas.screens.length <= 1) {
    return `${atlas.url} is one screen: nothing on it opened anything else. That is either a single-page app whose state is not in its accessibility tree, or a product that needs data before it has anything to show.`;
  }
  if (slate.length === 0) {
    return `every screen of ${atlas.url} was reached by typing its address rather than by pressing anything, so there is no action to film — a tutorial is somebody doing something, and nothing here does.`;
  }
  const best = slate[0];
  return (
    `the best candidate on ${atlas.url} is ${best.path} at ${best.score.toFixed(1)} of 10, under the floor of ${SLATE_FLOOR}: ` +
    best.why.join("; ") +
    `. Say what to teach with a goal, or point this at an instance with something in it.`
  );
}
