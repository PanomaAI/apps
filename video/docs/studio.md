# The studio: the product's own film, not panoma video's film with the product in it

> "The background of the videos must be the same colour as the app's theme. The app
> should first create every asset and element it will use. Not the same video for every
> app with only the app swapped. Here is the app: make a diagram of how it works,
> generate the assets, and have everything ready for intelligent, fluid video
> generation." — the owner, 2026-09-03

This record is the plan that answers that, written before a line of it was implemented.
It states what the disk shows today, the four movements, the sequence, and — at the end,
because it is the part a plan usually hides — the sameness this plan does *not* remove
and who decides when it does.

It was designed by five independent proposals (a pre-production lead, an art director, a
growth strategist, an architect and a skeptic), scored by three judges, synthesised, and
then attacked by three critics who found three blocking defects in the synthesis. Every
number below was verified against this disk after that attack; where a critic's claim did
not survive verification, the corrected census is printed instead.

## What the evidence shows today

Five contact sheets from three products, stacked into one image, read as one film with
the app swapped. The causes are all in the code, and none of them is the renderer:

| Cause | Where | Effect |
| --- | --- | --- |
| One palette module for seven recipes and four shared components | `apps/render/src/lib/theme.ts:6-20`, imported by `KineticQuote`, `Loop`, `ReleaseTrailer`, `ScreenCast`, `ScreenDemo`, `TerminalRun`, `Tutorial`, `Backdrop`, `KineticTitle`, `captions`, `ProductWindow` | Every product's film is shot on `#0a0a0a` with `#d2bd7f` accents |
| Only `FeatureSpotlight` receives a brand | `apps/render/src/compositions.tsx:806`, `FeatureSpotlight.tsx:68` | The one branded recipe is the exception, not the rule |
| `brandTheme` is all-or-nothing | `packages/brand/src/index.ts:106-118` | One `low` confidence among primary/background/text throws away a **high**-confidence measured background |
| One recipe per goal | `packages/director/src/plan.ts:306-386`, `templates.ts:146,184,305,332` | Two web apps get the same piece, in the same order, at the same length |
| One tempo, one key, one seed, one bed style | `templates.ts:148-149` (`bpm: 120`, `fps: 30`), `packages/audio/src/bed.ts:385-387` (`seed: 1`, `key: "A minor"`), `compositions.tsx:183` (`style: "calm"`) | Every product's film is scored with the same eight-second phrase |
| One opening and one close, enforced by the gate | `templates.ts:107,152` (`{{fact:name}} {{fact:version}}`), `story-checks.ts:123-133` | The review warns unless every film opens with the name and closes with the address |

The census of every workspace on this disk, verified 2026-09-03 (the synthesis claimed
"two of three studios are empty"; that was wrong, and this is what is actually there):

| Workspace | background | primary | heading | tour | frames / elements / macros (both takes) |
| --- | --- | --- | --- | --- | --- |
| universend (×3 runs, one product) | `#02030a` | `#dbff64` | sans | 12 steps, 3 marks | 3 / 2–3 / 2–3, `afterControl` yes, `after` **none** |
| panoma-monorepo | `#f8f9fc` | `#b0800f` | sans | 38 steps, 12 marks | 12 / 10 / 10, `afterControl` 7, `after` 1 |
| panoma-web | `#f8f9fc` | `#b0800f` | sans | 38 steps, 12 marks | **0 / 0 / 0** (stale) |
| panoma-site | `#fafafa` | `#0a0a0a` | sans | 29 steps, 9 marks | **0 / 0 / 0** (stale) |
| acme-catalog (fixture) | `#0a0a0a` | `#d2bd7f` | sans | 16 steps, 5 marks | **0 / 0 / 0** (stale) |

Three facts in that table decide most of this plan. **Every product's measured background
is high confidence** — so the stage can be the product's own ground today, without any new
measurement. **Every heading category is `sans`**, so the "type voice" is not a
differentiator on this disk and must not be sold as one. And **three of five studios are
empty**: they were filmed before the element capture existed, nothing says so, and every
piece that needs a control at macro scale is silently unavailable there.

Two more, found by the critics and verified:

- `brand.json` carries `source.url` — the loopback address with the OS-assigned port,
  different every run — and `source.extractedAt`, a wall clock (`packages/brand/src/live.ts:286`).
  **Its file hash can never enter a cache key.** The derived object can; the file cannot.
- The record cache key hashes `brand.scheme.default` (`auto.ts:480`) and the recorder is
  handed the same value (`auto.ts:531`). Changing one without the other pins every existing
  workspace to takes shot in the wrong scheme, for ever, silently.

## The decision, in one paragraph

panoma video stops being a factory that fills one template per goal and becomes a studio that
works in four movements. **The Look**: a `Direction` is derived per product from what the
brand pass measured — the stage is the product's own ground, moved just far enough that
the product still reads on it — and reaches every recipe through one theme context, so
panoma video's `#0a0a0a` and `#d2bd7f` can no longer touch another product's frame. **The
Studio**: a disk-only `study` stage indexes everything the takes already left and derives
the assets that do not exist yet (the mark on its own stage, the wordmark, poster stills,
the palette card, the map), computes which shots the material can honestly support, and
reports every gap with the name of who closes it. **The Map**: the walker's screen graph
is persisted and drawn in the product's colours — the diagram of how the app works, from
edges the tour actually walked, never a line it did not. **The Set**: a piece carries a
job and an objective, the platform narrows which formats render, and a short "stop" cut
and a loop are built from the recipes that already exist. Every movement is arithmetic:
`--brain=none` produces the same set, in the same colours, with the same map. The brain
still only phrases.

## Movement 1 — The Look

### The shape

`Direction` is a pure value. The plan put it in `@panoma/video-core`; it shipped in
`@panoma/video-brand/direction` instead, because the derivation needs `mix`, `oklabChroma`,
`contrastRatio` and `stackFor`, which live in `@panoma/video-brand` — and brand already depends on
core, so core importing brand would be a cycle. What the plan was right about is the
danger: `@panoma/video-brand`'s only export statically imports `playwright`
(`packages/brand/src/index.ts:15`) and `apps/render` consumes this per frame. The answer is
a **pure subpath** — `packages/brand/package.json` gains `"./direction"` — whose file
imports only `color.ts`, `contrast.ts`, `fonts.ts` and `types.ts`, and `apps/render` gains
`@panoma/video-brand` as a dependency it did not have.

