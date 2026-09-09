/*
  The direction: the arithmetic that decides what a product's film looks like.

  Three fixtures are the three real shapes on this disk — a dark chromatic product
  (universend: lime on near-black), a light monochrome one (panoma's site: black on
  white) and one nothing could be measured from — and the assertions below are the
  promises the record in docs/studio.md makes. Every one of them runs without a browser,
  because a look decided by arithmetic can be tested by arithmetic.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultColors, type BrandProfile } from "@panoma/video-brand";
import {
  DANCE_OF_ROW, DIRECTION_VERSION, KEYS, ROWS, STAGE_SEPARATION, TEMPOS, DEFAULT_DIRECTION,
  alphaOf, deriveDirection, filmSchemeOf, hash32, pieceSeed, rng, shuffle, stageFor, withHouseTheme,
} from "@panoma/video-brand/direction";
import { contrastRatio } from "@panoma/video-brand";
import { LIGHT_PALETTE } from "@panoma/video-core/theme";

const type = (heading: "sans" | "serif" = "sans"): BrandProfile["type"] => ({
  heading: { category: heading, family: heading === "serif" ? "Fraunces" : "Geist" },
  body: { category: "sans", family: "Geist" },
  mono: { category: "mono", family: "Geist Mono" },
});

const profile = (over: Partial<BrandProfile> = {}): BrandProfile => ({
  source: { extractedAt: "2026-09-03T00:00:00.000Z" },
  name: "Product",
  colors: defaultColors(),
  tokens: {},
  scheme: { supports: ["dark"], default: "dark" },
  type: type(),
  tone: { register: "neutral", metrics: {} },
  ...over,
});

/* universend, as its brand.json actually reads. */
const universend = profile({
  name: "Universend",
  colors: {
    ...defaultColors(),
    primary: { hex: "#dbff64", confidence: "high", origin: "census" },
    accent: { hex: "#dbff64", confidence: "medium", origin: "primary" },
    background: { hex: "#02030a", confidence: "high", origin: "body" },
    surface: { hex: "#161615", confidence: "medium", origin: "derived" },
    text: { hex: "#f4f2ea", confidence: "high", origin: "css-token:--ink" },
    muted: { hex: "#7b8296", confidence: "high", origin: "css-token:--muted" },
    onPrimary: { hex: "#000000", confidence: "high", origin: "wcag" },
  },
});

/* panoma's site: a black CTA on white. Chroma below the near-neutral threshold. */
const site = profile({
  name: "Panoma",
  scheme: { supports: ["light"], default: "light" },
  colors: {
    ...defaultColors(),
    primary: { hex: "#0a0a0a", confidence: "high", origin: "cta" },
    background: { hex: "#fafafa", confidence: "high", origin: "body" },
    surface: { hex: "#f3f3f3", confidence: "high", origin: "census" },
    text: { hex: "#000000", confidence: "high", origin: "body" },
    muted: { hex: "#5c5c5c", confidence: "high", origin: "census" },
    onPrimary: { hex: "#ffffff", confidence: "high", origin: "wcag" },
  },
});

