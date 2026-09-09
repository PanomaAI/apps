/*
  The rule this project was rebuilt to satisfy: nothing non-free in the tree, ever.
  The sweep reads every installed package in the pnpm store — transitive included —
  and fails on any license outside the free allowlist. Remotion entered this project
  once ("SEE LICENSE IN LICENSE.md", free only below 3 employees); removing it cost a
  day of engine work, and this test is why that day never repeats.
*/
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const FREE = new Set([
  "MIT",
  "ISC",
  "Apache-2.0",
  "Zlib",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "MPL-2.0",
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "CC-BY-4.0",
  /* Asset licences: type and media, which no package manifest ever reports. */
  "OFL-1.1",
  "CC-BY-SA-4.0",
  "Unlicense",
  "Python-2.0",
  "AGPL-3.0-only",
  "(MIT OR CC0-1.0)",
  "(MIT AND Zlib)",
  "Apache-2.0 AND MIT",
]);

function licenseOf(pkgJsonPath: string): { name: string; license: string } {
  const d = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  const raw = d.license ?? d.licenses;
  const license =
    typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((l) => l?.type).join(" OR ") : (raw?.type ?? "MISSING");
  return { name: `${d.name}@${d.version}`, license };
}

test("every installed package, transitive included, carries a free license", () => {
  const store = join(ROOT, "node_modules", ".pnpm");
  const offenders: string[] = [];
  for (const entry of readdirSync(store)) {
    const dir = join(store, entry, "node_modules");
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const subdirs = name.startsWith("@") ? readdirSync(join(dir, name)).map((s) => join(name, s)) : [name];
      for (const sub of subdirs) {
        let info;
        try {
          info = licenseOf(join(dir, sub, "package.json"));
        } catch {
          continue;
        }
        if (!FREE.has(info.license)) offenders.push(`${info.name}: ${info.license}`);
      }
    }
  }
  assert.deepEqual(
    [...new Set(offenders)].sort(),
    [],
    "Non-free (or unrecognized) licenses in the tree. Replace the dependency or, if the license IS free, add its exact SPDX id to the allowlist with a comment.",
  );
});

/*
  Assets are the half a package sweep cannot see. A vendored font, sample or
  texture carries its own licence, often in a file the package manifest never
  mentions — commit-mono ships OFL type under an MIT repo, uisfx ships CC0 audio
  under MIT code — so a check that reads only manifests records those wrongly.
  Every binary we vendor must name itself in a CREDITS.json beside it, with a
  licence from the allowlist and a licence file that exists.
*/
const ASSET_DIRS = ["packages/engine/assets/fonts", "apps/render/public/demo"];
const ASSET_EXTENSIONS = [".ttf", ".otf", ".woff", ".woff2", ".wav", ".mp3", ".png", ".jpg", ".svg"];

test("every vendored asset is credited, with a free licence and a licence file", () => {
  for (const dir of ASSET_DIRS) {
    const full = join(ROOT, dir);
    const creditsPath = join(full, "CREDITS.json");
    const credits = JSON.parse(readFileSync(creditsPath, "utf8")) as {
      file: string;
      title: string;
      author: string;
      source: string;
      license: string;
      licenseFile: string;
    }[];

    const credited = new Map(credits.map((c) => [c.file, c]));
    const present = readdirSync(full).filter((f) => ASSET_EXTENSIONS.some((e) => f.endsWith(e)));

    for (const file of present) {
      const entry = credited.get(file);
      assert.ok(entry, `${dir}/${file} is vendored but not in CREDITS.json`);
      assert.ok(FREE.has(entry.license), `${dir}/${file}: licence "${entry.license}" is not on the allowlist`);
      for (const field of ["title", "author", "source", "licenseFile"] as const) {
        assert.ok(entry[field], `${dir}/${file}: CREDITS.json entry has no ${field}`);
      }
      assert.ok(
        existsSync(join(full, entry.licenseFile)),
        `${dir}/${file}: names ${entry.licenseFile}, which is not there`,
      );
    }

    for (const entry of credits) {
      assert.ok(present.includes(entry.file), `CREDITS.json credits ${entry.file}, which is not in ${dir}`);
    }
  }
});

test("no package.json declares a dependency on remotion", () => {
  const manifests = ["package.json", "briefs/package.json"];
  for (const scope of ["apps", "packages"]) {
    /*
      Directories only. This read used to be a bare `readdirSync`, and the day Finder left a
      `.DS_Store` in `apps/` the sweep died on `apps/.DS_Store/package.json` with ENOTDIR —
      before it had read one manifest. A guard that crashes is a guard that is not watching,
      and this one is the reason Remotion cannot come back.
     */
    for (const entry of readdirSync(join(ROOT, scope), { withFileTypes: true })) {
      if (entry.isDirectory()) manifests.push(join(scope, entry.name, "package.json"));
    }
  }
  for (const manifest of manifests) {
    const d = JSON.parse(readFileSync(join(ROOT, manifest), "utf8"));
    const deps = Object.keys({ ...d.dependencies, ...d.devDependencies });
    const remotion = deps.filter((n) => n === "remotion" || n.startsWith("@remotion/"));
    assert.deepEqual(remotion, [], `${manifest} depends on Remotion, which is source-available, not free.`);
  }
});

/*
  The guard above sweeps what was installed. This one sweeps what this repository itself
  declares, which nobody was checking: the root said AGPL-3.0-only and all fifteen members
  said nothing at all. Private packages are not published, so npm never asked — but the
  engine is about to be folded into another product, and a manifest with no licence is the
  kind of blank that gets filled in by whoever notices it last.
*/
test("every workspace manifest declares the same free licence as the root", () => {
  const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.ok(FREE.has(root.license), `the root declares ${root.license}, which is not in the free allowlist`);

  const members = ["briefs/package.json"];
  for (const scope of ["apps", "packages"]) {
    for (const entry of readdirSync(join(ROOT, scope), { withFileTypes: true })) {
      if (entry.isDirectory()) members.push(join(scope, entry.name, "package.json"));
    }
  }
  const wrong = members.filter((m) => JSON.parse(readFileSync(join(ROOT, m), "utf8")).license !== root.license);
  assert.deepEqual(wrong, [], `these manifests do not declare ${root.license}`);
});
