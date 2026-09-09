# Open questions

Things that are knowingly unresolved, each with who decides. Fixing one without reading
its entry can undo a decision.

## The Reels safe zone (owner)

Meta's official Reels zone is 14% top, 35% bottom, 6% sides — 269 / 672 / 65 px on
1080×1920 — and it is larger than the layout union in `packages/core/src/format.ts`
(bottom 420 px, 21.9%). Imposing it would remove a third of every vertical canvas,
including for TikTok and Shorts, which publish no numbers. Today: layout keeps the union, and
nothing reports against the official rectangle — `zoneViolations` in
`packages/core/src/safe-zones.ts` can answer it, and the render plan does not yet carry
card rectangles to ask with. Decide whether Reels becomes a layout constraint or a
warning, and the check follows. Source: facebook.com/business/ads-guide
(Instagram Reels), verified 2026-09-01.

## Disclosure of the procedural bed (owner)

`needsDisclosure` in `packages/core/src/provenance.ts` counts music from a generator as
synthetic; the director records the procedural bed as `music.source: "procedural"` and
`synthetic.music: false`, on the argument that an oscillator is not a model. The EU AI
Act's Article 50 speaks of "artificially generated" content. Over-marking a bed costs
nothing; under-marking could. Decide, and make the two agree.

## Five colours under AA contrast (owner)

Inherited from panoma's landing, where they are a visual decision; panoma video's default theme
(`apps/render/src/lib/theme.ts`) uses `faint` and `muted` over the paper. Not the same
question as caption contrast, which is guaranteed by the plate.

## Deployed source coverage (integrator)

The stale-take defect closed on 2026-09-05: externally served instances now contribute
the entry document and a bounded sample of linked code/style bytes to both cache
keys. A twenty-four-hour maximum capture age covers what that probe cannot observe.
Failed probes force fresh material; an approved story's sources are kept until a
new story is explicitly requested. [platform.md](platform.md) records the limits.
What remains is richer observation of authenticated live data, lazy chunks and
secondary routes. The current probe does not claim those stayed unchanged; a forced
capture is still appropriate when the caller knows the live data changed.

## The dev script's own flags (integrator)

The scout starts the framework's binary directly (`next dev -H 127.0.0.1 --port N`)
because a script such as `next dev --turbopack -p 3000` cannot be forced onto a free port
from outside. The script's own flags are dropped. A project that only works with a
script-only flag starts differently under the camera. Recording the script's args and
merging them minus the port is the obvious next step; nobody has needed it yet.

## Site tours of monorepo packages (integrator)

