/*
  The ProjectProfile: what a project is, how to start it for a camera, and where its
  screens and documents are — read from files, never guessed, never executed.

  Every command carries the source it was read from, panoma's rule (runbook.ts): a
  plausible command that fails in a terminal costs more time than an empty list. The
  kind rules follow Railpack's Node provider (https://railpack.com/languages/node)
  with two additions the deploy tools do not need — `cli` and `library` — because a
  video about a CLI is a TerminalRun and a video about a library never starts a server.

  The start command runs the framework's own binary through the package manager's
  exec form (`npm exec -- next dev`, `pnpm exec next dev`, `yarn next dev`, `bun x`),
  not the project's `dev` script: a script such as `next dev --turbopack -p 3000`
  cannot be forced onto a free port from outside, and the whole point is the port.
  The script itself is still recorded in `commands` for a human.
*/
import { createHash } from "node:crypto";
import { realpathSync, statSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { isProductDestination } from "@panoma/video-core";
import { factSheet } from "./facts.ts";
import { detectFramework, devArgv, isStatic, type DetectContext, type FrameworkRule } from "./frameworks.ts";
import { exists, isDir, listRoot, readJson, readText, slug, walk } from "./fs.ts";
import { gitInfo } from "./git.ts";
import { parseReadme } from "./markdown.ts";
import { discoverRoutes } from "./routes.ts";
import type { PackageManager, ProjectKind, ProjectProfile, RunCommand, StartSpec } from "./types.ts";

export type PackageJson = {
  name?: string;
  version?: string;
  description?: string;
  homepage?: string;
  bin?: string | Record<string, string>;
  main?: string;
  module?: string;
  exports?: unknown;
  types?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/** `panoma-video ideate`'s default window: a month is the unit people count commits in. */
export const DEFAULT_DAYS = 30;

/** Script names that start something, in the order panoma tries them (runbook.ts). */
const START_SCRIPTS = ["dev", "start", "serve", "develop"];

function pyDepsOf(root: string): Set<string> {
  const out = new Set<string>();
  const req = readText(join(root, "requirements.txt")) ?? "";
  for (const line of req.split("\n")) {
    const m = /^\s*([A-Za-z0-9_.-]+)/.exec(line);
    if (m && !line.trim().startsWith("#") && !line.trim().startsWith("-")) out.add(m[1].toLowerCase().replace(/_/g, "-"));
  }
  const py = (readText(join(root, "pyproject.toml")) ?? "") + (readText(join(root, "Pipfile")) ?? "");
  for (const m of py.matchAll(/^\s*["']?([A-Za-z][A-Za-z0-9_.-]*)["']?\s*(?:[=<>!~\[;,]|$)/gm)) out.add(m[1].toLowerCase().replace(/_/g, "-"));
  return out;
}

export function makeContext(root: string): DetectContext & { pkg?: PackageJson } {
  const pkg = readJson<PackageJson>(join(root, "package.json"));
  const deps = new Set([...Object.keys(pkg?.dependencies ?? {}), ...Object.keys(pkg?.devDependencies ?? {})]);
  return {
    root,
    files: listRoot(root),
    deps,
    pyDeps: pyDepsOf(root),
    pkg,
    has: (rel) => exists(join(root, rel)),
    read: (rel) => readText(join(root, rel)),
  };
}

/** Railpack's order: packageManager field, then lockfiles, then npm. Other ecosystems by their manifest. */
export function packageManagerOf(ctx: DetectContext & { pkg?: PackageJson }): { manager?: PackageManager; source?: string } {
  if (ctx.pkg) {
    const declared = ctx.pkg.packageManager?.split("@")[0];
    if (declared === "npm" || declared === "pnpm" || declared === "yarn" || declared === "bun") return { manager: declared, source: "package.json#packageManager" };
    if (ctx.has("pnpm-lock.yaml")) return { manager: "pnpm", source: "pnpm-lock.yaml" };
    if (ctx.has("bun.lockb") || ctx.has("bun.lock")) return { manager: "bun", source: ctx.has("bun.lock") ? "bun.lock" : "bun.lockb" };
    if (ctx.has(".yarnrc.yml") || ctx.has("yarn.lock")) return { manager: "yarn", source: ctx.has("yarn.lock") ? "yarn.lock" : ".yarnrc.yml" };
    return { manager: "npm", source: ctx.has("package-lock.json") ? "package-lock.json" : "package.json" };
  }
  if (ctx.has("pubspec.yaml")) return { manager: "flutter", source: "pubspec.yaml" };
  if (ctx.has("Cargo.toml")) return { manager: "cargo", source: "Cargo.toml" };
  if (ctx.has("go.mod")) return { manager: "go", source: "go.mod" };
  if (ctx.has("poetry.lock")) return { manager: "poetry", source: "poetry.lock" };
  if (ctx.has("requirements.txt") || ctx.has("pyproject.toml") || ctx.has("Pipfile")) return { manager: "pip", source: ctx.has("requirements.txt") ? "requirements.txt" : "pyproject.toml" };
  if (ctx.has("Gemfile")) return { manager: "bundler", source: "Gemfile" };
  if (ctx.has("composer.json")) return { manager: "composer", source: "composer.json" };
  return {};
}

function commandsOf(ctx: DetectContext & { pkg?: PackageJson }, manager: PackageManager | undefined, managerSource: string | undefined): RunCommand[] {
  const out: RunCommand[] = [];
  const pkg = ctx.pkg;
  if (pkg && manager) {
    out.push({ purpose: "install", command: `${manager} install`, source: managerSource ?? "package.json" });
    const scripts = pkg.scripts ?? {};
    const groups: { names: string[]; purpose: RunCommand["purpose"] }[] = [
      { names: START_SCRIPTS, purpose: "start" },
      { names: ["test", "tests"], purpose: "tests" },
      { names: ["build", "compile"], purpose: "build" },
    ];
    for (const g of groups) {
      const name = g.names.find((n) => scripts[n]);
      if (name) out.push({ purpose: g.purpose, command: `${manager} run ${name}`, source: `package.json#scripts.${name}` });
    }
  }
  if (ctx.has("pubspec.yaml")) {
    const flutter = ctx.has("lib") && /^\s*flutter\s*:/m.test(ctx.read("pubspec.yaml") ?? "");
    out.push({ purpose: "install", command: flutter ? "flutter pub get" : "dart pub get", source: "pubspec.yaml" });
    if (flutter) out.push({ purpose: "start", command: "flutter run", source: "pubspec.yaml" }, { purpose: "tests", command: "flutter test", source: "pubspec.yaml" });
  }
  if (ctx.has("requirements.txt")) out.push({ purpose: "install", command: "pip install -r requirements.txt", source: "requirements.txt" });
  if (ctx.has("pyproject.toml") && ctx.has("poetry.lock")) out.push({ purpose: "install", command: "poetry install", source: "poetry.lock" });
  if (ctx.has("manage.py")) out.push({ purpose: "start", command: "python manage.py runserver", source: "manage.py" }, { purpose: "tests", command: "python manage.py test", source: "manage.py" });
  if (ctx.has("Cargo.toml")) out.push({ purpose: "start", command: "cargo run", source: "Cargo.toml" }, { purpose: "tests", command: "cargo test", source: "Cargo.toml" });
  if (ctx.has("go.mod")) out.push({ purpose: "start", command: "go run .", source: "go.mod" }, { purpose: "tests", command: "go test ./...", source: "go.mod" });
  if (ctx.has("Gemfile")) out.push({ purpose: "install", command: "bundle install", source: "Gemfile" });
  if (ctx.has("composer.json")) out.push({ purpose: "install", command: "composer install", source: "composer.json" });
  const compose = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"].find((f) => ctx.has(f));
  if (compose) out.push({ purpose: "start", command: "docker compose up", source: compose });
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.command) ? false : (seen.add(c.command), true)));
}

const WEB_GO = /net\/http|gin-gonic|labstack\/echo|gofiber|go-chi|gorilla\/mux|ListenAndServe/;
const WEB_RUST = /^\s*(axum|actix-web|rocket|warp|tide|poem|salvo|hyper)\s*=/m;

function kindOf(ctx: DetectContext & { pkg?: PackageJson }, rule: FrameworkRule | undefined): ProjectKind {
  const pkg = ctx.pkg;
  const scripts = pkg?.scripts ?? {};
  const hasStartScript = START_SCRIPTS.some((s) => scripts[s]);
  const expoApp = /"expo"\s*:/.test(ctx.read("app.json") ?? "");
  if (rule?.id === "flutter" || rule?.id === "expo" || expoApp) return "mobile";
  const servesPages = rule !== undefined && rule.devCommand !== null && rule.readiness === "http";
  if (pkg?.bin && !servesPages) return "cli";
  if (rule?.ecosystem === "go") {
    const goFiles = walk(ctx.root, { maxFiles: 300 }).filter((f) => f.endsWith(".go"));
    const web = goFiles.some((f) => WEB_GO.test(ctx.read(f) ?? ""));
    return web ? "web-app" : ctx.has("cmd") || ctx.has("main.go") ? "cli" : "library";
  }
  if (rule?.ecosystem === "rust") {
    const cargo = ctx.read("Cargo.toml") ?? "";
    if (WEB_RUST.test(cargo)) return "web-app";
    return /\[\[bin\]\]/.test(cargo) || ctx.has("src/main.rs") ? "cli" : "library";
  }
  if (rule && isStatic(rule, ctx)) return "static-site";
  if (rule && rule.devCommand !== null) return "web-app";
  if (rule && rule.devCommand === null && (hasStartScript || ctx.has("Procfile"))) return "web-app";
  if (pkg && (pkg.exports !== undefined || pkg.main || pkg.module || pkg.types) && !hasStartScript) return "library";
  if (hasStartScript || /^web:/m.test(ctx.read("Procfile") ?? "")) return "web-app";
  if (ctx.has("pyproject.toml")) return /\[project\.scripts\]/.test(ctx.read("pyproject.toml") ?? "") ? "cli" : "library";
  return "unknown";
}

function execForm(manager: PackageManager | undefined, argv: string[]): [string, string[]] {
  switch (manager) {
    case "pnpm": return ["pnpm", ["exec", ...argv]];
    case "yarn": return ["yarn", argv];
    case "bun": return ["bun", ["x", ...argv]];
    default: return ["npm", ["exec", "--", ...argv]];
  }
}

const PYTHON = process.platform === "win32" ? "python" : "python3";

function startOf(ctx: DetectContext & { pkg?: PackageJson }, rule: FrameworkRule | undefined, manager: PackageManager | undefined, kind: ProjectKind): StartSpec | undefined {
  if (kind === "cli" || kind === "library" || kind === "mobile" || kind === "unknown") return undefined;
  const cwd = ctx.root;
  const argv = rule ? devArgv(rule, ctx) : undefined;
  const withHost = (args: string[]) => (rule?.hostFlag ? [...args, rule.hostFlag, "127.0.0.1"] : args);
  if (rule && argv) {
    const depName = rule.detect.deps?.find((d) => ctx.deps.has(d));
    const source = `${depName ? `package.json#dependencies.${depName}` : rule.detect.files?.find((f) => ctx.has(f)) ?? rule.id} → ${argv.join(" ")}`;
    const base = { cwd, portFlag: rule.portFlag, envPort: rule.envPort, readiness: rule.readiness, source };
    switch (rule.ecosystem) {
      case "node": {
        const [command, args] = execForm(manager, argv);
        return { command, args: withHost(args), ...base };
      }
      case "python":
        return argv[0].endsWith(".py")
          ? { command: PYTHON, args: withHost(argv), ...base }
          : { command: PYTHON, args: withHost(["-m", ...argv]), ...base };
      case "ruby":
        return ctx.has("bin/rails")
          ? { command: "bin/rails", args: withHost(argv.slice(1)), ...base }
          : { command: "bundle", args: withHost(["exec", "rails", ...argv.slice(1)]), ...base };
      default:
        return { command: argv[0], args: withHost(argv.slice(1)), ...base };
    }
  }
  const procfile = /^web:\s*(.+)$/m.exec(ctx.read("Procfile") ?? "")?.[1]?.trim();
  if (procfile && !ctx.pkg) {
    const [command, ...args] = procfile.split(/\s+/);
    return { command, args, cwd, portFlag: null, envPort: "PORT", readiness: rule?.readiness ?? "tcp", source: "Procfile:web" };
  }
  const scripts = ctx.pkg?.scripts ?? {};
  const script = START_SCRIPTS.find((s) => scripts[s]);
  if (script && manager) {
    return { command: manager, args: ["run", script], cwd, portFlag: null, envPort: "PORT", readiness: rule?.readiness ?? "tcp", source: `package.json#scripts.${script}` };
  }
  return undefined;
}

function urlOf(pkg: PackageJson | undefined, readme: string | undefined): { url?: string; source?: string } {
  const home = pkg?.homepage;
  if (home && /^https:\/\//.test(home) && isProductDestination(home)) return { url: home, source: "package.json#homepage" };
  if (!readme) return {};
  const hit = parseReadme(readme).urls.find((u) => isProductDestination(u.text));
  return hit ? { url: hit.text, source: `README.md:${hit.line}` } : {};
}

const DOC_NAMES = ["README.md", "readme.md", "README", "README.rst", "CONTRIBUTING.md", "AGENTS.md", "CLAUDE.md", "GETTING_STARTED.md"];

function docsOf(root: string): string[] {
  const found = DOC_NAMES.filter((f) => exists(join(root, f)));
  if (isDir(join(root, "docs"))) {
    for (const f of walk(join(root, "docs"), { maxDepth: 1, maxFiles: 200 })) if (/\.(md|mdx|rst)$/i.test(f)) found.push(`docs/${f}`);
  }
  const size = (f: string) => {
    try {
      return statSync(join(root, f)).size;
    } catch {
      return Number.MAX_SAFE_INTEGER;
    }
  };
  return found.sort((a, b) => size(a) - size(b) || a.localeCompare(b)).slice(0, 20);
}

const LOGO_DIRS = ["", "public", "static", "assets", "src/assets", "docs", "docs/public", ".github", "images", "img", "media", "art", "brand", "public/images", "public/img"];
const LOGO_NAME = /logo|wordmark|brand|favicon|icon/i;
const LOGO_EXT = /\.(svg|png|webp|jpe?g|ico)$/i;

/** Repo-side logo candidates, best first. The score is a naming heuristic; @panoma/video-brand measures the files. */
export function logoFilesOf(root: string): string[] {
  const scored: { path: string; score: number }[] = [];
  for (const dir of LOGO_DIRS) {
    const abs = dir ? join(root, dir) : root;
    if (!isDir(abs)) continue;
    let names: string[];
    try {
      names = readdirSync(abs);
    } catch {
      continue;
    }
    for (const n of names) {
      if (!LOGO_EXT.test(n) || !LOGO_NAME.test(n)) continue;
      let score = 0;
      if (/logo/i.test(n)) score += 4;
      if (/wordmark/i.test(n)) score += 4;
      if (/brand/i.test(n)) score += 2;
      if (/\.svg$/i.test(n)) score += 3;
      if (/\.png$/i.test(n)) score += 1;
      if (/favicon/i.test(n)) score -= 1;
      if (/dark|light|white|black|mono/i.test(n)) score -= 1;
      if (dir === "public" || dir === "static") score += 1;
      scored.push({ path: dir ? `${dir}/${n}` : n, score });
    }
  }
  return scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).map((s) => s.path).slice(0, 10);
}

function manifestName(ctx: DetectContext & { pkg?: PackageJson }): { name: string; version?: string; description?: string } {
  if (ctx.pkg?.name) return { name: ctx.pkg.name, version: ctx.pkg.version, description: ctx.pkg.description };
  for (const file of ["Cargo.toml", "pyproject.toml"]) {
    const text = ctx.read(file);
    if (!text) continue;
    const block = /\[(?:package|project|tool\.poetry)\]([\s\S]*?)(?:\n\[|$)/.exec(text)?.[1] ?? "";
    const get = (k: string) => new RegExp(`^\\s*${k}\\s*=\\s*["']([^"']+)["']`, "m").exec(block)?.[1];
    const name = get("name");
    if (name) return { name, version: get("version"), description: get("description") };
  }
  const pub = ctx.read("pubspec.yaml");
  const pubName = pub && /^name:\s*(\S+)/m.exec(pub)?.[1];
  if (pubName) return { name: pubName, version: /^version:\s*(\S+)/m.exec(pub)?.[1], description: /^description:\s*(.+)$/m.exec(pub)?.[1]?.trim() };
  return { name: basename(ctx.root) };
}

export async function scoutProject(rootPath: string, opts: { days?: number } = {}): Promise<ProjectProfile> {
  const root = realpathSync(rootPath);
  if (!isDir(root)) throw new Error(`Not a directory: ${root}`);
  const days = opts.days ?? DEFAULT_DAYS;
  const ctx = makeContext(root);
  const rule = detectFramework(ctx);
  const { manager, source: managerSource } = packageManagerOf(ctx);
  const kind = kindOf(ctx, rule);
  const { name, version, description } = manifestName(ctx);
  const id = `${slug(name)}-${createHash("sha256").update(root).digest("hex").slice(0, 8)}`;

  let framework: ProjectProfile["framework"];
  if (rule) {
    const depName = rule.detect.deps?.find((d) => ctx.deps.has(d));
    const pyName = rule.detect.pyDeps?.find((d) => ctx.pyDeps.has(d));
    const file = rule.detect.files?.find((f) => ctx.has(f));
    const raw = depName ? (ctx.pkg?.dependencies?.[depName] ?? ctx.pkg?.devDependencies?.[depName]) : undefined;
    // A config file is the more literal witness (manage.py IS Django); a dependency line is the fallback.
    const source = depName
      ? `package.json#${ctx.pkg?.dependencies?.[depName] ? "dependencies" : "devDependencies"}.${depName}`
      : file ?? (pyName ? (ctx.has("requirements.txt") ? `requirements.txt:${pyName}` : `pyproject.toml:${pyName}`) : rule.id);
    framework = { id: rule.id, name: rule.name, version: raw?.replace(/^[\^~>=<\s]+/, ""), source };
  }

  const routes = discoverRoutes(root, rule?.id);
  if (routes.length === 0 && (kind === "web-app" || kind === "static-site")) routes.push({ path: "/", dynamic: false, source: `${kind}: the root document` });

  const readme = readText(join(root, "README.md")) ?? readText(join(root, "readme.md"));
  const git = await gitInfo(root, days);
  const partial: Omit<ProjectProfile, "facts"> = {
    root,
    id,
    name,
    description,
    version,
    kind,
    framework,
    packageManager: manager,
    start: startOf(ctx, rule, manager, kind),
    commands: commandsOf(ctx, manager, managerSource),
    routes,
    url: urlOf(ctx.pkg, readme).url,
    docs: docsOf(root),
    git,
    logoFiles: logoFilesOf(root),
  };
  return { ...partial, facts: factSheet(root, partial) };
}

export { urlOf };
