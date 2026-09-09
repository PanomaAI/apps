# Filming native mobile apps

> **Not built, 2026-09-04.** Nothing in this document exists in the repository. It is the
> record of a survey — six research lenses, adversarially verified, plus measurements taken
> on a real machine — written so that whoever builds this does not have to do the survey
> again. Read §Licences and §What not to build before writing a line: half the work here is
> knowing which of the obvious tools are disqualified and why.

panoma video films a running product. Today that product has to be a web page, because everything
load-bearing comes from Chromium: the recording, the stills, the 8× region crops, and the
DOM geometry that tells the camera what a rectangle *is*. The question this document answers
is whether a native iOS or Android app can be filmed to the same standard, with free software
only.

## The verdict

**Android, yes, at full quality. iOS, two of the three requirements, and the third capped
hard enough to change the shot list.**

This inverts the obvious guess — that iOS is easier because the Simulator is already on the
Mac. Android is the only one of the two where all three requirements are met by
Apache-2.0/MIT code running locally, where the density lever is genuinely uncapped, and where
the stack is free software all the way down to the OS. iOS gives an excellent element tree
(better than the DOM in one respect) and a fine recording, but **there is no equivalent of
`Page.captureScreenshot(clip, scale)` anywhere in the platform, free or proprietary** — every
scale knob in the iOS ecosystem scales *down*.

## What panoma video actually needs

Restated here so this document stands alone. These are the three things a browser gives it,
and the bar any other surface has to clear:

1. **A video** of the running app, at a known frame rate, seekable frame-accurately.
2. **An element tree with rectangles, time-synchronised**: for each moment, which controls
   exist, their role and name, and their bounding box in the app's own coordinate space.
   This is what places marks, decides what to press, lifts a control onto its own plane, and
   says what a press changed. Without it there are only pixels — and inferring geometry from
   pixels is the one thing this repository refuses to do, because a depth model over a flat
   interface reads contrast as geometry and returns bowed panels.
3. **High-density region capture**: one control's rectangle rendered at several device pixels
   per logical pixel. On the web, CDP gives up to 8×. It is what lets the camera push in on a
   button without it going soft.

Plus the standing constraint: **free/libre licences only**, enforced by a guardian test.

## Measured on this machine

Taken on 2026-09-04, macOS 25.5, iPhone 17 Pro simulator on iOS 26.3. These are measurements,
not documentation — where they disagree with a vendor page, they win.

| What | Value | How |
| --- | --- | --- |
| Screenshot size | **1206 × 2622 px** | `xcrun simctl io <udid> screenshot` |
| Logical size | 402 × 874 pt | device profile → **exactly 3×** |
| Recording size | **1206 × 2622** | `simctl io recordVideo --codec h264` — full native resolution |
| Nominal frame rate | 15/1 | `ffprobe` — **and it is a container artefact, not the truth** |
| Real frame rate under motion | **60 fps** (median gap 0.0167 s) | frame PTS analysis over an 8.1 s recording |
| Sustained | 56 frames in the best 1 s window | same |
| Static screen, 4 s recorded | **1 frame** | the recorder is change-driven |

Two things follow immediately, and one of them is a happy surprise.

**The recording is at full 3× native resolution.** This is the inversion worth knowing: on the
web the WebM is 1× the CSS viewport, which is why panoma video needs separate macro crops at all. On
iOS the density is already in the footage.

**And the recorder is variable-frame-rate.** Four seconds of a still screen produced one
frame. A frame exists only when pixels change.

## Requirement 1 — video

**Do not master from a device-side encoder, on either platform.** Every one of them is VFR by
construction; scrcpy's own `doc/video.md` says so outright. If panoma video treats a mobile MP4 the
way it treats a web capture, it will **silently lose the end of every shot that finishes on a
static screen** — which is most of them, because a tutorial holds after every press.

This is the same class of failure the panoma repo already learned about: measure by state
change, not by playback.

**Master from stills, assembled at whatever CFR the film declares.**

Android:

```bash
adb exec-out screencap > frame.bin   # 16-byte header (w, h, format=1 RGBA_8888, colorspace) + w*h*4
```

Raw, not `-p`: 0.83 s per frame against 1.05–1.15 s with PNG encoding on the device. Convert
host-side.

