/*
  What git knows about the project, read once and carried in the profile so the facts
  extractor can stay synchronous and never shells out. Same commands as `panoma-video ideate`
  (apps/cli/src/ideate.ts): the commit count in a window and the last tag are the two
  numbers that hook a release video, and both come from the log rather than a model.

  Tags carry their date because "v1.2.0" alone is a name; "v1.2.0 on 2026-08-30" is a
  fact a changelog video can say. `creatordate` is the tagger date for annotated tags
  and the commit date for lightweight ones, which is the order `git tag --sort` uses.
*/
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ProjectProfile } from "./types.ts";

const run = promisify(execFile);

export type GitInfo = NonNullable<ProjectProfile["git"]>;

/** Last five tags, newest first — a video names one release, and five is enough context for a ticker. */
export const TAG_COUNT = 5;

export async function gitInfo(root: string, days: number): Promise<GitInfo | undefined> {
  const git = (...args: string[]) =>
    run("git", ["-C", root, ...args], { maxBuffer: 4 * 1024 * 1024 }).then((r) => r.stdout.trim());
  let head: string;
  try {
    const inside = await git("rev-parse", "--is-inside-work-tree");
    if (inside !== "true") return undefined;
    head = await git("rev-parse", "HEAD");
  } catch {
    // Not a repository, or a repository with no commits yet: no git facts at all.
    return undefined;
  }
  const subjects = (await git("log", `--since=${days} days ago`, "--pretty=%s").catch(() => ""))
    .split("\n")
    .filter(Boolean);
  const tagLines = await git(
    "for-each-ref", "--sort=-creatordate", `--count=${TAG_COUNT}`,
    "--format=%(refname:short)\t%(creatordate:short)", "refs/tags",
  ).catch(() => "");
  const tags = tagLines
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [name, date] = l.split("\t");
      return { name, date: date ?? "" };
    });
  const lastTag = (await git("describe", "--tags", "--abbrev=0").catch(() => "")) || undefined;
  return { head, commits: subjects.length, days, subjects, lastTag, tags };
}

/*
  How much of an untracked file is read before its size and its clock stand in for it.
  A page or a component is kilobytes; a video somebody dropped in the folder is not
  worth hashing, and its size and mtime already say when it changed.
*/
const UNTRACKED_MAX_BYTES = 1024 * 1024;

/**
 * A fingerprint of what the working tree has that the commit does not.
 *
 * The commit alone is a poor answer to "is this still the same product?": a person
 * editing a component and asking for the video again has not committed anything, and
 * a cache keyed on HEAD would hand back footage of the previous version. So the
 * uncommitted work is hashed too — the status, the diff against HEAD, and the CONTENT
 * of files git only knows the names of. That last part is not a detail: a page written
 * and not yet added is the normal state of new work, and hashing its name alone would
 * cache the first draft of it forever.
 *
 * The whole repository is read, not the project's own subtree: an app that imports a
 * package next door renders differently when that package changes, and a key that
 * missed it would be stale in exactly the case a monorepo makes common. Environment
 * files are the one thing git ignores that the product certainly reads, so `.env*` is
 * STATTED — name, size and clock, never opened; the rule that panoma video does not read a
 * `.env` is older than this function.
 *
 * `undefined` means the tree cannot be fingerprinted: no repository, a repository that
 * ignores this very directory (so its commit describes something else), or a git
 * command that failed. It does NOT mean "unchanged", and the caller must not reuse
 * anything on it.
 *
 * What it still does not see, all of which are the caller's problem to re-shoot for:
 * a submodule's own dirty state beyond "dirty", a file flagged assume-unchanged, and
 * anything the pages read from a database, an API or the clock.
 */
export async function worktreeDigest(root: string): Promise<string | undefined> {
  /* diff.relative is a user setting that would silently narrow the diff to a subdirectory. */
  const git = (...args: string[]) =>
    run("git", ["-C", root, "-c", "diff.relative=false", ...args], { maxBuffer: 64 * 1024 * 1024 }).then((r) => r.stdout);
  try {
    if ((await git("rev-parse", "--is-inside-work-tree")).trim() !== "true") return undefined;
    /* A directory its own repository ignores is not described by that repository's commit. */
    if (await git("check-ignore", "-q", ".").then(() => true).catch(() => false)) return undefined;
    const top = (await git("rev-parse", "--show-toplevel")).trim();
    const [status, diff, others] = await Promise.all([
      /* -uall so a new directory is its files, not one collapsed line that never changes again. */
      git("status", "--porcelain", "-uall"),
      git("diff", "HEAD"),
      git("ls-files", "--others", "--exclude-standard", "-z", "--full-name", "--", ":/"),
    ]);
    const hash = createHash("sha256").update(status).update("\0").update(diff);
    for (const name of others.split("\0").filter(Boolean).sort()) {
      const file = join(top, name);
      hash.update("\0").update(name);
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) continue;
      hash.update(info.size <= UNTRACKED_MAX_BYTES ? await readFile(file) : Buffer.from(`${info.size}:${info.mtimeMs}`));
    }
    for (const name of (await readdir(root).catch(() => [])).filter((n) => n.startsWith(".env")).sort()) {
      const info = await stat(join(root, name)).catch(() => null);
      if (info?.isFile()) hash.update("\0").update(`${name}:${info.size}:${info.mtimeMs}`);
    }
    return hash.digest("hex").slice(0, 16);
  } catch {
    return undefined;
  }
}
