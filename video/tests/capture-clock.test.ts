import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { isCalibratedVideoClock, recordSession } from "@panoma/video-capture";

const exec = promisify(execFile);
type Color = "red" | "green" | "blue" | "other";
async function encodedColors(file: string): Promise<{ frames: { t: number; color: Color }[]; width: number; height: number }> {
  const { stdout: rgb } = await exec("ffmpeg", ["-v", "error", "-i", file,
    "-vf", "crop=iw/4:ih/4:3*iw/4:3*ih/4,scale=1:1:flags=area,format=rgb24",
    "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { encoding: "buffer" });
  const { stdout: times } = await exec("ffprobe", ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "frame=best_effort_timestamp_time:stream=width,height", "-of", "json", file]);
  const { frames, streams } = JSON.parse(times) as { frames: { best_effort_timestamp_time: string }[]; streams: { width: number; height: number }[] };
  assert.equal(rgb.length, frames.length * 3);
  return { ...streams[0], frames: frames.map((frame, index) => {
    const [r, g, b] = rgb.subarray(index * 3, index * 3 + 3);
    const color: Color = r > 140 && g < 90 && b < 90 ? "red" :
      g > 140 && r < 90 && b < 90 ? "green" : b > 140 && r < 90 && g < 90 ? "blue" : "other";
    return { t: Number(frame.best_effort_timestamp_time), color };
  }) };
}

test("encoded desktop and mobile frames share the logged input clock across delayed navigation", { timeout: 60000 }, async t => {
  const initialPauseMs = 650;
  const navigationDelayMs = 60;
  const document = (blue: boolean) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>html,body{margin:0;min-height:100vh;background:${blue ? "rgb(20,20,220)" : "rgb(220,20,20)"}}button,a{display:block;margin:20px;padding:12px;width:180px;background:white;color:black;font:16px sans-serif}</style>
    ${blue ? "<h1>Opened project</h1>" : `<button id="change" onclick="document.documentElement.style.background=document.body.style.background='rgb(20,220,20)'">Show project</button><a id="next" href="/next">Open project</a>`}`;
  const server = createServer((req, res) => {
    if (req.url !== "/" && req.url !== "/next") { res.writeHead(404).end(); return; }
    setTimeout(() => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(document(req.url === "/next"));
    }, req.url === "/next" ? navigationDelayMs : 350);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const { port } = server.address() as { port: number };
  const outDir = await mkdtemp(join(tmpdir(), "panoma-video-capture-clock-"));
  t.after(() => rm(outDir, { recursive: true, force: true }));

  for (const take of [
    { id: "desktop", viewport: { width: 640, height: 360 } },
    { id: "mobile", viewport: { width: 360, height: 640 }, isMobile: true },
  ]) await t.test(take.id, async sample => {
    const log = await recordSession({
      name: "capture-clock", take, outDir, captureElements: false, captureFrames: false, captureMacros: false,
      steps: [
        { pause: initialPauseMs }, { goto: `http://127.0.0.1:${port}/`, settleMs: 0 }, { pause: 300 },
        { mark: "show" }, { clickOn: "#change" }, { pause: 600 },
        { mark: "open" }, { clickOn: "#next" }, { pause: 600 },
      ],
    });
    assert.equal(log.fps, 25);
    assert.ok(isCalibratedVideoClock(log.videoClock));
    assert.equal(log.videoClock.source, "screencast");
    assert.equal(log.videoClock.version, 1);
    assert.equal(log.videoRatio, 2);
    const encoded = await encodedColors(join(outDir, log.video));
    assert.deepEqual({ width: encoded.width, height: encoded.height }, { width: take.viewport.width * 2, height: take.viewport.height * 2 });
    const { frames } = encoded;
    const clicks = log.events.filter(event => event.kind === "click");
    assert.equal(clicks.length, 2);
    const firstRed = frames.find(frame => frame.color === "red");
    assert.ok(firstRed && firstRed.t >= (initialPauseMs - 80) / 1000, "the camera preserves the deliberate blank head before navigation");
    const at = (seconds: number) => frames.findLast(frame => frame.t <= seconds)?.color;
    for (const [index, before, after, responseDelay] of [
      [0, "red", "green", 0], [1, "green", "blue", navigationDelayMs],
    ] as const) {
      const click = clicks[index].t / 1000;
      const changed = frames.find(frame => frame.color === after);
      assert.ok(changed, `${take.id}: the encoded file contains the ${after} result`);
      const offsetMs = Math.round((changed.t - click) * 1000);
      sample.diagnostic(`Action ${index + 1}: encoded transition ${offsetMs} ms after press, including ${responseDelay} ms deliberate response latency.`);
      assert.equal(at(click - 0.12), before, `${take.id} action ${index + 1}: the old state must still be visible before the logged press (transition offset ${offsetMs} ms)`);
      assert.equal(at(click + 0.25), after, `${take.id} action ${index + 1}: the result must be visible after the logged press (transition offset ${offsetMs} ms)`);
      assert.ok(Math.abs(offsetMs - responseDelay) <= 120,
        `${take.id} action ${index + 1}: encoded transition is ${offsetMs} ms from the logged press; expected ${responseDelay} ms product latency within 120 ms for dispatch and 25 fps quantization`);
    }
  });
});
