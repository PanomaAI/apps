/*
  The tools an agent drives panoma video with. Every one takes `project_path` and
  resolves the workspace itself — an agent should never carry an id the engine can
  derive — and every one returns a two-or-three-sentence summary ending in the next
  step, a structured mirror, and images only as content blocks.

  The slow ones (record, render, auto) report progress at most once a second and
  honour cancellation; the read-only ones say so in their annotations. Nothing here
  writes inside the project, runs its install script, or reads a .env.
*/
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { redact, wrapUntrusted, type ReviewReport } from "@panoma/video-core";
import { brandFromRepo, mergeBrand } from "@panoma/video-brand";
import { scoutProject } from "@panoma/video-scout";
import { frameAt, reportText, reviewVideo, contactSheet } from "@panoma/video-review";
import { auto, listFiles, openWorkspace, parsePatch, readJson, writeJson, studioWorkspace, StudioExportReviewError, type AutoReport, type RenderRow } from "@panoma/video-director";
import type { TourScript } from "@panoma/video-tour";
import { fail, image, link, ok, concise, type Block, type ToolResult } from "../lib/result.ts";
import { progressFor } from "../lib/progress.ts";
import { resolveProject } from "../lib/paths.ts";
import { BrainChoice, Detail, Goal, PromoTheme } from "../schemas.ts";

type Extra = Parameters<typeof progressFor>[0];

/** The workspace the scout would name — the folder's name is not the project's. */
export async function workspaceFor(root: string, workspaceId?: string) {
  const profile = await scoutProject(root);
  return openWorkspace(root, { id: workspaceId ?? profile.id });
}

export const WorkspaceId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(120).optional().describe("Stable workspace id returned by scout and retained by the host when a project moves.");
const projectPath = z.string().describe("Absolute path of the project directory (the repository root, or the app directory inside a monorepo).");
const Langs = z.array(z.enum(["en", "es"])).min(1).optional().describe('Languages to produce, default ["en","es"].');

function nextStep(report: AutoReport): string {
  const failed = Object.entries(report.stages).find(([, s]) => s.status === "failed" && s.next);
  if (failed) return `Next: ${failed[1].next!.tool} — ${failed[1].summary}`;
  const failing = report.renders.find((r) => r.review.status === "fail");
  if (failing) {
    const c = failing.review.failing[0];
    return `Next: fix ${c?.id} (${c?.fix?.by}) — ${c?.fix?.hint ?? c?.summary}`;
  }
  if (report.renders.length === 0) return "Next: panoma_video_render with a brief id from the list, or panoma_video_auto until \"preview\".";
  return "Next: look at the contact sheet; if it reads right, panoma_video_auto until \"final\" or panoma_video_render for each cut.";
}

function stagesText(report: AutoReport): string {
  return Object.entries(report.stages)
    .map(([name, s]) => `${name}: ${s.status} — ${s.summary}`)
    .join("\n");
}

/* What the brain decided, for the model reading this: each choice with its reason, and every line it was not allowed to say. */
function brainText(report: AutoReport): string {
  if (!report.brain) return "";
  const b = report.brain;
  return `Brain: ${b.driver}${b.model ? ` (${b.model})` : ""} · questions answered from cache: ${b.cached} · asked: ${b.calls}\n` + b.decisions.slice(0, 20).map((d) => `- ${d}`).join("\n") + (b.decisions.length > 20 ? `\n- … and more in ${b.log}: ${b.decisions.length - 20}` : "") + "\n";
}

function brainOut(report: AutoReport) {
  return report.brain ? { driver: report.brain.driver, model: report.brain.model, calls: report.brain.calls, cached: report.brain.cached, decisions: report.brain.decisions.slice(0, 40) } : undefined;
}

async function renderBlocks(row: RenderRow): Promise<Block[]> {
  const blocks: Block[] = [];
  if (row.sheet && existsSync(row.sheet)) blocks.push(await image(row.sheet));
  blocks.push(link(row.file, "the rendered cut"));
  blocks.push(link(row.review.file, "the review report"));
  blocks.push(link(row.provenance, "claims, takes and sources"));
  for (const ext of [".srt", ".vtt"]) {
    const side = row.file.slice(0, -4) + ext;
    if (existsSync(side)) blocks.push(link(side));
  }
  return blocks;
}

/* ---------- panoma_video_scout ---------- */

export const scoutInput = { project_path: projectPath, workspace_id: WorkspaceId, detail: Detail.optional() };

