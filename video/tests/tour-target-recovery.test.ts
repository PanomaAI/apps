import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { launchBrowser } from "@panoma/video-tour";
import { targetAbsent, targetDisappeared } from "../packages/tour/src/browser.ts";
import { rewalk } from "../packages/tour/src/rewalk.ts";

test("absent-target recovery refuses present targets, application errors and closed pages", { timeout: 15000 }, async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent('<button id="present">Open</button><button id="hidden" hidden>Hidden</button>');
    const error = await page.locator("#gone").evaluate(() => true, undefined, { timeout: 30 }).catch(error => error);
    assert.equal(error.name, "TimeoutError");
    assert.equal(await targetDisappeared(page, "#gone", error), true);
    assert.equal(await targetDisappeared(page, "#present", error), false);
    assert.equal(await targetDisappeared(page, "#hidden", error), false, "hidden is still present, not a vanished observation");
    assert.equal(await targetAbsent(page, "#hidden"), false);
    assert.equal(await targetDisappeared(page, "#gone", new Error("page evaluation failed")), false);
    assert.equal(await targetDisappeared(page, "css=[invalid", error), false);
    await page.close();
    assert.equal(await targetDisappeared(page, "#gone", error), false);
    assert.equal(await targetAbsent(page, "#gone"), false);
  } finally { await browser.close(); }
});

