/*
  A recording session is a typed script, not a performance. Screen Studio's whole
  category records one human take and bakes the cursor into the pixels; here the
  browser is driven by code, the video captures ONLY the page, and every input lands
  in a JSON log as data. The renderer draws its own cursor — eased by the engine's
  spring, not by a shaky hand — and when the product's UI changes, the same script
  re-records the take identically for free.

  ONE SCRIPT, SEVERAL TAKES — the deep answer to vertical video. Every tool in the
  field shoots a desktop app once and then crops it into a phone-shaped hole, which
  is why their vertical output is a stamp in the middle of an empty canvas. But
  software already has a portrait design: its mobile layout. So a session records
  the same tour twice — a desktop take for 16:9 and 1:1, a mobile take (narrow
  viewport, touch, phone user agent, so the product's own breakpoints fire) for
  9:16 — and the renderer picks the take that fits the canvas. The material is
  responsive, not just the layout on top of it.

  The mouse still MOVES during recording (hover states must be real), but the
  authored path is semantic: the log stores intents and timestamps, and how the
  cursor travels between them is the renderer's decision.
*/
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { chromium, type CDPSession, type Locator, type Page } from "playwright";
import { readingDestination, waitForReading, type ReadingDestination } from "./settle.ts";
import { scrollAtPointer, scrollToTarget, targetGeometry } from "./scroll.ts";
import { actionDenySelectors, assertActionAllowed, deniedSelector } from "./action-policy.ts";
import { captureBrowserArgs } from "./browser.ts";
import { createVideoClock, type VideoClock } from "./clock.ts";

const run = promisify(execFile);

/** The recorded frame rate, read from the file rather than assumed. */
async function probeFps(path: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=r_frame_rate",
    "-of", "default=nw=1:nk=1",
    path,
  ]);
  const [num, den] = stdout.trim().split("/").map(Number);
  const fps = den ? num / den : num;
  return Number.isFinite(fps) && fps > 0 ? fps : 25;
}

/*
  Video pixels per CSS pixel of the viewport, read from the file rather than assumed.

  The take is asked for `CAPTURE_DENSITY` and this says what it got. It is written down
  because the claim that mattered most to the tutorial camera — "the recording is a 1x
  asset" — was true for a year and recorded nowhere a renderer could read it, and because
  the first attempt at 2x produced a padded 1x that a constant would have vouched for. A
  value here is a measurement, and a measurement is what a ceiling wants.
*/
async function probeVideoRatio(path: string, viewport: { width: number }): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width",
    "-of", "default=nw=1:nk=1",
    path,
  ]);
  const width = Number(stdout.trim());
  const ratio = width / viewport.width;
  return Number.isFinite(ratio) && ratio > 0 ? Math.round(ratio * 1000) / 1000 : 1;
}

/*
  What a step is FOR. A consent banner, a cookie dismissal, a login — the viewer
  came for none of it, and an edit that treats every click alike spends its hardest
  push magnifying a Reject button for two seconds. Undefined means "product", so
  every script written before this keeps working.
*/
export type StepRole = "product" | "chrome";

export type SessionStep =
  | { goto: string; settleMs?: number }
  | { move: { x: number; y: number; ms?: number } }
  | { click: { x: number; y: number }; role?: StepRole }
  /*
    Click an element by Playwright selector — real coordinates land in the log.

    `href` is the destination the control led to when the script was written, and it
    is there for the take that renders the same control WITHOUT a name. A phone's
    navigation is a row of icons: the link to /bridge is still a link to /bridge, and
    it still goes to the same place, but it has no accessible name to be found by, so
    a selector built from the desktop's name matches nothing and the step is skipped.
    The picture then never moves while the narrator gives an instruction. Where the
    name fails and the destination is the same, the destination is the identity.
  */
  | { clickOn: string; optional?: boolean; role?: StepRole; href?: string; alternate?: string }
  | { type: { text: string; delayMs?: number }; role?: StepRole }
  | { press: { key: string }; role?: StepRole }
  | { scroll: { y: number; ms?: number }; role?: StepRole }
  /*
    Scroll until a named thing is on screen.

    A pixel scroll means different content in different layouts, and that is not a
    detail: the desktop and mobile takes of one session are the SAME tour of the same
    product, so "scroll 900" lands on the pitch in one and three sections past it in
    the other. A tutorial then narrates the front door over a screen showing something
    else — the mark is in the right place and the page is not. Naming the destination
    makes both takes land on the same content, which is what let the two step lists
    become one.
  */
  | { scrollTo: string; ms?: number; at?: number; optional?: boolean; back?: true; role?: StepRole }
  /** Reading time starts after a bounded check of the visible result when settled is true. */
  | { pause: number; settled?: true }
  /*
    A named instant in the take, and the only step that touches nothing.

    A tutorial pins a spoken sentence to a moment in the recording, and a moment
    cannot be a timestamp: the product changes, the take is re-shot, and every
    number in the script is wrong without a single error. A mark is the anchor
    that survives that — `{ mark: "copy" }` before the click means "here is where
    the copy step begins", and re-recording moves it wherever it now belongs.
  */
  | { mark: string };

export type SessionEvent =
  | { t: number; kind: "move"; x: number; y: number }
  | { t: number; kind: "click"; x: number; y: number; role?: StepRole }
  | { t: number; kind: "key"; text: string; role?: StepRole }
  | { t: number; kind: "scroll"; y: number; x?: number; durationMs?: number; role?: StepRole }
  | { t: number; kind: "mark"; name: string };

export type ElementHint = {
  /** A selector for the thing the mark names, when the tour knows one. */
  selector?: string;
  /** Last measured viewport box. Used as a point hint when the selector changed. */
  box?: { x: number; y: number; w: number; h: number };
  label?: string;
  kind?: string;
};

/** An exact UI fragment saved beside a take, ready to become motion-design material. */
export type ElementAsset = {
  id: string;
  mark: string;
  t: number;
  file: string;
  url: string;
  viewport: { width: number; height: number };
  /** CSS-pixel crop in the recorded viewport; the PNG itself may be supersampled. */
  box: { x: number; y: number; width: number; height: number };
  target?: { x: number; y: number; width: number; height: number };
  selector?: string;
  tag?: string;
  role?: string;
  name?: string;
  text?: string;
  kind?: string;
};

/** A lossless full viewport at a semantic mark, used when video would soften UI. */
export type FrameAsset = {
  id: string;
  mark: string;
  t: number;
  file: string;
  url: string;
  viewport: { width: number; height: number };
  /** Screenshot pixels per CSS pixel. Renderers can refuse to enlarge past this. */
  pixelRatio: number;
};

/** A rectangle in CSS pixels of the recorded viewport. */
export type CssBox = { x: number; y: number; width: number; height: number };

