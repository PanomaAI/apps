/*
  The walk: a running product goes in, a recording script comes out, and no model is
  needed at any point — one may be consulted, as a re-ranker of the calls to action
  (`rerank` below), never as the executor.

  Every demo-tour vendor (Arcade, Navattic, Supademo, Guidde, Clueso) derives its
  steps from clicks a human made and then writes one sentence per click. panoma video
  has no human in the loop, so this module makes the clicks itself, from the page's
  accessibility tree: the hero first, one scroll per section heading, the top call
  to action, then the primary navigation, breadth-first, until the budgets are
  spent. Everything it decides is written down in the script — a mark per moment,
  a role per click, a reason per candidate — so a person or a model can edit the
  result without driving a browser again.

  The walker EXECUTES what it plans, in its own browser, before writing it: a CTA
  that changes nothing (state hash unchanged), leaves the origin, or cannot be
  clicked is dropped with its reason instead of becoming a step that fails under
  the camera. A recording that dies at step nine is only discovered when the
  render looks wrong.
*/
import { redact } from "@panoma/video-core";
import { actionDenySelectors, captureBrowserArgs, deniedSelector, DESKTOP_TAKE, MOBILE_TAKE, targetGeometry, type SessionStep, type SessionTake } from "@panoma/video-capture";
import { chromium, type Browser, type Page } from "playwright";
import { boxOf, normalizeUrl, openTake, scrollToTarget, settle, settled, snapshotPage, targetDisappeared, type PageSnapshot } from "./browser.ts";
import { toUserFlow } from "./flow.ts";
import { CONSENT_ORDER, isChrome, isDestructive, isExternal, matchLexicon } from "./lexicon.ts";
import { rewalk } from "./rewalk.ts";
import { headingSelector, pageHeading, scoreCandidates, sectionAnchors, slugify, viewportBox } from "./score.ts";
import { roleSelector, type SnapshotNode } from "./snapshot.ts";
import { DEFAULT_BUDGET, type Box, type MarkKind, type ScreenEdge, type ScreenNode, type TourBudget, type TourCandidate, type TourMark, type TourScript } from "./types.ts";
import { CHROME_MS, CLICK_AT, readingPause, SCROLL_AT, SCROLL_MS } from "./timing.ts";
import { alternateSelector } from "./identity.ts";

/*
  What a re-ranker is handed and what it may answer.

  The candidates are the page's buttons and links as the scorer ranked them, with
  their reasons; the answer is an order of indexes. The executor stays the walker: a
  destructive, external or chrome candidate is "never clicked" whatever the answer
  says, a click that changes nothing is still refused, and the budgets still hold.
  What a model adds is judgement about which state change is worth the camera — a
  mute toggle and the product's main action both change the page.
*/
export type RerankInput = {
  page: { url: string; heading?: string; snapshot: string };
  candidates: { i: number; description: string; score: number; reasons: string[] }[];
  /** Steps the tour still has room for. */
  room: number;
};

export type Rerank = (input: RerankInput) => Promise<{ order: number[]; why?: string }>;

export type WriteTourOptions = {
  url: string;
  name: string;
  budget?: Partial<TourBudget>;
  /** Defaults to capture's desktop and mobile takes; the first non-mobile take is walked, the rest re-walked. */
  takes?: SessionTake[];
  /** The recorder's default is dark, and so is this. */
  colorScheme?: "light" | "dark";
  /** A model as re-ranker of the calls to action, never as executor; absent, the scorer's order is the order. */
  rerank?: Rerank;
  /** Words that invite action in the interface's language, added to the scorer's English lexicon. */
  verbs?: readonly string[];
  denySelectors?: readonly string[];
};

type NavLink = { name: string; href: string; seenOn: string };

type Walk = {
  page: Page;
  origin: string;
  viewport: { width: number; height: number };
  budget: TourBudget;
  steps: SessionStep[];
  marks: TourMark[];
  candidates: TourCandidate[];
  seenStates: Set<string>;
  visitedUrls: Set<string>;
  pages: ScreenNode[];
  edges: ScreenEdge[];
  /** The node the walk is standing on: what an edge leaves FROM. */
  at: string;
  pagesVisited: number;
  ctas: number;
  scrollY: number;
  queue: NavLink[];
  queued: Set<string>;
  usedSelectors: Set<string>;
  snapshot: string;
  rerank?: Rerank;
  verbs?: readonly string[];
  denySelectors: string[];
};

