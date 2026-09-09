/*
  One idea, several canvases. A recipe never hard-codes pixels for one aspect ratio;
  it lays itself out against the format it receives — responsive design, but for video.

  Safe areas are the pixels the platform UI covers (username, caption, action rail,
  progress bar). Text or product UI placed there is technically on screen and practically
  invisible. The numbers are the union of TikTok / Reels / Shorts overlays so one render
  survives all three; refine per-platform only if a piece is made for a single app.
*/

export type FormatId = "v" | "h" | "s";

export type Format = {
  readonly id: FormatId;
  readonly width: number;
  readonly height: number;
  /** Pixels covered (or at risk) at each edge across TikTok/Reels/Shorts UI. */
  readonly safe: { top: number; bottom: number; left: number; right: number };
  /** Where this format is published. */
  readonly targets: readonly string[];
};

export const FORMATS: Record<FormatId, Format> = {
  v: {
    id: "v",
    width: 1080,
    height: 1920,
    safe: { top: 220, bottom: 420, left: 90, right: 120 },
    targets: ["tiktok", "reels", "shorts"],
  },
  h: {
    id: "h",
    width: 1920,
    height: 1080,
    safe: { top: 60, bottom: 120, left: 90, right: 90 },
    targets: ["youtube", "x", "linkedin", "producthunt", "web"],
  },
  s: {
    id: "s",
    width: 1080,
    height: 1080,
    safe: { top: 60, bottom: 140, left: 60, right: 60 },
    targets: ["x", "linkedin"],
  },
} as const;

/** The stage that remains once the platform UI has taken its share. */
export function stage(f: Format) {
  return {
    x: f.safe.left,
    y: f.safe.top,
    width: f.width - f.safe.left - f.safe.right,
    height: f.height - f.safe.top - f.safe.bottom,
  };
}
