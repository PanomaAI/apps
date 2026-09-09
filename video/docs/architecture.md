# Architecture

## The pipeline

```
brief ──▶ assets ──▶ render ──▶ master
          (cached)   (matrix)    (-14 LUFS)
```

0. **Record** (`panoma-video record`): a typed session script drives the real product in
   Chromium; the page alone lands in the video, every input lands in a JSON log.
   The renderer draws the cursor and the zooms from that log — data, not pixels —
   so a UI change costs one re-run and the take comes back identical.

   **One script, several takes.** The script is shot twice: a desktop take at
   1920x1080 and a mobile take at 720x1280 (narrow viewport + touch + phone user
   agent, so the product renders its own portrait layout). Every take shares the
   aspect of the canvas it serves, which is what lets the render fill the frame
   instead of letterboxing. This is the deep answer to vertical video: the field
   crops a desktop recording into a phone-shaped hole; we shoot the product's
   portrait design, which already exists.
1. **Brief** (`briefs/`): the idea. Hooks, lines, languages, tempo, music. No frames,
   no pixels. This is the file a person (or a model) writes.
2. **Assets** (`panoma-video assets`): voice with word timestamps (one API call gives both),
   music, sound effects, Veo b-roll, Playwright product shots. Everything goes through
   a content-hash cache: an unchanged brief costs zero API calls; changing one word
   regenerates exactly that word's line.
3. **Render** (`panoma-video render`): compositions generated from the matrix —
   brief x hook x language x format. A recipe is a React component that receives
   (brief, hook, lang, format) and lays out inside the format's safe stage.
4. **Master** (`panoma-video master`, automatic after render): loudnorm measures, one `volume`
   gain lands the file on -14 LUFS, a limiter holds -1 dBTP (a dry run corrects for
   what the limiter takes), video stream copied untouched. Silent compositions skip it.
5. **Kit** (`panoma-video kit <brief> [--sheet]`): per composition, the platform-native copy
   (templates in `@panoma/video-core`, {{LINK}} placeholder on purpose), a thumbnail rendered
   by the engine at the hero frame, and a 12-frame contact sheet for judging a cut at
   a glance. Uploading stays manual — organic-posting APIs are the most ToS-fragile
   part of every tool we studied — but everything around the upload is precomputed.
6. **Ideate** (`panoma-video ideate --repo=… [--ai]`): git supplies real numbers, pure
   heuristics in `@panoma/video-core` shape them into draft briefs, and `--ai` lets the
   `claude` CLI rewrite hooks — copy only, never structure, with the heuristic draft
   as the guaranteed fallback. Drafts are not auto-registered.

## Decisions, with reasons

**Our own compositor, on free software only.** Remotion was the first choice and
lasted one day: it is source-available (free only under 3 employees, telemetry coming
in 5.0), and the project's rule is libre licenses everywhere, enforced by
`tests/licenses.test.ts`. The engine (`packages/engine`) keeps the architecture
Remotion got right and discards the rest:

- A scene is a **pure function of the frame** expressed as a React tree (React is MIT),
  rendered to static HTML in Node — no DOM, no state, no effects, nothing that can make
  frame 141 render differently twice.
- **Chromium rasterizes** each frame (Playwright, Apache-2.0): the full web platform —
  CSS layout, variable fonts, filters, gradients — is the drawing API, with determinism
  by construction because the page runs no animation and no clock. Fonts are awaited
  once per worker; images per frame via `decode()`.
- **PNGs go down a pipe into ffmpeg** — no frames directory; audio clips are mixed in
  the same invocation through a generated filtergraph (`amix` without normalization:
  the balance is authored, not automatic). ffmpeg is never bundled, and which of its
  encoders runs depends on what the operating system ships: [codecs.md](codecs.md).
- Frames rasterize in **parallel across a page pool** and are delivered in order
  through a bounded reorder buffer with real backpressure. 300 frames of 9:16 render
  in ~7s on this machine — faster than the Remotion pipeline it replaced.
- **A still is the render path**: `renderStill` and `renderFrames` — the thumbnails and
  contact sheets `panoma-video kit` writes — go through the same server, pool and shell that feed
  ffmpeg, so there is no second implementation to drift.
- The only build step in the repo is a 20-line `registerHooks` loader that runs JSX
  through the TypeScript compiler API at import time (typescript is Apache-2.0).
- Vendored Geist / Geist Mono (SIL OFL 1.1) make renders hermetic — no network, and no
  CDN glyph update can change yesterday's pixels.

**Beat grid as law.** `makeGrid(bpm, fps)` refuses tempos whose beat is not a whole
number of frames. The Product Hunt reference video we analyzed was NOT cut to its music
(34.1% of cuts within ±100ms of a beat ≈ the 37.3% chance would give); cutting truly on
the grid is where generated content can beat handmade.

**Formats are responsive design — and so is the footage.** One composition tree
reflows into 9:16 / 16:9 / 1:1, and a screencast additionally picks the take that
matches the canvas. The safe-area constants encode what TikTok/Reels/Shorts UI
covers (~220px top, ~420px bottom, ~90-120px sides on 1080x1920); the union of all
three means one render passes everywhere.

