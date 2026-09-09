# The platform: a project in, reviewed videos out

> "Create the tool first, and understand that we will have the projects available for
> automatic video creation." — the owner, 2026-09-01

This record covers what turned panoma video from a content engine that needed a hand-written
brief into a platform an AI agent drives over MCP and a person drives with one command:
`panoma-video auto <path>`. It states the decisions, the numbers with their sources, what the
evidence took away, and the limits. The research it rests on was seven primary-source
sweeps and a completeness critique run on 2026-09-01; the design was attacked by three
critics before a line of integration was written. Their load-bearing findings are cited
where they changed something.

## The three principles

1. **Facts, not prose.** Every number, command, route, version or feature name a video
   states comes from a `Fact` with an id and a source (`README.md:14`,
   `package.json#version`, `git:tag:v1.2.0`, `CHANGELOG.md:7`). A brief line references
   facts as `{{fact:id}}`; panoma video expands them verbatim; a literal digit in a generated
   brief is refused. `packages/core/src/facts.ts`, guarded by `tests/facts.test.ts`.
   Why: schema-valid model output is still semantically wrong about a fifth of the time
   (arXiv 2607.18261), copying from context cuts unfaithful hallucination
   (CopyPasteLLM, ICLR 2026), and regulators have made Apple and Google pull demo videos
   for features that were not there (NAD, 2025-26).
2. **The tool supplies structure, the model supplies words.** Steps, marks, durations,
   cuts, formats and the camera are derived. In the MCP setting the caller *is* the
   model, and it rewrites words through a patch keyed by line id that survives
   regeneration. On the command line the words come from templates that carry no
   digits. The automatic path never depends on `claude -p` — it failed in the session
   that built this (expired OAuth), which settled the question. Since 2026-09-03 it
   *uses* a model when the machine has one, without depending on it: `@panoma/video-brain`
   answers ten typed questions under the same audit an agent's patch passes, and
   `--brain=none` is this pipeline unchanged. [brain.md](brain.md) is the record.
3. **Evidence before delivery.** Every render returns a review report and a contact
   sheet; a failing review blocks `launch` and the final render. HeyGen measured that
   handing an agent a structured id instead of prose raised accuracy from 77-82% to
   97.6% on 80 videos; Remotion's own twelve agent skills never tell the agent to look
   at what it rendered. panoma video's do, and its MCP returns the picture.

## The pipeline, and where things live

```
scout → brand → brain → serve → tour → record → score → study → plan → narrate → render → review → (fix) → kit
```

The brain stage and the fix pass exist only when the machine has a model; without one the
chain is the one of 2026-09-01 ([brain.md](brain.md)).

Everything panoma video makes for another project lives under `PANOMA_VIDEO_HOME` (default `~/.panoma/video`; an existing `~/.vira` is honoured while it is the only home on the machine)
in `projects/<slug>-<8 hex of sha256(realpath)>/`: `profile.json`, `facts.json`,
`brand.json`, `promo.json` (the promo choice and its reasons), `tours/`, `sessions/` (takes, logs, exact component PNGs under
`sessions/elements/` and 2x lossless viewports under `sessions/frames/`), `briefs/` (JSON, with a `.patch.json` beside any
brief an agent edited), `renders/` (mp4 + `.review.json` + `.sheet.jpg` + `.srt/.vtt/.txt`
+ `.provenance.json`), `kits/`, `server.log`, `auto.json`. Nothing is ever written
inside the user's project, and `openWorkspace` refuses a `PANOMA_VIDEO_HOME` that resolves
inside the project being filmed before it creates the first directory.
Every stage is keyed on its inputs: the tour and the takes on
the product's commit, on what its working tree has that the commit does not, and on the
tour's steps; a render on the expanded brief, the take files and this engine's own commit. A
second run redoes only what changed. The address the dev server was given is never part
of a key — it is a free port, different every run, and hashing it made every stage miss
forever. Where git cannot fingerprint the tree (no repository, or one that ignores the
project) there is no evidence of sameness, so nothing is reused and the stage says why.

