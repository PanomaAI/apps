/*
  Development servers write: .next, .vite, generated types, caches and lock files.
  The camera gives them a disposable copy, including already installed dependencies,
  rather than a writable view of the product checkout. Copy-on-write clones are safe;
  hard links and links back into that checkout are not.
*/
import { constants } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ProjectProfile } from "./types.ts";

const PRIVATE_NAMES = new Set([".npmrc", ".yarnrc", ".yarnrc.yml", ".pypirc", ".netrc", ".git-credentials", ".ssh", ".aws", ".azure", ".gcloud", ".config", ".codex", ".claude", ".panoma", ".vira", ".wrangler"]);
const CACHE_NAMES = new Set([".git", ".hg", ".svn", ".next", ".nuxt", ".output", ".svelte-kit", ".astro", ".vite", ".cache", ".turbo", "coverage", "__pycache__", ".pytest_cache", ".mypy_cache"]);
const privateName = (name: string): boolean => {
  const lower = name.toLowerCase();
  return lower.startsWith(".env") || lower.startsWith(".dev.vars") || PRIVATE_NAMES.has(lower) || /\.(pem|key|p12|pfx|keystore)$/.test(lower) || /^(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.|$)/.test(lower) || /^(credentials|service[-_]?account|secrets?)(?:[-_.].*)?\.(json|ya?ml|toml|ini|txt)$/.test(lower);
};
const inside = (root: string, file: string): boolean => { const rel = relative(root, file); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)); };
const excluded = (root: string, file: string): boolean => relative(root, file).split(sep).some((part) => privateName(part) || CACHE_NAMES.has(part));

async function exists(file: string): Promise<boolean> { try { await lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }

/** Resolve existing parents too: a symlinked output base cannot turn into source writes. */
async function physicalPath(file: string): Promise<string> {
  try { return await realpath(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(file) === file) throw error;
    return join(await physicalPath(dirname(file)), basename(file));
  }
}

const glob = (pattern: string, path: string): boolean => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*").replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}/?$`).test(path);
};

/* Only a declared workspace membership widens the copy; a fixture merely nested
   inside panoma video's own checkout is not a member of its pnpm workspace. */
