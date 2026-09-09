/*
  Veo 3.1 through the Gemini API.

  Google Flow (labs.google) is a UI with no public API; the models behind it are reachable
  here with a separate key and separate billing — a Flow subscription does not grant API
  credits. Generation is a long-running operation: submit, poll, then fetch the file, and
  the file is gone from Google's servers after two days, so a run that does not download
  it inside the polling loop has bought nothing.

  Verified against ai.google.dev/gemini-api/docs/veo and .../docs/pricing on 2026-09-04.
  Model ids and prices are configuration and never constants: these move every few months
  and a stale price is worse than no price. Every 3.1 id is still marked Preview, which
  means it can change without a deprecation window — `panoma-video doctor` is what notices.

  Four things about this API are undocumented, half-documented or documented wrongly, and
  each one was a request that came back 400 after the submit had already been accepted:

  1. Attaching a picture forces eight seconds. Image-to-video and first/last interpolation
     both reject 4 and 6. That is the most expensive duration AND the one that drifts most,
     which is exactly why the board buys eight and cuts two.
  2. `lastFrame` requires `image`. Sent alone it is silently ignored — no error, a clip
     that simply does not land where the board said.
  3. `personGeneration` takes different values depending on the conditioning: `allow_all`
     for text-to-video, `allow_adult` for anything with a picture attached. The wrong one
     for the mode is a hard rejection.
  4. The wire format for a picture is genuinely ambiguous: the published curl samples use
     `inlineData: { mimeType, data }` and both official SDKs emit
     `bytesBase64Encoded` for the same field. So this adapter sends the SDK's shape and
     retries once with the documented one, rather than betting on which doc is current.

  And one thing that simply is not here: `seed`, `generateAudio`, `fps` and `mask` are
  Vertex AI parameters. On this API a video cannot be made reproducible and its audio
  cannot be turned off — so an approved clip is kept as bytes, and the encoder strips the
  soundtrack the model insisted on making.
*/
import type { Capability, Clip, GenRequest, Generator, ImageInput } from "../generator.ts";
import { unhonoured, nearestSeconds, gridFor } from "../generator.ts";

const API = "https://generativelanguage.googleapis.com/v1beta";

/** What each id costs per second of 720p output, from the published pricing table. */
export const VEO_MODELS: Record<string, { perSecond: number; resolutions: string[] }> = {
  "veo-3.1-generate-preview": { perSecond: 0.4, resolutions: ["720p", "1080p", "4k"] },
  "veo-3.1-fast-generate-preview": { perSecond: 0.1, resolutions: ["720p", "1080p", "4k"] },
  "veo-3.1-lite-generate-preview": { perSecond: 0.05, resolutions: ["720p", "1080p"] },
};

export const VEO_DEFAULT = "veo-3.1-fast-generate-preview";

function key(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("GEMINI_API_KEY is not set. Copy .env.example to .env.");
  return k;
}

export function veoCapability(model: string): Capability {
  return {
    seconds: [4, 6, 8],
    /* Eight and only eight, the moment anything is attached. See the header. */
    conditionedSeconds: [8],
    aspects: ["16:9", "9:16"],
    firstFrame: true,
    lastFrame: true,
    references: 3,
    negative: true,
    /* Vertex-only. There are no reproducible renders on this API; an approved clip is bytes. */
    seed: false,
    audio: true,
    perSecond: VEO_MODELS[model]?.perSecond ?? VEO_MODELS[VEO_DEFAULT].perSecond,
    pricedAt: "ai.google.dev/gemini-api/docs/pricing, read 2026-09-04",
  };
}

/* The two shapes the same field is documented as, in the order they are tried. */
const asSdk = (img: ImageInput) => ({ bytesBase64Encoded: img.bytes.toString("base64"), mimeType: img.mimeType });
const asDocs = (img: ImageInput) => ({ inlineData: { data: img.bytes.toString("base64"), mimeType: img.mimeType } });

