/*
  ByteDance Seedance, through fal.

  Seedance's own first-party API is Volcano Engine / BytePlus and wants an account most
  people outside China do not have; fal serves the same weights behind one key, and it
  serves half a dozen other models behind the same shape — which is the argument for
  putting the adapter here rather than at ByteDance: one integration, several models.

  What it has that the Google models do not is ASPECT. Seedance makes 21:9 through 9:16
  including 1:1, and panoma video makes a square cut for the feed, so this is the only
  provider on this list that can generate b-roll for one. What it does not have is a
  negative prompt.

  Verified against fal.ai/docs/model-api-reference/video-generation-api/bytedance-seedance-2.0-image-to-video
  on 2026-09-04. Images are passed by URL there, so a still we hold in memory goes as a
  data URI — which is what every fal example does with a local file.
*/
import type { Aspect, Capability, Clip, GenRequest, Generator, ImageInput } from "../generator.ts";
import { unhonoured } from "../generator.ts";

const API = "https://fal.run";

export const SEEDANCE_DEFAULT = "bytedance/seedance-2.0";

function key(): string {
  const k = process.env.FAL_KEY;
  if (!k) throw new Error("FAL_KEY is not set. Copy .env.example to .env.");
  return k;
}

const dataUri = (still: ImageInput) => `data:${still.mimeType};base64,${still.bytes.toString("base64")}`;

export function seedanceCapability(): Capability {
  return {
    /* The endpoint takes any whole number of seconds in the band, so the board is never rounded. */
    seconds: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    aspects: ["16:9", "9:16", "1:1"],
    firstFrame: true,
    lastFrame: true,
    references: 0,
    /* This model's grid does not narrow when a picture is attached. */
    conditionedSeconds: [],
    negative: false,
    seed: true,
    audio: true,
    /*
      fal does not publish a per-second rate on the reference page, and a price this file
      invented would be worse than none: the board's estimate says so rather than quoting a
      number nobody can check. Set PANOMA_VIDEO_SEEDANCE_PER_SECOND once you know your own rate.
    */
    perSecond: Number(process.env.PANOMA_VIDEO_SEEDANCE_PER_SECOND ?? 0),
    pricedAt: "not published on the fal reference page read 2026-09-04; set PANOMA_VIDEO_SEEDANCE_PER_SECOND",
  };
}

export function seedance(model: string = SEEDANCE_DEFAULT, opts: { resolution?: "480p" | "720p" } = {}): Generator {
  const can = seedanceCapability();
  return {
    provider: "seedance",
    model,
    can,
    async make(req: GenRequest): Promise<Clip> {
      const ignored = unhonoured(req, can);
      const seconds = Math.max(4, Math.min(15, Math.round(req.seconds)));
      const aspect: Aspect = can.aspects.includes(req.aspect) ? req.aspect : "16:9";
      /* Image-to-video when a shot opens on a still; text-to-video otherwise. */
      const path = req.first ? `${model}/image-to-video` : `${model}/text-to-video`;
      const body = {
        prompt: req.negative ? `${req.prompt} Avoid: ${req.negative}.` : req.prompt,
        ...(req.first ? { image_url: dataUri(req.first) } : {}),
        ...(req.last ? { end_image_url: dataUri(req.last) } : {}),
        resolution: opts.resolution ?? "720p",
        duration: String(seconds),
        aspect_ratio: aspect,
        ...(req.seed !== undefined ? { seed: req.seed } : {}),
      };
      const answer = await fetch(`${API}/${path}`, {
        method: "POST",
        headers: { Authorization: `Key ${key()}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!answer.ok) throw new Error(`seedance: ${answer.status} ${await answer.text()}`);
      const json = (await answer.json()) as { video?: { url?: string }; seed?: number };
      const url = json.video?.url;
      if (!url) throw new Error(`seedance: the answer carried no video url: ${JSON.stringify(json).slice(0, 400)}`);
      const file = await fetch(url);
      if (!file.ok) throw new Error(`seedance download: ${file.status}`);
      if (can.perSecond === 0) ignored.push("this provider publishes no per-second rate on its reference page, so the cost below is zero and is not the bill");
      return {
        bytes: Buffer.from(await file.arrayBuffer()),
        seconds,
        provider: "seedance",
        model,
        ignored,
        cost: Math.round(seconds * can.perSecond * 100) / 100,
      };
    },
  };
}
