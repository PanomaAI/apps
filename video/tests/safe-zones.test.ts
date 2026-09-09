import assert from "node:assert/strict";
import { test } from "node:test";
import { EDGES, FORMATS, SAFE_ZONES, TARGETS, isTarget, strictestZone, zoneOf, zoneViolations } from "@panoma/video-core";
import type { FormatId } from "@panoma/video-core";

const FORMAT_IDS: FormatId[] = ["v", "h", "s"];

test("Reels is Meta's published 14/35/6 percent, in pixels on 1080x1920", () => {
  /* https://www.facebook.com/business/ads-guide/update/video/instagram-reels */
  const z = SAFE_ZONES.reels.v;
  assert.equal(z.top, 269);
  assert.equal(z.bottom, 672);
  assert.equal(z.left, 65);
  assert.equal(z.right, 65);
  assert.equal(z.kind, "official");
  assert.match(z.source, /facebook\.com\/business\/ads-guide/);
  assert.equal(z.top, Math.round(0.14 * 1920));
  assert.equal(z.bottom, Math.round(0.35 * 1920));
  assert.equal(z.left, Math.round(0.06 * 1080));
});

test("every target has a sourced, dated zone on every canvas that still leaves a stage", () => {
  for (const target of TARGETS) {
    for (const id of FORMAT_IDS) {
      const z = SAFE_ZONES[target][id];
      const f = FORMATS[id];
      assert.ok(["official", "community"].includes(z.kind), `${target}.${id} kind`);
      assert.match(z.source, /^https:\/\//, `${target}.${id} source`);
      assert.match(z.verified, /^\d{4}-\d{2}-\d{2}$/, `${target}.${id} verified`);
      for (const edge of EDGES) assert.ok(Number.isInteger(z[edge]) && z[edge] > 0, `${target}.${id}.${edge}`);
      assert.ok(z.top + z.bottom < f.height / 2, `${target}.${id} leaves a vertical stage`);
      assert.ok(z.left + z.right < f.width / 2, `${target}.${id} leaves a horizontal stage`);
    }
  }
});

test("the community zones restate the layout union, so a change in format.ts is visible here", () => {
  for (const id of FORMAT_IDS) {
    assert.deepEqual(pick(SAFE_ZONES.tiktok[id]), FORMATS[id].safe, `tiktok.${id}`);
    assert.deepEqual(pick(SAFE_ZONES.shorts[id]), FORMATS[id].safe, `shorts.${id}`);
    assert.equal(SAFE_ZONES.tiktok[id].kind, "community");
  }
  /* And the union is smaller than Reels on the vertical canvas — the reason this module exists. */
  assert.ok(FORMATS.v.safe.bottom < SAFE_ZONES.reels.v.bottom);
});

test("web is the EBU R 95 graphics-safe 5 percent on every canvas", () => {
  /* https://tech.ebu.ch/publications/r095 */
  assert.deepEqual(pick(SAFE_ZONES.web.v), { top: 96, bottom: 96, left: 54, right: 54 });
  assert.deepEqual(pick(SAFE_ZONES.web.h), { top: 54, bottom: 54, left: 96, right: 96 });
  assert.deepEqual(pick(SAFE_ZONES.web.s), { top: 54, bottom: 54, left: 54, right: 54 });
  assert.equal(SAFE_ZONES.web.h.kind, "official");
});

test("the strictest vertical zone takes Reels' top and bottom and TikTok's sides", () => {
  const z = strictestZone("v", ["tiktok", "reels", "shorts"]);
  assert.deepEqual(pick(z), { top: 269, bottom: 672, left: 90, right: 120 });
  assert.equal(z.by.top, "reels");
  assert.equal(z.by.bottom, "reels");
  assert.equal(z.by.left, "tiktok");
  assert.equal(z.by.right, "tiktok");
  /* No targets given means the format's own, which is what the matrix renders for. */
  assert.deepEqual(strictestZone("v"), z);
});

test("unknown and empty target lists are refused by name", () => {
  assert.throws(() => strictestZone("v", ["instagram"]), /Unknown target "instagram"/);
  assert.throws(() => strictestZone("h", []), /at least one target/);
  assert.throws(() => zoneOf("vimeo", "h"), /Unknown target "vimeo"/);
  assert.equal(isTarget("reels"), true);
  assert.equal(isTarget("Reels"), false);
});

test("a CTA that passes layout is reported against Reels, by pixels, and against nothing else", () => {
  /* Bottom of the rectangle at y=1400; Reels reserves from 1248, the union from 1500. */
  const cta = { x: 100, y: 1300, w: 800, h: 100, label: "cta" };
  const found = zoneViolations([cta], "v");
  assert.deepEqual(
    found.map((v) => [v.target, v.label, v.edge, v.by, v.kind]),
    [["reels", "cta", "bottom", 152, "official"]],
  );
  assert.equal(found[0].rect, cta);
});

test("violations come out in target order, then rectangle order, then edge order", () => {
  const corner = { x: 0, y: 0, w: 300, h: 300, label: "logo" };
  const high = { x: 200, y: 200, w: 600, h: 50, label: "kicker" };
  const found = zoneViolations([corner, high], "v", ["shorts", "reels"]);
  assert.deepEqual(
    found.map((v) => `${v.target}/${v.label}/${v.edge}:${v.by}`),
    ["shorts/logo/top:220", "shorts/logo/left:90", "shorts/kicker/top:20", "reels/logo/top:269", "reels/logo/left:65", "reels/kicker/top:69"],
  );
});

test("a rectangle inside every zone reports nothing, and sub-pixel incursions are noise", () => {
  const stage = { x: 100, y: 700, w: 800, h: 500, label: "body" };
  assert.deepEqual(zoneViolations([stage], "v"), []);
  const grazing = { x: 90.3, y: 219.6, w: 800, h: 100, label: "title" };
  assert.deepEqual(zoneViolations([grazing], "v", ["tiktok"]), []);
});

test("a Format object works as well as its id, on the horizontal canvas", () => {
  const lowerThird = { x: 100, y: 1000, w: 600, h: 60, label: "lower-third" };
  const found = zoneViolations([lowerThird], FORMATS.h, ["youtube", "web"]);
  /* YouTube's community strip is 120 (from y=960); EBU's official 54 (from y=1026). */
  assert.deepEqual(
    found.map((v) => [v.target, v.edge, v.by]),
    [["youtube", "bottom", 100], ["web", "bottom", 34]],
  );
});

function pick(z: { top: number; bottom: number; left: number; right: number }) {
  return { top: z.top, bottom: z.bottom, left: z.left, right: z.right };
}
