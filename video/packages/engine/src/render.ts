/*
  The orchestration: rasterize frames in parallel, deliver them in order. Workers pull
  frame numbers from a shared cursor and park results in a small reorder buffer; a
  single flusher writes whatever contiguous run is ready and honors ffmpeg's
  backpressure. The window cap keeps a fast worker from racing ahead of a slow frame
  and ballooning memory — the buffer can never hold more than a few dozen PNGs.
*/
import { availableParallelism } from "node:os";
import { renderFrameHtml } from "./context.tsx";
import type { CompositionDef } from "./composition.ts";
import { startEncoder } from "./encoder.ts";
import { RasterPool } from "./rasterizer.ts";
import { startAssetServer } from "./server.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/*
  How many frames are painted at once.

  Six was a constant written on a ten-core laptop, and it was read as a throughput
  number for a year. It is not one. Every page rasterizes in software — SwiftShader,
  see DETERMINISM_ARGS — and SwiftShader already spreads one page's work across the
  whole machine, so a second page has no idle core to run on. Measured here, twenty-four
  1920x1080 frames took 7.4 s with six pages, 7.6 s with two and 7.7 s with one: the
  pool's width bought nothing at all. What it does buy is memory, once per page, and
  that bill came due on the two-core CI runners, where Chromium went away in the middle
  of a render and the screenshot could only report a page that was already closed.

  The end-to-end suite says the same thing from the other side: with the cap forced to
  two pages the agent's whole path took 253 s against 293 s at six, on the same laptop.
  Narrower was faster, which is what you expect once the pages are competing for the
  same cores and the same memory rather than for idle ones.

  So: never more pages than the machine has cores to run them on, and never more than
  the six it had, which is where a large machine stops caring anyway. A developer's
  laptop keeps exactly the number it used to have.
*/
const MAX_PARALLEL = 6;

export async function renderComposition(
  comp: CompositionDef,
  opts: {
    out: string;
    assetsDir: string;
    sessionsDir?: string;
    parallel?: number;
    onProgress?: (done: number, total: number) => void;
    /** Container tags — the AI-disclosure line among them (see encoder.ts). */
    metadata?: Record<string, string>;
    /** A client's cancellation: the pool and ffmpeg are torn down the moment it fires. */
    signal?: AbortSignal;
  },
): Promise<void> {
  const parallel = opts.parallel ?? Math.max(1, Math.min(MAX_PARALLEL, availableParallelism()));
  const total = comp.durationInFrames;

  const server = await startAssetServer({ assets: opts.assetsDir, sessions: opts.sessionsDir });
  const pool = await RasterPool.start({
    origin: server.origin,
    width: comp.format.width,
    height: comp.format.height,
    parallel,
  });
  const encoder = startEncoder({
    out: opts.out,
    fps: comp.fps,
    durationInFrames: total,
    audio: comp.audio,
    metadata: opts.metadata,
  });

  const element = comp.element();
  const buffer = new Map<number, Buffer>();
  let cursor = 0;
  let next = 0;
  let flushing = false;
  let failure: Error | null = null;

  async function flush(): Promise<void> {
    if (flushing) return;
    flushing = true;
    try {
      while (buffer.has(next)) {
        const png = buffer.get(next)!;
        buffer.delete(next);
        next++;
        await encoder.write(png);
        if (next % 60 === 0 || next === total) opts.onProgress?.(next, total);
      }
    } finally {
      flushing = false;
    }
    if (buffer.has(next)) await flush();
  }

  const cancelled = () => opts.signal?.aborted === true;
  async function worker(): Promise<void> {
    for (;;) {
      if (failure) return;
      if (cancelled()) {
        failure = new Error("Render cancelled.");
        return;
      }
      const frame = cursor++;
      if (frame >= total) return;
      while (frame - next > parallel * 4) {
        if (failure) return;
        await sleep(10);
      }
      const html = renderFrameHtml(element, {
        frame,
        fps: comp.fps,
        durationInFrames: total,
        format: comp.format,
      });
      buffer.set(frame, await pool.rasterize(html));
      await flush();
    }
  }

  try {
    await Promise.all(
      Array.from({ length: parallel }, () =>
        worker().catch((e) => {
          failure = e as Error;
        }),
      ),
    );
    if (failure) throw failure;
    await flush();
    await encoder.finish();
  } catch (error) {
    await encoder.abort();
    throw error;
  } finally {
    await pool.close();
    await server.close();
  }
}
