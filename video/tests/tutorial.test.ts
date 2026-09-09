import assert from "node:assert/strict";
import { test } from "node:test";
import { FORMATS, timecode, type Brief } from "@panoma/video-core";
import {
  videoWhole,
  SPEAK_TAIL,
  captionCards,
  captionPhrases,
  SPEAK_WPM,
  castSpeed,
  projectPoint,
  speakSeconds,
  tutorialChapters,
  tutorialParts,
  tutorialPlan,
  tutorialShots,
  tutorialOrphans,
  tutorialSourceAt,
  tutorialStalls,
  TUTORIAL_CARD_BEATS,
  type CastSession,
} from "@panoma/video-render/timing";

const hook = { id: "h", text: { en: "Tired of opening folders?" } };

const brief: Brief = {
  id: "tut",
  recipe: "Tutorial",
  langs: ["en"],
  bpm: 120,
  fps: 30,
  session: "s",
  hooks: [hook],
  lines: [
    { id: "one", mark: "copy", text: { en: "Come with me and copy this one line." } },
    { id: "two", mark: "scrolled", text: { en: "Then look at what the page does next." } },
    { id: "cta", text: { en: "Run it on your own disk." } },
  ],
};

/** 25 fps footage under a 30 fps timeline: the conform case, which is every take. */
const session: CastSession = {
  viewport: { width: 1920, height: 1080 },
  durationMs: 20_000,
  fps: 25,
  readyMs: 2000,
  marks: [
    { name: "copy", t: 3000 },
    { name: "scrolled", t: 9000 },
  ],
  events: [
    { t: 2500, kind: "move", x: 900, y: 400 },
    { t: 3000, kind: "mark", name: "copy" },
    { t: 4000, kind: "click", x: 960, y: 540 },
    { t: 9000, kind: "mark", name: "scrolled" },
    { t: 9500, kind: "scroll", y: 800 },
  ],
};

test("a line with a mark is a step; a line without one is the closing card", () => {
  const parts = tutorialParts(brief);
  assert.deepEqual(parts.steps.map((l) => l.id), ["one", "two"]);
  assert.deepEqual(parts.outro.map((l) => l.id), ["cta"]);
});

/*
  Every step but the first opens on its own title, with the frame to itself.

  It is the signpost Guo, Kim & Rubin ask for from 6.9 million viewing sessions —
  tutorials are scrubbed, and a boundary a scrubber can see is what makes that
  possible — and it is the only way to name a step without laying type over a moving
  interface. The first step has none because the cold open is already a card, and two
  cards with no picture between them is a slow lead-in.
*/
test("a step opens on its own title, and the first one does not", () => {
  const labelled: Brief = {
    ...brief,
    lines: brief.lines.map((l) => (l.mark ? { ...l, label: { en: l.mark } } : l)),
  };
  const plan = tutorialPlan(session, labelled, hook, "en");
  const beat = (30 * 60) / 120; /* a beat at 120 bpm, in frames of a 30 fps timeline */
  assert.equal(plan.steps[0].cardTo, plan.steps[0].from, "the first step cuts straight to the product");
  assert.equal(plan.steps[1].cardTo - plan.steps[1].from, beat * TUTORIAL_CARD_BEATS);
  const seconds = (TUTORIAL_CARD_BEATS * beat) / 30;
  assert.ok(seconds >= 0.833, `${seconds}s is below Netflix's floor for a readable fragment`);
  assert.ok(seconds <= 2, `${seconds}s: above two seconds a signpost is a lead-in`);
});

test("a step with nothing written on its title gets none", () => {
  const plan = tutorialPlan(session, brief, hook, "en");
  for (const step of plan.steps) assert.equal(step.cardTo, step.from, "no label, no card: a blank signpost is a pause");
});

