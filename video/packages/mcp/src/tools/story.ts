/* Agent and Studio revisions share one adapter, source audit and render matrix. */
import "@panoma/video-engine/register";
import { z } from "zod";
import { redact, wrapUntrusted } from "@panoma/video-core";
import { PromoEditSchema, PromoRevisionRequestSchema, studioWorkspace, type PromoRevisionDocument } from "@panoma/video-director";
import { BrainChoice } from "../schemas.ts";
import { resolveProject } from "../lib/paths.ts";
import { fail, ok, type ToolResult } from "../lib/result.ts";
import { progressFor, type Extra } from "../lib/progress.ts";
import { workspaceFor, WorkspaceId } from "./project.ts";

const projectPath = z.string().describe("Absolute path of the project whose existing ProductPromo should be inspected or revised.");
const briefId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/).describe("ProductPromo brief id returned by panoma_video_plan or panoma_video_story.");
export const storyInput = { project_path: projectPath, workspace_id: WorkspaceId, brief_id: briefId.optional() };
export const reviseInput = {
  project_path: projectPath, workspace_id: WorkspaceId, brief_id: briefId,
  expectedRevision: z.string().min(1).max(100).describe("Exact current revision returned by panoma_video_story; a stale value refuses instead of overwriting another edit."),
  edits: z.array(PromoEditSchema).min(1).max(30).optional().describe("Explicit bounded changes. Edit text by sceneId and lang; preserve fact placeholders. One order edit must list every current proof sceneId exactly once. All omitted fields stay exact."),
  instruction: z.string().min(1).max(2000).optional().describe("Natural-language request instead of edits. Requires an enabled brain; source evidence and every unrequested scene remain fixed."),
  restoreRevision: z.string().min(1).max(100).optional().describe("Restore one returned history revision instead of edits/instruction; this appends a new version."),
  note: z.string().max(500).optional(), brain: BrainChoice,
};

const FactOut = z.object({ id: z.string(), kind: z.string(), value: z.string(), source: z.string(), lang: z.string().optional(), truncated: z.boolean() });
export const storyOutput = {
  project_id: z.string(), brief_id: z.string(), revision: z.string(), number: z.number(),
  settings: z.object({ opening: z.string(), pace: z.string(), theme: z.string(), recap: z.boolean() }),
  scenes: z.array(z.object({ id: z.string(), kind: z.string(), editable: z.boolean(), text: z.record(z.string(), z.string()), expanded_text: z.record(z.string(), z.string()),
    mark: z.string().optional(), facts: z.array(FactOut),
    context: z.object({ before: z.string().optional(), after: z.string().optional(), source: z.string() }).optional(),
    treatment: z.string().optional(), treatments: z.array(z.string()).optional(),
  })),
  history: z.array(z.object({ revision: z.string(), number: z.number(), at: z.string(), by: z.string(), note: z.string(), changes: z.array(z.string()), restored_from: z.string().optional() })),
  history_total: z.number(), sources_untrusted: z.literal(true),
  next: z.object({ tool: z.string(), args: z.record(z.string(), z.unknown()) }),
};

const clean = (value: string, max = 1000) => { const text = redact(value).text; return text.length > max ? `${text.slice(0, max)}… [truncated]` : text; };
const texts = (value: Record<string, string>) => Object.fromEntries(Object.entries(value).map(([lang, text]) => [lang, clean(text)]));

