/*
  The app, read.

  The walker (walk.ts) answers "what is worth filming about this product" and
  answers it by walking: it explores breadth-first, presses what its scorer ranks
  highest, and writes a recording script. It is the right machine for a film that
  sells, and the wrong one for a person who says *make me a tutorial about how to
  manage the .md files of my projects*. That request names a destination, and a
  breadth-first walk has no destination: it would film the front door.

  So this module does the other half. It READS the product — every screen it can
  reach within its budget, every heading on each one, every control by the name the
  interface gives it — and writes that down as a document. Nothing here is filmed
  and nothing here is chosen: the atlas is the map a route is planned on, by a brain
  or by the words of the request itself (lesson.ts), and only then does anything get
  pressed on camera.

  Two things it does that the walker deliberately does not:

  - IT FOLLOWS CONTENT LINKS, not only the navigation. A tutorial about projects
    happens on a project page, and a project page is reached from a card in a grid.
    The cost is a catalogue of thirty-two projects looking like thirty-two screens,
    so links are grouped by the shape of their path and only the first couple of each
    shape is opened: `/p/panoma-monorepo` and `/p/panoma-video` are one screen with two
    addresses, and reading both teaches nothing the first did not.
  - IT OPENS IN-PAGE VIEWS. `scoreCandidates` refuses a link that points at the page
    it is on, which is right for a tour — a jump link films as nothing — and blind
    for a reading: a tab strip written as `<a href="#md">` is how a large part of
    this product's surface is reached, and none of it exists in a walk. Here such a
    link is pressed, and if the page's state changes it is a screen with the control
    that opens it recorded beside it.

  What it never does is press anything on the destructive, external or chrome lists.
  Reading a product is not permission to act on it, and this drives someone's running
  instance.
*/
import { redact } from "@panoma/video-core";
import { DESKTOP_TAKE, type SessionTake } from "@panoma/video-capture";
import type { Browser, Page } from "playwright";
import { launchBrowser, normalizeUrl, openTake, settle, settled, snapshotPage, type PageSnapshot } from "./browser.ts";
import { isChrome, isDestructive, isExternal } from "./lexicon.ts";
import { pageHeading, sectionAnchors } from "./score.ts";
import { roleSelector } from "./snapshot.ts";
import type { Box } from "./types.ts";

/** One thing on a screen a person could press, as the interface names it. */
export type AtlasControl = {
  /** A documented Playwright selector: what the recorder would be told to click. */
  selector: string;
  role: string;
  /** The control's own accessible name, redacted and clipped. */
  name: string;
  /** Document coordinates in the desktop take. */
  box: Box;
  landmark?: string;
  /** Where a link points, origin-relative; absent for a button. */
  href?: string;
  /** Set when the control is on a list this tool never presses, and why. */
  refused?: string;
};

/** One state of the product: a route, or a view of a route opened by a control. */
export type AtlasScreen = {
  /** The state hash: two routes that render the same thing are one screen. */
  id: string;
  /** Origin-relative, so a loopback port never reaches a plan or a key. */
  path: string;
  /** The page's own heading. */
  heading?: string;
  /** Every section heading, in document order: what this screen is about. */
  sections: string[];
  controls: AtlasControl[];
  /** The screen's own running text, clipped — what a reader would see. */
  text: string;
  /*
    The control this reading pressed to get here, and the screen it was pressed on.

    It is the same field for a view and for a navigation, and that is deliberate: what
    a route needs from it is identical — the door, and which side of it you were
    standing on. Absent on a screen the reading reached by typing its address, which
    is every screen a link leads to and the one the reading started at.
  */
  openedBy?: { from: string; selector: string; name: string };
  /** Arrival order; 0 is the address the reading started at. */
  order: number;
  /*
    What kind of screen this is, for diagnosing a reading that found nothing.

    A product behind a sign-in reads as one screen with a password field on it and no way
    further, and the difference between saying that and saying "nothing scored well enough
    to film" is the difference between a tool a person can act on and one they file a bug
    against.
  */
  signals: { fields: number; password: boolean };
};

export type Atlas = {
  name: string;
  url: string;
  createdAt: string;
  screens: AtlasScreen[];
  /** Screens the budget stopped this reading from opening, by path. */
  unread: string[];
};