test("the picture waits under a title and resumes where the step begins", () => {
  const labelled: Brief = {
    ...brief,
    lines: brief.lines.map((l) => (l.mark ? { ...l, label: { en: l.mark } } : l)),
  };
  const plan = tutorialPlan(session, labelled, hook, "en");
  const second = plan.steps[1];
  const fps = 30;
  const under = tutorialSourceAt(plan, session, second.from + 2, fps);
  const atCut = tutorialSourceAt(plan, session, second.cardTo, fps);
  assert.equal(under, second.sourceFrom, "the picture does not run on behind a card nobody can see through");
  assert.equal(atCut, second.sourceFrom, "and the cut delivers the frame the step starts on");
  assert.ok(tutorialSourceAt(plan, session, second.cardTo + 10, fps) > atCut, "then it plays");
});

test("a brief with no marked line refuses to be a tutorial", () => {
  assert.throws(
    () => tutorialParts({ ...brief, lines: [{ id: "cta", text: { en: "x" } }] }),
    /no steps/,
  );
});

test("a mark the take does not have names the marks it does", () => {
  const wrong: Brief = { ...brief, lines: [{ id: "one", mark: "nope", text: { en: "x" } }] };
  assert.throws(() => tutorialPlan(session, wrong, hook, "en"), /copy, scrolled/);
});

test("steps out of order against the recording stop the render", () => {
  const swapped: Brief = {
    ...brief,
    lines: [
      { id: "two", mark: "scrolled", text: { en: "x" } },
      { id: "one", mark: "copy", text: { en: "y" } },
    ],
  };
  assert.throws(() => tutorialPlan(session, swapped, hook, "en"), /the other way round/);
});

/*
  The stillness after a press is the payoff, not an accident. Apple's rule that text must
  stay on screen for a measured minimum — Netflix floors a subtitle at 20 frames, Brysbaert
  puts adult silent reading at 238 wpm — applies to a changed interface, and Guo's finding
  that tutorial pauses cluster at the state changes is viewers correcting an edit that cut
  too early. So the step declares where its own action landed, and the render plan turns
  that into a hold — otherwise the review reports the intended still as repeated frames.
*/
test("a step says where its action landed, and the still after it is intended", () => {
  const plan = tutorialPlan(session, brief, hook, "en");
  const first = plan.steps[0];
  assert.ok(first.settleFrom > first.cardTo, "the settle is after the step opens");
  assert.ok(first.settleFrom <= first.to, "and inside the step");
  /* The click is at 4000 ms, a second after the mark: the settle follows it, not the mark. */
  assert.ok(first.settleFrom > first.from + 15, `settle at ${first.settleFrom} is too close to the step's start`);
  /* A step with nothing in it settles where its picture starts: there is nothing to wait for. */
  const still = tutorialPlan({ ...session, events: session.events.filter((e) => e.kind === "mark") }, brief, hook, "en");
  assert.equal(still.steps[0].settleFrom, still.steps[0].cardTo);
});

test("a take with no marks says which command puts them there", () => {
  assert.throws(() => tutorialPlan({ ...session, marks: [] }, brief, hook, "en"), /panoma-video record/);
});

test("every step boundary lands on a beat, and the piece on a bar", () => {
  const plan = tutorialPlan(session, brief, hook, "en");
  /*
    Beats, not bars. Whole-bar rounding bought up to a bar of a title card with nothing
    happening on it, at the one place a piece cannot afford it — Wistia measures the slow
    lead-in as the commonest cause of early drop-off, over 13 million videos.
  */
  assert.equal(plan.hookFrames % 15, 0, "the cold open still lands on the grid");
  assert.ok(plan.hookFrames >= 30, "and is never shorter than two beats");
  for (const step of plan.steps) {
    assert.equal(step.from % 15, 0, `step ${step.mark} starts off the grid`);
    assert.equal(step.to % 15, 0, `step ${step.mark} ends off the grid`);
  }
  assert.equal(plan.durationInFrames % 60, 0);
});