The saved tour's origin still has to match the footage. When an owned local server
gets a new port and a changed capture version re-shoots a cached tour, panoma video rebinds
the tour URL, navigation steps and Recorder flow only after both replacement takes
succeed. Reused takes keep their original origin, and a caller-supplied URL is never
rebound this way. The same-origin proof check stays strict; ignoring all loopback
ports would confuse different local products. The tour cache key is preserved.

An instance panoma video did not start has its own source evidence, including an explicit
local `--url`. Before reusing a tour or take, panoma video fetches the entry HTML and up to
twelve directly linked, same-origin scripts/styles without cookies or authorization.
The fingerprint includes the bytes, so a same-URL deployment with a stale ETag is
still a change. CSP nonce attributes are excluded; other document content is not
silently normalized away. The probe is capped at fifteen seconds and twelve MiB,
and stores hashes and reasons only in `sessions/<id>.source.json`, after both takes
succeed. Failed or oversized probes cannot vouch for old footage. The tour and the
recording share the same source generation.

This probe does not see every route, lazy chunk, CDN response or live API value.
Consequently a capture expires after twenty-four hours even when its sampled bytes
are unchanged; checking it does not extend that age. This is a reuse policy, not a
claim that the complete deployed app was unchanged. `--force` renews it sooner.
Once a story has saved scene revisions, every camera run requires `--new-story`,
including an unchanged supplied URL or `--force`. It stops before the brain, server,
probe or metadata writes: matching served bytes do not prove an upgraded recorder or
changed action policy can reuse the same evidence. `--new-story` allows replacement
and the usual validated archive path; `--no-camera` edits existing evidence without
a network probe. Before saved revisions exist, a temporary server panoma video started keeps
its existing git-based key; its random port never enters the source fingerprint.
Direct `panoma-video record <tour> --project=<id>` replay also refuses saved scene revisions
before resolving a server or removing the recording key. Replacement goes through
`panoma-video auto <project-path> --new-story`, which owns the validated archive path;
adding `--new-story` to the replay shortcut does not bypass that protection.

An operator who reads an unfamiliar product's source can additionally pass
`AutoOptions.denySelectors`: CSS selectors for controls whose effects are not
authorized. This is useful for an innocently named button whose handler sends a
message. The walker excludes matching targets from the brain's menu and checks
again before pressing; mobile replay and the recorder enforce the same policy.
The selectors persist in the tour, participate in both cache keys and survive a
CLI recording replay. A brain cannot remove them. The policy supplements the
existing action lexicon; it does not block all POST requests, which can also read
data. This advanced option currently supports automatic tours; a requested lesson
with an active selector policy refuses rather than dropping the restriction.

Responsive labels are not stable element identities. The walker keeps a unique
alternate derived from the element it actually pressed: a real id/test attribute,
or its exact DOM text. Mobile replay may replace the accessible-name selector only
when that alternate also resolves uniquely and passes the action policy. Hidden
decorative text therefore stops costing a real mobile action; ambiguous controls
still lose their outcome. This alternate survives Recorder JSON export.

On Apple Silicon the product cameras use ANGLE Metal while keeping the same 2x
recording density. A real Universend trial measured headless SwiftShader taking
84 seconds to approach its first orbit control; a read-only renderer probe verified
Metal uses the Apple GPU. This is the running product's browser, not the deterministic
frame renderer. Other operating systems retain their existing browser path.

