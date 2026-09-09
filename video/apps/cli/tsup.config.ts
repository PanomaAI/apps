import { defineConfig } from "tsup";
import { cp, mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";

/* Workspace code and JSX compile together; only registry dependencies remain external. */
export default defineConfig({
  entry: { "panoma-video": "apps/cli/src/panoma-video.ts", mcp: "apps/cli/src/mcp.ts" },
  format: ["esm"], target: "node22", platform: "node", outDir: "dist", clean: true,
  metafile: true, splitting: true, sourcemap: false, noExternal: [/^@panoma\//],
  external: ["playwright", "react", "react-dom", "@modelcontextprotocol/sdk", "zod", "zod-to-json-schema"],
  esbuildPlugins: [{ name: "release-only-boundaries", setup(build) {
    build.onResolve({ filter: /^@panoma\/video-engine\/register$/ }, () => ({ path: "register", namespace: "release" }));
    build.onResolve({ filter: /^@panoma\/video-briefs(?:\/sessions)?$/ }, args => ({ path: args.path, namespace: "release" }));
    build.onLoad({ filter: /.*/, namespace: "release" }, args => ({ contents: args.path === "register" ? "export {};" : "export const briefs = []; export const sessions = [];", loader: "js" }));
  } }],
  async onSuccess() {
    await mkdir("assets", { recursive: true });
    await cp("packages/engine/assets/fonts", "assets/fonts", { recursive: true });
    const meta = JSON.parse(await readFile("dist/metafile-esm.json", "utf8")) as { outputs: Record<string, { imports: { external?: boolean; path: string }[] }> };
    const imports = [...new Set(Object.values(meta.outputs).flatMap(output => output.imports.filter(row => row.external).map(row => row.path)))].sort();
    await rm("dist/metafile-esm.json");
    const hash = createHash("sha256");
    for (const name of (await readdir("dist")).sort()) if (name.endsWith(".js")) hash.update(name).update(await readFile(resolve("dist", name)));
    for (const name of (await readdir("assets/fonts")).sort()) hash.update(name).update(await readFile(resolve("assets/fonts", name)));
    const pkg = JSON.parse(await readFile("package.json", "utf8")) as { version: string; dependencies: Record<string, string> };
    hash.update(JSON.stringify(pkg.dependencies));
    /*
      `digest` is computed over dist's own bytes, so it can never notice that the sources moved
      underneath it. These three can: they say which checkout produced this build. Without them
      `npm publish` uploads whatever sits in dist that day, which is how a tarball ends up carrying
      code that is in no commit. The catalog learned it first — apps/cli/scripts/pack-app.mjs.
     */
    const git = (...args: string[]) => { try { return execFileSync("git", args, { encoding: "utf8" }).trim(); } catch { return undefined; } };
    const status = git("status", "--porcelain");
    await writeFile("dist/runtime.json", JSON.stringify({
      version: pkg.version,
      digest: hash.digest("hex"),
      commit: git("rev-parse", "HEAD"),
      lockfile: createHash("sha256").update(await readFile("pnpm-lock.yaml")).digest("hex"),
      cleanTree: status === undefined ? undefined : status === "",
      imports,
    }) + "\n");
  },
});
