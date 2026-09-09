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
