/*
  @panoma/video-scout against six small projects that look like the real thing. The tests
  are literal on purpose: a fact's source is a file and a line number, and if the
  README parser drifts by one line every quote in every video points at the wrong
  sentence. The server round trip runs a real `node server.js` on a real free port,
  because the failures this package prevents (a guessed port, a port the browser
  refuses, a blank page recorded) only show up with a process on the other end.
*/
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  BAD_PORTS,
  detectPort,
  discoverRoutes,
  factSheet,
  frameworkById,
  freePort,
  FRAMEWORKS,
  parseChangelog,
  parseReadme,
  scoutProject,
  startServer,
  tcpOpen,
  type ProjectProfile,
  SKIP_DIRS,
} from "@panoma/video-scout";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FIX = join(ROOT, "tests", "fixtures", "scout");
const fixture = (name: string) => join(FIX, name);

const temps: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "panoma-video-scout-"));
  temps.push(d);
  return d;
};
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

test("kind per fixture", async () => {
  const kinds: Record<string, ProjectProfile["kind"]> = {};
  for (const name of ["next-app", "vite-spa", "cli-tool", "library", "node-server", "django-ish"]) {
    kinds[name] = (await scoutProject(fixture(name))).kind;
  }
  assert.deepEqual(kinds, {
    "next-app": "web-app",
    "vite-spa": "static-site",
    "cli-tool": "cli",
    library: "library",
    "node-server": "web-app",
    "django-ish": "web-app",
  });
});

test("next: framework, package manager, id, url, docs, commands with literal sources", async () => {
  const p = await scoutProject(fixture("next-app"));
  assert.equal(p.name, "@acme/web");
  assert.equal(p.version, "1.4.0");
  assert.match(p.id, /^acme-web-[0-9a-f]{8}$/);
  assert.equal(p.framework?.id, "next");
  assert.equal(p.framework?.version, "15.4.0");
  assert.equal(p.framework?.source, "package.json#dependencies.next");
  assert.equal(p.packageManager, "pnpm");
  assert.equal(p.url, "https://acme.example");
  assert.ok(p.docs.includes("README.md") && p.docs.includes("docs/roadmap.md"));
  assert.deepEqual(p.logoFiles[0], "public/logo.svg");
  const start = p.commands.find((c) => c.purpose === "start");
  assert.deepEqual(start, { purpose: "start", command: "pnpm run dev", source: "package.json#scripts.dev" });
  assert.ok(p.commands.some((c) => c.purpose === "install" && c.command === "pnpm install"));
  /* The start spec forces a port through the framework's own flag and binds the loopback interface. */
  assert.equal(p.start?.command, "pnpm");
  assert.deepEqual(p.start?.args, ["exec", "next", "dev", "-H", "127.0.0.1"]);
  assert.equal(p.start?.portFlag, "--port");
  assert.equal(p.start?.readiness, "http");
  assert.equal(p.start?.source, "package.json#dependencies.next → next dev");
});

test("vite spa: yarn from its lockfile, --port, one route", async () => {
  const p = await scoutProject(fixture("vite-spa"));
  assert.equal(p.framework?.id, "vite");
  assert.equal(p.packageManager, "yarn");
  assert.equal(p.start?.command, "yarn");
  assert.deepEqual(p.start?.args, ["vite", "--host", "127.0.0.1"]);
  assert.equal(p.start?.portFlag, "--port");
  assert.deepEqual(p.routes.map((r) => r.path), ["/"]);
});

test("vinext wins over retained Next and Vite dependencies and keeps App Router routes", async () => {
  const d = tempDir();
  cpSync(fixture("next-app"), d, { recursive: true });
  writeFileSync(join(d, "package.json"), JSON.stringify({ name: "vinext-app", dependencies: { vinext: "0.0.1", next: "16.0.0", vite: "7.0.0" } }));
  const p = await scoutProject(d);
  assert.equal(p.framework?.id, "vinext");
  assert.equal(p.framework?.source, "package.json#dependencies.vinext");
  assert.equal(p.kind, "web-app");
  assert.deepEqual(p.start?.args, ["exec", "--", "vinext", "dev", "-H", "127.0.0.1"]);
  assert.equal(p.start?.portFlag, "--port");
  assert.deepEqual(p.routes.map(r => r.path), ["/", "/pricing", "/docs/[slug]"]);
});

