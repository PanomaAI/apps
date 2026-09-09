/*
  What `--music=` is allowed to be. The deleted browser Studio validated its own request
  and refused a directory or a `.env` before reading a byte; the terminal never reached
  that validator, so the same argument went to ffmpeg and came back as whatever ffmpeg
  says about a file that is not a track. The check moved to `scoreTrack`, which every
  path that scores a brought track — the terminal, the agent channel, `auto` — goes
  through.
*/
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { scoreTrack } from "../packages/director/src/music.ts";

test("a brought track that is not an audio file is refused by name, before it reaches ffmpeg", async t => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-music-argument-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ws = { paths: { music: join(dir, "music") } };
  await mkdir(ws.paths.music, { recursive: true });

  await assert.rejects(scoreTrack(ws, join(dir, "missing.wav"), 30), /No music file at/);

  await writeFile(join(dir, ".env"), "ELEVENLABS_API_KEY=not-a-track\n");
  await assert.rejects(scoreTrack(ws, join(dir, ".env"), 30), error => {
    assert.match((error as Error).message, /is not an audio file/);
    assert.match((error as Error).message, /MP3, WAV, FLAC/, "the refusal says what would be accepted");
    assert.doesNotMatch((error as Error).message, /not-a-track/, "the refusal never quotes the file's contents");
    return true;
  });

  await writeFile(join(dir, "notes.txt"), "a text file with a track's name in it");
  await assert.rejects(scoreTrack(ws, join(dir, "notes.txt"), 30), /is not an audio file/);

  await mkdir(join(dir, "album.wav"));
  await assert.rejects(scoreTrack(ws, join(dir, "album.wav"), 30), /is not an audio file/, "a directory with an audio suffix is not a track");
});
