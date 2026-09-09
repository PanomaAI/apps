/*
  The tutorial's camera, and the four things that make it professional rather than busy.

  IT MOVES WITH THE PRESS. A camera that starts moving after the thing has happened tells
  the viewer the film was surprised by its own subject. The push straddles the press: most of
  it before, a tail after. That is only possible because a step now knows when its own press
  is, which it did not — everything aimed at the press was aiming at `settleFrom`, a beat past
  the segment's LAST action, and on a step that clicks and then scrolls those are three
  seconds apart.

  IT NEVER DRAWS PAST ITS OWN PIXELS. Playwright records at the CSS viewport, so a tutorial's
  subject is a 1x asset drawn into a content box smaller than the canvas. `videoWhole` is the
  scale where it is 1:1, and it is a ceiling, not a target. The only thing allowed above it is
  the press, where the lifted macro carries the detail at up to eight times the density.

  IT NEVER CROPS WHAT IT IS POINTING AT. `cameraTransform` clamps its pull, so a control near
  an edge simply cannot be brought to the middle at a readable depth. The old code knew this
  in prose and handled it with a hand-fitted ramp. `fitScaleToBox` solves it against the very
  clamp the frame is drawn with.

  IT COMES TO REST. Every move lands and then holds, because a frame still drifting under a
  result somebody is reading is the thing they pause the video to stop.
*/
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFile } from "node:fs/promises";
import { FORMATS, type Brief } from "@panoma/video-core";
import { calloutRamp, cameraAt, cameraTransform, fitScaleToBox, tutorialPlan, tutorialShots, videoWhole, visibleBand } from "../apps/render/src/recipes/timing.ts";

const VIEW = { width: 1920, height: 1080 };

const brief: Brief = {
  id: "cam",
  recipe: "Tutorial",
  bpm: 120,
  fps: 30,
  hooks: [{ id: "hook", text: { en: "Does it still build?" } }],
  lines: [
    { id: "one", mark: "open", text: { en: "Open the catalog to see every project you paused." } },
    { id: "two", mark: "resume", text: { en: "Click Resume to continue exactly where you left it." } },
    { id: "end", text: { en: "Try it yourself." } },
  ],
} as unknown as Brief;

/*
  A take that clicks and then scrolls, three seconds apart, inside one step.

  This is the repo's own shape and it is the whole reason `pressAt` exists: `settleFrom` is
  anchored to the LAST action of a segment, so on this session everything aimed at the press
  was aiming at the scroll.
*/
const session = {
  viewport: VIEW,
  durationMs: 16000,
  isMobile: false,
  readyMs: 0,
  fps: 30,
  marks: [
    { name: "open", t: 1000 },
    { name: "resume", t: 8000 },
  ],
  events: [
    { t: 1000, kind: "mark", name: "open" },
    { t: 2000, kind: "click", x: 420, y: 380 },
    { t: 5000, kind: "scroll", x: 960, y: 540 },
    { t: 8000, kind: "mark", name: "resume" },
    { t: 9000, kind: "click", x: 700, y: 360 },
    { t: 12000, kind: "scroll", x: 960, y: 540 },
  ],
} as unknown as Parameters<typeof tutorialPlan>[0];

const withMacros = {
  ...session,
  macros: [
    { mark: "open", file: "m/open.png", box: { x: 340, y: 320, width: 168, height: 121 }, pixelRatio: 8, focus: { x: 620, y: 300, width: 480, height: 90 } },
    { mark: "resume", file: "m/resume.png", box: { x: 604, y: 323, width: 221, height: 75 }, pixelRatio: 8, change: { box: { x: 400, y: 260, width: 700, height: 380 }, share: 0.13, boxShare: 0.13 } },
  ],
} as unknown as Parameters<typeof tutorialPlan>[0];

const shotsOf = (take: typeof session, format = FORMATS.h) => {
  const plan = tutorialPlan(take, brief, brief.hooks[0], "en");
  return { plan, shots: tutorialShots(take, brief, plan, format) };
};