test("the picture never runs slower than the conform rate — the anti-judder invariant", () => {
  const plan = tutorialPlan(session, brief, hook, "en");
  const rate = castSpeed(session, 30);
  for (const step of plan.steps) {
    assert.ok(step.playRate >= rate - 1e-9, `${step.mark} plays at ${step.playRate}, below the conform rate ${rate}`);
    /* Measured on the map itself, not just on the declared rate. */
    for (let f = step.from; f + 1 < step.holdFrom; f++) {
      const advance = tutorialSourceAt(plan, session, f + 1, 30) - tutorialSourceAt(plan, session, f, 30);
      assert.ok(advance >= rate / 30 - 1e-6, `frame ${f} advances ${advance}s, which would repeat a source frame`);
    }
  }
});

test("the map is continuous and never goes backwards", () => {
  const plan = tutorialPlan(session, brief, hook, "en");
  for (let i = 1; i < plan.steps.length; i++) {
    assert.equal(plan.steps[i].sourceFrom, plan.steps[i - 1].sourceTo, "a step starts where the previous one ended");
  }
  let previous = -1;
  for (let f = 0; f < plan.durationInFrames; f++) {
    const t = tutorialSourceAt(plan, session, f, 30);
    assert.ok(t >= previous - 1e-9, `frame ${f} moves the picture backwards`);
    assert.ok(t <= session.durationMs / 1000, `frame ${f} seeks past the end of the take`);
    previous = t;
  }
});

test("a sentence longer than its footage holds; the camera is what keeps moving", () => {
  const talky: Brief = {
    ...brief,
    lines: [
      { id: "one", mark: "copy", text: { en: "x" } },
      {
        id: "two",
        mark: "scrolled",
        text: { en: Array.from({ length: 60 }, () => "word").join(" ") },
      },
    ],
  };
  const plan = tutorialPlan(session, talky, hook, "en");
  const last = plan.steps[1];
  assert.ok(last.holdFrom < last.to, "the picture should run out before the sentence does");
  assert.equal(
    tutorialSourceAt(plan, session, last.to - 1, 30),
    tutorialSourceAt(plan, session, last.holdFrom, 30),
    "a held frame is the same frame",
  );
  assert.equal(tutorialStalls(plan).length, 1);
  assert.equal(tutorialStalls(plan)[0].mark, "scrolled");
});

test("a sentence shorter than its footage widens the step rather than cutting the action", () => {
  const terse: Brief = {
    ...brief,
    lines: [
      { id: "one", mark: "copy", text: { en: "Look." } },
      { id: "two", mark: "scrolled", text: { en: "Look." } },
    ],
  };
  const plan = tutorialPlan(session, terse, hook, "en");
  for (const step of plan.steps) {
    /* Everything between the marks is on screen: nothing is skipped to save time. */
    assert.ok(step.holdFrom <= step.to);
    assert.ok(
      Math.abs(tutorialSourceAt(plan, session, step.holdFrom, 30) - step.sourceTo) < 0.05,
      `${step.mark} never reaches the end of its own footage`,
    );
    assert.ok(step.playRate <= castSpeed(session, 30) * 2.5 + 1e-9, "and it is never hurried past the cap");
  }
  assert.equal(tutorialStalls(plan).length, 0);
});

test("a step is framed by what the product actually did after its mark", () => {
  const plan = tutorialPlan(session, brief, hook, "en");
  assert.equal(plan.steps[0].kind, "click");
  assert.equal(plan.steps[0].fx, 960 / 1920);
  assert.equal(plan.steps[1].kind, "scroll");
});

test("chrome earns no framing here either", () => {
  const consented: CastSession = {
    ...session,
    events: [
      { t: 3500, kind: "click", x: 100, y: 1000, role: "chrome" },
      { t: 4000, kind: "click", x: 960, y: 540 },
      ...session.events.filter((e) => e.kind === "scroll" || e.kind === "mark"),
    ],
  };
  const plan = tutorialPlan(consented, brief, hook, "en");
  assert.equal(plan.steps[0].fx, 960 / 1920, "the consent click must not become the subject");
});

