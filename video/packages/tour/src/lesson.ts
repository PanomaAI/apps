/*
  A lesson: someone asks for a tutorial about a thing, and this finds the way through
  the product to that thing and proves it works on camera.

  The walker (walk.ts) answers "what is worth filming about this product". A lesson
  answers a different question — "how do I do X here" — and the two need opposite
  machines. A walk explores breadth-first and stops when its budget is spent; a lesson
  has a destination and everything it presses is on the way there or at it.

  Three stages, and the middle one is the only one a model may touch:

  1. THE READING (atlas.ts) opens the product and writes down what it is made of:
     every screen it can reach, every heading, every control by the name the interface
     gives it, and the door each screen was reached through.
  2. THE ROUTE says which of those controls to press, in order. A brain reads the
     reading and answers with names; without one, the words of the request are matched
     against the reading, which is weaker and says so. Either way the answer is a list
     of NAMES — nothing here executes anything, and a name that is not in the reading
     is refused before a browser is opened.
  3. THE PROOF presses them. Every step is performed in a real browser before it is
     written down, and a step that cannot be performed — the control is gone, the press
     changes nothing, it leaves the product — is DROPPED with its reason. A tutorial
     that instructs a viewer to press something that does nothing is worse than no
     tutorial, and it is the one failure this whole module exists to make impossible.

  What comes out is a `TourScript`: the same shape the walker writes, so `panoma-video record`,
  the planner, the studio, the renderer and the review gate need to know nothing about
  lessons at all.
*/
import { redact } from "@panoma/video-core";
import { captureBrowserArgs, DESKTOP_TAKE, MOBILE_TAKE, type SessionStep, type SessionTake } from "@panoma/video-capture";
import { chromium, type Browser, type Page } from "playwright";
import { atlasText, keywords, readAtlas, type Atlas, type AtlasScreen } from "./atlas.ts";
import { noTutorialBecause, routeFromCandidate, slateOf, SLATE_FLOOR, type Angle, type Candidate } from "./slate.ts";
import { normalizeUrl, openTake, scrollCheckpoint, scrollToTarget, settle, settled, snapshotPage, type PageSnapshot } from "./browser.ts";
import { toUserFlow } from "./flow.ts";
import { isChrome, isDestructive, isExternal } from "./lexicon.ts";
import { rewalk } from "./rewalk.ts";
import { pageHeading, slugify, viewportBox } from "./score.ts";
import { roleSelector } from "./snapshot.ts";
import type { Box, ScreenEdge, ScreenNode, TourCandidate, TourMark, TourScript } from "./types.ts";
import { CLICK_AT, readingPause, SCROLL_MS } from "./timing.ts";

/** One thing the lesson intends to do, named the way the interface names it. */
export type RouteStep = {
  /** The screen it happens on, as `AtlasScreen.path`. */
  path: string;
  /** The control's own accessible name, copied from the reading. */
  control: string;
  /*
    What to do with it. A lesson is not only presses: half of teaching an interface is
    bringing the part that answers the question into the frame and letting a viewer read
    it. A `show` step scrolls to a heading and holds; it changes nothing, which is also
    why it is the only kind this tool will perform on a control it was not asked to press.
  */
  kind?: "press" | "show";
  /** One plain sentence for the record: why this step is in the lesson. */
  why: string;
};

export type Route = {
  steps: RouteStep[];
  /*
    The address the lesson is about, without its fragment.

    Once the camera has arrived there, a press that navigates somewhere else is not a
    step of this lesson — it is the lesson wandering off, which is what a purely lexical
    ranking does the moment the request's words also name something in the navigation.
  */
  on?: string;
  /** Who chose it, so a report can say whether a model was involved. */
  by: "brain" | "words";
  /** One paragraph for the record: how this route answers the request. */
  why: string;
};

/** A brain that reads a product and answers with a route through it. */
export type Router = (input: { goal: string; atlas: string; screens: { path: string; heading?: string }[] }) => Promise<Route>;

