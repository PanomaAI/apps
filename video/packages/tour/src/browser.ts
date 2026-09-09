/*
  The few things the walker asks a page for, behind one thin layer, so the desktop
  walk and the mobile re-walk open a take the same way `recordSession` does and
  read the page the same way as each other. If a take here rendered a different
  layout from the take the recorder shoots, every decision the walker made would
  be about the wrong page — so the context options mirror capture's session.ts
  (viewport, scheme, phone user agent, touch) rather than approximating them.
*/
import { captureBrowserArgs, PHONE_UA, scrollToTarget, type SessionTake } from "@panoma/video-capture";
import { chromium, errors, type Browser, type BrowserContext, type Page } from "playwright";
import { parseSnapshot, stateHash, type SnapshotNode } from "./snapshot.ts";
import { controlState } from "./control-state.ts";
import type { Box } from "./types.ts";

/*
  The same string capture's recorder sends for a mobile take, so the product's
  user-agent-driven branches fire identically under the walker and the camera. It
  is the recorder's own constant, re-exported here for callers that only know the
  tour; a copy would be a divergence waiting to show up as a tour written for a
  layout the take never shows.
*/
export { PHONE_UA };
export { scrollToTarget };

/** Only a successful read on an open browser can establish that a target is absent. */
export async function targetAbsent(page: Page, selector: string): Promise<boolean> {
  if (page.isClosed() || page.context().browser()?.isConnected() === false) return false;
  try {
    const absent = (await page.locator(selector).count()) === 0;
    return absent && !page.isClosed() && page.context().browser()?.isConnected() !== false;
  } catch {
    // An invalid selector or failed transport cannot establish that the target vanished.
    return false;
  }
}

/** A stale observation is recoverable; a live target's timeout or a broken browser is not. */
export async function targetDisappeared(page: Page, selector: string, error: unknown): Promise<boolean> {
  return error instanceof errors.TimeoutError && await targetAbsent(page, selector);
}

/** The browser the walker uses, exposed so a caller without a Playwright dependency of its own can replay a script. */
export const launchBrowser = (): Promise<Browser> => chromium.launch({ args: captureBrowserArgs() });

export async function openTake(
  browser: Browser,
  take: SessionTake,
  colorScheme: "light" | "dark",
): Promise<{ context: BrowserContext; page: Page }> {
  const isMobile = take.isMobile ?? false;
  const context = await browser.newContext({
    viewport: take.viewport,
    deviceScaleFactor: isMobile ? 2 : 1,
    colorScheme,
    ...(isMobile ? { isMobile: true, hasTouch: true, userAgent: PHONE_UA } : {}),
  });
  const page = await context.newPage();
  return { context, page };
}

export type PageSnapshot = {
  text: string;
  nodes: SnapshotNode[];
  hash: string;
  scrollY: number;
  docHeight: number;
  url: string;
};

/** The page as the walker sees it: nodes in document coordinates, plus its state identity. */
export async function snapshotPage(page: Page): Promise<PageSnapshot> {
  const { scrollY, docHeight } = await page.evaluate(() => ({
    scrollY: window.scrollY,
    docHeight: document.documentElement.scrollHeight,
  }));
  const text = await page.ariaSnapshot({ mode: "ai", boxes: true });
  const nodes = parseSnapshot(text, { scrollY });
  return { text, nodes, hash: stateHash(nodes, await controlState(page)), scrollY, docHeight, url: page.url() };
}

/** Scrolls instantly (the camera's easing is the recorder's job) and returns where the page landed. */
export async function scrollDocTo(page: Page, y: number): Promise<number> {
  return page.evaluate((target) => {
    const root = document.documentElement;
    const previous = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    window.scrollTo(0, Math.max(0, target));
    root.style.scrollBehavior = previous;
    return window.scrollY;
  }, y);
}

/** Rejected lesson attempts restore the exact scrollports they approached. */
export async function scrollCheckpoint(page: Page, selector: string): Promise<{ restore(): Promise<number>; dispose(): Promise<void> }> {
  const positions = await page.locator(selector).first().evaluateHandle((target) => {
    const entries = [];
    for (let el: Element | null = target; el; el = el.parentElement ?? (el.getRootNode() instanceof ShadowRoot ? (el.getRootNode() as ShadowRoot).host : null)) {
      entries.push({ el, x: el.scrollLeft, y: el.scrollTop });
    }
    return entries;
  });
  return {
    restore: () => positions.evaluate((entries) => {
      for (const { el, x, y } of entries) {
        if (!el.isConnected) continue;
        const style = (el as HTMLElement).style;
        const value = style.getPropertyValue("scroll-behavior"), priority = style.getPropertyPriority("scroll-behavior");
        style.setProperty("scroll-behavior", "auto", "important");
        el.scrollTo(x, y);
        if (value) style.setProperty("scroll-behavior", value, priority);
        else style.removeProperty("scroll-behavior");
      }
      return window.scrollY;
    }),
    dispose: () => positions.dispose(),
  };
}

/*
  The viewport box of a selector's first match, or null when it matches nothing
  visible — the same call `recordSession` makes before a clickOn/scrollTo, so
  "present" here means "the recorder will find it".
*/
export async function boxOf(page: Page, selector: string, timeout = 1500): Promise<Box | null> {
  const box = await page
    .locator(selector)
    .first()
    .boundingBox({ timeout })
    .catch(() => null);
  return box && box.width > 0 && box.height > 0 ? { x: box.x, y: box.y, w: box.width, h: box.height } : null;
}

/** Lets a click or a navigation finish without turning a quiet page into a timeout. */
export async function settle(page: Page, ms = 300): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
}

/*
  The page once it has stopped changing, and not one state earlier.

  `settle` waits for the network, which answers the wrong question after a press that
  routes on the client: nothing is in flight, so it returns at once. Sampling until two
  samples agree is better and still not enough — a press can produce a real intermediate
  state that holds still for a moment before the navigation it started arrives. Measured
  on this disk: a catalogue tile marks itself selected, sits there for a fifth of a
  second, and only then routes to the project page; a reading that stopped at the first
  agreement recorded "the catalogue with a tile selected" as the screen behind the tile,
  and the lesson planned on it was then stranded on the catalogue.

  So: a beat before the first sample, and three agreeing samples rather than two. A page
  that really is still costs about a second; one that is still moving is waited for.
*/
export async function settled(
  page: Page,
  opts: { tries?: number; gapMs?: number; firstMs?: number; agree?: number } = {},
): Promise<PageSnapshot> {
  const { tries = 12, gapMs = 250, firstMs = 400, agree = 3 } = opts;
  await settle(page, firstMs);
  let last = await snapshotPage(page);
  let same = 1;
  for (let i = 1; i < tries; i++) {
    await page.waitForTimeout(gapMs);
    const now = await snapshotPage(page);
    same = now.hash === last.hash && now.url === last.url ? same + 1 : 1;
    last = now;
    if (same >= agree) return now;
  }
  return last;
}

/** Same page, ignoring the fragment and a trailing slash. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    let s = u.toString();
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) s = s.replace(/\/(\?.*)?$/, "$1");
    return s;
  } catch {
    return url;
  }
}