/*
  2026-09-04, night. The tour writes `mark → scrollTo → clickOn` for a control below the
  fold, so the first thing after such a mark is the scroll that brings the control into
  view — and a step read as its first action was a "scroll" step: no push, no press
  framing, no lift, no result, only the pulse. Three of the panoma tutorial's five steps
  were lost that way. The scroll is the approach; the press is the step.
*/
test("chrome keyboard and scroll events earn neither a tutorial action nor an orphan warning", () => {
  const chrome: CastSession = {
    ...session,
    events: [
      { t: 500, kind: "key", text: "Escape", role: "chrome" },
      { t: 3200, kind: "scroll", y: 300, role: "chrome" },
      { t: 3400, kind: "key", text: "Tab", role: "chrome" },
    ],
  };
  const plan = tutorialPlan(chrome, brief, hook, "en");
  assert.ok(plan.steps.every((step) => !step.hasAction && step.kind === "still"));
  assert.deepEqual(tutorialOrphans(chrome, plan), []);
});

test("a step that scrolls to its control and then presses it is a click step, at the press", () => {
  const approached: CastSession = {
    ...session,
    events: [
      { t: 2500, kind: "move", x: 900, y: 400 },
      { t: 3000, kind: "mark", name: "copy" },
      { t: 3200, kind: "scroll", y: 600 },
      /* The glide to the control logs its departure: the scroll is done by then. */
      { t: 4300, kind: "move", x: 900, y: 400 },
      { t: 4750, kind: "move", x: 1200, y: 700 },
      { t: 4750, kind: "click", x: 1200, y: 700 },
      { t: 9000, kind: "mark", name: "scrolled" },
      { t: 9500, kind: "scroll", y: 800 },
    ],
  };
  const plan = tutorialPlan(approached, brief, hook, "en");
  const first = plan.steps[0];
  assert.equal(first.kind, "click");
  assert.equal(first.fx, 1200 / 1920);
  assert.equal(first.fy, 700 / 1080);
  /* A scroll before the press is the approach: nothing moved under the pressed page. */
  assert.equal(first.stableTo, first.to, "a scroll before the press must not mark the step unsettled");
  /* And the ring waits for the control to arrive: lit from the glide's departure, not from the cut. */
  assert.ok(first.calloutFrom > first.cardTo, "the ring must not point at the page sliding past");
  assert.ok(first.calloutFrom <= first.pressAt, "and it is lit by the press");
  assert.ok(first.calloutTo <= first.pressAt + 15, "and done a beat after it");
  /* The scroll-only and click-only answers are what they were. */
  assert.equal(plan.steps[1].kind, "scroll");
  const plain = tutorialPlan(session, brief, hook, "en").steps[0];
  assert.equal(plain.kind, "click");
  assert.equal(plain.calloutFrom, plain.cardTo, "with no scroll to wait for, the ring is lit from the cut");
});

test("a scroll after the press still kills the callout, even when one came before it", () => {
  const both: CastSession = {
    ...session,
    events: [
      { t: 3200, kind: "scroll", y: 600 },
      { t: 4750, kind: "click", x: 1200, y: 700 },
      { t: 4900, kind: "scroll", y: 300 },
      { t: 9500, kind: "scroll", y: 800 },
    ],
  };
  const plan = tutorialPlan(both, brief, hook, "en");
  const first = plan.steps[0];
  const beat = Math.round(((brief.fps ?? 30) * 60) / brief.bpm);
  assert.equal(first.kind, "click");
  assert.ok(first.calloutTo > first.from && first.calloutTo < first.pressAt + beat, "the second scroll ended the ring before the press rule would have");
  assert.ok(first.stableTo < first.to, "and the page moved under the pressed control");
});

