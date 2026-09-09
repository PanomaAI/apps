# Deliverables

> The mp4 is the least of what a render leaves behind.

Beside every rendered cut panoma video writes three things a platform, a reader or a regulator
asks for and a video file cannot answer on its own: which target the picture is unsafe
for and by how much, a caption track a machine can read, and a record of what the file
is made of. All three live in `@panoma/video-core` — `safe-zones.ts`, `subtitles.ts` and
`provenance.ts` — browser-safe, with no Node API and no import from another package,
because the preview UI and the review both need them.

## Safe zones: reported per target, laid out on the union

The layout has always used one rectangle per canvas, `FORMATS[id].safe`: the union of
what TikTok, Reels and Shorts paint over a vertical video. That stays. A recipe that
asked "which platform am I on?" would render the same brief differently per target,
which is what the format abstraction exists to prevent.

The trouble is that the union is smaller than the one platform that publishes numbers.
Meta's Reels guide reserves 35% of the bottom; the union reserves 21.9%. So a caption at
y=1300 on a 1080x1920 canvas passes layout and sits under Instagram's caption strip, and
nothing said so because nothing knew the number.

`SAFE_ZONES[target][formatId]` is the table that knows it. Each entry carries the four
edges in pixels on the canonical canvas, the URL it was read from, the date it was last
checked, and whether the number is **official** (the platform or a standards body
published it) or **community** (what third-party overlay templates converge on, or
panoma video's own union where nothing better exists). A review may fail on the first and only
warn on the second.

| Target | Vertical 1080x1920 | Kind | Source |
| --- | --- | --- | --- |
| reels | top 269 · bottom 672 · sides 65 | official | Meta ads guide: "at least 14% of the top, 35% of the bottom, and 6% on each side" |
| tiktok, shorts | top 220 · bottom 420 · left 90 · right 120 | community | Neither TikTok's ad spec nor YouTube's Shorts help publishes a pixel value; overlay templates converge on top 130–150, bottom 440–484, right 120–140, left 60 |
| youtube, x, linkedin, producthunt | the union of the canvas | community | No published value; Product Hunt plays a YouTube embed |
| web | 5% at every edge (96/96/54/54) | official | EBU R 95, graphics-safe area 90% of the picture |

Horizontal and square canvases follow the same rule: the union from `format.ts` as
community values for every platform, EBU's 5% as the official value for `web`. A test
pins the community zones to `FORMATS[id].safe`, so a change to the layout union shows
up here as a failing test rather than a silently moved goalpost.

Two questions the table answers. Nothing in `panoma-video review` asks them of a rendered cut
yet — the plan does not carry card rectangles — so the table is a reference, not a
check, until the owner's decision below is taken:

- `strictestZone(formatId, targets?)` — the largest reservation on every edge across
  the targets a cut is published to, and which target set each edge. On the vertical
  canvas that is Reels' top and bottom and TikTok's sides.
- `zoneViolations(rects, format, targets?)` — every (target, rectangle, edge) where a
  measured rectangle crosses into a reserved strip, with the overlap in whole pixels.
  A CTA that is fine for TikTok and not for Reels yields only the Reels entry: the
  report names the platform, never "the safe area". Overlaps under half a pixel are
  ignored, because DOM rectangles are fractional and 0.3 px is anti-aliasing.

Whether Reels' 35% becomes the layout rule is the owner's decision, recorded in open
questions. It removes a third of the canvas from every vertical cut, including the two
platforms that do not ask for it. This module only makes the number visible.

## Subtitles: the words already have times

The kinetic captions burned into every cut are not closed captions. A screen reader
cannot read them, a viewer cannot resize them, and a platform cannot index or translate
them. WCAG 1.2.2 wants captions as a text track; YouTube, LinkedIn and a plain `<video>`
all take an `.srt` or `.vtt` beside the file. The voice call already returns word
timings, so the track is arithmetic plus one decision: where a cue breaks.

`cuesFromWords(words, opts?)` breaks on the same three tells as the on-screen cards in
`apps/render` (`captionCards`): a full stop, a pause over 0.5 s, a full line. A cue and
a card therefore end in the same places. It then applies the two duration rules a text
track needs and a card does not — a card holds until the next one arrives, a cue does
not:

1. **A cue under 5/6 s is stretched** into the silence after it, up to two frames
   before the next cue.
2. **With no room to stretch, it merges** — forward into the sentence that follows, or
   backward into the one before — but only with a neighbour it shares a breath with,
   and only if the merge stays inside the line and time budgets. A one-word cue boxed
   in by two pauses stays short: stretching it across a pause would caption silence,
   which reads worse than a brief cue.

The writers are byte-exact and pinned by test: `toSrt` (numbered blocks,
`HH:MM:SS,mmm`), `toVtt` (the `WEBVTT` header, `HH:MM:SS.mmm`, `&`/`<`/`>` escaped
because cue text is markup in that format), and `toTranscript` (plain paragraphs, a new
one at any pause over a second). A blank line inside a cue would end its block early in
both formats, so it is collapsed before writing.

| Constant | Value | Source |
| --- | --- | --- |
| `CUE_MAX_CHARS` | 42 per cue, one line | Netflix English Timed Text Style Guide: 42 characters per line |
| `CUE_MIN_SECONDS` | 5/6 s (20 frames at 24 fps) | Netflix TTSG, minimum duration per event |
| `CUE_MAX_SECONDS` | 7 s | Netflix TTSG, maximum duration per event |
| `CUE_MIN_GAP` | 2/24 s | Netflix TTSG, two frames between events |
| `CUE_GAP_BREAK` | 0.5 s | The value `captionCards` breaks on, kept equal so cue and card boundaries agree |

Cues are one line each rather than two lines of 42: a 9:16 phone caption at 6.667%
type holds about 32 characters a line, two lines of 42 never fit there, and every
player wraps a long cue on its own. The 20 cps reading-speed check is not repeated
here; `captionPhrases` already measures it on the words, and the cues are built from
the same words.

## Provenance: what the file is made of

A finished cut mixes things with different truth values: footage recorded from the real
product, sentences expanded from facts with sources, a voice nobody spoke, a music bed
nobody composed, a cursor no hand moved, perhaps b-roll a model dreamed. Two audiences
need that mixture written down. A person later asking "was this screen real?" — the
answer is the commit and the take. And a regulator or a platform: the EU AI Act's
Article 50(2) requires synthetic audio and video to be marked as artificially generated
in a machine-readable form, in force since 2 August 2026, and YouTube asks the uploader
to disclose realistic altered content and AI-generated music. A tool that assembled all
of this and wrote nothing down would leave the disclosure to whoever uploads — which in
the automatic path is nobody.

`Provenance` is the type from the architecture, verbatim. `provenanceJson(p)` writes it
with keys in declaration order whatever order the object was built in, two-space
indented, so two renders of one composition diff only where they differ. An unknown
key — a future field — lands after the known ones, alphabetically, so the order stays
total.

`disclosureText(p)` is one English sentence for the container's `comment`, built only
from what is true of that file:

```
Synthetic voice and procedural music; recorded from the real product at commit abc1234; made with panoma video.
A synthetic cursor; recorded from the real product; made with panoma video.
Made with panoma video.
```

`needsDisclosure(p)` is true for a synthetic voice, music from a generator, or generated
footage — the Article 50 and YouTube triggers. The cursor is excluded on purpose: an
animated pointer over a real recording is a drawing, the same as an arrow, and marking
it would put the flag on every screen recording panoma video makes and drain it of meaning. The
procedural bed **does** count: it is not a model, but the article says "artificially
generated", and over-marking a bed is cheaper than arguing about one.

`disclosureMetadataArgs(p)` returns `["-metadata", "comment=…"]`. `comment` is one of the
keys ffmpeg's mp4 muxer writes without `-movflags use_metadata_tags`, which is why the
sentence and not a custom key carries the disclosure.

## Known limits

- **The table is a snapshot.** Every zone carries a `verified` date; the platforms move
  their UI without notice and publish little. Re-check the URLs before trusting a
  number older than a season.
- **Reels is the only official vertical value.** TikTok and Shorts are community
  numbers restating panoma video's own union, so a Reels-only violation is the common report,
  and its severity is the owner's call.
- **Cues are single-line.** A player that wants two lines wraps on its own; a cue that
  needs a deliberate line break can be edited after the fact, `toSrt` and `toVtt` keep
  a `\n` inside a cue.
- **Word boundaries are the caller's.** `cuesFromWords` trusts the words it is given.
  For CJK, where the voice returns per-character alignment, split with
  `Intl.Segmenter` first.
- **A lone short cue stays short.** Boxed in by two pauses with no neighbour to merge
  into, it is stretched as far as the next cue allows and no further. That is the
  honest outcome; the fix is fewer one-word sentences.
- **Provenance records; it does not sign.** A C2PA manifest is the machine-readable
  form regulators prefer, and no free, maintained library writes one from Node today.
  The JSON beside the file and the container comment are the fallback, and the
  `.provenance.json` is the input a signer would consume when one exists.
