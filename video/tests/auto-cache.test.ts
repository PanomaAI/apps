/*
  The pipeline caches on the product, not on the socket it was served from.

  The dev server takes a free port every run, so the base address differs each time
  while the product does not. Hashing that address verbatim made the tour and the
  takes miss on every call — and the renders behind them, since fresh takes have
  fresh bytes. What a key may see is checked here; that a second call actually says
  "cached" is checked end to end in mcp-tools.test.ts.
*/
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { auto, onOrigin, inputHash, isLoopback, stepsOnOrigin, tourOnOrigin } from "@panoma/video-director";
import { worktreeDigest } from "@panoma/video-scout";
import { fromUserFlow, toUserFlow, type TourScript } from "@panoma/video-tour";

const run = promisify(execFile);

test("no-camera never visits a supplied URL, even with force and no saved footage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-edit-only-"));
  /* The output directory is beside the project, never within it: `openWorkspace` refuses that. */
  const root = join(dir, "product");
  const previous = process.env.PANOMA_VIDEO_HOME;
  process.env.PANOMA_VIDEO_HOME = join(dir, "outputs");
  let visits = 0;
  const server = createServer((_, response) => { visits++; response.end("<h1>Must not be visited</h1>"); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "edit-only", type: "module", dependencies: { react: "1.0.0" } }));
    const address = server.address() as { port: number };
    const report = await auto({ root, camera: false, force: true, brain: "none", until: "study", url: `http://127.0.0.1:${address.port}` });
    assert.equal(visits, 0, "neither brand extraction, walking nor recording may contact the product");
    assert.equal(report.stages.record.status, "failed", "missing footage is not reported as cached");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous === undefined) delete process.env.PANOMA_VIDEO_HOME; else process.env.PANOMA_VIDEO_HOME = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

/** A repository with one committed file, somewhere temporary. */
async function repo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-tree-"));
  const git = (...args: string[]) => run("git", ["-C", dir, "-c", "user.email=t@panoma-video.test", "-c", "user.name=panoma-video", ...args]);
  await writeFile(join(dir, "page.html"), "<h1>one</h1>");
  await git("init", "-q");
  await git("add", "-A");
  await git("commit", "-q", "-m", "one");
  return dir;
}

test("a loopback address collapses to one token, whatever port it was given", () => {
  assert.equal(onOrigin("http://127.0.0.1:50270/docs.html?a=1", "local"), onOrigin("http://127.0.0.1:51074/docs.html?a=1", "local"));
  assert.equal(onOrigin("http://localhost:3000/app", "local"), "local/app");
  assert.equal(onOrigin("http://[::1]:8080/", "local"), "local/");
  /* The path survives: two routes of the same product are two different walks. */
  assert.notEqual(onOrigin("http://127.0.0.1:50270/docs", "local"), onOrigin("http://127.0.0.1:50270/app", "local"));
});

test("a deployed address is a different subject and keeps its whole self", () => {
  assert.equal(onOrigin("https://example.com/app", "local"), "https://example.com/app");
  assert.notEqual(onOrigin("https://example.com", "local"), onOrigin("http://127.0.0.1:50270", "local"));
  /* The takes of a deployed site and of this checkout must never share a key. */
  assert.notEqual(inputHash("tour", onOrigin("https://example.com", "local")), inputHash("tour", onOrigin("http://127.0.0.1:50270", "local")));
  /* Nonsense is left alone rather than thrown on: a key is not the place to validate an address. */
  assert.equal(onOrigin("not a url", "local"), "not a url");
});

test("rebasing onto a live origin is the same function, and is what sends the camera to a port that is open", () => {
  assert.equal(onOrigin("http://127.0.0.1:50270/docs.html", "http://127.0.0.1:51074"), "http://127.0.0.1:51074/docs.html");
  assert.equal(onOrigin("https://example.com/app", "http://127.0.0.1:51074"), "https://example.com/app");
});