/*
  A control rendered by the page at several device pixels per CSS pixel: material
  for a macro shot. The reference product films fill half the frame with one
  button, and a 2x crop of a 30-pixel control is a stamp when drawn that large.
  This clip is rasterized by Chromium itself (CDP `Page.captureScreenshot` with a
  clip scale), so it is the product's own pixels at whatever density the shot
  needs — never an upscale. `pixelRatio` is the ceiling: a renderer may draw the
  file `box.width × pixelRatio` canvas pixels wide and no wider.
*/
export type MacroAsset = {
  id: string;
  mark: string;
  t: number;
  file: string;
  url: string;
  viewport: { width: number; height: number };
  /** The crop: the control with enough of its component around it to read as one. */
  box: CssBox;
  /** The control itself, when the mark had one. */
  target?: CssBox;
  pixelRatio: number;
  /*
    When the control was photographed. "mark" is the moment the mark names; "press" is the
    instant before the click, for a control the mark could not see — the tour writes the
    mark before the scroll that brings a below-the-fold control into view, so at the mark
    the control is off-screen and nothing honest can be captured there. `box` and `target`
    are then the control's place on the scrolled page, which is where the press happens,
    and a consumer that draws the clip over the footage must know that the picture is only
    true from the press on. Absent on takes before capture version 11, which means "mark".
  */
  at?: "mark" | "press";
  /** The camera clock when a product press became quiet, before its reading dwell. Absent after a deadline or on older takes. */
  resultAtMs?: number;
  /** Exact heading verified on the after-frame, including viewport, clipping and center occlusion. Legacy focus alone is not evidence. */
  resultHeading?: { text: string; box: CssBox; visibleShare: number; centerVisible: true };
  /*
    What the action after this mark changed, measured on the next frame (the next
    mark's, or the take's last): the bounding box of the pixels that differ, the
    share of the viewport those pixels are, and the share the box is. A menu
    opening changes a corner; a scroll or a navigation changes most of the
    viewport, and a recipe reads the difference as "a component moved" against
    "the page changed". Absent when nothing changed.
  */
  change?: { box: CssBox; share: number; boxShare: number };
  /*
    The same neighbourhood after the action, rendered at its own ratio, when the
    change stayed local: the crop grown to hold everything that changed. A change
    that took most of the viewport has no local after — the next frame is the
    after-state.
  */
  after?: { file: string; box: CssBox; pixelRatio: number };
  /*
    The control itself after its action, re-rendered in the same box at the next
    mark: the toggle now filled, the navigation row now highlighted. It is what
    makes a press visibly do something to the thing under the pointer, whatever
    the rest of the page did. Absent when the take has no frame after this mark.
  */
  afterControl?: { file: string; pixelRatio: number };
  /*
    Where the heading the action produced sits on the next frame, when the tour
    named one and the page showed it: the place a camera lands to show cause and
    effect in one frame. Measured, never scrolled to.
  */
  focus?: CssBox;
};

export type SessionLog = {
  name: string;
  /** Which take this is: "desktop", "mobile", or whatever the script named it. */
  take: string;
  /** ISO timestamp of the recording. */
  recordedAt: string;
  /*
    The commit the product was at when this take was shot, when the caller knows it.
    A take is a photograph of one revision: rendering it after the product changed
    is the "stale screenshot" every demo tool rots into, and the only way to say so
    is to have written the revision down here.
  */
  head?: string;
  /** The UI locale the product was asked for (Accept-Language), when one was set. */
  locale?: string;
  /** True when the product was rendering its portrait layout. */
  isMobile: boolean;
  url: string;
  viewport: { width: number; height: number };
  video: string;
  /** Times below are already relative to this measured video origin. Never apply its offset again. */
  videoClock?: VideoClock;
  durationMs: number;
  /*
    Milliseconds of dead head. Recording starts before the first navigation, which is
    before `goto` has even been called, so every take opens on a blank white page
    for as long as the product takes to load. The renderer seeks past this instead
    of opening a launch video on an empty screen.
  */
  readyMs: number;
  /*
    The take's own frame rate, measured rather than assumed. Playwright records at
    25 fps and does not expose the setting; a 30 fps timeline seeking into it draws
    the same source frame twice every sixth frame, which judders even when the
    motion inside the take is perfect. The cast conforms the take to the timeline
    with this number — see castSpeed in the render app.
  */
  fps: number;
  /*
    Video pixels per CSS pixel of the viewport, measured from the file: 2 since capture
    version 10, and written down so that a renderer's ceiling is a measurement rather than
    a belief. Absent on older takes, which were recorded at the CSS size and are 1x.
  */
  videoRatio?: number;
  /*
    The named instants, in the order they happened. Duplicated from `events` on

    purpose: this is the index a tutorial reads, and an index that has to be
    recovered by filtering is one an author cannot see in the file.
  */
  marks: { name: string; t: number }[];
  /** Exact component captures made at marks. Older takes may omit this. */
  elements?: ElementAsset[];
  /** Lossless full-viewport captures made at marks. Older takes may omit this. */
  frames?: FrameAsset[];
  /** The control at every mark at several pixels per CSS pixel, with what its action changed. Older takes may omit this. */
  macros?: MacroAsset[];
  /** The viewport when the take ended: the after-state of the last mark. Older takes may omit this. */
  last?: FrameAsset;
  events: SessionEvent[];
};

/**
 * One camera on the product. `isMobile` sends a phone user agent and touch support
 * along with the narrow viewport, because a viewport alone leaves user-agent-driven
 * layouts on their desktop branch.
 */
export type SessionTake = {
  id: string;
  viewport: { width: number; height: number };
  isMobile?: boolean;
  /** Steps for this take only; falls back to the script's shared steps. */
  steps?: SessionStep[];
};

/*
  EVERY TAKE SHARES THE ASPECT OF THE CANVAS IT SERVES. This is what turns a small
  window into a full frame: 720x1280 is exactly 9:16 and 1920x1080 exactly 16:9, so
  the render fits the material edge to edge instead of letterboxing it and calling
  the leftovers design. 720 is also below every mobile breakpoint (768px), so the
  product renders its portrait layout; deviceScaleFactor 2 makes the capture a
  supersampled 720x1280, which survives being drawn ~980px wide.
*/
export const TAKE_MOBILE = "mobile";
export const TAKE_DESKTOP = "desktop";

export const MOBILE_TAKE: SessionTake = { id: TAKE_MOBILE, viewport: { width: 720, height: 1280 }, isMobile: true };
export const DESKTOP_TAKE: SessionTake = { id: TAKE_DESKTOP, viewport: { width: 1920, height: 1080 } };

/*
  The same flags the rasterizer launches with, so a take and the frames drawn around
  it disagree about nothing: no font hinting, no subpixel text, sRGB. Chromium's
  defaults for these follow the host, and a take recorded on one machine would then
  differ from the render made on another for reasons nobody can see.
*/
export const DETERMINISM_ARGS = ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb"];

/**
 * Included in automatic recording keys so a better visual capture refreshes old takes.
 *
 * 9 is not a better capture; it is a repair, twice over. A take shot at 7 or below
 * carries the recorder's own screenshot surface in its footage, and one shot at 8 carries
 * macro crops of the wrong part of the page. Neither survives a re-render.
 *
 * 10 IS a better capture: the video is recorded at the device pixels (`CAPTURE_DENSITY`,
 * through a real scale factor at launch), which doubles how far the tutorial camera may
 * push before it is drawing an upscale.
 *
 * 11 captures the control at the press when the mark could not see it. A tour writes the
 * mark before the scroll to a control below the fold, so at the mark the control was
 * off-screen and the take carried no clip of it at all — three of the panoma tutorial's
 * five steps had no push, no lift and no result for that reason. The clip is now taken the
 * instant before the click, under the mark's name, with `at: "press"`.
 */
export const ELEMENT_CAPTURE_VERSION = 18;

/* The camera pass has no macro assets. Keep its result clock until recordTake joins
   the capture pass's pictures to it; capture-pass milliseconds never describe video. */
const settledAtForSession = new WeakMap<SessionLog, Map<string, number>>();

/*
  Device pixels per CSS pixel for everything the take writes: the stills, the macro clips
  (which multiply it further, up to `MACRO_MAX_RATIO`) and, since version 10, the video.
*/
export const CAPTURE_DENSITY = 2;

/*
  How much of a control must be in the viewport for it to count as on screen: at the mark,
  where it decides whether the control is photographed now or at the press, and at the press
  itself. Any overlap used to do, and a control straddling the fold was then cropped by
  `macroBox` into a strip of whatever sat at the edge — the walker scrolls to anything not
  FULLY visible (packages/tour/src/walk.ts), so the two disagreed exactly there. Nine tenths
  rather than all of it, because a control wider than a phone's viewport is still that
  control.
*/
export const SHOWN_LEAST = 0.9;
export function shownShare(box: { x: number; y: number; width: number; height: number }, viewport: { width: number; height: number }): number {
  const w = Math.max(0, Math.min(box.x + box.width, viewport.width) - Math.max(box.x, 0));
  const h = Math.max(0, Math.min(box.y + box.height, viewport.height) - Math.max(box.y, 0));
  const area = box.width * box.height;
  return area > 0 ? (w * h) / area : 0;
}

