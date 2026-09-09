# Review

> Evidence before delivery. A render is not finished until a file has been measured.

Everything upstream of `@panoma/video-review` knows what it *meant* to produce. This package
measures what the encoded file actually contains, with ffmpeg and ffprobe, and returns a
`ReviewReport` whose every check names the number it compared against and where that
number comes from. A failing report blocks `launch`; an agent driving panoma video over MCP reads
the same report and loops until the gate opens.

## Why the file, and not the renderer

Every failure this package catches is one the renderer could not see from the inside:

| Failure | Where it is born | What sees it |
| --- | --- | --- |
| A black beat | a scene that returned nothing for a frame range | `blackdetect` |
| A frozen picture | a stalled screenshot pipe, or a hold nobody declared | `freezedetect`, `signalstats` YDIF |
| A cut that did not land | two scenes that look the same across the beat | `scdet` against the plan |
| A true peak over the ceiling | the AAC encode, after the master step's limiter | `ebur128 peak=true` on the mp4 |
| A strobe | a beat grid cutting between dark and light scenes at >3 a second | the flash detector |
| A file the platform rejects | duration, size, atom order | ffprobe and the bytes |

The master step measures a wav and writes an mp4; the review measures the mp4. That is
the whole point.

## What `reviewVideo` does

```ts
const report = await reviewVideo("renders/pov--en--h.mp4", {
  targets: ["youtube", "linkedin"],
  plannedCuts: grid.cuts,                 // seconds
  declaredHolds: [{ from: 12.4, to: 15.1 }],
  recipe: "Tutorial",
});
report.status;                            // "pass" | "warn" | "fail"
reportText(report, "concise");            // for the terminal
```

One ffprobe call, then three ffmpeg decodes side by side (picture, sound, flash), then
the conformance table. Twenty seconds of 1080p30 take about five seconds on this machine.

