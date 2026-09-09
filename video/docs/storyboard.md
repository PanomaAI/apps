# The storyboard

> **Parked, 2026-09-04.** This works and is not being used. Generative video was built
> three ways, measured each time, and set down: what it buys a film about software is worth
> less than what our own renderer already makes. The measurements are the point of keeping
> this document — anybody who proposes generative video for a product film should have to
> get past them first. Nothing in the default pipeline generates anything; `--moves`
> defaults to zero and `panoma-video elements` is only run by hand. See "The honest limit,
> measured" below, and [depth.md](depth.md) for the same verdict on elements.


`panoma-video storyboard <path>` writes a board for a film, shows it to you as a board, renders an
animatic of it, and — only if you ask — buys the shots it cannot record.

This document is the second version of this decision. The first one was wrong twice, in two
different ways, and both mistakes are written down here because the reasons they were made
are still the reasons somebody would make them again.

## What a storyboard is, and what we had instead

A storyboard is a sequence of **panels**. A panel is a picture with a notation layer around
it: a number, a duration, an arrow for what the camera does, the line spoken over it, and
how it leaves. One continuous camera move is drawn as **two** panels — `3A` and `3B`, the
start framing and the end framing — numbered that way to say "this is one shot, not two
setups". That convention is about ninety years old.

The first version of this file described a list of shots in prose: size, movement, a
sentence about what was in frame. It called itself a storyboard because it was ordered and
had durations. **It was a shot list.** A shot list is a table you take to a shoot; it has no
pictures, and it is not the same artefact.

That distinction stopped being academic the moment these films started being generated.
Every video model on the market takes an image as the frame a clip opens on, and the better
ones take a second image as the frame it ends on. `3A` is `image`. `3B` is `lastFrame`. The
drawing convention and the request body are the same shape — which is not a coincidence,
because both answer "where does this begin and where does it end".

A board with no pictures has nothing to send but a sentence. That is the whole explanation
for how this repository ended up commissioning four seconds of molten metal for a film about
a project catalog: a sentence is all it had.

## Where the panels come from

They are not drawn and they are not dreamt. `packages/capture` already writes a lossless
full viewport at every mark of a take — `SessionLog.frames`, one PNG per mark at the page's
own device pixel ratio. **Those files are the board.** Twelve marks is twelve panels, which
is also, by a coincidence worth noticing, roughly the number of panels a thirty-second
commercial is boarded at.

So a shot on this board is one continuous move between two marks, and both of its panels are
photographs of a real interface at a real instant.

## The second mistake: the plate

The first attempt at "give the product movement" bought an **empty lit room** from a model
and composited the real recording on top of it, inset, drifting for parallax.

It was rejected on sight, and correctly. A generated room behind a pasted screenshot is two
layers with two light sources and two cameras. Nothing in the room is lit by the interface
and nothing in the interface is lit by the room, so it reads as a sticker on wallpaper
however good the room is. Parallax does not make two images one space.

`Shot.plate` is gone. `tests/storyboard.test.ts` fails if it comes back.

## What the model is actually asked for

The three ways a shot can be conditioned, in `GenPlan.mode`:

| mode | what it is given | what is true |
| --- | --- | --- |
| `interpolate` | the real frame at one mark **and** the real frame at the next | both ends |
| `animate` | one real frame | the opening |
| `text` | nothing | nothing — and it may never depict the product |

`interpolate` is the mode a product film lives in. The model is not asked what the product
looks like; it is shown, twice, and asked only to move the camera from one true frame to the
other. Whatever it invents has to arrive exactly where the recording actually went.

Two rules of prompt craft follow from this, and both are load-bearing rather than stylistic:

- **A conditioned prompt describes the camera and nothing else.** The picture is the content.
  A sentence describing that content is a second source of truth arguing with a photograph,
  and the model settles that argument by drawing. `promptOf` emits camera language only for
  `interpolate` and `animate` — no subject, no style block, no palette.
- **No negative prompt anywhere names type.** Saying "no text" is still saying "text", which
  raises its likelihood; researchers working on text-heavy conditioning keep the word out of
  their prompts deliberately. This list carried `"text on screen"`, `"readable text"` and
  `"subtitles"` for a year. Words stay out of generated frames by never asking for a frame
  with words in it, and every line in a panoma video film is set by its own type engine.

## The honest limit, measured

Between the two true frames, **the model redraws the interface**. It is generating, not
transforming. On an interface that redraw is legible as damage: labels come back as
convincing gibberish, panel edges migrate, counts change.

The first board this repository shot — a push on a project catalog, Veo 3.1 Fast, eight
seconds, conditioned on two real frames a second apart — measured against its own
conditioning frames:

```
t = 0.00 – 1.00 s     32 dB       the conditioning frame, held
t = 1.33 – 7.30 s     14 – 17 dB  an interface that does not exist
t = 7.65 – 8.00 s     32 dB       the last frame, snapped back to
```

Real names became `caberran-shep`, `ocl-cordosi-poonf`, `rlege toegs`. `20 d ago` became
`20 4 siga`.

Three things follow, and the third is the one that matters.

1. **The honest head is about a second; the honest tail about a third of one.** The board
   had end-aligned every shot on the assumption that landing on truth mattered most. The
   head is three times longer. The measurement overturned the design it was made to check.
2. **The return is abrupt.** There is no gentle slope to cut on — it is 17 dB at 7.30 s and
   32 dB at 7.65 s.