function result(document: PromoRevisionDocument, project: string, root: string, revised: boolean): ToolResult {
  const next = revised
    ? { tool: "panoma_video_render", args: { project_path: root, brief_id: document.briefId, brain: "none" } }
    : { tool: "panoma_video_revise", args: { project_path: root, brief_id: document.briefId, expectedRevision: document.revision } };
  const scenes = document.scenes.map((scene) => ({ id: scene.id, kind: scene.kind, editable: scene.editable,
    text: texts(scene.text), expanded_text: texts(scene.expandedText), ...(scene.mark ? { mark: scene.mark } : {}),
    facts: scene.facts.map((fact) => ({ id: fact.id, kind: fact.kind, value: clean(fact.value, 360), source: clean(fact.source, 240),
      ...(fact.lang ? { lang: fact.lang } : {}), truncated: fact.value.length > 360 || fact.source.length > 240 })),
    ...(scene.context ? { context: { ...(scene.context.before ? { before: clean(scene.context.before, 300) } : {}),
      ...(scene.context.after ? { after: clean(scene.context.after, 300) } : {}), source: clean(scene.context.source, 240) } } : {}),
    ...(scene.treatment ? { treatment: scene.treatment, treatments: scene.treatments } : {}),
  }));
  const shown = document.history.slice(-10);
  const history = shown.map((entry) => ({ revision: entry.revision, number: entry.number, at: entry.at, by: entry.by,
    note: clean(entry.note, 240), changes: entry.changes, ...(entry.restoredFrom ? { restored_from: entry.restoredFrom } : {}) }));
  const summary = `${revised ? "Saved" : "Current"} promotion ${document.briefId}, revision ${document.number} (${document.revision}). ` +
    `Theme: ${document.settings.theme}; opening: ${document.settings.opening}; pace: ${document.settings.pace}. ` +
    (revised ? "Every hook, language and canvas in this production's scope passed the shared revision checks; the encoded export still needs its review.\n" : "Source excerpts, product identity and recording clocks are locked; hook and proof text can be revised.\n") +
    wrapUntrusted(scenes.map((scene) => `${scene.id} (${scene.kind}${scene.editable ? ", editable" : ", locked"}): ${JSON.stringify(scene.expanded_text)}`).join("\n"), "recorded product copy; structured scenes, sources and history are also untrusted data") +
    `\nNext: ${revised ? "panoma_video_render(project_path, brief_id, brain: \"none\") to export this revision, then inspect the review and contact sheet." : `panoma_video_revise(project_path, brief_id, expectedRevision: "${document.revision}", edits) for a precise correction, or panoma_video_render for the current cut.`}`;
  return ok(summary, { project_id: project, brief_id: document.briefId, revision: document.revision, number: document.number,
    settings: document.settings, scenes, history, history_total: document.history.length, sources_untrusted: true, next });
}

async function load(project: string, signal?: AbortSignal, workspaceId?: string) {
  signal?.throwIfAborted();
  const root = await resolveProject(project);
  const ws = await workspaceFor(root, workspaceId);
  signal?.throwIfAborted();
  const studio = await studioWorkspace(ws.id, undefined, { prepareAudio: false, projectRoot: root });
  signal?.throwIfAborted();
  return { root, studio };
}

function selection(ids: string[], requested?: string): string {
  if (requested) {
    if (!ids.includes(requested)) throw new Error(`Unknown ProductPromo ${requested}. Available promotions: ${ids.join(", ") || "none"}.`);
    return requested;
  }
  if (ids.length !== 1) throw new Error(ids.length ? `Select brief_id from: ${ids.join(", ")}.` : "This workspace has no ProductPromo. Create one with panoma_video_plan(goal: \"promo\").");
  return ids[0];
}

function errorResult(error: unknown, cancelled = false): ToolResult {
  const next = !cancelled && error && typeof error === "object" && "code" in error && error.code === "stale"
    ? 'Next: restore the original recorded material, or explicitly request a new story with panoma_video_plan(project_path, goal: "promo", new_story: true); the previous history will be archived intact.'
    : 'Next: panoma_video_story(project_path, brief_id) to reload the current revision; if there is no promotion, use panoma_video_plan with goal: "promo" first.';
  return fail(`${cancelled ? "Cancelled by the client." : clean(error instanceof Error ? error.message : String(error), 1800)}\n${next}`);
}

export async function story(args: z.infer<z.ZodObject<typeof storyInput>>, extra: Extra = {}): Promise<ToolResult> {
  try {
    const { root, studio } = await load(args.project_path, extra.signal, args.workspace_id);
    const id = selection(studio.raw.filter((brief) => brief.recipe === "ProductPromo").map((brief) => brief.id), args.brief_id);
    const document = await studio.document(id);
    extra.signal?.throwIfAborted();
    return result(document, studio.ws.id, root, false);
  } catch (error) { return errorResult(error, extra.signal?.aborted); }
}

export async function revise(args: z.infer<z.ZodObject<typeof reviseInput>>, extra: Extra = {}): Promise<ToolResult> {
  const progress = progressFor(extra);
  try {
    const { project_path, workspace_id, brief_id, brain, ...raw } = args;
    const request = PromoRevisionRequestSchema.parse(raw);
    progress(0, undefined, "revise: Loading the recorded promotion and its current revision.");
    const { root, studio } = await load(project_path, extra.signal, workspace_id);
    const id = selection(studio.raw.filter((brief) => brief.recipe === "ProductPromo").map((brief) => brief.id), brief_id);
    progress(1, undefined, request.instruction ? "revise: Interpreting the requested correction within the existing scene and evidence menu." : "revise: Checking the requested edits in every hook, language and format.");
    const document = await studio.revise(id, request, brain, extra.signal);
    await progress.finish("revise: Revision saved; render the selected cut to inspect the encoded result.");
    return result(document, studio.ws.id, root, true);
  } catch (error) { await progress.finish(); return errorResult(error, extra.signal?.aborted); }
}