test("a target disappearing during mobile approach makes its whole group optional and preserves the next action", { timeout: 20000 }, async () => {
  let clicked = false;
  const server = createServer((request, response) => {
    if (request.url === "/clicked") {
      clicked = true;
      response.end("ok");
      return;
    }
    response.setHeader("content-type", "text/html");
    response.end('<!doctype html><main><h1>Projects</h1><button id="stale">Open recent</button><button id="valid" onclick="fetch(\'/clicked\')">Open library</button></main>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const browser = await launchBrowser();
  let checks = 0;
  let removeAfter = 1;
  // Remove the real DOM target after either presence check, before the actual
  // locator.evaluate approach. No production hook or fake timeout.
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async options => {
    const context = await newContext(options);
    const newPage = context.newPage.bind(context);
    context.newPage = async () => {
      const page = await newPage();
      const locator = page.locator.bind(page);
      page.locator = (selector, options) => {
        const match = locator(selector, options);
        if (selector !== "#stale") return match;
        const first = match.first.bind(match);
        match.first = () => {
          const target = first();
          const boundingBox = target.boundingBox.bind(target);
          target.boundingBox = async options => {
            const check = ++checks;
            const box = await boundingBox(options);
            if (check === removeAfter) await page.evaluate(() => document.querySelector("#stale")!.remove());
            return box;
          };
          return target;
        };
        return match;
      };
      return page;
    };
    return context;
  };
  try {
    for (removeAfter of [1, 2]) {
      checks = 0;
      clicked = false;
      const result = await rewalk(browser, { id: "mobile", viewport: { width: 360, height: 640 }, isMobile: true }, [
        { goto: `http://127.0.0.1:${address.port}` }, { mark: "stale" },
        { scrollTo: "#stale", at: 0.5, ms: 200 }, { pause: 50 }, { clickOn: "#stale" },
        { mark: "valid" }, { clickOn: "#valid" },
      ], "light");
      assert.equal(checks, 2, "the target was removed after a successful presence check");
      assert.equal(clicked, true);
      assert.deepEqual(result.unreachedMarks, ["stale"]);
      assert.deepEqual(result.steps.filter(step => "mark" in step), [{ mark: "stale" }, { mark: "valid" }]);
      assert.equal(result.steps.length, 7, "no partial approach or duplicate group survives");
      const missing = result.steps.filter(step => ("scrollTo" in step && step.scrollTo === "#stale") || ("clickOn" in step && step.clickOn === "#stale"));
      assert.equal(missing.length, 2);
      assert.ok(missing.every(step => "optional" in step && step.optional === true));
      assert.deepEqual(result.steps.find(step => "clickOn" in step && step.clickOn === "#valid"), { clickOn: "#valid" });
      assert.ok(result.notes.some(note => note.selector === "#stale" && note.reasons.some(reason => reason.includes("target disappeared"))));
    }
  } finally {
    await browser.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("an approach that goes back up on the phone's layout is flagged back on that take, so the recorder's guard lets it through", { timeout: 20000 }, async () => {
  /*
    Two things side by side on a wide screen stack on a narrow one: the second lands far below
    the first, and a script that walked the desktop — first the section, then the control — now
    has to scroll back up for the control. The walk flags `back` only where it measured it;
    the re-walk of this take must measure it again. Measured on a catalog on 12-Sep-2026, where
    the mobile take died on the recorder's guard the re-walk had never armed.
  */
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(
      '<!doctype html><meta name="viewport" content="width=device-width"><style>body{margin:0} .row{display:flex} .row>*{flex:1 1 0} #first{height:1400px} #control{align-self:flex-start} .gap{display:none} .tall{height:1600px}' +
      ' @media (max-width:500px){.row{flex-direction:column} .row>*{flex:none} #control{order:-1} .gap{display:block;order:0;height:900px} #first{order:1}}</style>' +
      '<main><div class="row"><section id="first"><h2>Catalog overview</h2></section><div class="gap"></div><button id="control">List view</button></div><div class="tall"></div></main>',
    );
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const browser = await launchBrowser();
  try {
    const steps = [
      { goto: `http://127.0.0.1:${address.port}` }, { mark: "overview" },
      { scrollTo: "#first", at: 0.26, ms: 200 }, { pause: 50 },
      { mark: "cta" }, { scrollTo: "#control", at: 0.26, ms: 200 }, { pause: 50 }, { clickOn: "#control" },
    ];
    const wide = await rewalk(browser, { id: "wide", viewport: { width: 1000, height: 700 } }, steps, "light");
    const wideApproach = wide.steps.find(step => "scrollTo" in step && step.scrollTo === "#control");
    assert.ok(wideApproach && !("back" in wideApproach), "side by side, the control is not above the section");
    const phone = await rewalk(browser, { id: "mobile", viewport: { width: 360, height: 640 }, isMobile: true }, steps, "light");
    const phoneApproach = phone.steps.find(step => "scrollTo" in step && step.scrollTo === "#control");
    assert.ok(phoneApproach && "back" in phoneApproach && phoneApproach.back === true, "stacked, the control sits above where the section left the page");
    assert.deepEqual(phone.steps.filter(step => "pause" in step), [{ pause: 50 }, { pause: 50 }],
      "repairing a scroll cannot turn its following pause into another scroll");
    assert.equal(phone.steps.filter(step => "scrollTo" in step && step.scrollTo === "#control").length, 1);
    assert.ok(phone.notes.some(note => note.selector === "#control" && note.reasons.some(reason => reason.includes("flagged back"))));
    assert.deepEqual(phone.unreachedMarks, []);
  } finally {
    await browser.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("a banner whose first expander is an account menu does not stop the re-walk from opening the navigation's own", { timeout: 20000 }, async () => {
  /*
    Two buttons carry `aria-expanded` on the phone: an account menu in the banner and the
    «More» button that unfolds the secondary sections of the navigation. The target link only
    renders behind the second. Measured on a catalog on 12-Sep-2026: the re-walk opened the
    account menu, found nothing, and gave the link up as missing, so the phone take never
    clicked. Every expander is tried until one reveals the target, and the one that did is
    the chrome step the script gains.
  */
  let opened = 0;
  const server = createServer((request, response) => {
    if (request.url === "/packages") {
      opened += 1;
      response.setHeader("content-type", "text/html");
      response.end("<!doctype html><main><h1>Packages</h1></main>");
      return;
    }
    response.setHeader("content-type", "text/html");
    response.end(
      '<!doctype html><meta name="viewport" content="width=device-width"><style>[hidden]{display:none}</style>' +
      '<header><a href="/">Home</a><button id="account" aria-expanded="false" aria-controls="account-menu" onclick="account_menu.hidden=!account_menu.hidden;this.setAttribute(\'aria-expanded\',String(!account_menu.hidden))">Local account</button><div id="account-menu" hidden><a href="/settings">Settings</a></div></header>' +
      '<main><h1>Nothing scanned yet</h1></main>' +
      '<nav aria-label="Sections"><a href="/">Projects</a><a href="/spend">Spend</a><button id="more" aria-expanded="false" aria-controls="sections" onclick="sections.hidden=!sections.hidden;this.setAttribute(\'aria-expanded\',String(!sections.hidden))">More sections</button>' +
      '<div id="sections" hidden><a href="/packages">Packages</a><a href="/handoff">Handoff</a></div></nav>',
    );
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const browser = await launchBrowser();
  try {
    const result = await rewalk(browser, { id: "mobile", viewport: { width: 360, height: 640 }, isMobile: true }, [
      { goto: `http://127.0.0.1:${address.port}` }, { mark: "hero" }, { pause: 50 },
      { mark: "cta" }, { clickOn: 'role=link[name="Packages"s]' }, { pause: 50 },
    ], "light");
    assert.equal(opened, 1, "the link was clicked on the phone take once the right menu was open");
    assert.deepEqual(result.unreachedMarks, []);
    const menu = result.steps.filter(step => "clickOn" in step && step.clickOn === 'role=button[name="More sections"s]');
    assert.equal(menu.length, 1, "the navigation's own expander is the chrome step inserted");
    assert.deepEqual(menu[0], { clickOn: 'role=button[name="More sections"s]', optional: true, role: "chrome" });
    assert.ok(!result.steps.some(step => "clickOn" in step && step.clickOn.includes("Local account")), "the account menu is not in the script");
    const target = result.steps.find(step => "clickOn" in step && step.clickOn === 'role=link[name="Packages"s]');
    assert.deepEqual(target, { clickOn: 'role=link[name="Packages"s]' }, "the target keeps its click: it is not optional on this take");
    const note = result.notes.find(note => note.selector === 'role=button[name="More sections"s]');
    assert.ok(note && note.reasons.some(reason => reason.includes("navigation is collapsed")));
    assert.ok(!result.notes.some(note => note.description.includes("is missing on the mobile take")));
  } finally {
    await browser.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