export async function scout(args: { project_path: string; workspace_id?: string; detail?: "concise" | "detailed" }): Promise<ToolResult> {
  const root = await resolveProject(args.project_path);
  const profile = await scoutProject(root);
  const ws = await openWorkspace(root, { id: args.workspace_id ?? profile.id });
  const { facts, ...rest } = profile;
  await writeJson(ws.paths.profile, rest);
  await writeJson(ws.paths.facts, facts);
  let brand: { primary: string; confidence: string; scheme: string } | undefined;
  try {
    const b = mergeBrand(await brandFromRepo(root), {});
    await writeJson(ws.paths.brand, b);
    brand = { primary: b.colors.primary.hex, confidence: b.colors.primary.confidence, scheme: b.scheme.default };
  } catch {
    brand = undefined;
  }
  const detailed = args.detail === "detailed";
  const shown = detailed ? facts.facts : facts.facts.slice(0, 40);
  const factRows = shown.map((f) => ({ id: f.id, kind: f.kind, value: redact(f.value).text, source: f.source, ...(f.lang ? { lang: f.lang } : {}) }));
  /* The fact list is what gets trimmed in the concise form; the markers and the next step always survive. */
  const factsText = factRows.map((f) => `${f.id} = ${JSON.stringify(f.value)}  (${f.source})`).join("\n");
  const summary =
    `${profile.name} is a ${profile.kind}${profile.framework ? ` on ${profile.framework.name}` : ""}` +
    `${profile.start ? `, started with "${profile.start.command} ${profile.start.args.join(" ")}"` : ", with no documented start command"}` +
    `; routes: ${profile.routes.length}; facts: ${facts.facts.length}${profile.url ? `; deployed at ${profile.url}` : ""}.\n` +
    wrapUntrusted(detailed ? factsText : concise(factsText, 5000), "facts read from the repository") +
    `\nNext: panoma_video_record(project_path) to walk and shoot it, or panoma_video_auto(project_path, until: "preview").`;
  return ok(summary, {
    project_id: ws.id,
    project_dir: ws.dir,
    name: profile.name,
    kind: profile.kind,
    framework: profile.framework?.name,
    version: profile.version,
    url: profile.url,
    start: profile.start ? `${profile.start.command} ${profile.start.args.join(" ")}` : undefined,
    routes: profile.routes.map((r) => r.path),
    git: profile.git ? { head: profile.git.head, commits: profile.git.commits, days: profile.git.days, lastTag: profile.git.lastTag } : undefined,
    facts: factRows,
    facts_total: facts.facts.length,
    not_facts: facts.notFacts.length,
    brand,
    files: { profile: ws.paths.profile, facts: ws.paths.facts, brand: ws.paths.brand },
  });
}

/* ---------- panoma_video_record ---------- */

export const recordInput = {
  project_path: projectPath, workspace_id: WorkspaceId,
  force: z.boolean().optional().describe("Walk and shoot again even when the product's commit and the tour did not change."),
};

export async function record(args: { project_path: string; workspace_id?: string; force?: boolean }, extra: Extra): Promise<ToolResult> {
  const root = await resolveProject(args.project_path);
  const progress = progressFor(extra);
  const report = await auto({ root, projectId: args.workspace_id, until: "plan", force: args.force, signal: progress.signal, onProgress: (s, m) => progress(0, undefined, `${s}: ${m}`) });
  await progress.finish();
  const tour = report.files.tour ? await readJson<TourScript>(report.files.tour) : null;
  const ws = await openWorkspace(root, { id: report.project.id });
  const takes: { take: string; seconds: number; marks: string[] }[] = [];
  for (const take of ["desktop", "mobile"]) {
    const log = await readJson<{ durationMs: number; marks: { name: string }[] }>(join(ws.paths.sessions, `${ws.id}.${take}.session.json`));
    if (log) takes.push({ take, seconds: Math.round(log.durationMs / 100) / 10, marks: log.marks.map((m) => m.name) });
  }
  const failed = report.stages.serve.status === "failed" || report.stages.tour.status === "failed" || report.stages.record.status === "failed";
  const summary =
    `${stagesText(report)}\n` +
    (tour ? wrapUntrusted(`marks: ${tour.marks.map((m) => `${m.name} (${m.kind}: ${m.label})`).join(", ")}\ncandidates: ${tour.candidates.slice(0, 8).map((c) => `${c.description} [${c.score}]`).join(", ")}`, "what the walker found on the product's pages") + "\n" : "") +
    (failed ? nextStep(report) : `Next: panoma_video_plan(project_path) writes the briefs from these marks, or panoma_video_auto until "preview" renders the reference cut.`);
  const structured = {
    project_id: report.project.id,
    stages: { serve: report.stages.serve, tour: report.stages.tour, record: report.stages.record },
    tour: tour ? { file: report.files.tour, url: tour.url, marks: tour.marks.map((m) => ({ name: m.name, kind: m.kind, label: redact(m.label).text })), candidates: tour.candidates.slice(0, 12).map((c) => ({ description: redact(c.description).text, method: c.method, score: c.score, reasons: c.reasons })) } : undefined,
    takes,
  };
  /* A stage that failed is reported in the stages, with its next step; the call itself succeeded. */
  return ok(summary, structured, !failed && tour ? [link(report.files.tour!, "the tour script"), link(join(ws.paths.tours, `${ws.id}.flow.json`), "the same tour as a Chrome DevTools Recorder flow")] : []);
}

