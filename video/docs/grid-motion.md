# Grid / Assembly

The reference is the user's `ScreenRecording_09-05-2026 16-04-55_1.mov`, studied
on 2026-09-05. It is 34.142 seconds at 1320 × 776. Its stream advertises 120 fps,
but presentation timestamps contain about 60 distinct frames per second.
Frames and mixed-audio envelopes were inspected; no soundtrack or graphic was
copied into the repository.

The useful grammar is three linked operations:

| Reference interval | Observation | panoma video's reusable treatment |
| --- | --- | --- |
| 0.0–2.3 s | Displaced phrase fragments resolve into a line and hold | Exact words assemble in at most three groups; no replacement letters or invented copy |
| Throughout, especially 12–18 s | Fine raster texture and a larger spatial grid unify the frame | A static, integer-pixel lattice with a fine pitch and an eight-cell major grid |
| 16.35–18.4 s | Cards arrive from different edges, accumulate and briefly bow | A shingled recap deck, with curved editorial surfaces around flat, legible copy |
| 19.6–20.6 s | Short phrase groups arrive in a tightly spaced sequence | Whole-frame arrivals and procedural approach/landing sounds share one event plan |

The late ASCII-like image conversion and neon light sweeps are not necessary to
these operations. Grid preserves the real product's colours, geometry, source
clock and decoded frame; it adds a faint optical lattice rather than replacing
the interface with a stylized reconstruction. Added text paints above the lattice,
and opaque source/recap cards protect their copy. Nothing bends the filmed app.

## Selection

`--theme=grid` selects Grid / Assembly for a ProductPromo film and all its variants.
Normal / Flat remains the default. Only explicit `--theme=auto` lets the brain
choose it from the closed catalog, with a reason. Grid does not coexist with Block
or Vibrant within one film. Existing sourced terminals, code and split explanations
take Grid's neutral surfaces; their words retain the previous exact-source rules.
Grid uses only black, white and grayscale for its stage and added graphics. It
does not borrow a colored brand accent or introduce teal/gold decorations. The
recorded product retains its actual palette.

## One event plan for motion, sound and review

`promoAssemblyParts` in `timing.ts` partitions the original text, preserving its
Unicode and whitespace. Group onsets are spaced by `grid.tickFrames`, including
prime beat lengths from a conformed track. Each group moves for 220 ms. The number
of groups is reduced at slow tempos so the total entrance stays at or below 500 ms.
The first poster is complete and silent from frame zero. Later title cards reserve
their reading budget after `promoTitleSettledFrame`; the word slots do not reflow
while their transforms resolve. Larger travel, an initial 80% scale and a finite
turn make the approach decisive without prolonging it. Split explanations stay
still beside the action.

Recap rows reuse only the benefits already supported by recorded proofs. Each card
has a 320 ms arrival. The deck appears in a rapid cascade: arrivals are separated
by a whole number of ticks close to 240 ms, instead of a full reading interval
between each already-demonstrated benefit. The final card's settlement begins a
shared hold of at least 1.2 seconds or the longest row's reading budget, whichever
is greater. Section boundaries still land on beats. Each surface flexes around
its rigid text plane; content-driven heights avoid large empty checklist boxes.
Layered paper edges, a small fold and a monochrome margin rail give the cards their
structure. The next card overlaps only the preceding card's blank lower margin.
The layout fits through Stage in every format. There is no running spring or
independent animation clock.

The original procedural `assemble`, `settle` and `paper` WAVs are generated locally
at 48 kHz. Their onsets use those same group/card frames and have no source recording
timestamp. Actual clicks, scrolling and typing keep their measured source clock.
Existing workspaces receive missing sound assets without rewriting existing ones.
No beat causes a camera pulse or an unearned sound.

`GridTexture` uses integer pitches and no moving phase. Over the recorded product,
fine/major line opacities are 0.045/0.025; the editorial stage uses 0.075/0.055.
These are thin lines, not a full-frame tint. Source-canvas and compositor tests
separately verify unchanged footage geometry and the bounded optical overlay.

The regression tests cover exact copy, prime-tempo events, finite settling,
reading budgets, safe areas, visible card-copy separation, audio synchronization,
and Normal compatibility. Example exports and source manifests live under
`PANOMA_VIDEO_HOME`, not in the product being filmed or in versioned media.