export type AtlasBudget = {
  /** How many distinct screens to read at all. */
  screens: number;
  /** How many addresses of one path shape are worth reading. */
  perShape: number;
  /** How many in-page views to open on one screen. */
  views: number;
};

export const ATLAS_BUDGET: AtlasBudget = { screens: 14, perShape: 2, views: 8 };

/*
  Bumped when this module starts recording something a route can read. It is part of
  the cache key, so a lesson planned against an older reading is re-read rather than
  served for ever — the same contract TOUR_VERSION carries for the walker.
*/
export const ATLAS_VERSION = 2;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The interface's own words, with credential-shaped text masked, like every other string that leaves this machine. */
const say = (s: string): string => clip(redact(s.trim()).text, 80);

/**
 * The shape of a path, with the parts that vary collapsed.
 *
 * `/p/panoma-monorepo` and `/p/panoma-video` are the same screen twice, and a catalogue of
 * thirty-two of them would spend the whole budget proving it. Everything below the
 * first segment is a wildcard, which is coarse on purpose: this decides how many
 * ADDRESSES to open, never what a screen is — that is still the state hash.
 */
export function pathShape(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  return `/${parts[0]}${parts.length > 1 ? "/*".repeat(parts.length - 1) : ""}`;
}

function controlsOf(snap: PageSnapshot, origin: string): AtlasControl[] {
  const out: AtlasControl[] = [];
  for (const node of snap.nodes) {
    if (node.role !== "button" && node.role !== "link" && node.role !== "tab") continue;
    if (!node.box || !node.name.trim()) continue;
    const name = say(node.name);
    let href: string | undefined;
    if (node.url) {
      try {
        const u = new URL(node.url, snap.url);
        href = redact(u.origin === origin ? u.pathname + u.search + u.hash : u.href).text;
      } catch {
        href = redact(node.url).text;
      }
    }
    const refused =
      isDestructive(node.name) !== null
        ? `on the destructive list ("${isDestructive(node.name)}")`
        : isExternal(node.name) !== null
          ? `hands the work to another application`
          : isChrome(node.name) !== null
            ? `chrome, not a control of this product`
            : undefined;
    out.push({
      selector: roleSelector(node.role, node.name),
      role: node.role,
      name,
      box: node.box,
      ...(node.landmark ? { landmark: node.landmark } : {}),
      ...(href ? { href } : {}),
      ...(refused ? { refused } : {}),
    });
  }
  /* One entry per control: a name repeated in a header and a footer is one thing to press. */
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.selector) ? false : (seen.add(c.selector), true)));
}

/*
  The screen's own running text — its content, not its furniture.

  A product's header, navigation, footer and side panels are on every screen, and taking
  the whole document meant every screen "said" whatever the sidebar said. Measured on
  this disk: three different views of one project page all offered "131 KB of code" as
  the thing they were about, because that figure lives in a panel none of them owns. The
  same landmark rule the walker uses for headings applies here — `main`, or no landmark
  at all, which keeps a dialog (a dialog parses landmark-less) and drops the chrome.
*/
const FURNITURE: ReadonlySet<string> = new Set(["banner", "navigation", "contentinfo", "complementary"]);

function textOf(snap: PageSnapshot): string {
  const parts: string[] = [];
  for (const node of snap.nodes) {
    if (node.landmark && FURNITURE.has(node.landmark)) continue;
    const piece = node.text?.trim() || (node.role === "paragraph" || node.role === "heading" ? node.name.trim() : "");
    if (piece && piece.length > 1) parts.push(piece);
    if (parts.join(" ").length > 2400) break;
  }
  return clip(redact(parts.join(" · ")).text, 2400);
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}