/* ---------- panoma_video_plan ---------- */

const LinePatch = z.object({ text: z.record(z.string(), z.string()).optional(), label: z.record(z.string(), z.string()).optional() }).strict();
export const planInput = {
  project_path: projectPath, workspace_id: WorkspaceId,
  goal: Goal.optional(),
  new_story: z.boolean().optional().describe("Explicitly start a new ProductPromo story. After the replacement plan is valid, archive the previous revision history intact instead of reusing stale edits. Omitted preserves the current story."),
  theme: PromoTheme,
  langs: Langs,
  brief_id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional().describe("The brief the patch applies to (from a previous panoma_video_plan)."),
  brief_patch: z
    .object({
      hooks: z.record(z.string(), LinePatch).optional().describe("By hook id: new text/label per language."),
      lines: z.record(z.string(), LinePatch).optional().describe("By line id: new text/label per language. Numbers must be {{fact:id}} references."),
      drop: z.array(z.string()).optional().describe("Line ids to remove."),
      voice: z.string().optional().describe("An ElevenLabs voice id, to voice a tutorial."),
    })
    .strict()
    .optional()
    .describe("Words to change, keyed by the ids you were given. Persisted beside the brief and re-applied after regeneration. An approved ProductPromo is edited through panoma_video_revise; replacing it with this patch requires explicit new_story."),
  brain: BrainChoice,
};

export async function plan(args: { project_path: string; workspace_id?: string; goal?: string; new_story?: boolean; theme?: "auto" | "normal" | "flat" | "vibrant" | "block" | "grid"; langs?: ("en" | "es")[]; brief_id?: string; brief_patch?: unknown; brain?: "auto" | "none" | "claude" | "codex" | "anthropic" | "openai" }, extra: Extra): Promise<ToolResult> {
  if (args.brief_id !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(args.brief_id)) return fail("Invalid brief_id. Next: use an exact id returned by panoma_video_plan or panoma_video_story.");
  const root = await resolveProject(args.project_path);
  const progress = progressFor(extra);
  const ws = await workspaceFor(root, args.workspace_id);
  const journals = await listFiles(join(ws.dir, "promo-revisions"), ".json");
  if (args.brief_patch) {
    if (!args.brief_id) return fail("brief_patch needs brief_id: the id of the brief to change, from a previous panoma_video_plan or panoma_video_auto result.");
    if (!args.new_story && journals.some((file) => basename(file, ".json") === args.brief_id)) {
      return fail("This promotion has saved scene revisions; brief_patch cannot change its approved story. No patch was written. Next: use panoma_video_story and panoma_video_revise, or set new_story: true to plan a replacement while archiving its history.");
    }
    const patch = parsePatch(args.brief_patch);
    const file = join(ws.paths.briefs, `${args.brief_id}.patch.json`);
    const previous = (await readJson<Record<string, unknown>>(file)) ?? {};
    await writeJson(file, { ...previous, ...patch, lines: { ...(previous.lines as object), ...(patch.lines ?? {}) }, hooks: { ...(previous.hooks as object), ...(patch.hooks ?? {}) } });
  }
  const report = await auto({ root, projectId: args.workspace_id, until: "plan", goal: args.goal as never, newStory: args.new_story,
    ...(journals.length && !args.new_story ? { camera: false } : {}),
    theme: args.theme, langs: args.langs, brain: args.brain, signal: progress.signal, onProgress: (s, m) => progress(0, undefined, `${s}: ${m}`) });
  await progress.finish();
  const briefs = [];
  for (const b of report.briefs) {
    const brief = await readJson<{ hooks: { id: string; text: Record<string, string> }[]; lines: { id: string; mark?: string; text: Record<string, string>; label?: Record<string, string> }[]; recipe: string; promo?: { theme?: "flat" | "vibrant" | "block" | "grid" } }>(b.file);
    briefs.push({ id: b.id, goal: b.goal, recipe: b.recipe, file: b.file, claims: b.claims, ...(brief?.recipe === "ProductPromo" ? { theme: brief.promo?.theme ?? "flat" } : {}), hooks: brief?.hooks.map((h) => ({ id: h.id, text: h.text })) ?? [], lines: brief?.lines.map((l) => ({ id: l.id, mark: l.mark, text: l.text, label: l.label })) ?? [] });
  }
  const claims = report.briefs.reduce((n, b) => n + b.claims, 0);
  const summary =
    `Briefs: ${report.briefs.map((b) => `${b.id} (${b.recipe}${b.claims > 0 ? `; claims to fix: ${b.claims}` : ""})`).join(", ") || "none"}.` +
    (report.skipped.length > 0 ? ` Skipped: ${report.skipped.map((s) => `${s.goal} — ${s.why}`).join("; ")}.` : "") +
    `\nEvery number in a line is a {{fact:id}}; the lines below are what will be shown or said.\n` +
    briefs.map((b) => `${b.id}${b.theme ? ` [theme: ${b.theme}]` : ""}:\n` + [...b.hooks.map((h) => `  hook ${h.id}: ${JSON.stringify(h.text)}`), ...b.lines.map((l) => `  ${l.id}${l.mark ? ` @${l.mark}` : ""}: ${JSON.stringify(l.text)}`)].join("\n")).join("\n") +
    `\n` +
    brainText(report) +
    (claims > 0 ? journals.length && !args.new_story ? `Next: panoma_video_story and panoma_video_revise to fix the saved promotion; claims to fix: ${claims}.` : `Next: panoma_video_plan with brief_id and brief_patch to fix the flagged claims; claims to fix: ${claims}.` : `Next: panoma_video_render(project_path, brief_id) for one cut, or panoma_video_auto until "preview".`);
  return ok(summary, { project_id: report.project.id, briefs, skipped: report.skipped, polish: report.polish.slice(0, 40), stages: { brain: report.stages.brain, plan: report.stages.plan }, brain: brainOut(report) }, report.briefs.map((b) => link(b.file, `brief ${b.id}`)));
}

