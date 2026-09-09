/* A historical export is reviewed against its own frozen story, never today's draft. */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import type { CompositionDef } from "@panoma/video-engine";
import type { ReviewCheck, ReviewReport, RenderPlan } from "@panoma/video-core";
import { NEVER_A_SOURCE } from "@panoma/video-core";
import { overall, reviewVideo, type ReviewOptions } from "@panoma/video-review";
import { parseBrief } from "./schema.ts";
import { storyChecks } from "./story-checks.ts";

type StoryInput = Parameters<typeof storyChecks>[0];
type FileBinding = { file: string; sha256: string; bytes: number };
export type ExportReviewContext = {
  version: 1;
  compositionId: string;
  encoded: FileBinding;
  media: FileBinding[];
  options: ReviewOptions;
  story: StoryInput;
  /** These browser measurements belong to the unchanged original encoded image. */
  layout: ReviewCheck[];
  originalRenderedAt: string;
  integrity: string;
};

const MEDIA = new Set([".mp4", ".mov", ".webm", ".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac", ".ttf", ".woff", ".woff2"]);
const canonical = (value: unknown): string => JSON.stringify(value);
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
async function binding(file: string, signal?: AbortSignal): Promise<FileBinding> {
  signal?.throwIfAborted();
  if (!isAbsolute(file) || !MEDIA.has(extname(file).toLowerCase()) || NEVER_A_SOURCE.test(file)) throw new Error("Historical review accepts only absolute media paths from the saved export context.");
  const info = await stat(file).catch(() => { throw new Error(`Original review material is missing: ${file}. The existing full report is preserved.`); });
  if (!info.isFile()) throw new Error(`Original review material is not a file: ${file}.`);
  const sha = createHash("sha256");
  for await (const chunk of createReadStream(file)) { signal?.throwIfAborted(); sha.update(chunk); }
  return { file, sha256: sha.digest("hex"), bytes: info.size };
}

/** Called after the original full review; it saves data, not a live composition factory. */
export async function captureReviewContext(input: StoryInput & {
  file: string;
  comp: CompositionDef;
  assetsDir: string;
  sessionsDir?: string;
  review: ReviewReport;
  signal?: AbortSignal;
}): Promise<ExportReviewContext> {
  const { comp, plan } = input;
  if (!plan || plan.fps !== comp.fps || plan.durationInFrames !== comp.durationInFrames) throw new Error("The exported review needs the original matching composition plan.");
  if (resolve(input.review.file) !== resolve(input.file) || input.review.measured.width !== comp.format.width || input.review.measured.height !== comp.format.height ||
      Math.abs(input.review.measured.fps - comp.fps) > 0.01 || Math.abs(input.review.measured.seconds - comp.durationInFrames / comp.fps) > 1 / comp.fps) {
    throw new Error("The original review does not match this exported file and composition clock.");
  }
  const sourcePaths = (input.takes ?? []).flatMap((take) => [take.video,
    ...(take.frames ?? []).map((entry) => entry.file), ...(take.elements ?? []).map((entry) => entry.file),
    ...(take.macros ?? []).flatMap((entry) => [entry.file, entry.after?.file, entry.afterControl?.file].filter((file): file is string => Boolean(file))),
  ]).map((file) => resolve(input.sessionsDir ?? input.assetsDir, file));
  const files = [...new Set([...sourcePaths, ...comp.audio.map((clip) => resolve(clip.path))])].sort();
  const [encoded, media] = await Promise.all([binding(resolve(input.file), input.signal), Promise.all(files.map((file) => binding(file, input.signal)))]);
  const story: StoryInput = { brief: input.brief, facts: input.facts, plan, ...(input.takes ? { takes: input.takes } : {}),
    ...(input.tour ? { tour: input.tour } : {}), ...(input.promoCandidates ? { promoCandidates: input.promoCandidates } : {}),
    ...(input.staticSite !== undefined ? { staticSite: input.staticSite } : {}), ...(input.captions ? { captions: input.captions } : {}) };
  const context = JSON.parse(JSON.stringify({ version: 1, compositionId: comp.id, encoded, media,
    options: { targets: comp.format.targets.filter((target) => ["youtube", "shorts", "tiktok", "reels", "x", "linkedin"].includes(target)),
      plannedCuts: plan.cuts.map((cut) => cut.frame / comp.fps),
      declaredHolds: [...plan.holds, ...plan.cards].map((hold) => ({ from: hold.from / comp.fps, to: hold.to / comp.fps })),
      recipe: input.brief.recipe, expectSilent: comp.audio.length === 0 },
    story, layout: input.review.checks.filter((check) => check.id.startsWith("layout.")), originalRenderedAt: input.review.renderedAt,
  })) as Omit<ExportReviewContext, "integrity">;
  if (input.brief.recipe === "ProductPromo" && !context.layout.length) throw new Error("The original promotion has no measured layout checks to preserve.");
  return { ...context, integrity: hash(context) };
}

