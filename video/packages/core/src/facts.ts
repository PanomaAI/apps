/*
  Facts: the only things a generated video may state.

  A number in a product video is a claim, and a claim an agent wrote from memory is the
  failure this whole layer exists to prevent — regulators have made Apple and Google pull
  demo videos for features that were not there, and the measured record of language
  models is that schema-valid output is still semantically wrong about a fifth of the
  time. So the words of an automatic brief do not carry numbers, commands, routes or
  version strings directly. They carry `{{fact:id}}` references, and panoma video expands them
  verbatim from a sheet that was read from the repository, with a source for each entry.

  The audit is deliberately literal: any digit that is not inside a placeholder is a
  claim nobody vouched for, and it is reported by line and language so the fix is one
  edit. Hand-written briefs in briefs/index.ts are never audited — the guard exists
  where automation exists, not where a person signed the sentence.
*/
import type { Brief, Line } from "./brief.ts";

export type FactKind = "number" | "text" | "command" | "code" | "route" | "feature" | "quote" | "version" | "date" | "url";

export type Fact = {
  /** Stable, human-readable: "readme.tagline", "pkg.version", "git.commits.30d", "route.docs". */
  readonly id: string;
  readonly kind: FactKind;
  /** Verbatim. Never normalised, never rounded. */
  readonly value: string;
  /** Where it was read: "README.md:12" · "package.json#scripts.dev" · "git:tag:v1.2.0" · "route:/docs". */
  readonly source: string;
  /*
    The language of a prose fact, when it has one. A tagline in Spanish must not land
    in the English track, and digits cannot tell: the audit checks that a text fact
    placed in a language track matches it. Commands, routes, versions, numbers and
    URLs have no language and leave this unset.
  */
  readonly lang?: string;
};

export type FactSheet = {
  readonly project: string;
  /** ISO timestamp of the read. */
  readonly extractedAt: string;
  /** Git commit the facts were read at, when the project is a repository. */
  readonly head?: string;
  readonly facts: readonly Fact[];
  /*
    Things that look like facts and are not: a TODO, a roadmap bullet, an open pull
    request. They are kept so the audit can say "this sentence quotes a plan as if it
    had shipped" instead of silently letting it through.
  */
  readonly notFacts: readonly { value: string; source: string; why: string }[];
};

const PLACEHOLDER = /\{\{\s*fact:([A-Za-z0-9._-]+)\s*\}\}/g;

