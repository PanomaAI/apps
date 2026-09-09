import { expandFacts, factIds, isProductDestination, type Brief, type FactSheet, type RenderPlan, type ReviewCheck } from "@panoma/video-core";
import type { SessionLog } from "@panoma/video-capture";
import { promoCloseFor, promoFocusAvailable, promoInsertCandidates, type PromoCandidate } from "./promo.ts";
import { slotsOf } from "./plan.ts";

/** A clean encode cannot vouch for a sales claim or an action the edit omitted. */
export function promoChecks(input: { brief: Brief; facts: FactSheet; takes?: SessionLog[]; plan?: RenderPlan; promoCandidates?: readonly Pick<PromoCandidate, "id" | "facts">[] }): ReviewCheck[] {
  const { brief, facts, takes = [], plan } = input;
  const checks: ReviewCheck[] = [];
  const add = (id: string, ok: boolean, good: string, bad: string, by: "plan" | "record" | "engine" = "plan") => {
    checks.push({ id: `promo.${id}`, status: ok ? "pass" : "fail", summary: ok ? good : bad,
      fix: { by: ok ? "none" : by, hint: ok ? "" : bad } });
  };
  const proofs = brief.lines.filter((line) => line.mark);
  const marks = new Set(proofs.map((line) => line.mark));
  add("one-idea", proofs.length >= 1 && proofs.length <= 3 && marks.size === proofs.length,
    "The film selects one to three distinct demonstrations.", "Select one to three distinct recorded results; remove duplicate or unrelated demonstrations.");
  add("wordless", !brief.voice && [...brief.hooks, ...brief.lines].every((line) => line.mode === "type"),
    "Type and the real product carry the message without narration.", "ProductPromo uses type, product audio and music; remove the voice and mark every line as type.");
  const ids = new Set(facts.facts.map((fact) => fact.id));
  const unbound = [...brief.hooks, ...proofs].filter((line) => {
    const evidence = brief.promo?.evidence[line.id];
    const available = input.promoCandidates?.find((candidate) => candidate.id === evidence?.mark)?.facts;
    return !evidence || !marks.has(evidence.mark) || (line.mark && line.mark !== evidence.mark) ||
      (!line.mark && evidence.mark !== proofs[0]?.mark) || !available ||
      evidence.facts.length === 0 || evidence.facts.some((id) => !ids.has(id) || !available.some((fact) => fact.id === id)) ||
      brief.langs.some((lang) => !line.text[lang]?.trim() || factIds(line.text[lang] ?? "").some((id) => !evidence.facts.includes(id)));
  });
  add("evidence", unbound.length === 0,
    "Every hook and benefit uses its selected demonstration's allowed facts; semantic paraphrase remains an editorial judgment.",
    `Bind these lines to their selected proof and its source facts: ${unbound.map((line) => line.id).join(", ")}.`);

  const unsupported = Object.entries(brief.promo?.treatments ?? {}).filter(([id, treatment]) => {
    const proof = proofs.find((line) => line.id === id);
    return !proof || !["full", "focus", "split"].includes(treatment) ||
      (treatment === "focus" && !promoFocusAvailable(takes, proof.mark!));
  });
  add("treatments", unsupported.length === 0 && (!brief.promo?.recap || proofs.length >= 2),
    "Each presentation treatment has the recorded material it needs; recap repeats already demonstrated benefits.",
    `Use focus only for a bounded measured result in every take, split/full only on proof lines, and recap only with two or more proofs${unsupported.length ? `: ${unsupported.map(([id]) => id).join(", ")}` : ""}.`);

  const sourceMenu = promoInsertCandidates(facts, brief.langs);
  const inserts = brief.promo?.inserts ?? [];
  const insertLines = new Set<string>();
  const insertFacts = new Set<string>();
  const badInserts: string[] = [];
  for (const insert of inserts) {
    const line = brief.lines.find((line) => line.id === insert.line);
    const ids = line ? factIds(line.text[brief.langs[0]] ?? "") : [];
    const source = sourceMenu.find((entry) => entry.kind === insert.kind && entry.fact.id === ids[0]);
    const valid = line && !line.mark && line.mode === "type" && !["brand", "end"].includes(line.id) &&
      !insertLines.has(insert.line) && ids.length === 1 && source && !insertFacts.has(source.fact.id) &&
      proofs.some((proof) => proof.id === insert.after) && Object.keys(line.text).every((lang) => brief.langs.includes(lang)) &&
      brief.langs.every((lang) => /^\{\{\s*fact:[A-Za-z0-9._-]+\s*\}\}$/.test(line.text[lang] ?? "") &&
        factIds(line.text[lang] ?? "").length === 1 && factIds(line.text[lang] ?? "")[0] === source.fact.id);
    if (!valid) badInserts.push(insert.line);
    insertLines.add(insert.line);
    if (source) insertFacts.add(source.fact.id);
  }
  const orphan = brief.lines.filter((line) => !line.mark && !["brand", "end"].includes(line.id) && !insertLines.has(line.id));
  add("source-inserts", inserts.length <= 2 && badInserts.length === 0 && orphan.length === 0,
    "Terminal and code inserts quote short source excerpts exactly; no command result or successful execution is invented.",
    `Use at most two distinct source-only command/code inserts after selected proofs; remove invented text or output${badInserts.length || orphan.length ? `: ${[...badInserts, ...orphan.map((line) => line.id)].join(", ")}` : ""}.`);

  const absent: string[] = [];
  for (const take of takes) for (const line of proofs) {
    const mark = take.marks?.find((mark) => mark.name === line.mark);
    const end = mark ? (take.marks?.find((other) => other.t > mark.t)?.t ?? take.durationMs) : 0;
    const click = mark && take.events.some((event) => event.kind === "click" && event.role !== "chrome" && event.t >= mark.t && event.t < end);
    const changed = take.macros?.find((macro) => macro.mark === line.mark)?.change;
    if (!click || !changed || changed.share <= 0 || changed.box.width <= 0 || changed.box.height <= 0) absent.push(`${take.take}:${line.mark}`);
  }
  add("recorded-result", takes.length > 0 && absent.length === 0,
    "Every demonstration contains a product click and measured changed pixels in every take.",
    `Record the actual action and result in every take${absent.length ? `: ${absent.join(", ")}` : ". No take was supplied"}.`, "record");

  const end = brief.lines.find((line) => line.id === "end");
  const brand = brief.lines.find((line) => line.id === "brand");
  const close = brief.promo?.close;
  const exact = (line: typeof brand, fact: string) => Boolean(line && brief.langs.every((lang) =>
    line.text[lang] === `{{fact:${fact}}}`));
  const source = close && facts.facts.find((fact) => fact.id === close.fact && fact.source === close.source);
  const selected = promoCloseFor(facts);
  const validClose = close ? Boolean(source && selected?.kind === close.kind && selected.fact === close.fact && exact(brand, slotsOf(facts).name) && (close.kind === "brand"
    ? close.reason === "no-public-destination" && !end
    : source.kind === "url" && isProductDestination(source.value) && exact(end, close.fact)))
    : Boolean(brand && end && brief.langs.every((lang) =>
    factIds(brand.text[lang] ?? "").some((id) => ids.has(id)) &&
    factIds(end.text[lang] ?? "").some((id) => facts.facts.some((fact) => fact.id === id && fact.kind === "url"))));
  add("destination", validClose,
    close?.kind === "brand" ? "The close names the sourced product; no public destination or availability is implied." : "The close identifies the product and a sourced destination.",
    "Keep the exact sourced closing decision: product identity alone when no public destination exists, otherwise the sourced URL.");

  if (plan) {
    if (close) {
      const lang = plan.lang ?? brief.langs[0];
      let expected = "";
      try { expected = [brand, end].filter(Boolean).map((line) => expandFacts(line!.text[lang] ?? "", facts)).join("\n"); } catch { /* The claim check names missing facts. */ }
      const closing = plan.cards.find((card) => card.id === "end");
      add("rendered-close", plan.promoClose?.kind === close.kind && plan.promoClose.fact === close.fact && plan.promoClose.source === close.source &&
        (close.kind !== "brand" || (plan.promoClose.kind === "brand" && plan.promoClose.reason === close.reason)) && Boolean(expected && closing?.text === expected && closing.to === plan.durationInFrames),
        "The rendered closing card matches its exact sourced identity and selected destination policy.",
        "Rebuild this composition from its saved close; its rendered closing card does not match the selected source.", "engine");
    }
    const theme = brief.promo?.theme ?? "flat";
    add("theme", ["flat", "vibrant", "block", "grid"].includes(theme) && (plan.editorialTheme ?? "flat") === theme,
      `One ${theme} editorial theme is locked for the entire composition; recorded product pixels keep their own appearance.`,
      "Render the complete promotion with its selected theme; do not combine themes or reuse a plan from a different selection.", "engine");
    const uses = plan.uses ?? [];
    const broken = proofs.filter((line) => {
      const use = uses.find((use) => use.id === line.id && use.mark === line.mark);
      return !use || !(use.from <= use.actionFrame && use.actionFrame < use.resultFrame && use.resultFrame < use.to) ||
        (use.to - use.resultFrame) / plan.fps < 0.6;
    });
    add("cause-and-result", uses.length === proofs.length && broken.length === 0,
      "The plan includes each logged action and leaves time for its result; encoded action alignment also depends on the recording clock.",
      `The recorded action or readable result is missing from: ${broken.map((line) => line.id).join(", ") || "the proof plan"}.`, "engine");
    const openingCard = plan.cards.find((card) => card.from === 0);
    const firstProduct = openingCard ? openingCard.to : 0;
    add("early-value", firstProduct / plan.fps <= 3,
      "The product appears within the opening three seconds (a house editing target).",
      "Shorten the opening: the product needs to appear within three seconds.");
    const unreadable = plan.cards.filter((card) => {
      const readFrom = card.readFrom ?? card.from;
      if (![card.from, card.to, readFrom].every(Number.isFinite) || card.from < 0 || readFrom < card.from || readFrom >= card.to || card.to > plan.durationInFrames) return true;
      const line = [...brief.hooks, ...brief.lines].find((line) => line.id === (card.id ?? card.text))
        ?? (card.id === "end" && close?.kind === "brand" ? brand : undefined);
      if (!line) return false;
      const seconds = (card.to - readFrom) / plan.fps;
      return (plan.lang ? [plan.lang] : brief.langs).some((lang) => {
        try { return [...(card.id && card.text ? card.text : expandFacts(line.text[lang] ?? "", facts))].length / Math.max(seconds, 0.001) > 24; }
        catch { return true; }
      });
    });
    add("readable-cards", unreadable.length === 0,
      "Each full-frame card has time to be read after its entrance settles.",
      `Shorten or lengthen these cards: ${unreadable.map((card) => card.text).join(", ")}.`);

    const expectedText = [
      ...proofs.filter((line) => brief.promo?.treatments?.[line.id] === "split").map((line) => ({ id: line.id, kind: "split" })),
      ...(brief.promo?.recap ? proofs.map((line) => ({ id: line.id, kind: "recap" })) : []),
      ...inserts.map((insert) => ({ id: insert.line, kind: insert.kind })),
    ];
    const texts = plan.texts ?? [];
    const absentText = expectedText.filter((expected) => texts.filter((text) => text.id === expected.id && text.kind === expected.kind).length !== 1);
    const badText = texts.filter((text) => {
      const line = brief.lines.find((line) => line.id === text.id);
      const readableFrom = text.readFrom ?? text.from;
      if (!line || !expectedText.some((expected) => expected.id === text.id && expected.kind === text.kind) ||
          ![text.from, text.to, readableFrom].every(Number.isFinite) || text.from < 0 || readableFrom < text.from ||
          readableFrom >= text.to || text.to > plan.durationInFrames) return true;
      const seconds = (text.to - readableFrom) / plan.fps;
      return (plan.lang ? [plan.lang] : brief.langs).some((lang) => {
        try {
          const source = expandFacts(line.text[lang] ?? "", facts);
          return (text.text !== undefined && text.text !== source) || [...source].length / Math.max(seconds, 0.001) > 24;
        } catch { return true; }
      });
    });
    add("readable-effects", absentText.length === 0 && badText.length === 0,
      "Split explanations, progressive benefits and source inserts have readable time after their text arrives.",
      `Keep each requested text treatment and its exact copy visible long enough after arrival${absentText.length || badText.length ? `: ${[...absentText, ...badText].map((text) => `${text.kind}:${text.id}`).join(", ")}` : ""}.`, "engine");
    const missingTreatment = proofs.filter((line) => (uses.find((use) => use.id === line.id)?.treatment ?? "full") !== (brief.promo?.treatments?.[line.id] ?? "full"));
    add("rendered-treatments", missingTreatment.length === 0,
      "The rendered proof plan preserves the selected presentation treatments.",
      `Render the requested treatment for: ${missingTreatment.map((line) => line.id).join(", ")}.`, "engine");
  }
  return checks;
}