**Type floats, the product fills.** Safe areas exist so words are never covered; the
product is not words. `castFrame` therefore measures the window against the whole
canvas. The first version did the opposite — reserved flow space for type, gave the
recording the leftovers — and measured 25% of a vertical canvas. It now measures
83%, and `tests/frame.test.ts` fails the suite if that ever regresses.

The correction that followed: floating type still lays out through `Stage`, inside
the safe rectangle, on a contrast plate. Putting the words themselves in the margin
"because the scrim makes them readable" confuses contrast with occlusion — the
platform paints its own caption over that strip no matter how dark we make it.

**No build step.** Node 22.18+ strips types natively; Remotion bundles workspace TS.
The panoma monorepo's most common trap is testing stale `dist` output without noticing —
this repo makes that impossible by having no dist at all.

**Scenes evaluate in Node, so they may read disk.** When `panoma-video assets` has generated
voice, `compositions.tsx` finds the mp3s and word timestamps on disk, mounts the clips
at each line's frame (music ducks to 0.35 under voice) and swaps evenly-spaced caption
timing for the real thing. No bundler would allow this; owning the renderer makes it a
one-liner.

**Captions from TTS alignment, not STT.** ElevenLabs `with-timestamps` returns
character timing with the audio. The launch-video pipeline round-tripped through
speech-to-text to recover timing the API had already offered; never again.

**AI b-roll through the Gemini API, not Flow.** Flow has no public API and its credits
cannot fund API calls (verified against Google's own docs and forums). Veo 3.1 via
`predictLongRunning` does 9:16 natively with audio: `veo-3.1-fast-generate-preview` at
$0.10/s, lite at $0.05/s. Aggregators (fal.ai, Replicate) are the fallback and the way
to reach open models (Wan 2.2, LTX-2) without owning GPUs.

## The shot grammar

Four aesthetic directions were designed independently and judged against each other
(craft, feasibility, retention). FOLIO — editorial, hard grid, decisive cuts — won,
but the rules below are the ones that *more than one* direction proposed without
knowing what the others were writing, which is the strongest evidence a rule can
have. They live in `castShots` and are enforced by `tests/camera.test.ts`.

1. **Chrome earns nothing.** A step declares `role: "chrome"` and its click never
   becomes a shot. Before this, the tour spent its hardest push magnifying a cookie
   banner for two seconds — the one defect every direction reported independently.
2. **A click tightens, a scroll opens.** A click is a point, so the camera closes on
   it; a scroll is the product showing more of itself, so the camera opens. That
   inversion is most of the difference between an edit and a zoom effect.
3. **The cut lands before its cause.** A punch arrives on the beat *before* the
   click, so the edit reads as the reason the product moved rather than a reaction
   to it; a scroll cuts to the nearest beat, landing inside the movement.
4. **The camera may never look away from the action.** Applied afterwards, not
   hoped for: a shot holding a crop while a real event happens outside its visible
   band is split at the beat before that event, and the remainder opens.
5. **A focus near an edge is pushed gently.** The clamp that keeps the recording
   covering the frame pins an edge focus in place, so a hard push there buys no
   prominence and spends the frame on whatever surrounds the edge.

**Motion is conformed, not resampled.** Two independent causes made a recorded
scroll judder: the recorder stepped the mouse wheel (twenty-four instant 33px jumps
in 1.2 seconds), and Playwright records at 25 fps while the timeline runs at 30, so
one source frame in six was drawn twice. Scrolls now animate inside the page from
`requestAnimationFrame`, and `castSpeed` conforms the take frame for frame — 1.2
source seconds per timeline second, the same trade television made — so every
rendered frame carries its own distinct source frame. Measured after the fix: zero
identical consecutive frames through a scroll.

And an arithmetic rule that came out of the same panel: **at 120 BPM and 30 fps a
half-beat is 7.5 frames and does not exist.** The legal subdivisions of a beat are
its integer divisors, so `makeGrid` exposes `tickFrames` — the largest one at or
below half a beat, 5 here. Accents land on ticks; cuts land on beats.

Since a tempo can be conformed from a track, the beat is any whole number of frames
and not only the eight the integer tempos gave: a prime one has no divisors, and the
rule above answered a 1-frame tick — 33 ms, an accent nobody sees, on every cut made
at the 138.46 BPM (13 frames) the owner's own track conforms to. A beat with no
lattice gets `round(beatFrames / 3)` instead, three ticks a beat as at 120/30, and
`grid.ticksPerBeat` carries that count whole for the bed, which refuses a fraction.
The tick is then off the lattice because there is none; the cut is not, because a cut
has always been `beat` and `bar`.

## Ideas taken from the open-source field (see research.md)

- **EDL-as-LLM-target** (ShortGPT): a constrained declarative input a model can emit and
  a deterministic renderer executes. Our `Brief` is exactly that.
- **Stage isolation with cached intermediates** (MoneyPrinterTurbo): script / assets /
  render / master are separately regenerable; a failure never restarts the pipeline.
- **Agent edits a real timeline** (OpenChatCut): future direction — expose brief editing
  as a tool API instead of one-shot generation.
- **Lottie as motion-asset interchange** (@remotion/lottie): designer-made motion drops
  into deterministic renders, frame-seekable.
