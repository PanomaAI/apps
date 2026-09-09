# Roadmap

Phased so every phase ships something publishable. "Done" always means: files in
media/render/ good enough to post.

## Phase 1 — the engine (done)
Grid, formats, briefs, matrix, two recipes (KineticQuote, ScreenDemo), kinetic
captions, ElevenLabs client with timestamped voice, Veo client, mastering, CLI,
and **our own renderer** — free-software-only, license-guarded by test, with live
preview. 18 renders from 2 briefs, verified frames and -14.0 LUFS.

## The ambition, restated (2026-09-01)

The owner's call: panoma video aims to be **the complete video suite for software
products** — not a niche engine plus gaps. The weakness map (market-gaps.md) is the
checklist; every category the field serves badly gets a panoma video answer, our way:
code-driven, deterministic, local, beat-locked, license-clean.

## Phase 2 — the panoma campaign (in progress)
- ~~Recipe: **TerminalRun**~~ — done: the speedrun format, beat-locked, gold summary.
- ~~Recipe: **Loop**~~ — done: 8s seamless radar, periodic by construction, seam flash.
- ~~Wire word timestamps into captions~~ — done: compositions read the generated
  words.json from disk and duck the music under voice; even spacing stays the
  silent fallback.
- ~~Post kits~~ — done: `panoma-video kit` writes platform copy + engine-rendered thumbnail +
  contact sheet per composition.
- ~~Draft briefs from reality~~ — done: `panoma-video ideate` (git → heuristics → optional
  `claude -p` hook rewrite, drafts never auto-registered).
- ~~The screencast pillar~~ — done: `panoma-video record <session>` drives the real product
  (sessions are typed scripts in briefs/sessions), logs input as data, and the
  ScreenCast recipe beautifies the take: synthetic eased cursor, click ripples,
  beat-locked auto-zoom (castPlan), window chrome, every format. Screen Studio's
  category, re-founded on determinism.
- ~~Frame-filling multi-take screencasts~~ — done: `panoma-video record` shoots desktop and
  mobile takes whose aspects match their canvases, the vertical cut plays the
  product's real portrait layout inside a device frame (25% -> 83% of the canvas),
  taps replace the mouse cursor on mobile, and `tests/frame.test.ts` guards it.
