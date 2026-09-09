# AGENTS.md

panoma video is a content engine: one brief in, a matrix of beat-locked short videos out —
every hook x every language x every format, mastered to -14 LUFS. It was built as a
separate project from panoma, on the same stack (pnpm monorepo, TypeScript, ESM, Node
22+) so that the two could be fused; that fusion is now happening, and it is becoming a
feature of panoma. On its own the binary is `panoma-video <verb>`; inside panoma the same
verb is typed `panoma video <verb>`.

## Layout

- `briefs/` — one file per content idea (`@panoma/video-briefs`). The unit of work.
- `packages/core` — beat grid, formats + safe areas, brief types, content-hash cache.
- `packages/audio` — ElevenLabs: voice **with word timestamps in the same call**, music,
  sound effects, transcription.
- `packages/gen` — the STORYBOARD and the video-generation providers that turn its shots
  into clips: one request shape, per-provider capability flags, and the rule that a
  generated shot may never depict the product. Veo 3.1 and Gemini Omni Flash through the
  Gemini API, Seedance through fal. Google Flow has **no API**; Flow credits cannot fund
  API calls. Model ids and prices are configuration, never constants, and a price carries
  the date it was read. [docs/storyboard.md](docs/storyboard.md) is the record.
- `packages/capture` — the product on camera, as code: deterministic screenshots
  and scripted recording sessions (video + semantic input log).
- `packages/engine` — **the renderer, built from scratch on free software only**:
  scenes are React trees evaluated per frame in Node, rasterized deterministically in
  Chromium (Playwright), piped straight into ffmpeg. Own animation math (interpolate,
  cubic bezier, closed-form spring), own audio filtergraph, own loopback asset server.
- `apps/render` — the scene library: recipes turn (brief, format, grid) into frames.
  Five sell, **ReleaseTrailer** announces (the measured genre grammar), and **Tutorial teaches**,
  inverting the clock — see [docs/tutorials.md](docs/tutorials.md).