3. **So no constant is correct.** The width depends on the model, the duration, the move and
   how far apart the two real frames are. `packages/review/src/drift.ts` measures every
   bought clip against its own panels, finds the longest run still above `FAITHFUL_DB`
   (28 dB — the two states are 32 and ≤ 21 with nothing between them), and `shootBoard`
   cuts to that. A shot whose honest window is shorter than its hold is **shortened**, and
   the run says by how much. Holding a frame the model drew for the difference is the only
   worse option.

This is the part to read before deciding whether to use `--moves` at all. The technique buys
about a second of real camera movement on a real interface, per eight seconds billed. That
is a true statement of what it is worth, and it is smaller than it sounds like it should be.

## The two clocks

What the **edit** gets and what the **model** is sold are different numbers, and collapsing
them was the other structural error.

The measured average shot in a commercial is a little over two seconds. No model will make a
clip that short: Veo makes 4, 6 or 8 — and **8 is forced the moment a picture is attached**,
which is simultaneously the most expensive duration and the one that drifts most. So a shot
carries `duration` (frames, what the cut uses) and, separately, `gen.seconds` and
`gen.inPoint` (what was bought, and where the cut enters it).

We always generate long and cut short. Letting a vendor's duration grid set a film's rhythm
is how a tutorial ends up with a four-second hold on a click.

## Running it

```bash
panoma-video storyboard ~/code/yourproject --format=h --moves=2
```

Costs nothing. Writes the board JSON, a **contact sheet** (`*.board.png` — panels in order
with the arrows on them, which is the artefact you actually look at), and an **animatic**:
the real shots, the real cards, the real narration, and every unbought move standing still on
the exact frame the model would have been conditioned on. That last part is not a
placeholder — it is frame 0 of the shot, because the panel *is* the conditioning image.

```bash
panoma-video storyboard ~/code/yourproject --moves=2 --generate --provider=veo
```

Buys them. `BOARD_SECONDS_CAP` is 24 seconds of billing — three moves — and past it the
stage declines and says by how much. A key and a cap, never a key alone.

Re-running an unchanged board sends nothing and costs nothing: clips are content-addressed
on the prompt, the negative, the duration, the aspect, the provider, the model, **and the
two conditioning frames by hash**. Change a word in a card and nothing costs; change a
shot's move and that shot costs.

## The providers

| | Veo 3.1 | Omni Flash | Seedance 2.0 |
| --- | --- | --- | --- |
| seconds | 4, 6, 8 — **8 forced when conditioned** | 3–10, extendable to 40 | 4–15 |
| aspects | 16:9, 9:16 | 16:9, 9:16 | 21:9 … 9:16, **and 1:1** |
| first frame | yes | yes | yes |
| last frame | **yes** | no | yes |
| negative prompt | yes | no | no |
| seed | **no** (Vertex only) | no | yes |

The row that decides a film: only Seedance makes a square clip, and panoma video cuts a square for
the feed. The row that decides a *product* film: only Veo and Seedance take a last frame, and
without one only the opening of a move is true. `panoma-video storyboard` prints that beside the
price rather than discovering it in the cut.

Four things about the Veo API are undocumented or documented wrongly, each found as a 400
after a submit had already been accepted, and all four are now assertions in the adapter:

- **`durationSeconds` is a number.** The published samples and both SDKs type it as a string;
  sending `"8"` returns *"The value type for `durationSeconds` needs to be a number."*
- **`lastFrame` requires `image`.** Sent alone it is ignored silently — no error, just a clip
  that does not land where the board said.
- **`personGeneration` depends on the conditioning**: `allow_all` for text-to-video,
  `allow_adult` for anything with a picture attached. The wrong one is a hard rejection.
- **The image wire format is genuinely ambiguous**: the docs use
  `inlineData: { mimeType, data }` and both SDKs emit `bytesBase64Encoded`. The adapter sends
  the SDK's shape and retries once with the documented one.

And one thing that is simply absent: `seed`, `generateAudio`, `fps` and `mask` are Vertex AI
parameters. On the Gemini API **a clip cannot be made reproducible and its audio cannot be
turned off** — so an approved clip is kept as bytes, not as a prompt to re-render, and the
encoder strips the soundtrack the model insisted on making. Every clip also carries a SynthID
watermark with no opt-out.

## What is deliberately not built

- **No image model in the keyframe path.** Nano Banana and its peers "favour semantic
  plausibility over pixel-level fidelity" — measured at PSNR 20–22 dB on tasks that should
  reproduce their input, with documented character hallucination — and there is no mask or
  inpainting parameter anywhere in either API surface. "Keep this part unchanged" is prose in
  a prompt, never a contract. Our panels are photographs; nothing needs to redraw them.
- **No Sora adapter.** The API was removed in September 2026.
- **No Veo extension for long form.** 720p only, and `Extend` reads only the last 24 frames —
  it continues a shot but cannot honour a board.
- **No last-frame chaining across a cut.** Chaining compounds artefacts: the model conditions
  on its own imperfect output and a single frame carries no memory of lighting beyond itself.
  Chain within a shot; re-anchor at every cut.

## The guards

`tests/storyboard.test.ts` holds the invariants that cannot be executed:

| If you do this | What fails |
| --- | --- |
| Let an unconditioned shot describe software | `refuseGenerated` refuses it on the board, before a request is built |
| Put content words in a conditioned prompt | the same refusal — a description beside a photograph is what makes a model redraw |
| Name type in any negative prompt | the negative-prompt test |
| Bring back `Shot.plate` | the source-read test over three files |
| End-align an interpolation again | the source-read test, and the measurement above |