/* ---------- panoma_video_render ---------- */

export const renderInput = {
  project_path: projectPath, workspace_id: WorkspaceId,
  brief_id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).describe("A brief id from panoma_video_plan, panoma_video_story or panoma_video_auto."),
  theme: PromoTheme,
  hook: z.string().optional().describe("Hook id; default the first."),
  lang: z.enum(["en", "es"]).optional().describe("Default the brief's first language."),
  format: z.enum(["v", "h", "s"]).optional().describe("v = 9:16, h = 16:9 (default), s = 1:1."),
  force: z.boolean().optional().describe("Render again even when nothing changed."),
  voice: z
    .string()
    .optional()
    .describe(
      'An ElevenLabs voice id for a tutorial\'s narration. Omitted means the default voice, used only when ELEVENLABS_API_KEY is set; pass "none" to render the piece silent, with its sentences drawn as type.',
    ),
  brain: BrainChoice,
};

export async function render(args: { project_path: string; workspace_id?: string; brief_id: string; theme?: "auto" | "normal" | "flat" | "vibrant" | "block" | "grid"; hook?: string; lang?: string; format?: "v" | "h" | "s"; force?: boolean; voice?: string; brain?: "auto" | "none" | "claude" | "codex" | "anthropic" | "openai" }, extra: Extra): Promise<ToolResult> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(args.brief_id)) return fail("Invalid brief_id. Next: use an exact id returned by panoma_video_plan or panoma_video_story.");
  const root = await resolveProject(args.project_path);
  const progress = progressFor(extra);
  const workspace = await workspaceFor(root, args.workspace_id);
  const stored = await readJson<{ recipe: string }>(join(workspace.paths.briefs, `${args.brief_id}.json`));
  if (stored?.recipe === "ProductPromo") {
    try {
      progress.signal?.throwIfAborted();
      const studio = await studioWorkspace(workspace.id, undefined, { projectRoot: root });
      const document = await studio.document(args.brief_id);
      const requestedTheme = args.theme === "normal" ? "flat" : args.theme;
      if (requestedTheme !== undefined && requestedTheme !== document.settings.theme) return fail("This promotion has a saved theme. Next: use panoma_video_story and panoma_video_revise to select the new theme explicitly, then render that revision.");
      if (args.voice && args.voice !== "none") return fail("ProductPromo has no narration. Next: render without voice, or use panoma_video_teach for a narrated tutorial.");
      const id = `${document.briefId}--${args.hook ?? document.brief.hooks[0].id}--${args.lang ?? document.brief.langs[0]}--${args.format ?? "h"}`;
      const comp = studio.matrix.compositions.find((entry) => entry.id === id);
      if (!comp) return fail(`No composition ${id} belongs to this promotion. Next: choose one of ${studio.matrix.compositions.filter((entry) => entry.id.startsWith(`${document.briefId}--`)).map((entry) => entry.id).join(", ")}.`);
      const exported = await studio.render(id, (done, total) => progress(done, total, "render: Rendering the saved promotional revision."), progress.signal, { force: args.force });
      progress.signal?.throwIfAborted();
      const base = exported.out.slice(0, -4);
      const seconds = comp.durationInFrames / comp.fps;
      const sheet = `${base}.sheet.jpg`;
      if (!existsSync(sheet)) await contactSheet(exported.out, { seconds: Array.from({ length: 12 }, (_, i) => i * seconds / 12), out: sheet });
      const report = await readJson<ReviewReport>(exported.review.file);
      const failing = exported.review.checks.filter((check) => check.status === "fail");
      const row: RenderRow = { id: basename(base), file: exported.out, seconds,
        ...(exported.lufs ? { lufs: Number(exported.lufs) } : {}), sheet, kit: `${base}.kit.md`, provenance: exported.provenance,
        review: { status: exported.review.status, file: exported.review.file, failing },
      };
      await progress.finish("The saved revision is exported and reviewed.");
      return ok(`Rendered saved revision ${document.revision}: ${seconds.toFixed(1)} s, review ${exported.review.status}.\n${report ? reportText(report, "concise") : ""}\nNext: inspect the contact sheet and review; use panoma_video_frame with this render_id to read details, or panoma_video_story before another correction.`,
        { render_id: row.id, file: row.file, seconds: row.seconds, lufs: row.lufs, review: row.review, sheet, kit: row.kit, provenance: row.provenance, disclose: exported.disclose }, await renderBlocks(row));
    } catch (error) {
      await progress.finish();
      const failure = fail(`${redact(error instanceof Error ? error.message : String(error)).text}\nNext: panoma_video_story(project_path, brief_id) to inspect the saved revision and its recorded material before retrying.`);
      if (!(error instanceof StudioExportReviewError)) return failure;
      const exported = error.exported;
      const base = exported.out.slice(0, -4);
      return { ...failure, structuredContent: {
        render_id: basename(base), file: exported.out, seconds: exported.seconds,
        ...(exported.lufs ? { lufs: Number(exported.lufs) } : {}),
        review: { status: exported.review.status, file: exported.review.file,
          failing: exported.review.checks.filter(check => check.status === "fail") },
        kit: `${base}.kit.md`, provenance: exported.provenance, disclose: exported.disclose, outputs: exported.outputs,
      }, content: [...failure.content, link(exported.out, "The encoded cut that failed review"), link(exported.review.file, "The failed encoded review")] };
    }
  }
  const report = await auto({
    root, projectId: args.workspace_id,
    until: "preview",
    goal: "all",
    theme: args.theme,
    force: args.force,
    voice: args.voice,
    brain: args.brain,
    previewFormat: args.format ?? "h",
    only: { brief: args.brief_id, hook: args.hook, lang: args.lang },
    signal: progress.signal,
    onProgress: (s, m, done, total) => progress(done ?? 0, total, `${s}: ${m}`),
  });
  await progress.finish();
  const row = report.renders.find((r) => r.id.startsWith(`${args.brief_id}--`));
  if (!row) return fail(`Nothing rendered for "${args.brief_id}". ${nextStep(report)}`, { stages: report.stages, briefs: report.briefs.map((b) => b.id) });
  const review = await readJson<ReviewReport>(row.review.file);
  const summary =
    `Rendered ${row.id}: ${row.seconds.toFixed(1)} s${row.lufs !== undefined ? `, ${row.lufs.toFixed(1)} LUFS` : ""}, review ${row.review.status}` +
    (row.review.failing.length > 0 ? ` (${row.review.failing.map((c) => c.id).join(", ")})` : "") +
    `.\n${review ? reportText(review, "concise") : ""}\n${nextStep(report)}`;
  return ok(summary, { render_id: row.id, file: row.file, seconds: row.seconds, lufs: row.lufs, review: { status: row.review.status, file: row.review.file, failing: row.review.failing }, sheet: row.sheet, kit: row.kit, provenance: row.provenance, disclose: report.disclose.includes(row.id) }, await renderBlocks(row));
}