iOS: pull stills through `idb`, or run the raw stream and take frames from it.

For the shots that genuinely need motion — a spring, a scroll with momentum, a transition —
record and re-time host-side:

```bash
# Android. --time-limit 0 is real; the "3 minute cap" is stale folklore (AOSP sets UINT32_MAX).
adb shell screenrecord --output-format=mp4 --bit-rate 20M --time-limit 0 /sdcard/shot.mp4
```

**The find worth building on:** every `screenrecord` MP4 already carries two extra
`application/octet-stream` tracks holding a Winscope block — magic `#VV1NSC0PET1ME2#`,
version 2, the realtime-to-elapsed offset in ns, the frame count, then one 8-byte
elapsed-realtime timestamp per frame. AOSP's own Winscope uses exactly this to align traces to
video frame by frame. **Parse those tracks; do not trust PTS alone.**

```bash
# iOS. Raw BGRA on a clock you declare, rather than an encoder deciding your timing.
idb video-stream --fps 24 --format rbga \
  | ffmpeg -f rawvideo -pix_fmt bgra -s 1206x2622 -r 24 -i - -c:v prores_ks shot.mov
```

**What is lost versus the web.** On the web, CDP timestamps the screencast frames and the DOM
read on one connection. Here the video and the tree come from different processes with
different clocks, and the host has to impose one. On Android, use the device's elapsed-realtime
(`adb shell cat /proc/uptime`) read around every tree dump and every gesture, matched against
the Winscope table. On iOS, use host-monotonic time around every dump and tap, anchored on the
recorder's start response — **plus a calibration run**: a measured appearance change issued at
+3.046 s wall landed at PTS 3.5917, of which 0.279 s was the command's own round trip, leaving
~0.25 s of repaint and encode latency. That offset is real and machine-specific. Measure it per
host; never hard-code it.

## Requirement 2 — the element tree

Met well on both platforms, and on Android met *better than the DOM* in one respect.

### Android — write the capture service

Do not put `uiautomator dump` in the hot loop. Measured at 2.03–2.68 s per call on a 30–54 node
screen, because it starts a fresh `app_process` every time — and worse, it **blocks waiting for
the window to go idle**, which is precisely wrong during the animations panoma video films. Use it for
the week-one prototype and nothing else:

```bash
adb shell uiautomator dump /sdcard/ui.xml && adb exec-out cat /sdcard/ui.xml
```

(Write to a file and read it back; piping to `/dev/tty` truncates.)

The real answer is a ~400-line APK: an `AccessibilityService` that holds
`getRootInActiveWindow()` / `getWindows()` in-process, exposes the tree over a socket reached
with `adb forward`, and stamps every dump with elapsed-realtime. It gives three things nothing
off the shelf gives together:

- no process-start tax, and no idle-wait;
- `AccessibilityEvent` callbacks that say **when** and **what** a press changed — panoma video's "what
  did this press do" signal, *delivered rather than inferred*, which is better than the web;
- `takeScreenshot(displayId, …)`, whose `ScreenshotResult` **already carries a timestamp** — a
  (tree, pixels, clock) triple from one source.

Drive from the same service with `dispatchGesture()`: arbitrary multi-touch paths, arbitrary
durations, no JVM start per call, unlike `adb shell input tap`.

This is the Android analogue of the CDP session panoma video already depends on, and it is the
differentiator. Nobody ships it.

### iOS — `idb`, which grew into the right shape

```bash
idb ui describe-all --format complete
idb ui tap X Y
```

Per node: `AXFrame`, plus a numeric `frame {x, y, width, height}` **in UIKit points — the same
space `idb ui tap` consumes**, so "press the thing" and "draw a mark on the thing" agree by
construction. Plus role, subrole, label, traits, enabled, and two keys panoma video would otherwise have
had to invent: `interactable` (can this be acted on, and why not) and `occluded_by` (what is
covering it). `--format complete` also returns screen bounds, an explicit `truncated` flag, and
a timing profile (`read_duration_ms`, `element_count`), so panoma video can measure its own dump cost
instead of guessing.

Two disciplines, both from idb's own source:

- `interactable` and `occluded_by` make the app hit-test every node, costing a round trip per
  occluded element. Ask the cheap key set per frame and the expensive one only at decision
  points.
- **Never dump per frame.** The loop is *act → wait for quiescence → dump once → place marks
  from that dump*.

### What is lost versus the web

A tree read is expensive and can go stale mid-walk; every XCTest-backed implementation ships a
depth cap and a timeout for this reason.

And since Android 14, an app can set `isAccessibilityDataSensitive` on a view to hide it from
accessibility services — banking and login screens already do. **Nodes go missing with no
error**, which is the failure mode this repository hates most: not a crash, a quiet wrong
answer. Detect it: if a screenshot has content in a region the tree calls empty, fail the shot
loudly rather than filming a lie.

## Requirement 3 — density, and the arithmetic

Let **P** be the push factor: how much larger a control appears in the final frame than in the
establishing shot. Sharpness holds while

> P ≤ (capture density) / (density the establishing framing already consumes)

| Surface | Capture density | Establishing cost | **P max** |
| --- | --- | --- | --- |
| **Web today** | 8× (CDP clip+scale) | ~1.35 px/CSS px | **≈ 5.9×** |
| **iOS** | 3×, fixed | 1080/874 = 1.24 px/pt | **≈ 2.4×** |
| **Android, AVD at 640 dpi** | 4× | — | ≈ 3.2× |
| **Android, AVD at 1280 dpi** | 8× | — | **≈ 6.5× — matches the web** |

Concretely on iOS: **Apple's 44 pt minimum tap target is 132 real pixels, ever.** In an
establishing frame it occupies 54 px of 1080. Push it to 300 px — a routine panoma video move — and you
are upscaling 2.3×. Push it to fill the frame and you are at 8× interpolation, which is exactly
the mush this repository exists to avoid.

The 3× is verified three ways: `simctl io screenshot` accepts only `--type`, `--display`,
`--mask` and returns 1206 × 2622; `simctl io booted enumerate` shows one IOSurface at
1206 × 2622 BGRA on a screen declaring "Preferred UI Scale: 3"; and that 3 is written into
`mainScreenScale` in the `.simdevicetype` profile plist, which no CLI exposes.

### The Android lever

Android can **raise the density of a whole display and re-render**. Measured:
`wm size 2160x3840 && wm density 840` on a 1080×1920@420 device produced a real 2160×3840
`screencap`, visibly crisper than a lanczos 2× upscale of the 1× shot — a genuine supersample.
And `uiautomator dump` bounds scaled exactly 2× with it, so pixels and rectangles stay in one
coordinate space.

**The discipline:** scale width, height and dpi by the *same* factor, so dp geometry is
unchanged and the app lays out identically. Changing them unevenly changes the layout — a node
count dropped 54 → 41 when that was done by accident.

That route caps at 3× (`DisplayContent.getValidForcedSize()` has `maxScale = 3`, confirmed to
the pixel: asking 4320×7680 returned 4320×5760). **So do not use it as the primary.** Build the
device large from birth instead — in `~/.android/avd/<name>.avd/config.ini`, for a Pixel-class
411 × 891 dp phone:

| Profile | `hw.lcd.width` | `hw.lcd.height` | `hw.lcd.density` | Effect |
| --- | --- | --- | --- | --- |
| 4× | 1644 | 3564 | 640 | P ≈ 3.2×, and **nothing upscales** — 640 dpi is exactly the xxxhdpi bucket, so every raster asset ships at native size |
| 8× | 3288 | 7128 | 1280 | P ≈ 6.5×, matching the web — but bitmap assets top out at xxxhdpi and upscale 2×. Text, vector drawables and Compose primitives render at a true 8× |

No `getValidForcedSize` cap applies, because nothing is being overridden.

**Recommendation: the 4× AVD as default, 8× for text- and vector-heavy shots, `wm size` /
`wm density` (≤3×) only as a fallback on a real device.** On iOS, accept 3×, master
accordingly, and say so out loud rather than faking it with an ffmpeg upscale labelled "8×".

Housekeeping for every shot, because it costs nothing:

```bash
xcrun simctl status_bar booted override --time 9:41
xcrun simctl ui booted appearance dark
```

## Android vs iOS