- ~~`panoma-video launch <brief>`~~ — done: every format rendered, mastered and kitted in one
  command (the tour's three formats: 2.3 minutes).
- Voice the briefs (Darian for en; the es voice already chosen for the launch video) —
  needs ELEVENLABS_API_KEY in .env.
- Captions recipe for external founder clips: transcribe() already returns word
  timestamps; a recipe that eats an mp4 + words closes the #1 commodity gap locally.
- 6-8 briefs from the playbook's hook formulas; post 3-5/week; track which hook wins.

## Phase 2b — the platform (built 2026-09-01)

The owner's call: the most advanced platform for videos about apps, driven by agents
over MCP, automatic from a project path. Built and proved on a fixture product and on
panoma's own site ([platform.md](platform.md)):

- ~~`@panoma/video-scout`~~ — profile, framework table, forced port + readiness, routes, facts.
- ~~`@panoma/video-brand`~~ — repo and live passes, dembrandt's algorithms ported, bundled faces.
- ~~`@panoma/video-tour`~~ — the walker, marks, budgets, mobile re-walk, DevTools Recorder JSON.
- ~~`@panoma/video-review`~~ — the gate with `fix.by` on every check; BT.1702 flash detector.
- ~~`@panoma/video-director`~~ — story binding, templates, patches, `panoma-video auto`, provenance,
  subtitles, the twelve-tile contact sheet.
- ~~`@panoma/video-mcp`~~ — eleven tools, in-memory and stdio tests, the end-to-end test on a
  fixture product.
- ~~ReleaseTrailer~~ — the measured genre grammar as a recipe.
- ~~FeatureSpotlight~~ — a real app flow becomes a 20–26 s product film in the
  reference grammar: controls rendered by the page at up to 8x, one camera over the
  page, pointer and press on the beat, the result unfolding where it happened, the
  claim as the name of what was seen, exact brand theme/logo, all three formats.
  Rebuilt 2026-09-02 from device mockups to isolation by scale ([platform.md](platform.md)).
- ~~Procedural music bed~~ — from the beat grid, no third-party rights.
- ~~Motion library~~ — Cap's cursor spring, keystroke chips, idle cuts, zoom chaining.
  Wired 2026-09-04/05: the pointer, the press and the chained zooms draw in the
  Tutorial, the trailer and the cast; keystroke chips and the idle map are still arrays
  nobody reads ([motion.md](motion.md), Known limits).
- ~~A track you bring~~ — `--music=<file>`: measured, cut to its first downbeat,
  stretched at most 4.2% to a tempo with whole frames per beat, every cut on its beats, the
  picture punching in on its kicks; the brain directs the film's row, bed and dance
  ([music.md](music.md), [brain.md](brain.md)).

## Delivery loop (built 2026-09-05)

- ProductPromo scene revisions, exact untouched copy, source validation and atomic history.
- Story controls, natural-language adjustments and version restore.
- Shared encoded/story review with actual settled-frame editorial layout measurements.
- CLI and MCP revision exports use the saved story, including review/frame lookup.
- Cross-product audit reports insufficient material explicitly; audience performance remains unmeasured.

The browser studio that first drove this loop was removed on 2026-09-07: panoma video became a
feature of panoma, which already has exactly one web surface. The revision, review and
export path it called survives behind `panoma-video story`, `panoma-video revise`,
`panoma-video render` and the MCP tools; its persistent job queue went with it, because only the browser enqueued work.

See [studio-workflow.md](studio-workflow.md) for the flow and its boundaries.

## Booked, not yet built

- **A safe-zone check in the review.** `zoneViolations` exists; the render plan needs
  the card rectangles per format for `platform.<target>.safe` to report on them, and
  the Reels decision in open questions says whether it warns or fails.
- **Changelog recipe.** Its beat sheet is in the genre research; the plan already
  decides `changelog`, but nothing consumes it.
- **The brand theme inside the older recipes.** FeatureSpotlight consumes
  `brandTheme(profile)` directly; ReleaseTrailer, Tutorial and the original recipes
  still read the module constant. A `ThemeContext` at the composition root is the wiring.
- **Caption policy by format.** Verbatim in 9:16 and 1:1, two-to-four-word labels next
  to the zoomed control in 16:9 (Mayer's redundancy principle).
- **Keystroke chips and the idle map.** The two halves of the motion library that still
  draw nothing: the Tutorial keeps its own keycaps, and the idle map needs per-frame
  YDIF from the review that nobody supplies.
- **Longer holds in the walk.** The walker's `HOLD_MS` 1000 / `AFTER_CLICK_MS` 1500 are
  sized for a montage; a tutorial planned from the walk (`panoma-video auto --goal=tutorial`)
  still freezes its hero step under a sentence (`story.stalls`). `panoma-video teach` holds
  3.2 s and does not. Raising them is a `TOUR_VERSION` bump — every workspace re-walks.
- **Cost caps in API units** (`PANOMA_VIDEO_MAX_VOICE_CHARS`, `PANOMA_VIDEO_MAX_VEO_SECONDS`) and a
  `--dry-run` that prints the estimate.
- **Spanish lexicons** for the walker before it runs on a Spanish interface.
- **A way to reclaim a workspace**: a per-project renders cap and a command to prune
  what it keeps; a workspace accumulates takes.
- **Product Hunt kit sizes** (1270×760 gallery stills, 240×240 thumbnail).
- **Captions for clips we did not generate.** `transcribe()` in @panoma/video-audio already
  returns word timestamps from Scribe; what is missing is a recipe that eats a
  founder's mp4 plus those words. It is the field's #1 commodity feature
  (Submagic, Captions) and ours would run locally, on material that never leaves
  the machine.
- **The release trigger.** The flagship move from market-gaps.md: a pushed tag →
  `panoma-video ideate` on the tag range → brief → matrix → kit, so every release ships its
  own trailer. All three pieces exist; the trigger and the tag-range ideation do
  not. Nobody in the field reads a repository, so this stays unclaimed until we
  claim it.

## Phase 3 — AI pictures
- Veo b-roll stage in `panoma-video assets` (brief gains a `broll` field with per-shot
  prompts; cache makes retries free; remember: server keeps videos only 2 days).
- Nano Banana stills for thumbnails and image-to-video first frames.
- fal.ai adapter as second backend (Kling 2.5 Turbo for cheap volume; Wan/LTX-2 for
  open-model experiments).

## Phase 4 — the factory
- ~~**Brief-writer agent**~~ — built 2026-09-03 as `@panoma/video-brain` ([brain.md](brain.md)):
  the claude or codex agent on the machine (or a key) reads the product, chooses what the
  camera sees pressed, writes the words in every language, fixes what a review says the
  words can fix, and writes the post copy — under the fact audit, cached, capped, logged,
  and always under a person's patch. The OpenChatCut lesson holds: the model edits the
  brief, the renderer stays deterministic. Next: hook scoring against past performance.
- A/B loop: publish variants, read platform analytics, feed back which hooks win.
- Publishing automation (upload APIs / buffer-style scheduling) — research first;
  platform APIs for organic posting are the weak point of every tool in the field.

## Native mobile apps — surveyed 2026-09-04, not started

The whole survey, with measurements, licences and a phased plan, is
[native.md](native.md). Read it before starting; the short version:

- **Android is reachable at full quality** with free software only, and it is the one to
  build first. The differentiator is a ~400-line capture APK — an `AccessibilityService`
  that hands back the tree, the rectangles, a timestamp and the "what changed" signal
  from one process. Density is a real re-render on an AVD built large (4x default, 8x
  matches the web), not an upscale.
- **iOS gives two of the three requirements.** The tree (`idb`, MIT) is excellent and in
  the same coordinate space the driver taps in; the recording is 3x native at 60 fps —
  measured on this machine. But there is no clip+scale anywhere in the platform, so the
  push-in has a budget of ~2.4x against ~6x on the web. And it requires a Mac.
- **Web emulators are not the shortcut they look like.** They hand back a pixel stream and
  take away the geometry, which is the one trade this repository must never make.

Six phases, roughly four weeks for Android and one more for iOS.

## Someday / maybe
- panoma integration: `panoma` already knows every project on the disk — a brief
  generated from a project's own metadata ("this repo got 47 commits this
  month") is content nobody else can make. This is the fusion the stacks were kept
  compatible for.
- A polish UI (Theatre.js idea): humans tweak curves, files stay the truth.
- **Brand marks from theSVG** (looked at 2026-09-04, not adopted). `@thesvg/icons` is
  6,500+ brand logos plus the AWS, Azure and GCP architecture sets — an *icon* library,
  not the video-asset library it was hoped to be, so it touches nothing in the camera,
  the press or the depth work. Where it would earn its place is a "works with" strip when
  the scout finds integrations (the stack row panoma already prints: Node, TypeScript,
  GitHub Actions…), drawn from the product's own logos rather than typed names. Three
  things to settle before that: the code is MIT but the marks stay their owners'
  (nominative use, not a licence — the guard in `tests/licenses.test.ts` cannot vouch for
  it); the AWS set is CC BY-ND, which is not on the allowlist and must never be
  vendored; and the package is 97 MB unpacked, so the right shape is a handful of files
  copied into `apps/render/public` with a `CREDITS.json` entry each, never a dependency.
