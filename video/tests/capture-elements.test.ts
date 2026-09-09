import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LOCAL_CHANGE_MAX, MACRO_MIN, macroBox, macroRatio, recordTake } from "@panoma/video-capture";

const png = (buf: Buffer) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

/**
 * How alike two images are, 0..1, by ffmpeg's own structural similarity. The macro is
 * scaled down to the frame crop's size first, so this compares the PICTURE and not the
 * resolution.
 */
async function similarity(macroFile: string, frameFile: string, box: { x: number; y: number; width: number; height: number }): Promise<number> {
  const { spawn } = await import("node:child_process");
  const w = Math.round(box.width);
  const h = Math.round(box.height);
  const ff = spawn("ffmpeg", [
    "-v", "info", "-i", macroFile, "-i", frameFile,
    "-lavfi", `[0:v]scale=${w}:${h},format=gray[a];[1:v]crop=${w}:${h}:${Math.round(box.x)}:${Math.round(box.y)},format=gray[b];[a][b]ssim`,
    "-f", "null", "-",
  ]);
  let err = "";
  ff.stderr.on("data", (c) => (err += c));
  await new Promise((resolve) => ff.on("close", resolve));
  const all = err.match(/All:([\d.]+)/);
  return all ? Number(all[1]) : -1;
}

/** The seconds at which ffmpeg's own scene detector sees the picture change. */
async function sceneChanges(file: string): Promise<number[]> {
  const { spawn } = await import("node:child_process");
  const ff = spawn("ffmpeg", ["-v", "info", "-i", file, "-vf", "scdet=threshold=10", "-f", "null", "-"]);
  let err = "";
  ff.stderr.on("data", (chunk) => (err += chunk));
  await new Promise((resolve) => ff.on("close", resolve));
  return [...err.matchAll(/lavfi\.scd\.time: ([\d.]+)/g)].map((m) => Number(m[1]));
}

