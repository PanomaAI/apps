import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { BrainAnswerInvalid, openBrain, type Ask, type Driver } from "@panoma/video-brain";
import * as questions from "../packages/brain/src/questions.ts";
import { codexSchema } from "../packages/brain/src/drivers/codex-schema.ts";
import { codexArgs, codexFailureText } from "../packages/brain/src/drivers/codex.ts";

const { zodToJsonSchema } = createRequire(new URL("../packages/brain/package.json", import.meta.url))("zod-to-json-schema") as typeof import("../packages/brain/node_modules/zod-to-json-schema/dist/types/index.js");
const wire = (shape: z.ZodType) => codexSchema(zodToJsonSchema(shape, { name: "answer", $refStrategy: "none" }).definitions!.answer as Record<string, unknown>);
const entries = (value: Record<string, unknown>) => Object.entries(value).map(([key, value]) => ({ key, value }));

test("every actual brain question has a closed Codex wire schema with required object properties", () => {
  function closed(value: unknown) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(closed); return; }
    const node = value as Record<string, unknown>;
    assert.ok(!("propertyNames" in node), "record key constraints belong to the key field on the wire");
    if (node.type === "object") {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual(node.required, Object.keys(node.properties as object));
    }
    Object.values(node).forEach(closed);
  }
  const shapes = Object.entries(questions).filter(([name]) => name.endsWith("Shape"));
  assert.equal(shapes.length, 10);
  for (const [, shape] of shapes) closed(wire(shape as z.ZodType).schema);
});

test("Codex restores multilingual thesis maps before the existing shape validation", () => {
  const thesis = {
    what: { en: "A catalog", es: "Un catálogo" }, angle: { en: "Find a category", es: "Encuentra una categoría" },
    audience: "Readers", interfaceLang: "es", verbs: ["ver"], show: { first: "Catálogo", flows: ["Categorías"], avoid: [] }, tone: "plain", why: "The page shows a catalog.",
  };
  const decoded = wire(questions.ThesisShape).decode({ ...thesis, what: entries(thesis.what), angle: entries(thesis.angle) });
  assert.deepEqual(questions.ThesisShape.parse(decoded), thesis);
  assert.equal(questions.ThesisShape.safeParse(wire(questions.ThesisShape).decode({ ...thesis, what: [{ key: "too-long", value: "" }], angle: entries(thesis.angle) })).success, false, "transport does not weaken the original key or value validation");
});

test("Codex removes omitted optional promo fields but retains false and validates unknown fields", () => {
  const promo = {
    audience: "Readers", tension: "Find a category", opening: "promise", pace: "crisp",
    theme: null, themeWhy: null, recap: false, inserts: null,
    hooks: [[{ key: "es", value: "Encuentra tu categoría" }]],
    proofs: [{ id: "category", text: [{ key: "es", value: "Ves la categoría elegida" }], facts: ["ui.category"], treatment: null, why: "The recorded filter shows the category." }], why: "Show the category result.",
  };
  const decoded = questions.PromoShape.parse(wire(questions.PromoShape).decode(promo));
  assert.equal(decoded.recap, false);
  for (const key of ["theme", "themeWhy", "inserts"]) assert.ok(!(key in decoded));
  assert.ok(!("treatment" in decoded.proofs[0]));
  assert.deepEqual(decoded.hooks, [{ es: "Encuentra tu categoría" }]);
  assert.equal(questions.PromoShape.safeParse(wire(questions.PromoShape).decode({ ...promo, invented: true })).success, false);
});

test("Codex restores nested patch ids and language maps without turning omitted edits into nulls", () => {
  const decoded = wire(questions.FixedShape).decode({
    hooks: null, lines: [{ key: "benefit-1", value: { text: [{ key: "es", value: "Ves la categoría elegida" }], label: null } }], drop: [], why: "Keep the observed outcome.",
  });
  const result = questions.FixedShape.parse(decoded);
  assert.deepEqual(result.lines, { "benefit-1": { text: { es: "Ves la categoría elegida" } } });
  assert.ok(!("hooks" in result));
});