test("django: python framework from manage.py, port as a positional placeholder", async () => {
  const p = await scoutProject(fixture("django-ish"));
  assert.equal(p.framework?.id, "django");
  assert.equal(p.framework?.source, "manage.py");
  assert.equal(p.packageManager, "pip");
  assert.equal(p.start?.portFlag, null);
  assert.ok(p.start?.args.some((a) => a.includes("$PORT")), "runserver takes addr:port positionally");
  assert.ok(p.commands.some((c) => c.command === "pip install -r requirements.txt"));
});

test("cli and library have no start; the node server starts through its script with PORT", async () => {
  const cli = await scoutProject(fixture("cli-tool"));
  assert.equal(cli.start, undefined);
  const lib = await scoutProject(fixture("library"));
  assert.equal(lib.start, undefined);
  assert.equal(lib.facts.facts.find((f) => f.id === "readme.title")?.value, "Acme SDK", "a setext title counts");
  const srv = await scoutProject(fixture("node-server"));
  assert.equal(srv.framework, undefined);
  assert.deepEqual(srv.start && { command: srv.start.command, args: srv.start.args, envPort: srv.start.envPort, source: srv.start.source },
    { command: "npm", args: ["run", "start"], envPort: "PORT", source: "package.json#scripts.start" });
});

test("framework table: every entry names a source and a way to force the port when it has a dev server", () => {
  const wanted = ["next", "vite", "astro", "sveltekit", "nuxt", "react-router", "remix", "tanstack-start", "gatsby", "angular", "cra",
    "docusaurus", "vitepress", "eleventy", "hugo", "express", "fastify", "hono", "nest", "django", "flask", "fastapi", "rails", "go", "rust", "flutter"];
  for (const id of wanted) assert.ok(frameworkById(id), `missing framework ${id}`);
  for (const f of FRAMEWORKS) {
    assert.ok(f.source.length > 20, `${f.id} has no source`);
    if (f.devCommand !== null) {
      const cmd = typeof f.devCommand === "string" ? f.devCommand : "";
      assert.ok(f.portFlag || f.envPort || cmd.includes("$PORT"), `${f.id} cannot force a port`);
    }
  }
  assert.equal(frameworkById("next")?.portFlag, "--port");
  assert.equal(frameworkById("cra")?.portFlag, null);
  assert.equal(frameworkById("cra")?.envPort, "PORT");
  assert.equal(frameworkById("hugo")?.portFlag, "-p");
  /* Order: the meta-framework that sits on Vite must be found before Vite. */
  const idx = (id: string) => FRAMEWORKS.findIndex((f) => f.id === id);
  assert.ok(idx("sveltekit") < idx("vite") && idx("astro") < idx("vite") && idx("tanstack-start") < idx("vite"));
});

test("the counts the docs quote are the counts the tables have", () => {
  /* docs/scout.md and docs/platform.md state these; a table that grows must move the prose with it. */
  assert.equal(FRAMEWORKS.length, 28);
  assert.equal(BAD_PORTS.size, 82);
  assert.equal(SKIP_DIRS.size, 35);
});

test("routes: next app router — groups stripped, private and api skipped, dynamic last", () => {
  const routes = discoverRoutes(fixture("next-app"), "next");
  assert.deepEqual(routes.map((r) => [r.path, r.dynamic]), [["/", false], ["/pricing", false], ["/docs/[slug]", true]]);
  assert.equal(routes[1].source, "app/(marketing)/pricing/page.tsx");
});

test("routes: next prefers the build manifest when it exists", () => {
  const d = tempDir();
  mkdirSync(join(d, ".next"), { recursive: true });
  mkdirSync(join(d, "app", "old"), { recursive: true });
  writeFileSync(join(d, "app", "old", "page.tsx"), "");
  writeFileSync(join(d, ".next", "app-path-routes-manifest.json"), JSON.stringify({ "/page": "/", "/blog/[id]/page": "/blog/[id]", "/api/x/route": "/api/x" }));
  const routes = discoverRoutes(d, "next");
  assert.deepEqual(routes.map((r) => r.path), ["/", "/blog/[id]"]);
  assert.equal(routes[0].source, ".next/app-path-routes-manifest.json");
});