test("a recording mark captures its component, a 2x lossless viewport, a macro clip, and what the click changed", async () => {
  /*
    A card with a button that opens a menu below it. The first mark is the control
    before the click; the second mark is the page after it. Nothing here scrolls,
    so every box is in viewport coordinates as the log reports them.

    The ground is a horizontal gradient on purpose. On a flat page a crop taken from the
    wrong place averages the same colour as the right one, and the pixel check below
    passes through the very defect it exists to catch — measured: a clip shifted 300 px
    went unnoticed until this page had somewhere different to be.
  */
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      `<!doctype html><style>body{margin:0;background:linear-gradient(90deg,#0a3d62,#e55039 45%,#f6b93b);min-height:100vh}.card{position:absolute;left:80px;top:60px;width:360px;padding:28px;background:white;border-radius:18px}button{padding:14px 22px}#menu{position:absolute;left:100px;top:200px;width:300px;height:120px;margin:0;padding:0;list-style:none;background:#123;color:#fff}[hidden]{display:none}</style>` +
        `<main><article class="card"><h1>Project memory</h1><p>Keep the useful context.</p><button aria-label="Open memory" onclick="document.getElementById('menu').hidden=false">Open</button></article><ul id="menu" hidden><li>Notes</li><li>Sentinels</li></ul></main>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const outDir = await mkdtemp(join(tmpdir(), "panoma-video-elements-"));
  try {
    const log = await recordTake({
      name: "fixture",
      take: { id: "desktop", viewport: { width: 640, height: 360 } },
      outDir,
      steps: [
        { goto: `http://127.0.0.1:${address.port}` },
        { mark: "memory" },
        { clickOn: 'role=button[name="Open memory"s]' },
        { pause: 300 },
        { mark: "opened" },
        { pause: 40 },
      ],
      elementHints: { memory: { selector: 'role=button[name="Open memory"s]', label: "Open memory", kind: "flow" } },
      outcomes: { memory: { heading: "Project memory" } },
    });
    assert.equal(log.elements?.length, 2);
    const element = log.elements![0];
    assert.equal(element.mark, "memory");
    assert.equal(element.tag, "article", "the card wins over the tiny button");
    assert.match(element.text ?? "", /Project memory/);
    assert.ok(element.box.width > 300 && element.box.width < 500);
    assert.ok((await stat(join(outDir, element.file))).size > 1000);
    assert.equal(log.frames?.length, 2);
    const frame = log.frames![0];
    assert.equal(frame.mark, "memory");
    assert.equal(frame.pixelRatio, 2);
    assert.deepEqual(png(await readFile(join(outDir, frame.file))), { width: 1280, height: 720 });

    /* The macro: the button with its card around it, rendered by the page at the ratio the geometry asks for. */
    assert.equal(log.macros?.length, 2);
    const macro = log.macros![0];
    assert.equal(macro.mark, "memory");
    assert.ok(macro.target, "the hinted button is the control");
    assert.ok(macro.box.width >= MACRO_MIN.width && macro.box.height >= MACRO_MIN.height, `macro box ${JSON.stringify(macro.box)}`);
    assert.ok(macro.box.x <= macro.target!.x && macro.box.x + macro.box.width >= macro.target!.x + macro.target!.width, "the crop holds the control");
    assert.equal(macro.pixelRatio, macroRatio(macro.box));
    assert.ok(macro.pixelRatio >= 4, `a small control is rendered at ${macro.pixelRatio}x`);
    const shot = png(await readFile(join(outDir, macro.file)));
    assert.ok(Math.abs(shot.width - macro.box.width * macro.pixelRatio) <= macro.pixelRatio, `${shot.width} px for ${macro.box.width} css px at ${macro.pixelRatio}x`);
    assert.ok(Math.abs(shot.height - macro.box.height * macro.pixelRatio) <= macro.pixelRatio);

    /* What the click changed: the menu, and only the menu's corner of the viewport — so the after-state is local and rendered too. */
    assert.ok(macro.change, "the click opened a menu, and the next frame shows it");
    const change = macro.change!.box;
    assert.ok(change.x <= 104 && change.y <= 204, `the change starts at the menu: ${JSON.stringify(change)}`);
    assert.ok(change.x + change.width >= 396 && change.y + change.height >= 316, `the change covers the menu: ${JSON.stringify(change)}`);
    assert.ok(macro.change!.boxShare < LOCAL_CHANGE_MAX, "a menu is a local change");
    assert.ok(macro.after, "a local change earns an after-state clip");
    const after = macro.after!.box;
    assert.ok(after.x <= Math.min(macro.box.x, change.x) && after.y <= Math.min(macro.box.y, change.y), "the after crop holds the control and the change");
    assert.ok(after.x + after.width >= change.x + change.width && after.y + after.height >= change.y + change.height);
    const afterShot = png(await readFile(join(outDir, macro.after!.file)));
    assert.ok(Math.abs(afterShot.width - after.width * macro.after!.pixelRatio) <= macro.after!.pixelRatio);

    /* The control itself after the click, in its own box at its own ratio, and the heading the tour named, measured on that frame. */
    assert.ok(macro.afterControl, "the pressed control is rendered again");
    assert.equal(macro.afterControl!.pixelRatio, macro.pixelRatio);
    const controlShot = png(await readFile(join(outDir, macro.afterControl!.file)));
    assert.ok(Math.abs(controlShot.width - shot.width) <= 1 && Math.abs(controlShot.height - shot.height) <= 1, "same box, same size");
    assert.ok(macro.focus, "the outcome heading has a box on the next frame");
    assert.ok(macro.focus!.x >= element.box.x - 1 && macro.focus!.y >= element.box.y - 1 && macro.focus!.width > 100 && macro.focus!.height > 20, `the heading sits in the card: ${JSON.stringify(macro.focus)}`);

    /* The last mark is judged on the take's last frame; a still page changed nothing. */
    assert.ok(log.last, "the take ends on a frame");
    assert.equal(log.last!.mark, "__last");
    assert.equal(log.macros![1].change, undefined, "nothing happened after the second mark");
    assert.equal(log.macros![1].after, undefined);
    assert.ok(log.macros![1].afterControl, "but the control is still re-rendered on the last frame");
    assert.equal(log.macros![1].focus, undefined, "and no heading was named for it");

    const saved = JSON.parse(await readFile(join(outDir, "fixture.desktop.session.json"), "utf8"));
    assert.equal(saved.elements[0].file, element.file);
    assert.equal(saved.frames[0].file, frame.file);
    assert.equal(saved.macros[0].after.file, macro.after!.file);
    assert.equal(saved.last.file, log.last!.file);

    /*
      The crop shows the part of the page it says it does.

      Geometry was already asserted above — the box holds the control, the PNG is the box
      at its ratio — and all of it stayed true on 2026-09-03 while every macro on this
      disk was a crop of the WRONG PART of the page: `captureBeyondViewport` had moved
      the clip's coordinate space, and the only way to see it was to render a film and
      notice that the camera pushed into a control and showed blank card beside it.

      So the pixels are checked against the one other capture of the same instant: the
      full viewport at the same mark. The macro's average colour and the same box's
      average colour in the frame are the same picture, or the crop is somewhere else.
    */
    const alike = await similarity(join(outDir, macro.file), join(outDir, frame.file), {
      x: macro.box.x * frame.pixelRatio,
      y: macro.box.y * frame.pixelRatio,
      width: macro.box.width * frame.pixelRatio,
      height: macro.box.height * frame.pixelRatio,
    });
    assert.ok(alike > 0.9, `the macro crop is not the page at that box: structural similarity to the frame there is ${alike.toFixed(3)}`);

    /*
      And the take does not contain the recorder.

      Every asset capture is served by Chromium re-rendering a region of the page, and
      the screencast Playwright runs IS that surface — so a single-pass take carried, at
      every mark, the control drawn huge on a grey field and then a frame of nothing.
      Measured on panoma's app before the repair: a scene change within 0.14 s of 12
      marks out of 12; after `recordTake` split the walk into a camera pass and a capture
      pass, zero scene changes in the whole take. No re-render removes it — the glitch is
      in the footage, which is why this is asserted on the take and not on a film.

      A mark is a moment the recorder chose to notice. Nothing about noticing it may be
      visible, so a scene change may not sit on one.
    */
    const cuts = await sceneChanges(join(outDir, log.video));
    for (const mark of log.marks ?? []) {
      const nearest = Math.min(...cuts.map((c) => Math.abs(c - mark.t / 1000)), Number.POSITIVE_INFINITY);
      assert.ok(nearest > 0.25, `the recorder is visible in its own footage: a scene change ${nearest.toFixed(2)} s from the mark "${mark.name}"`);
    }
  } finally {
    server.close();
    await rm(outDir, { recursive: true, force: true });
  }
});

