import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { recordSession, recordTake } from "@panoma/video-capture";
import { launchBrowser, readingPause, type SnapshotNode } from "@panoma/video-tour";
import { waitForReading } from "../packages/capture/src/settle.ts";

test("reading time follows the changed result, with bounds and no navigation tax", () => {
  const short: SnapshotNode[] = [{ role: "heading", name: "Enabled", depth: 1, landmark: "main" }];
  const dense: SnapshotNode = { role: "paragraph", name: "The notes now include the project instructions and the linked documents that your team can inspect before continuing with the next step.", depth: 1, landmark: "main" };
  const opts = { scrollY: 0, height: 720, tutorial: true };
  const small = readingPause({ ...opts, nodes: short });
  const long = readingPause({ ...opts, nodes: [...short, dense] });
  assert.ok(long.pause > small.pause, "a result with reading in it earns more time than a toggle");
  assert.ok(long.pause <= 4800 && small.pause >= 2600);
  assert.equal(readingPause({ ...opts, nodes: [...short, { ...dense, landmark: "navigation" }] }).pause, small.pause);
  assert.equal(readingPause({ ...opts, nodes: [...short, dense], before: [dense] }).pause, small.pause, "unchanged prose is not read again");
  assert.equal(readingPause({ ...opts, nodes: [...short, dense], before: [{ ...dense, landmark: "navigation" }] }).pause, long.pause, "the menu name is not a result the viewer already read");
  const offscreen = { ...dense, box: { x: 0, y: 900, w: 300, h: 80 } };
  assert.equal(readingPause({ ...opts, nodes: [...short, dense], before: [offscreen], beforeScrollY: 0 }).pause, long.pause, "text newly revealed from below the fold still needs reading time");
  assert.equal(readingPause({ ...opts, nodes: [...short, dense], before: [offscreen], beforeScrollY: 850 }).pause, small.pause, "the before viewport is measured before navigation resets the scroll");
  assert.equal(readingPause({ ...opts, nodes: [...short, { ...dense, box: { x: 0, y: 900, w: 300, h: 80 } }] }).pause, small.pause, "offscreen prose is not the result");
  assert.equal(small.settled, true);
  assert.ok(readingPause({ ...opts, tutorial: false, nodes: short }).pause < small.pause, "a tour and a lesson have different reading needs");
});

test("a recorded pause starts its reading time after a delayed result, and action metadata keeps its clock", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><style>body{height:1600px}button{margin:20px}</style><main>
      <button onclick="this.setAttribute('aria-busy','true');setTimeout(()=>{this.removeAttribute('aria-busy');document.querySelector('h1').textContent='Ready'},700)">Open</button>
      <h1>Waiting</h1><input aria-label="Note"></main>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const outDir = await mkdtemp(join(tmpdir(), "panoma-video-reading-"));
  try {
    const log = await recordSession({
      name: "reading", take: { id: "desktop", viewport: { width: 640, height: 360 } }, outDir,
      video: false, captureElements: false, captureFrames: false, captureMacros: false,
      steps: [
        { goto: `http://127.0.0.1:${address.port}`, settleMs: 0 },
        { mark: "open" }, { clickOn: "button" }, { pause: 100, settled: true }, { mark: "result" },
        { press: { key: "Tab" }, role: "chrome" },
        { scroll: { y: 200, ms: 180 }, role: "chrome" },
      ],
    });
    const click = log.events.find((event) => event.kind === "click")!;
    const result = log.events.find((event) => event.kind === "mark" && event.name === "result")!;
    assert.ok(result.t - click.t >= 1000, "the next mark must keep the delayed result on tape, not merely the loading state");
    const scroll = log.events.find((event) => event.kind === "scroll");
    assert.ok(scroll && scroll.kind === "scroll" && scroll.durationMs! >= 180);
    assert.equal(scroll.role, "chrome");
    assert.equal(log.events.find((event) => event.kind === "key")?.role, "chrome");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(outDir, { recursive: true, force: true });
  }
});