describe("when the camera moves", () => {
  test("an early click inherits the actual framing when its waiting shot collapses", () => {
    const early = {
      ...withMacros,
      videoRatio: 2,
      events: withMacros.events.map((event) => event.kind === "click" ? { ...event, t: event.t - 800 } : event),
    } as typeof session;
    const labelled = { ...brief, lines: brief.lines.map((line) => line.mark ? { ...line, label: { en: line.mark } } : line) };
    for (const format of [FORMATS.h, FORMATS.v, FORMATS.s]) {
      const plan = tutorialPlan(early, labelled, labelled.hooks[0], "en");
      const shots = tutorialShots(early, labelled, plan, format);
      for (const step of plan.steps) {
        const visible = shots.filter((shot) => shot.from >= step.cardTo && shot.to <= step.to);
        for (let i = 1; i < visible.length; i++) {
          assert.deepEqual(visible[i].start, visible[i - 1].end, `${format.id}: discontinuity before ${visible[i].reason}`);
        }
      }
    }
  });

  test("a step knows its own press, which is not its last action", () => {
    const { plan } = shotsOf(session);
    const beat = 15;
    for (const step of plan.steps) {
      assert.ok(step.pressAt > 0, `step ${step.mark} has no press frame`);
      /*
        The defect this pins. Both steps click and then scroll three seconds later, so an
        anchor derived from `settleFrom` lands on the scroll — which is what every effect in
        this recipe was aiming at, ninety frames late.
      */
      assert.notEqual(step.pressAt, step.settleFrom - beat, `step ${step.mark} is still deriving its press from its last action`);
      assert.ok(step.pressAt < step.settleFrom, "the press comes before the settle, always");
    }
  });

  test("the push straddles the press rather than following it", () => {
    const { plan, shots } = shotsOf(session);
    for (const step of plan.steps) {
      const push = shots.find((s) => s.reason.includes(`${step.mark} — pressing`));
      assert.ok(push, `step ${step.mark} never pushes`);
      assert.ok(push!.from <= step.pressAt, "the push begins before the press");
      assert.ok(push!.to >= step.pressAt, "and it is still running when the press lands");
      assert.ok(push!.end.scale > push!.start.scale, "a push goes in");
    }
  });

  test("the shot list covers the piece with no gap and nothing inverted", () => {
    for (const take of [session, withMacros]) {
      const { plan, shots } = shotsOf(take);
      assert.equal(shots[0].from, 0);
      assert.equal(shots[shots.length - 1].to, plan.durationInFrames);
      for (const shot of shots) assert.ok(shot.to > shot.from, `${shot.reason} is empty or inverted`);
      for (let i = 1; i < shots.length; i++) assert.equal(shots[i].from, shots[i - 1].to, `a gap before ${shots[i].reason}`);
    }
  });

  test("the press is visibly closer than the framing, or the two shots are one still frame", () => {
    const { plan, shots } = shotsOf(withMacros);
    for (const step of plan.steps) {
      const wait = shots.find((s) => s.reason.includes(`${step.mark} — waiting`));
      const push = shots.find((s) => s.reason.includes(`${step.mark} — pressing`));
      if (!wait || !push) continue;
      assert.ok(push.end.scale / wait.start.scale >= 1.17, `step ${step.mark} presses only ${(push.end.scale / wait.start.scale).toFixed(3)}x closer`);
    }
  });
});