/*
  The macro shot's geometry, in one place so a test can check it without a browser.

  A crop narrower than MACRO_MIN reads as a pixel, not a component: a 30 px chevron
  is shown with the split button it belongs to, a sidebar link with its neighbours.
  The long edge is rendered at about MACRO_LONG_EDGE device pixels — more than any
  canvas this engine draws, so the file is never enlarged on the way to a frame —
  and Chromium's clip scale is capped at MACRO_MAX_RATIO.
*/
export const MACRO_MIN = { width: 220, height: 120 };
export const MACRO_LONG_EDGE = 2000;
export const MACRO_MAX_RATIO = 8;
/* A bar-shaped component up to this wide is shown whole: a split button's label lives at the other end from its chevron. */
export const MACRO_BAR_MAX_WIDTH = 640;
/* Past this share of the viewport a change is the page, not a component. */
export const LOCAL_CHANGE_MAX = 0.45;
/* Pixels that differ by more than this (0-255, largest channel) count as changed, measured on a quarter-size drawing. */
const CHANGE_THRESHOLD = 24;
const CHANGE_SAMPLE = 4;

const clampBox = (box: CssBox, within: CssBox): CssBox => {
  const x = Math.max(within.x, box.x);
  const y = Math.max(within.y, box.y);
  const right = Math.min(within.x + within.width, box.x + box.width);
  const bottom = Math.min(within.y + within.height, box.y + box.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
};

const unionBox = (a: CssBox, b: CssBox): CssBox => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};

/** Whole pixels, grown outward: a clip on a fractional edge leaves a seam. */
const roundBox = (b: CssBox): CssBox => {
  const x = Math.floor(b.x);
  const y = Math.floor(b.y);
  return { x, y, width: Math.ceil(b.x + b.width) - x, height: Math.ceil(b.y + b.height) - y };
};

/*
  A box moved inside a container, and shrunk only when the container is smaller.
  Clamping alone trims whatever hangs over an edge, which turns a minimum-size crop
  of a control near the edge of its component into a sliver; sliding it keeps the
  size and shows the component's other side instead.
*/
const fitInside = (box: CssBox, within: CssBox): CssBox => {
  const width = Math.min(box.width, within.width);
  const height = Math.min(box.height, within.height);
  const x = Math.min(Math.max(box.x, within.x), within.x + within.width - width);
  const y = Math.min(Math.max(box.y, within.y), within.y + within.height - height);
  return { x, y, width, height };
};

/**
 * The crop a macro shot takes: the control padded by half its height, widened to
 * MACRO_MIN around its centre, kept inside the component the element capture chose
 * (a link is shown with its navigation, not with the page beside it) and inside the
 * viewport. A component smaller than the minimum is the crop — a split button is
 * shown whole, never a stamp of its chevron. Without a control, the component.
 */
export function macroBox(target: CssBox | undefined, element: CssBox | undefined, viewport: { width: number; height: number }): CssBox | null {
  const base = target ?? element;
  if (!base) return null;
  const pad = Math.max(10, base.height * 0.5);
  let box: CssBox = { x: base.x - pad, y: base.y - pad, width: base.width + pad * 2, height: base.height + pad * 2 };
  const cx = base.x + base.width / 2;
  const cy = base.y + base.height / 2;
  if (box.width < MACRO_MIN.width) box = { ...box, x: cx - MACRO_MIN.width / 2, width: MACRO_MIN.width };
  if (box.height < MACRO_MIN.height) box = { ...box, y: cy - MACRO_MIN.height / 2, height: MACRO_MIN.height };
  if (target && element) {
    /* A bar is shown whole: on a phone the "Open in Claude" label sits at the far end of the row its chevron is on. */
    if (element.height <= MACRO_MIN.height && element.width <= MACRO_BAR_MAX_WIDTH) box = { ...box, x: element.x, width: element.width };
    /* Never tighter than the control with a hair of room: a component that crops its own control is no context. */
    const room = 6;
    const floor: CssBox = { x: target.x - room, y: target.y - room, width: target.width + room * 2, height: target.height + room * 2 };
    box = fitInside(box, unionBox(element, floor));
  }
  const out = roundBox(fitInside(box, { x: 0, y: 0, ...viewport }));
  return out.width >= 8 && out.height >= 8 ? out : null;
}

/** Device pixels per CSS pixel a clip is rendered at: its long edge lands near MACRO_LONG_EDGE. */
export function macroRatio(box: CssBox): number {
  return Math.max(2, Math.min(MACRO_MAX_RATIO, Math.ceil(MACRO_LONG_EDGE / Math.max(1, box.width, box.height))));
}

type Candidate = {
  box: ElementAsset["box"];
  target?: ElementAsset["target"];
  tag?: string;
  role?: string;
  name?: string;
  text?: string;
};

const safePart = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "element";