/*
  Write a screen down, once.

  A state hash is the identity, and it is slightly too strict for a live product: a
  page carrying a relative clock ("47 min ago") or a figure that ticks answers with a
  different hash on a second visit, and the reading ends up holding the same screen
  twice — once reached by a press, once by its address. So an address that already has
  a screen with the same heading is that screen. Which is a decision about READING,
  not about filming: a tour still treats every state as its own, because a tour
  presses things and has to know whether a press changed anything.
*/
function record(atlas: Atlas, snap: PageSnapshot, origin: string, openedBy?: AtlasScreen["openedBy"]): { screen: AtlasScreen; made: boolean } {
  const known = atlas.screens.find((s) => s.id === snap.hash);
  if (known) return { screen: known, made: false };
  const path = pathOf(snap.url);
  const heading = pageHeading(snap.nodes)?.name;
  /*
    The path+heading dedupe is for a screen reached by ADDRESS, which is where the
    ticking-clock problem lives: the same page read twice answers with two hashes because
    a relative time moved. A screen reached by PRESSING something is a view, and a view
    whose page heading did not change is the commonest kind there is — a tab strip that
    swaps the body and leaves the h1 alone. Deduping those away deleted most of what the
    reading exists to find.
  */
  const same = openedBy ? undefined : atlas.screens.find((s) => s.openedBy === undefined && s.path === path && s.heading === (heading ? say(heading) : undefined));
  if (same) return { screen: same, made: false };
  const screen: AtlasScreen = {
    id: snap.hash,
    path,
    ...(heading ? { heading: say(heading) } : {}),
    sections: sectionAnchors(snap.nodes).map((n) => say(n.name)).slice(0, 24),
    controls: controlsOf(snap, origin),
    text: textOf(snap),
    signals: {
      fields: snap.nodes.filter((n) => n.role === "textbox" || n.role === "combobox" || n.role === "searchbox").length,
      password: snap.nodes.some((n) => /password|contrase|passwort|mot de passe|senha/i.test(n.name)),
    },
    ...(openedBy ? { openedBy } : {}),
    order: atlas.screens.length,
  };
  atlas.screens.push(screen);
  return { screen, made: true };
}

/*
  A link that stays on the page it is on: a tab strip, a filter, a section switch.

  The href is the identity — `#md` on `/p/x` — and the walker refuses exactly these,
  because pressing one produces no navigation to film. A reading wants them: on this
  product they are how a project's sections are reached, and every one of them is a
  screen a tutorial might be about.
*/
function viewLinks(snap: PageSnapshot, controls: AtlasControl[]): AtlasControl[] {
  const here = pathOf(snap.url).split("#")[0];
  return controls.filter((c) => {
    if (c.refused) return false;
    if (c.role === "tab") return true;
    if (!c.href) return false;
    const [path, hash] = c.href.split("#");
    return hash !== undefined && hash.length > 0 && (path === "" || path === here);
  });
}

/*
  A screen's collections, and the one member of each worth opening.

  Every application of this kind has the same shape somewhere in it: a list of things,
  and a page per thing. The list is thirty-two tiles, the page is one project, and no
  amount of following hrefs finds the second — the tiles are buttons, the way rows in a
  table and messages in an inbox are buttons. A reading that stops at the list can only
  describe the product's furniture.

  The signal is repetition, and it needs no model: controls in the same part of the
  screen whose names open and close with the same words are the same control repeated
  over data. "Open panoma-monorepo's page — or double-click" and thirty-one siblings
  bucket together; "Favorites" and "Attention" do not. Three of a kind is a collection,
  and the FIRST is opened, once — a reading proves the page behind the list exists, it
  does not visit every row.
*/
function shapeKey(c: AtlasControl): string | null {
  if (c.refused || c.landmark === "banner" || c.landmark === "contentinfo" || c.landmark === "navigation") return null;
  const words = c.name.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return `${c.role}|${c.landmark ?? ""}|${words[0]}|${words[words.length - 1]}|${words.length}`;
}

const sameShape = (a: AtlasControl, b: AtlasControl): boolean => {
  const key = shapeKey(a);
  return key !== null && key === shapeKey(b);
};

function collections(controls: readonly AtlasControl[]): AtlasControl[] {
  const buckets = new Map<string, AtlasControl[]>();
  for (const c of controls) {
    const key = shapeKey(c);
    if (!key) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(c);
    else buckets.set(key, [c]);
  }
  return [...buckets.values()].filter((b) => b.length >= 3).map((b) => b[0]);
}

/** Same-origin destinations worth opening, in the order the page offers them, each with the link that offers it. */
function outLinks(snap: PageSnapshot, controls: AtlasControl[], origin: string): { path: string; name: string; selector: string }[] {
  const here = normalizeUrl(snap.url);
  const out: { path: string; name: string; selector: string }[] = [];
  for (const c of controls) {
    if (c.refused || c.role !== "link" || !c.href) continue;
    let u: URL;
    try {
      u = new URL(c.href, snap.url);
    } catch {
      continue;
    }
    if (u.origin !== origin || !/^https?:$/.test(u.protocol)) continue;
    if (normalizeUrl(u.toString()) === here) continue;
    out.push({ path: u.pathname + u.search, name: c.name, selector: c.selector });
  }
  return out;
}

