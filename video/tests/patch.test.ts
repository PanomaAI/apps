/*
  A patch survives regeneration because it is keyed by id and applied last; the
  things it may not do are as important as the things it may.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPatch, unknownPatchIds, type Brief, type BriefPatch } from "@panoma/video-core";

const brief: Brief = {
  id: "t",
  recipe: "Tutorial",
  langs: ["en", "es"],
  bpm: 120,
  hooks: [{ id: "h", text: { en: "Hook", es: "Gancho" } }],
  lines: [
    { id: "a", mark: "m1", text: { en: "A", es: "A es" } },
    { id: "b", mark: "m2", text: { en: "B", es: "B es" } },
    { id: "cta", text: { en: "Go", es: "Ve" } },
  ],
};

test("text, labels and results merge per language; other languages are untouched", () => {
  const out = applyPatch(brief, { lines: { a: { text: { es: "Mejor" }, label: { en: "Step" }, result: { en: "Your catalog" } } } });
  assert.equal(out.lines[0].text.es, "Mejor");
  assert.equal(out.lines[0].text.en, "A");
  assert.equal(out.lines[0].label?.en, "Step");
  assert.equal(out.lines[0].result?.en, "Your catalog");
});

test("drop removes lines, add appends, and the last hook can never be dropped", () => {
  const out = applyPatch(brief, { drop: ["b", "h"], add: [{ id: "c", mark: "m3", text: { en: "C", es: "C es" } }], voiceSpeed: 0.9 });
  assert.deepEqual(out.lines.map((l) => l.id), ["a", "cta", "c"]);
  assert.equal(out.hooks.length, 1);
  assert.equal(out.voiceSpeed, 0.9);
});

test("unknown ids are named rather than ignored", () => {
  const patch: BriefPatch = { lines: { nope: { text: { en: "x" } } }, hooks: { h: { text: { en: "y" } } }, drop: ["zzz"] };
  assert.deepEqual(unknownPatchIds(brief, patch), ["lines.nope", "drop.zzz"]);
});
