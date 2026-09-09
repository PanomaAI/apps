/*
  The shapes an agent writes and reads, as zod, in one place: a brief a workspace
  loads, a brief an agent proposes over MCP, and the patch that edits one are all
  validated here before anything else looks at them. They mirror the TypeScript
  types in @panoma/video-core; a test round-trips the repository's own briefs so the two
  cannot drift.
*/
import { z } from "zod";
import type { Brief, BriefPatch } from "@panoma/video-core";

const langText = z.record(z.string().min(2).max(5), z.string()).describe('Text per language, e.g. {"en": "...", "es": "..."}');

export const LineSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase, digits and dashes"),
    text: langText.describe("What is said and/or shown. May contain {{fact:id}} placeholders that panoma video expands verbatim."),
    mode: z.enum(["voice", "type", "both"]).optional(),
    mark: z.string().optional().describe("The named moment of the recording this line narrates. A line with a mark is a step; without one, the closing card."),
    label: langText.optional().describe("A two-or-three-word chip for the step."),
    result: langText.optional().describe("What the interface showed once this step landed — its own heading, quoted by fact id. A spotlight labels the after-state with it."),
  })
  .strict();

export const RECIPES = ["KineticQuote", "ScreenDemo", "TerminalRun", "Loop", "ScreenCast", "Tutorial", "ReleaseTrailer", "FeatureSpotlight", "ProductPromo"] as const;

export const BriefSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    recipe: z.enum(RECIPES),
    langs: z.array(z.string().min(2).max(5)).min(1),
    hooks: z.array(LineSchema).min(1).describe("Alternative openings; each becomes its own render. The feed votes."),
    lines: z.array(LineSchema),
    /* Not an integer: a track conformed to 13 frames a beat at 30 fps is 138.4615 BPM. The grid, not this, decides what is legal. */
    bpm: z.number().min(40).max(240),
    fps: z.number().int().optional(),
    music: z
      .object({
        prompt: z.string().optional(),
        file: z.string().optional(),
        style: z.enum(["calm", "pulse", "dark", "bright"]).optional(),
        key: z.string().optional(),
        pulse: z.string().optional().describe("The per-frame pulse of a brought track, written by the score stage."),
        dance: z.enum(["off", "light", "full"]).optional().describe('Optional musical motion. Omitted or "off" follows the product actions; "light" and "full" explicitly enable movement to the music.'),
      })
      .optional(),
    voice: z.string().optional().describe("ElevenLabs voice id. Omit for a silent (type-only) piece."),
    voiceSpeed: z.number().min(0.7).max(1.2).optional(),
    shots: z.string().optional(),
    session: z.string().optional().describe("The recorded session (tour) this brief plays."),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    promo: z.object({
      close: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("destination"), fact: z.string().min(1), source: z.string().min(1) }).strict(),
        z.object({ kind: z.literal("brand"), fact: z.string().min(1), source: z.string().min(1), reason: z.literal("no-public-destination") }).strict(),
      ]).optional(),
      theme: z.enum(["flat", "vibrant", "block", "grid"]).optional().describe("One theme for added editorial graphics throughout the film and every variant. The recorded source stays intact; Grid alone adds a faint static lattice over the whole film. Omitted means Normal / Flat; expressive styles require an explicit selection."),
      opening: z.enum(["promise", "result"]),
      pace: z.enum(["crisp", "measured"]),
      evidence: z.record(z.string(), z.object({ mark: z.string().min(1), facts: z.array(z.string().min(1)).min(1) }).strict()),
      treatments: z.record(z.string(), z.enum(["full", "focus", "split"])).optional(),
      recap: z.boolean().optional(),
      inserts: z.array(z.object({ kind: z.enum(["terminal", "code"]), line: z.string().min(1), after: z.string().min(1) }).strict()).max(2).optional(),
    }).strict().optional(),
    job: z.enum(["sell", "announce", "prove", "teach", "stop", "loop", "still"]).optional(),
    tags: z.array(z.string()).optional(),
    project: z.string().optional().describe("The project id whose facts this brief may quote."),
  })
  .strict();

const LinePatchSchema = z
  .object({
    text: langText.optional(),
    label: langText.optional(),
    result: langText.optional(),
    mark: z.string().optional(),
    mode: z.enum(["voice", "type", "both"]).optional(),
  })
  .strict();

export const BriefPatchSchema = z
  .object({
    hooks: z.record(z.string(), LinePatchSchema).optional().describe("By hook id."),
    lines: z.record(z.string(), LinePatchSchema).optional().describe("By line id."),
    drop: z.array(z.string()).optional().describe("Line ids to remove."),
    add: z.array(LineSchema).optional().describe("Lines to append."),
    addHooks: z.array(LineSchema).optional().describe("Hooks to append: each one is another opening, and another cut of the matrix."),
    bpm: z.number().int().min(60).max(180).optional(),
    voice: z.string().optional(),
    voiceSpeed: z.number().min(0.7).max(1.2).optional(),
  })
  .strict();

/** A brief from JSON, or a one-line error naming the field. */
export function parseBrief(value: unknown): Brief {
  const r = BriefSchema.safeParse(value);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new Error(`Brief is not valid at ${issue.path.join(".") || "root"}: ${issue.message}.`);
  }
  return r.data as Brief;
}

export function parsePatch(value: unknown): BriefPatch {
  const r = BriefPatchSchema.safeParse(value);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new Error(`brief_patch is not valid at ${issue.path.join(".") || "root"}: ${issue.message}.`);
  }
  return r.data as BriefPatch;
}
