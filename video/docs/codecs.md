# Codecs

> ffmpeg is never bundled, and where the machine already has an encoder, that is the one
> that runs.

Two decisions live in `packages/codec`, and they answer two questions that are easy to
mistake for one.

## The two questions

**Copyright** is about the source code: who wrote it, and what the licence lets you do
with it. It is why no ffmpeg travels inside this product. A build carrying libx264 is
GPL-2.0-or-later, and the licence-clean way to use one from AGPL code is to invoke it as
a separate process — which is what `packages/review/src/exec.ts` does, by name, off
PATH.

**Patents** are about the method: someone registered the technique of compressing video
this way, and they did not grant anything by publishing source code, because they did not
write it. Every licence in this tree can be honoured perfectly and say nothing about that,
because it is a different question with different holders. That is why this product ships
no encoder, and why `NOTICE.md` grants no patent licence and sends the reader to their own
counsel.

`tests/licenses.test.ts` guards the first. `tests/codec.test.ts` guards what can be
guarded of the second.

## What runs

| System | H.264 | AAC |
| --- | --- | --- |
| macOS 13+ | `h264_videotoolbox` | `aac_at` |
| Windows | `libx264` — see below | `aac_mf` |
| Linux, macOS 12 and older, an ffmpeg without them | `libx264` | ffmpeg's `aac` |

Where the operating system ships an encoder **and somebody has measured it there**, that
encoder runs. Otherwise the fallback is what this project used everywhere before
7-Sep-2026. Linux ships no encoder of its own; macOS before 13 has one that cannot be
told to hold a bitrate; and Windows is a story of its own, below.

The practical reason is measured. On a 19 s 1080x1920 deliverable, `h264_videotoolbox`
held 4.87 Mbps against libx264's 4.95 and spent 1.7 s of CPU against 11.4 — the same
file for a sixth of the work, on the machine a render is already waiting on. Quality at
that rate is 0.99927 SSIM against libx264's 0.99992, both measured against the same
source.

The other reason is that a codec the machine came with was licensed by whoever sold the
machine, and calling it ships no encoder of ours. What that settles is a question for a
lawyer and not for this file; what it changes is concrete and worth writing down.

## What the settings are, and why they are not the same

Rate control is per-encoder, and the arguments are not interchangeable. What this engine
renders is mostly flat cards carrying text, and every encoder left to judge for itself
encodes those into almost nothing — after which the platform's own second encode has too
little edge information left to keep interface type legible. So the rate is held:

- **libx264** — `-b:v`, `-minrate`, `-maxrate`, `-bufsize` and `nal-hrd=cbr`.
- **h264_videotoolbox** — `-constant_bit_rate`, and pointedly **without** `-maxrate` or
  `-bufsize`. With a maximum set as well the same flat card came out at 33 kbps instead
  of 4.4 Mbps. It looks like the careful spelling, and it is the trap; there is a test
  for it.
`-constant_bit_rate` arrived in macOS 13. Below that VideoToolbox reads `-b:v` as a
suggestion and a flat card comes out at a fortieth of it, so macOS 12 and older keep
libx264 rather than lose the floor.

**Rate control converges, and short pieces sit inside the ramp.** On the same card at
5 Mbps: libx264 lands 1,097 kbps short at a second and a half, 244 short at four seconds,
46 short at twenty; VideoToolbox 1,661 short, then 622, then 123. A deliverable out of
this engine is twenty to forty-five seconds, which is past the ramp for both. This
matters when reading a test: `encode.test.ts` renders six seconds for that reason, and
`codec.test.ts` renders a second and a half on purpose, to hold the worst case to the
lowest floor a platform actually sets rather than to the number one encoder happens to
hit.

## Windows, and what it cost to guess

Windows ships Media Foundation — `h264_mf` and `aac_mf` — and this project does not use
it. That is a measurement, not an opinion, and the measurement was expensive.

