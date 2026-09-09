# Depth, and what generation is actually for

> **Half of this is parked, 2026-09-04.** The LIFT — depth read from real DOM geometry —
> is live and is the half that mattered. The ELEMENTS half works, is measured, and is set
> down with the rest of the generative work: it is punctuation on three moments, and the
> renderer's own camera turned out to be the thing worth spending the effort on. Nothing
> buys anything unless `panoma-video elements` is run by hand.


Two changes, made together because they answer the same question from opposite ends: how a
film about software gets to feel like a space rather than a screen recording.

One of them costs nothing and is ours. The other costs about two dollars, once, ever.

## What came before, and why it was abandoned

Three attempts put generated footage near a product, and all three failed for the same
structural reason — the generated picture and the recorded one never shared a frame.

| attempt | where the generated part sat | why it failed |
| --- | --- | --- |
| b-roll | **beside** the product | shares no space, no camera and no subject with it |
| a plate | **behind** the product | two light sources, two cameras: a sticker on wallpaper |
| interpolation | **on** the product, redrawing it | measured at ~1 usable second per 8 billed, and worse than the camera we already had |

The measurement that ended the third is in [storyboard.md](storyboard.md): the honest head of
an interpolated clip runs about a second and the tail about a third of one, and in between the
model returns an interface that does not exist.

The fourth position is the one that works, and it is the only one left: **in front of the
product, in the same frame, at the same instant, without touching it.**

## 1. The lift: depth we read instead of depth we guess

Every other tool in this category infers depth from a flat picture, because a flat picture is
all it has. A monocular depth estimator is trained on photographs, and on an interface it
reads contrast and salience as geometry — so panels come back bowed and card edges skew. It
is the single clearest tell that a product shot was faked into 3D.

We have never had to infer it. `MacroAsset` has been written by every take for months: the
control the tour actually clicked, rasterized by Chromium itself at up to **eight device
pixels per CSS pixel**, with its rectangle in the recording's own coordinates. Real z-order,
measured at capture.

So the lift is a lookup. `liftAt` finds the macro for the step's mark and hands it to
`ProductWindow` as its own plane in front of the page. Two cues do the work and both are free:

- **Parallax.** The plane grows faster than the page under it as the camera pushes.
- **Sharpness.** The page is a video, and a video pushed into softens; the plane is a PNG at
  the density the page rendered it, so it stays crisp while everything behind it gives up
  detail. That is what a viewer reads as *nearer*.

Three rules keep it honest, and each one is a test in `tests/depth.test.ts`:

**The gap must vanish at rest.** The differential is a function of `scale - 1`, so at zero
push the lifted copy sits precisely over the pixels it was cut from. Any constant gain would
ghost a doubled edge on every frame the camera holds — and a tutorial holds the camera on
every single step.

**`LIFT_GAIN` stays under a tenth.** Past that the plane stops looking nearer and starts
looking like a sticker sliding on glass, which is the exact failure the plate had.

**A lift that exceeds its own density is not drawn.** The capture documents `pixelRatio` as a
ceiling in so many words. Drawn past it the plane softens *before* the video behind it, which
runs the depth cue backwards and makes the near thing look far. It is refused, not degraded.

A scroll gets no lift: a scroll is the whole page moving, and there is nothing in front of it.

**And the plane survives the press when there is something true to show.** It used to be
taken down before the press on the argument that a press changes the page under it — which
is true of a navigation and false of everything else. The capture already writes the control
as it looked on the frame *after* a press that stayed on the page (`afterControl`, the same
box at the same density), so `liftAt` swaps to that picture on the press frame, as one swap,
and the plane stays through the push and the rest, which is exactly where the camera is
closest and the pixels behind it are giving up the most. A press that navigated has nothing
true to swap to, and the plane is gone before it as before. With the recording now at the
device pixels the plane's *sharpness* argument is weaker than it was and its parallax is what
remains — capped by `LIFT_REACH`, because a push to 2.6 with the gain uncapped moved the plane
by about a seventh, which is the sticker. And the swap only happens when the page under the
box stayed put after the press: the after-state is cropped when the next mark is reached, so
on a step that presses and then scrolls it is a picture of the scrolled page, and the plane
goes before the press as it always did.

**A control the mark could not see is lifted from the press on, and only then.** The tour
scrolls to a below-the-fold control *after* its mark, so the capture photographs it the
instant before the press instead (`at: "press"`, since capture version 11), and its box is
the control's place on the *scrolled* page. That box is true from the moment the scroll is
done and false before it: a plane lifted from the step's start would float over whatever
that box held on the unscrolled page — a copy of a control over pixels it was not cut from,
which is the doubled edge the first rule forbids, for the whole length of the scroll. So
`liftAt` starts such a plane's life at the press: it ramps in a tick after the press frame
showing the pressed control (`afterControl`), and a press-captured control with no
after-state lifts nothing at all. The scroll before the press does not count as the page
moving under the control — `stableTo` is the first scroll *after* the press — so the swap is
trusted on exactly the steps this was built for.

## 2. Elements: what a video model should actually be paid for

A model is asked for **matter on a flat ground and nothing else** — glass bursting, sparks,
ink, dust. That is composited with a blend that makes the ground disappear. Neither blend
replaces a pixel of the interface; both leave every letter underneath exactly where it was and
entirely readable.

### The rule that decides the blend

The element's ground is the **opposite** of the film's stage.

| the app is | the element is on | blended with | what happens |
| --- | --- | --- | --- |
| dark | black | `screen` | the black vanishes, the light adds |
| light | white | `multiply` | the white vanishes, the matter darkens |

This is derived from `direction.scheme`, never chosen, because getting it wrong is not a
matter of degree. Screen-blending a black element over a near-white interface produces
**nothing at all** — screen of white with anything is white — and that is precisely what the
first composite attempted here did.

### The ground has to actually be flat, and it will not be

The first element bought here *looked* black in every frame. It measured a **mean luma of 40
out of 255, with 12% of its busiest frame at true black.** Composited with `screen` that lifts
the entire interface by sixteen per cent, evenly — which looks like a badly exported video and
nothing like an effect.

So the pipeline is **buy → crush → measure → keep**:

- `crushGround` remaps the ground's own end of the range to the limit. On that clip it moved
  true black from 12% to **67%**.
- `groundOf` then measures the *busiest* frame, and `GROUND_FLOOR` (60%) decides. An element
  that still does not pass is named and deleted rather than kept and used.

```bash
panoma-video elements --scheme=light          # the whole library, on the ground a light app needs
panoma-video elements --scheme=dark --only=glass-burst
```

### Why this is worth buying where interpolation was not

- An element is **text**-to-video, so it escapes the eight seconds a conditioning frame forces
  on Veo. Four seconds, **$0.40**.
- An element refers to **no product**. A shattering is a shattering. So the library is bought
  **once** — four elements is under two dollars — and every film after that costs nothing.

Interpolation was $0.80 per shot, per film, forever, for one usable second.

### Where they go

At the **press**, and that is the important one: the session log knows the exact millisecond
and the exact pixel box of every click, so the element lands on the control however far the
camera has pushed. Twelve frames at most — this is punctuation, and punctuation that lingers
is a video playing over a video.

The burst is drawn *outside* the product window, over the whole frame. Inside the window's own
transform it would blend against the page's white and disappear.

## What this is not

It is seasoning, not the meal. The film is still the recording, panoma video's own camera
and its own type. Generation buys four short clips, once, and touches three moments.

The larger of the two changes here is the one that cost nothing.
