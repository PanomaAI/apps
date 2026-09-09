/*
  The guide: the conventions of this server, returned by the server itself.

  Shotstack's MCP ships a `get_shotstack_guide` tool for one reason that applies here
  in full — a model's training data is always older than the tool, so the first thing
  it should read is what the tool says about itself today. This is that. It states the
  call order, what each tool returns, the brief shape, the fact placeholder syntax,
  the budgets a video is checked against, and what will make a render refuse.
*/
import { zodToJsonSchema } from "zod-to-json-schema";
import { BriefSchema } from "../schemas.ts";
import { ok } from "../lib/result.ts";

import { APP_PROTOCOL, probeRequirements, type ProbeDepth } from "../requirements.ts";
export const GUIDE_VERSION = APP_PROTOCOL;

export const CALL_ORDER = [
  "panoma_video_scout(project_path)                    — read-only: what the project is, how it starts, its routes, and the FACTS it may quote (each with an id and a source).",
  "panoma_video_record(project_path, force?)           — starts the product on 127.0.0.1 (or uses its deployed address), walks it, and shoots the desktop and mobile takes with marks. Slow (40–120 s); progress is reported; cached on the product's commit and on whatever its working tree has that the commit does not — the port the server got is never part of it.",
  "panoma_video_plan(project_path, goal?, langs?, brief_id?, brief_patch?) — writes and audits the briefs from the facts and the marks. Pass brief_id + brief_patch to change words by line id; numbers must be {{fact:id}} references.",
  "panoma_video_story(project_path, brief_id?) — read the current ProductPromo revision, scene ids, raw/expanded copy, source evidence, settings and recent history without creating media or asking a brain.",
  "panoma_video_revise(project_path, brief_id, expectedRevision, edits|instruction|restoreRevision, brain?) — revise only requested promotional scenes/settings; keep every other field exact. Pass the revision returned by panoma_video_story. Explicit edits and restore work with brain none; an instruction needs a brain. All hook/language/horizontal/vertical plans pass the shared audit before an atomic history entry is saved. Then call panoma_video_render; it consumes this same revision.",
  "panoma_video_render(project_path, brief_id, hook?, lang?, format?) — ONE cut: renders, masters, reviews, kits; returns the contact sheet you must look at. Slow (30–180 s); idempotent on content.",
  "panoma_video_review(project_path, render_id) / panoma_video_frame(project_path, render_id, seconds) — look again: the report, or one full frame.",
  "panoma_video_auto(project_path, goal?, langs?, until?, music?, dance?, creative_brief?) — all of the above in one call: until \"plan\" (seconds), \"preview\" (one reference cut per brief), \"final\" (every cut with its kit). A promo can use measured focus, separate text/product panels, progressive benefits and exact documented terminal/code excerpts; creative_brief guides these choices in words. `music` scores the pieces with a track of your own, cut to the grid. Musical pumping is off by default; only explicit `dance: light|full` enables it.",
  "panoma_video_teach(project_path, about, langs?, until?, music?, dance?) — a tutorial about ONE thing, asked for in words: panoma video reads the product, plans the route that answers it, proves every step in a browser and films only what it proved. Use this when the ask names a task (\"how to do X here\") rather than a product.",
];

export function guideText(): string {
  const schema = JSON.stringify(zodToJsonSchema(BriefSchema, { name: "Brief" }).definitions?.Brief ?? {}, null, 1);
  return [
    `# panoma video — guide (version ${GUIDE_VERSION})`,
    ``,
    `panoma video makes videos about software from the software itself: a project on disk goes in,`,
    `beat-locked 9:16 / 16:9 / 1:1 cuts come out, rendered on this machine, reviewed before`,
    `they are called done. Rendering is cached by its inputs. Revisions append history and`,
    `require the current expectedRevision; a duplicate stale mutation refuses.`,
    ``,
    `## Three rules`,
    `1. Facts, not prose. A video may state a number, a command, a route or a feature name`,
    `   ONLY through a {{fact:<id>}} reference from panoma_video_scout's fact sheet; panoma video`,
    `   expands it verbatim. A literal digit in a brief line is refused by panoma_video_plan.`,
    `2. You write words, panoma video writes structure. Steps, marks, durations, cuts and`,
    `   formats are derived. Your job is hooks, sentences and labels — in every language the`,
    `   brief lists.`,
    `3. Evidence before delivery. Every render returns a review report and a contact sheet.`,
    `   A failing review blocks the final render. Look at the sheet before you say it is done.`,
    ``,
    `## Call order`,
    ...CALL_ORDER.map((c) => `- ${c}`),
    ``,
    `## What the review measures (sources in docs/review.md)`,
    `- The file: black and frozen runs, duplicate frames and the first frame (warnings — a dark interface is`,
    `  black to a luma threshold); planned cuts against scdet (warning); loudness, true peak ≤ −1 dBTP,`,
    `  short-term ≤ integrated + 5 LU, silence, clipping (failures); flashing per ITU-R BT.1702-3, failing`,
    `  only when sustained; platform conformance (codec, profile, colour tags, faststart, duration and size).`,
    `- The story: every number a fact (in the text and in the chip), every narrated mark present in every take,`,
    `  two to four claim→proof pairs in a trailer, the brand inside five seconds, an address or install command`,
    `  at the end, and spoken phrases under 20 characters a second of caption (a warning, fixed by plan).`,
    `- Guidance, not enforced: trailers 30–60 s, tutorials under six minutes; the safe-zone table exists and`,
    `  nothing reports against it yet.`,
    ``,
    `## The brief (JSON Schema)`,
    "```json",
    schema,
    "```",
    ``,
    `A line with a \`mark\` is pinned to that moment of the recording; without one it is the`,
    `closing card. Hooks are plural on purpose: each one becomes its own render.`,
    ``,
    `## The brain`,
    `panoma video has its own judgement when this machine has one: the claude or codex agent, or an Anthropic or OpenAI`,
    `key (PANOMA_VIDEO_BRAIN picks; "auto" is the default). It reads the product, chooses which controls the camera sees`,
    `pressed, writes the words in every language, rewrites what a review says the words can fix, and writes the`,
    `post copy. Its words pass exactly the audit yours do — a digit without a fact is refused line by line — and`,
    `every choice comes back with its reason. Your brief_patch is applied OVER the brain's words: you outrank it.`,
    `Pass brain: "none" to panoma_video_plan, panoma_video_render or panoma_video_auto when you are the one writing.`,
    `An ordinary correction uses panoma_video_story and panoma_video_revise. Starting a different story or replacing stale`,
    `recorded evidence requires explicit new_story: true on panoma_video_plan or panoma_video_auto. The prior history is`,
    `archived intact only after a valid replacement plan exists; rendering never resets it.`,
    ``,
    `## What will refuse`,
    `- A number that is not a fact reference; a fact id that does not exist; a sentence that`,
    `  quotes a roadmap item as if it had shipped.`,
    `- A mark that is not in every take of the session.`,
    `- A path outside the project or outside PANOMA_VIDEO_HOME; an unexpanded \${VARIABLE}.`,
    `- A final render whose review failed (preview renders always run).`,
  ].join("\n");
}

export async function guide(args?: { probe?: ProbeDepth }) {
  const text = guideText();
  // The handshake before every job asks the cheap question; only an explicit check starts a browser.
  const requirements = await probeRequirements(args?.probe === "deep" ? "deep" : "quick");
  return ok(text, { version: GUIDE_VERSION, callOrder: CALL_ORDER, guide: text, requirements });
}
