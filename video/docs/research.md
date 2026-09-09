# Field research — September 2026

Three sweeps run on 2026-09-01: the open-source compositor landscape, the generation
APIs, and the short-form virality data. What follows is the distilled state of the
world that panoma video's decisions rest on; if a fact here goes stale, re-verify before
building on it.

## Compositors and engines

| Project | State (late 2026) | Verdict |
|---|---|---|
| **Remotion** | v4.0.519, near-daily releases; 5.0 announced | **Rejected on license** (source-available; free only ≤3-person for-profit; telemetry mandatory in 5.0). Its good ideas — frame-pure components, composition-as-code — live on in `packages/engine`, reimplemented from scratch |
| **Revideo** (midrender/revideo) | MIT, alive but passively maintained | The fallback if Remotion's license ever bites. Canvas-based, headless renders |
| **Motion Canvas** | Abandoned (last real commit Feb 2025) | Steal the generator-function animation idea, not the code |
| **Editly / FFCreator / Etro** | Dead or dormant | The declarative-JSON-edit idea lives on in our Brief |
| **Mediabunny** | MPL-2.0, very active, Remotion bet on it | Future encode/mux layer if we outgrow ffmpeg CLI |
| **Theatre.js** | Publicly dormant 2 years | Its idea — animation state serialized separately from code — fits a future polish UI |
| **ShortGPT / MoneyPrinterTurbo** | MPT huge & active (Python) | Architecture donors: LLM-targeted edit language; staged pipeline with cached intermediates. Output quality is stock-footage slop — our opening |
| **OpenCut / OpenChatCut / OpenReel** | Active 2026 wave of TS editors | The consensus: local-first, real timeline, agent mutates it via tool API. Directionally where panoma video should go |
| **whisper.cpp + @remotion/captions** | Commodity | For captioning audio we did NOT generate (founder clips). Generated voice already carries timestamps |

## Generation APIs

- **Google Flow: no API, and Flow credits cannot fund API calls.** The API path is the
  Gemini API. Veo 3.1: `veo-3.1-generate-preview` ($0.40/s), `-fast-` ($0.10/s 720p),
  `-lite-` ($0.05/s); 9:16 native; audio native; image-to-video; up to 3 reference
  images ("ingredients"); 4/6/8s. Videos persist server-side only 2 days.
- **Gemini Omni Flash** (`gemini-omni-1.1-flash`, GA Aug 2026): Google's new default,
  token-priced (~$0.10/s at 720p), conversational editing, 3-10s +extensions to 40s.
  Uses the newer Interactions API — adopt when we need multi-turn editing.
- **Images**: `gemini-3.1-flash-image` (Nano Banana 2) $0.067 at 1K, 9:16 supported.
  Imagen 4 was shut down Aug 2026.
- **ElevenLabs 2026**: `eleven_v3` GA ($0.10/1k chars); Music API $0.15/min and
  commercially cleared on paid plans (the clean-license standout); SFX $0.12/gen;
  Scribe v2 $0.22/hr with word timestamps. Covers our whole audio stack.
- **Others**: Kling 3.0 $0.084-0.168/s and 2.5 Turbo from $0.042/s (cheap, 9:16);
  Runway gen4.5 $0.12/s; **Sora API shuts down Sept 24, 2026 — never build on it**;
  Suno still has no public API; Lyria 3 ($0.04/30s clip) is the budget music option.
- **Aggregators**: fal.ai (~half of gen-media API traffic) and Replicate serve Veo,
  Kling, Wan 2.2, LTX-2 behind one key — the sane integration path for open models.

## Virality data

Full numbers live in playbook.md. Headlines: >60s TikToks out-reach 5-10s clips by
96% (Buffer, 1.1M videos); TikTok's stated sweet spot 21-34s; rewatch outweighs
completion; 75-85% watch muted; word-by-word captions lift watch time 12-25%;
watermarks cost 40-60% reach cross-posted; universal safe zone ≈900x1400 centered
in 1080x1920.

Sources: the three research reports of 2026-09-01 cite ~90 URLs; keep them in the
session archive. Key ones: buffer.com/resources/longer-tiktoks-get-more-views-data,
socialinsider.io/blog/tiktok-vs-reels-vs-shorts, ai.google.dev/gemini-api/docs/veo,
ai.google.dev/gemini-api/docs/google-ai-plans, elevenlabs.io/pricing/api,
remotion.dev/docs/license, midrender.com/revideo, github.com/harry0703/MoneyPrinterTurbo.
