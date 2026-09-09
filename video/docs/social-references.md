# Social product films: three local references

Observed on 2026-09-05 from the three screen recordings supplied by the owner.
These are references for editorial decisions, not product evidence, licensed source
assets, or evidence of conversion or reach. No performance metrics were supplied.

## Material and method

| Reference | Local file in Downloads | Duration | Recorded canvas | Recorded frame rate |
| --- | --- | ---: | --- | --- |
| One | `ScreenRecording_09-01-2026 20-31-32_1.mov` | 22.630 s | 1320 × 928 | 60000/1001 |
| Two | `ScreenRecording_09-02-2026 04-40-35_1.mov` | 19.185 s | 1320 × 856 | 60 |
| Three | `ScreenRecording_09-03-2026 20-56-50_1.mov` | 54.572 s | 1320 × 774 | 60 |

All three contain stereo AAC at 44.1 kHz. Measurements below use ffprobe and ffmpeg
on those files; the audio onset analysis used decoded mono PCM at 22.05 kHz, a
1024-sample Hann window and roughly 10 ms hops. Visual changes were screened with
ffmpeg `scdet` at 330 pixels wide, then checked against extracted frames. Adjacent
detections inside 250 ms were grouped, because a camera move can trigger many
detections and is not a sequence of cuts.

The audio was measured, not auditioned. A detected transient is not identified as a
click, a drum hit, speech or a whoosh. Neither the absence of narration nor the
identity of individual effects can be established from these measurements alone.
Screen capture volume, compression and the captured player may differ from the
original production file. Times below locate editorial events to about a tenth of
a second; they are not intended as sample-accurate edit decisions.

## What the third reference does

The third film presents a sketch becoming a racing game. Its opening and closing
branding identifies it as a teaser, with a “coming soon” end line. Its staged
generation screens and rendered output are not verification that any advertised
software performs those operations today.

| Time | What is visible | Why it advances the sale |
| --- | --- | --- |
| 0–2.3 s | A designed identity card already contains the finished racer imagery. | The promised destination is visible before any workflow explanation. |
| 2.3–4.2 s | A physical notebook with drawings of characters, vehicles and a track. | A concrete, recognizable starting artifact gives the transformation a baseline. |
| 4.2–7.8 s | A compact prompt panel arrives over the notebook, receives its image and a request for a playable prototype. The camera closes toward the input. | One intention explains the rest of the film; this is not a tour of unrelated controls. |
| 7.8–12.9 s | The sketch is scanned, then short generation-status rows take the frame. | Progress compresses an otherwise invisible process into distinct milestones. These rows are assertions in the advertisement, not evidence for panoma video to reuse. |
| 12.9–15.7 s | Visual-style alternatives, then camera-perspective alternatives. | The viewer sees authorship and choice, rather than a black box yielding one arbitrary result. |
| 15.7–17.8 s | The film closes on rigging/export status. | A brief signpost prepares a change of visual material. |
| 17.8–20 s | Gray assets in a Blender-like workspace: environment pieces and a wheel. | Intermediate material bridges the sketch and polished output. The gray models make later colour feel like a payoff. |
| About 20–27.8 s | A character performs several distinct motions, with brief requested-animation inputs. | Capability is shown by changed behavior. Successive actions change the subject itself, not merely the camera around it. |
| 27.8–29.7 s | A short game-building status panel. | A boundary separates making the assets from experiencing the result. |
| 29.7–34.2 s | The rendered racer arrives first inside a panel, then fills the frame across several cinematic angles. | Increasing screen area and richer material make the outcome feel consequential. |
| 34.2–42.8 s | An extended gameplay view with the racing interface. | The film allows the viewer to inhabit the benefit. This stretch lasts over eight seconds; momentum does not require a fresh cut every beat. |
| 42.8–47.3 s | Racer and vehicle selection screens. | A second angle on the value adds choice and replayability after the main payoff. |
| 47.3–49 s | A person reacts while using a laptop. | The subject changes from mechanism to experience. This is a creative device, not proof of a real customer reaction. |
| 49–54.6 s | A concise availability line over the human scene. | The film closes with one destination and one availability statement. |

The useful progression is **starting artifact → intention → selected evidence →
valuable result → invitation**. It is not “show every screen.” Crops carry the eye
between the relevant object and its result. Blur is visible during fast transitions,
then readable material arrives and stays readable. Reusing its exact blur, shadows,
generated assets or branded UI would not reproduce the reason the sequence works.

## The shorter references

The first reference follows one editing request from setup to a finished clip:

| Time | What is visible | Editorial function |
| --- | --- | --- |
| 0–4.3 s | A command, installation output and a short skills selection. | Establishes the mechanism and the intended technical audience. |
| 4.3–6.2 s | Footage is attached to a compact prompt. | Makes the input and intention concrete. |
| 6.2–8.1 s | One forceful move into submit, followed by a brief oversized analysis word. | Accents the action and compresses a processing boundary. |
| 8.1–10 s | Source clips gather around a held centre. | Turns an invisible reading operation into visible material. |
| 10–13.8 s | Editing instructions and a timeline-like code sequence. | Bridges input and output for an audience that recognizes code. |
| About 14–18.3 s | The finished interview edit, with variations in framing and typography. | Gives the payoff substantially more time than the submit button. |
| 18.3–22.6 s | A white authorship card, product mark and compatible-tool marks. | Separates attribution and invitation from the demonstration. |

The first recording has very few large picture changes. A broad movement around
7.4–8.0 seconds triggers a run of scene scores, despite being one transition; a
clearer large change occurs at 18.3 seconds. A detector that calls every moving
frame a cut would diagnose its fluidity incorrectly.

The second recording stays largely on a common dark ground. At this detection
scale it has no scene score above 12 after the capture's opening. Its observed
sequence moves through a prompt, format choice and export, then benefit cards.
Material and text take turns carrying the frame. The supplied recording starts
partway through a looping workflow, so its first captured frame is not evidence
that the creator chose to begin the advertisement there.

Its compact sequence isolates a prompt, changes the requested style, selects a
format and presses Export. Short cards then connect the output to the offer and
the product mark. The loop returns to a question about the viewer's idea and the
prompt. The bright blue action and large cursor make the relevant control easy
to locate; the frame does not ask the viewer to inspect a whole dashboard. The
blue abstract transitions and glow are part of this reference's visual identity,
not an instruction to add them to every product or override panoma video's house style.

Both are useful counterexamples to a fixed montage template: continuity can carry
several actions, and a meaningful visual change does not need a full-frame flash
or a new background. Their subject changes provide the rhythm.

## What the audio measurements support

| Reference | Integrated loudness | Recorded true peak | Loudness range |
| --- | ---: | ---: | ---: |
| One | −13.91 LUFS | −5.30 dBTP | 4.0 LU |
| Two | −14.03 LUFS | −5.72 dBTP | 1.6 LU |
| Three | −13.99 LUFS | −4.61 dBTP | 6.4 LU |

All contain recurring transient structure. The first has a strong periodicity
around 144 events per minute; the second admits several competing interpretations
around 90, 120 and 180; the third has strong structure around 130 and 162. These
are diagnostics of a mixed soundtrack, not reliable declarations of musical meter
or instructions to conform these recordings to a guessed beat grid.

Local audio onsets often occur near large visual changes, but proximity alone is
weak evidence: in reference three, 20 of 30 grouped scene changes were within
70 ms of a locally detected onset, while onsets covered about 64% of arbitrary
times under the same tolerance. That does not establish that every cut was
deliberately locked to the same musical beat. The first two have too few large
scene changes for that statistic to say much at all.

The third does show a clear change of audio level between sections. Mean mono RMS
is approximately −13.9 dBFS during the asset/character section at 17.8–27.8 seconds,
−23.4 dBFS during gameplay at 34.2–42.8 seconds, −20.9 dBFS during selection at
42.8–49 seconds and −14.4 dBFS during the closing human scene and message. The
roughly 9.5 dB difference between building and gameplay is measurable. The
interpretation that it gives the finished result room is editorial judgment;
it cannot identify which music or effect layer changed without separate stems.

## Rules carried into the product

- Start with the value the audience wants, and select the evidence that makes it
  visible. A button name tells the viewer where an action happens; it is not, by
  itself, a reason to want the product.
- Use one coherent promise per social film. A short result preview can establish
  that promise, followed by the real action that produced it. A preview does not
  invent a new click or play an interaction sound over an already completed state.
- Keep cause and effect together. On new takes, a product press's measured quiet
  result supplies the end of a concise proof; long reading dwell belongs to a
  tutorial, not automatically to a promotional cut. With no trustworthy result
  timestamp, keep the whole source segment rather than cutting off a slow action.
- Let each piece change its pace with its material: a short intention, a legible
  action, then enough of the result to understand the benefit. The reference's
  long gameplay hold is a reason to allow variation, not a rule to hold every app
  for the same number of seconds.
- Use real action sounds on the action clock. Music can support section changes;
  it need not make the camera pulse continuously or add a whoosh at every beat.
- Keep the important material large, change framing for a reason, and hold when
  it needs reading. A result can deserve more screen area than the control used
  to produce it.
- Write concise benefit cards from the project's fact sheet and witnessed
  changes. Never import a reference's capability, time-saving claim, availability,
  logo or testimony into an unrelated product.
- Do not copy source footage, music, artwork or recognizable creative assets into
  panoma video's outputs. These local references inform decisions; they grant no reuse
  license. The engine's product footage remains its own deterministic recording.

These are reusable editorial constraints, not a claim that a formula makes a
video sell or go viral. A supplied promotional film cannot establish either.