/*
  Find the visual object around a semantic target without moving the page. Locator
  screenshots scroll their subject into view, which changes the take; this returns a
  viewport crop and `page.screenshot({clip})` takes the pixels exactly where they are.

  A button is usually too small to animate as a product card, so its ancestors
  compete. Named structural elements and card/panel/modal class names win, then a
  moderate share of the viewport: enough context to understand the control, not the
  entire application disguised as an extracted element.
*/
async function elementCandidate(page: Page, locator: Locator | null, hint?: ElementHint, point?: { x: number; y: number }): Promise<Candidate | null> {
  const choose = (target: Element | null, input: { width: number; height: number; point?: { x: number; y: number } }) => {
    const vw = input.width;
    const vh = input.height;
    const visible = (rect: DOMRect) => rect.width >= 24 && rect.height >= 18 && rect.right > 0 && rect.bottom > 0 && rect.left < vw && rect.top < vh;
    /* The control itself may be an icon button of twenty pixels; it is still the thing that gets clicked. */
    const onScreen = (rect: DOMRect) => rect.width >= 8 && rect.height >= 8 && rect.right > 0 && rect.bottom > 0 && rect.left < vw && rect.top < vh;
    const crop = (rect: DOMRect) => {
      const pad = Math.max(10, Math.min(vw, vh) * 0.012);
      const x = Math.max(0, rect.left - pad);
      const y = Math.max(0, rect.top - pad);
      const right = Math.min(vw, rect.right + pad);
      const bottom = Math.min(vh, rect.bottom + pad);
      return { x, y, width: right - x, height: bottom - y };
    };
    const score = (el: Element) => {
      const rect = el.getBoundingClientRect();
      if (!visible(rect)) return -Infinity;
      const fraction = (rect.width * rect.height) / (vw * vh);
      if (fraction > 0.82) return -Infinity;
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role") ?? "";
      const cls = typeof el.className === "string" ? el.className.toLowerCase() : "";
      const structural = /^(article|section|form|dialog|li|aside|figure|table)$/.test(tag) || /^(dialog|listitem|row|grid|tabpanel)$/.test(role);
      const component = /(^|[-_ ])(card|panel|modal|sheet|popover|tile|item|widget|metric|menu|switch|toolbar|control|cluster)([-_ ]|$)/.test(cls);
      const ideal = 1 - Math.min(1, Math.abs(fraction - 0.22) / 0.22);
      const controls = Math.min(6, el.querySelectorAll("button,a,input,select,textarea,[role=button]").length);
      const words = Math.min(1, ((el.textContent ?? "").trim().length || 0) / 120);
      const usefulTarget = el === seed && /^(a|button|input|select|textarea)$/.test(tag) && fraction >= 0.001;
      return (structural ? 3 : 0) + (component ? 8 : 0) + (usefulTarget ? 7 : 0) + ideal * 4 + controls * 0.24 + words - (fraction < 0.001 ? 3 : 0);
    };

    let seed = target === document.body || target === document.documentElement ? null : target;
    if (!seed && input.point) seed = document.elementFromPoint(input.point.x, input.point.y);
    const candidates: Element[] = [];
    for (let el = seed; el && el !== document.body && el !== document.documentElement; el = el.parentElement) candidates.push(el);
    if (candidates.length === 0) {
      candidates.push(...Array.from(document.querySelectorAll("[role=dialog],article,main>section,form,[class*=card i],[class*=panel i],[class*=modal i],[class*=tile i]")));
    }
    const chosen = candidates.map((el) => ({ el, score: score(el) })).filter((c) => Number.isFinite(c.score)).sort((a, b) => b.score - a.score)[0]?.el;
    if (!chosen) return null;

    /*
      A PART of a control is not a control.

      panoma's "Open in Claude" is a split button: a labelled half and a chevron half,
      flush against each other inside one black pill. On the phone take the chevron's own
      `<button>` won the score — it is 0.29% of that viewport, over the threshold that
      calls a clicked element useful, where on the desktop take the same chevron is 0.05%
      and the wrapper won instead. So the same product was cropped two different ways by
      an accident of viewport size, and the phone's crop sliced the pill down the middle:
      the film pushed into a control and showed a chevron and half a word.

      The test is geometric and needs no class names. An element that shares two or more
      of its edges with its parent is a PIECE of that parent, not something sitting
      inside it — a card has padding, a half of a split button does not. So the choice
      climbs while that holds and while the parent is still COMPONENT-sized.

      The stopper is the flushness, not the growth: an area ratio was tried as the guard
      and it is the wrong measure, because the labelled half of a split button can be any
      length beside its chevron — at 375 px the ratio was 7.99 and the crop was right, at
      720 px it was over eight and the same control was sliced again.
    */
    const FLUSH_PX = 2;
    const PARENT_FRACTION_MOST = 0.25;
    const flushEdges = (el: Element, parent: Element) => {
      const a = el.getBoundingClientRect();
      const b = parent.getBoundingClientRect();
      return (
        Number(Math.abs(a.left - b.left) <= FLUSH_PX) +
        Number(Math.abs(a.right - b.right) <= FLUSH_PX) +
        Number(Math.abs(a.top - b.top) <= FLUSH_PX) +
        Number(Math.abs(a.bottom - b.bottom) <= FLUSH_PX)
      );
    };
    let best = chosen;
    for (let step = 0; step < 3; step++) {
      const parent = best.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) break;
      const b = parent.getBoundingClientRect();
      const area = b.width * b.height;
      if (!visible(b) || area / (vw * vh) > PARENT_FRACTION_MOST) break;
      if (flushEdges(best, parent) < 2) break;
      best = parent;
    }
    const rect = best.getBoundingClientRect();
    const targetRect = seed?.getBoundingClientRect();
    const name = seed?.getAttribute("aria-label") ?? seed?.getAttribute("title") ?? undefined;
    const text = (best.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 240) || undefined;
    return {
      box: crop(rect),
      ...(targetRect && onScreen(targetRect) ? { target: { x: targetRect.x, y: targetRect.y, width: targetRect.width, height: targetRect.height } } : {}),
      tag: best.tagName.toLowerCase(),
      role: best.getAttribute("role") ?? undefined,
      name,
      text,
    };
  };

  /* A point measured in this take beats the tour's box: that box belongs to the desktop walk, and a phone lays the same control out elsewhere. */
  const at = point ?? (hint?.box ? { x: hint.box.x + hint.box.w / 2, y: hint.box.y + hint.box.h / 2 } : undefined);
  const input = { width: page.viewportSize()!.width, height: page.viewportSize()!.height, ...(at ? { point: at } : {}) };
  if (locator) {
    /* With a timeout: a selector that matches nothing waits the default thirty seconds, once per mark, and a tour of five marks stalls for two and a half minutes with nothing on screen to say why. */
    const found = await locator.evaluate(choose, input, { timeout: 2000 }).catch(() => null);
    if (found) return found;
  }
  return page.locator("body").evaluate(choose, input).catch(() => null);
}

/*
  The control, photographed on its own.

  Both this and the macro clip are visible to a screencast — Chromium serves them by
  re-rendering a region of the page, and the screencast is that surface. That was fixed
  where it belonged, in `recordTake`, by not running a camera and a capture in the same
  pass. Two attempts to fix it HERE instead are worth recording, because both were wrong
  in ways that took a rendered film to see: routing this through CDP gave element PNGs at
  1x for some marks and 2x for others, and `captureBeyondViewport` moved the clip's
  coordinate space, so every macro on this disk was a crop of the wrong part of the page
  — the camera framed the control and what it showed was blank card beside it.
*/
async function captureElement(opts: {
  page: Page;
  outDir: string;
  stem: string;
  mark: string;
  t: number;
  viewport: { width: number; height: number };
  hint?: ElementHint;
  fallbackSelector?: string;
  /** Where the mark's action lands in this take, when the next step could be measured. */
  point?: { x: number; y: number };
}): Promise<ElementAsset | null> {
  const selector = opts.hint ? opts.hint.selector : opts.fallbackSelector;
  const locator = selector ? opts.page.locator(selector).first() : null;
  const candidate = await elementCandidate(opts.page, locator, opts.hint, opts.point);
  if (!candidate) return null;
  const dir = join(opts.outDir, "elements");
  await mkdir(dir, { recursive: true });
  const name = `${opts.stem}.${safePart(opts.mark)}.png`;
  await opts.page.screenshot({ path: join(dir, name), clip: candidate.box, animations: "disabled" });
  return {
    id: `${opts.stem}.${safePart(opts.mark)}`,
    mark: opts.mark,
    t: opts.t,
    file: `elements/${name}`,
    url: opts.page.url(),
    viewport: opts.viewport,
    ...candidate,
    ...(selector ? { selector } : {}),
    ...(opts.hint?.label && !candidate.name ? { name: opts.hint.label } : {}),
    ...(opts.hint?.kind ? { kind: opts.hint.kind } : {}),
  };
}

async function captureFrame(opts: {
  page: Page;
  outDir: string;
  stem: string;
  mark: string;
  /** The file's name part; a mark's slug, or a name no mark can produce. */
  slug: string;
  t: number;
  viewport: { width: number; height: number };
}): Promise<{ asset: FrameAsset; png: Buffer }> {
  const dir = join(opts.outDir, "frames");
  await mkdir(dir, { recursive: true });
  const name = `${opts.stem}.${opts.slug}.png`;
  const png = await opts.page.screenshot({ animations: "disabled" });
  await writeFile(join(dir, name), png);
  const pixelRatio = await opts.page.evaluate(() => window.devicePixelRatio);
  return {
    asset: {
      id: `${opts.stem}.${opts.slug}`,
      mark: opts.mark,
      t: opts.t,
      file: `frames/${name}`,
      url: opts.page.url(),
      viewport: opts.viewport,
      pixelRatio,
    },
    png,
  };
}

/*
  CDP's clip is in DOCUMENT coordinates: a viewport box travels by the scroll offset
  (Playwright's own `clip` hides the same conversion, which is why nothing said so).
  The page renders the region at `ratio` device pixels per CSS pixel whatever the
  context's deviceScaleFactor is.
*/
async function captureClip(cdp: CDPSession, page: Page, box: CssBox, ratio: number, path: string): Promise<void> {
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  /*
    A clip's `scale` is multiplied by the browser's REAL scale factor, which `recordTake`
    sets to `CAPTURE_DENSITY` for the video's sake (the emulated one leaves it alone —
    measured: 120 CSS px at scale 4 is 480 px without the flag and 960 with it). Divided
    back out here, so a macro's `pixelRatio` still says how many pixels its file holds.
  */
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    clip: { x: box.x + scroll.x, y: box.y + scroll.y, width: box.width, height: box.height, scale: ratio / CAPTURE_DENSITY },
  });
  await writeFile(path, Buffer.from(shot.data, "base64"));
}