test("the still after the press lasts to the step's end, not to where the hold begins", () => {
  /*
    A sentence longer than its footage holds the last frame, and the pixels under the press
    point stay put through that hold. `stableTo` used to be `frameOf(toMs)`, which is the
    frame the hold begins on: 500 against a step ending at 510 on this brief's second step,
    and the lift read that as "the page moved" and refused the after-state on every step
    whose sentence outlasted its footage.
  */
  const talky: Brief = {
    ...brief,
    lines: [{ id: "one", mark: "copy", text: { en: Array.from({ length: 40 }, () => "word").join(" ") } }, brief.lines[1], brief.lines[2]],
  };
  const plan = tutorialPlan(session, talky, hook, "en");
  const first = plan.steps[0];
  assert.ok(first.holdFrom < first.to, "the fixture must hold for this to test anything");
  assert.equal(first.stableTo, first.to);
  assert.equal(plan.steps[1].stableTo, plan.steps[1].to, "a scroll step with nothing after its scroll is stable to its end too");
});

test("the shot list covers the piece end to end, with no gap and no inversion", () => {
  const plan = tutorialPlan(session, brief, hook, "en");
  const shots = tutorialShots(session, brief, plan);
  assert.ok(!shots.some((s) => s.reason.includes("under its title")), "no line in this brief has a label, so no step has a card");
  assert.equal(shots[0].from, 0);
  assert.equal(shots[shots.length - 1].to, plan.durationInFrames);
  for (const shot of shots) assert.ok(shot.to > shot.from, `${shot.reason} is empty or inverted`);
  for (let i = 1; i < shots.length; i++) {
    assert.equal(shots[i].from, shots[i - 1].to, "a gap between shots would freeze the camera");
  }
  /*
    The ceiling is measured now, not chosen. This fixture carries no `videoRatio`, so it is
    the 1x take every recording was until 2026-09-04, and `videoWhole` is the scale at which
    it is drawn at its own pixels; past it every further step of camera is an upscale. The
    only thing allowed above it is the press, where the LIFTED macro carries the detail at up
    to eight times the density. The old literal here was 1.45, which permitted a quarter of
    an upscale.
  */
  const whole = videoWhole(FORMATS.h, session.viewport, { isMobile: session.isMobile });
  for (const shot of shots) {
    const cap = /pressing|settling|held/.test(shot.reason) ? whole * 1.35 : whole;
    assert.ok(shot.end.scale <= cap + 1e-9, `${shot.reason} reaches ${shot.end.scale.toFixed(3)}, past its ${cap.toFixed(3)} ceiling`);
  }
});

/*
  The camera arrives and then stops, which is the opposite of what this recipe used to
  do. Nielsen Norman put the band a viewer reads as deliberate at 100-400 ms and 500 ms
  at "a real drag"; Material says the same from the other side. What the old design had
  instead was a push that ran for the whole step, on the argument that a held frame
  needs something alive in it — and a frame still drifting under a result somebody is
  reading is exactly what they pause the video to stop.
*/
test("a title card delivers an arrived camera, with no extra approach after the cut", () => {
  const labelled: Brief = { ...brief, lines: brief.lines.map((l) => (l.mark ? { ...l, label: { en: l.mark } } : l)) };
  const plan = tutorialPlan(session, labelled, hook, "en");
  const shots = tutorialShots(session, labelled, plan);
  const titled = plan.steps.filter((s) => s.cardTo > s.from);
  assert.ok(titled.length > 0, "the fixture must have a titled step for this to test anything");
  for (const step of titled) {
    const under = shots.find((s) => s.reason.includes(`${step.mark} — under its title`));
    const arriving = shots.find((s) => s.reason.includes(`${step.mark} — approaching`));
    assert.ok(under, `step ${step.mark} has no shot under its card`);
    assert.equal(under!.to, arriving!.from, "the approach follows the title's initial hold");
    assert.equal(arriving!.to, step.cardTo, "the approach finishes under the title");
    const visible = shots.find((s) => s.from === step.cardTo)!;
    assert.deepEqual(visible.start, arriving!.end, "the cut delivers the arrived frame");
  }
});

