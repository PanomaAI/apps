/*
  The asset stage: turn a brief's lines into audio, through the cache. Regenerating an
  unchanged brief costs zero API calls; changing one word regenerates only that word's
  line. Voice comes back with word timing in the same call — captions never need a
  second trip through speech-to-text.
*/
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { music, speakWithTimestamps } from "@panoma/video-audio";
import type { Brief } from "@panoma/video-core";
import { cached, saidHash, VOICE_MANIFEST, type VoiceManifest } from "@panoma/video-core/cache";

export async function makeAssets(brief: Brief, mediaDir: string): Promise<void> {
  const cacheDir = join(mediaDir, "cache");
  const outDir = join(mediaDir, "source", "generated", brief.id);
  await mkdir(outDir, { recursive: true });

  /*
    Hooks and lines are written into one directory, named by id, so a hook that
    shares an id with a line silently overwrites its audio — and the render then
    plays the hook's sentence under a step, in perfect sync, with no error anywhere.
  */
  const ids = [...brief.hooks, ...brief.lines].map((l) => l.id);
  const repeated = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (repeated.length > 0) {
    throw new Error(
      `Brief "${brief.id}" uses the id ${[...new Set(repeated)].map((r) => `"${r}"`).join(", ")} more than once. ` +
        `Hooks and lines share one namespace on disk; the second one would overwrite the first.`,
    );
  }

  if (brief.voice) {
    /* The set is the previous run's until this one has said all of it: see @panoma/video-core/cache. */
    await rm(join(outDir, VOICE_MANIFEST), { force: true });
    const manifest: VoiceManifest = { voice: brief.voice, ...(brief.voiceSpeed === undefined ? {} : { speed: brief.voiceSpeed }), lines: {} };
    for (const lang of brief.langs) {
      let previousText: string | undefined;
      for (const line of [...brief.hooks, ...brief.lines]) {
        if (line.mode === "type") continue;
        const text = line.text[lang];
        const request = { kind: "tts", voice: brief.voice, text, previousText, speed: brief.voiceSpeed };
        const { path, hit } = await cached(cacheDir, request, "json", async () => {
          const r = await speakWithTimestamps({ text, voiceId: brief.voice!, previousText, speed: brief.voiceSpeed });
          return Buffer.from(JSON.stringify({ audio: r.audio.toString("base64"), words: r.words }));
        });
        const { audio, words } = JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8"));
        await writeFile(join(outDir, `${line.id}-${lang}.mp3`), Buffer.from(audio, "base64"));
        await writeFile(join(outDir, `${line.id}-${lang}.words.json`), JSON.stringify(words, null, 2));
        manifest.lines[`${line.id}-${lang}`] = saidHash(text);
        console.log(`· voice ${line.id} (${lang})${hit ? " — cached" : ""}`);
        previousText = text;
      }
    }
    await writeFile(join(outDir, VOICE_MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
  }

  if (brief.music?.prompt) {
    const request = { kind: "music", prompt: brief.music.prompt };
    const { path, hit } = await cached(cacheDir, request, "mp3", () =>
      music({ prompt: brief.music!.prompt!, lengthMs: 60_000 }),
    );
    console.log(`· music ${path}${hit ? " — cached" : ""}`);
  }
}