`h264_mf` was written into the table on the strength of reading about it. What made that
feel safe was the fallback: an ffmpeg built without the encoder selects libx264 on its
own, so the worst case looked like no change at all. That reasoning covered the wrong
failure. Media Foundation *was* there. The arguments were wrong:

```
[h264_mf] Unable to parse "profile" option value "high"
[h264_mf] Error applying encoder options: Invalid argument
```

`-profile:v high` is a name, and that option on that encoder wants a number. So every
encode failed the instant it started, and the Windows half of CI — which runs this suite
in 27 to 30 minutes and always has — passed 86 minutes on two runners still inside
`pnpm test`, waiting on a file that could never be written, and was killed rather than
paid for.

The obvious repair is `-profile:v 100`, since that option wants a number. Here is what
`packages/codec/src/measure.ts` says about that repair, run on a real `windows-latest`
runner against gyan.dev's ffmpeg 9.0.1, on a 6 s 1080x1920 card asked for 5 Mbps:

```
libx264  as shipped                     3.0s    4839 kbps  High|yuv420p
h264_mf  as shipped (profile:v high)  FAILED              Invalid argument
h264_mf  profile:v 100                  2.2s      58 kbps  High|yuv420p
h264_mf  no profile                     2.3s      58 kbps  Constrained Baseline|yuv420p
h264_mf  no rate_control                1.9s      58 kbps  Constrained Baseline|yuv420p

aac                                     0.3s     243 kbps  aac|LC|48000|239930
aac_mf                                  0.2s     259 kbps  aac|LC|48000|256018
```

**Fifty-eight kilobits.** Media Foundation ignores the rate on this material, and
`-rate_control cbr` does not move it. The repair would have stopped the error and started
writing silently unusable video — a worse failure than the one it fixed, and one no test
outside the conformance floor would have caught quickly. So Windows keeps libx264 for
picture.

`aac_mf` is a different encoder and got a different answer: 256.0 kbps for a 256k request
against ffmpeg's own 239.9, 48 kHz AAC-LC, and faster. It is measured, so it is used.

That is what this file means by measured. `.github/workflows/codec.yml` runs the
instrument on any of the three systems on demand — no install, no browsers, no suite, a
few minutes against the better part of an hour.

## Intermediates

`crushGround` writes an element once and every render after reads it, so it is encoded for
quality rather than to a rate: `-crf 16` on libx264, `-q:v 90` on VideoToolbox — measured
against each other on a 4 s 720p element at 0.9977 SSIM in 5.4 MB and 0.9987 in 13.2 MB.
Media Foundation's quality mode has been measured by nobody here, so Windows keeps CRF
until somebody does. That is a known gap, not an oversight.

## Rules for this area

Nothing in this file is legal advice, and none of it establishes that any particular use
infringes or does not. What it establishes is smaller and true: this product ships no
encoder, and where the machine has one of its own, that is what encodes. The patent
notice in `NOTICE.md` says the rest, and anything past it is a question for your own
counsel rather than for this file.

Three things follow for anyone changing this area:

- Do not add a dependency that bundles an ffmpeg binary. `tests/codec.test.ts` fails on
  the usual ones by name.
- Do not answer a patent question with a copyright argument. That sentence used to live
  in `exec.ts` and read as though the subprocess boundary settled both.
- Do not add an encoder to the table without running `measure.ts` on that system. The
  section on Windows is what happens otherwise.

## Reading which encoder ran

Nothing about the choice is silent. ffmpeg stamps the encoder into the file's own stream
metadata, `probe()` reads it back as `video.encoder`, and it reaches the report as
`measured.encoder`, so `reportText` prints it on the line under the verdict:

```
PASS renders/pov--en--v.mp4
  19.0 s · 1080x1920 · 30 fps · -14.0 LUFS · TP -1.1 dBTP · cuts: 12 · Lavc63.1.101 h264_videotoolbox
```
