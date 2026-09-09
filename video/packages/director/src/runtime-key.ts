/* Runtime identity shared by automatic renders and Studio exports. */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

export async function engineRuntimeKey(): Promise<string> {
  try {
    const release = JSON.parse(await readFile(new URL("./runtime.json", import.meta.url), "utf8")) as { version: string; digest: string };
    if (/^[a-f0-9]{64}$/.test(release.digest)) return `${release.version}+${release.digest}`;
  } catch { /* Development runs use the actual source tree below. */ }
  try {
    const root = fileURLToPath(new URL("../../..", import.meta.url));
    const { stdout } = await run("git", ["-C", root, "rev-parse", "--short", "HEAD"]);
    /* Only runtime inputs invalidate a render. A documentation edit should not
       encode three videos again, while an untracked recipe must. Git's diff omits
       untracked files, so their bytes are folded in explicitly. */
    const runtime = ["apps", "packages", "briefs", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"];
    /* A vendored font or an image in the working tree overflows the default 1 MiB buffer, and the digest then reports "unknown" for every edit that follows. */
    const big = { maxBuffer: 256 * 1024 * 1024 };
    const [{ stdout: diff }, { stdout: untracked }] = await Promise.all([
      run("git", ["-C", root, "diff", "--binary", "--no-ext-diff", "HEAD", "--", ...runtime], big),
      run("git", ["-C", root, "ls-files", "--others", "--exclude-standard", "--", ...runtime], big),
    ]);
    if (!diff && !untracked.trim()) return stdout.trim();
    const digest = createHash("sha256").update(diff);
    for (const relative of untracked.trim().split("\n").filter(Boolean).sort()) {
      digest.update(relative).update(await readFile(join(root, relative)));
    }
    return `${stdout.trim()}+${digest.digest("hex").slice(0, 8)}`;
  } catch {
    /* A key nobody can reproduce is safer than a stable one: this reuses nothing, where "unknown" served yesterday's film for today's code. */
    return randomUUID();
  }
}
