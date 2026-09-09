/*
  The guard between a generated brief and a number nobody vouched for. Small on
  purpose: a literal digit is a claim, a placeholder is not, and the two functions
  that decide this must never disagree.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { auditClaims, expandBrief, expandFacts, factIds, type Brief, type FactSheet } from "@panoma/video-core";

const sheet: FactSheet = {
  project: "panoma",
  extractedAt: "2026-09-01T00:00:00Z",
  facts: [
    { id: "git.commits.30d", kind: "number", value: "47", source: "git:log:--since=30 days" },
    { id: "pkg.version", kind: "version", value: "0.1.9", source: "package.json#version" },
    { id: "cmd.install", kind: "command", value: "npx panoma", source: "README.md:14" },
  ],
  notFacts: [{ value: "Windows support is coming next month", source: "docs/roadmap.md:9", why: "roadmap item" }],
};

const brief = (en: string, es = en): Brief => ({
  id: "t",
  recipe: "KineticQuote",
  langs: ["en", "es"],
  bpm: 120,
  hooks: [{ id: "h", text: { en, es } }],
  lines: [{ id: "brand", text: { en: "panoma", es: "panoma" } }],
});

test("placeholders expand verbatim and unknown ids throw with a hint", () => {
  assert.equal(expandFacts("Commits this month: {{fact:git.commits.30d}}.", sheet), "Commits this month: 47.");
  assert.deepEqual(factIds("{{fact:a}} and {{ fact:b.c }}"), ["a", "b.c"]);
  assert.throws(() => expandFacts("{{fact:git.nope}}", sheet), /Unknown fact "git.nope".*git\.commits\.30d/);
});

test("a literal number is a claim; a placeholder is not", () => {
  assert.deepEqual(auditClaims(brief("Commits this month: {{fact:git.commits.30d}}."), sheet), []);
  const claims = auditClaims(brief("You have 47 projects. Name ten."), sheet);
  assert.equal(claims.length, 2);
  assert.equal(claims[0].token, "47");
  assert.equal(claims[0].why, "literal-number");
  assert.equal(claims[0].lang, "en");
});

test("an unknown fact and a quoted non-fact are both reported", () => {
  const claims = auditClaims(brief("{{fact:pkg.nope}} — Windows support is coming next month!"), sheet);
  assert.ok(claims.some((c) => c.why === "unknown-fact" && c.token === "{{fact:pkg.nope}}"));
  assert.ok(claims.some((c) => c.why === "quotes-a-non-fact"));
});

test("expandBrief touches every language of every hook and line, and labels too", () => {
  const b: Brief = {
    ...brief("Version {{fact:pkg.version}} is out", "La versión {{fact:pkg.version}} ya está"),
    lines: [{ id: "l", mark: "m", label: { en: "Run {{fact:cmd.install}}" }, text: { en: "Type {{fact:cmd.install}}.", es: "Escribe {{fact:cmd.install}}." } }],
  };
  const out = expandBrief(b, sheet);
  assert.equal(out.hooks[0].text.es, "La versión 0.1.9 ya está");
  assert.equal(out.lines[0].text.en, "Type npx panoma.");
  assert.equal(out.lines[0].label?.en, "Run npx panoma");
});

test("a prose fact in the wrong language, and a leftover placeholder, are claims too", () => {
  const withLang: FactSheet = {
    ...sheet,
    facts: [...sheet.facts, { id: "readme.tagline", kind: "text", value: "Tu disco, catalogado", source: "README.md:3", lang: "es" }],
  };
  const claims = auditClaims(brief("{{fact:readme.tagline}} — see {{LINK}}"), withLang);
  assert.ok(claims.some((c) => c.why === "wrong-language" && c.lang === "en"));
  assert.ok(!claims.some((c) => c.why === "wrong-language" && c.lang === "es"));
  assert.ok(claims.some((c) => c.why === "placeholder-token" && c.token === "{{LINK}}"));
});

test("the chip is audited like the text: a digit in a label is a claim too", () => {
  const withLabel: Brief = { ...brief("Fine."), lines: [{ id: "claim-1", text: { en: "{{fact:git.commits.30d}} commits" }, label: { en: "Python 3.12" } }] };
  const claims = auditClaims(withLabel, sheet);
  assert.deepEqual(claims.map((c) => [c.line, c.field, c.token, c.why]), [["claim-1", "label", "3.12", "literal-number"]]);
});

test("the result is on screen too: it expands like the text and is audited like the chip", () => {
  const withResult: Brief = { ...brief("Fine."), lines: [{ id: "claim-1", mark: "m", text: { en: "Open it" }, result: { en: "{{fact:cmd.install}}" } }] };
  assert.deepEqual(auditClaims(withResult, sheet), []);
  assert.equal(expandBrief(withResult, sheet).lines[0].result?.en, "npx panoma");
  const counted: Brief = { ...withResult, lines: [{ ...withResult.lines[0], result: { en: "57 projects found" } }] };
  assert.deepEqual(auditClaims(counted, sheet).map((c) => [c.line, c.field, c.token, c.why]), [["claim-1", "result", "57", "literal-number"]]);
});