| stage | package | what it does without a model |
| --- | --- | --- |
| brain | `@panoma/video-brain` | with a model: the thesis (what the product is, in which language its interface speaks, what to show), which controls the camera sees pressed, the words in every language, the fix of a failing cut, the post copy — each answer validated, cached, capped, audited and logged. Without one: nothing; the templates. [brain.md](brain.md) |
| scout | `@panoma/video-scout` | kind (web-app, static-site, cli, library, mobile), framework from a 28-entry table transliterated from Railpack, `@netlify/build-info` and `@vercel/frameworks`, the start command with its port and host flags, routes per framework convention, and the fact sheet. Never reads `.env`. [scout.md](scout.md) |
| brand | `@panoma/video-brand` | tokens from shadcn/Tailwind CSS, manifest and theme-color, an area-weighted colour census through CDP, dembrandt's role selection and logo scoring (MIT, ported), fonts mapped to the bundled OFL faces by category, tone from the README. A low-confidence primary keeps panoma video's theme. [brand.md](brand.md) |
| serve | `@panoma/video-scout` | the framework's own binary on a free loopback port that the Fetch standard does not block, readiness by stdout URL, TCP or an HTML answer, the process tree killed on stop. Never `install`. |
| tour | `@panoma/video-tour` | the accessibility tree (`ariaSnapshot`), landmarks, section headings, calls to action scored by a verb lexicon minus a chrome lexicon and a destructive blocklist, a state hash to refuse no-op clicks, budgets from Navattic and Arcade (5–13 steps, ≤2 CTAs), a mobile re-walk that keeps one shared step list, Chrome DevTools Recorder JSON in and out. [tour.md](tour.md) |
| record | `@panoma/video-capture` | stamps the product's commit, masks credential-shaped text, treats vanished controls as optional, and at every mark — without scrolling or changing the page — captures a 2x lossless viewport, a semantic UI component, and the control rendered by the page at up to 8x (CDP clip scale), then on the next frame what its action changed: the control's after-state, the changed region, a local after-clip when a menu opened, and the box of the heading it produced. A settled pause after a product press also measures result readiness on the camera clock, before reading time. |
| score | `@panoma/video-audio` | measures and conforms a supplied track to the whole-frame musical grid; with no supplied track, the render stage supplies a procedural bed. [music.md](music.md) |
| study | `@panoma/video-director` | inventories the recorded screens, components and controls, derives the visual direction, and reports missing material before planning. [studio.md](studio.md) |
| plan | `@panoma/video-director` | the story binding below; then templates; then the audit |
| narrate | `@panoma/video-director` | the tutorial's lines spoken with their word timings, content-addressed so a re-run pays for what changed, capped in characters before the first call, and skipped with a reason when there is no key. Runs before the matrix is built, because a tutorial's clock is measured from what the voice actually took. [tutorials.md](tutorials.md) |
| render | `@panoma/video-render` | the matrix as a factory over (briefs, dirs); the procedural bed and action-timed sound effects; ProductPromo, ReleaseTrailer, FeatureSpotlight and Tutorial |
| review | `@panoma/video-review` | the gate below, on the encoded file |

## What makes it make sense: the story binding

The first design said "claim cards from section headings, proof from section marks". The
product critic showed that on a real repository this is a slideshow of headings — a
README's H2s are "Installation" and "Contributing"; a scroll to a heading shows the product
*saying* something, not *doing* it. So `packages/core/src/story.ts` binds claims to
moments with arithmetic:

- A **moment** is a mark the tour left, scored by the state change its action caused
  (a scroll is zero), the tour's own ranking, the route's git heat, README word overlap,
  and whether both takes have it.
- A **claim** is a sentence someone wrote, ranked by trust: the interface's own names
  (tier 1), a tagged CHANGELOG section (2), package.json (3), README prose (4), commit
  subjects (5), landing copy (6).
- A claim earns a card only when bound to a moment with a real state change whose words
  it shares; it is stripped of commit prefixes and "add support for", and refused if it
  does not fit five words. Unbound claims vanish. Section scrolls are admissible proof
  only for a static site — or a page the walker could not change — and that piece is
  called a **site tour**, never a trailer.