async function copyRoot(project: string): Promise<string> {
  for (let parent = dirname(project); parent !== dirname(parent) && parent !== homedir(); parent = dirname(parent)) {
    let patterns: string[] = [];
    const manifest = join(parent, "package.json");
    if (await exists(manifest) && !(await lstat(manifest)).isSymbolicLink()) {
      const pkg = JSON.parse(await readFile(manifest, "utf8")) as { workspaces?: string[] | { packages?: string[] } };
      patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages ?? [];
    }
    const pnpm = join(parent, "pnpm-workspace.yaml");
    if (await exists(pnpm) && !(await lstat(pnpm)).isSymbolicLink()) {
      const text = await readFile(pnpm, "utf8");
      const section = text.match(/^packages:\s*\n((?:[ \t].*\n?|\s*\n)*)/m)?.[1] ?? "";
      patterns.push(...[...section.matchAll(/^\s*-\s*["']?([^"'\r\n#]+?)["']?\s*(?:#.*)?$/gm)].map((match) => match[1].trim()));
    }
    const path = relative(parent, project).split(sep).join("/");
    if (patterns.some((pattern) => !pattern.startsWith("!") && glob(pattern, path)) && !patterns.some((pattern) => pattern.startsWith("!") && glob(pattern.slice(1), path))) return parent;
    if (await exists(join(parent, ".git"))) break;
  }
  return project;
}

export type PreparedRuntime = {
  dir: string;
  root: string;
  cwd: string;
  sourceRoot: string;
  env: Record<string, string>;
  mapPath(file: string): string;
  cleanup(): Promise<void>;
};

export async function prepareRuntime(profile: ProjectProfile, options: { baseDir?: string } = {}): Promise<PreparedRuntime> {
  const project = await realpath(profile.root);
  const sourceRoot = await copyRoot(project);
  const sourceCwd = await realpath(profile.start?.cwd ?? project);
  if (!inside(sourceRoot, sourceCwd)) throw new Error("The start directory is outside the product workspace. Supply a running --url instead.");
  /*
    The caller supplies this. Scout used to derive it from the environment, which meant a
    second opinion about where the engine's home is — and the two could disagree, because
    `videoHome()` in the director now prefers a new path and honours an older one. A
    package that walks somebody else's project has no business knowing where our output
    goes; whoever opened the workspace already does.
  */
  if (!options.baseDir) throw new Error("prepareRuntime needs a baseDir: the caller owns the engine's home, not the scout.");
  const baseDir = await physicalPath(resolve(options.baseDir));
  if (inside(sourceRoot, baseDir)) throw new Error("The camera runtime must be outside the product workspace; choose a PANOMA_VIDEO_HOME outside it.");
  await mkdir(baseDir, { recursive: true });
  const dir = await mkdtemp(join(baseDir, `${profile.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-`));
  const root = join(dir, "project");
  const links: { source: string; target: string }[] = [];
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    await cp(sourceRoot, root, { recursive: true, mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true,
      filter: async (source) => {
        if (excluded(sourceRoot, source)) return false;
        const stat = await lstat(source);
        if (stat.isSymbolicLink()) {
          const raw = await readlink(source);
          const target = await physicalPath(resolve(dirname(source), raw));
          if (!inside(sourceRoot, target) || excluded(sourceRoot, target)) throw new Error(`Cannot isolate the linked file ${relative(sourceRoot, source)} without accessing material outside the runtime. Install dependencies within the workspace yourself, or supply a running --url instead.`);
          links.push({ source, target });
        } else if (!stat.isDirectory() && !stat.isFile()) throw new Error(`Cannot copy the special file ${relative(sourceRoot, source)} into a camera runtime. Supply a running --url instead.`);
        return true;
      },
    });
    for (const { source, target } of links) {
      const destination = join(root, relative(sourceRoot, source));
      const next = join(root, relative(sourceRoot, target));
      await rm(destination);
      await symlink(relative(dirname(destination), next), destination);
    }
    /* A chain of internal links must resolve within the copy too. Missing targets
       are refused before a package manager could try to install their substitute. */
    for (const { source } of links) {
      const destination = join(root, relative(sourceRoot, source));
      const target = await realpath(destination).catch(() => undefined);
      if (!target || !inside(root, target)) throw new Error(`The runtime link ${relative(sourceRoot, source)} has no isolated target. Install complete local dependencies yourself, or supply a running --url instead.`);
    }
    const home = join(dir, "home"), cache = join(dir, "cache"), temp = join(dir, "tmp");
    await Promise.all([home, cache, temp].map((path) => mkdir(path)));
    const env: Record<string, string> = {};
    for (const name of ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"]) if (process.env[name]) env[name] = process.env[name]!;
    if (env.PATH) env.PATH = env.PATH.split(process.platform === "win32" ? ";" : ":").map((entry) => isAbsolute(entry) && inside(sourceRoot, entry) ? join(root, relative(sourceRoot, entry)) : entry).join(process.platform === "win32" ? ";" : ":");
    Object.assign(env, { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: cache, XDG_DATA_HOME: join(home, ".local", "share"), TMPDIR: temp, TMP: temp, TEMP: temp,
      npm_config_cache: join(cache, "npm"), npm_config_userconfig: join(home, ".npmrc"), npm_config_offline: "true", npm_config_yes: "false", COREPACK_ENABLE_NETWORK: "0", NEXT_TELEMETRY_DISABLED: "1", ASTRO_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" });
    return { dir, root, sourceRoot, cwd: join(root, relative(sourceRoot, sourceCwd)), env, cleanup,
      mapPath: (file) => isAbsolute(file) && inside(sourceRoot, file) ? join(root, relative(sourceRoot, file)) : file };
  } catch (error) { await cleanup(); throw error; }
}