/* ---------- panoma_video_review ---------- */

export const reviewInput = { project_path: projectPath, workspace_id: WorkspaceId, render_id: z.string().describe("A composition id, brief--hook--lang--format, from panoma_video_render or panoma_video_auto."), detail: Detail.optional() };

export async function review(args: { project_path: string; workspace_id?: string; render_id: string; detail?: "concise" | "detailed" }): Promise<ToolResult> {
  const root = await resolveProject(args.project_path);
  const ws = await workspaceFor(root, args.workspace_id);
  const file = join(ws.paths.renders, `${args.render_id}.mp4`);
  if (!existsSync(file)) return fail(`No render named "${args.render_id}" under ${ws.paths.renders}. Render it first with panoma_video_render.`);
  const reportFile = `${file.slice(0, -4)}.review.json`;
  let report: ReviewReport | null;
  if (existsSync(`${file.slice(0, -4)}.export.json`) || args.render_id.includes("--r-")) {
    try {
      const { reviewExportFile, writeReviewReport } = await import("../../../director/src/export-review.ts");
      report = await reviewExportFile(file) ?? null;
      if (report) await writeReviewReport(file, report);
    } catch (error) {
      return fail(`${redact(error instanceof Error ? error.message : String(error)).text}\nNext: restore the original exported material or create a new export; the historical report was preserved.`);
    }
  } else report = await readJson<ReviewReport>(reportFile);
  if (!report) {
    report = await reviewVideo(file);
    await writeJson(reportFile, report);
  }
  const sheet = `${file.slice(0, -4)}.sheet.jpg`;
  if (!existsSync(sheet)) await contactSheet(file, { seconds: Array.from({ length: 12 }, (_, i) => (i * report!.measured.seconds) / 12), out: sheet }).catch(() => undefined);
  const blocks: Block[] = [];
  if (existsSync(sheet)) blocks.push(await image(sheet));
  blocks.push(link(reportFile));
  const failing = report.checks.filter((c) => c.status === "fail");
  const summary = `${reportText(report, args.detail ?? "concise")}\n` + (failing.length > 0 ? `Next: ${failing.map((c) => `${c.id} → ${c.fix?.by}${c.fix?.hint ? ` (${c.fix.hint})` : ""}`).join("; ")}` : "Next: this cut can ship; panoma_video_frame(project_path, render_id, seconds) to read any tile closely.");
  return ok(summary, { render_id: args.render_id, status: report.status, measured: report.measured, checks: args.detail === "detailed" ? report.checks : report.checks.filter((c) => c.status !== "pass"), sheet: existsSync(sheet) ? sheet : undefined }, blocks);
}

