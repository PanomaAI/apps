# Scout

> A project on disk goes in. What it is, how to start it, which screens it has, and
> every sentence a video may quote — with a source for each — come out. No model, no
> browser, no key.

`@panoma/video-scout` is the first stage of the automatic path. Everything downstream — the
brand pass, the tour, the director's templates — reads a `ProjectProfile` and a
`FactSheet` instead of reading the repository again, and nothing downstream is
allowed to state a number, a command or a route the sheet does not carry.

## What it does

```ts
import { scoutProject, startServer } from "@panoma/video-scout";

const profile = await scoutProject("/path/to/project");   // ~0.2 s, no network
const server = await startServer(profile);                 // free port, 127.0.0.1, ready
// …record…
await server.stop();                                       // the whole process tree
```

`scoutProject` returns the contract from the architecture, section 2, exactly:
`kind`, `framework`, `packageManager`, `start`, `commands`, `routes`, `url`, `docs`,
`git`, `logoFiles` and `facts`. It never writes inside the project and never executes
anything it found there.

## Facts, not prose

The point of the package is the fact sheet. Every entry has a stable id and a literal
source:

| id | kind | source looks like |
| --- | --- | --- |
| `pkg.name` · `pkg.version` · `pkg.description` | text / version | `package.json#version` |
| `readme.title` · `readme.tagline` | text | `README.md:1` · `README.md:6` |
| `readme.section.<slug>` | feature | `README.md:18` (each H2 that is not housekeeping) |
| `cmd.install` · `cmd.2` … | command | `README.md:14` (install lines inside fenced blocks) |
| `code.readme.<fence ordinal>` | code | `README.md:22` (first content line of a complete, bounded, non-shell example) |
| `changelog.version` · `changelog.date` | version / date | `CHANGELOG.md:10` |
| `changelog.added.1` · `changelog.fixed.1` … | feature / text | `CHANGELOG.md:13` |
| `git.commits.30d` | number | `git:log:--since=30 days` |
| `git.lastTag` · `git.tag.1` · `git.tag.1.date` | version / date | `git:tag:v1.2.0` |
| `route.root` · `route.pricing` | route | `app/(marketing)/pricing/page.tsx` |
| `framework.name` · `framework.version` | text / version | `package.json#dependencies.next` |
| `url` | url | `package.json#homepage` or `README.md:9` |

A director template writes `{{fact:cmd.install}}` and gets the README's own line,
verbatim, at the line the source names. `auditClaims` in `@panoma/video-core` refuses a
literal number that no fact vouches for.

**Code examples are quoted, never executed or shortened.** A complete README fence
with a declared non-shell language can supply a code fact: at most eight lines,
70 characters per line and 400 characters total. Whitespace is kept, with CRLF
normalized to LF. Roadmap and housekeeping ancestry, credentials or masking, TODOs,
destructive-code patterns and duplicated install commands exclude the whole block.
Shell and output fences keep their existing command handling; they never become
code examples. The display rules and visual reference analysis are in
[effects-references.md](effects-references.md).

**`notFacts` are kept, not dropped.** TODO and FIXME lines in source, bullets under a
README section titled Roadmap / Coming soon / Planned, and every bullet of
`ROADMAP.md`, `TODO.md` or `docs/roadmap*.md` are listed with a `why`. They exist so
the audit can say "this sentence quotes a plan as if it had shipped" — which is what
regulators pulled the Apple and Google demo videos for.

**Nothing reads a `.env`.** The one file reader in the package (`fs.ts`) refuses any
basename that starts with `.env`, and the tree walk drops those files before a
caller sees them. A test copies a fixture, plants a secret in `.env` and `.env.local`
with a `TODO` beside it, and asserts the secret is nowhere in the profile.

## Kind

The rules follow Railpack's Node provider — the active successor of Nixpacks, whose
own repository has recommended it since 24-Nov-2025 — with two kinds the deploy tools
do not need, because a video about a CLI is a `TerminalRun` and a video about a
library never starts a server.