test("the camera arrives inside half a second and then holds", () => {
  const plan = tutorialPlan(session, brief, hook, "en");
  const shots = tutorialShots(session, brief, plan);
  const fps = brief.fps ?? 30;
  const arriving = shots.filter((s) => s.reason.includes("approaching"));
  const held = shots.filter((s) => s.reason.includes("held"));
  assert.equal(arriving.length, plan.steps.length);
  for (const shot of arriving) assert.ok(shot.to - shot.from <= Math.round(fps * 0.42) + 1, "an approach is the measured move and nothing more");
  for (const shot of arriving) {
    assert.ok(shot.start.scale > shot.end.scale, "a step settles into its framing rather than pushing out of it");
    assert.ok((shot.to - shot.from) / fps <= 0.5 + 3, "the move itself is under half a second once the card has lifted");
    /*
      An ease-out, so the eye has time to focus as the frame comes to rest — and since
      2026-09-04 the critically damped one: it departs from rest as well, which the cubic
      did not, and lands over the last third instead of the last frame. See `easings.spring`.
    */
    assert.equal(shot.ease, "spring", "the approach is the spring-shaped ease-out");
  }
  for (const shot of held) {
    /*
      Not a freeze either: a perfectly still frame is what the review counts as duplicates.

      The DIRECTION is free, and that is the correction. This drift exists for the encoder
      and not for the eye — every source on reading asks for the opposite — so when the
      framing already sits at the recording's own pixels the only way left is back, and a
      hold that insisted on drifting up was zooming a take the ceiling had just told it not
      to. What has to be true is that it moves, and that nobody can see it.
    */
    const by = shot.end.scale / shot.start.scale;
    assert.notEqual(by, 1, "a still picture under a frozen camera is a slide");
    assert.ok(Math.abs(by - 1) < 0.02, `a hold drifts by ${((by - 1) * 100).toFixed(2)}%, which is a move`);
  }
});

test("speaking time scales with words and is zero for nothing", () => {
  assert.equal(speakSeconds(""), 0);
  const one = speakSeconds("word");
  const ten = speakSeconds(Array.from({ length: 10 }, () => "word").join(" "));
  assert.ok(ten > one * 5, "ten words take longer than two");
  const minute = Array.from({ length: SPEAK_WPM }, () => "w").join(" ");
  assert.ok(Math.abs(speakSeconds(minute) - (60 + SPEAK_TAIL)) < 0.01, "a minute of words takes a minute");
  /*
    The band, not the number: below 165 is the engagement dip Guo, Kim & Rubin
    measured over 6.9M sessions; above 200 the captions pass 20 characters a second
    and stop being readable by someone following along.
  */
  assert.ok(SPEAK_WPM >= 165 && SPEAK_WPM <= 200, `${SPEAK_WPM} wpm is outside the evidenced band`);
});

test("a step containing the action is never hurried, however short its sentence", () => {
  const terse: Brief = {
    ...brief,
    lines: [
      { id: "one", mark: "copy", text: { en: "Here." } },
      { id: "two", mark: "scrolled", text: { en: "Here." } },
    ],
  };
  const plan = tutorialPlan(session, terse, hook, "en");
  const rate = castSpeed(session, 30);
  for (const step of plan.steps) {
    assert.ok(step.hasAction, "both segments of the fixture contain a product event");
    assert.ok(
      Math.abs(step.playRate - rate) < 1e-9,
      `${step.mark} rushes the action at ${step.playRate} instead of the conform rate ${rate}`,
    );
  }
});