test("a stored tour knows whether it needs a server, and every goto moves to the live one", () => {
  /*
    Replaying a tour is the other half of this: the addresses it stored name the port
    of the run that wrote it, and that socket is closed. `panoma-video record` asks these two
    questions before a frame is shot — does this need a server at all, and where are
    the steps going now.
  */
  assert.equal(isLoopback("http://127.0.0.1:50270/docs"), true);
  assert.equal(isLoopback("http://localhost:3000"), true);
  assert.equal(isLoopback("https://example.com/app"), false, "a deployed site is still there tomorrow");
  assert.equal(isLoopback("not a url"), false, "nonsense needs no server either");

  const steps = [{ goto: "http://127.0.0.1:50270/" }, { mark: "hero" }, { scrollTo: "text=Features", at: 0.26 }, { goto: "http://127.0.0.1:50270/start" }];
  const moved = stepsOnOrigin(steps as never, "http://127.0.0.1:61111");
  assert.deepEqual(
    moved.map((s) => ("goto" in s ? s.goto : null)),
    ["http://127.0.0.1:61111/", null, null, "http://127.0.0.1:61111/start"],
  );
  /* Nothing but an address is touched: the marks and the scrolls are the script. */
  assert.deepEqual(moved[1], { mark: "hero" });
  assert.deepEqual(moved[2], { scrollTo: "text=Features", at: 0.26 });
  /* A tour of a deployed site is left exactly where it was walked. */
  assert.deepEqual(stepsOnOrigin([{ goto: "https://example.com/app" }] as never, "http://127.0.0.1:61111"), [{ goto: "https://example.com/app" }]);
});

function cachedLocalTour(): TourScript & { key: string; lesson: { goal: string } } {
  const tour: TourScript & { key: string; lesson: { goal: string } } = {
    name: "catalog", url: "http://127.0.0.1:50270/catalog?sort=recent#drops", createdAt: "2026-09-06T00:00:00Z",
    key: "the-original-walk-key", lesson: { goal: "Open a launch" },
    steps: [
      { goto: "http://127.0.0.1:50270/catalog?sort=recent#drops", settleMs: 600 },
      { mark: "launch" }, { scrollTo: "#launch", at: 0.3, ms: 900, optional: true },
      { clickOn: "#launch", role: "product", optional: true, href: "/launch", alternate: "text=Launch" },
      { pause: 1500, settled: true },
      { goto: "http://localhost:50270/launch?view=details#about", settleMs: 350 },
      { goto: "https://docs.example.com/launch?lang=en#help" },
    ],
    marks: [{ name: "launch", label: "Launch", kind: "cta", outcome: { heading: "Launch details", route: "/launch" } }],
    candidates: [{ selector: "#launch", description: "Open launch", method: "click", box: { x: 20, y: 30, w: 100, h: 40 }, score: 5, reasons: ["product action"] }],
    snapshot: "heading Catalog\nlink Launch", denySelectors: ["#purchase"],
    pages: [{ id: "catalog", path: "/catalog", order: 0 }, { id: "detail", path: "/launch", heading: "Launch details", order: 1 }],
    edges: [{ from: "catalog", to: "detail", mark: "launch", label: "Launch", kind: "cta" }],
    flow: { title: "catalog", steps: [] },
  };
  tour.flow = toUserFlow(tour);
  return tour;
}

test("a freshly filmed cached tour rebinds its proof origin and Recorder flow without changing its story or cache identity", () => {
  const tour = cachedLocalTour();
  const original = structuredClone(tour);
  const moved = tourOnOrigin(tour, "http://127.0.0.1:61111/ignored-path?ignored=query");
  assert.equal(moved.url, "http://127.0.0.1:61111/catalog?sort=recent#drops");
  const expected = structuredClone(tour.steps);
  expected[0] = { goto: "http://127.0.0.1:61111/catalog?sort=recent#drops", settleMs: 600 };
  expected[5] = { goto: "http://127.0.0.1:61111/launch?view=details#about", settleMs: 350 };
  assert.deepEqual(moved.steps, expected, "only local navigation addresses change; input policy, destinations and timing remain authored");
  assert.deepEqual(fromUserFlow(moved.flow), expected, "the exported Recorder flow replays the same newly filmed addresses and commands");
  assert.deepEqual({ ...moved, url: tour.url, steps: tour.steps, flow: tour.flow }, tour,
    "marks, evidence graph, action exclusions, snapshot, extensions and original walk key survive");
  assert.equal(moved.key, tour.key);
  assert.equal(moved.lesson.goal, tour.lesson.goal, "the generic result retains lesson extensions");
  assert.equal(inputHash("record", stepsOnOrigin(moved.steps, "local")), inputHash("record", stepsOnOrigin(tour.steps, "local")),
    "a port change cannot invalidate the freshly saved recording key");
  assert.notStrictEqual(moved, tour);
  assert.deepEqual(tour, original, "rebinding cannot rewrite the cached tour or its previous flow in memory");
});

