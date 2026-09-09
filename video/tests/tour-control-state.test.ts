import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, test } from "node:test";
import { DESKTOP_TAKE } from "@panoma/video-capture";
import { launchBrowser, openTake, snapshotPage, stateHash, writeTour, type RerankInput } from "@panoma/video-tour";

describe("observed control state", () => {
  let browser: Awaited<ReturnType<typeof launchBrowser>>;
  before(async () => { browser = await launchBrowser(); });
  after(async () => { await browser.close(); });

  test("CSS selections and disclosure states change identity without changing accessible names", async () => {
    const { context, page } = await openTake(browser, DESKTOP_TAKE, "light");
    try {
      await page.setContent('<main><h1>Forecast</h1><button id="choice">Choose scenario</button></main>');
      const initial = await snapshotPage(page);
      for (const token of ["selected", "active", "open", "checked", "expanded", "is-selected"]) {
        await page.locator("#choice").evaluate((element: HTMLElement, token: string) => { element.className = token; }, token);
        const selected = await snapshotPage(page);
        assert.notEqual(selected.hash, initial.hash, token);
        assert.equal(stateHash(selected.nodes), stateHash(initial.nodes), "CSS does not become an accessible name");
      }
      await page.locator("#choice").evaluate((element: HTMLElement) => { element.className = ""; element.setAttribute("data-state", "open"); });
      const open = await snapshotPage(page);
      assert.notEqual(open.hash, initial.hash);
      assert.deepEqual(await page.locator("#choice").evaluate(element => element.getAttributeNames().filter(name => name.startsWith("aria-"))), [], "the observer never repairs or invents ARIA");
    } finally { await context.close(); }
  });

  test("focus, hover, animation, arbitrary data and decorative state do not manufacture a changed page", async () => {
    const { context, page } = await openTake(browser, DESKTOP_TAKE, "light");
    try {
      await page.setContent('<main style="height:2500px"><h1>Forecast</h1><button id="choice">Choose scenario</button><div id="decoration"></div></main>');
      const initial = await snapshotPage(page);
      await page.locator("#choice").evaluate((element: HTMLElement) => {
        element.className = "hover active:hover focus-visible animate-pulse transitioning frame-22";
        element.setAttribute("data-state", "frame-22");
        element.setAttribute("data-time", "1000");
        element.focus();
      });
      await page.locator("#decoration").evaluate((element: HTMLElement) => { element.className = "selected active open"; });
      assert.equal((await snapshotPage(page)).hash, initial.hash);
      await page.evaluate(() => window.scrollTo(0, 500));
      assert.equal((await snapshotPage(page)).hash, initial.hash, "scroll position and refs remain outside state identity");
    } finally { await context.close(); }
  });

  test("native disabled, checked and explicit ARIA state are read from the control", async () => {
    const { context, page } = await openTake(browser, DESKTOP_TAKE, "light");
    try {
      await page.setContent('<main><h1>Forecast</h1><button id="lock" disabled>Lock forecast</button><label><input type="checkbox">Confirm</label><button id="disclosure" aria-expanded="false">Details</button></main>');
      const initial = await snapshotPage(page);
      assert.equal(initial.nodes.find(node => node.name === "Lock forecast")?.disabled, true);
      await page.locator("#lock").evaluate(element => { (element as HTMLButtonElement).disabled = false; });
      const enabled = await snapshotPage(page);
      assert.notEqual(enabled.hash, initial.hash);
      assert.equal(enabled.nodes.find(node => node.name === "Lock forecast")?.disabled, undefined);
      await page.locator("input").check();
      const checked = await snapshotPage(page);
      assert.notEqual(checked.hash, enabled.hash);
      await page.locator("#disclosure").evaluate(element => element.setAttribute("aria-expanded", "true"));
      assert.notEqual((await snapshotPage(page)).hash, checked.hash);
    } finally { await context.close(); }
  });
});

const forecast = `<!doctype html><meta charset="utf-8"><style>
  body{font:24px sans-serif}button{display:block;width:300px;height:60px;margin:16px;background:white}
  button.selected,button.active{background:#155eef;color:white;border:4px solid #111}
  </style><main><h1>Practice a forecast</h1>
  <button id="scenario">Choose scenario A</button><button id="bias">Bullish</button>
  <button id="thesis">Momentum thesis</button><button id="lock" disabled>Lock forecast</button></main>
  <script>
  const selected=new Set();
  for(const id of ['scenario','bias','thesis']) document.getElementById(id).onclick=function(){
    this.className=id==='scenario'?'selected':'active';selected.add(id);
    document.getElementById('lock').disabled=selected.size!==3;
  };
  document.getElementById('lock').onclick=()=>document.querySelector('main').innerHTML='<h1>Forecast locked</h1><p>Your practice forecast is ready.</p>';
  </script>`;

test("the default action budget completes three CSS-only prerequisites and the enabled result action", { timeout: 90000 }, async () => {
  const server = createServer((_req, res) => { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(forecast); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const attempts: RerankInput[] = [];
  const names = ["Choose scenario A", "Bullish", "Momentum thesis", "Lock forecast"];
  try {
    const script = await writeTour({
      url: `http://127.0.0.1:${port}/`, name: "forecast", takes: [DESKTOP_TAKE],
      rerank: async input => {
        attempts.push(input);
        return { order: names.flatMap(name => input.candidates.filter(candidate => candidate.description.includes(`"${name}"`)).map(candidate => candidate.i)) };
      },
    });
    const actions = script.marks.filter(mark => mark.kind === "cta");
    assert.deepEqual(actions.map(mark => mark.label), names);
    assert.ok(script.marks.length <= 12);
    assert.deepEqual(actions.slice(0, 3).map(mark => mark.outcome), [undefined, undefined, undefined], "CSS selection never invents an outcome heading");
    assert.equal(actions[3].outcome?.heading, "Forecast locked", "the result is the page's actual heading");
    assert.ok(script.edges && script.pages, "a walk writes the screen graph it built");
    assert.equal(script.edges.length, 4);
    assert.equal(new Set(script.pages.map(page => page.id)).size, 5);
    for (let i = 0; i < 4; i++) {
      assert.ok(attempts[i]);
      for (const used of names.slice(0, i)) assert.ok(!attempts[i].candidates.some(candidate => candidate.description.includes(`"${used}"`)), "already used controls are not offered again");
      assert.equal(attempts[i].candidates.some(candidate => candidate.description.includes('"Lock forecast"')), i === 3, "the final action is offered only when the page enables it");
    }
    assert.ok(!script.candidates.some(candidate => candidate.reasons.some(reason => reason.includes("no-op click"))), "real CSS selections are kept");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