```ts
// packages/brand/src/direction.ts
export type Signal = "chromatic" | "mono";
export type Surface = { hex: string; from: "measured" | "derived" | "patch" | "default"; why: string };

export type Direction = {
  version: number;                 // DIRECTION_VERSION — part of every key
  name: "editorial" | "kinetic" | "plain";
  scheme: "light" | "dark";        // the FILM's scheme, derived from the stage
  signal: Signal;
  stage: Surface;                  // the product's background, offset to clear the page (below)
  page: string;                    // the product's background verbatim — what the recording paints
  plate: Surface; scrim: { hex: string; alpha: number };
  ink: Surface; muted: Surface; faint: Surface; line: Surface;
  accent: Surface; onAccent: Surface;
  inverted: { stage: string; ink: string; muted: string };
  fonts: { display: string; body: string; mono: string; detected: { heading?: string; body?: string; mono?: string } };
  motion: { push: [number, number]; drift: number; enters: ("cut" | "flash" | "whip")[] };
  furniture: { caption: "plate" | "chip"; glow: boolean; rule: boolean; window: "chrome" | "bare" };
  sound: { style: BedStyle; key: string; bpm: number };
  contrast: { pair: string; ratio: number; aa: boolean }[];
  branded: { stage: boolean; accent: boolean; ink: boolean };
  seed: number;
};
```

### The derivation, rule by rule

Every rule is arithmetic over `brand.json` plus two shape numbers from the profile and the
tour. **Trust is per swatch**, which is the correction to `brandTheme`'s cliff: a measured
background at `confidence: "high"` is used even when the primary is `low`.

| Field | Rule | Why |
| --- | --- | --- |
| `page` | `colors.background.hex`, verbatim | This is what the recording itself paints; the stage must be measured against it |
| `stage` | `page`, pushed away from `page` toward black or white until the contrast between them is at least `STAGE_SEPARATION` (1.25:1), capped at 8% of the way | The critic's finding: set the stage to the app's exact background and the product window's chrome (`ProductWindow.tsx:99`, 5% off) and its ring (12%) vanish into it, and the recorded page has no edge. The stage is the app's colour *moved just enough that the app reads on it*, and `why` records the offset |
| `scheme` | `isDark(stage)` | The film's scheme, which is what the walker and the recorder must be told — not `brand.scheme.default` |
| `signal` | `mono` when the primary is near-neutral (OKLab chroma < 0.05) or `confidence: "low"`; else `chromatic` | A near-neutral brand gets no glows, no rings, no rails, and `accent = ink`. It never gets panoma video's gold |
| `accent` | `colors.primary.hex` when trusted; else `ink` | `#d2bd7f` appears in no derived direction, ever |
| `plate` / `scrim` | `colors.surface` when trusted, else `mix(stage, ink, 0.06)`; the scrim is the **stage** at α 0.62 | Type over footage sits on the product's dark, not on `rgba(0,0,0,…)`; on a light product the plate is light and the ink flips |
| `ink` / `muted` / `faint` / `line` | measured text colour, then panoma video's ratios (`0.2`, `0.33`, `0.88`) **against the product's own stage** | The ratios are ours; the endpoints are the product's |
| `fonts` | the detected category mapped to the four bundled OFL faces (`packages/brand/src/fonts.ts:87-101`) | Only Geist, Geist Mono, Fraunces and Anybody can load (`packages/engine/src/document.ts:26-54`). A product's own webfont is never downloaded, and the record says so |
| `sound` | `style` from tone register and scheme; `key` from a fixed list indexed by the seed; `bpm` from the legal tempos of `makeGrid(bpm, 30)` | Three literals today (`calm`, `A minor`, `120`) make every product's film carry the same eight-second phrase. The bed hash already keys the render, so this costs nothing |
| `motion` / `furniture` | the named direction's row, clamped into the ranges the clock tests already pin | A direction may change rhythm and furniture. It may **never** change a colour |
| `seed` | `inputHash(profile.name, brief.id, DIRECTION_VERSION)` | **Not** `ws.id`: that is `<folder>-<8 hex of realpath>` (`workspace.ts:29-30`), so the film would change when the checkout moves and two people filming one repository would get two films |

Three named directions, not six: `editorial` (light stage, mono or low-chroma, rules and
plates, cut-led), `kinetic` (dark stage, chromatic, glows and whips, flash-led), `plain`
(the safe row: no glow, no whip, plate captions — what a low-confidence brand or a
narration-clocked tutorial gets). The other four the art director proposed (`macro`,
`documentary`, `speedrun`, `loop`) are booked rows with no code until a piece needs one.

**The rule that keeps this honest, asserted by test: a direction may change motion,
furniture, shot vocabulary and hook shape; the colours always come from the product.**

### How it travels

The film's scheme is computed once from the brand (`filmSchemeOf`) before the tour, so
`direction.scheme` — not `brand.scheme.default` — is what the walker and the recorder are
told, **and what the record cache key hashes** (`auto.ts:456`, `:464`, `:480`, `:531`, all
four in one edit; this reshoots both takes on every existing workspace, which is the
correct cost). The `Direction` itself is decided after the takes are on disk — the tour's
shape is one of its inputs — and written to `direction.json` in the workspace, with the
arithmetic proposal, what was chosen, who chose (`by: "arithmetic" | "brain"`), the reason
and any clamp (Movement 8). It rides into the render three ways: `Dirs.direction` for the
element factories, `brief.params.direction` and `brief.params.seed` (already a hashed part
of the expanded brief, `schema.ts:47`), and the object itself folded into the render key —
`inputHash("render", …, direction)` — because the file it came from carries a port and a
clock and can never be hashed.

