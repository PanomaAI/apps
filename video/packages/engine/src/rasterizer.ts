/*
  Determinism by construction: the page runs no animation, no timers and no rAF —
  every frame is a fresh <body> whose styles were computed in Node. The two async
  hazards a screenshot can race are fonts and images; fonts are awaited once when the
  shell loads, and images are awaited per frame via decode(), which resolves only
  when the bitmap is ready to paint. A hidden-tab throttling trap (learned on the
  launch video) does not exist here because nothing in the page ever waits for a
  frame callback.
*/
import { chromium, type Browser, type Page } from "playwright";

/*
  Determinism is a triple: this Playwright, its Chromium, the bundled fonts. Three
  launch flags remove what the HOST would otherwise add to that: font hinting and
  subpixel (LCD) text follow the machine's display settings, and the colour profile
  follows its monitor. With them off, two machines with the same triple paint the
  same pixels; without them, they do not, and nothing says why. (Cross-OS frames
  still differ in ways Playwright documents — compare perceptually, never byte-wise.)
*/
export const DETERMINISM_ARGS = [
  "--font-render-hinting=none",
  "--disable-lcd-text",
  "--force-color-profile=srgb",
  /* One rasterizer for every machine: ANGLE on SwiftShader, never the host's GPU. */
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--disable-gpu",
];

export type LintFinding =
  | { kind: "overflow"; path: string; by: { x: number; y: number } }
  | { kind: "outside"; path: string; text: string; rect: { x: number; y: number; w: number; h: number } }
  | { kind: "collapsed"; path: string; text: string };

/*
  How long one frame may take to come out of Chromium, and why the answer is not a number.

  Nobody chose thirty seconds, which is what it was: Playwright's default, inherited in
  silence, and plenty on the machine this engine was written on. The first CI run to render
  anything showed what it costs elsewhere — `page.screenshot` timed out at exactly 30,000 ms
  and a whole cut was lost. It was raised to two minutes. Two minutes was then exceeded too,
  on Windows, on one of two Node versions, while the other passed.

  That last detail is the one that matters: a fixed wall-clock ceiling was measuring the
  wrong thing. Frames do not render alone. The pool rasterises `availableParallelism()` of
  them at once, capped at six, and on a four-core runner with no GPU that is four full-HD
  pages competing for the same software rasteriser. A frame that would take thirty seconds
  by itself honestly takes two minutes with three siblings — nothing is wrong, it is
  waiting its turn.

  So the ceiling is per frame times however many share the machine. A page that hangs still
  trips it; a page that is merely queued behind its own pool no longer does. On this laptop
  the base alone is a hundredfold what a frame costs, so it is invisible where it always was.
*/
const FRAME_BASE_MS = 90_000;

export class RasterPool {
  private pages: Page[] = [];
  private free: Page[] = [];
  private waiters: { resolve: (page: Page) => void; reject: (error: Error) => void }[] = [];
  private browser: Browser;
  /*
    What Playwright will not say on its own.

    "Target page, context or browser has been closed" is one sentence for three very
    different events, and it names the one Playwright noticed rather than the one that
    happened. The pool closes nothing while a frame is in flight, so when CI reported
    that message mid-render the only reading left was that Chromium went away by
    itself — and the message could not say which part of it, or why.

    So the pool listens for both ways that happens and keeps the first reason it hears:
    `browser.on("disconnected")` for the browser process ending, `page.on("crash")` for
    a single renderer being killed (which is how Chromium answers memory pressure).
    Every frame error then carries that reason. The next run says either "the browser
    process ended" or "a page crashed", and those two ask for different fixes.
  */
  private lost: string | null = null;
  /** Frames being painted right now — reported with `lost`, because it is the load that caused it. */
  private inFlight = 0;
  /** Our own close(), so an expected disconnect is not reported as a crash. */
  private closing = false;
  readonly width: number;
  readonly height: number;

  private constructor(browser: Browser, width: number, height: number) {
    this.browser = browser;
    this.width = width;
    this.height = height;
  }

