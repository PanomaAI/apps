/* One preflight for a revised story and an explicitly requested replacement story. */
import { expandBrief, factIds, JOBS, type Brief } from "@panoma/video-core";
import type { Promo } from "@panoma/video-brain";
import type { buildCompositions } from "@panoma/video-render/compositions";
import { promoCandidates, validatePromoChoice, type PromoForInput } from "./promo.ts";
import { storyChecks } from "./story-checks.ts";

export async function validatePromoVariants(input: { brief: Brief; material: PromoForInput; dirs: Parameters<typeof buildCompositions>[1];
  /** The unpatched proposal: unchanged original copy keeps its existing contract. */
  baseline?: Brief;
}): Promise<void> {
  const { brief, material, dirs } = input;
  await import("@panoma/video-engine/register");
  const { buildCompositions } = await import("@panoma/video-render/compositions");
  const menu = promoCandidates(material);
  if (input.baseline) {
    const proofs = brief.lines.filter(line => line.mark);
    const choice: Promo = { audience: "The selected promotional audience", tension: "Preserve the supported argument while applying the explicit replacement patch.",
      opening: brief.promo!.opening, pace: brief.promo!.pace, theme: brief.promo!.theme,
      hooks: brief.hooks.map(line => line.text),
      proofs: proofs.map(line => ({ id: line.mark!, text: line.text, facts: [...(brief.promo!.evidence[line.id]?.facts ?? [])],
        treatment: brief.promo!.treatments?.[line.id], why: "The replacement retains recorded proof and source facts." })),
      recap: brief.promo!.recap,
      inserts: brief.promo!.inserts?.map(insert => ({ kind: insert.kind,
        fact: factIds(brief.lines.find(line => line.id === insert.line)?.text[brief.langs[0]] ?? "")[0] ?? "",
        after: proofs.find(line => line.id === insert.after)?.mark ?? "" })),
      why: "Validate newly patched copy before preserving the old story in the archive.",
    };
    const preservedText = Object.fromEntries([
      ...input.baseline.lines.filter(line => line.mark).map(line => [line.mark!, line.text]),
      ...input.baseline.hooks.map((line, index) => [`hook-${index + 1}`, line.text]),
    ]);
    const refused = validatePromoChoice(material, menu.facts, menu.candidates, choice, { preservedText });
    if (refused.length) throw new Error(refused.map(issue => `${issue.id}${issue.lang ? `/${issue.lang}` : ""}: ${issue.why}${issue.token ? ` (${issue.token})` : ""}`).join("\n"));
  }
  const formats = JOBS.sell.formats.filter(format => !material.formats || material.formats.includes(format));
  const matrix = buildCompositions([expandBrief(brief, menu.facts)], dirs, { formats });
  if (!formats.length || matrix.mismatched.size || matrix.compositions.length !== brief.hooks.length * brief.langs.length * formats.length) {
    throw new Error("Matching recordings are required for every selected promotion format.");
  }
  const failures = matrix.compositions.flatMap(comp => storyChecks({ brief, facts: menu.facts, takes: [...material.takes], tour: material.tour,
    plan: matrix.plans.get(comp.id), promoCandidates: menu.candidates }).filter(check => check.status === "fail").map(check => `${comp.id}: ${check.summary}`));
  if (failures.length) throw new Error([...new Set(failures)].join("\n"));
}