describe("how close it is allowed to get", () => {
  test("nothing is drawn past the recording's own pixels, except the press", () => {
    /*
      The invariant the whole look depends on, and the one the old ceiling of 1.45 broke: on
      a horizontal desktop cut the recording is 1:1 at 1.171, so 1.45 was a quarter of an
      upscale on every close-up.
    */
    for (const format of [FORMATS.h, FORMATS.v, FORMATS.s]) {
      const whole = videoWhole(format, VIEW, { isMobile: false });
      const { shots } = shotsOf(withMacros, format);
      for (const shot of shots) {
        const cap = /pressing|settling|held/.test(shot.reason) ? whole * 1.35 : whole;
        for (const scale of [shot.start.scale, shot.end.scale]) {
          assert.ok(scale <= cap + 1e-9, `${format.id}: ${shot.reason} reaches ${scale.toFixed(3)} past ${cap.toFixed(3)}`);
        }
      }
    }
  });

  test("a take that arrives already magnified is not zoomed at all", () => {
    /*
      A phone take drawn into a vertical cut is upscaled by a third before the camera does
      anything, so its ceiling is below one and the honest move is none. The recipe used to
      express this as `push = 0.5`, which halved a number that should not have existed.
    */
    const whole = videoWhole(FORMATS.v, { width: 720, height: 1280 }, { isMobile: true });
    assert.ok(whole < 1, `a phone take in a vertical cut should be pre-magnified, got ${whole.toFixed(3)}`);
    const phone = { ...withMacros, isMobile: true, viewport: { width: 720, height: 1280 } } as typeof session;
    const { shots } = shotsOf(phone, FORMATS.v);
    for (const shot of shots) assert.ok(shot.end.scale <= 1.0 + 1e-9, `${shot.reason} zooms a take that is already an upscale`);
  });

  test("the subject is never cropped, on any frame of any step", () => {
    /*
      Walked frame by frame rather than checked at the endpoints, because an eased move
      between two safe framings can still pass through an unsafe one.
    */
    const { plan, shots } = shotsOf(withMacros);
    const macros = (withMacros as unknown as { macros: { mark: string; box: { x: number; y: number; width: number; height: number } }[] }).macros;
    for (const step of plan.steps) {
      const box = macros.find((m) => m.mark === step.mark)!.box;
      const mine = shots.filter((s) => s.reason.includes(`${step.mark} —`) && !s.reason.includes("settling") && !s.reason.includes("held"));
      for (const shot of mine) {
        for (let f = shot.from; f < shot.to; f++) {
          const t = (f - shot.from) / Math.max(1, shot.to - shot.from);
          const scale = shot.start.scale + (shot.end.scale - shot.start.scale) * t;
          const fx = shot.start.fx + (shot.end.fx - shot.start.fx) * t;
          const fy = shot.start.fy + (shot.end.fy - shot.start.fy) * t;
          const cam = cameraTransform({ framing: { fx, fy, scale }, tilt: { rx: 0, ry: 0 }, entering: 1, enter: "cut", shot: 0 });
          const at = (v: number, size: number, d: number) => 0.5 + (v / size - 0.5) * cam.scale + d;
          assert.ok(at(box.x, VIEW.width, cam.dx) >= -1e-6, `${shot.reason} crops the control's left edge`);
          assert.ok(at(box.x + box.width, VIEW.width, cam.dx) <= 1 + 1e-6, `${shot.reason} crops its right edge`);
          assert.ok(at(box.y, VIEW.height, cam.dy) >= -1e-6, `${shot.reason} crops its top`);
          assert.ok(at(box.y + box.height, VIEW.height, cam.dy) <= 1 + 1e-6, `${shot.reason} crops its bottom`);
        }
      }
    }
  });

  test("fitScaleToBox never returns below one, and never returns a scale that crops", () => {
    const boxes = [
      { x: 0, y: 0, width: 60, height: 40 },
      { x: 1860, y: 1040, width: 60, height: 40 },
      { x: 900, y: 500, width: 120, height: 80 },
      { x: 0, y: 0, width: 1920, height: 1080 },
    ];
    for (const box of boxes) {
      const s = fitScaleToBox(box, VIEW, 2.4);
      assert.ok(s >= 1, `a corner box returned ${s}, and the camera may not scale below one`);
      assert.ok(s <= 2.4 + 1e-9);
    }
    /* A control at the very corner cannot be pushed to at all; the answer is to stay wide. */
    assert.equal(fitScaleToBox({ x: 0, y: 0, width: 60, height: 40 }, VIEW, 2.4), 1);
  });
});

