/*
  One frame to a PNG, through the exact pipeline that makes videos — same server,
  same pool, same shell. Thumbnails and gallery slides are not screenshots of a
  video, they are renders of a frame, which means they can be retaken pixel-for-pixel
  after a copy change without touching any mp4.
*/
import { writeFile } from "node:fs/promises";
import { renderFrameHtml } from "./context.tsx";
import type { CompositionDef } from "./composition.ts";
import { RasterPool } from "./rasterizer.ts";
import { startAssetServer } from "./server.ts";

export async function renderStill(
  comp: CompositionDef,
  opts: { frame: number; out: string; assetsDir: string; sessionsDir?: string },
): Promise<void> {
  const server = await startAssetServer({ assets: opts.assetsDir, sessions: opts.sessionsDir });
  const pool = await RasterPool.start({
    origin: server.origin,
    width: comp.format.width,
    height: comp.format.height,
    parallel: 1,
  });
  try {
    const html = renderFrameHtml(comp.element(), {
      frame: opts.frame,
      fps: comp.fps,
      durationInFrames: comp.durationInFrames,
      format: comp.format,
    });
    await writeFile(opts.out, await pool.rasterize(html));
  } finally {
    await pool.close();
    await server.close();
  }
}

/** Several frames in one pass, for contact sheets — the pool stays warm between them. */
export async function renderFrames(
  comp: CompositionDef,
  opts: { frames: number[]; assetsDir: string; sessionsDir?: string },
): Promise<Buffer[]> {
  const server = await startAssetServer({ assets: opts.assetsDir, sessions: opts.sessionsDir });
  const pool = await RasterPool.start({
    origin: server.origin,
    width: comp.format.width,
    height: comp.format.height,
    parallel: 2,
  });
  try {
    return await Promise.all(
      opts.frames.map((frame) =>
        pool.rasterize(
          renderFrameHtml(comp.element(), {
            frame,
            fps: comp.fps,
            durationInFrames: comp.durationInFrames,
            format: comp.format,
          }),
        ),
      ),
    );
  } finally {
    await pool.close();
    await server.close();
  }
}
