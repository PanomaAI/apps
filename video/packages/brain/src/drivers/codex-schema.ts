/*
  Codex enforces OpenAI's strict JSON Schema subset: closed objects and required
  properties. panoma video's answers also contain dynamic language/id maps and optional
  patches. Encode those only on the wire, then restore the original shape before
  the brain's Zod validation and the director's claim audit see the answer.
*/
import { DriverAnswerInvalid } from "../driver.ts";

type Schema = Record<string, unknown>;
type Codec = { schema: Schema; decode(value: unknown): unknown };

const object = (value: unknown): value is Schema => !!value && typeof value === "object" && !Array.isArray(value);
const nullable = (schema: Schema): boolean => schema.type === "null" || (Array.isArray(schema.type) && schema.type.includes("null"));

export const CODEX_WIRE_INSTRUCTION = "Transport format: follow the supplied output schema. A map (text by language or patches by id) is an array of {key, value} entries with unique keys, not a JSON object; preserve the original language/id keys. Use null for optional fields you are not providing. panoma video restores maps and omissions before validating your answer. Answer from the provided material only; do not use tools.";

/** A wire-only adapter for the object, array and scalar shapes panoma video asks today. */
export function codexSchema(input: Schema): Codec {
  function visit(source: Schema, path: string): Codec {
    if (["$ref", "anyOf", "oneOf", "allOf", "patternProperties"].some(key => key in source)) {
      throw new Error(`codex cannot encode the schema at ${path}: unsupported composition`);
    }
    if (source.type === "object") {
      const properties = object(source.properties) ? source.properties : {};
      if (object(source.additionalProperties)) {
        if (Object.keys(properties).length) throw new Error(`codex cannot encode a mixed fixed/dynamic object at ${path}`);
        const value = visit(source.additionalProperties, `${path}.*`);
        const key = { type: "string", ...(object(source.propertyNames) ? source.propertyNames : {}) };
        return {
          schema: {
            type: "array",
            description: [source.description, "Map entries with unique keys; preserve each original language or id as key."].filter(Boolean).join(" "),
            items: { type: "object", properties: { key, value: value.schema }, required: ["key", "value"], additionalProperties: false },
          },
          decode(raw) {
            if (!Array.isArray(raw)) throw new DriverAnswerInvalid(`codex map at ${path} must be an entry array`);
            const entries: [string, unknown][] = [];
            const seen = new Set<string>();
            for (const entry of raw) {
              if (!object(entry) || typeof entry.key !== "string" || !("value" in entry) || Object.keys(entry).some(k => k !== "key" && k !== "value")) throw new DriverAnswerInvalid(`codex map at ${path} has an invalid entry`);
              if (seen.has(entry.key)) throw new DriverAnswerInvalid(`codex map at ${path} repeats a key`);
              seen.add(entry.key);
              entries.push([entry.key, value.decode(entry.value)]);
            }
            // Define own data properties, including __proto__; never assign through a prototype setter.
            return Object.fromEntries(entries);
          },
        };
      }
      if (source.additionalProperties === true) throw new Error(`codex cannot encode an untyped open object at ${path}`);
      const required = new Set(Array.isArray(source.required) ? source.required as string[] : []);
      const children = Object.fromEntries(Object.entries(properties).map(([key, value]) => {
        if (!object(value)) throw new Error(`codex cannot encode the property at ${path}.${key}`);
        return [key, { codec: visit(value, `${path}.${key}`), optional: !required.has(key), nullable: nullable(value) }];
      }));
      return {
        schema: {
          ...source,
          properties: Object.fromEntries(Object.entries(children).map(([key, child]) => [key, child.optional && !child.nullable ? { anyOf: [child.codec.schema, { type: "null" }] } : child.codec.schema])),
          required: Object.keys(children),
          additionalProperties: false,
        },
        decode(raw) {
          if (!object(raw)) return raw; // The original Zod shape reports a wrong type.
          return Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => {
            const child = Object.hasOwn(children, key) ? children[key] : undefined;
            if (child?.optional && !child.nullable && value === null) return [];
            return [[key, child ? child.codec.decode(value) : value]];
          }));
        },
      };
    }
    if (source.type === "array") {
      if (!object(source.items)) throw new Error(`codex cannot encode array items at ${path}`);
      const item = visit(source.items, `${path}[]`);
      return { schema: { ...source, items: item.schema }, decode: raw => Array.isArray(raw) ? raw.map(value => item.decode(value)) : raw };
    }
    return { schema: { ...source }, decode: raw => raw };
  }
  return visit(input, "answer");
}