test("routes: sveltekit, tanstack (generated tree), react-router config, and the cap", () => {
  const sk = tempDir();
  for (const f of ["src/routes/+page.svelte", "src/routes/(app)/dashboard/+page.svelte", "src/routes/blog/[slug]/+page.svelte", "src/routes/+layout.svelte"]) {
    mkdirSync(join(sk, f, ".."), { recursive: true });
    writeFileSync(join(sk, f), "");
  }
  assert.deepEqual(discoverRoutes(sk, "sveltekit").map((r) => r.path), ["/", "/dashboard", "/blog/[slug]"]);

  const ts = tempDir();
  mkdirSync(join(ts, "src"), { recursive: true });
  writeFileSync(join(ts, "src", "routeTree.gen.ts"), `export interface FileRoutesByFullPath {\n  '/': typeof IndexRoute\n  '/about': typeof AboutRoute\n  '/posts/$postId': typeof PostsPostIdRoute\n}\nexport interface FileRoutesByTo {\n  '/x': typeof X\n}\n`);
  assert.deepEqual(discoverRoutes(ts, "tanstack-start").map((r) => [r.path, r.dynamic]), [["/", false], ["/about", false], ["/posts/$postId", true]]);

  const rr = tempDir();
  mkdirSync(join(rr, "app"), { recursive: true });
  writeFileSync(join(rr, "app", "routes.ts"), `export default [index("routes/home.tsx"), route("about", "routes/about.tsx"), route("users/:id", "routes/user.tsx")];`);
  assert.deepEqual(discoverRoutes(rr, "react-router").map((r) => [r.path, r.dynamic]), [["/", false], ["/about", false], ["/users/:id", true]]);

  const big = tempDir();
  for (let i = 0; i < 30; i++) {
    mkdirSync(join(big, "app", `p${String(i).padStart(2, "0")}`), { recursive: true });
    writeFileSync(join(big, "app", `p${String(i).padStart(2, "0")}`, "page.tsx"), "");
  }
  assert.equal(discoverRoutes(big, "next").length, 20);
});

test("facts: README title, tagline without badges, sections, commands — with exact line numbers", async () => {
  const p = await scoutProject(fixture("next-app"));
  const by = (id: string) => p.facts.facts.find((f) => f.id === id);
  assert.deepEqual(by("readme.title"), { id: "readme.title", kind: "text", value: "Acme Web", source: "README.md:1" });
  assert.deepEqual(by("readme.tagline"), {
    id: "readme.tagline", kind: "text",
    value: "One panel for every Acme device, on your own machine. Nothing leaves it.",
    source: "README.md:6",
  });
  assert.deepEqual(by("readme.section.features"), { id: "readme.section.features", kind: "feature", value: "Features", source: "README.md:18" });
  assert.equal(by("readme.section.license"), undefined, "housekeeping sections are not features");
  assert.equal(by("readme.section.roadmap"), undefined, "a roadmap is not a feature");
  assert.deepEqual(by("cmd.install"), { id: "cmd.install", kind: "command", value: "npx @acme/web init", source: "README.md:14" });
  assert.deepEqual(by("cmd.2"), { id: "cmd.2", kind: "command", value: "pnpm add @acme/web", source: "README.md:15" });
  assert.deepEqual(by("pkg.version"), { id: "pkg.version", kind: "version", value: "1.4.0", source: "package.json#version" });
  assert.deepEqual(by("url"), { id: "url", kind: "url", value: "https://acme.example", source: "package.json#homepage" });
  assert.deepEqual(by("framework.name"), { id: "framework.name", kind: "text", value: "Next.js", source: "package.json#dependencies.next" });
  assert.deepEqual(by("route.pricing"), { id: "route.pricing", kind: "route", value: "/pricing", source: "app/(marketing)/pricing/page.tsx" });
  assert.equal(p.facts.project, "@acme/web");
  const ids = p.facts.facts.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, "fact ids are unique");
});

