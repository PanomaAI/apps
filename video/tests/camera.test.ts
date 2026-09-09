/*
  The camera is the difference between footage and an edit, so its shot list has
  to hold two promises: it covers the whole piece without gaps, and every arrival
  lands on the grid. Both are cheap to assert and expensive to notice by eye.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Brief } from "@panoma/video-core";
import { cameraAt, cameraTransform, castPlan, castShots, castSpeed, visibleBand, type CastSession } from "@panoma/video-render/timing";

const brief: Brief = {
  id: "cam",
  recipe: "ScreenCast",
  langs: ["en"],
  bpm: 120,
  fps: 30,
  hooks: [{ id: "h", text: { en: "x" } }],
  lines: [],
};
const BAR = 60;

const session: CastSession = {
  viewport: { width: 1920, height: 1080 },
  durationMs: 18_000,
  readyMs: 2000,
  events: [
    { t: 4000, kind: "click", x: 400, y: 300 },
    { t: 10_000, kind: "click", x: 1500, y: 800 },
  ],
};

test("the shot list covers the piece with no gap and no overlap", () => {
  const plan = castPlan(session, brief);
  const shots = castShots(session, brief, plan);
  assert.ok(shots.length >= 4, `expected an edit, got ${shots.length} shot(s)`);
  assert.equal(shots[0].from, 0);
  assert.equal(shots[shots.length - 1].to, plan.durationInFrames);
  for (let i = 1; i < shots.length; i++) {
    assert.equal(shots[i].from, shots[i - 1].to, `gap or overlap before shot ${i}`);
    assert.ok(shots[i].to > shots[i].from, `shot ${i} has no duration`);
  }
});

test("every cut lands on a bar", () => {
  /*
    2026-09-04: a shot boundary is a cut only when the framing jumps. The punch is two
    shots now — the spring to the click and the hold after it — and the seam between them
    is continuous, so the old "every shot starts on a bar" became "every DISCONTINUITY
    starts on a bar". A seam with the same framing on both sides is not a cut.
  */
  const plan = castPlan(session, brief);
  const shots = castShots(session, brief, plan);
  for (let i = 1; i < shots.length; i++) {
    const shot = shots[i];
    const before = shots[i - 1].end;
    const seam = Math.abs(before.fx - shot.start.fx) < 1e-9 && Math.abs(before.fy - shot.start.fy) < 1e-9 && Math.abs(before.scale - shot.start.scale) < 1e-9;
    if (seam) continue;
    assert.equal(shot.from % BAR, 0, `cut off the grid at ${shot.from} (${shot.reason})`);
  }
});

test("the edit opens wide, punches on the action, and closes wide", () => {
  const plan = castPlan(session, brief);
  const shots = castShots(session, brief, plan);
  assert.equal(shots[0].reason, "establish");
  assert.ok(shots[0].start.scale <= 1.05, "the opening must show the whole product");
  assert.ok(shots.some((s) => s.reason.startsWith("punch")), "the clicks must be punched");
  assert.ok(shots.some((s) => s.start.scale > 1.4), "a punch must actually push in");
  assert.equal(shots[shots.length - 1].reason, "close");
  assert.ok(shots[shots.length - 1].end.scale <= 1.02, "the close must pull back");
});

test("a take with no clicks still gets an edit, not a freeze", () => {
  const quiet = { ...session, events: [] };
  const plan = castPlan(quiet, brief);
  const shots = castShots(quiet, brief, plan);
  assert.ok(shots.length >= 1);
  assert.equal(shots[0].from, 0);
  assert.equal(shots[shots.length - 1].to, plan.durationInFrames);
  for (const s of shots) assert.ok(s.start.scale !== s.end.scale || s.reason === "close", "a still shot is a dead shot");
});

test("the camera never exposes the edge of the recording", () => {
  const plan = castPlan(session, brief);
  const shots = castShots(session, brief, plan);
  for (let frame = 0; frame < plan.durationInFrames; frame += 3) {
    const t = cameraTransform(cameraAt(shots, frame, 15));
    const limit = (t.scale - 1) / 2 + 1e-9;
    assert.ok(Math.abs(t.dx) <= limit && Math.abs(t.dy) <= limit, `frame ${frame} pans past the edge`);
    assert.ok(t.scale >= 1, `frame ${frame} scales below 1`);
  }
});

