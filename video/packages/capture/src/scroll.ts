/*
  The named target owns its scroll, not the window. The walker uses this same
  geometry with duration zero; the recorder animates the measured ancestor chain
  in one requestAnimationFrame clock. Nothing asks Playwright to auto-scroll under
  a cursor whose logged coordinates were measured before that movement.
*/
import type { Page } from "playwright";

export type TargetGeometry = {
  box: { x: number; y: number; width: number; height: number };
  visibleShare: number;
  centerVisible: boolean;
};

export type ScrollResult = TargetGeometry & {
  /** Sum of the actual CSS-pixel displacement of the scrollports that moved. */
  x: number;
  y: number;
  moved: boolean;
  backward: boolean;
  containers: number;
  windowY: number;
};

type ScrollRequest = {
  kind: "target" | "pointer" | "inspect";
  at: number;
  duration: number;
  onlyIfNeeded?: boolean;
  back?: boolean;
  delta?: number;
  pointer?: { x: number; y: number };
};

/* This function is serialized into the page: all geometry and easing live here. */
async function inPage(found: Element, request: ScrollRequest): Promise<ScrollResult> {
  const root = document.scrollingElement ?? document.documentElement;
  const parentOf = (el: Element): Element | null => el.parentElement ?? (el.getRootNode() instanceof ShadowRoot ? (el.getRootNode() as ShadowRoot).host : null);
  const atPoint = (x: number, y: number): Element | null => {
    let hit = document.elementFromPoint(x, y);
    for (;;) {
      const child = hit?.shadowRoot?.elementFromPoint(x, y);
      if (!child || child === hit) return hit;
      hit = child;
    }
  };
  const target = request.kind === "pointer" ? atPoint(request.pointer!.x, request.pointer!.y) ?? root : found;
  const ancestors: Element[] = [];
  for (let el: Element | null = request.kind === "pointer" ? target : parentOf(target); el; el = parentOf(el)) {
    ancestors.push(el);
    if (getComputedStyle(el).position === "fixed") break;
  }
  const fixed = getComputedStyle(target).position === "fixed";
  if (!fixed && !ancestors.some((el) => getComputedStyle(el).position === "fixed") && !ancestors.includes(root)) ancestors.push(root);

  const portOf = (el: Element) => {
    if (el === root) return { left: 0, top: 0, width: document.documentElement.clientWidth, height: window.innerHeight, sx: 1, sy: 1 };
    const rect = el.getBoundingClientRect();
    const html = el as HTMLElement;
    const sx = html.offsetWidth > 0 ? rect.width / html.offsetWidth : 1;
    const sy = html.offsetHeight > 0 ? rect.height / html.offsetHeight : 1;
    return { left: rect.left + el.clientLeft * sx, top: rect.top + el.clientTop * sy, width: el.clientWidth * sx, height: el.clientHeight * sy, sx, sy };
  };
  const measure = (): TargetGeometry => {
    const b = target.getBoundingClientRect();
    let left = Math.max(0, b.left), top = Math.max(0, b.top);
    let right = Math.min(window.innerWidth, b.right), bottom = Math.min(window.innerHeight, b.bottom);
    if (!fixed) for (const el of ancestors) {
      const css = getComputedStyle(el), p = portOf(el);
      if (el === root || /hidden|clip|auto|scroll|overlay/.test(css.overflowX)) { left = Math.max(left, p.left); right = Math.min(right, p.left + p.width); }
      if (el === root || /hidden|clip|auto|scroll|overlay/.test(css.overflowY)) { top = Math.max(top, p.top); bottom = Math.min(bottom, p.top + p.height); }
    }
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const hit = cx >= left && cx < right && cy >= top && cy < bottom ? atPoint(cx, cy) : null;
    let hitTarget = false;
    for (let el = hit; el; el = parentOf(el)) if (el === target) { hitTarget = true; break; }
    const visibleShare = b.width > 0 && b.height > 0 ? Math.max(0, right - left) * Math.max(0, bottom - top) / (b.width * b.height) : 0;
    return { box: { x: b.x, y: b.y, width: b.width, height: b.height }, visibleShare, centerVisible: hitTarget };
  };
  const initial = measure();
  const empty = (): ScrollResult => ({ ...measure(), x: 0, y: 0, moved: false, backward: false, containers: 0, windowY: window.scrollY });
  if (request.kind === "inspect" || fixed || (request.onlyIfNeeded && initial.visibleShare > 0.999 && initial.centerVisible)) return empty();

  type Move = { el: Element; x: number; y: number; toX: number; toY: number; height: number; sx: number; sy: number };
  const moves: Move[] = [];
  let projected = { ...initial.box };
  let alignedY = false;
  let remaining = request.delta ?? 0;
  for (const el of ancestors) {
    const css = getComputedStyle(el), p = portOf(el);
    if (p.sx <= 0 || p.sy <= 0) continue;
    const canX = el.scrollWidth > el.clientWidth + 1 && (el === root || /auto|scroll|overlay|hidden/.test(css.overflowX));
    const canY = el.scrollHeight > el.clientHeight + 1 && (el === root || /auto|scroll|overlay|hidden/.test(css.overflowY));
    const maxX = el.scrollWidth - el.clientWidth, maxY = el.scrollHeight - el.clientHeight;
    const rtl = css.direction === "rtl";
    const x = el.scrollLeft, y = el.scrollTop;
    let dx = 0, dy = 0;
    if (request.kind === "pointer") {
      if (canY) dy = remaining;
    } else {
      if (canX) {
        if (projected.x < p.left) dx = (projected.x - p.left) / p.sx;
        else if (projected.x + projected.width > p.left + p.width) dx = (projected.x + Math.min(projected.width, p.width) - p.left - p.width) / p.sx;
      }
      if (canY) {
        if (!alignedY) {
          const offset = Math.min(p.height * request.at, Math.max(0, p.height - projected.height));
          dy = (projected.y - p.top - offset) / p.sy;
          alignedY = true;
        } else if (projected.y < p.top) dy = (projected.y - p.top) / p.sy;
        else if (projected.y + projected.height > p.top + p.height) dy = (projected.y + Math.min(projected.height, p.height) - p.top - p.height) / p.sy;
      }
    }
    const toX = Math.max(rtl ? -maxX : 0, Math.min(rtl ? 0 : maxX, x + dx));
    const toY = Math.max(0, Math.min(maxY, y + dy));
    if (Math.abs(toX - x) > 0.5 || Math.abs(toY - y) > 0.5) {
      moves.push({ el, x, y, toX, toY, height: el.clientHeight, sx: p.sx, sy: p.sy });
      projected.x -= (toX - x) * p.sx;
      projected.y -= (toY - y) * p.sy;
      remaining -= toY - y;
    }
    if (request.kind === "pointer" && (Math.abs(remaining) < 0.5 || (canY && /contain|none/.test(css.overscrollBehaviorY)))) break;
  }
  const backward = moves.some((m) => m.toY - m.y < -m.height * 0.25);
  if (backward && request.back === false) throw new Error("The target would scroll BACK by more than a quarter of its scroll container. Use a more specific selector, or pass `back: true` if going back is intended.");
  if (!moves.length) return empty();

  const styles = [...new Set(moves.map((m) => m.el === root ? document.documentElement : m.el))].map((el) => {
    const style = (el as HTMLElement).style;
    return { style, saved: ["scroll-behavior", "scroll-snap-type"].map((name) => ({ name, value: style.getPropertyValue(name), priority: style.getPropertyPriority(name) })) };
  });
  try {
    for (const { style } of styles) { style.setProperty("scroll-behavior", "auto", "important"); style.setProperty("scroll-snap-type", "none", "important"); }
    const apply = (t: number) => {
      if (!target.isConnected) throw new Error("The scroll target disappeared while the page was moving.");
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      for (const m of moves) m.el.scrollTo(m.x + (m.toX - m.x) * eased, m.y + (m.toY - m.y) * eased);
    };
    if (request.duration === 0) apply(1);
    else await new Promise<void>((resolve, reject) => {
      const start = performance.now();
      const tick = (now: number) => {
        try {
          const t = Math.min(1, (now - start) / request.duration);
          apply(t);
          if (t < 1) requestAnimationFrame(tick);
          else resolve();
        } catch (error) { reject(error); }
      };
      requestAnimationFrame(tick);
    });
  } finally {
    for (const { style, saved } of styles) for (const { name, value, priority } of saved) {
      if (value) style.setProperty(name, value, priority);
      else style.removeProperty(name);
    }
  }
  const x = moves.reduce((n, m) => n + m.el.scrollLeft - m.x, 0);
  const y = moves.reduce((n, m) => n + m.el.scrollTop - m.y, 0);
  return { ...measure(), x, y, moved: Math.abs(x) > 0.5 || Math.abs(y) > 0.5, backward, containers: moves.length, windowY: window.scrollY };
}