Every check is `{ id, status, summary, threshold, source, at? }`. The summary is one
sentence a model can act on ("true peak -0.3 dBTP is above -1.0 dBTP … lower the limiter
ceiling"); `at` lists seconds and frames; `threshold` and `source` are the number and its
origin, so a reader never has to trust the reviewer.

## The checks, and the numbers behind them

### Picture (`video.*`)

| Check | Rule | Source |
| --- | --- | --- |
| `video.black` | warn on a black run ≥ 0.1 s (a dark interface on a dark backdrop is 98% black to a luma threshold; the summary says where) | `blackdetect=d=0.1:pix_th=0.10`, ffmpeg filter docs |
| `video.frozen` | warn on a frozen run ≥ 1 s outside declared holds (a still page under a slow camera is frozen to the detector) | `freezedetect=n=-60dB:d=1` |
| `video.duplicates` | warn on a run > 1 s of frames whose mean luma difference is under 0.5 (outside holds) | `signalstats` YDIF; QCTools uses the same metric |
| `video.firstframe` | warn when the first frame's mean luma is under 38 — feeds show it as the poster | blackdetect's own pixel threshold on limited range |
| `video.cuts.planned` | warn when a planned cut has no scene score ≥ 10 within ±1 frame (a jump under a dimmed card scores under it) | `scdet=t=10` (documented useful range 8–14) |
| `video.cuts.unplanned` | warn on a scene change nobody planned | same |
| `video.density` | warn when any 5 s window holds more than 5 cuts (ASL under a second) | house rule after Cutting, DeLong & Nothelfer 2010 |
| `video.asl` | warn when a Tutorial/ScreenDemo/ScreenCast averages under 2 s a shot | same |

`declaredHolds` is how a tutorial's retimed still (see [tutorials.md](tutorials.md)) passes:
the hold is a decision, so the caller says so, and only the *uncovered* seconds of a
frozen run count.

### Sound (`audio.*`)

| Check | Rule | Source |
| --- | --- | --- |
| `audio.truepeak` | fail above -1.0 dBTP | AES TD1004.1.15-10; EBU R 128 |
| `audio.integrated` | warn outside -18..-12 LUFS — **observed, not published** | no platform documents a target; the band is what normalisation is observed to leave alone. AES's own streaming range is -16..-20 |
| `audio.shortterm` | fail when max short-term exceeds integrated + 5 LU (warn on pieces over 60 s, outside the rule's scope) | AES TD1004, short-form |
| `audio.silence` | fail on an internal gap ≥ 1 s below -50 dB; warn on leading silence > 0.5 s; fail on a track that is silent throughout | house rule; `silencedetect` |
| `audio.clipping` | fail when the decoded sample peak reaches 0 dBFS, or a flat top sits at ≥ -0.1 dBFS | `astats` Peak level and Flat factor |

A file with no audio stream skips the audio checks and says so; `expectSilent` makes the
skip quiet.

The -14 LUFS the master step targets is two LU hotter than AES's ceiling. That is fine for
a feed and the report says so in words rather than failing on folklore.

`audio.truepeak` measures the file that ships, and until 2026-09-04 the master did not.
Every measurement in the mastering chain is of the filtered PCM, and what leaves is AAC: a
lossy codec reconstructs a waveform close to the original and not identical to it, and the
difference shows first at the peaks. A Spanish narration held by the limiter at exactly
-1.0 dBTP came back from the encoder at -0.9 and failed the gate the whole chain exists to
pass. The master now measures the written file and lowers the ceiling once if it has to —
once, because lowering a limiter can only lower a peak.

### Flash (`flash.*`)

There is no free, maintained photosensitivity analyser to call — ffmpeg's
`photosensitivity` filter is a mitigator that follows no guideline, PEAT forbids
commercial use, and IRIS is a C++ build for a rule that fits in a page. So the rule is
implemented here on a 32×18 grey grid streamed from ffmpeg (`-f rawvideo -pix_fmt gray`).

The rule is ITU-R BT.1702-3 Guideline 1, which is also Ofcom's guidance and WCAG 2.3.1
in different units:

- a **flash** is a pair of opposing luminance changes of ≥ 20 cd/m² where the darker
  image is below 160 cd/m²;
- **fail** (`flash.bt1702`) when more than three flashes occur in any one-second period, and the windows over the limit run longer than a second and a half (a single window — a fast scroll across a light-and-dark page — warns with its second; decision of 2026-09-01 after the rule stopped panoma's own landing)
  over more than 25% of the frame;
- flashes whose leading edges are ≥ 9 frames apart (≤ 25 fps) or ≥ 334 ms apart (30 fps
  and up) are acceptable regardless of brightness or area;
- **warn** (`flash.sustained`) on 2–3 flashes a second sustained for 5 s (EA IRIS's
  warning tier, BSD-3-Clause) and on any compliant flashing run longer than 5 s
  (BT.1702's own note).

Units: BT.1702 Annex 2 assumes SDR peak white of 200 cd/m², so a grey value is linearised
with the sRGB curve to relative luminance and multiplied by 200. A 20 cd/m² step is then a
0.10 change in relative luminance — WCAG's threshold — so one detector serves both
standards. The report carries a per-second trace `{ second, areaFlashing, flashes }` in
`details`, the shape HardingFPA users expect, so an agent can fix the exact beat.

### Story (`story.*`)

Computed from the plan, not from pixels, by `storyChecks` in
`packages/director/src/story-checks.ts`; `panoma-video auto` and the MCP tools append them to
the file's report. A heading slideshow with a clean mix passes every signal check.

| Check | Rule | Fixed by |
| --- | --- | --- |
| `story.claims` | fail on a literal number, an unknown fact, a fact in the wrong language, a placeholder token or a roadmap item quoted as shipped — in a line's text or its chip | plan |
| `story.marks` | fail when a narrated mark is missing from any take | record |
| `story.pairs` | fail when a trailer has fewer than two or more than four claim→proof pairs | plan |
| `story.proof` | warn when a trailer claim is proved by a scroll rather than an action (unless the project is a static site) | tour |
| `story.captions` | warn when a spoken phrase reads over 20 characters a second, or more than a third of them over 17 — per language, on the words the voice produced (Netflix Timed Text Style Guide) | plan |
| `story.open-on-motion` · `story.brand-by-5s` · `story.cta-last` · `story.proof-length` · `story.stalls` | warnings on the shape of the piece: a card in the first second, no brand inside five seconds, no address at the end, a proof that ran out of footage, a step that holds a frozen picture | engine · plan · plan · record · record |

Safe zones are not a check yet: `zoneViolations` in `packages/core/src/safe-zones.ts`
answers the question, and nothing asks it of a rendered cut (open question, owner).

### Conformance (`platform.<target>.*`)

A dated table, one row per target, each with the page it was read from:

| Target | Hard limits (fail) | Recommendations (warn) | Source |
| --- | --- | --- | --- |
| youtube | — | 8 Mbps at 1080p ≤ 30 fps (12 at 48–60), H.264 High yuv420p progressive, bt709 tags, moov first, AAC 48 kHz ≥ 128 kbps (384 stereo noted) | support.google.com/youtube/answer/1722171 |
| shorts | ≤ 180 s | as YouTube | support.google.com/youtube/answer/10059070 |
| tiktok | ≤ 600 s, ≤ 500 MB | ≥ 2.5 Mbps | ads.tiktok.com/help/article/video-ads-specifications |
| reels | ≤ 900 s, ≤ 4 GB | warn over 180 s (no longer recommended to new audiences) | facebook.com/business/ads-guide/update/video/instagram-reels |
| x | ≤ 140 s, ≤ 512 MB (non-Premium) | — | help.x.com/en/using-x/x-videos |
| linkedin | 3–1800 s, ≤ 500 MB | 30 fps recommended — reported as a pass with a note, because every 24 fps cut would otherwise warn forever | business.linkedin.com/advertise/ads/sponsored-content/video-ads/specs |

Every row was read on 2026-09-01. These numbers move; the date is there so a stale row is
a known quantity rather than a surprise.

## Pictures

`contactSheet(file, { seconds, columns: 4, width: 1280, out })` tiles the frames at the
given seconds into one JPEG; `frameAt(file, seconds, { out })` extracts one. Both return
`{ file, bytes, width, seconds }` with an absolute path. JPEG quality steps down until the
file fits the MCP image budget (about 80 KB), because the picture rides inside a tool
result that a model reads. Timestamps are burned onto tiles only when the ffmpeg build
has `drawtext`; the Homebrew build does not, so the seconds come back in the result for
a caller to caption in text.

## Decisions

- **Measure the mp4, never the wav.** Inter-sample overs are born in the AAC encode.
- **Clipping is not `Abs_Peak_count > 0`.** That counter is ≥ 1 for every file (some
  sample is always the loudest). Clipping is a decoded peak at full scale, or a flat top
  at -0.1 dBFS.
- **The loudness band warns; the true peak fails.** One is folklore with a citation, the
  other is a standard.
- **The exemption for spaced flashes is implemented, not assumed.** Arithmetically, four
  flashes in one second already imply a gap under 334 ms; the code still applies the
  rule so the report can explain a pass on a slow strobe in the standard's own words.
- **A silent file skips, a silent track fails.** No audio stream is a choice the caller
  can declare; an audio stream carrying digital silence is a mix that lost its inputs.
- **The CLI's own `-color_primaries/-color_trc/-colorspace` did not tag the file** with
  ffmpeg 9 and libx264; only `setparams` on the frames did. The encoder must do the same
  or every platform check warns "untagged".

## Severities, decided on real renders

The first automatic renders (2026-09-01) failed on a dark product page ("black"), a still
page under a slow camera ("frozen"), a window arriving over a beat ("first frame black"),
a jump under a dimmed card ("planned cut missing") and a scroll across panoma's own
landing ("flashing"). None was a defect a viewer would see. So the picture checks warn
and never fail; the flash rule fails only when sustained; and fail is kept for what needs
no interpretation: conformance, true peak, a silent track, and the story checks the
director adds (a claim without a fact, a mark a take lacks, fewer than two pairs).

## Known limits

- **No saturated-red check.** BT.1702 treats a transition to or from saturated red as
  harmful regardless of luminance; the detector works on a grey stream and cannot see
  it. Adding it means streaming RGB (3× the bytes, still trivial) and WCAG's
  R/(R+G+B) ≥ 0.8 test; it is not done yet.
- **Luma is treated as sRGB-encoded.** ffmpeg's grey output is BT.709 luma expanded to
  full range, which is not exactly display luminance of the linear light. For a rule
  with a 20 cd/m² step and a 25% area gate the difference is well inside the margin.
- **Broadcast severity only.** WCAG's "strict" mode (25% of a 10-degree field, which is
  smaller than 25% of the frame on a large display) is not offered; product videos are
  watched on phones, where the whole frame is roughly that field.
- **YDIF is a mean over the whole plane.** A cursor moving on a flat title card scores
  under 0.5 and reads as a duplicate run; that is why `video.duplicates` warns rather
  than fails, and why a recipe with a long still opening should declare it as a hold.
- **`scdet` sees hard cuts.** A slow dissolve scores under 10 and reads as "planned cut
  not found"; a plan that dissolves should not list that beat as a cut.
- **The loudness band is a reading of behaviour, not a document.** When a platform
  publishes a target, replace the band and its source.
- **Performance is bounded by the decode**, three of them: roughly a quarter of the
  piece's duration on this machine for 1080p30. A ten-minute file takes a couple of
  minutes; the MCP server should stream progress.