They are not symmetric, and the asymmetry runs opposite to intuition.

**Android is reachable at full quality.** All three requirements are met by free software. The
density lever is a real re-render with no ceiling if the device is built large. The emulator
boots headless in ~20 s, so it runs in CI on Linux:

```bash
emulator -avd panoma_video_4x -no-window -no-audio -no-boot-anim -read-only \
  -no-snapshot-save -gpu swiftshader_indirect -grpc 8554 -port 5560
```

The tree is available on real devices as well as emulators, the frame-to-clock table already
exists inside the video file, and the floor is AOSP.

**iOS is reachable at reduced quality, and only on a Mac.** Requirement 3 has no answer at all.
The tree is simulator-only in practice: idb's accessibility is `FBSimulatorControl`, and
`FBDeviceControl` has no accessibility commands; AXe is simulator-only; and
`pymobiledevice3`'s accessibility model serialises to
`{platform_identifier, estimated_uid, caption, spoken_description}` — **no rectangle**, which
only appear on audit *issues*. WebDriverAgent is the only free way to get a rectangled tree off
a real iPhone, and it costs a signed XCTest bundle, a team id, a provisioning profile, and a
watchdog that may kill long sessions.

And unlike the web, **there is no free engine at the bottom**: Chromium is free, Xcode is not.

One thing iOS does better: `interactable` and `occluded_by` are a real occlusion verdict from
the platform, which on the web panoma video has to derive by hit-testing itself.

## The web-emulator idea

The premise — "there are already web emulators for native apps" — is half true. They exist and
some are excellent. **But for a tool whose whole position is "read geometry, never infer it",
a browser transport is close to the opposite of the answer**, because what it hands you is a
pixel stream, and pixels are the one thing panoma video already has too much of.

Against the three requirements:

- **The tree does not come from the browser.** Every product that has one gets it from the same
  two places panoma video would use locally and for free — UiAutomator/accessibility over adb, and
  XCTest/AX on the Simulator. Going through a web emulator adds a hop and removes nothing.
- **Density gets strictly worse.** The Android Emulator's own `emulator_controller.proto` says
  a requested screenshot "will never exceed the given width" — downscale only, no clip.
  Appetize's `screenshot()` is whole-device with no clip and no scale, and its stream `scale`
  runs 10–100 %. `idb --scale-factor` is documented "between 0 and 1.0". **Not one offers
  clip+scale.** They cap at device pixels and then put lossy H.264 on top.
- **Video is a live stream, not a seekable file.** `android-emulator-webrtc` and `ws-scrcpy`
  give WebRTC/MSE you would have to re-record — which is exactly the screen recording panoma video
  exists not to be.

For iOS there is **no legal route off Apple hardware**. The Corellium litigation established a
fair-use defence for one security-research product in one circuit and settled before the DMCA
§1201 question was decided; it says nothing about the iOS SLA.

And every hosted one contradicts the product premise — nothing leaves the machine — before it
contradicts the licence test.

## Licences

**Clean and usable:** idb (MIT) · scrcpy (Apache-2.0) · AOSP tooling — `screenrecord`,
`screencap`, `wm`, `uiautomator`, Perfetto/Winscope (Apache-2.0) · androidx.test / UiAutomator
2.4.0 (Apache-2.0) · AXe (MIT) · go-ios (MIT) · `reactivecircus/android-emulator-runner`
(Apache-2.0).

ffmpeg is LGPL-2.1+ or GPL-2.0+ depending on the build — **shell out, never link**, and the
distinction disappears. This is what the repository already does.

**Free but with a condition:**

- `pymobiledevice3` is **GPL-3.0** — fine as a subprocess, infectious if imported as a library.
- WebDriverAgent is verbatim three-clause BSD with Facebook's copyright, but GitHub's API
  reports `NOASSERTION` / `Other` because the LICENSE opens with "BSD License / For
  WebDriverAgent software" instead of the canonical preamble. **A guardian test that trusts the
  SPDX field will reject a perfectly free dependency.** If WDA is ever needed, allowlist it by
  the SHA of the LICENSE text, not by an API's opinion. The architecture below does not need
  it, which is one more reason to prefer it.

**Disqualified — report as such, never recommend:**