test("decorative loops do not delay a readable page, while an endless busy state has a deadline", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.route("http://reading.test/", (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html>
      <style>@keyframes pulse{to{opacity:.2}}i{display:block;width:40px;height:40px;background:blue;animation:pulse 1s infinite}</style>
      <h1>Ready</h1><i></i><output style="position:absolute;top:2000px"></output>
      <script>setInterval(()=>document.querySelector('output').textContent=Date.now(),50)</script>` }));
    await page.goto("http://reading.test/");
    assert.equal(await waitForReading(page), "quiet", "an endless accent or an offscreen ticker is not a pending result");
    await page.locator("h1").evaluate((el) => el.setAttribute("aria-busy", "true"));
    assert.equal(await waitForReading(page), "deadline", "a stalled product cannot stall the recording indefinitely");
  } finally {
    await browser.close();
  }
});

test("only a quiet result after a product press receives a result timestamp before reading time", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><main><h1>Waiting</h1>
      <button id="open" onclick="this.setAttribute('aria-busy','true');setTimeout(()=>{this.removeAttribute('aria-busy');document.querySelector('h1').textContent='Ready'},700)">Open</button>
      <button id="chrome">Consent</button><button id="busy" onclick="this.setAttribute('aria-busy','true')">Never ready</button></main>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const outDir = await mkdtemp(join(tmpdir(), "panoma-video-result-time-"));
  try {
    const log = await recordSession({
      name: "result-time", take: { id: "desktop", viewport: { width: 640, height: 360 } }, outDir,
      video: false, captureElements: false, captureFrames: false,
      steps: [
        { goto: `http://127.0.0.1:${address.port}`, settleMs: 0 },
        { mark: "no-press" }, { pause: 20, settled: true },
        { mark: "open" }, { clickOn: "#open" }, { pause: 250, settled: true },
        { mark: "chrome" }, { clickOn: "#chrome", role: "chrome" }, { pause: 20, settled: true },
        { mark: "busy" }, { clickOn: "#busy" }, { pause: 20, settled: true },
        { mark: "end" },
      ],
    });
    const result = log.macros!.find((macro) => macro.mark === "open")!;
    const press = log.events.find((event) => event.kind === "click" && event.role === "product")!;
    const next = log.marks.find((mark) => mark.name === "chrome")!;
    assert.ok(result.resultAtMs! >= press.t + 1000, "readiness includes the delayed response and its quiet interval");
    assert.ok(next.t - result.resultAtMs! >= 240 && next.t - result.resultAtMs! < 500, "the timestamp excludes the reading dwell");
    for (const mark of ["no-press", "chrome", "busy"]) {
      const macro = log.macros!.find((item) => item.mark === mark);
      assert.ok(macro, `${mark}: the fixture captured its control`);
      assert.equal(macro.resultAtMs, undefined, `${mark}: no manufactured completion timestamp`);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(outDir, { recursive: true, force: true });
  }
});

