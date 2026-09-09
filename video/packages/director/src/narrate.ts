/*
  The voice, in the automatic path.

  Until now a tutorial planned by `panoma-video auto` named a voice and never got one.
  The code that speaks lines lived in `panoma-video assets`, a command for the
  repository's own briefs, pointed at the repository's own media directory — so an
  agent that asked for a tutorial over MCP received a silent video with its sentences
  drawn as type, which is the honest fallback and is not the product. This is that
  stage, in the workspace, where the rest of the pipeline can find what it writes.

  Three things make it safe to run unattended:

  - IT COSTS LITTLE TWICE. Every request is content-addressed (@panoma/video-core/cache), so
    a re-run of an unchanged brief sends nothing at all. Changing one sentence costs
    that sentence and the one after it: a line is spoken knowing what preceded it,
    which is what keeps the prosody continuous across separate calls, and that
    predecessor is part of the request.
  - IT CANNOT RUN AWAY. The characters a run may send are capped before the first
    call, counted across every brief, language and hook. Past the cap the stage
    declines and says by how much — it never sends "most" of a tutorial, because
    half a narration is worse than none: the recipe lays out at two clocks.
  - IT NEVER SPEAKS A PLACEHOLDER. The briefs handed here are expanded, so what is
    said is what the audit already vouched for, word for word.

  What it writes is what `buildCompositions` looks for: `<brief id>/<line id>-<lang>.mp3`
  beside a `.words.json` of the word timings the same API call returned. Recovering
  those timings by sending the audio back through speech-to-text is what the old
  pipeline did, and it is why captions used to drift. It also writes the manifest that
  says the set is complete and whose sentences it is (`VOICE_MANIFEST`) — last, after
  the whole brief has succeeded, and only then, because files that merely exist are
  the previous run's until something says otherwise.
*/
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_VOICE, speakWithTimestamps, type Word } from "@panoma/video-audio";
import { cached, saidHash, VOICE_MANIFEST, type VoiceManifest } from "@panoma/video-core/cache";
import type { Brief, Line } from "@panoma/video-core";

export { DEFAULT_VOICE };

/*
  The characters one run may send, across every brief, language and hook.

  A tutorial of ten steps in two languages is about fifteen hundred; this is more
  than ten of those, and still small enough that a runaway loop is a rounding error
  rather than a bill. It exists because this is the only stage in the pipeline that
  spends money, and the doctrine for those is a key and a cap, never a key alone.
*/
export const NARRATION_CHAR_CAP = 20_000;

export type NarrationResult = {
  status: "done" | "cached" | "skipped" | "failed";
  summary: string;
  /** Audio files on disk when this returned, whether spoken now or reused. */
  files: number;
  /** Characters actually sent to the API — zero on a fully cached run. */
  charged: number;
};

/**
 * What a voice has to say for a brief: every hook, because each one opens a
 * different cut, and every line that is not type-only. Order matters — the lines
 * are spoken in it, each told what preceded it, which is what keeps the prosody of
 * a sentence continuous across separate API calls.
 */
export function spokenLines(brief: Brief): Line[] {
  return [...brief.hooks, ...brief.lines].filter((l) => l.mode !== "type");
}

/**
 * Ids that would overwrite each other on disk.
 *
 * Hooks and lines share one namespace in the generated directory, so a hook called
 * `cta` and a line called `cta` produce one file — and the render then plays the
 * hook's sentence under a step, in sync, with no error anywhere.
 */
export function collidingIds(brief: Brief): string[] {
  const ids = [...brief.hooks, ...brief.lines].map((l) => l.id);
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
}

/** Characters a brief would send, before any cache is consulted. */
export function charCost(brief: Brief): number {
  let n = 0;
  for (const lang of brief.langs) for (const line of spokenLines(brief)) n += (line.text[lang] ?? "").length;
  return n;
}

