import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { recordSession, type MacroAsset } from "@panoma/video-capture";
import { fromUserFlow, writeTour } from "@panoma/video-tour";

test("a desktop dialog does not strand navigation, and its recorded reset replays on both layouts", { timeout: 90000 }, async t => {
  let destinations = 0;
  let denied = 0;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    if (request.url === "/packages") {
      destinations++;
      response.end("<!doctype html><main><h1>Installed packages</h1><p>Your local packages are ready.</p></main>");
      return;
    }
    if (request.url === "/denied") denied++;
    response.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
      <style>body{font:24px sans-serif}button,a{padding:16px;display:inline-block}
      #overlay{position:fixed;inset:0;background:white;z-index:10}
      #more{display:none}@media(max-width:700px){#palette,#links{display:none}#more{display:inline-block}#links.open{display:block}}</style>
      <header><button id="palette" onclick="document.querySelector('#overlay').hidden=false">Open the command palette</button></header>
      <nav><button id="more" aria-expanded="false" onclick="document.querySelector('#links').classList.toggle('open');this.setAttribute('aria-expanded',String(document.querySelector('#links').classList.contains('open')))">More sections</button>
      <div id="links"><a href="/recent" onclick="event.preventDefault()">Recent projects</a><a href="/packages">Packages</a><a href="/denied">Protected details</a></div></nav>
      <main><h1>Project catalog</h1></main>
      <div id="overlay" role="dialog" aria-label="Commands" hidden><h2>Choose a command</h2></div>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const desktop = { id: "desktop", viewport: { width: 1000, height: 700 } };
  const mobile = { id: "mobile", viewport: { width: 540, height: 960 }, isMobile: true };
  const script = await writeTour({ url, name: "modal-navigation", takes: [desktop, mobile], colorScheme: "light",
    denySelectors: ['a[href="/denied"]'], budget: { steps: 5, ctas: 1, pages: 3 } });
  assert.equal(destinations, 2, "the desktop walk and phone re-walk each really opened the destination");
  assert.equal(denied, 0, "restoring navigation does not bypass the source action policy");
  assert.ok(script.candidates.some(candidate => candidate.selector.includes("Recent projects") && candidate.reasons.some(reason => reason.includes("no-op"))),
    "a refused first link cannot discard the reset the next successful click needs on tape");
  const palette = script.steps.find(step => "clickOn" in step && step.clickOn.includes("command palette"));
  assert.ok(palette && "optional" in palette && palette.optional, "no mobile equivalent is invented for the hidden desktop control");
  const destination = script.marks.find(mark => mark.kind === "flow" && mark.label === "Packages");
  assert.deepEqual(destination?.outcome, { heading: "Installed packages", route: "/packages" });
  assert.equal(script.edges?.find(edge => edge.mark === destination?.name)?.from, script.pages?.[0].id,
    "the restored catalog, not the dialog state, is the navigation's real source");
  assert.equal(script.steps.filter(step => "goto" in step && step.goto === url).length, 2, "the recovery reset is in the shared recording script");
  assert.ok(script.steps.some(step => "clickOn" in step && step.clickOn.includes("More sections") && step.role === "chrome"));
  assert.deepEqual(fromUserFlow(script.flow), script.steps);

  const outDir = await mkdtemp(join(tmpdir(), "panoma-video-modal-navigation-"));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const steps = script.steps.map(step => "pause" in step ? { ...step, pause: 20 } : step);
  const outcomes = Object.fromEntries(script.marks.flatMap(mark => mark.outcome ? [[mark.name, mark.outcome]] : []));
  for (const take of [desktop, mobile]) {
    const log = await recordSession({ name: "modal-navigation", take, steps, outDir,
      outcomes, denySelectors: script.denySelectors, video: false, captureElements: false, captureFrames: true, captureMacros: true });
    assert.equal(log.events.filter(event => event.kind === "click" && event.role === "product").length, take === desktop ? 2 : 1,
      "the recorded product clicks agree with the observed layout");
    const proof: MacroAsset | undefined = log.macros?.find(macro => macro.mark === destination?.name);
    assert.equal(proof?.at, "press", "the reset arms capture for the real product press on the restored page");
    assert.ok(proof?.change && proof.change.share > 0, "the navigation earns a measured visible change in this take");
    assert.equal(proof.resultHeading?.text, "Installed packages", "the recorded result heading is visible after the actual click");
  }
  assert.equal(destinations, 4, "both cameras reached the real destination after replaying the recovery");
  assert.equal(denied, 0);
});
