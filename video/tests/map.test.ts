/*
  The map: what it may draw, and what it may never draw.

  It is the first artifact panoma video publishes that is made of the walker's own text — every
  other public surface is either a fact with a source or a frame rendered from a masked
  take — so the assertions below are about provenance as much as geometry.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultColors, type BrandProfile } from "@panoma/video-brand";
import { deriveDirection } from "@panoma/video-brand/direction";
import { layerOf, mapSvg } from "@panoma/video-director";
import type { TourScript } from "@panoma/video-tour";

const brand: BrandProfile = {
  source: { extractedAt: "2026-09-03T00:00:00.000Z" },
  name: "Universend",
  colors: {
    ...defaultColors(),
    primary: { hex: "#dbff64", confidence: "high", origin: "census" },
    background: { hex: "#02030a", confidence: "high", origin: "body" },
    surface: { hex: "#161615", confidence: "medium", origin: "derived" },
    text: { hex: "#f4f2ea", confidence: "high", origin: "css-token:--ink" },
    muted: { hex: "#7b8296", confidence: "high", origin: "css-token:--muted" },
    onPrimary: { hex: "#000000", confidence: "high", origin: "wcag" },
  },
  tokens: {},
  scheme: { supports: ["dark"], default: "dark" },
  type: { heading: { category: "sans", family: "Geist" }, body: { category: "sans", family: "Geist" }, mono: { category: "mono", family: "Geist Mono" } },
  tone: { register: "neutral", metrics: {} },
};

const tour = {
  name: "t",
  url: "http://127.0.0.1:51640/",
  createdAt: "2026-09-03T00:00:00.000Z",
  steps: [],
  marks: [],
  candidates: [],
  snapshot: "",
  flow: { title: "t", steps: [] },
  pages: [
    { id: "h0", path: "/", heading: "What's the front door to your projects?", order: 0 },
    { id: "h1", path: "/projects", heading: "Your catalog", order: 1 },
    { id: "h2", path: "/bridge", heading: "Bridge", order: 2 },
  ],
  edges: [
    { from: "h0", to: "h1", mark: "cta", label: "Get started", kind: "cta" as const },
    { from: "h1", to: "h2", mark: "bridge", label: "Bridge", kind: "nav" as const, desktopOnly: true },
    { from: "h2", to: "h0", label: "Home", kind: "nav" as const, seen: true },
  ],
} satisfies TourScript;

const direction = deriveDirection(brand, { flows: 2 });

test("the map is byte-identical for the same tour", () => {
  assert.equal(mapSvg(tour, direction), mapSvg(tour, direction));
});

test("every colour in the map is one the product's direction chose", () => {
  const svg = mapSvg(tour, direction);
  const allowed = new Set([direction.stage.hex, direction.plate.hex, direction.ink.hex, direction.muted.hex, direction.faint.hex, direction.line.hex, direction.accent.hex]);
  for (const hex of svg.match(/#[0-9a-f]{6}/gi) ?? []) {
    assert.ok(allowed.has(hex.toLowerCase()), `the map painted ${hex}, which no swatch chose`);
  }
});

test("no edge the tour did not walk, and a working control it refused is still drawn", () => {
  const svg = mapSvg(tour, direction);
  assert.ok(svg.includes("Get started"), "a filmed edge is missing");
  /* The back edge is real — the control works — and is dashed rather than dropped. */
  assert.ok(svg.includes("Home") && svg.includes("stroke-dasharray"), "the refused-but-working control is not drawn");
  assert.ok(svg.includes("desktop only"), "an edge the phone could not reach is not marked");
  assert.ok(!svg.includes("Contact"), "the map invented an edge");
  const caption = svg.match(/(\d+) screens · (\d+) filmed, (\d+) not/);
  assert.ok(caption && caption[1] === "3" && caption[2] === "2" && caption[3] === "1", `the caption miscounts: ${caption?.[0]}`);
});

test("the caption counts the edges the picture actually contains", () => {
  /* An edge whose `from` is no node cannot be placed. Counting it anyway printed
     "2 filmed" over a drawing with no line in it. */
  const orphan = { ...tour, edges: [...tour.edges, { from: "gone", to: "h1", label: "Ghost", kind: "cta" as const }] };
  const svg = mapSvg(orphan, direction);
  assert.ok(!svg.includes("Ghost"), "the map drew an edge it could not place");
  assert.match(svg, /3 screens · 2 filmed, 1 not/);
});

test("nothing volatile is drawn: no port, no absolute address, no timestamp", () => {
  const svg = mapSvg(tour, direction);
  assert.ok(!svg.includes("127.0.0.1"), "the map drew the loopback address");
  assert.ok(!/:\d{4,5}/.test(svg.replace(/viewBox="[^"]*"/g, "")), "the map drew a port");
  assert.ok(!svg.includes("2026-09-03"), "the map drew a timestamp");
});

test("the layering follows the clicks, and an unreachable state still gets a column", () => {
  const depth = layerOf(tour.pages, tour.edges);
  assert.equal(depth.get("h0"), 0);
  assert.equal(depth.get("h1"), 1);
  assert.equal(depth.get("h2"), 2);
  /* A back edge never deepens a state: the home page stays the first column. */
  assert.equal(layerOf(tour.pages, [...tour.edges, { from: "h2", to: "h0", label: "Home", kind: "nav" }]).get("h0"), 0);
  const orphan = layerOf([...tour.pages, { id: "h9", path: "/lost", order: 3 }], tour.edges);
  assert.equal(orphan.get("h9"), 0);
});

/**
 * Every attribute of every tag parses. A bundled font stack is `"Geist", system-ui,
 * sans-serif`; one unescaped quote inside an attribute ends it early and the browser
 * renders "attributes construct error" instead of the drawing — which is exactly what
 * the palette card did until 2026-09-03.
 */
export function wellFormed(svg: string): string[] {
  const bad: string[] = [];
  for (const tag of svg.match(/<[a-zA-Z][^>]*>/g) ?? []) {
    const rest = tag
      .replace(/^<[a-zA-Z-]+/, "")
      .replace(/[a-zA-Z-:]+="[^"]*"/g, "")
      .replace(/[\s/>]/g, "");
    if (rest.length > 0) bad.push(tag.slice(0, 90));
  }
  return bad;
}

test("every attribute in the map parses, quotes in a font stack included", () => {
  assert.deepEqual(wellFormed(mapSvg(tour, direction)), []);
});

test("a control that leaves the product where it was is drawn as a loop, not a backwards line", () => {
  /* panoma's site has one: the copy button, pressed twice, landing on the same state. */
  const loop = { ...tour, edges: [...tour.edges, { from: "h1", to: "h1", mark: "cta-2", label: "Copy the command", kind: "cta" as const }] };
  const svg = mapSvg(loop, direction);
  assert.ok(svg.includes("Copy the command"), "the self-edge vanished");
  assert.deepEqual(wellFormed(svg), []);
  /* And the drawing grows to hold it rather than clipping the loop off the top. */
  const height = (h: string) => Number(h.match(/viewBox="0 0 \d+ (\d+)"/)![1]);
  assert.ok(height(svg) > height(mapSvg(tour, direction)));
});

test("a tour with no graph draws nothing rather than an empty frame", () => {
  assert.equal(mapSvg({ ...tour, pages: [], edges: [] }, direction), "");
});
