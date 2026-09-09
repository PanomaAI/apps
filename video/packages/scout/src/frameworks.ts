/*
  The framework table: how a project is recognised and how its dev server accepts a
  port. Without this table panoma video would have to guess a port, and the whole discovery
  research says nobody detects ports — Railpack, Netlify and Vercel all assume $PORT
  or a flag, and Coolify asks the user. So every entry says, from its own docs, the
  flag that forces a port and the flag that binds the loopback interface; the profile
  passes both, and the camera never records on an address it did not choose.

  Transliterated from three MIT / Apache-2.0 rule tables, each entry naming its source:
  - Railpack (MIT, railwayapp/railpack): detection and the static-vs-server rules,
    https://railpack.com/languages/node · /python · /ruby · /golang
  - @netlify/build-info (MIT, netlify/build, packages/build-info/src/frameworks/*.ts):
    config files, npm dependencies, dev port, TCP polling readiness
  - @vercel/frameworks (Apache-2.0, vercel/vercel, packages/frameworks/src/frameworks.ts):
    the `devCommand` strings that already carry `--port $PORT`
  Nothing is copied verbatim (two are Go and TypeScript classes); the rules are.

  Order matters and is deliberate: a meta-framework is listed before the build tool it
  sits on (SvelteKit before Vite, Nuxt before Vue), because a SvelteKit project has
  `vite` in devDependencies and the first match wins. Netlify's accuracy tiers say the
  same thing: a dependency match beats a config-file match.
*/

import { readdirSync } from "node:fs";
import { join } from "node:path";

export type Ecosystem = "node" | "python" | "ruby" | "go" | "rust" | "flutter" | "static";

/** What a rule may look at. Built once per project by profile.ts; nothing here touches the disk twice. */
export type DetectContext = {
  root: string;
  /** Root-level entry names. */
  files: Set<string>;
  /** npm dependencies + devDependencies, names only. */
  deps: Set<string>;
  /** Python distribution names from requirements.txt / pyproject.toml, lowercased. */
  pyDeps: Set<string>;
  has(rel: string): boolean;
  read(rel: string): string | undefined;
};

/** Railpack's static-site rules: "always" (a site generator), "never" (a server), or a check on the config. */
export type StaticRule = "always" | "never" | ((ctx: DetectContext) => boolean);

export type FrameworkRule = {
  id: string;
  name: string;
  ecosystem: Ecosystem;
  detect: { deps?: string[]; files?: string[]; pyDeps?: string[]; excludeDeps?: string[]; when?: (ctx: DetectContext) => boolean };
  /**
   * The dev server command as the framework's own binary sees it, without a port.
   * `null` means "no dev server of its own": run the package script instead (Express,
   * Fastify, Hono, Nest) or nothing at all (Flutter, Expo).
   */
  devCommand: string | ((ctx: DetectContext) => string) | null;
  /** The flag that forces the port, or null when the port travels in `envPort`. Value follows as the next arg. */
  portFlag: string | null;
  envPort: string | null;
  /** The flag that binds the interface (panoma video always passes 127.0.0.1), or null when the default is loopback already. */
  hostFlag: string | null;
  /** The port the framework picks by itself — recorded for humans, never used by the engine. */
  defaultPort: number | null;
  readiness: "http" | "tcp";
  static: StaticRule;
  source: string;
};

