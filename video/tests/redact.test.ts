import assert from "node:assert/strict";
import { test } from "node:test";
import { NEVER_A_SOURCE, redact } from "@panoma/video-core";

test("tokens by shape are masked and counted; ordinary text is untouched", () => {
  const r = redact("key sk_live_ABCDEFGHIJKLMNOPQRSTUV and ghp_1234567890abcdefghijklmnop, commit 1bc8fe8, 47 projects");
  assert.equal(r.redactions, 2);
  assert.ok(!r.text.includes("ABCDEFGHIJKLMNOPQRSTUV"));
  assert.ok(r.text.includes("sk_l"));
  assert.ok(r.text.includes("commit 1bc8fe8"), "a short hash is not a secret");
  assert.equal(redact("Nothing to see. Commits this month: 47.").redactions, 0);
});

test("assignments keep their name and lose their value; bearer headers too", () => {
  const r = redact("API_KEY=supersecretvalue123 Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123");
  assert.ok(r.text.startsWith("API_KEY=supe"));
  assert.ok(r.text.includes("Bearer abcd"));
  assert.ok(!r.text.includes("supersecretvalue123"));
  assert.equal(r.redactions, 2);
});

test("files that are never a source", () => {
  for (const f of [".env", ".env.local", "a/b/.env.production", "certs/server.pem", "id_rsa", "gcp-credentials.json"]) {
    assert.ok(NEVER_A_SOURCE.test(f), f);
  }
  assert.ok(!NEVER_A_SOURCE.test(".env.example.md"));
  assert.ok(!NEVER_A_SOURCE.test("README.md"));
});