A person overrides any of it in `brand.patch.json` (name, scheme, six hexes, logo),
merged before `brand.json` is written and re-read on a fix pass. It is the second patch
file in the system, not the third: `dossier.patch.json` is refused.

## Movement 2 — The Studio

`panoma-video study <path>` (`auto({ until: "study" })`, plus `panoma_video_study` over MCP) is a
**disk-only** stage at the seam `auto.ts:556-571`: after record, before plan. It reads
`tours/`, `sessions/`, `brand.json`, `direction.json`, `facts.json`, and never the live
server — so the fix pass (`camera: false`) rebuilds it, and `--brain=none` changes nothing
about it.

It does two things the synthesis had it doing only one of. It **indexes** what the takes
already left (frames, component crops, macro clips, their boxes, pixel ratios, marks and
outcomes), referencing the files where the recorder put them — nothing is copied, because
the engine already serves `sessions/` and universend alone carries eight 4.5 MB PNGs. And
it **derives** the assets that do not exist yet, which is what the owner asked for by
name:

```
study/
  index.json          the one file an agent, a person or panoma reads
  material.json       per mark: which shots this material can honestly support
  gaps.json           what is missing, with who closes it
  identity/mark.png           the logo on the film's own stage, at its own pixels
  identity/mark.mono.png      the mark reduced to ink, when its source allows it
  identity/wordmark.png       the name set in the direction's display face, on the stage
  palette.png                 the swatch card: every surface, its origin, its contrast
  posters/<mark>.<format>.jpg the poster frames (Product Hunt, OG, a thumbnail)
  map.svg / map.png           Movement 3
  book.html                   one page: what the studio has, and what it lacks
  study.key
```

The **material matrix** is arithmetic over the session logs: `press` needs a macro clip
with an `afterControl`; `unfold` needs a macro `after`; `reveal` needs a `change` box;
`logo-out` needs a mark whose longer edge clears the logo floor; `map` needs at least
three nodes. A shot whose material is missing is never planned — which is why the matrix
exists rather than a list of hopes. On this disk it says: universend supports `press` and
not `unfold` (no `after` on any mark); panoma-monorepo supports both; the other three
support nothing at all.

**Gaps** speak the review's vocabulary — an id, a summary, a hint, and who fixes it — but
they are a `Gap` type of their own, not a `ReviewCheck`. The reason is exact:
`ReviewFix.by` has no member meaning "a person must act", `none` is documented as
"informational; there is nothing to do" and is asserted as the pass marker
(`review-types.ts:22`, `tests/review.test.ts:126-128`), and widening that union touches
every consumer and the published skill table. So `Gap.by` is
`person | record | tour | brand | engine`, printed by the same report path, converted to a
review check only if one ever needs to enter a review report.

The first gap it will report, on three of five workspaces: **this studio is empty**. That
gap deletes `sessions/<id>.key`, so the next run re-records instead of reusing takes that
carry no material. Today nothing says it and every macro-scale piece is silently
unavailable.

## Movement 3 — The Map

The walker already knows the graph and throws it away: `walk.ts:67-86` keeps
`seenStates`, `visitedUrls`, `pagesVisited` and the queue in memory, and the refusal "this
leads to a state the tour has already shown" is exactly a back-edge. Persisting it is
`pages[]` and `edges[]` on `TourScript` behind a `TOUR_VERSION` bump — which re-walks but
does not reshoot, because the record key hashes the *steps*, not the version.

`map.svg` is drawn by hand (BFS layering, no graph library) in the direction's colours,
byte-identical on two calls. Three rules, all from the honesty critic and all worth having:

- **An edge is drawn only where the tour actually walked it**, and it carries which takes
  reached it — the mobile re-walk misses links the desktop walk took. A back-edge to a
  state already shown is drawn distinctly, because it is real and unfilmed.
- **Every label passes `redact()`** and prefers a fact id over raw page text. Today no
  walker text is ever published; `map.svg` would be the first artifact to publish page
  headings, and the kit is a public surface.
- The map **ships as a file first** — in the study, and in the kit only once the labels
  are fact-backed. Promoting it to a shot costs a recipe section, a `RenderPlan` builder, a
  frame-text test and a per-frame pixel walk, and on this disk it would fire for one
  product. Booked, with the reason.

## Movement 4 — The Set

A piece gains a **job** and an **objective**, and the platform narrows which formats
render instead of every brief rendering all three:

| Job | Objective | Formats | Opening | Length | Evidence |
| --- | --- | --- | --- | --- | --- |
| `announce` | announce | h, v, s | the name, inside 5 s | the trailer's grammar | measured (genre sweep) |
| `prove` | convert | h, v | the pixels the use changed | 20–26 s | measured (two reference films) |
| `teach` | retain | h, v | the first step | the narration's clock | own rule |
| `stop` | reach | v only | the change, then the name | 8–15 s | **hypothesis** |
| `loop` | reach | v, s | mid-motion | < 10 s | **hypothesis** |
| `still` | convert | — | — | one frame | own rule |

Every duration and threshold carries that `evidence` tag — `measured`, `own-rule`,
`hypothesis` — and the report prints it, because `docs/playbook.md` already records that
the field's duration numbers did not survive a search for primary sources, and a plan that
quietly reuses them would be claiming evidence it does not have.

`stop` and `loop` are **`brief.params` variants of the recipes that already exist**, never
new recipes and never new brief ids: the id is the directory name for `generated/` and
`renders/`, the name of `.brain.json` and `.patch.json`, and the composition id prefix. The
campaign is computed by arithmetic from the material matrix and the story binding; the
sixth brain question (`campaign`) is **not** asked yet, because `QUESTION_VERSION` is an
input to every cached brain answer and a bump re-spends the whole budget on every
workspace — and the arithmetic path has to produce the same set anyway for `--brain=none`.

## What does not change

Facts, not prose: every number, command, route and version is `{{fact:id}}`, expanded
verbatim, and `auditClaims` refuses a literal digit, an unknown id or a fact in the wrong
language track. The brain phrases and never states, under `sanitizePatch`. Cuts land on
beats and whole frames. Recipes are format-blind. No file is drawn past its own pixels.
Every review check names who fixes it. Nothing is written inside the filmed project, no
install script runs, no `.env` is read, credential-shaped text is masked before the first
frame. Only free licences, and only the four bundled OFL faces. And `--brain=none`
produces the whole set — in the product's colours, with the map and the study — because
every derivation in this plan is arithmetic over what was measured.