/*
  The words of a request that are worth matching on.

  Short words and the grammar around them ("how", "the", "de", "los") match everything
  and rank nothing. What is left is the nouns — "projects", ".md", "files" — and the
  dotted and hyphenated tokens a product's own vocabulary is made of, which is why the
  split keeps a dot inside a word and drops one at the end of a sentence.
*/
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "how", "what", "with", "from", "my", "your", "me",
  "make", "create", "show", "tutorial", "about", "video", "app", "que", "de", "del", "la", "el", "los", "las", "un",
  "una", "como", "para", "por", "con", "en", "mi", "tus", "sus", "haz", "hacer", "crear", "video", "sobre",
]);

export function keywords(about: string): string[] {
  const words = about
    .toLowerCase()
    .split(/[^a-z0-9._\-]+/)
    .map((w) => w.replace(/^[.\-_]+|[.\-_]+$/g, (m, at: number) => (at === 0 && m === "." ? "." : "")))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return [...new Set(words)];
}

/** How much a name and an address have to do with the request: matched words, longest first. */
function relevance(text: string, words: readonly string[]): number {
  const hay = text.toLowerCase();
  let score = 0;
  for (const w of words) if (hay.includes(w)) score += w.length;
  return score;
}

export type ReadAtlasOptions = {
  url: string;
  name: string;
  /*
    What the reading is FOR, in the words of whoever asked.

    Without it the queue is the page's own order, which on a product with a fifteen-item
    navigation means fifteen screens of chrome before the first project. With it the
    queue is best-first: a link whose name or address shares words with the request is
    opened before one that does not, so a budget of a dozen screens is spent where the
    answer is. It only ORDERS — nothing is refused for being off-topic, because a route
    often runs through a screen the request never mentions.
  */
  about?: string;
  budget?: Partial<AtlasBudget>;
  colorScheme?: "light" | "dark";
  take?: SessionTake;
  /** Reuse a browser the caller already opened; one is launched and closed otherwise. */
  browser?: Browser;
  onProgress?: (message: string, done: number, total: number) => void;
};

/**
 * Read a running product and write down what it is made of.
 *
 * Deterministic in what it visits — the order is the page's own — and bounded by
 * three numbers, all of which appear in the result: a reading that ran out of budget
 * says which addresses it did not open, because a route planned on a partial map
 * should be able to say so rather than quietly teach the wrong thing.
 */
