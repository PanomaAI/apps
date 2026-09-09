# The weakness map — where panoma video wins

Two field surveys of 2026-09-01: the commercial short-form tools (CapCut, Veed,
Descript, Captions, Submagic, Opus Clip, Vizard, Klap, the render APIs, the
idea-to-video generators) and the developer-video tools (Screen Studio and its clone
industry, Clueso/Guidde/Arcade/Storylane/Walnut, Jitter/Rive/AE, the launch-video
economy). Method: user complaints (Trustpilot, G2, Reddit, forums), not vendor copy.
~90 sources; the session archive holds them all, the load-bearing ones are cited
inline. Every claim below about panoma video refers to code that exists at this commit.

## The ten structural gaps, crossed against what we have

| # | Gap in the field (evidence) | panoma video today | The move |
|---|---|---|---|
| 1 | **The meter is the product.** Source-minute credits (Opus charges the 30-min podcast even if you keep one clip), credit opacity (Captions, Vizard), 30% overage premium (Shotstack), $2-3/min (Plainly). n8n user: costs spike "exactly when your automation is working" | **Have.** Local render, zero marginal cost, no credits anywhere | Say it plainly: no meter, no seat, no render bill |
| 2 | **Exports held hostage.** Watermarks after paying (Veed), clips that expire in 3 days (Opus, Kapwing), renders deleted in 30 (Creatomate), pay-to-export discovered at export (CapCut, Trustpilot 1.2/5) | **Have.** Files on your disk, forever | Nothing to build — this is a sentence in the README |
| 3 | **Template sameness.** "If you only swap clips and text, your video competes with hundreds using the exact rhythm" | **Have the antidote, half-built.** Recipes are code, not templates; the palette is one theme module | Theme-per-brief so every brand ships its own design system |
| 4 | **Nobody cuts to the music.** Beat-sync is a consumer assist (CapCut/Filmora snap clips to a song) or an FCPXML marker export (Beat2Cut); **no API or automation platform is music-aware at all** | **Have, as core identity.** The grid refuses tempos that don't divide the frame rate; every cut lands on a beat by construction | Ship SFX-on-beat and beat-locked audio loops; this is the moat, deepen it |
| 5 | **Multi-format = crop.** Every "resize" surveyed (Veed, Kapwing, Opus/Vizard reframe, Resolve Smart Reframe) is center-crop or subject-tracking crop, with documented mis-tracking failures. True reflow does not exist in the mainstream | **Have.** One composition reflows into 9:16 / 16:9 / 1:1 against per-format safe areas | Keep every new recipe format-blind; it costs nothing extra at authoring time |
| 6 | **Hook variants exist only in ads.** Sovran ($66-99/mo, media-buyer-shaped, vendor-only evidence). No creator tool renders N hooks × one body | **Have.** The matrix is the product: hooks × languages × formats from one brief | Wire performance feedback so the matrix learns which hooks win |
| 7 | **Nothing knows the product.** Prompt-to-video outputs stock slop (InVideo shipped stock footage with the stock watermark still on it); changelog-video tools (ngram, Velo, Supermotion) need pasted text; **zero tools read git, releases, or the app UI** | **Have the seed, alone in the space.** `panoma-video ideate` reads git history; `@panoma/video-capture` shoots the real UI deterministically | The flagship: release-triggered trailers — tag push → brief → matrix → kit. Nobody else can follow without rebuilding their architecture |
| 8 | **Cloud-only plus rights overreach.** CapCut's 2025 ToS takes a perpetual, irrevocable license over even private drafts; every SaaS requires uploading unreleased product footage; multi-hour queues (Opus, Klap, HeyGen) | **Have.** Local-first, nothing leaves the machine — the same sentence panoma is built on | Brand synergy: one philosophy, two products |
| 9 | **Music licensing anxiety.** CapCut's library is only cleared on-platform; Content ID claims redirect creator revenue; liability sits on the creator | **Partial.** ElevenLabs music is commercially cleared on paid plans; SFX are synthesized in-repo | Stamp provenance into the kit: every audio asset with its license line |
| 10 | **Audio mastering is voice-only.** Descript/Veed clean speech; nobody masters the full mix to platform loudness | **Have.** Two-pass -14 LUFS on every render, music ducks under voice automatically | Nothing — already ahead |

## The developer-specific findings

- **The repo-to-video loop is unclaimed.** The whole lineage is Gource (2009, abstract
  commit graphs), GitHub Unwrapped (annual novelty), RepoClip (one-shot AI promo,
  ignores activity). Changelog SaaS requires paste-in text — ngram has no git
  integration at all. `panoma-video ideate` already stands where nobody is standing.
- **The launch-video economy is broken at both ends.** Indie founders confess the video
  gets thought about "two days before launch"; agencies run $1,500-7,000 for 60
  seconds, Sandwich publishes "from $50k". A rendered-from-reality video at zero
  marginal cost attacks the whole curve.
- **Screen Studio's category (capture beautification) — claimed, our way.** Their
  model: one hand-recorded take, cursor baked into pixels, re-record on every UI
  change, macOS-only, and a pricing revolt when the lifetime license died. Decision
  of 2026-09-01 (owner's call, reversing this doc's first draft): the suite must be
  complete, so panoma video ships the beautifier — as code. `panoma-video record` drives the real
  product with Playwright, the input log is data, the renderer draws the eased
  cursor and attacks every auto-zoom on a musical beat, and a UI change costs one
  re-run, not a re-recording. Cross-platform by construction.
- **CI-deterministic video is "Remotion plus footnotes"** — and Remotion is the tool
  the license test already expelled. We own the renderer; `panoma-video render` in a GitHub
  Action is configuration, not a feature.

## What the field has that we lack, and whether to care

- **Auto-captions for external recordings** — `transcribe()` exists in @panoma/video-audio
  (scribe, word timestamps) but no recipe consumes a founder clip yet. Worth building:
  it is the #1 commodity feature (Submagic/Captions) and ours is local.
- **A timeline editor** — deliberately absent; the brief is the interface. Revisit
  only if non-developers become users.
- **Avatars, stock libraries, publishing APIs** — deliberately absent: slop,
  sameness, and ToS fragility are the field's three documented wounds.
- **Windows** — untested. The clone industry around Screen Studio exists because of
  macOS lock-in; when panoma video opens, CI needs the three-OS matrix panoma already runs.

## The wedge, in one sentence

Brief in — beat-locked 9:16 + 16:9 + 1:1 out, N hooks per idea, generated from your
product's real history, rendered on your machine: no meter, no watermark, no upload,
no rights grab. Every clause maps to a documented complaint in the surveys above.

## Load-bearing sources

Trustpilot: capcut.com (1.2/5, 1,263 reviews) · captions.ai · klap.app · revid.ai ·
argil.ai (2.8/5). CapCut ToS: larryjordan.com, digitalcameraworld.com. Opus credit
math: ascynd.io, playcut.ai. Shotstack overage: shotstack.io/pricing, n8n community
thread 306487. Reframe-is-crop: opus.pro/ai-reframe, Blackmagic forum 196392.
Sovran: sovran.ai. Repo-to-video void: github.com/{acaudwell/Gource,
initialcommit-com/git-story, remotion-dev/github-unwrapped}, ngram.com, usevelo.ai.
Launch costs: contentbeta.com, vidico.com, sandwich.co/faq, flowjam.com. Screen
Studio revolt: alternativeto.net (Oct 2025). Devtool bottleneck: draft.dev,
dev.to/kazutaka-dev.