test("facts: the newest Keep a Changelog section, Unreleased skipped", async () => {
  const p = await scoutProject(fixture("next-app"));
  const by = (id: string) => p.facts.facts.find((f) => f.id === id);
  assert.deepEqual(by("changelog.version"), { id: "changelog.version", kind: "version", value: "1.4.0", source: "CHANGELOG.md:10" });
  assert.deepEqual(by("changelog.date"), { id: "changelog.date", kind: "date", value: "2026-08-30", source: "CHANGELOG.md:10" });
  assert.deepEqual(by("changelog.added.1"), { id: "changelog.added.1", kind: "feature", value: "Offline mode", source: "CHANGELOG.md:13" });
  assert.deepEqual(by("changelog.added.2"), { id: "changelog.added.2", kind: "feature", value: "Device search", source: "CHANGELOG.md:14" });
  assert.deepEqual(by("changelog.fixed.1"), { id: "changelog.fixed.1", kind: "text", value: "The panel no longer loses devices on sleep", source: "CHANGELOG.md:17" });
  assert.equal(p.facts.facts.some((f) => f.value === "A thing that has not shipped"), false);
  assert.equal(p.facts.facts.some((f) => f.value === "Older stuff"), false);
});

test("code facts quote complete README examples in any declared code language, with exact source lines", async () => {
  const d = tempDir();
  const readme = ["# Tiny SDK", "", "## Usage", "```sh", "pnpm add tiny-sdk", "```", "", "```python",
    "from tiny import Catalog", "", "catalog = Catalog()", "catalog.list()", "```", "", "~~~sql",
    "SELECT name", "FROM projects;", "~~~", "", "```customlang", "items |> show", "```"].join("\n");
  writeFileSync(join(d, "README.md"), readme);
  const p = await scoutProject(d);
  assert.deepEqual(p.facts.facts.filter((f) => f.kind === "code"), [
    { id: "code.readme.2", kind: "code", value: "from tiny import Catalog\n\ncatalog = Catalog()\ncatalog.list()", source: "README.md:9" },
    { id: "code.readme.3", kind: "code", value: "SELECT name\nFROM projects;", source: "README.md:16" },
    { id: "code.readme.4", kind: "code", value: "items |> show", source: "README.md:21" },
  ]);
  assert.equal(p.facts.facts.filter((f) => f.kind === "command").length, 1, "shell installation stays a command, never duplicated as code");
  assert.deepEqual(p.facts.facts, (await scoutProject(d)).facts.facts, "ids are stable for the same README state");
});

test("code facts refuse roadmap ancestry, housekeeping, credentials and destructive examples", async () => {
  const d = tempDir();
  const fenced = (text: string, language = "ts") => ["```" + language, text, "```"].join("\n");
  writeFileSync(join(d, "README.md"), ["# Example", "## Roadmap", "### Future API", fenced("future.launch();"),
    "## Usage", "### Coming soon", fenced("later.launch();"), "### Current", fenced("current.list();"),
    "## Security", "### Example", fenced("private.scan();"), "## Examples",
    fenced('const token = "test";'), fenced('const auth = "ghp_1234567890abcdefghijklmnop";'),
    fenced('const apiKey = "••••••••";'), fenced('const token = "[redacted]";'),
    fenced('execSync("rm -rf /tmp/example");'), fenced("DROP TABLE projects;", "sql"),
    fenced("// TODO: ship this\nnext.launch();"), fenced("npm install example", "js"),
    fenced("node example.js", "console"), fenced("successful output", "text"),
    fenced("unlabelled output", ""), fenced("SELECT name FROM projects;", "sql")].join("\n"));
  const p = await scoutProject(d);
  assert.deepEqual(p.facts.facts.filter((f) => f.kind === "code").map((f) => f.value), ["current.list();", "SELECT name FROM projects;"]);
});

