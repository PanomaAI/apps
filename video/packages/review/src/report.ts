/*
  The report as text, for a terminal and for the text mirror of an MCP result. Two
  levels because the two readers differ: a person at `panoma-video review` wants the verdict
  and what to fix; a model that asked for `detail: "detailed"` wants every check with
  its threshold and its source so it can act without a second call.

  The rules of the house apply to every sentence: the number closes the phrase
  ("cuts: 6"), never "6 cuts" glued to a word that inflects.
*/
import type { ReviewCheck, ReviewReport } from "./types.ts";

export type Detail = "concise" | "detailed";

const MARK: Record<ReviewCheck["status"], string> = { pass: "pass", warn: "WARN", fail: "FAIL", skip: "skip" };

function measuredLine(r: ReviewReport): string {
  const m = r.measured;
  const parts = [`${m.seconds.toFixed(1)} s`, `${m.width}x${m.height}`, `${Number(m.fps.toFixed(3))} fps`];
  if (m.lufs !== undefined) parts.push(`${m.lufs.toFixed(1)} LUFS`);
  if (m.truePeak !== undefined) parts.push(`TP ${m.truePeak.toFixed(1)} dBTP`);
  if (m.lra !== undefined) parts.push(`LRA ${m.lra.toFixed(1)} LU`);
  if (m.maxShortTerm !== undefined) parts.push(`max S ${m.maxShortTerm.toFixed(1)} LUFS`);
  if (m.cuts !== undefined) parts.push(`cuts: ${m.cuts}`);
  if (m.encoder) parts.push(m.encoder);
  return parts.join(" · ");
}

function where(c: ReviewCheck): string {
  if (!c.at?.length) return "";
  const shown = c.at.slice(0, 5).map((a) => `${a.seconds.toFixed(2)}s${a.frame !== undefined ? ` (f${a.frame})` : ""}`);
  const more = c.at.length > 5 ? ` +${c.at.length - 5}` : "";
  return ` @ ${shown.join(", ")}${more}`;
}

function line(c: ReviewCheck, detail: Detail): string {
  const head = `${MARK[c.status]} ${c.id}: ${c.summary}${where(c)}`;
  if (detail === "concise") return head;
  const extra: string[] = [];
  if (c.threshold) extra.push(`threshold: ${c.threshold}`);
  if (c.source) extra.push(`source: ${c.source}`);
  return extra.length ? `${head}\n      ${extra.join("\n      ")}` : head;
}

/** The report for a terminal or a tool result. */
export function reportText(report: ReviewReport, detail: Detail = "concise"): string {
  const out: string[] = [];
  out.push(`${report.status.toUpperCase()} ${report.file}`);
  out.push(`  ${measuredLine(report)}`);
  const counts = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const c of report.checks) counts[c.status]++;
  const shown = detail === "detailed" ? report.checks : report.checks.filter((c) => c.status === "fail" || c.status === "warn");
  const ordered = [...shown].sort((a, b) => rank(a.status) - rank(b.status));
  for (const c of ordered) out.push(`  ${line(c, detail)}`);
  out.push(`  checks — failed: ${counts.fail} · warned: ${counts.warn} · passed: ${counts.pass} · skipped: ${counts.skip}`);
  return out.join("\n");
}

function rank(status: ReviewCheck["status"]): number {
  return status === "fail" ? 0 : status === "warn" ? 1 : status === "pass" ? 2 : 3;
}
