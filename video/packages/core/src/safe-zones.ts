/*
  Safe zones, per target, with a source for every number.

  The layout in format.ts uses ONE rectangle per canvas: the union of what TikTok, Reels
  and Shorts paint over a vertical video. Every recipe lays out against that union, and
  it stays — a recipe that asked "which platform am I on?" would render the same brief
  differently per target, which is exactly what the format abstraction exists to
  prevent. But the union is smaller than the one platform that publishes numbers. Meta's
  Reels guide reserves 35% of the bottom and the union reserves 21.9%, so a caption at
  y=1300 on a 1080x1920 canvas passes layout today and sits under Instagram's own
  caption strip. Nothing said so, because nothing knew the number.

  This module is what `panoma-video review` reports against. It answers, per rendered cut,
  "which target does this rectangle violate, on which edge, by how many pixels" — and
  leaves the owner to decide whether the Reels zone becomes the layout rule (it removes
  a third of the canvas) or stays a warning. That decision is recorded in open questions;
  this file only makes the number visible. Every entry says where it came from and
  whether a platform published it or a community measured it, because these numbers
  move, and a pixel count without a source cannot be re-verified when they do.
*/
import { FORMATS } from "./format.ts";
import type { Format, FormatId } from "./format.ts";

/** Where a cut is published. The strings in `Format.targets` are these. */
export type Target = "tiktok" | "reels" | "shorts" | "youtube" | "x" | "linkedin" | "producthunt" | "web";

export const TARGETS: readonly Target[] = ["tiktok", "reels", "shorts", "youtube", "x", "linkedin", "producthunt", "web"];

export type Edge = "top" | "bottom" | "left" | "right";

export const EDGES: readonly Edge[] = ["top", "bottom", "left", "right"];

/**
 * "official" is a number the platform (or a standards body) published; "community" is
 * what third-party overlay templates converge on, or the engine's own union where nothing
 * better exists. A review may fail on the first and only warn on the second.
 */
export type ZoneKind = "official" | "community";

export type SafeZone = {
  /** Pixels reserved at each edge, on the canonical canvas of the format. */
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  /** URL of the page the number was read from, or that failed to publish one. */
  readonly source: string;
  /** ISO date the source was last checked. */
  readonly verified: string;
  readonly kind: ZoneKind;
};

export function isTarget(value: string): value is Target {
  return (TARGETS as readonly string[]).includes(value);
}

function assertTarget(value: string): Target {
  if (isTarget(value)) return value;
  throw new Error(`Unknown target "${value}". Targets are: ${TARGETS.join(", ")}.`);
}

/* ---------- The table ---------- */

const VERIFIED = "2026-09-01";

const zone = (
  edges: readonly [top: number, bottom: number, left: number, right: number],
  kind: ZoneKind,
  source: string,
): SafeZone => ({ top: edges[0], bottom: edges[1], left: edges[2], right: edges[3], kind, source, verified: VERIFIED });

/*
  The union rectangles are the ones in format.ts, restated here so a change there
  shows up as a failing review rather than as a silently moved goalpost. They come
  from the overlays third-party safe-zone templates converge on: vertical top 130-150,
  bottom 440-484, right 120-140, left 60 px, widened to survive all three apps at once.
*/
const UNION_V = [220, 420, 90, 120] as const;
const UNION_H = [60, 120, 90, 90] as const;
const UNION_S = [60, 140, 60, 60] as const;

/*
  Meta, Instagram Reels ads guide: "Consider leaving at least 14% of the top, 35% of
  the bottom, and 6% on each side of your asset free from text, logos, or other
  important creative elements." On 1080x1920: 268.8 → 269, 672, 64.8 → 65.
  https://www.facebook.com/business/ads-guide/update/video/instagram-reels
*/
const REELS_URL = "https://www.facebook.com/business/ads-guide/update/video/instagram-reels";
const REELS_V = [Math.round(0.14 * 1920), Math.round(0.35 * 1920), Math.round(0.06 * 1080), Math.round(0.06 * 1080)] as const;

/*
  EBU R 95 (2017), "Safe areas for 16:9 television production": the graphics-safe area
  is 90% of the picture in each dimension, i.e. 5% at every edge. Nothing overlays a
  plain web player, so this broadcast floor is the honest number for `web`.
  https://tech.ebu.ch/publications/r095
*/
const EBU_URL = "https://tech.ebu.ch/publications/r095";
const ebu = (width: number, height: number) =>
  [Math.round(0.05 * height), Math.round(0.05 * height), Math.round(0.05 * width), Math.round(0.05 * width)] as const;

