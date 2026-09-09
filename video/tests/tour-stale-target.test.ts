import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { DESKTOP_TAKE } from "@panoma/video-capture";
import { writeTour } from "@panoma/video-tour";

test("a CTA removed during reranking is refused without a phantom step and the next candidate is used", { timeout: 30000 }, async t => {
  let removeTarget = false;
  let removalAcknowledged = false;
  let validClicks = 0;
  const removed = Promise.withResolvers<void>();
  const html = `<!doctype html><meta charset="utf-8"><title>Project shelf</title>
    <style>body{font:24px sans-serif}button{display:block;width:300px;height:60px;margin:16px}</style>
    <main><h1>Project shelf</h1><button id="stale">Open recent project</button><button id="valid">Open saved notes</button></main>
    <script>
      document.getElementById('valid').onclick = () => {
        document.querySelector('main').innerHTML = '<h1>Saved project notes</h1><p>The project notes are ready to read.</p>';
        fetch('/clicked');
      };
      async function poll() {
        const state = await fetch('/control').then(response => response.json());
        if (state.remove) {
          document.getElementById('stale').remove();
          await fetch('/removed');
        } else setTimeout(poll, 1200);
      }
      setTimeout(poll, 1200);
    </script>`;
  const server = createServer((req, res) => {
    if (req.url === "/control") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ remove: removeTarget }));
    } else if (req.url === "/removed") {
      removalAcknowledged = true;
      res.end("removed");
      removed.resolve();
    } else if (req.url === "/clicked") {
      validClicks++;
      res.end("clicked");
    } else {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(html);
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const { port } = server.address() as { port: number };
  let offeredBoth = false;
  const script = await writeTour({
    url: `http://127.0.0.1:${port}/`, name: "stale-target", takes: [DESKTOP_TAKE], budget: { ctas: 1, pages: 1 },
    rerank: async input => {
      const stale = input.candidates.find(candidate => candidate.description.includes('"Open recent project"'));
      const valid = input.candidates.find(candidate => candidate.description.includes('"Open saved notes"'));
      if (!stale || !valid) return { order: [] };
      offeredBoth = true;
      removeTarget = true;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([removed.promise, new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("The browser did not acknowledge target removal")), 8000);
        })]);
      } finally { clearTimeout(timeout); }
      return { order: [stale.i, valid.i] };
    },
  });

  assert.equal(offeredBoth, true, "the ranking snapshot contains both original controls");
  assert.equal(removalAcknowledged, true, "the stale control is gone before the reranker returns");
  assert.equal(validClicks, 1, "the next valid control was actually clicked");
  const stale = script.candidates.find(candidate => candidate.description.includes('"Open recent project"'));
  assert.ok(stale);
  assert.match(stale.reasons.join(" "), /target disappeared/i);
  assert.ok(!script.steps.some(step => ("clickOn" in step && step.clickOn.includes("Open recent project")) ||
    ("scrollTo" in step && step.scrollTo.includes("Open recent project"))), "the missing target leaves no authored click or scroll");
  const actions = script.marks.filter(mark => mark.kind === "cta");
  assert.deepEqual(actions.map(mark => mark.label), ["Open saved notes"]);
  assert.equal(actions[0].outcome?.heading, "Saved project notes");
  assert.deepEqual(script.marks.map(mark => mark.kind), ["hero", "cta"], "the refused control leaves no phantom mark");
  assert.ok(script.edges, "a walk writes the screen graph it built");
  assert.equal(script.edges.length, 1);
  assert.equal(script.edges[0].label, "Open saved notes");
});