export async function readAtlas(opts: ReadAtlasOptions): Promise<Atlas> {
  const budget: AtlasBudget = { ...ATLAS_BUDGET, ...opts.budget };
  const origin = new URL(opts.url).origin;
  const atlas: Atlas = { name: opts.name, url: opts.url, createdAt: new Date().toISOString(), screens: [], unread: [] };
  const browser = opts.browser ?? (await launchBrowser());
  const owned = !opts.browser;
  const { context, page } = await openTake(browser, opts.take ?? DESKTOP_TAKE, opts.colorScheme ?? "dark");

  const words = opts.about ? keywords(opts.about) : [];
  type Waiting = { path: string; name: string; rank: number; via?: AtlasScreen["openedBy"] };
  const queue: Waiting[] = [{ path: pathOf(opts.url), name: "start", rank: Infinity }];
  const queued = new Set<string>([normalizeUrl(opts.url)]);
  /** Screens whose own controls have been pressed: a state is explored once. */
  const explored = new Set<string>();
  const shapes = new Map<string, number>();
  /* Best first when the reading has a subject; the page's own order when it does not. */
  /*
    Put an address in the queue, or raise the one already in it.

    The raise is not a detail. A page reached by pressing a control this reading chose
    is offered a second time, at a rank that puts it next — and the first offer usually
    came moments earlier from an ordinary link on the same screen, at the rank of every
    other link. Dropping the second offer as a duplicate is what left the page behind
    the list at the bottom of the queue and out of the budget, which is precisely the
    screen the reading was opened to find.
  */
  const offer = (link: { path: string; name: string }, boost = 0, via?: AtlasScreen["openedBy"]) => {
    const key = normalizeUrl(new URL(link.path, origin).toString());
    const rank = boost + (words.length > 0 ? relevance(`${link.name} ${link.path}`, words) : -queue.length);
    if (queued.has(key)) {
      const already = queue.find((q) => normalizeUrl(new URL(q.path, origin).toString()) === key);
      if (already && rank > already.rank) {
        already.rank = rank;
        /* The stronger reason brings its door with it: this is how the screen was actually reached. */
        if (via) already.via = via;
      }
      return;
    }
    const shape = pathShape(link.path);
    const seen = shapes.get(shape) ?? 0;
    if (seen >= budget.perShape) return;
    shapes.set(shape, seen + 1);
    queued.add(key);
    queue.push({ ...link, rank, ...(via ? { via } : {}) });
  };
  const nextUp = () => {
    let at = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].rank > queue[at].rank) at = i;
    return queue.splice(at, 1)[0];
  };

  try {
    while (queue.length > 0) {
      if (atlas.screens.length >= budget.screens) {
        atlas.unread.push(...queue.map((q) => q.path));
        break;
      }
      const next = nextUp();
      opts.onProgress?.(`reading ${next.path}`, atlas.screens.length, budget.screens);
      const address = new URL(next.path, origin).toString();
      const landed = await page
        .goto(address, { waitUntil: "domcontentloaded", timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!landed) continue;
      const snap = await settled(page);
      /*
        A screen reached twice — pressed from a list, then opened by its own address —
        is one screen, and the second arrival is what gets to explore it. `record`
        refuses the duplicate and the existing entry is used, which is also what makes
        the address the reading returns to between presses the right one.
      */
      const { screen } = record(atlas, snap, origin, next.via);
      if (explored.has(screen.id)) continue;
      explored.add(screen.id);

      const controls = screen.controls;
      /*
        What to press on this screen, and why pressing anything at all.

        A product's own surface is not made of links. Every tile in this catalogue is a
        `button` that opens a project, and a reading that only follows hrefs never sees a
        project page — it reads fifteen navigation destinations and reports that the
        product has no projects in it. So the reading presses too: the in-page views
        always, and, when it has a subject, the controls whose own names have something to
        do with it. Nothing on the destructive, external or chrome lists is ever pressed,
        and after each one the screen is reloaded, so the presses are independent and the
        product is left as it was found.
      */
      const openings = [...viewLinks(snap, controls)];
      for (const one of collections(controls)) if (!openings.includes(one)) openings.push(one);
      if (words.length > 0) {
        const matched = controls
          .filter((c) => !c.refused && !openings.includes(c) && relevance(`${c.name} ${c.href ?? ""}`, words) > 0)
          .sort((a, b) => relevance(`${b.name} ${b.href ?? ""}`, words) - relevance(`${a.name} ${a.href ?? ""}`, words));
        openings.push(...matched);
      }
      openings.sort((a, b) => relevance(`${b.name} ${b.href ?? ""}`, words) - relevance(`${a.name} ${a.href ?? ""}`, words));

      let opened = 0;
      for (const opening of openings) {
        if (opened >= budget.views || atlas.screens.length >= budget.screens) break;
        const after = await openView(page, opening.selector, snap, origin);
        opened++;
        if (after) {
          /*
            A press that went somewhere with an address of its own is a NAVIGATION, not a
            view: it is offered to the queue, at a rank that puts it next, and read on its
            own turn — which is the turn where its own views get pressed. Recording it in
            passing instead is what left the page behind a list recorded and never opened,
            with none of the views inside it seen, and the views were the point.
          */
          const path = pathOf(after.url).split("#")[0];
          if (path !== next.path.split("#")[0]) offer({ path, name: opening.name }, 1000, { from: screen.id, selector: opening.selector, name: opening.name });
          else {
            const view = record(atlas, after, origin, { from: screen.id, selector: opening.selector, name: opening.name });
            if (view.made) for (const link of outLinks(after, view.screen.controls, origin)) offer(link, 0, { from: view.screen.id, selector: link.selector, name: link.name });
          }
        }
        await page.goto(address, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
        await settle(page, 150);
      }

      /*
        A link is a door too. It used to be offered as a bare address, so every screen the
        navigation leads to arrived with no record of how anyone gets there — and a slate
        built from doors then saw only the parts of the product reached by pressing
        something in the page, which on a product with a fifteen-item navigation is a
        tenth of it.
      */
      for (const link of outLinks(snap, controls, origin)) offer(link, 0, { from: screen.id, selector: link.selector, name: link.name });
    }
  } finally {
    await context.close().catch(() => undefined);
    if (owned) await browser.close().catch(() => undefined);
  }
  return atlas;
}

/** Press a control and return what the page became, or null when it became nothing this reading may keep. */
async function openView(page: Page, selector: string, before: PageSnapshot, origin: string): Promise<PageSnapshot | null> {
  const clicked = await page
    .locator(selector)
    .first()
    .click({ timeout: 2500 })
    .then(() => true)
    .catch(() => false);
  if (!clicked) return null;
  const after = await settled(page);
  /* A press that left the product is not a screen of it; the caller reloads either way. */
  if (new URL(page.url()).origin !== origin) return null;
  return after.hash === before.hash ? null : after;
}

/**
 * The atlas as the paragraph a route is planned on.
 *
 * A brain reads this, not the JSON: the ids are hashes and the boxes are pixels, and
 * neither belongs in a question about which screen a lesson lives on. What survives
 * is what a person would use to answer the same question — where each screen is, what
 * it is called, what it says, and what can be pressed on it, by name.
 */
/**
 * The atlas as the paragraph a route is planned on.
 *
 * A brain reads this, not the JSON: the ids are hashes and the boxes are pixels, and
 * neither belongs in a question about which screen a lesson lives on. What survives
 * is what a person would use to answer the same question — where each screen is, what
 * it is called, what it says, and what can be pressed on it, by name.
 */
export function atlasText(atlas: Atlas, opts: { controls?: number; text?: number } = {}): string {
  const controlCap = opts.controls ?? 24;
  const textCap = opts.text ?? 420;
  /*
    The furniture, said once.

    A control that is on every screen is the product's chrome — its navigation, its
    account menu, its language switch — and repeating fifteen of them under every
    screen is most of the page count and none of the information. Named once at the
    top, where a reader (or a brain planning a route) can see that they are always
    available, and left out of the screens.
  */
  const everywhere =
    atlas.screens.length >= 3
      ? atlas.screens[0].controls.filter(
          (c) => !c.refused && atlas.screens.every((s) => s.controls.some((o) => o.selector === c.selector)),
        )
      : [];
  const shared = new Set(everywhere.map((c) => c.selector));
  const where = new Map(atlas.screens.map((s) => [s.id, s.path]));
  const screens = atlas.screens.map((s) => {
    const door = s.openedBy ? ` · reached by pressing "${s.openedBy.name}" on ${where.get(s.openedBy.from) ?? "the screen before"}` : "";
    /*
      A list of thirty-two projects is one control repeated over data, and printing all
      of it is how a reading of eight screens becomes a wall nobody can plan a route on.
      The first stands for the rest and says how many there are — which is also the
      truth a route needs: press this one, or any of them.
    */
    const repeated = new Map(collections(s.controls).map((c) => [c.selector, s.controls.filter((o) => sameShape(o, c)).length]));
    const shapes = new Set<string>();
    const controls = s.controls
      .filter((c) => !c.refused && !shared.has(c.selector))
      .filter((c) => {
        const key = shapeKey(c);
        if (!key || !repeated.has(c.selector)) return !key || !shapes.has(key) ? (key && shapes.add(key), true) : false;
        if (shapes.has(key)) return false;
        shapes.add(key);
        return true;
      })
      .slice(0, controlCap)
      .map((c) => {
        const many = repeated.get(c.selector);
        return `      - ${c.role} "${c.name}"${c.href ? ` → ${c.href}` : ""}${many && many > 1 ? ` (and ${many - 1} more of the same shape)` : ""}`;
      })
      .join("\n");
    return [
      `  screen ${s.path}${door}`,
      s.heading ? `    heading: ${s.heading}` : "",
      s.sections.length > 0 ? `    sections: ${s.sections.join(" · ")}` : "",
      s.text ? `    says: ${clip(s.text, textCap)}` : "",
      controls ? `    controls:\n${controls}` : "    controls: none of its own",
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    everywhere.length > 0 ? `  on every screen: ${everywhere.map((c) => `${c.role} "${c.name}"`).join(" · ")}` : "",
    ...screens,
  ]
    .filter(Boolean)
    .join("\n\n");
}