export function veo(model: string = VEO_DEFAULT, opts: { resolution?: "720p" | "1080p" | "4k"; pollMs?: number } = {}): Generator {
  const can = veoCapability(model);
  return {
    provider: "veo",
    model,
    can,
    async make(req: GenRequest): Promise<Clip> {
      const ignored = unhonoured(req, can);
      const conditioned = req.first !== undefined || req.last !== undefined;
      if (req.last && !req.first) {
        throw new Error("veo: a last frame was given with no first frame. This API ignores it silently, which would make a clip that does not land where the board says.");
      }
      if (req.references?.length && conditioned) {
        throw new Error("veo: reference pictures and first/last frames cannot both be sent. Pick one: reference images condition the LOOK, first/last condition the FRAMES.");
      }
      if (req.references?.length && req.aspect === "9:16") {
        throw new Error("veo: reference pictures are 16:9 only; a vertical shot with references comes back as a bare 400.");
      }

      const seconds = nearestSeconds(req.seconds, gridFor(req, can));
      const aspectRatio = can.aspects.includes(req.aspect) ? req.aspect : "16:9";
      /*
        A duration is only free at 720p and only without a picture: 1080p, 4k, reference
        images and anything image-conditioned are all eight seconds.
      */
      const resolution = opts.resolution ?? "720p";
      const forcedEight = resolution !== "720p" || conditioned || (req.references?.length ?? 0) > 0;
      const billed = forcedEight ? 8 : seconds;
      if (forcedEight && req.seconds !== 8) {
        ignored.push(
          conditioned
            ? `${req.seconds}s was asked for; conditioning on a real frame forces 8s here, so 8s was bought and the cut uses what it needs`
            : `${resolution} only makes 8s clips, so it made 8s and not ${req.seconds}s`,
        );
      }

      const build = (shape: (img: ImageInput) => unknown) => ({
        instances: [
          {
            prompt: req.prompt,
            ...(req.first ? { image: shape(req.first) } : {}),
            ...(req.last ? { lastFrame: shape(req.last) } : {}),
            ...(req.references?.length ? { referenceImages: req.references.map((r) => ({ image: shape(r), referenceType: "asset" })) } : {}),
          },
        ],
        parameters: {
          aspectRatio,
          resolution,
          /*
            A NUMBER, despite the published samples and both SDKs typing it as a string:
            sending "8" comes back as "The value type for `durationSeconds` needs to be a
            number." Measured against the live endpoint on 2026-09-04, which is the only
            documentation of this that exists.
          */
          durationSeconds: billed,
          /* Derived from the conditioning, never from configuration. The wrong one is a 400. */
          personGeneration: conditioned || (req.references?.length ?? 0) > 0 ? "allow_adult" : "allow_all",
          ...(req.negative ? { negativePrompt: req.negative } : {}),
        },
      });

      let name: string | undefined;
      let firstError = "";
      for (const shape of [asSdk, asDocs]) {
        const submit = await fetch(`${API}/models/${model}:predictLongRunning`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key() },
          body: JSON.stringify(build(shape)),
        });
        if (submit.ok) {
          ({ name } = (await submit.json()) as { name: string });
          break;
        }
        const body = await submit.text();
        /* Only the wire-format ambiguity is worth a second attempt; everything else is real. */
        const ambiguous = submit.status === 400 && /image|inlineData|bytesBase64Encoded|Unknown name/i.test(body);
        if (!firstError) firstError = `${submit.status} ${body}`;
        if (!ambiguous || !req.first) throw new Error(`veo submit: ${firstError}`);
      }
      if (!name) throw new Error(`veo submit: ${firstError}`);

      for (;;) {
        await new Promise((r) => setTimeout(r, opts.pollMs ?? 10_000));
        const poll = await fetch(`${API}/${name}`, { headers: { "x-goog-api-key": key() } });
        if (!poll.ok) throw new Error(`veo poll: ${poll.status} ${await poll.text()}`);
        const op = (await poll.json()) as {
          done?: boolean;
          error?: { message: string };
          response?: {
            generateVideoResponse?: {
              generatedSamples?: { video?: { uri?: string } }[];
              raiMediaFilteredCount?: number;
              raiMediaFilteredReasons?: string[];
            };
          };
        };
        if (op.error) throw new Error(`veo: ${op.error.message}`);
        if (!op.done) continue;
        const made = op.response?.generateVideoResponse;
        const uri = made?.generatedSamples?.[0]?.video?.uri;
        if (!uri) {
          /*
            A safety filter refusing a shot is a normal outcome with a normal cost of zero,
            and it arrives as a finished operation with no video in it rather than as an
            error. Saying which shot and why is the whole difference between a board a
            person can fix and a command that died.
          */
          const why = made?.raiMediaFilteredReasons?.join("; ");
          throw new Error(`veo: nothing came back${why ? ` — the safety filter refused it: ${why}` : ` (${JSON.stringify(op.response)})`}`);
        }
        /* Two days and it is gone from Google's servers, so it is fetched here or never. */
        const file = await fetch(uri, { headers: { "x-goog-api-key": key() } });
        if (!file.ok) throw new Error(`veo download: ${file.status}`);
        return {
          bytes: Buffer.from(await file.arrayBuffer()),
          seconds: billed,
          provider: "veo",
          model,
          ignored,
          cost: Math.round(billed * can.perSecond * 100) / 100,
        };
      }
    },
  };
}

/** The first Veo client this repository had, kept because `panoma-video assets` calls it. */
export type VeoRequest = {
  prompt: string;
  model: string;
  aspectRatio?: "16:9" | "9:16";
  seconds?: number;
  negativePrompt?: string;
  image?: { bytes: Buffer; mimeType: string };
};

export async function generateVideo(req: VeoRequest): Promise<Buffer> {
  const clip = await veo(req.model).make({
    prompt: req.prompt,
    seconds: req.seconds ?? 8,
    aspect: req.aspectRatio ?? "16:9",
    ...(req.negativePrompt ? { negative: req.negativePrompt } : {}),
    ...(req.image ? { first: req.image } : {}),
  });
  return clip.bytes;
}
