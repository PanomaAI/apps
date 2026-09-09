# panoma video

A project in, reviewed videos out. One brief in, a matrix of short videos out.

A brief is an idea: hooks (plural — the feed votes), lines, a tempo. panoma video
multiplies it by every language and every format (9:16, 16:9, 1:1), cuts it on a musical
grid where every cut lands on a whole frame, carries the argument through readable type
or narration captions, and masters everything to -14 LUFS. The renderer is ours, built on
free software only — React as a template layer, deterministic Chromium rasterization,
ffmpeg down a pipe — and a test fails the suite if a non-free license ever enters the
tree.

It is an optional official app for panoma. On its own the binary is
`panoma-video <verb>`; inside panoma the same verb is typed `panoma video <verb>`.

## Installing

Inside panoma, which keeps its own copy of the app and can update or roll it back:

```bash
panoma apps install panoma-video
```

Standalone, if you want the binary without the catalog:

```bash
npm install -g @panoma/video
panoma-video doctor          # says what is still missing, before anything renders
panoma-video auto .          # read this project and write the videos it earns
```

**Two things are downloaded separately and neither travels inside the package.** Roughly
550 MB of Chromium, which every rasterized frame goes through and which `playwright`
never fetches on its own because it declares no install script; and `ffmpeg` with
`ffprobe` on `PATH`, which this software invokes as a separate process and never
distributes. `panoma-video doctor` reports both, and refuses rather than half-working.

Provider keys must be supplied explicitly in the environment. Nothing is sent anywhere
until you name a provider: the brain defaults to `none`, and the voice is off.

## From a development checkout

The installable `@panoma/video` package contains compiled code; the commands below run
the source tree. [docs/app.md](docs/app.md) describes packaging, prerequisites and the
host protocol. Development may use Node's `--env-file=.env` option.

```bash
pnpm install
pnpm --filter "./packages/capture" exec playwright install chromium
node apps/cli/src/panoma-video.ts list                 # the matrix
node apps/cli/src/panoma-video.ts record panoma-tour   # drive the real product, desktop + mobile
node apps/cli/src/panoma-video.ts launch tour          # every format, mastered, with its kit
```

The second line is the same 550 MB of Chromium as above, and nothing runs it for you.
Without it the renderer and every test that draws a frame fail at browser launch.

## The automatic path

Point panoma video at a project and it reads the repository for facts, extracts the
product's brand, starts it on a loopback port, walks its pages from the accessibility
tree, shoots a desktop and a mobile take, writes the briefs the project earns — a
**Product Promo** that sells a supported benefit through one to three recorded results,
a wordless release trailer when two claims bind to moments that changed the interface, a
narrated getting-started tutorial when the walk found a control whose use changes the
interface, a **Feature Spotlight** when it finds a real app flow (the interface's own
controls rendered by the page at up to 8x, used on a dark stage — pointer, press, the
result unfolding where it happened — with one camera over the page and no mockups), a
card piece from facts for a CLI — speaks the tutorial, renders them, and reviews every
file before calling it done. Nothing is written inside the project; everything lands
under `~/.panoma/video`.

```bash
node apps/cli/src/panoma-video.ts auto ~/code/my-app --until=preview   # one reference cut per brief
node apps/cli/src/panoma-video.ts auto ~/code/my-app --until=final     # every language and format, with kits
node apps/cli/src/panoma-video.ts promo ~/code/my-app --langs=es      # one vertical promo preview, without narration
node apps/cli/src/panoma-video.ts promo ~/code/my-app --format=h --music=./track.mp3
node apps/cli/src/panoma-video.ts themes                            # discover styles and their motion
node apps/cli/src/panoma-video.ts promo ~/code/my-app --theme=block    # opt into one graphic system across the film
node apps/cli/src/panoma-video.ts promo ~/code/my-app --theme=grid     # Grid / Assembly, with exact phrase assemblies
node apps/cli/src/panoma-video.ts auto ~/code/my-app --goal=promo --until=plan
node apps/cli/src/panoma-video.ts auto ~/code/my-app --goal=spotlight  # app UI becomes the motion-design material
node apps/cli/src/panoma-video.ts auto ~/code/my-app --goal=spotlight --only=my-app-spotlight --format=v
                                                               # iterate one cut without paying for the matrix
node apps/cli/src/panoma-video.ts review out.mp4                       # the gate, on any file
```

`panoma-video promo` uses the automatic pipeline with the `promo` goal and a vertical
preview by default. `auto --goal=promo` keeps auto's horizontal preview default. `--format`
selects one preview canvas (`v` or `h` for the promo); `--until=final` renders the supported
matrix unless `--only=<brief>` narrows it. Add `--url` to film an app already running,
or `--no-camera --project=<id>` to make a new edit from that workspace's existing takes.

`ProductPromo` has no narration. Its promise and benefit cards alternate with the real
product, supported by music and soft clicks, scrolling and key onsets from the recorded
actions. A proof can also isolate its measured result with a focus mask or play beside
stable explanatory text in a separate safe panel. Progressive lists recap demonstrated
benefits; terminal and code inserts type exact documented excerpts with no invented
execution or output. `--creative="Explain the release with text beside the app"` guides
these choices in words. The brain chooses the audience, supported benefits, effects, order and opening from a
closed menu of filmed results; `promo.json` records that choice and its reasons. Without
a brain, a deterministic fallback describes the observed changes. Music sets the cuts;
actions keep their own clock, and the camera moves to a subject before holding for the
result. This is an editorial workflow, with no promise of viral reach.
[docs/social.md](docs/social.md) describes the recipe and its limits;
[docs/social-references.md](docs/social-references.md) records what the supplied examples
actually show.
[docs/effects-references.md](docs/effects-references.md) records the focus, list and
split-composition references that informed these effects.