test("a control below the fold is captured at the press, under its mark, and judged at the next mark", async () => {
  /*
    The tour's own order for a control it has to scroll to: the mark, then the scroll that
    brings the control into view, then the click. At the mark the control is off-screen, and
    a mark that captured it there would report a strip of whatever sat at the bottom of the
    viewport as the control — so it captures nothing, and until the night of 2026-09-04
    that was the end of it: three of the panoma tutorial's five steps had no clip, no push
    and no lift. The clip is now taken the instant before the press, on the scrolled page.
  */
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      `<!doctype html><style>body{margin:0;background:linear-gradient(90deg,#0a3d62,#e55039 45%,#f6b93b)}main{position:relative;height:1600px}.card{position:absolute;left:80px;top:960px;width:360px;padding:28px;background:white;border-radius:18px}button{padding:14px 22px}#menu{position:absolute;left:100px;top:1100px;width:300px;height:100px;margin:0;padding:0;list-style:none;background:#123;color:#fff}[hidden]{display:none}</style>` +
        `<main><h1>Above the fold</h1><article class="card"><h2>Project memory</h2><button aria-label="Open memory" onclick="document.getElementById('menu').hidden=false">Open</button></article><ul id="menu" hidden><li>Notes</li><li>Sentinels</li></ul></main>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const outDir = await mkdtemp(join(tmpdir(), "panoma-video-fold-"));
  const viewport = { width: 640, height: 360 };
  try {
    const log = await recordTake({
      name: "fold",
      take: { id: "desktop", viewport },
      outDir,
      steps: [
        { goto: `http://127.0.0.1:${address.port}` },
        { mark: "memory" },
        { scrollTo: 'role=button[name="Open memory"s]', at: 0.4 },
        { clickOn: 'role=button[name="Open memory"s]' },
        { pause: 300 },
        { mark: "opened" },
        { pause: 40 },
      ],
      elementHints: { memory: { selector: 'role=button[name="Open memory"s]', label: "Open memory", kind: "flow" } },
      outcomes: { memory: { heading: "Project memory" } },
    });
    const onScreen = (b: { x: number; y: number; width: number; height: number }) => b.x >= 0 && b.y >= 0 && b.x + b.width <= viewport.width && b.y + b.height <= viewport.height;

    /* The mark's own frame exists — a mark is still a frame — and the press's before-image is not one of the take's frames. */
    assert.equal(log.frames?.length, 2);
    assert.equal(log.frames![0].mark, "memory");

    /* The macro carries the mark's name and says when it was taken; its box is the control on the scrolled page. */
    assert.equal(log.macros?.length, 2);
    const macro = log.macros![0];
    assert.equal(macro.mark, "memory");
    assert.equal(macro.at, "press");
    assert.equal(macro.t, log.marks[0].t, "stamped with its mark's time in the camera pass, like every asset");
    assert.ok(macro.target, "the measured control is the target");
    assert.ok(onScreen(macro.target!), `the control is on screen at the press: ${JSON.stringify(macro.target)}`);
    assert.ok(macro.target!.y > 60 && macro.target!.y < 260, `and sits where the scroll put it, not at the fold: ${JSON.stringify(macro.target)}`);
    assert.ok(onScreen(macro.box), `the crop is inside the viewport: ${JSON.stringify(macro.box)}`);
    assert.ok(macro.box.x <= macro.target!.x && macro.box.x + macro.box.width >= macro.target!.x + macro.target!.width, "the crop holds the control");
    assert.equal(macro.pixelRatio, macroRatio(macro.box));
    const shot = png(await readFile(join(outDir, macro.file)));
    assert.ok(Math.abs(shot.width - macro.box.width * macro.pixelRatio) <= macro.pixelRatio, `${shot.width} px for ${macro.box.width} css px at ${macro.pixelRatio}x`);
    assert.ok(Math.abs(shot.height - macro.box.height * macro.pixelRatio) <= macro.pixelRatio);

    /* The component around it, measured in this take at the press and not from the tour's box. */
    const element = log.elements!.find((e) => e.mark === "memory");
    assert.ok(element, "the element is captured at the press too");
    assert.equal(element!.tag, "article", "the card wins over the tiny button");
    assert.ok(onScreen(element!.box), `the component crop is on screen: ${JSON.stringify(element!.box)}`);

    /* The press is judged at the next mark, against the before-image taken at the press: after the scroll, so the scroll is not the change. */
    assert.ok(macro.afterControl, "the pressed control is rendered again at the next mark");
    assert.equal(macro.afterControl!.pixelRatio, macro.pixelRatio);
    assert.ok(macro.change, "the click opened a menu");
    assert.ok(macro.change!.boxShare < LOCAL_CHANGE_MAX, `a menu is a local change, not the scroll: ${JSON.stringify(macro.change)}`);
    assert.ok(macro.after, "and the local change earns an after-state clip");
    assert.ok(macro.focus, "the outcome heading, on the scrolled page");
    assert.ok(onScreen(macro.focus!));

    /* The second mark could see its page; it is a mark capture as before. */
    assert.equal(log.macros![1].mark, "opened");
    assert.equal(log.macros![1].at, "mark");

    const saved = JSON.parse(await readFile(join(outDir, "fold.desktop.session.json"), "utf8"));
    assert.equal(saved.macros[0].at, "press");
    assert.equal(saved.macros[0].file, macro.file);

    /* And the camera pass saw none of it: the capture at the press happens only where there is no camera. */
    const cuts = await sceneChanges(join(outDir, log.video));
    for (const mark of log.marks ?? []) {
      const nearest = Math.min(...cuts.map((c) => Math.abs(c - mark.t / 1000)), Number.POSITIVE_INFINITY);
      assert.ok(nearest > 0.25, `the recorder is visible in its own footage: a scene change ${nearest.toFixed(2)} s from the mark "${mark.name}"`);
    }
    const press = log.events.find((e) => e.kind === "click")!;
    const nearestPress = Math.min(...cuts.map((c) => Math.abs(c - press.t / 1000)), Number.POSITIVE_INFINITY);
    assert.ok(nearestPress > 0.25, `the recorder is visible at the press: a scene change ${nearestPress.toFixed(2)} s from the click`);
  } finally {
    server.close();
    await rm(outDir, { recursive: true, force: true });
  }
});