describe("when the take has nothing to go on", () => {
  test("a take with no macros still gets a full shot list, and no result move", () => {
    const { plan, shots } = shotsOf(session);
    assert.ok(shots.length > 0);
    assert.ok(!shots.some((s) => s.reason.includes("settling")), "there is nothing measured to settle onto");
    for (const step of plan.steps) assert.equal(step.result, undefined);
  });

  test("a clipped screen-reader heading yields to the measured broad result on every format", () => {
    /*
      The first real project navigation returned a 1x2 px accessible heading. The camera
      zoomed into its coordinate beside the sidebar while the visible project was cropped.
      Discarding only the heading still held the obsolete click point: the wide change box
      was refused below 1.12. Both decisions must follow the result that is actually visible.
    */
    for (const viewport of [VIEW, { width: 720, height: 1280 }]) {
      const sx = viewport.width / VIEW.width;
      const sy = viewport.height / VIEW.height;
      const change = { x: 32 * sx, y: 102 * sy, width: 1616 * sx, height: 978 * sy };
      const take = {
        ...session, viewport, isMobile: viewport !== VIEW, videoRatio: viewport === VIEW ? 2 : 1,
        events: session.events.map((event) => event.kind === "click" ? { ...event, x: event.x * sx, y: event.y * sy } : event),
        macros: [{ mark: "open", file: "m/open.png", box: { x: 340 * sx, y: 320 * sy, width: 168 * sx, height: 121 * sy }, pixelRatio: 8,
          focus: { x: 458 * sx, y: 442 * sy, width: 1, height: 2 }, change: { box: change, share: 0.064, boxShare: 0.762 } }],
      } as unknown as typeof session;
      for (const format of [FORMATS.h, FORMATS.v, FORMATS.s]) {
        const { plan, shots } = shotsOf(take, format);
        assert.deepEqual(plan.steps[0].result?.box, change, "the result uses the changed pixels, not the clipped heading");
        const settle = shots.find((shot) => shot.reason.includes("open — settling"));
        assert.ok(settle, "a large real result still earns a move away from the old click");
        const whole = videoWhole(format, viewport, { isMobile: take.isMobile, videoRatio: take.videoRatio });
        assert.equal(settle.end.scale, Math.min(1, whole), `${format.id}: the result fits without an upscale`);
        assert.equal(settle.end.fx, 0.5, "the new page is centered horizontally");
        assert.equal(settle.end.fy, 0.5, "the new page is centered vertically");
        const hold = shots.find((shot) => shot.from === settle.to);
        assert.ok(hold && /held/.test(hold.reason));
        assert.deepEqual(hold.start, settle.end, "the release lands directly into its hold");
        assert.deepEqual(hold.end, hold.start, "a full-page result does not drift back into a crop");
        for (let frame = hold.from; frame < hold.to; frame++) {
          const camera = cameraAt(shots, frame, 15);
          assert.ok(camera.framing.scale <= whole + 1e-9, `${format.id}: a result hold never exceeds its own pixels`);
          assert.equal(camera.framing.fx, 0.5);
          assert.equal(camera.framing.fy, 0.5);
        }
      }
    }
  });

  test("a clipped heading without a measured change invents no result target", () => {
    const take = { ...session, macros: [{ mark: "open", file: "m/open.png", box: { x: 340, y: 320, width: 168, height: 121 }, pixelRatio: 8,
      focus: { x: 458, y: 442, width: 1, height: 2 } }] } as unknown as typeof session;
    const { plan, shots } = shotsOf(take);
    assert.equal(plan.steps[0].result, undefined);
    assert.ok(!shots.some((shot) => shot.reason.includes("open — settling")));
  });

  test("nothing throws on the shapes a real take actually arrives in", () => {
    const shapes = [
      session,
      withMacros,
      { ...session, macros: [] },
      { ...session, macros: [{ mark: "open", file: "m/o.png", box: { x: 1890, y: 1050, width: 24, height: 18 }, pixelRatio: 8 }] },
      { ...session, events: session.events.filter((e) => e.kind !== "click") },
    ] as unknown as typeof session[];
    for (const [i, take] of shapes.entries()) {
      assert.doesNotThrow(() => shotsOf(take), `shape ${i} threw`);
    }
  });
});

