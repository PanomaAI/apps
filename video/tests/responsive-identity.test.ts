import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { recordSession } from "@panoma/video-capture";
import { writeTour, fromUserFlow } from "@panoma/video-tour";

async function fixture(t: TestContext, duplicate: boolean) {
  const server = createServer((_, response) => {
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:24px sans-serif;padding:30px}button{padding:20px}small{margin-left:10px}@media(max-width:700px){small{display:none}}</style></head><body><main><h1>Choose a destination</h1><button ${duplicate ? 'id="orbit"' : ""} onclick="document.querySelector('h1').textContent='Nebulosa orbit'">Open Nebulosa<small>5.200 light years</small></button></main>${duplicate ? '<script>if(innerWidth<700)document.querySelector("main").append(document.querySelector("button").cloneNode(true));</script>' : ""}</body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
}

const desktop = { id: "desktop", viewport: { width: 1000, height: 600 } };
const mobile = { id: "mobile", viewport: { width: 540, height: 960 }, isMobile: true };

test("a responsive accessible name retains the exact clicked element on both takes and in Recorder export", { timeout: 40_000 }, async t => {
  const url = await fixture(t, false);
  const tour = await writeTour({ url, name: "responsive", takes: [desktop, mobile], colorScheme: "light", budget: { steps: 3, ctas: 1, pages: 1 } });
  const click = tour.steps.find(step => "clickOn" in step);
  assert.ok(click && "clickOn" in click);
  assert.match(click.clickOn, /^css=button:has-text\(/);
  assert.equal(click.optional, undefined);
  assert.equal(click.alternate, click.clickOn);
  assert.ok(tour.marks.find(mark => mark.kind === "cta")?.outcome?.heading?.includes("Nebulosa orbit"));
  assert.ok(tour.candidates.some(candidate => candidate.reasons.some(reason => reason.includes("desktop-verified alternate"))));
  const exported = fromUserFlow(JSON.parse(JSON.stringify(tour.flow))).find(step => "clickOn" in step);
  assert.ok(exported && "clickOn" in exported);
  assert.equal(exported.alternate, click.alternate);
  const outDir = await mkdtemp(join(tmpdir(), "panoma-video-responsive-"));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const log = await recordSession({ name: "responsive", take: mobile, steps: tour.steps, outDir,
    video: false, captureElements: false, captureFrames: false, captureMacros: false });
  assert.equal(log.events.filter(event => event.kind === "click").length, 1, "the recorder executes the shared repaired script on mobile");
});

test("an alternate that becomes ambiguous on mobile earns no recorded outcome", { timeout: 30_000 }, async t => {
  const url = await fixture(t, true);
  const tour = await writeTour({ url, name: "ambiguous", takes: [desktop, mobile], budget: { steps: 3, ctas: 1, pages: 1 } });
  const click = tour.steps.find(step => "clickOn" in step);
  assert.ok(click && "clickOn" in click);
  assert.equal(click.alternate, "css=#orbit");
  assert.ok(click.optional);
  assert.equal(tour.marks.find(mark => mark.kind === "cta")?.outcome, undefined);
});
