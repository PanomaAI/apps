import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { recordTake } from "@panoma/video-capture";
import { writeTour } from "@panoma/video-tour";

async function serve(page: (path: string) => string) {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><style>body{margin:24px;font:16px sans-serif}h1,h2{margin:12px 0}button,a{display:inline-block;padding:16px}</style>${page(request.url ?? "/")}`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

const desktop = { id: "desktop", viewport: { width: 640, height: 360 } };

test("a repeated catalog name becomes the visible destination heading, never a new offscreen recommendation", { timeout: 45000 }, async () => {
  const server = await serve(path => path === "/detail"
    ? `<main><h1>Field Notes</h1><p>The selected notebook.</p><section style="height:35px;overflow:hidden"><h2 style="margin-top:100px">Hidden panel result</h2></section><section style="margin-top:1600px"><h2>You might also like</h2></section></main>`
    : `<main><h1>Catalog</h1><a href="/detail" aria-label="Open Field Notes"><h2>Field Notes</h2>Open notebook</a></main>`);
  try {
    const tour = await writeTour({ url: server.url, name: "repeat-name", takes: [desktop], budget: { steps: 2, ctas: 1, pages: 2 } });
    const outcome = tour.marks.find(mark => mark.kind === "cta")?.outcome;
    assert.deepEqual(outcome, { heading: "Field Notes", route: "/detail" }, JSON.stringify({ marks: tour.marks, candidates: tour.candidates }));
  } finally { await server.close(); }
});

test("local results omit clipped or offscreen new headings while retaining a visible dialog", { timeout: 60000 }, async () => {
  const server = await serve(path => `<main><h1>Catalog</h1>
    <button onclick="document.getElementById('results').hidden=false;this.textContent='Opened'">Open details</button>
    <div id="results" hidden><section style="height:25px;overflow:hidden"><h2 style="margin-top:80px">Clipped result</h2></section>
    ${path === "/dialog" ? '<div role="dialog"><h2>Notebook details</h2></div>' : ""}
    <h2 style="position:absolute;top:1200.5px">Recommendations</h2></div></main>`);
  try {
    for (const path of ["/dialog", "/only-offscreen"]) {
      const tour = await writeTour({ url: server.url + path, name: "local-results", takes: [desktop], budget: { steps: 2, ctas: 1, pages: 1 } });
      const mark = tour.marks.find(mark => mark.kind === "cta");
      assert.ok(mark, "the action still changed the real interface");
      assert.equal(mark.outcome?.heading, path === "/dialog" ? "Notebook details" : undefined);
      assert.equal(mark.outcome?.route, undefined);
    }
  } finally { await server.close(); }
});

test("each recorded take rejects an offscreen fractional heading and retains its exact visible result", { timeout: 90000 }, async () => {
  const server = await serve(() => `<main><h1>Result</h1><button id="act" onclick="this.style.background=this.style.background==='coral'?'lightblue':'coral'">Change card</button>
    <h2 style="position:absolute;top:2400.5px">Recommendations</h2></main>`);
  const outDir = await mkdtemp(join(tmpdir(), "panoma-video-heading-focus-"));
  try {
    for (const take of [desktop, { id: "mobile", viewport: { width: 360, height: 640 }, isMobile: true }]) {
      const log = await recordTake({ name: "heading-focus", take, outDir,
        steps: [{ goto: server.url }, { mark: "wrong" }, { clickOn: "#act" }, { pause: 100, settled: true },
          { mark: "right" }, { clickOn: "#act" }, { pause: 100, settled: true }, { mark: "done" }, { pause: 20 }],
        outcomes: { wrong: { heading: "Recommendations" }, right: { heading: "Result" } },
      });
      const wrong = log.macros?.find(macro => macro.mark === "wrong");
      const right = log.macros?.find(macro => macro.mark === "right");
      assert.ok(wrong?.change, `${take.id}: the first click really changed pixels`);
      assert.equal(wrong.focus, undefined, `${take.id}: zero intersection cannot round into a one-pixel focus`);
      assert.equal(wrong.resultHeading, undefined);
      assert.ok(right?.focus, `${take.id}: exact visible heading remains measured`);
      assert.equal(right.resultHeading?.text, "Result");
      assert.equal(right.resultHeading?.centerVisible, true);
      assert.ok(right.resultHeading!.visibleShare >= 0.9);
      assert.ok(right.focus.y + right.focus.height <= take.viewport.height);
      assert.ok(right.focus.height > 1);
    }
  } finally { await server.close(); await rm(outDir, { recursive: true, force: true }); }
});