describe("the guarantees, read as source", () => {
  test("the citation that was invented is gone, and stays gone", async () => {
    /*
      Three files cited Apple's HIG for a sentence about text staying on screen long enough
      to be read. It is not in the HIG. It was the authority under the most load-bearing
      timing decision in the recipe, and it was copied twice before anyone looked.
    */
    const files = [
      "../apps/render/src/recipes/timing.ts",
      "../apps/render/src/recipes/Tutorial.tsx",
      "../docs/tutorials.md",
      "../tests/tutorial.test.ts",
    ];
    for (const f of files) {
      const src = await readFile(new URL(f, import.meta.url), "utf8");
      assert.ok(!src.includes("long enough for people to read"), `${f} cites a sentence Apple never wrote`);
    }
  });

  test("the per-format zoom fudge does not come back", async () => {
    /*
      `push = device ? 0.5 : format.id === "v" ? 1.15 : 1` was a hand-fitted correction for
      something now measured: how far a 1x recording may be pushed depends on the size the
      format draws it at, and `videoWhole` is that number.
    */
    const src = await readFile(new URL("../apps/render/src/recipes/Tutorial.tsx", import.meta.url), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    assert.doesNotMatch(code, /format\.id === "v" \? 1\.15/, "the per-format fudge is back beside the measured ceiling");
    assert.doesNotMatch(code, /const push =/, "the camera is drawn as the shot list decided it, with no second opinion");
  });

  test("the depths are solved from boxes, not typed as literals", async () => {
    /*
      The old ramp interpolated between 1.36 and 1.12 by how near an edge a control was —
      the right instinct with no number behind it. The bound is computed now, and this is
      what stops the ramp being re-typed by the next person who wants it "a bit closer".
    */
    const src = await readFile(new URL("../apps/render/src/recipes/timing.ts", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("export function tutorialShots("));
    const code = body.slice(0, body.indexOf("\n/**")).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    assert.match(code, /fitScaleToBox\(/, "the tutorial camera must solve its framings");
    assert.match(code, /videoWhole\(/, "and cap them against the recording's own pixels");
    assert.doesNotMatch(code, /lerp\(1\.\d+, 1\.\d+/, "the hand-fitted depth ramp is back");
  });
});

/*
  2026-09-04, evening. The recording is no longer a 1x asset: the capture records at the
  device pixels and writes the ratio it got, and the camera reads it. The shot list has
  three new habits with it — a framing that holds the pointer's whole approach, a press
  whose effects run on the timeline, and a return to a wider view once the result has been
  read — and every move is the critically damped spring rather than a cubic.
*/
describe("the recording's own pixels, measured", () => {
  test("a take recorded at the device pixels doubles the ceiling, and an old take does not", () => {
    const one = videoWhole(FORMATS.h, VIEW);
    const two = videoWhole(FORMATS.h, VIEW, { videoRatio: 2 });
    assert.ok(Math.abs(two - one * 2) < 1e-9, `2x pixels are twice the ceiling, got ${one} and ${two}`);
    assert.equal(videoWhole(FORMATS.h, VIEW, { videoRatio: 0 }), one, "a ratio of nothing is a 1x take");
  });

  test("the press goes past the old ceiling only when the file can hold it", () => {
    const old = shotsOf(withMacros).shots.find((s) => s.reason.includes("resume — pressing"))!;
    const fresh = shotsOf({ ...withMacros, videoRatio: 2 } as unknown as typeof session).shots.find((s) => s.reason.includes("resume — pressing"))!;
    const one = videoWhole(FORMATS.h, VIEW);
    assert.ok(old.end.scale <= one * 1.35 + 1e-9, `a 1x take pressed to ${old.end.scale.toFixed(2)}, past its file`);
    assert.ok(fresh.end.scale > 2, `a 2x take should press well past 2, got ${fresh.end.scale.toFixed(2)}`);
    assert.ok(fresh.end.scale <= one * 2 * 1.35 + 1e-9, "and still not past the doubled ceiling");
  });
});

describe("how a move is shaped", () => {
  test("the push departs from rest, is nearly there when the press lands, and lands over the last third", () => {
    const { shots } = shotsOf({ ...withMacros, videoRatio: 2 } as unknown as typeof session);
    const push = shots.find((s) => s.reason.includes("resume — pressing"))!;
    const span = push.to - push.from;
    const at = (t: number) => cameraAt(shots, push.from + Math.round(span * t), 15).framing.scale;
    const share = (t: number) => (at(t) - push.start.scale) / (push.end.scale - push.start.scale);
    assert.ok(share(0.1) < 0.2, `a body on a spring has barely moved at a tenth of its time, got ${share(0.1).toFixed(2)}`);
    assert.ok(share(2 / 3) > 0.93, `and is nearly there when the press lands, got ${share(2 / 3).toFixed(2)}`);
    assert.ok(Math.abs(share(1) - 1) < 1e-6, "and exactly there at the end");
    let last = -1;
    for (let f = push.from; f <= push.to; f++) {
      const s = cameraAt(shots, f, 15).framing.scale;
      assert.ok(s >= last - 1e-9, "a push never backs up");
      assert.ok(s <= push.end.scale + 1e-9, "and never overshoots its own end");
      last = s;
    }
  });
});

describe("what the step knows about its presses", () => {
  test("every product press is on the timeline, in order, inside the step", () => {
    const { plan } = shotsOf(session);
    for (const step of plan.steps) {
      assert.ok(step.presses.length >= 1, `step ${step.mark} pressed something`);
      assert.equal(step.presses[0].frame, step.pressAt, "the first press is the step's press");
      for (const p of step.presses) assert.ok(p.frame >= step.cardTo && p.frame < step.to, "a press lands inside the picture");
      for (let i = 1; i < step.presses.length; i++) assert.ok(step.presses[i].frame >= step.presses[i - 1].frame);
    }
  });

  test("the ring is done a beat after the press, whatever the page did", () => {
    const { plan } = shotsOf(session);
    for (const step of plan.steps) assert.ok(step.calloutTo <= step.pressAt + 15, `step ${step.mark} rings on after its press`);
  });
});

describe("the framing holds the pointer's approach", () => {
  const far = { ...withMacros, videoRatio: 2, events: [{ t: 500, kind: "move", x: 1500, y: 900 }, ...withMacros.events] } as unknown as typeof session;
  const beyond = { ...withMacros, videoRatio: 2, events: [{ t: 999, kind: "move", x: 1900, y: 1060 }, ...withMacros.events] } as unknown as typeof session;
  const near = { ...withMacros, videoRatio: 2 } as unknown as typeof session;
  const framedOf = (take: typeof session, mark: string) => shotsOf(take).shots.find((s) => s.reason.includes(`${mark} — approaching`))!.end.scale;

  test("a pointer setting off from across the page widens the framing so its travel is in frame", () => {
    assert.ok(framedOf(far, "open") < framedOf(near, "open") - 0.1, `far ${framedOf(far, "open").toFixed(2)} vs near ${framedOf(near, "open").toFixed(2)}`);
    /*
      And the framing LOOKS where it was solved: the resting shot's visible band must hold
      both the control and the point the pointer sets off from. It used to be solved about
      the widened box and drawn at the click point, which put the start 37 px below the
      frame on this very fixture.
    */
    const rest = shotsOf(far).shots.find((s) => s.reason.includes("open — approaching"))!.end;
    const band = visibleBand(rest);
    const start = { x: 1220 / 1920, y: 765 / 1080 };
    assert.ok(start.x > band.loX && start.x < band.hiX && start.y > band.lo && start.y < band.hi, `the pointer's start (${start.x.toFixed(2)}, ${start.y.toFixed(2)}) is outside the band x ${band.loX.toFixed(2)}..${band.hiX.toFixed(2)} y ${band.lo.toFixed(2)}..${band.hi.toFixed(2)}`);
    assert.ok(0.219 > band.loX && 0.219 < band.hiX && 0.352 > band.lo && 0.352 < band.hi, "and so is the control");
  });

  test("and one that would need most of the page enters from the edge instead", () => {
    assert.equal(framedOf(beyond, "open"), framedOf(near, "open"));
  });
});

describe("after the result has been read", () => {
  test("a long enough step opens back out, a fifth wider, and holds there", () => {
    const { plan, shots } = shotsOf({ ...withMacros, videoRatio: 2 } as unknown as typeof session);
    for (const step of plan.steps) {
      const opening = shots.find((s) => s.reason.includes(`${step.mark} — opening out`));
      assert.ok(opening, `step ${step.mark} spans ${step.to - step.from} frames and never opens out`);
      const rest = shots.find((s) => s.reason.includes(`${step.mark} — held on what it did`))!;
      assert.ok(rest.to - rest.from >= 60, "the result is read for two seconds first");
      assert.ok(opening!.end.scale <= opening!.start.scale / 1.1, "the return is a visible widening");
      assert.ok(opening!.end.scale >= 1, "and never past the whole page");
      const after = shots.find((s) => s.from === opening!.to)!;
      assert.match(after.reason, /held/);
      assert.ok(after.to === step.to, "the wide view holds to the end of the step");
    }
  });

  test("a step with no room for a beat of the wide view keeps the close one", () => {
    const short = { ...brief, lines: brief.lines.map((l) => (l.mark ? { ...l, text: { en: "Go." } } : l)) } as Brief;
    const take = { ...withMacros, durationMs: 7000, marks: [{ name: "open", t: 1000 }, { name: "resume", t: 4000 }], events: [
      { t: 1000, kind: "mark", name: "open" },
      { t: 1500, kind: "click", x: 420, y: 380 },
      { t: 4000, kind: "mark", name: "resume" },
      { t: 4500, kind: "click", x: 700, y: 360 },
    ] } as unknown as typeof session;
    const plan = tutorialPlan(take, short, short.hooks[0], "en");
    const shots = tutorialShots(take, short, plan, FORMATS.h);
    assert.ok(!shots.some((s) => s.reason.includes("opening out")), "nothing to open out of in a step this short");
  });
});

describe("the callout's ramp", () => {
  test("never throws, is zero outside its span, and shares the span when it is short", () => {
    for (const [from, to] of [[0, 0], [10, 10], [10, 11], [10, 12], [10, 13], [10, 25], [10, 60], [60, 10]]) {
      for (let f = -5; f < 70; f++) {
        const v = calloutRamp(f, from, to, 15);
        assert.ok(v >= 0 && v <= 1, `ramp out of range at ${f} for ${from}..${to}`);
        if (f <= from || f >= to) assert.equal(v, 0, `lit outside its span at ${f} for ${from}..${to}`);
      }
    }
    assert.equal(calloutRamp(40, 10, 60, 15), 1, "fully up in the middle");
    assert.ok(calloutRamp(12, 10, 60, 15) > 0 && calloutRamp(12, 10, 60, 15) < 1, "on its way up");
    assert.ok(calloutRamp(58, 10, 60, 15) > 0 && calloutRamp(58, 10, 60, 15) < 1, "on its way down");
    /* The case that stopped a render: a press thirteen frames after the card, the ring done a beat later. */
    assert.equal(calloutRamp(125, 125, 148, 15), 0, "dark on its first frame");
    assert.ok(calloutRamp(130, 125, 148, 15) > 0 && calloutRamp(130, 125, 148, 15) < 1, "rising");
    assert.ok(calloutRamp(136, 125, 148, 15) > 0.9, "up inside a short span");
    assert.ok(calloutRamp(146, 125, 148, 15) < 0.3, "and down again before it ends");
  });
});

describe("what a press is not", () => {
  test("a chrome click before the product's is not the step's press", () => {
    const consent = { ...session, events: [session.events[0], { t: 1500, kind: "click", x: 1800, y: 1000, role: "chrome" }, ...session.events.slice(1)] } as unknown as typeof session;
    const { plan } = shotsOf(consent);
    const first = plan.steps[0];
    assert.equal(first.presses.length, 1, "the consent click is not a press");
    assert.equal(first.presses[0].x, 420, "the product click is");
    assert.ok(first.pressAt > first.cardTo + 10, "and the press frame is the product click's, not the banner's");
  });
});

describe("the guarantees, read as source (evening)", () => {
  test("no press effect runs on the recording's clock", async () => {
    const src = await readFile(new URL("../apps/render/src/recipes/Tutorial.tsx", import.meta.url), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    assert.doesNotMatch(code, /\/ 450/, "a ripple aged in the recording's milliseconds freezes with the picture");
    assert.doesNotMatch(code, /cursorAt\(/, "the tween is gone; the pointer is Cap's spring");
  });

  test("bumping the capture version is what re-records a take", async () => {
    const src = await readFile(new URL("../packages/director/src/auto.ts", import.meta.url), "utf8");
    assert.match(src, /inputHash\("record", ELEMENT_CAPTURE_VERSION/, "the record key must carry the capture version, or a better capture never reaches an old workspace");
  });
});

describe("a control the mark could not see", () => {
  /*
    The tour's own order for a control below the fold: mark, the scroll that brings it into
    view, the press. Until the night of 2026-09-04 the mark captured nothing (the control was
    off-screen when it looked) and the plan read the step as its first action, the scroll —
    so no push, no framing on a control, no lift, no result. The capture now photographs the
    control the instant before the press (`at: "press"`, its box on the scrolled page), and
    the plan reads the press as the step.
  */
  const macrosOf = (take: typeof session) => (take as unknown as { macros: { mark: string; box: { x: number; y: number; width: number; height: number } }[] }).macros;
  const approached = {
    ...withMacros,
    videoRatio: 2,
    events: [
      { t: 500, kind: "move", x: 300, y: 200 },
      { t: 1000, kind: "mark", name: "open" },
      { t: 1200, kind: "scroll", y: 700 },
      { t: 2300, kind: "move", x: 300, y: 200 },
      { t: 2750, kind: "move", x: 424, y: 380 },
      { t: 2750, kind: "click", x: 424, y: 380 },
      { t: 8000, kind: "mark", name: "resume" },
      { t: 9000, kind: "click", x: 700, y: 360 },
      { t: 12000, kind: "scroll", x: 960, y: 540 },
    ],
    macros: [{ ...macrosOf(withMacros)[0], at: "press", target: { x: 360, y: 340, width: 128, height: 80 } }, macrosOf(withMacros)[1]],
  } as unknown as typeof session;

  test("is a click step framed on the measured control, with a push straddling the press", () => {
    const { plan, shots } = shotsOf(approached);
    const step = plan.steps[0];
    assert.equal(step.kind, "click");
    const push = shots.find((s) => s.reason.includes("open — pressing"));
    assert.ok(push, "no push: the step was read as its scroll");
    assert.ok(push!.from <= step.pressAt && push!.to >= step.pressAt, "the push straddles the press");
    assert.ok(push!.end.scale > push!.start.scale, "and goes in");
    /*
      The pointer sets off from where it rested through the scroll — a pointer is
      viewport-fixed, the page moves under it — so the approach framing holds that point and
      the control on the scrolled page, and it must not collapse toward the whole page.
    */
    const framed = shots.find((s) => s.reason.includes("open — approaching"))!.end.scale;
    assert.ok(framed >= 1.12, `the framing collapsed to ${framed.toFixed(2)}`);
    assert.ok(shots.some((s) => s.reason.includes("open — settling")), "the press was judged at the next mark, so the result move exists");
  });

  test("never crops the control it was pressed on, walked frame by frame", () => {
    const { plan, shots } = shotsOf(approached);
    const step = plan.steps[0];
    const box = macrosOf(approached)[0].box;
    /* The shots that frame the control; after the press the camera is on the result. */
    const mine = shots.filter((s) => /open — (approaching|waiting|pressing)/.test(s.reason));
    assert.equal(mine.length, 3, "the step has its approach, its wait and its push");
    for (const shot of mine) {
      for (let f = shot.from; f < shot.to; f++) {
        const t = (f - shot.from) / Math.max(1, shot.to - shot.from);
        const scale = shot.start.scale + (shot.end.scale - shot.start.scale) * t;
        const fx = shot.start.fx + (shot.end.fx - shot.start.fx) * t;
        const fy = shot.start.fy + (shot.end.fy - shot.start.fy) * t;
        const cam = cameraTransform({ framing: { fx, fy, scale }, tilt: { rx: 0, ry: 0 }, entering: 1, enter: "cut", shot: 0 });
        const at = (v: number, size: number, d: number) => 0.5 + (v / size - 0.5) * cam.scale + d;
        assert.ok(at(box.x, VIEW.width, cam.dx) >= -1e-6 && at(box.x + box.width, VIEW.width, cam.dx) <= 1 + 1e-6, `${shot.reason} crops the control sideways`);
        assert.ok(at(box.y, VIEW.height, cam.dy) >= -1e-6 && at(box.y + box.height, VIEW.height, cam.dy) <= 1 + 1e-6, `${shot.reason} crops it vertically`);
      }
    }
  });

  test("the plan says where the ring may start, and it is after the scroll", () => {
    const { plan } = shotsOf(approached);
    const step = plan.steps[0];
    assert.ok(step.calloutFrom > step.cardTo, "a ring lit on the cut points at the page sliding past");
    assert.ok(step.calloutFrom <= step.pressAt);
  });
});

describe("a pointer resting at the edge", () => {
  test("does not collapse the framing to the whole page", () => {
    /* The previous click was in the top bar, 60 px from the edge; the control is central. */
    const edge = { ...withMacros, videoRatio: 2, events: [{ t: 500, kind: "move", x: 960, y: 60 }, ...withMacros.events] } as unknown as typeof session;
    const framed = shotsOf(edge).shots.find((s) => s.reason.includes("open — approaching"))!.end.scale;
    assert.ok(framed >= 1.4, `a pointer at the edge dragged the framing down to ${framed.toFixed(2)}`);
  });
});
