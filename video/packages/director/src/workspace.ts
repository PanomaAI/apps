/*
  Where panoma video keeps what it makes for OTHER projects.

  Nothing is ever written inside the user's project: a video tool that leaves takes,
  voice files and renders in someone's repository is a tool people uninstall. So a
  project gets a directory under PANOMA_VIDEO_HOME (default ~/.panoma/video), named by its folder and
  a hash of its real path, and every stage of the automatic path reads and writes
  there. The layout is flat and boring on purpose — an agent can list it, a person
  can delete it, and panoma can index it later.

  A project that moves gets a new hash and a fresh directory; `profile.json` records
  the root it was made for, so a stale workspace is recognisable rather than reused.
  panoma, which has its own project ids, can pass one in and override the derived
  name.
*/
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/*
  Where the engine keeps its work, and why there are two answers.

  It was `~/.vira` until the engine was renamed on 7-Sep-2026, and by then a disk could
  already hold thirty project workspaces and a hundred exports under that name. A default
  that simply moved would have pointed the tool at an empty directory and said nothing —
  the worst kind of failure, because everything keeps working and the past disappears.

  So the new home wins, the old one is honoured while it is the only one that exists, and
  neither is created merely to answer this question. Set `PANOMA_VIDEO_HOME` to end the
  ambiguity, which is what a machine carrying both should do.

  This is the only place that decides. Two other files used to compute it themselves —
  the runtime clone in `@panoma/video-scout` and the `elements` command in the CLI — and
  the second one read no environment variable at all, so `PANOMA_VIDEO_HOME` moved eight
  directories and silently not the ninth. They ask here now.
*/
export function videoHome(): string {
  if (process.env.PANOMA_VIDEO_HOME) return resolve(process.env.PANOMA_VIDEO_HOME);
  const home = resolve(homedir(), ".panoma", "video");
  if (existsSync(home)) return home;
  const legacy = resolve(homedir(), ".vira");
  return existsSync(legacy) ? legacy : home;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";

/** `<folder-slug>-<8 hex of sha256(realpath)>`, unless the caller brings its own id. */
export function projectIdFor(root: string, override?: string): string {
  if (override) return slug(override);
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 8);
  return `${slug(basename(root))}-${hash}`;
}

export type Workspace = {
  readonly id: string;
  readonly root: string;
  readonly dir: string;
  readonly paths: {
    readonly profile: string;
    readonly facts: string;
    readonly brand: string;
    readonly tours: string;
    readonly sessions: string;
    readonly briefs: string;
    readonly generated: string;
    readonly sfx: string;
    readonly music: string;
    readonly renders: string;
    readonly kits: string;
    readonly cache: string;
    readonly serverLog: string;
    readonly auto: string;
    /** What the brain decided about this project, and the log of every question it was asked. */
    readonly brain: string;
    readonly brainLog: string;
    /** The film's direction as it was decided — the arithmetic proposal, what was chosen, and by whom. */
    readonly direction: string;
  };
};

/*
  A path-boundary test, not a string-prefix one: `/tmp/app-out` merely begins with the
  letters of `/tmp/app` and is a different directory, so the question is asked of the
  relative path between them. `..` alone, a `..` first segment, and an absolute answer
  (which is what `relative` returns across Windows drives) all mean "outside"; the empty
  string means the two are the same directory, which counts as inside. The separator
  comes from `path` rather than from a `process.platform` test, because `..\` and `../`
  are different strings and this repository has been bitten by writing one of them out.
*/
export const inside = (root: string, child: string) => {
  const p = relative(root, child);
  return !p || (p !== ".." && !p.startsWith(`..${sep}`) && !isAbsolute(p));
};

/*
  Where a path would really be, without creating it. The output directory usually does
  not exist on a first run, and `realpath` refuses to answer about a directory that is
  not there — so walk up to the nearest ancestor that does exist, resolve that, and put
  the missing tail back on. Finding out where the output would land must never be the
  thing that puts a directory inside the filmed project.
*/
async function realDestination(value: string): Promise<string> {
  try { return await realpath(value); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(value) === value) throw error;
    return join(await realDestination(dirname(value)), relative(dirname(value), value));
  }
}

export async function openWorkspace(projectRoot: string, opts: { id?: string; home?: string } = {}): Promise<Workspace> {
  const root = await realpath(projectRoot);
  const id = projectIdFor(root, opts.id);
  const home = resolve(opts.home ?? videoHome());
  const dir = join(home, "projects", id);
  /*
    The header's promise, enforced.

    The header above has always said that nothing is written inside the user's project,
    but nothing here ever checked it: the only check lived in the request validator the
    browser Studio called, so `PANOMA_VIDEO_HOME=./out` put takes, voice files and renders
    straight into the repository being filmed. The Studio is gone, and the promise
    outlives it — so the check belongs at the one door every workspace comes through,
    before the first `mkdir`.

    Both the home and the project directory are asked, and both through their real
    paths: a symlink is a way into the project that the names do not show, and a
    symlinked `projects` would put the directory inside while the home still looked
    clean.
  */
  for (const candidate of [home, dir]) {
    if (inside(root, await realDestination(candidate))) {
      throw new Error(`The output directory (${candidate}) is inside the project being filmed (${root}). Takes, voice files and renders are never written into a filmed project: set PANOMA_VIDEO_HOME to a directory outside it.`);
    }
  }
  const paths = {
    profile: join(dir, "profile.json"),
    facts: join(dir, "facts.json"),
    brand: join(dir, "brand.json"),
    tours: join(dir, "tours"),
    sessions: join(dir, "sessions"),
    briefs: join(dir, "briefs"),
    generated: join(dir, "generated"),
    sfx: join(dir, "sfx"),
    music: join(dir, "music"),
    renders: join(dir, "renders"),
    kits: join(dir, "kits"),
    cache: join(home, "cache"),
    serverLog: join(dir, "server.log"),
    auto: join(dir, "auto.json"),
    brain: join(dir, "brain.json"),
    brainLog: join(dir, "brain.log.jsonl"),
    direction: join(dir, "direction.json"),
  };
  for (const p of [paths.tours, paths.sessions, paths.briefs, paths.generated, paths.sfx, paths.music, paths.renders, paths.kits, paths.cache]) {
    await mkdir(p, { recursive: true });
  }
  return { id, root, dir, paths };
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}

/** Files under a directory with a suffix, sorted, absolute. */
export async function listFiles(dir: string, suffix: string): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.filter((n) => n.endsWith(suffix)).sort().map((n) => join(dir, n));
}

/** A stable hash of any JSON-serialisable inputs — the key every cached stage uses. */
export function inputHash(...parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}
