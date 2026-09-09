/* Measured editorial layout, sampled after the declared entrances and typing settle. */
import { secondsOf, stage, type RenderPlan, type ReviewCheck } from "@panoma/video-core";
import type { CompositionDef } from "@panoma/video-engine";
import { RasterPool, type LintFinding } from "@panoma/video-engine/rasterizer";
import { startAssetServer } from "@panoma/video-engine/server";

export type PromoLayoutSample = { frame: number; scenes: string[] };
type TextSpan = { from: number; to: number; readFrom?: number; id?: string };
const valid = (span: TextSpan, duration: number) => [span.from, span.to, span.readFrom ?? span.from].every(Number.isInteger) &&
  span.from >= 0 && span.to <= duration && span.from <= (span.readFrom ?? span.from) && (span.readFrom ?? span.from) < span.to;

/** The whole visible group must settle, including later rows in a shared recap. */
export function promoLayoutSamples(plan: RenderPlan): PromoLayoutSample[] {
  const spans = [...plan.cards, ...(plan.texts ?? [])];
  if (!Number.isInteger(plan.durationInFrames) || plan.durationInFrames <= 0 || spans.some((span) => !valid(span, plan.durationInFrames))) {
    throw new Error("Editorial layout needs finite whole-frame spans with a reading hold inside the composition.");
  }
  const samples = new Map<number, Set<string>>();
  for (const [index, span] of spans.entries()) {
    const overlapping = spans.filter((other) => other.from < span.to && other.to > span.from);
    const from = Math.max(span.readFrom ?? span.from, ...overlapping.map((other) => other.readFrom ?? other.from));
    const to = Math.min(span.to, ...overlapping.map((other) => other.to));
    if (from >= to) throw new Error("Overlapping editorial elements have no shared settled reading frame.");
    for (const frame of [from, Math.floor((from + to - 1) / 2), to - 1]) {
      const scenes = samples.get(frame) ?? new Set<string>();
      scenes.add(span.id ?? `card-${index + 1}`);
      samples.set(frame, scenes);
    }
  }
  return [...samples].sort(([a], [b]) => a - b).map(([frame, scenes]) => ({ frame, scenes: [...scenes] }));
}

/** Browser measurements concern added text; recorded pixels cannot be DOM-audited. */
export async function reviewPromoLayout(input: {
  comp: CompositionDef;
  plan?: RenderPlan;
  assetsDir: string;
  sessionsDir?: string;
  signal?: AbortSignal;
}): Promise<ReviewCheck[]> {
  const { comp, plan } = input;
  if (plan && plan.recipe !== "ProductPromo") return [];
  const unavailable = (why: string): ReviewCheck[] => [{ id: "layout.measured", status: "fail", summary: why,
    source: "house rule: measure the actual settled editorial DOM against the platform-safe Stage",
    fix: { by: "engine", hint: "Restore the composition's declared reading spans and renderable assets before exporting; do not treat an unmeasured layout as passed." } }];
  if (!plan) return unavailable("The promotional composition is missing its layout reading plan.");
  if (plan.durationInFrames !== comp.durationInFrames || plan.fps !== comp.fps) return unavailable("The layout plan and composition use different clocks.");
  let samples: PromoLayoutSample[];
  try { samples = promoLayoutSamples(plan); } catch (error) { return unavailable(String(error)); }
  if (!samples.length) return unavailable("No settled editorial frames are declared for this promotional composition.");
  const safe = stage(comp.format);
  if (![safe.x, safe.y, safe.width, safe.height].every(Number.isFinite) || safe.width <= 0 || safe.height <= 0) return unavailable("The format has no positive platform-safe Stage for editorial text.");
  const findings: { sample: PromoLayoutSample; finding: LintFinding }[] = [];
  const server = await startAssetServer({ assets: input.assetsDir, sessions: input.sessionsDir });
  let pool: RasterPool | undefined;
  try {
    await import("@panoma/video-engine/register");
    const { renderFrameHtml } = await import("@panoma/video-engine");
    pool = await RasterPool.start({ origin: server.origin, width: comp.format.width, height: comp.format.height, parallel: 1 });
    const element = comp.element();
    for (const sample of samples) {
      input.signal?.throwIfAborted();
      const html = renderFrameHtml(element, { frame: sample.frame, fps: comp.fps, durationInFrames: comp.durationInFrames, format: comp.format });
      for (const finding of await pool.lint(html, safe)) findings.push({ sample, finding });
    }
  } catch (error) {
    input.signal?.throwIfAborted();
    return unavailable(`The settled layout could not be measured: ${String(error).split("\n")[0]}`);
  } finally {
    await pool?.close();
    await server.close();
  }
  const descriptions = {
    overflow: ["Editorial containers do not clip their settled contents.", "Settled editorial content exceeds a clipping container."],
    outside: ["Settled editorial text stays inside the platform-safe Stage.", "Settled editorial text crosses the platform-safe Stage."],
    collapsed: ["Settled editorial text has measurable line boxes.", "Editorial text collapses to an empty line box during its reading hold."],
  } as const;
  return (Object.keys(descriptions) as LintFinding["kind"][]).map((kind): ReviewCheck => {
    const broken = findings.filter(({ finding }) => finding.kind === kind);
    const frames = [...new Set(broken.map(({ sample }) => sample.frame))];
    return { id: `layout.${kind}`, status: broken.length ? "fail" : "pass", summary: descriptions[kind][broken.length ? 1 : 0],
      threshold: "No findings at the start, middle and end of each settled reading group; 1 px geometry tolerance.",
      source: "house rule: Chromium text rectangles and clipping-container bounds, measured against Format.safe via Stage",
      ...(frames.length ? { at: frames.map((frame) => ({ frame, seconds: secondsOf(frame, comp.fps) })) } : {}),
      details: { samples, stage: safe, findings: broken.map(({ sample, finding }) => ({ frame: sample.frame, seconds: secondsOf(sample.frame, comp.fps), scenes: sample.scenes, ...finding })),
        scope: "Added DOM text and its containers only. Recorded product pixels, image legibility, motion between samples and aesthetic quality are not certified." },
      fix: broken.length ? { by: "engine", hint: `Fix the ${kind} layout at the listed scenes and frames. Keep the actual words and source evidence intact; check layout again before export.`, args: { composition: comp.id, frames } }
        : { by: "none", hint: "nothing to do" } };
  });
}