/*
  A brain that is handed the MENU and picks from it.

  The difference from a router matters. A router is asked an open question and answers
  with names it has to find in a document; a chooser is handed a ranked list that
  arithmetic already produced from the reading, and its whole job is to say what each one
  would be called by a viewer and which of them is worth a video. It phrases, and it may
  reorder — the same contract the walker's re-ranker has, and the same reason: judgement
  about what a person would want to watch is exactly what arithmetic cannot supply, and
  which controls exist is exactly what it must not invent.
*/
export type Chooser = (input: {
  atlas: string;
  slate: Candidate[];
}) => Promise<{ pick: number; task: string; angle?: Angle; why: string }>;

export type LessonScript = TourScript & {
  /** The request, in the words it was asked in — or, when nobody asked, the task panoma video chose. */
  goal: string;
  lesson: {
    by: Route["by"];
    why: string;
    /** Every step that was planned and could not be performed, with the reason. */
    dropped: { control: string; why: string }[];
    /** What the reading could not open, so a thin lesson can say whether it looked everywhere. */
    unread: string[];
    /** Set when nobody said what to teach: the menu the arithmetic produced, and which row was filmed. */
    slate?: { chosen: number; menu: Candidate[] };
    /** How the piece is framed. Chosen from the material; see slate.ts. */
    angle?: Angle;
    /** The screen's own sentence that earned the angle, when one did. */
    evidence?: string;
  };
};

/*
  How many steps a lesson may have.

  Guo, Kim & Rubin (L@S 2014, 6.9 million viewing sessions) measured that students
  watch two to three minutes of a tutorial whatever its length, and that tutorials —
  unlike lectures — are re-watched and scrubbed rather than played through. At the six
  to ten seconds a step needs to be signalled, performed and read, a piece a person
  finishes is four to six steps. The floor is the shape of the shortest honest
  tutorial there is: get to it, do it, see what happened.
*/
export const LESSON_STEPS = { most: 6, least: 3 } as const;

/* Compatibility export for scripts that used the old fixed hold. New lessons use
   the visible content budget in readingPause, after the recorder observes settlement. */
export { LESSON_HOLD_MS } from "./timing.ts";

