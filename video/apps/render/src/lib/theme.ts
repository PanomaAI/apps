/** Compatibility exports for the house palette; colours live in the shared light theme. */
import { LIGHT_PALETTE } from "@panoma/video-core/theme";
import { alphaOf } from "@panoma/video-brand/direction";

export const color = LIGHT_PALETTE;

export function inkAlpha(alpha: number): string {
  return alphaOf(color.ink, alpha);
}
