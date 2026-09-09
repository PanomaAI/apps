/*
  The tour in a few English lines, for whoever did not drive the browser: an
  agent reading an MCP result, a person reading a terminal. A script is a list of
  steps; what a reader wants to know is what the tour shows, what it clicks, and
  what it chose NOT to click and why — which is exactly what the candidates'
  reasons already say, so this is a rendering, not a second opinion.
*/
import { STEP_FLOOR, type TourScript } from "./types.ts";

/** How many candidates the summary lists with their score. */
const TOP = 6;

export function tourSummary(script: TourScript): string {
  const lines: string[] = [];
  const product = script.marks.length;
  lines.push(`Tour "${script.name}" of ${script.url}, written ${script.createdAt.slice(0, 10)}.`);
  lines.push(`Marks in the script (one per moment a sentence can be pinned to): ${product}.`);
  if (product < STEP_FLOOR) {
    lines.push(`That is below the floor the demo-tour vendors publish for a flow, which is ${STEP_FLOOR}.`);
  }
  const chrome = script.steps.filter((s) => "clickOn" in s && s.role === "chrome").length;
  const clicks = script.steps.filter((s) => "clickOn" in s && s.role !== "chrome").length;
  lines.push(`Product clicks: ${clicks}. Chrome clicks (consent, menus; no shot): ${chrome}.`);
  lines.push("");
  lines.push("Marks, in order:");
  for (const m of script.marks) {
    const at = m.target ? ` at ${Math.round(m.target.x)},${Math.round(m.target.y)} (${Math.round(m.target.w)}x${Math.round(m.target.h)})` : "";
    lines.push(`  ${m.name} [${m.kind}] — ${m.label}${at}`);
  }

  const ranked = script.candidates.filter((c) => c.score > 0);
  if (ranked.length) {
    lines.push("");
    lines.push("Calls to action, best first:");
    for (const c of ranked.slice(0, TOP)) {
      const outcome = c.reasons.find((r) => r.startsWith("clicked") || r.startsWith("not clicked"));
      lines.push(`  ${c.score.toFixed(2)}  ${c.description}${outcome ? ` — ${outcome}` : ""}`);
    }
  }

  const skipped = script.candidates.filter((c) => c.score === 0);
  if (skipped.length) {
    lines.push("");
    lines.push("Skipped, and why:");
    for (const c of skipped) lines.push(`  ${c.description} — ${c.reasons[0] ?? "no reason recorded"}`);
  }

  const optional = script.steps.filter((s) => ("clickOn" in s || "scrollTo" in s) && s.optional);
  if (optional.length) {
    lines.push("");
    lines.push(`Optional steps (skipped on a take where the target is not rendered): ${optional.length}.`);
  }
  return lines.join("\n");
}