export async function targetGeometry(page: Page, selector: string, timeout = 4000): Promise<TargetGeometry | null> {
  const target = page.locator(selector).first();
  if (!await target.boundingBox({ timeout }).catch(() => null)) return null;
  return target.evaluate(inPage, { kind: "inspect", at: 0.26, duration: 0 } satisfies ScrollRequest, { timeout });
}

/** Semantic alignment inside a scrollport, followed by the minimum outer reveal. */
export async function scrollToTarget(page: Page, selector: string, options: { at?: number; duration?: number; onlyIfNeeded?: boolean; back?: boolean } = {}): Promise<ScrollResult> {
  const at = options.at ?? 0.26, duration = options.duration ?? 0;
  if (!Number.isFinite(at) || at < 0 || at > 1 || !Number.isFinite(duration) || duration < 0) throw new Error("A scroll needs an alignment from zero to one and a nonnegative duration.");
  return page.locator(selector).first().evaluate(inPage, { kind: "target", at, duration, onlyIfNeeded: options.onlyIfNeeded, back: options.back } satisfies ScrollRequest, { timeout: 4000 });
}

/** Legacy authored wheel distance follows the scrollable element under the cursor. */
export async function scrollAtPointer(page: Page, y: number, duration: number, pointer: { x: number; y: number }): Promise<ScrollResult> {
  if (!Number.isFinite(y) || !Number.isFinite(duration) || duration < 0) throw new Error("A scroll needs a finite distance and a nonnegative duration.");
  return page.locator("html").evaluate(inPage, { kind: "pointer", at: 0.26, duration, delta: y, pointer } satisfies ScrollRequest, { timeout: 4000 });
}