test("Codex maps refuse repeated keys and malformed entries, and reserved names stay own data", () => {
  const codec = wire(z.object({ values: z.record(z.string()) }));
  assert.throws(() => codec.decode({ values: [{ key: "es", value: "one" }, { key: "es", value: "two" }] }), /repeats a key/);
  assert.throws(() => codec.decode({ values: [{ key: "es", value: "one", extra: true }] }), /invalid entry/);
  assert.throws(() => codec.decode({ values: { es: "one" } }), /entry array/);
  const result = codec.decode({ values: [{ key: "__proto__", value: "own" }, { key: "constructor", value: "also own" }] }) as { values: Record<string, unknown> };
  assert.equal(Object.getPrototypeOf(result.values), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(result.values, "__proto__")?.value, "own");
  assert.equal(result.values.constructor, "also own");
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("optional nullable fields preserve explicit null while optional ordinary fields become omissions", () => {
  const shape = z.object({ ordinary: z.string().optional(), nullable: z.string().nullable().optional() });
  assert.deepEqual(shape.parse(wire(shape).decode({ ordinary: null, nullable: null })), { nullable: null });
});

test("named Codex runs isolate personal integrations and errors report the backend cause", () => {
  const named = codexArgs("/schema.json", "/answer.json", "gpt-5.6-luna", "low");
  assert.ok(named.includes("--ignore-user-config"));
  assert.equal(named[named.indexOf("--model") + 1], "gpt-5.6-luna");
  for (const feature of ["shell_tool", "apps", "hooks", "multi_agent", "remote_plugin"]) assert.equal(named[named.indexOf(feature) - 1], "--disable");
  assert.ok(named.includes('web_search="disabled"'));
  const configured = codexArgs("/schema.json", "/answer.json", "");
  assert.ok(!configured.includes("--ignore-user-config"));
  assert.ok(!configured.includes("--model"));
  const failure = 'ERROR: {\n "error": {"code":"invalid_json_schema","message":"Invalid schema: propertyNames is not permitted."}\n}\nWARN unrelated MCP shutdown';
  assert.equal(codexFailureText(failure, ""), "Invalid schema: propertyNames is not permitted.");
  assert.equal(codexFailureText("error: unauthorized\nWARN unrelated MCP shutdown", ""), "error: unauthorized");
  assert.doesNotMatch(codexFailureText('ERROR: {"message":"token sk_test_abcdefghijklmnopqrstuv"}', ""), /abcdefghijklmnopqrstuv/);
});

const mapShape = z.object({ values: z.record(z.string().min(1)) });
const mapQuestion = { id: "decode-test", version: 1, system: "system", user: "original question", shape: mapShape };
const validMap = { values: [{ key: "es", value: "A valid answer" }] };
const duplicateMap = { values: [{ key: "es", value: "first" }, { key: "es", value: "second" }] };
const invalidValueMap = { values: [{ key: "es", value: "" }] };

function decodingDriver(replies: unknown[]): Driver & { asked: Ask[] } {
  const asked: Ask[] = [];
  return {
    name: "codex", asked,
    async available() { return { ok: true, model: "fake-codex", how: "fixture" }; },
    async complete(ask) {
      const reply = replies[asked.length];
      asked.push(ask);
      if (reply instanceof Error) throw reply;
      return { json: codexSchema(ask.schema).decode(reply), model: "fake-codex" };
    },
  };
}

test("a malformed Codex map receives the existing correction and only the valid decoded result is cached", async () => {
  for (const malformed of [duplicateMap, { values: [{ key: "es" }] }, { values: { es: "object instead of entries" } }]) {
    const dir = await mkdtemp(join(tmpdir(), "panoma-video-codex-retry-"));
    try {
      const driver = decodingDriver([malformed, validMap]);
      const { brain } = await openBrain({ choice: "codex", cacheDir: dir, scratchDir: dir, drivers: [driver], maxCalls: 1 });
      assert.deepEqual((await brain!.ask(mapQuestion)).value, { values: { es: "A valid answer" } });
      assert.equal(driver.asked.length, 2);
      assert.equal(driver.asked[0].user, mapQuestion.user, "the successful first-attempt prompt is unchanged");
      assert.match(driver.asked[1].user, /Your previous answer did not fit the schema \(codex map at answer.values/);
      assert.deepEqual(driver.asked[1].schema, driver.asked[0].schema);
      assert.equal((await brain!.ask(mapQuestion)).hit, true);
      assert.equal(driver.asked.length, 2, "only the corrected value was stored");
      assert.equal(brain!.ledger().calls, 1, "the existing per-question correction budget is unchanged");
      assert.equal(brain!.ledger().failed, 0);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});

test("decode and Zod errors share a single correction, including when the second answer fails in the other layer", async () => {
  for (const replies of [[duplicateMap, duplicateMap], [duplicateMap, invalidValueMap], [invalidValueMap, duplicateMap]]) {
    const dir = await mkdtemp(join(tmpdir(), "panoma-video-codex-refusal-"));
    try {
      const driver = decodingDriver(replies);
      const { brain } = await openBrain({ choice: "codex", cacheDir: dir, scratchDir: dir, drivers: [driver] });
      await assert.rejects(brain!.ask(mapQuestion), BrainAnswerInvalid);
      assert.equal(driver.asked.length, 2);
      assert.equal(brain!.ledger().failed, 1);
      assert.match(brain!.ledger().entries[0].note!, /did not fit its shape twice/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});

test("transport and schema-construction errors do not become answer corrections", async () => {
  for (const replies of [[new Error("codex did not answer within the timeout")], [duplicateMap, new Error("codex transport failed")]]) {
    const dir = await mkdtemp(join(tmpdir(), "panoma-video-codex-transport-"));
    try {
      const driver = decodingDriver(replies);
      const { brain } = await openBrain({ choice: "codex", cacheDir: dir, scratchDir: dir, drivers: [driver] });
      await assert.rejects(brain!.ask(mapQuestion), error => error === replies.at(-1));
      assert.equal(driver.asked.length, replies.length);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-codex-schema-refusal-"));
  try {
    const driver = decodingDriver([{}]);
    const { brain } = await openBrain({ choice: "codex", cacheDir: dir, scratchDir: dir, drivers: [driver] });
    await assert.rejects(brain!.ask({ ...mapQuestion, shape: z.object({ union: z.union([z.string(), z.object({ text: z.string() })]) }) }), /unsupported composition/);
    assert.equal(driver.asked.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
