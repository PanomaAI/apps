/*
  Depth in a product film, and the three things that make it honest.

  Every other tool in this category infers depth from a flat picture, because a flat picture
  is all it has — and a monocular depth estimator trained on photographs reads an interface's
  contrast and salience as geometry, so panels come back bowed and card edges skew. We have
  never had to infer it: `MacroAsset` is the control the take actually clicked, rasterized by
  the page at up to eight device pixels per CSS pixel, with its rectangle in the recording's
  own coordinates. The lift is a lookup.

  What has to stay true:

  ALIGNED AT REST. The lifted plane is a COPY of a region sitting over its own source, so any
  offset that does not vanish at zero push shows as a doubled edge on every still frame. The
  differential is a function of `scale - 1` for exactly this reason.

  INSIDE THE CAPTURE'S CEILING. `pixelRatio` is documented as a maximum — draw the plane
  larger than its own density and it softens BEFORE the video behind it, which runs the depth
  cue backwards and makes the near thing look far.

  RAMPED, NEVER CUT. A plane that pops into existence is an image appearing. The whole cue is
  that it was always there and the camera moved.
*/
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFile } from "node:fs/promises";
import { liftAt } from "../apps/render/src/recipes/timing.ts";

const macro = (over: Partial<Parameters<typeof liftAt>[0]["macros"] extends readonly (infer M)[] | undefined ? M : never> = {}) => ({
  mark: "resume",
  file: "macro/resume.png",
  box: { x: 604, y: 323, width: 221, height: 75 },
  pixelRatio: 8,
  ...over,
});

const ask = (over: Partial<Parameters<typeof liftAt>[0]> = {}) =>
  liftAt({
    macros: [macro()],
    mark: "resume",
    frame: 60,
    from: 0,
    to: 120,
    beatFrames: 15,
    tickFrames: 5,
    focus: { fx: 0.37, fy: 0.33 },
    pageWidthPx: 1600,
    viewportWidth: 1920,
    ...over,
  });

describe("which part of the page is lifted", () => {
  test("the control the step is about, by its mark", () => {
    const lift = ask();
    assert.equal(lift?.planes.length, 1);
    assert.equal(lift?.planes[0].file, "macro/resume.png");
    /* Its rectangle is the page's, not a guess: this is DOM geometry, measured at capture. */
    assert.deepEqual(lift?.planes[0].box, { x: 604, y: 323, width: 221, height: 75 });
  });

  test("nothing, when the step has no mark or the take captured no macro for it", () => {
    assert.equal(ask({ mark: undefined }), null);
    assert.equal(ask({ macros: [] }), null);
    assert.equal(ask({ macros: undefined }), null);
  });

  test("nothing, when the camera would draw it past the density it was captured at", () => {
    /*
      The capture documents `pixelRatio` as a ceiling in so many words. Past it the plane is
      an upscale, so it softens first and the near thing reads as the far one — the cue
      inverted. A lift that does not fit is not drawn, rather than drawn badly.
    */
    const wide = macro().box.width * macro().pixelRatio; // 1768 canvas px at most
    const pageAt = (drawn: number) => (drawn * 1920) / macro().box.width;
    assert.ok(ask({ pageWidthPx: pageAt(wide - 1) }), "just inside the ceiling is drawn");
    assert.equal(ask({ pageWidthPx: pageAt(wide + 1) }), null, "just past it is refused");
  });
});

describe("when it is there", () => {
  test("it ramps in and out, and is absent at both edges of the step", () => {
    assert.equal(ask({ frame: 0 }), null, "not on the cut");
    assert.equal(ask({ frame: 4 }), null, "not before its tick");
    const arriving = ask({ frame: 12 });
    assert.ok(arriving && arriving.planes[0].depth > 0 && arriving.planes[0].depth < 1, "arriving, not popped");
    assert.equal(ask({ frame: 60 })?.planes[0].depth, 1, "held through the middle");
    assert.equal(ask({ frame: 120 }), null, "gone before the step ends");
  });

  test("a step with no room for a ramp gets no plane at all", () => {
    assert.equal(ask({ from: 0, to: 10 }), null);
    assert.equal(ask({ from: 40, to: 40 }), null);
  });

  test("it is parallax against where the camera is looking, not against the frame", () => {
    /* Without a focus there is nothing for a near plane to move RELATIVE to. */
    assert.deepEqual(ask()?.focus, { fx: 0.37, fy: 0.33 });
  });
});