`@panoma/site` reads as its package name in the kicker because the package has no README
title. A derived, display-only name (the folder, the site's own `og:site_name`) would read
better and would not be a fact. Decide whether a kicker may carry a derived name.

## Changelog (integrator)

Its beat sheet is specified in the genre research (60–210 s: hero items 20–30 s,
medium 8–12 s, a lightning round). The plan already emits the `changelog` decision;
no recipe consumes it. FeatureSpotlight is resolved by the shorter automatic product
film documented in [platform.md](platform.md).

## The spotlight does not fill the frame (owner)

`castFill` and `tests/frame.test.ts` say the product fills the canvas, and every
recording recipe obeys. FeatureSpotlight isolates one control on a dark stage instead,
because the two reference launch films it was measured against do exactly that, and a
control at 8x is more product on screen than a whole page at 1x. The fill rule is not
applied to it. If the owner decides the reference look is wrong for a given product, the
knob is `SPOTLIGHT.framedShare` / `pressedShare` in `apps/render/src/recipes/timing.ts`.

## Nested panel scrolling (resolved 2026-09-05)

The recorder and tour now share a semantic scroll primitive that measures the target's
scrollable ancestors, aligns it inside its own panel, and reveals it through outer
containers. The recorder animates the whole chain on one finite eased clock. Clipping
also gates macro capture, so a target outside its panel is photographed at the press
after the approach. See [tour.md](tour.md#scrolling-inside-the-product).

## A page that animates itself can still fool the outcome (integrator)

Fixed on 2026-09-03: what a click produced is diffed against the page as it was the instant
before that click, so state left by an earlier attempt is no longer credited to it
([tour.md](tour.md)). What remains is a product whose page changes on its own between those
two frames — universend's 3D scene rotates, a dashboard ticks, a carousel advances — where a
"new" heading can have nothing to do with the click. The honest options are sampling the
page twice and requiring the heading to be stable, or refusing an outcome whose element sits
outside the region the click changed (the capture already measures that region). Neither is
written. Until one is, `ui.<mark>.result` is an observation, not a proof of causation, and
the films that quote it inherit that.

## Action-language coverage (integrator)

The fixed action lexicons now include Spanish, French, German and Portuguese in
addition to English. Those refusals stay outside the brain. Languages and unusually
phrased controls outside that coverage remain a limitation; a safe-looking label
can still perform a write. `denySelectors` adds a source-reviewed CSS policy,
persisted with the tour and checked again at execution. The Universend trial used
it to exclude a poetic reaction button whose handler posts a signal. Neither the
language list nor that policy is a general proof that arbitrary app actions are safe.

## Required in the type, optional in every read (resolved 2026-09-07)

Answered by looking, which is what the entry asked for: 31 project workspaces under the
engine's home, 23 tour files and 40 session logs.

**`TourScript.pages` and `.edges` were lying, and are now optional.** The walker started
persisting the screen graph on 3-Sep-2026 (`addb31f`, "The walker knew the shape of the
product all along, and threw it away every run"). Eighteen tours carry both fields; three
recorded before that commit — 1-Sep, 2-Sep and 3-Sep 04:50 — carry neither, and they are
still on the disk. Two more files in `tours/` are not tours at all: they are refusal records,
with `by` / `dropped` / `goal` / `unread` / `why`, and they were miscounted as missing fields
by the sweep that first raised this question.

Marking the two optional produced **zero** typecheck errors, which is the answer to the other
half: every reader had already learned to write `tour.pages?.…` and `?? []` on its own. The
code was right and the type was wrong, and nothing was defending against a shape that could
not arrive — three of them can.

**`SessionLog.readyMs`, `.fps` and `.marks` were not lying, and stay required.** All 40 logs
carry all three, and the fields have been written since 1-Sep-2026 at 10:15 (`de5f32a`), which
is earlier than the oldest take on this machine, 1-Sep at 17:38.

The fifteen defensive reads that made this look like a contradiction belong to **a different
type**. `CastSession` in `apps/render/src/recipes/timing.ts` declares `readyMs?` and `fps?`
deliberately, with its own comments saying why — "Absent means: assume it matches the
timeline" — because the render accepts a looser shape than the recorder writes. Fourteen of
the fifteen are that type, and correct. The one that reads a required field, in
`clipsOf` (`packages/director/src/study.ts`), also stays: that object came out of a file
through `readJson`, which validates nothing, so `required` there is a claim about the writer
rather than a check on the bytes. It now says so.

The coverage hole the question surfaced is real and still open: because no promo fixture
carried a graph, the `beforePage` / `routeChanged` / `headingChanged` branch of
`promoCandidates` (`packages/director/src/promo.ts:270-272`) is exercised by exactly one test.

## Sixteen refusals, checked only for throwing (engineer)

`tests/studio-creation.test.ts` gives `normalizeCreationRequest` sixteen malformed option
patches and asserts each one throws. It does not assert *what*. Every one of the sixteen was run
by hand on 7-Sep-2026 and every refusal is the intended one, so nothing is hiding — but the test
is worth less than its name suggests, and closing the gap means choosing a predicate or a message
match, which changes what it asserts.

One thing that check would have caught: `{ root: "/bad\0folder" }` is refused with *"root: Choose
an absolute local path."* The path given **is** absolute. `packages/director/src/creation-settings.ts:6`
folds absoluteness and control characters into one `refine`, so a NUL byte is reported as the
wrong problem. Splitting the refine fixes the message and would break nothing, but it is a
product message and this is the record, not the fix.

## Playwright timeouts nobody chose (engineer)

The rasterizer's `page.screenshot` had no timeout, so it used Playwright's default of
thirty seconds. That was invisible until 7-Sep-2026, when the first CI run to render a
frame failed on the two-core Linux and Windows runners with `Timeout 30000ms exceeded`
and lost a whole cut, while the same commit rendered fine on macOS. It is now
`FRAME_TIMEOUT_MS`, chosen and explained where it stands.

The same silence is everywhere else. `page.goto` in the rasterizer's shell, and in
`capture/session.ts`, `capture/pageshot.ts` and `capture/shoot.ts`, along with every
`page.screenshot` in those three, all inherit the default. None has failed yet, which is
the only reason they are not in the fix: they run once per take rather than once per
frame, so they have more room before the same wall.

Deciding this properly is one choice, not eight: whether the engine sets a default on the
context it creates — `context.setDefaultTimeout` — and if so what it should be for a
machine smaller than the one it was written on. Guessing eight numbers with no failure
behind them would replace a default nobody chose with eight defaults nobody chose.
