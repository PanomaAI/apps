/*
  Screenshots instead of screen recordings, on purpose. A recording carries the author's
  cursor, theme and timing and can never be repeated; a deterministic 2x PNG is retaken
  identically with one command, and the motion (push, sweep, parallax) is Remotion's job
  on top of the still. Learned on the panoma launch video, where it also dodged a second
  trap: hidden browser tabs don't fire requestAnimationFrame, so headless-panel captures
  silently miss anything animated. Playwright opens a truly visible page.
*/
import { chromium, type Page } from "playwright";

export type ShootTarget = {
  name: string;
  url: string;
  /** Runs after load — scroll, hover, click — before the picture is taken. */
  prepare?: (page: Page) => Promise<void>;
  /** Clip to a region instead of the full viewport. */
  clip?: { x: number; y: number; width: number; height: number };
};

export type ShootOptions = {
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number;
  colorScheme?: "light" | "dark";
  cookies?: { name: string; value: string; domain: string; path: string }[];
  /** Extra settle time after network idle, for fonts and entrance animations. */
  settleMs?: number;
};

export async function shoot(targets: ShootTarget[], outDir: string, opts: ShootOptions = {}): Promise<string[]> {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 1440, height: 900 },
    deviceScaleFactor: opts.deviceScaleFactor ?? 2,
    colorScheme: opts.colorScheme ?? "dark",
  });
  if (opts.cookies?.length) await context.addCookies(opts.cookies);

  const written: string[] = [];
  try {
    const page = await context.newPage();
    for (const t of targets) {
      await page.goto(t.url, { waitUntil: "networkidle" });
      await page.waitForTimeout(opts.settleMs ?? 400);
      if (t.prepare) await t.prepare(page);
      const path = `${outDir}/${t.name}.png`;
      await page.screenshot({ path, clip: t.clip });
      written.push(path);
    }
  } finally {
    await browser.close();
  }
  return written;
}