function uniqueMark(w: Walk, base: string): string {
  let name = base;
  for (let i = 2; w.marks.some((m) => m.name === name); i++) name = `${base}-${i}`;
  return name;
}

function mark(w: Walk, base: string, label: string, kind: MarkKind, target?: Box): string {
  const name = uniqueMark(w, base);
  w.marks.push({ name, label, kind, ...(target ? { target } : {}) });
  w.steps.push({ mark: name });
  return name;
}

/**
 * A state the walk reached, recorded once. The path is origin-relative on purpose: the
 * dev server binds a free port that is different every run, and this ends up drawn.
 */
function screen(w: Walk, snap: PageSnapshot): ScreenNode {
  const found = w.pages.find((p) => p.id === snap.hash);
  if (found) {
    w.at = found.id;
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
  const made: ScreenNode = { id: snap.hash, path, ...(heading ? { heading } : {}), order: w.pages.length };
  w.pages.push(made);
  w.at = made.id;
  return made;
}

/**
 * A control's own name, as the interface writes it, with credential-shaped text masked.
 * This is the first walker text that will ever be published — the map ships in a kit —
 * and everything else that leaves this machine goes through `redact` first.
 */
function labelOf(name: string): string {
  return redact(name.trim()).text.slice(0, 60);
}

/**
 * One control, pressed, and where it led.
 *
 * It leaves from the node the walk is STANDING on, not from the hash of the snapshot
 * taken the instant before the click. Those differ more often than they look: the state
 * hash is roles and names in document order, and a page that loads content as it is
 * scrolled has a different hash after the section pass than it had on arrival. Using the
 * snapshot's hash produced edges whose `from` matched no node, so the map counted them in
 * its caption and could not draw them.
 */
function edge(w: Walk, e: Omit<ScreenEdge, "from">): void {
  if (!w.at) return;
  w.edges.push({ from: w.at, ...e });
}

/*
  What the page showed that it was not showing before.

  `tryClick` has already proved the state is new, so something here is the
  interface's own answer to "what did that do" — but the page's own heading is only
  that answer when the click CHANGED it. A button that reveals a panel leaves the h1
  alone, and reporting it anyway produces a sentence that is grammatical, sourced and
  false: "click Open catalog and Your catalog opens", said over a catalog that was
  already open. So the page heading counts only when it is new, and otherwise the
  answer is the first heading that was not on the page a moment ago. When nothing
  answers, the mark claims nothing and the narration says less.
*/
async function landed(w: Walk, before: PageSnapshot, after: PageSnapshot): Promise<void> {
  /*
    The page's own headings, not the site's. A promo bar in the banner is a heading
    that is new on the page the click reached, and taking it by document order makes
    "click Get started and Summer sale opens" — sourced, and about the wrong thing.
    `main` or no landmark at all, which is what `pageHeading` and `sectionAnchors`
    already use, and which keeps a modal's heading (a dialog parses landmark-less).
  */
  const CHROME = new Set(["banner", "navigation", "contentinfo", "complementary"]);
  const named = (snap: PageSnapshot) =>
    snap.nodes.filter((n) => n.role === "heading" && n.name.trim() && !(n.landmark && CHROME.has(n.landmark)));
  /* A route is only worth recording when the step went somewhere. */
  let route: string | undefined;
  try {
    const to = new URL(after.url);
    if (normalizeUrl(after.url) !== normalizeUrl(before.url)) route = to.pathname;
  } catch {
    route = undefined;
  }
  const was = new Set(named(before).map((n) => n.name.trim()));
  // Accessibility visibility includes the whole scrollable document. A new heading
  // below the fold cannot name the result on this frame; nor can one clipped by a panel.
  const onFrame = named(after).filter(n => {
    if (!n.box) return false;
    const box = viewportBox(n.box, after.scrollY);
    return box.x < w.viewport.width && box.x + box.w > 0 && box.y < w.viewport.height && box.y + box.h > 0;
  });
  const visible = (await Promise.all(onFrame.map(async node => {
    const geometry = await targetGeometry(w.page, headingSelector(node), 1500).catch(() => null);
    return geometry && geometry.visibleShare >= 0.9 && geometry.centerVisible ? node : undefined;
  }))).filter((node): node is SnapshotNode => node !== undefined);
  const page = pageHeading(visible)?.name.trim();
  // A destination h1 may repeat the card that led here. The changed route makes
  // that a newly reached page, rather than an unchanged result of a local toggle.
  const heading = page && (route || !was.has(page)) ? page : visible.map(n => n.name.trim()).find(name => !was.has(name));
  if (!heading && !route) return;
  w.marks[w.marks.length - 1].outcome = { ...(heading ? { heading } : {}), ...(route ? { route } : {}) };
}

const roomFor = (w: Walk, reserve = 0): boolean => w.marks.length + reserve < w.budget.steps;

/*
  Bring a thing into the frame the way the recorder will: a scrollTo that puts it
  at `at` of the viewport. Emitted only when it is not already fully on screen,
  and flagged `back` when the recorder's own guard would otherwise refuse it
  (a scroll of more than a quarter viewport upwards — see session.ts).
*/
async function approach(w: Walk, selector: string, at: number): Promise<Box | null> {
  const moved = await scrollToTarget(w.page, selector, { at, onlyIfNeeded: true }).catch(async error => {
    if (!(await targetDisappeared(w.page, selector, error))) throw error;
    return null;
  });
  if (!moved) return null;
  if (moved.moved) w.steps.push({ scrollTo: selector, at, ms: SCROLL_MS, ...(moved.backward ? { back: true as const } : {}) });
  w.scrollY = moved.windowY;
  const { x, y, width, height } = moved.box;
  return { x, y, w: width, h: height };
}

/*
  Consent first, and as chrome: the banner is dismissed with the most
  privacy-preserving button it offers, the click earns no shot, and the step is
  optional because the banner is not there on a second visit.
*/
async function dismissConsent(w: Walk, snap: PageSnapshot): Promise<PageSnapshot> {
  const buttons = snap.nodes.filter((n) => (n.role === "button" || n.role === "link") && n.box && n.name.trim());
  let best: { node: SnapshotNode; rank: number } | undefined;
  for (const node of buttons) {
    const hit = matchLexicon(node.name, CONSENT_ORDER);
    if (!hit) continue;
    const rank = CONSENT_ORDER.indexOf(hit);
    if (!best || rank < best.rank) best = { node, rank };
  }
  if (!best) return snap;
  const selector = roleSelector(best.node.role, best.node.name);
  if (await deniedSelector(w.page, selector, w.denySelectors)) return snap;
  const clicked = await w.page
    .locator(selector)
    .first()
    .click({ timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  if (!clicked) return snap;
  await settle(w.page);
  const after = await snapshotPage(w.page);
  if (after.hash === snap.hash) return snap;
  w.steps.push({ clickOn: selector, optional: true, role: "chrome" }, { pause: CHROME_MS });
  return after;
}

function navLinks(w: Walk, snap: PageSnapshot): void {
  const inNav = snap.nodes.filter((n) => n.role === "link" && n.landmark === "navigation");
  const links = inNav.length ? inNav : snap.nodes.filter((n) => n.role === "link" && n.landmark === "banner");
  for (const link of links) {
    if (!link.url || !link.name.trim() || isDestructive(link.name) || isExternal(link.name) || isChrome(link.name)) continue;
    let href: URL;
    try {
      href = new URL(link.url, snap.url);
    } catch {
      continue;
    }
    if (href.origin !== w.origin || !/^https?:$/.test(href.protocol)) continue;
    const key = normalizeUrl(href.toString());
    if (w.queued.has(key)) continue;
    w.queued.add(key);
    w.queue.push({ name: link.name, href: key, seenOn: snap.url });
  }
}

/*
  What a click did, judged by the page and not by the promise: off-origin is
  undone and refused, an unchanged state is a no-op, a state already seen is a
  loop. Only a new same-origin state becomes a step.
*/
async function tryClick(
  w: Walk,
  selector: string,
  before: PageSnapshot,
): Promise<{ ok: true; snap: PageSnapshot; navigated: boolean } | { ok: false; why: string; snap?: PageSnapshot }> {
  const denied = await deniedSelector(w.page, selector, w.denySelectors);
  if (denied) return { ok: false, why: `source policy refuses ${denied}` };
  const clicked = await w.page
    .locator(selector)
    .first()
    .click({ timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  if (!clicked) return { ok: false, why: "could not be clicked (hidden, covered or gone)" };
  const snap = await settled(w.page);
  const url = w.page.url();
  if (new URL(url).origin !== w.origin) {
    await w.page.goBack({ waitUntil: "networkidle" }).catch(() => undefined);
    await settle(w.page);
    return { ok: false, why: `leaves the origin for ${new URL(url).host}` };
  }
  if (snap.hash === before.hash) return { ok: false, why: "no-op click: the page did not change" };
  const navigated = normalizeUrl(url) !== normalizeUrl(before.url);
  if (navigated && (w.seenStates.has(snap.hash) || w.visitedUrls.has(normalizeUrl(url)))) {
    await w.page.goBack({ waitUntil: "networkidle" }).catch(() => undefined);
    await settle(w.page);
    return { ok: false, why: "leads to a state the tour has already shown", snap };
  }
  return { ok: true, snap, navigated };
}

async function arrive(w: Walk, snap: PageSnapshot): Promise<void> {
  w.pagesVisited++;
  w.visitedUrls.add(normalizeUrl(snap.url));
  w.seenStates.add(snap.hash);
  screen(w, snap);
  w.scrollY = snap.scrollY;
  w.usedSelectors.clear();
  navLinks(w, snap);
}

async function sectionPass(w: Walk, snap: PageSnapshot): Promise<void> {
  for (const heading of sectionAnchors(snap.nodes)) {
    if (!roomFor(w, w.ctas < w.budget.ctas ? 1 : 0)) return;
    const selector = headingSelector(heading);
    /* A repeated heading would send the recorder's first-match scroll back to the earlier one. */
    if (w.usedSelectors.has(selector)) continue;
    w.usedSelectors.add(selector);
    const moved = await scrollToTarget(w.page, selector, { at: SCROLL_AT }).catch(async error => {
      if (!(await targetDisappeared(w.page, selector, error))) throw error;
      return null;
    });
    if (!moved) {
      w.candidates.push({ selector, description: `section "${heading.name}"`, method: "scrollTo", box: heading.box!, score: 0,
        reasons: ["not scrolled: target disappeared after it was observed"] });
      continue;
    }
    // Commit the mark only once the approach succeeds; no vanished section earns a shot.
    mark(w, slugify(heading.name), heading.name, "section");
    w.steps.push({ scrollTo: selector, at: SCROLL_AT, ms: SCROLL_MS, ...(moved.backward ? { back: true as const } : {}) });
    w.scrollY = moved.windowY;
    const { x, y, width, height } = moved.box;
    w.marks[w.marks.length - 1].target = { x, y, w: width, h: height };
    const visible = await snapshotPage(w.page);
    w.steps.push(readingPause({ nodes: visible.nodes, focus: heading.name, scrollY: w.scrollY, height: w.viewport.height }));
  }
}

async function ctaPass(w: Walk, snap: PageSnapshot): Promise<PageSnapshot | null> {
  const sections = sectionAnchors(snap.nodes);
  const ranked = scoreCandidates(snap.nodes, {
    viewport: w.viewport,
    origin: w.origin,
    pageUrl: snap.url,
    heroEnd: sections[0]?.box?.y,
    verbs: w.verbs,
  });
  const path = new URL(snap.url).pathname;
  const policyDenied = new Set<TourCandidate>();
  for (const c of ranked) {
    c.description += ` (on ${path})`;
    const denied = await deniedSelector(w.page, c.selector, w.denySelectors);
    if (denied) { c.score = 0; c.reasons.push(`source policy refuses ${denied}`); policyDenied.add(c); }
  }
  w.candidates.push(...ranked);
  /*
    A candidate the re-ranker may put forward: anything the scorer ranked, and
    anything it set aside only for WHERE it sits — a destination list in a
    complementary landmark is the product's main task on some pages. What the scorer
    refused for what it IS — destructive, external, chrome, off-origin, the page
    itself — is not on offer, and the loop below skips it at score 0 regardless.
  */
  const rescuable = (c: TourCandidate) => !policyDenied.has(c) && (c.score > 0 || c.reasons.some((r) => r.startsWith("not a call to action: outside main and banner")));
  let order = ranked;
  if (w.rerank) {
    const offered = ranked.map((c, i) => ({ c, i })).filter(({ c }) => rescuable(c) && !w.usedSelectors.has(c.selector));
    try {
      const answer = await w.rerank({
        page: { url: snap.url, heading: pageHeading(snap.nodes)?.name, snapshot: snap.text },
        candidates: offered.map(({ c, i }) => ({ i, description: c.description, score: c.score, reasons: [...c.reasons] })),
        room: Math.max(0, w.budget.steps - w.marks.length),
      });
      const chosen: TourCandidate[] = [];
      const sentences = answer.why ? answer.why.split(/(?<=[.!?])\s+/) : [];
      for (const i of answer.order) {
        const c = ranked[i];
        /* An index that names nobody, or something the scorer refused for what it is, is passed over without a word. */
        if (!c || !rescuable(c) || chosen.includes(c)) continue;
        if (c.score <= 0) c.score = 0.5;
        const sentence = sentences[chosen.length];
        c.reasons.push(`brain: ranked #${chosen.length + 1}${sentence ? ` — ${sentence}` : ""}`);
        chosen.push(c);
      }
      order = [...chosen, ...ranked.filter((c) => !chosen.includes(c))];
    } catch (e) {
      /* A brain that does not answer leaves the scorer's order in place, and says so on the record. */
      for (const c of ranked) c.reasons.push(`brain: no answer (${(e as Error).message.split("\n")[0]})`);
    }
  }
  for (const c of order) {
    if (c.score <= 0) continue;
    if (!roomFor(w)) {
      c.reasons.push("not clicked: the step budget is spent");
      continue;
    }
    if (w.usedSelectors.has(c.selector)) {
      c.reasons.push("not clicked: already used on this page");
      continue;
    }
    const node = snap.nodes.find((n) => n.box === c.box)!;
    const before = w.steps.length;
    const target = await approach(w, c.selector, CLICK_AT);
    if (!target) {
      w.steps.length = before;
      c.reasons.push("not clicked: target disappeared after it was observed");
      continue;
    }
    /*
      What the page looks like the instant before THIS click, not when the pass began.

      Both questions below are about one click — did it change anything, and what did
      it produce — and both used to be answered against the snapshot taken before the
      first candidate was even tried. Everything an earlier attempt left behind was
      therefore credited to whichever click succeeded later. Measured on a real
      product: the walk tried a destination button, Playwright reported it could not
      be clicked, the app had nevertheless moved to that destination, and the next
      click — a mute toggle — was recorded as having produced the heading "Marte".
      That became a fact with a source, and from there a sentence the film spoke
      aloud: "click this and the heading changes to Marte", true of nothing.

      A fresh snapshot makes the diff the click's own. A page that animates itself
      between these two frames can still fool it; that is written down in docs/tour.md
      rather than papered over.
    */
    const just = await snapshotPage(w.page);
    const alternate = await alternateSelector(w.page, c.selector);
    const result = await tryClick(w, c.selector, just);
    if (!result.ok) {
      w.steps.length = before;
      c.reasons.push(`not clicked: ${result.why}`);
      /* A click that worked and led somewhere already shown is a real edge nobody films. */
      const to = result.snap?.hash;
      if (to) edge(w, { ...(w.pages.some((p) => p.id === to) ? { to } : {}), label: labelOf(node.name), kind: "cta", seen: true });
      continue;
    }
    /* The mark goes before the approach so the step's footage includes the scroll to the target. */
    const approachSteps = w.steps.splice(before);
    const name = mark(w, "cta", node.name, "cta", target);
    await landed(w, just, result.snap);
    const cameFrom = w.at;
    w.steps.push(...approachSteps, { clickOn: c.selector, ...(alternate ? { alternate } : {}) }, readingPause({ nodes: result.snap.nodes, before: just.nodes, beforeScrollY: just.scrollY, scrollY: result.snap.scrollY, height: w.viewport.height }));
    w.usedSelectors.add(c.selector);
    w.ctas++;
    c.reasons.push(`clicked as mark "${name}"`);
    for (const other of order) {
      if (other !== c && other.score > 0 && !other.reasons.some((r) => r.startsWith("not clicked") || r.startsWith("clicked"))) {
        other.reasons.push("not clicked: an earlier candidate on this page was clicked first");
      }
    }
    if (result.navigated) await arrive(w, result.snap);
    else {
      w.seenStates.add(result.snap.hash);
      /*
        A click that changed the page without leaving it is a state of its own — a menu
        open, a panel revealed, a sound turned off — and the map is a map of states, not
        of routes. Without this the graph had edges pointing at nothing: universend's
        whole tour happens on one URL.
      */
      screen(w, result.snap);
    }
    w.edges.push({ from: cameFrom, to: w.at, mark: name, label: labelOf(node.name), kind: "cta" });
    return result.snap;
  }
  return null;
}

/* One page: its sections, then its calls to action, each of which may lead to another page. */
async function pagePass(w: Walk, snap: PageSnapshot): Promise<void> {
  await sectionPass(w, snap);
  let current = snap;
  while (w.ctas < w.budget.ctas && roomFor(w)) {
    const next = await ctaPass(w, current);
    if (!next) return;
    const navigated = normalizeUrl(next.url) !== normalizeUrl(current.url);
    current = next;
    if (navigated) {
      if (w.pagesVisited >= w.budget.pages) return;
      await sectionPass(w, current);
    }
  }
}

/*
  Breadth-first over the primary navigation. A link is clicked from the page it
  was seen on; when the tour is elsewhere, a goto brings it back first. The
  state hash and the visited-URL set together keep the tour from showing one
  page twice under two names.
*/
async function navPass(w: Walk, current: PageSnapshot): Promise<void> {
  while (w.queue.length && roomFor(w) && w.pagesVisited < w.budget.pages) {
    const link = w.queue.shift()!;
    if (w.visitedUrls.has(link.href)) continue;
    const onThisPage = (s: PageSnapshot): SnapshotNode | undefined =>
      s.nodes.find((n) => {
        if (n.role !== "link" || !n.url || !n.box || n.name !== link.name) return false;
        try {
          return normalizeUrl(new URL(n.url, s.url).toString()) === link.href;
        } catch {
          return false;
        }
      });
    let node = onThisPage(current);
    const before = w.steps.length;
    if (!node) {
      await w.page.goto(link.seenOn, { waitUntil: "networkidle" });
      await settle(w.page);
      current = await snapshotPage(w.page);
      w.scrollY = current.scrollY;
      w.steps.push({ goto: link.seenOn });
      node = onThisPage(current);
      if (!node) {
        w.steps.length = before;
        continue;
      }
    }
    const selector = roleSelector("link", link.name);
    const target = await approach(w, selector, CLICK_AT);
    if (!target) {
      w.steps.length = before;
      w.candidates.push({ selector, description: `link "${link.name}" in navigation → ${new URL(link.href).pathname}`,
        method: "click", box: node.box!, score: 0, reasons: ["not clicked: target disappeared after it was observed"] });
      continue;
    }
    /* The same rule as the call-to-action pass: what this click did is measured against the page as it was the instant before it. */
    const just = await snapshotPage(w.page);
    const result = await tryClick(w, selector, just);
    if (!result.ok || !result.navigated) {
      w.steps.length = before;
      w.candidates.push({
        selector,
        description: `link "${link.name}" in navigation → ${new URL(link.href).pathname}`,
        method: "click",
        box: node.box!,
        score: 0,
        reasons: [`not clicked: ${result.ok ? "did not navigate" : result.why}`],
      });
      continue;
    }
    const approachSteps = w.steps.splice(before);
    const navMark = mark(w, slugify(link.name), link.name, "flow", target);
    await landed(w, just, result.snap);
    const cameFrom = w.at;
    /* Where this link goes, for a take that renders it as an icon with no name to be found by. */
    const to = (() => {
      try {
        const u = new URL(link.href);
        return u.origin === w.origin ? u.pathname + u.search : undefined;
      } catch {
        return undefined;
      }
    })();
    w.steps.push(...approachSteps, { clickOn: selector, ...(to ? { href: to } : {}) }, readingPause({ nodes: result.snap.nodes, before: just.nodes, beforeScrollY: just.scrollY, scrollY: result.snap.scrollY, height: w.viewport.height }));
    current = result.snap;
    await arrive(w, current);
    w.edges.push({ from: cameFrom, to: w.at, mark: navMark, label: labelOf(link.name), kind: "nav" });
    await pagePass(w, current);
    if (normalizeUrl(w.page.url()) !== normalizeUrl(current.url)) current = await snapshotPage(w.page);
  }
}

async function walkTake(browser: Browser, take: SessionTake, opts: WriteTourOptions, budget: TourBudget): Promise<Walk> {
  const { context, page } = await openTake(browser, take, opts.colorScheme ?? "dark");
  const w: Walk = {
    page,
    origin: new URL(opts.url).origin,
    viewport: take.viewport,
    budget,
    steps: [],
    marks: [],
    candidates: [],
    seenStates: new Set(),
    visitedUrls: new Set(),
    pages: [],
    edges: [],
    at: "",
    pagesVisited: 0,
    ctas: 0,
    scrollY: 0,
    queue: [],
    queued: new Set(),
    usedSelectors: new Set(),
    snapshot: "",
    rerank: opts.rerank,
    verbs: opts.verbs,
    denySelectors: actionDenySelectors(opts.denySelectors),
  };
  try {
    await page.goto(opts.url, { waitUntil: "networkidle" });
    await settle(page);
    w.steps.push({ goto: opts.url });
    let snap = await snapshotPage(page);
    snap = await dismissConsent(w, snap);
    w.snapshot = snap.text;
    await arrive(w, snap);

    const heading = pageHeading(snap.nodes);
    mark(w, "hero", heading?.name ?? (await page.title()), "hero", heading?.box ? viewportBox(heading.box, snap.scrollY) : undefined);
    w.steps.push(readingPause({ nodes: snap.nodes, focus: heading?.name, scrollY: w.scrollY, height: w.viewport.height }));

    await pagePass(w, snap);
    const current = normalizeUrl(page.url()) === normalizeUrl(snap.url) ? snap : await snapshotPage(page);
    await navPass(w, current);
  } finally {
    await context.close();
  }
  return w;
}

/**
 * Walks a running product and writes its recording script: one shared step list
 * for every take, marks per moment, ranked candidates, and the DevTools flow.
 */
export async function writeTour(opts: WriteTourOptions): Promise<TourScript> {
  const budget: TourBudget = { ...DEFAULT_BUDGET, ...opts.budget };
  const takes = opts.takes ?? [DESKTOP_TAKE, MOBILE_TAKE];
  const primary = takes.find((t) => !t.isMobile) ?? takes[0];
  const browser = await chromium.launch({ args: captureBrowserArgs() });
  try {
    const w = await walkTake(browser, primary, opts, budget);
    let steps = w.steps;
    for (const take of takes) {
      if (take === primary) continue;
      const result = await rewalk(browser, take, steps, opts.colorScheme ?? "dark", w.denySelectors);
      steps = result.steps;
      for (const note of result.notes) w.candidates.push(note);
      /*
        One script serves every take, so what a mark is allowed to CLAIM is what is
        true in all of them. A control the phone does not render makes its click a
        step this take skips, and the outcome the desktop observed did not happen
        here — so the claim goes, and the narration falls back to the instruction.
      */
      for (const name of result.unreachedMarks) {
        const mark = w.marks.find((m) => m.name === name);
        if (mark) delete mark.outcome;
      }
      for (const name of result.unreachedMarks) {
        const link = w.edges.find((e) => e.mark === name);
        if (link) link.desktopOnly = true;
      }
    }
    /*
      What the phone could not reach is recorded on the edge rather than deleted: the
      control exists and the desktop pressed it, and a map that quietly dropped it would
      be drawing a smaller product than the one that was filmed.
    */
    const script: TourScript = {
      name: opts.name,
      url: opts.url,
      createdAt: new Date().toISOString(),
      steps,
      ...(w.denySelectors.length ? { denySelectors: w.denySelectors } : {}),
      marks: w.marks,
      candidates: w.candidates,
      snapshot: w.snapshot,
      flow: { title: opts.name, steps: [] },
      pages: w.pages,
      edges: w.edges,
    };
    script.flow = toUserFlow(script);
    return script;
  } finally {
    await browser.close();
  }
}
