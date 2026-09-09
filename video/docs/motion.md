# Motion

> The cursor is there before the click. That is the whole difference.

`apps/render/src/recipes/motion.ts` is the arithmetic behind four things a viewer
feels without naming: a cursor that looks intentional, keystrokes that read like
typing, waiting that gets hurried, and a camera that pans between two clicks instead
of zooming out and back in. It is plain TypeScript with no JSX — the same rule as
`timing.ts`, for the same reason: a number inside a component can only be tested by
rendering, and a number here is arithmetic.

Every function is a pure function of the session log. No clock, no random, no state
between calls; the same inputs give the same array, and a test can assert the
arrival.

The recorder's source scroll is a separate operation in `packages/capture/src/scroll.ts`.
It animates the named target's actual scrollable ancestors on one eased browser clock,
then records the completed movement and its duration. The camera and cursor therefore
read the final viewport coordinates even when the window itself never moved. See
[tour.md](tour.md#scrolling-inside-the-product).

## The recorded clock

Capture version 17 starts the camera through Playwright's public
[`page.screencast.start({ path, size, onFrame })`](https://playwright.dev/docs/api/class-screencast#screencast-start).
The callback supplies the browser's presentation timestamp in Unix milliseconds;
the installed encoder uses the same timestamp and makes its first frame video zero.
Page creation and callback arrival are not that instant. Assuming they were could
put the real result before its logged click, so a proof seeking just before the
click could begin after the action had already finished.

`packages/capture/src/clock.ts` measures that origin and fails after a bounded wait
if no valid timestamp arrives. The callback only reads metadata. The 2x camera,
frame stream, encoder and image quality stay the same. Before a session is saved,
the measured offset is applied once to its marks, events, ready time, endpoint,
assets and settled-result clock. Scroll durations remain intervals. The separate
capture pass keeps its own clock; `recordTake` attaches its images to the corrected
camera times as before.

`SessionLog.videoClock` records the source, version, first-frame origin and applied
offset. All session times are already video-relative; consumers must not apply the
offset again. Older takes lack that evidence and need recording again to establish
alignment. Tests decode two independent color changes, including a navigation,
on desktop and mobile after an initial wait and delayed document response. A
small fixture also passed the older recorder, so it is an alignment regression
check, not a reproduction of every startup delay seen on a live product. Browser
input dispatch and the encoded 25 fps grid still bound the precision of a click.

Capture version 18 also prevents a quiet old screen from becoming a navigation's
result. Before a product press, the recorder keeps the tour's observed destination
or, when that adds no new destination, reads the same-origin anchor under the actual
pointer. An observed destination takes precedence over an intermediate link, so a
known redirect is followed to its result. `waitForReading` requires that destination
to arrive before the existing visible-content and geometry stability interval can
finish. Its total deadline stays 2.8 seconds; a destination that never arrives earns
no `resultAtMs`, and the planner must keep the full action window.

Destination matching keeps origin and normalized pathname exact (a trailing slash
is ignored). A path-only tour observation asserts neither query nor fragment.
Explicit query/fragment parts are checked exactly; a measured anchor includes both,
even when empty. An observation already matching the pre-press page is skipped, so
it cannot shadow a link to a different query or fragment. External/non-web links
do not add a guard, and unchanged routes or local toggles keep the same readiness
behavior. Tests hold a catalog unchanged for one second before a client navigation,
then move the result's layout again; neither earlier quiet interval counts as the
completed result. This is evidence of the expected route and observed stability,
not a promise that arbitrary future asynchronous work can be predicted.

## Where it comes from

The look people recognise as expensive is not a taste, it is a handful of published
numbers. Cap (AGPL-3.0) publishes its cursor spring, the click look-ahead and the
keystroke layer; OpenScreen (MIT) publishes the chained-zoom rule; auto-editor
(Unlicense) the chunk-and-margin model. This file ports them, keeps the copyright
lines in its header, and keeps every constant in one table, `MOTION_PRESETS`, with
the source beside it. Nothing was taken from anything non-free.

## The cursor

`cursorAt` in `timing.ts` eases between logged intents. It is honest, and it looks
like a tween: the cursor chases every click and arrives *with* it, which a viewer
reads as "the machine did this". `cursorPath` replaces the tween with Cap's
spring-mass-damper and three rules around it.

1. **The target leads.** A spring chasing a moving target trails it by
   friction/tension seconds at steady state, whatever the mass (149 ms for the
   default profile). The target is sampled that far ahead, so the smoothed cursor
   sits on the recorded one instead of visibly behind it.
2. **A click is known in advance.** Within 500 ms of a click the target *is* the
   click point, and within 175 ms the stiffer "snappy" profile applies. The cursor
   glides there early and is at rest when the click lands. This is the one thing a
   scripted cursor gets wrong by default, and the reason this file exists.
3. **Tremor is dropped.** A point that reverses direction against its neighbours,
   with both hops under 1.5% of the viewport and all three within 100 ms, is a
   shake and is removed before the spring sees it.

The spring is Cap's closed-form solution, not a stepped one: the state after `dt` is
exact for any `dt`, so the 60 Hz simulation and the frame resampling never disagree.
Runs are split where the log implies the cursor was hidden — two points at different
places more than two seconds apart cannot be one glide, since the recorder's default
glide is 450 ms — and the spring restarts at rest on the far side rather than
gliding across a span it never saw (OpenScreen's `splitVisibleRuns`, inferred).

The path is one viewport-pixel point per **conformed** timeline frame of the take —
the same mapping as `eventFrame` in `timing.ts`, minus `videoStart` — so a ScreenCast
indexes it by frame (`cursorAtFrame`, with `frame - videoStart` as the index and nothing
to interpolate), and a Tutorial or a ReleaseTrailer, which seek by source time because
their picture is retimed, use `cursorAtMs`. Points are clamped to the viewport; a spring
can overshoot, a cursor cannot.

The press that follows is drawn the same way in every recipe, and on the same clock: the
plan writes each product press in composition frames (`TutorialStep.presses`, the
trailer's `presses` per proof, `eventFrame` for the cast) and the pulse, the ring and the
pointer's own give — a squash of a seventh that lands on the press frame and springs back
over the next few — all read that one number. A ripple aged in the recording's
milliseconds compresses to a flicker at the conform rate and freezes solid on a hold; the
tutorial found that first, and the trailer had the same `/ 450` until 2026-09-04.

`strength` blends the recorded path (0) with the spring (1). It is the one knob an
agent can set; the presets are Cap's four, and `mellow` is the default because it is
Cap's default.

## Keystroke chips

The recorder logs a `type` step as one event per burst and a `press` as its key
name, so a chip layer needs no OS hook — only the layout constants. `keystrokeChips`
turns the log into chips the way real typing looks: characters within 500 ms of each
other grow *one* chip, revealed key by key; a named key (Enter, Escape, ⌘K) is its
own chip with the glyphs every macOS visualiser uses. Each lingers 0.8 s past its
last key and fades 150 ms at both ends with Cap's 6 px bounce; only the newest six
survive.

A burst carries no per-character times, so they are spread at the recorder's own
default delay (55 ms). That is a reconstruction, not a measurement; the `type`
step's `delayMs` is not in the log, and a script that changes it will see chips
reveal at the wrong pace until the recorder writes the delay down.

`keystrokeLayout` says where the row goes in the coordinates of the box it is drawn
in — ProductWindow's content box for the `over` slot — sized from the caption size,
so chips scale with the type they sit near. The three positions are Cap's, with its
y-factors; the pixel constants (6 px bounce, 15 px gap from captions) are Cap's at
1080 and scale with the box height, as Cap's own layer does.

## Idle, and hurrying it

`idleSegments` finds the stretches where nothing happened. The predicate is
screenstudio-alt's, and it needs **both** halves: no input within 700 ms *and*
frozen pixels. Either alone lies — a page animates on its own with no input, and a
glide changes no pixel at all because the cursor is not in the video. Frozen is
ffmpeg `signalstats` YDIF below 0.5 per source frame, which the integrator supplies
as an array; a glide counts as busy from its departure to its arrival, a typed burst
for as long as its characters take, and a mark for the margin either side.

Runs are then shrunk by 200 ms on each end — auto-editor's `--margin`, seen from the
silent side — and anything under 1.2 s is left alone: that is a breath between
actions, not a wait.

`speedMap` turns the segments into a timeline→source mapping that plays idle at
`rate` and everything else at 1. It is piecewise linear, so it is monotonic and
continuous by construction; `sourceAt` seeks, `timelineAt` says where a click or a
mark lands once the waiting is hurried, and `timelineLength` is the new duration.

## Chained zooms

`chainZooms` applies OpenScreen's rule. Two focus regions closer than 1.5 s are
joined by a 1 s pan and the camera stays in; further apart, the first releases over
the transition window and the next attacks on its own, fully in 500 ms after its
moment. A zoom-out-and-back-in between two clicks a second apart is the single most
recognisable tell of an automatic edit.

The output is a list of links — `zoom`, `pan`, `release` — each with its focus and,
for a zoom, the frames of ease-in at its start (zero when a pan delivered the
camera already in). It is deliberately not snapped to the beat: the grid is the
recipe's business, and the recipe applies the same `snapBefore` the cast uses.

Since 2026-09-04 `castShots` in `timing.ts` reads it. The pairing is the only thing
taken — which moments are neighbours, and how long the pan between them is — and the
grid does the rest: the first punch's attack is snapped with `snapBefore` as it always
was, the pan starts on the beat at or before the latest frame that still lets it land by
the next click, keeps its length, and the punch it delivers is entered already in (a
`cut` with no transition, from 97% of its depth) and only settles. Between the two clicks
the camera never opens; `tests/recipes-motion.test.ts` walks every frame of it. Two
clicks so close that a one-second pan cannot fit after the first punch's own arrival are
the cast's crowd case, and it does what it always did — the newcomer's punch waits for the
grid. Only click→click pairs chain: a scroll opens (rule 2b), so there is nothing to keep
the camera in for. `castPlan`'s zoom segments — the studio's list, and `zoomAt` — still
release and attack; they are not what the camera draws.

The punch itself changed shape with it. It was one `slam` ease across its whole hold, up
to two bars, so the arrival was normalised to the hold and a long hold was a slow creep
with a hard cut at its head. It is two shots now: the critically damped spring from the
attack to half a second past the click (the tutorial's shape — the click lands about two
thirds of the way through the move), and a hold that drifts 1.2% so the encoder never
reads it as a stall. The seam between them is continuous and is not a cut; the hold's end
is, and lands on a bar. The trailer's proof is built the same way from its first press.

A chain leaves the bar grid at its first pan, and since 2026-09-05 it hands the grid back
on the way out. A panned-in punch's `attack` is an off-grid frame, and every frame derived
from it — the hold's end, and through it the next moment's attack — used to be off-grid
too: a whip, a flash or a cut on neither a bar nor a beat. `backToGrid` in `castShots` now
rounds those three frames to the bar the frame falls in, or to the next bar when that one
is already behind the punch's own arrival. Over 600 random sessions this took the cuts off
the bar from 292 to 7 and off the beat from 12 to 0, and cost nothing: the punch lands
after its click 203 times in 1760, where the unsnapped code did 222. The 7 that remain are
`open for off-crop action`, rule 4's split, which is on a beat because the beat before the
action it opens for is the whole point of where it cuts.

Rule 4 reads the punch and its hold as one unit, for the same reason. When a shot has to
open because a moment happens outside its crop and there is no room to split it honestly,
whatever continued that shot continues the opened one instead, keeping the move it had —
a hold keeps its 1.2% drift. Opening only the push left the hold starting back on the very
crop that could not see the click, a discontinuity nobody declared onto a framing the rule
exists to forbid; `tests/camera.test.ts` builds the two-clicks-in-opposite-corners take
that produced it.

## The dance, where the file has room

`recipes/pulse.ts` turns a track into one number per frame, and every recipe with a
picture reads it: the camera is punched in by the beat *after* `cameraTransform`
(`dancedZoom`, only ever larger, so a framing that kept the recording's edge out still
does), the cards pump with the kick (`dancedScale`), and the backdrop's lights breathe
with the loudness. The trailer and the spotlight are wordless and dance at full gain; the
cast and the tutorial receive a pulse already at the light level when words run over
them (`danceOf` in `compositions.tsx`) and know nothing about levels.

The spotlight's plate cannot simply be scaled: the plan keeps every camera key at or under
the pixel ratio of what it draws, and a two per cent pump on a control shown at its own 8x
would draw it past its pixels. `danceWithin` bounds the pump by the tightest ratio on
screen this frame — at the press, where the clip is exactly at its ratio, the dance is
nothing; on the page at rest it has the room the drift left. That keeps the invariant in
`tests/timing.test.ts` true of the drawn frame and not only of the key.

## The numbers, and where they come from

| Constant | Value | Source |
| --- | --- | --- |
| Cursor presets slow / smooth / mellow / fast | 200/2.25/40 · 80/2.5/28 · 470/3/70 · 380/1/30 (tension/mass/friction) | Cap `crates/project/src/configuration.rs`, `CursorAnimationStyle::preset()`; Mellow is the default |
| Snappy profile | 530/1/40 | Cap `ClickSpringConfig::default()` |
| Drag profile | 1000/1/40 | Cap `cursor_interpolation.rs`, `DRAG_SPRING` |
| Click look-ahead / snappy window | 500 ms / 175 ms | Cap `CLICK_LOOKAHEAD_TARGET_MS`, `CLICK_SPRING_WINDOW_MS` |
| Shake threshold / window | 0.015 of the viewport / 100 ms | Cap `SHAKE_THRESHOLD_UV`, `SHAKE_DETECTION_WINDOW_MS` |
| Simulation step, settle, lead smoothing | 16.67 ms, 300 ms, 0.12 | Cap `SIMULATION_STEP_MS`, `SPRING_SETTLE_EXTRA_MS`, `LEAD_SMOOTHING` |
| Hidden gap | 2000 ms | Ours; the recorder's default glide is 450 ms |
| Chip grouping / linger / fade | 500 ms / 0.8 s / 0.15 s | Cap `KeyboardSettings::default()` |
| Chip bounce / caption gap / padding / radius / y-factors | 6 px / 15 px / 0.45 / 0.5 / 0.08, 0.75, 0.85 | Cap `layers/keyboard.rs` |
| Chip font | 0.55 of the caption size | Ours; the proportion `Tutorial.tsx` already draws |
| Per-character delay | 55 ms | The recorder's `type` default, `packages/capture/src/session.ts` |
| Idle margin | 200 ms | auto-editor `--margin 0.2sec` default |
| Idle input gap / YDIF threshold / minimum | 700 ms / 0.5 / 1200 ms | Ours; YDIF scale from ffmpeg-filters, `signalstats` |
| Chained gap / pan / overlap | 1500 / 1000 / 500 ms | OpenScreen `zoomRegionUtils.ts` |
| Transition window, zoom-in window | 1015.05 ms, ×1.5 | OpenScreen `constants.ts` |
| Hold after a moment | 2000 ms | Ours; the cast holds a bar and a beat, 2.5 s at 120 |

## Isolation by scale, and the hand-off between pixel ratios

The spotlight (`apps/render/src/recipes/timing.ts`, `unitCamera`) has one camera over
the page and three kinds of file under it: the 2x frame, the control's clip at up to
8x, the menu's clip at its own ratio. Which one is on screen is decided by the camera's
scale and nothing else. Up to `pageWhole` — three quarters of its own pixels, the scale a
result rests at — the page is drawn whole; from there to its ratio it ramps out
(`pageAlpha`), and past that only clips are drawn —
the page has dissolved into the stage and the control stands alone. A clip is drawn only
when the camera is at or under its ratio: the menu's, rendered at a lower ratio than the
control's, waits for the pull-out to come down to it (`unfoldFrom`), and the control's
clip covers the region until then. Between keys the scale travels geometrically, so a
zoom from eight to two reads as one even move. A held key drifts 1.5% across its hold,
which is under the eye and over the review's freeze threshold.

A control also *arrives*: the travel to it stops 4.5% short and the arrival closes that
gap over its two beats, one move across the seam between two uses. A drift alone is not
enough there. On a phone take nothing else moves in that second — there is no pointer
travelling in — and the review came back with duplicate frames on exactly those spans.

One value opens the window and brings the page in: `pageArrival`, the page's own scale
ramp with a floor of a beat. Separating them — a window that followed the scale while the
page followed its opacity — left the plate empty for five frames and then landed the page
in six, which the review counted as a scene change in all three formats. And the pull-out
eases at both ends: leaving the press at speed instead reads as a cut on the very frame
the result arrives.

The drift is a rate and not a total, and every cap leaves room for the most a rest can
reach (`driftMost`): the last use has no travel, so its rest runs five beats instead of
three, and a drift measured against the claim either overshot its cap or, clamped, stood
the picture still for 77 frames. A push is always a push, too — a control small enough
that framing and pressing both hit its file's ratio was shown at 8x twice, and the camera
did not move between the arrival and the press (`pushLeast`).

Two more rules follow from where the ramp sits, and both were broken at once until a
review found them. A key whose content IS the page — a use whose control was never captured, a
result that navigated or revealed — is capped at `pageWhole` and not at the page's own
pixels, where its opacity is zero: capping there drew a claim over an empty plate. And
the plate never grows past the canvas: the pull-out and the travel both take their size
from the mix of their two ends, which is bounded by them, and move only the window's
centre. Each had been given a window of its own, and each put a picture wider than the
frame on it.

## Known limits

- **Most of it draws now; two pieces still do not.** Since 2026-09-04 the Tutorial, the
  ReleaseTrailer and the ScreenCast all draw `cursorPath` — through `cursorPathOf`, which
  keeps one path per take because a composition renders every frame from nothing — the
  first two seeking it with `cursorAtMs` and the cast indexing it with `cursorAtFrame`;
  `chainZooms` drives the cast's pans; and `cursorAt` in `timing.ts` is drawn by nobody
  (it stays as the tween the tests compare against). What still does not draw: the
  Tutorial draws its own keycaps rather than `keystrokeChips`, and the idle map
  (`idleSegments`, `speedMap`) is an array nobody reads. The spotlight draws its own
  pointer from the take's click through `cursorArc` and the engine's spring, not through
  `cursorPath`: it has one click per use, not a path — but its press is the same squash,
  pulse and ring as everywhere else (`Stagecraft.tsx`).
- **The keystroke reveal is reconstructed.** See above: the log carries a burst, not
  its characters, so the 55 ms spacing is the recorder's default and not the take's.
- **No drag profile without a log that has it.** `CastEvent` has no mouse-down, so
  `drags` is an option the integrator fills if a trace ever carries the spans.
- **A mobile take gets a path it never draws.** ProductWindow never draws a pointer
  on a device, so the cursor cost is paid for nothing there; it is small.
- **Idle needs YDIF from outside.** The function is pure; running
  `ffmpeg -vf signalstats -f null -` on the take and collecting `lavfi.signalstats.YDIF`
  per frame is the review package's job.
- **Chained zooms are off the grid** on purpose, and the snapping is left to the
  recipe. Snapping a pan's end to a beat can push it past the next moment; `castShots`
  snaps the *attack* and leaves the pan its length, as described above. The two-shot
  punch also means a shot boundary is no longer always a cut: the render plan the studio
  and the review read (`castRenderPlan` in `compositions.tsx`) declares a boundary as a
  cut only when the framing jumps, by comparing each shot's start with the previous
  shot's end.
