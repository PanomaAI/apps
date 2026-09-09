/*
  Small, bounded filesystem helpers shared by every scout module.

  Two failures they prevent. First, a scout that walks an unbounded tree: a project
  with node_modules, a .next cache or a media directory has hundreds of thousands of
  files, and "understand the project" must not take a minute or run out of memory.
  `walk` skips the known heavy directories and stops at a hard file budget. Second,
  a scout that reads a secret by accident: every reader here refuses any file whose
  basename starts with ".env" — the architecture says "never read .env" and this is
  the one place that rule is enforced, so no caller can forget it.
*/
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

/** Directories that are never part of "the project": caches, dependencies, output. */
export const SKIP_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", ".next", ".nuxt", ".output",
  ".svelte-kit", ".astro", ".cache", ".turbo", ".vercel", ".netlify", "coverage", "target",
  "vendor", "media", "__pycache__", ".venv", "venv", ".tox", ".mypy_cache", ".pytest_cache",
  "Pods", ".dart_tool", ".gradle", ".idea", ".vscode", "tmp", "temp", ".panoma", ".vira",
]);

/** The rule from the architecture: `.env`, `.env.local`, `.env.production` — none of them, ever. */
export function isEnvFile(path: string): boolean {
  return basename(path).startsWith(".env");
}

export function exists(path: string): boolean {
  return existsSync(path);
}

export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Text of a file, or undefined when it is missing, unreadable, or an env file. */
export function readText(path: string): string | undefined {
  if (isEnvFile(path)) return undefined;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Parsed JSON, or undefined on a missing or malformed file — a broken package.json is not a crash. */
export function readJson<T>(path: string): T | undefined {
  const text = readText(path);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** The first existing path among candidates relative to root, as given (relative). */
export function firstExisting(root: string, candidates: readonly string[]): string | undefined {
  return candidates.find((c) => existsSync(join(root, c)));
}

/** Root-level entry names — the cheap "is there a X here" set most rules need. */
export function listRoot(root: string): Set<string> {
  try {
    return new Set(readdirSync(root));
  } catch {
    return new Set();
  }
}

export type WalkOptions = {
  /** Stop after this many files; the default is generous for source trees and hostile to caches. */
  maxFiles?: number;
  /** Maximum directory depth below root (root itself is 0). */
  maxDepth?: number;
  /** Extra directory names to skip, on top of SKIP_DIRS. */
  skip?: readonly string[];
};

/**
 * Relative paths (POSIX separators) of every regular file under root, depth-first,
 * sorted for determinism. Env files are excluded here too, so a caller that greps the
 * tree for TODOs cannot quote a secret.
 */
export function walk(root: string, opts: WalkOptions = {}): string[] {
  const maxFiles = opts.maxFiles ?? 4000;
  const maxDepth = opts.maxDepth ?? 12;
  const skip = new Set([...SKIP_DIRS, ...(opts.skip ?? [])]);
  const out: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (out.length >= maxFiles || depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      if (out.length >= maxFiles) return;
      const full = join(dir, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (!skip.has(name)) visit(full, depth + 1);
      } else if (stat.isFile() && !isEnvFile(name)) {
        out.push(relative(root, full).split("\\").join("/"));
      }
    }
  };
  visit(root, 0);
  return out;
}

/** "Acme Web!" → "acme-web". Used for ids, so it must be stable and URL-safe. */
export function slug(s: string): string {
  return s.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
}