| order | rule | kind |
| --- | --- | --- |
| 1 | `pubspec.yaml` with a `flutter:` key, an `expo` dependency, or `app.json` with an `expo` key | `mobile` |
| 2 | `package.json#bin`, and no framework that serves pages | `cli` |
| 3 | Go: a `net/http`-style import anywhere → `web-app`; else `cmd/` or `main.go` → `cli`; else `library`. Rust: a web crate in `Cargo.toml` → `web-app`; `[[bin]]` or `src/main.rs` → `cli`; else `library` | |
| 4 | the framework's static rule (below) says yes | `static-site` |
| 5 | a framework with a dev server, or a server framework plus a start script | `web-app` |
| 6 | `exports` / `main` / `module` / `types` and no `dev` / `start` / `serve` / `develop` script | `library` |
| 7 | a start script or a `Procfile` `web:` line | `web-app` |
| 8 | `pyproject.toml`: `[project.scripts]` → `cli`, otherwise `library` | |
| 9 | nothing recognisable | `unknown` |

The static rules are Railpack's, one per framework (https://railpack.com/languages/node):
Vite (a Vite project no meta-framework claimed), Astro unless `output: 'server'`, Next
only with `output: 'export'`, React Router only with `ssr: false`, SvelteKit only with
`adapter-static`, and always for CRA, Angular, Gatsby, Docusaurus, VitePress, Eleventy, Hugo.

## The framework table

`frameworks.ts` is one ordered array. Each entry says how the framework is recognised
(npm dependencies, config files, Python distribution names, or a check), the dev
command as its own binary sees it, **the flag that forces a port**, **the flag that
binds the interface**, the port it would pick by itself, and what "ready" means. Every
entry carries a `source` line naming where each of those came from. Three rule tables
were transliterated, none copied verbatim (two are Go and TypeScript classes):

- **Railpack** (MIT) — detection and the static-vs-server decisions.
- **@netlify/build-info** (MIT, `packages/build-info/src/frameworks/*.ts`) — config
  files, dependencies, dev port, and the idea of TCP polling for readiness. Its
  accuracy tiers say a dependency match beats a config-file match; the table keeps that.
