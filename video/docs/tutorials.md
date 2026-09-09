# Tutorials

> "Tired of opening folders? Come with me and I'll show you."

Everything else panoma video makes sells something. A tutorial teaches, and the two want
opposite things from a video — which is why this is a recipe of its own rather than a
ScreenCast with a voice track bolted on.

## The clock belongs to the narrator

This is the whole design, and it inverts what every other recipe here assumes.

| Recipe | Who owns the clock |
| --- | --- |
| KineticQuote, ScreenDemo, TerminalRun, Loop | the beat grid; the words fit the bars |
| ScreenCast | the recording; the camera quantises to the grid |
| **Tutorial** | **the narration; the footage is retimed to meet it** |

Someone following instructions cannot be hurried by a bar line, and footage that runs
ahead of the sentence explaining it teaches nothing. So a step lasts as long as its
sentence takes to say — and since speech cannot be stretched without being audibly
wrong, the *picture* is what moves.

## Marks: what a sentence is pinned to

A recording script can leave named instants in the take:

```ts
{ mark: "copy" },
{ move: { x: 960, y: 500, ms: 700 } },
{ clickOn: "text=copy", role: "product" },
```

A mark is not a timestamp. Timestamps rot: the product changes, the take is re-shot,
and every number in the brief is silently wrong. A mark is re-recorded along with the
thing it names, so `panoma-video record` after a redesign moves the anchor and the tutorial
still narrates the right moment.

A mark is also where the take photographs the step's control (the macro clip, see
[platform.md](platform.md), *The material*) — unless the control is not there yet. The tour
writes the mark **before** the scroll to a control below the fold, so at the mark the
control is off-screen and nothing honest can be captured: a crop slid into view would show
a strip of whatever sat at the bottom of the viewport. Since the night of 2026-09-04 the
next product click is *armed* instead, and the control is photographed the instant before
it is pressed, on the scrolled page, under the mark's name and with `at: "press"`. What
the press did is still judged at the next mark, against a before-image taken at the press
rather than at the mark, so the scroll is never mistaken for the change. An optional click
that matches nothing captures nothing, and the arm dies at the next mark: a step that
never pressed anything has no control to show.

In the brief, a line with a `mark` is a **step**; a line without one is the **closing
card**. That is the entire grammar. The brief never states how many steps there are,
what order they run in, or how long any of them lasts — all three are consequences.

```ts
{ id: "copy", mark: "copy", label: { en: "Copy the command" },
  text: { en: "Come with me. One command, and nothing gets installed — copy this line." } }
```

`text` is what the narrator says and what the captions show. `label` is the two or
three words that ride the step chip.

`panoma-video scaffold <session>` writes the whole draft from a take's marks, with the
sentences left blank. Writing a tutorial is filling in sentences.

Accessible names sometimes contain operating instructions: "Open totem’s page — or
double-click" identifies a control to assistive technology, but reading that inside
"Pulsa …" mixes two instructions and two languages. `isName` refuses gesture and keyboard
hints as quotable UI names. The action keeps its mark and gets a neutral instruction in
the narration's language, such as "Abre este elemento."; short names such as "The .md"
remain verbatim. The tour retains the full original label as evidence. Cached brain
patches are sanitized again against the current facts when a plan is made, so an old
reference to the refused label falls back to the safe template in that language while
the rest of the patch survives.

## Retiming, and the three rules that keep it honest

Between one mark and the next there are *n* seconds of footage; the sentence takes
*m* seconds to say. They will never match. What happens then:

1. **The footage never plays slower than the conform rate.** Below `castSpeed` a
   25 fps take starts repeating source frames under a 30 fps timeline, which is the
   judder that cost a day to find. When the sentence is longer than the footage, the
   picture reaches the end of its segment and **holds** while the camera keeps
   pushing. A still frame under a moving camera is a decision; a stuttering one is a
   bug, and they must never be confused.
2. **The picture is never cut off mid-action.** When the sentence is shorter than the
   footage, the step is *extended* until everything between the marks has been shown,
   at up to `TUTORIAL_MAX_RUSH` times the conform rate. The viewer waits for the
   narrator; the narrator never waits for the edit.