/* ---------- panoma_video_frame ---------- */

export const frameInput = { project_path: projectPath, workspace_id: WorkspaceId, render_id: z.string(), seconds: z.number().min(0).describe("The second to show, e.g. 3.0 for the thumbnail-quality frame.") };

export async function frame(args: { project_path: string; workspace_id?: string; render_id: string; seconds: number }): Promise<ToolResult> {
  const root = await resolveProject(args.project_path);
  const ws = await workspaceFor(root, args.workspace_id);
  const file = join(ws.paths.renders, `${args.render_id}.mp4`);
  if (!existsSync(file)) return fail(`No render named "${args.render_id}". Render it first with panoma_video_render.`);
  const report = await readJson<ReviewReport>(`${file.slice(0, -4)}.review.json`);
  const length = report?.measured.seconds;
  if (length !== undefined && args.seconds >= length) {
    return fail(`${args.render_id} is ${length.toFixed(1)} s long; ask for a second below that.`);
  }
  const out = join(ws.paths.renders, `${args.render_id}.frame-${args.seconds.toFixed(2)}.jpg`);
  const pic = await frameAt(file, args.seconds, { out });
  return ok(`${args.render_id} at ${args.seconds.toFixed(2)} s (${pic.width} px wide). Next: compare this frame with panoma_video_review before deciding whether the cut needs a correction.`, { render_id: args.render_id, seconds: args.seconds, file: pic.file, bytes: pic.bytes }, [await image(pic.file)]);
}

/* ---------- panoma_video_auto ---------- */