test("tour rebinding never redirects a remote subject, remote navigation or an invalid destination", () => {
  const local = cachedLocalTour();
  const remote = { ...local, url: "https://example.com/catalog" };
  assert.strictEqual(tourOnOrigin(remote, "http://127.0.0.1:61111"), remote, "a named deployed subject keeps its exact saved tour");
  for (const origin of ["https://example.com", "https://127.0.0.1.example.com", "not a url"]) {
    assert.strictEqual(tourOnOrigin(local, origin), local, "only a loopback destination can replace an ephemeral server");
  }
  for (const origin of ["http://localhost:61111", "http://[::1]:61111"]) {
    const moved = tourOnOrigin(local, origin);
    assert.equal(moved.url, `${origin}/catalog?sort=recent#drops`);
    assert.deepEqual(moved.steps.at(-1), local.steps.at(-1), "a foreign goto is not redirected to the local product");
    const remoteNavigation = moved.flow.steps.at(-1);
    assert.equal(remoteNavigation?.type, "navigate");
    if (remoteNavigation?.type === "navigate") assert.equal(remoteNavigation.url, "https://docs.example.com/launch?lang=en#help");
  }
});

test("the working tree is fingerprinted, so an uncommitted edit is not the same product", async () => {
  /* fileURLToPath, not .pathname: a checkout under a path with a space arrives percent-encoded. */
  const here = fileURLToPath(new URL("..", import.meta.url));
  const digest = await worktreeDigest(here);
  assert.match(digest ?? "", /^[0-9a-f]{16}$/, "this repository has a digest");
  assert.equal(digest, await worktreeDigest(here), "and it is stable while nothing changes");
  const dir = await repo();
  try {
    const clean = await worktreeDigest(dir);
    await writeFile(join(dir, "page.html"), "<h1>two</h1>");
    assert.notEqual(await worktreeDigest(dir), clean, "an edit to a tracked file is a different product");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a file git only knows the name of is hashed by its content, because that is what new work looks like", async () => {
  const dir = await repo();
  try {
    await mkdir(join(dir, "pricing"), { recursive: true });
    await writeFile(join(dir, "pricing", "index.html"), "<h1>nine</h1>");
    const first = await worktreeDigest(dir);
    /* The same untracked file, rewritten: the status line does not move, so only the content can say. */
    await writeFile(join(dir, "pricing", "index.html"), "<h1>forty-nine, and a new hero</h1>");
    assert.notEqual(await worktreeDigest(dir), first, "rewriting an untracked page is a different product");
    /* A whole section added inside the same untracked directory must move it too. */
    const second = await worktreeDigest(dir);
    await writeFile(join(dir, "pricing", "compare.html"), "<h1>compare</h1>");
    assert.notEqual(await worktreeDigest(dir), second, "a new page inside an untracked directory is a different product");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a tree git cannot speak for says so, and the pipeline then reuses nothing", async () => {
  /* No repository at all. */
  const bare = await mkdtemp(join(tmpdir(), "panoma-video-bare-"));
  /* A project the repository is told to ignore: its commit describes something else entirely. */
  const dir = await repo();
  try {
    assert.equal(await worktreeDigest(bare), undefined);
    await writeFile(join(dir, ".gitignore"), "sandbox/\n");
    await mkdir(join(dir, "sandbox", "app"), { recursive: true });
    await writeFile(join(dir, "sandbox", "app", "page.html"), "<h1>nested</h1>");
    assert.equal(await worktreeDigest(join(dir, "sandbox", "app")), undefined, "an ignored project is not described by its parent");
    assert.match((await worktreeDigest(dir)) ?? "", /^[0-9a-f]{16}$/, "while the repository itself still answers");
  } finally {
    await rm(bare, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
});
