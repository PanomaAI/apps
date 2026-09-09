import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { recordSession } from "@panoma/video-capture";
import { writeTour } from "@panoma/video-tour";

async function fixture(t: TestContext) {
  let writes = 0;
  const server = createServer((request, response) => {
    if (request.method === "POST") { writes++; response.end("written"); return; }
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><html><head><style>body{font:24px sans-serif;padding:30px}button{padding:20px}</style></head><body><main><h1>Catalog</h1><button id="private" onclick="fetch('/write',{method:'POST'});document.querySelector('h1').textContent='Sent'">Open the universe</button><button onclick="this.disabled=true;document.querySelector('h1').textContent='Project memory'">View project memory</button></main></body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/`, writes: () => writes };
}

test("source-denied controls never reach a model's candidate menu and cannot be rescued by an arbitrary index", { timeout: 30_000 }, async t => {
  const { url, writes } = await fixture(t);
  const offered: string[] = [];
  const tour = await writeTour({ url, name: "policy", colorScheme: "light", denySelectors: ["#private"],
    takes: [{ id: "desktop", viewport: { width: 800, height: 500 } }], budget: { steps: 3, ctas: 1, pages: 1 },
    rerank: async input => { offered.push(...input.candidates.map(candidate => candidate.description)); return { order: [0, 1, 2, 3], why: "Choose an observed result." }; } });
  assert.equal(writes(), 0);
  assert.ok(offered.length > 0);
  assert.ok(offered.every(text => !text.includes("Open the universe")));
  assert.deepEqual(tour.denySelectors, ["#private"]);
  assert.ok(tour.candidates.some(candidate => candidate.description.includes("Open the universe") && candidate.reasons.some(reason => reason.includes("source policy"))));
  assert.ok(tour.steps.some(step => "clickOn" in step && step.clickOn.includes("View project memory")));
  assert.ok(!tour.steps.some(step => "clickOn" in step && step.clickOn.includes("Open the universe")));
});

test("the recorder refuses a forbidden action even when a cached script explicitly requests it as optional", { timeout: 20_000 }, async t => {
  const { url, writes } = await fixture(t);
  const outDir = await mkdtemp(join(tmpdir(), "panoma-video-action-policy-"));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  await assert.rejects(recordSession({ name: "policy", take: { id: "desktop", viewport: { width: 800, height: 500 } }, outDir,
    video: false, captureElements: false, captureFrames: false, captureMacros: false, denySelectors: ["#private"],
    steps: [{ goto: url }, { clickOn: "text=Open the universe", optional: true }] }), /Action refused by source policy: #private/);
  assert.equal(writes(), 0);
});
