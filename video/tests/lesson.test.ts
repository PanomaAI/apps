/*
  A lesson is a route through a product, planned from a reading of it and proved in a
  browser before a frame is shot. Two things must hold whatever the product is: it has
  to REACH the thing that was asked about — through a list, through a tab strip, past a
  navigation whose words happen to match the request — and it must never press anything
  that acts on somebody's machine.

  The fixture is a small application, not a landing page: a catalogue of four projects
  as buttons (the shape no href-following reading can see), a project page whose
  sections are switched by same-page anchors (the shape the walker refuses by design),
  and inside it a "Delete project" and a "Reveal in Finder" that must survive untouched.
*/
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { DESKTOP_TAKE } from "@panoma/video-capture";
import {
  atlasText,
  isDestructive,
  keywords,
  lessonSummary,
  LESSON_HOLD_MS,
  noTutorialBecause,
  pathShape,
  readAtlas,
  routeFromWords,
  slateOf,
  slateText,
  SLATE_FLOOR,
  writeLesson,
  type Atlas,
} from "@panoma/video-tour";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "lesson");

function serve(): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const file = path === "/" ? "index.html" : path.replace(/^\//, "");
    try {
      const body = await readFile(join(FIXTURES, file));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

describe("the words of a request", () => {
  test("keeps the nouns and the product's own vocabulary", () => {
    const words = keywords("créame un tutorial de cómo administrar los archivos .md de los proyectos");
    assert.ok(words.includes(".md"), "a dotted token is one word");
    assert.ok(words.includes("archivos"));
    assert.ok(!words.includes("de"), "grammar matches everything and ranks nothing");
    assert.ok(!words.includes("tutorial"), "the word 'tutorial' is the request's form, not its subject");
  });

  test("a path's shape collapses what varies", () => {
    assert.equal(pathShape("/p/alpha"), "/p/*");
    assert.equal(pathShape("/p/beta"), "/p/*");
    assert.equal(pathShape("/settings"), "/settings");
    assert.equal(pathShape("/"), "/");
  });
});

describe("the route, from a reading", () => {
  const atlas: Atlas = {
    name: "ledger",
    url: "http://127.0.0.1:1/",
    createdAt: "2026-09-04T00:00:00.000Z",
    unread: [],
    screens: [
      {
        id: "home",
        path: "/",
        heading: "Your projects",
        sections: [],
        text: "Four of them",
        order: 0,
        signals: { fields: 0, password: false },
        controls: [
          { selector: 'role=link[name="Settings"s]', role: "link", name: "Settings", box: { x: 0, y: 0, w: 10, h: 10 }, landmark: "navigation", href: "/settings.html" },
          { selector: 'role=button[name="Open alpha’s page"s]', role: "button", name: "Open alpha’s page", box: { x: 0, y: 100, w: 320, h: 60 } },
        ],
      },
      {
        id: "project",
        path: "/p/alpha.html",
        heading: "alpha",
        sections: ["The notes your agents read", "Files on this disk"],
        text: "Nine notes. Eleven files.",
        order: 1,
        signals: { fields: 0, password: false },
        openedBy: { from: "home", selector: 'role=button[name="Open alpha’s page"s]', name: "Open alpha’s page" },
        controls: [
          { selector: 'role=link[name="Settings"s]', role: "link", name: "Settings", box: { x: 0, y: 0, w: 10, h: 10 }, landmark: "navigation", href: "/settings.html" },
          { selector: 'role=link[name="The notes"s]', role: "link", name: "The notes", box: { x: 0, y: 60, w: 80, h: 20 }, href: "/p/alpha.html#notes" },
        ],
      },
      {
        id: "notes",
        path: "/p/alpha.html#notes",
        heading: "alpha",
        sections: ["The notes your agents read"],
        text: "Nine notes, and two of them contradict the code.",
        order: 2,
        signals: { fields: 0, password: false },
        openedBy: { from: "project", selector: 'role=link[name="The notes"s]', name: "The notes" },
        controls: [
          { selector: 'role=link[name="Settings"s]', role: "link", name: "Settings", box: { x: 0, y: 0, w: 10, h: 10 }, landmark: "navigation", href: "/settings.html" },
          { selector: 'role=button[name="Check the notes"s]', role: "button", name: "Check the notes", box: { x: 0, y: 200, w: 120, h: 30 } },
          { selector: 'role=button[name="Delete project"s]', role: "button", name: "Delete project", box: { x: 0, y: 260, w: 120, h: 30 }, refused: "on the destructive list" },
        ],
      },
    ],
  };

  test("walks the doors to the screen the request is about", () => {
    const route = routeFromWords(atlas, "how to manage the notes my agents read in a project");
    assert.equal(route.by, "words");
    assert.equal(route.on, "/p/alpha.html");
    assert.deepEqual(
      route.steps.filter((s) => (s.kind ?? "press") === "press").map((s) => s.control),
      ["Open alpha’s page", "The notes"],
      "the route is the chain of doors the reading recorded, in order",
    );
  });

  test("never leaves the lesson for a navigation the request happens to name", () => {
    const route = routeFromWords(atlas, "the settings of the notes");
    assert.ok(!route.steps.some((s) => s.control === "Settings"), "a control on every screen is furniture, not a step");
  });

  test("reads the screen instead of pressing what it cannot judge", () => {
    const route = routeFromWords(atlas, "how to manage the notes my agents read in a project");
    const shows = route.steps.filter((s) => s.kind === "show").map((s) => s.control);
    assert.ok(shows.length > 0, "a lesson teaches what a panel says, not only what to click");
    assert.ok(
      !route.steps.some((s) => (s.kind ?? "press") === "press" && s.control === "Check the notes"),
      "without a brain to weigh consequences, nothing is pressed on the strength of a string match",
    );
  });

  test("the reading reads as a document, with the furniture said once", () => {
    const text = atlasText(atlas);
    assert.match(text, /on every screen: .*"Settings"/, "a control on every screen is named once, at the top");
    assert.equal(text.split('link "Settings"').length - 1, 1, "and never again under a screen");
    assert.match(text, /reached by pressing "Open alpha’s page" on \//);
  });
});

describe("what is worth teaching, when nobody says", () => {
  const atlas: Atlas = {
    name: "ledger",
    url: "http://127.0.0.1:1/",
    createdAt: "2026-09-04T00:00:00.000Z",
    unread: [],
    screens: [
      {
        id: "home",
        path: "/",
        heading: "Your projects",
        sections: ["A", "B", "C", "D"],
        text: "Four of them.",
        order: 0,
        signals: { fields: 0, password: false },
        controls: [],
      },
      {
        id: "notes",
        path: "/p/alpha.html#notes",
        heading: "The notes your agents read",
        sections: [],
        text: "Nine notes. Are they still true?",
        order: 1,
        openedBy: { from: "project", selector: 'role=link[name="The notes"s]', name: "The notes" },
        controls: [],
        signals: { fields: 0, password: false },
      },
      {
        id: "project",
        path: "/p/alpha.html",
        heading: "alpha",
        sections: ["A", "B", "C", "D"],
        text: "Everything about alpha.",
        order: 2,
        openedBy: { from: "home", selector: 'role=button[name="Open alpha"s]', name: "Open alpha" },
        controls: [],
        signals: { fields: 0, password: false },
      },
      {
        id: "settings",
        path: "/settings.html",
        heading: "Settings",
        sections: [],
        text: "Where the disk is.",
        order: 3,
        openedBy: { from: "home", selector: 'role=link[name="Settings"s]', name: "Settings" },
        controls: [],
        signals: { fields: 0, password: false },
      },
    ],
  };

  test("a screen reached by pressing something outranks a place you navigate to", () => {
    const slate = slateOf(atlas);
    const notes = slate.find((c) => c.path.endsWith("#notes"))!;
    const settings = slate.find((c) => c.path === "/settings.html")!;
    assert.ok(notes.score > settings.score, `${notes.score} should beat ${settings.score}: one is an action, the other is a place`);
    assert.ok(notes.terms.payoff > settings.terms.payoff);
  });

  test("a well-written screen does not outrank one that teaches something", () => {
    /* The copywriting is read for the angle and never for the ranking. */
    const plain = { ...atlas.screens[1], id: "plain", path: "/p/alpha.html#plain", heading: "Files", text: "Eleven files." };
    const both = slateOf({ ...atlas, screens: [...atlas.screens, plain] });
    const asking = both.find((c) => c.id === "notes")!;
    const flat = both.find((c) => c.id === "plain")!;
    assert.equal(asking.score, flat.score, "two screens of the same shape score the same however they are written");
    assert.equal(asking.angle, "objection");
    assert.notEqual(flat.angle, "objection");
  });

  test("the screen the reading started on is not a candidate: there is no lesson in arriving", () => {
    assert.ok(!slateOf(atlas).some((c) => c.path === "/"));
  });

  test("a screen that asks a question is framed as the question it asks", () => {
    const notes = slateOf(atlas).find((c) => c.path.endsWith("#notes"))!;
    assert.equal(notes.angle, "objection");
    assert.match(notes.evidence ?? "", /Are they still true\?/);
  });

  test("a route that has to press something refused is not a candidate at all", () => {
    const dangerous: Atlas = {
      ...atlas,
      screens: atlas.screens.map((s) =>
        s.id === "notes" ? { ...s, openedBy: { ...s.openedBy!, name: "Delete the notes" } } : s,
      ),
    };
    assert.ok(isDestructive("Delete the notes"), "the fixture only tests the rule if the lexicon refuses this");
    assert.ok(!slateOf(dangerous).some((c) => c.path.endsWith("#notes")));
  });

  test("the slate is a menu, not the same page ten times", () => {
    const many: Atlas = {
      ...atlas,
      screens: [
        ...atlas.screens,
        ...["#a", "#b", "#c", "#d"].map((hash, i) => ({
          id: `v${i}`,
          path: `/p/alpha.html${hash}`,
          heading: `View ${i}`,
          sections: [],
          text: "Something.",
          order: 10 + i,
          openedBy: { from: "project", selector: `role=link[name="V${i}"s]`, name: `V${i}` },
          controls: [],
          signals: { fields: 0, password: false },
        })),
      ],
    };
    const perAddress = slateOf(many).filter((c) => c.path.startsWith("/p/alpha.html")).length;
    assert.ok(perAddress <= 2, `a project page offered ${perAddress} rows of the slate`);
  });

  test("a product behind a sign-in is told so, not told its score", () => {
    const wall: Atlas = {
      ...atlas,
      screens: [{ ...atlas.screens[0], signals: { fields: 2, password: true } }],
    };
    const why = noTutorialBecause(wall, []);
    assert.match(why, /behind a sign-in/);
    assert.doesNotMatch(why, /of 10/, "a score is not a diagnosis");
  });

  test("the menu reads as a menu", () => {
    const text = slateText(slateOf(atlas));
    assert.match(text, /\/10 · angle /);
    assert.match(text, /press: /);
    assert.ok(SLATE_FLOOR > 0 && SLATE_FLOOR < 10);
  });

  /*
    The one number that decides whether a lesson holds a frozen picture. A step's sentence
    is about a dozen words — 4.2 s at 170 wpm — the footage conforms at ~1.2 source seconds
    per timeline second, and the review calls a step stalled past 55% held. So the picture
    has to cover 45% of 4.2 s, which is 2.3 s of source.
  */
  test("a lesson shoots enough footage for the sentence that will be said over it", () => {
    const sentence = (12 / 170) * 60 + 0.35;
    const needed = sentence * 0.45 * 1.2 * 1000;
    assert.ok(LESSON_HOLD_MS >= needed, `${LESSON_HOLD_MS} ms is under the ${Math.round(needed)} ms a step's sentence needs`);
    assert.ok(LESSON_HOLD_MS <= 6000, "past a few seconds this is padding the take, not covering a sentence");
  });
});

describe("a lesson, against a running product", () => {
  let server: Server;
  let url: string;

  before(async () => {
    const started = await serve();
    server = started.server;
    url = started.url;
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  test("reads past a list of buttons and into the views inside an item", async () => {
    const atlas = await readAtlas({
      url,
      name: "ledger",
      about: "the notes my agents read in a project",
      take: DESKTOP_TAKE,
      budget: { screens: 8, perShape: 1, views: 6 },
    });
    const paths = atlas.screens.map((s) => s.path);
    assert.ok(
      paths.some((p) => p.startsWith("/p/")),
      `a project page is behind a button, not a link, and a reading that follows only hrefs never finds one — read: ${paths.join(", ")}`,
    );
    assert.ok(paths.some((p) => p.includes("#notes")), `an in-page view is a screen — read: ${paths.join(", ")}`);
    /* Views of one project share its address; four projects are still one screen shape. */
    const items = new Set(paths.filter((p) => p.startsWith("/p/")).map((p) => p.split("#")[0]));
    assert.ok(items.size <= 2, `four projects are one screen with four addresses, opened: ${[...items].join(", ")}`);
  });

  /*
    A product does not hold still between the reading and the shoot. The catalogue this
    was measured on lost a project in the hour between them, and the tile the route named
    had moved — so every step was dropped and the lesson was correct and useless. A row is
    not really about that row: any member of the same list teaches the same thing.
  */
  test("substitutes a sibling when the row a route named has gone", async () => {
    const lesson = await writeLesson({
      url,
      name: "ledger",
      goal: "the notes my agents read in a project",
      takes: [DESKTOP_TAKE],
      budget: { screens: 8, perShape: 1, views: 6 },
      router: async () => ({
        by: "brain",
        why: "a route naming a project that is not in this catalogue",
        on: "/p/alpha.html",
        steps: [
          { path: "/", control: "Open omega’s page — or double-click", kind: "press", why: "the project the lesson is about" },
          { path: "/p/alpha.html", control: "The notes", kind: "press", why: "where the notes live" },
        ],
      }),
    });
    const pressed = lesson.steps.flatMap((s) => ("clickOn" in s ? [s.clickOn] : []));
    assert.ok(
      pressed.some((s) => /Open .*’s page/.test(s)),
      `no tile was pressed, so the lesson stopped at the catalogue: ${pressed.join(", ")}`,
    );
    assert.ok(
      lesson.candidates.some((c) => c.reasons.some((r) => /was gone; this is one of the same list/.test(r))),
      "the substitution is on the record, not silent",
    );
    assert.ok(lesson.marks.some((m) => m.label === "The notes"), `the lesson still reached the notes: ${lesson.marks.map((m) => m.label).join(", ")}`);
  });

  /*
    Nobody said what to teach. The reading scores what it found and the top row is filmed —
    the same list, every time, from the same product.
  */
  test("with no goal at all it chooses what to teach, and says what it chose from", async () => {
    const lesson = await writeLesson({
      url,
      name: "ledger",
      takes: [DESKTOP_TAKE],
      budget: { screens: 8, perShape: 1, views: 6 },
    });
    assert.ok(lesson.lesson.slate, "a chosen lesson carries the menu it was chosen from");
    assert.ok(lesson.lesson.slate!.menu.length > 0);
    assert.ok(lesson.goal.length > 0, "the row it picked becomes the goal for everything downstream");
    assert.ok(lesson.lesson.angle, "and a framing, taken from the material");
    assert.ok(lesson.marks.length >= 2, `a chosen lesson is still a lesson: ${lesson.marks.map((m) => m.name).join(", ")}`);
    assert.match(lessonSummary(lesson), /nobody said what to teach/);
  });

  test("proves every step, and presses nothing that acts on the machine", async () => {
    const lesson = await writeLesson({
      url,
      name: "ledger",
      goal: "the notes my agents read in a project",
      takes: [DESKTOP_TAKE],
      budget: { screens: 8, perShape: 1, views: 6 },
    });

    const pressed = lesson.steps.flatMap((s) => ("clickOn" in s ? [s.clickOn] : []));
    assert.ok(!pressed.some((s) => /Delete project/.test(s)), `nothing destructive is pressed: ${pressed.join(", ")}`);
    assert.ok(!pressed.some((s) => /Reveal in Finder/.test(s)), `nothing that leaves for another application is pressed: ${pressed.join(", ")}`);

    /* Every mark is a moment in the recording, and every moment has a step to shoot. */
    const marks = lesson.marks.map((m) => m.name);
    assert.ok(marks.length >= 2, `a lesson is more than arriving: ${marks.join(", ")}`);
    assert.equal(new Set(marks).size, marks.length, "a mark name is an identifier");
    for (const mark of marks) {
      assert.ok(
        lesson.steps.some((s) => "mark" in s && s.mark === mark),
        `mark "${mark}" has no step in the script`,
      );
    }
    assert.equal(lesson.marks[0].kind, "hero", "the first moment is arriving at the product");
    assert.equal(lesson.steps.filter((step) => "pause" in step && step.settled).length, lesson.marks.length, "each instruction records its own settled reading window");
    assert.ok(lesson.goal.length > 0);
    assert.match(lessonSummary(lesson), /route by words/);
  });
});