3. **Only still water may be hurried.** That cap applies to a segment where nothing
   happens — a page settling, a cursor travelling. A segment containing the click
   plays at *exactly* the conform rate, because rushing the action is rushing the one
   thing the viewer is trying to copy, and they cannot rewind an edit.

Step spans round up to whole beats, so despite the narrator owning the clock every cut
still lands on the grid.

**What a step is about is its press, wherever the press falls.** A segment used to be
read as its *first* action, and for a control below the fold the first action after the
mark is the scroll that brings it into view — so the step was a "scroll" step: no push, no
framing on the control, no lift, no result, only the pulse. Three of the panoma tutorial's
five steps were lost that way. `stepPoint` now looks for the product's press first; the
scroll before it is the approach. A scroll *after* the press is still what ends the ring
and marks the page as moved (`stableTo`); a scroll before it moves nothing that matters.
And with no scroll after the press the pressed page is stable **to the step's end**, not
to where the hold begins — `frameOf(toMs)` is the first held frame, and reading it as the
end told the lift the page had moved on every step whose sentence outlasted its footage.

### When a step holds too long, the tool says so

A hold covering more than 55% of a step is not a decision, it is a script that shot
two seconds of footage for a six-second sentence. `tutorialStalls` names those steps
by mark, and the build prints them:

```
[panoma-video] tutorial "start" (en, desktop take) freezes the picture for most of 3 of its steps:
        question: held for 4.6s of 6.5s
        Shoot more between those marks, or say less. The camera keeps moving either way.
```

There are exactly two honest fixes and both belong to a person. The renderer will not
slow the footage to fill the gap, because that is the judder again.

## What is on screen

- **The cold open** is a question, not a feature. The product is already there behind
  the title, receded and softened, and comes forward as the question ends. That
  arrival is "come with me".
- **The step chip** — `2/4` plus the label. Tutorials are abandoned when the viewer
  cannot tell how much is left. It reads `2/4` and never "2 steps": a digit is never
  glued to a word that inflects.
- **The callout** — one ring on the thing the sentence is about, everything else
  dimmed. Drawn on the content box *after* the camera transform (`projectPoint`), so
  it holds its size while the picture pushes in. A ring that scaled with the zoom
  would stop being an annotation and become part of the screenshot. It also **dies at
  the first scroll of its step, and a beat after the press** (`calloutTo`): the ring is
  anchored to a viewport coordinate and the page moves underneath it, so a ring left
  running points confidently at nothing, which is worse than no ring at all — a press that
  navigated once left it ringing a project's commit count for five seconds, because a
  tile had been where the count now was.
- **Keycaps** for anything typed during the step.
- **Captions**, word by word, because most of this is watched muted. With no voice
  generated yet the step's sentence is shown as static type instead, so a tutorial is
  readable before it is audible — which is what the automatic path falls back to when
  there is no key to pay for a voice. See below —
  the grouping has rules.
- **The rail** at the bottom of the stage: the whole piece's progress, notched per
  step. The only element that knows the future.