const FileSchema = z.object({ file: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative() }).strict();
const ContextSchema = z.object({ version: z.literal(1), compositionId: z.string(), encoded: FileSchema, media: z.array(FileSchema),
  options: z.object({ targets: z.array(z.string()), plannedCuts: z.array(z.number()), declaredHolds: z.array(z.object({ from: z.number(), to: z.number() })), recipe: z.string(), expectSilent: z.boolean() }).strict(),
  story: z.record(z.string(), z.unknown()), layout: z.array(z.object({ id: z.string(), status: z.enum(["pass", "warn", "fail", "skip"]), summary: z.string() }).passthrough()),
  originalRenderedAt: z.string(), integrity: z.string(),
}).strict();

function parsedContext(value: unknown): ExportReviewContext {
  if (!ContextSchema.safeParse(value).success) throw new Error("The historical export has no valid original review context. Its existing full report is preserved; export it again to capture a reviewable snapshot.");
  const context = value as ExportReviewContext;
  const { integrity, ...payload } = context;
  if (hash(payload) !== integrity) throw new Error("The saved historical review context changed. The existing full report is preserved.");
  parseBrief(context.story.brief);
  const plan = context.story.plan;
  if (!plan || plan.recipe !== context.story.brief.recipe || !Number.isFinite(plan.fps) || plan.fps <= 0 || !Number.isInteger(plan.durationInFrames) ||
      !Array.isArray(plan.cuts) || !Array.isArray(plan.holds) || !Array.isArray(plan.cards) || !context.story.facts?.facts ||
      !context.story.facts.notFacts || (context.story.brief.recipe === "ProductPromo" && context.layout.length === 0)) {
    throw new Error("The original story, plan or layout evidence is incomplete. The existing full report is preserved.");
  }
  return context;
}

async function unchanged(context: ExportReviewContext, file: string, signal?: AbortSignal): Promise<void> {
  const expected = [context.encoded, ...context.media];
  for (const [index, original] of expected.entries()) {
    const current = await binding(index === 0 ? file : original.file, signal);
    if (current.sha256 !== original.sha256 || current.bytes !== original.bytes) throw new Error(`Original ${index === 0 ? "encoded video" : "review material"} changed: ${current.file}. The existing full report is preserved; review a new export instead.`);
  }
}

/** Frozen encoded clocks are authoritative; manual overrides cannot relabel an old film. */
export async function reviewExportFile(file: string, overrides: ReviewOptions = {}, signal?: AbortSignal): Promise<ReviewReport | undefined> {
  file = resolve(file);
  const base = file.replace(/\.(?:mp4|mov|webm)$/i, "");
  let metadata: { revision?: unknown; compositionId?: unknown; reviewContext?: unknown };
  try { metadata = JSON.parse(await readFile(`${base}.export.json`, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (/--r-/.test(base)) throw new Error("The versioned export is missing its original export metadata. The existing full report is preserved.");
      return undefined;
    }
    throw new Error("The export metadata is invalid. The existing full report is preserved.");
  }
  if (!metadata || typeof metadata !== "object") throw new Error("The export metadata is invalid. The existing full report is preserved.");
  const context = parsedContext(metadata.reviewContext);
  if (metadata.compositionId !== context.compositionId || typeof metadata.revision !== "string") throw new Error("The export metadata and frozen review context identify different compositions.");
  for (const [key, value] of Object.entries(overrides)) if (value !== undefined && canonical(value) !== canonical(context.options[key as keyof ReviewOptions])) {
    throw new Error(`A historical export owns its ${key}; omit the override to re-review its original plan.`);
  }
  await unchanged(context, file, signal);
  const planFile = await readFile(`${base}.plan.json`, "utf8").then((raw) => JSON.parse(raw) as RenderPlan).catch(() => undefined);
  if (!planFile || hash(planFile) !== hash(context.story.plan)) throw new Error("The original plan sidecar is missing or changed. The existing full report is preserved.");
  const encoded = await reviewVideo(file, context.options);
  signal?.throwIfAborted();
  const checks = [...encoded.checks, ...storyChecks(context.story), ...context.layout, {
    id: "review.original-context", status: "pass" as const,
    summary: `Reviewed exported revision ${metadata.revision} from its original story and unchanged media; retained its original measured layout checks.`,
    details: { revision: metadata.revision, compositionId: context.compositionId, originalRenderedAt: context.originalRenderedAt,
      scope: "Encoded checks and frozen-story checks were rerun. Layout checks are the measurements retained from the original export, not a rendering of the current draft." },
    fix: { by: "none" as const, hint: "nothing to do" },
  }];
  await unchanged(context, file, signal);
  return { ...encoded, checks, status: overall(checks) };
}

/** Replace a report only after every requested historical check succeeded. */
export async function writeReviewReport(file: string, report: ReviewReport): Promise<void> {
  const absolute = resolve(file);
  const out = /\.(mp4|mov|webm)$/i.test(absolute) ? absolute.replace(/\.(mp4|mov|webm)$/i, ".review.json") : `${absolute}.review.json`;
  const temporary = join(dirname(out), `.${randomUUID()}.review.tmp`);
  try { await writeFile(temporary, JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); await rename(temporary, out); }
  finally { await rm(temporary, { force: true }); }
}