- **@vercel/frameworks** (Apache-2.0, `packages/frameworks/src/frameworks.ts`) — the
  `devCommand` strings that already carry `--port $PORT`, which is where the
  "substitute `$PORT` in the argv" convention comes from (Django's `runserver
  127.0.0.1:$PORT` is positional, and this is how it is expressed).

**Order is a decision.** A SvelteKit project has `vite` in devDependencies and the
first match wins, so every meta-framework is listed before the build tool it sits on.
A test pins that order.

Twenty-eight entries: vinext, next, sveltekit, nuxt, astro, tanstack-start, react-router, remix,
gatsby, angular, cra, docusaurus, vitepress, eleventy, vite, nest, express, fastify,
hono, hugo, django, flask, fastapi, rails, go, rust, flutter, expo.

## The start command, and why it is not the `dev` script

`profile.start` runs the framework's binary through the package manager's exec form —
`npm exec -- next dev`, `pnpm exec next dev`, `yarn next dev`, `bun x next dev` — plus
the host flag, and `startServer` appends the port flag. It does not run `pnpm run dev`.
A script such as `next dev --turbopack -p 3000` cannot be forced onto a free port from
outside: the port in the script wins, or the extra argument is swallowed by the package
manager (npm needs `--`, pnpm forwards without it, bun differs again). The script is
still recorded in `commands` for a person; the camera gets the port.

A project with no framework but a `dev` / `start` script runs that script with
`PORT` in the environment, which is the Heroku buildpack convention every Node
server follows. Readiness is then `tcp`: panoma video cannot know that an anonymous server
speaks HTML.

## Starting it for a camera

`startServer(profile)` first prepares a disposable runtime, then does five things,
each a scar from somewhere:

The runtime lives under `PANOMA_VIDEO_HOME/runtimes` (default `~/.panoma/video/runtimes`). Source and
already installed dependencies are copied there before the child starts. Copy-on-write
file clones may share storage until modified, but no file is a hard link. An explicitly
declared parent workspace is included when a package belongs to it, so local workspace
dependencies keep their normal resolution. Merely being nested inside another checkout
does not make a project one of that checkout's packages.

Internal symbolic links are rewritten to the copied targets and checked after copying.
An external or incomplete link refuses the start with a suggestion to use a running
`--url` or complete local dependencies outside panoma video. No dependency install runs, npm is
offline, and Corepack cannot fetch a package manager. A runtime base inside the source,
including through a directory symlink, is refused before anything is written there.

Environment files (`.env*` and Cloudflare's `.dev.vars*`), conventional credential
files/directories, `.wrangler` state, version-control metadata and framework caches are
excluded by name before file contents are copied — and any directory whose name starts
with `.next`, whatever follows: Next.js lets a project set `distDir`, and a catalog that kept
`.next-bundle`, `.next-dev` and `.next-ui-preview` beside `.next` carried 3.8 GB of webpack
caches into the copy until the disk ran out (13-Sep-2026). The child receives a small system
environment allowlist plus the caller's explicit `StartOptions.env`; it does not inherit
panoma video's API keys or `NODE_OPTIONS`. Its HOME, cache and temporary directories belong to
the runtime too. `RunningServer.runtimeDir` identifies the disposable copy and
`StartOptions.runtimeBase` can set its parent in a test or managed workspace.

This isolates ordinary framework output; it is not an operating-system sandbox for
hostile application code. A process can still use absolute paths written into its code
or contact a remote service configured by its source. Secret files with arbitrary names
cannot be recognized from filenames. Projects that require omitted local credentials
or external links may need an already running URL. No promise of hostile-code isolation
or complete secret discovery follows from making a copy.

1. **Picks a free port** by listening on 0 — and skips any port on the Fetch
   Standard's bad-ports list (https://fetch.spec.whatwg.org/#port-blocking). Chromium
   refuses those with `ERR_UNSAFE_PORT` and no server-side trace; panoma's `panoma up`
   on 4190 reported "did not answer in 60 s" with the server alive and curl at 200.
   6000, 6666 and 4190 are the ones people actually land on.
2. **Forces the port** through the entry's flag, the `$PORT` placeholder or the
   environment variable — never trusts a default. Vite moves to the next free port
   silently unless `strictPort` is set (https://vite.dev/config/server-options).
3. **Binds 127.0.0.1** with the host flag where the framework has one, plus
   `HOST=127.0.0.1`, `BROWSER=none` (CRA and Gatsby open a tab on start), and
   `NO_COLOR` so the URL regex reads clean stdout.
4. **Waits for readiness** by polling every 250 ms: an HTML answer on `GET /` for
   frameworks that serve pages (any status below 500 — a dev 404 page still means
   "up"), or an open socket for API servers. If stdout prints a localhost URL with a
   different port, the probe follows it.
5. **Fails with evidence.** A timeout or an early exit throws with the last 200 lines
   of stdout and stderr; `log()` returns the same tail on a live server.

`stop()` kills the tree: `pnpm run dev` is three processes deep, and killing the parent
alone leaves the server holding the port for the next take. POSIX children get their
own process group (`detached` + `kill(-pid)`), SIGTERM then SIGKILL after 3 s; Windows
gets `taskkill /T /F`. The group is checked even when its launcher already exited.
Only then is the runtime removed. Failed and timed-out starts also remove it, while the
last output remains in the error message. `tests/runtime.test.ts` verifies source bytes,
independent dependency files, excluded credentials, explicit environment transfer,
link refusals and cleanup through real child processes.

Any automatic camera run with saved scene revisions requires `--new-story`, including
an explicitly supplied URL or `--force`. This check happens before the brain, server,
URL probe or metadata writes: a new runtime can start with different local data, and
a recorder or policy upgrade can invalidate otherwise matching cache keys. `--no-camera`
keeps editing the saved footage. Refusal preserves the profile, facts, brand, journal
and takes. Before a story has saved revisions, ordinary runs still reuse a verified
unchanged served instance through the bounded freshness check.

## Routes

File conventions, one globber per framework, before any server exists:

| framework | read from |
| --- | --- |
| Next.js | `.next/app-path-routes-manifest.json` when a build exists; else `app/**/page.*` with `(group)` stripped, `_private` and `@slot` skipped, `[seg]` dynamic; else `pages/**` minus `_app`, `_document`, `_error`, `api/` |
| SvelteKit | `src/routes/**/+page.svelte`, `(group)` stripped |
| Nuxt | `pages/**` (`app/pages`, `src/pages` too); `app.vue` alone is one route |
| Astro | `src/pages/**` (`.astro`, `.md`, `.mdx`, `.html`), `_prefix` ignored |
| TanStack | `routeTree.gen.ts`'s `FileRoutesByFullPath` when it exists; else `routes/**` with dot nesting, `$param`, `_layout` pathless |
| React Router / Remix | `app/routes.ts` `index()` / `route("…")`; else flat files under `app/routes/` |
| Vite, CRA, Angular | `["/"]` — a SPA has one document; the rest is the live walker's job |

Static routes first, then dynamic; sorted by depth; **capped at 20**. A camera cannot
visit more, and a sheet with 400 routes is noise.

## Numbers and their sources

| Constant | Value | Source |
| --- | --- | --- |
| Default git window | 30 days | `panoma-video ideate`'s unit; a month is what people count commits in |
| Tags kept | 5 | a video names one release; five is context for a ticker |
| Route cap | 20 | a tour budget is 5–13 steps (Navattic docs); twenty routes is already more than a camera visits |
| Readiness poll | 250 ms | ≤250 ms of added latency, without log-spamming a server that logs requests |
| Readiness timeout | 60 s | a cold `next dev` with Turbopack compiles for 5–20 s on first request; sixty covers a first `pnpm dev` |
| Stdout tail | 200 lines | enough to hold a stack trace and the line before it |
| SIGTERM grace | 3 s | dev servers flush caches on exit; longer only delays a failing test |
| Bad ports | the Fetch Standard list, 82 entries | https://fetch.spec.whatwg.org/#port-blocking |
| Dev ports (never used, recorded) | next 3000 · vite 5173 · astro 4321 · gatsby 8000 · angular 4200 · eleventy 8080 · hugo 1313 · django 8000 · flask 5000 · rails 3000 | @netlify/build-info per-framework files; the framework's own CLI docs |
| TODO census | ≤40 entries, ≤3000 files, files ≤512 KB | context, not a catalogue; the walk must stay cheap on a big tree |
| Tree walk | ≤4000 files, depth ≤12, skips 35 cache / dependency / output directories | `node_modules` alone is hundreds of thousands of files |

## Known limits

- **The dev script's own flags are dropped.** `next dev --turbopack` becomes `next dev`
  when panoma video starts it. A project that only works with a script flag will start
  differently under the camera; `commands` still shows the script for a person.
- **Python and Ruby commands assume the conventional entrypoint.** FastAPI is started
  as `uvicorn main:app` (Railpack's guess); Rails as `bin/rails server`. The
  interpreter is `python3` except on Windows (`python`).
- **Monorepos are scouted at the path given.** Point `scoutProject` at
  `apps/web`, not at the workspace root, or the kind will be `library` or `unknown`
  and the routes empty. Workspace-aware scouting is a later piece.
- **The README parser understands ATX and setext headings, fences, bullets and
  badges.** Tables, HTML blocks and reference-style links are skipped, not
  misread. A tagline inside an HTML `<p align="center">` is invisible to it.
- **Dynamic routes carry no sample id.** `/docs/[slug]` is listed as dynamic and a tour
  must find a real slug in the live navigation.
- **Readiness `tcp` cannot see a crash after listen.** A server that opens the socket
  and then throws on the first request is "ready" here and blank on camera; the
  review stage catches the blank frames.
- **`git` facts need a checkout with history.** A shallow clone counts the commits it
  has; a tarball has no `git` block at all, and the sheet says so by omitting `head`.