The camera is one shot per step, pushing gently (≤1.4, against the cast's 1.68) for
the whole span — including the held part, which is what keeps a frozen picture alive.
A click tightens on its point; a scroll opens, exactly as in the cast's grammar.

## Caption cards

Captions are grouped into **cards** and a card stays up until the next one arrives.
Three rules, each of which the first version got wrong:

- **Measure the card, not the word.** The 20 cps limit is defined on the block of text
  on screen. Per word it reports every ordinary sentence as too fast — "installed"
  takes a quarter of a second to say, which is 36 cps and completely normal.
- **Measure the time it is up, not the time it takes to say.** A card is readable
  through the breath after its last word, so it holds instead of blinking out.
- **Never straddle two sentences.** A tutorial's word track is every step's narration
  concatenated, so a fixed group of three words eventually shows the tail of one step
  beside the head of the next. A gap over 0.5s breaks a card, and so does a full stop
  — which also buys reading time, because the card is on screen for that pause too.

`captionCards` is in timing.ts and both the renderer and the readability check call
it, so a card that passes the check is the card that gets rendered. The whole card is
legible from the moment it appears and the spoken word is the bright one — hiding the
words not yet said renders, in a 16:9 frame, as a wide empty plate with two words at
the left.

The highlight changes colour and opacity only: words never scale or shift as they
are spoken. Captions appear only over the product; a step's title, the hook and the
closing card keep the frame to themselves. The spoken word track and exported
subtitles retain their complete timings, including narration that begins on a title.

**Reading speed is measured over the phrase, not the card.** A card in the middle of a
sentence is not read on its own: "What is the front door to your" is 30 characters in
1.2 seconds, which looks like a failure and is not one, because the next card arrives
with no pause and continues the sentence. What binds a continuous reader is the
sustained rate across the phrase — which is the speaking rate. A card followed by
silence is a phrase of one, and *is* judged alone. `captionPhrases` does the grouping.

## The numbers, and where they come from

Craft blogs and primary measurement disagree about tutorials more than about anything
else here. Where they do, the measurement wins and the disagreement is recorded.

| Constant | Value | Source |
| --- | --- | --- |
| `SPEAK_WPM` | 170 | Guo, Kim & Rubin, L@S 2014, 6.9M sessions: engagement rises with rate, and **145–165 is a measured dip**. The 160 wpm convention everyone quotes is a 1967 figure for live lectures, where nobody can rewind. Vendor guides say 130–150; they are not measuring anything. |
| `captionSize` | 6.667% of the canvas short side (72px at 1080), line-height 1.2 | BBC `ttml-validator` T.8 and T.9. The only primary, checkable type-size number in the field — and the one that caught 27px captions in this repo. |
| `CPS_MAX` / `CPS_WARN` | 20 / 17 characters a second | Netflix English Timed Text Style Guide (20 adult / 17 children's). Checked **per phrase and per language**: Spanish says the same thing in 15–25% more characters, so an English cut that passes and a Spanish one that fails is a matrix's default outcome. |
| `voiceSpeed` | 0.92 for a tutorial | Not a source, a measurement: this voice reads at 190 wpm unmodified, which put a third of the phrases over the caption limit. At 0.92 it reads at 178 (English) and 163 (Spanish) and every phrase passes. Narration a listener follows easily is still too fast for a reader who is doing something else at the same time. |
| YouTube chapters | ≥3 rows, first at 0:00, gaps ≥10s, total ≥30s | YouTube Help, Video Chapters. |
| Camera push | ~0.7% scale a second | Under the ≤2%/s ceiling derived from Ken Burns craft guidance (110–120% over 5–10s). |
| Front-load deadline | first step before min(6s, 0.2×T) | Zannettou et al., CHI 2024, a TikTok data donation of 4.1M videos: 24% of views are gone before a fifth of the duration. |
| Step ceiling | 20s | Ragazou & Karasavvidis 2020 tabulate real tutorial corpora at 11–23s per step. Past twenty it is not one operation any more. |

### And two things the evidence took away

- **The step counter and progress rail are opt-in, off by default** (`params: { progress: true }`).
  The intuition that people quit when they cannot tell how much is left is folklore:
  Matzat et al. (n=2,460, survival analysis) found progress-indicator effects on
  completion negative or absent, and Conrad et al. found early feedback implying slow
  progress *raises* abandonment. The step **label** stays on — naming what is happening
  is the signaling principle, which is well supported. This recipe's first draft
  asserted the opposite in a code comment; the comment was wrong.
- **A tutorial cuts. It never whips and never flashes.** Both transitions exist here
  and both are right in a sales cut. Over footage a viewer is trying to read they are
  the documented "cheap" tell — a travel-vlog device whose failure mode is filler.
- **Dim, never blur, to emphasise.** In a software video a blurred *region* means
  redaction: it is what every documentation tool uses to hide a credential. The
  spotlight dims; the recede behind a title card dims and barely softens.

## Chapters

Every tutorial produces a chapter list in its kit, and says whether the player will
honour it: YouTube wants a chapter at 0:00, three or more of them, ten seconds apart.
A 34-second vertical cut satisfies none of that, and a kit that printed timestamps
without saying so would be teaching someone to paste dead text.

## Making one

For a project — anything with an interface panoma video can walk — there is nothing to write:

```bash
panoma-video auto ~/code/acme          # scout, walk, shoot, plan, SPEAK, render, review
panoma-video auto ~/code/acme --voice=none   # the same piece, silent, sentences as type
```

The `narrate` stage speaks every line of the tutorial and keeps the word timings the
same API call returns, into the project's workspace, content-addressed: changing one
sentence pays for one sentence. It needs `ELEVENLABS_API_KEY` — a key in the
environment is the consent to spend, and without one the stage says so and the piece
falls back to type. It is capped per run in characters (`NARRATION_CHAR_CAP`) and
declines whole rather than speaking half a tutorial.

For this repository's own briefs, the manual route is unchanged:

```bash
panoma-video record panoma-start      # both takes, marks reported
panoma-video scaffold panoma-start    # the draft, one step per mark
# write the sentences, move it into briefs/index.ts
panoma-video assets start             # voice + word timing, through the cache
panoma-video launch start --lang=en   # every format, mastered, with kits
```

## What a step is allowed to say

The sentences come from `tutorialBrief` in `packages/director/src/templates.ts` and
every slot in them is a `{{fact:id}}` the audit checks. Two of those facts are the
interface's own: `ui.<mark>` is what a control or a heading is called, and
`ui.<mark>.result` is the heading the page showed once the step landed — the second
half of "click Get started **and Your catalog opens**", which is the half every other
tool has to invent. The walker records it for free, because it already takes that
snapshot to decide whether the click did anything ([tour.md](tour.md)), and it is
recorded only when the heading is NEW: a button that reveals a panel leaves the h1
alone, and reporting it anyway produces a sentence that is grammatical, sourced and
false.

Both are gated by `isName`: at most six words, no second sentence, no line break. A
landing page's headings are whole marketing sentences, and a tutorial that quotes one
is a narrator reading an advertisement with "Then" in front of it — the slideshow the
story layer exists to refuse, arriving through a side door. Where there is no name,
the sentence that needed it is not written; where that leaves fewer than
`TUTORIAL_MIN_STEPS` steps, the tutorial is not written either, and the skip says how
many the page earned. Sections are context rather than instruction, so they earn a
step only while the piece is short of actions.

## One thing on screen, and the signpost that made it possible

*(2026-09-04.)* Until this date a step announced itself with a chip in the corner of the
picture. It was legible and it was two things on one screen — and worse, it was invisible
to the way a tutorial is actually watched. Guo, Kim & Rubin measured 6.9 million viewing
sessions and found that tutorials, unlike lectures, are **scrubbed and re-watched**:
their recommendation is literally "visual signposts on tutorial videos, such as big
blocks of text to signify transitions". A chip over unbroken footage is no boundary at
all when somebody drags the scrubber.

So a step now opens on its own title card, at the opposite polarity, with the frame to
itself — and then the product has the frame to itself.

| | Number | Where it comes from |
| --- | --- | --- |
| Card dwell | 3 beats (1.5 s at 120 bpm) | Above Netflix's 833 ms floor for a readable fragment; below the two seconds at which a signpost becomes the slow lead-in Wistia measures as the commonest cause of early drop-off. |
| Approach | ≤ 0.42 s, the spring-shaped ease-out | Nielsen Norman: 100–400 ms reads as deliberate, 500 ms is "a real drag". Material: > 400 ms "may feel too slow"; ease-out "allows the eye time to focus on the element as it comes to rest". Since the evening of 2026-09-04 the curve is `easings.spring` — see "The move's shape" below. |
| The push, around the press | begins 1 s before, lands 0.5 s after | The press falls about two thirds of the way through the move. A camera that starts moving *after* the thing has happened tells the viewer the film was surprised by its own subject. |
| How close it may go | `videoWhole`, measured per format **and per take** | Until the evening of 2026-09-04 every take was recorded at `size: viewport`, a **1× asset** — `deviceScaleFactor: 2` reached only the stills and macros — and `videoWhole` measured 1.171 on a horizontal desktop cut, 1.891 on a vertical one, **0.731** on a phone take. That was the whole reason the zoom read as an effect: the ceiling was the file. The capture now launches the browser with a **real** scale factor of 2 (`--force-device-scale-factor`) and records at viewport × 2, and writes `videoRatio`, which the camera reads: **2.34, 3.78 and 1.46**. The emulated `deviceScaleFactor` alone does not reach the screencast — asking for viewport × 2 with it gives the 1× picture in the top-left quarter of a gray frame, which a first attempt shipped for an hour because its measurement looked only at that quarter. With the real factor the CSS viewport, `devicePixelRatio` and layout are unchanged and the frame is the full 2× picture; an older take is still capped at what it actually holds. |
| How close the *press* may go | `videoWhole × 1.35`, and never past 2.6 | A third past the file because the lifted macro carries the detail there — the product's own control at up to eight times the density, on its own plane, and since the same evening it **stays through the press**: the capture re-renders the control on the frame after a press that did not navigate (`afterControl`), the plane swaps to that picture on the press frame and holds through the push and the rest. 2.6 is where a 26 px icon target is drawn about five per cent of the frame's height tall. |
| The move's shape | the critically damped step response | `easings.spring`: departs from rest, has 96% of its distance done by two thirds of the way — which is where the press falls in a push — and lands over the last third. The cubic `inOut` it replaces is symmetric, as long leaving as landing, which is what a viewer reads as a tween rather than a camera. |
| The pointer | Cap's spring, `mellow`, click look-ahead 500 ms | `cursorPath` in [motion.md](motion.md) was written and never wired; the tutorial drew the tween, which arrives *with* the click and reads as the machine doing it. The pointer now sits on the click point half a second early, at rest, with the tremor dropped — and gives by a seventh on the press frame, springing back over the next few. |
| The press | a pulse ≤ 300 ms at low opacity, a ring to 450 ms | Every screen-recording guide asks for the same confirmation: a short, low-opacity pulse and none of the trails or sparkles. Both run on the **timeline** (`TutorialStep.presses`), not the recording's clock, which a retimed picture compresses to a flicker or freezes solid — the same bug the burst had, fixed in the same way. |
| The framing | the control's room, widened to the pointer's start | A framing solved on the control alone can begin with the pointer outside it, so the viewer sees a cursor arrive from nowhere. The box is widened to where the pointer sets off from when that is within three quarters of the viewport; past that it enters from the edge, as it would on a real camera. On a step that scrolls to its control first the same point is right: a pointer is viewport-fixed, so it rests there through the scroll and sets off from there after it, and the control's box is measured on the scrolled page in the same coordinates. |
| A control below the fold | photographed at the press, `at: "press"` | The mark could not see it, so the macro is the control on the scrolled page, the instant before the click. The camera frames it as any other press; the **lifted plane** rises only from the press on (`liftAt`), because before the scroll is done its box is a place on a page it was not cut from; and the plan says where the ring may start (`calloutFrom`, the glide's departure after the scroll) so it never points at the page sliding past. |
| After the result | 2 s of rest, then 0.9 s back out, a fifth wider | The reading first (Netflix's 20-frame floor, Brysbaert's 238 wpm, Guo's pauses at the state changes), then the return every guide states the same way: the pan comes back to a wide view once the detail moment has passed, so the viewer keeps their map of the interface. Never past the step's own framing, and only when a beat of the wide view still fits. |
| Hold after the move | the rest of the step, drifting 1.2 % | Netflix's timed-text standard floors a subtitle at 20 frames (5/6 s) and Brysbaert's meta-analysis of 190 studies puts adult silent reading at 238 wpm; the same obligation applies to a changed interface. (This row used to cite Apple's HIG for a sentence about text staying on screen long enough to be read. **That sentence is not in the HIG.** It was invented, and copied into three files before anyone checked; `tests/tutorial-camera.test.ts` now greps for it.) Guo: tutorial pauses cluster *selectively* at the state changes — a hold too short is a viewer correcting the edit. |

**The shot grammar.** A step that presses something emits up to eight shots, and every
boundary comes from the step itself: *under its title* (`from → cardTo`), *approaching*
(`+ ARRIVE`), *waiting on the control* (until the push begins), *pressing* (straddling
`pressAt`), *settling on what it did* (only when the take measured a result), *held on
what it did* — or *on the press*, when nothing was measured — (two seconds), *opening
out* (back to a fifth wider), and *held*. The last three collapse to one *held* when the
step is too short for a second of the wide view.
A scroll or a still step emits two: there is nothing to press, and a "push" between two
equal framings is a shot that runs backwards by exactly the drift.

**`pressAt`, and why it had to exist.** Everything aimed at the press used to derive its
frame from `settleFrom`, which is a beat past the segment's **last** action. On a step that
clicks and then scrolls — the repo's own take — those are three seconds apart, so the camera
pushed after the thing had already happened. `pressAt` is the step's own first press.

Three consequences worth knowing before changing any of it:

- **The narration starts on the card and runs over the cut.** The step's audio still
  begins at `step.from`, so the sentence is not interrupted by the picture arriving. This
  is why the card costs no extra seconds: it is the head of the step, not a section
  before it.
- **The picture waits under the card.** `tutorialSourceAt` holds `sourceFrom` until
  `cardTo`, so the cut delivers the frame the step begins on rather than a frame it has
  already run past.
- **The camera moves under the card.** By the time the card lifts, the framing has
  arrived — one event where there used to be two. The first step has no card, so its
  move is the one a viewer sees, which is right: it is the product arriving.

A step with no label in the rendered language gets no card. A blank signpost is a pause.

The renderer enforces that arrival again as of 2026-09-05: the short approach ends
under the signpost, so revealing the product does not trigger another six-percent
settle. A first step without a signpost still approaches on screen. Consecutive
visible shots also share their exact endpoint: when an early press removes the
waiting shot, its push starts from the actual framing, without inheriting drift
from a wait that never happened. The camera tests exercise that seam in all three
formats.

The result must also be visible. A screen-reader heading can report a tiny CSS box
while remaining invisible in the recording; it cannot aim the camera. When that
focus is unusable, the measured changed area supplies the destination. If the change
fills the page, the camera opens to show it instead of staying magnified around the
control on the page that just disappeared. This is a measured wide result, bounded
by the take's pixels, and needs no invented focal point.

## Known limits

The lesson's action sounds follow the same retimed source clock as the picture:
clicks land on the press, scrolls follow the measured gesture, and a keyboard input
gets one onset. Title cards and the closing card do not invent interaction sounds.
See [Interaction sound](music.md#interaction-sound) for the mapping and legacy-log limits.

- **The narration estimate and the real voice differ.** With no audio on disk the
  clock is built from `speakSeconds` (a words-a-minute rate plus a breath), so the
  piece is a few seconds longer or shorter once voiced. This is what lets a piece be laid
  out and rendered with no key and no network; it is not a bug, but the frame counts you
  read before generating audio are not the ones you will ship. `panoma-video auto` does not
  have this problem — it narrates *before* it builds the matrix, so its clock is
  measured; the estimate is what you see on the manual route before `panoma-video assets`.
- **All or nothing on voice.** A tutorial with half its lines generated falls back to
  estimates for everything. Mixing measured and estimated durations would lay the
  piece out at two clocks and put the wrong sentence under half its steps.
- **Takes must agree about their marks.** A take may bring its own steps, so it can
  carry different marks — and a tutorial pinned to a mark only the desktop take has
  renders in 16:9 and fails in 9:16. `panoma-video record` compares the takes and says so.
- **A mark is an instant, not a span.** A step runs from its mark to the next one, so
  a moment you want to skip over must still belong to some step's sentence.
