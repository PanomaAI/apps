/*
  Timing, in the recorder's own units so a generated script reads like a written
  one. Plain constants in a leaf module: the walk and the re-walk both need them,
  and a constant that lives inside either would make the two import each other.

  - SCROLL_AT / SCROLL_MS are `recordSession`'s defaults for scrollTo (0.26 of the
    viewport, 1100 ms — packages/capture/src/session.ts), written out so the
    script is explicit about them.
  - CLICK_AT is where the hand-written session in briefs/sessions/index.ts puts a
    thing it is about to click (0.4-0.45): high enough that what the click reveals
    shares the frame, low enough that the cursor's arrival is not at the edge.
  - Reading pauses follow the visible content. Source recording time has no beat
    constraint: the renderer puts cuts on its grid after narration is measured.
    HOLD_MS / AFTER_CLICK_MS remain exports for existing authored scripts.
*/
import type { SessionStep } from "@panoma/video-capture";
import type { SnapshotNode } from "./snapshot.ts";

export const SCROLL_AT = 0.26;
export const SCROLL_MS = 1100;
export const CLICK_AT = 0.4;
export const HOLD_MS = 1000;
export const AFTER_CLICK_MS = 1500;
export const CHROME_MS = 500;

/** Minimum real footage for a short tutorial sentence, before the settlement check. */
export const LESSON_HOLD_MS = 2600;

/**
 * Budget for reading what this step reveals, not all the copy on the page. A press
 * counts newly visible text; a heading counts its section. Navigation and footer
 * furniture contribute nothing. The result is bounded even on a long document.
 */
export function readingPause(opts: {
  nodes: readonly SnapshotNode[];
  before?: readonly SnapshotNode[];
  beforeScrollY?: number;
  focus?: string;
  scrollY: number;
  height: number;
  tutorial?: boolean;
}): Extract<SessionStep, { pause: number }> {
  const beforeY = opts.beforeScrollY ?? opts.scrollY;
  const old = new Set(opts.before?.filter((node) => (!node.landmark || !["navigation", "banner", "contentinfo"].includes(node.landmark)) &&
    (!node.box || (node.box.y + node.box.h > beforeY && node.box.y < beforeY + opts.height)))
    .flatMap((node) => [node.name.trim(), node.text?.trim() ?? ""]) ?? []);
  const focus = opts.focus ? opts.nodes.findIndex((node) => node.role === "heading" && node.name === opts.focus) : -1;
  const level = focus >= 0 ? opts.nodes[focus].level ?? 6 : 6;
  const content = new Set<string>();
  for (let i = Math.max(0, focus); i < opts.nodes.length; i++) {
    const node = opts.nodes[i];
    if (focus >= 0 && i > focus && node.role === "heading" && (node.level ?? 6) <= level) break;
    if (node.landmark && ["navigation", "banner", "contentinfo"].includes(node.landmark)) continue;
    if (node.box && (node.box.y + node.box.h <= opts.scrollY || node.box.y >= opts.scrollY + opts.height)) continue;
    for (const text of [node.name.trim(), node.text?.trim() ?? ""]) {
      if (text && !old.has(text)) content.add(text);
    }
  }
  const segments = new Intl.Segmenter(undefined, { granularity: "word" }).segment([...content].join(" "));
  const words = Math.min(24, [...segments].filter((segment) => segment.isWordLike).length);
  const floor = opts.tutorial ? LESSON_HOLD_MS : 1800;
  const ceiling = opts.tutorial ? 4800 : 3200;
  // Reading at 238 wpm, plus an orientation breath. These are capture budgets, not claims about speech.
  const ms = Math.min(ceiling, Math.max(floor, 600 + words * 60_000 / 238));
  return { pause: Math.ceil(ms / 100) * 100, settled: true };
}