describe("the guarantees, read as source", () => {
  test("the plane is exactly aligned with its source when the camera is still", async () => {
    /*
      The one rule that cannot be checked by calling anything: the differential must be a
      function of `scale - 1`, so that at rest it is one and the copy sits precisely over the
      pixels it was cut from. A constant gain would ghost every frame the camera holds — and
      a tutorial holds the camera on every single step.
    */
    const src = await readFile(new URL("../apps/render/src/lib/ProductWindow.tsx", import.meta.url), "utf8");
    assert.match(src, /Math\.max\(0, zoom\.scale - 1\)/, "the lift's gap must vanish at rest");
    const gain = /LIFT_GAIN = ([\d.]+)/.exec(src);
    assert.ok(gain, "LIFT_GAIN is named, so it can be argued with");
    assert.ok(Number(gain[1]) > 0 && Number(gain[1]) <= 0.12, `parallax past a tenth reads as a sticker sliding on glass, got ${gain?.[1]}`);
  });

  test("nothing anywhere estimates depth from the picture", async () => {
    /*
      The distinction this whole feature rests on. Depth here is read from geometry the
      browser reported at capture; the moment anything infers it from pixels, an interface
      starts bowing and the films acquire the exact artefact that gives every competitor
      away.
    */
    for (const f of ["../apps/render/src/lib/ProductWindow.tsx", "../apps/render/src/recipes/timing.ts", "../apps/render/src/recipes/Tutorial.tsx"]) {
      const src = await readFile(new URL(f, import.meta.url), "utf8");
      /*
        Block comments removed whole, not by line prefix. This repository's other
        source-reading guards strip lines that OPEN with a comment marker, which is enough
        for hunting colour literals and not enough here: the prose in these files argues
        about depth estimation by name, and a line-prefix filter leaves the argument in the
        code it is checking. This test failed on its own explanation first.
      */
      const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
      assert.doesNotMatch(code, /depthMap|estimateDepth|disparity|midas|monocular/i, `${f} infers depth instead of reading it`);
    }
  });
});

/*
  2026-09-04, evening. The plane used to be gone before the press, on the argument that a
  press changes the page under it. That is true of a navigation and false of everything
  else, and the capture already writes the control as it looked on the frame AFTER a press
  that stayed (`afterControl`). So the plane now swaps to that picture on the press frame
  and stays through the push and the hold — where the camera is closest — and is only taken
  down before the press when there is nothing true to swap it for.
*/
describe("through the press", () => {
  const after = { file: "macro/resume.control.png", pixelRatio: 8 };

  test("with an after-state it swaps on the press frame and stays", () => {
    const withAfter = { macros: [macro({ afterControl: after })], pressAt: 60 };
    assert.equal(ask({ ...withAfter, frame: 59 })?.planes[0].file, "macro/resume.png", "before the press, the control as it looked at its mark");
    assert.equal(ask({ ...withAfter, frame: 60 })?.planes[0].file, after.file, "on the press frame, as one swap, the control as pressed");
    assert.equal(ask({ ...withAfter, frame: 88 })?.planes[0].depth, 1, "and it is still there, fully, through the hold");
    assert.equal(ask({ ...withAfter, frame: 120 }), null, "gone only at the end of the step");
  });

  test("without one it is gone before the press, as it always was", () => {
    assert.ok((ask({ pressAt: 60, frame: 40 })?.planes[0].depth ?? 0) > 0, "on its way down before the press");
    assert.equal(ask({ pressAt: 60, frame: 60 }), null, "and gone on the press frame");
    assert.equal(ask({ pressAt: 60, frame: 90 }), null, "and after it");
  });

  test("a press before the plane could even arrive means no plane", () => {
    assert.equal(ask({ pressAt: 3, frame: 2 }), null);
  });
});

/*
  2026-09-04, night. A control the mark could not see — below the fold, the tour scrolls to
  it after the mark — is photographed the instant before the press instead, on the SCROLLED
  page (`at: "press"`). Its box is where the control is once the scroll is done, and
  nowhere before: lifted from the step's start it would float over whatever that box held
  before the scroll, a copy of a control over a page it was not cut from, for the length of
  the scroll — the doubled edge the first rule forbids. So its plane's life begins at the
  press.
*/
describe("a control photographed at the press", () => {
  const after = { file: "macro/resume.control.png", pixelRatio: 8 };

  test("is not lifted before the press, and what rises after it is the pressed control", () => {
    const pressed = { macros: [macro({ at: "press", afterControl: after })], pressAt: 60 };
    assert.equal(ask({ ...pressed, frame: 40 }), null, "before the scroll is done its box is a lie");
    assert.equal(ask({ ...pressed, frame: 60 }), null, "and it ramps in after the press rather than popping on it");
    const up = ask({ ...pressed, frame: 80 });
    assert.equal(up?.planes[0].file, after.file, "what rises is the pressed control");
    assert.equal(up?.planes[0].depth, 1, "fully, through the hold");
    assert.equal(ask({ ...pressed, frame: 120 }), null, "and gone at the end of the step");
  });

  test("with no after-state it lifts nothing at all", () => {
    for (const frame of [40, 60, 80]) assert.equal(ask({ macros: [macro({ at: "press" })], pressAt: 60, frame }), null);
  });

  test("and one that says it was photographed at its mark behaves as before", () => {
    const marked = { macros: [macro({ at: "mark", afterControl: after })], pressAt: 60 };
    assert.equal(ask({ ...marked, frame: 40 })?.planes[0].file, "macro/resume.png");
    assert.equal(ask({ ...marked, frame: 60 })?.planes[0].file, after.file);
  });
});

describe("when the page moved after the press", () => {
  test("the after-state is not trusted, and the plane goes before the press", () => {
    const after = { file: "macro/resume.control.png", pixelRatio: 8 };
    const scrolled = { macros: [macro({ afterControl: after })], pressAt: 60, settled: false };
    assert.equal(ask({ ...scrolled, frame: 60 }), null, "gone on the press frame");
    assert.ok((ask({ ...scrolled, frame: 40 })?.planes[0].depth ?? 0) > 0, "but there before it");
    assert.equal(ask({ ...scrolled, frame: 40 })?.planes[0].file, "macro/resume.png", "and it was the control as it looked at its mark");
  });
});
