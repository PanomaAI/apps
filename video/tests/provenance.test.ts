import assert from "node:assert/strict";
import { test } from "node:test";
import { disclosureMetadataArgs, disclosureText, needsDisclosure, provenanceJson } from "@panoma/video-core";
import type { Provenance } from "@panoma/video-core";

/* Keys deliberately out of declaration order, to prove the writer imposes its own. */
const FULL: Provenance = {
  review: { file: "/home/me/.panoma/video/projects/p/renders/launch--h1--en--v.review.json", status: "pass" },
  synthetic: { broll: false, cursor: true, music: true, voice: true },
  music: { license: "panoma video procedural bed, no third-party rights", source: "procedural" },
  voice: { model: "eleven_multilingual_v2", voiceId: "darian", provider: "elevenlabs", speed: 0.92 },
  takes: [
    {
      viewport: { height: 1080, width: 1920 },
      url: "http://127.0.0.1:4188/",
      head: "abc1234def5678",
      recordedAt: "2026-09-01T10:00:00.000Z",
      take: "desktop",
      session: "panoma-start",
    },
  ],
  claims: [{ facts: ["pkg.version"], text: "Version 0.1.9 is out.", line: "kicker" }],
  project: { root: "/home/me/panoma", id: "panoma-1a2b3c4d", head: "abc1234def5678" },
  engine: "f00dbabe",
  renderedAt: "2026-09-01T10:05:00.000Z",
  compositionId: "launch--h1--en--v",
};

const EXPECTED_JSON = `{
  "compositionId": "launch--h1--en--v",
  "renderedAt": "2026-09-01T10:05:00.000Z",
  "engine": "f00dbabe",
  "project": {
    "id": "panoma-1a2b3c4d",
    "root": "/home/me/panoma",
    "head": "abc1234def5678"
  },
  "claims": [
    {
      "line": "kicker",
      "text": "Version 0.1.9 is out.",
      "facts": [
        "pkg.version"
      ]
    }
  ],
  "takes": [
    {
      "session": "panoma-start",
      "take": "desktop",
      "recordedAt": "2026-09-01T10:00:00.000Z",
      "head": "abc1234def5678",
      "url": "http://127.0.0.1:4188/",
      "viewport": {
        "width": 1920,
        "height": 1080
      }
    }
  ],
  "voice": {
    "provider": "elevenlabs",
    "voiceId": "darian",
    "model": "eleven_multilingual_v2",
    "speed": 0.92
  },
  "music": {
    "source": "procedural",
    "license": "panoma video procedural bed, no third-party rights"
  },
  "synthetic": {
    "voice": true,
    "music": true,
    "cursor": true,
    "broll": false
  },
  "review": {
    "status": "pass",
    "file": "/home/me/.panoma/video/projects/p/renders/launch--h1--en--v.review.json"
  }
}
`;

function bare(over: Partial<Provenance> = {}): Provenance {
  return {
    compositionId: "c",
    renderedAt: "2026-09-01T00:00:00.000Z",
    engine: "f00dbabe",
    project: { id: "p", root: "/p" },
    claims: [],
    takes: [],
    synthetic: { voice: false, music: false, cursor: false, broll: false },
    review: { status: "pass", file: "/p.review.json" },
    ...over,
  };
}

test("the JSON is byte-exact, in declaration order, whatever order the object was built in", () => {
  assert.equal(provenanceJson(FULL), EXPECTED_JSON);
  assert.deepEqual(JSON.parse(provenanceJson(FULL)), FULL);
});

test("optional fields left undefined are absent, and an unknown field lands after the known ones", () => {
  const p = bare({ project: { id: "p", root: "/p", head: undefined } });
  const json = provenanceJson(p);
  assert.ok(!json.includes('"head"'));
  assert.ok(!json.includes('"voice": {'));
  const withExtra = { ...bare(), zzz: 1, aaa: 2 } as unknown as Provenance;
  const keys = Object.keys(JSON.parse(provenanceJson(withExtra)));
  assert.deepEqual(keys.slice(-2), ["aaa", "zzz"]);
  assert.equal(keys[0], "compositionId");
});

test("the disclosure sentence names what is synthetic, the commit the recording shows, and panoma video", () => {
  assert.equal(
    disclosureText(FULL),
    "Synthetic voice, procedural music and a synthetic cursor; recorded from the real product at commit abc1234; made with panoma video.",
  );
  const voiceAndMusic = bare({
    synthetic: { voice: true, music: true, cursor: false, broll: false },
    music: { source: "procedural", license: "none" },
    takes: FULL.takes,
  });
  assert.equal(
    disclosureText(voiceAndMusic),
    "Synthetic voice and procedural music; recorded from the real product at commit abc1234; made with panoma video.",
  );
});

test("the sentence says only what is true of the file", () => {
  assert.equal(disclosureText(bare()), "Made with panoma video.");
  const cursorOnly = bare({
    synthetic: { voice: false, music: false, cursor: true, broll: false },
    takes: [{ session: "s", take: "t", recordedAt: "2026-09-01T00:00:00.000Z", url: "https://example.test/", viewport: { width: 1080, height: 1920 } }],
  });
  assert.equal(disclosureText(cursorOnly), "A synthetic cursor; recorded from the real product; made with panoma video.");
  const generated = bare({
    synthetic: { voice: true, music: true, cursor: false, broll: true },
    music: { source: "elevenlabs", license: "ElevenLabs plan terms" },
  });
  assert.equal(disclosureText(generated), "Synthetic voice, AI-generated music and AI-generated b-roll; made with panoma video.");
  /* With no take head, the project's own commit stands in. */
  const projectHead = bare({
    project: { id: "p", root: "/p", head: "1234567890" },
    takes: cursorOnly.takes,
  });
  assert.equal(disclosureText(projectHead), "Recorded from the real product at commit 1234567; made with panoma video.");
});

test("disclosure is required for a synthetic voice, generated music or generated footage — not for a cursor", () => {
  const flags = (voice: boolean, music: boolean, cursor: boolean, broll: boolean) =>
    needsDisclosure(bare({ synthetic: { voice, music, cursor, broll } }));
  assert.equal(flags(false, false, false, false), false);
  assert.equal(flags(false, false, true, false), false);
  assert.equal(flags(true, false, false, false), true);
  assert.equal(flags(false, true, false, false), true);
  assert.equal(flags(false, false, false, true), true);
  assert.equal(needsDisclosure(FULL), true);
});

test("the ffmpeg arguments carry the sentence as the container comment", () => {
  assert.deepEqual(disclosureMetadataArgs(bare()), ["-metadata", "comment=Made with panoma video."]);
});