export const autoInput = {
  project_path: projectPath, workspace_id: WorkspaceId,
  goal: Goal.optional(),
  format: z.enum(["v", "h", "s"]).optional().describe("One preview canvas; final uses the recipe matrix."),
  new_story: z.boolean().optional().describe("Explicitly plan a new ProductPromo and archive its previous revision journal after the replacement plan validates. Use when captured evidence changed or a new story is requested; ordinary corrections use panoma_video_revise."),
  theme: PromoTheme,
  langs: Langs,
  until: z.enum(["plan", "preview", "final"]).optional().describe('How far to go: "plan" writes the briefs; "preview" (default) renders one reference cut per brief; "final" renders every cut of every brief with its kit.'),
  force: z.boolean().optional().describe("Redo the tour and the takes even when nothing changed."),
  voice: z
    .string()
    .optional()
    .describe(
      'An ElevenLabs voice id for the tutorial\'s narration. Omitted means the default voice, used only when ELEVENLABS_API_KEY is set — narration is a paid call and it is capped per run. Pass "none" for a silent piece whose sentences are drawn as type.',
    ),
  url: z
    .string()
    .optional()
    .describe(
      "An address to film instead of starting the project: a staging deployment, or an instance already running on this machine with real content in it. The serve stage does nothing and the camera goes here.",
    ),
  brain: BrainChoice,
  music: z
    .string()
    .optional()
    .describe(
      "A music file to score the pieces with (absolute path; mp3, wav, m4a...). panoma video measures its tempo and beats, cuts it to its first downbeat, stretches it at most 4.2% to a tempo with whole frames per beat, and cuts every piece on its beats. Omitted means the procedural bed.",
    ),
  dance: z
    .enum(["off", "light", "full"])
    .optional()
    .describe('Optional musical motion: "full" pulses to kicks in wordless pieces; "light" keeps a third of it. Omitted or "off" follows product actions without musical pumping, even when a track is supplied. Narrated pieces are capped at "light".'),
  creative_brief: z.string().min(1).max(2000).optional().describe("Editorial request for a promotion: audience, emphasis or effects. Guides choices over recorded evidence; cannot invent features, execution or outcomes."),
};

export async function runAuto(args: { project_path: string; workspace_id?: string; goal?: string; format?: "v" | "h" | "s"; new_story?: boolean; theme?: "auto" | "normal" | "flat" | "vibrant" | "block" | "grid"; langs?: ("en" | "es")[]; until?: "plan" | "preview" | "final"; force?: boolean; voice?: string; url?: string; brain?: "auto" | "none" | "claude" | "codex" | "anthropic" | "openai"; music?: string; dance?: "off" | "light" | "full"; creative_brief?: string }, extra: Extra): Promise<ToolResult> {
  const root = await resolveProject(args.project_path);
  const progress = progressFor(extra);
  const report = await auto({ root, projectId: args.workspace_id, goal: args.goal as never, previewFormat: args.format, newStory: args.new_story, theme: args.theme, langs: args.langs, until: args.until ?? "preview", force: args.force, voice: args.voice, url: args.url, brain: args.brain, music: args.music, dance: args.dance, creative: args.creative_brief, signal: progress.signal, onProgress: (s, m, done, total) => progress(done ?? 0, total, `${s}: ${m}`) });
  await progress.finish();
  const blocks: Block[] = [];
  if (report.reference?.sheet && existsSync(report.reference.sheet)) blocks.push(await image(report.reference.sheet));
  for (const r of report.renders) blocks.push(link(r.file, `${r.id} · review ${r.review.status}`));
  blocks.push(link(report.files.auto, "the full report"));
  const summary =
    `${report.project.name} (${report.project.kind}) — cuts rendered: ${report.renders.length} · briefs: ${report.briefs.length} · goals skipped: ${report.skipped.length}.\n${stagesText(report)}\n` +
    (report.renders.length > 0 ? `Cuts: ${report.renders.map((r) => `${r.id} ${r.seconds.toFixed(1)} s review ${r.review.status}`).join(" · ")}\n` : "") +
    (report.disclose.length > 0 ? `Synthetic voice or music in: ${report.disclose.join(", ")} — tick the platform's disclosure.\n` : "") +
    brainText(report) +
    nextStep(report);
  return ok(summary, { project_id: report.project.id, project_dir: report.project.dir, stages: report.stages, briefs: report.briefs, skipped: report.skipped, renders: report.renders.map((r) => ({ ...r, review: { status: r.review.status, failing: r.review.failing.map((c) => ({ id: c.id, summary: c.summary, fix: c.fix })), file: r.review.file } })), polish: report.polish.slice(0, 40), disclose: report.disclose, reference: report.reference?.id, brain: brainOut(report) }, blocks);
}

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

/* ---------- panoma_video_teach ---------- */

