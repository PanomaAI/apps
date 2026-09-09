import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { recordTake, scrollAtPointer, scrollToTarget, targetGeometry, type SessionTake } from "@panoma/video-capture";
import { launchBrowser, rewalk, writeTour } from "@panoma/video-tour";
import { scrollCheckpoint } from "../packages/tour/src/browser.ts";

const nested = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>html,body{margin:0;height:100%;overflow:hidden}header{height:48px}main{height:calc(100vh - 64px);margin:0 16px;overflow:auto;border:2px solid black}
  article{margin:100vh 12px;height:170px;overflow:auto;border:3px solid blue}button{display:block;margin:500px 12px;padding:12px}</style>
  <header>Workspace</header><main id="outer" style="scroll-behavior:smooth!important;scroll-snap-type:y mandatory"><article id="inner" style="scroll-behavior:smooth!important;scroll-snap-type:y mandatory"><button id="target">Open report</button></article></main>`;

test("semantic scrolling reveals a target through nested panels in both take layouts on one finite eased clock", async () => {
  const browser = await launchBrowser();
  try {
    for (const viewport of [{ width: 640, height: 360 }, { width: 360, height: 640 }]) {
      const page = await browser.newPage({ viewport });
      /* Drive the actual DOM animation on a controlled browser clock. A loaded
         full suite can leave fewer than four compositor samples in 350 ms of
         wall time; that measures host contention rather than the easing. */
      await page.clock.install({ time: "2026-01-01T00:00:00Z" });
      await page.setContent(nested);
      await page.clock.pauseAt("2026-01-01T01:00:00Z");
      assert.equal((await targetGeometry(page, "#target"))!.visibleShare, 0);
      await page.evaluate(() => {
        const samples: number[][] = [];
        (window as unknown as { scrollSamples: number[][] }).scrollSamples = samples;
        const tick = () => { samples.push([document.querySelector("#inner")!.scrollTop, document.querySelector("#outer")!.scrollTop]); if (samples.length < 100) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      });
      const moving = scrollToTarget(page, "#target", { duration: 350, at: 0.26 });
      /* A DOM barrier, not a sleep: do not advance the clock until the shared
         primitive has measured both panels and taken over their scroll styles. */
      await page.locator("#inner").evaluate(element => new Promise<void>(resolve => {
        const ready = () => (element as HTMLElement).style.scrollBehavior === "auto";
        if (ready()) { resolve(); return; }
        const observer = new MutationObserver(() => { if (ready()) { observer.disconnect(); resolve(); } });
        observer.observe(element, { attributes: true, attributeFilter: ["style"] });
      }));
      await page.clock.runFor(176);
      const halfway = await page.evaluate(() => [document.querySelector("#inner")!.scrollTop, document.querySelector("#outer")!.scrollTop]);
      await page.clock.runFor(192);
      const moved = await moving;
      assert.equal(moved.containers, 2);
      assert.equal(moved.windowY, 0, "the product scrolls its panels, never the locked window");
      assert.ok(moved.visibleShare > 0.99 && moved.centerVisible, JSON.stringify(moved));
      const read = await page.evaluate(() => ({ samples: (window as unknown as { scrollSamples: number[][] }).scrollSamples, styles: ["#inner", "#outer"].map((s) => document.querySelector(s)!.getAttribute("style")), y: [document.querySelector("#inner")!.scrollTop, document.querySelector("#outer")!.scrollTop] }));
      assert.ok(read.y.every((y) => y > 100));
      assert.ok(halfway.every((value, axis) => value > 0 && value < read.y[axis]), "both real scrollports have an intermediate position before the finite move completes");
      for (const axis of [0, 1]) {
        const positions = read.samples.map((sample) => sample[axis]);
        assert.ok(new Set(positions).size >= 4, "the footage sees intermediate frames, not one instant jump");
        assert.ok(positions.every((value, i) => i === 0 || value >= positions[i - 1]), "the nested motion does not reverse");
      }
      assert.deepEqual(read.styles, ["scroll-behavior: smooth !important; scroll-snap-type: y mandatory;", "scroll-behavior: smooth !important; scroll-snap-type: y mandatory;"]);
      assert.equal((await scrollToTarget(page, "#target", { onlyIfNeeded: true })).moved, false, "a visible control stays still before a click");
      await page.close();
    }
  } finally { await browser.close(); }
});

test("horizontal and transformed scrollports use their measured scale and preserve unrelated window scrolling", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  try {
    await page.setContent(`<!doctype html><style>body{margin:0;width:1500px}#panel{margin:20px 150px;width:360px;height:200px;overflow:auto;transform:scale(.8);transform-origin:top left}section{width:1000px;height:190px}button{margin:40px 800px;width:90px}</style><div id="panel"><section><button id="target">Open</button></section></div>`);
    await page.evaluate(() => window.scrollTo(80, 0));
    const result = await scrollToTarget(page, "#target");
    assert.ok(result.x > 400 && result.centerVisible && result.visibleShare > 0.99, JSON.stringify(result));
    assert.equal(result.y, 0);
    assert.equal(await page.evaluate(() => window.scrollX), 80);
    await page.setContent(`<!doctype html><style>body{margin:0}#panel{margin:20px;width:360px;height:200px;overflow:auto;direction:rtl}section{position:relative;width:1000px;height:190px}button{position:absolute;left:0;top:40px;width:90px}</style><div id="panel"><section><button id="target">Open</button></section></div>`);
    const rtl = await scrollToTarget(page, "#target");
    assert.ok(rtl.x < 0 && rtl.centerVisible, "right-to-left panels use negative scrollLeft instead of clamping to zero");
  } finally { await browser.close(); }
});