test("the macro crop keeps a small control inside its component and never smaller than the minimum", () => {
  const viewport = { width: 1920, height: 1080 };
  /* A 30x34 chevron inside a 197x60 split button: the crop is the button, not a stamp of the chevron. */
  const chevron = { x: 1607, y: 250, width: 30, height: 34 };
  const button = { x: 1453, y: 237, width: 197, height: 60 };
  const crop = macroBox(chevron, button, viewport)!;
  assert.ok(crop.x <= 1453 + 1 && crop.x + crop.width >= 1650 - 1, `the crop spans the button: ${JSON.stringify(crop)}`);
  assert.ok(crop.height <= 60 + 1, "and no taller than the button, which is the component");
  assert.ok(crop.x <= chevron.x - 6 && crop.x + crop.width >= chevron.x + chevron.width + 6, "the control keeps a hair of room");
  assert.ok(macroRatio(crop) >= 8, "a component this small is rendered at the top ratio");

  /* A link in a tall sidebar: the crop is the link with its neighbours, not the whole column. */
  const link = { x: 16, y: 153, width: 195, height: 46 };
  const aside = { x: 0, y: 61, width: 241, height: 1019 };
  const nav = macroBox(link, aside, viewport)!;
  assert.ok(nav.width >= MACRO_MIN.width - 30 && nav.height >= MACRO_MIN.height, JSON.stringify(nav));
  assert.ok(nav.height < 300, "the crop is a neighbourhood, not the column");
  assert.ok(nav.x >= 0 && nav.y >= 61, "and stays inside the component");

  /* A phone's full-width bar with its chevron at the far right: the crop is the whole bar, label and all, not the chevron's end of it. */
  const phone = { width: 720, height: 1280 };
  const bar = { x: 14, y: 258, width: 593, height: 54 };
  const tip = { x: 665, y: 266, width: 30, height: 34 };
  const whole = macroBox(tip, bar, phone)!;
  assert.ok(whole.x <= bar.x + 1 && whole.x + whole.width >= bar.x + bar.width - 1, `the bar whole: ${JSON.stringify(whole)}`);
  assert.equal(macroRatio(whole), 4, "a bar this wide lands its long edge near two thousand pixels at 4x");

  /* No control and no component: nothing to render. */
  assert.equal(macroBox(undefined, undefined, viewport), null);
  /* The ratio lands the long edge near two thousand device pixels, between 2x and 8x. */
  assert.equal(macroRatio({ x: 0, y: 0, width: 1000, height: 200 }), 2);
  assert.equal(macroRatio({ x: 0, y: 0, width: 250, height: 100 }), 8);
  assert.equal(macroRatio({ x: 0, y: 0, width: 500, height: 100 }), 4);
});