test("the camera moves continuously inside a shot", () => {
  const plan = castPlan(session, brief);
  const shots = castShots(session, brief, plan);
  const shot = shots[0];
  let previous = cameraAt(shots, shot.from, 15).framing.scale;
  for (let frame = shot.from + 1; frame < shot.to; frame++) {
    const scale = cameraAt(shots, frame, 15).framing.scale;
    assert.ok(Math.abs(scale - previous) < 0.05, `jump inside a shot at ${frame}`);
    previous = scale;
  }
});

test("chrome events earn nothing: a consent click never gets a punch", () => {
  const withBanner: CastSession = {
    ...session,
    events: [
      { t: 2600, kind: "click", x: 1800, y: 1040, role: "chrome" },
      { t: 8000, kind: "click", x: 700, y: 400, role: "product" },
    ],
  };
  const plan = castPlan(withBanner, brief);
  const shots = castShots(withBanner, brief, plan);
  const punches = shots.filter((s) => s.reason.startsWith("punch"));
  assert.equal(punches.length, 1, "only the product click deserves a punch");
  assert.ok(Math.abs(punches[0].start.fy - 400 / 1080) < 1e-9, "the punch must be on the product click");
});

test("a click tightens and a scroll opens", () => {
  const mixed: CastSession = {
    ...session,
    events: [
      { t: 4000, kind: "click", x: 400, y: 300 },
      { t: 10_000, kind: "scroll", y: 800 },
    ],
  };
  const plan = castPlan(mixed, brief);
  const shots = castShots(mixed, brief, plan);
  const punch = shots.find((s) => s.reason.startsWith("punch"));
  const open = shots.find((s) => s.reason.startsWith("open on scroll"));
  assert.ok(punch && punch.start.scale > 1.4, "a click must close in");
  assert.ok(open && open.end.scale <= 1.05, "a scroll must open out");
  assert.ok(open && open.start.scale > open.end.scale, "the opening must travel outward");
});

test("the cut lands before the click that causes it", () => {
  const plan = castPlan(session, brief);
  const shots = castShots(session, brief, plan);
  const ready = session.readyMs ?? 0;
  for (const e of session.events) {
    if (e.kind !== "click") continue;
    const at = plan.videoStart + Math.round(((e.t - ready) / 1000) * 30);
    const punch = shots.find((s) => s.reason.startsWith("punch") && at >= s.from && at < s.to);
    if (!punch) continue;
    assert.ok(punch.from <= at, "the punch must arrive no later than its click");
  }
});

test("no shot holds a crop while the action happens outside it", () => {
  /* The verified defect: 80 frames framing a banner while the real click was
     at the very top of the viewport, entirely off-crop. */
  const offCrop: CastSession = {
    ...session,
    events: [
      { t: 4000, kind: "click", x: 1700, y: 1040, role: "product" },
      { t: 5800, kind: "click", x: 200, y: 30, role: "product" },
    ],
  };
  const plan = castPlan(offCrop, brief);
  const shots = castShots(offCrop, brief, plan);
  const ready = offCrop.readyMs ?? 0;
  for (const shot of shots) {
    const band = visibleBand(shot.end);
    for (const e of offCrop.events) {
      if (e.kind !== "click") continue;
      const at = plan.videoStart + Math.round(((e.t - ready) / 1000) * 30);
      if (at <= shot.from + 15 || at >= shot.to) continue;
      const fx = e.x / offCrop.viewport.width;
      const fy = e.y / offCrop.viewport.height;
      assert.ok(
        fy >= band.lo - 1e-6 && fy <= band.hi + 1e-6 && fx >= band.loX - 1e-6 && fx <= band.hiX + 1e-6,
        `shot "${shot.reason}" holds a crop while a click at (${fx.toFixed(2)}, ${fy.toFixed(2)}) is off screen`,
      );
    }
  }
});