export type WriteLessonOptions = {
  url: string;
  name: string;
  /*
    The request, in the words it was asked in; any language.

    Absent means nobody said: the reading is scored by `slateOf`, a chooser (or the
    arithmetic alone) picks a row, and the task becomes the goal. Which is the difference
    between a tool you have to know how to ask and one you can point at a product.
  */
  goal?: string;
  takes?: SessionTake[];
  colorScheme?: "light" | "dark";
  /** A brain that plans the route from the reading; the words of the request are used without one. */
  router?: Router;
  /** A brain that picks from the slate when nobody said what to teach; the top row is taken without one. */
  chooser?: Chooser;
  /** How many rows of the slate to consider. */
  slateSize?: number;
  /** How much of the product to read before planning. */
  budget?: Parameters<typeof readAtlas>[0]["budget"];
  onProgress?: (message: string) => void;
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const labelOf = (name: string): string => clip(redact(name.trim()).text, 60);

/** A control this tool will never press, whatever a route says. */
function forbidden(name: string): string | null {
  const destructive = isDestructive(name);
  if (destructive) return `"${destructive}" is on the destructive list`;
  const external = isExternal(name);
  if (external) return `"${external}" hands the work to another application`;
  const chrome = isChrome(name);
  if (chrome) return `"${chrome}" is chrome, not a step of this product`;
  return null;
}

/**
 * The route the words of the request alone can find.
 *
 * It is the fallback, and it is honest about being one: matching a request against an
 * interface is only as good as the vocabulary they share, and a request written in one
 * language about an interface written in another shares almost none. What it does have
 * is the reading's own structure — a screen knows which door it was reached through —
 * so the route is the CHAIN to the best-matching screen followed by the controls on it
 * that the request's words also name. That is exactly the shape of a tutorial: get
 * there, then do the thing.
 */
export function routeFromWords(atlas: Atlas, goal: string): Route {
  const words = keywords(goal);
  const score = (text: string) => {
    const hay = text.toLowerCase();
    let n = 0;
    for (const w of words) if (hay.includes(w)) n += w.length;
    return n;
  };
  const byId = new Map(atlas.screens.map((s) => [s.id, s]));
  const doorsTo = (screen: AtlasScreen): { screen: AtlasScreen; door: NonNullable<AtlasScreen["openedBy"]> }[] => {
    const chain: { screen: AtlasScreen; door: NonNullable<AtlasScreen["openedBy"]> }[] = [];
    for (let at: AtlasScreen | undefined = screen; at?.openedBy && chain.length < 8; at = byId.get(at.openedBy.from)) {
      chain.unshift({ screen: at, door: at.openedBy });
    }
    return chain;
  };

  /*
    The screen the request is about.

    Words first, and then two tie-breaks that matter more than they look. A product's
    "everything" view contains every word its focused views contain, so on text alone
    the catch-all always ties with the thing itself; the focused one is the one with
    FEWER sections on it and MORE doors behind it. Which is the same judgement a person
    makes: the deeper, narrower screen is the answer, and the one that shows everything
    is the place you were standing when you asked.
  */
  const ranked = [...atlas.screens].sort((a, b) => {
    const byWords = score(`${b.path} ${b.heading ?? ""} ${b.sections.join(" ")} ${b.openedBy?.name ?? ""} ${b.text}`)
      - score(`${a.path} ${a.heading ?? ""} ${a.sections.join(" ")} ${a.openedBy?.name ?? ""} ${a.text}`);
    if (byWords !== 0) return byWords;
    const byDepth = doorsTo(b).length - doorsTo(a).length;
    if (byDepth !== 0) return byDepth;
    return a.sections.length - b.sections.length;
  });
  const target = ranked[0];

  /*
    The product's furniture: a control that is on every screen is its navigation, and a
    lesson that presses one has left the subject rather than taught it. Measured on this
    product, "Projects" in the header outranked every control on the screen the request
    was about, because the request said "projects" — and pressing it walked the camera
    back out to the catalogue in the middle of the lesson.
  */
  const everywhere = new Set(
    atlas.screens.length >= 3
      ? atlas.screens[0].controls.filter((c) => atlas.screens.every((s) => s.controls.some((o) => o.selector === c.selector))).map((c) => c.selector)
      : [],
  );

  const steps: RouteStep[] = doorsTo(target).map(({ screen, door }) => ({
    path: byId.get(door.from)?.path ?? "/",
    control: door.name,
    why: `the way to ${screen.path}, which is where the request lands`,
  }));
  /*
    And then what is on that screen, SHOWN rather than pressed.

    Words alone cannot tell a safe press from an expensive one. The controls that teach
    this best are called "Fix the obvious" and "Ask the model's opinion": the first
    rewrites a file in somebody's repository and the second spends their model credits,
    and neither shares a word with the request that would have ranked it. A lexical
    ranking that presses whatever it finds is a tool that acts on a stranger's running
    product on the strength of a string match, so without a brain to reason about
    consequences this route reads the screen instead: it brings the headings the request
    names into frame and holds on them, which changes nothing and is most of what a
    tutorial about a panel actually is. A brain may name a press; that answer is a
    decision somebody can read in the tour's own file.
  */
  const shows = [target.heading, ...target.sections].filter((h): h is string => Boolean(h));
  for (const heading of shows) {
    if (steps.length >= LESSON_STEPS.most) break;
    if (steps.some((s) => s.control === heading)) continue;
    steps.push({ path: target.path, control: heading, kind: "show", why: `what ${target.path} says about it` });
  }
  return {
    steps: steps.slice(0, LESSON_STEPS.most),
    on: target.path.split("#")[0],
    by: "words",
    why:
      words.length === 0
        ? "the request carried no words to match on, so the route is the first screen the reading opened"
        : `matched the words ${words.map((w) => `"${w}"`).join(", ")} against the reading; the best screen was ${target.path}`,
  };
}

/**
 * The thing a route step names, on the page as it is now.
 *
 * A step names a control the way a person would — by what it says — and the page is
 * the authority on whether that thing is still there. Exact first; a name a brain
 * shortened by a word still names one thing when exactly one node contains it, and
 * never when two do, because guessing between two is how a tutorial ends up pointing
 * at the wrong button with complete confidence.
 */
function findOnPage(
  snap: PageSnapshot,
  name: string,
  kind: "press" | "show",
): { selector: string; box: Box; role: string; name: string; substitute?: string } | null {
  /*
    The reading clips a control's name at eighty characters and marks the cut with an
    ellipsis, which is right for a document a person reads and wrong for an identifier: a
    route step then names "Ana Pérez · Re: September invoice · You replied 2 days…" and
    nothing on the page has that string, because the page has the whole thing. The
    ellipsis is the reading's punctuation, not the product's, so it comes off before
    anything is compared — and a clipped name then matches as a prefix, which is what
    `near` is for. That shape — the accessible name is the whole card — is the normal one
    for a list row, a mail item, a search result, a Kanban card.
  */
  const wanted = name.trim().replace(/…$/, "").trim().toLowerCase();
  const roles = kind === "show" ? ["heading"] : ["button", "link", "tab", "menuitem", "option", "checkbox", "radio"];
  const nodes = snap.nodes.filter((n) => n.box && n.name.trim() && roles.includes(n.role));
  const made = (node: (typeof nodes)[number], substitute?: string) => ({
    selector: roleSelector(node.role, node.name, node.role === "heading" ? node.level : undefined),
    box: node.box!,
    role: node.role,
    name: node.name,
    ...(substitute ? { substitute } : {}),
  });

  const exact = nodes.find((n) => n.name.trim().toLowerCase() === wanted);
  if (exact) return made(exact);
  const near = nodes.filter((n) => n.name.trim().toLowerCase().includes(wanted));
  if (near.length === 1) return made(near[0]);
  if (near.length > 1) return null;

  /*
    One of a list will do.

    A step that names a row — "Open panoma-monorepo's page" — is not really about that
    row: it is about opening A project, and the product decides which projects exist.
    Measured on this one: the reading found the catalogue with 32 tiles, the camera rolled
    an hour later and there were 31 with a different one first, and every step of the
    lesson was dropped because the tile the route named had moved. The lesson was correct
    and useless.

    So a name that matches nothing is matched by SHAPE — same first word, same last word,
    same number of words — and only when at least three controls share it, which is the
    same three-of-a-kind that makes a collection in the reading. Below three it is not a
    list, it is a coincidence, and pressing a coincidence is how a tutorial points
    confidently at the wrong thing.
  */
  const shapeOf = (text: string) => {
    const w = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return w.length === 0 ? null : `${w[0]}|${w[w.length - 1]}|${w.length}`;
  };
  const shape = shapeOf(name);
  if (!shape) return null;
  const siblings = nodes.filter((n) => shapeOf(n.name) === shape);
  return siblings.length >= 3 ? made(siblings[0], name) : null;
}

type Proof = {
  page: Page;
  origin: string;
  viewport: { width: number; height: number };
  steps: SessionStep[];
  marks: TourMark[];
  candidates: TourCandidate[];
  pages: ScreenNode[];
  edges: ScreenEdge[];
  at: string;
  scrollY: number;
  dropped: { control: string; why: string }[];
};

/** Two steps that name the same thing are two marks, and a mark name is an identifier. */
function uniqueName(p: Proof, base: string): string {
  let name = base;
  for (let i = 2; p.marks.some((m) => m.name === name); i++) name = `${base}-${i}`;
  return name;
}

function screenOf(p: Proof, snap: PageSnapshot): ScreenNode {
  const found = p.pages.find((s) => s.id === snap.hash);
  if (found) {
    p.at = found.id;
    return found;
  }
  let path = "/";
  try {
    const u = new URL(snap.url);
    path = u.pathname + u.search;
  } catch {
    path = "/";
  }
  const heading = pageHeading(snap.nodes)?.name.trim();
  const made: ScreenNode = { id: snap.hash, path, ...(heading ? { heading } : {}), order: p.pages.length };
  p.pages.push(made);
  p.at = made.id;
  return made;
}

/**
 * What the interface answered, in its own words.
 *
 * The same rule the walker uses and for the same reason: a heading that was already on
 * the page before the press is not what the press produced, and reporting it anyway
 * writes a sentence that is grammatical, sourced and false. A step whose answer nobody
 * can point at claims nothing, and the narration says less.
 */
function answered(before: PageSnapshot, after: PageSnapshot): TourMark["outcome"] {
  const CHROME = new Set(["banner", "navigation", "contentinfo", "complementary"]);
  const named = (snap: PageSnapshot) =>
    snap.nodes.filter((n) => n.role === "heading" && n.name.trim() && !(n.landmark && CHROME.has(n.landmark)));
  const was = new Set(named(before).map((n) => n.name.trim()));
  /*
    The page's own heading, and only if it passed the same chrome filter as the rest.

    `pageHeading` takes the first h1 anywhere, which on a product whose banner carries the
    wordmark as an h1 is the wordmark — new on nothing, present on every screen, and
    reported as the result of every press. The named() set is already filtered; take it
    from there.
  */
  const page = named(after).find((n) => n.level === 1)?.name.trim();
  const heading = page && !was.has(page) ? page : named(after).map((n) => n.name.trim()).find((n) => !was.has(n));
  let route: string | undefined;
  try {
    if (normalizeUrl(after.url) !== normalizeUrl(before.url)) route = new URL(after.url).pathname;
  } catch {
    route = undefined;
  }
  if (!heading && !route) return undefined;
  return { ...(heading ? { heading } : {}), ...(route ? { route } : {}) };
}

/** Bring the target into frame the way the recorder will, and record the scroll as a step. */
async function approach(p: Proof, selector: string): Promise<Box> {
  const moved = await scrollToTarget(p.page, selector, { at: CLICK_AT, onlyIfNeeded: true });
  if (moved.moved) p.steps.push({ scrollTo: selector, at: CLICK_AT, ms: SCROLL_MS, ...(moved.backward ? { back: true as const } : {}) });
  p.scrollY = moved.windowY;
  const { x, y, width, height } = moved.box;
  return { x, y, w: width, h: height };
}

async function proveTake(browser: Browser, take: SessionTake, opts: WriteLessonOptions, route: Route, atlas: Atlas): Promise<Proof> {
  const { context, page } = await openTake(browser, take, opts.colorScheme ?? "dark");
  const origin = new URL(opts.url).origin;
  const p: Proof = {
    page,
    origin,
    viewport: take.viewport,
    steps: [],
    marks: [],
    candidates: [],
    pages: [],
    edges: [],
    at: "",
    scrollY: 0,
    dropped: [],
  };
  /* Every control the reading recorded anywhere, by name: what a press is allowed to be. */
  const known = new Set(atlas.screens.flatMap((s) => s.controls.map((c) => c.name.trim().replace(/…$/, "").trim().toLowerCase())));

  try {
    /*
      The lesson starts where the product does.

      `domcontentloaded` with a timeout, not `networkidle` without one: a product holding a
      request open — server-sent events, long polling, an analytics heartbeat, a dev
      server's hot-reload socket — never goes idle, and the reading (which already uses
      this) would sail through fourteen screens and the proof would then hang for ever on
      the first, after the whole reading had been paid for.
    */
    await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await settle(page);
    p.steps.push({ goto: opts.url });
    let snap = await settled(page);
    screenOf(p, snap);
    p.scrollY = snap.scrollY;

    /* The first mark is arriving: a viewer who has not opened the product yet is at step zero. */
    const heading = pageHeading(snap.nodes);
    const hero = heading?.name ?? (await page.title());
    p.marks.push({
      name: "open",
      label: labelOf(hero),
      kind: "hero",
      ...(heading?.box ? { target: viewportBox(heading.box, snap.scrollY) } : {}),
    });
    p.steps.push({ mark: "open" }, readingPause({ nodes: snap.nodes, focus: heading?.name, scrollY: p.scrollY, height: take.viewport.height, tutorial: true }));

    for (const step of route.steps) {
      if (p.marks.length > LESSON_STEPS.most) break;
      const kind = step.kind ?? "press";
      const why = kind === "press" ? forbidden(step.control) : null;
      if (why) {
        p.dropped.push({ control: step.control, why: `never pressed: ${why}` });
        continue;
      }
      const found = findOnPage(snap, step.control, kind);
      if (!found) {
        p.dropped.push({
          control: step.control,
          why: `not on ${new URL(page.url()).pathname} when the camera looked — the product changed between the reading and the shoot`,
        });
        continue;
      }
      /*
        And the thing actually found is checked again, by ITS name.

        The route's name was checked before the page was consulted; what gets pressed is
        whatever `findOnPage` resolved to, and for a substituted row that is a different
        string. Checking the plan and pressing something else is the shape of every guard
        that turns out not to have been one.
      */
      const no = kind === "press" ? forbidden(found.name) : null;
      if (no) {
        p.dropped.push({ control: found.name, why: `never pressed: ${no}` });
        continue;
      }
      /*
        A press must also be a control the READING saw. The route is partly written by a
        model that has read the product's own copy, and a product's own copy is where an
        injected instruction would live; the reading is the only list of controls that
        existed before that copy was read. A name that is on the page now and was not in
        the reading is a control the product grew between the two, and a lesson does not
        press one on a stranger's machine.
      */
      if (kind === "press" && !known.has(found.name.trim().toLowerCase())) {
        p.dropped.push({ control: found.name, why: "not in the reading: the product grew this control between the reading and the shoot" });
        continue;
      }

      const before = p.steps.length;
      /*
        Where the page was before this step was attempted.

        `approach` scrolls the real browser AND appends a scrollTo to the script, and every
        drop path below rewinds the script with `steps.length = before` and leaves the
        browser scrolled. The next step then measures its target against a viewport the
        recording will never be in, so the camera looks at the wrong part of the page while
        the narrator names the right one.
      */
      const position = await scrollCheckpoint(page, found.selector);
      try {
        const rewind = async () => {
          p.steps.length = before;
          p.scrollY = await position.restore();
        };
        const target = await approach(p, found.selector);

        if (kind === "show") {
          /*
            Nothing is pressed and nothing has to change: the step IS the scroll, and what
            it teaches is what the screen says once it is in frame. It still earns a mark,
            because a sentence has to be pinned to a moment, and a moment is a mark.
          */
          const approachSteps = p.steps.splice(before);
          const name = uniqueName(p, slugify(found.name) || `look-${p.marks.length}`);
          p.marks.push({ name, label: labelOf(found.name), kind: "section", target });
          p.steps.push({ mark: name }, ...approachSteps, readingPause({ nodes: snap.nodes, focus: found.name, scrollY: p.scrollY, height: take.viewport.height, tutorial: true }));
          p.candidates.push({
            selector: found.selector,
            description: `heading "${found.name}" (on ${new URL(page.url()).pathname})`,
            method: "scrollTo",
            box: found.box,
            score: 1,
            reasons: [
            `${route.by}: ${step.why}`,
            ...(found.substitute ? [`"${found.substitute}" was gone; this is one of the same shape`] : []),
            `shown as mark "${name}"`,
          ],
          });
          continue;
        }

        /* What the page looks like the instant before THIS press, so the diff is its own. */
        const just = await snapshotPage(page);
        const wasOn = new URL(page.url()).pathname;
        const pressed = await page
          .locator(found.selector)
          .first()
          .click({ timeout: 4000 })
          .then(() => true)
          .catch(() => false);
        if (!pressed) {
          await rewind();
          p.dropped.push({ control: step.control, why: "could not be pressed (hidden, covered or gone)" });
          continue;
        }
        const after = await settled(page);
        const landedOn = new URL(page.url()).pathname;
        /*
          Both sides are a bare pathname. `route.on` used to arrive with a query string on it
          — a candidate's address is `pathname + search` — and a screen reached at `/p?x=1`
          then never matched `wasOn`, which switched the guard off on exactly the products
          that route by query.
        */
        const on = route.on === undefined ? undefined : route.on.split("?")[0];
        const wandered = on !== undefined && wasOn === on && landedOn !== on;
        if (new URL(page.url()).origin !== origin || wandered) {
          await page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
          snap = await settled(page);
          p.steps.length = before;
          p.scrollY = snap.scrollY;
          p.dropped.push({
            control: step.control,
            why: wandered ? `leaves ${route.on}, which is what the lesson is about` : "leaves the product",
          });
          continue;
        }
        if (after.hash === just.hash) {
          await rewind();
          p.dropped.push({ control: step.control, why: "pressing it changed nothing a viewer could see" });
          snap = after;
          continue;
        }

        const approachSteps = p.steps.splice(before);
        const name = uniqueName(p, slugify(found.name) || `step-${p.marks.length}`);
        const outcome = answered(just, after);
        p.marks.push({ name, label: labelOf(found.name), kind: "cta", target, ...(outcome ? { outcome } : {}) });
        p.steps.push({ mark: name }, ...approachSteps, { clickOn: found.selector }, readingPause({ nodes: after.nodes, before: just.nodes, beforeScrollY: just.scrollY, scrollY: after.scrollY, height: take.viewport.height, tutorial: true }));
        p.candidates.push({
          selector: found.selector,
          description: `${step.control} (on ${wasOn})`,
          method: "click",
          box: found.box,
          score: 1,
          reasons: [
            `${route.by}: ${step.why}`,
            ...(found.substitute ? [`"${found.substitute}" was gone; this is one of the same list, which teaches the same thing`] : []),
            `pressed as mark "${name}"`,
          ],
        });
        const from = p.at;
        const to = screenOf(p, after);
        p.edges.push({ from, to: to.id, mark: name, label: labelOf(step.control), kind: "cta" });
        p.scrollY = after.scrollY;
        snap = after;
      } finally {
        await position.dispose();
      }
    }
  } finally {
    await context.close();
  }
  return p;
}

/**
 * Find the way to what someone asked for, prove it in a browser, and write the script.
 *
 * The result is a `TourScript` and nothing downstream can tell the difference — which
 * is the point: a lesson is a different way of CHOOSING what to film, not a different
 * kind of film.
 */
export async function writeLesson(opts: WriteLessonOptions): Promise<LessonScript> {
  const takes = opts.takes ?? [DESKTOP_TAKE, MOBILE_TAKE];
  const primary = takes.find((t) => !t.isMobile) ?? takes[0];
  const browser = await chromium.launch({ args: captureBrowserArgs() });
  try {
    opts.onProgress?.(`reading ${opts.url}`);
    const atlas = await readAtlas({
      url: opts.url,
      name: opts.name,
      ...(opts.goal ? { about: opts.goal } : {}),
      colorScheme: opts.colorScheme,
      take: primary,
      browser,
      ...(opts.budget ? { budget: opts.budget } : {}),
      onProgress: (m) => opts.onProgress?.(m),
    });

    let route: Route;
    let goal = opts.goal;
    let slate: { chosen: number; menu: Candidate[] } | undefined;
    let angle: Angle | undefined;
    let evidence: string | undefined;

    if (goal === undefined) {
      /*
        Nobody said what to teach, so the arithmetic proposes and the judgement picks.

        `slateOf` scores every screen the reading reached on five terms it can measure —
        whether getting there produces something, how focused it is, how far it is, what
        the screen says for itself, and whether anything on the way is refused — and the
        list it returns is the same for the same reading, every time. That is what makes
        it a thing to argue with rather than a mood. A brain then names each row and picks
        one; without a brain the top row is the pick, which is a defensible default
        precisely because the ranking is not a model's opinion.
      */
      const menu = slateOf(atlas).slice(0, opts.slateSize ?? 8);
      if (menu.length === 0 || menu[0].score < SLATE_FLOOR) {
        throw new Error(`This product has no tutorial in it: ${noTutorialBecause(atlas, menu)}`);
      }
      let chosen = 0;
      let answered = false;
      let why = `the slate's own arithmetic: ${menu[0].why.join("; ")}`;
      if (opts.chooser) {
        opts.onProgress?.(`choosing from ${menu.length} ${menu.length === 1 ? "candidate" : "candidates"}`);
        const answer = await opts.chooser({ atlas: atlasText(atlas), slate: menu }).catch((e: unknown) => {
          why = `the brain did not answer (${(e as Error).message.split("\n")[0]}), so the slate's top row was filmed`;
          return null;
        });
        if (answer) {
          answered = true;
          chosen = Math.max(0, Math.min(menu.length - 1, answer.pick));
          goal = answer.task;
          if (answer.angle) menu[chosen].angle = answer.angle;
          why = answer.why;
        }
      }
      const candidate = menu[chosen];
      goal = goal ?? candidate.heading ?? candidate.path;
      angle = candidate.angle;
      evidence = candidate.evidence;
      slate = { chosen, menu };
      const built = routeFromCandidate(atlas, candidate, LESSON_STEPS.most);
      /* "by" is who actually chose, not who was offered the job: a chooser that threw did not. */
      route = { steps: built.steps, on: built.on, by: answered ? "brain" : "words", why };
    } else if (opts.router) {
      opts.onProgress?.("planning the route");
      route = await opts.router({
        goal,
        atlas: atlasText(atlas),
        screens: atlas.screens.map((s) => ({ path: s.path, ...(s.heading ? { heading: s.heading } : {}) })),
      }).catch((e: unknown) => ({
        ...routeFromWords(atlas, goal!),
        why: `the brain did not answer (${(e as Error).message.split("\n")[0]}), so the words of the request chose the route`,
      }));
    } else {
      route = routeFromWords(atlas, goal);
    }

    opts.onProgress?.(`proving ${route.steps.length} ${route.steps.length === 1 ? "step" : "steps"}`);
    const proof = await proveTake(browser, primary, opts, route, atlas);
    let steps = proof.steps;
    for (const take of takes) {
      if (take === primary) continue;
      const result = await rewalk(browser, take, steps, opts.colorScheme ?? "dark");
      steps = result.steps;
      for (const note of result.notes) proof.candidates.push(note);
      /* One script serves every take, so a claim only survives where every take can reach it. */
      for (const name of result.unreachedMarks) {
        const mark = proof.marks.find((m) => m.name === name);
        if (mark) delete mark.outcome;
        const edge = proof.edges.find((e) => e.mark === name);
        if (edge) edge.desktopOnly = true;
      }
    }

    const script: LessonScript = {
      name: opts.name,
      url: opts.url,
      createdAt: new Date().toISOString(),
      steps,
      marks: proof.marks,
      candidates: proof.candidates,
      snapshot: atlasText(atlas),
      flow: { title: opts.name, steps: [] },
      pages: proof.pages,
      edges: proof.edges,
      goal: goal ?? "",
      lesson: {
        by: route.by,
        why: route.why,
        dropped: proof.dropped,
        unread: atlas.unread,
        ...(slate ? { slate } : {}),
        ...(angle ? { angle } : {}),
        ...(evidence ? { evidence } : {}),
      },
    };
    script.flow = toUserFlow(script);
    return script;
  } finally {
    await browser.close();
  }
}

/** What a lesson turned out to be, for the terminal and the report. */
export function lessonSummary(script: LessonScript): string {
  const taught = script.marks.filter((m) => m.kind !== "hero");
  const lines = [
    script.lesson.slate ? `nobody said what to teach; panoma video chose: "${script.goal}"` : `"${script.goal}"`,
    ...(script.lesson.angle ? [`  angle: ${script.lesson.angle}${script.lesson.evidence ? ` — the screen's own words: ${JSON.stringify(script.lesson.evidence)}` : ""}`] : []),
    `  route by ${script.lesson.by}: ${script.lesson.why}`,
    `  steps proved on camera: ${taught.length}`,
    ...taught.map((m) => `    · ${m.label}${m.outcome?.heading ? ` → "${m.outcome.heading}"` : ""}${m.outcome?.route ? ` at ${m.outcome.route}` : ""}`),
  ];
  if (script.lesson.dropped.length > 0) {
    lines.push(`  dropped: ${script.lesson.dropped.length}`);
    for (const d of script.lesson.dropped) lines.push(`    · ${d.control}: ${d.why}`);
  }
  if (script.lesson.unread.length > 0) lines.push(`  not read: ${script.lesson.unread.join(", ")}`);
  if (script.lesson.slate) {
    lines.push(`  the slate it chose from, best first (${script.lesson.slate.menu.length}):`);
    script.lesson.slate.menu.forEach((c, i) => {
      lines.push(`    ${i === script.lesson.slate!.chosen ? "▸" : " "} ${c.score.toFixed(1)}/10 ${c.angle.padEnd(9)} ${c.heading ?? c.path} · ${c.path}`);
    });
  }
  return lines.join("\n");
}