## The sequence

Each step leaves the pipeline whole, and the first three change the pixels.

| # | What | Files | Guard | What a person sees |
| --- | --- | --- | --- | --- |
| 1 | `Direction` derived: per-swatch trust, the stage offset, signal, sound, motion, furniture, seed | new `packages/brand/src/direction.ts` (a pure subpath, with the seed in it; the plan said `packages/core`, and the reason it moved is above) | new `tests/direction.test.ts`: universend → stage clears `#02030a` by ≥1.25:1, accent `#dbff64`, chromatic; panoma-site → light, mono, accent = ink; `#d2bd7f` in no derived palette; identical under `PANOMA_VIDEO_BRAIN=none` and a faked driver | Nothing yet — one second of arithmetic |
| 2 | The theme context beside `theme.ts` (never a rename: another session commits here), provided in the five element factories, consumed by the four shared components; the direction folded into the render key | new `apps/render/src/lib/theme-context.tsx`; `Backdrop`, `KineticTitle`, `captions`, `ProductWindow`; `compositions.tsx`; `auto.ts:728-735` | new `tests/house-style.test.ts`: real frames of every recipe under a product brand fail on `#d2bd7f`, `rgba(210,189,127`, `#0a0a0a`, `#161616`, `"Fraunces"`; under `REPO_DIRS` panoma video's own theme survives. `tests/auto-cache.test.ts`: the render key follows the direction and never a port | The five sheets stop sharing a ground |
| 3 | The remaining recipe literals, the display face from the detected category, the logo on the end card at its own pixels | the seven recipes, `Stagecraft.tsx` | `house-style` extended to every recipe and to a light stage (captions and vignette flip polarity) | A sans brand's trailer stops opening with a serif slam |
| 4 | `direction.json`, `brand.patch.json`, and `direction.scheme` into **all four** of `auto.ts:456/464/480/531` | `workspace.ts`, `auto.ts` | `tests/auto-cache.test.ts`: the record key changes with the film scheme and never carries a port; `tests/brand.test.ts`: a patched hex is `origin: patch`, an invalid one is refused by field name | A light product is filmed light; a wrong colour is fixed in one line and the next run re-renders |
| 5 | Seeded variation inside the caps the clock tests already pin, plus objective-aware story checks | `timing.ts:1433,1440,151-209`, `compositions.tsx:480-607`, `plan.ts`, `story-checks.ts` | `tests/camera.test.ts`, `tests/cast.test.ts` unchanged under the default direction, one case per direction; cuts still land on bars; no flash on a light stage; **and a new test that two fixture products' `RenderPlan`s differ in something structural, not only in hex** | Two products stop sharing a rhythm |
| 6 | The screen graph persisted and `map.svg` drawn | `tour/types.ts` (`TOUR_VERSION` bump), `walk.ts`, new `director/map.ts` | `tests/tour.test.ts`: page nodes, an edge for the CTA, a back-edge for the repeat; new `tests/map.test.ts`: byte-identical twice, every hex in the palette, every label redacted and fact-backed, no edge the tour did not walk | "Make a diagram of how it works", answered with a file |
| 7 | The `study` stage: index, derived assets, material matrix, gaps, book | new `director/study.ts`, `auto.ts`, `plan.ts`, `panoma-video.ts`, `mcp/tools/project.ts` | new `tests/study.test.ts`: clip ranges past `readyMs`, `unfold` only where `after` exists, an empty take yields the empty-studio gap and deletes the record key | Three of five workspaces finally say out loud that they have no material |
| 8 | Jobs, objectives, platform narrowing, `stop` and `loop` as `params` variants | new `core/campaign.ts`, `plan.ts`, `templates.ts`, `auto.ts` | new `tests/campaign.test.ts`: canonical ids kept, every skipped job names its unlock, the gate is `afterControl` present and `change.share > 0.02` | A 6 s loop beside a 30 s film reads as a different film |

## Known limits, honestly

- **Identical inputs still give identical films, and that is correct.** panoma-monorepo
  and panoma-web have byte-identical brands and identical tours (38 steps, 12 marks). After
  all eight steps their films differ only by the seed, which is keyed on the product name.
  Manufacturing a difference where the evidence says there is none would be the opposite of
  this repository's doctrine.
- **Structural sameness survives steps 1–5.** Recipe per goal is untouched: two web apps
  get the same recipe, the same section kinds in the same order, and the same length. Steps
  1–5 deliver the product's ground, its accent, its sound and its micro-rhythm. Structural
  variety arrives in step 8 for `stop` and `loop`, and fully only with a composer, which
  this plan deliberately does not build.
- **The type voice is not a differentiator on this disk.** All eight workspaces resolve to
  `heading: sans` → Geist. The field is derived and recorded because it is true, not
  because it currently distinguishes anything.
- **The stage separation constant (1.25:1) is ours**, not a standard. It is the smallest
  offset at which the product window's chrome and ring are still visible against the stage
  in the frames measured on this disk; a product whose background is already mid-grey will
  test it hardest.
- **The `stop` and `loop` lengths are hypotheses**, tagged as such, and the first two
  launches are the evidence that will replace them.
- **The composer is not built.** `Shot` and `Board` are not defined and no golden test
  pins them: the synthesis proposed shipping an extracted second copy of ~2,100 lines of
  clock code with no consumer, and the engineering critic was right that a duplicated
  clock guarded by an equality assertion is a tax, not insurance. When a composer is
  built, it becomes the implementation and the recipes delegate to it — not a parallel
  truth beside it.

## Open decisions