test("code facts are bounded by whole lines and characters and never truncate", async () => {
  const d = tempDir();
  const fence = (value: string) => `\n\`\`\`ts\n${value}\n\`\`\`\n`;
  const accepted = [Array.from({ length: 8 }, (_, i) => `show(${i});`).join("\n"), "x".repeat(70), Array(5).fill("y".repeat(70)).concat("z".repeat(45)).join("\n")];
  writeFileSync(join(d, "README.md"), "# Code\n## Usage\n" + [...accepted,
    Array(9).fill("show();").join("\n"), "x".repeat(71), Array(5).fill("y".repeat(70)).concat("z".repeat(46)).join("\n")].map(fence).join(""));
  const p = await scoutProject(d);
  assert.deepEqual(p.facts.facts.filter((f) => f.kind === "code").map((f) => f.value), accepted);
  assert.equal(accepted[2].length, 400);
});

test("markdown code examples keep whitespace and require a matching closed fence", () => {
  const r = parseReadme("# Code\r\n## Usage\r\n````ts\r\n  const x = 1;  \r\n```\r\n  show(x);\r\n````\r\n```ts\r\nunfinished();");
  assert.deepEqual(r.code, [{ text: "  const x = 1;  \n```\n  show(x);", line: 4, language: "ts", headings: ["Code", "Usage"] }]);
});

test("notFacts: README roadmap section, docs/roadmap.md, and a TODO in source — and never a .env", async () => {
  const d = tempDir();
  cpSync(fixture("next-app"), d, { recursive: true });
  writeFileSync(join(d, ".env"), "SECRET_TOKEN=hunter2 # TODO rotate before launch\n");
  writeFileSync(join(d, ".env.local"), "# TODO: hunter2 again\n");
  const p = await scoutProject(d);
  const nf = p.facts.notFacts;
  assert.ok(nf.some((n) => n.value === "Windows support is coming next month" && n.source === "README.md:25" && /plan/.test(n.why)));
  assert.ok(nf.some((n) => n.value === "Ship the Bluetooth pairing flow" && n.source === "docs/roadmap.md:3" && n.why === "roadmap item"));
  assert.ok(nf.some((n) => n.value === "remove the polling fallback once websockets land" && n.source === "src/lib/poll.ts:2" && n.why === "TODO in source"));
  const everything = JSON.stringify(p);
  assert.ok(!everything.includes("hunter2"), "a .env was read");
  assert.ok(!p.facts.facts.some((f) => f.value.includes("Bluetooth")), "a roadmap bullet became a fact");
});

test("git facts on this repository: head, a commit count for the window, and the tag list", async () => {
  const p = await scoutProject(ROOT, { days: 3650 });
  assert.match(p.git?.head ?? "", /^[0-9a-f]{40}$/);
  assert.ok((p.git?.commits ?? 0) > 0);
  assert.equal(p.git?.days, 3650);
  assert.equal(p.facts.head, p.git?.head);
  const count = p.facts.facts.find((f) => f.id === "git.commits.3650d");
  assert.equal(count?.kind, "number");
  assert.equal(count?.value, String(p.git?.commits));
  assert.equal(count?.source, "git:log:--since=3650 days");
  assert.ok(Array.isArray(p.git?.tags));
  for (const t of p.git?.tags ?? []) assert.match(t.date, /^\d{4}-\d{2}-\d{2}$/);
});

test("a directory that is not a repository has no git block", async () => {
  const d = tempDir();
  writeFileSync(join(d, "package.json"), JSON.stringify({ name: "loose" }));
  const p = await scoutProject(d);
  assert.equal(p.git, undefined);
  assert.equal(p.facts.head, undefined);
  assert.equal(p.kind, "unknown");
});

test("markdown: badges, setext titles and changelog date variants", () => {
  const r = parseReadme("[![b](https://x/b.svg)](https://x)\n\n# T\n\n<img src=\"x.png\">\n\n*Fast* and `small`.\n\n## A\n- one\n\n## B\n");
  assert.equal(r.title?.line, 3);
  assert.deepEqual(r.tagline, { text: "Fast and small.", line: 7 });
  assert.deepEqual(r.h2.map((h) => h.text), ["A", "B"]);
  const c = parseChangelog("# Log\n\n## 2.0.0 (2026-01-02)\n- Big\n\n## 1.0.0\n- Old\n");
  assert.deepEqual(c && { v: c.version, d: c.date, items: c.groups[0].items.map((i) => i.text) }, { v: "2.0.0", d: "2026-01-02", items: ["Big"] });
});