export const teachInput = {
  project_path: projectPath, workspace_id: WorkspaceId,
  about: z
    .string()
    .min(4)
    .max(600)
    .optional()
    .describe(
      'What to teach, in the words somebody asked for it: "how to manage the .md instruction files your agents read". ' +
        "Any language. panoma video reads the product screen by screen, plans the route that answers this, proves every step in a " +
        "browser, and films only what it proved — a step that cannot be performed is dropped with its reason. " +
        "OMIT IT and panoma video decides: it scores every screen the reading reached on what it can measure — whether getting " +
        "there produces something, how focused the screen is, how far it is, and what the screen says for itself — names " +
        "the candidates, picks one, and says what it picked from. Leave it out when you do not already know the product.",
    ),
  langs: Langs,
  until: z.enum(["plan", "preview", "final"]).optional().describe('How far to go: "plan" writes the brief; "preview" (default) renders one 16:9 cut; "final" renders every language and format.'),
  force: z.boolean().optional().describe("Read the product and shoot the takes again even when nothing changed."),
  voice: z.string().optional().describe('An ElevenLabs voice id for the narration. Omitted means the default voice when ELEVENLABS_API_KEY is set. Pass "none" for a silent piece whose sentences are drawn as type.'),
  url: z
    .string()
    .optional()
    .describe("An address to film instead of starting the project: an instance already running with real content in it, which is what makes a tutorial worth watching."),
  brain: BrainChoice,
  music: z
    .string()
    .optional()
    .describe(
      "A music file to score the pieces with (absolute path; mp3, wav, m4a...). panoma video measures its tempo and beats, cuts it to its first downbeat, stretches it at most 4.2% to a tempo with whole frames per beat, and cuts every piece on its beats. Omitted means the procedural bed.",
    ),
  dance: z
    .enum(["off", "light", "full"])
    .optional()
    .describe('Optional musical motion: "full" pulses to kicks in wordless pieces; "light" keeps a third of it. Omitted or "off" follows product actions without musical pumping, even when a track is supplied. Narrated pieces are capped at "light".'),
};

/**
 * A tutorial about one thing, asked for in words.
 *
 * The same pipeline as `panoma_video_auto` with two differences, both consequences of having a
 * destination: the walk becomes a reading of the product and a route through it, and the
 * only piece planned is the tutorial that answers the request. It presses nothing that
 * sends, pays, deletes, publishes, installs, rewrites a file or spends model credits —
 * refused in the executor, not only in the prompt — and every step is performed in a
 * browser before it is written down.
 */
export async function runTeach(
  args: { project_path: string; workspace_id?: string; about?: string; langs?: ("en" | "es")[]; until?: "plan" | "preview" | "final"; force?: boolean; voice?: string; url?: string; brain?: "auto" | "none" | "claude" | "codex" | "anthropic" | "openai"; music?: string; dance?: "off" | "light" | "full" },
  extra: Extra,
): Promise<ToolResult> {
  const root = await resolveProject(args.project_path);
  const progress = progressFor(extra);
  const report = await auto({
    root, projectId: args.workspace_id,
    ...(args.about ? { about: args.about } : { teach: true }),
    goal: "tutorial",
    langs: args.langs,
    until: args.until ?? "preview",
    force: args.force,
    voice: args.voice,
    url: args.url,
    brain: args.brain,
    music: args.music,
    dance: args.dance,
    signal: progress.signal,
    onProgress: (s, m, done, total) => progress(done ?? 0, total, `${s}: ${m}`),
  });
  await progress.finish();
  const blocks: Block[] = [];
  if (report.reference?.sheet && existsSync(report.reference.sheet)) blocks.push(await image(report.reference.sheet));
  for (const r of report.renders) blocks.push(link(r.file, `${r.id} · review ${r.review.status}`));
  blocks.push(link(report.files.auto, "the full report"));
  const summary =
    `${report.project.name} — asked: ${JSON.stringify(args.about)}
` +
    (report.lesson ? `${report.lesson.summary}
` : "") +
    `${stagesText(report)}
` +
    (report.renders.length > 0 ? `Cuts: ${report.renders.map((r) => `${r.id} ${r.seconds.toFixed(1)} s review ${r.review.status}`).join(" · ")}
` : "") +
    (report.disclose.length > 0 ? `Synthetic voice or music in: ${report.disclose.join(", ")} — tick the platform's disclosure.\n` : "") +
    brainText(report) +
    nextStep(report);
  return ok(
    summary,
    {
      project_id: report.project.id,
      project_dir: report.project.dir,
      stages: report.stages,
      briefs: report.briefs,
      lesson: report.lesson,
      renders: report.renders.map((r) => ({ ...r, review: { status: r.review.status, failing: r.review.failing.map((c) => ({ id: c.id, summary: c.summary, fix: c.fix })), file: r.review.file } })),
      disclose: report.disclose,
      reference: report.reference?.id,
      brain: brainOut(report),
    },
    blocks,
  );
}