Normal / Flat is the default. panoma video keeps that restrained presentation unless a
user or agent explicitly selects a style. `panoma-video themes` lists the styles and
their motion:
`normal` (an alias for `flat`), `vibrant`, `block` (Block-based), and `grid`
(Grid / Assembly).
`--theme=block` selects bold structured panels, outlines and directional assemblies;
`--theme=vibrant` selects strong color fields and crisp entrances. `--theme=grid`
selects monochrome ink and paper, a faint static lattice across the whole film,
including the recording, exact phrases assembling decisively with dry accents, and
layered paper cards that flex, dock and stack without covering their copy. Grid's
added graphics stay neutral even when the recorded app is colorful. Its first poster is already
readable; later titles assemble and then hold. Each is one system for the entire
promotion and all its variants. Only added graphics can flex; the recorded app never bends.

A named choice persists on later renders; `--theme=normal` returns to Normal / Flat.
`--theme=auto` explicitly lets the brain choose from the product and message for this
run. It releases a saved manual choice, but does not enable expressive themes on later
planning runs that omit the option. Direct rendering of an existing brief keeps that
film's saved selection. The recorded app retains its real geometry and source frames,
with only Grid's explicitly selected faint lattice composited over them; themes
never mix between sections or with the music, and `promo.json.theme` records the
effective selection and its reason.

A presentation fragment can combine these resources. The director supplies the
actual benefit IDs and their evidence before it becomes a complete brief:

```ts
const presentation = {
  opening: "result",
  pace: "measured",
  treatments: { hero: "focus", detail: "split" },
  recap: true,
};
```

With a brain — the `claude` or `codex` agent already on the machine, or an Anthropic or
OpenAI key — panoma video also *thinks*: it reads the product, chooses which controls
the camera sees pressed (in the interface's own language), writes the words in every
language, rewrites what a review says the words can fix, and writes the post copy. Every
answer passes the same fact audit as an agent's, is cached, capped and logged, and a
person's patch outranks it. `--brain=none` is the pipeline without it;
`panoma-video brain <path>` prints the thesis before a frame is shot.
[docs/brain.md](docs/brain.md).

An AI agent drives the same path over MCP — `claude mcp add panoma-video -- node
apps/cli/src/panoma-video.ts mcp` — with eleven tools that return a summary, a
structured mirror and a contact sheet it must look at; `skills/panoma-video/SKILL.md`
teaches the loop to agents that do not use MCP. [docs/platform.md](docs/platform.md) has
the decisions and the limits.

## Tutorials

The other recipes sell. One teaches: `Tutorial` narrates a walkthrough of the real
product — "tired of opening folders? come with me" — and inverts the clock to do it.
A step lasts as long as its sentence takes to say, and the footage is retimed to meet
the voice, pinned to **marks** the recording script leaves in the take rather than to
timestamps that rot the next time the product changes.

For someone else's project there is nothing to write: `panoma-video auto` walks it, and
the sentences come from the interface's own names and from what the page did when the walk
pressed something — "click Get started and Your catalog opens", both halves observed,
neither invented. With `ELEVENLABS_API_KEY` set it is spoken; without one it is drawn
as type. `--voice=none` keeps it silent on purpose.

```bash
node apps/cli/src/panoma-video.ts auto ~/code/my-app --goal=tutorial   # walk it, speak it, render it
node apps/cli/src/panoma-video.ts record panoma-start    # the take, with its marks
node apps/cli/src/panoma-video.ts scaffold panoma-start  # the draft: one step per mark
node apps/cli/src/panoma-video.ts assets start           # voice + word timing, cached
node apps/cli/src/panoma-video.ts launch start           # every format, with chapters
```

[docs/tutorials.md](docs/tutorials.md) has the retiming rules and the limits.

Read [AGENTS.md](AGENTS.md) before changing anything, and `docs/` for why it is built
this way: [architecture](docs/architecture.md) · [research](docs/research.md) ·
[playbook](docs/playbook.md) · [tutorials](docs/tutorials.md) ·
[social promos](docs/social.md) ·
[market gaps](docs/market-gaps.md) · [platform](docs/platform.md) · [brain](docs/brain.md) ·
[roadmap](docs/roadmap.md).

The [story workflow](docs/studio-workflow.md) connects project preparation, scene
revisions, version history and reviewed exports. `panoma-video story` reads a promotion,
`panoma-video revise` edits it, and the matching MCP tools use the same state.

## Licence and notices

Copyright (c) 2026 Jesús Castillo. The names *panoma* and *panoma video* are not part of the
licence grant; [TRADEMARK.md](https://github.com/PanomaAI/apps/blob/main/TRADEMARK.md) in
the public repository says what you may do with them.

AGPL-3.0-only, in [LICENSE](LICENSE). What that licence does and does not cover — no
encoder is distributed, third-party software keeps its own terms, no patent licence is
granted or implied — is in [NOTICE.md](NOTICE.md).