| Question | Recommendation | Who decides |
| --- | --- | --- |
| Does the `stop` cut keep the name card in its first second? | Keep it. `tests/spotlight-scene.test.ts:125` pins the card sequence, and a viewer who does not know what product they are looking at has not been hooked | The owner, after seeing the first `stop` cut |
| When does the map become a shot? | Booked, not built: on this disk it would fire for one product | The owner, after the sheets |
| When is the sixth brain question asked? | After the arithmetic campaign has been looked at, because a `QUESTION_VERSION` bump re-spends the brain budget on every workspace | The owner |
| The picture checks on a light stage | Measure and record the numbers before changing a threshold; a dark interface already reads 98% black to a luma threshold and those checks warn by decision | The engineer at step 3, reporting to the owner |

## What shipped, and what did not (2026-09-03)

The record above is the plan. This is the state of it, written the same day, so a reader
never has to guess which half is built.

**Built and proved on two real products** (universend: lime on near-black; panoma's site:
black on white):

| # | What | Where |
| --- | --- | --- |
| 1 | The `Direction`, derived per swatch, with the stage offset, the mono signal, the seeded picks and the sound — in a pure subpath of @panoma/video-brand, not in core, for the reason above | `packages/brand/src/direction.ts`, `tests/direction.test.ts` |
| 2 | The theme context: the four shared components and all seven recipes read the product's colours; the scrim and the caption plate are the product's ground; the derived direction is in the render key | `apps/render/src/lib/theme-context.tsx`, `tests/house-style.test.ts` |
| 4a | `brand.patch.json` — a person's correction outranks every measurement, and a value that is not a colour is refused by field name | `packages/director/src/brand-patch.ts`, `tests/brand-patch.test.ts` |
| 5a | The tempo per product: three templates said 120 | `packages/director/src/templates.ts` |
| 6 | The screen graph on the tour, and `map.svg` in the product's colours | `packages/tour/src/walk.ts`, `packages/director/src/map.ts`, `tests/map.test.ts` |
| 7 | `panoma-video study`: the index, the material matrix, the palette card, the wordmark, the map, the book, the gaps | `packages/director/src/study.ts`, `tests/study.test.ts` |

Measured after: universend is filmed on `#1e1f25` — its own `#02030a` lifted 11% so the
recording has an edge — in lime, at 120 BPM in D minor; panoma's site on `#e1e1e1` — its
own `#fafafa` darkened 10% — monochrome, at 100 BPM in C major. Its gate passes with zero
failures at that tempo, which was the risk worth checking before shipping the change.

**Finished the same day, after the list above was written** (the sequence's steps 3, 4b, 5b
and 8, which that list had recorded as not built):

| # | What | Where |
| --- | --- | --- |
| 3 | The nineteen colour literals the recipes still wrote. The ground reached the frame; the furniture over it did not — every scrim, vignette, flash, sheen and drop shadow was `rgba(0,0,0,…)` or `rgba(255,255,255,…)`, correct on panoma video's near-black stage and wrong on a light product's. They are now `pop()` and `ground()` (a `shadow()` was the third for one day; see the movement below), and `FeatureSpotlight` stopped inverting a light product onto a dark stage — a decision reversed with its reason, not a bug | `theme-context.tsx`, the seven recipes, `Stagecraft`, `ProductWindow`, `tests/house-style.test.ts` |
| 4b | The film's scheme, computed once and reaching the walker, the recorder and both cache keys from that one value | `direction.ts` (`filmSchemeOf`), `auto.ts` |
| 5b | The push range and the transitions from the direction's row. A punch closes to the product's own range and arrives on its hardest enter; a scroll and a hand-over take its softest; a product with nothing measured cuts every time | `timing.ts`, `tests/camera.test.ts` |
| 8 | Jobs, objectives, the evidence tag, the platform narrowing, and `stop` as a real cut | `packages/core/src/campaign.ts`, `plan.ts`, `compositions.tsx`, `story-checks.ts`, `tests/campaign.test.ts` |

The guard that mattered most was the one read from SOURCE rather than from a frame: a
rendered frame only proves the paths that frame took, so no file under `recipes/` or
`lib/` may name a colour, and the survivors are listed with a reason — a phone's bezel, a
terminal, a window's traffic lights. A second test fails if an exception outlives the
literal behind it.

Three things the `stop` cut taught, measured on universend and fixed:

- Its close was two bars, and four of the twelve cells of the first contact sheet were the
  wordmark: a third of a thirteen-second piece on a card with one word to land. One bar.
- Its arrival pushed 10%, which is right when the arrival is a settle between two controls
  and the camera has just travelled. Here it IS the opening, and the review measured 1.57 s
  of near-identical frames from frame 0. 28%.
- Its control was drawn at the film's 26% of the canvas's short side — 281 px in a 1920-tall
  frame, a lit dot in an empty room. 55%, and the press at 78%.

And the story checks stopped judging it by a trailer's rules. "The brand inside five
seconds" is an ANNOUNCE rule; a cut whose objective is REACH is built the other way round
on purpose, so the check warned about the one decision that piece was designed around —
and a warning that fires by design teaches a reader to ignore the whole report.

**Still not built, each with the reason:**

- **`loop` and `still`**, refused by name rather than absent. A loop's last frame has to be
  congruent with its first BY CONSTRUCTION; trimming a spotlight to six seconds produces
  the seam the format exists to avoid. The unlock is recorded in the campaign itself: a
  press ping-ponged back to its before-state, which the capture already holds and no recipe
  yet plays backwards.
- **The drift of a held frame** (`motion.drift`). The push and the enters are read; the
  drift is still `SPOTLIGHT.driftShare` for every product, because it is a rate three
  separate clock tests pin and its visible contribution is a fraction of a percent per beat.
- **The composer** — deliberately, with the reasoning above.

**Three defects the work surfaced, fixed here:**

- `panoma-video render --project` parsed `<id>.brain.json` as a brief and threw on every workspace
  the brain had touched.
- A bed is mounted only when its file exists as the matrix is built, and `panoma-video render`
  never wrote one: a composition whose bed was missing rendered silent and then failed the
  gate for silence, saying nothing about the music.
- The palette card and the wordmark did not parse: a bundled font stack carries quotes, and
  one unescaped quote ends an attribute. `wellFormed` now walks every tag of every SVG panoma video
  writes.


