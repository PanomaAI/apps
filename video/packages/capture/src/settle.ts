import type { Page } from "playwright";

export type ReadingDestination = {
  origin: string;
  pathname: string;
  search?: string;
  hash?: string;
};

const routePath = (path: string): string => path.length > 1 ? path.replace(/\/+$/, "") : path;

/** A path-only tour observation does not claim a query or fragment it never recorded. */
export function atReadingDestination(url: string, destination: ReadingDestination): boolean {
  try {
    const page = new URL(url);
    return page.origin === destination.origin && routePath(page.pathname) === destination.pathname &&
      (destination.search === undefined || page.search === destination.search) &&
      (destination.hash === undefined || page.hash === destination.hash);
  } catch { return false; }
}

/** Prefer the observed destination (including redirects), then the actual pressed link. */
export function readingDestination(currentUrl: string, observedRoute?: string, href?: string): ReadingDestination | undefined {
  let current: URL;
  try { current = new URL(currentUrl); } catch { return undefined; }
  for (const [value, exact] of [[observedRoute, false], [href, true]] as const) {
    if (!value?.trim()) continue;
    try {
      const target = new URL(value, current);
      if (!/^https?:$/.test(target.protocol) || target.origin !== current.origin) continue;
      const destination: ReadingDestination = { origin: target.origin, pathname: routePath(target.pathname),
        ...(exact || value.split("#")[0].includes("?") ? { search: target.search } : {}),
        ...(exact || value.includes("#") ? { hash: target.hash } : {}),
      };
      if (!atReadingDestination(currentUrl, destination)) return destination;
    } catch { /* An unreadable route cannot authorize a destination claim. */ }
  }
  return undefined;
}

/**
 * Wait for a result to become readable before spending its reading time. Network
 * idleness cannot see a client transition; a perpetual decorative animation is not
 * a reason to keep filming. Only visible content, control positions, busy indicators
 * and finite transitions count, and even an application that never settles is bounded.
 */
export async function waitForReading(page: Page, destination?: ReadingDestination): Promise<"quiet" | "deadline"> {
  const started = Date.now();
  let quietSince = started;
  let previous = "";
  while (Date.now() - started < 2800) {
    const sample = await page.evaluate(() => {
      const visible = (el: Element) => {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth &&
          style.visibility !== "hidden" && style.display !== "none";
      };
      const text: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!node.textContent?.trim() || !node.parentElement || !visible(node.parentElement)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        if (Array.from(range.getClientRects()).some((box) => box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth)) {
          text.push(node.textContent);
        }
      }
      const controls = Array.from(document.querySelectorAll("h1,h2,h3,button,a,input,select,textarea,[role=tab],[role=dialog]"))
        .filter(visible).slice(0, 160).map((el) => {
          const r = el.getBoundingClientRect();
          return [el.tagName, el.getAttribute("aria-label"), el.getAttribute("aria-expanded"), el.getAttribute("aria-pressed"),
            Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
        });
      const busy = Array.from(document.querySelectorAll('[aria-busy="true"],[role="progressbar"]')).some(visible);
      const images = Array.from(document.images).some((img) => visible(img) && !img.complete);
      const moving = document.getAnimations().some((animation) => {
        const timing = animation.effect?.getComputedTiming();
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return animation.playState === "running" && typeof timing?.endTime === "number" &&
          Number.isFinite(timing.endTime) && target instanceof Element && visible(target);
      });
      return { url: location.href, key: JSON.stringify([location.href, text, controls]), busy: busy || moving || images };
    }).catch(() => null);
    const now = Date.now();
    const arrived = sample && (!destination || atReadingDestination(sample.url, destination));
    if (!arrived || sample.busy || sample.key !== previous) quietSince = now;
    if (sample) previous = sample.key;
    if (now - started >= 500 && now - quietSince >= 320) return "quiet";
    await page.waitForTimeout(80);
  }
  return "deadline";
}