/*
  What changed between two frames, measured where the pixels are decoded for free:
  the page's own canvas. ffmpeg's cropdetect was tried first and reports nothing for
  a still that differs in one corner. Both PNGs are drawn at a quarter size — the
  answer is a place to frame, not a measurement — and compared pixel by pixel on the
  largest channel difference. Returned in CSS pixels of the viewport.
*/
async function changedRegion(page: Page, before: Buffer, after: Buffer, viewport: { width: number; height: number }): Promise<MacroAsset["change"] | undefined> {
  const found = await page
    .evaluate(
      async ([a, b, sample, threshold]: readonly [string, string, number, number]) => {
        const bitmap = async (base64: string) => {
          const bin = atob(base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return createImageBitmap(new Blob([bytes], { type: "image/png" }));
        };
        const [first, second] = await Promise.all([bitmap(a), bitmap(b)]);
        if (first.width !== second.width || first.height !== second.height) return null;
        const w = Math.ceil(first.width / sample);
        const h = Math.ceil(first.height / sample);
        const pixels = (bm: ImageBitmap) => {
          const canvas = new OffscreenCanvas(w, h);
          const g = canvas.getContext("2d", { willReadFrequently: true })!;
          g.imageSmoothingEnabled = false;
          g.drawImage(bm, 0, 0, w, h);
          return g.getImageData(0, 0, w, h).data;
        };
        const p = pixels(first);
        const q = pixels(second);
        let x1 = w;
        let y1 = h;
        let x2 = -1;
        let y2 = -1;
        let changed = 0;
        for (let row = 0; row < h; row++) {
          for (let col = 0; col < w; col++) {
            const i = (row * w + col) * 4;
            const d = Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2]));
            if (d <= threshold) continue;
            changed++;
            if (col < x1) x1 = col;
            if (col > x2) x2 = col;
            if (row < y1) y1 = row;
            if (row > y2) y2 = row;
          }
        }
        if (x2 < 0) return { none: true as const };
        return {
          none: false as const,
          px: first.width,
          x: x1 * sample,
          y: y1 * sample,
          width: (x2 - x1 + 1) * sample,
          height: (y2 - y1 + 1) * sample,
          share: changed / (w * h),
          boxShare: ((x2 - x1 + 1) * (y2 - y1 + 1)) / (w * h),
        };
      },
      [before.toString("base64"), after.toString("base64"), CHANGE_SAMPLE, CHANGE_THRESHOLD] as const,
    )
    .catch(() => null);
  if (!found || found.none) return undefined;
  const ratio = found.px / viewport.width;
  const css: CssBox = { x: found.x / ratio, y: found.y / ratio, width: found.width / ratio, height: found.height / ratio };
  return { box: roundBox(clampBox(css, { x: 0, y: 0, ...viewport })), share: found.share, boxShare: found.boxShare };
}

async function captureMacro(opts: {
  page: Page;
  cdp: CDPSession;
  outDir: string;
  stem: string;
  mark: string;
  t: number;
  viewport: { width: number; height: number };
  target?: CssBox;
  element?: CssBox;
  at: MacroAsset["at"];
}): Promise<MacroAsset | null> {
  const box = macroBox(opts.target, opts.element, opts.viewport);
  if (!box) return null;
  const dir = join(opts.outDir, "macro");
  await mkdir(dir, { recursive: true });
  const name = `${opts.stem}.${safePart(opts.mark)}.png`;
  const pixelRatio = macroRatio(box);
  await captureClip(opts.cdp, opts.page, box, pixelRatio, join(dir, name));
  return {
    id: `${opts.stem}.${safePart(opts.mark)}`,
    mark: opts.mark,
    t: opts.t,
    file: `macro/${name}`,
    url: opts.page.url(),
    viewport: opts.viewport,
    box,
    ...(opts.target ? { target: opts.target } : {}),
    pixelRatio,
    at: opts.at,
  };
}

/*
  The after-state of a mark's action, once the next frame exists. The control is
  re-rendered in its own box (the press must show on the thing pressed); the
  change is measured against the new frame, and when it stayed local the crop is
  grown to hold it and rendered again, so a menu that opened becomes one plane
  that grows rather than two frames that cut; and the heading the tour saw the
  action produce is measured, so a navigation has a place to land.
*/
async function settleMacro(opts: {
  page: Page;
  cdp: CDPSession;
  outDir: string;
  stem: string;
  macro: MacroAsset;
  before: Buffer;
  after: Buffer;
  /** Whether the click left the document the control was measured on. */
  moved: boolean;
  heading?: string;
}): Promise<void> {
  const dir = join(opts.outDir, "macro");
  await mkdir(dir, { recursive: true });
  /*
    The control's own box, again, on the frame after the click — but only if the click
    stayed on the page. After a navigation that box holds unrelated content of another
    document at scroll zero, and the scene pastes it over the button at the press.
  */
  if (!opts.moved) {
    const control = `${opts.stem}.${safePart(opts.macro.mark)}.control.png`;
    await captureClip(opts.cdp, opts.page, opts.macro.box, opts.macro.pixelRatio, join(dir, control));
    opts.macro.afterControl = { file: `macro/${control}`, pixelRatio: opts.macro.pixelRatio };
  }
  if (opts.heading) {
    const geometry = await targetGeometry(opts.page, `role=heading[name=${JSON.stringify(opts.heading)}s]`, 1500).catch(() => null);
    const box = geometry?.box;
    const screen: CssBox = { x: 0, y: 0, ...opts.macro.viewport };
    if (box && geometry.visibleShare >= SHOWN_LEAST && geometry.centerVisible) {
      const inside = clampBox(box, screen);
      // Test the intersection before outward rounding: a zero-height intersection
      // at a fractional offscreen y would otherwise become a fabricated one-pixel focus.
      if (inside.width > 0 && inside.height > 0) {
        opts.macro.focus = roundBox(inside);
        opts.macro.resultHeading = { text: opts.heading, box: opts.macro.focus, visibleShare: geometry.visibleShare, centerVisible: true };
      }
    }
  }
  const change = await changedRegion(opts.page, opts.before, opts.after, opts.macro.viewport);
  if (!change) return;
  opts.macro.change = change;
  if (change.boxShare > LOCAL_CHANGE_MAX) return;
  const box = roundBox(clampBox(unionBox(opts.macro.box, change.box), { x: 0, y: 0, ...opts.macro.viewport }));
  const name = `${opts.stem}.${safePart(opts.macro.mark)}.after.png`;
  const pixelRatio = macroRatio(box);
  await captureClip(opts.cdp, opts.page, box, pixelRatio, join(dir, name));
  opts.macro.after = { file: `macro/${name}`, box, pixelRatio };
}

/*
  Runs in the page before any of its own scripts, and keeps running: password and
  one-time-code fields render as discs, and any text node that carries something
  shaped like a credential (a provider prefix followed by a long token) is masked in
  place. It is a heuristic, not a guarantee — the honest line for the docs is that a
  product showing secrets in plain text needs a fixture account, not a filter.
*/
const SECRET_MASK_SCRIPT = `(() => {
  const TOKEN = /\\b(?:(?:sk|pk|rk)[-_](?:live|test)?[-_]?|(?:ghp|gho|ghu|ghs|ghr)_|glpat-|xox[abp]-|AKIA|AIza|eyJ)[A-Za-z0-9_\\-.]{16,}\\b/g;
  const mask = (s) => s.replace(TOKEN, (m) => m.slice(0, 4) + "\u2022".repeat(Math.min(12, m.length - 4)));
  const FIELDS = 'input[type=password],input[autocomplete="one-time-code"],input[autocomplete^="cc-"],input[name*="token" i],input[name*="secret" i],input[name*="apikey" i],input[name*="api_key" i]';
  const scan = (root) => {
    if (!root || root.nodeType === 3) root = root && root.parentNode;
    if (!root || !root.querySelectorAll) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      TOKEN.lastIndex = 0;
      if (TOKEN.test(n.data)) { TOKEN.lastIndex = 0; n.data = mask(n.data); }
    }
    for (const el of root.querySelectorAll(FIELDS)) el.style.webkitTextSecurity = "disc";
  };
  const start = () => {
    scan(document.body);
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "characterData") scan(r.target);
        for (const node of r.addedNodes) scan(node);
      }
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();`;

