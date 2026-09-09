# Music

> The kick lands on `grid.beat(n)` because both are computed from the same number — and
> a track someone brings is measured and conformed until the same is true of it.

Every other asset panoma video makes has a third party somewhere in the loop: a voice from
ElevenLabs, b-roll from Veo, a font from its foundry. The music bed is the one that
does not. `packages/audio/src/bed.ts` synthesises it from four oscillators, in Node,
with no dependency, and writes a WAV whose kick is on the beat by construction.

## Why a procedural bed exists

The generated alternative, Eleven Music, is plan-gated three ways
([model-specific terms](https://elevenlabs.io/eleven-music-model-specific-terms)):
free-plan output must carry the credit "Created in collaboration with ElevenLabs",
commercial rights come from a per-plan table you can only read logged in, and
YouTube lists AI-generated music among the things that require the "altered or
synthetic" disclosure at upload. A library track is worse: a licence to audit per
platform and a Content ID claim waiting to happen the first time a viewer re-uploads
the cut.

A bed generated from panoma video's own beat grid has none of that. There is no author but
the file, so there is nothing to credit, disclose or clear; and there is nothing to
cache from a network, so `panoma-video assets` produces it with no key and no plan. The
ElevenLabs bed stays available as an opt-in (`music.prompt` in a brief), which is
what the plan gate is for.

The other reason is the grid itself. The reference video studied in `grid.ts` was
not cut to its music — 34.1% of its cuts fell near a beat against 37.3% expected by
chance. A bed whose kick is *defined* as `n × 60 / bpm` seconds cannot drift from a
timeline whose cuts are defined as `n × beatFrames`, whatever tempo the brief picks.

## What it is

A four-bar loop in the brief's key, rendered once and tiled to the piece's length:

| Voice | Where | How |
| --- | --- | --- |
| Kick | every beat | a sine whose pitch falls from 100-120 Hz to 50 Hz, 110 ms decay, rounded by a `tanh` stage |
| Hat | every tick (or the off-ticks only, in `calm`) | 18-30 ms of noise high-passed twice at 5.5 kHz; the downbeat tick rings longer, the rest sit back, and ±8% of seeded jitter keeps sixteen of them from sounding like a metronome |
| Bass | beats 1 and 3 (plus a pickup on the bar's last tick in `pulse` and `bright`) | root, then fifth, an octave under the pad, one-pole at 700 Hz |
| Pad | one chord a bar | two triangle voices per chord note, detuned ±5-7 cents and panned apart, slow attack, a beat of release under the next chord, low-passed twice at the style's cutoff |

The progression is I–vi–IV–V (the "50s progression") or, for `dark`, i–VI–III–VII —
the minor-key loop most dark electronic music sits on (Am F C G). Both are built from
scale degrees, so the chord qualities follow the key's mode on their own: "A minor"
and "C major" get the right triads without a lookup table.

On top of the loop, over the whole piece:

- **Sidechain.** The pad and bass drop 4 dB for 80 ms after every kick and recover
  over the next 100 ms. Four decibels is a breath, not a pump: the kick gets its own
  space and nobody hears the pad move.
- **Accents, when requested.** At each second in `accents`, a wide noise swell rises
  over 450 ms and stops on a soft pitched hit (the key's root an octave above the pad,
  three partials, 300 ms decay). Product recordings leave this list empty: their
  visible interactions provide the accents, so a card does not layer another hit
  on the beat already in the track.
- **Fades.** In over one beat, out over one bar. The entry is felt on the downbeat
  after it; the exit is a bar of settling rather than a cut.
- **Headroom.** The peak is normalised to -6 dBFS and nothing else. Mastering is
  `panoma-video master`'s job: it measures the finished mix with loudnorm, applies one gain to
  land on -14 LUFS and holds -1 dBTP with a limiter, and a bed already at full scale
  would only give that limiter work.

### The four styles

Density and brightness are the only things that change between them.

| Style | Progression | Hats | Pad cutoff | Bass | Character |
| --- | --- | --- | --- | --- | --- |
| `calm` | I–vi–IV–V | off-ticks only, low | 1.4 kHz, one-beat attack | triangle | under a voice: the default |
| `pulse` | I–vi–IV–V | every tick | 2.6 kHz | triangle, with pickups | a trailer without words |
| `dark` | i–VI–III–VII | every tick, capped at 7 kHz | 1 kHz, 30% saw | saw | a "perspective-dark" product film |
| `bright` | I–vi–IV–V | every tick, loudest | 4.5 kHz, 40% saw, octave pair | triangle, with pickups | a "floating-light" one |

A triangle's harmonics fall at 12 dB an octave, so a cutoff moved from 1 to 4.5 kHz
changes almost nothing on its own — the first version proved that with a spectrum
that did not move. The saw share is what gives the filter something to shape.

## The grid, and the one thing to pass it

`renderBed` takes the tempo and computes the beat from it; the hats need one more
number. A hat sits on every **tick**, and a tick is a property of the grid, not of
the tempo: at 120 BPM a beat is 15 frames at 30 fps and 12 at 24, so the largest
whole-frame subdivision is 5 frames (three ticks a beat) in one case and 6 (two) in
the other. Pass `ticksPerBeat: grid.ticksPerBeat` and the hats fall exactly where the
recipe's accents are allowed to. The default is 2.

Pass the grid's own number, never `grid.beatFrames / grid.tickFrames`: a beat of a
prime number of frames — 13 at the 138.46 BPM a conformed track can land on — has no
divisor to tick with, so its tick is 4 frames and that division is 3.25, which this
module rejects. `grid.ticksPerBeat` is the same division wherever it is whole and the
nearest whole count where it is not (3 for that beat, the density every other tempo
gets at 30 fps).

Everything else is in seconds, sample-accurate: a beat at 120 BPM is exactly 24,000
samples at 48 kHz, and every event is placed by rounding its own time, never by
accumulating a step, so nothing drifts. The loop's length is rounded once, to the
nearest sample of four bars — at most half a sample of error per 8 seconds at a tempo
that does not divide 2,880,000, which is below anything a cut could notice.

## Determinism

Same options, same bytes. Every random choice — hat noise, velocity jitter, detune,
pad phase, swell noise — comes from mulberry32 seeded with `seed` (default 1), and the
module has no clock. The test renders twice and compares buffers.

This holds on one engine. `Math.sin` and `Math.exp` are not specified bit-exactly
across JavaScript engines or across V8 versions, so a bed rendered on another machine
may differ in the last bit of some samples. That is the same "per pinned triple"
determinism the architecture claims for frames, and it is why the file name
(`bedName`) does not pretend to be a content hash: `panoma-video assets` caches by request
hash on top of it.

## The numbers, and where they come from

| Constant | Value | Source |
| --- | --- | --- |
| Kick pitch envelope | 100-120 → 50 Hz, τ 35 ms; level τ 110 ms | Gordon Reid, "Synth Secrets" part 34 (Sound On Sound, 2002): the analogue bass-drum recipe, where the pitch envelope is the whole instrument |
| Hat highpass | 5.5 kHz, two poles | Reid, "Synth Secrets" part 36: a closed hat carries almost nothing below 5 kHz; cymbals are filtered noise |
| One-pole coefficient | a = 1 − e^(−2π·fc/fs) | J. O. Smith, *Introduction to Digital Filters*, first-order lowpass; a highpass is the input minus its lowpass |
| Pad detune | 5-7 cents | About the just-noticeable difference of pitch (Zwicker & Fastl, *Psychoacoustics*, ch. 7): enough to beat slowly and read as width, not enough to read as out of tune |
| Sidechain | −4 dB, 80 ms hold, 100 ms recovery | The architecture brief, by ear: below the ~6 dB where ducking is heard as an effect |
| Headroom | peak at −6 dBFS | `packages/audio/src/master.ts` measures with loudnorm at I −14 / TP −1 (EBU R128 measurement, the platforms' targets) and applies the gain itself; the bed leaves the limiter little to do |
| Fades | one beat in, one bar out | The brief |
| Tuning | A4 = 440 Hz | ISO 16 |
| Tempo bounds | 40-240 BPM | Sanity: outside it the "beat" stops being one |
| PRNG | mulberry32 | Tommy Ettinger, public domain; the same sequence on every engine |

## What it sounds like

Honesty first: the session that built this could run `afplay` but could not listen,
so what follows is what ffmpeg measured on an 8-second render of each style at
120 BPM, and what those numbers mean.

- Integrated loudness −17.8 to −18.4 LUFS before mastering, peak −6.0 dBFS in every
  style, loudness range 0.5 LU — it is a bed, and it stays where it is put.
- Below 150 Hz all four styles are within 1.2 dB of each other (the kick and bass are
  the same instrument in every style); between 150 Hz and 2 kHz `calm` is the fullest
  because its pad is the loudest.
- Above 8 kHz the styles are 18 dB apart in RMS: `calm` −60, `dark` −53, `pulse`
  −47, `bright` −44. That band is nothing but hats, so it is the honest measure of
  "density and brightness", and it is the one the first version failed: with the hats
  at a quarter of their present level the four styles were within 1.5 dB up there.
- The loop seam at 8 s produces no step larger than a kick transient elsewhere in
  the file. The pad and bass filters are run over the loop twice and the second pass
  kept, so the filter state at the end of the loop matches its start.

What a listener should expect from that: a soft four-on-the-floor with a detuned
triangle pad breathing under it, a bass that answers the kick on one and three, hats
as the only thing above 5 kHz. Nothing in it is a square wave and every voice is
filtered, which is the difference between a bed and a chiptune. Whoever ships the
first cut with it should still listen once; see the limits.

## Making one

```ts
import { bedName, renderBed, writeBed } from "@panoma/video-audio";

const opts = { bpm: 120, seconds: 30, style: "calm", key: "A minor",
               ticksPerBeat: grid.ticksPerBeat, accents: [5, 15, 25] };
writeBed(opts, join(dir, bedName(opts)));   // bed-120-calm-a-minor-30s.wav
```

`renderBed` returns the WAV as a `Buffer`; `writeBed` creates the directory and
writes it; `bedName` is a stable file name (the seed appears only when it is not the
default). Accents and `ticksPerBeat` are not in the name, so anything that varies
them must cache by request hash, which is what `panoma-video assets` does.

## A track someone brings

Everything above is the bed panoma video makes. Since 2026-09-04 a piece can be scored with a
track of your own instead — `panoma-video auto … --music=<file>`, `panoma-video teach … --music=<file>`,
or `music` on the `panoma_video_auto` / `panoma_video_teach` tools — and the promise is the same one the
bed keeps by construction: **every cut lands on the music**. A brought track is not on the
grid, so the score stage puts it there, once, and writes what it did next to the
workspace's music (`packages/director/src/music.ts`):

1. **Analysis** (`packages/audio/src/beat.ts`, no dependency). ffmpeg decodes to mono
   float; a 46 ms window hopped every 11.6 ms feeds forty log-spaced bands; the summed
   positive change of each band's log energy is the spectral flux, and the flux minus
   its local mean is the onset envelope (Bello et al. 2005). The tempo is the
   envelope's autocorrelation peak under a log-Gaussian prior centred on 120 BPM, one
   octave wide, and the beats are Ellis's dynamic programme over it (Ellis, *Beat
   tracking by dynamic programming*, 2007, tightness 400); the tempo is then refined as
   the slope of a line through the beats. The downbeat is the beat phase of four where
   the low band and the onsets land most — right for four-on-the-floor, unsure
   elsewhere. How hard a beat hit is the peak of the low band over its frame ±2, because
   one frame of the onset envelope was noise: the beat is quantised to an 11.6 ms frame
   and the flux peaks a frame either side of it, so 48 kicks written at one gain read 0.469
   to 0.942 (spread 0.473, sd 0.1423) and the picture's punch varied at random from kick to
   kick. Read from the low band they spread 0.028 (sd 0.0088), and the quiet kick of the
   fixture comes out at 0.549 of the loud one where the fixture wrote 0.55. Two envelopes
   with a VU needle's ballistics, one for the whole band and one below 200 Hz, are what the
   picture breathes with. Measured on a synthesised click track at 128 BPM
   (`tests/beat.test.ts`): tempo exact, every beat within 18 ms. Length is not a limit:
   nothing in the analysis spreads a per-frame array into a call, which used to throw at
   124,330 frames — 24.1 minutes — and left the owner's mix silently replaced by the bed.
2. **Conform.** The grid wants a whole number of frames per beat and a real tempo almost
   never is: 140 BPM is 12.86 frames at 30 fps. The nearest whole number is 13, which is
   138.46 BPM, and the track is stretched to it with `atempo` (pitch kept) after its head
   is cut at the first downbeat that hits: the first beat whose strength reaches a tenth of
   the strongest (20 dB down), walked forward to the phase the bars start on. The detected
   phase alone would not do it — it names one of the first four beats the tracker found,
   and the tracker chains beats through a pad or a noise floor at the right period, so any
   intro of a bar or more used to survive the cut and the film opened over it. On the
   two-bar pad intro of the fixture the intro beats measure 0.002 and the softest kick
   0.510. The stretch is bounded by half a frame per beat — at most
   4.2% (half a frame of twelve) up to 150 BPM, 1.1% for that track — and the exact figure is on the provenance
   record (`music.bpm`, `music.stretch`). After this, beat *n* of the file is frame
   *n × beatFrames* of the composition, exactly, and `makeGrid` accepts the conformed
   tempo (it rounds a millionth of a frame, because 1800 / (1800 / 14) is
   13.999999999999998 in a double).
3. **The pulse** (`apps/render/src/recipes/pulse.ts`). One value per composition frame —
   the loudness and the low band — and every beat on the timeline with how hard it hit
   and whether it starts a bar, already in composition time: the render never sees the
   head cut or the stretch. Where the pulse reaches past the end of the analysed audio the
   loudness is 0, not the track's last value held, and no beat is written past the last one
   measured. **Musical motion is off by default**, including with a supplied track: the
   camera follows the product's actions and holds while the viewer reads the result.
   `--dance=light|full` explicitly enables the musical mode. In that mode, on every beat
   the picture punches in and settles (an impulse
   on the beat's frame decaying with a 100 ms time constant; the strongest kick moves the
   scale by 2%, a downbeat by half as much again — the range where a pulse is felt as a
   pulse rather than a jolt) and the stage's lights breathe with the loudness and flare
   on the beat. `full` is available for a wordless piece; narration and drawn sentences
   cap it at `light` (a third of every beat). `off` keeps the action-led camera and adds
   no movement from the track. The level is baked into the pulse the recipes receive,
   so every recipe dances at gain 1 and knows nothing about levels. With no track
   brought, `--dance` alone makes the picture dance to the bed: its kick is on every beat
   by construction, so its pulse is the grid itself (`bedPulse`), downbeats at full
   strength and the rest a little under. The brain may choose a product's row, bed and
   tempo, but cannot enable this mode. Older `direction.json` files cannot enable it
   either: the explicit setting belongs in the brief's `music.dance`.
4. **The mix.** The bed measures about −18 LUFS and the mix's gains were set for it; a
   brought track is whatever it is (a mastered piece sits around −9 to −13), so its gain
   is the bed's corrected by the difference the score stage measured — the same number
   of decibels under the voice whichever file it is. It fades in over one beat, as the
   bed does — a full-level kick in the file's first samples came back from the AAC
   encoder at −0.9 dBTP whatever ceiling the limiter held — and out over the last bar.

The bed keeps its own promise unchanged; the track keeps it by measurement.

## Interaction sound

*(2026-09-05.)* The default sound follows what the product does. Earlier tutorials
had a tick on every step boundary and no sound on the actual click; trailers had
impacts on their cards, and spotlights piled an impact, a camera whoosh, a click,
another whoosh and a closing riser onto each use. Those layers made the edit louder
without making the interface easier to follow.

`apps/render/src/recipes/sound.ts` now reads the real events through each recipe's
visible source windows. A mouse press gets a dry mechanical click, a scroll gets
a quiet filtered brush, and a logged keyboard input gets one short key onset. The
three WAVs are synthesised deterministically in `packages/audio/src/sfx.ts`, with
no samples, network calls or added dependencies.

- **An action is not quantised to a beat.** Tutorial clips start at `cardTo`, then
  divide source time by the step's `playRate`; trailer proofs and the live cold
  open use their own source windows; screencasts use the same 25-to-30 conform as
  their picture. The clicks agree with the visual press frames. A spotlight
  sounds its staged press only when the take actually clicked that control.
- **Only visible actions sound.** Pre-ready events, chrome, omitted footage,
  card-covered playback and zero-distance scrolls earn no cue. Duplicate onsets
  of the same kind that collapse onto one rendered frame are merged.
- **The tail belongs to the shot.** The encoder trims each cue to its own
  `durationInFrames`, before delay and mixing, and a scroll fades over its final
  90 ms. New recordings measure the scroll's actual duration; it is conformed with
  the footage. Old logs have no end time, so they get only a 160 ms onset brush.
  The brush lasts at most 1.6 seconds, keeping long scrolls quiet.
- **No typing is invented.** Existing logs describe an aggregate input, not
  individual key times. One input earns one onset, even when its text is long.
- **Music stays behind the actions.** Unvoiced product recordings use a steady
  0.32 bed gain; tutorials with narration keep 0.08 and short voiced films 0.12.
  Imported tracks receive the same measured loudness correction. There is no
  per-click pumping of the music and no automatic impact for a camera move.

`panoma-video auto`, `panoma-video render` and `panoma-video launch` prepare missing sound
assets and beds before rebuilding the matrix. An older workspace with only
`tick.wav` acquires the new foley automatically. `panoma-video sfx` can regenerate all
seven effects; the older four remain available for manually authored pieces.

`tests/action-sound.test.ts` checks alignment against the visual plans, source
visibility, measured scroll durations and old-workspace upgrades. The encoder
test reads the AAC result to verify that a delayed gesture fades and stops at its
own boundary.

### Limits of the brought track

- **The downbeat is a heuristic.** Four-on-the-floor is read right; a track whose bars
  start on a quiet beat may open its first bar one beat early or late. The cuts are
  still on beats; only which of four is the bar's first can be wrong.
- **A beat is as hard as its kick.** Strength is the low band, so a beat carried by a
  snare, a clap or a chord and nothing under 200 Hz reads soft, and the picture punches
  where the kicks are. That is right for the four-on-the-floor this is built for and wrong
  for a track whose backbeat is the event.
- **An intro without a kick is cut, however long it is.** The head cut looks for the first
  beat that reaches a tenth of the strongest, so a minute of pad before the drop is a
  minute the film never sees. A quiet-but-drummed intro survives it — 20 dB under the
  loudest kick of the same track is far below anything a listener calls the start — but a
  track that fades in over a bar loses that bar.
- **The pulse ends with the track, and the render holds its last frame.** `pulseOf` writes
  0 past the audio, but a composition longer than the pulse file reads its final frame for
  ever (`pulseAt` in `apps/render/src/recipes/pulse.ts` clamps), so a piece longer than its
  music breathes on the track's last loudness. Bring a track at least as long as the piece.
- **4/4 only**, like the bed: the pulse marks every fourth beat as a downbeat.
- **One tempo per track.** A piece that changes tempo, or a live recording that drifts,
  gets one grid tempo and drifts off it; the analysis reports the line through all its
  beats, not the drift. Electronic and produced music is quantised and fine.
- **The stretch is audible to a musician** above about 2%; it is under 1% for most
  tempos and never above 4.2% up to 150 BPM. Above 150 the whole-frame grid gets coarse
  (12 frames is 150 BPM, 11 is 163.6) and a track in between stretches more.
- **The track's rights are the owner's.** panoma video does not know what it is; the provenance
  record says `source: "file"` and that the track was brought.

## Known limits

- **It is a loop, and past thirty seconds it sounds like one.** Four bars, four
  chords, no melody, no variation between repeats beyond what the seed put in the
  first pass. A 60-second trailer gets the same eight seconds seven and a half times.
  A B section on the fourth repeat is the obvious next step; it is not built.
- **4/4 only.** Bars are four beats and the progression is four bars. A brief cannot
  ask for anything else.
- **The first kick is inside the fade-in.** The bed enters over one beat, so beat 0 is
  felt, not heard, and the first full kick is beat 1. A recipe whose cold open wants a
  hard downbeat should start the bed one beat before its `grid.start`.
- **Accents are seconds, not beats.** The caller passes card times; nothing here
  quantises them. Pass `grid.beat(n) / fps` and they land on the grid; pass anything
  else and the hit lands there, which is sometimes what a card wants and sometimes not.
- **The key does not follow the brand.** There is no rule from a colour or a tone to a
  key. `A minor` is the default because it is the sound of "product film" more often
  than not; a brief can say otherwise.
- **Byte-identical on one engine, not across engines.** See Determinism.
- **The saws are naive.** No band-limiting: a saw at 740 Hz folds its harmonics above
  24 kHz back into the audible band, some 36 dB under the fundamental and then under
  the pad's low-pass. Inaudible under a kick; measurable on a spectrum analyser.
- **Not mastered, not dithered.** 16-bit output straight from a float mix at −6 dBFS;
  `panoma-video master` handles loudness, and a bed at −18 LUFS does not need dither.
- **Is a synthesised bed "synthetic" for disclosure?** The EU AI Act Art. 50 and
  YouTube's policy are about AI-generated content; this is an oscillator, the way a
  synthesiser is. The provenance record should say `source: "procedural"` and the
  owner decides what `synthetic.music` means for it — recorded here so that the
  decision is made, not defaulted.
