/*
  The promise the whole renderer rests on, checked in the smallest way that can fail:
  the same frame, painted twice by the same pool, is the same bytes. If this ever
  breaks, something in the page has found a clock, a random seed or the GPU.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { RasterPool } from "@panoma/video-engine/rasterizer";
import { startAssetServer } from "@panoma/video-engine/server";

test("one frame, painted twice, is byte-identical", async () => {
  const server = await startAssetServer({ assets: process.cwd() });
  const pool = await RasterPool.start({ origin: server.origin, width: 320, height: 180, parallel: 2 });
  try {
    const html = `<div style="position:absolute;inset:0;background:linear-gradient(135deg,#0a0a0a,#d2bd7f)">` +
      `<div style="font:700 48px Geist,sans-serif;color:#fafafa;padding:40px">Ññ 47 — the same</div></div>`;
    const [a, b] = await Promise.all([pool.rasterize(html), pool.rasterize(html)]);
    const hash = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
    assert.equal(hash(a), hash(b));
    const lint = await pool.lint(html, { x: 0, y: 0, width: 320, height: 180 });
    assert.deepEqual(lint, []);
    const clipped = await pool.lint(`<div style="position:absolute;left:0;top:0;width:80px;height:40px;overflow:hidden"><span style="font:24px sans-serif;white-space:nowrap">a sentence that does not fit</span></div>`, { x: 0, y: 0, width: 320, height: 180 });
    assert.ok(clipped.some((f) => f.kind === "overflow"), JSON.stringify(clipped));
    const outside = await pool.lint(`<div style="position:absolute;left:300px;top:0;font:24px sans-serif;white-space:nowrap">off stage</div>`, { x: 0, y: 0, width: 200, height: 180 });
    assert.ok(outside.some((f) => f.kind === "outside"), JSON.stringify(outside));
  } finally {
    await pool.close();
    await server.close();
  }
});
