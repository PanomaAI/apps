/* The automatic path and Studio judge the same encoded file against the same story. */
import type { CompositionDef } from "@panoma/video-engine";
import { overall, reviewVideo } from "@panoma/video-review";
import type { ReviewReport } from "@panoma/video-core";
import { storyChecks } from "./story-checks.ts";
import { reviewPromoLayout } from "./layout-review.ts";

export async function reviewComposition(input: Parameters<typeof storyChecks>[0] & {
  file: string;
  comp: CompositionDef;
  assetsDir: string;
  sessionsDir?: string;
  signal?: AbortSignal;
}): Promise<ReviewReport> {
  const { file, comp, plan, brief } = input;
  const review = await reviewVideo(file, {
    targets: comp.format.targets.filter((target) => ["youtube", "shorts", "tiktok", "reels", "x", "linkedin"].includes(target)),
    plannedCuts: plan?.cuts.map((cut) => cut.frame / comp.fps),
    declaredHolds: [...(plan?.holds ?? []), ...(plan?.cards ?? [])].map((hold) => ({ from: hold.from / comp.fps, to: hold.to / comp.fps })),
    recipe: brief.recipe,
    expectSilent: comp.audio.length === 0,
  });
  input.signal?.throwIfAborted();
  const layout = brief.recipe === "ProductPromo" ? await reviewPromoLayout(input) : [];
  const checks = [...review.checks, ...storyChecks(input), ...layout];
  return { ...review, checks, status: overall(checks) };
}
