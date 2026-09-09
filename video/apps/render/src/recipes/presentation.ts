/* Responsive composition and effect arithmetic. All time is the composition clock. */
import { stage, type EditorialTheme, type Format } from "@panoma/video-core";
import type { CastFrame, CastShot, PromoProof } from "./timing.ts";

type Rect = { x: number; y: number; width: number; height: number };

/** The copy owns one safe panel and the moving product owns another, with no overlap. */
export function promoPanelLayout(format: Format, viewport: { width: number; height: number }, opts: { isMobile?: boolean; videoRatio?: number } = {}): { text: Rect; product: CastFrame; axis: "columns" | "stack" } {
  const safe = stage(format);
  const unit = Math.min(safe.width, safe.height);
  const columns = safe.width / safe.height >= 1.35;
  const gap = unit * (columns ? 0.055 : 0.04);
  const text = columns
    ? { x: safe.x, y: safe.y, width: (safe.width - gap) * 0.34, height: safe.height }
    : { x: safe.x, y: safe.y, width: safe.width, height: unit * 0.2 };
  const slot = columns
    ? { x: text.x + text.width + gap, y: safe.y, width: safe.width - text.width - gap, height: safe.height }
    : { x: safe.x, y: text.y + text.height + gap, width: safe.width, height: safe.height - text.height - gap };
  const device = opts.isMobile ?? false;
  const chromeSize = unit * (device ? 0.013 : 0.031);
  const padW = device ? chromeSize * 2 : 0;
  const padH = device ? chromeSize * 2 : chromeSize;
  const ratio = opts.videoRatio && opts.videoRatio > 0 ? opts.videoRatio : 1;
  const scale = Math.min((slot.width - padW) / viewport.width, (slot.height - padH) / viewport.height, ratio);
  const width = viewport.width * scale + padW;
  const height = viewport.height * scale + padH;
  return {
    axis: columns ? "columns" : "stack", text,
    product: { x: slot.x + (slot.width - width) / 2, y: slot.y + (slot.height - height) / 2, width, height,
      content: { x: device ? chromeSize : 0, y: chromeSize, width: viewport.width * scale, height: viewport.height * scale },
      chrome: device ? "device" : "browser", chromeSize, radius: unit * (device ? 0.044 : 0.015) },
  };
}

/** Wait for the result AND camera; the mask never implies a result before the tape shows it. */
export function promoFocusOpacity(proof: PromoProof, shots: CastShot[], frame: number, fps: number): number {
  if (proof.treatment !== "focus" || !proof.focusBox) return 0;
  const movements = shots.filter((shot) => shot.from >= proof.from && shot.to <= proof.to &&
    (shot.start.fx !== shot.end.fx || shot.start.fy !== shot.end.fy || shot.start.scale !== shot.end.scale));
  const from = Math.max(proof.resultFrom, ...movements.map((shot) => shot.to));
  const length = Math.max(1, Math.min(Math.round(fps * 0.3), proof.to - from));
  const progress = Math.max(0, Math.min(1, (frame - from) / length));
  /* A full-picture veil needs equal small steps: ease-out front-loads enough luma
     change into its first frame to look like an extra, off-grid cut. */
  return progress;
}

/** Rows reserve their space from the start. Only the newly presented row moves. */
export function promoRowArrivalFrames(fps: number, theme: EditorialTheme = "flat"): number {
  return Math.max(1, Math.round(fps * (theme === "grid" ? 0.32 : theme === "vibrant" ? 0.18 : 0.26)));
}

export function promoRowState(rows: readonly { from: number }[], index: number, frame: number, fps: number, theme: EditorialTheme = "flat"): { visible: boolean; active: boolean; progress: number; checked: number } {
  const row = rows[index];
  const visible = Boolean(row && frame >= row.from);
  const progress = visible ? Math.min(1, (frame - row.from + 1) / promoRowArrivalFrames(fps, theme)) : 0;
  const settles = index === rows.length - 1 ? row.from + Math.ceil(fps * 0.65) : rows[index + 1].from;
  const checked = visible ? Math.max(0, Math.min(1, (frame - settles) / Math.max(1, Math.round(fps * (theme === "vibrant" ? 0.16 : 0.22))))) : 0;
  return { visible, active: visible && frame < settles, progress: 1 - (1 - progress) ** 3, checked };
}

/** Reveal whole Unicode code points. These are typeset examples, not an executed terminal. */
export function promoTypedCount(text: string, from: number, typingTo: number, frame: number): number {
  const length = [...text].length;
  const share = Math.max(0, Math.min(1, (frame - from) / Math.max(1, typingTo - from)));
  return Math.min(length, Math.floor(length * share));
}