test("the stage is the product's own ground, moved only until the product reads on it", () => {
  const dark = deriveDirection(universend, { flows: 2 });
  assert.equal(dark.page, "#02030a", "the page is the product's background, verbatim");
  assert.notEqual(dark.stage.hex, dark.page, "a stage equal to the page has no edge for the window");
  assert.ok(contrastRatio(dark.stage.hex, dark.page) >= STAGE_SEPARATION, "the stage clears the page");
  assert.match(dark.stage.why, /#02030a/, "the reason names the ground it came from");

  const light = deriveDirection(site, { flows: 0 });
  assert.ok(contrastRatio(light.stage.hex, light.page) >= STAGE_SEPARATION);
  /* A light product darkens, a dark one lifts: the stage always moves AWAY from the page. */
  assert.ok(Number.parseInt(light.stage.hex.slice(1, 3), 16) < Number.parseInt(light.page.slice(1, 3), 16));
  assert.ok(Number.parseInt(dark.stage.hex.slice(1, 3), 16) > Number.parseInt(dark.page.slice(1, 3), 16));

  /* Mid-grey is the hardest case: it must still separate, in whichever direction it can. */
  const grey = stageFor("#808080");
  assert.ok(contrastRatio(grey.hex, "#808080") >= STAGE_SEPARATION, "a mid-grey ground still yields a stage");
});

test("a near-neutral or untrusted primary yields a monochrome film, never the house gold", () => {
  const mono = deriveDirection(site, { flows: 0 });
  assert.equal(mono.signal, "mono");
  assert.equal(mono.accent.hex, mono.ink.hex, "a monochrome brand accents in its own ink");
  assert.equal(mono.furniture.glow, false, "no glow without a colour to glow in");

  const nothing = deriveDirection(profile(), { flows: 1 });
  assert.equal(nothing.name, "plain", "nothing measured gets the row that needs no colour");
  assert.equal(nothing.branded.stage, false);

  /* The gold may only ever appear as a product's OWN colour, never as a fallback. */
  for (const d of [deriveDirection(universend, { flows: 2 }), mono, nothing]) {
    const hexes = [d.stage.hex, d.plate.hex, d.ink.hex, d.muted.hex, d.faint.hex, d.line.hex, d.accent.hex, d.onAccent.hex];
    assert.ok(!hexes.includes("#d2bd7f"), `${d.name} borrowed the house accent: ${hexes.join(" ")}`);
  }
});

test("the product's own colours reach every surface when they were measured", () => {
  const d = deriveDirection(universend, { flows: 2 });
  assert.equal(d.accent.hex, "#dbff64");
  assert.equal(d.ink.hex, "#f4f2ea");
  assert.equal(d.plate.hex, "#161615");
  assert.equal(d.muted.hex, "#7b8296");
  assert.equal(d.scrim.hex, d.stage.hex, "type over footage sits on the product's dark, not on black");
  assert.deepEqual(d.branded, { stage: true, accent: true, ink: true });
  assert.equal(d.scheme, "dark", "the FILM's scheme comes from its stage");
  assert.equal(deriveDirection(site, { flows: 0 }).scheme, "light");
});

test("measured ink without a measured ground must read on the house stage", () => {
  const partial = profile({ colors: {
    ...defaultColors(),
    text: { hex: "#fafafa", confidence: "high", origin: "css-token:--text" },
  } });
  const before = structuredClone(partial);
  const direction = deriveDirection(partial);
  assert.equal(direction.stage.hex, LIGHT_PALETTE.paper);
  assert.equal(direction.ink.hex, LIGHT_PALETTE.ink);
  assert.equal(direction.ink.from, "default");
  assert.equal(direction.branded.ink, false);
  assert.match(direction.ink.why, /#fafafa.*4\.5:1.*unmeasured ground/);
  assert.equal(withHouseTheme(direction), direction, "a current house palette retains the ink's rendering provenance");
  assert.ok(contrastRatio(direction.ink.hex, direction.stage.hex) >= 4.5);
  assert.deepEqual(partial, before, "rendering preserves the extracted profile and its evidence");
  assert.equal(deriveDirection(universend).ink.hex, universend.colors.text.hex, "a measured dark ground retains its own light ink");
});

test("a tour that changed nothing is filmed as a product that shows itself", () => {
  /* The one rule that reads the tour rather than the palette: two products with the same
     brand can still get different films, and a page with no state change gets no punch. */
  const shows = deriveDirection(universend, { flows: 0 });
  const does = deriveDirection(universend, { flows: 2 });
  assert.equal(shows.name, "editorial");
  assert.equal(does.name, "kinetic");
  assert.notDeepEqual(shows.motion, does.motion);
  assert.deepEqual(shows.stage, does.stage, "the shape decides the rhythm; it never touches a colour");
});

test("a direction may change rhythm and furniture, never a colour", () => {
  for (const [name, row] of Object.entries(ROWS)) {
    const text = JSON.stringify(row);
    assert.ok(!/#[0-9a-f]{3,8}/i.test(text), `the ${name} row carries a colour: ${text}`);
    assert.ok(row.push[0] < row.push[1] && row.push[0] >= 1, `${name} has an impossible push range`);
  }
});

test("every tempo the direction may choose has a beat of whole frames at 30 fps", () => {
  for (const bpm of TEMPOS) assert.equal((30 * 60) % bpm, 0, `${bpm} BPM has a fractional beat at 30 fps`);
});

test("the seed is the product's identity, not its place on a disk", () => {
  assert.equal(deriveDirection(universend, { flows: 2 }).seed, deriveDirection(universend, { flows: 2 }).seed);
  assert.notEqual(deriveDirection(universend, { flows: 2 }).seed, deriveDirection(site, { flows: 2 }).seed);
  assert.equal(pieceSeed("Universend", "universend-trailer"), pieceSeed("Universend", "universend-trailer"));
  assert.notEqual(pieceSeed("Universend", "universend-trailer"), pieceSeed("Universend", "universend-start"));
  /* Nothing in the seed may come from a path: two checkouts of one product film the same. */
  assert.equal(hash32("Universend 1"), hash32("Universend 1"));
});

test("the derivation is a pure function: same inputs, same direction, byte for byte", () => {
  const a = JSON.stringify(deriveDirection(universend, { flows: 2, marks: 3 }));
  const b = JSON.stringify(deriveDirection(universend, { flows: 2, marks: 3 }));
  assert.equal(a, b);
  /* And it consults no model: nothing here reads PANOMA_VIDEO_BRAIN or the environment at all. */
  process.env.PANOMA_VIDEO_BRAIN = "none";
  assert.equal(JSON.stringify(deriveDirection(universend, { flows: 2, marks: 3 })), a);
  delete process.env.PANOMA_VIDEO_BRAIN;
});

test("the seeded picks stay inside the row's own range", () => {
  const d = deriveDirection(universend, { flows: 2 });
  const row = ROWS[d.name];
  assert.deepEqual([...d.motion.enters].sort(), [...row.enters].sort(), "a seed permutes the enters; it never invents one");
  assert.ok(d.motion.push[0] >= row.push[0] && d.motion.push[1] <= row.push[1]);
  assert.ok(TEMPOS.includes(d.sound.bpm as (typeof TEMPOS)[number]));
  const next = rng(1);
  assert.deepEqual(shuffle(next, ["a", "b", "c"]).sort(), ["a", "b", "c"], "a shuffle keeps every item");
});

test("the two shapes that share a brand still differ in something a viewer can hear", () => {
  /* panoma-monorepo and panoma-web have byte-identical brand.json files on this disk. What
     separates their films is the name they carry, which is what the seed is made of. */
  const one = deriveDirection(profile({ name: "Panoma", colors: site.colors }), { flows: 2 });
  const two = deriveDirection(profile({ name: "Projects", colors: site.colors }), { flows: 2 });
  assert.deepEqual(one.stage, two.stage, "identical brands keep identical colours — that is correct");
  const sound = (d: typeof one) => `${d.sound.bpm} ${d.sound.key}`;
  assert.notEqual(`${sound(one)} ${one.motion.enters}`, `${sound(two)} ${two.motion.enters}`);
});

test("the house direction and an unmeasured product use Panoma's central light theme", () => {
  for (const direction of [DEFAULT_DIRECTION, deriveDirection(profile())]) {
    assert.equal(direction.scheme, "light");
    assert.equal(direction.signal, "mono");
    assert.equal(direction.stage.hex, LIGHT_PALETTE.paper);
    assert.equal(direction.plate.hex, LIGHT_PALETTE.card);
    for (const role of ["ink", "muted", "faint", "line", "accent", "onAccent"] as const) {
      assert.equal(direction[role].hex, LIGHT_PALETTE[role]);
    }
    assert.deepEqual(direction.inverted, {
      stage: LIGHT_PALETTE.inverted.paper,
      ink: LIGHT_PALETTE.inverted.ink,
      muted: LIGHT_PALETTE.inverted.muted,
    });
  }
  assert.equal(alphaOf("not a colour", 0.5), alphaOf(LIGHT_PALETTE.ink, 0.5));
  assert.equal(DEFAULT_DIRECTION.version, DIRECTION_VERSION);
});

test("saved house colours refresh without changing editorial choices or measured products", () => {
  const saved = {
    ...deriveDirection(profile(), { flows: 1 }, { name: "editorial", style: "pulse", key: "G major", bpm: 90 }),
    scheme: "dark" as const,
    signal: "chromatic" as const,
    stage: { hex: "#0a0a0a", from: "default" as const, why: "old house paper" },
    accent: { hex: "#d2bd7f", from: "default" as const, why: "old house gold" },
  };
  const refreshed = withHouseTheme(saved);
  assert.equal(refreshed.stage.hex, LIGHT_PALETTE.paper);
  assert.equal(refreshed.accent.hex, LIGHT_PALETTE.accent);
  assert.equal(refreshed.scheme, "light");
  assert.equal(refreshed.signal, "mono");
  for (const role of ["name", "motion", "furniture", "sound", "dance", "fonts", "seed", "by", "version"] as const) {
    assert.deepEqual(refreshed[role], saved[role], `refreshing house colours preserves ${role}`);
  }
  assert.deepEqual(withHouseTheme(refreshed), refreshed, "refreshing an already current direction is idempotent");
  const measured = deriveDirection(universend, { flows: 2 });
  assert.equal(withHouseTheme(measured), measured, "a measured dark product retains its identity");
  for (const role of ["surface", "muted", "onPrimary", "text"] as const) {
    const partial = deriveDirection(profile({
      colors: { ...defaultColors(), [role]: { hex: "#24272b", confidence: "high", origin: "css-token" } },
    }));
    assert.equal(withHouseTheme(partial), partial, `a measured ${role} is preserved even with an unknown ground`);
  }
});

/*
  The film's scheme, which is not the product's.

  `brand.scheme.default` is what the page says about itself; the film is shot on the
  STAGE, and the stage is derived. Four things read this — the walker, the recorder, and
  both cache keys — and they must be one value, computed once, or a workspace ends up
  pinned to takes shot in a scheme its films are no longer graded in.
*/
test("the film's scheme comes from its stage, and no shape can move it", () => {
  assert.equal(filmSchemeOf(universend), deriveDirection(universend, { flows: 3 }).scheme);
  /* The tour chooses the ROW. It may never choose the scheme. */
  for (const flows of [0, 1, 9]) assert.equal(deriveDirection(universend, { flows }).scheme, filmSchemeOf(universend));
  assert.equal(filmSchemeOf(universend), "dark");
  assert.equal(filmSchemeOf(site), "light");
});

test("a film follows the pixels, not what the page declares about itself", () => {
  /* A page that says dark and paints itself near-white: the recorder is told light. */
  const lying = profile({ ...site, scheme: { supports: ["dark"], default: "dark" } });
  assert.equal(lying.scheme.default, "dark");
  assert.equal(filmSchemeOf(lying), "light");
  assert.equal(deriveDirection(lying, { flows: 2 }).scheme, "light");
});

/*
  Which row a product's tour earns, which is the one place the direction reads the tour
  rather than the palette — and the one place a wrong count changes how every film moves.
*/
test("a control that changes the interface is a flow, named or not", async () => {
  const { flowsOf } = await import("@panoma/video-director");
  const mark = (kind: "cta" | "flow" | "section" | "hero", outcome?: { heading: string }) =>
    ({ name: kind, label: kind, kind, ...(outcome ? { outcome } : {}) }) as never;

  /* universend's two: a mute and a notifications panel. Both change the interface; neither
     leaves a heading behind, and requiring one filmed the product as a static page. */
  const toggles = { marks: [mark("hero"), mark("cta"), mark("cta")] } as never;
  assert.equal(flowsOf(toggles), 2);

  /* A scroll to a heading is not a flow however well it is named. */
  const sections = { marks: [mark("hero"), mark("section", { heading: "Today's numbers" }), mark("section")] } as never;
  assert.equal(flowsOf(sections), 0);

  assert.equal(flowsOf(null), 0);
});

test("a dark product with controls is filmed kinetic; the same product with none is not", () => {
  const withFlows = deriveDirection(universend, { flows: 2 });
  const without = deriveDirection(universend, { flows: 0 });
  assert.equal(withFlows.name, "kinetic");
  assert.equal(without.name, "editorial");
  /* And the difference is what a viewer sees: the camera closes harder and may flash. */
  assert.ok(withFlows.motion.push[1] > without.motion.push[1]);
  assert.ok(withFlows.motion.enters.includes("flash") && !without.motion.enters.includes("flash"));
});

/*
  Arithmetic proposes, judgement disposes. A brain may hand the derivation a choice, and
  what that choice may and may not move is the same rule as the rows': rhythm, furniture
  and sound, never a colour — and never the scheme, which the recorder was already told.
*/
test("every row follows actions by default, and arithmetic signs its own work", () => {
  assert.deepEqual(DANCE_OF_ROW, { editorial: "off", kinetic: "off", plain: "off" });
  assert.equal(deriveDirection(universend, { flows: 2 }).dance, "off", "a kinetic film follows the product's actions");
  assert.equal(deriveDirection(universend, { flows: 0 }).dance, "off", "an editorial film does not pump to music");
  assert.equal(deriveDirection(profile(), { flows: 1 }).dance, "off", "a plain film follows the same policy");
  assert.equal(DEFAULT_DIRECTION.dance, "off", "repository briefs do not opt into musical motion either");
  for (const d of [deriveDirection(universend, { flows: 2 }), deriveDirection(site, { flows: 0 }), DEFAULT_DIRECTION]) assert.equal(d.by, "arithmetic");
});

test("a choice moves the row, the bed and the dance, and nothing else", () => {
  const proposed = deriveDirection(universend, { flows: 2 });
  const chosen = deriveDirection(universend, { flows: 2 }, { name: "editorial", style: "calm", key: "C major", bpm: 90, dance: "off" });
  assert.equal(chosen.by, "brain");
  assert.equal(chosen.name, "editorial");
  assert.deepEqual(chosen.sound, { style: "calm", key: "C major", bpm: 90 });
  assert.equal(chosen.dance, "off");
  assert.deepEqual(chosen.furniture, ROWS.editorial.furniture);
  assert.deepEqual([...chosen.motion.enters].sort(), [...ROWS.editorial.enters].sort());
  for (const k of ["stage", "page", "plate", "scrim", "ink", "muted", "faint", "line", "accent", "onAccent", "inverted", "fonts", "contrast", "branded", "seed", "scheme", "signal"] as const) {
    assert.deepEqual(chosen[k], proposed[k], `a choice moved ${k}`);
  }
  /* A field left out keeps the arithmetic value: the brain chose the row and nothing else. */
  const partial = deriveDirection(universend, { flows: 2 }, { name: "editorial" });
  assert.deepEqual(partial.sound, proposed.sound, "the tempo and the key it did not choose did not move");
  assert.equal(partial.dance, DANCE_OF_ROW.editorial, "the dance follows the chosen row when nobody chose one");
  /* An empty choice is still a choice: the same film, signed by the brain. */
  const same = deriveDirection(universend, { flows: 2 }, {});
  assert.deepEqual({ ...same, by: "arithmetic" }, proposed);
  /* Every key on offer is one the bed can play. */
  for (const key of KEYS) assert.equal(deriveDirection(universend, { flows: 2 }, { key }).sound.key, key);
});
