/*
  The ProjectProfile contract, exactly as the architecture document states it
  (section 2). It lives in its own file so the type is importable by the director, the
  MCP server and the tests without dragging in node:fs or child_process.

  Two fields carry the reason this package exists. `start.portFlag` / `start.envPort`
  say how the framework accepts a port, because panoma video never records on a guessed
  port: Vite moves to the next free one silently
  (https://vite.dev/config/server-options), and Coolify — a deployment tool that has
  seen every stack — still asks the user for the port rather than detect it.
  `commands[].source` is literal, panoma's rule (packages/core/src/runbook.ts): an
  invented command that fails in the terminal costs more than an empty list.
*/
import type { FactSheet } from "@panoma/video-core";

export type ProjectKind = "web-app" | "static-site" | "cli" | "library" | "mobile" | "unknown";

export type PackageManager =
  | "npm" | "pnpm" | "yarn" | "bun" | "cargo" | "go" | "pip" | "poetry" | "bundler" | "composer" | "flutter";

/** panoma's RunCommand shape (packages/core/src/runbook.ts, same author, AGPL-3.0). */
export type RunCommand = {
  purpose: "install" | "start" | "tests" | "build";
  command: string;
  /** Where it came from, literally: "package.json#scripts.dev", "Cargo.toml". */
  source: string;
};

export type StartSpec = {
  command: string;
  /** May contain the literal token `$PORT`; `startServer` substitutes it (Vercel's devCommand convention). */
  args: string[];
  cwd: string;
  /** The framework's own flag to force a port ("--port", "-p"), or null when only `envPort` works. */
  portFlag: string | null;
  /** The environment variable the server reads its port from ("PORT"), or null. */
  envPort: string | null;
  /** What "up" means: an HTML answer on GET /, or merely an open socket. */
  readiness: "http" | "tcp";
  source: string;
};

export type Route = { path: string; dynamic: boolean; source: string };

export type ProjectProfile = {
  root: string;
  /** `<slug>-<8 hex of sha256(realpath)>`: stable across renames of the folder's parent, unique across clones. */
  id: string;
  name: string;
  description?: string;
  version?: string;
  kind: ProjectKind;
  framework?: { id: string; name: string; version?: string; source: string };
  packageManager?: PackageManager;
  start?: StartSpec;
  commands: RunCommand[];
  /** Static-first, capped at 20. */
  routes: Route[];
  /** A deployed site, from package.json homepage or the README. */
  url?: string;
  /** README.md, docs/… — shortest first. */
  docs: string[];
  git?: {
    head: string;
    commits: number;
    days: number;
    subjects: string[];
    lastTag?: string;
    tags: { name: string; date: string }[];
  };
  /** Repo-side logo candidates, best first. */
  logoFiles: string[];
  facts: FactSheet;
};
