import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { normalizeCreationRequest, readCreationManifest, restrictCreationMatrix, type CreationManifest } from "../packages/director/src/creation-settings.ts";
import { writeJson } from "../packages/director/src/workspace.ts";

process.env.PANOMA_VIDEO_BRAIN = "none";

test("creation defaults are explicit and neutral", () => {
  const request = normalizeCreationRequest({ root: "/projects/acme" });
  assert.deepEqual({ purpose: request.purpose, langs: request.langs, formats: request.formats, theme: request.theme, voice: request.voice, dance: request.dance, finish: request.finish },
    { purpose: "product", langs: ["es"], formats: ["v"], theme: "normal", voice: "auto", dance: "off", finish: "plan" });
});

test("creation rejects unknown, malformed and incompatible options instead of ignoring active controls", () => {
  for (const patch of [
    { root: "relative" }, { root: "/bad\0folder" }, { ignoredOption: true }, { formats: [] }, { formats: ["v", "v"] },
    { langs: ["fr"] }, { theme: "glass" }, { creative: "a".repeat(2001) }, { audience: "a".repeat(301) }, { outcome: "a".repeat(501) },
    { purpose: "release", theme: "block" }, { purpose: "tutorial", opening: "result" }, { purpose: "auto", recap: "on" },
    { voice: "on" }, { about: "Open notes" }, { purpose: "tutorial", audience: "Teams" },
  ]) assert.throws(() => normalizeCreationRequest({ root: "/acme", ...patch }), JSON.stringify(patch));
});

test("the saved selection filters actual compositions, sound, captions and review plans together", () => {
  const ids = ["chosen--one--es--v", "chosen--one--es--h", "chosen--one--en--v", "other--one--es--v"];
  const entries = ids.map(id => [id, { id }] as const);
  const matrix = { compositions: ids.map(id => ({ id, marker: true })), mismatched: new Set(ids.slice(1)), chapters: new Map(entries), plans: new Map(entries), words: new Map(entries), beds: new Map(entries) };
  const manifest: CreationManifest = { version: 1, createdAt: "2026-09-06", settings: normalizeCreationRequest({ root: "/acme" }),
    selection: { briefIds: ["chosen"], recipe: "ProductPromo", why: "Requested", formats: ["v"], langs: ["es"], voice: "none" } };
  const filtered = restrictCreationMatrix(matrix, manifest);
  assert.deepEqual(filtered.compositions, [{ id: ids[0], marker: true }]);
  assert.equal(filtered.mismatched.size, 0);
  for (const key of ["chapters", "plans", "words", "beds"] as const) assert.deepEqual([...filtered[key].keys()], [ids[0]]);
  assert.equal(matrix.compositions.length, 4, "the source matrix is unchanged");
});

/*
  The saved constraints outlive the browser that once wrote them: a workspace that
  already has a `creation.json` on disk is still opened under it, so the file has to be
  read the same way whether it is absent, sound or damaged.
*/
test("saved creation constraints are read whole, missing, or refused as damaged", async t => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-creation-manifest-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal(await readCreationManifest(dir), undefined, "a workspace without saved constraints is unconstrained, not broken");
  const manifest: CreationManifest = { version: 1, createdAt: "2026-09-06T00:00:00Z", settings: normalizeCreationRequest({ root: "/acme", formats: ["v"], langs: ["es"] }),
    selection: { briefIds: ["chosen"], recipe: "ProductPromo", why: "Requested", formats: ["v"], langs: ["es"], voice: "none" } };
  await writeJson(join(dir, "creation.json"), manifest);
  assert.deepEqual(await readCreationManifest(dir), manifest);
  for (const damaged of [{ broken: true }, { ...manifest, selection: { ...manifest.selection, formats: ["h"] } }, { ...manifest, selection: { ...manifest.selection, recipe: "Tutorial" } }]) {
    await writeJson(join(dir, "creation.json"), damaged);
    await assert.rejects(readCreationManifest(dir), /saved video configuration is invalid/, JSON.stringify(damaged));
  }
});