test("a two-pass take stamps results with the camera clock even when the capture pass settles later", async () => {
  let visits = 0;
  const server = createServer((request, response) => {
    if (request.url !== "/") { response.writeHead(404).end(); return; }
    const delay = ++visits === 1 ? 100 : 1500;
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><main><h1>Waiting</h1><button onclick="this.setAttribute('aria-busy','true');setTimeout(()=>{this.removeAttribute('aria-busy');document.querySelector('h1').textContent='Ready'},${delay})">Open</button></main>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const outDir = await mkdtemp(join(tmpdir(), "panoma-video-result-clock-"));
  try {
    const log = await recordTake({
      name: "result-clock", take: { id: "desktop", viewport: { width: 640, height: 360 } }, outDir,
      captureElements: false, captureFrames: false,
      steps: [
        { goto: `http://127.0.0.1:${address.port}`, settleMs: 0 },
        { mark: "open" }, { clickOn: "button" }, { pause: 300, settled: true }, { mark: "end" },
      ],
    });
    const result = log.macros!.find((macro) => macro.mark === "open")!;
    const press = log.events.find((event) => event.kind === "click")!;
    const next = log.marks.find((mark) => mark.name === "end")!;
    assert.ok(result.resultAtMs! > press.t, "the timestamp follows the recorded press");
    assert.ok(next.t - result.resultAtMs! >= 290 && next.t - result.resultAtMs! < 550, "capture's extra wait cannot enter the video's clock");
    assert.ok(visits >= 2, "the two passes actually ran");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(outDir, { recursive: true, force: true });
  }
});

test("later input remeasures a settled press while direct navigation discards its old result", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><style>body{height:1600px}</style><main>
      <button id="edit" onclick="document.querySelector('input').focus()">Edit</button>
      <input oninput="document.querySelector('output').textContent=this.value"><output></output></main>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const outDir = await mkdtemp(join(tmpdir(), "panoma-video-result-actions-"));
  try {
    const log = await recordSession({
      name: "result-actions", take: { id: "desktop", viewport: { width: 640, height: 360 } }, outDir,
      video: false, captureElements: false, captureFrames: false,
      steps: [
        { goto: url, settleMs: 0 },
        { mark: "typing" }, { clickOn: "#edit" }, { pause: 20, settled: true },
        { type: { text: "notes", delayMs: 80 } }, { pause: 200, settled: true },
        { mark: "scrolling" }, { clickOn: "#edit" }, { pause: 20, settled: true },
        { scroll: { y: 100, ms: 250 } }, { pause: 200, settled: true },
        { mark: "navigation" }, { scrollTo: "#edit", back: true }, { clickOn: "#edit" }, { pause: 20, settled: true },
        { goto: url, settleMs: 0 }, { pause: 20, settled: true }, { mark: "end" },
      ],
    });
    const typed = log.events.find((event) => event.kind === "key")!;
    const scrolled = log.events.find((event) => event.kind === "scroll")!;
    assert.ok(scrolled.kind === "scroll");
    const typing = log.macros!.find((macro) => macro.mark === "typing")!;
    const scrolling = log.macros!.find((macro) => macro.mark === "scrolling")!;
    assert.ok(typing.resultAtMs! >= typed.t + 400, "the final result follows the whole aggregate typing action");
    assert.ok(scrolling.resultAtMs! > scrolled.t + scrolled.durationMs!, "scroll completion replaces the earlier settled click");
    assert.equal(log.macros!.find((macro) => macro.mark === "navigation")!.resultAtMs, undefined, "an unlogged direct navigation must not retain a different page's ready time");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(outDir, { recursive: true, force: true });
  }
});

test("reading waits for a delayed SPA destination and its final layout before spending the dwell", { timeout: 45000 }, async t => {
  const routeDelayMs = 1000;
  const layoutDelayMs = 250;
  const dwellMs = 300;
  const server = createServer((request, response) => {
    const anchor = request.url === "/anchor";
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><style>body{font:24px sans-serif}button,a{display:block;width:240px;padding:16px;margin:20px}</style>
      <main><h1>Project overview</h1>${anchor ? '<a id="open" href="/notes">Open notes</a>' : '<button id="open">Open notes</button>'}</main>
      <script>
        document.getElementById('open').onclick = event => {
          event.preventDefault();
          setTimeout(() => {
            history.pushState({}, '', '/notes');
            const heading = document.querySelector('h1');
            heading.textContent = 'Saved project notes';
            setTimeout(() => heading.style.marginTop = '140px', ${layoutDelayMs});
          }, ${routeDelayMs});
        };
      </script>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const outDir = await mkdtemp(join(tmpdir(), "panoma-video-destination-reading-"));
  t.after(() => rm(outDir, { recursive: true, force: true }));

  for (const kind of ["button", "anchor"] as const) await t.test(kind, async () => {
    const log = await recordSession({
      name: `destination-${kind}`, take: { id: "desktop", viewport: { width: 640, height: 360 } }, outDir,
      video: false, captureElements: false, captureFrames: false,
      ...(kind === "button" ? { outcomes: { open: { route: "/notes", heading: "Saved project notes" } } } : {}),
      steps: [
        { goto: `http://127.0.0.1:${address.port}/${kind}`, settleMs: 0 },
        { mark: "open" }, { clickOn: "#open" }, { pause: dwellMs, settled: true }, { mark: "end" },
      ],
    });
    const press = log.events.find(event => event.kind === "click")!;
    const result = log.macros!.find(macro => macro.mark === "open")!;
    const end = log.marks.find(mark => mark.name === "end")!;
    assert.ok(result.resultAtMs !== undefined, `${kind}: the arrived destination becomes readable`);
    assert.ok(result.resultAtMs - press.t >= routeDelayMs + layoutDelayMs + 300,
      `${kind}: quiet old content is not a result, and the final control geometry needs its own stable interval`);
    assert.ok(result.resultAtMs - press.t < 2500, `${kind}: a ready destination does not spend the whole deadline`);
    assert.ok(end.t - result.resultAtMs >= dwellMs - 10 && end.t - result.resultAtMs < dwellMs + 200,
      `${kind}: the reading dwell starts after destination readiness`);
  });
});

test("a destination that never arrives reaches the deadline without a fabricated result timestamp", { timeout: 20000 }, async t => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end('<!doctype html><main><h1>Project overview</h1><button>Open notes</button></main>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const outDir = await mkdtemp(join(tmpdir(), "panoma-video-missing-destination-"));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const log = await recordSession({
    name: "missing-destination", take: { id: "desktop", viewport: { width: 640, height: 360 } }, outDir,
    video: false, captureElements: false, captureFrames: false,
    outcomes: { open: { route: "/notes", heading: "Saved project notes" } },
    steps: [
      { goto: `http://127.0.0.1:${address.port}/`, settleMs: 0 },
      { mark: "open" }, { clickOn: "button" }, { pause: 300, settled: true }, { mark: "end" },
    ],
  });
  const press = log.events.find(event => event.kind === "click")!;
  const result = log.macros!.find(macro => macro.mark === "open")!;
  const end = log.marks.find(mark => mark.name === "end")!;
  assert.equal(result.resultAtMs, undefined, "a quiet previous page cannot stand in for a destination that never loaded");
  assert.ok(end.t - press.t >= 2800 && end.t - press.t < 3800,
    `the same readiness deadline bounds the failed destination: ${end.t - press.t} ms including reading dwell`);
});
