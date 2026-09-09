/*
  One picture of one local page.

  Small on purpose. `RasterPool` in @panoma/video-engine keeps warm pages with fonts loaded because
  it paints thousands of frames; this paints one, of a file on disk, and a pool would be a
  browser launched and thrown away with extra steps. It lives in this package because this
  is the package that owns driving a browser — everything else that wants a screenshot goes
  through here rather than adding playwright to its own dependencies.
*/
import { chromium } from "playwright";
import { DETERMINISM_ARGS } from "./session.ts";

/**
 * Rasterize a local HTML file, whole, and write it as a PNG.
 *
 * Full page rather than viewport: the caller is a document — a contact sheet, a report —
 * and cropping one to a window is how you get a picture of its first screen. Images are
 * awaited through `decode()`, which resolves only when a bitmap is ready to paint, because
 * a screenshot taken before that silently contains blank boxes.
 */
export async function pageShot(
  html: string,
  png: string,
  opts: { width?: number; scale?: number } = {},
): Promise<string> {
  const browser = await chromium.launch({ args: DETERMINISM_ARGS });
  try {
    const page = await browser.newPage({
      viewport: { width: opts.width ?? 1600, height: 1200 },
      deviceScaleFactor: opts.scale ?? 2,
    });
    await page.goto(`file://${html}`, { waitUntil: "load" });
    await page.evaluate(async () => {
      await Promise.all(Array.from(document.images, (i) => i.decode().catch(() => undefined)));
      await document.fonts.ready;
    });
    await page.screenshot({ path: png, fullPage: true });
    return png;
  } finally {
    await browser.close();
  }
}