## Movement 5 — Two rules a viewer gave us (2026-09-03, later the same day)

Both of these came from watching the films rather than reading the code, and both were
true of every piece panoma video had ever made. Neither had ever been decided; each was the
accumulation of single frames that looked thin on their own.

### Nothing casts a shadow

Every word of type carried a blurred halo of the accent behind it (`Arrive`'s `glow`,
passed by every caller). Every plate sat on a dark blur and inside an accent glow that
breathed through the beats. The drawn pointer dropped a shadow. The stage closed in with
a vignette, the backdrop with a second one, and the captions blurred a third behind their
letters. The tutorial dimmed the whole interface around its callout ring.

They are gone. The rule is: no `textShadow`, no `drop-shadow()`, and a `boxShadow` only
when every layer of it is `inset` — an inset shadow is a border that does not resize the
box its sprites are pinned to, which is why the product window's bezel and the control
plate's hairline use one instead of `border`. The eye is held by what is LIT.

The enforcement is in two places, and the second is the one that will hold. The veil
helper no longer HAS a `shadow()`: there is no colour to draw one in
(`theme-context.tsx`). And `tests/house-style.test.ts` reads the source of every file
under `recipes/` and `lib/`, because a shadow that only appears on the press of the
second control is a shadow no rendered frame in a test will ever show.

What survives, and why it is not a shadow: the tutorial's callout RING (a lit circle on
the thing the sentence is about — the dim around it went), the caption plate (a solid
ground the type sits on, which is how a muted viewer reads it over anything), and the
backdrop's two lights (light, not dark).

### One thing on screen at a time

A product film had been showing the claim and the picture in the same frame, in all
three recipes:

| Recipe | What shared the frame | Now |
| --- | --- | --- |
| `FeatureSpotlight` | The claim typed across the last bar of the use it named, with the interface's answer on a chip beside it — over the control being pressed | A CARD section of one bar before each use: the claim alone, the answer under it. The use is two bars of product with not one text node on it |
| `ReleaseTrailer` | Every card played over the product, receded and dimmed 58%, still moving; every proof carried the claim again as a corner label | The product is on screen for `open` and `proof` and nowhere else. No label |
| `Tutorial` | The cold open's question and the closing card, both over the window pushed back and softened | The window is off screen for both, and arrives on the beat the question ends. Captions stay: a caption IS the narration |

Three things follow from it that are worth stating on their own.

**The film cuts now.** It had exactly one declared cut — the end card — because the claim
was written over the use and the camera travelled between controls so nothing ever
changed picture. Every card boundary is a real cut, declared as one, and the plate no
longer springs in over a beat (which turned each of them back into a dissolve). The
energy of the piece is its edit.

**A use is the whole frame.** The wide layout used to keep the picture in the right-hand
46% because the claim was set in a column beside it, and the tall one gave the bottom 30%
to the same words. `spotlightLayout` has no `claim`, no `label` and no `claimAlign` left,
and the plate is the stage in every shape.

**The length did not change.** A use lost the bar it spent being written over and the
travel it spent arriving somewhere it now cuts to: three bars became a bar of card and
two of use. Three features are the same 26 seconds at 100/30 they were this morning.

### What the measurement then said, and what it changed

The first cut of all this passed nothing new. Every frame of a piece — the claim, the
product, the wordmark — was on one light-grey ground, so ninety per cent of every frame
was the same colour and scdet scored the cuts between them 5.8 to 9.5 against its
threshold of 10. The review said a planned cut was not visible in the file, ten times in
the trailer and five in the spotlight, and it was right. Four things followed:

- **A card is the opposite polarity**, as the spotlight's close already was. The scores
  went to about 70. It is also the rhythm the reference films are built on, and the
  reason the pieces now read as edited rather than as one long move.
- **A cut is where the GROUND changes**, and only there. Two cards in a row — a claim
  giving way to the wordmark, the kicker to the theme — are the same ink on the same
  ground with different words on it, and scdet scores that nothing. Declaring it anyway
  is how a report fills with warnings nobody reads.
- **A card's line lands whole, on the frame of the cut.** `KineticTitle` and `Arrive`
  reserve every word's space from the first frame so a line never reflows under itself,
  which is right over footage and wrong on a card: for the first second the frame was
  one word sitting left of centre in an empty field. `cardLead` — how long a card waits
  for the picture to settle — is deleted with it: there is no picture behind a card, and
  the wait rendered as a black frame with nothing on it at the top of every card.
- **A card is set to its stage** (`cardSize`), not to `titleSize`'s constant. A one-word
  claim came out at 12.6% of the short side in the middle of an empty 1920 frame; it is
  20% now, or as much as its longest word and three lines allow.

Two things also went that nobody had asked to keep. `LightSweep` — a blurred bar of the
accent crossing the frame on every cut — is a lens flare over the claim, and the polarity
flip does its job honestly. And the tutorial was drawing the narration TWICE over its cold
open: as the title in the middle of the frame and again as a caption at 80% height.

Its cold open is the one card that does NOT flip: a feed shows the first frame as the
poster, and on a light product a flipped question made that poster a black frame (mean
luma 36, `video.firstframe`). An ending may change the ground; a beginning keeps the
product's.

Measured on panoma, all four cuts: the spotlight and the feed cut **pass with nothing**,
and the trailer and the tutorial are left with `video.duplicates` and `story.proof-length`
— both `fix.by: record`, both about footage that runs out under a held camera, neither
introduced here.

## Movement 6 — A tutorial that answers a question (2026-09-04)

Two asks, one day apart, and the second one names the gap the first one left: *the
tutorial function should understand the app completely — say "make me a tutorial in
panoma about how to manage the .md files of the projects" and it should understand and
do it* — and, again, *minimalist and clean, but with action, and sexy.*

Until this date panoma video could film what a product IS. Asked what to teach, it had no way to
be told: the tutorial was whatever the walker had happened to press, narrated. The walk is
the reason — it explores breadth-first and stops when its budget is spent, which is the
right machine for a film that sells and the wrong one for a question with a destination.

### The reading, the route, and the proof

