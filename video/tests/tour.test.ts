/*
  The tour writes a recording script from a running product with no model in the
  loop, so what it must never do is the thing to test: click a destructive verb,
  fork the step list between takes, lose a mark, or emit a selector the recorder
  cannot resolve. The fixture is a small landing site served by node:http — a
  banner with a navigation that folds into a Menu button on the phone layout, a
  cookie banner, three sections, a hero CTA, a "Delete account" link, and two more
  pages reachable from it.
*/
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { DESKTOP_TAKE, MOBILE_TAKE, type SessionStep } from "@panoma/video-capture";
import {
  DESTRUCTIVE,
  fromUserFlow,
  isDestructive,
  matchLexicon,
  parseRoleSelector,
  parseSnapshot,
  roleSelector,
  scoreCandidates,
  sectionAnchors,
  slugify,
  stateHash,
  toUserFlow,
  tourSummary,
  verbOf,
  writeTour,
  launchBrowser,
  openTake,
  type TourScript,
} from "@panoma/video-tour";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "tour");

function serve(): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
    const path = (req.url ?? "/") === "/" ? "/index.html" : (req.url ?? "/");
    try {
      const body = await readFile(join(FIXTURES, path.replace(/^\//, "")));
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end("not here");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

const selectorOf = (s: SessionStep): string | null => ("clickOn" in s ? s.clickOn : "scrollTo" in s ? s.scrollTo : null);
const nameOf = (selector: string): string => parseRoleSelector(selector)?.name ?? selector;

describe("snapshot", async () => {
  const text = await readFile(join(FIXTURES, "landing.snapshot.txt"), "utf8");

  test("parses roles, names, levels, boxes, urls and the nearest landmark", () => {
    const nodes = parseSnapshot(text);
    const h1 = nodes.find((n) => n.role === "heading" && n.level === 1);
    assert.equal(h1?.name, "Every project on your disk, in one place");
    assert.equal(h1?.landmark, "main");
    assert.ok(h1?.box && h1.box.w > 1000);
    const docs = nodes.find((n) => n.role === "link" && n.name === "Docs");
    assert.equal(docs?.landmark, "navigation");
    assert.equal(docs?.url, "/docs.html");
    assert.equal(docs?.cursorPointer, true);
    assert.ok(docs?.ref?.startsWith("e"));
    const privacy = nodes.find((n) => n.name === "Privacy");
    assert.equal(privacy?.landmark, "contentinfo");
    const accept = nodes.find((n) => n.name === "Accept");
    assert.equal(accept?.role, "button");
    assert.equal(accept?.landmark, undefined);
  });

  test("scrollY turns viewport boxes into document boxes", () => {
    const [a] = parseSnapshot(text).filter((n) => n.name === "Docs");
    const [b] = parseSnapshot(text, { scrollY: 500 }).filter((n) => n.name === "Docs");
    assert.equal(b.box!.y, a.box!.y + 500);
  });

  test("the state hash ignores refs, boxes, focus and cursor", () => {
    const a = parseSnapshot(text);
    const stripped = text
      .replace(/ \[ref=e\d+\]/g, "")
      .replace(/ \[box=[^\]]+\]/g, "")
      .replace(/ \[active\]/g, "")
      .replace(/ \[cursor=pointer\]/g, "");
    assert.notEqual(stripped, text);
    assert.equal(stateHash(parseSnapshot(stripped)), stateHash(a));
    const renamed = text.replace('link "Docs"', 'link "Guides"');
    assert.notEqual(stateHash(parseSnapshot(renamed)), stateHash(a));
  });

  test("names with quotes survive the selector round trip", () => {
    for (const name of ['Say "hi" there', "It's ok", "plain"]) {
      const sel = roleSelector("heading", name, 2);
      assert.deepEqual(parseRoleSelector(sel), { role: "heading", name, level: 2 });
    }
    assert.equal(parseRoleSelector("text=Docs"), null);
  });

  test("slugs are readable and bounded", () => {
    assert.equal(slugify("Discover what is on the disk"), "discover-what-is-on-the-disk");
    assert.equal(slugify("Déjà vu: the café"), "deja-vu-the-cafe");
    assert.ok(slugify("A heading that runs on and on and on and on and on and on").length <= 40);
    assert.equal(slugify("!!!"), "section");
  });
});

describe("lexicon and scoring", async () => {
  const text = await readFile(join(FIXTURES, "landing.snapshot.txt"), "utf8");
  const nodes = parseSnapshot(text);

  test("a control that hands the work to another application is never clicked", () => {
    /*
      Found by filming a real product: the walk clicked "Open in Claude" on someone's
      live catalog and launched an agent on their machine. "Open" is one of the
      strongest verbs there is, and the button is neither destructive nor chrome.
    */
    const nodes = parseSnapshot(
      `- main:\n  - button "Open in Claude" [cursor=pointer] [box=10,10,180,40]\n  - button "Reveal in Finder" [cursor=pointer] [box=10,60,180,40]\n  - button "Open the catalog" [cursor=pointer] [box=10,110,180,40]`,
    );
    const ranked = scoreCandidates(nodes, { viewport: { width: 1280, height: 800 }, origin: "http://x", pageUrl: "http://x/" });
    const byName = (n: string) => ranked.find((c) => c.description.includes(n))!;
    assert.equal(byName("Open in Claude").score, 0);
    assert.match(byName("Open in Claude").reasons.join(" "), /another application/);
    assert.equal(byName("Reveal in Finder").score, 0);
    /* And a control that merely says "open" about the product is still a call to action. */
    assert.ok(byName("Open the catalog").score > 0);
  });

  test("a destructive verb is never outranked by a verb", () => {
    assert.equal(isDestructive("Add and pay"), "pay");
    assert.equal(verbOf("Get started"), "get started");
    assert.equal(isDestructive("Get started"), null);
    assert.equal(matchLexicon("Started", DESTRUCTIVE), null);
    assert.equal(isDestructive("Delete account"), "delete");
    assert.equal(isDestructive("Log out"), "log out");
  });

  test("the hero CTA ranks first and destructive links score zero with a reason", () => {
    const ranked = scoreCandidates(nodes, { viewport: DESKTOP_TAKE.viewport, origin: "http://x", pageUrl: "http://x/" });
    assert.equal(nameOf(ranked[0].selector), "Get started");
    assert.ok(ranked[0].reasons.some((r) => r.startsWith('verb "get started"')));
    for (const name of ["Delete account", "Buy now", "Subscribe"]) {
      const c = ranked.find((x) => nameOf(x.selector) === name);
      assert.equal(c?.score, 0, name);
      assert.match(c!.reasons[0], /never clicked/);
    }
    const signIn = ranked.find((x) => nameOf(x.selector) === "Sign in");
    assert.match(signIn!.reasons[0], /chrome/);
  });

  test("section anchors are the h2s in main, minus the page's own heading", () => {
    assert.deepEqual(
      sectionAnchors(nodes).map((n) => n.name),
      ["Discover what is on the disk", "Health at a glance", "Agents that know the house rules"],
    );
  });
});

describe("DevTools Recorder flow", () => {
  test("every step kind round-trips through the Recorder JSON", () => {
    const steps: SessionStep[] = [
      { goto: "http://x/", settleMs: 900 },
      { clickOn: 'role=button[name="Reject"s]', optional: true, role: "chrome" },
      { pause: 500 },
      { pause: 2600, settled: true },
      { mark: "hero" },
      { scrollTo: 'role=heading[name="Health"s][level=2]', at: 0.26, ms: 1100 },
      { scrollTo: 'role=link[name="Get started"s]', at: 0.4, ms: 1100, back: true },
      { clickOn: 'role=link[name="Get started"s]' },
      { scroll: { y: 300, ms: 500 }, role: "chrome" },
      { move: { x: 10, y: 20, ms: 100 } },
      { click: { x: 5, y: 6 }, role: "product" },
      { press: { key: "Enter" }, role: "chrome" },
      { type: { text: "hi" }, role: "chrome" },
    ];
    const script = { name: "t", steps, marks: [{ name: "hero", label: "Hero", kind: "hero" as const }], candidates: [] };
    const flow = toUserFlow(script);
    assert.equal(flow.title, "t");
    const click = flow.steps.find((s) => s.type === "click" && !("engine" in s));
    assert.deepEqual((click as { selectors: string[] }).selectors, ['aria/Get started[role="link"]', "text/Get started"]);
    assert.deepEqual(fromUserFlow(JSON.parse(JSON.stringify(flow))), steps);
  });

  test("a flow recorded in Chrome becomes steps the recorder understands", () => {
    const steps = fromUserFlow({
      title: "recorded",
      steps: [
        { type: "setViewport", width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: false },
        { type: "navigate", url: "http://x/", assertedEvents: [{ type: "navigation", url: "http://x/" }] },
        { type: "click", selectors: [["#root", "aria/Get started[role=\"link\"]"], "text/Get started", "#cta"], offsetX: 3, offsetY: 4 },
        { type: "click", selectors: ["#only-css"], offsetX: 1, offsetY: 1 },
        { type: "scroll", selectors: ["aria/Pricing"] },
        { type: "waitForExpression", expression: "new Promise((resolve) => setTimeout(() => resolve(true), 700))" },
        { type: "customStep", name: "mark", parameters: { name: "end" } },
      ],
    });
    assert.deepEqual(steps, [
      { goto: "http://x/" },
      { clickOn: 'role=link[name="Get started"s]' },
      { clickOn: "#only-css" },
      { scrollTo: "text=Pricing" },
      { pause: 700 },
      { mark: "end" },
    ]);
  });
});

describe("writeTour on the fixture site", () => {
  let server: Server;
  let url: string;
  let script: TourScript;

  before(async () => {
    ({ server, url } = await serve());
    script = await writeTour({ url, name: "lantern" });
  });
  after(() => server.close());

  test("marks come in tour order: hero, sections, cta, the pages it leads to, the navigation", () => {
    assert.deepEqual(
      script.marks.map((m) => m.name),
      [
        "hero",
        "discover-what-is-on-the-disk",
        "health-at-a-glance",
        "agents-that-know-the-house-rules",
        "cta",
        "install",
        "first-run",
        "cta-2",
        "projects",
        "pricing",
      ],
    );
    assert.deepEqual(
      script.marks.map((m) => m.kind),
      ["hero", "section", "section", "section", "cta", "section", "section", "cta", "section", "flow"],
    );
    const inSteps = script.steps.filter((s) => "mark" in s).map((s) => (s as { mark: string }).mark);
    assert.deepEqual(inSteps, script.marks.map((m) => m.name));
    assert.equal(new Set(inSteps).size, inSteps.length);
    assert.equal(script.steps.filter((step) => "pause" in step && step.settled).length, script.marks.length, "each product mark records a settled reading window");
    for (const m of script.marks) assert.ok(m.target && m.target.w > 0, `${m.name} has a target box`);
  });

  test("a step that changed the page records what the page became", () => {
    /*
      The walk already proves a click did something — it refuses to mark one that
      changed nothing — and it used to throw the proof away. Kept, it is the second
      half of a narrated sentence: "click this, and THAT opens", where "that" is the
      page's own heading and the page is the source.
    */
    const acted = script.marks.filter((m) => m.kind === "cta" || m.kind === "flow");
    assert.ok(acted.length >= 2);
    for (const m of acted) {
      assert.ok(m.outcome, `${m.name} landed somewhere and says where`);
      assert.ok((m.outcome!.heading ?? "").length > 0, `${m.name} carries the heading the page showed`);
      assert.match(m.outcome!.route ?? "", /^\//);
    }
    /* The fixture's calls to action lead to the docs and then the catalog; the nav link to pricing. */
    assert.deepEqual(
      acted.map((m) => m.outcome!.heading),
      ["Getting started", "Catalog", "Pricing"],
    );
    /* A scroll to a heading changed nothing, so it claims nothing. */
    for (const m of script.marks.filter((m) => m.kind === "section" || m.kind === "hero")) {
      assert.equal(m.outcome, undefined, `${m.name} is a scroll and has no outcome to claim`);
    }
  });

  test("consent is dismissed with the privacy-preserving button, as optional chrome", () => {
    const consent = script.steps.find((s) => "clickOn" in s && s.role === "chrome");
    assert.ok(consent && "clickOn" in consent);
    assert.equal(nameOf(consent.clickOn), "Reject");
    assert.equal(consent.optional, true);
    assert.ok(script.steps.indexOf(consent) < script.steps.findIndex((s) => "mark" in s));
  });

  test("nothing destructive is ever clicked, and the refusal is recorded", () => {
    for (const s of script.steps) {
      if (!("clickOn" in s)) continue;
      assert.equal(isDestructive(nameOf(s.clickOn)), null, s.clickOn);
    }
    for (const name of ["Delete account", "Buy now", "Subscribe", "Purchase"]) {
      assert.ok(!script.steps.some((s) => "clickOn" in s && nameOf(s.clickOn) === name), `${name} is not clicked`);
    }
    const del = script.candidates.find((c) => nameOf(c.selector) === "Delete account");
    assert.equal(del?.score, 0);
    assert.match(del!.reasons[0], /never clicked: "delete"/);
    assert.ok(!script.steps.some((s) => "type" in s || "press" in s), "never types");
  });

  test("budgets hold: at most 12 marks and 6 product actions, hero first", () => {
    assert.ok(script.marks.length <= 12);
    assert.ok(script.marks.filter((m) => m.kind === "cta").length <= 6);
    assert.equal(script.marks[0].kind, "hero");
  });

  test("a control with no name on a take is found by where it goes", () => {
    /*
      Measured on a real application: a phone's navigation is a row of icons, and the
      link to /bridge is still a link to /bridge — it just carries no accessible name,
      so a selector built from the desktop's name matches nothing. Left there, the
      vertical cut narrated three instructions over a picture that never moved. The
      destination travels with the step for exactly this.
    */
    const clicks = script.steps.filter((s): s is { clickOn: string; href?: string } => "clickOn" in s);
    const nav = clicks.find((s) => s.clickOn.includes("Pricing"));
    assert.ok(nav, "the navigation link is a click step");
    assert.equal(nav!.href, "/pricing.html", "and it carries where it goes");
    /* It survives the Recorder round trip, or the shared list loses it on the way back in. */
    const back = fromUserFlow(JSON.parse(JSON.stringify(script.flow))).filter((s): s is { clickOn: string; href?: string } => "clickOn" in s);
    assert.equal(back.find((s) => s.clickOn.includes("Pricing"))?.href, "/pricing.html");
    /* A call to action inside the page is identified by its name, not by a destination it may not have. */
    assert.equal(clicks.find((s) => s.clickOn.includes("Get started"))?.href, undefined);
  });

  test("the mobile re-walk keeps one step list: the menu opens as optional chrome before the folded nav link", () => {
    const pricing = script.steps.findIndex((s) => "clickOn" in s && nameOf(s.clickOn) === "Pricing");
    assert.ok(pricing > 0);
    const before = script.steps.slice(0, pricing);
    const menu = before.findLastIndex((s) => "clickOn" in s && nameOf(s.clickOn) === "Menu");
    assert.ok(menu > 0, "a Menu chrome step precedes the Pricing click");
    const step = script.steps[menu] as { clickOn: string; optional?: boolean; role?: string };
    assert.equal(step.role, "chrome");
    assert.equal(step.optional, true);
    /* The Pricing link itself is not optional: with the menu open it exists on both takes. */
    assert.equal((script.steps[pricing] as { optional?: boolean }).optional, undefined);
  });

  test("every selector resolves under the recorder's own conditions, on both takes", async () => {
    const browser = await launchBrowser();
    try {
      for (const take of [DESKTOP_TAKE, MOBILE_TAKE]) {
        const { context, page } = await openTake(browser, take, "dark");
        for (const s of script.steps) {
          if ("goto" in s) {
            await page.goto(s.goto, { waitUntil: "networkidle" });
            continue;
          }
          const selector = selectorOf(s);
          if (!selector) continue;
          const box = await page
            .locator(selector)
            .first()
            .boundingBox({ timeout: 2000 })
            .catch(() => null);
          if (!box) {
            assert.equal((s as { optional?: boolean }).optional, true, `${take.id}: "${selector}" is missing and not optional`);
            continue;
          }
          assert.ok((await page.locator(selector).count()) >= 1);
          if ("clickOn" in s) {
            await page.locator(selector).first().click();
            await page.waitForLoadState("networkidle").catch(() => undefined);
          } else {
            await page.locator(selector).first().scrollIntoViewIfNeeded();
          }
        }
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });

  test("the DevTools flow round-trips and the snapshot is the landing page", () => {
    assert.deepEqual(fromUserFlow(JSON.parse(JSON.stringify(script.flow))), script.steps);
    assert.equal(script.flow.title, "lantern");
    assert.match(script.snapshot, /heading "Every project on your disk, in one place" \[level=1\]/);
    assert.equal(script.url, url);
  });

  test("the summary reads as English and names what was skipped", () => {
    const text = tourSummary(script);
    assert.match(text, /Marks in the script .*: 10\./);
    assert.match(text, /Get started.*clicked as mark "cta"/);
    assert.match(text, /Delete account.*never clicked/);
    assert.match(text, /menu button on the mobile take/);
  });
});

describe("what a click revealed, when it did not navigate", () => {
  /*
    The page's own heading is only the answer when the click CHANGED it. A button
    that reveals a panel leaves the h1 exactly where it was, so the walk falls back to
    the first heading that was not there a moment ago — and that fallback ignores the
    site's chrome, or a promo bar in the banner would beat the thing the click
    actually produced.
  */
  const PAGE = `<!doctype html><html lang="en"><head><title>Reveal</title></head><body>
<header><h2>Summer sale: everything must go</h2><nav aria-label="Main"><a href="/">Home</a></nav></header>
<main><h1>Your catalog</h1>
<button onclick="document.getElementById('p').hidden=false">Open catalog</button>
<section id="p" hidden><h2>Project memory</h2><p>What the disk remembers.</p></section>
</main><footer><h2>Legal notices</h2></footer></body></html>`;

  test("the answer is the heading that is new, and never the site's own furniture", async () => {
    const server = createServer((_req, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(PAGE);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const { port } = server.address() as { port: number };
    try {
      const script = await writeTour({ url: `http://127.0.0.1:${port}/`, name: "reveal", budget: { steps: 6, ctas: 1, pages: 2 } });
      const cta = script.marks.find((m) => m.kind === "cta");
      assert.ok(cta, "the button that changed the page earned a mark");
      assert.equal(cta!.outcome?.heading, "Project memory", "the panel it opened, not the h1 it left alone");
      assert.equal(cta!.outcome?.route, undefined, "nothing navigated, so nothing landed anywhere");
    } finally {
      server.close();
    }
  });
});

describe("writeTour budgets", () => {
  test("a smaller budget clips sections and calls to action, hero still first", async () => {
    const { server, url } = await serve();
    try {
      const script = await writeTour({ url, name: "short", budget: { steps: 6, ctas: 1 } });
      assert.equal(script.marks.length, 6);
      assert.equal(script.marks[0].name, "hero");
      assert.equal(script.marks.filter((m) => m.kind === "cta").length, 1);
      /* With one CTA allowed, the second page is never scored: the runner-up on the first page says why it lost. */
      const runnerUp = script.candidates.find((c) => c.reasons.includes("not clicked: an earlier candidate on this page was clicked first"));
      assert.ok(runnerUp, "the runner-up carries its reason");
      assert.match(tourSummary(script), /Marks in the script .*: 6\./);
    } finally {
      server.close();
    }
  });
});

describe("writeTour with a re-ranker", () => {
  let server: Server;
  let url: string;

  before(async () => {
    ({ server, url } = await serve());
  });
  after(() => server.close());

  test("the brain's order is tried first and stays on the record; what the scorer refused for what it is stays refused", async () => {
    const seen: { url: string; offered: string[] }[] = [];
    const script = await writeTour({
      url,
      name: "lantern-brain",
      budget: { steps: 6, ctas: 1, pages: 2 },
      /* A word the English lexicon does not have, as a brain would supply for an interface in another language. */
      verbs: ["pricing"],
      rerank: async (input) => {
        seen.push({ url: input.page.url, offered: input.candidates.map((c) => c.description) });
        const pricing = input.candidates.find((c) => c.description.includes('"See pricing"'));
        /* 999 names nobody; a destructive link is never offered, so it cannot be named by index either. */
        return { order: pricing ? [999, pricing.i] : [], why: "The pricing page is where the product explains itself." };
      },
    });
    assert.ok(seen.length >= 1, "the re-ranker was asked on the landing page");
    assert.ok(seen[0].offered.some((d) => d.includes("Get started")), "the scorer's own first choice is on offer");
    assert.ok(!seen[0].offered.some((d) => d.includes("Delete account")), "a destructive link is not on offer");
    const cta = script.marks.find((m) => m.kind === "cta");
    assert.equal(cta?.label, "See pricing", "the brain's choice was clicked instead of the scorer's");
    const chosen = script.candidates.find((c) => c.description.includes('"See pricing"'));
    assert.ok(chosen, "the brain's choice is among the recorded candidates");
    assert.ok(chosen?.reasons.some((r) => r === "brain: ranked #1 — The pricing page is where the product explains itself."), chosen?.reasons.join(" | "));
    assert.ok(chosen?.reasons.some((r) => r.startsWith('verb "pricing"')), "a verb the brain supplied earns the scorer's bonus");
    assert.ok(!script.marks.some((m) => /delete/i.test(m.label)), "nothing destructive was clicked");
  });
});

describe("what a click did is measured against the instant before it", () => {
  let server: Server;
  let url: string;

  before(async () => {
    ({ server, url } = await serve());
  });
  after(() => server.close());

  /*
    The scar. On a real product the walk approached a destination button, Playwright
    reported it could not be clicked, the application had moved to that destination
    anyway, and the NEXT click — an unrelated toggle — was recorded as having produced
    the heading the failed attempt left behind. That became a fact with a source, and
    from there a sentence the film spoke aloud: "click this and the heading changes to
    Marte", true of nothing. The audit could not catch it, because the audit checks
    provenance and not causation.

    The fixture reproduces the shape deterministically: the top-ranked control changes
    a heading on mouseenter and removes itself, so the pointer alone moves the page and
    the click then fails. Whatever the second click is credited with, it must not be
    the ghost's heading.
  */
  test("a heading left behind by a failed attempt is never credited to the click that follows", async () => {
    const script = await writeTour({ url: `${url}ghost.html`, name: "ghost", budget: { steps: 6, ctas: 2, pages: 1 } });
    const ghost = script.candidates.find((c) => nameOf(c.selector) === "Launch the journey");
    assert.ok(ghost, "the vanishing control was ranked");
    assert.match(ghost!.reasons.join(" "), /not clicked: could not be clicked/, "and the walker knows it never clicked it");

    const acted = script.marks.filter((m) => m.kind === "cta" || m.kind === "flow");
    assert.ok(acted.length >= 1, `the second control was still filmed: ${JSON.stringify(script.marks.map((m) => m.label))}`);
    for (const m of acted) {
      assert.notEqual(m.outcome?.heading, "Andromeda", `${m.name} was credited with a heading its click did not produce`);
    }
    const panel = acted.find((m) => m.label === "Open the panel");
    assert.ok(panel, "the panel button is the one that was clicked");
    /* And what it DID produce is still recorded: the fix must not cost the honest half. */
    assert.equal(panel!.outcome?.heading, "Your panel");
  });
});
