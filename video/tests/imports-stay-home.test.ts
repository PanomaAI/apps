/*
  Every bare import in this repository must resolve inside this repository.

  On 7-Sep-2026 the first CI run this project ever had failed on all six machines at
  once, and what it found was not a bug in any of them. Three test files import `zod`,
  and the root manifest did not declare it: the three packages that use it do. On a
  clean clone that is unresolvable, and the whole suite dies on the first import.

  It had never been noticed because of where it resolved instead. Node walks up from
  the importing file looking for `node_modules`, and it does not stop at the project —
  it stops at the filesystem root. On the machine this was written on there is a stray
  `node_modules` in the user's home directory, four levels above the repository, and it
  contains a `zod`. So `tests/brain.test.ts` was importing a package belonging to no
  project, and eight hundred tests passed on the strength of it.

  That failure mode is invisible by construction: it looks like everything works, it
  cannot be reproduced anywhere else, and the error it finally produces names a module
  rather than the reason. This test makes it visible on the machine where it is
  cheapest to fix. It resolves the way Node does — walking up for
  `node_modules/<package>/package.json` — and fails on the first specifier whose answer
  lies outside these four walls.
*/
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Directories that hold code we wrote. `node_modules` is what we are checking against. */
const SOURCES = ["tests", "packages", "apps", "briefs"];
const SKIP_DIRS = new Set(["node_modules", ".git", "fixtures", "dist", ".playwright"]);
const CODE = /\.(ts|tsx|mts|cts)$/;

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (CODE.test(entry.name)) yield full;
  }
}

/*
  Comments go first, and that is not fastidiousness: the first version of this sweep
  reported `"A minor"` as an unresolvable package, because `packages/audio/src/bed.ts`
  explains in prose that a bed is transposed *from "A minor"*. A guard that cries about
  prose is a guard people switch off.
*/
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1 ");

/*
  Only real module specifiers: a static `import`/`export … from`, a dynamic `import()`,
  a `require()`, and the `createRequire(...)` form this repository uses to keep a package
  out of a bundle. Everything relative or built in is dropped — a relative path cannot
  leave the repository, and `node:` never resolves to a directory at all.
*/
const SPECIFIER = /(?:^|\n)\s*(?:import|export)\b[^;\n]*?\bfrom\s*["']([^"'\n]+)["']|(?:^|\n)\s*import\s+["']([^"'\n]+)["']|\bimport\s*\(\s*["']([^"'\n]+)["']|\brequire\s*\(\s*["']([^"'\n]+)["']/g;

/*
  A file may anchor its own resolution deliberately, and several here do:

      const require = createRequire(new URL("../packages/engine/package.json", import.meta.url));
      const { createElement } = require("react");

  That is correct code, not an oversight — `react` belongs to the engine and not to the
  root, and the test says so instead of hoping. The first version of this sweep called it
  an unresolvable import, which would have taught the next reader to delete the anchor and
  break the test on a clean clone. So the anchors are read too, and a `require` in a file
  that declares one is resolved from there.
*/
const ANCHOR = /createRequire\(\s*new URL\(\s*["']([^"'\n]+)["']\s*,\s*import\.meta\.url\s*\)/g;

function anchorsOf(source: string, fileDir: string): string[] {
  return [...stripComments(source).matchAll(ANCHOR)].map((m) => dirname(resolve(fileDir, m[1]!)));
}

function bareSpecifiers(source: string): string[] {
  const out = new Set<string>();
  for (const match of stripComments(source).matchAll(SPECIFIER)) {
    const spec = match[1] ?? match[2] ?? match[3] ?? match[4]!;
    if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) continue;
    /* `@scope/name/sub` → `@scope/name`; `name/sub` → `name`. */
    const parts = spec.split("/");
    out.add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!);
  }
  return [...out];
}

/** Node's own algorithm, stopped at nothing — which is the point. */
function packageDir(fromDir: string, name: string): string | undefined {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dirname(dir) === dir) return undefined;
  }
}

const inside = (path: string) => {
  const r = relative(ROOT, path);
  return r !== "" && !r.startsWith("..") && !r.startsWith(`..${sep}`);
};

test("every bare import resolves inside this repository", () => {
  const escaped: string[] = [];
  const missing: string[] = [];
  let checked = 0;

  for (const dir of SOURCES) {
    const base = join(ROOT, dir);
    if (!existsSync(base) || !statSync(base).isDirectory()) continue;
    for (const file of files(base)) {
      const source = readFileSync(file, "utf8");
      const bases = [dirname(file), ...anchorsOf(source, dirname(file))];
      for (const name of bareSpecifiers(source)) {
        checked++;
        const found = bases.map((base) => packageDir(base, name)).find(Boolean);
        const where = relative(ROOT, file);
        if (!found) missing.push(`${where}: "${name}" resolves nowhere`);
        else if (!inside(found)) escaped.push(`${where}: "${name}" resolves to ${found}`);
      }
    }
  }

  assert.ok(checked > 100, `the sweep found ${checked} imports, which is too few to have worked`);
  assert.deepEqual(missing, [], "an import resolves to nothing; a clean clone cannot run this");
  assert.deepEqual(
    escaped,
    [],
    "an import resolves outside the repository, so it works here and nowhere else; declare it in the manifest of whoever imports it",
  );
});