/* Pages checked for a published safe zone. None of these prints one. */
const TIKTOK_URL = "https://ads.tiktok.com/help/article/video-ads-specifications";
const SHORTS_URL = "https://support.google.com/youtube/answer/10059070";
const YOUTUBE_URL = "https://support.google.com/youtube/answer/1722171";
const X_URL = "https://help.x.com/en/using-x/x-videos";
const LINKEDIN_URL = "https://business.linkedin.com/advertise/ads/sponsored-content/video-ads/specs";
/* Product Hunt plays a YouTube embed, so YouTube's player is the overlay that applies. */
const PRODUCTHUNT_URL = "https://www.producthunt.com/launch";

const union = (source: string): Record<FormatId, SafeZone> => ({
  v: zone(UNION_V, "community", source),
  h: zone(UNION_H, "community", source),
  s: zone(UNION_S, "community", source),
});

export const SAFE_ZONES: Record<Target, Record<FormatId, SafeZone>> = {
  tiktok: union(TIKTOK_URL),
  reels: { ...union(REELS_URL), v: zone(REELS_V, "official", REELS_URL) },
  shorts: union(SHORTS_URL),
  youtube: union(YOUTUBE_URL),
  x: union(X_URL),
  linkedin: union(LINKEDIN_URL),
  producthunt: union(PRODUCTHUNT_URL),
  web: {
    v: zone(ebu(FORMATS.v.width, FORMATS.v.height), "official", EBU_URL),
    h: zone(ebu(FORMATS.h.width, FORMATS.h.height), "official", EBU_URL),
    s: zone(ebu(FORMATS.s.width, FORMATS.s.height), "official", EBU_URL),
  },
};

/** The zone one target reserves on one canvas. Throws on a target this table does not know. */
export function zoneOf(target: string, formatId: FormatId): SafeZone {
  return SAFE_ZONES[assertTarget(target)][formatId];
}

/* ---------- Questions the review asks ---------- */

export type StrictZone = {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  /** Which target set each edge — the one to name when a rectangle crosses it. */
  readonly by: Readonly<Record<Edge, Target>>;
};

/**
 * The largest reservation on every edge across the targets a cut is published to.
 * Defaults to the format's own targets, which is the matrix's default too.
 */
export function strictestZone(formatId: FormatId, targets: readonly string[] = FORMATS[formatId].targets): StrictZone {
  if (targets.length === 0) throw new Error("strictestZone needs at least one target.");
  const named = targets.map(assertTarget);
  const pick = (edge: Edge) => {
    let best = named[0];
    for (const t of named) if (SAFE_ZONES[t][formatId][edge] > SAFE_ZONES[best][formatId][edge]) best = t;
    return best;
  };
  const by = { top: pick("top"), bottom: pick("bottom"), left: pick("left"), right: pick("right") };
  return {
    top: SAFE_ZONES[by.top][formatId].top,
    bottom: SAFE_ZONES[by.bottom][formatId].bottom,
    left: SAFE_ZONES[by.left][formatId].left,
    right: SAFE_ZONES[by.right][formatId].right,
    by,
  };
}

/** A measured rectangle on the canvas — a caption line, a CTA, a logo — with a name to report. */
export type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly label: string };

export type ZoneViolation = {
  readonly target: Target;
  readonly label: string;
  readonly rect: Rect;
  readonly edge: Edge;
  /** Whole pixels the rectangle reaches into the reserved strip. Never below 1. */
  readonly by: number;
  readonly kind: ZoneKind;
};

/**
 * Every (target, rectangle, edge) where the rectangle crosses into a reserved strip,
 * in target order, then rectangle order, then top/bottom/left/right. A rectangle that
 * crosses two edges yields two entries; one that is fine for TikTok and not for Reels
 * yields only the Reels entry — the report names the platform, not "the safe area".
 *
 * Overlaps are rounded to whole pixels and anything under half a pixel is ignored:
 * DOM rectangles are fractional, and a 0.3 px incursion is anti-aliasing, not layout.
 */
export function zoneViolations(
  rects: readonly Rect[],
  format: FormatId | Format,
  targets?: readonly string[],
): ZoneViolation[] {
  const f = typeof format === "string" ? FORMATS[format] : format;
  const named = (targets ?? f.targets).map(assertTarget);
  const out: ZoneViolation[] = [];
  for (const target of named) {
    const z = SAFE_ZONES[target][f.id];
    for (const rect of rects) {
      const overlaps: Record<Edge, number> = {
        top: z.top - rect.y,
        bottom: rect.y + rect.h - (f.height - z.bottom),
        left: z.left - rect.x,
        right: rect.x + rect.w - (f.width - z.right),
      };
      for (const edge of EDGES) {
        const by = Math.round(overlaps[edge]);
        if (by >= 1) out.push({ target, label: rect.label, rect, edge, by, kind: z.kind });
      }
    }
  }
  return out;
}
