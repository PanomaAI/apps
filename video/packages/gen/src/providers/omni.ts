/*
  Gemini Omni Flash: Google's newer video path, and a different API from Veo's.

  It answers on the Interactions API rather than through a long-running operation, it can
  return the file inline (base64) or as a URI, and it is built for CONVERSATION — a second
  turn with `previous_interaction_id` edits the clip it just made rather than making a new
  one. That is a real capability nothing else on this list has, and it is why this adapter
  exists beside Veo instead of replacing it.

  Two things it does not do, and both are honest limits a board has to be told about: it
  takes no negative prompt at all (the docs say so — "System instructions, temperature,
  top_p, stop sequences, and negative prompts" are unsupported), and its clips are short
  unless they are extended turn by turn.

  Verified against ai.google.dev/gemini-api/docs/omni and .../docs/pricing on 2026-09-04.
*/
import type { Capability, Clip, GenRequest, Generator } from "../generator.ts";
import { unhonoured } from "../generator.ts";

const API = "https://generativelanguage.googleapis.com/v1beta";

export const OMNI_DEFAULT = "gemini-omni-1.1-flash";

function key(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("GEMINI_API_KEY is not set. Copy .env.example to .env.");
  return k;
}

export function omniCapability(): Capability {
  return {
    /* Any length it will make in one turn; the docs put a single generation at 3-10s. */
    seconds: [3, 4, 5, 6, 7, 8, 9, 10],
    aspects: ["16:9", "9:16"],
    firstFrame: true,
    lastFrame: false,
    references: 0,
    /* This model's grid does not narrow when a picture is attached. */
    conditionedSeconds: [],
    /* Explicitly unsupported. A shot's avoid-list has to go into the prompt as prose. */
    negative: false,
    seed: false,
    audio: true,
    /* $17.50 per 1M video tokens at 5,792 tokens a second of 720p ≈ $0.10/s, as the page itself says. */
    perSecond: 0.101,
    pricedAt: "ai.google.dev/gemini-api/docs/pricing, read 2026-09-04",
  };
}

export function omni(model: string = OMNI_DEFAULT, opts: { resolution?: "360p" | "720p" | "1080p" | "4k" } = {}): Generator {
  const can = omniCapability();
  return {
    provider: "omni",
    model,
    can,
    async make(req: GenRequest): Promise<Clip> {
      const ignored = unhonoured(req, can);
      const seconds = Math.max(3, Math.min(10, Math.round(req.seconds)));
      /*
        No negative prompt, so what must not appear is said in the prompt instead. It is a
        weaker instrument and the report says which shots relied on it.
      */
      const prompt = req.negative ? `${req.prompt} Do not include: ${req.negative}.` : req.prompt;
      /*
        The body, as the documentation's own REST example writes it — and the first version
        of this adapter did not.

        `input` is a STRING for text-to-video, not the `[{ role, parts }]` shape every other
        Google endpoint takes; a request built that way comes back
        `400 Unknown parameter 'parts' at 'input[0]'`. Which is the useful kind of failure:
        it happens before the billing check, so it proved the endpoint and the key while
        proving nothing about credit. The multimodal form below — an array carrying a text
        part and an image part — mirrors the shape the RESPONSE uses and is inferred rather
        than quoted; it is the one thing on this page not verified against an example.
      */
      const said = `${prompt} The clip is ${seconds} seconds long.`;
      const body = {
        model,
        input: req.first
          ? [{ role: "user", content: [{ type: "text", text: said }, { type: "image", mime_type: req.first.mimeType, data: req.first.bytes.toString("base64") }] }]
          : said,
        response_format: {
          type: "video",
          /* Over about four megabytes the answer must be a URI, and a 720p clip of any length is. */
          delivery: "uri",
          aspect_ratio: can.aspects.includes(req.aspect) ? req.aspect : "16:9",
          resolution: opts.resolution ?? "720p",
        },
        generation_config: { video_config: { task: req.first ? "image_to_video" : "text_to_video" } },
      };

      const answer = await fetch(`${API}/interactions?key=${key()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!answer.ok) throw new Error(`omni: ${answer.status} ${(await answer.text()).slice(0, 400)}`);
      /*
        And the answer is a transcript, not a result: `steps` carries the input back, then
        the model's thinking, then its output, and the video is a `content` entry of type
        "video" inside the `model_output` step — as base64 in `data`, or as an address when
        the delivery was a URI.
      */
      const json = (await answer.json()) as {
        status?: string;
        steps?: { type?: string; content?: { type?: string; mime_type?: string; data?: string; uri?: string; file_uri?: string; url?: string }[] }[];
      };
      const video = (json.steps ?? [])
        .flatMap((step) => step.content ?? [])
        .find((part) => part.type === "video" || (part.mime_type ?? "").startsWith("video/"));
      if (!video) throw new Error(`omni: the answer carried no video (status ${json.status ?? "?"}): ${JSON.stringify(json).slice(0, 400)}`);
      let bytes: Buffer;
      const uri = video.uri ?? video.file_uri ?? video.url;
      if (video.data) {
        bytes = Buffer.from(video.data, "base64");
      } else if (uri) {
        const file = await fetch(uri.startsWith("http") ? `${uri}${uri.includes("?") ? "&" : "?"}key=${key()}` : `${API}/${uri}?key=${key()}`);
        if (!file.ok) throw new Error(`omni download: ${file.status}`);
        bytes = Buffer.from(await file.arrayBuffer());
      } else {
        throw new Error(`omni: the video part carried neither data nor a uri: ${JSON.stringify(video).slice(0, 300)}`);
      }
      return { bytes, seconds, provider: "omni", model, ignored, cost: Math.round(seconds * can.perSecond * 100) / 100 };
    },
  };
}
