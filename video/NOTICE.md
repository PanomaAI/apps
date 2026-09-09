# Notices

Copyright (c) 2026 Jesús Castillo.

panoma video is free software under the GNU Affero General Public License, version 3
only — see [LICENSE](LICENSE). That licence covers this software and nothing else. It
grants no rights under patents, trademarks, or other intellectual property held by third
parties, including rights relating to media formats and codecs.

## No encoder is distributed

panoma video does not include, download, or install any video or audio encoder or decoder.
It writes media files by invoking, in this order:

- the encoder supplied by the operating system, where one exists and has been measured
  fit for this material — VideoToolbox and AudioToolbox on macOS 13 and later, and Media
  Foundation's AAC encoder on Windows;
- otherwise, the `ffmpeg` and `ffprobe` found on `PATH`, which you install yourself and
  which their authors license under their own terms (LGPL-2.1-or-later, or
  GPL-2.0-or-later for builds that include components such as libx264).

To read media — clips you bring, elements you buy, files it measures — panoma video uses
the decoding capabilities of the browser build you installed through Playwright and of
that same `ffmpeg`. It never asks either to encode.

Which encoder wrote a given file is recorded in that file's own stream metadata and
printed by `panoma-video review`. [docs/codecs.md](docs/codecs.md) is the record of how
that choice is made and measured.

## Third-party software

- **FFmpeg** — invoked as a separate process; never distributed with this software.
  <https://ffmpeg.org/legal.html>
- **Chromium** — the browser build you install through Playwright, used to rasterise
  frames and to decode the clips it composites; subject to its own terms.
- **Fonts and media** vendored with this software are credited in the `CREDITS.json`
  beside them, each with its author, source, and licence file — under `assets/fonts` in
  the installed package, and under `packages/engine/assets` and `apps/render/public` in
  the source tree.
- **Ported source** — code adapted from OpenScreen, dembrandt, Cap and auto-editor is
  attributed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), which also carries the
  notices of every dependency the package installs.

## Patents

No patent licence is granted or implied by this software or its licence. Whether
encoding, decoding, distributing, or otherwise exploiting media in a given format
requires a licence from a third party or the payment of royalties depends on the
jurisdiction and on the use, and is a question for the holders of those rights and for
your own counsel, not for this project.

## Trademarks

The names *panoma* and *panoma video*, and the P monogram, are not covered by the licence.
AGPL-3.0 §7(e) lets a licensor decline to grant rights in its names and marks, and this
project does. You may always say your software is based on panoma video; you may not call
it panoma video. The usage policy is `TRADEMARK.md` in the source repository named below.

## Source

What npm installs is compiled output, not source. The complete Corresponding Source for
this version, as the licence uses that term, is the `video` directory of
<https://github.com/PanomaAI/apps> at the tag matching this version — `panoma-video-`
followed by the version in `package.json`.