test("clipping is measured before capture, backward guards use the actual container, and rejected lessons can restore it", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  try {
    await page.setContent(`<!doctype html><style>body{margin:0}main{margin:20px;height:100px;overflow:auto}button{display:block;height:24px}#last{margin-top:140px}footer{height:500px}</style><main><button id="first">First</button><button id="last">Last</button><footer></footer></main>`);
    const clipped = (await targetGeometry(page, "#last"))!;
    assert.ok(clipped.box.y > 0 && clipped.box.y + clipped.box.height < 360, "the old viewport-only check would call this on screen");
    assert.equal(clipped.visibleShare, 0);
    const checkpoint = await scrollCheckpoint(page, "#last");
    try {
      await scrollToTarget(page, "#last");
      const before = await page.locator("main").evaluate((el) => el.scrollTop);
      assert.ok(before > 0);
      await assert.rejects(scrollToTarget(page, "#first", { back: false }), /BACK.*scroll container/);
      assert.equal(await page.locator("main").evaluate((el) => el.scrollTop), before, "the guard refuses before moving any ancestor");
      await checkpoint.restore();
      assert.equal(await page.locator("main").evaluate((el) => el.scrollTop), 0);
      await scrollAtPointer(page, 90, 80, { x: 60, y: 60 });
      assert.equal(await page.locator("main").evaluate((el) => el.scrollTop), 90, "a legacy wheel distance follows the panel under the pointer");
      assert.equal(await page.evaluate(() => window.scrollY), 0);
    } finally { await checkpoint.dispose(); }
  } finally { await browser.close(); }
});

test("recorded implicit approaches keep the click, the macro and the decoded product result on the same coordinates", { timeout: 90000 }, async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;height:100vh;overflow:hidden}main{margin:20px;height:110px;overflow:auto}button{display:block;margin:180px 20px 500px;padding:10px}h1{font-size:20px}</style><h1>Workspace</h1><main><button id="target" onclick="document.querySelector('h1').textContent='Report opened'">Open report</button></main>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const outDir = await mkdtemp(join(tmpdir(), "panoma-video-nested-record-"));
  try {
    const log = await recordTake({ name: "nested", take: { id: "desktop", viewport: { width: 640, height: 360 } }, outDir,
      steps: [{ goto: `http://127.0.0.1:${address.port}`, settleMs: 0 }, { mark: "open" }, { clickOn: "#target" }, { pause: 100, settled: true }, { mark: "result" }],
      outcomes: { open: { heading: "Report opened" } }, elementHints: { open: { selector: "#target" } } });
    const scroll = log.events.find((event) => event.kind === "scroll")!;
    const click = log.events.find((event) => event.kind === "click")!;
    assert.ok(scroll.kind === "scroll" && scroll.y > 100 && scroll.durationMs! >= 900);
    assert.ok(click.kind === "click" && click.t > scroll.t + scroll.durationMs!);
    const macro = log.macros!.find((asset) => asset.mark === "open")!;
    assert.equal(macro.at, "press", "an internally clipped control is not photographed at its mark");
    assert.ok(Math.abs(macro.target!.x + macro.target!.width / 2 - click.x) < 2);
    assert.ok(Math.abs(macro.target!.y + macro.target!.height / 2 - click.y) < 2);
    assert.ok(macro.focus && macro.change, "the real click produced the named result");
    assert.ok((await readFile(join(outDir, log.video))).length > 0, "the complete take exists alongside its semantic input log");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(outDir, { recursive: true, force: true });
  }
});

test("tour rehearsal, mobile re-walk and recording name the same nested destination", { timeout: 90000 }, async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;height:100vh;overflow:hidden}main{height:calc(100vh - 10px);overflow:auto}h1{margin:20px}section{height:700px}h2{margin:0 20px;padding-top:20px}button{margin:20px}</style><main><h1>Workspace</h1><section></section><h2>Reports</h2><button onclick="document.querySelector('h2').textContent='Report opened'">Open report</button><section></section></main>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const takes: SessionTake[] = [{ id: "desktop", viewport: { width: 640, height: 360 } }, { id: "mobile", viewport: { width: 360, height: 640 }, isMobile: true }];
  const browser = await launchBrowser();
  try {
    const script = await writeTour({ name: "nested", url: `http://127.0.0.1:${address.port}`, takes, budget: { steps: 4, ctas: 1, pages: 1 } });
    const section = script.marks.find((mark) => mark.label === "Reports")!;
    assert.ok(section?.target && section.target.y >= 0 && section.target.y < 360, "the tour records the measured landing, not stale document coordinates");
    assert.ok(script.steps.some((step) => "scrollTo" in step && step.scrollTo.includes("Reports")));
    const replay = await rewalk(browser, takes[1], script.steps, "dark");
    assert.deepEqual(replay.unreachedMarks, []);
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