const NEXT_EXPORT = /output\s*:\s*["'`]export["'`]/;
const ASTRO_SERVER = /output\s*:\s*["'`]server["'`]/;
const SSR_FALSE = /ssr\s*:\s*false/;

function readConfig(ctx: DetectContext, names: string[]): string {
  for (const n of names) {
    const t = ctx.read(n);
    if (t !== undefined) return t;
  }
  return "";
}

const NEXT_CONFIGS = ["next.config.js", "next.config.mjs", "next.config.ts"];
const ASTRO_CONFIGS = ["astro.config.mjs", "astro.config.js", "astro.config.ts"];
const RR_CONFIGS = ["react-router.config.ts", "react-router.config.js"];
const NUXT_CONFIGS = ["nuxt.config.ts", "nuxt.config.js"];
const VITE_CONFIGS = ["vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"];

export const FRAMEWORKS: readonly FrameworkRule[] = [
  {
    id: "vinext", name: "vinext", ecosystem: "node",
    // vinext projects retain next and vite dependencies; the runtime must win both matches.
    detect: { deps: ["vinext"] },
    devCommand: "vinext dev", portFlag: "--port", envPort: "PORT", hostFlag: "-H", defaultPort: 3000, readiness: "http",
    static: "never",
    source: "vinext CLI dev help and cli-args.ts: --port, -H/--hostname; https://github.com/cloudflare/vinext",
  },
  {
    id: "next", name: "Next.js", ecosystem: "node",
    detect: { deps: ["next"], files: NEXT_CONFIGS, excludeDeps: ["@nrwl/next"] },
    devCommand: "next dev", portFlag: "--port", envPort: "PORT", hostFlag: "-H", defaultPort: 3000, readiness: "http",
    // Railpack: static only when next.config sets output: 'export' (output dir `out`).
    static: (ctx) => NEXT_EXPORT.test(readConfig(ctx, NEXT_CONFIGS)),
    source: "netlify build-info next.ts (port 3000, TCP) · vercel `next dev --port $PORT` · railpack node: output 'export' → static · https://nextjs.org/docs/app/api-reference/cli/next#next-dev-options (-H, --port)",
  },
  {
    id: "sveltekit", name: "SvelteKit", ecosystem: "node",
    detect: { deps: ["@sveltejs/kit"], files: ["svelte.config.js"] },
    devCommand: "vite dev", portFlag: "--port", envPort: null, hostFlag: "--host", defaultPort: 5173, readiness: "http",
    // adapter-static prerenders the whole site; every other adapter is a server.
    static: (ctx) => /adapter-static/.test(ctx.read("svelte.config.js") ?? ""),
    source: "netlify build-info svelte-kit.ts (port 5173) · vercel sveltekit-1 `vite dev --port $PORT` · https://svelte.dev/docs/kit/adapter-static",
  },
  {
    id: "nuxt", name: "Nuxt", ecosystem: "node",
    detect: { deps: ["nuxt", "nuxt3", "nuxt-edge"], files: NUXT_CONFIGS },
    devCommand: "nuxt dev", portFlag: "--port", envPort: "PORT", hostFlag: "--host", defaultPort: 3000, readiness: "http",
    static: (ctx) => SSR_FALSE.test(readConfig(ctx, NUXT_CONFIGS)),
    source: "netlify build-info nuxt.ts (port 3000) · vercel `nuxt dev` · https://nuxt.com/docs/api/commands/dev (--port, --host)",
  },
  {
    id: "astro", name: "Astro", ecosystem: "node",
    detect: { deps: ["astro"], files: ASTRO_CONFIGS },
    devCommand: "astro dev", portFlag: "--port", envPort: null, hostFlag: "--host", defaultPort: 4321, readiness: "http",
    // Railpack: static unless output is "server" (Astro 5 made "hybrid" the default of "static").
    static: (ctx) => !ASTRO_SERVER.test(readConfig(ctx, ASTRO_CONFIGS)),
    source: "netlify build-info astro.ts (port 4321; 3000 below v3, TCP) · vercel `astro dev --port $PORT` · railpack node: output != server → static",
  },
  {
    id: "tanstack-start", name: "TanStack Start", ecosystem: "node",
    detect: { deps: ["@tanstack/react-start", "@tanstack/start", "@tanstack/solid-start", "@tanstack/router-plugin"] },
    devCommand: "vite dev", portFlag: "--port", envPort: null, hostFlag: "--host", defaultPort: 3000, readiness: "http",
    static: "never",
    source: "netlify build-info tanstack-start.ts (port 3000) · vercel tanstack-start `vite --port $PORT` · https://tanstack.com/start/latest/docs/framework/react/quick-start",
  },
  {
    id: "react-router", name: "React Router", ecosystem: "node",
    detect: { deps: ["@react-router/dev"], files: RR_CONFIGS },
    devCommand: "react-router dev", portFlag: "--port", envPort: null, hostFlag: "--host", defaultPort: 5173, readiness: "http",
    // Railpack: static (SPA mode, output build/client) only when the config says ssr: false.
    static: (ctx) => SSR_FALSE.test(readConfig(ctx, RR_CONFIGS)),
    source: "netlify build-info react-router.ts · vercel `react-router dev` · railpack node: ssr false → static · https://reactrouter.com/how-to/spa",
  },
  {
    id: "remix", name: "Remix", ecosystem: "node",
    detect: { deps: ["@remix-run/dev"], files: ["remix.config.js"] },
    // Remix 2 runs on Vite; `remix vite:dev` is a Vite dev server with Vite's flags.
    devCommand: "remix vite:dev", portFlag: "--port", envPort: null, hostFlag: "--host", defaultPort: 5173, readiness: "http",
    static: "never",
    source: "netlify build-info remix.ts · vercel `remix dev` · https://remix.run/docs/en/main/other-api/dev",
  },
  {
    id: "gatsby", name: "Gatsby", ecosystem: "node",
    detect: { deps: ["gatsby"], files: ["gatsby-config.js", "gatsby-config.ts"] },
    devCommand: "gatsby develop", portFlag: "--port", envPort: null, hostFlag: "--host", defaultPort: 8000, readiness: "http",
    static: "always",
    source: "netlify build-info gatsby.ts (port 8000, TCP) · vercel `gatsby develop --port $PORT` · https://www.gatsbyjs.com/docs/reference/gatsby-cli/#develop",
  },
  {
    id: "angular", name: "Angular", ecosystem: "node",
    detect: { deps: ["@angular/cli"], files: ["angular.json"] },
    devCommand: "ng serve", portFlag: "--port", envPort: null, hostFlag: "--host", defaultPort: 4200, readiness: "http",
    static: "always",
    source: "netlify build-info angular.ts (port 4200, TCP) · vercel `ng serve --port $PORT` · railpack node: angular.json → static",
  },
  {
    id: "cra", name: "Create React App", ecosystem: "node",
    detect: { deps: ["react-scripts"] },
    // react-scripts has no port flag; PORT and HOST are environment variables.
    devCommand: "react-scripts start", portFlag: null, envPort: "PORT", hostFlag: null, defaultPort: 3000, readiness: "http",
    static: "always",
    source: "vercel create-react-app `react-scripts start` · railpack node: react-scripts → static (build/) · https://create-react-app.dev/docs/advanced-configuration/ (PORT, HOST, BROWSER)",
  },
  {
    id: "docusaurus", name: "Docusaurus", ecosystem: "node",
    detect: { deps: ["@docusaurus/core"], files: ["docusaurus.config.js", "docusaurus.config.ts"] },
    devCommand: "docusaurus start", portFlag: "--port", envPort: null, hostFlag: "--host", defaultPort: 3000, readiness: "http",
    static: "always",
    source: "netlify build-info docusaurus.ts (port 3000) · vercel `docusaurus start --port $PORT` · https://docusaurus.io/docs/cli#docusaurus-start-sitedir",
  },
  {
    id: "vitepress", name: "VitePress", ecosystem: "node",
    detect: { deps: ["vitepress"] },
    // Vercel guesses `docs`; the config directory says where the site really is.
    devCommand: (ctx) => (ctx.has("docs/.vitepress") && !ctx.has(".vitepress") ? "vitepress dev docs" : "vitepress dev"),
    portFlag: "--port", envPort: null, hostFlag: "--host", defaultPort: 5173, readiness: "http",
    static: "always",
    source: "netlify build-info vitepress.ts (port 5173) · vercel `vitepress dev docs --port $PORT` · https://vitepress.dev/reference/cli",
  },
  {
    id: "eleventy", name: "Eleventy", ecosystem: "node",
    detect: { deps: ["@11ty/eleventy"], files: [".eleventy.js", "eleventy.config.js", "eleventy.config.cjs", "eleventy.config.mjs"] },
    devCommand: "eleventy --serve", portFlag: "--port", envPort: null, hostFlag: null, defaultPort: 8080, readiness: "http",
    static: "always",
    source: "netlify build-info eleventy.ts (`eleventy --serve`, port 8080, TCP) · vercel `npx @11ty/eleventy --serve --watch --port $PORT`",
  },
  {
    id: "vite", name: "Vite", ecosystem: "node",
    detect: { deps: ["vite"], files: VITE_CONFIGS },
    devCommand: "vite", portFlag: "--port", envPort: null, hostFlag: "--host", defaultPort: 5173, readiness: "http",
    // Railpack: a Vite project that no meta-framework claimed (they are all above) is a SPA.
    static: "always",
    source: "netlify build-info vite.ts (port 5173) · vercel `vite --port $PORT` · railpack node: vite.config.* or `vite build` → static (dist) · https://vite.dev/config/server-options (5173 moves when busy)",
  },
  {
    id: "nest", name: "NestJS", ecosystem: "node",
    detect: { deps: ["@nestjs/core"] },
    devCommand: "nest start --watch", portFlag: null, envPort: "PORT", hostFlag: null, defaultPort: 3000, readiness: "tcp",
    static: "never",
    source: "vercel nestjs (devCommand null) · https://docs.nestjs.com/cli/usages#nest-start · the port is `app.listen(process.env.PORT ?? 3000)` in main.ts by convention",
  },
  {
    id: "express", name: "Express", ecosystem: "node",
    detect: { deps: ["express"] },
    devCommand: null, portFlag: null, envPort: "PORT", hostFlag: null, defaultPort: null, readiness: "tcp",
    static: "never",
    source: "vercel express (devCommand null; app/index/server files) · heroku nodejs behaviour: apps bind $PORT",
  },
  {
    id: "fastify", name: "Fastify", ecosystem: "node",
    detect: { deps: ["fastify"] },
    devCommand: null, portFlag: null, envPort: "PORT", hostFlag: null, defaultPort: null, readiness: "tcp",
    static: "never",
    source: "vercel fastify (devCommand null) · heroku nodejs behaviour: apps bind $PORT",
  },
  {
    id: "hono", name: "Hono", ecosystem: "node",
    detect: { deps: ["hono"] },
    devCommand: null, portFlag: null, envPort: "PORT", hostFlag: null, defaultPort: null, readiness: "tcp",
    static: "never",
    source: "vercel hono (devCommand null) · netlify build-info hono.ts",
  },
  {
    id: "hugo", name: "Hugo", ecosystem: "static",
    // config.toml is generic (Cargo, mise…): only with a content/ directory does it mean Hugo.
    detect: { files: ["hugo.toml", "hugo.yaml", "hugo.json"], when: (ctx) => ctx.has("content") && ["config.toml", "config.yaml", "config.json"].some((f) => ctx.has(f)) },
    devCommand: "hugo server -D", portFlag: "-p", envPort: null, hostFlag: "--bind", defaultPort: 1313, readiness: "http",
    static: "always",
    source: "netlify build-info hugo.ts (`hugo server -w`, port 1313, TCP) · vercel `hugo server -D -w -p $PORT` · https://gohugo.io/commands/hugo_server/ (--bind, -p)",
  },
  {
    id: "django", name: "Django", ecosystem: "python",
    detect: { files: ["manage.py"], pyDeps: ["django"] },
    // runserver takes addr:port positionally; `$PORT` is substituted by startServer.
    devCommand: "manage.py runserver 127.0.0.1:$PORT", portFlag: null, envPort: null, hostFlag: null, defaultPort: 8000, readiness: "http",
    static: "never",
    source: "railpack python: manage.py → Django · https://docs.djangoproject.com/en/stable/ref/django-admin/#runserver (default 127.0.0.1:8000)",
  },
  {
    id: "flask", name: "Flask", ecosystem: "python",
    detect: { pyDeps: ["flask"] },
    devCommand: "flask run", portFlag: "--port", envPort: null, hostFlag: "--host", defaultPort: 5000, readiness: "http",
    static: "never",
    source: "railpack python: flask + gunicorn → `gunicorn --bind 0.0.0.0:${PORT:-8000} main:app` (deploy) · https://flask.palletsprojects.com/en/stable/cli/ (`flask run --host --port`, default 5000)",
  },
  {
    id: "fastapi", name: "FastAPI", ecosystem: "python",
    detect: { pyDeps: ["fastapi"] },
    // Railpack's module guess; a JSON root is the norm, so an open socket is the honest readiness.
    devCommand: "uvicorn main:app", portFlag: "--port", envPort: null, hostFlag: "--host", defaultPort: 8000, readiness: "tcp",
    static: "never",
    source: "railpack python: fastapi + uvicorn → `uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}` · https://www.uvicorn.org/settings/",
  },
  {
    id: "rails", name: "Ruby on Rails", ecosystem: "ruby",
    detect: { files: ["config/application.rb"] },
    devCommand: "bin/rails server", portFlag: "-p", envPort: "PORT", hostFlag: "-b", defaultPort: 3000, readiness: "http",
    static: "never",
    source: "railpack ruby: config/application.rb → Rails · https://guides.rubyonrails.org/command_line.html#bin-rails-server (-p, -b, default 3000)",
  },
  {
    id: "go", name: "Go", ecosystem: "go",
    detect: { files: ["go.mod", "go.work", "main.go"] },
    // Railpack's target order: root package if it has Go files, else the first directory under cmd/.
    devCommand: (ctx) => (ctx.has("main.go") ? "go run ." : `go run ./cmd/${firstCmd(ctx) ?? "."}`),
    portFlag: null, envPort: "PORT", hostFlag: null, defaultPort: null, readiness: "tcp",
    static: "never",
    source: "railpack golang: go.mod / go.work / main.go; target = root, then first cmd/ subdirectory · no port convention documented (PORT is the buildpack norm)",
  },
  {
    id: "rust", name: "Rust", ecosystem: "rust",
    detect: { files: ["Cargo.toml"] },
    devCommand: "cargo run", portFlag: null, envPort: "PORT", hostFlag: null, defaultPort: null, readiness: "tcp",
    static: "never",
    source: "nixpacks rust provider (Cargo default_run, workspace members) — railpack has no Rust page yet · panoma runbook.ts `cargo run`",
  },
  {
    id: "flutter", name: "Flutter", ecosystem: "flutter",
    detect: { files: ["pubspec.yaml"], when: (ctx) => /^\s*flutter\s*:/m.test(ctx.read("pubspec.yaml") ?? "") },
    devCommand: null, portFlag: null, envPort: null, hostFlag: null, defaultPort: null, readiness: "tcp",
    static: "never",
    source: "panoma runbook.ts: pubspec.yaml + lib/ → flutter run · https://docs.flutter.dev/reference/flutter-cli",
  },
  {
    id: "expo", name: "Expo", ecosystem: "node",
    detect: { deps: ["expo"] },
    devCommand: null, portFlag: null, envPort: null, hostFlag: null, defaultPort: 8081, readiness: "tcp",
    static: "never",
    source: "railpack node: expo + react-native-web + app.json expo.web.output → static web; otherwise a mobile app · netlify build-info expo.ts",
  },
];

function firstCmd(ctx: DetectContext): string | undefined {
  if (!ctx.has("cmd")) return undefined;
  try {
    return readdirSync(join(ctx.root, "cmd")).sort()[0];
  } catch {
    return undefined;
  }
}

/** The first rule whose dependency, config file or extra check matches, in table order. */
export function detectFramework(ctx: DetectContext): FrameworkRule | undefined {
  for (const rule of FRAMEWORKS) {
    const d = rule.detect;
    if (d.excludeDeps?.some((x) => ctx.deps.has(x))) continue;
    const byDep = d.deps?.some((x) => ctx.deps.has(x)) ?? false;
    const byPy = d.pyDeps?.some((x) => ctx.pyDeps.has(x)) ?? false;
    const byFile = d.files?.some((f) => ctx.has(f)) ?? false;
    const byWhen = d.when?.(ctx) ?? false;
    if (byDep || byPy || byFile || byWhen) return rule;
  }
  return undefined;
}

export function frameworkById(id: string): FrameworkRule | undefined {
  return FRAMEWORKS.find((f) => f.id === id);
}

/** Resolve a rule's dev command for a project: the split argv, `$PORT` still literal. */
export function devArgv(rule: FrameworkRule, ctx: DetectContext): string[] | undefined {
  const cmd = typeof rule.devCommand === "function" ? rule.devCommand(ctx) : rule.devCommand;
  return cmd ? cmd.split(/\s+/) : undefined;
}

/** Is this project a static site under the rule? */
export function isStatic(rule: FrameworkRule, ctx: DetectContext): boolean {
  if (rule.static === "always") return true;
  if (rule.static === "never") return false;
  return rule.static(ctx);
}