test("a punch that has to open takes its hold with it", () => {
  /*
    Rule 4 is applied to the punch and its hold as one unit, because since 2026-09-04 the
    punch is two shots. Two clicks in opposite corners eleven frames apart: the second one
    falls inside the first punch and too late in it to split, so the punch opens. Opening
    only the push left the hold starting back at 1.33 on the very crop that could not see
    the click — a discontinuity nobody declared, at frame 155, on neither a bar nor a beat,
    onto a framing this rule exists to forbid.
  */
  const crowded: CastSession = {
    ...session,
    events: [
      { t: 4667, kind: "click", x: 1700, y: 60, role: "product" },
      { t: 5000, kind: "click", x: 120, y: 1020, role: "product" },
    ],
  };
  const plan = castPlan(crowded, brief);
  const shots = castShots(crowded, brief, plan);
  const opened = shots.findIndex((s) => s.reason.includes("(opened"));
  assert.ok(opened > 0, `nothing had to open: ${shots.map((s) => s.reason).join(" | ")}`);
  const after = shots[opened + 1];
  assert.ok(after.reason.startsWith("hold"), `expected the hold after the opened push, got "${after.reason}"`);
  assert.deepEqual(after.start, shots[opened].end, "the hold jumps back into the crop its push had to open");
  /* And the seam stays continuous, so the piece still cuts only on the grid. */
  for (let i = 1; i < shots.length; i++) {
    const before = shots[i - 1].end;
    const start = shots[i].start;
    if (Math.abs(before.fx - start.fx) < 1e-9 && Math.abs(before.fy - start.fy) < 1e-9 && Math.abs(before.scale - start.scale) < 1e-9) continue;
    assert.equal(shots[i].from % BAR, 0, `cut off the grid at ${shots[i].from} (${shots[i].reason})`);
  }
});

test("nothing holds still for more than a bar and a half", () => {
  const plan = castPlan(session, brief);
  const shots = castShots(session, brief, plan);
  for (const shot of shots) {
    const still = shot.start.scale === shot.end.scale && shot.start.fx === shot.end.fx && shot.start.fy === shot.end.fy;
    assert.ok(!still || shot.to - shot.from <= 90, `dead air: "${shot.reason}" holds still for ${shot.to - shot.from} frames`);
  }
});

test("a 25 fps take is conformed to a 30 fps timeline, not resampled into judder", () => {
  /* Playwright records at 25 and does not expose the setting. Seeking a 30 fps
     timeline into it repeats one source frame in every six — five freezes a
     second, which is what a scroll looks like when it makes people seasick. */
  const pal: CastSession = { ...session, fps: 25 };
  assert.ok(Math.abs(castSpeed(pal, 30) - 30 / 25) < 1e-9);

  const plan = castPlan(pal, brief);
  /* Every rendered frame must land on a distinct source frame. */
  const seen = new Set<number>();
  for (let frame = plan.videoStart; frame < plan.videoStart + plan.videoFrames; frame++) {
    const sourceSec = ((frame - plan.videoStart) / 30) * castSpeed(pal, 30);
    seen.add(Math.round(sourceSec * 25));
  }
  assert.equal(seen.size, plan.videoFrames, "a conformed take must never repeat a frame");
});

test("a take that already matches the timeline is left alone", () => {
  assert.equal(castSpeed({ ...session, fps: 30 }, 30), 1);
  assert.equal(castSpeed({ ...session, fps: undefined }, 30), 1);
  /* Faster footage is never sped up by accident. */
  assert.equal(castSpeed({ ...session, fps: 60 }, 30), 1);
});

test("conforming spends one timeline frame per source frame, so the take tightens", () => {
  const plan30 = castPlan({ ...session, fps: 30 }, brief);
  const plan25 = castPlan({ ...session, fps: 25 }, brief);
  assert.ok(plan25.videoFrames < plan30.videoFrames, "25 fps footage needs fewer timeline frames");
  /* 16 s of 25 fps footage is 400 frames, and it gets exactly 400. */
  assert.equal(plan25.videoFrames, Math.ceil(((18_000 - 2000) / 1000) * 25));
});

/*
  Photosensitivity, handled where it is deterministic. ITU-R BT.1702-3 exempts flashes
  whose leading edges are at least 334 ms apart (60 Hz material); a flash-enter is a
  white frame, so two of them closer than that would be the one thing a product video
  can do to a viewer that a review should never have to catch. The shot list is where
  that is guaranteed.
*/
test("two flash enters are never closer than 334 ms, whatever the take does", () => {
  const busy: CastSession = {
    viewport: { width: 1920, height: 1080 },
    durationMs: 20_000,
    readyMs: 1000,
    events: Array.from({ length: 12 }, (_, i) => ({ t: 1500 + i * 700, kind: "click" as const, x: 200 + i * 100, y: 300 + (i % 3) * 150 })),
  };
  const plan = castPlan(busy, brief);
  const shots = castShots(busy, brief, plan);
  const flashes = shots.filter((s) => s.enter === "flash").map((s) => s.from);
  for (let i = 1; i < flashes.length; i++) {
    assert.ok(((flashes[i] - flashes[i - 1]) / 30) * 1000 >= 334, `flashes ${flashes[i - 1]} and ${flashes[i]} are too close`);
  }
});