  static async start(opts: {
    origin: string;
    width: number;
    height: number;
    parallel: number;
  }): Promise<RasterPool> {
    const browser = await chromium.launch({ args: DETERMINISM_ARGS });
    const pool = new RasterPool(browser, opts.width, opts.height);
    browser.on("disconnected", () => pool.lose("the browser process ended"));
    try {
      await Promise.all(
        Array.from({ length: opts.parallel }, async () => {
          const page = await browser.newPage({
            viewport: { width: opts.width, height: opts.height },
            deviceScaleFactor: 1,
          });
          page.on("crash", () => pool.lose("a page crashed, which is how Chromium sheds memory"));
          await page.goto(`${opts.origin}/__shell__?w=${opts.width}&h=${opts.height}`);
          await page.evaluate(async () => {
            await Promise.all([
              document.fonts.load('900 100px "Geist"', "AaÑñ47"),
              document.fonts.load('400 100px "Geist Mono"', "AaÑñ47"),
              document.fonts.load('900 100px "Fraunces"', "AaÑñ47"),
              document.fonts.load('900 100px "Anybody"', "AaÑñ47"),
            ]);
            await document.fonts.ready;
          });
          pool.pages.push(page);
          pool.free.push(page);
        }),
      );
    } catch (error) {
      /* One page that fails to open used to leak the whole browser: nobody held a
         reference to close it. On Windows that also leaks its profile directory,
         whose open handles then defeat any rm of the temp tree around it. */
      await browser.close().catch(() => undefined);
      throw error;
    }
    return pool;
  }

  /** Record the first reason Chromium went away, and stop anybody waiting for a page it will never get. */
  private lose(reason: string): void {
    if (this.closing) return;
    this.lost ??= reason;
    for (const waiter of this.waiters.splice(0)) waiter.reject(new Error(`No page to paint on: ${this.lost}.`));
  }

