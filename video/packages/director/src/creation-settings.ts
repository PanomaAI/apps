/* A creation request is a production constraint, never a new source of product facts. */
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";

const path = z.string().trim().min(1).max(4096).refine(value => isAbsolute(value) && !/[\0\r\n]/.test(value), "Choose an absolute local path.");
const text = (max: number) => z.string().trim().max(max).optional().transform(value => value || undefined);
const formats = z.array(z.enum(["v", "h"])).min(1).max(2).refine(value => new Set(value).size === value.length, "Choose each format once.");
const langs = z.array(z.enum(["es", "en"])).min(1).max(2).refine(value => new Set(value).size === value.length, "Choose each language once.");

export const CreationRequestSchema = z.object({
  root: path,
  purpose: z.enum(["auto", "product", "release", "tutorial"]).default("product"),
  creative: text(2000), audience: text(300), outcome: text(500), about: text(1000),
  langs: langs.default(["es"]), formats: formats.default(["v"]),
  theme: z.enum(["normal", "vibrant", "block", "grid", "auto"]).default("normal"),
  voice: z.enum(["auto", "none", "on"]).default("auto"),
  dance: z.enum(["off", "light", "full"]).default("off"),
  music: path.optional(), finish: z.enum(["plan", "video"]).default("plan"),
  opening: z.enum(["auto", "result", "promise"]).default("auto"),
  pace: z.enum(["auto", "crisp", "measured"]).default("auto"),
  recap: z.enum(["auto", "on", "off"]).default("auto"),
}).strict().superRefine((value, ctx) => {
  const issue = (field: string, message: string) => ctx.addIssue({ code: "custom", path: [field], message });
  if (value.purpose !== "product") {
    if (value.theme !== "normal") issue("theme", "Expressive themes apply to product promotions. Choose Product or keep Normal.");
    for (const field of ["opening", "pace", "recap"] as const) if (value[field] !== "auto") issue(field, "Manual presentation choices apply to product promotions.");
  }
  if (value.about && value.purpose !== "tutorial") issue("about", "Choose Tutorial to request a particular task.");
  if (value.voice === "on" && value.purpose !== "tutorial") issue("voice", "Narration is supported for tutorials. Choose Tutorial, Automatic voice, or No voice.");
  if ((value.creative || value.audience || value.outcome) && value.purpose !== "product" && value.purpose !== "auto") {
    issue("creative", "Audience and sales direction apply to product promotions. For a tutorial, describe its task instead.");
  }
});

export type CreationRequest = z.infer<typeof CreationRequestSchema>;

export function normalizeCreationRequest(value: unknown): CreationRequest {
  const parsed = CreationRequestSchema.safeParse(value);
  if (!parsed.success) throw new Error(parsed.error.issues.map(issue => `${issue.path.join(".") || "request"}: ${issue.message}`).join(" "));
  return parsed.data;
}

const selection = z.object({
  briefIds: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/)).min(1),
  recipe: z.string().min(1), why: z.string().min(1), formats, langs,
  voice: z.enum(["none", "on"]),
}).strict();
export const CreationManifestSchema = z.object({ version: z.literal(1), createdAt: z.string(), settings: CreationRequestSchema, selection }).strict().superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", path: ["selection"], message });
  if (JSON.stringify(value.settings.formats) !== JSON.stringify(value.selection.formats) || JSON.stringify(value.settings.langs) !== JSON.stringify(value.selection.langs)) issue("The selected languages and formats must match the creation request.");
  const expected = { product: "ProductPromo", release: "ReleaseTrailer", tutorial: "Tutorial" };
  if (value.settings.purpose !== "auto" && value.selection.recipe !== expected[value.settings.purpose]) issue("The selected recipe must fulfill the requested purpose.");
  if (new Set(value.selection.briefIds).size !== value.selection.briefIds.length) issue("A selected brief may appear only once.");
  if ((value.settings.voice === "none" && value.selection.voice !== "none") || (value.settings.voice === "on" && value.selection.voice !== "on")) issue("The selected voice must honor the explicit voice choice.");
  if (value.selection.voice === "on" && value.selection.recipe !== "Tutorial") issue("Only tutorials can currently carry narration.");
});
export type CreationManifest = z.infer<typeof CreationManifestSchema>;

/** Corrupt saved constraints fail closed; they never expand a one-format order into every format. */
export async function readCreationManifest(workspace: string): Promise<CreationManifest | undefined> {
  let raw: string;
  try { raw = await readFile(join(workspace, "creation.json"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  try { return CreationManifestSchema.parse(JSON.parse(raw)); }
  catch { throw new Error("The saved video configuration is invalid. Restore creation.json before opening this production."); }
}

/** All matrix collections share exactly the selected rows, including sound and review plans. */
export function restrictCreationMatrix<T extends { compositions: { id: string }[]; mismatched: Set<string>; chapters: Map<string, unknown>; plans: Map<string, unknown>; beds: Map<string, unknown>; words: Map<string, unknown> }>(matrix: T, manifest?: CreationManifest): T {
  if (!manifest) return matrix;
  const chosen = matrix.compositions.filter(comp => {
    const [brief, , lang, format] = comp.id.split("--");
    return manifest.selection.briefIds.includes(brief) && manifest.selection.formats.includes(format as "v" | "h") && manifest.selection.langs.includes(lang as "es" | "en");
  });
  const ids = new Set(chosen.map(comp => comp.id));
  const keep = <V>(map: Map<string, V>) => new Map([...map].filter(([id]) => ids.has(id)));
  return { ...matrix, compositions: chosen, mismatched: new Set([...matrix.mismatched].filter(id => ids.has(id))), chapters: keep(matrix.chapters), plans: keep(matrix.plans), beds: keep(matrix.beds), words: keep(matrix.words) };
}
