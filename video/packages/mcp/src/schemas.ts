/*
  The shapes an agent writes and reads, as zod, in one place: the tool input schemas
  are built from these, the guide prints them, and a brief an agent proposes is
  validated against them before anything else looks at it. They mirror the TypeScript
  types in @panoma/video-core; if the two drift, the test that round-trips a real brief
  through `BriefSchema` fails.
*/
import { z } from "zod";

const langText = z.record(z.string().min(2).max(5), z.string()).describe('Text per language, e.g. {"en": "...", "es": "..."}');

export const LineSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase, digits and dashes"),
    text: langText.describe("What is said and/or shown. May contain {{fact:id}} placeholders that panoma video expands verbatim."),
    mode: z.enum(["voice", "type", "both"]).optional(),
    mark: z.string().optional().describe("Tutorial and cast recipes: the named moment of the recording this line narrates. A line with a mark is a step; without one, the closing card."),
    label: langText.optional().describe("A two-or-three-word chip for the step."),
    result: langText.optional().describe("What the interface showed once this step landed — its own heading, quoted by fact id. A spotlight labels the after-state with it."),
  })
  .strict();

export const BriefSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    recipe: z.enum(["KineticQuote", "ScreenDemo", "TerminalRun", "Loop", "ScreenCast", "Tutorial", "ReleaseTrailer", "Changelog", "FeatureSpotlight", "ProductPromo"]),
    langs: z.array(z.string().min(2).max(5)).min(1),
    hooks: z.array(LineSchema).min(1).describe("Alternative openings; each becomes its own render. The feed votes."),
    lines: z.array(LineSchema),
    bpm: z.number().min(40).max(240),
    fps: z.number().int().optional(),
    music: z.object({ prompt: z.string().optional(), file: z.string().optional(), style: z.enum(["calm", "pulse", "dark", "bright"]).optional(), key: z.string().optional(), pulse: z.string().optional(), dance: z.enum(["off", "light", "full"]).optional() }).optional(),
    voice: z.string().optional().describe("ElevenLabs voice id. Omit for a silent (type-only) piece."),
    voiceSpeed: z.number().min(0.7).max(1.2).optional(),
    session: z.string().optional().describe("The recorded session (tour) this brief plays."),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    promo: z.object({
      close: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("destination"), fact: z.string().min(1), source: z.string().min(1) }).strict(),
        z.object({ kind: z.literal("brand"), fact: z.string().min(1), source: z.string().min(1), reason: z.literal("no-public-destination") }).strict(),
      ]).optional(),
      theme: z.enum(["flat", "vibrant", "block", "grid"]).optional().describe("One theme for added editorial graphics throughout the film and every variant. The recorded source stays intact; Grid alone adds a faint static lattice over the whole film. Omitted means Normal / Flat; expressive styles require an explicit selection."),
      opening: z.enum(["promise", "result"]), pace: z.enum(["crisp", "measured"]),
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

export type BriefInput = z.infer<typeof BriefSchema>;

export const Detail = z.enum(["concise", "detailed"]).default("concise").describe("How much to return. Concise is about a third of the tokens.");

export const BrainChoice = z
  .enum(["auto", "none", "claude", "codex", "anthropic", "openai"])
  .optional()
  .describe(
    'Who writes the words and chooses what the camera sees pressed. "auto" (the default) takes the first brain this machine has — the claude or codex agent, then an Anthropic or OpenAI key; its words pass the same audit as yours. Pass "none" when you are writing the words yourself through brief_patch.',
  );

export const Goal = z
  .enum(["promo", "trailer", "spotlight", "tutorial", "sitetour", "facts", "all"])
  .default("all")
  .describe("What to make: promo sells one supported benefit through real actions, concise type and music without narration; trailer announces a release; spotlight isolates controls; tutorial teaches with narration; sitetour shows sections; facts serves CLIs and libraries; all makes every earned piece.");

export const PromoTheme = z.enum(["normal", "flat", "vibrant", "block", "grid", "auto"]).optional().describe("One theme for the entire ProductPromo and every variant. Omitted is Normal / Flat, unless a saved explicit user choice exists. normal aliases flat: clear surfaces and quiet reveals. vibrant: strong color fields and crisp arrivals. block: bold outlines, structured panels, offset planes and short directional assemblies. grid (Grid / Assembly): monochrome ink and paper, a fine lattice, an already readable opening poster, exact later phrases assembling decisively with dry accents, and layered paper cards flexing/docking/stacking without covering their copy. Grid graphics stay neutral even for a colorful brand. Recorded app pixels never bend. Named choices override the brain and persist; explicit auto opts into brain/arithmetic selection for this run, without making later omitted runs expressive. Themes style added graphics; Grid also adds a faint static film lattice over the whole canvas, including the recording. The recorded source keeps its original geometry and colors. Applies to goal promo or all.");
