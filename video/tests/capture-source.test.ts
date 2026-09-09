import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import { CAPTURE_SOURCE_MAX_AGE_MS, probeCaptureSource } from "../packages/director/src/capture-source.ts";

async function fixture(t: TestContext) {
  const state = { html: "<main><h1>Catalog</h1></main>", code: "window.feature = 'catalog'", css: "body{color:black}", status: 200, nonce: 0 };
  const requests: { path: string; cookie?: string; authorization?: string }[] = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url!, cookie: request.headers.cookie, authorization: request.headers.authorization });
    response.statusCode = state.status;
    // A stale validator must never conceal changed bytes at an unchanged URL.
    response.setHeader("ETag", '"always-the-same"');
    response.setHeader("Set-Cookie", "session=fixture-secret; HttpOnly");
    if (request.url === "/app.js") return void response.end(state.code);
    if (request.url === "/app.css") return void response.end(state.css);
    if (request.url === "/redirect") { response.statusCode = 302; response.setHeader("Location", "/"); return void response.end(); }
    response.end(`<html><head><link rel="stylesheet" href="/app.css"><script nonce="${state.nonce++}" src="/app.js"></script></head><body>${state.html}</body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  return { state, requests, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}

test("unchanged served bytes reuse their generation despite CSP nonces, timestamps and validators", async t => {
  const { url, requests } = await fixture(t);
  const initial = await probeCaptureSource(url, { now: 1_000_000 });
  assert.equal(initial.state, "initial");
  assert.equal(initial.resources, 3);
  const again = await probeCaptureSource(url, { previous: initial, now: 1_100_000 });
  assert.equal(again.state, "unchanged");
  assert.equal(again.key, initial.key);
  assert.equal(again.capturedAt, initial.capturedAt);
  assert.notEqual(again.checkedAt, initial.checkedAt);
  assert.equal(requests.filter(request => request.path === "/app.js").length, 2, "the asset bytes are checked on every run");
  assert.ok(requests.every(request => !request.cookie && !request.authorization));
  assert.doesNotMatch(JSON.stringify(again), /fixture-secret|window.feature|Catalog|127\.0\.0\.1/);
});

test("a same-URL deployment invalidates footage without a checkout edit or a changed ETag", async t => {
  const { url, state } = await fixture(t);
  let previous = await probeCaptureSource(url);
  for (const mutate of [() => { state.code = "window.feature = 'memory'"; }, () => { state.css = "body{color:white}"; }, () => { state.html = "<main><h1>Project memory</h1></main>"; }]) {
    mutate();
    const next = await probeCaptureSource(url, { previous });
    assert.equal(next.state, "changed");
    assert.notEqual(next.fingerprint, previous.fingerprint);
    assert.notEqual(next.key, previous.key);
    assert.match(next.reason, /served document or linked asset bytes changed/);
    previous = next;
  }
});

test("capture age is anchored to filming, not renewed by checks of an unchanged application shell", async t => {
  const { url } = await fixture(t);
  const initial = await probeCaptureSource(url, { now: 1000 });
  const recent = await probeCaptureSource(url, { previous: initial, now: 1000 + CAPTURE_SOURCE_MAX_AGE_MS - 1 });
  assert.equal(recent.key, initial.key);
  const expired = await probeCaptureSource(url, { previous: recent, now: 1000 + CAPTURE_SOURCE_MAX_AGE_MS });
  assert.equal(expired.state, "expired");
  assert.notEqual(expired.key, initial.key);
  assert.equal(expired.fingerprint, initial.fingerprint);
  assert.match(expired.reason, /client data and unsampled routes/);
  const fresh = await probeCaptureSource(url, { previous: expired, now: 1001 + CAPTURE_SOURCE_MAX_AGE_MS });
  assert.equal(fresh.state, "unchanged");
  assert.equal(fresh.key, expired.key);
});

test("failed and oversized probes never vouch for old footage, while caller cancellation propagates", async t => {
  const { url, state } = await fixture(t);
  const initial = await probeCaptureSource(url);
  state.status = 503;
  const unavailable = await probeCaptureSource(url, { previous: initial });
  assert.equal(unavailable.state, "unverified");
  assert.notEqual(unavailable.key, initial.key);
  assert.match(unavailable.reason, /HTTP 503/);
  state.status = 200;
  state.html = "<main>" + "x".repeat(2 * 1024 * 1024) + "</main>";
  const large = await probeCaptureSource(url, { previous: initial });
  assert.equal(large.state, "unverified");
  assert.match(large.reason, /byte budget/);
  const abort = new AbortController();
  abort.abort(new Error("capture cancelled"));
  await assert.rejects(probeCaptureSource(url, { signal: abort.signal }), /capture cancelled/);
});

test("credential-bearing URLs are never fetched and redirects remain bounded read-only requests", async t => {
  const { url, requests } = await fixture(t);
  for (const raw of [url.replace("http://", "http://user:private@"), `${url}?access_token=private`, "file:///etc/passwd"]) {
    const source = await probeCaptureSource(raw);
    assert.equal(source.state, "unverified");
    assert.doesNotMatch(JSON.stringify(source), /user:private|access_token=private|etc\/passwd/);
  }
  assert.equal(requests.length, 0);
  const redirected = await probeCaptureSource(`${url}redirect`);
  assert.equal(redirected.state, "initial");
  assert.equal(redirected.resources, 3);
});

test("a force request creates a new capture generation without pretending the site changed", async t => {
  const { url } = await fixture(t);
  const initial = await probeCaptureSource(url);
  const forced = await probeCaptureSource(url, { previous: initial, force: true });
  assert.equal(forced.state, "forced");
  assert.equal(forced.fingerprint, initial.fingerprint);
  assert.notEqual(forced.key, initial.key);
});