export async function narrate(input: {
  /** Expanded briefs — placeholders are never spoken. */
  briefs: readonly Brief[];
  /** The workspace's generated directory. */
  outDir: string;
  cacheDir: string;
  charCap?: number;
  onProgress?: (message: string, done?: number, total?: number) => void;
  signal?: AbortSignal;
}): Promise<NarrationResult> {
  const voiced = input.briefs.filter((b) => b.voice);
  if (voiced.length === 0) return { status: "skipped", summary: "no brief asks for a voice", files: 0, charged: 0 };
  if (!process.env.ELEVENLABS_API_KEY) {
    return {
      status: "skipped",
      summary: "ELEVENLABS_API_KEY is not set, so the tutorial shows its sentences as type instead of speaking them",
      files: 0,
      charged: 0,
    };
  }

  const cap = input.charCap ?? NARRATION_CHAR_CAP;
  const wanted = voiced.reduce((n, b) => n + charCost(b), 0);
  if (wanted > cap) {
    /* The number closes the sentence, and the sentence says what to do about it. */
    return {
      status: "skipped",
      summary: `the narration would send more characters than one run may spend — say less, or narrate fewer briefs at a time; over by ${wanted - cap}`,
      files: 0,
      charged: 0,
    };
  }

  let files = 0;
  let charged = 0;
  const total = voiced.reduce((n, b) => n + b.langs.length * spokenLines(b).length, 0);
  for (const brief of voiced) {
    const collisions = collidingIds(brief);
    if (collisions.length > 0) {
      return {
        status: "failed",
        summary: `brief "${brief.id}" uses ${collisions.map((c) => `"${c}"`).join(", ")} for both a hook and a line; on disk they are one file, and the render would play the wrong sentence under a step`,
        files,
        charged,
      };
    }
    const dir = join(input.outDir, brief.id);
    await mkdir(dir, { recursive: true });
    /* Nothing vouches for what is already there until this brief has been said whole. */
    await rm(join(dir, VOICE_MANIFEST), { force: true });
    const manifest: VoiceManifest = { voice: brief.voice!, ...(brief.voiceSpeed === undefined ? {} : { speed: brief.voiceSpeed }), lines: {} };
    for (const lang of brief.langs) {
      /*
        A hook opens its cut, so nothing precedes it. The lines that follow chain from
        the first hook onwards: chaining each line to each hook instead would double
        the bill to change the breath before one sentence.
      */
      let previousText: string | undefined = brief.hooks[0]?.text[lang];
      for (const line of spokenLines(brief)) {
        /* A stop is not a broken brief: the report must not send an agent off to rewrite words nobody objected to. */
        if (input.signal?.aborted) return { status: "skipped", summary: "the run was cancelled before the narration finished; the piece falls back to type", files, charged };
        const isHook = brief.hooks.some((h) => h.id === line.id);
        const text = line.text[lang] ?? "";
        if (!text.trim()) continue;
        const request = { kind: "tts", voice: brief.voice, text, previousText: isHook ? undefined : previousText, speed: brief.voiceSpeed };
        const { path, hit } = await cached(input.cacheDir, request, "json", async () => {
          charged += text.length;
          const r = await speakWithTimestamps({
            text,
            voiceId: brief.voice!,
            previousText: isHook ? undefined : previousText,
            speed: brief.voiceSpeed,
          });
          return Buffer.from(JSON.stringify({ audio: r.audio.toString("base64"), words: r.words }));
        });
        const said = JSON.parse(await readFile(path, "utf8")) as { audio: string; words: Word[] };
        await writeFile(join(dir, `${line.id}-${lang}.mp3`), Buffer.from(said.audio, "base64"));
        await writeFile(join(dir, `${line.id}-${lang}.words.json`), JSON.stringify(said.words, null, 2));
        manifest.lines[`${line.id}-${lang}`] = saidHash(text);
        files++;
        input.onProgress?.(`${brief.id} · ${line.id} (${lang})${hit ? " — cached" : ""}`, files, total);
        if (!isHook) previousText = text;
      }
    }
    await writeFile(join(dir, VOICE_MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
  }
  const spoken = voiced.map((b) => b.id).join(", ");
  return {
    status: charged === 0 ? "cached" : "done",
    summary: charged === 0 ? `every line was already spoken: ${spoken}` : `${spoken} · characters spoken: ${charged}`,
    files,
    charged,
  };
}