test("a part of a control is not a control: the crop is the whole split button", async () => {
  /*
    panoma's "Open in Claude" is one black pill made of two halves, flush against each
    other: a labelled button and a chevron button. The tour clicks the chevron, and on the
    phone take the chevron's own element won the score — it is 0.29% of that viewport,
    over the threshold that calls a clicked element useful, where on the desktop take the
    same chevron is 0.05% and the wrapper won instead. The same product was cropped two
    different ways by an accident of viewport size, and the phone's crop sliced the pill
    down the middle: the film pushed into a control and showed a chevron and half a word.

    The test is geometric. A child that shares two or more edges with its parent is a
    PIECE of it — a card has padding, a half of a split button does not.
  */
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      `<!doctype html><style>body{margin:0;background:linear-gradient(90deg,#0a3d62,#f6b93b);font:16px system-ui}` +
        `.split{position:absolute;left:120px;top:120px;display:flex;background:#111;border-radius:10px;overflow:hidden}` +
        `.split button{border:0;background:#111;color:#fff;font-size:15px;padding:12px 18px}` +
        `.split .tip{padding:12px 10px;border-left:1px solid #444}</style>` +
        `<main><div class="split"><button>Open in Claude</button><button class="tip" aria-label="More places to open it">v</button></div></main>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const outDir = await mkdtemp(join(tmpdir(), "panoma-video-split-"));
  try {
    const log = await recordTake({
      name: "split",
      take: { id: "desktop", viewport: { width: 720, height: 480 } },
      outDir,
      steps: [{ goto: `http://127.0.0.1:${address.port}` }, { pause: 200 }, { mark: "open" }, { pause: 200 }],
      elementHints: { open: { selector: 'role=button[name="More places to open it"s]', label: "More places to open it", kind: "cta" } },
    });
    const element = log.elements![0];
    const target = element.target!;
    /* The chevron is what was aimed at; the crop is the pill it belongs to. */
    assert.ok(target.width < 60, `the aimed control is the chevron: ${JSON.stringify(target)}`);
    assert.ok(element.box.width > target.width * 3, `the crop is a fragment of the control: ${JSON.stringify(element.box)}`);
    /* And it reaches past the chevron's left edge, which is where the label lives. */
    assert.ok(element.box.x < target.x - 80, `the crop starts at ${element.box.x} and the chevron at ${target.x}: the label is outside it`);
  } finally {
    server.close();
    await rm(outDir, { recursive: true, force: true });
  }
});