- `docker-android` (budtmo). Its LICENSE.md says it in its own words: "a Custom Apache 2.0
  License, NOT a dual-license model you may choose from", with obligations on forks — plus
  default telemetry that geolocates users via ipinfo.io. Apache-2.0 with added obligations is
  not Apache-2.0, and a product promising nothing leaves the machine cannot ship a component
  that phones home with your city.
- **`maestro record` as used by default.** The CLI is genuinely Apache-2.0, but
  `RecordCommand.kt` without `--local` uses `RemoteVideoRenderer` and **uploads your frames to
  mobile.dev** for rendering. `--local` exists and is marked beta. The Apache licence covers the
  CLI you drive, not the video service it calls. Maestro Studio is not open source.
- `redroid` — the docs/images repo has **no LICENSE file at all**, and it is Linux-only anyway.
  "Almost certainly AOSP-derived and fine" is not what a guardian test accepts.
- All hosted device clouds and proprietary emulators: Appetize.io, BrowserStack, Sauce Labs,
  LambdaTest, HeadSpin, Firebase Test Lab, Genymotion, Corellium.

### The two toolchain exceptions

**These must go into doctrine before the first line of code, because no manifest scanner will
ever see them.** They are the same shape as the repository's existing dependency on a browser:
an external tool the developer installs, never vendored.

- **The Android SDK binary.** The emulator's *source* is free (QEMU GPL-2.0 plus Apache-2.0
  Android parts), but the binary Google ships carries `android-sdk-license`: you "may not copy
  (except for backup purposes), modify, adapt, redistribute, decompile, reverse engineer,
  disassemble, or create derivative works", licensed "solely to develop applications for
  compatible implementations of Android". Prefer AOSP `default` / `aosp_atd` system images over
  `google_apis` wherever the app under test does not need Play services; then even the image is
  free.
- **Xcode, `simctl`, XCTest and the Simulator** are proprietary under the Apple SDK agreement.
  The SLA permits use only on Apple-branded hardware and only to develop and test applications;
  it does not permit redistribution, and it is why there is no legal Linux CI for filming iOS.
  **Filming an iOS app requires a Mac with Xcode.** That is a defensible line — the same one
  panoma video draws when it requires a browser — but draw it deliberately.

## What to build, in order

One architecture for both platforms: **a `Stage` interface on the host, a capture agent on the
device, and the host owning the clock.**

```
Stage:
  open(app)
  tree()          -> nodes with rects + device timestamp
  press(nodeRef)
  still(rect?)    -> pixels + timestamp
  record(fps)
```

The director code — marks, the camera, the lift-onto-its-own-plane move — stays
platform-agnostic and never sees `adb` or `idb`. Everything below is an implementation of that
interface.

| Phase | Work | Size |
| --- | --- | --- |
| **0** | Write the doctrine paragraph and the licence note above into `docs/`; add the two toolchain exceptions to the guardian test's documentation so the next audit does not re-litigate them | 1 day |
| **1** | **Android Stage, prototype.** Headless emulator, `adb`, `uiautomator dump` for the tree (slow, zero setup), `screencap` raw stills, assembled at 24 fps host-side. Goal: one complete 30 s film of a real app, frame-accurate, marks placed from real rectangles | ~1 week |
| **2** | **The capture APK — the differentiator.** The `AccessibilityService`: tree + rects + elapsed-realtime over a forwarded socket, `dispatchGesture` for input, `takeScreenshot` with its built-in timestamp. Removes the 2-second tax and the idle-wait in one move, and delivers the "what changed" signal instead of inferring it | ~1 week |
| **3** | **Density.** Two AVD profiles, 4× and 8×, same dp as the target device. Density becomes a per-*shot* decision — "this shot runs on the 8× stage" — not a per-crop one, because it costs a re-render | 2 days |
| **4** | **Motion shots.** `screenrecord`, a parser for the Winscope timestamp tracks, host-side re-timing to CFR. Only for shots with real motion; stills remain the master everywhere else | 3 days |
| **5** | **iOS Stage.** `idb ui describe-all --format complete` for the tree, `idb ui tap/swipe/text` for driving, `idb video-stream` for video, host-monotonic timestamps around every dump and tap, and a calibration run for the repaint offset. Simulator only. **No WDA, no Appium, no Node** — which also means no licence exception | ~1 week |
| **6** | *Only if asked.* The in-app render shim for iOS: a debug-configuration Swift package that re-renders a view at arbitrary scale (`ImageRenderer.scale`, or `UIGraphicsImageRendererFormat.scale` + `layer.render(in:)`), addressed by the accessibility identifier panoma video already has from the tree. This is the *true* analogue of clip+scale, because like CDP it **re-rasterises rather than interpolating**. It films the user's own app, so a debug-only package is a reasonable ask — and it is the only iOS path to requirement 3 at all | — |