  private acquire(): Promise<Page> {
    if (this.lost) return Promise.reject(new Error(`No page to paint on: ${this.lost}.`));
    const page = this.free.pop();
    if (page) return Promise.resolve(page);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private release(page: Page): void {
    /* A page from a browser that has gone is not worth handing on: whoever received it
       would only rediscover the same death one screenshot later. */
    if (this.lost) {
      for (const waiter of this.waiters.splice(0)) waiter.reject(new Error(`No page to paint on: ${this.lost}.`));
      this.free.push(page);
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(page);
    else this.free.push(page);
  }

  /** Say what happened to Chromium, when it is the pool and not the frame that failed. */
  private frameError(error: unknown): Error {
    const cause = error instanceof Error ? error : new Error(String(error));
    if (!this.lost) return cause;
    /* One line: the report that reads this keeps only the first (see the render stage). */
    return new Error(`${cause.message.split("\n")[0].trim()} — ${this.lost}; frames in flight: ${this.inFlight}`, { cause });
  }

  /** The ceiling for one frame: its own budget, times the number of frames sharing the machine. */
  private frameTimeout(): number {
    return FRAME_BASE_MS * Math.max(1, this.pages.length);
  }

  /** Paint one frame's HTML and return its PNG (or a JPEG, for anything a model will look at). */
  async rasterize(bodyHtml: string, opts: { type?: "png" | "jpeg"; quality?: number } = {}): Promise<Buffer> {
    const page = await this.acquire();
    this.inFlight++;
    try {
      await this.paint(page, bodyHtml);
      return opts.type === "jpeg"
        ? await page.screenshot({ type: "jpeg", quality: opts.quality ?? 72, timeout: this.frameTimeout() })
        : await page.screenshot({ type: "png", timeout: this.frameTimeout() });
    } catch (error) {
      throw this.frameError(error);
    } finally {
      this.inFlight--;
      this.release(page);
    }
  }

  /*
    What a frame cannot show, measured in the DOM instead of guessed from pixels.

    Three failures are invisible in a still and obvious to a viewer: a caption whose
    third word was clipped by its own box, a title whose line box crosses into the
    strip the platform paints over, and text that laid out at zero size. None of
    them throws. Playwright has no clipped-text assertion (issue #10686), so this is
    the check: scrollWidth against clientWidth for anything that clips, every text
    node's line rects against the stage, and zero-sized rects for text that exists.
    Anything under a `data-lint="ignore"` ancestor is exempt — window chrome sits
    outside the stage on purpose.
  */
  async lint(bodyHtml: string, stage: { x: number; y: number; width: number; height: number }): Promise<LintFinding[]> {
    const page = await this.acquire();
    this.inFlight++;
    try {
      await this.paint(page, bodyHtml);
      return await page.evaluate((stage) => {
        const out: LintFinding[] = [];
        const pathOf = (el: Element): string => {
          const parts: string[] = [];
          let e: Element | null = el;
          while (e && e !== document.body && parts.length < 6) {
            const name = (e as HTMLElement).dataset?.name;
            parts.unshift(e.tagName.toLowerCase() + (e.id ? `#${e.id}` : "") + (name ? `[${name}]` : ""));
            e = e.parentElement;
          }
          return parts.join(" > ");
        };
        const ignored = (el: Element | null) => !!el?.closest('[data-lint="ignore"]');
        for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
          if (ignored(el)) continue;
          const cs = getComputedStyle(el);
          const clips = [cs.overflow, cs.overflowX, cs.overflowY].some((v) => v && v !== "visible");
          if (!clips) continue;
          const byX = el.scrollWidth - el.clientWidth;
          const byY = el.scrollHeight - el.clientHeight;
          if (byX > 1 || byY > 1) out.push({ kind: "overflow", path: pathOf(el), by: { x: Math.max(0, byX), y: Math.max(0, byY) } });
        }
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const text = (node as Text).data.trim();
          if (!text) continue;
          const el = node.parentElement;
          if (!el || ignored(el)) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
          /* Words held invisible on purpose (a hook revealing itself) are not laid out yet. */
          const alpha = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+))?\s*\)/.exec(cs.color);
          if (alpha && alpha[1] !== undefined && Number(alpha[1]) === 0) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const rects = Array.from(range.getClientRects());
          if (rects.length === 0 || rects.every((r) => r.width === 0 || r.height === 0)) {
            out.push({ kind: "collapsed", path: pathOf(el), text: text.slice(0, 40) });
            continue;
          }
          for (const r of rects) {
            if (r.width === 0 || r.height === 0) continue;
            const off =
              r.left < stage.x - 1 || r.top < stage.y - 1 || r.right > stage.x + stage.width + 1 || r.bottom > stage.y + stage.height + 1;
            if (off) out.push({ kind: "outside", path: pathOf(el), text: text.slice(0, 40), rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
          }
        }
        return out;
      }, stage);
    } catch (error) {
      throw this.frameError(error);
    } finally {
      this.inFlight--;
      this.release(page);
    }
  }

  private async paint(page: Page, bodyHtml: string): Promise<void> {
    {
      await page.evaluate(async (html) => {
        /*
          Video material: scenes mark a slot with data-video + data-seek, and the page
          keeps ONE persistent <video> per source in a hidden pool that survives the
          innerHTML swap — recreating the element every frame would re-open the file
          and re-decode from zero, hundreds of times per render. Painting the held
          frame into each slot's <canvas> keeps the DOM the scene authored.
        */
        type Pool = Map<string, HTMLVideoElement>;
        const w = window as unknown as { __videoPool?: Pool };
        const pool: Pool = (w.__videoPool ??= new Map());

        document.body.innerHTML = html;

        /*
          Slots are grouped by source and served one seek at a time. Seeking the
          same element in parallel is a race with no error: two pending seeks
          share one 'seeked' listener, so a slot can draw a frame that belongs to
          its neighbour. It costs nothing today, when a scene shows one recording
          once, and it is the precondition for showing the same take twice at two
          different instants — a split screen, or a frozen click beside the live
          moment a second later.
        */
        const slots = Array.from(document.querySelectorAll<HTMLCanvasElement>("canvas[data-video]"));
        const bySource = new Map<string, HTMLCanvasElement[]>();
        for (const slot of slots) {
          const src = slot.dataset.video!;
          const group = bySource.get(src);
          if (group) group.push(slot);
          else bySource.set(src, [slot]);
        }

        await Promise.all(
          Array.from(bySource, async ([src, group]) => {
            let video = pool.get(src);
            if (!video) {
              video = document.createElement("video");
              video.muted = true;
              video.preload = "auto";
              video.src = src;
              pool.set(src, video);
              await new Promise<void>((resolve, reject) => {
                video!.addEventListener("loadeddata", () => resolve(), { once: true });
                video!.addEventListener("error", () => reject(new Error(`video failed: ${src}`)), { once: true });
              });
            }
            /* Ascending order so the decoder walks forward, which it is built for. */
            const ordered = [...group].sort((a, b) => Number(a.dataset.seek ?? 0) - Number(b.dataset.seek ?? 0));
            for (const slot of ordered) {
              const seek = Number(slot.dataset.seek ?? 0);
              if (Math.abs(video.currentTime - seek) > 1 / 240) {
                await new Promise<void>((resolve) => {
                  video!.addEventListener("seeked", () => resolve(), { once: true });
                  video!.currentTime = seek;
                });
              }
              slot.width = video.videoWidth;
              slot.height = video.videoHeight;
              slot.getContext("2d")!.drawImage(video, 0, 0);
            }
          }),
        );
        await Promise.all(Array.from(document.images, (img) => img.decode().catch(() => undefined)));
      }, bodyHtml);
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    /* A caller that closes the pool while frames are queued (Promise.all rejecting on
       the first failure does exactly that) must not leave those waiters pending for
       ever — they would be the render that never returns and never says why. */
    for (const waiter of this.waiters.splice(0)) waiter.reject(new Error("The rasterizer was closed while this frame waited for a page."));
    await this.browser.close();
  }
}