[docs/lesson.md](lesson.md) is the record; the shape is three stages and only the middle
one may involve a model.

`readAtlas` opens the product and writes down what it is made of — every screen, every
heading, every control by the name the interface gives it, and the door each screen was
reached through. Three things had to be inverted, not relaxed, before it could see a real
application:

| The walker | The reading |
| --- | --- |
| follows the primary navigation | follows content too, and **presses** — every tile in a catalogue is a `button`, so a reading that follows only `href`s reports that the product has no projects in it |
| refuses a link that points at the page it is on | **opens** it: a tab strip written as `<a href="#md">` is how a large part of a product's surface is reached, and none of it exists in a walk |
| one budget, document order | **best-first** when it has a subject, and an address reached by a press it already chose is raised to the front of the queue |

A collection is found by repetition and no model: controls in the same part of a screen
whose names open and close with the same words are one control repeated over data. Three
of a kind, and the first is opened once. That single rule is what turns "a catalogue with
32 tiles" into "and the page behind one of them".

The route is names only — nothing executes, and a name that is not in the reading is
refused before a browser is opened. Then every step is performed for real, and a step that
cannot be is **dropped with its reason**: the control is gone, the press changed nothing, it
left the product, it left the screen the lesson is about. A tutorial that instructs a
viewer to press something that does nothing is worse than no tutorial.

What comes out is a `TourScript`. Nothing downstream can tell the difference, which is the
point: a lesson is a different way of choosing what to film, not a different kind of film.

### What it will not press, and why that is in two places

This drives somebody's running product against their data, and a press cannot be taken
back by deciding afterwards that the film was wrong. The brain is told the rule; the
executor enforces it, because a rule enforced only in a prompt is a request. And without a
brain nothing speculative is pressed at all — words cannot tell a safe press from an
expensive one. On panoma the controls that teach the subject best are called "Fix the
obvious" and "Ask the model's opinion": the first rewrites a file in somebody's
repository, the second spends their model credits, and neither shares a word with the
request that would have ranked it. The wordless route reads the screen instead.

Asked for panoma's `.md` panel, the brain wrote the refusal into the record itself:

> "It deliberately stops there without pressing the sync, fix, or model-opinion controls
> on that screen, since those change or spend on the file rather than teach how it is
> viewed."

### The title card, and the camera that stops

The second half of the ask was the look, and the reference genre answers it exactly: the
description first, then the app full-screen. So every step but the first now opens on its
own title card — the opposite polarity, the frame to itself, three beats — and then the
product has the frame to itself.

It replaces a chip in the corner of the picture. The chip was legible and it was two
things on one screen, and worse: Guo, Kim & Rubin measured 6.9 million viewing sessions
and found that tutorials, unlike lectures, are **scrubbed and re-watched**. Their
recommendation is literal — "visual signposts, such as big blocks of text to signify
transitions" — and a chip over unbroken footage is no boundary at all to somebody dragging
a scrubber.

Three consequences, each of which had to be built rather than declared:

- **The narration starts on the card and runs over the cut**, so the card costs no
  seconds: it is the head of the step, not a section before it.
- **The picture waits under the card** (`tutorialSourceAt` holds `sourceFrom` until
  `cardTo`), so the cut delivers the frame the step begins on rather than one it has
  already run past.
- **The camera moves under the card.** By the time the card lifts the framing has arrived
  — one event where there used to be two.

And then the camera stops. What was there before was a push that ran for the whole step,
on the argument that a held frame needs something alive in it; a frame still drifting
under a result somebody is reading is what they pause the video to stop. The move is
0.42 s and eases out — Nielsen Norman put the deliberate band at 100–400 ms and 500 ms at
"a real drag", Material says > 400 ms "may feel too slow" — and the hold that follows
drifts 1.2%, which is not a move and is not a freeze either. Every hold is declared in the
render plan, so the review knows the stillness was a decision.

One more tell went with it. The address bar used to read `127.0.0.1:4173`, which is true,
is nowhere any viewer will ever be, and is the clearest sign a product film was made on
somebody's laptop. A loopback host is now dropped and the **path** kept — and it follows
the take, so it reads `/p/panoma-monorepo` when the tutorial has walked there. The
repository already treated a loopback origin as an artefact rather than a fact; this is
the same decision, one layer up.

## Movement 7 — Point it at a product and say nothing (2026-09-04, later the same day)

The lesson answered "how do I do X here". The next ask was the question before it: *run it
and let it decide — for virality, for a comparison, for whatever the product has in it.*

A tool you have to know how to ask is a tool for people who already know the product, and
the honest version of "decide" is not a model improvising a topic. Everything a person
would use to pick is already in the reading, and all of it is measurable.

### Arithmetic proposes, judgement disposes

`slateOf` scores every screen the reading reached on four terms and three gates — payoff
(getting there produces something), focus (few sections of its own), reach (two to four
doors), procedure (how many steps the lesson would actually have), and gates on safety, on
payoff and on having at least two steps — and returns the same ranked menu for the same reading, every time. That is what
makes it a thing to argue with. A brain is then handed the menu and does the one part
arithmetic cannot: names each row as a viewer would, says how much anyone outside the
product would want it, and picks — and it may prefer a lower row if it says why. Its
`pick` is clamped to the list, because a candidate it invents is a screen the product does
not have.

The first autonomous run on panoma ranked seven screens and chose the Resume tab over
Accounts, which had scored identically:

> "Resume is the one problem every developer with a pile of local projects instantly
> recognizes… the runner-up, accounts, only matters once a project has been deployed
> somewhere, and the empty states like twin, runs and bridge show nothing a viewer could
> actually do yet."

There is also a floor. Under it panoma video says the product has no tutorial in it and diagnoses
why — behind a sign-in, one screen only, nothing that changes when you press it. A tool
that always produces a video produces bad videos.

One term was in the first draft and is not in this one, and the adversarial pass is why:
the screen's own copywriting. Scoring a screen higher for asking a question or stating a
figure ranks how well the product is WRITTEN, not how much of it there is to teach — and
the evidence for question headlines (+150% clicks) measures clicks while every length and
completion finding measures retention. They pull against each other. A well-copywritten
screen that teaches nothing would have won. So the question and the figure still choose the
angle, and they no longer touch the ranking.

