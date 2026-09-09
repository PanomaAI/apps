/*
  The one line a person writes when panoma video measured something wrong.

  Everything else in this pipeline is derived, and the derivations are honest about their
  confidence — but a measurement can be right about the page and wrong about the product.
  Three real cases on this disk: panoma's site is named, in `brand.json`, "The local
  catalog of your projects", because the h1 of a landing page is a sentence and not a
  name; universend's only mark is a 24x24 favicon, which no film can use as a logo; and a
  product whose brand colour appears only on a route the live pass never loaded gets a
  monochrome film that is correct and not what its owner wants.

  `brand.patch.json` sits beside `brand.json` in the workspace, is merged before it is
  written, and outranks every measurement — that is the point of it. A patched swatch is
  recorded as `confidence: "high"`, `origin: "patch"`, so the reason for a colour stays
  readable in the file that carries it, and the direction trusts it the way it trusts a
  CSS token.

  It is the SECOND patch file in the system, not the third: a brief's words are patched in
  `briefs/<id>.patch.json`, and that is where words belong. Nothing here changes a word.
*/
import { readFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { normalizeHex, type BrandProfile } from "@panoma/video-brand";
import type { Workspace } from "./workspace.ts";

export type BrandPatch = {
  name?: string;
  scheme?: "light" | "dark";
  colors?: Partial<Record<"primary" | "accent" | "background" | "surface" | "text" | "muted" | "onPrimary", string>>;
  /** An absolute path, or one relative to the workspace directory. */
  logo?: string;
};

export type PatchResult = { brand: BrandProfile; applied: string[]; refused: string[] };

export const BRAND_PATCH_FILE = "brand.patch.json";

/**
 * Merges the patch into the measured brand. A value that is not a colour is refused BY
 * FIELD NAME rather than silently ignored: a person editing a hex by hand gets told which
 * one they got wrong, which is the whole reason this file is hand-written.
 */
export function applyBrandPatch(brand: BrandProfile, patch: BrandPatch | null, dir?: string): PatchResult {
  if (!patch) return { brand, applied: [], refused: [] };
  const applied: string[] = [];
  const refused: string[] = [];
  let next: BrandProfile = brand;

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length > 0 && name.length <= 60) {
      next = { ...next, name };
      applied.push("name");
    } else refused.push(`name: a product name is between 1 and 60 characters`);
  }

  if (patch.scheme !== undefined) {
    if (patch.scheme === "light" || patch.scheme === "dark") {
      next = { ...next, scheme: { supports: next.scheme.supports.includes(patch.scheme) ? next.scheme.supports : [...next.scheme.supports, patch.scheme], default: patch.scheme } };
      applied.push("scheme");
    } else refused.push(`scheme: "light" or "dark"`);
  }

  if (patch.colors) {
    const colors = { ...next.colors };
    for (const [role, value] of Object.entries(patch.colors)) {
      if (!(role in colors)) {
        refused.push(`colors.${role}: no such role`);
        continue;
      }
      const hex = normalizeHex(value ?? null);
      if (!hex) {
        refused.push(`colors.${role}: "${value}" is not a colour`);
        continue;
      }
      colors[role as keyof typeof colors] = { hex, confidence: "high", origin: "patch" };
      applied.push(`colors.${role}`);
    }
    next = { ...next, colors };
  }

  if (patch.logo !== undefined) {
    /*
      `isAbsolute` and not `startsWith("/")`. The old test was written for POSIX, and on
      Windows an absolute path is `C:\…` or `\\server\share` — neither starts with a
      slash. A person naming an absolute logo in `brand.patch.json` on Windows had it
      joined onto the workspace directory instead, and the render then looked for a file
      that is not there. `path.isAbsolute` answers true for a leading slash as well, so
      nothing changes on the three systems where it already worked.
    */
    const file = isAbsolute(patch.logo) ? patch.logo : join(dir ?? "", patch.logo);
    next = { ...next, logo: { file, kind: next.logo?.kind ?? "logomark", width: next.logo?.width ?? 0, height: next.logo?.height ?? 0, reversed: next.logo?.reversed ?? false, origin: "patch", score: 100 } };
    applied.push("logo");
  }

  return { brand: next, applied, refused };
}

export async function readBrandPatch(ws: Workspace): Promise<BrandPatch | null> {
  try {
    return JSON.parse(await readFile(join(ws.dir, BRAND_PATCH_FILE), "utf8")) as BrandPatch;
  } catch {
    return null;
  }
}