- **Goals** follow the kind and the evidence: a web app with two bound pairs earns a
  trailer; a **task** earns a tutorial — a control whose use changed the interface, which
  is the only thing there is to teach, with a documented install command as the other
  door; a CLI or library earns a card piece from its facts; every skipped goal names the
  one thing that would unlock it.

`tests/story.test.ts` and `tests/plan.test.ts` hold the promises.

## A social promo from the same pipeline

`panoma-video promo <path>` selects the `promo` goal and defaults to one vertical preview.
`panoma-video auto <path> --goal=promo` selects the same recipe but retains auto's horizontal
preview default. Both support `--until=study|plan|preview|final`, `--langs=en,es`,
`--brain`, `--music`, an existing app's `--url` and a workspace `--project` id.

```bash
node apps/cli/src/panoma-video.ts promo ~/code/my-app --langs=es --music=./track.mp3
node apps/cli/src/panoma-video.ts promo ~/code/my-app --format=h --until=preview
node apps/cli/src/panoma-video.ts auto ~/code/my-app --goal=promo --until=plan
node apps/cli/src/panoma-video.ts promo ~/code/my-app --project=my-app --no-camera --until=final
```

`--format` chooses one preview canvas; it is not a comma-separated matrix filter
on these commands. The promo's `sell` job publishes `v` and `h`, so use one of those;
`s` is an auto option for jobs that publish square. `--until=final` selects every supported hook, language and format
unless `--only=<brief>` is present. With `--only`, `--format`, `--hook` and `--lang`
resolve one composition. `--no-camera` reuses the saved tour and takes without starting,
walking or recording the product; it requires those files in the selected workspace.

**ProductPromo sells a supported benefit without a voice track.** The director builds
a closed menu of marks with a recorded product press and measured changed pixels in
every take. The brain selects one to three proofs, an audience, a tension, the opening
and the pace; it phrases their benefits using the facts each proof is allowed to carry.
The choice, its reasons and its validation limits are written to `promo.json`. With no
brain, the fallback ranks observed changes and uses their names rather than inferring
a wider benefit. A schema-valid paraphrase is still a model judgment; the file records
that distinction. [social.md](social.md) defines the contract and refusal rules.

The result preview, when selected, shows a recorded payoff before the promise. Promise
and benefit cards own their frames; proofs show the product with no claim laid over it.
The camera approaches a control, follows its result and holds. The promo clock preserves
continuous footage from the press approach through the settled result and its reading
time, conforms the recording frame for frame, and rounds the editorial boundaries onto
beats. Older takes without a measured result keep the rest of their marked segment.
This shorter selling clock does not replace the tutorial's narration and reading clock.

Music accompanies the edit, with synthesized clicks, scroll brushes and key onsets only
where the recorded actions are visible in a proof. Cards and the result preview earn no
interaction sounds. Inputs stay on the source clock after conforming; they are not
snapped to musical beats, and an aggregate typing event earns one onset rather than a
made-up cadence. No narration service is called for this recipe. The supplied reference
clips informed the timing and visual contrasts recorded in
[social-references.md](social-references.md); they establish no audience performance
or formula for viral reach.

## The recipes the genre asked for

