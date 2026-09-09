/*
  The one file a person edits when panoma video measured the page correctly and the product
  wrongly. The cases below are the three that are actually on this disk.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { isAbsolute, join } from "node:path";
import { defaultColors, type BrandProfile } from "@panoma/video-brand";
import { deriveDirection } from "@panoma/video-brand/direction";
import { applyBrandPatch } from "@panoma/video-director";
/* Straight from the source, as the other director tests do: `inside` is internal
   to the package and does not belong on its public surface. */
import { inside } from "../packages/director/src/workspace.ts";

const brand: BrandProfile = {
  source: { extractedAt: "2026-09-03T00:00:00.000Z" },
  /* Exactly what panoma-site's brand.json says today: the h1 of a landing page. */
  name: "The local catalog of your projects",
  colors: { ...defaultColors(), background: { hex: "#fafafa", confidence: "high", origin: "body" } },
  tokens: {},
  scheme: { supports: ["light"], default: "light" },
  type: { heading: { category: "sans", family: "Geist" }, body: { category: "sans", family: "Geist" }, mono: { category: "mono", family: "Geist Mono" } },
  tone: { register: "neutral", metrics: {} },
};

test("a patched name replaces a sentence a page happened to put in its h1", () => {
  const { brand: out, applied, refused } = applyBrandPatch(brand, { name: "Panoma" });
  assert.equal(out.name, "Panoma");
  assert.deepEqual(applied, ["name"]);
  assert.deepEqual(refused, []);
});

test("a patched colour is trusted like a token, and says it came from a person", () => {
  const { brand: out } = applyBrandPatch(brand, { colors: { primary: "#2456e6" } });
  assert.deepEqual(out.colors.primary, { hex: "#2456e6", confidence: "high", origin: "patch" });
  /* And the direction picks it up: a monochrome film becomes the product's own colour. */
  assert.equal(deriveDirection(brand, { flows: 1 }).signal, "mono");
  assert.equal(deriveDirection(out, { flows: 1 }).accent.hex, "#2456e6");
});

test("every colour notation a person might type is accepted, and a mistake is named", () => {
  const { brand: out, applied, refused } = applyBrandPatch(brand, {
    colors: { primary: "rgb(36, 86, 230)", text: "not-a-colour", background: "#FFF" } as never,
  });
  assert.equal(out.colors.primary.hex, "#2456e6");
  assert.equal(out.colors.background.hex, "#ffffff");
  assert.ok(applied.includes("colors.primary") && applied.includes("colors.background"));
  assert.deepEqual(refused, ['colors.text: "not-a-colour" is not a colour']);
  /* A refused field keeps what was measured rather than falling back to a default. */
  assert.equal(out.colors.text.hex, brand.colors.text.hex);
});

test("an unknown role is refused by name rather than written into the profile", () => {
  const { brand: out, refused } = applyBrandPatch(brand, { colors: { brand: "#000000" } as never });
  assert.deepEqual(refused, ["colors.brand: no such role"]);
  assert.ok(!("brand" in out.colors));
});

test("a patched scheme joins what the product supports rather than replacing it", () => {
  const { brand: out } = applyBrandPatch({ ...brand, scheme: { supports: ["light"], default: "light" } }, { scheme: "dark" });
  assert.equal(out.scheme.default, "dark");
  assert.deepEqual(out.scheme.supports, ["light", "dark"]);
});

test("a logo a person supplies outranks the 24px favicon that was found", () => {
  const { brand: out } = applyBrandPatch({ ...brand, logo: { file: "/w/icon.png", kind: "icon", width: 24, height: 24, reversed: false, origin: "icon", score: 10 } }, { logo: "mark.svg" }, "/w");
  /*
    `join`, not the literal "/w/mark.svg" this line used to assert. `logo.file` is a
    filesystem path — `copyFile` in auto.ts and `existsSync` in study.ts are what read it,
    and the only place it becomes a URL, `renderBrand`, converts it there. So its
    separator is the platform's, and on Windows the correct answer is `\w\mark.svg`. The
    old assertion hardcoded a POSIX separator it had no business asserting, and that is
    the whole of the Windows failure here: the code was right and the test was not.
  */
  assert.equal(out.logo?.file, join("/w", "mark.svg"));
  assert.equal(out.logo?.origin, "patch");
});

test("an absolute logo path is used as it was written, not joined onto the workspace", () => {
  /*
    Absoluteness is `path.isAbsolute`, not a leading slash. A leading slash is absolute on
    both platforms, so this case reads the same everywhere; the drive and UNC shapes below
    are absolute only where they mean something, which is why the expectation is asked of
    `isAbsolute` rather than written out.
  */
  const { brand: out } = applyBrandPatch(brand, { logo: "/marks/mark.svg" }, "/w");
  assert.equal(out.logo?.file, "/marks/mark.svg");
  for (const supplied of ["C:\\marks\\mark.svg", "\\\\server\\brand\\mark.svg"]) {
    const { brand: patched } = applyBrandPatch(brand, { logo: supplied }, "/w");
    assert.equal(patched.logo?.file, isAbsolute(supplied) ? supplied : join("/w", supplied));
  }
});

test("a file already under a directory is inside it, and a sibling that merely extends its name is not", () => {
  const root = join("/tmp", "app");
  assert.equal(inside(root, join(root, "brand-logo.svg")), true);
  assert.equal(inside(root, join(root, "study", "logo.svg")), true);
  /* The directory itself counts as inside: nothing has to be copied into where it is. */
  assert.equal(inside(root, root), true);
  /* The prefix trap: "/tmp/app-out" begins with the letters of "/tmp/app" and is elsewhere. */
  assert.equal(inside(root, join("/tmp", "app-out", "logo.svg")), false);
  assert.equal(inside(root, join("/tmp", "logo.svg")), false);
});

test("no patch changes nothing at all", () => {
  const { brand: out, applied, refused } = applyBrandPatch(brand, null);
  assert.equal(out, brand);
  assert.deepEqual([applied, refused], [[], []]);
});