/** The fact ids a text references, in order, duplicates kept. */
export function factIds(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

export function findFact(sheet: FactSheet, id: string): Fact | undefined {
  return sheet.facts.find((f) => f.id === id);
}

/** Replace every placeholder with the fact's verbatim value. Unknown ids throw. */
export function expandFacts(text: string, sheet: FactSheet): string {
  return text.replace(PLACEHOLDER, (_, id: string) => {
    const fact = findFact(sheet, id);
    if (!fact) {
      const near = sheet.facts
        .map((f) => f.id)
        .filter((f) => f.startsWith(id.split(".")[0]))
        .slice(0, 6);
      throw new Error(
        `Unknown fact "${id}". ${near.length > 0 ? `Facts that start the same way: ${near.join(", ")}.` : `The sheet has ${sheet.facts.length} ${sheet.facts.length === 1 ? "fact" : "facts"}.`}`,
      );
    }
    return fact.value;
  });
}

function expandLine(line: Line, sheet: FactSheet): Line {
  const text = Object.fromEntries(Object.entries(line.text).map(([lang, t]) => [lang, expandFacts(t, sheet)]));
  const label = line.label
    ? Object.fromEntries(Object.entries(line.label).map(([lang, t]) => [lang, expandFacts(t, sheet)]))
    : undefined;
  const result = line.result
    ? Object.fromEntries(Object.entries(line.result).map(([lang, t]) => [lang, expandFacts(t, sheet)]))
    : undefined;
  return { ...line, text, ...(label ? { label } : {}), ...(result ? { result } : {}) };
}

/** A brief with every placeholder expanded, ready for voice, captions and type. */
export function expandBrief(brief: Brief, sheet: FactSheet): Brief {
  return {
    ...brief,
    hooks: brief.hooks.map((h) => expandLine(h, sheet)),
    lines: brief.lines.map((l) => expandLine(l, sheet)),
  };
}

export type Claim = {
  /** Hook or line id. */
  readonly line: string;
  readonly lang: string;
  /** The offending token, verbatim. */
  readonly token: string;
  readonly why: "literal-number" | "unknown-fact" | "quotes-a-non-fact" | "wrong-language" | "placeholder-token";
  /** Set when the token sits in the line's chip or its result rather than its text; both are on screen too. */
  readonly field?: "label" | "result";
};

/*
  A digit run with the punctuation that rides on numbers: "47", "1.2", "9,4", "10%",
  "0:30", "v1.2.0". Ordinal words ("ten", "diez") are not caught on purpose — they are
  rhetoric, not measurement, and "Name ten" is a hook this repository already ships.
*/
const NUMBER = /v?\d[\d.,:%]*/g;

/**
 * Every claim in a brief that no fact vouches for.
 *
 * Runs on the UNEXPANDED text: a placeholder is fine whatever it expands to, and any
 * other digit is a literal number someone typed. A `{{fact:...}}` that names nothing
 * is reported too, so the audit and the expansion can never disagree about a brief.
 */
export function auditClaims(brief: Brief, sheet: FactSheet): Claim[] {
  const out: Claim[] = [];
  const known = new Set(sheet.facts.map((f) => f.id));
  const quiet = sheet.notFacts.map((n) => n.value.trim().toLowerCase()).filter((v) => v.length >= 12);

  /* The chip and the result are audited under the same rules as the text: both are on screen, and the chip was the one place a digit slipped through. */
  for (const line of [...brief.hooks, ...brief.lines]) {
    const fields: [Claim["field"], Record<string, string>][] = [
      [undefined, line.text],
      ...(line.label ? [["label", line.label] as [Claim["field"], Record<string, string>]] : []),
      ...(line.result ? [["result", line.result] as [Claim["field"], Record<string, string>]] : []),
    ];
    for (const [field, texts] of fields) {
      const at = field ? { field } : {};
      for (const [lang, raw] of Object.entries(texts)) {
        for (const id of factIds(raw)) {
          if (!known.has(id)) out.push({ line: line.id, lang, token: `{{fact:${id}}}`, why: "unknown-fact", ...at });
        }
        for (const id of factIds(raw)) {
          const fact = findFact(sheet, id);
          if (fact?.lang && fact.lang !== lang) out.push({ line: line.id, lang, token: `{{fact:${id}}}`, why: "wrong-language", ...at });
        }
        const stripped = raw.replace(PLACEHOLDER, " ");
        for (const m of stripped.matchAll(NUMBER)) {
          out.push({ line: line.id, lang, token: m[0], why: "literal-number", ...at });
        }
        /* A kit placeholder or an unexpanded template token inside a video is a hole on screen. */
        for (const m of stripped.matchAll(/\{\{[^}]*\}\}|\{[A-Z_]{3,}\}|\bLINK_HERE\b/g)) {
          out.push({ line: line.id, lang, token: m[0], why: "placeholder-token", ...at });
        }
        const lower = stripped.toLowerCase();
        for (const value of quiet) {
          if (lower.includes(value)) out.push({ line: line.id, lang, token: value, why: "quotes-a-non-fact", ...at });
        }
      }
    }
  }
  return out;
}

/** The claims a rendered line makes, for the provenance manifest. */
export function claimsOf(brief: Brief): { line: string; lang: string; facts: string[] }[] {
  const rows: { line: string; lang: string; facts: string[] }[] = [];
  for (const line of [...brief.hooks, ...brief.lines]) {
    for (const [lang, raw] of Object.entries(line.text)) {
      const ids = factIds(raw);
      if (ids.length > 0) rows.push({ line: line.id, lang, facts: [...new Set(ids)] });
    }
  }
  return rows;
}
