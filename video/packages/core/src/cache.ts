/*
  Content-addressed cache for generated assets. Node-only — never import from render code.

  Every generator (voice, music, sfx, veo) is a pure function from a request object to
  bytes, so the sha256 of the canonical request names the result. Re-running a pipeline
  with an unchanged brief costs zero API calls; changing one word regenerates exactly the
  assets that word touches. The cache lives in media/cache and is git-ignored.
*/
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function requestHash(request: unknown): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex").slice(0, 16);
}

/*
  What a directory of generated speech is allowed to be believed about.

  The audio for a brief is written one file per line and language, named by line id,
  and a reader used to accept the set as complete because the files existed. They can
  exist and be wrong: a run whose narration failed, was cancelled or found no key
  leaves the PREVIOUS run's files exactly where they were, and the render then plays
  the old sentence under the new caption, in sync, with the report saying the piece
  fell back to type. Nothing about the files themselves says which brief they belong
  to.

  So the writer states it, once, after the whole brief has succeeded: a manifest of
  every line it spoke, against a digest of the words it spoke. A reader that wants to
  treat the audio as this brief's narration checks it, and a set that does not match
  is not a set — the piece falls back to type, which is the honest outcome and the one
  the report already claims.
*/
export const VOICE_MANIFEST = "voice.json";

export type VoiceManifest = {
  voice: string;
  speed?: number;
  /** `<line id>-<lang>` to a digest of the sentence that was spoken. */
  lines: Record<string, string>;
};

/** The digest a manifest entry carries: the words themselves, nothing else. */
export function saidHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * Does this manifest vouch for exactly these sentences?
 *
 * `wanted` is the `<line id>-<lang>` keys the reader needs and the text it expects
 * under each. A missing entry, a different sentence or a different voice all mean no.
 */
export function manifestVouches(
  manifest: VoiceManifest | null | undefined,
  voice: string,
  wanted: readonly { key: string; text: string }[],
): boolean {
  if (!manifest || manifest.voice !== voice) return false;
  return wanted.every((w) => manifest.lines[w.key] === saidHash(w.text));
}

export async function cached(
  dir: string,
  request: unknown,
  ext: string,
  produce: () => Promise<Buffer>,
): Promise<{ path: string; hit: boolean }> {
  const path = join(dir, `${requestHash(request)}.${ext}`);
  try {
    await readFile(path);
    return { path, hit: true };
  } catch {
    /* miss — produce below */
  }
  const bytes = await produce();
  await mkdir(dir, { recursive: true });
  await writeFile(path, bytes);
  return { path, hit: false };
}
