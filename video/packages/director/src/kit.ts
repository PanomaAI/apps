/*
  One directory per composition: the platform copy, a thumbnail rendered by the same
  engine that renders the video (retakeable after any copy change, no mp4 involved),
  and optionally a contact sheet for judging a whole cut at a glance.
*/
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { postKitMarkdown, type Brief, type Chapter, type Copy, type FormatId, type Line } from "@panoma/video-core";

const run = promisify(execFile);

export type KitEntry = { id: string; brief: Brief; hook: Line; lang: string; formatId: FormatId };

export async function writeKit(
  entry: KitEntry,
  deps: {
    kitsDir: string;
    assetsDir: string;
    sessionsDir?: string;
    sheet: boolean;
    /** Tutorials carry them; every other recipe has none. */
    chapters?: Chapter[];
    /** Copy a brain wrote for this cut; the template's copy otherwise. */
    copy?: Copy;
    comp: import("@panoma/video-engine").CompositionDef;
    renderStill: typeof import("@panoma/video-engine").renderStill;
    renderFrames: typeof import("@panoma/video-engine").renderFrames;
    heroFrame: (brief: Brief, durationInFrames: number) => number;
  },
): Promise<string> {
  const dir = join(deps.kitsDir, entry.id);
  await mkdir(dir, { recursive: true });

  await writeFile(
    join(dir, "post.md"),
    postKitMarkdown(entry.brief, entry.hook, entry.lang, entry.formatId, { chapters: deps.chapters, copy: deps.copy }) + "\n",
  );

  await deps.renderStill(deps.comp, {
    frame: deps.heroFrame(entry.brief, deps.comp.durationInFrames),
    out: join(dir, "thumb.png"),
    assetsDir: deps.assetsDir,
    sessionsDir: deps.sessionsDir,
  });

  if (deps.sheet) {
    /*
      Twelve full-resolution frames are scratch, not deliverables: they used to be
      written INSIDE the kit and deleted only when ffmpeg succeeded, so a failed
      tile left several megabytes of hidden files in a directory people commit.
      They go to a temp directory now, and the cleanup runs whatever happens.
    */
    const n = 12;
    const frames = Array.from({ length: n }, (_, i) =>
      Math.min(deps.comp.durationInFrames - 1, Math.round((i * deps.comp.durationInFrames) / n)),
    );
    const pngs = await deps.renderFrames(deps.comp, { frames, assetsDir: deps.assetsDir, sessionsDir: deps.sessionsDir });
    const tmp = await mkdtemp(join(tmpdir(), "panoma-video-sheet-"));
    try {
      await Promise.all(pngs.map((png, i) => writeFile(join(tmp, `${String(i).padStart(2, "0")}.png`), png)));
      await run("ffmpeg", [
        "-y", "-v", "error",
        "-framerate", "1",
        "-i", join(tmp, "%02d.png"),
        "-frames:v", "1",
        "-vf", "tile=4x3",
        "-update", "1",
        join(dir, "sheet.png"),
      ]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
  return dir;
}
