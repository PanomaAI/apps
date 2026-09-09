/*
  The tour's contract, in one place so the walker, the summary and the flow
  converter cannot drift apart about what a script is. `TourScript` is the shape
  the architecture fixes (docs/architecture.md, section 2): the steps `panoma-video record`
  runs, the marks a brief pins sentences to, the ranked candidates a model may
  re-rank later, the snapshot the decisions were made on, and the DevTools flow.
*/
import type { SessionStep } from "@panoma/video-capture";
import type { UserFlow } from "./replay-schema.ts";

export type Box = { x: number; y: number; w: number; h: number };

export type MarkKind = "hero" | "section" | "cta" | "flow";

export type TourMark = {
  name: string;
  label: string;
  kind: MarkKind;
  /*
    Where the thing the mark is about sits on screen once its step has landed —
    viewport coordinates of the desktop take, after the scroll that the step
    performs. This is the hotspot the demo-tour vendors pan and zoom onto (Arcade
    reports pan-and-zoom in 80% of its top demos, docs.arcade.software); panoma video
    has the box before a single frame is recorded.
  */
  target?: Box;
  /*
    What the interface showed once this step landed: its own heading, and the route
    it ended on.

    The walker already judges a click by comparing the page to itself — a click that
    changes nothing is refused — and then throws the "after" away. Keeping it is the
    difference between a tutorial that says "click this" and one that says what
    clicking it does, in the product's own words, with the page as the source. Only
    a step that navigated or changed state has one; a scroll to a heading does not.
  */
  outcome?: { heading?: string; route?: string };
};

export type TourCandidate = {
  /** A documented Playwright selector, e.g. `role=link[name="Get started"s]`. */
  selector: string;
  description: string;
  method: "click" | "scrollTo";
  /** Document coordinates of the desktop take. */
  box: Box;
  /** 0 means "never clicked"; the reasons say why. */
  score: number;
  reasons: string[];
};

/*
  The product as a graph, which the walker has always known and always thrown away.

  `seenStates`, `visitedUrls` and the queue live for the length of one walk (walk.ts),
  and the refusal "leads to a state the tour has already shown" is precisely a back
  edge. Keeping them is what turns a list of steps into a diagram of how the app works:
  a node per distinct state the walk reached, an edge per control it actually pressed.

  Nothing here is inferred. An edge exists only where a click was performed and the page
  answered; a control the walker refused for any other reason is in `candidates` with its
  reason, and never in this graph.
*/
export type ScreenNode = {
  /** The walker's own state hash — two routes that render the same state are one node. */
  id: string;
  /** Origin-relative, so a free loopback port never reaches a drawing or a key. */
  path: string;
  heading?: string;
  /** Arrival order; 0 is the page the tour starts on. */
  order: number;
};

export type ScreenEdge = {
  from: string;
  /** The state the click produced; absent when it led somewhere the tour had already shown. */
  to?: string;
  /** The mark this edge is filmed as. Absent when the click worked and was refused anyway. */
  mark?: string;
  /** The control's own accessible name, as the interface writes it. */
  label: string;
  kind: "cta" | "nav";
  /** The click worked and led to a state already on screen: real, and not filmed. */
  seen?: boolean;
  /** The mobile re-walk could not reach this control. */
  desktopOnly?: boolean;
};

export type TourScript = {
  name: string;
  url: string;
  createdAt: string;
  /** The script `panoma-video record` runs — with marks and roles. */
  steps: SessionStep[];
  /** Source-reviewed controls whose effects are not authorized; retained on replay. */
  denySelectors?: string[];
  marks: TourMark[];
  candidates: TourCandidate[];
  /** The ai-mode aria snapshot of the landing page the decisions were made on. */
  snapshot: string;
  /** Chrome DevTools Recorder JSON (import/export). */
  flow: UserFlow;
  /*
    The screen graph: what the walk reached, and what pressing a control led to.

    Optional because the disk says so. The walker started persisting it on 3-Sep-2026
    ("The walker knew the shape of the product all along, and threw it away every run"),
    and three tours recorded before that — 1-Sep, 2-Sep and 3-Sep 04:50 — are still under
    the engine's home without either field, against eighteen that carry them. Declaring
    them required did not make them appear; it only stopped the compiler from asking
    anyone to check, which is why five files had already learned to read them as
    `tour.pages?.…` and `?? []` on their own.
  */
  pages?: ScreenNode[];
  edges?: ScreenEdge[];
};

/*
  How much of a product one tour may show. The demo-tour vendors publish the
  numbers their best-performing flows converge on:
  - Navattic's best practices: 5-13 steps per flow, start with a hook, at most a
    couple of calls to action (https://docs.navattic.com/help/best-practices.md).
  - Arcade's benchmarks: the best demos have 12 steps and 1-2 CTAs
    (https://docs.arcade.software/kb/build/interactive-demo/edit/pan-and-zoom).
  The legacy `ctas` field counts recorded product actions, including prerequisite
  selections, not viewer-facing calls to action in a finished film. Six actions
  let a short local workflow finish within the same twelve-step ceiling.
  `pages` bounds the crawl itself, not the script: it is the page budget of the
  model-free crawl the research recommends (Crawljax's idea, default 12).
*/
export type TourBudget = { steps: number; ctas: number; pages: number };

export const DEFAULT_BUDGET: TourBudget = { steps: 12, ctas: 6, pages: 12 };

/** Below this many product steps a tour is thin, and the summary says so (Navattic's floor). */
export const STEP_FLOOR = 5;

/*
  What the walker records, as a number the cache can compare.

  A tour is cached on the product — its commit, its working tree, its steps — which is
  right, and which means a tour written by an older walker is served forever to a
  project that has not changed. That is invisible and it is exactly how a new field on
  a mark reaches nobody: `outcome` was added, every existing workspace kept its
  outcome-less tour, and the tutorials went on saying "click this" with no "and that
  happens". So the walker's own contract is part of the key. Bump this when the walker
  starts recording something a brief can read — or something the mobile re-walk needs
  to reach a control, which is the same thing one step further down; not for a
  refactor that changes nothing anyone downstream can see.
*/
export const TOUR_VERSION = 12;