/*
  The user agent a mobile take presents. Exported because the tour walker opens the
  same take before the camera does: a product with user-agent-driven branches must
  fire them identically under both, or the tour is written for a layout the
  recording never shows.
*/
export const PHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export async function recordSession(opts: {
  name: string;
  take: SessionTake;
  steps: SessionStep[];
  outDir: string;
  colorScheme?: "light" | "dark";
  /** Source-reviewed effects forbidden even when a supplied script asks for them. */
  denySelectors?: readonly string[];
  /** The product's commit, recorded into the log (see SessionLog.head). */
  head?: string;
  /** BCP 47 locale for the browser context, so the product renders the narration's language. */
  locale?: string;
  /*
    Hide credentials before the first frame is captured. On by default: the recorder
    is pointed at real products by automation that never looks at the screen, and a
    settings page with an API key on it is one `panoma-video auto` away from a public video.
  */
  maskSecrets?: boolean;
  /** Capture the real UI component at every mark. Enabled by default. */
  captureElements?: boolean;
  /** Capture a lossless full viewport at every mark. Enabled by default. */
  captureFrames?: boolean;
  /** Render the control at every mark at several pixels per CSS pixel, and measure what its action changed. Enabled by default. */
  captureMacros?: boolean;
  /*
    Record a video of this pass. Off for the capture pass of `recordTake`, whose only
    product is the assets; its independent clock and screenshot work do not enter tape.
  */
  video?: boolean;
  /** Semantic targets from a tour; step lookahead is the fallback. */
  elementHints?: Record<string, ElementHint>;
  /** What the tour saw each mark's action produce, by mark; the heading is measured on the next frame (MacroAsset.focus). */
  outcomes?: Record<string, { heading?: string; route?: string }>;
}): Promise<SessionLog> {
  const denySelectors = actionDenySelectors(opts.denySelectors);
  const viewport = opts.take.viewport;
  const isMobile = opts.take.isMobile ?? false;
  await mkdir(opts.outDir, { recursive: true });

  /*
    A REAL scale factor, not only the emulated one.

    `deviceScaleFactor` on the context is emulation: it reaches screenshots (the stills at
    2x, the macro clips at up to 8x) and nothing the compositor shows live — the screencast
    Playwright records the video from stays at the CSS size, so for a year the recording was
    a 1x asset and the tutorial camera capped every zoom at 1.17 to stay inside it. The
    flag makes the browser's own scale 2, and then the screencast frame IS 3840 wide for a
    1920 viewport. Measured 2026-09-04 on the same page in both configurations: the CSS
    viewport, `devicePixelRatio` and the layout are identical; the video is twice the
    pixels; a page.screenshot is unchanged; and a CDP clip's `scale` is multiplied by the
    real factor, which `captureClip` divides back out.
  */
  const browser = await chromium.launch({ args: [...DETERMINISM_ARGS, ...captureBrowserArgs(), `--force-device-scale-factor=${CAPTURE_DENSITY}`] });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: CAPTURE_DENSITY,
    screen: viewport,
    colorScheme: opts.colorScheme ?? "dark",
    ...(opts.locale ? { locale: opts.locale } : {}),
    ...(isMobile ? { isMobile: true, hasTouch: true, userAgent: PHONE_UA } : {}),
  });

  const events: SessionEvent[] = [];
  const marks: { name: string; t: number }[] = [];
  const elements: ElementAsset[] = [];
  const frames: FrameAsset[] = [];
  const macros: MacroAsset[] = [];
  let last: FrameAsset | undefined;
  let url = "";
  const stem = `${opts.name}.${opts.take.id}`;

  if (opts.maskSecrets ?? true) await context.addInitScript(SECRET_MASK_SCRIPT);

  const page = await context.newPage();
  /* The page rasterizes its own macro clips (captureClip); one session serves the whole take. */
  const cdp = (opts.captureMacros ?? true) ? await context.newCDPSession(page) : null;
  /* The previous mark's macro and frame: what its action did is judged on the frame after it. */
  let pending: { macro: MacroAsset; frame: Buffer; url: string } | null = null;
  /*
    A mark whose control was below the fold, waiting for the press that will see it.

    The tour writes `mark → scrollTo → clickOn`, so at the mark the control is off-screen
    and the mark captures nothing (see `lost`). The next product `clickOn` is where the
    control is finally on the page and about to be pressed, and that instant is the one
    place the same clip can still be taken honestly. An optional click that matches
    nothing leaves the arm set, and the next mark clears it: a step that never pressed
    anything has no control to show, and a later mark's click is a later mark's material.
  */
  let armed: { mark: string; t: number } | null = null;
  const settledResults = new Map<string, number>();
  let resultPress: { mark: string; at: number; destination?: ReadingDestination } | undefined;
  let readyMs = 0;
  // Capture-only passes keep their elapsed clock. Video passes are rebased to the
  // first encoded frame, whose browser timestamp the public screencast API exposes.
  const started = Date.now();
  const now = () => Date.now() - started;
  const clock = opts.video === false ? undefined : createVideoClock(started);
  const video = clock ? join(opts.outDir, `${stem}.webm`) : undefined;
  // A failed retry must not remove the completed take it was meant to replace.
  const pendingVideo = clock ? join(opts.outDir, `.${stem}.${randomUUID()}.webm`) : undefined;
  let recording = false;
  let durationMs = 0;
  let cursor = { x: viewport.width / 2, y: viewport.height / 2 };

  function afterAction(role: StepRole, pressAt?: number, destination?: ReadingDestination): void {
    const mark = marks.at(-1)?.name;
    if (mark) settledResults.delete(mark);
    if (role === "chrome") resultPress = undefined;
    else if (mark && pressAt !== undefined) resultPress = { mark, at: pressAt, ...(destination ? { destination } : {}) };
  }

  async function pressDestination(point: { x: number; y: number }, role: StepRole): Promise<ReadingDestination | undefined> {
    if (role === "chrome") return undefined;
    const mark = marks.at(-1)?.name;
    const route = mark ? opts.outcomes?.[mark]?.route : undefined;
    const current = page.url();
    const href = await page.evaluate(({ x, y }) => {
      const link = document.elementFromPoint(x, y)?.closest("a[href]");
      return link instanceof HTMLAnchorElement ? link.href : undefined;
    }, point);
    return readingDestination(current, route, href);
  }

  /*
    Real movement, really paced: mouse.move's `steps` dispatches back-to-back and
    ignores wall time, so the glide walks its own clock. The path is linear on
    purpose — the page only needs believable hover timing; the pretty easing is
    the renderer's job, from the log.
  */
  async function glide(x: number, y: number, ms: number): Promise<void> {
    events.push({ t: now(), kind: "move", x: cursor.x, y: cursor.y });
    const ticks = Math.max(2, Math.round(ms / 16));
    for (let i = 1; i <= ticks; i++) {
      await page.mouse.move(cursor.x + ((x - cursor.x) * i) / ticks, cursor.y + ((y - cursor.y) * i) / ticks);
      await page.waitForTimeout(ms / ticks);
    }
    cursor = { x, y };
    events.push({ t: now(), kind: "move", x, y });
  }


  try {
    if (clock && pendingVideo) {
      // Preserve the real 2x camera and Playwright's encoder/quality. A synchronous
      // metadata callback adds no work to the frame stream and retains no images.
      recording = true;
      await page.screencast.start({ path: pendingVideo,
        size: { width: viewport.width * CAPTURE_DENSITY, height: viewport.height * CAPTURE_DENSITY },
        onFrame: ({ timestamp }) => clock.observeFrame(timestamp),
      });
      await clock.ready();
    }
    for (let stepIndex = 0; stepIndex < opts.steps.length; stepIndex++) {
      const step = opts.steps[stepIndex];
      if ("goto" in step) {
        /* An explicit navigation replaces the result of the preceding press. Until
           another product press settles, the whole segment is the only safe proof. */
        afterAction("chrome");
        url = step.goto;
        await page.goto(step.goto, { waitUntil: "networkidle" });
        await page.waitForTimeout(step.settleMs ?? 600);
        /* The first navigation is the one that ends the blank head. */
        if (readyMs === 0) readyMs = now();
      } else if ("move" in step) {
        await glide(step.move.x, step.move.y, step.move.ms ?? 450);
      } else if ("click" in step) {
        await glide(step.click.x, step.click.y, 450);
        await assertActionAllowed(page, denySelectors, step.click);
        const destination = await pressDestination(step.click, step.role ?? "product");
        const t = now();
        events.push({ t, kind: "click", x: step.click.x, y: step.click.y, role: step.role ?? "product" });
        await page.mouse.click(step.click.x, step.click.y);
        afterAction(step.role ?? "product", t, destination);
      } else if ("clickOn" in step) {
        const denied = await deniedSelector(page, step.clickOn, denySelectors);
        if (denied) throw new Error(`Action refused by source policy: ${denied}`);
        const before = await targetGeometry(page, step.clickOn);
        if (!before) {
          if (step.optional) continue;
          throw new Error(`clickOn "${step.clickOn}" matched nothing on the page.`);
        }
        /* A panel can clip a control whose box still lies inside the viewport. */
        let shown = before;
        if (before.visibleShare < 0.999 || !before.centerVisible) {
          const event: Extract<SessionEvent, { kind: "scroll" }> = { t: now(), kind: "scroll", y: 0, role: step.role ?? "product" };
          const result = await scrollToTarget(page, step.clickOn, { at: 0.4, duration: 900, onlyIfNeeded: true });
          if (result.moved) {
            Object.assign(event, { y: result.y, ...(result.x ? { x: result.x } : {}), durationMs: now() - event.t });
            events.push(event);
            afterAction(step.role ?? "product");
          }
          shown = result;
        }
        if (!shown.centerVisible) {
          if (step.optional) continue;
          throw new Error(`clickOn "${step.clickOn}" is clipped or covered after its scroll; the target cannot be pressed at its measured center.`);
        }
        const box = shown.box;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await glide(x, y, 450);
        /*
          The armed mark's control, photographed the instant before it is pressed.

          Only in the capture pass — `cdp` is null in the camera pass, and a screenshot
          here would put the recorder in the footage at exactly the frame a viewer is
          looking at. The point and the target are the box measured in THIS take, never the
          tour's desktop box: a phone lays the same control out elsewhere. The frame taken
          here is the before-image the next mark judges the press against; it is not one of
          the take's frames, because the mark's own frame already is.
        */
        const pressable = armed !== null && (step.role ?? "product") !== "chrome" && shownShare(box, viewport) >= SHOWN_LEAST;
        if (pressable && armed) {
          const aim = { x: box.x, y: box.y, width: box.width, height: box.height };
          let captured: ElementAsset | null = null;
          if (opts.captureElements ?? true) {
            captured = await captureElement({
              page,
              outDir: opts.outDir,
              stem,
              mark: armed.mark,
              t: armed.t,
              viewport,
              hint: opts.elementHints?.[armed.mark],
              fallbackSelector: step.clickOn,
              point: { x, y },
            });
            if (captured) elements.push(captured);
          }
          if (cdp) {
            const before = await page.screenshot({ animations: "disabled" });
            const macro = await captureMacro({ page, cdp, outDir: opts.outDir, stem, mark: armed.mark, t: armed.t, viewport, target: aim, element: captured?.box, at: "press" });
            if (macro) {
              macros.push(macro);
              pending = { macro, frame: before, url: page.url() };
            }
          }
          armed = null;
        }
        const destination = await pressDestination({ x, y }, step.role ?? "product");
        const t = now();
        await assertActionAllowed(page, denySelectors, { x, y });
        events.push({ t, kind: "click", x, y, role: step.role ?? "product" });
        await page.mouse.click(x, y);
        afterAction(step.role ?? "product", t, destination);
      } else if ("type" in step) {
        await assertActionAllowed(page, denySelectors);
        events.push({ t: now(), kind: "key", text: step.type.text, role: step.role ?? "product" });
        await page.keyboard.type(step.type.text, { delay: step.type.delayMs ?? 55 });
        afterAction(step.role ?? "product");
      } else if ("press" in step) {
        await assertActionAllowed(page, denySelectors);
        events.push({ t: now(), kind: "key", text: step.press.key, role: step.role ?? "product" });
        await page.keyboard.press(step.press.key);
        afterAction(step.role ?? "product");
      } else if ("scroll" in step) {
        const event: Extract<SessionEvent, { kind: "scroll" }> = { t: now(), kind: "scroll", y: 0, role: step.role ?? "product" };
        const result = await scrollAtPointer(page, step.scroll.y, step.scroll.ms ?? 900, cursor);
        if (result.moved) {
          Object.assign(event, { y: result.y, ...(result.x ? { x: result.x } : {}), durationMs: now() - event.t });
          events.push(event);
          afterAction(step.role ?? "product");
        }
      } else if ("mark" in step) {
        /*
          Names are unique per take, and the failure is loud. A repeated name
          means a sentence would be pinned to two different moments, and the
          renderer would silently take the first — a tutorial that narrates one
          thing while showing another, which is the one defect this whole recipe
          exists to make impossible.
        */
        if (marks.some((m) => m.name === step.mark)) {
          throw new Error(
            `Two steps are both marked "${step.mark}". A mark names one moment; rename one of them.`,
          );
        }
        const t = now();
        marks.push({ name: step.mark, t });
        events.push({ t, kind: "mark", name: step.mark });
        resultPress = undefined;
        /* A mark that never pressed anything has no control to show; its arm ends here. */
        armed = null;
        let shot: Buffer | null = null;
        if (opts.captureFrames ?? true) {
          const frame = await captureFrame({ page, outDir: opts.outDir, stem, mark: step.mark, slug: safePart(step.mark), t, viewport });
          frames.push(frame.asset);
          shot = frame.png;
        }
        /* The previous mark's action is judged here, on the first frame after it. */
        if (pending && shot && cdp) {
          await settleMacro({ page, cdp, outDir: opts.outDir, stem, macro: pending.macro, before: pending.frame, after: shot, moved: page.url() !== pending.url, heading: opts.outcomes?.[pending.macro.mark]?.heading });
          pending = null;
        }
        /* The action immediately after a mark is what the mark names. Pauses and
           another mark carry no selector, so look ahead to the next destination. */
        const next = opts.steps.slice(stepIndex + 1).find((s) => "clickOn" in s || "scrollTo" in s || "goto" in s);
        const nextSelector = next && ("clickOn" in next ? next.clickOn : "scrollTo" in next ? next.scrollTo : undefined);
        /*
          Where that action will land, measured in THIS take. The tour's boxes belong
          to the desktop walk; a phone lays the same control out somewhere else, and
          an element chosen from a desktop point on a phone is a random card.
        */
        const geometry = nextSelector ? await targetGeometry(page, nextSelector, 1500) : null;
        const measured = geometry?.box ?? null;
        /*
          And only if it is on screen HERE. The walker writes the mark before the
          approach that scrolls to the control, so at a mark below the fold the box
          comes back off-screen; `macroBox` then slides the crop into view and the
          take reports a strip of whatever sits at the bottom of the viewport as the
          control, with nothing degraded and nothing to warn about.
        */
        const onScreen = measured !== null && (geometry?.visibleShare ?? 0) >= SHOWN_LEAST;
        const aim = onScreen ? measured : null;
        /*
          Off screen is not the same as absent: the selector resolved, so no other
          element on this page is the control, and choosing one by score would render
          a random card as the mark's material. Nothing is captured HERE; the next
          product click is armed to capture it the instant before the press, when the
          scroll the tour wrote after this mark has brought it into view.
        */
        const lost = measured !== null && !onScreen;
        if (lost) armed = { mark: step.mark, t };
        let captured: ElementAsset | null = null;
        if ((opts.captureElements ?? true) && !lost) {
          captured = await captureElement({
            page,
            outDir: opts.outDir,
            stem,
            mark: step.mark,
            t,
            viewport,
            hint: opts.elementHints?.[step.mark],
            fallbackSelector: nextSelector,
            ...(aim ? { point: { x: aim.x + aim.width / 2, y: aim.y + aim.height / 2 } } : {}),
          });
          if (captured) elements.push(captured);
        }
        /* The control is what the next step measured, or what the element capture found; the component is what it chose. */
        const target = aim ?? captured?.target;
        if (cdp && (target || captured)) {
          const macro = await captureMacro({ page, cdp, outDir: opts.outDir, stem, mark: step.mark, t, viewport, target, element: captured?.box, at: "mark" });
          if (macro) {
            macros.push(macro);
            if (shot) pending = { macro, frame: shot, url: page.url() };
          }
        }
      } else if ("scrollTo" in step) {
        const geometry = await targetGeometry(page, step.scrollTo);
        if (!geometry) {
          if (step.optional) continue;
          throw new Error(`scrollTo "${step.scrollTo}" matched nothing on the page.`);
        }
        const event: Extract<SessionEvent, { kind: "scroll" }> = { t: now(), kind: "scroll", y: 0, role: step.role ?? "product" };
        const result = await scrollToTarget(page, step.scrollTo, { at: step.at, duration: step.ms ?? 1100, back: step.back ?? false });
        if (result.moved) {
          Object.assign(event, { y: result.y, ...(result.x ? { x: result.x } : {}), durationMs: now() - event.t });
          events.push(event);
          afterAction(step.role ?? "product");
        }
        if (result.visibleShare <= 0 && !step.optional) throw new Error(`scrollTo "${step.scrollTo}" could not reveal its target inside the page's clipping containers.`);
      } else if ("pause" in step) {
        if (step.settled) {
          const state = await waitForReading(page, resultPress?.destination);
          const resultAt = now();
          if (state === "quiet" && resultPress && resultAt > resultPress.at && !settledResults.has(resultPress.mark)) {
            settledResults.set(resultPress.mark, resultAt);
          }
        }
        await page.waitForTimeout(step.pause);
      }
    }
    /* A tail so the last action breathes before the recording stops. */
    await page.waitForTimeout(800);
    /*
      The take's last frame: the after-state of the last mark, which has no next
      mark to be judged on. Its name carries underscores, which no mark's slug can,
      so it never shadows a mark called "last".
    */
    if ((opts.captureFrames ?? true) && marks.length > 0) {
      const frame = await captureFrame({ page, outDir: opts.outDir, stem, mark: "__last", slug: "__last", t: now(), viewport });
      last = frame.asset;
      if (pending && cdp) await settleMacro({ page, cdp, outDir: opts.outDir, stem, macro: pending.macro, before: pending.frame, after: frame.png, moved: page.url() !== pending.url, heading: opts.outcomes?.[pending.macro.mark]?.heading });
      pending = null;
    }
    durationMs = now();
    if (clock) {
      clock.metadata();
      await page.screencast.stop();
      recording = false;
      clock.metadata();
    }
  } catch (error) {
    /*
      A failed step must fail the command — a truncated take that reports success
      is only discovered when the render looks wrong. Close (which flushes the
      webm), delete the orphan, and let the error out. No `return` may ever live
      in a `finally` here: it silently discards the in-flight exception.
    */
    durationMs = now();
    if (recording) await page.screencast.stop().catch(() => undefined);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    if (pendingVideo) await rm(pendingVideo, { force: true }).catch(() => undefined);
    throw new Error(
      `Session "${opts.name}" (${opts.take.id}) failed after ${(durationMs / 1000).toFixed(1)}s: ${(error as Error).message}`,
    );
  }

  await context.close();
  await browser.close();
  if (pendingVideo && video) await rename(pendingVideo, video);

  // Everything downstream reads video seconds, including assets joined in the
  // second pass and the private readiness map. Scroll durations stay intervals.
  const at = (elapsed: number): number => clock ? clock.time(elapsed) : elapsed;
  const stamp = <T extends { t: number }>(item: T): T => ({ ...item, t: at(item.t) });
  const results = new Map([...settledResults].map(([mark, time]) => [mark, at(time)]));

  const log: SessionLog = {
    name: opts.name,
    take: opts.take.id,
    recordedAt: new Date().toISOString(),
    ...(opts.head ? { head: opts.head } : {}),
    ...(opts.locale ? { locale: opts.locale } : {}),
    isMobile,
    fps: video ? await probeFps(video) : 0,
    ...(video ? { videoRatio: await probeVideoRatio(video, viewport) } : {}),
    url,

    viewport,
    video: video ? `${stem}.webm` : "",
    ...(clock ? { videoClock: clock.metadata() } : {}),
    durationMs: at(durationMs),
    readyMs: readyMs ? at(readyMs) : 0,
    marks: marks.map(stamp),
    ...(elements.length > 0 ? { elements: elements.map(stamp) } : {}),
    ...(frames.length > 0 ? { frames: frames.map(stamp) } : {}),
    ...(macros.length > 0 ? { macros: macros.map((macro) => ({ ...stamp(macro), ...(results.has(macro.mark) ? { resultAtMs: results.get(macro.mark)! } : {}) })) } : {}),
    ...(last ? { last: stamp(last) } : {}),
    events: events.map(stamp),
  };
  settledAtForSession.set(log, results);
  if (opts.video !== false) await writeFile(join(opts.outDir, `${stem}.session.json`), JSON.stringify(log, null, 2));
  return log;
}