test("still water may be hurried — that is what the cap is for", () => {
  /* A mark with nothing between it and the next one: a page settling, a cursor. */
  const idle: CastSession = {
    ...session,
    marks: [
      { name: "copy", t: 3000 },
      { name: "scrolled", t: 14_000 },
    ],
    events: [{ t: 4000, kind: "click", x: 960, y: 540 }],
  };
  const plan = tutorialPlan(idle, { ...brief, lines: [brief.lines[0], brief.lines[1]] }, hook, "en");
  const rate = castSpeed(idle, 30);
  assert.equal(plan.steps[0].hasAction, true);
  assert.equal(plan.steps[1].hasAction, false, "nothing happens after the second mark");
  assert.ok(plan.steps[1].playRate > rate, "dead air should compress");
  assert.ok(plan.steps[1].playRate <= rate * 2.5 + 1e-9);
});

test("a callout dies when the page scrolls out from under it", () => {
  const scrolledAway: CastSession = {
    ...session,
    events: [
      { t: 4000, kind: "click", x: 960, y: 540 },
      /*
        The same step scrolls right after the press: the button the ring points at moves.
        Inside the beat the ring would otherwise be granted after a press, so that the
        scroll — and not the press rule — is what ends it here.
      */
      { t: 4200, kind: "scroll", y: 300 },
      { t: 9500, kind: "scroll", y: 800 },
    ],
  };
  const plan = tutorialPlan(scrolledAway, brief, hook, "en");
  const first = plan.steps[0];
  const aBeat = Math.round(((brief.fps ?? 30) * 60) / brief.bpm);
  assert.ok(first.calloutTo < first.to, "the ring must not outlive the pixel it points at");
  assert.ok(first.calloutTo > first.from, "and it must still exist");
  assert.ok(first.calloutTo < first.pressAt + aBeat, "the scroll ended it before the press rule would have");
  /*
    With nothing moving the page, it lasts until a beat after the press and no longer: the
    press is where the ring's job ends. It used to run for the whole picture, and on a
    press that navigated it went on ringing the coordinate the control HAD on a page that
    had put something else there.
  */
  const still = tutorialPlan(session, brief, hook, "en");
  const beat = Math.round(((brief.fps ?? 30) * 60) / brief.bpm);
  assert.equal(still.steps[0].kind, "click");
  assert.equal(still.steps[0].calloutTo, Math.min(still.steps[0].to, still.steps[0].holdFrom, still.steps[0].pressAt + beat));
});

test("action no step narrates is reported by the second it happened", () => {
  const noisy: CastSession = {
    ...session,
    events: [
      /* Before the first mark, and after the last: nobody explains either. */
      { t: 500, kind: "click", x: 10, y: 10 },
      { t: 4000, kind: "click", x: 960, y: 540 },
      { t: 9500, kind: "scroll", y: 800 },
    ],
    durationMs: 20_000,
  };
  const plan = tutorialPlan(noisy, brief, hook, "en");
  const orphans = tutorialOrphans(noisy, plan);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].t, 500);
  /* A consent banner is declared chrome and is not an orphan. */
  const consented = { ...noisy, events: noisy.events.map((e) => (e.t === 500 ? { ...e, role: "chrome" as const } : e)) };
  assert.equal(tutorialOrphans(consented, tutorialPlan(consented, brief, hook, "en")).length, 0);
});

test("chapters open at zero, run in order, and admit when YouTube will ignore them", () => {
  const plan = tutorialPlan(session, brief, hook, "en");
  const rows = tutorialChapters(plan, brief, hook, "en");
  assert.equal(rows[0].seconds, 0);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].seconds > rows[i - 1].seconds);
  assert.equal(rows.length, plan.steps.length + 2);
  const short = tutorialChapters(
    { ...plan, durationInFrames: 300 },
    brief,
    hook,
    "en",
  );
  assert.equal(short[0].accepted, false, "a ten-second piece cannot have YouTube chapters");
});

test("timecodes are m:ss and never negative", () => {
  assert.equal(timecode(0), "0:00");
  assert.equal(timecode(9.7), "0:09");
  assert.equal(timecode(75), "1:15");
  assert.equal(timecode(-4), "0:00");
});