The genre sweep watched the reference material directly. Linear's announcements have no
speech and no hard cut of footage; the unit shared by Linear, Cursor, Framer and Raycast
is a **claim card of at most five words, two to three seconds, then six to twelve seconds
of the product proving it**, three or four times, between fixed furniture: product in
motion first, the name inside five seconds (Google's ABCD playbook, Ipsos-backed), a
counted ticker, a status line, the wordmark last. `TRAILER` in
`apps/render/src/recipes/timing.ts` carries those numbers; `ReleaseTrailer.tsx` is the
scene; the footage jump between proofs happens under the card so the piece never shows a
hard cut. The trailer's voice, when any, is 110–150 wpm — 170 is a tutorial rate. Since
2026-09-04 its camera is the tutorial's, and so is the cast's: every framing is capped at
`videoWhole`, the scale at which the recording is drawn 1:1 in that format, in place of
the per-format push fudge; a proof pushes to its first press with the critically damped
spring and then holds, drifting; every press — pulse, ring, the pointer's give — runs on
the timeline (`presses` on the proof, `eventFrame` in the cast); the pointer is Cap's
spring. Music accompanies these actions by default; only an explicit `--dance=light|full`
adds musical motion (`recipes/pulse.ts`). The cast's two-shot
punch and its pans between near clicks are in [motion.md](motion.md).

**FeatureSpotlight makes the interface the raw material, and uses it.** It was
rebuilt on 2026-09-02 against two reference launch films (Diffusion Studio's and
Scenivia's), measured frame by frame: one real interface element huge on a dark stage,
the pointer on it before the click, the result unfolding where it happened, the name of
the thing landing once the picture has stopped, and light sweeping across on the cut.
The first version put device mockups on a light backdrop with static crops beside them,
and read as a slideshow; three independent design proposals and two judges converged on
the grammar below before a line of it was written.

*The material.* At every recording mark `@panoma/video-capture` keeps three things beside the
take: the whole viewport as a 2x lossless PNG; the semantic component crop; and a
**macro clip** of the control — the page's own rendering at up to eight device pixels
per CSS pixel, made with CDP `Page.captureScreenshot` and a clip scale, so a 30 px
chevron can fill half the frame pin-sharp instead of being a stamp blown up from a 2x
crop. CDP's clip is in document coordinates (the viewport box travels by the scroll
offset; Playwright's own `clip` hides the same conversion). The control is where the
*next step's* locator measures it in *this* take — a tour's boxes belong to the desktop
walk, and a phone lays the same control out elsewhere; the element chooser used to pick
a random card on the mobile take from a desktop point. On the next frame the capture
judges what the action did: the control re-rendered in its own box (`afterControl`: the
toggle now filled, the row now highlighted), the bounding box of the pixels that changed
(`change`, measured in the page's own canvas at a quarter size — ffmpeg's `cropdetect`
reports nothing for a still that differs in one corner), the same neighbourhood grown to
hold the change when it stayed under 45% of the viewport (`after`: a menu that opened),
and the box of the heading the tour saw the click produce (`focus`). The take ends on
one more frame, `__last`, so the last mark is judged too. There is a third moment, for
the control the mark could not see: the tour writes the mark *before* the scroll to a
control below the fold, so at the mark the control is off-screen and nothing is captured
there (a crop slid into view would be a strip of the wrong page). The next product click
is armed instead, and the control, its component and a before-image are taken the
instant before the press, on the scrolled page, under the mark's name — `at: "press"` on
the macro says so — and judged at the next mark like any other. This happens only in the
capture pass; the camera pass has no CDP session and takes no screenshot, which is what
keeps the recorder out of its own footage.

*The camera.* One camera over the page. Every sprite — the 2x frame, the 8x clip, the
5x menu — is pinned to its CSS box of the viewport and drawn through one framing (`canvas
= anchor + (css − centre) × k`), so a zoom from a chevron to the menu hanging under it
is a single move and never a cut. Pushed past the page's own pixels the page dissolves
into the stage and the control stands alone on a lit plate; pulled back, the page returns
around it. The invariant the look depends on is arithmetic in `timing.ts` and a test
walks every frame of the plan for it: **the camera never draws a file past its own
pixels** — the 2x frame is gone above 2x, the menu's clip waits for the camera to come
down to its ratio (`unfoldFrom`), the next control's clip waits the same way on the travel
that delivers it (`handOver`), a framed control is never taller than 26% of the canvas's
short side and a pressed one never taller than 40%, capped by the clip's ratio. Two
corollaries an adversarial review had to find: a key whose content IS the page is capped
at `pageWhole`, three quarters of the page's own pixels, because at the page's own pixels
its opacity is zero and the plate would be empty; and the plate itself never grows past
the canvas, so the pull-out and the travel take their size from the mix of their two ends
and move only the window's centre. There are no device mockups any more; the reference
films have none, and a phone frame at a fifth of the canvas was the stamp this recipe
exists to delete.

*The clock.* Open one bar (the page the first use starts on, pushing slowly toward the
first press), kicker one bar (the name lands whole under a scrim, the brand inside five
seconds), three bars per use, two for the close: two uses are 20 seconds at 120/30, three
are 26. Inside a use, in beats: the pointer is at rest on the control by beat 2, the push
runs through beat 3, the press lands on beat 4, the result on the next downbeat, the
camera comes to rest — and the claim lands, one word per tick, in its own column, never
over the plate — on that bar's fourth beat, the claim leaves on the last bar's third beat,
and the last two beats carry the camera to the next control while the pointer travels
there — stopping 4.5% short of it, so the next use's arrival closes the gap and the seam
between two uses is one move rather than a second of stillness. The answer the interface
gave sits under the picture, or on its bottom edge on a chip when the layout leaves no
lane; it is placed from the plate on screen, never from a percentage of the stage, which
are two different spaces and printed grey mono inside a white page in all three formats. The result takes the form the capture measured: **menu** (the clip unfolds from the
control's own box outward), **navigate** (the page swaps to its next frame and the camera
rests on the control and the heading it produced together — or on the heading alone when
holding both would mean showing the page under `legibleScale`, which for a sidebar item
and a heading across the page meant fifteen times the plate and type nobody reads — with
the heading quoted as a label from `line.result`), **reveal** (the page swaps and the before is shown beside the
after, smaller and dimmer). Only one-frame swaps are declared as cuts; a hold drifts 1.5%
so the review never reads it as frozen. A phone take draws no pointer — a tap blooms — and
a mark the take could not render at macro scale is shown from the page at its own pixels
and reported by name (`plan.degraded`), never upscaled and never silent. The story
checks that measure a trailer's furniture (motion first, brand by five seconds, an address
last) run on this recipe too, and `tests/spotlight-scene.test.ts` reads real frames to
assert that every word on screen is the brief's, the interface's answer, or the brand's.

**Type over footage cuts; the picture is what moves.** A card used to arrive in three
events: its dark plate appeared instantly and complete, the letters then climbed into it
from behind a mask over eight frames, and the variable-font axes went on thickening for
most of a beat after the word had visibly landed — and in the trailer all of that started
one frame into a section whose product was still receding. Nothing justified any of it,
and a viewer reads an unexplained second move as a bug. So a word now lands whole —
plate, letters and final type shape on one frame — on the frame the picture has finished
moving, and the rhythm is the arrivals, one per tick, not an animation inside each one.
The variable fonts still do the work they were chosen for; they are set at the shape the
old travel was crawling towards. `KineticTitle.tsx` carries the reasoning. The exception
is a piece where the type *is* the frame rather than an overlay on one — `KineticQuote`'s
slam — which is a shot, not a caption over a shot.

Not built, and booked in the roadmap with the reason: Changelog, the caption policy per
format (verbatim in 9:16, labels in 16:9 per Mayer's redundancy principle), and the brand
theme inside the remaining recipes (FeatureSpotlight consumes it; older recipes still
read `theme.ts`).

## The gate

`panoma-video review <file>` measures the encoded file with ffmpeg and ffprobe: black and frozen
runs, planned cuts against `scdet`, loudness, true peak and short-term loudness (AES
TD1004 for short form), silence, clipping, a BT.1702-3 / WCAG 2.3.1 flash detector on a
32×18 grid of luminance in cd/m², platform conformance from a dated table. Every check
carries `fix.by` — `plan`, `record`, `tour`, `engine`, `none` — so an agent never loops
blindly. Story checks from the plan sit beside them: claims traced (in the text and in
the chip), marks present in every take, proofs that changed state, two to four pairs,
spoken phrases under 20 characters a second of caption, the brand by five seconds, an
address at the end. [review.md](review.md) has every threshold and its source.

**What the first real runs taught, and changed.** Picture checks warn and never fail: a
dark interface on a dark backdrop is 98% "black" to a luma threshold and is the most common
product there is; a page that does not move under a slow camera is "frozen"; both are
signals worth reading and neither is proof of a defect. A planned cut `scdet` does not see is
a warning too: a jump under a dimmed card scores under its threshold. The flash rule fails
only when the failing windows run longer than a second and a half — a scroll across a
light-and-dark page trips the letter of BT.1702 for one window, and panoma's own landing
did — and warns otherwise. Fail is reserved for what needs no interpretation: conformance,
true peak, an audio stream that is silent throughout, a claim with no fact, a mark a take
lacks, fewer than two pairs. The first frame is on screen from frame 0 now (a
feed shows it as the poster). A contact sheet always has twelve tiles: padding with black
reads as a broken video to the model looking at it.

## The agent surface

`panoma-video mcp` serves eleven tools over stdio on SDK 1.30 (Claude Code probes the 2026-07-28
protocol and falls back to `initialize`; the tools do not change when the transport is
ported to `@modelcontextprotocol/server` 2.0). `panoma_video_guide`, `panoma_video_scout`, `panoma_video_record`,
`panoma_video_plan`, `panoma_video_story`, `panoma_video_revise`, `panoma_video_render`, `panoma_video_review`, `panoma_video_frame`,
`panoma_video_auto`, `panoma_video_teach`. Every project tool takes
`project_path` and derives the workspace; returns a summary that ends in the next step,
a structured mirror without base64, images only as JPEG blocks under 80 KB (Claude Code's
25,000-token result cap does not exempt images), files as `resource_link` blocks.
`panoma_video_render` renders one composition; the matrix lives in `panoma_video_auto` and the CLI.
`panoma_video_auto` never fails as a whole: each stage reports done, cached, skipped or failed
with the tool that fixes it. The MCP is shipped with a skill — `skills/panoma-video/SKILL.md` —
because Remotion deprecated its own MCP for one documented reason: agents did not invoke
it reliably. `tests/mcp.test.ts`, `tests/mcp-stdio.test.ts` and `tests/mcp-tools.test.ts`
(the whole path on a fixture product, over an in-memory client) guard it.

`panoma_video_story` reads a ProductPromo's exact effective revision, scene ids, raw and
expanded copy, locked sources, settings and recent history. It prepares no audio or
video and asks no brain. `panoma_video_revise` uses the same `studioWorkspace` adapter the CLI
does: explicit edits or a bounded natural-language correction pass every
hook/language/horizontal/vertical plan before an atomic history entry is saved.
The caller must supply `expectedRevision`; concurrent, stale or unsupported edits
refuse without changing the current film. Restore appends history. An instruction
needs a brain; explicit edits and restore work with `brain: "none"`.

For a saved promotion, `panoma_video_render` exports that exact revision through that same
adapter, without replanning or changing unrequested words. A different theme must be selected
with `panoma_video_revise` first. Its immutable revision file id also resolves through
`panoma_video_review` and `panoma_video_frame`. Reports, the source manifest, kit and contact sheet
accompany the export. Source strings and notes are redacted, marked untrusted and
bounded on the MCP wire; full snapshots remain in the local revision journal.
`tests/mcp-story.test.ts` checks the read/edit/restore and encoded export paths.

Starting a new story is explicit: `new_story: true` on `panoma_video_auto`/`panoma_video_plan`
(`--new-story` on the CLI). A valid replacement is prepared before the old journal
is moved intact into `promo-revisions/archive/`; ordinary render and revision calls
never reset it. The archive uses the same writer lock and can require the expected
revision, preserving concurrent edits and the old history rather than deleting them.
This gives changed captures a fresh baseline without applying earlier edits to new
evidence. Corrupt journals can also be preserved for inspection during this explicit
recovery; they are not interpreted as usable scene history.

## What the evidence took away

- WebGL transitions: SwiftShader output differs from a GPU's; CSS and ffmpeg only.
- The MCP Tasks extension: no client declares it. Plain blocking tools with progress;
  Claude Code backgrounds a call after two minutes on its own.
- MCP logging, roots, sampling: deprecated in the 2026-07-28 revision. Stderr and path
  parameters.
- APCA: not free (a "Limited W3 License"). WCAG 2 contrast only.
- logo.dev, Brandfetch, PEAT, ffmpeg's `photosensitivity` as compliance: non-free or not
  a standard.
- Downloaded webfonts: never; the bundled OFL faces by category. The licence question
  disappears.
- The ElevenLabs music bed as a default: non-commercial on the free plan. The default bed
  is procedural, generated from the beat grid by `packages/audio/src/bed.ts`, so the cut is
  on the music by construction and nobody's rights are involved. [music.md](music.md)
- "Product Hunt video of the year" as a corpus: the category existed in 2021 and the
  awards ended in 2025; PH's gallery sizes are booked for the kit, not built.

## Deliverables and the law

Each cut ships with `.srt`, `.vtt` and a transcript from the word timestamps (WCAG 1.2
needs machine-readable captions; burned kinetic captions are not those), a
`provenance.json` (claims → facts → sources, takes → commit, voice and music sources,
what is synthetic), and a machine-readable disclosure in the container's `comment` tag
when the voice or the b-roll is synthetic — the EU AI Act's Article 50 has applied since
2 August 2026 and YouTube's upload form asks the same question. The procedural bed is
recorded as `music.source: "procedural"` and does not trigger the flag; that is a
decision, recorded in [music.md](music.md), that the owner can reverse.
[deliverables.md](deliverables.md) has the formats.

## Security

The project path is the trust boundary. panoma video runs the product's documented start command
only, bound to 127.0.0.1, never `install` (a postinstall is arbitrary code), stops the
process tree, resolves `project_path` to an existing directory and refuses an unexpanded
`${VARIABLE}` (outputs land under `PANOMA_VIDEO_HOME` by construction), never reads `.env`, masks credential-shaped text before the first frame
and in every fact and tool result (`redact` in core), and marks project text in tool
results as untrusted. The walker never types into a field, never submits a form, and
never clicks a destructive verb.

## Limits, honestly

- The lexicons are English; a Spanish interface ranks no call to action and, worse, does
  not recognise destructive verbs. Extend `DESTRUCTIVE` before running on it.
- Determinism is per pinned (Playwright, Chromium, bundled fonts) triple with the launch
  flags in `rasterizer.ts`; cross-OS comparison must be perceptual. A take is reproducible
  only for the same product commit.
- The dev script's own flags are dropped when the framework binary is started directly;
  a project that only works with a script-only flag starts differently under the camera.
- Windows is written per panoma's lessons (`.cmd` spawn, `taskkill /T`) and untested here.
- The BT.1702 detector streams grey; saturated-red flashes are not detected.
- No C2PA manifest: no free, maintained Node library exists. The JSON sidecar and the
  container tag are the fallback.
- Narration is capped per run in characters (`NARRATION_CHAR_CAP`, enforced in
  `packages/director/src/narrate.ts`) and never half-spends: past the cap the stage
  declines whole. `PANOMA_VIDEO_MAX_VEO_SECONDS` is still specified and not enforced.
- A key in the environment is the automatic path's consent to spend on narration: with
  `ELEVENLABS_API_KEY` set and no voice id given, the default voice is used. Pass
  `voice: "none"` for a silent piece whose sentences are drawn as type.