/*
  And the difference between two products' edits.

  A film used to differ from another film only in which pixels were inside the frame:
  the push depths and the transitions were literals in timing.ts, so two applications
  whose material puts a click in the same place cut identically. The direction now
  carries a push range, the transitions it allows and the product's own seed, and this
  is the assertion that the difference is STRUCTURAL rather than a shade.
*/
import { deriveDirection, ROWS } from "@panoma/video-brand/direction";
import { defaultColors, type BrandProfile } from "@panoma/video-brand";

const profile = (name: string, background: string, primary: string, confidence: "high" | "low"): BrandProfile => ({
  source: { extractedAt: "2026-09-03T00:00:00.000Z" },
  name,
  colors: {
    ...defaultColors(),
    primary: { hex: primary, confidence, origin: "census" },
    background: { hex: background, confidence: "high", origin: "body" },
    text: { hex: "#f4f2ea", confidence: "high", origin: "css-token:--ink" },
  },
  tokens: {},
  scheme: { supports: ["dark"], default: "dark" },
  type: { heading: { category: "sans", family: "Geist" }, body: { category: "sans", family: "Geist" }, mono: { category: "mono", family: "Geist Mono" } },
  tone: { register: "neutral", metrics: {} },
});

const motionOf = (d: ReturnType<typeof deriveDirection>) => ({ push: d.motion.push, enters: d.motion.enters, seed: d.seed });

test("two products with the same material do not get the same edit", () => {
  /* A click dead centre, so the depth lands on the range's own end and the number is readable. */
  const centred: CastSession = { ...session, events: [{ t: 4000, kind: "click", x: 960, y: 540 }] };
  const plan = castPlan(centred, brief);
  /* One with flows and a trusted colour (kinetic); one whose tour changed nothing (editorial). */
  const kinetic = deriveDirection(profile("Universend", "#02030a", "#dbff64", "high"), { flows: 3 });
  const editorial = deriveDirection(profile("Panoma", "#02030a", "#dbff64", "high"), { flows: 0 });
  assert.equal(kinetic.name, "kinetic");
  assert.equal(editorial.name, "editorial");

  const a = castShots(centred, brief, plan, motionOf(kinetic));
  const b = castShots(centred, brief, plan, motionOf(editorial));
  const punch = (shots: typeof a) => shots.find((s) => s.reason.startsWith("punch"))!;

  /* The camera closes harder on a product that does something than on one that shows itself. */
  assert.equal(punch(a).end.scale, ROWS.kinetic.push[1]);
  assert.equal(punch(b).end.scale, ROWS.editorial.push[1]);
  assert.ok(punch(a).end.scale > punch(b).end.scale);
  /* The first enter is the direction's seeded choice, not a fixed transition for this
     fixture's name. A versioned seed may choose a cut while the kinetic row still permits flashes. */
  assert.equal(punch(a).enter, kinetic.motion.enters[0]);
  assert.equal(punch(b).enter, editorial.motion.enters[0]);
  assert.ok(kinetic.motion.enters.includes("flash"), "the kinetic direction lost its distinct transition vocabulary");
  assert.ok(!b.some((s) => s.enter === "flash"), "an editorial edit flashed");
  assert.deepEqual(castShots(centred, brief, plan, motionOf(kinetic)), a, "the seeded edit must be repeatable");
});

test("an unmeasured product cuts, and never flashes at something it cannot vouch for", () => {
  const plan = castPlan(session, brief);
  /* Nothing trusted at all: the row that needs no colour to be right. */
  const unmeasured = profile("Unknown", "#02030a", "#777777", "low");
  const plain = deriveDirection(
    { ...unmeasured, colors: { ...unmeasured.colors, background: { hex: "#02030a", confidence: "low", origin: "default" }, text: { hex: "#f4f2ea", confidence: "low", origin: "default" } } },
    { flows: 2 },
  );
  assert.equal(plain.name, "plain");
  const shots = castShots(session, brief, plan, motionOf(plain));
  assert.ok(shots.every((s) => s.enter === "cut"), "a plain direction used a transition it has no confidence for");
});

test("with no direction the edit is exactly what it was before directions existed", () => {
  const centred: CastSession = { ...session, events: [{ t: 4000, kind: "click", x: 960, y: 540 }] };
  const plan = castPlan(centred, brief);
  const punch = castShots(centred, brief, plan).find((s) => s.reason.startsWith("punch"))!;
  assert.equal(punch.end.scale, 1.68);
  assert.equal(punch.enter, "flash");
});