test("a callout finds the pixel the camera moved, and holds its size", () => {
  /* No camera: fractions pass straight through. */
  assert.deepEqual(projectPoint({ scale: 1, dx: 0, dy: 0 }, 0.25, 0.75), { x: 0.25, y: 0.75 });
  /* Zooming on a point brings it towards the middle, which is what the camera did. */
  const camera = { scale: 1.5, dx: 0.15, dy: 0 };
  const moved = projectPoint(camera, 0.2, 0.5);
  assert.ok(Math.abs(moved.x - 0.5) < Math.abs(0.2 - 0.5), "the subject should have come inward");
  assert.equal(moved.y, 0.5);
});

/* ---------- Caption cards ---------- */

const w = (text: string, start: number, end: number) => ({ text, start, end });

test("a card never straddles a pause, and a pause is how two sentences are told apart", () => {
  const cards = captionCards([
    w("Come", 0, 0.3),
    w("with", 0.3, 0.6),
    w("me", 0.6, 0.9),
    /* A beat of air: the next step's narration. */
    w("Then", 2.0, 2.3),
    w("look", 2.3, 2.6),
  ]);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards[0].words.map((x) => x.text), ["Come", "with", "me"]);
  assert.deepEqual(cards[1].words.map((x) => x.text), ["Then", "look"]);
});

test("a card breaks at a full stop, which is where the speaker breathes anyway", () => {
  const cards = captionCards([w("Look.", 0, 0.4), w("Now", 0.45, 0.7), w("copy", 0.7, 1.0)]);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards[0].words.map((x) => x.text), ["Look."]);
});

test("a card holds until the next one arrives, and its reading speed says so", () => {
  const cards = captionCards([w("aaaa", 0, 0.4), w("bbbb.", 0.4, 0.8), w("cccc", 1.4, 1.8)]);
  assert.equal(cards[0].shownUntil, 1.4, "it stays up through the breath after it");
  assert.ok(cards[0].spoken < cards[0].shownUntil);
  /* "aaaa bbbb." is ten characters, read over the 1.4s it is on screen — not over
     the 0.8s it took to say, which is the number the first version reported. */
  assert.equal(cards[0].chars, 10);
  assert.ok(Math.abs(cards[0].cps - 10 / 1.4) < 1e-9);
  assert.equal(cards[cards.length - 1].shownUntil, 1.8 + 0.8, "the last card gets a tail");
});

test("a card stays inside two readable lines", () => {
  const many = Array.from({ length: 24 }, (_, i) => w("wordy", i * 0.3, i * 0.3 + 0.28));
  for (const card of captionCards(many)) assert.ok(card.chars <= 40, `${card.chars} characters is a wall of text`);
});

test("captions with no words produce no cards rather than an empty one", () => {
  assert.deepEqual(captionCards([]), []);
});

test("reading speed is measured over the phrase, not over a card mid-sentence", () => {
  /* Seven short words with no pause: fast per card, ordinary as a sentence. */
  const words = Array.from({ length: 8 }, (_, i) => w("front", i * 0.17, i * 0.17 + 0.16));
  const cards = captionCards(words);
  assert.ok(cards.length > 1, "the fixture must split for layout");
  const phrases = captionPhrases(cards);
  assert.equal(phrases.length, 1, "no pause means one phrase");
  /* The phrase's rate is the speaking rate; a card's is an artefact of where it broke. */
  assert.ok(phrases[0].cps < Math.max(...cards.map((c) => c.cps)));
});

test("a card followed by silence is a phrase of one, and is judged on its own", () => {
  const phrases = captionPhrases(
    captionCards([w("Look.", 0, 0.4), w("Now", 2.0, 2.3), w("copy", 2.3, 2.6)]),
  );
  assert.equal(phrases.length, 2);
  assert.equal(phrases[0].text, "Look.");
});