### The angle is taken from the material

Five framings, closed, each requiring something the material had to contain: a question the
screen asks (`objection`), a figure it states (`count`), two doors or fewer (`speed`), a
manual alternative (`contrast`), otherwise `how-to`. It changes the hook and nothing else.
A sixth invented per piece would be a mood, and a generator with moods produces five
tutorials that all open "Ever wondered…". panoma's own screen asks "Does it still build?",
so that is what the film opens on.

### What the adversarial pass found, and what changed

Four independent readers attacked the day's work and every finding was sent back to be
refuted against the source. Nineteen survived. The ones that changed code:

- **The lexicon that enforces "refused in the executor, not only in the prompt" was
  English-only.** A Spanish product's "Eliminar proyecto" reached the model with
  `refused: undefined` beside it. It now carries four more languages — and the words that
  are also ordinary nouns ("block", "report", "order", "run") count only when they OPEN a
  control's name, because labels are verb-first: "Block user" is an action, "Regenerate the
  block" is not, and the old list refused the second one.
- **The guard checked the plan and pressed something else.** A substituted row is a
  different string; it is checked again by its own name now, and a press must also be a
  control the READING saw — the only list that existed before the product's own copy was
  read, which is where an injected instruction would live.
- **A candidate was resolved by address**, and two screens can share one. It carries the
  state hash now.
- **The wander guard switched itself off** whenever the target address had a query on it.
- **`answered()` reported the site's banner heading** as the result of every press.
- **The dedupe by address and heading was deleting in-page views** whose page heading did
  not change, which is the commonest kind there is.
- **A dropped step left the browser scrolled and the script not**, so the next step
  measured its target against a viewport the recording would never be in.
- **Paths and query strings bypassed `redact`** on their way to a model provider.
- **The MCP tool handed the product's own words back to the calling agent unwrapped**,
  which every sibling tool wraps.
- **`page.goto(networkidle)` with no timeout** would hang for ever on a product that holds
  a request open — after the whole reading had been paid for.

### And two numbers that were wrong in the film

**The take was shot for a montage.** The walker holds 1.5 s after a click, which is right
where nothing is said over a shot and wrong where a sentence is: every lesson filmed came
back with `story.stalls`, "holds a frozen picture for most of its span", `fix.by: record`.
The arithmetic is in `LESSON_HOLD_MS` now — a dozen words is 4.2 s at 170 wpm, footage
conforms at 1.2, a step is stalled past 55% held, so the picture has to cover 2.3 s of
source — and the constant is 3.2 s.

**And the check was measuring the wrong thing.** It inferred a stall from the declared
holds and the cuts around them, and both halves broke the day a step gained a title card:
the settle after a press is now DECLARED (it is the still a viewer reads the result in) and
a titled step has two cuts inside it, so every intended hold read as a defect. The recipe
knows where the footage actually ran out; it says so in the render plan, and the check
reads it.

One more of the day's own decisions was reversed by measurement. The camera's arrival was
being spent **under** the title card, on the argument that the cut should deliver a frame
already in position — which produced a title, a cut, and then a still, with the 0.42 s that
NN/g and Material both measured for a move a viewer *watches* happening where nobody could
see it. A titled step has three shots now: the card holds the framing, the arrival is the
first thing after the cut, the hold follows. And captions, switched off under a step's
title on the one-thing-on-screen rule, are back: that rule is about a card that IS the
sentence, and a step's title is two words over a spoken instruction — switching them off
took the first second and a half of every sentence away from the viewers watching muted,
which is most of them.

The autonomous cut passes the whole gate with nothing. It is the first tutorial in this
repository that does.

## Movement 8 — The brain directs (2026-09-04, evening)

Movement 1 said the direction is arithmetic so that `--brain=none` gets the same film. It
still is, and it still does. What was missing is what the slate already had: arithmetic
proposes, judgement disposes. The rule `nameFor` applies is the same rule for every
product, and that is how two products with one palette got one film — a documentation
site and a game are both dark and chromatic, and the rule cannot tell them apart, because
nothing it reads says what the product IS. The thesis does.

So `directionFor` (`packages/director/src/look.ts`) asks the ninth question
([brain.md](brain.md), **direct**) with the proposal, the measurements and the closed
candidates — the three rows, the four bed styles of [music.md](music.md), the six keys,
the three legal tempos, and a fixed `dance: off` policy — and hands the clamped answer to
`deriveDirection(profile, shape, choice)`. Three things are enforced in code rather than
asked for in the prompt:

- **No colour is on offer.** The choice type carries no hex, the colours are derived
  before the choice is read, and the test asserts every colour surface, the scheme, the
  signal, the fonts and the seed are deep-equal with and without the brain.
- **Every field is clamped.** An answer outside its candidate set keeps the proposal's
  value on that field and is written down (`clamped` in `direction.json`, `direct: …` in
  the decisions). The tempo therefore stays one of `TEMPOS`, and `makeGrid` keeps its
  whole-frame beat; a brought track overrides `sound.bpm` downstream and the question is
  told so.
- **Failure is the arithmetic film.** No brain, a declined call, a timeout, a shape missed
  twice: `directionOf` unchanged, `by: "arithmetic"`, the same file written.

Two fields joined the `Direction` for it. `dance: "off" | "light" | "full"` remains in the
record, but every row defaults to `off` (`DANCE_OF_ROW`). The brain is offered only `off`,
and the clamp refuses a legacy answer that requests musical motion. The caller enables
that separate mode with `--dance=light|full`, written into the brief's `music.dance`;
neither a supplied track nor a persisted direction enables it. `by` says who decided. Neither is
free text — the `why` lives in `direction.json` and in the decisions, never in the object a
frame is keyed on. `DIRECTION_VERSION` is 2: the default now follows actions in every row.

`panoma-video render --project` and `panoma-video storyboard` read `direction.json`, using arithmetic only
when it is absent, so the chosen row and bed survive later renders.
