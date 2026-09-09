/*
  The recording scripts that exist. A session is a typed tour of the real product —
  code, not a performance — so re-recording after a UI change costs one command.
  `panoma-video record <name>` shoots every take: the desktop camera for 16:9 and 1:1, the
  mobile camera for 9:16. Steps are shared unless a take overrides them, because a
  portrait layout sometimes hides behind a menu the desktop layout shows outright.
*/
import { DESKTOP_TAKE, MOBILE_TAKE, type SessionStep, type SessionTake } from "@panoma/video-capture";

export type SessionScript = {
  name: string;
  takes: SessionTake[];
  /** Used by any take that does not bring its own steps. */
  steps: SessionStep[];
  colorScheme?: "light" | "dark";
};

const SITE = "https://panomal.vercel.app";

export const sessions: SessionScript[] = [
  /*
    The tutorial tour, which differs from `panoma-tour` in one way that changes
    everything: it carries MARKS. A mark is a named instant a sentence can be pinned
    to, so this script is not a list of moves any more — it is four chapters with
    footage in them, and the narration finds them by name however long they take.

    Both takes mark the same four moments. They have to: a tutorial pinned to a mark
    that only one take carries renders in 16:9 and fails in 9:16, and `panoma-video record`
    says so the moment the takes disagree.
  */
  {
    name: "panoma-start",
    colorScheme: "dark",
    /*
      ONE STEP LIST FOR BOTH TAKES, which is only possible because nothing here is a
      pixel. Every destination is named — `clickOn` a button, `scrollTo` a heading —
      so the desktop and the mobile camera land on the same CONTENT in two completely
      different layouts. The tour that used to need two hand-tuned scripts, whose
      scroll distances drifted apart until the Spanish vertical cut narrated the front
      door over a screenshot of something else, is now one.
    */
    takes: [DESKTOP_TAKE, MOBILE_TAKE],
    steps: [
      { goto: SITE, settleMs: 1400 },
      { clickOn: "text=Reject", optional: true, role: "chrome" },
      { pause: 500 },

      /* Each chapter carries about six seconds of movement, and that number is not
         taste: a step's picture plays at the conform rate and then HOLDS while the
         sentence finishes, so a chapter shot in two seconds under a six-second
         sentence is four seconds of frozen screen. The renderer says so by name when
         it happens — see tutorialStalls — and this is what heeding it looks like. */
      { mark: "copy" },
      { clickOn: "text=copy", optional: true, role: "product" },
      { pause: 1600 },
      { scrollTo: "text=any folder", at: 0.4, ms: 900 },
      { pause: 900 },
      { scrollTo: "text=all your projects", at: 0.45, ms: 900 },
      { pause: 1000 },

      { mark: "question" },
      { scrollTo: "text=One question", at: 0.2, ms: 1300 },
      { pause: 1200 },
      { scrollTo: "text=Answer it out loud", at: 0.3, ms: 1000 },
      { pause: 1100 },
      { scrollTo: "text=looking for an answer", at: 0.45, ms: 1000 },
      { pause: 1000 },

      { mark: "door" },
      { scrollTo: "text=Ten seconds", at: 0.18, ms: 1300 },
      { pause: 1400 },
      { scrollTo: "text=And a door appears", at: 0.35, ms: 1100 },
      { pause: 1400 },
      { scrollTo: "text=All of them on one page", at: 0.35, ms: 1000 },
      { pause: 1200 },

      { mark: "memory" },
      /* The "Project memory" eyebrow is desktop-only markup; the heading is in both. */
      { scrollTo: "text=The most advanced memory", at: 0.2, ms: 1300 },
      { pause: 1400 },
      { scrollTo: "text=It updates live", at: 0.3, ms: 1100 },
      { pause: 1400 },
      { scrollTo: "text=How memory works", at: 0.4, ms: 1000 },
      { pause: 1400 },
    ],
  },
  {
    name: "panoma-tour",
    colorScheme: "dark",
    takes: [
      DESKTOP_TAKE,
      {
        ...MOBILE_TAKE,
        /*
          The portrait tour is its own edit, not the desktop one squeezed. Coordinates
          live inside a 720x1560 viewport, and the scrolls are shorter because a phone
          layout stacks what a desktop layout spreads.
        */
        steps: [
          { goto: SITE, settleMs: 1500 },
          /* Consent is chrome: the viewer came for none of it, and an edit that
             treats every click alike spends its hardest push on a Reject button. */
          { clickOn: "text=Reject", optional: true, role: "chrome" },
          { pause: 700 },
          { move: { x: 360, y: 520, ms: 500 } },
          { pause: 500 },
          /* The real interaction of the portrait cut: copying the install command. */
          { clickOn: "text=copy", optional: true, role: "product" },
          { pause: 900 },
          { scroll: { y: 620, ms: 1100 } },
          { pause: 800 },
          { move: { x: 360, y: 900, ms: 500 } },
          { pause: 600 },
          { scroll: { y: 780, ms: 1200 } },
          { pause: 900 },
          { scroll: { y: 700, ms: 1000 } },
          { pause: 800 },
          { move: { x: 400, y: 760, ms: 500 } },
          { pause: 700 },
        ],
      },
    ],
    steps: [
      { goto: SITE, settleMs: 1400 },
      { clickOn: "text=Reject", optional: true, role: "chrome" },
      { pause: 500 },
      { move: { x: 960, y: 420, ms: 500 } },
      { pause: 400 },
      /* The product's actual action, not a nav link: copying the install command,
         which sits mid-page and gives visible feedback. A punch is only worth two
         bars if there is something at the focus worth two bars. */
      { clickOn: "text=copy", optional: true, role: "product" },
      { pause: 1100 },
      { scroll: { y: 800, ms: 1200 } },
      { pause: 700 },
      { move: { x: 620, y: 600, ms: 550 } },
      { pause: 400 },
      { scroll: { y: 900, ms: 1200 } },
      { pause: 800 },
      { move: { x: 1200, y: 640, ms: 500 } },
      { pause: 600 },
    ],
  },
];