### How much of panoma video's quality survives

**Survives whole: the position.** Geometry comes from the tree on both platforms, never from
pixels. Marks land on real rectangles, in the same coordinate space the driver taps in. On
Android, "what did this press change" arrives as an `AccessibilityEvent` rather than being
inferred — better than what the web gives.

**Survives with work: frame accuracy.** The stills-stepped master recovers it fully, but it is
work the web path did not need, and motion shots will always be re-timed from a VFR source.

**Gets worse, specifically: the push-in on iOS.** panoma video's signature move — a control lifted onto
its own plane, staying sharp while everything behind it softens — has a budget of ~2.4× on iOS
against ~6× on the web. A 44 pt button is 132 real pixels and there is no way to get more. On
Android at the 8× stage the move survives intact for text and vector content. Plan the iOS shot
list around wider crops and let the *motion* carry the emphasis instead of the magnification —
or ship the Phase 6 shim.

## What not to build

- **Do not master from `xcrun simctl io recordVideo`, or any device-side encoder.** VFR,
  change-driven, and it drops the static tail of every shot. Measured: 4 s of a still screen,
  1 frame.
- **Do not put `uiautomator dump` in the hot loop.** ~2.3 s per call, and it blocks on window
  idle — wrong exactly during the animation you are filming.
- **Do not use `scrcpy --new-display` as the density lever.** It is uncapped and tempting, but
  `uiautomator` and accessibility do not see that display: you would buy pixels by losing the
  tree, which is the one trade panoma video must never make.
- **Do not edit `.simdevicetype` plists to fake a 6× simulator.** sudo under `/Library`,
  unsupported, and iOS ships no @6× asset variants, so raster content upscales anyway.
- **Do not upscale in ffmpeg and call it a push-in.** Interpolation is precisely the artefact
  that gives competitors away. Where the pixels are not there, reframe the shot.
- **Do not use `maestro record`**, with or without `--local`: without it your frames go to
  mobile.dev; with it you get a stylised product video with a device frame and captions, not a
  seekable master.
- **Do not adopt** minicap/minitouch ("Emulators are not supported", plus prebuilt libraries
  compiled inside the AOSP tree per SDK level) · **ws-scrcpy** (unreleased since 2024 against a
  server now at 4.1 — read it as protocol documentation, never run it) · **tidevice** (two iOS
  majors behind) · **sonic-ios-bridge** (archived 2024).
- **Do not depend on XcodeBuildMCP, mobile-mcp or mobilerun.** They are agent-shaped wrappers
  over `simctl`, AXe, WDA and `adb shell input`. Read them for how the pieces combine; calling
  the underlying tools directly is strictly less machinery.
- **Do not add Appium.** A Node server plus two on-device APKs, to obtain a tree the capture
  service gives you in-process — and its recording defaults are 10 fps MJPEG.
- **Do not attempt real iOS devices in v1.** The rectangled tree there needs a signed WDA
  bundle, a team id, a provisioning profile, and a watchdog that kills long sessions — a whole
  project, for a platform where requirement 3 is capped anyway.
- **Do not go near a hosted emulator or device cloud.** They fail the licence test, and they
  fail the product premise first.

## Provenance

Everything in *Measured on this machine* was taken here on 2026-09-04 and can be re-run. The
Android numbers, the Winscope track format, the licence findings and the `getValidForcedSize`
cap come from a six-lens survey whose load-bearing claims were then adversarially verified:
**12 survived, 4 were refuted and dropped.** Where a number is quoted without a measurement
above, treat it as read rather than measured, and re-check it before betting a week on it —
this field moves, and several tools in it have relicensed.
