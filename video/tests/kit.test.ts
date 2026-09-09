import assert from "node:assert/strict";
import { test } from "node:test";
import { postCopy, postKitMarkdown, hasDestinationClaim, type Brief } from "@panoma/video-core";

const brief: Brief = {
  id: "demo",
  recipe: "KineticQuote",
  langs: ["en", "es"],
  bpm: 120,
  hooks: [{ id: "h", text: { en: "Name ten projects.", es: "Di diez proyectos." } }],
  lines: [
    { id: "a", text: { en: "One command finds them.", es: "Un comando los encuentra." } },
    { id: "brand", text: { en: "panoma", es: "panoma" } },
  ],
  tags: ["panoma"],
};

test("copy carries the hook, the placeholder link, and the tags", () => {
  const copy = postCopy(brief, brief.hooks[0], "en");
  assert.ok(copy.short.includes("Name ten projects."));
  assert.ok(copy.x.includes("{{LINK}}"));
  assert.ok(copy.linkedin.includes("{{LINK}}"));
  assert.ok(copy.youtubeDescription.includes("{{LINK}}"));
  assert.deepEqual(copy.hashtags, ["buildinpublic", "devtools", "programming", "panoma"]);
});

test("the Spanish kit speaks Spanish", () => {
  const copy = postCopy(brief, brief.hooks[0], "es");
  assert.ok(copy.short.includes("El enlace está en la bio."));
  assert.ok(copy.linkedin.includes("construyendo en abierto"));
});

test("markdown includes only the sections this format is posted to", () => {
  const vertical = postKitMarkdown(brief, brief.hooks[0], "en", "v");
  assert.ok(vertical.includes("TikTok / Reels / Shorts"));
  assert.ok(!vertical.includes("## LinkedIn"));
  const horizontal = postKitMarkdown(brief, brief.hooks[0], "en", "h");
  assert.ok(horizontal.includes("## YouTube"));
  assert.ok(horizontal.includes("## LinkedIn"));
  assert.ok(horizontal.includes("watermarks cost 40-60% reach"));
});

test("a YouTube title never exceeds the 70-character cut", () => {
  const long = { ...brief.hooks[0], text: { en: "x".repeat(120), es: "y".repeat(120) } };
  const copy = postCopy(brief, long, "en");
  assert.ok(copy.youtubeTitle.length <= 70);
});

test("brand-only kits contain supported value and identity without inventing availability, links or open source", () => {
  const local: Brief = { ...brief, recipe: "ProductPromo", lines: brief.lines.map((line) => line.id === "a" ? { ...line, mark: "find" } : line),
    promo: { opening: "promise", pace: "crisp", evidence: {}, close: { kind: "brand", fact: "name", source: "package.json#name", reason: "no-public-destination" } } };
  for (const lang of ["en", "es"]) {
    const copy = postCopy(local, local.hooks[0], lang);
    assert.equal(hasDestinationClaim(copy), false);
    assert.ok(copy.short.includes("panoma"));
    assert.ok(copy.youtubeDescription.includes(local.lines[0].text[lang]));
    const md = postKitMarkdown(local, local.hooks[0], lang, "h", { copy: postCopy(brief, brief.hooks[0], lang) });
    assert.doesNotMatch(md, /\{\{LINK\}\}|Link in bio|enlace está en la bio|construyendo en abierto|Building this in the open/);
    assert.match(md, /No public destination was supplied/);
  }
});