/*
  A take, recorded twice, because a camera cannot photograph the room it is standing in.

  Every asset capture — the component at a mark, the control at eight pixels per CSS
  pixel — is served by Chromium re-rendering a region of the page, and the screencast
  Playwright is running IS that surface. So the take carried the recorder: at each mark,
  two or three frames of the control drawn huge on a grey field, then a frame of nothing.
  Measured on panoma's app: a scene change within 0.14 s of 12 marks out of 12, and a
  strange jump at every change of screen in every film cut from that footage.

  Four configurations were recorded to find it (`captureElements` and `captureMacros`,
  on and off, against a fixture): with either capture on, the recorder is in the frame;
  with neither, the recording is clean. CDP's `captureBeyondViewport` removes it for a
  capture at the device ratio and not for one at eight times it, which is what a legible
  macro needs — so the answer is not a flag.

  The walk therefore runs twice, in this order and never merged into one pass:

    1. the CAMERA pass — the video, the marks, the events. No captures at all.
    2. the CAPTURE pass — every asset, and no video.

  What each pass owns is what only it can know. The camera pass owns time: the mark
  times in it are the ones the video's own seconds are measured against, so every asset
  is stamped with ITS mark's time and never with its own. The capture pass owns the
  material, including the before/after pair a change is measured from, which is
  self-consistent because both halves are shot in the same pass.

  The cost is honest and it is real: filming a product takes twice as long. A product
  that shows different data on two runs gets assets of the second one; that is a
  caveat, not a defect, and it is the same caveat as filming any live system twice.
*/
export async function recordTake(opts: Parameters<typeof recordSession>[0]): Promise<SessionLog> {
  const wantsAssets = (opts.captureElements ?? true) || (opts.captureMacros ?? true) || (opts.captureFrames ?? true);
  if (!wantsAssets) return recordSession(opts);

  const camera = await recordSession({ ...opts, captureElements: false, captureFrames: false, captureMacros: false });
  const capture = await recordSession({ ...opts, video: false });

  /* Every asset carries the time of ITS mark in the take that has a clock: the camera pass. */
  const at = new Map(camera.marks.map((m) => [m.name, m.t]));
  const stamp = <T extends { mark: string; t: number }>(asset: T): T => ({ ...asset, t: at.get(asset.mark) ?? asset.t });
  const resultAt = settledAtForSession.get(camera);
  const stampMacro = (asset: MacroAsset): MacroAsset => {
    const macro = stamp(asset);
    delete macro.resultAtMs;
    const time = resultAt?.get(macro.mark);
    if (time !== undefined) macro.resultAtMs = time;
    return macro;
  };

  const log: SessionLog = {
    ...camera,
    ...(capture.elements ? { elements: capture.elements.map(stamp) } : {}),
    ...(capture.frames ? { frames: capture.frames.map(stamp) } : {}),
    ...(capture.macros ? { macros: capture.macros.map(stampMacro) } : {}),
    ...(capture.last ? { last: { ...capture.last, t: camera.durationMs } } : {}),
  };
  const stem = `${opts.name}.${opts.take.id}`;
  await writeFile(join(opts.outDir, `${stem}.session.json`), JSON.stringify(log, null, 2));
  return log;
}