test("ports: the free port is never on the browser's bad list, and printed URLs are read", async () => {
  const port = await freePort();
  assert.ok(port > 1024 && !BAD_PORTS.has(port));
  assert.ok(BAD_PORTS.has(4190) && BAD_PORTS.has(6000) && BAD_PORTS.has(6666));
  assert.equal(detectPort("  ➜  Local:   http://localhost:5174/\n"), 5174);
  assert.equal(detectPort("- Local: http://127.0.0.1:3001"), 3001);
  assert.equal(detectPort("nothing here"), undefined);
});

/*
  `runtimeBase` is required now, and it has to be. The engine's home is decided in exactly
  one place — `videoHome()` in the director — and a package that walks somebody else's
  project has no business holding a second opinion about it. Tests are the callers here,
  so tests name a directory of their own.
*/
const runtimeBase = mkdtempSync(join(tmpdir(), "panoma-video-runtimes-"));
after(() => rmSync(runtimeBase, { recursive: true, force: true }));

test("server round trip: starts on a free port, serves HTML on 127.0.0.1, stops the tree", async () => {
  const p = await scoutProject(fixture("node-server"));
  const server = await startServer(p, { timeoutMs: 20_000, runtimeBase });
  try {
    assert.ok(!BAD_PORTS.has(server.port));
    assert.equal(server.url, `http://127.0.0.1:${server.port}`);
    const res = await fetch(server.url);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await res.text(), new RegExp(`acme on ${server.port}`));
    assert.match(server.log(), new RegExp(`listening on http://localhost:${server.port}`));
  } finally {
    await server.stop();
  }
  assert.equal(await tcpOpen(server.port), false, "the port is released after stop()");
});

test("server: http readiness on the same fixture, and a start that dies reports its output", async () => {
  const p = await scoutProject(fixture("node-server"));
  const strict: ProjectProfile = { ...p, start: { ...p.start!, readiness: "http" } };
  const server = await startServer(strict, { timeoutMs: 20_000, runtimeBase });
  await server.stop();
  const broken: ProjectProfile = { ...p, start: { ...p.start!, command: "node", args: ["-e", "console.log('boom'); process.exit(3)"] } };
  await assert.rejects(startServer(broken, { timeoutMs: 5000, runtimeBase }), /exited with code 3[\s\S]*boom/);
  const silent: ProjectProfile = { ...p, start: { ...p.start!, command: "node", args: ["-e", "console.log('idle'); setInterval(() => {}, 1000)"] } };
  await assert.rejects(startServer(silent, { timeoutMs: 1500, runtimeBase }), /not ready[\s\S]*idle/);
});

/*
  Read as text, because the branch it guards only runs on Windows. `shell: true` does not
  quote: Node joins the command and its arguments with single spaces and hands cmd.exe the
  result verbatim. The test above then became three arguments on Windows — node evaluated
  `console.log('boom')` alone, printed boom and exited 0 — so a start that died with code 3
  was reported as code 0, with the output of a command nobody wrote. cmd.exe is reached only
  for a shim cmd.exe alone can run now, over a line this package quotes itself.
*/
test("the server never hands spawn a shell, because a Windows shell passes arguments unquoted", () => {
  const source = readFileSync(join(ROOT, "packages", "scout", "src", "server.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  assert.equal(/\bshell\s*:/.test(code), false, "spawn options must never carry a shell");
  assert.match(code, /windowsVerbatimArguments: viaShell/, "the hand-built cmd.exe line must not be re-quoted by Node");
});

test("factSheet is synchronous and works on a profile without git", () => {
  const sheet = factSheet(fixture("cli-tool"), {
    root: fixture("cli-tool"), id: "x", name: "acme-cli", kind: "cli", commands: [], routes: [], docs: [], logoFiles: [],
  });
  assert.equal(sheet.facts.find((f) => f.id === "cmd.install")?.value, "npm i -g acme-cli");
  assert.equal(sheet.facts.find((f) => f.id === "cmd.install")?.source, "README.md:8");
});