- `apps/cli` — the `panoma-video` command: assets → render → master, plus
  `panoma-video kit` (platform copy + thumbnail + contact sheet) and `panoma-video ideate`
  (draft briefs from a repository's git log).
- `briefs/sessions/` — typed recording scripts, each with several **takes**
  (desktop 16:9, mobile 9:16); `panoma-video record <name>` shoots them all and leaves
  `<name>.<take>.webm` + `.session.json` in media/source/sessions.
- `briefs/drafts/` — what `panoma-video ideate` writes. Drafts are typechecked but NOT
  auto-registered; a person promotes them into `briefs/index.ts`.

The automatic path — a project in, reviewed videos out — is built from six more
packages, and everything it makes lives under `PANOMA_VIDEO_HOME` (default `~/.panoma/video`, with `~/.vira` honoured while it is the only one on the machine), never
inside the project. [docs/platform.md](docs/platform.md) is the record.

- `packages/scout` — what a project is, how it starts, its routes, and its FACT SHEET:
  every number, command, route and quote a video may state, each with a source.
- `packages/brand` — the product's colours, scheme, logo, type category and tone, from
  its repository and its live page.
- `packages/tour` — walks a running product from the accessibility tree and writes the
  recording script itself, with marks. It also READS one (`atlas.ts`), plans a route
  through it for a request made in words (`lesson.ts`, `panoma-video teach`), and — when nobody
  says — scores every screen it read and picks what deserves the video (`slate.ts`,
  `panoma-video tutorial`). Same script shape, chosen by destination instead of by exploration.
  [docs/lesson.md](docs/lesson.md) is the record.
- `packages/codec` — which encoder writes the file: the operating system's H.264 and AAC
  where it ships them and somebody has measured them there (macOS today), ffmpeg's own
  everywhere else. ffmpeg itself is never bundled. `measure.ts` beside it is how a
  candidate earns its place, and [docs/codecs.md](docs/codecs.md) is the record — including
  the two questions, copyright and patents, that this area is easy to answer with the
  wrong one.
- `packages/review` — the gate: black and frozen runs, cuts on the grid, loudness and
  true peak, flashing, platform conformance, measured on the encoded file.
- `packages/director` — the plan (claims bound to moments that changed the interface),
  the templates, the JSON contracts, the pipeline (`panoma-video auto`).
- `packages/mcp` — `panoma-video mcp`: eleven tools an agent drives the whole path with, plus
  `skills/panoma-video/SKILL.md` for agents that do not use MCP.
- `packages/brain` — the judgement: the claude or codex agent on the machine, or an
  Anthropic or OpenAI key, answering ten typed questions — what the product is, what to
  click, what to say, how to fix a failing cut, how to post it, the route through a product
  that answers a request, which of a product's screens deserves its one tutorial from a menu
  arithmetic already ranked, the shots that are not the software, the film's row and bed and
  tempo, and how to direct a wordless promotion. It phrases; it never states — and the one question
  whose answer is an ACTION is refused again on panoma video's own side, because a rule enforced
  only in a prompt is a request. [docs/brain.md](docs/brain.md) is the record.

## Set up

```bash
pnpm install
pnpm --filter "./packages/capture" exec playwright install chromium
node apps/cli/src/panoma-video.ts doctor
node apps/cli/src/panoma-video.ts list
```

**The browser is a separate, manual download, and nothing runs it for you.**
`playwright@1.62.1` declares no install script, so `pnpm install` fetches no browser —
and the `onlyBuiltDependencies` approval for it in `pnpm-workspace.yaml` approves a build
step that does not exist. The second line downloads roughly 550 MB of Chromium into
Playwright's own cache. Every frame here is rasterized in that browser, so on a clean
clone without it the renderer and every test that draws a frame fail at browser launch,
and the failure comes from inside a render rather than from setup.

Development runs TypeScript natively with Node 22.18+ (`erasableSyntaxOnly`, no enums or
parameter properties), and the engine's `registerHooks` loader compiles `.tsx` scenes at
import time. The installable `@panoma/video` package is different: `pnpm build` precompiles
workspace code and JSX into `dist`, and `pnpm release:prepare` prepares its production
shrinkwrap and notices. The installed tarball must pass `tests/package.test.ts`; source
tests alone do not verify the distributable. See [docs/app.md](docs/app.md).

Before proposing a change: `pnpm -r typecheck` and `pnpm test` (the suite launches
Chromium and ffmpeg; the MCP end-to-end test alone runs a fixture product through the
whole path and takes about five minutes).

The maps of the decision records, by what you are changing:

| If you are changing... | Read |
| --- | --- |
| The installable app, packaging, host protocol, requirements or job spending | [docs/app.md](docs/app.md) |
| The automatic path, the MCP, the plan | [docs/platform.md](docs/platform.md) |
| The brain, a driver, a question, the audit on its words | [docs/brain.md](docs/brain.md) |
| A fact, a route, the start command | [docs/scout.md](docs/scout.md) |
| The walker, marks, selectors, budgets | [docs/tour.md](docs/tour.md) |
| A colour, the logo, a font, tone | [docs/brand.md](docs/brand.md) |
| The look of a product's film, the study, the map, the set of pieces | [docs/studio.md](docs/studio.md) |
| A threshold in the review, a platform limit | [docs/review.md](docs/review.md) |
| The cursor, keystrokes, idle cuts, zoom chaining | [docs/motion.md](docs/motion.md) |
| The music bed, or a track you bring, and the picture that dances to it | [docs/music.md](docs/music.md) |
| Subtitles, provenance, disclosure, safe zones | [docs/deliverables.md](docs/deliverables.md) |
| A tutorial | [docs/tutorials.md](docs/tutorials.md) |
| Depth, the lift, what generation is for | [docs/depth.md](docs/depth.md) |
| Filming a native mobile app — surveyed, costed, **not built** | [docs/native.md](docs/native.md) |
| Anything that looks wrong on purpose | [docs/open-questions.md](docs/open-questions.md) |

## Rules

- **Vendored assets carry a CREDITS.json entry** beside them, naming title, author,
  source, licence and the licence file that must exist. `tests/licenses.test.ts`
  audits the directory both ways: an uncredited file fails, and a credit for a file
  that is not there fails too. A package sweep cannot see assets — half the good
  ones split code from media into separate licences.
- **Free licenses only, enforced by test.** `tests/licenses.test.ts` sweeps every
  installed package — transitive included — against a free-software allowlist and
  fails the suite on anything else. Remotion (source-available) was in this tree for
  one day; replacing it cost the engine rebuild, and the test is why that never
  repeats. The vendored Geist fonts are SIL OFL 1.1 (`packages/engine/assets/fonts`).

- **Keys live in the environment** (`.env`, git-ignored; `.env.example` is the contract).
  This repository is headed for public; a key in a file is a key in history forever.
- **Every cut lands on a beat and a whole frame.** `makeGrid` throws on tempos that
  don't divide the fps — that error is a feature. `panoma-video bpms 30` lists legal tempos.
  A track you bring (`--music=<file>`) is measured and conformed to the nearest such
  tempo — cut at its first downbeat, stretched at most 4.2% with the pitch kept — before
  anything is planned, so the promise holds for it too (docs/music.md, "A track
  someone brings").
- **One thing on screen at a time.** A card is type on the stage and nothing else; a
  shot is the product and nothing else. No claim over a use, no label in a corner of
  a proof, no title over a window pushed back and dimmed. Until 2026-09-03 all three
  happened in every piece — the spotlight typed the claim across the last bar of the
  shot it named and put the interface's answer on a chip beside it, and the trailer
  played every card over the product at 58% dim — and it is the single reason the
  films read as busy: two things were asking for one eye and neither had finished.
  The exception is a CAPTION, which is the narration and belongs over the product by
  definition — and even then only while the product is on screen; over a card the
  narration is already the type in the middle of the frame. `tests/spotlight-scene.test.ts`
  renders every phase of every use and fails on a single text node.
  Since 2026-09-05, `ProductPromo` also supports an explicitly requested split
  composition: stable explanatory text owns one safe panel while the recorded
  product owns a separate panel. They never overlap. This is selected per proof,
  not a new default overlay for the other recipes. A progressive recap follows
  completed demonstrations; it never fabricates live product progress.
- **A card is the opposite polarity of the shot beside it, and its line lands whole on
  the frame of the cut.** Both are consequences of the rule above. With the claim, the
  product and the wordmark all on one ground, scdet scored the cuts between them 5.8 to
  9.5 against a threshold of 10 and the review said — correctly — that a declared cut was
  not visible in the file; a flipped ground scores about 70. And `Arrive`/`KineticTitle`
  reserve every word's space from the first frame so a line never reflows, which is right
  over footage and wrong on a card, where it renders as one word sitting left of centre in
  an empty field. A cut is declared where the GROUND changes and nowhere else: two cards in
  a row are type changing, not a picture changing. The exception is the first card of a
  piece, which keeps the product's ground — a feed shows the first frame as the poster,
  and a black poster is `video.firstframe`.
  Since 2026-09-05, dedicated `ProductPromo` cards can give that complete line one
  finite theme-specific entrance. The first poster stays fully settled; later
  titles stop within 400 ms, and `cards.readFrom` reserves reading time after the
  move. Split explanations remain stationary beside the recording.
  The explicitly selected Grid theme extends this to exact phrase fragments:
  at most three tick-spaced arrivals, each moving for 220 ms, with the whole
  assembly capped at 500 ms by reducing the fragment count at slow tempos.
  Reading starts after assembly; the first poster is still complete at frame zero.
- **A tutorial names its step before the step happens, and never over it.** Every step
  but the first opens on a title card with the frame to itself, and then the product has
  the frame to itself. It is the signalling principle — 103 studies, 12,201 participants,
  retention g+ = 0.53, and the signal has to PRECEDE the action or it has signalled
  nothing — and it is what Guo, Kim & Rubin ask for after measuring 6.9 million viewing
  sessions: tutorials are scrubbed and re-watched rather than played through, so they
  need "visual signposts, such as big blocks of text to signify transitions". Until
  2026-09-04 the step's name was a chip in the corner of the picture, which is two things
  on one screen and no boundary a scrubber can see. The card holds three beats — above
  Netflix's 833 ms floor for a readable fragment, under the two seconds at which a
  signpost becomes the slow lead-in Wistia measures as the commonest cause of early
  drop-off — and the narration starts ON it and runs over the cut, so the sentence is not
  interrupted by the picture arriving. The first step has none: the cold open is already
  a card, and two cards with nothing between them is that lead-in.
- **A camera arrives and then holds.** The move is under half a second and eases out
  (Nielsen Norman: 100-400 ms reads as deliberate, 500 ms is "a real drag"; Material says
  >400 ms "may feel too slow"), it happens under the title card wherever there is one so
  the cut delivers a frame already in position, and then the frame stops. What replaced
  is a push that ran for the whole step on the argument that a held frame needs something
  alive in it — and a frame still drifting under a result somebody is reading is what
  they pause the video to stop. A hold is not a freeze either: a tenth of a per cent per
  second keeps the encoder honest, and every hold is declared in the render plan so the
  review knows the stillness was decided. `tests/tutorial.test.ts` holds both numbers.
- **No model INVENTS the product, and a model may be shown it.** Those are two different
  rules and the first version of this one collapsed them. A shot conditioned on nothing may
  not describe software — a dreamt interface is a picture of a product that does not exist,
  and `refuseGenerated` reads its words, and the BRAIN's answer, before a request is built.
  But a shot conditioned on two real frames of the recording may name the product, because
  it is a photograph of it: that is `interpolate`, and refusing it refused the only
  technique that gives a product film movement on the product itself. What a conditioned
  shot may never carry is a prompt DESCRIBING the frame — the picture is the content, and a
  sentence arguing with it is what makes a model redraw. Between the two true ends a model
  does redraw, so `packages/review/src/drift.ts` measures every bought clip against its own
  panels and the cut takes only what stayed above 28 dB — about a second per eight bought,
  measured, not assumed. `tests/storyboard.test.ts` holds all of it.
- **Depth is read, never inferred.** The control a step is about is lifted onto its own
  plane in front of the page, and its rectangle comes from `MacroAsset` — the thing the tour
  actually clicked, rasterized by the page at up to eight device pixels per CSS pixel. Every
  other tool in this category runs a depth model over a flat screenshot, and a depth model
  trained on photographs reads an interface's contrast as geometry: bowed panels, skewed card
  edges, the clearest tell there is. Three rules keep it honest and `tests/depth.test.ts`
  holds all three — the parallax gap is a function of `scale - 1` so it vanishes at rest and
  never ghosts a doubled edge; `LIFT_GAIN` stays under a tenth; and a lift the camera would
  draw past its own captured density is refused rather than upscaled. It is also gone before
  the press, because a macro is the control as it looked AT its mark and the action after it
  changes the page underneath. [docs/depth.md](docs/depth.md) is the record.
- **Generative video is PARKED, and this is the rule if it is ever unparked.** It was built
  three ways, measured each time, and set down: what a model sells is worth less to a film
  about software than what this renderer already makes. Nothing generates unless somebody
  types a flag. If it comes back: **a generated element sits IN FRONT of the product, on a
  ground that is the opposite of the film's.** Dark app, element on black, `screen`; light app, element on white,
  `multiply` — derived from the scheme, never chosen, because screen-blending black over a
  near-white interface produces nothing at all and did. The blend never replaces a pixel:
  every letter underneath stays readable. An element is bought once for every film there
  will ever be, because it refers to no product. And its ground is measured before it is
  kept: the first one bought here looked black and was 12% black, which composited would
  have lifted the whole interface — `crushGround` moved it to 67% and `groundOf` is what
  decides.

- **Nothing casts a shadow.** No `textShadow`, no `drop-shadow()`, no glow around a
  plate or halo behind a letter, no vignette closing on the frame; a `boxShadow` only
  when every layer of it is `inset`, which is a border that does not resize the box
  its sprites are pinned to. None of what was there had been decided — each one was
  added where a single frame looked thin, and together they are why the films read as
  printed on rather than shot. The eye is held by what is LIT, not by what is darkened
  around it. `tests/house-style.test.ts` reads the source, because a shadow that only
  appears on the press of the second control is one no rendered frame will show.
  The explicitly selected Block editorial theme is allowed the hard offset base
  requested on 2026-09-05: a rounded SVG face over a solid offset plane, without
  blur, lighting filters or any change to the recorded interface. Its depth is
  reserved inside the graphic's layout budget; the face and its text move together.
- **Normal / Flat is the default editorial theme.** A named user choice persists;
  only explicit `--theme=auto` lets the brain choose an expressive theme for a new
  planning run. One theme applies to every added element and every variant of the
  promotion. `panoma-video themes` is the available catalog; [docs/social.md](docs/social.md)
  records the selection and motion vocabulary.
- **Grid is an explicitly selected film treatment.** Its static, faint lattice
  may cover the whole canvas, as requested on 2026-09-05. It never alters the
  recording's decoded pixels, source clock or geometry; the composited image has
  only the declared low-opacity line overlay. No moving scan, grain, blur, glow,
  pixelation or monochrome conversion obscures the product. Flexible stacked
  cards are authored editorial surfaces with exact proof copy, never bent app
  screenshots. They overlap only empty margins and stop before their reading hold.
  Grid's stage and added pieces are monochrome. Its recap brings the cards in on
  consecutive short tick groups, then reserves a shared reading hold; it does not
  pause for a full reading interval between each already-demonstrated benefit.
- **Type over footage cuts.** A word lands whole — plate, letters and final
  variable-font shape on one frame — on the frame the picture has finished moving,
  and nothing about it moves afterwards. It used to arrive in three events (plate,
  then letters rising from behind a mask, then axes still thickening a beat later),
  which reads as a bug because nothing justifies the second and third. The rhythm is
  the arrivals, one per tick; the exception is a piece where the type IS the frame
  rather than an overlay on one (`KineticQuote`'s slam), which is a shot.
- **The interface is quoted only where it speaks in names.** `isName` in
  `packages/director/src/plan.ts` gates every `ui.*` fact: at most six words, no
  second sentence, no line break. A landing page's h2s are whole marketing sentences
  and one of this project's own buttons wraps a paragraph — quoting those gives a
  narrator reading advertising copy with "Then" in front of it. A tutorial that
  cannot name a control says less; it never guesses, and below three steps it is not
  written at all.
- **Recipes are format-blind.** They lay out against the `Format` they receive (stage =
  canvas minus platform safe areas). If a recipe asks "am I vertical?", the answer
  should be a layout token, not a pixel constant.
- **A take shares the aspect of the canvas it serves**, and the product fills the
  frame: `castFrame` measures against the canvas, not the safe stage.
  `tests/frame.test.ts` fails if a format drops below its fill threshold — that
  test is a scar, not a preference. The one recipe that isolates a control on a dark
  stage instead (FeatureSpotlight) does it at the control's own pixels, rendered by
  the page at up to 8x — never a crop enlarged past its ratio, and a test walks every
  frame of its plan for that.
- **A file is never drawn past its own pixels.** A 2x frame is gone above 2x, a clip
  waits for the camera to come down to its ratio, and a control the take could not
  render at macro scale is shown small from the page and reported by name — the
  honest shot, never an upscale and never silent.
- **Type always lays out through `Stage`**, in every recipe, without exception. The
  window may fill the canvas; the words may not. A scrim solves contrast and does
  nothing about the platform painting its own caption over that strip — those are
  two different problems, and conflating them once put the CTA of every vertical
  cut behind TikTok's action rail.
- **Accents land on ticks, cuts land on beats.** `grid.tickFrames` is the largest
  whole-frame subdivision of a beat; a half-beat is 7.5 frames at 120/30 and does
  not exist. Never write `beatFrames / 2`. A tempo conformed from a brought track
  can give a PRIME beat (13 frames at 138.46 BPM), which has no subdivision at all:
  the tick is then `round(beatFrames / 3)` and is not a divisor, so anything that
  needs a whole count of ticks in a beat asks `grid.ticksPerBeat` and never divides.
- **A recording step names its destination; it never counts pixels.** `clickOn` a
  selector, `scrollTo` a heading. A pixel scroll means different content in different
  layouts, and the desktop and mobile takes of one session are the same tour — so
  "scroll 900" landed on the pitch in one and three sections past it in the other, and
  the Spanish vertical cut narrated the front door over a screenshot of Twin. Naming
  the destination is also what collapsed two hand-tuned step lists into one.
- **A recording step declares its `role`.** Consent banners, logins and cookie
  walls are `"chrome"` and earn no shot. The default is `"product"`.
- **A hook id and a line id may not collide.** Both are written into one directory
  named by id, so the second silently overwrites the first and the render plays the
  hook's sentence under a step, in sync, with no error. `makeAssets` refuses.
- **Videos must work muted.** 75-85% of short-form is watched without sound; captions
  and on-screen type carry the argument, audio is the reward.
- **Type over footage is sized against the CANVAS, not the stage.** `captionSize` is
  6.667% of the short side (BBC ttml T.8) — 72px at 1080. The stage-derived
  `typeScale` is right for a recipe whose type *is* the composition, and it silently
  produced 27px captions on a 1080px canvas for every recipe that lays words over a
  recording.
- Prose in this repo (comments, docs, commits) is English.
- **A tutorial's clock belongs to the narration, and the footage is retimed to meet
  it.** Sentences are pinned to named `mark` steps in the recording, never to
  timestamps: a timestamp is wrong the moment the product changes and nothing says so.
  The retiming has two rules — footage never plays below the conform rate (that is the
  judder), and it is never cut off mid-action (the step widens instead). A step that
  ends up holding a frozen picture for most of its span is reported by mark and fixed
  by a person, with more footage or fewer words.
- **Recipe clocks live in `apps/render/src/recipes/timing.ts`** — plain TS, no JSX,
  imported by scenes, voice offsets and tests alike. A duration inside a component
  can only be tested by rendering; a duration in timing.ts is arithmetic.
- **A generated video states facts, not prose.** A brief the director or an agent
  writes references every number, command, route and version as `{{fact:id}}`; panoma video
  expands it verbatim and `auditClaims` refuses a literal digit, an unknown id, a
  roadmap item quoted as shipped, or a fact placed in the wrong language track.
  Hand-written briefs in `briefs/index.ts` are never audited.
- **A claim needs a proof, and a proof is a state change.** `packages/core/src/story.ts`
  binds claim cards to marks whose click changed the interface; a scroll to a heading
  proves nothing unless the project is a static site, and that piece is a site tour,
  never a trailer. Without two bound pairs there is no trailer, and the skip says what
  would unlock it.
- **The brain phrases; it never states.** A model's patch goes through `sanitizePatch`
  in `packages/director/src/brain.ts` — the same `auditClaims` an agent's patch passes —
  and every line and language that introduced a claim is refused back to the template,
  by id, with the token it tried to say. A brain answer is validated against its zod
  shape, cached on its inputs, counted against `BRAIN_CALL_CAP`, and logged. The brain
  never clicks: the walker offers it candidates and keeps the destructive, external and
  chrome lists as its own. `--brain=none` is the pipeline without it, byte for byte.
- **Every failing review check names who fixes it** (`fix.by`: plan, record, tour, engine,
  none), so an agent never loops blindly. Picture checks (black, frozen, duplicates,
  first frame) warn and never fail: a dark interface is 98% black to a luma threshold.
- **Nothing is written inside a project, nothing runs its install script, no `.env` is
  read, and credential-shaped text is masked before the first frame.** The project
  path is the trust boundary; the dev server binds 127.0.0.1 on a free port that the
  Fetch standard does not block, and its process tree is killed on stop.
- **A tool result over MCP is a summary that ends in the next step, a structured mirror
  with no base64, and images only as JPEG blocks under 80 KB.** Claude Code's result
  cap does not exempt images. Every tool takes `project_path`; an agent never carries
  an id panoma video can derive.
- **The matrix is a factory.** `buildCompositions(briefs, dirs)` serves the repository's
  own briefs and a workspace's JSON briefs alike; `--project=<id>` points the CLI at a
  workspace. Every composition carries a `RenderPlan` (cuts and their kinds, holds,
  cards) that the review subtracts before it judges.

## Traps already paid for

- **Playwright records video at 25 fps and does not expose the setting.** A 30 fps
  timeline seeking into it repeats one source frame in every six — five freezes a
  second, invisible on a still page and nauseating on a scroll. `castSpeed`
  conforms the take frame for frame (the PAL speed-up trade) instead of resampling
  it in time. Any new recipe that seeks a take must use it.
- **A scroll is animated inside the page, never by stepping `mouse.wheel`.** A
  wheel notch is a discrete jump: a 1200 ms scroll became twenty-four instant 33 px
  jumps. `requestAnimationFrame` + `scrollTo` gives the browser's own 60 Hz, and
  `scroll-behavior` must be forced to `auto` first or a site's own smooth scrolling
  fights the easing.
- **Playwright never upscales `recordVideo`**: a size larger than the capture is
  letterboxed onto gray, silently — and the emulated `deviceScaleFactor` does not
  reach the screencast, so with it alone the size must equal the viewport. A REAL
  scale factor (`--force-device-scale-factor=2` at launch) makes the screencast 2×
  at the same layout, and `recordTake` records at viewport × 2 that way since
  2026-09-04; it also multiplies a CDP clip's `scale`, which `captureClip` divides out.
- **Video zero is the first presented frame, not page creation or navigation.**
  Capture 17 starts the public screencast before navigation and rebases event times
  to its first browser presentation timestamp. `SessionLog.videoClock` records the
  correction already applied; never add it again. `readyMs` marks the blank head
  the cast seeks past. The older page-creation clock could place a cut after the
  real navigation while the semantic log still said the click was ahead.
- **`transform-origin` does not bring a point into view** — it pins it. Zooming
  "on" something means scaling about the centre and translating it there, clamped
  so the scaled content still covers the box (`zoomTransform`).
- **`box-sizing: border-box` makes a `border` eat the content box.** Frames are
  drawn with an inset box-shadow instead.
- **Variable fonts must be vendored as raw TTF from `google/fonts`.** The Google
  Fonts CSS API answers a non-browser agent with per-weight STATIC slices, and
  Fontsource ships per-axis subsets whose default import silently drops every axis
  but weight. In both cases `font-variation-settings` then does nothing, without an
  error — the animation just never happens.
- A test (or any Node code) that needs an engine export must import a JSX-free
  submodule (`@panoma/video-engine/math`, `@panoma/video-engine/server`) — the package index pulls
  in .tsx and dies without the loader hook.

- A static `import` of a `.tsx` file dies before `@panoma/video-engine/register` can install
  the JSX hook — the module graph links first. Scenes are imported **dynamically**,
  after the register import. The CLI's `stage()` helper is the pattern.
- `erasableSyntaxOnly` forbids constructor parameter properties, not just enums —
  declare fields explicitly.
- pnpm leaves removed packages in `node_modules/.pnpm` until a fresh install; the
  license sweep sees them. `rm -rf node_modules && pnpm install` is the honest purge.
- **Environment files are explicit.** The CLI never loads `.env` on startup. For development,
  use `node --env-file=.env apps/cli/src/panoma-video.ts`; an installed host passes only its
  approved provider credentials. `doctor --json` performs local prerequisite checks only.

- JSX does not process ` ` escapes in text — it renders the literal characters.
  Write `{" "}` inside braces. This shipped a broken frame once already.
- pnpm 11 blocks dependency build scripts: approvals live in `pnpm-workspace.yaml`
  under `onlyBuiltDependencies`, and a change there needs `pnpm rebuild <dep>`.
- `erasableSyntaxOnly` needs TypeScript 5.8+; the workspace pins 5.9.
- A word popped with `transform: scale()` does not reserve layout space — keep pops
  ≤1.12 or neighbors collide (the launch video's parade taught the same lesson).
- ffmpeg filter expressions: commas inside `aevalsrc`/expressions must be escaped
  (`\\,`) or the parser splits the filter and blames the *next* option.
- **An encoder's options are not portable, and a wrong one fails at full speed.**
  `h264_videotoolbox` holds a rate through `-constant_bit_rate` and stops the moment
  `-maxrate` is set beside it — the same flat card, 33 kbps against 4.4 Mbps.
  `h264_mf` rejects `-profile:v high` outright, because that option wants a number there.
  And rate control converges: on a card at 5 Mbps, libx264 lands 1,097 kbps short at a
  second and a half and 46 short at twenty. Measure with `packages/codec/src/measure.ts`
  before believing any of it.
- **ffmpeg 9 + libx264 writes colour tags only from the frames** — `setparams=…bt709`
  in the filter chain; the `-color_primaries/-color_trc/-colorspace` output options
  alone left primaries and transfer "unknown". And **loudnorm's remux came out at
  96 kHz** until `-ar 48000` was forced: it resamples to 192 kHz inside and hands the
  encoder whatever it likes.
- **loudnorm's `linear=true` is a request, not a promise.** It is honoured only when
  the measured true peak plus the gain stays under the target ceiling; otherwise the
  filter silently compresses (its dynamic mode), and every automatic master took that
  path while the header promised a linear one. The master now measures with loudnorm
  and applies the gain itself (`volume`), then a limiter at -1.6 dBFS holds the file
  under -1.0 dBTP; a dry run corrects for what the limiter takes. Without the limiter a
  bed plus a tick went out at -0.8 dBTP and the review failed the master.
- **`blackdetect` calls a dark interface black** (98% of pixels under the luma
  threshold), and `freezedetect` calls a still page frozen under a slow camera. Both
  warn, neither fails.
- **A workspace is named by the scout, not by the folder.** `acme-catalog-2b810f33`
  comes from the package name; `openWorkspace(root)` without the scout's id derived
  `product-2b810f33` and `panoma_video_review` looked for renders in the wrong directory.
- **`page.setContent` reuses the document**, so an `addInitScript` observer installed
  on it is wiped by `document.open()`; test init scripts with a real navigation
  (`page.route` + `goto`), which is what the recorder does.
- **The bed is mounted only when its file exists, and the matrix is what says which
  beds exist** — build it twice: once to learn the beds, once with them on disk.
- **A tour's clicks are optional on tape.** A control that existed when the walker
  looked and not when the camera did (a player's Play button) killed the mobile take of
  panoma's site until every `clickOn`/`scrollTo` from a tour carried `optional: true`.
- **A mark is written before the scroll to its control, so at the mark the control may
  be off-screen.** The capture then photographs nothing there and arms the next product
  click to take the clip the instant before the press (`MacroAsset.at: "press"`), and the
  plan reads a segment by its *press*, not its first action — read as its first action,
  a scroll-then-click step was a "scroll" step with no push and no lift, three of five
  in panoma's tutorial. Anything that draws a press-captured clip over the footage is
  only true from the press on: its box is a place on the *scrolled* page.
- **A conformed tempo is a whole number of frames that the double disagrees with.**
  `1800 / (1800 / 14)` is 13.999999999999998, and `makeGrid` used to throw on it as a
  fractional beat. It rounds to a millionth of a frame now; write the grid's tempo as
  `fps * 60 / n` and never as a decimal you typed.

## Do not

- Do not hardcode a generation model id deeper than one obvious constant.
- Do not add a formatter or reformat files you are not changing.
- Do not put anything in `media/` under version control (it is git-ignored output).
- Do not write into a project panoma video is filming, run its install script, or read its
  `.env`. Outputs go under `PANOMA_VIDEO_HOME` only.
- Do not print to stdout from anything the MCP server can reach; the transport is
  stdio and one stray line ends the session (`tests/mcp-stdio.test.ts`).
- Do not let a test reach a real brain: this machine has the claude CLI on PATH, so a
  suite that runs `auto` sets `PANOMA_VIDEO_BRAIN=none` first, as `tests/mcp-tools.test.ts` does.
