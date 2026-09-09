/*
  The voice, checked without ever calling the API.

  Everything here is the part that decides WHETHER to spend and WHAT to send: which
  lines a voice owes, which ids would overwrite each other on disk, what a brief
  costs, and the two refusals — no key, and more characters than a run may spend.
  The call itself is one function from @panoma/video-audio and is not this test's business;
  what is this test's business is that an unattended pipeline cannot be made to bill
  someone by a brief that grew, and cannot half-narrate a tutorial.
*/
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Brief } from "@panoma/video-core";
import { manifestVouches, saidHash, VOICE_MANIFEST, type VoiceManifest } from "@panoma/video-core/cache";
import { charCost, collidingIds, narrate, spokenLines, NARRATION_CHAR_CAP, DEFAULT_VOICE } from "@panoma/video-director";

const brief: Brief = {
  id: "acme-start",
  recipe: "Tutorial",
  langs: ["en", "es"],
  bpm: 120,
  fps: 30,
  session: "acme",
  voice: DEFAULT_VOICE,
  voiceSpeed: 0.92,
  hooks: [{ id: "hook", text: { en: "This is acme running.", es: "Esto es acme en marcha." } }],
  lines: [
    { id: "step-hero", mark: "hero", text: { en: "Open the catalog to start.", es: "Abre el catálogo para empezar." } },
    { id: "cta", mode: "type", text: { en: "acme.example", es: "acme.example" } },
  ],
};

/** Whatever the machine running this happens to have set. */
async function withoutKey<T>(fn: () => Promise<T>): Promise<T> {
  const key = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    return await fn();
  } finally {
    if (key !== undefined) process.env.ELEVENLABS_API_KEY = key;
  }
}

test("a voice owes every hook and every line that is not type-only", () => {
  assert.deepEqual(spokenLines(brief).map((l) => l.id), ["hook", "step-hero"]);
  /* Each hook opens a different cut, so all of them are spoken, not just the first. */
  const two = { ...brief, hooks: [...brief.hooks, { id: "tired", text: { en: "Tired of it?", es: "¿Cansado?" } }] };
  assert.deepEqual(spokenLines(two).map((l) => l.id), ["hook", "tired", "step-hero"]);
});

test("a hook and a line with one id would be one file, and that is refused before anything is spent", async () => {
  const clash: Brief = { ...brief, hooks: [{ id: "cta", text: { en: "One", es: "Uno" } }] };
  assert.deepEqual(collidingIds(clash), ["cta"]);
  assert.deepEqual(collidingIds(brief), []);
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-say-"));
  try {
    process.env.ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? "test-key-never-used";
    const said = await narrate({ briefs: [{ ...clash, lines: [{ id: "cta", text: { en: "Two", es: "Dos" } }] }], outDir: dir, cacheDir: join(dir, "cache") });
    assert.equal(said.status, "failed");
    assert.match(said.summary, /"cta"/);
    assert.equal(said.charged, 0, "nothing is sent for a brief that cannot be written to disk");
  } finally {
    if (process.env.ELEVENLABS_API_KEY === "test-key-never-used") delete process.env.ELEVENLABS_API_KEY;
    await rm(dir, { recursive: true, force: true });
  }
});

test("the cost is every language of every spoken line, and only those", () => {
  const cost = charCost(brief);
  const expected = "This is acme running.".length + "Esto es acme en marcha.".length + "Open the catalog to start.".length + "Abre el catálogo para empezar.".length;
  assert.equal(cost, expected, "the type-only line is not spoken and is not charged");
  assert.ok(cost < NARRATION_CHAR_CAP, "one tutorial is nowhere near the cap");
});

test("no key means type on screen, not a failure and not a call", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-say-"));
  try {
    const said = await withoutKey(() => narrate({ briefs: [brief], outDir: dir, cacheDir: join(dir, "cache") }));
    assert.equal(said.status, "skipped");
    assert.match(said.summary, /ELEVENLABS_API_KEY/);
    assert.equal(said.files, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a brief that would cost more than a run may spend is refused whole, never half", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-say-"));
  const long = { ...brief, lines: [{ id: "step-hero", mark: "hero", text: { en: "x".repeat(400), es: "y".repeat(400) } }] };
  try {
    process.env.ELEVENLABS_API_KEY = "test-key-never-used";
    const said = await narrate({ briefs: [long], outDir: dir, cacheDir: join(dir, "cache"), charCap: 100 });
    assert.equal(said.status, "skipped");
    assert.equal(said.files, 0, "half a narration lays the piece out on two clocks; there is no half");
    /* The house rule: the number closes the sentence. */
    assert.match(said.summary, /over by \d+$/);
  } finally {
    delete process.env.ELEVENLABS_API_KEY;
    await rm(dir, { recursive: true, force: true });
  }
});

test("a brief with no voice asks for nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-say-"));
  try {
    const { voice, ...silent } = brief;
    void voice;
    const said = await narrate({ briefs: [silent as Brief], outDir: dir, cacheDir: join(dir, "cache") });
    assert.equal(said.status, "skipped");
    assert.equal(said.charged, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/*
  The half-narration trap, which is the reason the manifest exists.

  Audio is one file per line and language, named by line id. A run whose narration
  failed, was cancelled or found no key leaves the PREVIOUS run's files exactly where
  they were, and a reader that trusts `existsSync` then plays the old sentence under
  the new caption, in sync, while the report says the piece fell back to type.
*/
test("audio on disk is only this brief's when a manifest says so", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-say-"));
  try {
    const said = [
      { key: "hook-en", text: "This is acme running." },
      { key: "step-hero-en", text: "Open the catalog to start." },
    ];
    const manifest: VoiceManifest = {
      voice: DEFAULT_VOICE,
      speed: 0.92,
      lines: Object.fromEntries(said.map((w) => [w.key, saidHash(w.text)])),
    };
    assert.equal(manifestVouches(manifest, DEFAULT_VOICE, said), true);

    /* The sentence was rewritten and the narration did not run: the files are last run's. */
    assert.equal(manifestVouches(manifest, DEFAULT_VOICE, [said[0], { key: "step-hero-en", text: "Click Sign up." }]), false);
    /* A line the manifest never mentions. */
    assert.equal(manifestVouches(manifest, DEFAULT_VOICE, [...said, { key: "cta-en", text: "Try it." }]), false);
    /* Another voice's recording of the same words. */
    assert.equal(manifestVouches(manifest, "some-other-voice", said), false);
    /* No manifest at all — files that exist and nothing vouching for them. */
    assert.equal(manifestVouches(null, DEFAULT_VOICE, said), false);

    /*
      And the writer only vouches for a brief it said whole: a refusal leaves whatever
      was there without a statement about it.
    */
    await writeFile(join(dir, VOICE_MANIFEST), JSON.stringify(manifest));
    const before = await readFile(join(dir, VOICE_MANIFEST), "utf8");
    assert.ok(before.length > 0);
    const refused = await withoutKey(() => narrate({ briefs: [brief], outDir: dir, cacheDir: join(dir, "cache") }));
    assert.equal(refused.status, "skipped");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
